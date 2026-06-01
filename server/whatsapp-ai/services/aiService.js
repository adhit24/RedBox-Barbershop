const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const knowledgeService = require('./knowledgeService');
const logger = require('../utils/logger');

const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

// Load system prompt once at startup, then interpolate branch identity
const _RAW_SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, '../prompts/system.txt'), 'utf8'
);
const SYSTEM_PROMPT = _RAW_SYSTEM_PROMPT
  .replace(/\{\{BRANCH_NAME\}\}/g, config.BRANCH_NAME)
  .replace(/\{\{BRANCH_ADDRESS\}\}/g, config.BRANCH_ADDRESS);

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

// Foreign customer chat — responds in their language with RedBox context
const FOREIGN_SYSTEM_PROMPT = `You are "Reddy", the friendly AI assistant for RedBox Barbershop in Cirebon, Indonesia.

IMPORTANT: You MUST respond in the SAME LANGUAGE the customer is using. If they write in English, respond in English. If Chinese, respond in Chinese. If Japanese, respond in Japanese. If Turkish, respond in Turkish. And so on.

CONTEXT:
- RedBox Barbershop has been a premium barbershop in Cirebon since 2014
- 5 branches: Bypass (Jl. Ahmad Yani No.88), CSB Mall (Lt.1), Samadikun, Sumber, Tegal
- Operating hours: Daily 10:00-21:00 (CSB Mall until 22:00)
- Payment: Cash or QRIS (all e-wallets accepted)

SERVICES & PRICES:
• Gentleman Grooming — IDR 95k (45 min) — Premium modern haircut with fade
• Hair Spa — IDR 110k (30 min) — Hair health treatment
• Hair Color — IDR 160k (45 min) — Professional coloring
• Shaving — IDR 40k (20 min) — Beard/mustache grooming
• Men Massage — IDR 145k (45 min) — Relaxation massage

YOUR ROLE:
- Answer questions about services, prices, branches, and barbers
- Be warm, helpful, and concise (max 3-4 sentences)
- Use 1-2 emojis per message
- If they want to book, guide them to tell you: service, preferred barber, date, and time
- NEVER redirect to website — foreign customers get personal chat booking service
- You are collecting info for a manual booking (admin will enter it in Moka POS)

TONE: Friendly, professional, welcoming — like a helpful concierge for a tourist`;

const chatForeign = async (phone, name, userMessage, language) => {
  addToContext(phone, 'user', userMessage);

  const systemMessage = `${FOREIGN_SYSTEM_PROMPT}\n\nCUSTOMER NAME: ${name}\nCUSTOMER LANGUAGE: ${language}\n\nRespond ONLY in ${language}. Keep it short and helpful. If they seem to want to book, ask what service they'd like.`;

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

  const reply = response.choices[0]?.message?.content?.trim() || 'Sorry, there was a brief issue. Please try again 🙏';
  const tokensUsed = response.usage?.total_tokens || 0;

  addToContext(phone, 'assistant', reply);
  logger.logTokenUsage(phone, tokensUsed);

  return { reply, tokensUsed };
};

module.exports = { chat, chatForeign, clearContext, getContext };
