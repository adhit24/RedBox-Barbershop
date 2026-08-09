'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { STATUS, normalizePhone, normalizeBranch } = require('../services/bookingStatusService');
const { classifyIntent } = require('../services/messageHandler');
const knowledgeService = require('../services/knowledgeService');

assert.deepStrictEqual(normalizePhone('081234567890'), ['081234567890', '6281234567890']);
assert.strictEqual(normalizeBranch('CSB Mall'), 'csb');
assert.strictEqual(STATUS.CONFIRMED, 'CONFIRMED');
assert.strictEqual(classifyIntent('Jam 7 aku OTW'), 'late_notification');
assert.strictEqual(classifyIntent('Nanti aku langsung datang aja'), 'walk_in');
assert.strictEqual(classifyIntent('Mau booking home service'), 'home_service_request');
assert.strictEqual(classifyIntent('Wedding H-2'), 'wedding_too_soon');
assert.strictEqual(classifyIntent('Yang anak-anak'), 'booking_detail_confirmation');
assert.match(knowledgeService.getServicesText('CSB'), /Redbox Gentleman Grooming.*120k/);
assert.match(knowledgeService.buildKnowledgeContext('CSB'), /Hair Spa \(120k/);

// Production uses the Fonnte webhook, so guard the active route against regressions.
const activeFonnteWebhook = fs.readFileSync(
  path.resolve(__dirname, '../../../api/wa/webhook.js'),
  'utf8'
);
assert.match(activeFonnteWebhook, /getCustomerBookingStatus/);
assert.match(activeFonnteWebhook, /status === BOOKING_STATUS\.CONFIRMED/);
assert.match(activeFonnteWebhook, /redboxbarbershop\.com\/home-service\.html/);
assert.doesNotMatch(activeFonnteWebhook, /dateng langsung dilayani tanpa antri/);
assert.doesNotMatch(activeFonnteWebhook, /FULL RAW PAYLOAD/);

console.log('policy-regression.test.js: PASS');
