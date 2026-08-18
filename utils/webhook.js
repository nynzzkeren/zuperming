const axios = require('axios');

async function sendWebhook(embed) {
    const url = process.env.LOG_WEBHOOK_URL;
    if (!url) return;

    try {
        await axios.post(url, { embeds: [embed] });
    } catch (err) {
        console.error('Failed to send webhook:', err.message);
    }
}

module.exports = { sendWebhook };
