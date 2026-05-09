'use strict';
/**
 * Test: buat order → langsung accept via API → harusnya langsung masuk Daftar Bill
 * Jalankan: node server/diag-moka3.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const { getAccessToken } = require('./moka/oauth');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const MOKA_BASE = process.env.MOKA_API_BASE || 'https://api.mokapos.com';

async function req(method, path, body, token) {
  const url = `${MOKA_BASE}${path}`;
  console.log(`\n→ ${method} ${url}`);
  if (body) console.log('  Body:', JSON.stringify(body));
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text().catch(() => '');
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  console.log(`  ← HTTP ${res.status}:`, JSON.stringify(data).slice(0, 300));
  return { status: res.status, ok: res.ok, data };
}

async function main() {
  const { data: outlet } = await sb.from('outlets').select('id, name, moka_outlet_id').eq('slug', 'bypass').single();
  const { data: barber } = await sb.from('barbers').select('id, name, moka_employee_id').eq('id', 'bypass-bob').single();
  const { data: svc } = await sb.from('services').select('id, name, price').ilike('name', '%haircut%').limit(1).single();

  console.log(`Outlet: ${outlet.name} | mokaId: ${outlet.moka_outlet_id}`);

  const token = await getAccessToken(sb, outlet.id);

  // 1. Bersihkan schedule lama
  await sb.from('schedules').delete().like('notes', '%DIAG3%');

  // 2. Buat schedule
  const startTime = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
  const endTime   = new Date(Date.now() + 2.5 * 3600 * 1000).toISOString();
  const { data: cust } = await sb.from('customers')
    .upsert({ name: 'Test Booking Online', wa: '+6281234560003', phone_e164: '+6281234560003', source: 'web' }, { onConflict: 'phone_e164' })
    .select('id').single();
  const { data: sch } = await sb.from('schedules').insert({
    outlet_id: outlet.id, barber_id: barber.id, customer_id: cust?.id,
    service_id: svc.id, service_name: svc.name, price: svc.price,
    start_time: startTime, end_time: endTime, status: 'reserved', source: 'web',
    notes: '[DIAG3 — hapus setelah test]',
  }).select().single();
  console.log('\n✅ Schedule:', sch.id);

  // 3. Buat Advanced Order
  // Fetch category dari items
  const itemsRes = await req('GET', `/v1/outlets/${outlet.moka_outlet_id}/items?include_variants=true`, null, token);
  const items = itemsRes.data?.data?.items || [];
  const bobItem = items.find(i => i.id == barber.moka_employee_id);
  const hairVariant = (bobItem?.item_variants || []).find(v => v.name === 'Hair Cut');

  const orderPayload = {
    application_order_id: sch.id,
    payment_type: 'online_booking',
    customer_name: 'Test Booking Online',
    customer_phone_number: '+6281234560003',
    note: 'Online booking RedBox Bypass — Barber: Bob [DIAG3]',
    client_created_at: startTime,
    auto_cancel_in_seconds: 86400,
    accept_order_notification_url:   `${process.env.APP_BASE_URL}/api/moka/callback/accept`,
    complete_order_notification_url: `${process.env.APP_BASE_URL}/api/moka/callback/complete`,
    cancel_order_notification_url:   `${process.env.APP_BASE_URL}/api/moka/callback/cancel`,
    order_items: [{
      item_id: Number(barber.moka_employee_id),
      item_name: barber.name,
      quantity: 1,
      item_price_library: svc.price,
      ...(hairVariant ? { item_variant_id: hairVariant.id, item_variant_name: hairVariant.name } : {}),
      ...(bobItem ? { category_id: Number(bobItem.category_id), category_name: bobItem.category?.name || 'Regular Cutting' } : {}),
    }],
  };

  const createRes = await req('POST', `/v1/outlets/${outlet.moka_outlet_id}/advanced_orderings/orders`, orderPayload, token);
  const mokaOrderId = createRes.data?.data?.id;

  if (!mokaOrderId) {
    console.error('\n❌ Order tidak terbuat:', JSON.stringify(createRes.data));
    await sb.from('schedules').delete().eq('id', sch.id);
    return;
  }

  console.log(`\n✅ Order dibuat! ID: ${mokaOrderId}`);
  await sb.from('schedules').update({ external_id: String(mokaOrderId), status: 'confirmed' }).eq('id', sch.id);

  // 4. Coba ACCEPT order via API
  console.log('\n=== COBA ACCEPT ORDER VIA API ===');
  const acceptRes = await req('POST', `/v1/outlets/${outlet.moka_outlet_id}/advanced_orderings/orders/${mokaOrderId}/accept`, {}, token);

  // 5. Coba endpoint alternatif jika accept gagal
  if (!acceptRes.ok) {
    console.log('\n  accept gagal, coba endpoint lain...');
    await req('PUT', `/v1/outlets/${outlet.moka_outlet_id}/advanced_orderings/orders/${mokaOrderId}`, { status: 'accepted' }, token);
    await req('PATCH', `/v1/outlets/${outlet.moka_outlet_id}/advanced_orderings/orders/${mokaOrderId}`, { status: 'accepted' }, token);
    await req('POST', `/v1/outlets/${outlet.moka_outlet_id}/advanced_orderings/orders/${mokaOrderId}/confirm`, {}, token);
  }

  // 6. Cek status order setelah accept
  console.log('\n=== CEK STATUS SETELAH ACCEPT ===');
  await req('GET', `/v1/outlets/${outlet.moka_outlet_id}/advanced_orderings/orders/${mokaOrderId}`, null, token);

  console.log(`\n📋 Moka Order ID: ${mokaOrderId}`);
  console.log('   Cek Moka POS apakah sudah muncul di Daftar Bill!');
  console.log(`   Schedule: ${sch.id} (hapus manual setelah test)`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
