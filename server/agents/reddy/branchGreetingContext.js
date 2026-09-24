'use strict';

/**
 * Reddy branch-lock + personal greeting context.
 *
 * Pure helpers (no I/O). The webhook resolves the branch from the Fonnte
 * receiving device on EVERY inbound message (never from conversation memory or
 * the LLM) and this module turns that into:
 *   - conversation_branch / branch_locked / requested_branch
 *   - a prompt block that makes the WhatsApp channel's branch the default
 *   - a safe first-name for the session's first greeting
 *
 * It does not create state: "first greeting" reuses the existing
 * sessionStatus ('expired' === new session) computed from wa_conversations.
 */

const { REDBOX_KNOWLEDGE } = require('./knowledge/redboxKnowledge');
const { BRANCH_WA_NUMBER } = require('../../services/fonnte');
const { extractFirstName } = require('./personalityPolicy');

const BRANCH_SOURCE = Object.freeze({
  FONNTE_DEVICE: 'fonnte_device',
  EXPLICIT_PARAM: 'explicit_param',
  DEFAULT_FALLBACK: 'default_fallback',
});

function canonicalDigits(value) {
  let n = String(value || '').replace(/\D/g, '');
  if (n.startsWith('62')) n = n.slice(2);
  if (n.startsWith('0')) n = n.slice(1);
  return n;
}

/**
 * Returns the branch id whose WhatsApp number equals `deviceOrReceiver`, or
 * null. Unlike detectBranchFromNumber it never falls back to 'bypass', so the
 * caller can tell a real device match from a default.
 */
function matchBranchFromDevice(deviceOrReceiver) {
  const input = canonicalDigits(deviceOrReceiver);
  if (!input) return null;
  for (const [branch, number] of Object.entries(BRANCH_WA_NUMBER)) {
    if (canonicalDigits(number) === input) return branch;
  }
  return null;
}

function branchRecord(id) {
  return REDBOX_KNOWLEDGE.branches.find((b) => b.id === id) || null;
}

/**
 * Finds a branch the customer names in `text` that differs from the
 * conversation branch. Alias match is on whole words only.
 */
function detectRequestedBranch(text, conversationBranch) {
  const haystack = String(text || '').toLowerCase();
  if (!haystack) return null;
  for (const b of REDBOX_KNOWLEDGE.branches) {
    if (b.id === conversationBranch) continue;
    const aliases = [b.id, ...(b.aliases || [])].map((a) => String(a).toLowerCase());
    for (const alias of aliases) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(haystack)) return b.id;
    }
  }
  return null;
}

/**
 * @param {object} p
 * @param {string} p.branch - branch already resolved by the webhook
 * @param {string|null} [p.deviceOrReceiver] - raw Fonnte device/receiver
 * @param {boolean} [p.explicit] - branch passed explicitly (not from device)
 * @param {string} [p.text]
 */
function buildBranchContext({ branch, deviceOrReceiver = null, explicit = false, text = '' } = {}) {
  const deviceBranch = matchBranchFromDevice(deviceOrReceiver);
  let source = BRANCH_SOURCE.DEFAULT_FALLBACK;
  let conversationBranch = branch;
  if (deviceBranch) {
    source = BRANCH_SOURCE.FONNTE_DEVICE;
    conversationBranch = deviceBranch;
  } else if (explicit) {
    source = BRANCH_SOURCE.EXPLICIT_PARAM;
  }
  const record = branchRecord(conversationBranch);
  const locked = source !== BRANCH_SOURCE.DEFAULT_FALLBACK && Boolean(record);
  return Object.freeze({
    conversation_branch: conversationBranch,
    branch_name: record ? record.name : null,
    branch_locked: locked,
    branch_source: source,
    requested_branch: locked ? detectRequestedBranch(text, conversationBranch) : null,
  });
}

