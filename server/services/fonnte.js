/**
 * Fonnte WhatsApp Gateway Service
 * Docs: https://fonnte.com/api
 * Set env: FONNTE_TOKEN=<your_device_token>
 */

const FONNTE_API = 'https://api.fonnte.com/send';

async function sendWA(to, message) {
  const token = process.env.FONNTE_TOKEN;
  if (!token) {
    console.warn('[Fonnte] FONNTE_TOKEN not set, skipping WA send');
    return null;
  }

  // Normalize number: remove +, leading 0 → 62
  const number = String(to).replace(/\D/g, '').replace(/^0/, '62');

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let res;
    try {
      res = await fetch(FONNTE_API, {
        method: 'POST',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ target: number, message }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const raw = await res.text();
    let data;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = { status: false, error: 'non_json_response', raw };
    }

    if (!res.ok) {
      return { status: false, http_status: res.status, ...data };
    }
    return data;
  } catch (err) {
    console.error('[Fonnte] Request error:', err.message);
    return null;
  }
}

module.exports = { sendWA };
