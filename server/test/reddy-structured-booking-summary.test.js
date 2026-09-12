'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyDeterministically,
  isStructuredBookingSummary,
} = require('../orchestrator/routingPolicy');
const {
  resolveResponseLanguage,
  hasIndonesianLanguageSignal,
} = require('../agents/reddy/languageResolution');
const { resolveKnowledgeContext } = require('../agents/reddy/knowledge/knowledgeResolver');

const INDONESIAN_SUMMARY = `Ringkasan booking\nNama: Budi\nLayanan: Gentleman Grooming\nHarga: Rp95.000\nDurasi: 60 menit\nKapster: Abdul\nTanggal: 13 September 2026\nJam: 14:00\nCabang: Bypass`;

test('structured booking summary is detected deterministically', () => {
  assert.equal(isStructuredBookingSummary(INDONESIAN_SUMMARY), true);
});

test('structured booking summary routes to trusted booking-status verification, not barber inquiry', () => {
  assert.deepEqual(classifyDeterministically(INDONESIAN_SUMMARY), {
    intent: 'booking_status',
    confidence: 1,
    reason: 'structured_booking_summary',
  });
});

test('Indonesian structured booking labels outrank English-ish service/barber vocabulary', () => {
  assert.equal(hasIndonesianLanguageSignal(INDONESIAN_SUMMARY), true);
  assert.equal(resolveResponseLanguage(INDONESIAN_SUMMARY, { turns: [] }), 'indonesian');
});

test('structured booking summary validates reported price and duration against active catalog', () => {
  const context = resolveKnowledgeContext({
    intent: 'booking_status',
    text: INDONESIAN_SUMMARY,
    branch: 'bypass',
  });
  const validation = context.facts.find((fact) => fact.category === 'booking_summary_validation');

  assert.ok(validation, 'booking summary validation fact should be present');
  assert.equal(validation.status, 'conflict');
  assert.deepEqual(validation.conflicts.sort(), ['duration', 'price']);
  assert.equal(validation.reported_price_idr, 95000);
  assert.equal(validation.reported_duration_minutes, 60);
  assert.equal(validation.verified_price_idr, 120000);
  assert.equal(validation.verified_duration_minutes, 75);
});

test('ordinary barber question is not mistaken for a structured booking summary', () => {
  const message = 'Kapster Bypass siapa aja?';
  assert.equal(isStructuredBookingSummary(message), false);
});

test('fully English structured summary can still resolve to English', () => {
  const englishSummary = `Booking summary\nName: John\nService: Gentleman Grooming\nPrice: Rp120.000\nDuration: 75 minutes\nBarber: Abdul\nDate: September 13, 2026\nTime: 14:00\nBranch: Bypass`;
  assert.equal(isStructuredBookingSummary(englishSummary), true);
  assert.equal(resolveResponseLanguage(englishSummary, { turns: [] }), 'english');
});
