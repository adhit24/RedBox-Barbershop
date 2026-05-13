const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

const WA_URL = `${config.WA_API_URL}/${config.WA_PHONE_NUMBER_ID}/messages`;

const headers = () => ({
  Authorization: `Bearer ${config.WA_ACCESS_TOKEN}`,
  'Content-Type': 'application/json',
});

// Send a plain text message
const sendText = async (to, text, retries = 2) => {
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: text },
  };

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const res = await axios.post(WA_URL, payload, { headers: headers() });
      logger.logOutgoing(to, text);
      return res.data;
    } catch (err) {
      const status = err.response?.status;
      const errMsg = err.response?.data?.error?.message || err.message;

      console.error(`[WA] Send failed (attempt ${attempt}): ${errMsg}`);
      logger.logError('whatsapp_send', `To: ${to} | ${errMsg}`);

      if (attempt <= retries && status !== 400) {
        await sleep(1500 * attempt);
      } else {
        throw err;
      }
    }
  }
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

module.exports = { sendText };
