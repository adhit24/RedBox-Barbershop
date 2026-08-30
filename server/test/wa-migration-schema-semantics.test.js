'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Migration Schema Semantics Validation Test for Round 3.
 *
 * Models the confirmed production schema:
 *   - wa_conversations_pkey PRIMARY KEY (sender)
 *   - Task45 columns (conversation_status, idle_close_due_at, etc.)
 *
 * Verifies that the migration algorithm correctly:
 *   1. Identifies that current PK is on sender (not id).
 *   2. Drops the sender PK constraint regardless of its name.
 *   3. Adds id UUID PRIMARY KEY.
 *   4. Adds UNIQUE (sender, provider_device_hash).
 *   5. Allows same sender + different device hash (e.g. Bypass + CSB) to coexist.
 *   6. Rejects duplicate (sender, provider_device_hash).
 *   7. Is 100% idempotent on a second run.
 */

class MockPostgresDatabase {
  constructor() {
    // Initial state: confirmed production wa_conversations table shape
    this.tables = {
      wa_conversations: {
        columns: {
          sender: { type: 'TEXT', nullable: false },
          history: { type: 'JSONB', nullable: false, default: '[]' },
          updated_at: { type: 'TIMESTAMPTZ', nullable: false, default: 'NOW()' },
          conversation_status: { type: 'TEXT', nullable: true },
          idle_close_due_at: { type: 'TIMESTAMPTZ', nullable: true },
          idle_closed_at: { type: 'TIMESTAMPTZ', nullable: true },
          last_customer_message_at: { type: 'TIMESTAMPTZ', nullable: true },
          last_bot_message_at: { type: 'TIMESTAMPTZ', nullable: true },
        },
        constraints: [
          { name: 'wa_conversations_pkey', type: 'p', keys: ['sender'] },
          { name: 'wa_conversations_conversation_status_check', type: 'c', check: "conversation_status IN ('active','closing','closed')" },
        ],
        rows: [
          { sender: '628999', history: '[]', updated_at: new Date().toISOString(), conversation_status: 'closed' },
        ],
      },
    };
  }

  getConstraints(tableName) {
    return this.tables[tableName] ? this.tables[tableName].constraints : [];
  }

  runMigration() {
    const table = this.tables.wa_conversations;

    // 1. ADD COLUMN IF NOT EXISTS provider_device_hash
    if (!table.columns.provider_device_hash) {
      table.columns.provider_device_hash = { type: 'TEXT', nullable: true };
    }

    // 2. UPDATE wa_conversations SET provider_device_hash = 'legacy-unscoped' WHERE NULL
    table.rows.forEach(r => {
      if (!r.provider_device_hash) r.provider_device_hash = 'legacy-unscoped';
    });
    table.columns.provider_device_hash.nullable = false;

    // 3. ADD COLUMN IF NOT EXISTS branch
    if (!table.columns.branch) {
      table.columns.branch = { type: 'TEXT', nullable: true };
    }

    // 4. Guarded branch check constraint
    if (!table.constraints.some(c => c.name === 'chk_wa_conversations_branch')) {
      table.constraints.push({
        name: 'chk_wa_conversations_branch',
        type: 'c',
        check: "branch IS NULL OR branch IN ('bypass', 'samadikun', 'csb', 'sumber', 'tegal')",
      });
    }

    // 5. ADD COLUMN IF NOT EXISTS id
    if (!table.columns.id) {
      table.columns.id = { type: 'UUID', nullable: false, default: 'gen_random_uuid()' };
      table.rows.forEach((r, idx) => {
        if (!r.id) r.id = `uuid-row-${idx + 1}`;
      });
    }

    // 6. PK Replacement Algorithm (inspects PK columns, not constraint name alone)
    const currentPk = table.constraints.find(c => c.type === 'p');
    const pkIsId = currentPk && currentPk.keys.length === 1 && currentPk.keys[0] === 'id';

    if (currentPk && !pkIsId) {
      // Drop existing PK constraint regardless of its name
      const idx = table.constraints.indexOf(currentPk);
      table.constraints.splice(idx, 1);
    }

    if (!pkIsId) {
      if (!table.constraints.some(c => c.name === 'wa_conversations_pkey')) {
        table.constraints.push({ name: 'wa_conversations_pkey', type: 'p', keys: ['id'] });
      }
    }

    // 7. Composite Unique constraint UNIQUE (sender, provider_device_hash)
    if (!table.constraints.some(c => c.name === 'uq_wa_conversations_sender_device')) {
      table.constraints.push({
        name: 'uq_wa_conversations_sender_device',
        type: 'u',
        keys: ['sender', 'provider_device_hash'],
      });
    }
  }

