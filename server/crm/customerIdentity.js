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

  const cleanId = (typeof customer_id === 'string' && customer_id.trim()) ? customer_id.trim() : null;

  // 1. Direct UUID Lookup if only customer_id is provided
  if (cleanId && !phone && !user_key) {
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
      const normPhone = normalizeMemberPhone(customer.wa || customer.phone_e164);
      return {
        found: true,
        customer_id: customer.id,
        alias_customer_ids: [customer.id],
        canonical_phone: normPhone,
        phone_e164: customer.phone_e164 || (customer.wa ? `+${normPhone}` : null),
        resolution: 'direct_id_match',
        customer_row: customer,
      };
    }
  }

  // 2. Phone / User Key Lookup
  const targetPhone = phone || user_key;
  if (!targetPhone || typeof targetPhone !== 'string' || !targetPhone.trim()) {
    if (cleanId) {
      const { data: customer, error } = await supabase
        .from('customers')
        .select('*')
        .eq('id', cleanId)
        .maybeSingle();
      if (error) {
        return { found: false, customer_id: null, resolution: 'db_error', error: error.message };
      }
      if (customer) {
        const normPhone = normalizeMemberPhone(customer.wa || customer.phone_e164);
        return {
          found: true,
          customer_id: customer.id,
          alias_customer_ids: [customer.id],
          canonical_phone: normPhone,
          phone_e164: customer.phone_e164 || (customer.wa ? `+${normPhone}` : null),
          resolution: 'direct_id_match',
          customer_row: customer,
        };
      }
    }
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

  // Fetch candidate from `member_profiles`
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
    if (distinctPhones.size > 1 || profileRows.length > 1) {
      return {
        found: false,
        customer_id: null,
        resolution: 'ambiguous',
        reason: 'multiple_member_profile_records',
      };
    }
    memberProfileRow = profileRows[0];
  }

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

  const rawCandidateRows = Array.isArray(customerRows) ? customerRows : [];

  // Filter & validate candidates: BOTH wa and phone_e164 (if populated) must independently normalize to canonical phone
  const candidateRows = [];
  for (const r of rawCandidateRows) {
    const hasWa = typeof r.wa === 'string' && r.wa.trim().length > 0;
    const hasE164 = typeof r.phone_e164 === 'string' && r.phone_e164.trim().length > 0;

    if (!hasWa && !hasE164) {
      continue;
    }

    const normWa = hasWa ? normalizeMemberPhone(r.wa) : null;
    const normE164 = hasE164 ? normalizeMemberPhone(r.phone_e164) : null;

    if (hasWa && hasE164) {
      if (normWa !== normE164 || normWa !== canonical || normE164 !== canonical) {
        return {
          found: false,
          customer_id: null,
          resolution: 'ambiguous',
          reason: 'conflicting_customer_phones',
        };
      }
    } else if (hasWa) {
      if (normWa !== canonical) {
        return {
          found: false,
          customer_id: null,
          resolution: 'ambiguous',
          reason: 'conflicting_customer_phones',
        };
      }
    } else if (hasE164) {
      if (normE164 !== canonical) {
        return {
          found: false,
          customer_id: null,
          resolution: 'ambiguous',
          reason: 'conflicting_customer_phones',
        };
      }
    }

    candidateRows.push(r);
  }

  // Collect candidate customer IDs ONLY from `customers` table
  const aliasCustomerIds = Array.from(new Set(candidateRows.map(r => r.id).filter(Boolean)));

  // If dual claim provided (both phone AND customer_id), verify customer_id belongs strictly to customers.id[] in this cluster!
  if (cleanId) {
    const matchesAliasId = aliasCustomerIds.includes(cleanId);
    if (!matchesAliasId) {
      return {
        found: false,
        customer_id: null,
        resolution: 'ambiguous',
        reason: 'dual_claim_conflict',
      };
    }
  }

  // Member-profile-only path: NO customers table rows found
  if (candidateRows.length === 0) {
    if (memberProfileRow) {
      return {
        found: true,
        customer_id: null, // member_profiles.id MUST NEVER be customer_id!
        alias_customer_ids: [], // member_profiles.id MUST NEVER be in alias_customer_ids!
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

  // Safe merge candidate rows
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
    customer_id: merged.id || null, // customer_id comes STRICTLY from customers.id ONLY
    alias_customer_ids: aliasCustomerIds, // alias_customer_ids comes STRICTLY from customers.id[] ONLY
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
