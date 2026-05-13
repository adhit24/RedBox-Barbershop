const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');
const { rateLimiter } = require('../middleware/rateLimiter');

// Webhook verification (GET) — required by Meta
router.get('/', webhookController.verify);

// Incoming messages (POST)
router.post('/', rateLimiter, webhookController.receive);

module.exports = router;
