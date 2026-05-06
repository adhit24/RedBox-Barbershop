'use strict';
// ============================================================
// MOKA SCHEMA SYNC
// Menyinkronkan data Moka (items/barbers + variants/services)
// ke tabel Supabase agar booking push selalu akurat.
//
// Dipanggil:
//   - Otomatis saat server start (jika OAuth dikonfigurasi)
//   - Via POST /api/moka/sync-schema (manual trigger)
//   - Via cron setiap hari jam 03:00 WIB
// ============================================================

const MOKA_API_BASE = process.env.MOKA_API_BASE || 'https://api.mokapos.com';

// ── NAME NORMALIZATION ────────────────────────────────────────
// Digunakan untuk fuzzy matching barber/service names
function _norm(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Score kecocokan nama (0..1). 1 = exact match.
function _matchScore(a, b) {
  const na = _norm(a);
  const nb = _norm(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  // Token overlap
  const ta = new Set(na.split(' '));
  const tb = new Set(nb.split(' '));
  const inter = [...ta].filter(t => tb.has(t) && t.length > 1).length;
  const union = new Set([...ta, ...tb]).size;
  return union > 0 ? inter / union : 0;
}

function _bestMatch(name, candidates) {
  let best = null, bestScore = 0;
  for (const c of candidates) {
    const score = _matchScore(name, c.name);
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return bestScore >= 0.6 ? { item: best, score: bestScore } : null;
}

// ── MOKA FETCH HELPERS ────────────────────────────────────────

async function _mokaGet(path, token) {
  const res = await fetch(`${MOKA_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Moka ${path} → ${res.status}`);
  return res.json();
}

async function _fetchOutletItems(mokaOutletId, token) {
  const d = await _mokaGet(
    `/v1/outlets/${mokaOutletId}/items?include_variants=true`,
    token
  );
  return d?.data?.items || d?.data || d?.items || [];
}

// ── CORE SYNC ─────────────────────────────────────────────────

/**
 * Sinkronisasi penuh Moka → Supabase untuk semua outlet.
 * Mengupdate:
 *   - barbers.moka_employee_id  (Moka item ID untuk barber)
 *   - services.moka_item_id     (Moka variant ID untuk service, per-outlet via barbers)
 *   - services.moka_category_id / moka_category_name
 *   - services.moka_variant_name (nama variant Moka untuk referensi)
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<object>} laporan sync
 */
async function syncMokaSchema(supabase) {
  const report = { outlets: [], services_updated: 0, barbers_updated: 0, errors: [] };

  // 1. Ambil semua outlet + token
  const { data: outlets } = await supabase
    .from('outlets')
    .select('id, slug, name, moka_outlet_id')
    .not('moka_outlet_id', 'is', null);

  if (!outlets?.length) {
    report.errors.push('No outlets with moka_outlet_id found');
    return report;
  }

  // Ambil token — gunakan token pertama yang tersedia (Client Credentials berlaku global)
  const { data: tokens } = await supabase
    .from('moka_tokens')
    .select('access_token, outlet_id, expires_at')
    .order('expires_at', { ascending: false })
    .limit(1);

  const token = tokens?.[0]?.access_token;
  if (!token) {
    report.errors.push('No Moka token available — run OAuth first');
    return report;
  }

  // 2. Ambil barbers dari Supabase
  const { data: allBarbers } = await supabase
    .from('barbers')
    .select('id, name, outlet_id, moka_employee_id');

  // 3. Ambil services dari Supabase
  const { data: allServices } = await supabase
    .from('services')
    .select('id, name, moka_item_id, moka_category_id, moka_category_name, moka_variant_name');

  // 4. Per outlet: fetch Moka items → update barbers + services
  for (const outlet of outlets) {
    const outletReport = {
      outlet: outlet.slug,
      moka_outlet_id: outlet.moka_outlet_id,
      barbers_matched: [],
      barbers_unmatched: [],
      variants_found: 0,
    };

    try {
      const mokaItems = await _fetchOutletItems(outlet.moka_outlet_id, token);

      // Barbers for this outlet
      const outletBarbers = (allBarbers || []).filter(b => b.outlet_id === outlet.id);

      // Moka barber items = items dengan banyak variants (≥3) dan category = Regular Cutting
      // atau semua items dengan nama yang match barber kita
      const mokaBarberItems = mokaItems.filter(i => i.item_variants?.length >= 2);

      // Match dan update setiap barber
      for (const barber of outletBarbers) {
        const match = _bestMatch(barber.name, mokaBarberItems);
        if (match) {
          const mokaItem = match.item;
          const moka_employee_id = String(mokaItem.id);

          if (barber.moka_employee_id !== moka_employee_id) {
            await supabase
              .from('barbers')
              .update({ moka_employee_id })
              .eq('id', barber.id);
            report.barbers_updated++;
          }

          outletReport.barbers_matched.push({
            barber: barber.name,
            moka_item: mokaItem.name,
            moka_id: mokaItem.id,
            score: Math.round(match.score * 100),
          });

          // Sync services → variants dari barber item ini
          const variants = mokaItem.item_variants || [];
          outletReport.variants_found = Math.max(outletReport.variants_found, variants.length);

          // Update services dengan variant info (hanya sekali per service, pakai barber pertama)
          if (variants.length > 0 && allServices) {
            await _syncServicesFromVariants(supabase, allServices, variants, mokaItem, report);
          }
        } else {
          outletReport.barbers_unmatched.push(barber.name);
        }
      }

      report.outlets.push(outletReport);
    } catch (err) {
      report.errors.push(`${outlet.slug}: ${err.message}`);
      report.outlets.push({ ...outletReport, error: err.message });
    }
  }

  return report;
}

/**
 * Match services kita ke Moka variants dan update jika belum di-set.
 */
async function _syncServicesFromVariants(supabase, services, variants, mokaItem, report) {
  for (const svc of services) {
    // Skip jika sudah punya data lengkap
    if (svc.moka_item_id && svc.moka_category_id && svc.moka_variant_name) continue;

    const match = _bestMatch(svc.name, variants.map(v => ({ name: v.name, id: v.id })));
    if (!match) continue;

    const variant = match.item;
    const updates = {};
    if (!svc.moka_item_id)       updates.moka_item_id     = String(variant.id);
    if (!svc.moka_category_id)   updates.moka_category_id = String(mokaItem.category_id || '');
    if (!svc.moka_category_name) updates.moka_category_name = mokaItem.category?.name || null;
    if (!svc.moka_variant_name)  updates.moka_variant_name = variant.name;

    if (Object.keys(updates).length > 0) {
      await supabase.from('services').update(updates).eq('id', svc.id);
      // Update in-memory untuk iterasi berikutnya
      Object.assign(svc, updates);
      report.services_updated++;
    }
  }
}

/**
 * Lookup item Moka untuk barber tertentu (untuk dipakai saat push booking).
 * Mengembalikan { item_id, category_id, category_name } atau null.
 *
 * @param {string} barberName - nama barber dari booking
 * @param {string} mokaOutletId - Moka outlet ID (e.g. "100818")
 * @param {string} token - access token
 */
async function resolveBarberMokaItem(barberName, mokaOutletId, token) {
  if (!barberName || !mokaOutletId || !token) return null;
  try {
    const items = await _fetchOutletItems(mokaOutletId, token);
    const match = _bestMatch(barberName, items.filter(i => i.item_variants?.length >= 2));
    if (!match) return null;
    const item = match.item;
    return {
      item_id:       item.id,
      category_id:   item.category_id,
      category_name: item.category?.name || null,
      variants:      item.item_variants || [],
    };
  } catch {
    return null;
  }
}

/**
 * Lookup variant ID untuk service tertentu dalam barber item.
 * Mengembalikan variant_id atau null.
 *
 * @param {string} serviceName - nama service dari booking
 * @param {Array}  variants    - array variants dari resolveBarberMokaItem
 */
function resolveVariantId(serviceName, variants) {
  if (!serviceName || !variants?.length) return null;
  const match = _bestMatch(serviceName, variants.map(v => ({ name: v.name, id: v.id })));
  return match ? match.item.id : null;
}

module.exports = { syncMokaSchema, resolveBarberMokaItem, resolveVariantId, _norm, _matchScore };
