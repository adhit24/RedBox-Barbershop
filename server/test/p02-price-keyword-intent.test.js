'use strict';

/**
 * P0.2 incident hotfix — fast keyword price-intent routing.
 *
 * Production symptom: "Halo, Redbox Tegal buka jam berapa?" (an operating-
 * hours question) was answered with the full price list, with production
 * telemetry showing used: 'keyword'.
 *
 * Confirmed root cause: api/wa/webhook.js's deterministic fast keyword
 * intercept (runs before the orchestrator/LLM) triggered the price-list
 * reply on the standalone word "berapa" — which also appears in "jam
 * berapa" (hours), "kapan/jam berapa masuk" (barber schedule), etc. Fix:
 * every price trigger now carries its own explicit price-context word/phrase
 * (harga, price, tarif, biaya, "bayar berapa", "kena berapa"); "berapa" is
 * never a standalone trigger.
 *
 * These tests call the REAL handleMessage from api/wa/webhook.js with no
 * mocked keyword-detection internals — the same fast-keyword code path
 * production traffic runs through — rather than testing the trigger regex
 * in isolation.
 *
 * Note (scope decision, confirmed with the requester): a separate,
 * pre-existing guard (isSpecificServiceInquiry) already skips the ENTIRE
 * price/service-catalog keyword block whenever a specific service name
 * (gentleman, grooming, junior, ...) is mentioned, regardless of this fix —
 * that guard predates and is unrelated to the confirmed 'berapa' root cause,
 * so it is intentionally left untouched here. Phrases naming a specific
 * service correctly bypass the fast keyword shortcut and reach the
 * orchestrator instead, exactly as they did before this fix; those cases are
 * asserted below as "does not receive the generic price-list keyword reply"
 * rather than "used === 'keyword'".
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { handleMessage } = require('../../api/wa/webhook');

let seq = 0;
function uniquePhone() {
  seq += 1;
  return `62811100${String(1000 + seq).padStart(6, '0')}`;
}

async function ask(text) {
  return handleMessage({ from: uniquePhone(), text });
}

// ── MUST classify as price (generic — no specific service named) ─────────

const MUST_BE_PRICE = [
  'biaya haircut berapa?',
  'berapa biaya haircut?',
  'tarif haircut',
  'harga berapa?',
  'berapa ya harganya?',
];

for (const text of MUST_BE_PRICE) {
  test(`P0.2: "${text}" hits the price keyword handler`, async () => {
    const res = await ask(text);
    assert.equal(res.used, 'keyword');
    assert.match(res.reply, /Berikut daftar harga layanan RedBox/);
  });
}

// ── MUST NOT classify as price (hours/schedule questions — the confirmed bug) ─

const MUST_NOT_BE_PRICE = [
  'Tegal buka jam berapa?',
  'Tegal tutup jam berapa?',
  'jam berapa buka?',
  'jam berapa tutup?',
  'booking jam berapa?',
  'kapster Opan masuk jam berapa?',
  'besok jam berapa?',
  'terakhir booking jam berapa?',
  'Bypass buka sampai jam berapa hari ini?',
  'CSB tutup jam berapa?',
];

for (const text of MUST_NOT_BE_PRICE) {
  test(`P0.2: "${text}" does NOT hit the price keyword handler (the confirmed production bug)`, async () => {
    const res = await ask(text);
    assert.notEqual(res.used, 'keyword');
    assert.doesNotMatch(res.reply || '', /Berikut daftar harga layanan RedBox/);
  });
}

// ── Named-service price phrases: pre-existing isSpecificServiceInquiry guard
// (untouched by this fix) routes these past the fast keyword shortcut, same
// as before — documented here so the interaction is explicit, not silently
// untested. ─────────────────────────────────────────────────────────────

const NAMED_SERVICE_PRICE_PHRASES = [
  'Gentleman Grooming berapa harganya?',
  'harga gentleman berapa?',
  'berapa harga gentleman?',
  'bayar berapa untuk gentleman?',
  'kena berapa untuk grooming?',
  'price gentleman',
];

for (const text of NAMED_SERVICE_PRICE_PHRASES) {
  test(`P0.2: "${text}" bypasses the generic price keyword shortcut (named-service guard, pre-existing/unrelated to this fix)`, async () => {
    const res = await ask(text);
    assert.notEqual(res.used, 'keyword');
    assert.doesNotMatch(res.reply || '', /Berikut daftar harga layanan RedBox/);
  });
}

// ── The literal production failure example from the incident report ──────

test('P0.2: the literal reported production failure — "Halo, Redbox Tegal buka jam berapa?" is not answered with the price list', async () => {
  const res = await ask('Halo, Redbox Tegal buka jam berapa?');
  assert.notEqual(res.used, 'keyword');
  assert.doesNotMatch(res.reply || '', /Berikut daftar harga layanan RedBox/);
});
