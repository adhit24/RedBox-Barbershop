'use strict';

const { buildCustomerFactsContext } = require('./customerFactsContext');

/**
 * Redbox Reddy Execution Adapter v0.1
 * Adapts AI Orchestrator route decision ("reddy_agent") to existing Reddy conversation execution.
 */

/**
 * Executes Reddy conversational generation for an orchestrated message with optional CRM runtime facts injection
 * and conversation context continuity.
 * @param {object} params - Input parameters { from, name, text, device, branch, trustedIdentity, customerIntelligence, conversationContext }
 * @param {object} dependencies - Dependencies { callOpenAI, sendWA }
 * @returns {Promise<object>} Execution result { used: 'reddy_agent', reply, sendResult, error }
 */
async function executeReddyAgent(params = {}, dependencies = {}) {
  const {
    from,
    name,
    text,
    branch = 'bypass',
    customerIntelligence = null,
    conversationContext = null,
  } = params;
  const { callOpenAI, sendWA } = dependencies;

  if (!callOpenAI || typeof callOpenAI !== 'function') {
    throw new Error('callOpenAI dependency function required for Reddy execution');
  }

  let factsContext = null;
  if (customerIntelligence) {
    factsContext = buildCustomerFactsContext(customerIntelligence);
  }

  let reply;
  let used = 'reddy_agent';
  let error = null;

  try {
    reply = await callOpenAI(from, text, name, branch, factsContext, conversationContext);
  } catch (err) {
    throw err;
  }

  let sendResult = null;
  if (sendWA && typeof sendWA === 'function') {
    sendResult = await sendWA(from, reply, { branch });
  }

  return {
    used,
    reply,
    sendResult,
    error,
  };
}

module.exports = { executeReddyAgent };
