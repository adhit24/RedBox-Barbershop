'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { REDBOX_SERVICES, REDBOX_ADDONS } = require('../../public/js/services-data');
const {
  REDBOX_KNOWLEDGE,
  KNOWLEDGE_VERSION,
  BRANCH_IDS,
  SERVICE_IDS,
} = require('../agents/reddy/knowledge/redboxKnowledge');
const { validateKnowledge } = require('../agents/reddy/knowledge/validateKnowledge');

function cloneKnowledge() {
  return structuredClone(REDBOX_KNOWLEDGE);
}

function validationError(mutator, pattern) {
  const knowledge = cloneKnowledge();
  mutator(knowledge);
  assert.throws(() => validateKnowledge(knowledge), pattern);
}

test('exports the browser booking catalog to CommonJS without changing its public data', () => {
  assert.ok(Array.isArray(REDBOX_SERVICES));
  assert.ok(REDBOX_SERVICES.length > 0);
  assert.ok(REDBOX_ADDONS['gentleman-grooming']);
});

test('publishes the exact Redbox knowledge version and audited IDs', () => {
  assert.equal(KNOWLEDGE_VERSION, 'reddy_knowledge.v0.1');
  assert.equal(REDBOX_KNOWLEDGE.version, KNOWLEDGE_VERSION);
  assert.deepEqual(BRANCH_IDS, ['bypass', 'samadikun', 'csb', 'sumber', 'tegal']);
  assert.deepEqual(SERVICE_IDS, REDBOX_SERVICES.map(service => service.id));
});

test('composes every knowledge service price from the booking-facing catalog', () => {
  assert.equal(REDBOX_KNOWLEDGE.services.length, REDBOX_SERVICES.length);
  for (const catalogService of REDBOX_SERVICES) {
    const service = REDBOX_KNOWLEDGE.services.find(item => item.id === catalogService.id);
    assert.ok(service, `missing ${catalogService.id}`);
    assert.equal(service.name, catalogService.name);
    assert.equal(service.description, catalogService.desc);
    assert.equal(service.duration_minutes, Number.parseInt(catalogService.duration, 10));
    assert.deepEqual(service.prices, {
      standard: catalogService.price,
      csb: catalogService.csbPrice,
    });
  }
});

test('accepts the canonical public knowledge contract', () => {
  assert.equal(validateKnowledge(REDBOX_KNOWLEDGE), REDBOX_KNOWLEDGE);
  assert.deepEqual(REDBOX_KNOWLEDGE.promotions, []);
});

test('publishes implemented home-service and server-enforced wedding capabilities', () => {
  const homeService = REDBOX_KNOWLEDGE.capabilities.find(item => item.id === 'home-service');
  assert.deepEqual(homeService.booking_url, 'booking.html?type=homeservice');
  assert.deepEqual(homeService.hours, { opens: '06:00', closes: '23:00', timezone: 'Asia/Jakarta' });

  const wedding = REDBOX_KNOWLEDGE.capabilities.find(item => item.id === 'wedding-grooming');
  assert.deepEqual(wedding.packages, [
    { id: 'wedding-gentleman', price_idr: 350000 },
    { id: 'wedding-silver', price_idr: 500000 },
    { id: 'wedding-gold', price_idr: 750000 },
    { id: 'wedding-platinum', price_idr: 1000000 },
  ]);
});

test('rejects a wrong knowledge version', () => {
  validationError(knowledge => { knowledge.version = 'reddy_knowledge.v9'; }, /version/i);
});

test('rejects duplicate normalized branch aliases', () => {
  validationError(knowledge => { knowledge.branches[1].aliases.push(' Redbox   Bypass '); }, /branch alias/i);
});

test('rejects duplicate normalized service aliases', () => {
  validationError(knowledge => { knowledge.services[1].aliases.push('  GENTLEMAN\tGROOMING '); }, /service alias/i);
});

test('rejects a normalized alias shared by a branch and a service', () => {
  validationError(knowledge => { knowledge.services[0].aliases.push('  REDBOX\tBYPASS '); }, /alias/i);
});

test('rejects a service ID set that differs from the booking catalog', () => {
  validationError(knowledge => { knowledge.services[0].id = 'invented-service'; }, /service id/i);
});

for (const invalidPrice of [-1, NaN, Infinity, '95000']) {
  test(`rejects invalid service price: ${String(invalidPrice)}`, () => {
    validationError(knowledge => { knowledge.services[0].prices.standard = invalidPrice; }, /price/i);
  });
}

test('rejects recursively forbidden internal fields', () => {
  validationError(knowledge => { knowledge.branches[0].internal_note = 'do not expose'; }, /forbidden/i);
});

test('rejects a promotion with an invalid status', () => {
  validationError(knowledge => {
    knowledge.promotions.push({
      id: 'promo-invalid-status', title: 'Invalid', status: 'draft',
      valid_from: '2026-08-01', valid_until: '2026-08-31',
      branches: ['bypass'], services: ['gentleman-grooming'], eligibility: 'Semua pelanggan', terms_summary: 'Valid.',
    });
  }, /promotion status/i);
});

test('rejects a promotion with a reversed date range', () => {
  validationError(knowledge => {
    knowledge.promotions.push({
      id: 'promo-invalid-dates', title: 'Invalid', status: 'active',
      valid_from: '2026-09-01', valid_until: '2026-08-31',
      branches: ['bypass'], services: ['gentleman-grooming'], eligibility: 'Semua pelanggan', terms_summary: 'Valid.',
    });
  }, /promotion date/i);
});

test('rejects a promotion that references an unknown branch', () => {
  validationError(knowledge => {
    knowledge.promotions.push({
      id: 'promo-unknown-branch', title: 'Invalid', status: 'active',
      valid_from: '2026-08-01', valid_until: '2026-08-31',
      branches: ['unknown-branch'], services: ['gentleman-grooming'], eligibility: 'Semua pelanggan', terms_summary: 'Valid.',
    });
  }, /promotion branch/i);
});

test('rejects a promotion that references an unknown service', () => {
  validationError(knowledge => {
    knowledge.promotions.push({
      id: 'promo-unknown-service', title: 'Invalid', status: 'active',
      valid_from: '2026-08-01', valid_until: '2026-08-31',
      branches: ['bypass'], services: ['unknown-service'], eligibility: 'Semua pelanggan', terms_summary: 'Valid.',
    });
  }, /promotion service/i);
});
