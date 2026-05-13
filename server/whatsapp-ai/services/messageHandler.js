const config = require('../config');
const whatsappService = require('./whatsappService');
const knowledgeService = require('./knowledgeService');
const bookingService = require('./bookingService');
const aiService = require('./aiService');
const costGuard = require('../middleware/costGuard');
const escalationService = require('./escalationService');
const logger = require('../utils/logger');

const sendText = whatsappService.sendText;

// Route and handle an incoming message
const handle = async ({ from, name, text }) => {
  const lower = text.toLowerCase().trim();

  try {
    // 1. Check if booking flow is active for this user
    if (bookingService.isActive(from)) {
      const { reply } = bookingService.handle(from, name, text);
      await sendText(from, reply);
      return;
    }

    // 2. Escalation keywords — bypass AI, route to human
    if (escalationService.shouldEscalate(text)) {
      await escalationService.escalate(from, name, text);
      return;
    }

    // 3. Keyword triggers (fast, no AI cost)
    if (['harga', 'price', 'layanan', 'services', 'menu'].some(k => lower.includes(k))) {
      await sendText(from, knowledgeService.getServicesText());
      return;
    }

    if (['booking', 'reservasi', 'jadwal', 'pesan'].some(k => lower.includes(k))) {
      const { reply } = bookingService.handle(from, name, text);
      await sendText(from, reply);
      return;
    }

    // 4. FAQ match — cheap, no AI
    const faqMatch = knowledgeService.matchFaq(text);
    if (faqMatch) {
      await sendText(from, faqMatch.answer);
      return;
    }

    // 5. Greeting
    if (['halo', 'hai', 'hi', 'hello', 'assalamualaikum', 'selamat'].some(k => lower.startsWith(k))) {
      const hour = new Date().getHours();
      const greet = hour < 12 ? 'pagi' : hour < 15 ? 'siang' : hour < 18 ? 'sore' : 'malam';
      await sendText(from, `Halo ${name}! Selamat ${greet} ☀️\n\nAda yang bisa aku bantu? Mau lihat layanan, booking, atau nanya-nanya dulu? 😊`);
      return;
    }

    // 6. Cost guard before AI call
    const guardResult = costGuard.check(from);
    if (!guardResult.allowed) {
      await sendText(from, guardResult.message);
      return;
    }

    // 7. AI fallback
    const { reply, tokensUsed } = await aiService.chat(from, name, text);
    await sendText(from, reply);

    console.log(`[AI] ${from} → ${tokensUsed} tokens`);

  } catch (err) {
    console.error('[Handler] Error:', err.message);
    logger.logError('message_handler', `${from}: ${err.message}`);
    await sendText(from, 'Maaf kak, ada gangguan sebentar. Coba lagi ya 🙏');
  }
};

module.exports = { handle, sendText };
