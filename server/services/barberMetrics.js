// server/services/barberMetrics.js
// Core gamification logic — called when booking status → done

const { sendPushToUser } = require('./webPush');

// Badge definitions
const BADGES = {
  hair_cut_master:   { label: '✂️ Hair Cut Master',     serviceMatch: /gunting/i,         threshold: 500 },
  color_expert:      { label: '🎨 Color Expert',        serviceMatch: /color/i,           threshold: 100 },
  home_service_hero: { label: '🏠 Home Service Hero',   typeMatch: 'home_service',        threshold: 25 },
  early_bird:        { label: '🌅 Early Bird',          timeMax: '10:00',                 threshold: 10 },
  night_owl:         { label: '🌙 Night Owl',           timeMin: '20:00',                 threshold: 10 },
  diamond_hand:      { label: '💎 Diamond Hand',        allServices: true,                threshold: 1000 },
  streak_master:     { label: '🔥 Streak Master',       streakBased: true,                threshold: 30 },
};

function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/**
 * Fire-and-forget hook called when a booking status changes to 'done'.
 * Updates: daily count for target check, personal records, mission progress, achievement check.
 */
async function onBookingCompleted(supabase, booking) {
  if (!booking || !booking.barber_id) return;
  const barberId = booking.barber_id;
  const today = localDateStr();

  try {
    // 1. Count bookings done today for this barber
    const { count: todayCount } = await supabase
      .from('bookings')
      .select('*', { count: 'exact', head: true })
      .eq('barber_id', barberId)
      .eq('status', 'done')
      .eq('date', today);

    // 2. Get barber target
    const { data: profile } = await supabase
      .from('barber_users')
      .select('target_daily, barber_id')
      .eq('barber_id', barberId)
      .maybeSingle();

    const target = profile?.target_daily || 10;

    // 3. Check if just hit target → push notification
    if (todayCount === target) {
      sendPushNotifToBarber(supabase, barberId, {
        title: '🎉 Target Hari Ini Tercapai!',
        body: `${todayCount}/${target} customer. Mantap! 💪`,
        url: '/barber/home',
      });
    } else if (todayCount >= target - 2 && todayCount < target) {
      sendPushNotifToBarber(supabase, barberId, {
        title: `⚡ Sedikit lagi!`,
        body: `Sisa ${target - todayCount} customer lagi untuk hit target hari ini`,
        url: '/barber/home',
      });
    }

    // 4. Update personal records
    await updateRecords(supabase, barberId, todayCount);

    // 5. Update mission progress
    await updateMissionProgress(supabase, barberId, booking);

    // 6. Check achievements
    await checkAchievements(supabase, barberId);

  } catch (e) {
    console.error('[barberMetrics] onBookingCompleted error:', e.message);
  }
}

async function updateRecords(supabase, barberId, todayCount) {
  const today = localDateStr();

  // Upsert barber_records row if not exists
  const { data: rec } = await supabase
    .from('barber_records')
    .select('*')
    .eq('barber_id', barberId)
    .maybeSingle();

  if (!rec) {
    await supabase.from('barber_records').insert({
      barber_id: barberId,
      best_customer_per_day: todayCount,
      best_customer_per_day_at: today,
    });
    return;
  }

  if (todayCount > (rec.best_customer_per_day || 0)) {
    await supabase.from('barber_records').update({
      best_customer_per_day: todayCount,
      best_customer_per_day_at: today,
    }).eq('barber_id', barberId);

    sendPushNotifToBarber(supabase, barberId, {
      title: '🏆 PERSONAL BEST!',
      body: `Rekor baru: ${todayCount} customer dalam sehari!`,
      url: '/barber/progress',
    });
  }
}

