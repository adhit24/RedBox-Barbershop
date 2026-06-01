const config = require('../config');
const messageHandler = require('../services/messageHandler');
const handoffStore = require('../services/handoffStore');
const logger = require('../utils/logger');

// Verify webhook with Meta challenge
const verify = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.WA_VERIFY_TOKEN) {
    console.log('[Webhook] Verified successfully');
    return res.status(200).send(challenge);
  }

  console.warn('[Webhook] Verification failed');
  return res.status(403).json({ error: 'Forbidden' });
};

// Detect if message is from business/admin (outbound message detected via statuses)
const detectAdminIntervention = (value) => {
  // Check statuses - when business sends message, we get status updates
  if (value?.statuses && value.statuses.length > 0) {
    const status = value.statuses[0];
    const recipientId = status.recipient_id; // Customer's phone number
    
    // If status is 'sent' or 'read', it means business recently interacted
    if (['sent', 'delivered', 'read'].includes(status.status)) {
      // Enable handoff when business sends message to customer (all branches)
      handoffStore.enableHandoff(recipientId, config.HANDOFF_DURATION_MINUTES || 30, 'cloud_api_status');
      console.log(`[Webhook] Admin intervention detected for ${recipientId}, handoff enabled (all branches)`);
    }
  }
};

// Receive and process incoming messages
const receive = async (req, res) => {
  // Always respond 200 immediately to Meta (required)
  res.status(200).send('EVENT_RECEIVED');

  try {
    const body = req.body;

    if (body.object !== 'whatsapp_business_account') return;

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    // Detect admin intervention via status updates
    detectAdminIntervention(value);

    // Ignore if no messages (might be just status updates)
    if (!value?.messages || value.messages.length === 0) return;

    const message = value.messages[0];
    const contact = value.contacts?.[0];
    const from = message.from;
    const name = contact?.profile?.name || 'Kak';
    const msgType = message.type;

    // Only handle text messages for now
    if (msgType !== 'text') {
      await messageHandler.sendText(from, 'Maaf kak, aku hanya bisa baca pesan teks untuk sekarang 🙏');
      return;
    }

    const text = message.text?.body?.trim();
    if (!text) return;

    logger.logIncoming(from, name, text);

    await messageHandler.handle({ from, name, text });

  } catch (err) {
    console.error('[Webhook] Error processing message:', err.message);
    logger.logError('webhook', err.message);
  }
};

module.exports = { verify, receive };
