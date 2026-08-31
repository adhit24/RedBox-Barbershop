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

// Canonicalize slugs and display labels before selecting a branch device.
function normalizeBranch(branch) {
  const value = String(branch || '').toLowerCase().trim();
  if (!value || value === 'default' || value === 'pusat' || value === 'redbox bypass') return 'bypass';
  if (value === 'csb mall' || value === 'redbox csb mall') return 'csb';
  if (value === 'redbox sumber') return 'sumber';
  if (value === 'redbox samadikun') return 'samadikun';
  if (value === 'redbox tegal') return 'tegal';
  return value;
}

/**
 * Mendapatkan token Fonnte untuk cabang tertentu
 * @param {string} branch - Nama cabang (bypass, sumber, samadikun, csb, tegal)
 * @returns {string|null} Token Fonnte atau null jika tidak ada
 */
function getBranchToken(branch) {
  const branchKey = normalizeBranch(branch);
  
  // Token bypass: cek FONNTE_TOKEN_BYPASS dulu, fallback ke FONNTE_TOKEN (legacy)
  const bypassToken = process.env.FONNTE_TOKEN_BYPASS || process.env.FONNTE_TOKEN || null;

  // Jika tidak ada branch atau default, pakai bypass token
  if (!branchKey || branchKey === 'default' || branchKey === 'bypass') {
    return bypassToken;
  }

  const envVarName = BRANCH_TOKEN_MAP[branchKey];
  if (envVarName) {
    const token = process.env[envVarName];
    if (token) return token;
    // Do not silently route a branch message through Bypass. That can make
    // one device look healthy while the intended branch device is offline.
    return null;
  }

  return null;
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
 * @param {boolean} [options.assumeIndonesianLocalShorthand] - Only set true
 *   for a caller that KNOWS `to` is a bare Indonesian mobile number with no
 *   leading 0 and no country code (e.g. a legacy DB row). Without it, a bare
 *   "8..." target is left untouched, since it's ambiguous with real foreign
 *   country codes (81 Japan, 82 Korea, 84 Vietnam, 86 China, ...).
 */
async function sendWA(to, message, options = {}) {
  // Detect branch from options atau dari nomor tujuan
  let branch = normalizeBranch(options.branch || detectBranchFromNumber(to));
  let token = options.token || getBranchToken(branch);
  
  console.log('[Fonnte] sendWA called:', { to, branch });
  
  // Fallback ke default token jika tidak ada
  if (!token && branch === 'bypass') {
    token = process.env.FONNTE_TOKEN;
    console.log('[Fonnte] Falling back to default (Bypass) token');
  }
  if (!token) {
    return { status: false, reason: `FONNTE_TOKEN not configured for branch: ${branch}` };
  }

  // Normalize outbound target number:
  //   "+628xxx" / "628xxx"  → already has a country code (Indonesian or
  //                            foreign) → left as-is
  //   "08xxx"               → Indonesian local convenience → "628xxx"
  //   "8xxx" (bare, no 0/62
  //   prefix)               → AMBIGUOUS once stripped of punctuation: could
  //                            be Indonesian mobile shorthand ("81234567890"
  //                            meaning "081234567890") OR a legitimate
  //                            international number whose own country code
  //                            starts with 8 (Japan 81, Korea 82, Vietnam 84,
  //                            China 86, Cambodia 855, Bangladesh 880, Taiwan
  //                            886, ...). Left as-is by default — a prior
  //                            version of this function blindly prepended 62
  //                            onto every bare "8..." number, which silently
  //                            corrupted any of those country codes (e.g. a
  //                            Japanese "819012345678" became
  //                            "62819012345678"). Also fixed, same
  //                            correction: a prior-prior version prepended 62
  //                            onto ANY non-Indonesian number at all (e.g. a
  //                            Singapore number became "62" + "6591234567").
  //
  // If a caller genuinely holds a bare Indonesian-shorthand number (no
  // leading 0, no country code — legacy DB rows written before this format
  // was standardized elsewhere) it must say so explicitly:
  //   sendWA(to, message, { branch, assumeIndonesianLocalShorthand: true })
  // No current caller in this codebase needs this — every live caller either
  // passes a trusted, already-normalized phone (never bare-8: see
  // phoneNormalization.js) or a DB-sourced number that's already 62-prefixed
  // at write time (adminCrm.js's waNorm, member-identity.js's
  // normalizeMemberPhone). The option exists as a scoped escape hatch, not a
  // default assumption.
  let number = String(to).replace(/\D/g, '');
  if (number.startsWith('0')) {
    number = '62' + number.slice(1);
  } else if (options.assumeIndonesianLocalShorthand === true && number.startsWith('8') && !number.startsWith('62')) {
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
    const hasToken = branch === 'bypass'
      ? !!(process.env.FONNTE_TOKEN_BYPASS || process.env.FONNTE_TOKEN)
      : !!process.env[envVar];
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
  normalizeBranch,
  BRANCH_WA_NUMBER
};
