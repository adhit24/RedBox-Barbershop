'use strict';

/**
 * Redbox AI Internal Orchestration Service v0.2
 * In-process orchestration decision layer for central event classification & routing.
 */

const { classifyMessage } = require('./classifier');

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
    // Classification receives ONLY the raw message string — zero phone, secret, or PII
    const decision = await classifier(message);
    return {
      intent: typeof decision?.intent === 'string' ? decision.intent : 'unknown',
      route: typeof decision?.route === 'string' ? decision.route : 'reddy_agent',
      agent: typeof decision?.agent === 'string' ? decision.agent : (typeof decision?.route === 'string' && decision.route === 'human' ? 'human' : 'reddy_agent'),
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

module.exports = { orchestrateMessage };
