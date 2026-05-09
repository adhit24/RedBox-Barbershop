'use strict';
/**
 * Repair: update schedules from today with barber_id = null.
 * Fetches all today's bills from Moka (all statuses, deep=true) and
 * extracts barber from billDetail.items using moka_employee_id.
 * Run once: node server/repair-moka-barbers.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  const { data: outlets } = await sb
    .from('outlets').select('id, name, slug, moka_outlet_id').eq('is_active', true).not('moka_outlet_id', 'is', null);
  const { data: tokens } = await sb.from('moka_tokens').select('access_token').order('expires_at', { ascending: false }).limit(1);
  const token = tokens?.[0]?.access_token;
  if (!token) throw new Error('No Moka token available');

  const headers = { 'Authorization': `Bearer ${token}` };
  const base = process.env.MOKA_API_BASE || 'https://api.mokapos.com';

  const today = new Date(); today.setHours(0,0,0,0);
  const { data: badSchedules } = await sb
    .from('schedules')
    .select('id, external_id, outlet_id, service_name')
    .is('barber_id', null)
    .eq('source', 'moka')
    .gte('created_at', today.toISOString())
    .not('external_id', 'is', null);

  console.log(`Found ${badSchedules?.length || 0} schedules to repair`);
  if (!badSchedules?.length) return;

  // Group bad schedules by outlet
  const byOutlet = {};
  for (const sch of badSchedules) {
    (byOutlet[sch.outlet_id] = byOutlet[sch.outlet_id] || []).push(sch);
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const [y, m, d] = todayStr.split('-');
  const fmt = `${d}/${m}/${y}`;

  let totalFixed = 0, totalFailed = 0;

  for (const outlet of outlets) {
    const scheds = byOutlet[outlet.id];
    if (!scheds?.length) continue;

    console.log(`\n--- ${outlet.name} (${scheds.length} schedules) ---`);

    // Fetch all today's bills (all statuses, deep=true, paginated)
    let allBills = [];
    try {
      for (let page = 1; page <= 5; page++) {
        const url = `${base}/v1/outlets/${outlet.moka_outlet_id}/sync_bills/?start=${fmt}&end=${fmt}&per_page=200&deep=true&page=${page}`;
        console.log(`  Fetching page ${page}: ${url}`);
        const res = await fetch(url, { headers });
        const json = await res.json();
        const bills = json?.data || [];
        console.log(`  HTTP ${res.status} — ${Array.isArray(bills) ? bills.length : 'non-array'} bills`);
        if (!Array.isArray(bills) || !bills.length) break;
        allBills = allBills.concat(bills);
        if (bills.length < 200) break;
      }
    } catch (err) {
      console.error(`  Fetch error: ${err.message}`);
      totalFailed += scheds.length;
      continue;
    }

    console.log(`  Total bills fetched: ${allBills.length}`);

    // Build billId → bill map
    const billMap = Object.fromEntries(allBills.map(b => [String(b.id), b]));

    // Fetch barbers for this outlet
    const { data: outletBarbers } = await sb.from('barbers').select('id, name, moka_employee_id').eq('outlet_id', outlet.id).not('moka_employee_id', 'is', null);

    for (const sch of scheds) {
      const bill = billMap[String(sch.external_id)];
      if (!bill) {
        console.log(`  [${sch.external_id}] NOT FOUND in today's bills`);
        totalFailed++;
        continue;
      }

      const items = bill.billDetail?.items || bill.checkouts || bill.items || [];
      let barberId = null, serviceName = null, price = bill.totalPrice || bill.total || null;

      for (const item of items) {
        const mokaItemId = String(item.id || item.item_id || '');
        const barber = (outletBarbers || []).find(b => b.moka_employee_id === mokaItemId);
        if (barber) {
          barberId = barber.id;
          const variantName = item.item_variants?.name || item.variant_name || null;
          if (variantName) serviceName = variantName;
          if (!price && item.item_variants?.price) price = item.item_variants.price;
          console.log(`  [${sch.external_id}] → ${barber.name}${serviceName ? ' / '+serviceName : ''}`);
          break;
        }
      }

      if (!barberId) {
        console.log(`  [${sch.external_id}] No barber in ${items.length} items — names: ${items.map(i=>i.name).join(', ')}`);
        totalFailed++;
        continue;
      }

      const updates = { barber_id: barberId, notes: null };
      if (serviceName) updates.service_name = serviceName;
      if (price != null) updates.price = price;

      const { error } = await sb.from('schedules').update(updates).eq('id', sch.id);
      if (error) { console.error(`  Update error: ${error.message}`); totalFailed++; }
      else totalFixed++;
    }
  }

  console.log(`\nDone: ${totalFixed} fixed, ${totalFailed} failed`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
