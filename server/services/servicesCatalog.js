'use strict';

/**
 * Live public.services price/duration authority (Reddy reliability round 2).
 *
 * Root cause this replaces: Reddy's price/duration numbers previously came
 * from a hardcoded catalog (public/js/services-data.js -> redboxKnowledge.js)
 * that drifted from public.services (e.g. Gentleman Grooming: catalog said
 * Rp95.000, public.services says Rp120.000/75min, is_active=true). This
 * module is the single place that reads the live, authoritative row.
 *
 * Short TTL cache (default 60s) so a normal conversation doesn't hit the DB
 * on every single message, while a services.price update in the backoffice
 * still reaches Reddy within a minute — not stale forever like the old
 * hardcoded JS catalog.
 */

const DEFAULT_TTL_MS = 60 * 1000;

let cache = { rows: null, fetchedAt: 0 };
let inflight = null;

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

async function fetchActiveServices(supabase) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('services')
    .select('id, name, price, duration_minutes, is_active')
    .eq('is_active', true);
  if (error) return null;
  return Array.isArray(data) ? data : [];
}

/**
 * Returns the cached (or freshly fetched) list of active services. Never
 * throws — a DB/network failure resolves to `null`, and callers must treat
 * `null` as "cannot verify" (fail closed on a wrong number, not fail open by
 * inventing/trusting a stale one).
 *
 * @param {object} supabase
 * @param {{ ttlMs?: number, forceRefresh?: boolean }} [options]
 */
async function getActiveServicesCatalog(supabase, options = {}) {
  const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : DEFAULT_TTL_MS;
  const fresh = !options.forceRefresh && cache.rows && (Date.now() - cache.fetchedAt) < ttlMs;
  if (fresh) return cache.rows;

  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const rows = await fetchActiveServices(supabase);
      if (rows) {
        cache = { rows, fetchedAt: Date.now() };
        return rows;
      }
      // Fetch failed: serve stale cache if we have any, otherwise null.
      return cache.rows || null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * Finds a single unambiguous active service row by exact name or alias list.
 * Returns null if not found or if the match is ambiguous (caller must not
 * guess a price/duration when it cannot identify exactly one service).
 *
 * @param {Array<{id,name,price,duration_minutes}>} rows
 * @param {{ name?: string, aliases?: string[] }} identity
 */
function findServiceRow(rows, { name, aliases } = {}) {
  if (!Array.isArray(rows) || !rows.length) return null;
  if (name) {
    const target = normalizeName(name);
    const exact = rows.filter((row) => normalizeName(row.name) === target);
    if (exact.length === 1) return exact[0];
  }
  if (Array.isArray(aliases) && aliases.length) {
    const aliasSet = new Set(aliases.map(normalizeName));
    const matches = rows.filter((row) => aliasSet.has(normalizeName(row.name)));
    if (matches.length === 1) return matches[0];
  }
  return null;
}

function resetServicesCatalogCache() {
  cache = { rows: null, fetchedAt: 0 };
  inflight = null;
}

module.exports = {
  getActiveServicesCatalog,
  findServiceRow,
  resetServicesCatalogCache,
  DEFAULT_TTL_MS,
};