async function updateMissionProgress(supabase, barberId, booking) {
  // Get current week Monday
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((day === 0 ? 7 : day) - 1));
  const weekStart = localDateStr(monday);

  // Fetch current missions for this week
  const { data: missions } = await supabase
    .from('barber_missions')
    .select('id, mission_key, progress, target, completed_at')
    .eq('barber_id', barberId)
    .eq('week_start', weekStart);

  if (!missions) return;

  for (const m of missions) {
    if (m.completed_at) continue;

    let newProgress = m.progress;
    if (m.mission_key === 'serve_customers') {
      newProgress = m.progress + 1;
    }
    // quality and consistency missions are updated by cron or separate logic

    if (newProgress !== m.progress) {
      const update = { progress: newProgress };
      if (newProgress >= m.target) {
        update.completed_at = new Date().toISOString();
      }
      await supabase.from('barber_missions').update(update).eq('id', m.id);
    }
  }

  // Check if ALL missions completed → bonus notification
  const allCompleted = missions.every(m => m.completed_at || (m.mission_key === 'serve_customers' && m.progress + 1 >= m.target));
  if (allCompleted && missions.length >= 3) {
    sendPushNotifToBarber(supabase, barberId, {
      title: '🏆 Weekly Champion!',
      body: 'Semua misi minggu ini selesai! Luar biasa!',
      url: '/barber/progress',
    });
  }
}

async function checkAchievements(supabase, barberId) {
  // Get already earned badges
  const { data: earned } = await supabase
    .from('barber_achievements')
    .select('badge_key')
    .eq('barber_id', barberId);
  const earnedKeys = new Set((earned || []).map(a => a.badge_key));

  for (const [key, def] of Object.entries(BADGES)) {
    if (earnedKeys.has(key)) continue;
    if (def.streakBased) continue; // streak_master is checked by cron

    let count = 0;

    if (def.allServices) {
      // Total done bookings
      const { count: c } = await supabase
        .from('bookings')
        .select('*', { count: 'exact', head: true })
        .eq('barber_id', barberId)
        .eq('status', 'done');
      count = c || 0;
    } else if (def.serviceMatch) {
      const { data: rows } = await supabase
        .from('bookings')
        .select('id')
        .eq('barber_id', barberId)
        .eq('status', 'done')
        .ilike('service', `%${def.serviceMatch.source.replace(/[/\\^$*+?.()|[\]{}]/g, '')}%`);
      count = rows?.length || 0;
    } else if (def.typeMatch) {
      const { data: rows } = await supabase
        .from('bookings')
        .select('id')
        .eq('barber_id', barberId)
        .eq('status', 'done')
        .like('notes', '%HOME SERVICE%');
      count = rows?.length || 0;
    } else if (def.timeMax) {
      const { data: rows } = await supabase
        .from('bookings')
        .select('id')
        .eq('barber_id', barberId)
        .eq('status', 'done')
        .lt('time', def.timeMax);
      count = rows?.length || 0;
    } else if (def.timeMin) {
      const { data: rows } = await supabase
        .from('bookings')
        .select('id')
        .eq('barber_id', barberId)
        .eq('status', 'done')
        .gte('time', def.timeMin);
      count = rows?.length || 0;
    }

    if (count >= def.threshold) {
      await supabase.from('barber_achievements').insert({ barber_id: barberId, badge_key: key });
      sendPushNotifToBarber(supabase, barberId, {
        title: `🏅 Badge Baru: ${def.label}`,
        body: `Selamat! Kamu unlock ${def.label}!`,
        url: '/barber/progress',
      });
    }
  }
}

/**
 * Helper: send push notif to barber via barber_users → users mapping.
 * Fire and forget.
 */
function sendPushNotifToBarber(supabase, barberId, payload) {
  supabase
    .from('users')
    .select('id')
    .eq('barber_id', barberId)
    .eq('role', 'barber')
    .maybeSingle()
    .then(({ data }) => {
      if (data?.id) {
        sendPushToUser(supabase, data.id, payload).catch(() => {});
      }
    })
    .catch(() => {});
}

module.exports = { onBookingCompleted, checkAchievements, updateRecords, updateMissionProgress, BADGES, sendPushNotifToBarber };
