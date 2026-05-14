/**
 * Vercel Cron — GET /api/cron/birthday
 * Runs daily at 08:00 WIB (01:00 UTC).
 * Sends birthday free-cut promo to customers born today.
 * Requires: customers table to have a `birthday` column (format: MM-DD, e.g. "05-14")
 */

const { createClient } = require('@supabase/supabase-js');
const { sendWA } = require('../../server/services/fonnte');

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function todayMMDD() {
  // WIB = UTC+7
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const m = String(wib.getUTCMonth() + 1).padStart(2, '0');
  const d = String(wib.getUTCDate()).padStart(2, '0');
  return `${m}-${d}`;
}

function buildBirthdayMessage(name, wa) {
  const firstName = (name || 'Kak').split(' ')[0];

  return pick([
    `Haii kak ${firstName}! 🎂🎉\n\nSelamat ulang tahun dari kami semua di *RedBox Barbershop*! 🥳🥳\n\nSemoga panjang umur, sehat selalu, dan makin kece penampilannya ya!\n\nSpesial hari ini, kamu dapet:\n🎁 *FREE HAIRCUT* — gratis potong rambut!\n\nCaranya gampang:\n✅ Tunjukin pesan ini ke kasir\n✅ Berlaku hari ini aja ya kak\n\nBooking dulu biar dapat slot yang pas:\n👉 *redboxbarbershop.com/booking.html*\n\nHappy birthday kak ${firstName}! 🎊🎊🎊`,

    `Selamat ultah kak ${firstName}! 🎉🎂✨\n\nWah hari ini hari spesial banget nih! Semoga semua harapannya terkabul ya kak 🙏\n\nDari RedBox, ada kado spesial buat kamu:\n🎁 *GRATIS HAIRCUT* — khusus hari ini!\n\nGampang banget cara dapetinnya:\n1️⃣ Booking di redboxbarbershop.com/booking.html\n2️⃣ Dateng ke outlet\n3️⃣ Tunjukin pesan ini ke kasir\n4️⃣ Done — gratis! 🙌\n\nJangan sampe kelewatan ya kak! Berlaku hari ini doang 😄\n\nHappy birthday! 🥳`,

    `Kak ${firstName}! 🎂\n\nHappy birthday ya dari seluruh tim *RedBox Barbershop*!\n\nUlang tahun itu momen buat tampil lebih kece — dan kami punya kado untukmu:\n\n💈 *FREE HAIRCUT hari ini!*\n\nTinggal:\n✔️ Booking: redboxbarbershop.com/booking.html\n✔️ Dateng & tunjukin pesan ini\n\nSelamat merayakan kak! Kamu berhak tampil terbaik hari ini 🌟`,
  ]);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers['authorization'];
  if (secret && authHeader !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const today = todayMMDD();
  console.log(`[Birthday] Checking customers with birthday: ${today}`);

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // Query customers whose birthday matches today (MM-DD)
    // The `birthday` column should store in format "MM-DD" (e.g. "05-14")
    const { data: customers, error } = await supabase
      .from('customers')
      .select('id, name, wa, birthday')
      .eq('birthday', today)
      .not('wa', 'is', null);

    if (error) {
      // If column doesn't exist yet, log and skip gracefully
      if (error.code === '42703') {
        console.warn('[Birthday] `birthday` column not found in customers table. Add it first!');
        return res.status(200).json({ sent: 0, note: 'birthday column not found in customers table' });
      }
      console.error('[Birthday] DB error:', error.message);
      return res.status(500).json({ error: error.message });
    }

    if (!customers || customers.length === 0) {
      console.log('[Birthday] No birthdays today.');
      return res.status(200).json({ sent: 0, date: today });
    }

    let sent = 0;
    let failed = 0;

    for (const customer of customers) {
      if (!customer.wa) continue;

      const msg = buildBirthdayMessage(customer.name, customer.wa);

      try {
        await sendWA(customer.wa, msg);
        sent++;
        console.log(`[Birthday] Sent to ${customer.wa} (${customer.name})`);
        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        failed++;
        console.error(`[Birthday] Failed for ${customer.wa}:`, err.message);
      }
    }

    console.log(`[Birthday] Done. Sent: ${sent}, Failed: ${failed}`);
    return res.status(200).json({ sent, failed, date: today, total: customers.length });

  } catch (err) {
    console.error('[Birthday] Unexpected error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
