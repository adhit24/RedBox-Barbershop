const { decisionFor, normalizeModelDecision } = require('./contract');
const { classifyDeterministically } = require('./routingPolicy');
const { classifyWithOpenAI } = require('./openaiClient');

function createClassifier({ modelClassifier = classifyWithOpenAI } = {}) {
  return async function classifyMessage(message) {
    const deterministic = classifyDeterministically(message);
    if (deterministic) {
      return decisionFor(deterministic.intent, deterministic.confidence, { modelTier: 'none' });
    }
    return normalizeModelDecision(await modelClassifier(message));
  };
}

const classifyMessage = createClassifier();

module.exports = { classifyMessage, createClassifier };
