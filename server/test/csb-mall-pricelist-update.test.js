'use strict';

// Verifies the 2026-09 CSB Mall pricelist update:
//   Gentleman 120000, Noble 170000, Baron 190000, Royal 315000, Duke(Duxe) 280000, Earl 235000
// and that no other branch's pricing moved as a side effect.

const test = require('node:test');
const assert = require('node:assert/strict');

const { REDBOX_SERVICES } = require('../../public/js/services-data');
const { resolveKnowledgeContext } = require('../agents/reddy/knowledge/knowledgeResolver');

const CSB_TARGET_PRICES = {
  'gentleman-grooming': 120000,
  'package-noble': 170000,
  'package-baron': 190000,
  'package-royal': 315000,
  'package-duxe': 280000, // "Redbox Duke Grooming" in the pricelist is this catalog's "Duxe Grooming"
  'package-earl': 235000,
};

// Standard (non-CSB) prices must remain exactly as they were before this update.
const STANDARD_PRICES_UNCHANGED = {
  'gentleman-grooming': 95000,
  'package-noble': 140000,
  'package-baron': 150000,
  'package-royal': 305000,
  'package-duxe': 250000,
  'package-earl': 185000,
};

function catalogService(id) {
  const service = REDBOX_SERVICES.find((item) => item.id === id);
  assert.ok(service, `catalog is missing service id ${id}`);
  return service;
}

// Test A — CSB pricing
test('Test A: CSB Mall prices match the new pricelist for all six services', () => {
  for (const [id, price] of Object.entries(CSB_TARGET_PRICES)) {
    assert.equal(catalogService(id).csbPrice, price, `${id} csbPrice mismatch`);
  }
});

// Test B — branch isolation (standard/other-branch price untouched)
test('Test B: non-CSB (standard) prices are unchanged by the CSB update', () => {
  for (const [id, price] of Object.entries(STANDARD_PRICES_UNCHANGED)) {
    assert.equal(catalogService(id).price, price, `${id} standard price must stay EXISTING`);
  }
});

// Test C — branch switching recomputes the correct price from the same catalog row
test('Test C: switching branch on the same service recomputes the correct price', () => {
  for (const [id, csbPrice] of Object.entries(CSB_TARGET_PRICES)) {
    const service = catalogService(id);
    const standardPrice = STANDARD_PRICES_UNCHANGED[id];

    const priceFor = (isCsb) => (isCsb ? service.csbPrice || service.price : service.price);

    // Bypass -> CSB
    assert.equal(priceFor(false), standardPrice);
    assert.equal(priceFor(true), csbPrice);
    // CSB -> Bypass
    assert.equal(priceFor(true), csbPrice);
    assert.equal(priceFor(false), standardPrice);
  }
});

// Test F — AI bot (Reddy) answers CSB prices correctly, and does not leak CSB
// pricing into other-branch questions (branch isolation for the AI bot).
test('Test F: Reddy resolves the correct CSB price for each of the six services', () => {
  const queries = [
    ['gentleman grooming CSB berapa?', 'gentleman-grooming', 120000],
    ['harga noble di csb?', 'package-noble', 170000],
    ['royal csb berapa?', 'package-royal', 315000],
    ['duxe grooming csb?', 'package-duxe', 280000],
    ['earl grooming di csb berapa?', 'package-earl', 235000],
    ['baron grooming csb berapa?', 'package-baron', 190000],
  ];

  for (const [text, serviceId, expectedPrice] of queries) {
    const context = resolveKnowledgeContext({ intent: 'price_inquiry', text });
    const fact = context.facts.find((f) => f.category === 'service' && f.id === serviceId);
    assert.ok(fact, `no service fact resolved for "${text}"`);
    assert.equal(fact.price_scope, 'csb', `expected csb price scope for "${text}"`);
    assert.equal(fact.price_idr, expectedPrice, `wrong CSB price resolved for "${text}"`);
  }
});

test('Test F (control): a non-CSB branch question never resolves the CSB price', () => {
  const context = resolveKnowledgeContext({
    intent: 'price_inquiry',
    text: 'gentleman grooming bypass berapa?',
  });
  const fact = context.facts.find((f) => f.category === 'service' && f.id === 'gentleman-grooming');
  assert.ok(fact, 'no service fact resolved for bypass query');
  assert.equal(fact.price_scope, 'standard');
  assert.equal(fact.price_idr, 95000);
  assert.notEqual(fact.price_idr, 120000);
});

test('Test G: a plain service question with no branch mentioned does not assume CSB', () => {
  for (const id of Object.keys(CSB_TARGET_PRICES)) {
    const service = catalogService(id);
    const context = resolveKnowledgeContext({
      intent: 'price_inquiry',
      text: `harga ${service.name.toLowerCase()}?`,
    });
    const fact = context.facts.find((f) => f.category === 'service' && f.id === id);
    assert.ok(fact, `no service fact resolved for ${service.name}`);
    assert.notEqual(fact.price_scope, 'csb', `${service.name} should not default to CSB pricing without a branch`);
  }
});
