'use strict';
// ============================================================
// In-Memory Supabase Mock for Moka OAuth (fallback)
// Stores tokens in memory when Supabase is not configured
// ============================================================

const _memoryTokens = new Map(); // outlet_id -> token data
const _outlets = new Map(); // slug -> { id, slug, name }

// Default outlet for single-outlet setup - uses env MOKA_OUTLET_ID
const DEFAULT_OUTLET_ID = process.env.MOKA_OUTLET_ID || '2000001165';

// RedBox Branches - 5 locations
const REDBOX_OUTLETS = [
  {
    id: 'bypass',
    slug: 'bypass',
    name: 'Redbox Bypass',
    address: 'Jl. Soekarno Hatta Bypass No. 123, Bandung',
    timezone: 'Asia/Jakarta',
    is_active: true,
    moka_outlet_id: DEFAULT_OUTLET_ID,
  },
  {
    id: 'csb',
    slug: 'csb', 
    name: 'Redbox Cibabat',
    address: 'Jl. Raya Cibabat No. 45, Cimahi',
    timezone: 'Asia/Jakarta',
    is_active: true,
    moka_outlet_id: DEFAULT_OUTLET_ID,
  },
  {
    id: 'tegal',
    slug: 'tegal',
    name: 'Redbox Tegal',
    address: 'Jl. Martadinata No. 67, Tegal',
    timezone: 'Asia/Jakarta',
    is_active: true,
    moka_outlet_id: DEFAULT_OUTLET_ID,
  },
  {
    id: 'sumber',
    slug: 'sumber',
    name: 'Redbox Sumber',
    address: 'Jl. Sumber No. 89, Bandung',
    timezone: 'Asia/Jakarta',
    is_active: true,
    moka_outlet_id: DEFAULT_OUTLET_ID,
  },
  {
    id: 'samadikun',
    slug: 'samadikun',
    name: 'Redbox Samadikun',
    address: 'Jl. Samadikun No. 234, Bandung',
    timezone: 'Asia/Jakarta',
    is_active: true,
    moka_outlet_id: DEFAULT_OUTLET_ID,
  }
];

// Initialize all outlets
REDBOX_OUTLETS.forEach(outlet => {
  _outlets.set(outlet.slug, outlet);
  _outlets.set(outlet.id, outlet);
});

/**
 * Ensure default outlet exists (call this before queries)
 */
function _ensureDefaultOutlet() {
  const outletId = process.env.MOKA_OUTLET_ID || '2000001165';
  if (!_outlets.has('redbox')) {
    const outlet = {
      id: 'default-outlet',
      slug: 'redbox',
      name: 'Redbox Barbershop',
      moka_outlet_id: outletId,
    };
    _outlets.set('redbox', outlet);
    _outlets.set('default-outlet', outlet);
    _outlets.set(outletId, outlet);
  }
}

/**
 * Create a minimal in-memory Supabase client for Moka integration
 * Implements only .from('moka_tokens') and .from('outlets')
 */
