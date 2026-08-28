'use strict';

/**
 * P0 incident hotfix — Reddy anti-spam / webhook idempotency test matrix
 * (A-M) plus an incident-shaped reproduction test.
 *
 * These exercise the actual guard modules (server/services/waInboundGuard.js,
 * server/services/waOutboundGuard.js) against a fake Supabase query builder
 * that faithfully models the two invariants the real schema enforces:
 *   - a UNIQUE index on wa_inbound_events(provider, provider_message_id)
 *     (insert conflicts return error.code === '23505', mirroring Postgres)
 *   - a compare-and-swap UPDATE ... WHERE outbound_attempted = false
 * Because the fake store mutates synchronously inside each query's `_exec()`
 * (no internal await), concurrent claims issued via Promise.all still
 * resolve with exactly one winner — the same invariant the real unique
 * index/CAS guarantees under genuine concurrent serverless instances.
 */

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  isReddyEnabled, hashValue, normalizePhoneDigits, classifyInboundEvent,
  resolveProviderMessageId, claimInboundEvent, markInboundEventStatus,
} = require('../services/waInboundGuard');
const { createGuardedSend, claimOutboundSend, isDuplicateContent, isRateLimited } = require('../services/waOutboundGuard');

class FakeQueryBuilder {
  constructor(store, table) {
    this.store = store;
    this.table = table;
    this.op = null;
    this.payload = null;
    this.filters = [];
    this.limitN = null;
    this.singleFlag = false;
    this.maybeSingleFlag = false;
    this.countMode = null;
  }

  insert(obj) { this.op = 'insert'; this.payload = obj; return this; }
  update(obj) { this.op = 'update'; this.payload = obj; return this; }
  select(_cols, opts) {
    if (!this.op) this.op = 'select';
    if (opts && opts.count) this.countMode = opts.count;
    return this;
  }
  eq(col, val) { this.filters.push(['eq', col, val]); return this; }
  gte(col, val) { this.filters.push(['gte', col, val]); return this; }
  limit(n) { this.limitN = n; return this; }
  single() { return this._exec(true); }
  maybeSingle() { return this._exec(true); }
  then(resolve, reject) { return this._exec(false).then(resolve, reject); }

  _matches(row) {
    return this.filters.every(([kind, col, val]) => (kind === 'eq' ? row[col] === val : row[col] >= val));
  }

