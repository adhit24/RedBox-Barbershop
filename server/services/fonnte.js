/**
 * Fonnte WhatsApp Gateway Service
 * Docs: https://fonnte.com/api
 * 
 * Multi-branch token support:
 * - FONNTE_TOKEN: Default/global token (Bypass)
 * - FONNTE_TOKEN_SUMBER: Token untuk cabang Sumber
 * - FONNTE_TOKEN_SAMADIKUN: Token untuk cabang Samadikun
 * - FONNTE_TOKEN_CSB: Token untuk cabang CSB Mall
 * - FONNTE_TOKEN_TEGAL: Token untuk cabang Tegal
 */

const FONNTE_API = 'https://api.fonnte.com/send';
const FONNTE_DEVICE_API = 'https://api.fonnte.com/device';
const FONNTE_STATUS_API = 'https://api.fonnte.com/status';

// Mapping cabang ke environment variable token
const BRANCH_TOKEN_MAP = {
  bypass:    'FONNTE_TOKEN',
  sumber:    'FONNTE_TOKEN_SUMBER',
  samadikun: 'FONNTE_TOKEN_SAMADIKUN',
  csb:       'FONNTE_TOKEN_CSB',
  tegal:     'FONNTE_TOKEN_TEGAL',
};

// Device/token mapping untuk multi-cabang
const BRANCH_WA_NUMBER = {
  bypass:    '0818202569',
  sumber:    '0818202599',
  samadikun: '0818202589',
  csb:       '0818202889',
  tegal:     '0818268883',
};

/**
 * Mendapatkan token Fonnte untuk cabang tertentu
 * @param {string} branch - Nama cabang (bypass, sumber, samadikun, csb, tegal)
 * @returns {string|null} Token Fonnte atau null jika tidak ada
 */
function getBranchToken(branch) {
  const branchKey = String(branch || '').toLowerCase().trim();
  
  // Jika tidak ada branch atau default, pakai FONNTE_TOKEN (Bypass)
  if (!branchKey || branchKey === 'default' || branchKey === 'bypass') {
    return process.env.FONNTE_TOKEN || null;
  }
  
  const envVarName = BRANCH_TOKEN_MAP[branchKey];
  if (envVarName) {
    const token = process.env[envVarName];
    if (token) return token;
    // Fallback ke default token jika branch token tidak tersedia
    return process.env.FONNTE_TOKEN || null;
  }
  
  return process.env.FONNTE_TOKEN || null;
}

/**
 * Mendeteksi cabang dari nomor WA tujuan
 * @param {string} to - Nomor WA tujuan
 * @returns {string} Nama cabang (bypass, sumber, samadikun, csb, tegal)
 */
function detectBranchFromNumber(to) {
  const normalized = String(to).replace(/\D/g, '');
  
  // Normalize the branch number to check: remove all non-digits, then remove leading 62 or 0
  const normalizeBranchNum = (num) => {
    let n = String(num).replace(/\D/g, '');
    if (n.startsWith('62')) n = n.slice(2);
    if (n.startsWith('0')) n = n.slice(1);
    return n;
  };
  
  // Check normalized input against normalized branch numbers
  const normalizedInput = normalizeBranchNum(normalized);
  
  for (const [branch, number] of Object.entries(BRANCH_WA_NUMBER)) {
    const normalizedBranch = normalizeBranchNum(number);
    // Check if either the full normalized number matches, or the input ends with the branch number
    if (normalizedInput === normalizedBranch) {
      return branch;
    }
  }
  return 'bypass'; // Default ke Bypass
}

/**
 * Kirim WhatsApp message via Fonnte
 * @param {string} to - Nomor tujuan
 * @param {string} message - Pesan yang akan dikirim
 * @param {object} options - Options tambahan
 * @param {string} options.branch - Cabang pengirim (bypass, sumber, etc.)
 * @param {string} options.token - Token khusus (override branch detection)
 */
async function sendWA(to, message, options = {}) {
  // Detect branch from options atau dari nomor tujuan
  let branch = options.branch || detectBranchFromNumber(to);
  let token = options.token || getBranchToken(branch);
  
  console.log('[Fonnte] sendWA called with:', { to, branch, options, tokenFirstChars: token ? token.slice(0, 10) + '...' : 'none' });
  
  // Fallback ke default token jika tidak ada
  if (!token) {
    token = process.env.FONNTE_TOKEN;
    console.log('[Fonnte] Falling back to default (Bypass) token');
  }
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

/**
 * Get device info dengan support branch-specific token
 * @param {string} branch - Nama cabang (opsional, default: 'bypass')
 */
async function getDeviceInfo(branch = 'bypass') {
  const token = getBranchToken(branch);
  if (!token) return { status: false, reason: `FONNTE_TOKEN not set for branch: ${branch}` };

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

/**
 * Check message status dengan support branch-specific token
 * @param {number} id - Message ID
 * @param {string} branch - Nama cabang (opsional, default: 'bypass')
 */
async function checkMessageStatus(id, branch = 'bypass') {
  const token = getBranchToken(branch);
  if (!token) return { status: false, reason: `FONNTE_TOKEN not set for branch: ${branch}` };
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

/**
 * Get token untuk cabang tertentu (utility function)
 * @param {string} branch - Nama cabang
 * @returns {string|null} Token atau null
 */
function getTokenForBranch(branch) {
  return getBranchToken(branch);
}

/**
 * List semua cabang yang punya token tersedia
 * @returns {object} Object dengan status token per cabang
 */
function getAvailableBranches() {
  const result = {};
  for (const [branch, envVar] of Object.entries(BRANCH_TOKEN_MAP)) {
    const hasToken = !!process.env[envVar];
    result[branch] = {
      available: hasToken,
      env_var: envVar,
      wa_number: BRANCH_WA_NUMBER[branch]
    };
  }
  return result;
}

module.exports = { 
  sendWA, 
  getDeviceInfo, 
  checkMessageStatus,
  getTokenForBranch,
  getAvailableBranches,
  detectBranchFromNumber,
  BRANCH_WA_NUMBER
};
