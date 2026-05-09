'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  const since = new Date(Date.now() - 90 * 60 * 1000).toISOString();

  const { data: schedules } = await sb
    .from('schedules_full')
    .select('id, customer_name, barber_name, service_name, start_time, status, source, external_id, notes, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false });

  console.log('=== Schedules 1.5 jam terakhir ===');
  for (const s of (schedules || [])) {
    const startWIB = new Date(s.start_time).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' });
    console.log(`  [${s.source}] ${s.customer_name || '(no name)'} ${startWIB} ${s.barber_name || '(no barber)'}`);
    console.log(`    status: ${s.status} | external_id: ${s.external_id || '-'} | created: ${s.created_at}`);
    console.log(`    notes: ${(s.notes || '-').slice(0, 60)}`);
    console.log();
  }

  const { data: logs } = await sb
    .from('sync_logs')
    .select('direction, status, error_message, payload, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(15);

  console.log('=== Sync Logs 1.5 jam terakhir ===');
  for (const l of (logs || [])) {
    const mokaId = l.payload?.mokaOrderId || '-';
    const err = l.error_message ? ` | ERR: ${l.error_message.slice(0, 80)}` : '';
    console.log(`  ${l.direction} | ${l.status} | mokaOrderId: ${mokaId}${err}`);
    console.log(`    created: ${l.created_at}`);
  }
}
main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
