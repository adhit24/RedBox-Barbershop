'use strict';

/**
 * Redbox CRM Agent v0.1 — 0-LLM Deterministic Tool Layer
 * Pure deterministic tool execution over Customer 360 Read Service.
 */

const { getCustomer360, getCustomerPointsByTrustedPhone } = require('../../crm/customer360Service');
const { resolveCustomerIdentity } = require('../../crm/customerIdentity');
const { projectInternal, projectCustomerSelf } = require('../../crm/customerPrivacy');
const { CONTRACT_VERSION, CRM_TOOLS, PROJECTION_TYPES } = require('./contract');
const { normalizeMemberPhone } = require('../../member-identity');

/**
 * Executes a deterministic CRM Agent tool capability with strict IDOR authorization binding.
 * @param {string} toolName - Name of the capability tool to execute
 * @param {object} params - Input params (e.g. { phone, customer_id, limit })
 * @param {object} context - Execution context { supabase, projection, allow_internal_projection, phone, customer_id, user }
 * @returns {Promise<object>} Tool execution result
 */
async function executeCrmTool(toolName, params = {}, context = {}) {
  const { supabase } = context;

  if (!supabase) {
    return {
      status: 'error',
      tool: toolName,
      error: 'supabase_client_required',
      data: null,
    };
  }

  if (!CRM_TOOLS.includes(toolName)) {
    return {
      status: 'error',
      tool: toolName,
      error: 'unknown_crm_tool',
      data: null,
    };
  }

  // Projection is strictly determined by trusted server context with explicit authorization flag
  const isInternalAuthorized = (context.projection === PROJECTION_TYPES.INTERNAL && context.allow_internal_projection === true);
  const projection = isInternalAuthorized ? PROJECTION_TYPES.INTERNAL : PROJECTION_TYPES.CUSTOMER_SELF;

  let targetPhone = null;
  let targetCustomerId = null;

  if (projection === PROJECTION_TYPES.CUSTOMER_SELF) {
    // Trusted server context ONLY — unverified trustedIdentity objects MUST NOT authorize CRM
    const contextPhone = context.phone || context.user?.phone;
    const contextCustId = context.customer_id || context.user?.customer_id || context.user?.id;

    if (!contextPhone && !contextCustId) {
      return {
        status: 'unauthorized',
        tool: toolName,
        error: 'unauthenticated_context',
        customer_found: false,
        data: null,
      };
    }

    // Dual trusted claims: phone is cluster authority. customer_id claim is authorized if included in phone's alias cluster.
    if (contextPhone && contextCustId) {
      const phoneIdentity = await resolveCustomerIdentity(supabase, { phone: contextPhone });
      if (phoneIdentity.resolution === 'db_error') {
        return {
          status: 'db_error',
          tool: toolName,
          error: 'database_unavailable',
          customer_found: false,
          data: null,
        };
      }
      if (!phoneIdentity.found || !phoneIdentity.customer_id) {
        return {
          status: 'forbidden',
          tool: toolName,
          error: 'identity_unverified',
          customer_found: false,
          data: null,
        };
      }

      const customerIdIdentity = await resolveCustomerIdentity(supabase, { customer_id: String(contextCustId).trim() });
      if (customerIdIdentity.resolution === 'db_error') {
        return {
          status: 'db_error',
          tool: toolName,
          error: 'database_unavailable',
          customer_found: false,
          data: null,
        };
      }
      if (!customerIdIdentity.found || !customerIdIdentity.customer_id) {
        return {
          status: 'forbidden',
          tool: toolName,
          error: 'identity_unverified',
          customer_found: false,
          data: null,
        };
      }

      const phoneAliases = Array.isArray(phoneIdentity.alias_customer_ids) && phoneIdentity.alias_customer_ids.length > 0
        ? phoneIdentity.alias_customer_ids
        : (phoneIdentity.customer_id ? [phoneIdentity.customer_id] : []);

      if (!phoneAliases.includes(customerIdIdentity.customer_id)) {
        return {
          status: 'forbidden',
          tool: toolName,
          error: 'identity_conflict_blocked',
          customer_found: false,
          data: null,
        };
      }
    }

    // Check IDOR attempts from input parameters against trusted context
    if (params.customer_id && contextCustId && String(params.customer_id).trim() !== String(contextCustId).trim()) {
      return {
        status: 'forbidden',
        tool: toolName,
        error: 'idor_attempt_blocked',
        customer_found: false,
        data: null,
      };
    }

    if (params.customer_id && contextPhone && !contextCustId) {
      const paramIdentity = await resolveCustomerIdentity(supabase, { customer_id: params.customer_id });
      const contextIdentity = await resolveCustomerIdentity(supabase, { phone: contextPhone });
      const contextAliases = Array.isArray(contextIdentity.alias_customer_ids) && contextIdentity.alias_customer_ids.length > 0
        ? contextIdentity.alias_customer_ids
        : (contextIdentity.customer_id ? [contextIdentity.customer_id] : []);
      if (!paramIdentity.found || !contextIdentity.found || !contextAliases.includes(paramIdentity.customer_id)) {
        return {
          status: 'forbidden',
          tool: toolName,
          error: 'idor_attempt_blocked',
          customer_found: false,
          data: null,
        };
      }
    }

    if (params.phone && contextCustId && !contextPhone) {
      const paramIdentity = await resolveCustomerIdentity(supabase, { phone: params.phone });
      const paramAliases = Array.isArray(paramIdentity.alias_customer_ids) && paramIdentity.alias_customer_ids.length > 0
        ? paramIdentity.alias_customer_ids
        : (paramIdentity.customer_id ? [paramIdentity.customer_id] : []);
      if (!paramIdentity.found || !paramAliases.includes(String(contextCustId).trim())) {
        return {
          status: 'forbidden',
          tool: toolName,
          error: 'idor_attempt_blocked',
          customer_found: false,
          data: null,
        };
      }
    }

    if (params.phone && contextPhone) {
      const normParamPhone = normalizeMemberPhone(params.phone);
      const normContextPhone = normalizeMemberPhone(contextPhone);
      if (normParamPhone && normContextPhone && normParamPhone !== normContextPhone) {
        return {
          status: 'forbidden',
          tool: toolName,
          error: 'idor_attempt_blocked',
          customer_found: false,
          data: null,
        };
      }
    }

    targetPhone = contextPhone || params.phone;
    targetCustomerId = contextCustId || params.customer_id;
  } else {
    // INTERNAL mode (Admin / System): params take priority
    targetPhone = params.phone || context.phone;
    targetCustomerId = params.customer_id || context.customer_id;
  }

  // Dedicated points read path under CUSTOMER_SELF using trusted phone anchor
  if (toolName === 'get_points' && projection === PROJECTION_TYPES.CUSTOMER_SELF && targetPhone && !targetCustomerId) {
    const pointsRes = await getCustomerPointsByTrustedPhone(supabase, targetPhone);

    if (pointsRes.resolution === 'db_error') {
      return {
        status: 'db_error',
        tool: toolName,
        error: pointsRes.error || 'database_unavailable',
        customer_found: false,
        data: null,
      };
    }

    if (!pointsRes.found) {
      return {
        status: pointsRes.resolution === 'ambiguous' ? 'ambiguous' : 'not_found',
        tool: toolName,
        contract_version: CONTRACT_VERSION,
        error: pointsRes.resolution === 'ambiguous' ? 'ambiguous_identity' : undefined,
        customer_found: false,
        data: null,
        message: pointsRes.resolution === 'ambiguous' ? 'Identity resolution is ambiguous' : 'Customer identity could not be resolved',
      };
    }

    if (pointsRes.status === 'ambiguous_balance_conflict') {
      return {
        status: 'success',
        tool: toolName,
        contract_version: CONTRACT_VERSION,
        customer_found: true,
        projection: PROJECTION_TYPES.CUSTOMER_SELF,
        data: { points_balance: null, status: 'ambiguous_balance_conflict' },
      };
    }

    return {
      status: 'success',
      tool: toolName,
      contract_version: CONTRACT_VERSION,
      customer_found: true,
      projection: PROJECTION_TYPES.CUSTOMER_SELF,
      data: {
        points_balance: pointsRes.points_balance,
        status: pointsRes.status || 'available',
      },
    };
  }

  const identityInput = {
    phone: targetPhone,
    customer_id: targetCustomerId,
    user_key: params.user_key || context.user_key,
  };

  // Step 1: Fetch underlying Customer 360 facts
  const raw360 = await getCustomer360(supabase, identityInput);

  if (raw360.identity?.resolution === 'db_error') {
    return {
      status: 'db_error',
      tool: toolName,
      error: raw360.identity.error || 'database_unavailable',
      customer_found: false,
      data: null,
    };
  }

  if (raw360.identity?.resolution === 'ambiguous') {
    return {
      status: 'ambiguous',
      tool: toolName,
      contract_version: CONTRACT_VERSION,
      error: 'ambiguous_identity',
      customer_found: false,
      data: null,
    };
  }

  // Step 2: Apply privacy projection
  const projected360 = projection === PROJECTION_TYPES.INTERNAL
    ? projectInternal(raw360)
    : projectCustomerSelf(raw360);

  const customerFound = Boolean(projected360?.identity?.customer_found);

  if (!customerFound) {
    return {
      status: 'not_found',
      tool: toolName,
      contract_version: CONTRACT_VERSION,
      customer_found: false,
      data: null,
      message: 'Customer identity could not be resolved',
    };
  }

  // Step 3: Extract slice for specific tool request
  let toolData = null;

  switch (toolName) {
    case 'get_customer_profile':
      toolData = {
        customer: projected360.customer,
        membership: projected360.membership,
      };
      break;

    case 'get_points':
      toolData = projected360.loyalty;
      break;

    case 'get_membership':
      toolData = projected360.membership;
      break;

    case 'get_customer_preferences':
      toolData = projected360.preferences;
      break;

    case 'get_visit_summary':
      toolData = projected360.activity;
      break;

    case 'get_transaction_summary':
      toolData = projection === PROJECTION_TYPES.CUSTOMER_SELF
        ? { activity: { completed_transaction_count: projected360.activity?.completed_transaction_count ?? null } }
        : projected360.spending;
      break;

    case 'get_customer_history':
      toolData = {
        activity: projected360.activity,
        spending: projected360.spending,
        preferences: projected360.preferences,
      };
      break;

    default:
      toolData = projected360;
      break;
  }

  return {
    status: 'success',
    tool: toolName,
    contract_version: CONTRACT_VERSION,
    customer_found: true,
    projection: projection,
    data: toolData,
  };
}

module.exports = {
  executeCrmTool,
  CRM_TOOLS,
};
