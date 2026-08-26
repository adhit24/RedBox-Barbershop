'use strict';

/**
 * Redbox AI Internal Orchestration Service v0.2
 * In-process orchestration decision layer for central event classification & routing.
 */

const { classifyMessage } = require('./classifier');

const ALLOWED_AGENTS = Object.freeze(['reddy_agent', 'crm_agent', 'human']);
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
    };
  }

  try {
    const decision = await classifier(message);

    let rawRoute = typeof decision?.route === 'string' ? decision.route : 'reddy_agent';
    let rawAgent = typeof decision?.agent === 'string' ? decision.agent : (rawRoute === 'human' ? 'human' : 'reddy_agent');

    // BLOCKER 10: Strict allowlist validation against existing taxonomy.
    // Unknown or unsupported routes MUST fall back to reddy_agent fallback_unknown.
    const isRouteAllowed = ALLOWED_ROUTES.includes(rawRoute);
    const isAgentAllowed = ALLOWED_AGENTS.includes(rawAgent);

    if (!isRouteAllowed || !isAgentAllowed) {
      return {
        intent: typeof decision?.intent === 'string' ? decision.intent : 'unknown',
        route: 'reddy_agent',
        agent: 'reddy_agent',
        action: 'fallback_unknown',
        confidence: typeof decision?.confidence === 'number' && Number.isFinite(decision.confidence) ? decision.confidence : 0,
        model_tier: typeof decision?.model_tier === 'string' ? decision.model_tier : 'none',
        channel,
        branch: branch || 'unknown',
        fallback_reason: 'unsupported_route_or_agent',
      };
    }

    return {
      intent: typeof decision?.intent === 'string' ? decision.intent : 'unknown',
      route: rawRoute,
      agent: rawAgent,
      action: typeof decision?.action === 'string' ? decision.action : 'fallback_unknown',
      confidence: typeof decision?.confidence === 'number' && Number.isFinite(decision.confidence) ? decision.confidence : 0,
      model_tier: typeof decision?.model_tier === 'string' ? decision.model_tier : 'none',
      channel,
      branch: branch || 'unknown',
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
      error: err?.message || String(err),
    };
  }
}

module.exports = { orchestrateMessage, ALLOWED_AGENTS, ALLOWED_ROUTES };
