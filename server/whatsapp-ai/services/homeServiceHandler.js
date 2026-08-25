'use strict';
require('../loadEnv').loadEnv();

const { createClient } = require('@supabase/supabase-js');
const { sendWA } = require('../../services/fonnte');
const config = require('../config');
const { escapePostgrestValue } = require('../utils/postgrestEscape');

// sendWA wrapper: kirim dari nomor cabang ini (bukan Bypass)
const sendFromBranch = (to, text) => sendWA(to, text, { branch: config.BRANCH_NAME.toLowerCase() });

const GOOGLE_REVIEW_URLS = {
  bypass:    'https://g.page/r/CQVtP1_nV-SFEBM/review',
  samadikun: 'https://g.page/r/CYSfr6rTvLs1EBM/review',
  sumber:    'https://g.page/r/CS9yPcCA-CznEBM/review',
  tegal:     'https://g.page/r/CWg3nZeYXRxSEBM/review',
  csb:       'https://g.page/r/CbsPlES6TnydEBM/review',
};

const REVIEW_DELAY_MS = 30 * 60 * 1000; // 30 menit setelah konfirmasi selesai

function _db() {
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY;

  return createClient(
    process.env.SUPABASE_URL,
    supabaseKey
  );
}

// Find the earliest job for a barber (looked up by phone) in a given status.
async function _jobByBarberPhone(supabase, phone, status) {
  const { data: barber } = await supabase
    .from('barbers').select('id, name, outlet_id').eq('phone', phone).maybeSingle();
  if (!barber) return null;

  const { data: schRows } = await supabase
    .from('schedules')
    .select('id, start_time, external_id, customer_id')
    .eq('barber_id', barber.id)
    .not('status', 'eq', 'cancelled')
    .order('start_time', { ascending: true });
  if (!schRows?.length) return null;

  const { data: job } = await supabase
    .from('home_service_jobs')
    .select('id, address, status, schedule_id')
    .in('schedule_id', schRows.map(s => s.id))
    .eq('status', status)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!job) return null;

  const schedule = schRows.find(s => s.id === job.schedule_id);
  const { data: customer } = await supabase
    .from('customers').select('name, phone').eq('id', schedule.customer_id).maybeSingle();

  return { job, schedule, barber, customer };
}

// Find the earliest job for a customer (looked up by phone) in a given status.
async function _jobByCustomerPhone(supabase, phone, status) {
  const safePhone = escapePostgrestValue(phone);
  const { data: customer } = await supabase
    .from('customers').select('id, name')
    .or(`phone.eq.${safePhone},phone_e164.eq.${safePhone},wa.eq.${safePhone}`)
    .maybeSingle();
  if (!customer) return null;

  const { data: schRows } = await supabase
    .from('schedules')
    .select('id, external_id, barber_id')
    .eq('customer_id', customer.id)
    .not('status', 'eq', 'cancelled')
    .order('start_time', { ascending: true });
  if (!schRows?.length) return null;

  const { data: job } = await supabase
    .from('home_service_jobs')
    .select('id, address, status, schedule_id')
    .in('schedule_id', schRows.map(s => s.id))
    .eq('status', status)
    .limit(1)
    .maybeSingle();
  if (!job) return null;

  const schedule = schRows.find(s => s.id === job.schedule_id);
  const { data: barber } = await supabase
    .from('barbers').select('name, phone').eq('id', schedule.barber_id).maybeSingle();

  return { job, schedule, customer, barber };
}

async function _handleBerangkat(from) {
  const supabase = _db();
  const result = await _jobByBarberPhone(supabase, from, 'confirmed');
  if (!result) {
    await sendFromBranch(from, 'Tidak ada pekerjaan home service aktif yang ditemukan untuk nomor Anda.');
    return;
  }
  const { job, barber, customer } = result;

  await supabase
    .from('home_service_jobs')
    .update({ status: 'on_the_way', barber_enroute_at: new Date().toISOString() })
    .eq('id', job.id);

  await sendFromBranch(from, '✅ Status diperbarui: *Dalam Perjalanan*. Hati-hati di jalan!');

  if (customer?.phone) {
    await sendFromBranch(customer.phone,
      `🛵 Kapster *${barber.name}* sedang dalam perjalanan ke lokasi Anda.\n\nDitunggu ya! ✂️`
    );
  }
}

