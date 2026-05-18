/**
 * Fonnte WhatsApp Gateway Service
 * Docs: https://fonnte.com/api
 * Set env: FONNTE_TOKEN=<your_device_token>
 */

const FONNTE_API = 'https://api.fonnte.com/send';
const FONNTE_DEVICE_API = 'https://api.fonnte.com/device';
const FONNTE_STATUS_API = 'https://api.fonnte.com/status';

async function sendWA(to, message) {
  const token = process.env.FONNTE_TOKEN;
  if (!token) {
    console.warn('[Fonnte] FONNTE_TOKEN not set, skipping WA send');
    return null;
  }

  // Normalize to full Indonesian international format (628xxx):
  //   "+628xxx" → strip + → "628xxx"
  //   "08xxx"   → remove leading 0, prepend 62 → "628xxx"
  //   "8xxx"    → no leading 0 or 62 prefix → prepend 62 → "628xxx"
  let number = String(to).replace(/\D/g, '');
  if (number.startsWith('0')) {
    number = '62' + number.slice(1);
  } else if (!number.startsWith('62')) {
    number = '62' + number;
  }

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
    return { status: false, error: err.message };
  }
}

async function getDeviceInfo() {
  const token = process.env.FONNTE_TOKEN;
  if (!token) return { status: false, reason: 'FONNTE_TOKEN not set' };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let res;
    try {
      res = await fetch(FONNTE_DEVICE_API, {
        method: 'POST',
        headers: { Authorization: token },
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

    if (!res.ok) return { status: false, http_status: res.status, ...data };
    return data;
  } catch (err) {
    return { status: false, error: err.message };
  }
}

async function checkMessageStatus(id) {
  const token = process.env.FONNTE_TOKEN;
  if (!token) return { status: false, reason: 'FONNTE_TOKEN not set' };
  const msgId = Number(id);
  if (!Number.isFinite(msgId) || msgId <= 0) return { status: false, reason: 'invalid_id' };

  try {
    const body = new URLSearchParams({ id: String(msgId) });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let res;
    try {
      res = await fetch(FONNTE_STATUS_API, {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
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

    if (!res.ok) return { status: false, http_status: res.status, ...data };
    return data;
  } catch (err) {
    return { status: false, error: err.message };
  }
}

module.exports = { sendWA, getDeviceInfo, checkMessageStatus };
