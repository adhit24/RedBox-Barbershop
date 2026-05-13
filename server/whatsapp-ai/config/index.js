require('dotenv').config();

module.exports = {
  // Server
  PORT: process.env.PORT || 3001,
  NODE_ENV: process.env.NODE_ENV || 'development',

  // WhatsApp Cloud API
  WA_PHONE_NUMBER_ID: process.env.WA_PHONE_NUMBER_ID,
  WA_ACCESS_TOKEN: process.env.WA_ACCESS_TOKEN,
  WA_VERIFY_TOKEN: process.env.WA_VERIFY_TOKEN,
  WA_API_URL: `https://graph.facebook.com/v19.0`,

  // OpenAI
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_MODEL: 'gpt-4o-mini',
  MAX_TOKENS: 300,
  MAX_CONTEXT_MESSAGES: 6,

  // Cost Protection
  RATE_LIMIT_WINDOW_MS: 60 * 1000,       // 1 minute window
  RATE_LIMIT_MAX: 5,                       // max 5 msgs per window per user
  COOLDOWN_MS: 3000,                       // 3s between messages
  DAILY_MSG_LIMIT: 30,                     // max 30 AI calls per user per day
  MAX_MSG_LENGTH: 500,                     // ignore messages > 500 chars

  // Human escalation keywords
  ESCALATION_KEYWORDS: ['komplain', 'refund', 'marah', 'kecewa', 'tipu', 'bohong', 'minta uang kembali', 'lapor'],

  // Business info
  BRAND_NAME: 'RedBox Barbershop',
  BRAND_ADDRESS: process.env.BRAND_ADDRESS || 'RedBox Barbershop',
  ADMIN_WHATSAPP: process.env.ADMIN_WHATSAPP || '',

  // Branch WhatsApp numbers for dispatch forwarding
  // Format: 628xxxxxxxxxx (no + or spaces)
  BRANCH_WA: {
    bypass:    process.env.WA_BRANCH_BYPASS    || '',
    csb:       process.env.WA_BRANCH_CSB       || '',
    samadikun: process.env.WA_BRANCH_SAMADIKUN || '',
    sumber:    process.env.WA_BRANCH_SUMBER    || '',
    tegal:     process.env.WA_BRANCH_TEGAL     || '',
  },
};
