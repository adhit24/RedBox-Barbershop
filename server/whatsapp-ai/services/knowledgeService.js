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

module.exports = { getServicesText, matchFaq, buildKnowledgeContext };
