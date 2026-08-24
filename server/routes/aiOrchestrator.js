const express = require('express');
const { randomUUID, timingSafeEqual } = require('crypto');
const { classifyMessage } = require('../orchestrator/classifier');

function safeSecretEqual(provided, expected) {
  const left = Buffer.from(String(provided || ''));
  const right = Buffer.from(String(expected || ''));
  return left.length === right.length && timingSafeEqual(left, right);
}

function createAiOrchestratorRoutes({ classifier = classifyMessage, env = process.env } = {}) {
  const router = express.Router();
  router.post('/', async (req, res) => {
    const secret = String(env.ORCHESTRATOR_INTERNAL_SECRET || '');
    const apiKey = String(env.OPENAI_ORCHESTRATOR_API_KEY || '');
    if (!secret || !apiKey) return res.status(503).json({ error: 'orchestrator_not_configured' });
    if (!safeSecretEqual(req.get('x-orchestrator-secret'), secret)) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message) return res.status(400).json({ error: 'message_required' });
    if (message.length > 1000) return res.status(413).json({ error: 'message_too_long' });

    try {
      const decision = await classifier(message);
      return res.json({
        trace_id: `orch_${randomUUID()}`,
        ...decision,
        mode: 'classify_only',
      });
    } catch (error) {
      if (error?.code === 'CLASSIFICATION_TIMEOUT') {
        return res.status(504).json({ error: 'classification_timeout' });
      }
      return res.status(502).json({ error: 'classification_unavailable' });
    }
  });
  return router;
}

function orchestratorJsonErrorHandler(error, req, res, next) {
  if (error?.type === 'entity.parse.failed' && req.path === '/api/ai/orchestrator') {
    return res.status(400).json({ error: 'malformed_json' });
  }
  return next(error);
}

module.exports = { createAiOrchestratorRoutes, orchestratorJsonErrorHandler, safeSecretEqual };
