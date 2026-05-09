'use strict';
/**
 * Diagnostic 2: test pushScheduleToMoka dengan intercept payload + simpan order
 * Jalankan: node server/diag-moka2.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Intercept MokaClient.createOrder untuk log payload + response
const MokaClient = require('./moka/client');
const _origCreate = MokaClient.prototype.createOrder;
MokaClient.prototype.createOrder = async function(payload) {
  console.log('\n=== PAYLOAD KE MOKA ===');
  console.log(JSON.stringify(payload, null, 2));
  const result = await _origCreate.call(this, payload);
  console.log('\n=== RESPONSE DARI MOKA ===');
  console.log(JSON.stringify(result, null, 2));
  return result;
};

async function main() {
  const { pushScheduleToMoka } = require('./moka/sync');

  const { data: outlet } = await supabase
    .from('outlets').select('id, name, moka_outlet_id, slug').eq('slug', 'bypass').single();
  const { data: barber } = await supabase
    .from('barbers').select('id, name, moka_employee_id').eq('id', 'bypass-bob').single();
  const { data: svc } = await supabase
    .from('services').select('id, name, price, moka_variant_name')
    .ilike('name', '%haircut%').limit(1).single();

  console.log('\n=== Outlet / Barber / Service ===');
  console.log(`  Outlet:  ${outlet.name} | moka_outlet_id: ${outlet.moka_outlet_id}`);
  console.log(`  Barber:  ${barber.name} | moka_employee_id: ${barber.moka_employee_id}`);
  console.log(`  Service: ${svc.name} | price: ${svc.price} | moka_variant: ${svc.moka_variant_name}`);

  // Buat schedule 1 jam dari sekarang (supaya cashier sempat lihat notif)
  const startTime = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const endTime   = new Date(Date.now() + 90 * 60 * 1000).toISOString();

  const { data: customer } = await supabase
    .from('customers')
    .upsert({ name: 'Test Booking 2', wa: '+6281234560002', phone_e164: '+6281234560002', source: 'web' }, { onConflict: 'phone_e164' })
    .select('id').single();

  const { data: schedule, error: schErr } = await supabase
    .from('schedules')
    .insert({
      outlet_id:    outlet.id,
      barber_id:    barber.id,
      customer_id:  customer?.id,
      service_id:   svc.id,
      service_name: svc.name,
      price:        svc.price,
      start_time:   startTime,
      end_time:     endTime,
      status:       'reserved',
      source:       'web',
      notes:        '[DIAG TEST — hapus setelah cek di Moka]',
    })
    .select().single();

  if (schErr) throw new Error('Schedule gagal: ' + schErr.message);
  console.log(`\n✅ Schedule dibuat: ${schedule.id}`);

  try {
    const result = await pushScheduleToMoka(supabase, schedule.id);
    console.log('\n✅ pushScheduleToMoka berhasil:', result);

    const { data: updated } = await supabase
      .from('schedules').select('external_id, status').eq('id', schedule.id).single();
    console.log('   external_id di DB:', updated?.external_id);
    console.log('   status di DB:', updated?.status);

    if (updated?.external_id) {
      console.log('\n======================================================');
      console.log('  ORDER ID MOKA:', updated.external_id);
      console.log('  Schedule ID  :', schedule.id);
      console.log('======================================================');
      console.log('\n⚠️  SEKARANG cek Moka POS untuk notifikasi order masuk!');
      console.log('   Biasanya ada popup atau icon notifikasi di layar POS.');
      console.log('   Tap "Terima" / "Accept" → bill akan muncul di Daftar Bill.');
      console.log('\n   Schedule ini TIDAK dihapus — hapus manual setelah test.');
    }
  } catch (err) {
    console.error('\n❌ Push gagal:', err.message);
    if (err.details) console.error('   Detail:', JSON.stringify(err.details, null, 2));
    await supabase.from('schedules').delete().eq('id', schedule.id);
    console.log('   Schedule test dihapus');
  }
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