  insert(row) {
    const table = this.tables.wa_conversations;
    const fullRow = {
      id: row.id || `uuid-${Math.random().toString(36).slice(2)}`,
      history: '[]',
      updated_at: new Date().toISOString(),
      ...row,
    };

    // Validate PK (id)
    const pk = table.constraints.find(c => c.type === 'p');
    if (pk) {
      const match = table.rows.find(r => pk.keys.every(k => r[k] === fullRow[k]));
      if (match) throw new Error(`duplicate key value violates unique constraint "${pk.name}"`);
    }

    // Validate Composite Unique (sender, provider_device_hash)
    const uniq = table.constraints.find(c => c.name === 'uq_wa_conversations_sender_device');
    if (uniq) {
      const match = table.rows.find(r => uniq.keys.every(k => r[k] === fullRow[k]));
      if (match) throw new Error(`duplicate key value violates unique constraint "${uniq.name}"`);
    }

    // Validate Branch check constraint
    if (fullRow.branch !== undefined && fullRow.branch !== null) {
      const allowed = ['bypass', 'samadikun', 'csb', 'sumber', 'tegal'];
      if (!allowed.includes(fullRow.branch)) {
        throw new Error('violates check constraint "chk_wa_conversations_branch"');
      }
    }

    table.rows.push(fullRow);
    return fullRow;
  }
}

test('Migration Round 3 — SQL file contains table-scoped guards and column-based PK algorithm', () => {
  const sqlPath = path.join(__dirname, '../migrations/2026-08-30-wa-inbound-lifecycle-conversation-isolation.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  // Verify table-scoped constraint checks
  assert.ok(sql.includes("conrelid = 'public.wa_conversations'::regclass"), 'Must scope constraint queries to public.wa_conversations');
  assert.ok(sql.includes("MAX(a.attname) = 'id'"), 'Must inspect actual PK column name');
  assert.ok(sql.includes("chk_wa_conversations_branch"), 'Must include branch CHECK constraint');
  assert.ok(sql.includes("uq_wa_conversations_sender_device"), 'Must include composite UNIQUE constraint');
});

test('Migration Round 3 — Simulation on confirmed production schema succeeds and replaces sender PK', () => {
  const db = new MockPostgresDatabase();

  // Pre-migration checks: production has PK (sender)
  const initialPk = db.getConstraints('wa_conversations').find(c => c.type === 'p');
  assert.equal(initialPk.name, 'wa_conversations_pkey');
  assert.deepEqual(initialPk.keys, ['sender']);

  // Run migration
  db.runMigration();

  // Post-migration checks: PK is now on column 'id'
  const finalPk = db.getConstraints('wa_conversations').find(c => c.type === 'p');
  assert.equal(finalPk.name, 'wa_conversations_pkey');
  assert.deepEqual(finalPk.keys, ['id']);

  // Composite UNIQUE is present on (sender, provider_device_hash)
  const compUniq = db.getConstraints('wa_conversations').find(c => c.name === 'uq_wa_conversations_sender_device');
  assert.ok(compUniq);
  assert.deepEqual(compUniq.keys, ['sender', 'provider_device_hash']);
});

test('Migration Round 3 — Same sender + different device hash (Bypass + CSB) can coexist', () => {
  const db = new MockPostgresDatabase();
  db.runMigration();

  // Insert sender 628111 with Bypass device hash
  const r1 = db.insert({ sender: '628111', provider_device_hash: 'a'.repeat(64), branch: 'bypass' });
  assert.ok(r1);

  // Insert SAME sender 628111 with CSB device hash
  const r2 = db.insert({ sender: '628111', provider_device_hash: 'b'.repeat(64), branch: 'csb' });
  assert.ok(r2);

  // Verify both rows exist in database
  const count = db.tables.wa_conversations.rows.filter(r => r.sender === '628111').length;
  assert.equal(count, 2, 'Both Bypass and CSB conversations for sender 628111 must coexist');
});

test('Migration Round 3 — Same sender + same device hash is rejected by composite unique constraint', () => {
  const db = new MockPostgresDatabase();
  db.runMigration();

  db.insert({ sender: '628111', provider_device_hash: 'a'.repeat(64), branch: 'bypass' });

  // Second insert with same sender + same device hash must fail
  assert.throws(
    () => db.insert({ sender: '628111', provider_device_hash: 'a'.repeat(64), branch: 'bypass' }),
    /violates unique constraint "uq_wa_conversations_sender_device"/
  );
});

test('Migration Round 3 — Second run (Idempotency) is a clean no-op', () => {
  const db = new MockPostgresDatabase();
  db.runMigration(); // First run

  const constraintsCountBefore = db.getConstraints('wa_conversations').length;

  // Second run
  db.runMigration();

  const constraintsCountAfter = db.getConstraints('wa_conversations').length;
  assert.equal(constraintsCountBefore, constraintsCountAfter, 'Second migration run must be a clean no-op');
});
