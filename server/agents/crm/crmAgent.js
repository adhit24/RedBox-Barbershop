'use strict';

/**
 * Redbox CRM Agent v0.1 — 0-LLM Deterministic Tool Layer
 * Pure deterministic tool execution over Customer 360 Read Service.
 */

const { getCustomer360 } = require('../../crm/customer360Service');
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

    // Check trusted context identity conflict: if both context.phone and context.customer_id are present, they MUST resolve to the same customer UUID
    if (contextPhone && contextCustId) {
      const phoneIdentity = await resolveCustomerIdentity(supabase, { phone: contextPhone });
      if (phoneIdentity.found && phoneIdentity.customer_id && String(phoneIdentity.customer_id).trim() !== String(contextCustId).trim()) {
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
      if (paramIdentity.found && contextIdentity.found && paramIdentity.customer_id !== contextIdentity.customer_id) {
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
      if (paramIdentity.found && paramIdentity.customer_id !== String(contextCustId).trim()) {
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
      toolData = projected360.spending;
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
