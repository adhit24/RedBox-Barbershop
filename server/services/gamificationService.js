// server/services/gamificationService.js
'use strict';

const { sendPushNotifToBarber } = require('./barberMetrics');

function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ── Achievement Thresholds (mirrors frontend achievementDefs.ts) ─
const ACHIEVEMENT_CHECKS = [
  { key: 'first_cut',        label: 'First Cut',         type: 'total_customers', value: 1,    rarity: 'common'    },
  { key: 'rookie_10',        label: 'Rookie Cutter',     type: 'total_customers', value: 10,   rarity: 'common'    },
  { key: 'century',          label: 'Century Club',      type: 'total_customers', value: 100,  rarity: 'rare'      },
  { key: 'diamond_hand',     label: 'Diamond Hand',      type: 'total_customers', value: 1000, rarity: 'epic'      },
  { key: 'five_thousand',    label: '5000 Legend',       type: 'total_customers', value: 5000, rarity: 'mythic'    },
  { key: 'first_star',       label: 'First Star',        type: 'total_reviews',   value: 1,    rarity: 'common'    },
  { key: 'review_50',        label: '50 Happy Clients',  type: 'total_reviews',   value: 50,   rarity: 'rare'      },
  { key: 'review_100',       label: '100 Happy Clients', type: 'total_reviews',   value: 100,  rarity: 'epic'      },
  { key: 'review_500',       label: 'Review Master',     type: 'total_reviews',   value: 500,  rarity: 'legendary' },
  { key: 'streak_master',    label: 'Streak Master',     type: 'streak',          value: 30,   rarity: 'rare'      },
  { key: 'streak_60',        label: 'Streak Legend',     type: 'streak',          value: 60,   rarity: 'epic'      },
  { key: 'streak_100',       label: 'Streak God',        type: 'streak',          value: 100,  rarity: 'legendary' },
  { key: 'first_mission',    label: 'First Mission',     type: 'missions_done',   value: 1,    rarity: 'common'    },
  { key: 'mission_hunter',   label: 'Mission Hunter',    type: 'missions_done',   value: 20,   rarity: 'rare'      },
  { key: 'mission_conqueror', label: 'Mission Conqueror', type: 'missions_done',  value: 50,   rarity: 'epic'      },
];

async function checkAchievements(supabase, barberId, { totalCustomers, totalReviews, streak, missionsDone }) {
  const unlocked = [];
  for (const check of ACHIEVEMENT_CHECKS) {
    const metric =
      check.type === 'total_customers' ? totalCustomers :
      check.type === 'total_reviews'   ? totalReviews :
      check.type === 'streak'          ? streak :
      check.type === 'missions_done'   ? missionsDone : 0;

    if (metric >= check.value) {
      const { data: result } = await supabase.rpc('unlock_achievement', {
        p_barber_id: barberId,
        p_badge_key: check.key,
        p_label:     check.label,
        p_rarity:    check.rarity,
      });
      if (result === true) {
        unlocked.push(check.key);
        const xpMap = { common: 25, rare: 50, epic: 100, legendary: 250, mythic: 500 };
        sendPushNotifToBarber(supabase, barberId, {
          title: `🏆 Badge Baru: ${check.label}`,
          body: `${check.rarity.toUpperCase()} · +${xpMap[check.rarity]} XP`,
          url: '/barber/progress',
        });
      }
    }
  }
  return unlocked;
}

async function assignRivals(supabase, weekStart) {
  const monthStart = weekStart.slice(0, 7) + '-01';

  const { data: barbers } = await supabase
    .from('barbers').select('id, name, branch').eq('is_active', true);
  if (!barbers?.length) return 0;

  const { data: countRows } = await supabase
    .from('barber_daily_counts')
    .select('barber_id, count')
    .gte('date', monthStart)
    .lte('date', weekStart);

  const countMap = {};
  for (const r of (countRows || [])) {
    countMap[r.barber_id] = (countMap[r.barber_id] || 0) + r.count;
  }

  const ranked = barbers
    .map(b => ({ ...b, count: countMap[b.id] || 0 }))
    .sort((a, b) => b.count - a.count);

  let assigned = 0;
  for (let i = 0; i < ranked.length; i++) {
    const me = ranked[i];
    const rival = ranked[i - 1] || ranked[i + 1];
    if (!rival) continue;

    await supabase.from('barber_rivals').upsert({
      barber_id:           me.id,
      rival_id:            rival.id,
      week_start:          weekStart,
      my_count_start:      me.count,
      rival_count_start:   rival.count,
      my_count_current:    me.count,
      rival_count_current: rival.count,
    }, { onConflict: 'barber_id,week_start' });

    const gap = rival.count - me.count;
    const msg = gap > 0
      ? `Kamu tertinggal ${gap} customer dari ${rival.name}`
      : gap === 0
        ? `Kamu sejajar dengan ${rival.name}!`
        : `Kamu unggul ${Math.abs(gap)} customer dari ${rival.name}`;

    sendPushNotifToBarber(supabase, me.id, {
      title: `⚔️ Rival minggu ini: ${rival.name}`,
      body: msg,
      url: '/barber/leaderboard',
    });
    assigned++;
  }
  return assigned;
}

