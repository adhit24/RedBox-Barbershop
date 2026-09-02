'use strict';

// Wrapper around the existing CRM router. The legacy implementation is kept
// byte-for-byte in adminCrmLegacy.js; only the auth middleware passed into it
// is upgraded for Backoffice requests.
const legacy = require('./adminCrmLegacy');
const { createBackofficeSupabaseAuth } = require('../middleware/backofficeSupabaseAuth');

function createAdminCrmRoutes(supabase, legacyAdminAuth) {
  const backofficeAwareAuth = createBackofficeSupabaseAuth(supabase, legacyAdminAuth);
  return legacy.createAdminCrmRoutes(supabase, backofficeAwareAuth);
}

module.exports = {
  ...legacy,
  createAdminCrmRoutes,
};
