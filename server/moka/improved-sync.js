'use strict';
// ============================================================
// IMPROVED MOKA SYNC — Anti Double-Booking for All Branches
//
// Key improvements:
// 1. Enhanced barber name resolution with outlet validation
// 2. Strict structured bill name parsing
// 3. Cross-branch conflict prevention
// 4. Better error handling and logging
// ============================================================

const { createClient } = require('@supabase/supabase-js');

// Lazy-initialized fallback client (used only if caller doesn't pass supabase)
let _defaultClient = null;
function _getDefaultClient() {
  if (!_defaultClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL/SUPABASE_SERVICE_KEY not set');
    _defaultClient = createClient(url, key);
  }
  return _defaultClient;
}

/**
 * Enhanced barber resolution with strict validation.
 * Prevents cross-branch assignment errors like Yuki→Abdul instead of Yuki→Opan.
 * @param {object} [db] - Supabase client (defaults to lazily-created service-key client)
 */
async function resolveBarberWithValidation(billName, outletId, billId, db = null) {
  const supabase = db || _getDefaultClient();
  console.log(`[Enhanced Sync] Resolving barber for bill "${billName}" at outlet ${outletId}`);

  // Step 1: Try structured format first (highest priority)
  const structuredMatch = _parseStructuredBillName(billName);
  if (structuredMatch) {
    console.log(`[Enhanced Sync] Structured format detected:`, structuredMatch);

    const { dateStr, timeStr, barberHint } = structuredMatch;

    const barberMatch = await _matchBarberByNameHint(barberHint, outletId, supabase);
    if (barberMatch) {
      console.log(`[Enhanced Sync] ✓ Structured match: "${barberHint}" → ${barberMatch.name} (${barberMatch.id})`);
      return {
        barberId: barberMatch.id,
        confidence: 'structured',
        method: 'hint-match',
        parsedTime: _parseDateTime(dateStr, timeStr),
      };
    } else {
      console.warn(`[Enhanced Sync] ⚠️ Structured hint "${barberHint}" not found in outlet ${outletId}`);
    }
  }

  // Step 2: item-based resolution stub (needs Moka client — handled in sync.js Pass 1/3)
  // kept as no-op here to preserve the resolution cascade

  // Step 3: Fallback to fuzzy matching with strict thresholds
  const fuzzyMatch = await _matchBarberFuzzyStrict(billName, outletId, supabase);
  if (fuzzyMatch) {
    console.log(`[Enhanced Sync] ✓ Fuzzy match: "${fuzzyMatch.name}" (${fuzzyMatch.id}) - score: ${fuzzyMatch.score}`);
    return {
      barberId: fuzzyMatch.id,
      confidence: 'fuzzy',
      method: 'strict-fuzzy',
      score: fuzzyMatch.score,
    };
  }

  console.log(`[Enhanced Sync] ❌ No barber match found for bill "${billName}"`);
  return null;
}

/**
 * Parse structured bill name: "CUSTOMER DD/MM HH.MM BARBER"
 * Returns null if format doesn't match structured pattern.
 */
function _parseStructuredBillName(billName) {
  if (!billName) return null;

  // Pattern: CUSTOMER DD/MM HH.MM BARBER — e.g. "yuki 19/05 14.00 opan"
  const m = billName.match(/^(\S+)\s+(\d{1,2}[\/\-\.]\d{1,2}(?:[\/\-\.]\d{2,4})?)\s+(\d{1,2}[.:]\d{2})\s+(.+)$/i);
  if (!m) return null;

  return {
    customerName: m[1].trim(),
    dateStr:      m[2].trim(),
    timeStr:      m[3].trim(),
    barberHint:   m[4].trim(),
  };
}

/**
 * Match barber by exact name hint (structured format).
 * Only searches within the specified outlet to prevent cross-branch errors.
 */
