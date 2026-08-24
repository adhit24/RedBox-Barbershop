'use strict';

/**
 * Redbox CRM Customer Identity Resolver
 * Resolves raw input (phone / customer_id / user_key) to canonical customer_id (UUID)
 * strictly using verified identity logic and conservative security rules.
 */

const {
  normalizeMemberPhone,
  getMemberPhoneVariants,
  mergeCustomerRows,
} = require('../member-identity');

/**
 * Resolves customer identity against database.
 * @param {object} supabase - Supabase client instance
 * @param {object} input - Query params: { phone, customer_id, user_key }
 * @returns {Promise<object>} Identity resolution result object
 */
async function resolveCustomerIdentity(supabase, input = {}) {
  const { customer_id, phone, user_key } = input;

  // 1. Direct UUID Lookup
  if (customer_id && typeof customer_id === 'string' && customer_id.trim()) {
    const cleanId = customer_id.trim();
    const { data: customer, error } = await supabase
      .from('customers')
      .select('*')
      .eq('id', cleanId)
      .maybeSingle();

    if (error) {
      return {
        found: false,
        customer_id: null,
        resolution: 'db_error',
        error: error.message,
      };
    }

    if (customer) {
      return {
        found: true,
        customer_id: customer.id,
        canonical_phone: normalizeMemberPhone(customer.wa || customer.phone_e164),
        phone_e164: customer.phone_e164 || (customer.wa ? `+${normalizeMemberPhone(customer.wa)}` : null),
        resolution: 'direct_id_match',
        customer_row: customer,
      };
    }
  }

  // 2. Phone / User Key Lookup
  const targetPhone = phone || user_key;
  if (!targetPhone || typeof targetPhone !== 'string' || !targetPhone.trim()) {
    return {
      found: false,
      customer_id: null,
      resolution: 'missing_input',
    };
  }

  const canonical = normalizeMemberPhone(targetPhone);
  if (!canonical || canonical.length < 9) {
    return {
      found: false,
      customer_id: null,
      resolution: 'invalid_phone_format',
    };
  }

  const variants = getMemberPhoneVariants(canonical);

  // Clean OR clauses for PostgREST syntax
  const orConditions = variants.map(v => {
    const digits = String(v).replace(/\D/g, '');
    return `wa.eq.${digits},phone_e164.eq.${digits},phone_e164.eq.+${digits}`;
  }).join(',');

  // Fetch candidates from `customers` table matching any phone variant
  const { data: customerRows, error: custErr } = await supabase
    .from('customers')
    .select('*')
    .or(orConditions);

  if (custErr) {
    return {
      found: false,
      customer_id: null,
      resolution: 'db_error',
      error: custErr.message,
    };
  }

  // Fetch candidate from `member_profiles` if customer row is missing
  const profileConditions = variants.map(v => {
    const digits = String(v).replace(/\D/g, '');
    return `phone.eq.${digits},phone.eq.+${digits}`;
  }).join(',');

  let memberProfileRow = null;
  const { data: profileRows, error: profErr } = await supabase
    .from('member_profiles')
    .select('*')
    .or(profileConditions);

  if (profErr) {
    return {
      found: false,
      customer_id: null,
      resolution: 'db_error',
      error: profErr.message,
    };
  }

  if (Array.isArray(profileRows) && profileRows.length > 0) {
    const distinctPhones = new Set(profileRows.map(p => normalizeMemberPhone(p.phone)).filter(Boolean));
    if (distinctPhones.size > 1) {
      return {
        found: false,
        customer_id: null,
        resolution: 'ambiguous',
        reason: 'conflicting_profile_phones',
      };
    }
    memberProfileRow = profileRows[0];
  }

  const candidateRows = Array.isArray(customerRows) ? customerRows : [];

  if (candidateRows.length === 0) {
    if (memberProfileRow) {
      return {
        found: true,
        customer_id: memberProfileRow.id || null,
        user_key: memberProfileRow.user_key || null,
        canonical_phone: canonical,
        phone_e164: `+${canonical}`,
        resolution: 'member_profile_match',
        member_profile_row: memberProfileRow,
      };
    }
    return {
      found: false,
      customer_id: null,
      resolution: 'not_found',
    };
  }

  // Check for ambiguous identity:
  // If candidate rows contain multiple distinct customer UUIDs with materially conflicting identity details (e.g. names)
  const distinctCustomerIds = new Set(candidateRows.map(r => r.id).filter(Boolean));

  if (distinctCustomerIds.size > 1) {
    const names = new Set(
      candidateRows
        .map(r => (r.name || '').trim().toLowerCase())
        .filter(Boolean)
    );
    // If different candidate rows have different non-empty names, it is ambiguous
    if (names.size > 1) {
      return {
        found: false,
        customer_id: null,
        resolution: 'ambiguous',
        reason: 'conflicting_customer_names',
      };
    }
  }

  // Safe merge if candidates have compatible/non-conflicting identities
  const merged = mergeCustomerRows(candidateRows, canonical);
  if (!merged) {
    return {
      found: false,
      customer_id: null,
      resolution: 'not_found',
    };
  }

  return {
    found: true,
    customer_id: merged.id || null,
    canonical_phone: canonical,
    phone_e164: merged.phone_e164 || `+${canonical}`,
    resolution: 'phone_match',
    customer_row: merged,
    member_profile_row: memberProfileRow,
  };
}

module.exports = {
  resolveCustomerIdentity,
};
