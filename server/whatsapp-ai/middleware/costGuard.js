const config = require('../config');

// Track per-user: last AI call time + daily AI call count
const userStats = new Map(); // phone → { lastCall, dailyCount, date }

const today = () => new Date().toISOString().slice(0, 10);

const getStats = (phone) => {
  const s = userStats.get(phone);
  if (!s || s.date !== today()) {
    return { lastCall: 0, dailyCount: 0, date: today() };
  }
  return s;
};

// Returns { allowed: bool, message: string }
const check = (phone) => {
  const stats = getStats(phone);
  const now = Date.now();

  // Cooldown check
  if (now - stats.lastCall < config.COOLDOWN_MS) {
    return { allowed: false, message: 'Slow down kak, pesan sebelumnya masih diproses 😊' };
  }

  // Daily limit check
  if (stats.dailyCount >= config.DAILY_MSG_LIMIT) {
    return {
      allowed: false,
      message: `Wah sudah banyak banget kak pertanyaannya hari ini 😄 Coba lagi besok ya, atau langsung hubungi admin kami 🙏`
    };
  }

  // Allow — update stats
  userStats.set(phone, {
    lastCall: now,
    dailyCount: stats.dailyCount + 1,
    date: today(),
  });

  return { allowed: true };
};

module.exports = { check };
