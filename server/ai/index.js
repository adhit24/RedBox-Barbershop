/**
 * AI Module Entry Point
 * Integrates AI Grooming Assistant with main server
 */

const aiRoutes = require('./routes/aiRoutes');

// Mount AI routes to main app
const mountAIRoutes = (app) => {
  app.use('/api/ai', aiRoutes);
  console.log('✅ AI Routes mounted at /api/ai');
};

module.exports = { mountAIRoutes };
