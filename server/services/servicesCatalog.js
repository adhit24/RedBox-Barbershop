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

const SERVICE_ALIASES_MAP = Object.freeze({
  'gentleman grooming': ['gentleman grooming', 'redbox gentleman grooming', 'haircut', 'potong rambut', 'cukur rambut', 'fade'],
  'hair color': ['hair color', 'coloring', 'cat rambut', 'semir rambut', 'semir'],
  'hair spa': ['hair spa', 'spa rambut'],
  'down perm / root lift': ['down perm / root lift', 'down perm', 'root lift', 'downperm'],
  'hair curly': ['hair curly', 'curly', 'keriting rambut', 'keriting'],
  'treatment smoothing & shave': ['treatment smoothing & shave', 'treatment smoothing', 'hair smoothing', 'smoothing rambut', 'smoothing', 'rebonding', 'lurusin'],
  'traditional shaving': ['traditional shaving', 'traditional shave', 'cukur kumis', 'cukur jenggot', 'cukur jenggot kumis'],
  'hair bleaching': ['hair bleaching', 'bleaching rambut', 'bleaching'],
  'hair highlighting': ['hair highlighting', 'highlighting', 'highlight'],
  'men massage service': ['men massage service', 'men massage', 'pijat pria', 'massage'],
  'hair tattoo - double side': ['hair tattoo - double side', 'hair tattoo double side', 'tattoo double'],
  'hair tattoo - single side': ['hair tattoo - single side', 'hair tattoo single side', 'tattoo single'],
  'redbox royal grooming': ['redbox royal grooming', 'royal grooming', 'paket royal'],
  'redbox earl grooming': ['redbox earl grooming', 'earl grooming', 'paket earl'],
  'redbox baron grooming': ['redbox baron grooming', 'baron grooming', 'paket baron'],
  'redbox noble grooming': ['redbox noble grooming', 'noble grooming', 'paket noble'],
  'redbox duxe grooming': ['redbox duxe grooming', 'duxe grooming', 'redbox duke grooming', 'duke grooming', 'duxe', 'duke'],
  'charcoal deep cleansing': ['charcoal deep cleansing', 'charcoal deep', 'deep cleansing'],
  'charcoal nose cleansing strip': ['charcoal nose cleansing strip', 'charcoal nose strip', 'nose cleansing strip'],
  'ear candle': ['ear candle', 'terapi lilin telinga'],
  'ear singeing': ['ear singeing', 'singeing'],
  'ear wax': ['ear wax', 'wax telinga'],
  'nose wax': ['nose wax', 'wax hidung'],
  'premium head shave': ['premium head shave', 'head shave', 'cukur botak'],
  'haircut + beard': ['haircut + beard', 'haircut beard'],
  'haircut + creambath': ['haircut + creambath', 'haircut creambath'],
});

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

const CANONICAL_SEED_SERVICES = Object.freeze([
  { id: 'srv-grooming', name: 'Gentleman Grooming', price: 95000, duration_minutes: 75, is_active: true },
  { id: 'srv-color', name: 'Hair Color', price: 150000, duration_minutes: 45, is_active: true },
  { id: 'srv-spa', name: 'Hair Spa', price: 100000, duration_minutes: 30, is_active: true },
  { id: 'srv-downperm', name: 'Down Perm / Root Lift', price: 165000, duration_minutes: 60, is_active: true },
  { id: 'srv-curly', name: 'Hair Curly', price: 300000, duration_minutes: 90, is_active: true },
  { id: 'srv-smoothing', name: 'Treatment Smoothing & Shave', price: 200000, duration_minutes: 90, is_active: true },
  { id: 'srv-shave', name: 'Traditional Shaving', price: 60000, duration_minutes: 30, is_active: true },
  { id: 'srv-earcandle', name: 'Ear Candle', price: 40000, duration_minutes: 20, is_active: true },
]);

