'use strict';

const CONTEXT_VERSION = 'reddy_knowledge_context.v0.1';
const DELIMITER_OPEN = '<redbox_knowledge_json>';
const DELIMITER_CLOSE = '</redbox_knowledge_json>';
const VALID_STATUSES = new Set(['available', 'no_verified_fact', 'unavailable']);

function strings(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))];
}

function buildKnowledgeContext(envelope = {}) {
  const facts = Array.isArray(envelope.facts) ? envelope.facts : [];
  const status = VALID_STATUSES.has(envelope.status)
    ? envelope.status
    : (facts.length ? 'available' : 'no_verified_fact');
  const context = {
    version: CONTEXT_VERSION,
    source: 'redbox_knowledge',
    trust: 'verified_business_facts',
    status,
    topics: strings(envelope.topics),
    facts,
    unknown_fields: strings(envelope.unknown_fields),
    fact_count: facts.length,
  };
  if (envelope.bounded === true) context.bounded = true;
  return context;
}

function createUnavailableKnowledgeContext(topics = []) {
  return buildKnowledgeContext({ status: 'unavailable', topics, facts: [], unknown_fields: [] });
}

function serializeKnowledgeForPrompt(value) {
  const envelope = buildKnowledgeContext(value);
  const json = JSON.stringify(envelope).replace(/[<>&]/g, character => ({
    '<': '\\u003c',
    '>': '\\u003e',
    '&': '\\u0026',
  })[character]);
  return `${DELIMITER_OPEN}${json}${DELIMITER_CLOSE}`;
}

module.exports = {
  CONTEXT_VERSION,
  buildKnowledgeContext,
  serializeKnowledgeForPrompt,
  createUnavailableKnowledgeContext,
};
