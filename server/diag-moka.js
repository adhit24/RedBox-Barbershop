'use strict';
/**
 * Diagnostic lengkap: cek order 7962149 dan test create order baru dengan verbose log
 * Jalankan: node server/diag-moka.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const MOKA_API_BASE = process.env.MOKA_API_BASE || 'https://api.mokapos.com';

async function getToken(outletId) {
  const { data } = await supabase
    .from('moka_tokens')
    .select('access_token, expires_at, scope')
    .eq('outlet_id', outletId)
    .single();
  return data;
}

async function mokaReq(method, path, body, token) {
  const url = `${MOKA_API_BASE}${path}`;
  console.log(`\n→ ${method} ${url}`);
  if (body) console.log('  Body:', JSON.stringify(body, null, 2));

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text().catch(() => '');
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

  console.log(`  ← HTTP ${res.status}`);
  console.log('  Response:', JSON.stringify(data, null, 2));
  return { status: res.status, ok: res.ok, data };
}

async function main() {
  // 1. Load bypass outlet + token
  const { data: outlet } = await supabase
    .from('outlets').select('id, name, moka_outlet_id, slug').eq('slug', 'bypass').single();

  if (!outlet) throw new Error('Outlet bypass tidak ditemukan');
  console.log('\n=== Outlet ===');
  console.log(`  ${outlet.name} | moka_outlet_id: ${outlet.moka_outlet_id}`);

  const tokenRow = await getToken(outlet.id);
  if (!tokenRow) throw new Error('Token tidak ditemukan untuk bypass outlet');

  const token = tokenRow.access_token;
  const now = new Date();
  const exp = new Date(tokenRow.expires_at);
  console.log(`  Token scope: ${tokenRow.scope}`);
  console.log(`  Token expires: ${tokenRow.expires_at} (${exp > now ? '✅ valid' : '❌ EXPIRED'})`);

  // 2. Cek order lama (7962149) masih ada atau tidak
  console.log('\n=== CEK ORDER LAMA 7962149 ===');
  await mokaReq('GET', `/v1/outlets/${outlet.moka_outlet_id}/advanced_orderings/orders/7962149`, null, token);

  // 3. Cek GET list advanced orders dengan berbagai endpoint
  console.log('\n=== CEK GET LIST ENDPOINTS ===');
  await mokaReq('GET', `/v1/outlets/${outlet.moka_outlet_id}/advanced_orderings/orders`, null, token);
  await mokaReq('GET', `/v2/outlets/${outlet.moka_outlet_id}/advanced_orderings/orders`, null, token);

  // 4. Load barber Bob + service
  const { data: barber } = await supabase
    .from('barbers').select('id, name, moka_employee_id').eq('id', 'bypass-bob').single();

  const { data: svc } = await supabase
    .from('services').select('id, name, price, moka_variant_name')
    .ilike('name', '%haircut%').limit(1).single();

  console.log('\n=== Barber & Service ===');
  console.log(`  Barber: ${barber?.name} | moka_employee_id: ${barber?.moka_employee_id}`);
  console.log(`  Service: ${svc?.name} | moka_variant_name: ${svc?.moka_variant_name} | price: ${svc?.price}`);

  // 5. GET items untuk cari variant_id yang benar
  console.log('\n=== GET ITEMS (cari variant_id untuk Hair Cut) ===');
  const itemsRes = await mokaReq('GET', `/v1/outlets/${outlet.moka_outlet_id}/items?include_variants=true`, null, token);

  let targetItem = null;
  let targetVariantId = null;
  const items = itemsRes.data?.data?.items || itemsRes.data?.data || itemsRes.data?.items || [];

  for (const item of (Array.isArray(items) ? items : [])) {
    const nameLower = (item.name || '').toLowerCase();
    if (nameLower.includes('bob') || item.id == barber?.moka_employee_id) {
      console.log(`\n  FOUND item for Bob: id=${item.id} name="${item.name}"`);
      targetItem = item;
      for (const v of (item.item_variants || [])) {
        console.log(`    variant: id=${v.id} name="${v.name}" price=${v.price}`);
        if ((v.name || '').toLowerCase().includes('hair cut') || (v.name || '').toLowerCase().includes('haircut')) {
          targetVariantId = v.id;
          console.log(`    ↑ TARGET VARIANT`);
        }
      }
    }
  }

  // 6. Buat schedule test real
  const startTime = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 jam dari sekarang
  const endTime   = new Date(Date.now() + 90 * 60 * 1000).toISOString(); // 1.5 jam dari sekarang

  const { data: customer } = await supabase
    .from('customers')
    .upsert({ name: 'Test Diag', wa: '+6281234560001', phone_e164: '+6281234560001', source: 'web' }, { onConflict: 'phone_e164' })
    .select('id').single();

  const { data: schedule, error: schErr } = await supabase
    .from('schedules')
    .insert({
      outlet_id:    outlet.id,
      barber_id:    barber?.id,
      customer_id:  customer?.id,
      service_id:   svc?.id,
      service_name: svc?.name || 'Haircut',
      price:        svc?.price || 35000,
      start_time:   startTime,
      end_time:     endTime,
      status:       'reserved',
      source:       'web',
      notes:        '[DIAG TEST — hapus setelah cek]',
    })
    .select().single();

  if (schErr) throw new Error('Schedule insert gagal: ' + schErr.message);
  console.log(`\n✅ Schedule dibuat: ${schedule.id}`);
  console.log(`   Start: ${startTime}`);

  // 7. Buat payload VERBOSE ke Moka
  const baseUrl = (process.env.APP_BASE_URL || 'https://redboxbarbershop.com').replace(/\/$/, '');

  const orderPayload = {
    application_order_id:            schedule.id,
    payment_type:                    'online_booking',
    customer_name:                   'Test Diag',
    customer_phone_number:           '+6281234560001',
    note:                            `[DIAG] Online booking — RedBox Bypass | Barber: Bob`,
    client_created_at:               startTime,
    auto_cancel_in_seconds:          3600,
    accept_order_notification_url:   `${baseUrl}/api/moka/callback/accept`,
    complete_order_notification_url: `${baseUrl}/api/moka/callback/complete`,
    cancel_order_notification_url:   `${baseUrl}/api/moka/callback/cancel`,
    order_items: [{
      item_id:             barber?.moka_employee_id ? Number(barber.moka_employee_id) : undefined,
      item_name:           barber?.name || 'Bob',
      quantity:            1,
      item_price_library:  svc?.price || 35000,
      ...(targetVariantId ? { item_variant_id: Number(targetVariantId) } : {}),
      item_variant_name:   svc?.moka_variant_name || 'Hair Cut',
    }],
  };

  console.log('\n=== CREATE ORDER BARU (VERBOSE) ===');
  const createRes = await mokaReq(
    'POST',
    `/v1/outlets/${outlet.moka_outlet_id}/advanced_orderings/orders`,
    orderPayload,
    token
  );

  const newOrderId = createRes.data?.data?.id || createRes.data?.id;
  console.log(`\n  Moka Order ID: ${newOrderId || '❌ TIDAK ADA'}`);

  if (newOrderId) {
    // 8. Langsung GET order baru untuk lihat statusnya
    console.log('\n=== CEK STATUS ORDER BARU ===');
    await mokaReq('GET', `/v1/outlets/${outlet.moka_outlet_id}/advanced_orderings/orders/${newOrderId}`, null, token);

    // Update schedule dengan order ID
    await supabase.from('schedules').update({
      external_id: String(newOrderId),
      status: 'confirmed',
    }).eq('id', schedule.id);

    console.log('\n✅ Schedule diupdate dengan Moka order ID:', newOrderId);
    console.log('   ⚠️  Cek di MokaPOS sekarang! (bisa ada di notifikasi incoming order)');
    console.log('   ⚠️  Schedule ini TIDAK dihapus — hapus manual setelah cek.');
    console.log(`   Schedule ID: ${schedule.id}`);
  } else {
    console.log('\n❌ Order tidak berhasil dibuat atau response tidak punya ID');
    await supabase.from('schedules').delete().eq('id', schedule.id);
    console.log('   Schedule test dihapus');
  }
}

main().catch(err => { console.error('\nFatal:', err.message); process.exit(1); });
