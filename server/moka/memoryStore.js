'use strict';
// ============================================================
// In-Memory Supabase Mock for Moka OAuth (fallback)
// Stores tokens in memory when Supabase is not configured
// ============================================================

const _memoryTokens = new Map(); // outlet_id -> token data
const _outlets = new Map(); // slug -> { id, slug, name }

// Default outlet for single-outlet setup - uses env MOKA_OUTLET_ID
const DEFAULT_OUTLET_ID = process.env.MOKA_OUTLET_ID || '2000001165';
const DEFAULT_OUTLET = {
  id: 'default-outlet',
  slug: 'redbox',
  name: 'Redbox Barbershop',
  moka_outlet_id: DEFAULT_OUTLET_ID,
};

_outlets.set('redbox', DEFAULT_OUTLET);
_outlets.set('default-outlet', DEFAULT_OUTLET);
_outlets.set(DEFAULT_OUTLET_ID, DEFAULT_OUTLET);

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
