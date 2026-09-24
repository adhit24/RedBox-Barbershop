'use strict';

const { resolveCustomerIdentity } = require('../../crm/customerIdentity');

/**
 * Read-only lookup of the CRM display name for a TRUSTED WhatsApp phone, used
 * only for the first-turn personal greeting. Reuses the existing normalized
 * phone resolver; fail-closed — ambiguous / not found / db_error yield null.
 * Never creates or mutates customer rows.
 */
async function lookupGreetingName(supabase, phone) {
  if (!supabase || !phone) return null;
  const res = await resolveCustomerIdentity(supabase, { phone });
  return res && res.found ? (res.customer_row?.name || null) : null;
}

module.exports = { lookupGreetingName };
