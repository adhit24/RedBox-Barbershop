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
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

/**
 * Enhanced barber resolution with strict validation
 * Prevents cross-branch assignment errors like Yuki→Abdul instead of Yuki→Opan
 */
async function resolveBarberWithValidation(billName, outletId, billId) {
  console.log(`[Enhanced Sync] Resolving barber for bill "${billName}" at outlet ${outletId}`);
  
  // Step 1: Try structured format first (highest priority)
  const structuredMatch = _parseStructuredBillName(billName);
  if (structuredMatch) {
    console.log(`[Enhanced Sync] Structured format detected:`, structuredMatch);
    
    const { customerName, dateStr, timeStr, barberHint } = structuredMatch;
    
    // For structured format, only match the barber hint (highest confidence)
    const barberMatch = await _matchBarberByNameHint(barberHint, outletId);
    if (barberMatch) {
      console.log(`[Enhanced Sync] ✓ Structured match: "${barberHint}" → ${barberMatch.name} (${barberMatch.id})`);
      return {
        barberId: barberMatch.id,
        confidence: 'structured',
        method: 'hint-match',
        parsedTime: _parseDateTime(dateStr, timeStr)
      };
    } else {
      console.warn(`[Enhanced Sync] ⚠️ Structured hint "${barberHint}" not found in outlet ${outletId}`);
    }
  }
  
  // Step 2: Try item-based resolution (Moka employee ID)
  const itemMatch = await _matchBarberByItemId(outletId);
  if (itemMatch) {
    console.log(`[Enhanced Sync] ✓ Item-based match: ${itemMatch.name} (${itemMatch.id})`);
    return {
      barberId: itemMatch.id,
      confidence: 'item-based',
      method: 'moka-employee-id'
    };
  }
  
  // Step 3: Fallback to fuzzy matching with strict thresholds
  const fuzzyMatch = await _matchBarberFuzzyStrict(billName, outletId);
  if (fuzzyMatch) {
    console.log(`[Enhanced Sync] ✓ Fuzzy match: "${fuzzyMatch.name}" (${fuzzyMatch.id}) - score: ${fuzzyMatch.score}`);
    return {
      barberId: fuzzyMatch.id,
      confidence: 'fuzzy',
      method: 'strict-fuzzy',
      score: fuzzyMatch.score
    };
  }
  
  console.log(`[Enhanced Sync] ❌ No barber match found for bill "${billName}"`);
  return null;
}

/**
 * Parse structured bill name: "CUSTOMER DD/MM HH.MM BARBER"
 * Returns null if format doesn't match structured pattern
 */
function _parseStructuredBillName(billName) {
  if (!billName) return null;
  
  // Pattern: CUSTOMER DD/MM HH.MM BARBER
  // Example: "yuki 19/05 14.00 opan"
  const structuredPattern = /^(\S+)\s+(\d{1,2}[\/\-\.]\d{1,2}(?:[\/\-\.]\d{2,4})?)\s+(\d{1,2}[.:]\d{2})\s+(.+)$/i;
  const match = billName.match(structuredPattern);
  
  if (!match) return null;
  
  const [, customerName, dateStr, timeStr, barberHint] = match;
  
  return {
    customerName: customerName.trim(),
    dateStr: dateStr.trim(),
    timeStr: timeStr.trim(),
    barberHint: barberHint.trim()
  };
}

/**
 * Match barber by exact name hint (structured format)
 * Only searches within the specified outlet to prevent cross-branch errors
 */
async function _matchBarberByNameHint(barberHint, outletId) {
  if (!barberHint || !outletId) return null;
  
  const { data: barbers, error } = await supabase
    .from('barbers')
    .select('id, name, is_active')
    .eq('outlet_id', outletId)
    .eq('is_active', true);
    
  if (error || !barbers?.length) return null;
  
  const hintLower = barberHint.toLowerCase().trim();
  
  // Exact match first
  let exactMatch = barbers.find(b => b.name.toLowerCase() === hintLower);
  if (exactMatch) return exactMatch;
  
  // Token-based matching (high confidence)
  for (const barber of barbers) {
    const barberLower = barber.name.toLowerCase();
    const barberTokens = barberLower.split(/\s+/).filter(t => t.length >= 2);
    
    // Check if hint contains any barber token (e.g., "opan" matches "Opan")
    const tokenHit = barberTokens.some(token => 
      hintLower.includes(token) || token.includes(hintLower)
    );
    
    if (tokenHit) {
      console.log(`[Enhanced Sync] Token match: "${barberHint}" → "${barber.name}" (token: ${barberTokens.find(t => hintLower.includes(t) || t.includes(hintLower))})`);
      return barber;
    }
  }
  
  return null;
}

