'use strict';

/**
 * Redbox AI Internal Orchestration Service v0.2
 * In-process orchestration decision layer for central event classification & routing.
 */

const { classifyMessage } = require('./classifier');

// Phase 1 AI AGENTS topology consists strictly of orchestrator, crm_agent, and reddy_agent.
// Human handoff is a ROUTING OUTCOME / STATE, not an AI agent.
const ALLOWED_AGENTS = Object.freeze(['reddy_agent', 'crm_agent']);
const ALLOWED_ROUTES = Object.freeze(['reddy_agent', 'crm_agent', 'human']);

/**
 * Orchestrates an inbound message in-process, returning safe routing metadata.
 * @param {object} params - Input params { message, channel, branch, trustedIdentity, conversationContext }
 * @param {object} dependencies - Override dependencies for testability { classifier }
 * @returns {Promise<object>} Safe routing decision
 */
async function orchestrateMessage(params = {}, dependencies = {}) {
  const { message, channel = 'whatsapp', branch = null } = params;
  const classifier = dependencies.classifier || classifyMessage;

  if (!message || typeof message !== 'string' || !message.trim()) {
    return {
      intent: 'unknown',
      route: 'reddy_agent',
      agent: 'reddy_agent',
      action: 'fallback_unknown',
      confidence: 0,
      model_tier: 'none',
      channel,
      branch: branch || 'unknown',
      fallback_used: true,
      fallback_reason: 'empty_message',
    };
  }

  try {
    const decision = await classifier(message);

    let rawRoute = typeof decision?.route === 'string' ? decision.route : 'reddy_agent';
    let rawIntent = typeof decision?.intent === 'string' ? decision.intent : 'unknown';
    let rawAction = typeof decision?.action === 'string' ? decision.action : 'fallback_unknown';

    // BLOCKER 1 & 10: Strict taxonomy allowlist validation.
    const isRouteAllowed = ALLOWED_ROUTES.includes(rawRoute);

    if (!isRouteAllowed) {
      return {
        intent: rawIntent,
        route: 'reddy_agent',
        agent: 'reddy_agent',
        action: 'fallback_unknown',
        confidence: typeof decision?.confidence === 'number' && Number.isFinite(decision.confidence) ? decision.confidence : 0,
        model_tier: typeof decision?.model_tier === 'string' ? decision.model_tier : 'none',
        channel,
        branch: branch || 'unknown',
        fallback_used: true,
        fallback_reason: 'unsupported_route_or_agent',
      };
    }

    // Human route is a routing outcome/state, NOT an AI agent
    let targetAgent;
    if (rawRoute === 'human') {
      targetAgent = undefined;
    } else {
      targetAgent = rawRoute;
    }

    return {
      intent: rawIntent,
      route: rawRoute,
      agent: targetAgent,
      action: rawAction,
      confidence: typeof decision?.confidence === 'number' && Number.isFinite(decision.confidence) ? decision.confidence : 0,
      model_tier: typeof decision?.model_tier === 'string' ? decision.model_tier : 'none',
      channel,
      branch: branch || 'unknown',
      fallback_used: false,
      fallback_reason: null,
    };
  } catch (err) {
    return {
      intent: 'unknown',
      route: 'reddy_agent',
      agent: 'reddy_agent',
      action: 'fallback_unknown',
      confidence: 0,
      model_tier: 'none',
      channel,
      branch: branch || 'unknown',
      fallback_used: true,
      fallback_reason: 'orchestrator_error',
    };
  }
}

module.exports = { orchestrateMessage, ALLOWED_AGENTS, ALLOWED_ROUTES };
