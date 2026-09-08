// server/services/turnstile.js
'use strict';

const CLOUDFLARE_SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Verify Cloudflare Turnstile token server-side.
 * Fail-closed: returns success: false if token is missing or verification fails.
 *
 * @param {string} token - The cf-turnstile-response token from client
 * @param {string} [remoteIp] - Optional client IP address
 * @returns {Promise<{ success: boolean, error?: string, errorCodes?: string[], testMode?: boolean }>}
 */
async function verifyTurnstileToken(token, remoteIp = '') {
  const cleanToken = typeof token === 'string' ? token.trim() : '';

  if (!cleanToken) {
    return {
      success: false,
      code: 'BOOKING_TURNSTILE_REQUIRED',
      error: 'BOOKING_TURNSTILE_REQUIRED',
      message: 'Token verifikasi keamanan (Turnstile) diperlukan.',
      errorCodes: ['missing-input-response'],
    };
  }

  // Automated test environment bypass - strictly confined to NODE_ENV === 'test'
  if (process.env.NODE_ENV === 'test') {
    if (cleanToken === 'test-valid-turnstile-token' || cleanToken.startsWith('test-valid')) {
      return { success: true, testMode: true };
    }

    if (cleanToken === 'invalid-dummy-token' || cleanToken.startsWith('test-invalid')) {
      return {
        success: false,
        code: 'BOOKING_TURNSTILE_FAILED',
        error: 'BOOKING_TURNSTILE_FAILED',
        message: 'Verifikasi keamanan bot gagal. Silakan coba lagi.',
        errorCodes: ['invalid-input-response'],
        testMode: true,
      };
    }
  }

  const secretKey = process.env.TURNSTILE_SECRET_KEY ? process.env.TURNSTILE_SECRET_KEY.trim() : '';

  if (!secretKey) {
    if (process.env.NODE_ENV === 'test') {
      return {
        success: false,
        code: 'BOOKING_TURNSTILE_FAILED',
        error: 'BOOKING_TURNSTILE_FAILED',
        message: 'Verifikasi keamanan bot gagal. Silakan coba lagi.',
        errorCodes: ['invalid-input-response'],
        testMode: true,
      };
    }
    console.error('[Turnstile] TURNSTILE_SECRET_KEY is not configured on server');
    return {
      success: false,
      code: 'BOOKING_TURNSTILE_FAILED',
      error: 'TURNSTILE_NOT_CONFIGURED',
      message: 'Verifikasi keamanan bot belum dikonfigurasi.',
      errorCodes: ['internal-error'],
    };
  }

  try {
    const formData = new URLSearchParams();
    formData.append('secret', secretKey);
    formData.append('response', cleanToken);
    if (remoteIp) {
      formData.append('remoteip', remoteIp);
    }

    const res = await fetch(CLOUDFLARE_SITEVERIFY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      return {
        success: false,
        code: 'BOOKING_TURNSTILE_FAILED',
        error: `HTTP_${res.status}`,
        message: 'Layanan verifikasi bot sedang mengalami gangguan.',
        errorCodes: [`http-status-${res.status}`],
      };
    }

    const data = await res.json().catch(() => ({}));
    if (data && data.success) {
      return { success: true, errorCodes: [] };
    }

    return {
      success: false,
      code: 'BOOKING_TURNSTILE_FAILED',
      error: 'BOOKING_TURNSTILE_FAILED',
      message: 'Verifikasi keamanan bot gagal.',
      errorCodes: Array.isArray(data['error-codes']) ? data['error-codes'] : ['invalid-input-response'],
    };
  } catch (err) {
    const isTimeout = err?.name === 'TimeoutError' || err?.message?.includes('timeout');
    console.error('[Turnstile] Verification call failed:', err?.message || err);
    return {
      success: false,
      code: 'BOOKING_TURNSTILE_FAILED',
      error: isTimeout ? 'TURNSTILE_TIMEOUT' : 'TURNSTILE_NETWORK_ERROR',
      message: isTimeout ? 'Verifikasi bot timeout. Silakan coba lagi.' : 'Gagal menghubungi server verifikasi bot.',
      errorCodes: [isTimeout ? 'timeout' : 'network-error'],
    };
  }
}

/**
 * Determine if request comes from an internal, trusted admin caller that bypasses Turnstile.
 * Never trust client-supplied boolean flags like skipTurnstile.
 *
 * @param {import('express').Request} req
 * @returns {boolean}
 */
function isTrustedTurnstileBypass(req) {
  if (!req) return false;

  const adminPassword = process.env.ADMIN_PASSWORD;
  const adminTokenHeader = req.headers ? req.headers['x-admin-token'] : undefined;

  // Direct server admin token match
  if (adminPassword && adminTokenHeader === adminPassword) {
    return true;
  }

  // Verified adminAuth attached by middleware
  if (req.adminAuth && (req.adminAuth.role === 'owner' || req.adminAuth.role === 'manager' || req.adminAuth.sessionVerified)) {
    return true;
  }

  return false;
}

module.exports = {
  verifyTurnstileToken,
  isTrustedTurnstileBypass,
};
