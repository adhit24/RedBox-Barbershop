/**
 * Re-engagement WhatsApp Reminder Service
 *
 * Kirim WA reminder otomatis ke customer yang:
 *  - last_visit > 30 hari lalu (kategori At-Risk + Lost di CRM)
 *  - BUKAN active member (cross-check ke membership DB)
 *  - last_reminder_at NULL atau > 30 hari lalu (cooldown 1 reminder/bulan)
 *
 * Dipanggil otomatis tiap hari oleh api/cron/reminders.js setelah H-1 booking reminders.
 * Batch limit: 50 customer per run untuk hindari rate-limit Fonnte.
 */

'use strict';

const { sendWA } = require('./fonnte');

const BATCH_LIMIT     = 50;
const COOLDOWN_DAYS   = 30;
const MIN_INACTIVE_DAYS = 30;
const SEND_DELAY_MS   = 600;

// Member tables sekarang di PRIMARY DB (post-consolidation 2026-05-28),
// jadi cukup pakai supabase client utama yang sudah di-pass ke
// sendReengagementBatch — tidak perlu cross-DB fetch lagi.

function buildMessage(name) {
  const fn = String(name || 'Kak').split(' ')[0];
  return `Halo ${fn}! 👋

Sudah hampir 1 bulan kita belum jumpa di Redbox Barbershop. Rambutmu pasti sudah mulai panjang nih 😄

Yuk booking lagi di redboxbarbershop.com/booking.html — ada promo spesial buat kamu! 🔥`;
}

function normalizePhone(raw) {
  if (!raw) return '';
  let d = String(raw).replace(/\D/g, '');
  if (d.startsWith('62')) d = d.slice(2);
  else if (d.startsWith('0')) d = d.slice(1);
  return d.slice(-11);
}

/** Ambil daftar nomor phone member ACTIVE dari member_profiles (same DB sekarang). */
async function fetchActiveMemberPhones(supabase) {
  try {
    const { data, error } = await supabase
      .from('member_profiles').select('phone').eq('membership_status', 'ACTIVE');
    if (error) {
      console.warn('[Reengagement] Failed to fetch member phones:', error.message);
      return new Set();
    }
    const set = new Set();
    for (const r of data || []) {
      const n = normalizePhone(r.phone);
      if (n) set.add(n);
    }
    return set;
  } catch (err) {
    console.warn('[Reengagement] Member phone fetch error:', err.message);
    return new Set();
  }
}

/**
 * Jalankan satu batch re-engagement.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase  — main DB client
 * @returns {Promise<{ scanned: number, eligible: number, sent: number, failed: number, skipped_members: number }>}
 */
async function sendReengagementBatch(supabase) {
  const now = new Date();
  const cutoffLastVisit = new Date(now.getTime() - MIN_INACTIVE_DAYS * 86400000).toISOString().slice(0, 10);
  const cutoffReminder  = new Date(now.getTime() - COOLDOWN_DAYS    * 86400000).toISOString();

  // Query candidate customers: at-risk OR lost + belum di-reminder dalam 30 hari
  // Fetch lebih banyak dari BATCH_LIMIT karena akan di-filter lagi by membership
  const FETCH_BUFFER = BATCH_LIMIT * 2;
  const { data: candidates, error } = await supabase
    .from('customers')
    .select('id, name, wa, last_visit, last_reminder_at')
    .lt('last_visit', cutoffLastVisit)
    .not('wa', 'is', null)
    .or(`last_reminder_at.is.null,last_reminder_at.lt.${cutoffReminder}`)
    .order('last_visit', { ascending: true })
    .limit(FETCH_BUFFER);

  if (error) {
    console.error('[Reengagement] Query error:', error.message);
    return { scanned: 0, eligible: 0, sent: 0, failed: 0, skipped_members: 0, error: error.message };
  }

  const scanned = candidates?.length || 0;
  if (!scanned) {
    console.log('[Reengagement] Tidak ada candidate untuk hari ini.');
    return { scanned: 0, eligible: 0, sent: 0, failed: 0, skipped_members: 0 };
  }

  const memberPhones = await fetchActiveMemberPhones(supabase);

  const eligible = [];
  let skippedMembers = 0;
  for (const c of candidates) {
    if (!c.wa) continue;
    const norm = normalizePhone(c.wa);
    if (!norm || norm.length < 8) continue;
    if (memberPhones.has(norm)) { skippedMembers++; continue; }
    eligible.push(c);
    if (eligible.length >= BATCH_LIMIT) break;
  }

  console.log(`[Reengagement] Scanned ${scanned}, eligible ${eligible.length}, skipped_members ${skippedMembers}`);

  let sent = 0, failed = 0;
  for (const c of eligible) {
    try {
      const result = await sendWA(c.wa, buildMessage(c.name));
      if (result && result.status === false) {
        failed++;
        console.error(`[Reengagement] Fonnte rejected ${c.wa} (${c.name}): ${JSON.stringify(result)}`);
      } else {
        sent++;
        await supabase
          .from('customers')
          .update({ last_reminder_at: new Date().toISOString() })
          .eq('id', c.id);
      }
      await new Promise(r => setTimeout(r, SEND_DELAY_MS));
    } catch (err) {
      failed++;
      console.error(`[Reengagement] Send error to ${c.wa}:`, err.message);
    }
  }

  console.log(`[Reengagement] Done. Sent: ${sent}, Failed: ${failed}`);
  return { scanned, eligible: eligible.length, sent, failed, skipped_members: skippedMembers };
}

module.exports = { sendReengagementBatch };
