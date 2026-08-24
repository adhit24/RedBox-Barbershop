'use strict';

const { executeCrmTool } = require('../agents/crm/crmAgent');
const { PROJECTION_TYPES } = require('../agents/crm/contract');
const { isTrustedIdentity } = require('../identity/trustedIdentity');

const POINTS_EXECUTION = Object.freeze({
  intent: 'points_inquiry',
  route: 'crm_agent',
  agent: 'crm_agent',
  action: 'get_points',
  tool: 'get_points',
});

function matchesPointsAllowlist(classification) {
  return Boolean(classification
    && classification.intent === POINTS_EXECUTION.intent
    && classification.route === POINTS_EXECUTION.route
    && classification.agent === POINTS_EXECUTION.agent
    && classification.action === POINTS_EXECUTION.action);
}

function safeClassification(classification = {}) {
  return {
    intent: typeof classification.intent === 'string' ? classification.intent : 'unknown',
    route: typeof classification.route === 'string' ? classification.route : 'reddy_agent',
    ...(typeof classification.agent === 'string' ? { agent: classification.agent } : {}),
    action: typeof classification.action === 'string' ? classification.action : 'fallback_unknown',
    ...(typeof classification.model_tier === 'string' ? { model_tier: classification.model_tier } : {}),
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
  const base = safeClassification(classificationResult);
  if (!matchesPointsAllowlist(classificationResult)) {
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
