'use strict';

const { executeCrmTool } = require('../agents/crm/crmAgent');
const { PROJECTION_TYPES } = require('../agents/crm/contract');
const { isTrustedIdentity } = require('../identity/trustedIdentity');

const POINTS_EXECUTION = Object.freeze({
  intent: 'points_inquiry',
  route: 'crm_agent',
  agent: 'crm_agent',
  action: 'get_points',
  model_tier: 'economy',
  tool: 'get_points',
});
const POINTS_CLASSIFICATION_KEYS = Object.freeze([
  'intent',
  'route',
  'agent',
  'action',
  'confidence',
  'model_tier',
]);
const POINTS_CLASSIFICATION_KEY_SET = new Set(POINTS_CLASSIFICATION_KEYS);

function readPointsClassification(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    if (Object.getPrototypeOf(value) !== Object.prototype) return null;

    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== POINTS_CLASSIFICATION_KEYS.length
      || ownKeys.some(key => typeof key !== 'string' || !POINTS_CLASSIFICATION_KEY_SET.has(key))) {
      return null;
    }

    const descriptors = Object.getOwnPropertyDescriptors(value);
    const classification = {};
    for (const key of POINTS_CLASSIFICATION_KEYS) {
      const descriptor = descriptors[key];
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) return null;
      classification[key] = descriptor.value;
    }
    return classification;
  } catch (_) {
    return null;
  }
}

function matchesPointsData(classification) {
  return Boolean(classification
    && classification.intent === POINTS_EXECUTION.intent
    && classification.route === POINTS_EXECUTION.route
    && classification.agent === POINTS_EXECUTION.agent
    && classification.action === POINTS_EXECUTION.action
    && classification.model_tier === POINTS_EXECUTION.model_tier
    && typeof classification.confidence === 'number'
    && Number.isFinite(classification.confidence)
    && classification.confidence >= 0
    && classification.confidence <= 1);
}

function matchesPointsAllowlist(classification) {
  return matchesPointsData(readPointsClassification(classification));
}

function safeClassification(classification) {
  const value = classification || {};
  return {
    intent: typeof value.intent === 'string' ? value.intent : 'unknown',
    route: typeof value.route === 'string' ? value.route : 'reddy_agent',
    ...(typeof value.agent === 'string' ? { agent: value.agent } : {}),
    action: typeof value.action === 'string' ? value.action : 'fallback_unknown',
    ...(typeof value.model_tier === 'string' ? { model_tier: value.model_tier } : {}),
  };
}

function executionResult(base, executionStatus, { customerFound = false, data = null } = {}) {
  return {
    ...base,
    mode: 'execute',
    execution_status: executionStatus,
    result: {
      status: executionStatus,
      tool: POINTS_EXECUTION.tool,
      customer_found: customerFound,
      data,
    },
  };
}

function mapCrmFailure(base, crmResult) {
  const statusMap = {
    unauthorized: 'unauthorized',
    forbidden: 'forbidden',
    not_found: 'customer_not_found',
    ambiguous: 'ambiguous_identity',
    db_error: 'database_unavailable',
  };
  const mapped = statusMap[crmResult?.status] || 'database_unavailable';
  return executionResult(base, mapped);
}

async function executeOrchestration(classificationResult, dependencies = {}) {
  const classification = readPointsClassification(classificationResult);
  const base = safeClassification(classification);
  if (!matchesPointsData(classification)) {
    return {
      ...base,
      mode: 'classify_only',
      execution_status: 'unsupported_execution',
      result: null,
    };
  }

  const { trustedIdentity, supabase, crmExecutor = executeCrmTool } = dependencies;
  if (!isTrustedIdentity(trustedIdentity)) {
    return executionResult(base, 'unauthorized');
  }

  const context = {
    supabase,
    projection: PROJECTION_TYPES.CUSTOMER_SELF,
    ...(trustedIdentity.phone ? { phone: trustedIdentity.phone } : {}),
    ...(trustedIdentity.customer_id ? { customer_id: trustedIdentity.customer_id } : {}),
  };
  let crmResult;
  try {
    crmResult = await crmExecutor(POINTS_EXECUTION.tool, {}, context);
  } catch (_) {
    return executionResult(base, 'database_unavailable');
  }
  if (crmResult?.status !== 'success') return mapCrmFailure(base, crmResult);

  const pointsBalance = crmResult.data?.points_balance;
  const pointsStatus = crmResult.data?.status || 'available';
  if (typeof pointsBalance !== 'number' || pointsStatus !== 'available') {
    return executionResult(base, 'points_unavailable', {
      customerFound: true,
      data: {
        points_balance: null,
        status: pointsStatus === 'ambiguous_balance_conflict'
          ? 'ambiguous_balance_conflict'
          : 'unavailable',
      },
    });
  }

  return executionResult(base, 'success', {
    customerFound: true,
    data: { points_balance: pointsBalance, status: 'available' },
  });
}

module.exports = {
  POINTS_EXECUTION,
  executeOrchestration,
  matchesPointsAllowlist,
};