function createInMemorySupabase() {
  // Ensure outlet is initialized for this instance
  _ensureDefaultOutlet();
  
  return {
    from: (table) => ({
      // ── moka_tokens table ──────────────────────────────────
      select: (columns) => {
        if (table === 'moka_tokens') {
          return {
            eq: (col, val) => ({
              single: async () => {
                const token = _memoryTokens.get(val);
                if (!token) {
                  return { data: null, error: { message: 'No rows found', code: 'PGRST116' } };
                }
                return { data: token, error: null };
              },
            }),
            // For selecting all tokens
            then: async (cb) => {
              const allTokens = Array.from(_memoryTokens.values());
              return cb ? cb({ data: allTokens, error: null }) : { data: allTokens, error: null };
            },
          };
        }
        if (table === 'outlets') {
          return {
            eq: (col, val) => ({
              single: async () => {
                _ensureDefaultOutlet(); // Re-check before query
                let outlet = null;
                if (col === 'slug') {
                  outlet = _outlets.get(val);
                } else if (col === 'id') {
                  outlet = Array.from(_outlets.values()).find(o => o.id === val);
                }
                if (!outlet) {
                  outlet = Array.from(_outlets.values()).find(o => o.id === val || o.slug === val);
                }
                if (!outlet) {
                  return { data: null, error: { message: 'No rows found', code: 'PGRST116' } };
                }
                return { data: outlet, error: null };
              },
              // Support chaining eq().order() for filtering
              order: (sortCol, options) => ({
                limit: (n) => ({
                  then: async (cb) => {
                    _ensureDefaultOutlet();
                    let filtered = Array.from(_outlets.values());
                    if (col && val !== undefined) {
                      filtered = filtered.filter(o => o[col] === val);
                    }
                    // Sort by name by default
                    filtered.sort((a, b) => a.name.localeCompare(b.name));
                    if (n) filtered = filtered.slice(0, n);
                    return cb ? cb({ data: filtered, error: null }) : { data: filtered, error: null };
                  }
                }),
                then: async (cb) => {
                  _ensureDefaultOutlet();
                  let filtered = Array.from(_outlets.values());
                  if (col && val !== undefined) {
                    filtered = filtered.filter(o => o[col] === val);
                  }
                  // Sort by name by default
                  filtered.sort((a, b) => a.name.localeCompare(b.name));
                  return cb ? cb({ data: filtered, error: null }) : { data: filtered, error: null };
                }
              })
            }),
            // Support direct order() without eq()
            order: (sortCol, options) => ({
              limit: (n) => ({
                then: async (cb) => {
                  _ensureDefaultOutlet();
                  let allOutlets = Array.from(_outlets.values());
                  // Remove duplicates (same outlet might be stored by slug and id)
                  const uniqueOutlets = allOutlets.filter((outlet, index, self) => 
                    index === self.findIndex(o => o.id === outlet.id)
                  );
                  // Sort by name by default
                  uniqueOutlets.sort((a, b) => a.name.localeCompare(b.name));
                  if (n) uniqueOutlets.slice(0, n);
                  return cb ? cb({ data: uniqueOutlets, error: null }) : { data: uniqueOutlets, error: null };
                }
              }),
              then: async (cb) => {
                _ensureDefaultOutlet();
                let allOutlets = Array.from(_outlets.values());
                // Remove duplicates
                const uniqueOutlets = allOutlets.filter((outlet, index, self) => 
                  index === self.findIndex(o => o.id === outlet.id)
                );
                // Sort by name by default
                uniqueOutlets.sort((a, b) => a.name.localeCompare(b.name));
                return cb ? cb({ data: uniqueOutlets, error: null }) : { data: uniqueOutlets, error: null };
              }
            }),
            ilike: () => ({
              single: async () => {
                _ensureDefaultOutlet();
                const outlet = _outlets.get(val) || Array.from(_outlets.values()).find(o => o.id === val || o.slug === val);
                return { data: outlet || null, error: outlet ? null : { message: 'No rows found' } };
              },
            }),
          };
        }
        // ── Generic tables (services, barbers, schedules, etc.) ──────────────────
        const createEqChain = () => ({
          single: async () => ({ data: null, error: { message: 'Not found', code: 'PGRST116' } }),
          limit: (n) => ({ 
            single: async () => ({ data: null, error: { message: 'Not found', code: 'PGRST116' } }),
            then: async (cb) => cb({ data: [], error: null })
          }),
          eq: () => createEqChain(), // Support chaining .eq().eq()
          order: () => createEqChain(),
          range: () => ({ then: async (cb) => cb({ data: [], error: null }) }),
          then: async (cb) => cb({ data: [], error: null }),
        });
        
        return {
          eq: (col, val) => createEqChain(),
          order: (col, opts) => ({
            limit: (n) => ({
              then: async (cb) => cb({ data: [], error: null }),
              range: (from, to) => ({ then: async (cb) => cb({ data: [], error: null }) }),
            }),
            range: (from, to) => ({ then: async (cb) => cb({ data: [], error: null }) }),
            then: async (cb) => cb({ data: [], error: null }),
          }),
          range: (from, to) => ({ then: async (cb) => cb({ data: [], error: null }) }),
          limit: (n) => ({ then: async (cb) => cb({ data: [], error: null }) }),
          then: async (cb) => cb({ data: [], error: null }),
        };
      },

      // ── moka_tokens upsert ─────────────────────────────────
      upsert: (record, options) => {
        const execute = async () => {
          if (table === 'moka_tokens' && record.outlet_id) {
            _memoryTokens.set(record.outlet_id, {
              ..._memoryTokens.get(record.outlet_id),
              ...record,
              updated_at: new Date().toISOString(),
            });
          }
          return { error: null };
        };
        return {
          then: (onFulfilled, onRejected) => execute().then(onFulfilled, onRejected),
          catch: (onRejected) => execute().catch(onRejected),
        };
      },

      // ── Generic methods ─────────────────────────────────────
      insert: (records) => ({
        select: () => ({
          single: async () => {
            return { data: records[0], error: null };
          },
        }),
      }),
      
      update: (data) => ({
        eq: (col, val) => ({
          then: async (cb) => {
            return cb ? cb({ error: null }) : { error: null };
          },
        }),
      }),
      
      delete: () => ({
        eq: () => ({
          then: async (cb) => {
            return cb ? cb({ error: null }) : { error: null };
          },
        }),
      }),
    }),
  };
}

module.exports = { createInMemorySupabase, _memoryTokens, _outlets };
