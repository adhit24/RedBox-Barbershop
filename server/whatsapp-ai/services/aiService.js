const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const knowledgeService = require('./knowledgeService');
const logger = require('../utils/logger');

const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

// Load system prompt once at startup
const SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, '../prompts/system.txt'), 'utf8'
);

// In-memory short context per user: { phone: [{ role, content }] }
const userContexts = new Map();

const getContext = (phone) => userContexts.get(phone) || [];

const addToContext = (phone, role, content) => {
  const ctx = getContext(phone);
  ctx.push({ role, content });

  // Keep only last N messages (cost control)
  if (ctx.length > config.MAX_CONTEXT_MESSAGES) {
    ctx.splice(0, ctx.length - config.MAX_CONTEXT_MESSAGES);
  }

  userContexts.set(phone, ctx);
};

const clearContext = (phone) => userContexts.delete(phone);

const chat = async (phone, name, userMessage) => {
  addToContext(phone, 'user', userMessage);

  const knowledge = knowledgeService.buildKnowledgeContext();

  const systemMessage = `${SYSTEM_PROMPT}\n\nNAMA CUSTOMER: ${name}\n\n${knowledge}`;

  const messages = [
    { role: 'system', content: systemMessage },
    ...getContext(phone),
  ];

  const response = await openai.chat.completions.create({
    model: config.OPENAI_MODEL,
    messages,
    max_tokens: config.MAX_TOKENS,
    temperature: 0.7,
  });

  const reply = response.choices[0]?.message?.content?.trim() || 'Maaf kak, ada gangguan sebentar. Coba lagi ya 🙏';
  const tokensUsed = response.usage?.total_tokens || 0;

  addToContext(phone, 'assistant', reply);
  logger.logTokenUsage(phone, tokensUsed);

  return { reply, tokensUsed };
};

module.exports = { chat, clearContext, getContext };
