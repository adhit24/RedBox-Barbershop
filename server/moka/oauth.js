'use strict';
// ============================================================
// MOKA POS  —  OAuth 2.0 Token Manager
// Handles: authorization URL, code exchange, refresh, storage
// ============================================================

let MOKA_AUTH_URL  = process.env.MOKA_AUTH_URL  || 'https://account.mokapos.com/oauth/authorize';
let MOKA_TOKEN_URL = process.env.MOKA_TOKEN_URL || 'https://api.mokapos.com/oauth/token';
if (!/^https?:\/\//i.test(MOKA_AUTH_URL))  MOKA_AUTH_URL  = 'https://' + MOKA_AUTH_URL;
if (!/^https?:\/\//i.test(MOKA_TOKEN_URL)) MOKA_TOKEN_URL = 'https://' + MOKA_TOKEN_URL;
const MOKA_CLIENT_ID   = process.env.MOKA_CLIENT_ID   || '';
const MOKA_CLIENT_SECRET = process.env.MOKA_CLIENT_SECRET || '';
const MOKA_REDIRECT_URI  = process.env.MOKA_REDIRECT_URI  || '';
const MOKA_SCOPE         = process.env.MOKA_SCOPE || 'orders:read orders:write customers:read customers:write';

// Refresh 5 minutes before actual expiry to avoid clock-skew races
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

// In-process token cache keyed by outletId.
// Avoids DB round-trip on every request.
const _cache = new Map(); // outletId → { access_token, expires_at, ... }

// ── PUBLIC API ────────────────────────────────────────────

/**
 * Build the OAuth authorization URL to redirect the admin to.
 * @param {string} state - random CSRF token (store in session)
 * @returns {string} full URL
 */
function buildAuthorizationUrl(state) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     MOKA_CLIENT_ID,
    redirect_uri:  MOKA_REDIRECT_URI,
    state,
  });
  const scope = MOKA_SCOPE.trim();
  if (scope) params.set('scope', scope);
  return `${MOKA_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange an authorization code for access + refresh tokens.
 * Called once per outlet after the OAuth redirect.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} code - authorization code from Moka callback
 * @param {string} outletId - our outlet UUID
 */
async function exchangeCode(supabase, code, outletId) {
  const data = await _tokenRequest({
    grant_type:    'authorization_code',
    code,
    redirect_uri:  MOKA_REDIRECT_URI,
    client_id:     MOKA_CLIENT_ID,
    client_secret: MOKA_CLIENT_SECRET,
  });
  await _persistToken(supabase, outletId, data);
  return data;
}

/**
 * Get a valid access_token for the given outlet.
 * Uses Client Credentials flow - auto-generates token if not cached.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} outletId
 * @returns {Promise<string>} access_token
 */
async function getAccessToken(supabase, outletId) {
  // 1. Memory cache hit?
  const cached = _cache.get(outletId);
  if (cached && !_isExpiringSoon(cached.expires_at)) {
    return cached.access_token;
  }

  // 2. Try load from DB (if available)
  let row = null;
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('moka_tokens')
        .select('*')
        .eq('outlet_id', outletId)
        .single();
      if (!error && data) row = data;
    } catch (e) {
      // Ignore DB errors, use client credentials
    }
  }

  // 3. If no token or expiring, use Client Credentials to get new token
  if (!row || _isExpiringSoon(row.expires_at)) {
    console.log('[Moka] Using Client Credentials to generate token...');
    const tokenData = await _getClientCredentialsToken();
    
    const expiresAt = new Date(
      Date.now() + (tokenData.expires_in || 15552000) * 1000
    ).toISOString();
    
    row = {
      outlet_id: outletId,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || null,
      token_type: tokenData.token_type || 'Bearer',
      expires_at: expiresAt,
      scope: tokenData.scope || 'profile',
      updated_at: new Date().toISOString(),
    };
    
    // Try save to DB (optional)
    if (supabase) {
      supabase.from('moka_tokens').upsert(row, { onConflict: 'outlet_id' })
        .catch(() => {});
    }
  }

  // 4. Cache and return
  _cache.set(outletId, { access_token: row.access_token, expires_at: row.expires_at });
  return row.access_token;
}

/**
 * Get token using Client Credentials flow with ALL scopes
 * Scopes: customer, library, profile, report, transaction, checkout, checkout_api, sales_type
 */
async function _getClientCredentialsToken() {
  const ALL_SCOPES = 'customer library profile report transaction checkout checkout_api sales_type';
  
  const res = await fetch(MOKA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: MOKA_CLIENT_ID,
      client_secret: MOKA_CLIENT_SECRET,
      scope: ALL_SCOPES,
    }).toString(),
  });

  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }

  if (!res.ok) {
    throw Object.assign(
      new Error(`Moka client credentials failed [${res.status}]: ${body?.error_description || body?.error || text}`),
      { status: res.status, code: 'MOKA_TOKEN_ERROR', details: body }
    );
  }
  console.log('[Moka] Token generated with scopes:', body.scope || ALL_SCOPES);
  return body;
}

/**
 * Test current token and return scopes info
 */
async function getTokenInfo(supabase, outletId) {
  try {
    const token = await getAccessToken(supabase, outletId);
    // Decode JWT payload (base64)
    const parts = token.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      return {
        scopes: payload.scope?.split(' ') || [],
        expires_at: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
        outlet_id: payload.outlet_id || null,
      };
    }
    return { scopes: [], error: 'Not a JWT token' };
  } catch (e) {
    return { scopes: [], error: e.message };
  }
}

/**
 * Revoke cached token for an outlet (e.g., when re-authorizing).
 * @param {string} outletId
 */
function invalidateCache(outletId) {
  _cache.delete(outletId);
}

/**
 * Check whether Moka integration is ready to make API calls.
 * Two modes:
 *   1. Full OAuth: CLIENT_ID + CLIENT_SECRET + REDIRECT_URI → token auto-refresh works
 *   2. Token-only:  no CLIENT_ID/SECRET but a token was manually stored via DB — still usable
 *      (token won't auto-refresh, but avoids blocking the entire integration)
 * MOKA_OUTLET_ID is used as the fallback token key when no outlet UUID is known.
 */
function isMokaOAuthConfigured() {
  // Full OAuth credentials present
  if (MOKA_CLIENT_ID && MOKA_CLIENT_SECRET && MOKA_REDIRECT_URI) return true;
  // At minimum we need a client_credentials capable secret (allows token generation without redirect)
  if (MOKA_CLIENT_ID && MOKA_CLIENT_SECRET) return true;
  return false;
}

// ── PRIVATE HELPERS ───────────────────────────────────────

async function _doRefresh(supabase, outletId, refreshToken) {
  const data = await _tokenRequest({
    grant_type:    'refresh_token',
    refresh_token: refreshToken,
    client_id:     MOKA_CLIENT_ID,
    client_secret: MOKA_CLIENT_SECRET,
  });
  await _persistToken(supabase, outletId, data);
  return data;
}

async function _tokenRequest(params) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  let res;
  try {
    res = await fetch(MOKA_TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams(params).toString(),
      signal:  controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw Object.assign(
      new Error('Moka token request timed out after 15 s'),
      { code: 'MOKA_TIMEOUT' }
    );
    throw err;
  }
  clearTimeout(timer);

  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }

  if (!res.ok) {
    throw Object.assign(
      new Error(`Moka token request failed [${res.status}]: ${body?.error_description || body?.error || text}`),
      { status: res.status, code: 'MOKA_TOKEN_ERROR', details: body }
    );
  }
  return body;
}

async function _persistToken(supabase, outletId, tokenData) {
  const expiresAt = new Date(
    Date.now() + (tokenData.expires_in || 3600) * 1000
  ).toISOString();

  const record = {
    outlet_id:     outletId,
    access_token:  tokenData.access_token,
    refresh_token: tokenData.refresh_token || null,
    token_type:    tokenData.token_type    || 'Bearer',
    expires_at:    expiresAt,
    scope:         tokenData.scope         || null,
    updated_at:    new Date().toISOString(),
  };

  const { error } = await supabase
    .from('moka_tokens')
    .upsert(record, { onConflict: 'outlet_id' });

  if (error) console.error('[OAuth] Failed to persist token:', error.message);

  _cache.set(outletId, { access_token: record.access_token, expires_at: record.expires_at });
}

function _isExpiringSoon(expiresAt) {
  return Date.now() >= new Date(expiresAt).getTime() - REFRESH_BUFFER_MS;
}

module.exports = {
  buildAuthorizationUrl,
  exchangeCode,
  getAccessToken,
  getTokenInfo,
  invalidateCache,
  isMokaOAuthConfigured,
};
