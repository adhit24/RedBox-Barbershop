/**
 * Cron — GET /api/cron/reengagement
 * Runs daily at 11:00 WIB via cron-job.org.
 * Sends WhatsApp re-engagement reminder to at-risk & lost customers
 * (last_visit > 30 days, non-member, belum di-remind dalam 30 hari terakhir).
 * Batch: 50 customers per run.
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');
const { sendReengagementBatch } = require('../../server/services/reengagement');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers['authorization'];
  if (secret && authHeader !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('[Reengagement] Cron triggered');

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    const result = await sendReengagementBatch(supabase);
    console.log('[Reengagement] Done:', JSON.stringify(result));
    return res.status(200).json(result);

  } catch (err) {
    console.error('[Reengagement] Unexpected error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
