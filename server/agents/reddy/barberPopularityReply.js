'use strict';

const BRANCH_LABELS = Object.freeze({
  bypass: 'Bypass',
  csb: 'CSB',
  sumber: 'Sumber',
  tegal: 'Tegal',
  samadikun: 'Samadikun',
});

function periodLabel(period = {}) {
  if (period.type === 'current_month') return 'bulan ini sampai hari ini';
  if (period.type === 'current_week') return 'minggu ini sampai hari ini';
  return '30 hari terakhir';
}

function joinNames(names) {
  if (names.length <= 1) return names[0] || '';
  if (names.length === 2) return `${names[0]} dan ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, dan ${names.at(-1)}`;
}

function formatBarberPopularityReply(result = {}) {
  if (result.status === 'ambiguous_branch' || result.status === 'unknown_branch') {
    return 'Cabang Redbox yang ingin dibandingkan yang mana, Kak?';
  }
  if (result.status === 'unsupported_metric') {
    return 'Untuk saat ini aku baru bisa membandingkan kapster dari jumlah booking yang dipilih, bukan jumlah customer yang dilayani, Kak.';
  }

  if (result.status !== 'success' || !Array.isArray(result.leaders) || result.leaders.length === 0) {
    return `Aku belum punya data booking yang cukup untuk menentukan kapster yang paling sering dipilih di ${BRANCH_LABELS[result.branch] || 'cabang ini'} saat ini.`;
  }

  const branch = BRANCH_LABELS[result.branch] || String(result.branch || 'cabang ini').toUpperCase();
  const topRank = result.leaders[0].rank || 1;
  const topNames = result.leaders
    .filter(leader => (leader.rank || 1) === topRank)
    .map(leader => leader.barber_name)
    .filter(Boolean);

  if (topNames.length > 1) {
    return `Kalau lihat booking ${branch} ${periodLabel(result.period)}, yang paling sering dipilih sama banyak adalah ${joinNames(topNames)}, Kak.`;
  }
  return `Kalau lihat booking ${branch} ${periodLabel(result.period)}, yang paling sering dipilih adalah ${topNames[0]}, Kak.`;
}

module.exports = { formatBarberPopularityReply, periodLabel };
