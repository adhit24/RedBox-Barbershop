'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  const [{ data: scheds }, { data: logs }] = await Promise.all([
    sb.from('schedules_full')
      .select('id, customer_name, customer_phone, barber_name, start_time, status, source, external_id, created_at')
      .ilike('barber_name', '%dul%')
      .gte('start_time', '2026-05-07T00:00:00Z')
      .order('start_time'),

    sb.from('sync_logs')
      .select('direction, status, error_message, payload, created_at')
      .gte('created_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false }),
  ]);

  console.log('=== Schedules barber Abdul hari ini ===');
  for (const s of (scheds || [])) {
    const t = new Date(s.start_time).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    const c = new Date(s.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    console.log(`  ${s.customer_name || '(no name)'} | ${t} | status:${s.status} | ext:${s.external_id || '-'}`);
    console.log(`    created:${c} | phone:${s.customer_phone || '-'}`);
  }

  console.log('\n=== Sync logs 30 menit terakhir ===');
  for (const l of (logs || [])) {
    const err = l.error_message ? ' ERR:' + l.error_message.slice(0, 80) : '';
    console.log(`  ${l.direction} | ${l.status} | mokaId:${l.payload?.mokaOrderId || '-'}${err}`);
    console.log(`    ${l.created_at}`);
  }
}
main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
