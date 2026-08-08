'use strict';

/**
 * Cron — GET /api/cron/expire-membership-registrations
 * Configure an external scheduler (cron-job.org) to call this endpoint hourly.
 * The database keeps EXPIRED rows for audit; they disappear from Pending lists.
 */

const { createClient } = require('@supabase/supabase-js');
const { expirePendingMembershipRegistrations } = require('../../server/services/membershipRegistration');

function isAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers['x-vercel-cron'] === '1'
    || req.headers.authorization === `Bearer ${secret}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  if (!isAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );
    const result = await expirePendingMembershipRegistrations(supabase, new Date());
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error('[ExpireMembershipRegistrations] Unexpected error:', error.message);
    return res.status(500).json({ error: error.message });
  }
};

