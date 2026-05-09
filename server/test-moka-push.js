'use strict';
/**
 * Test simulasi: buat schedule dummy lalu push ke Moka Advanced Ordering.
 * Jalankan: node server/test-moka-push.js
 * Schedule ini dibuat dengan status='test' sehingga tidak mempengaruhi data real.
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  // 1. Load outlet bypass + barber Bob
  const { data: outlet } = await supabase
    .from('outlets').select('id, name, moka_outlet_id, slug').eq('slug', 'bypass').single();
  if (!outlet) throw new Error('Outlet bypass tidak ditemukan');

  const { data: barber } = await supabase
    .from('barbers').select('id, name, moka_employee_id').eq('id', 'bypass-bob').single();
  if (!barber) throw new Error('Barber bypass-bob tidak ditemukan');

  const { data: service } = await supabase
    .from('services').select('id, name, price, duration_minutes, moka_variant_name')
    .ilike('name', '%haircut%').limit(1).single();

  console.log('\n=== Test Config ===');
  console.log('Outlet :', outlet.name, '(moka_outlet_id:', outlet.moka_outlet_id, ')');
  console.log('Barber :', barber.name, '(moka_employee_id:', barber.moka_employee_id, ')');
  console.log('Service:', service?.name, '(moka_variant_name:', service?.moka_variant_name, ')');

  // 2. Buat schedule test sementara (start 2 jam dari sekarang)
  const startTime = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
  const endTime   = new Date(Date.now() + 2 * 3600 * 1000 + 30 * 60 * 1000).toISOString();

  const { data: schedule, error: schErr } = await supabase
    .from('schedules')
    .insert({
      outlet_id:    outlet.id,
      barber_id:    barber.id,
      service_id:   service?.id || null,
      service_name: service?.name || 'Haircut',
      price:        service?.price || 35000,
      start_time:   startTime,
      end_time:     endTime,
      status:       'reserved',
      source:       'web',
      notes:        '[TEST SIMULASI — bisa dihapus]',
    })
    .select().single();

  if (schErr) throw new Error('Schedule insert gagal: ' + schErr.message);
  console.log('\n✅ Schedule dibuat:', schedule.id);

  // 3. Upsert test customer
  const { data: customer } = await supabase
    .from('customers')
    .upsert({ name: 'Test Customer', wa: '+6281234560000', phone_e164: '+6281234560000', source: 'web' }, { onConflict: 'phone_e164' })
    .select('id').single();

  await supabase.from('schedules').update({ customer_id: customer?.id }).eq('id', schedule.id);

  // 4. Push ke Moka
  console.log('\n=== Push ke Moka ===');
  const { pushScheduleToMoka } = require('./moka/sync');

  try {
    const result = await pushScheduleToMoka(supabase, schedule.id);
    console.log('✅ Push berhasil!', result);

    // Cek external_id tersimpan
    const { data: updated } = await supabase
      .from('schedules').select('external_id, status').eq('id', schedule.id).single();
    console.log('   external_id (Moka order ID):', updated?.external_id);
    console.log('   status:', updated?.status);

  } catch (err) {
    console.error('❌ Push gagal:', err.message);
    if (err.details) console.error('   Detail:', JSON.stringify(err.details, null, 2));
  }

  // 5. Hapus schedule test
  await supabase.from('schedules').delete().eq('id', schedule.id);
  console.log('\n🧹 Schedule test dihapus');
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
