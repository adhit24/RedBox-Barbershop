require('dotenv').config();

const express = require('express');
const config = require('./config');
const webhookRoutes = require('./routes/webhook');
const { ensureLogDir } = require('./utils/logger');
const schedulerService = require('./services/schedulerService');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: config.BRAND_NAME + ' WhatsApp AI', timestamp: new Date().toISOString() });
});

// WhatsApp webhook
app.use('/webhook', webhookRoutes);

// 404
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Global error handler
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

async function start() {
  await ensureLogDir();
  app.listen(config.PORT, () => {
    console.log(`✅ ${config.BRAND_NAME} WhatsApp AI running on port ${config.PORT}`);
    console.log(`   Webhook: POST /webhook`);
    console.log(`   Health:  GET  /health`);
  });

  // Start reminder scheduler
  schedulerService.start();
}

start();
