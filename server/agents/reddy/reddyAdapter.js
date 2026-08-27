'use strict';

const { buildCustomerFactsContext } = require('./customerFactsContext');
const { serializeKnowledgeForPrompt } = require('./knowledge/knowledgeContext');

/**
 * Redbox Reddy Execution Adapter v0.1
 * Adapts AI Orchestrator route decision ("reddy_agent") to existing Reddy conversation execution.
 */

async function executeReddyAgent(params = {}, dependencies = {}) {
  const {
    from,
    name,
    text,
    branch = 'bypass',
    knowledgeContext = null,
    customerIntelligence = null,
    conversationContext = null,
    orchestrationDecision = null,
  } = params;
  const { callOpenAI, sendWA } = dependencies;

  if (!callOpenAI || typeof callOpenAI !== 'function') {
    throw new Error('callOpenAI dependency function required for Reddy execution');
  }

  let factsContext = null;
  if (customerIntelligence) {
    factsContext = buildCustomerFactsContext(customerIntelligence);
  }

  let knowledgeFactsContext = knowledgeContext?.knowledgeFactsContext || null;
  if (!knowledgeFactsContext && knowledgeContext) {
    if (typeof knowledgeContext === 'string') {
      knowledgeFactsContext = knowledgeContext;
    } else {
      knowledgeFactsContext = serializeKnowledgeForPrompt(knowledgeContext);
    }
  }

  let reply;
  let used = 'reddy_agent';
  let error = null;

  // Verified CRM name source: derive ONLY from customerIntelligence facts or customer entity
  const verifiedCrmName = customerIntelligence?.facts?.name || customerIntelligence?.customer?.name || null;
  const boundedConversationContext = {
    ...(conversationContext && typeof conversationContext === 'object' ? conversationContext : {
      turns: [],
      turn_count: 0,
      history_status: 'empty',
      sessionStatus: 'expired',
    }),
    ...(orchestrationDecision && typeof orchestrationDecision === 'object' ? {
      orchestrator_decision: {
        intent: orchestrationDecision.intent || 'unknown',
        conversational_act: orchestrationDecision.conversational_act || 'unknown',
        continuation_type: orchestrationDecision.continuation_type || 'none',
        context_reference: orchestrationDecision.context_reference || null,
        route: orchestrationDecision.route || 'reddy_agent',
        required_sources: Array.isArray(orchestrationDecision.required_sources) ? orchestrationDecision.required_sources : [],
        allowed_claims: Array.isArray(orchestrationDecision.allowed_claims) ? orchestrationDecision.allowed_claims : [],
        prohibited_claims: Array.isArray(orchestrationDecision.prohibited_claims) ? orchestrationDecision.prohibited_claims : [],
        clarification_required: Boolean(orchestrationDecision.clarification_required),
        session_behavior: orchestrationDecision.session_behavior || 'continue',
        response_strategy: orchestrationDecision.response_strategy || 'answer_directly',
      },
    } : {}),
  };

  try {
    if (knowledgeFactsContext) {
      reply = await callOpenAI(from, text, verifiedCrmName, branch, knowledgeFactsContext, factsContext, boundedConversationContext);
    } else {
      reply = await callOpenAI(from, text, verifiedCrmName, branch, null, factsContext, boundedConversationContext);
    }
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