async function _handleSelesai(from) {
  const supabase = _db();
  const result = await _jobByBarberPhone(supabase, from, 'on_the_way');
  if (!result) {
    await sendFromBranch(from, 'Tidak ada pekerjaan home service aktif yang ditemukan untuk nomor Anda.');
    return;
  }
  const { job, barber, customer } = result;

  await supabase
    .from('home_service_jobs')
    .update({ status: 'done_barber', barber_done_at: new Date().toISOString() })
    .eq('id', job.id);

  await sendFromBranch(from, '✅ Pekerjaan dilaporkan selesai. Menunggu konfirmasi pelanggan.');

  if (customer?.phone) {
    await sendFromBranch(customer.phone,
      `✅ Kapster *${barber.name}* melaporkan pekerjaan selesai.\n\nSudah menerima layanan? Balas *YA* untuk konfirmasi.`
    );
  }
}

// Returns true if a matching job was found and handled.
// Returns false if no job found — 'ya' is common Indonesian, don't block normal flow.
async function _handleYa(from) {
  const supabase = _db();
  const result = await _jobByCustomerPhone(supabase, from, 'done_barber');
  if (!result) return false;

  const { job, barber } = result;

  await supabase
    .from('home_service_jobs')
    .update({ status: 'completed', customer_confirmed_at: new Date().toISOString() })
    .eq('id', job.id);

  await sendFromBranch(from, '🎉 Terima kasih sudah mengkonfirmasi! Senang bisa melayani kamu ✂️');

  if (barber?.phone) {
    await sendFromBranch(barber.phone,
      '✅ Pekerjaan Anda telah dikonfirmasi selesai oleh pelanggan. Terima kasih! 🎉'
    );
  }

  // Kirim permintaan ulasan Google 30 menit setelah konfirmasi selesai
  const customerPhone = from;
  const branchKey  = config.BRANCH_NAME.toLowerCase();
  const branchName = config.BRANCH_NAME;
  const reviewLink = GOOGLE_REVIEW_URLS[branchKey] || GOOGLE_REVIEW_URLS.bypass;
  const kapsterStr = result.barber?.name ? `bareng *${result.barber.name}*` : 'di Redbox';
  const custName   = result.customer?.name ? result.customer.name.split(' ')[0] : 'Kak';

  setTimeout(async () => {
    try {
      const message =
`Haii kak *${custName}*! 👋

Makasih banyak ya udah percayain *RedBox ${branchName}* buat grooming hari ini — beneran berarti banget buat kami 🙏✨ Semoga hasil ${kapsterStr} bikin makin pede & fresh ya 💈

Jujur kak, ulasan dari kakak di Google itu *bintang utamanya tim kami*. Cuma butuh *30 detik* aja, tapi dampaknya luar biasa buat bikin para kapster tambah semangat ngasih service terbaik 💯🔥

⭐ *Tulis ulasan kakak di sini:*
👉 ${reviewLink}

Dukungan singkat kakak = energi besar buat RedBox terus tumbuh. Terima kasih banyak kak! 😎✂️`;

      await sendFromBranch(customerPhone, message);
      console.log(`[HomeService] ✅ Review request sent to ${customerPhone} (branch: ${branchName})`);
    } catch (err) {
      console.error(`[HomeService] ❌ Failed to send review request to ${customerPhone}:`, err.message);
    }
  }, REVIEW_DELAY_MS);

  return true;
}

// Main entry: returns true if the message was handled as a home service command.
const handle = async (from, lowerText) => {
  if (lowerText === 'berangkat') { await _handleBerangkat(from); return true; }
  if (lowerText === 'selesai')   { await _handleSelesai(from);   return true; }
  if (lowerText === 'ya')        { return await _handleYa(from); }
  return false;
};

module.exports = { handle };
