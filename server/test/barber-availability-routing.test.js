'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { classifyDeterministically } = require('../orchestrator/routingPolicy');
const { decisionFor, ROUTES } = require('../orchestrator/contract');

test('barber_availability_query: named barber + availability word routes to reddy_agent/answer_barber_availability', () => {
  for (const text of ['Mas Abdul kosong jam berapa kak?', 'Mas Abdul hari ini kosong', 'Mas Sofyan available gak besok?']) {
    const classified = classifyDeterministically(text);
    assert.equal(classified?.intent, 'barber_availability_query', text);
    const decision = decisionFor(classified.intent, classified.confidence);
    assert.equal(decision.agent, 'reddy_agent');
    assert.equal(decision.action, 'answer_barber_availability');
  }
});

test('specific_time_availability_query: named barber + clock time + availability word', () => {
  for (const text of ['Mas Abdul jam 5 sore kosong?', 'Mas Abdul jam 19:00 available?']) {
    const classified = classifyDeterministically(text);
    assert.equal(classified?.intent, 'specific_time_availability_query', text);
    const decision = decisionFor(classified.intent, classified.confidence);
    assert.equal(decision.agent, 'reddy_agent');
    assert.equal(decision.action, 'answer_barber_availability');
  }
});

test('branch_availability_query: "siapa yang kosong" with no barber name', () => {
  for (const text of ['Jam 7 malam di Bypass siapa yang kosong?', 'Sekarang siapa yang available?']) {
    const classified = classifyDeterministically(text);
    assert.equal(classified?.intent, 'branch_availability_query', text);
    const decision = decisionFor(classified.intent, classified.confidence);
    assert.equal(decision.agent, 'reddy_agent');
    assert.equal(decision.action, 'answer_barber_availability');
  }
});

test('booking write intents are unaffected: no availability signal words, not routed to availability', () => {
  for (const text of ['Tolong booking Abdul jam 8', 'Yaudah lock dulu slotnya', 'Bisa reschedule ke besok?']) {
    const classified = classifyDeterministically(text);
    assert.notEqual(classified?.intent, 'barber_availability_query', text);
    assert.notEqual(classified?.intent, 'specific_time_availability_query', text);
    assert.notEqual(classified?.intent, 'branch_availability_query', text);
  }
});

test('Correction 2: "slot terdekat" (next-available-slot, deferred) is never silently classified as a same-day availability query', () => {
  for (const text of ['Mas Abdul slot terdekat kapan?', 'Abdul kosong paling dekat jam berapa nanti?']) {
    const classified = classifyDeterministically(text);
    assert.notEqual(classified?.intent, 'barber_availability_query', text);
    assert.notEqual(classified?.intent, 'specific_time_availability_query', text);
    assert.notEqual(classified?.intent, 'branch_availability_query', text);
  }
});

test('the 3 new intents are registered in ROUTES and reachable via decisionFor', () => {
  for (const intent of ['barber_availability_query', 'specific_time_availability_query', 'branch_availability_query']) {
    assert.ok(Object.hasOwn(ROUTES, intent), intent);
    const decision = decisionFor(intent, 1);
    assert.equal(decision.route, 'reddy_agent');
  }
});
