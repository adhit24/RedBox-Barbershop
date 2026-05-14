/**
 * Vercel Cron — GET /api/cron/reminders
 * Runs daily at 10:00 WIB (03:00 UTC).
 * Sends WhatsApp booking reminder to customers with appointments tomorrow.
 */

const { createClient } = require('@supabase/supabase-js');
const { sendWA } = require('../../server/services/fonnte');

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function tomorrowWIB() {
  // WIB = UTC+7
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const tom = new Date(wib);
  tom.setUTCDate(tom.getUTCDate() + 1);
  const y = tom.getUTCFullYear();
  const m = String(tom.getUTCMonth() + 1).padStart(2, '0');
  const d = String(tom.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function dayName(dateStr) {
  const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const d = new Date(dateStr + 'T00:00:00');
  return days[d.getDay()];
}

function formatDate(dateStr) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const [y, m, d] = dateStr.split('-');
  return `${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`;
}

function buildReminderMessage(booking) {
  const { name, service, time, date } = booking;
  const firstName = (name || 'Kak').split(' ')[0];
  const day = dayName(date);
  const dateFormatted = formatDate(date);

  return pick([
    `Haii kak ${firstName}! 👋\n\nKami dari *RedBox Barbershop* mau ngingetin nih — besok ada jadwalmu lho!\n\n📅 *${day}, ${dateFormatted}*\n⏰ Jam *${time} WIB*\n✂️ *${service}*\n\nJangan sampai kelewatan ya kak! Kalau mau reschedule, bisa langsung di:\n🔗 redboxbarbershop.com/booking.html\n\nSee you tomorrow! ✂️✨`,
    `Hai kak ${firstName}! Sebelum besok dimulai, kami mau ngingetin dulu 😊\n\n🗓️ Jadwalmu besok:\n• *${day}, ${dateFormatted}* jam *${time}*\n• Layanan: *${service}*\n\nDateng tepat waktu ya kak biar langsung bisa dilayani 💈\n\nAda yang perlu diubah? Langsung chat kami aja!\nSampai besok kak! 🙏`,
    `Psst kak ${firstName}! Jangan lupa besok ada jadwal di RedBox ya 👀✂️\n\n⏰ *${time} WIB* — ${day}, ${dateFormatted}\n💈 *${service}*\n\nKita tunggu kedatangannya kak! 😄\n\nKalau ada perubahan jadwal, kabarin kami sebelum jam 9 malem ya 🙏`,
  ]);
}

module.exports = async function handler(req, res) {
  // Only allow GET (Vercel cron) or requests with cron secret
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
      .select('id, name, wa, service, time, date')
      .eq('date', tomorrow)
      .not('status', 'in', '("cancelled","no_show")')
      .not('wa', 'is', null);

    if (error) {
      console.error('[Reminders] DB error:', error.message);
      return res.status(500).json({ error: error.message });
    }

    if (!bookings || bookings.length === 0) {
      console.log('[Reminders] No bookings tomorrow.');
      return res.status(200).json({ sent: 0, date: tomorrow });
    }

    let sent = 0;
    let failed = 0;

    for (const booking of bookings) {
      if (!booking.wa) continue;

      const msg = buildReminderMessage(booking);

      try {
        await sendWA(booking.wa, msg);
        sent++;
        console.log(`[Reminders] Sent to ${booking.wa} (${booking.name})`);
        // Small delay between sends to avoid rate limit
        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        failed++;
        console.error(`[Reminders] Failed for ${booking.wa}:`, err.message);
      }
    }

    console.log(`[Reminders] Done. Sent: ${sent}, Failed: ${failed}`);
    return res.status(200).json({ sent, failed, date: tomorrow, total: bookings.length });

  } catch (err) {
    console.error('[Reminders] Unexpected error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