/**
 * Match barber by Moka item ID (most reliable)
 */
async function _matchBarberByItemId(outletId) {
  // This would need access to Moka client and bill items
  // For now, return null to rely on name-based matching
  return null;
}

/**
 * Strict fuzzy matching with high thresholds to prevent false positives
 */
async function _matchBarberFuzzyStrict(billName, outletId) {
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
    
    // Skip very short names that could cause false matches
    if (barberLower.length < 3) continue;
    
    // Calculate similarity score
    let score = 0;
    
    // Exact substring match (high confidence)
    if (billLower.includes(barberLower) || barberLower.includes(billLower)) {
      score = 0.9;
    }
    // Token-based matching
    else {
      const barberTokens = barberLower.split(/\s+/).filter(t => t.length >= 3);
      const billTokens = billLower.split(/\s+/).filter(t => t.length >= 3);
      
      for (const barberToken of barberTokens) {
        for (const billToken of billTokens) {
          if (barberToken.includes(billToken) || billToken.includes(barberToken)) {
            score = Math.max(score, 0.7);
          }
        }
      }
    }
    
    // Apply strict threshold
    if (score > bestScore && score >= 0.7) {
      bestScore = score;
      bestMatch = { ...barber, score };
    }
  }
  
  return bestMatch;
}

/**
 * Parse date and time from structured format
 */
function _parseDateTime(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  
  try {
    const currentYear = new Date().getFullYear();
    
    // Parse date (handle DD/MM, DD-MM, DD.MM formats)
    const dateParts = dateStr.split(/[\/\-\.]/);
    if (dateParts.length < 2) return null;
    
    let day = parseInt(dateParts[0], 10);
    let month = parseInt(dateParts[1], 10);
    let year = dateParts[2] ? parseInt(dateParts[2], 10) : currentYear;
    
    // Handle 2-digit years
    if (year < 100) {
      year += year < 50 ? 2000 : 1900;
    }
    
    // Parse time (handle HH.MM or HH:MM formats)
    const timeParts = timeStr.split(/[.:]/);
    if (timeParts.length < 2) return null;
    
    const hours = parseInt(timeParts[0], 10);
    const minutes = parseInt(timeParts[1], 10);
    
    if (isNaN(day) || isNaN(month) || isNaN(year) || 
        isNaN(hours) || isNaN(minutes)) {
      return null;
    }
    
    // Create Date object in WIB timezone
    const date = new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00+07:00`);
    
    return date;
  } catch (error) {
    console.warn(`[Enhanced Sync] Date parsing error:`, error.message);
    return null;
  }
}

/**
 * Validate outlet assignment to prevent cross-branch errors
 */
async function validateOutletAssignment(barberId, expectedOutletId, billId) {
  if (!barberId || !expectedOutletId) return false;
  
  const { data: barber, error } = await supabase
    .from('barbers')
    .select('outlet_id, name')
    .eq('id', barberId)
    .single();
    
  if (error || !barber) {
    console.error(`[Enhanced Sync] ❌ Barber ${barberId} not found for validation`);
    return false;
  }
  
  const isValid = barber.outlet_id === expectedOutletId;
  
  if (!isValid) {
    console.error(`[Enhanced Sync] ❌ OUTLET MISMATCH for bill ${billId}:`);
    console.error(`    Expected outlet: ${expectedOutletId}`);
    console.error(`    Barber actual outlet: ${barber.outlet_id}`);
    console.error(`    Barber: ${barber.name} (${barberId})`);
    console.error(`    This could cause double booking!`);
  }
  
  return isValid;
}

module.exports = {
  resolveBarberWithValidation,
  validateOutletAssignment,
  _parseStructuredBillName,
  _parseDateTime
};