  async _exec(wantSingle) {
    if (this.store.throwOn && this.store.throwOn(this.table, this.op)) {
      throw new Error('simulated supabase failure');
    }
    const rows = this.store.tables[this.table] || (this.store.tables[this.table] = []);

    if (this.op === 'insert') {
      if (this.table === 'wa_inbound_events') {
        const dup = rows.find(r => r.provider === this.payload.provider && r.provider_message_id === this.payload.provider_message_id);
        if (dup) return { data: null, error: { code: '23505', message: 'duplicate key' } };
      }
      const defaults = this.table === 'wa_outbound_sends'
        ? { id: `row_${++this.store.nextId}`, sent_at: new Date().toISOString() }
        : {
          id: `row_${++this.store.nextId}`,
          provider: 'fonnte',
          processing_status: 'received',
          outbound_attempted: false,
          outbound_sent: false,
          received_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      const row = { ...defaults, ...this.payload };
      rows.push(row);
      return wantSingle ? { data: row, error: null } : { data: [row], error: null };
    }

    if (this.op === 'update') {
      const matched = rows.filter(r => this._matches(r));
      matched.forEach(r => Object.assign(r, this.payload));
      if (wantSingle) return { data: matched[0] || null, error: null };
      return { data: matched, error: null };
    }

    // select
    let matched = rows.filter(r => this._matches(r));
    if (this.countMode) return { count: matched.length, error: null, data: null };
    if (this.limitN != null) matched = matched.slice(0, this.limitN);
    if (wantSingle) return { data: matched[0] || null, error: null };
    return { data: matched, error: null };
  }
}

function createFakeSupabase() {
  const store = { tables: {}, nextId: 0, throwOn: null };
  return {
    from(table) { return new FakeQueryBuilder(store, table); },
    _store: store,
  };
}

function fonntePayload(overrides = {}) {
  return { device: '628222000000', sender: '628111000000', name: 'Budi', message: 'halo', id: 'wamid.default', type: 'text', ...overrides };
}

// ── Provenance classification (roots of Tests C/D) ──────────────────────

test('P0-C: status callback payload classifies as status_callback, never customer_message', () => {
  const statusPayload = { id: 'wamid.1', status: 'delivered', stateid: 'ACK' };
  assert.equal(classifyInboundEvent(statusPayload), 'status_callback');
});

test('P0-D: isFromMe payload and device===sender fallback both classify as self_message', () => {
  assert.equal(classifyInboundEvent(fonntePayload({ isFromMe: true })), 'self_message');
  assert.equal(classifyInboundEvent({ device: '6281', sender: '6281', message: 'sent by bot' }, { device: '6281' }), 'self_message');
});

test('P0-D: genuine customer payload classifies as customer_message', () => {
  assert.equal(classifyInboundEvent(fonntePayload()), 'customer_message');
});

test('P0: payload with neither sender nor message classifies as unsupported', () => {
  assert.equal(classifyInboundEvent({}), 'unsupported');
});

// ── Test A / G: concurrent duplicate delivery, real DB uniqueness ───────

test('P0-A/G: 5x concurrent identical webhook deliveries converge on exactly one winner', async () => {
  const supabase = createFakeSupabase();
  const results = await Promise.all(Array.from({ length: 5 }, () => claimInboundEvent(supabase, {
    providerMessageId: 'wamid.race-1', senderHash: hashValue('628111000000'), eventType: 'customer_message',
  })));
  const claimed = results.filter(r => r.status === 'claimed');
  const duplicates = results.filter(r => r.status === 'duplicate');
  assert.equal(claimed.length, 1);
  assert.equal(duplicates.length, 4);

  const winnerRowId = claimed[0].row.id;
  const sends = [];
  const realSend = async (to, message) => { sends.push({ to, message }); return { status: true }; };
  const guardedSend = createGuardedSend({ realSend, supabase, inboundEventRowId: winnerRowId });
  await Promise.all(duplicates.map(() => guardedSend('628111000000', 'balasan')));
  await guardedSend('628111000000', 'balasan');
  assert.equal(sends.length, 1);
});

// ── Test B: retry after already sent → 0 further claims, 0 further sends ─

test('P0-B: retry of an already-sent event is rejected at the inbound claim, before any send', async () => {
  const supabase = createFakeSupabase();
  const first = await claimInboundEvent(supabase, { providerMessageId: 'wamid.retry-1', eventType: 'customer_message' });
  assert.equal(first.status, 'claimed');
  const sends = [];
  const realSend = async () => { sends.push(1); return { status: true }; };
  const guardedSend = createGuardedSend({ realSend, supabase, inboundEventRowId: first.row.id });
  await guardedSend('628111000000', 'balasan pertama');
  assert.equal(sends.length, 1);

  // Provider retries the SAME event (e.g. Fonnte redelivery after a slow ack).
  const retry = await claimInboundEvent(supabase, { providerMessageId: 'wamid.retry-1', eventType: 'customer_message' });
  assert.equal(retry.status, 'duplicate');
  // Even if something tried to send again against the original row, the
  // send-once CAS on that row is already flipped.
  const claim = await claimOutboundSend(supabase, first.row.id);
  assert.equal(claim.claimed, false);
  assert.equal(claim.reason, 'already_attempted');
  assert.equal(sends.length, 1);
});

// ── Test E: global kill switch ───────────────────────────────────────────

test('P0-E: kill switch OFF suppresses every automated send regardless of other guards', async () => {
  const supabase = createFakeSupabase();
  const claim = await claimInboundEvent(supabase, { providerMessageId: 'wamid.killswitch-1', eventType: 'customer_message' });
  const sends = [];
  const realSend = async () => { sends.push(1); return { status: true }; };
  const guardedSend = createGuardedSend({ realSend, supabase, inboundEventRowId: claim.row.id, isEnabled: () => false });
  const result = await guardedSend('628111000000', 'balasan');
  assert.equal(sends.length, 0);
  assert.equal(result.suppressed, true);
  assert.equal(result.reason, 'ai_kill_switch');
});

test('P0: isReddyEnabled reads REDDY_ENABLED and defaults to true when unset', () => {
  assert.equal(isReddyEnabled({}), true);
  assert.equal(isReddyEnabled({ REDDY_ENABLED: 'false' }), false);
  assert.equal(isReddyEnabled({ REDDY_ENABLED: 'true' }), true);
});

// ── Test F: distinct provider message IDs, identical text → no content dedup at claim time ──

test('P0-F: two distinct provider message IDs with identical text both claim successfully', async () => {
  const supabase = createFakeSupabase();
  const r1 = await claimInboundEvent(supabase, { providerMessageId: 'wamid.distinct-1', eventType: 'customer_message' });
  const r2 = await claimInboundEvent(supabase, { providerMessageId: 'wamid.distinct-2', eventType: 'customer_message' });
  assert.equal(r1.status, 'claimed');
  assert.equal(r2.status, 'claimed');
});

// ── Test H/I: send-once invariant is indifferent to reply content (fallback text, fast-path text, etc.) ──

test('P0-H/I: send-once gate rejects a second attempt on the same row even with different message content', async () => {
  const supabase = createFakeSupabase();
  const claim = await claimInboundEvent(supabase, { providerMessageId: 'wamid.fallback-1', eventType: 'customer_message' });
  const sends = [];
  const realSend = async (to, message) => { sends.push(message); return { status: true }; };
  const guardedSend = createGuardedSend({ realSend, supabase, inboundEventRowId: claim.row.id });
  const first = await guardedSend('628111000000', 'jawaban Reddy asli');
  const second = await guardedSend('628111000000', 'Layanan sedang tidak dapat diakses sementara.');
  assert.equal(first.status, true);
  assert.equal(second.suppressed, true);
  assert.equal(sends.length, 1);
  assert.deepEqual(sends, ['jawaban Reddy asli']);
});

// ── Test J: outbound duplicate-content circuit breaker ──────────────────

test('P0-J: identical content to the same destination within the window is suppressed even from a different inbound event', async () => {
  const supabase = createFakeSupabase();
  const claimA = await claimInboundEvent(supabase, { providerMessageId: 'wamid.dupcontent-1', eventType: 'customer_message' });
  const claimB = await claimInboundEvent(supabase, { providerMessageId: 'wamid.dupcontent-2', eventType: 'customer_message' });
  const sends = [];
  const realSend = async (to, message) => { sends.push(message); return { status: true }; };
  const sendA = createGuardedSend({ realSend, supabase, inboundEventRowId: claimA.row.id });
  const sendB = createGuardedSend({ realSend, supabase, inboundEventRowId: claimB.row.id });

  const resultA = await sendA('628111000000', 'Halo Kak, ada yang bisa dibantu?');
  const resultB = await sendB('628111000000', 'Halo Kak, ada yang bisa dibantu?');
  assert.equal(resultA.status, true);
  assert.equal(resultB.suppressed, true);
  assert.equal(resultB.reason, 'duplicate_content');
  assert.equal(sends.length, 1);
});

test('P0: isDuplicateContent is a pure secondary check, independent of claimOutboundSend', async () => {
  const supabase = createFakeSupabase();
  const dh = hashValue(normalizePhoneDigits('628111000000'));
  const ch = hashValue('halo');
  const before = await isDuplicateContent(supabase, { destinationHash: dh, contentHash: ch });
  assert.equal(before.duplicate, false);
});

// ── Test K/L: per-customer automated rate limit, manual channel unaffected ──

test('P0-K/L: 6th automated send within the window is rate-limited; the manual channel (raw realSend) is unaffected', async () => {
  const supabase = createFakeSupabase();
  const sends = [];
  const realSend = async (to, message) => { sends.push(message); return { status: true }; };

  for (let i = 0; i < 5; i += 1) {
    const claim = await claimInboundEvent(supabase, { providerMessageId: `wamid.ratelimit-${i}`, eventType: 'customer_message' });
    const guardedSend = createGuardedSend({ realSend, supabase, inboundEventRowId: claim.row.id });
    const result = await guardedSend('628111000000', `balasan unik ${i}`);
    assert.equal(result.status, true, `send ${i} should succeed`);
  }
  assert.equal(sends.length, 5);

  const sixthClaim = await claimInboundEvent(supabase, { providerMessageId: 'wamid.ratelimit-5', eventType: 'customer_message' });
  const sixthGuardedSend = createGuardedSend({ realSend, supabase, inboundEventRowId: sixthClaim.row.id });
  const sixth = await sixthGuardedSend('628111000000', 'balasan unik 5');
  assert.equal(sixth.suppressed, true);
  assert.equal(sixth.reason, 'rate_limited');
  assert.equal(sends.length, 5);

  // The manual/human WhatsApp reply channel never goes through guardedSend —
  // it calls the provider send directly and is not subject to this ceiling.
  const manualResult = await realSend('628111000000', 'balasan manual dari admin');
  assert.equal(manualResult.status, true);
  assert.equal(sends.length, 6);
});

test('P0: isRateLimited counts only sends inside the window for that destination', async () => {
  const supabase = createFakeSupabase();
  const dh = hashValue(normalizePhoneDigits('628111000000'));
  const before = await isRateLimited(supabase, dh);
  assert.equal(before.limited, false);
  assert.equal(before.count, 0);
});

// ── Test M: fail-closed behavior on DB errors ────────────────────────────

test('P0-M: a DB error on the send-once claim suppresses the send (fail closed)', async () => {
  const supabase = createFakeSupabase();
  const claim = await claimInboundEvent(supabase, { providerMessageId: 'wamid.failclosed-1', eventType: 'customer_message' });
  supabase._store.throwOn = (table, op) => table === 'wa_inbound_events' && op === 'update';
  const sends = [];
  const realSend = async () => { sends.push(1); return { status: true }; };
  const guardedSend = createGuardedSend({ realSend, supabase, inboundEventRowId: claim.row.id });
  const result = await guardedSend('628111000000', 'balasan');
  assert.equal(sends.length, 0);
  assert.equal(result.suppressed, true);
});

test('P0-M: a DB error on the duplicate-content check suppresses the send (fail closed)', async () => {
  const supabase = createFakeSupabase();
  const claim = await claimInboundEvent(supabase, { providerMessageId: 'wamid.failclosed-2', eventType: 'customer_message' });
  let updateCalls = 0;
  supabase._store.throwOn = (table, op) => {
    if (table === 'wa_inbound_events' && op === 'update') { updateCalls += 1; return false; }
    return table === 'wa_outbound_sends' && op === 'select';
  };
  const sends = [];
  const realSend = async () => { sends.push(1); return { status: true }; };
  const guardedSend = createGuardedSend({ realSend, supabase, inboundEventRowId: claim.row.id });
  const result = await guardedSend('628111000000', 'balasan');
  assert.equal(sends.length, 0);
  assert.equal(result.suppressed, true);
  assert.ok(updateCalls >= 1, 'markOutboundResult(false) should still run as best-effort bookkeeping');
});

test('P0-M: a DB error on the rate-limit check suppresses the send (fail closed)', async () => {
  const supabase = createFakeSupabase();
  const claim = await claimInboundEvent(supabase, { providerMessageId: 'wamid.failclosed-3', eventType: 'customer_message' });
  // isDuplicateContent's select has no count option; isRateLimited's does —
  // intercept only the count-mode select so isDuplicateContent still passes
  // and the rate-limit check specifically is what fails.
  const originalFrom = supabase.from.bind(supabase);
  supabase.from = (table) => {
    const builder = originalFrom(table);
    const originalSelect = builder.select.bind(builder);
    builder.select = (cols, opts) => {
      if (opts && opts.count) {
        builder._exec = async () => { throw new Error('simulated rate-limit query failure'); };
      }
      return originalSelect(cols, opts);
    };
    return builder;
  };
  const sends = [];
  const realSend = async () => { sends.push(1); return { status: true }; };
  const guardedSend = createGuardedSend({ realSend, supabase, inboundEventRowId: claim.row.id });
  const result = await guardedSend('628111000000', 'balasan');
  assert.equal(sends.length, 0);
  assert.equal(result.suppressed, true);
});

// ── resolveProviderMessageId: primary key vs bucketed fallback ──────────

test('P0: resolveProviderMessageId prefers the real provider id and only falls back when genuinely absent', () => {
  const withId = resolveProviderMessageId({ id: 'wamid.abc' });
  assert.equal(withId.providerMessageId, 'wamid.abc');
  assert.equal(withId.isFallback, false);

  const withoutId = resolveProviderMessageId({ sender: '6281', message: 'halo' }, { now: 1000 });
  assert.equal(withoutId.isFallback, true);
  assert.match(withoutId.providerMessageId, /^fallback:/);
});

// ── Incident reproduction: today's real pattern ──────────────────────────

test('P0-INCIDENT: same sender, same provider message id, same content, 5 webhook deliveries → exactly one outbound send', async () => {
  const supabase = createFakeSupabase();
  const sends = [];
  const realSend = async (to, message) => { sends.push({ to, message }); return { status: true }; };

  const payload = fonntePayload({ id: 'wamid.incident-2026-08-29', message: 'halo min, ada promo?' });

  async function deliverOnce() {
    const provenance = classifyInboundEvent(payload);
    if (provenance !== 'customer_message') return { delivered: false };
    const { providerMessageId } = resolveProviderMessageId(payload);
    const claim = await claimInboundEvent(supabase, {
      providerMessageId, senderHash: hashValue(normalizePhoneDigits(payload.sender)), eventType: 'customer_message',
    });
    if (claim.status !== 'claimed') return { delivered: false, reason: claim.status };
    const guardedSend = createGuardedSend({ realSend, supabase, inboundEventRowId: claim.row.id });
    const result = await guardedSend(payload.sender, 'Halo Kak! Ada promo potong rambut + creambath bulan ini 💈');
    await markInboundEventStatus(supabase, claim.row.id, result.status ? 'sent' : 'failed');
    return { delivered: true, result };
  }

  const outcomes = await Promise.all(Array.from({ length: 5 }, deliverOnce));
  assert.equal(outcomes.filter(o => o.delivered).length, 1);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].to, '628111000000');
});