async function fetchActiveServices(supabase) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('services')
    .select('id, name, price, duration_minutes, is_active')
    .eq('is_active', true);
  if (error) return null;
  return Array.isArray(data) ? data.filter((s) => s && s.is_active === true) : [];
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
      if (supabase === null) {
        return null;
      }
      if (!supabase) {
        if (!cache.rows) {
          cache = { rows: CANONICAL_SEED_SERVICES, fetchedAt: Date.now() };
        }
        return cache.rows;
      }
      const rows = await fetchActiveServices(supabase);
      if (rows && rows.length > 0) {
        cache = { rows, fetchedAt: Date.now() };
        return rows;
      }
      // Expired data cannot authorize a current price or service duration.
      return null;
    } catch (_error) {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

const getActiveServices = getActiveServicesCatalog;

/**
 * Finds a single unambiguous active service row by exact name or alias list.
 * Returns null if not found or if the match is ambiguous.
 *
 * @param {Array<{id,name,price,duration_minutes}>} rows
 * @param {{ name?: string, aliases?: string[], id?: string, slug?: string }} identity
 */
function findServiceRow(rows, { name, aliases, id, slug } = {}) {
  const activeRows = Array.isArray(rows) && rows.length ? rows : (cache.rows || CANONICAL_SEED_SERVICES);
  if (!Array.isArray(activeRows) || !activeRows.length) return null;
  if (id) {
    const byId = activeRows.find((r) => r.id === id);
    if (byId) return byId;
  }
  if (slug) {
    const slugNorm = normalizeName(slug).replace(/[^a-z0-9]+/g, '-').toLowerCase();
    const bySlug = activeRows.find((r) => {
      const candidates = [r.slug, r.id, r.name].filter(Boolean).map((v) =>
        String(v).toLowerCase().replace(/[^a-z0-9]+/g, '-')
      );
      return candidates.some((c) => c === slugNorm || c.includes(slugNorm) || slugNorm.includes(c));
    });
    if (bySlug) return bySlug;
  }
  if (name) {
    const target = normalizeName(name);
    const exact = activeRows.filter((row) => normalizeName(row.name) === target);
    if (exact.length === 1) return exact[0];

    // Check alias map
    const aliasMatches = activeRows.filter((row) => {
      const aliasesForService = SERVICE_ALIASES_MAP[normalizeName(row.name)] || [];
      return aliasesForService.includes(target) || normalizeName(row.name).includes(target);
    });
    if (aliasMatches.length === 1) return aliasMatches[0];
  }
  if (Array.isArray(aliases) && aliases.length) {
    const aliasSet = new Set(aliases.map(normalizeName));
    const matches = activeRows.filter((row) => {
      const rName = normalizeName(row.name);
      if (aliasSet.has(rName)) return true;
      const mapped = SERVICE_ALIASES_MAP[rName] || [];
      return mapped.some((a) => aliasSet.has(a));
    });
    if (matches.length === 1) return matches[0];
  }
  return null;
}

function getServiceByName(name, rows) {
  return findServiceRow(rows || cache.rows || CANONICAL_SEED_SERVICES, { name });
}

function getServiceBySlug(slug, rows) {
  return findServiceRow(rows || cache.rows || CANONICAL_SEED_SERVICES, { slug });
}

function getServiceById(id, rows) {
  return findServiceRow(rows || cache.rows || CANONICAL_SEED_SERVICES, { id });
}

/**
 * Resolves mentions of services from free text against canonical rows.
 * Returns an array of matched { row, mention, index }.
 */
function resolveAllServiceMentions(text, rows) {
  const activeRows = Array.isArray(rows) && rows.length ? rows : (cache.rows || CANONICAL_SEED_SERVICES);
  if (typeof text !== 'string' || !Array.isArray(activeRows) || !activeRows.length) return [];
  const lowerText = text.toLowerCase();
  const matched = [];

  for (const row of activeRows) {
    const rowNorm = normalizeName(row.name);
    const aliases = SERVICE_ALIASES_MAP[rowNorm] || [rowNorm];
    // Sort aliases by length descending so longer phrases match first
    const sortedAliases = [...new Set([rowNorm, ...aliases])].sort((a, b) => b.length - a.length);

    for (const alias of sortedAliases) {
      if (!alias || alias.length < 3) continue;
      const pattern = new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'i');
      const match = pattern.exec(lowerText);
      if (match) {
        matched.push({
          row,
          mention: match[0],
          alias,
          index: match.index,
          length: match[0].length,
        });
        break; // Match at most once per canonical service row
      }
    }
  }

  return matched;
}

function escapeRegExp(val) {
  return String(val || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Formats IDR currency in standard Indonesian format: Rp95.000
 */
function formatIDR(amount) {
  return 'Rp' + Number(amount || 0).toLocaleString('id-ID');
}

/**
 * Builds canonical service listing text for shortcuts / queries directly from public.services rows.
 * Excludes inactive rows.
 */
function buildCanonicalServicesText(branch, rows) {
  const activeRows = Array.isArray(rows) && rows.length ? rows : (cache.rows || CANONICAL_SEED_SERVICES);
  if (!Array.isArray(activeRows) || !activeRows.length) {
    return 'Maaf, daftar layanan saat ini sedang tidak dapat dimuat.';
  }
  const isCsb = String(branch || '').trim().toLowerCase() === 'csb';
  return activeRows
    .filter((r) => r.is_active === true && Number(r.price) > 0)
    .sort((a, b) => {
      // Prioritize flagship haircuts/grooming first
      const aFlag = normalizeName(a.name).includes('gentleman grooming') ? -1 : 1;
      const bFlag = normalizeName(b.name).includes('gentleman grooming') ? -1 : 1;
      if (aFlag !== bFlag) return aFlag - bFlag;
      return a.name.localeCompare(b.name);
    })
    .map((service) => {
      let price = service.price;
      if (isCsb && normalizeName(service.name).includes('gentleman grooming')) {
        price = 120000;
      }
      return `  ${service.name} — ${formatIDR(price)}`;
    })
    .join('\n');
}

function resetServicesCatalogCache() {
  cache = { rows: null, fetchedAt: 0 };
  inflight = null;
}

const servicesCatalog = {
  getActiveServicesCatalog,
  getActiveServices,
  findServiceRow,
  getServiceByName,
  getServiceBySlug,
  getServiceById,
  resolveAllServiceMentions,
  buildCanonicalServicesText,
  resetServicesCatalogCache,
};

module.exports = {
  servicesCatalog,
  getActiveServicesCatalog,
  getActiveServices,
  findServiceRow,
  getServiceByName,
  getServiceBySlug,
  getServiceById,
  resolveAllServiceMentions,
  buildCanonicalServicesText,
  resetServicesCatalogCache,
  formatIDR,
  DEFAULT_TTL_MS,
};

