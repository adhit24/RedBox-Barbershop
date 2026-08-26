'use strict';

/**
 * Redbox CRM Customer Identity Resolver
 * Resolves raw input (phone / customer_id / user_key) to canonical customer_id
 * strictly using verified identity logic and conservative security rules.
 */

const {
  normalizeMemberPhone,
  getMemberPhoneVariants,
  mergeCustomerRows,
} = require('../member-identity');

/**
 * Determines whether a set of non-empty name strings are small/compatible variants of the same logical person.
 */
function areNamesCompatibleVariants(nameList) {
  const normalized = nameList.map(n => String(n || '').trim().toLowerCase()).filter(Boolean);
  if (normalized.length <= 1) return true;

  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      const a = normalized[i];
      const b = normalized[j];
      if (a === b) continue;

      // Substring / prefix match (e.g. "Adhit" vs "Adhit Nugraha")
      if (a.startsWith(b) || b.startsWith(a) || a.includes(b) || b.includes(a)) continue;

      // Token comparison (e.g. "Adhit Nugraha" vs "Adhitya Nugraha")
      const tokensA = a.split(/\s+/);
      const tokensB = b.split(/\s+/);
      const commonTokens = tokensA.filter(t => tokensB.includes(t));
      const significantCommon = commonTokens.filter(t => t.length >= 3);
      if (significantCommon.length > 0) continue;

      // Prefix similarity on first name (e.g. "Adhit" vs "Adhitya")
      const firstA = tokensA[0] || '';
      const firstB = tokensB[0] || '';
      if (firstA.length >= 3 && firstB.length >= 3) {
        if (firstA.startsWith(firstB.slice(0, 3)) || firstB.startsWith(firstA.slice(0, 3))) continue;
      }

      return false;
    }
  }
  return true;
}

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

  // Fetch candidate from `member_profiles` if customer row is missing or to establish canonical anchor
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

  // Check for ambiguous identity:
  // If candidate rows contain multiple distinct customer UUIDs with materially conflicting names AND no memberProfileRow anchor
  const distinctCustomerIds = new Set(candidateRows.map(r => r.id).filter(Boolean));
  if (distinctCustomerIds.size > 1) {
    const names = candidateRows.map(r => (r.name || '').trim()).filter(Boolean);
    if (!memberProfileRow && !areNamesCompatibleVariants(names)) {
      return {
        found: false,
        customer_id: null,
        resolution: 'ambiguous',
        reason: 'conflicting_customer_names',
      };
    }
  }

  if (candidateRows.length === 0) {
    if (memberProfileRow) {
      return {
        found: true,
        customer_id: memberProfileRow.id || memberProfileRow.user_key || null,
        user_key: memberProfileRow.user_key || null,
        canonical_phone: canonical,
        phone_e164: memberProfileRow.phone ? `+${normalizeMemberPhone(memberProfileRow.phone)}` : `+${canonical}`,
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

  const merged = mergeCustomerRows(candidateRows, canonical);
  const canonicalId = memberProfileRow?.id || (merged ? merged.id : candidateRows[0].id);

  return {
    found: true,
    customer_id: canonicalId || null,
    canonical_phone: canonical,
    phone_e164: (merged && merged.phone_e164) || `+${canonical}`,
    resolution: memberProfileRow ? 'member_profile_match' : 'phone_match',
    customer_row: merged || candidateRows[0],
    member_profile_row: memberProfileRow,
  };
}

module.exports = {
  resolveCustomerIdentity,
  areNamesCompatibleVariants,
};
