'use strict';

/**
 * Facility/operational message boundary (Round 3, Objective B).
 *
 * Fragments describing branch facility/maintenance state (a broken lamp, an
 * AC that's out, a leaking toilet) must never be misrouted into membership
 * clarification, booking intent, or a CRM private-data lookup. This module
 * is deliberately keyword-*intersection* based (a facility noun AND a
 * damage/maintenance signal), not single-keyword, so it does not fire on
 * incidental overlaps like "lampu hijau booking", "AC Milan", or
 * "membership saya mati?" (no facility noun there) — see the false-positive
 * guard tests in server/test/reddy-audit-round3-*.test.js.
 *
 * Seat-position identity ("kursi kapster nomor 2 itu siapa?") is handled
 * upstream by barberPresenceIntent.classifyBarberPositionIntent, which the
 * webhook consults before this module, so it never reaches here.
 */

const FACILITY_NOUN = /\b(lampu|ac|listrik|toilet|wc|kursi|kipas|atap|pintu|kaca)(nya)?\b/i;
const FACILITY_SIGNAL = /\b(rusak|mati|bocor|mogok|error|ngadat|perbaikan|diperbaiki|maintenance|teknisi|panas|dingin|diservice|di\s*service|diservis)\b/i;

// Explicit complaint/request markers — distinguishes "this is happening"
// (informational) from "please act on this" (complaint/request). Only the
// latter may become a human handoff (spec §B).
const COMPLAINT_SIGNAL = /\b(tolong|mohon|please|banget|parah|segera|secepatnya)\b/i;

function classifyFacilityIntent(message) {
  const text = String(message || '');
  const hasBulletMarker = /^\s*☝️/.test(text);
  if (!FACILITY_NOUN.test(text) || !FACILITY_SIGNAL.test(text)) {
    return { matched: false, kind: null };
  }
  const isComplaint = COMPLAINT_SIGNAL.test(text) && !hasBulletMarker;
  return {
    matched: true,
    kind: isComplaint ? 'complaint' : 'informational',
  };
}

module.exports = { classifyFacilityIntent };