async function crownKingOfShop(supabase, weekStart) {
  const monthStart = weekStart.slice(0, 7) + '-01';

  const { data: barbers } = await supabase
    .from('barbers').select('id, name, branch').eq('is_active', true);
  if (!barbers?.length) return;

  const branches = [...new Set(barbers.map(b => b.branch))];

  const { data: countRows } = await supabase
    .from('barber_daily_counts')
    .select('barber_id, count')
    .gte('date', monthStart)
    .lte('date', weekStart);

  const countMap = {};
  for (const r of (countRows || [])) {
    countMap[r.barber_id] = (countMap[r.barber_id] || 0) + r.count;
  }

  for (const branch of branches) {
    const branchBarbers = barbers.filter(b => b.branch === branch);
    const top = branchBarbers
      .map(b => ({ ...b, count: countMap[b.id] || 0 }))
      .sort((a, b) => b.count - a.count)[0];

    if (!top || top.count === 0) continue;

    await supabase.from('king_of_shop').upsert({
      branch,
      week_start:  weekStart,
      barber_id:   top.id,
      barber_name: top.name,
      total_count: top.count,
    }, { onConflict: 'branch,week_start' });

    await supabase.from('barber_titles').upsert({
      barber_id:     top.id,
      special_title: 'King of The Shop 👑',
      active_title:  'King of The Shop 👑',
    }, { onConflict: 'barber_id' });

    await supabase.rpc('add_xp', {
      p_barber_id: top.id, p_xp: 200, p_reason: 'king_of_shop'
    });

    await supabase.from('barber_social_feed').insert({
      event_type: 'king_of_shop', barber_id: top.id,
      barber_name: top.name, branch,
      title: `${top.name} adalah King of The Shop!`,
      body: `Cabang ${branch} — ${top.count} customer bulan ini`,
      emoji: '👑',
      metadata: { branch, week_start: weekStart, count: top.count },
    });

    sendPushNotifToBarber(supabase, top.id, {
      title: '👑 KAMU ADALAH KING OF THE SHOP!',
      body: `Cabang ${branch} — ${top.count} customer bulan ini`,
      url: '/barber/leaderboard',
    });
  }
}

async function rebuildLeaderboardCache(supabase, today) {
  const monthStart = today.slice(0, 7) + '-01';
  const weekStart = (() => {
    const d = new Date(today + 'T00:00:00+07:00');
    const day = d.getDay();
    d.setDate(d.getDate() - ((day === 0 ? 7 : day) - 1));
    return localDateStr(d);
  })();

  const { data: barbers } = await supabase
    .from('barbers').select('id, name, branch').eq('is_active', true);
  if (!barbers?.length) return;

  // ── Monthly Customer Champion ──────────────────────────────────
  const { data: monthRows } = await supabase
    .from('barber_daily_counts').select('barber_id, count')
    .gte('date', monthStart).lte('date', today);

  const monthMap = {};
  for (const r of (monthRows || [])) {
    monthMap[r.barber_id] = (monthMap[r.barber_id] || 0) + r.count;
  }

  const monthRanked = barbers
    .map(b => ({ ...b, count: monthMap[b.id] || 0 }))
    .sort((a, b) => b.count - a.count);

  await supabase.from('barber_leaderboard_cache')
    .delete().eq('period_type', 'monthly').eq('category', 'customer_champion')
    .eq('period_start', monthStart);

  for (let i = 0; i < monthRanked.length; i++) {
    const b = monthRanked[i];
    await supabase.from('barber_leaderboard_cache').insert({
      period_type: 'monthly', category: 'customer_champion',
      period_start: monthStart,
      rank: i + 1, barber_id: b.id, barber_name: b.name, branch: b.branch,
      score: b.count, display_value: `${b.count} customer`,
    });
  }

  // ── Monthly Streak Champion ────────────────────────────────────
  const { data: streakRows } = await supabase
    .from('barber_streaks').select('barber_id, current_streak');

  const streakMap = {};
  for (const r of (streakRows || [])) streakMap[r.barber_id] = r.current_streak;

  const streakRanked = barbers
    .map(b => ({ ...b, streak: streakMap[b.id] || 0 }))
    .sort((a, b) => b.streak - a.streak);

  await supabase.from('barber_leaderboard_cache')
    .delete().eq('period_type', 'monthly').eq('category', 'streak_champion')
    .eq('period_start', monthStart);

  for (let i = 0; i < streakRanked.length; i++) {
    const b = streakRanked[i];
    await supabase.from('barber_leaderboard_cache').insert({
      period_type: 'monthly', category: 'streak_champion',
      period_start: monthStart,
      rank: i + 1, barber_id: b.id, barber_name: b.name, branch: b.branch,
      score: b.streak, display_value: `${b.streak} hari`,
    });
  }
}

module.exports = { checkAchievements, assignRivals, crownKingOfShop, rebuildLeaderboardCache };