async function _matchBarberByNameHint(barberHint, outletId, supabase) {
  if (!barberHint || !outletId) return null;

  const { data: barbers, error } = await supabase
    .from('barbers')
    .select('id, name, is_active')
    .eq('outlet_id', outletId)
    .eq('is_active', true);

  if (error || !barbers?.length) return null;

  const hintLower = barberHint.toLowerCase().trim();

  // Exact match first
  const exactMatch = barbers.find(b => b.name.toLowerCase() === hintLower);
  if (exactMatch) return exactMatch;

  // Token-based matching (high confidence)
  for (const barber of barbers) {
    const barberLower = barber.name.toLowerCase();
    const barberTokens = barberLower.split(/\s+/).filter(t => t.length >= 2);

    const tokenHit = barberTokens.some(token =>
      hintLower.includes(token) || token.includes(hintLower)
    );

    if (tokenHit) {
      console.log(`[Enhanced Sync] Token match: "${barberHint}" → "${barber.name}"`);
      return barber;
    }
  }

  return null;
}

/**
 * Strict fuzzy matching with high thresholds to prevent false positives.
 */
async function _matchBarberFuzzyStrict(billName, outletId, supabase) {
  if (!billName || !outletId) return null;

  const { data: barbers, error } = await supabase
    .from('barbers')
    .select('id, name, is_active')
    .eq('outlet_id', outletId)
    .eq('is_active', true);

  if (error || !barbers?.length) return null;

  const billLower = billName.toLowerCase();
  let bestMatch = null;
  let bestScore = 0;

  for (const barber of barbers) {
    const barberLower = barber.name.toLowerCase();

    if (barberLower.length < 3) continue;

    let score = 0;

    if (billLower.includes(barberLower) || barberLower.includes(billLower)) {
      score = 0.9;
    } else {
      const barberTokens = barberLower.split(/\s+/).filter(t => t.length >= 3);
      const billTokens   = billLower.split(/\s+/).filter(t => t.length >= 3);

      for (const bt of barberTokens) {
        for (const wt of billTokens) {
          if (bt.includes(wt) || wt.includes(bt)) {
            score = Math.max(score, 0.7);
          }
        }
      }
    }

    if (score > bestScore && score >= 0.7) {
      bestScore = score;
      bestMatch = { ...barber, score };
    }
  }

  return bestMatch;
}

/**
 * Parse date and time from structured format (DD/MM and HH.MM or HH:MM).
 */
function _parseDateTime(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;

  try {
    const currentYear = new Date().getFullYear();

    const dateParts = dateStr.split(/[\/\-\.]/);
    if (dateParts.length < 2) return null;

    const day   = parseInt(dateParts[0], 10);
    const month = parseInt(dateParts[1], 10);
    let   year  = dateParts[2] ? parseInt(dateParts[2], 10) : currentYear;
    if (year < 100) year += year < 50 ? 2000 : 1900;

    const timeParts = timeStr.split(/[.:]/);
    if (timeParts.length < 2) return null;

    const hours   = parseInt(timeParts[0], 10);
    const minutes = parseInt(timeParts[1], 10);

    if (isNaN(day) || isNaN(month) || isNaN(year) || isNaN(hours) || isNaN(minutes)) return null;

    return new Date(
      `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}` +
      `T${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:00+07:00`
    );
  } catch (err) {
    console.warn(`[Enhanced Sync] Date parsing error:`, err.message);
    return null;
  }
}

/**
 * Validate that a barber belongs to the expected outlet.
 * Prevents cross-branch assignments causing double-booking.
 * @param {object} [db] - Supabase client (defaults to lazily-created service-key client)
 */
async function validateOutletAssignment(barberId, expectedOutletId, billId, db = null) {
  if (!barberId || !expectedOutletId) return false;

  const supabase = db || _getDefaultClient();

  const { data: barber, error } = await supabase
    .from('barbers')
    .select('outlet_id, name')
    .eq('id', barberId)
    .single();

  if (error || !barber) {
    console.error(`[Enhanced Sync] ❌ Barber ${barberId} not found for validation (bill ${billId})`);
    return false;
  }

  const isValid = barber.outlet_id === expectedOutletId;

  if (!isValid) {
    console.error(`[Enhanced Sync] ❌ OUTLET MISMATCH for bill ${billId}: barber "${barber.name}" is at ${barber.outlet_id}, expected ${expectedOutletId}`);
  }

  return isValid;
}

module.exports = {
  resolveBarberWithValidation,
  validateOutletAssignment,
  _parseStructuredBillName,
  _parseDateTime,
};
