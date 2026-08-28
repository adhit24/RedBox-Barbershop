'use strict';

function normalize(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeCanonicalBarber(row) {
  if (!row || !row.id || !row.name || !row.branch || row.is_active === false) return null;
  return {
    id: String(row.id),
    name: String(row.name).trim(),
    branch: String(row.branch).trim().toLowerCase(),
    is_active: true,
  };
}

async function loadCanonicalBarbers(supabase) {
  if (!supabase || typeof supabase.from !== 'function') {
    return { status: 'unavailable', barbers: [], reason: 'canonical_source_unavailable' };
  }

  try {
    const { data, error } = await supabase
      .from('barbers')
      .select('id,name,branch,is_active')
      .eq('is_active', true);

    if (error) return { status: 'unavailable', barbers: [], reason: 'canonical_source_error' };
    return {
      status: 'verified',
      barbers: (data || []).map(normalizeCanonicalBarber).filter(Boolean),
      reason: null,
    };
  } catch (_) {
    return { status: 'unavailable', barbers: [], reason: 'canonical_source_error' };
  }
}

function resolveCanonicalBarber(text, canonicalBarbers = [], requestedBranch = null) {
  const normalizedText = ` ${normalize(text)} `;
  if (!normalizedText.trim() || !Array.isArray(canonicalBarbers) || canonicalBarbers.length === 0) {
    return { status: 'unresolved', barber: null, reason: 'canonical_source_unavailable' };
  }

  if (/\b(bebas|siapa aja|siapa saja|random|mana aja)\b/i.test(String(text || ''))) {
    return { status: 'preference_any', barber: null, reason: null };
  }

  const matches = canonicalBarbers
    .map(normalizeCanonicalBarber)
    .filter(Boolean)
    .filter((barber) => normalizedText.includes(` ${normalize(barber.name)} `))
    .filter((barber) => !requestedBranch || barber.branch === String(requestedBranch).toLowerCase());

  if (matches.length !== 1) {
    return {
      status: matches.length > 1 ? 'ambiguous' : 'unresolved',
      barber: null,
      reason: matches.length > 1 ? 'multiple_canonical_barbers' : 'barber_not_verified',
    };
  }

  return { status: 'verified', barber: matches[0], reason: null };
}

module.exports = {
  loadCanonicalBarbers,
  normalizeCanonicalBarber,
  resolveCanonicalBarber,
};
