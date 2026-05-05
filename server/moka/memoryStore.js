'use strict';
// ============================================================
// In-Memory Supabase Mock for Moka OAuth (fallback)
// Stores tokens in memory when Supabase is not configured
// ============================================================

const _memoryTokens = new Map(); // outlet_id -> token data
const _outlets = new Map(); // slug -> { id, slug, name }

// Default outlet for single-outlet setup
const DEFAULT_OUTLET = {
  id: 'default-outlet',
  slug: 'redbox',
  name: 'Redbox Barbershop',
  moka_outlet_id: process.env.MOKA_OUTLET_ID || '',
};

_outlets.set('redbox', DEFAULT_OUTLET);
_outlets.set('default-outlet', DEFAULT_OUTLET);

/**
 * Create a minimal in-memory Supabase client for Moka integration
 * Implements only .from('moka_tokens') and .from('outlets')
 */
function createInMemorySupabase() {
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
                const outlet = _outlets.get(val) || Array.from(_outlets.values()).find(o => o.id === val || o.slug === val);
                if (!outlet) {
                  return { data: null, error: { message: 'No rows found', code: 'PGRST116' } };
                }
                return { data: outlet, error: null };
              },
            }),
            ilike: () => ({
              single: async () => {
                const outlet = _outlets.get(val) || Array.from(_outlets.values()).find(o => o.id === val || o.slug === val);
                return { data: outlet || null, error: outlet ? null : { message: 'No rows found' } };
              },
            }),
          };
        }
        return { data: null, error: null };
      },

      // ── moka_tokens upsert ─────────────────────────────────
      upsert: (record, options) => ({
        then: async (cb) => {
          if (table === 'moka_tokens' && record.outlet_id) {
            _memoryTokens.set(record.outlet_id, {
              ..._memoryTokens.get(record.outlet_id),
              ...record,
              updated_at: new Date().toISOString(),
            });
            return cb ? cb({ error: null }) : { error: null };
          }
          return cb ? cb({ error: null }) : { error: null };
        },
      }),

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