function buildBranchContextPrompt(ctx) {
  if (!ctx || !ctx.branch_locked) return '';
  const requested = ctx.requested_branch ? branchRecord(ctx.requested_branch) : null;
  let block = `\n\n# KONTEKS CABANG WHATSAPP (SOURCE OF TRUTH)\n` +
    `CURRENT_BRANCH: ${ctx.branch_name} (id: ${ctx.conversation_branch})\n` +
    `BRANCH_LOCKED: true\n` +
    `Customer sedang menghubungi nomor WhatsApp ${ctx.branch_name}. CURRENT_BRANCH ditentukan sistem dari nomor WhatsApp yang dihubungi, bukan dari isi chat.\n` +
    `- DILARANG bertanya "mau cabang mana?" / "di outlet mana?" selama customer tidak menyebut cabang lain.\n` +
    `- Pakai CURRENT_BRANCH sebagai default untuk barber/kapster, layanan, harga per cabang, jam operasional, alamat, dan booking.\n` +
    `- Untuk niat booking, anggap customer ingin booking di CURRENT_BRANCH; cukup ingatkan "kamu lagi chat ke ${ctx.branch_name}, tinggal pilih cabang tersebut saat booking" (link booking sudah membawa cabang).\n` +
    `- DILARANG menawarkan / membandingkan / mendaftar cabang atau barber cabang lain tanpa diminta.\n` +
    `- Jika customer menanyakan cabang lain, jawab pertanyaan itu sebagai REQUESTED_BRANCH sementara tanpa mengubah CURRENT_BRANCH.\n` +
    `- Aturan ini mengatur konteks cabang saja; kebijakan booking, fakta harga/durasi, dan ketersediaan real-time tidak berubah.`;
  if (requested) {
    block += `\nREQUESTED_BRANCH (pesan ini): ${requested.name} (id: ${requested.id}). Jawab untuk ${requested.name}, tetapi channel percakapan tetap ${ctx.branch_name}. ` +
      `Jika customer menyatakan ingin ke ${requested.name}, arahkan booking ke ${requested.name}.`;
  }
  return block;
}

const INVALID_NAME_TOKENS = new Set([
  'null', 'undefined', 'customer', 'pelanggan', 'guest', 'user', 'unknown', 'kak', 'nan', 'none', 'anonymous', 'test',
]);

/**
 * Safe greeting name: first usable token, title-cased when stored in ALL CAPS.
 * Returns null for empty/invalid/phone-like values.
 */
function normalizeGreetingName(rawName) {
  const first = extractFirstName(typeof rawName === 'string' ? rawName : null);
  if (!first) return null;
  const cleaned = first.replace(/^[^\p{L}]+|[^\p{L}'’-]+$/gu, '');
  if (cleaned.length < 2 || !/\p{L}/u.test(cleaned)) return null;
  if (INVALID_NAME_TOKENS.has(cleaned.toLowerCase())) return null;
  if (cleaned === cleaned.toUpperCase() || cleaned === cleaned.toLowerCase()) {
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
  }
  return cleaned;
}

/**
 * Greeting instruction for the FIRST message of a session only.
 * `nameSource` is telemetry-safe metadata (never the name itself).
 */
function buildGreetingPrompt({ greetingName, branchName = null, isNewSession }) {
  if (!isNewSession) return '';
  const where = branchName ? ` di ${branchName}` : '';
  if (greetingName) {
    return `\n\n# SALAM PERSONAL (AWAL SESI)\nNama customer: ${greetingName}. Ini pesan pertama sesi. Sapa dengan nama tanpa "Kak", contoh: "Halo ${greetingName} 👋 ada yang bisa Reddy bantu hari ini${where}?". ` +
      `Jika customer langsung bertanya, jawab langsung dengan menyebut nama sekali secara natural ("Hai ${greetingName}, ..."). Jangan pakai nama lagi di jawaban berikutnya kecuali terdengar natural.`;
  }
  return `\n\n# SALAM (AWAL SESI, NAMA TIDAK DIKETAHUI)\nNama customer tidak tersedia. Jangan mengarang nama, jangan pakai nomor HP atau nama display WhatsApp. Jika customer hanya menyapa, contoh: "Halo 👋 selamat datang di ${branchName || 'Redbox'}. Ada yang bisa Reddy bantu hari ini?". ` +
    `Jika customer memperkenalkan namanya di percakapan ini, boleh dipakai untuk balasan berikutnya.`;
}

module.exports = {
  BRANCH_SOURCE,
  matchBranchFromDevice,
  detectRequestedBranch,
  buildBranchContext,
  buildBranchContextPrompt,
  normalizeGreetingName,
  buildGreetingPrompt,
};
