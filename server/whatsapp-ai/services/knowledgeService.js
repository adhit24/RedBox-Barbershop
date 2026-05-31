const fs = require('fs');
const path = require('path');

const load = (filename) => {
  const filePath = path.join(__dirname, '../knowledge', filename);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
};

// Format services list for reply
const getServicesText = () => {
  const { services } = load('services.json');
  const lines = services.map(s => `• *${s.name}* — ${s.price} (${s.duration})`);
  return `Layanan RedBox Barbershop ✂️\n\n${lines.join('\n')}\n\nMau booking atau ada yang ditanyain kak? 😊`;
};

// Match FAQ by keyword
const matchFaq = (text) => {
  const { faq } = load('faq.json');
  const lower = text.toLowerCase();
  return faq.find(f => f.keywords.some(kw => lower.includes(kw))) || null;
};

// Build context string for AI
const buildKnowledgeContext = () => {
  const { services } = load('services.json');
  const { faq } = load('faq.json');

  const serviceList = services.map(s => `${s.name} (${s.price}, ${s.duration})`).join(', ');
  const faqList = faq.map(f => `Q: ${f.question} → A: ${f.answer}`).join('\n');

  return `=== LAYANAN ===\n${serviceList}\n\n=== FAQ ===\n${faqList}`;
};

// Build multilingual service list for foreign customers
const getServicesForForeign = () => {
  const { services } = load('services.json');
  const english = services.map(s => `• ${s.name} — IDR ${s.price} (${s.duration})`).join('\n');
  const chinese = services.map(s => `• ${s.name} — ${s.price}印尼盾 (${s.duration})`).join('\n');
  const japanese = services.map(s => `• ${s.name} — ${s.price}ルピア (${s.duration})`).join('\n');
  const korean = services.map(s => `• ${s.name} — ${s.price}루피아 (${s.duration})`).join('\n');
  const turkish = services.map(s => `• ${s.name} — ${s.price} IDR (${s.duration})`).join('\n');
  return { english, chinese, japanese, korean, turkish };
};

module.exports = { getServicesText, matchFaq, buildKnowledgeContext, getServicesForForeign };
