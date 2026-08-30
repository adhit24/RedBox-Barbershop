'use strict';

/**
 * Objective C — conversation isolation authority.
 *
 * Conversation identity (both `wa_conversations` rows and the in-memory
 * conversationCache in api/wa/webhook.js) is currently keyed on `sender`
 * alone, so the same customer contacting two different RedBox branch
 * WhatsApp numbers shares one history. The new isolation authority is
 * `sender + trusted provider device` — device identity is preferred over a
 * branch label as the scope boundary because branch labels can change (a
 * device gets reassigned to a different branch) while the provider device
 * identity is the actual authenticated transport channel.
 *
 * `provider_device_hash` (see server/services/waInboundGuard.js) is already
 * a one-way SHA-256 hash of the raw Fonnte `device` value — this module
 * reuses that exact hash, never the raw device string, matching the existing
 * privacy design (P0 anti-spam migration: "Only hashes/bounded metadata are
 * stored: never raw phone or message content").
 *
 * Legacy rows written before this scoping existed have no real device hash.
 * LEGACY_DEVICE_SCOPE is the sentinel those rows are backfilled to (see the
 * P0 migration) — a REAL provider_device_hash can never equal this sentinel
 * (it is always a 64-char hex SHA-256 digest), so a legacy row is naturally
 * unreachable by any new scoped lookup without needing a destructive delete
 * or a special-case branch in every call site.
 */

const LEGACY_DEVICE_SCOPE = 'legacy-unscoped';

function isRealDeviceHash(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value.trim());
}

/** Never returns null/undefined — always a well-defined scope string. */
function resolveConversationDeviceScope(providerDeviceHash) {
  return isRealDeviceHash(providerDeviceHash) ? providerDeviceHash.trim().toLowerCase() : LEGACY_DEVICE_SCOPE;
}

/** In-memory conversationCache/cacheTimestamps Map key. */
function conversationCacheKey(sender, providerDeviceHash) {
  return `${resolveConversationDeviceScope(providerDeviceHash)}::${sender}`;
}

module.exports = {
  LEGACY_DEVICE_SCOPE,
  isRealDeviceHash,
  resolveConversationDeviceScope,
  conversationCacheKey,
};
