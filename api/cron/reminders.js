/**
 * Cron — GET /api/cron/reminders
 * Runs daily at 10:00 WIB via cron-job.org.
 * 1. Sends WhatsApp H-1 booking reminder to customers with appointments tomorrow.
 * 2. Sends birthday free-cut promo to customers born today.
 * Re-engagement batch dipindah ke /api/cron/reengagement (endpoint terpisah).
 */

const { createClient } = require('@supabase/supabase-js');
const { notifyCustomerReminderH1 } = require('../../server/services/waNotification');
const { sendWA } = require('../../server/services/fonnte');

// ── Birthday helpers ──────────────────────────────────────────────────────────
const _pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function _todayMMDD() {
  const wib = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const m = String(wib.getUTCMonth() + 1).padStart(2, '0');
  const d = String(wib.getUTCDate()).padStart(2, '0');
  return `${m}-${d}`;
}

function _buildBirthdayMessage(name) {
  const firstName = (name || 'Kak').split(' ')[0];
  return _pick([
    `Haii kak ${firstName}! 🎂🎉\n\nSelamat ulang tahun dari kami semua di *RedBox Barbershop*! 🥳🥳\n\nSemoga panjang umur, sehat selalu, dan makin kece penampilannya ya!\n\nSpesial hari ini, kamu dapet:\n🎁 *FREE HAIRCUT* — gratis potong rambut!\n\nCaranya gampang:\n✅ Tunjukin pesan ini ke kasir\n✅ Berlaku hari ini aja ya kak\n\nBooking dulu biar dapat slot yang pas:\n👉 *redboxbarbershop.com/booking.html*\n\nHappy birthday kak ${firstName}! 🎊🎊🎊`,
    `Selamat ultah kak ${firstName}! 🎉🎂✨\n\nWah hari ini hari spesial banget nih! Semoga semua harapannya terkabul ya kak 🙏\n\nDari RedBox, ada kado spesial buat kamu:\n🎁 *GRATIS HAIRCUT* — khusus hari ini!\n\nGampang banget cara dapetinnya:\n1️⃣ Booking di redboxbarbershop.com/booking.html\n2️⃣ Dateng ke outlet\n3️⃣ Tunjukin pesan ini ke kasir\n4️⃣ Done — gratis! 🙌\n\nJangan sampe kelewatan ya kak! Berlaku hari ini doang 😄\n\nHappy birthday! 🥳`,
    `Kak ${firstName}! 🎂\n\nHappy birthday ya dari seluruh tim *RedBox Barbershop*!\n\nUlang tahun itu momen buat tampil lebih kece — dan kami punya kado untukmu:\n\n💈 *FREE HAIRCUT hari ini!*\n\nTinggal:\n✔️ Booking: redboxbarbershop.com/booking.html\n✔️ Dateng & tunjukin pesan ini\n\nSelamat merayakan kak! Kamu berhak tampil terbaik hari ini 🌟`,
  ]);
}

async function _sendBirthdays(supabase) {
  const today = _todayMMDD();
  console.log(`[Birthday] Checking customers with birthday: ${today}`);

  const { data: customers, error } = await supabase
    .from('customers')
    .select('id, name, wa, birthday')
    .eq('birthday', today)
    .not('wa', 'is', null);

  if (error) {
    if (error.code === '42703') {
      console.warn('[Birthday] `birthday` column not found in customers table.');
      return { sent: 0, failed: 0, note: 'birthday column not found' };
    }
    console.error('[Birthday] DB error:', error.message);
    return { sent: 0, failed: 0, error: error.message };
  }

  if (!customers || customers.length === 0) {
    console.log('[Birthday] No birthdays today.');
    return { sent: 0, failed: 0, date: today };
  }

  let sent = 0, failed = 0;
  for (const c of customers) {
    if (!c.wa) continue;
    try {
      await sendWA(c.wa, _buildBirthdayMessage(c.name));
      sent++;
      console.log(`[Birthday] Sent to ${c.wa} (${c.name})`);
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      failed++;
      console.error(`[Birthday] Failed for ${c.wa}:`, err.message);
    }
  }
  console.log(`[Birthday] Done. Sent: ${sent}, Failed: ${failed}`);
  return { sent, failed, date: today, total: customers.length };
}

function tomorrowWIB() {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const tom = new Date(wib);
  tom.setUTCDate(tom.getUTCDate() + 1);
  const y = tom.getUTCFullYear();
  const m = String(tom.getUTCMonth() + 1).padStart(2, '0');
  const d = String(tom.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}


module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers['authorization'];
  if (secret && authHeader !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const tomorrow = tomorrowWIB();
  console.log(`[Reminders] Checking bookings for ${tomorrow}`);

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    const { data: bookings, error } = await supabase
      .from('bookings')
      .select('id, name, wa, service, time, date, location, barber_id')
      .eq('date', tomorrow)
      .eq('status', 'confirmed')
      .eq('remind_h1_sent', false)
      .not('wa', 'is', null);

    if (error) {
      console.error('[Reminders] DB error:', error.message);
      return res.status(500).json({ error: error.message });
    }

    if (!bookings || bookings.length === 0) {
      console.log('[Reminders] No bookings tomorrow.');
      return res.status(200).json({ sent: 0, date: tomorrow });
    }

    // Bulk fetch barber names — non-blocking: if it fails, reminders still send without kapster name.
    const barberMap = {};
    const barberIds = [...new Set(bookings.map(b => b.barber_id).filter(Boolean))];
    if (barberIds.length) {
      const { data: barbers } = await supabase
        .from('barbers').select('id, name').in('id', barberIds);
      for (const b of barbers || []) barberMap[b.id] = b.name;
    }

    let sent = 0;
    let failed = 0;

    for (const booking of bookings) {
      if (!booking.wa) continue;

      const barberName = barberMap[booking.barber_id] || null;

      try {
        const result = await notifyCustomerReminderH1({ ...booking, barber_name: barberName });
        // Fonnte returns { status: false, reason: ... } on soft failure — treat as failure
        if (result && result.status === false) {
          failed++;
          console.error(`[Reminders] Fonnte rejected ${booking.wa} (${booking.name}): ${JSON.stringify(result)}`);
        } else {
          sent++;
          console.log(`[Reminders] Sent to ${booking.wa} (${booking.name})`);
          // Mark as reminded to prevent duplicate sends across Vercel instances
          await supabase.from('bookings').update({ remind_h1_sent: true }).eq('id', booking.id);
        }
        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        failed++;
        console.error(`[Reminders] Failed for ${booking.wa}:`, err.message);
      }
    }

    console.log(`[Reminders] Done. Sent: ${sent}, Failed: ${failed}`);

    const birthdayResult = await _sendBirthdays(supabase);

    return res.status(200).json({
      reminders: { sent, failed, date: tomorrow, total: bookings.length },
      birthday: birthdayResult,
    });

  } catch (err) {
    console.error('[Reminders] Unexpected error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
