'use strict';

const KNOWLEDGE_VERSION = 'reddy_knowledge.v0.1';
const EXPECTED_BRANCH_IDS = new Set(['bypass', 'samadikun', 'csb', 'sumber', 'tegal']);
const PROMOTION_STATUSES = new Set(['active', 'inactive']);
const FORBIDDEN_FIELD_NAMES = new Set([
  'secret', 'credential', 'apikey', 'token', 'databaseurl', 'customerid',
  'customernote', 'ownermetric', 'commissionrule', 'escalationnote', 'internalnote',
]);

function fail(reason) {
  throw new Error(`Invalid Redbox knowledge: ${reason}`);
}

function normalizeAlias(value) {
  return String(value).trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizedFieldName(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function assertArray(value, name) {
  if (!Array.isArray(value)) fail(`${name} must be an array`);
}

function assertNonEmptyString(value, name) {
  if (typeof value !== 'string' || !value.trim()) fail(`${name} must be a non-empty string`);
}

function assertNoForbiddenFields(value) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach(assertNoForbiddenFields);
    return;
  }
  for (const [key, nestedValue] of Object.entries(value)) {
    if (FORBIDDEN_FIELD_NAMES.has(normalizedFieldName(key))) fail('forbidden field');
    assertNoForbiddenFields(nestedValue);
  }
}

function assertAliases(items, type) {
  const aliases = new Set();
  for (const item of items) {
    assertArray(item.aliases, `${type} aliases`);
    for (const alias of item.aliases) {
      assertNonEmptyString(alias, `${type} alias`);
      const normalized = normalizeAlias(alias);
      if (aliases.has(normalized)) fail(`duplicate ${type} alias`);
      aliases.add(normalized);
    }
  }
}

function assertValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validateKnowledge(knowledge) {
  if (!knowledge || typeof knowledge !== 'object' || Array.isArray(knowledge)) fail('root must be an object');
  assertNoForbiddenFields(knowledge);
  if (knowledge.version !== KNOWLEDGE_VERSION) fail('wrong version');

  assertArray(knowledge.branches, 'branches');
  const branchIds = new Set();
  for (const branch of knowledge.branches) {
    if (!branch || typeof branch !== 'object') fail('branch must be an object');
    assertNonEmptyString(branch.id, 'branch id');
    if (!EXPECTED_BRANCH_IDS.has(branch.id)) fail('unknown branch id');
    if (branchIds.has(branch.id)) fail('duplicate branch id');
    branchIds.add(branch.id);
  }
  if (branchIds.size !== EXPECTED_BRANCH_IDS.size) fail('missing branch id');
  assertAliases(knowledge.branches, 'branch');

  assertArray(knowledge.services, 'services');
  const serviceIds = new Set();
  for (const service of knowledge.services) {
    if (!service || typeof service !== 'object') fail('service must be an object');
    assertNonEmptyString(service.id, 'service id');
    if (serviceIds.has(service.id)) fail('duplicate service id');
    serviceIds.add(service.id);
    if (!Number.isInteger(service.duration_minutes) || service.duration_minutes <= 0) fail('service duration');
    if (!service.prices || typeof service.prices !== 'object') fail('service prices');
    for (const scope of ['standard', 'csb']) {
      const price = service.prices[scope];
      if (!Number.isInteger(price) || price < 0) fail('invalid service price');
    }
  }
  assertAliases(knowledge.services, 'service');

  assertArray(knowledge.promotions, 'promotions');
  for (const promotion of knowledge.promotions) {
    if (!promotion || typeof promotion !== 'object') fail('promotion must be an object');
    if (!PROMOTION_STATUSES.has(promotion.status)) fail('invalid promotion status');
    if (!assertValidDate(promotion.valid_from) || !assertValidDate(promotion.valid_until) || promotion.valid_from > promotion.valid_until) {
      fail('invalid promotion date range');
    }
    assertArray(promotion.branches, 'promotion branches');
    assertArray(promotion.services, 'promotion services');
    for (const branchId of promotion.branches) {
      if (!branchIds.has(branchId)) fail('unknown promotion branch');
    }
    for (const serviceId of promotion.services) {
      if (!serviceIds.has(serviceId)) fail('unknown promotion service');
    }
  }

  return knowledge;
}

module.exports = { validateKnowledge };
