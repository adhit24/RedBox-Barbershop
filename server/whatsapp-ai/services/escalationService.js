const config = require('../config');
const whatsappService = require('./whatsappService');
const logger = require('../utils/logger');

const shouldEscalate = (text) => {
  const lower = text.toLowerCase();
  return config.ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
};

const escalate = async (from, name, text) => {
  const msg = `Aduh maaf banget kak ${name} 🙏 Aku langsung terusin ke admin kami ya, biar bisa ditangani lebih cepat dan tepat.\n\nSebentar ya kak, admin akan segera menghubungi 🙏`;
  await whatsappService.sendText(from, msg);

  logger.logEscalation(from, name, text);

  // Optionally notify admin
  if (config.ADMIN_WHATSAPP) {
    const adminMsg = `⚠️ *ESCALATION ALERT*\n\nPelanggan: ${name} (${from})\nPesan: "${text}"\nWaktu: ${new Date().toLocaleString('id-ID')}`;
    try {
      await whatsappService.sendText(config.ADMIN_WHATSAPP, adminMsg);
    } catch (err) {
      console.error('[Escalation] Failed to notify admin:', err.message);
    }
  }
};

module.exports = { shouldEscalate, escalate };
