/**
 * Vercel Cron — GET /api/cron/reminders
 * Runs daily at 10:00 WIB (03:00 UTC).
 * Sends WhatsApp H-1 booking reminder to customers with appointments tomorrow.
 */

const { createClient } = require('@supabase/supabase-js');
const { sendWA } = require('../../server/services/fonnte');

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

const BRANCH_LABELS = {
  bypass:    'RedBox Bypass (Pusat)',
  samadikun: 'RedBox Samadikun',
  csb:       'RedBox CSB Mall',
  sumber:    'RedBox Sumber',
  tegal:     'RedBox Tegal',
};

function branchLabel(location) {
  return BRANCH_LABELS[String(location || '').toLowerCase()] || 'RedBox Barbershop';
}

function buildReminderMessage(booking, barberName) {
  const { name, service, time, date, location } = booking;
  const fn = (name || 'Kak').split(' ')[0];
  const day = dayName(date);
  const dateFormatted = formatDate(date);
  const branch = branchLabel(location);
  const barberLine = barberName ? `\n💈 Kapster: *${barberName}*` : '';

  return `Haii kak ${fn}! 👋\n\nKami dari *RedBox Barbershop* mau ngingetin — besok ada jadwalmu lho!\n\n📅 *${day}, ${dateFormatted}*\n⏰ Jam *${time} WIB*\n✂️ *${service}*${barberLine}\n📍 *${branch}*\n\nJangan sampai kelewatan ya kak! Kalau mau reschedule, bisa langsung di:\n🔗 redboxbarbershop.com/booking.html\n\nSee you tomorrow! ✂️✨`;
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
      const msg = buildReminderMessage(booking, barberName);

      try {
        await sendWA(booking.wa, msg);
        sent++;
        console.log(`[Reminders] Sent to ${booking.wa} (${booking.name})`);
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
