'use strict';

/**
 * Redbox Reddy Execution Adapter v0.1
 * Adapts AI Orchestrator route decision ("reddy_agent") to existing Reddy conversation execution.
 */

/**
 * Executes Reddy conversational generation for an orchestrated message.
 * @param {object} params - Input parameters { from, name, text, device, branch, trustedIdentity }
 * @param {object} dependencies - Dependencies { callOpenAI, sendWA }
 * @returns {Promise<object>} Execution result { used: 'reddy_agent', reply, sendResult, error }
 */
async function executeReddyAgent(params = {}, dependencies = {}) {
  const { from, name, text, branch = 'bypass' } = params;
  const { callOpenAI, sendWA } = dependencies;

  if (!callOpenAI || typeof callOpenAI !== 'function') {
    throw new Error('callOpenAI dependency function required for Reddy execution');
  }

  let reply;
  let used = 'reddy_agent';
  let error = null;

  try {
    reply = await callOpenAI(from, text, name, branch);
  } catch (err) {
    throw err; // Re-throw to allow Orchestrator fallback handler to manage fallback safely
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
