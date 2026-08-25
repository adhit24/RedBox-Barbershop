const express = require('express');
const { createHash, randomUUID, timingSafeEqual } = require('crypto');
const { classifyMessage } = require('../orchestrator/classifier');

function safeSecretEqual(provided, expected) {
  const digest = (value) => createHash('sha256').update(String(value || ''), 'utf8').digest();
  return timingSafeEqual(digest(provided), digest(expected));
}

function createAiOrchestratorRoutes({ classifier = classifyMessage, env = process.env } = {}) {
  const router = express.Router();
  router.post('/', async (req, res) => {
    const secret = String(env.ORCHESTRATOR_INTERNAL_SECRET || '').trim();
    const apiKey = String(env.OPENAI_ORCHESTRATOR_API_KEY || '').trim();
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
  const isPostRoute = req.method === 'POST' && /^\/api\/ai\/orchestrator\/?$/.test(req.path);
  const isBodyParserFailure = error?.type === 'entity.parse.failed'
    && (error?.status === 400 || error?.statusCode === 400);
  const isVercelFailure = error?.statusCode === 400 && error?.message === 'Invalid JSON';
  if (isPostRoute && (isBodyParserFailure || isVercelFailure)) {
    return res.status(400).json({ error: 'invalid_json' });
  }
  return next(error);
}

module.exports = { createAiOrchestratorRoutes, orchestratorJsonErrorHandler, safeSecretEqual };
