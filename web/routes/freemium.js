const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../../database');
const { getBaseUrl } = require('../../config/products');
const https = require('https');

function getClientIp(req) {
    return req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip;
}

// Generate random ZFREE key
function generateFreemiumKey() {
    return 'ZFREE-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

router.post('/start', (req, res) => {
    const ip = getClientIp(req);
    const provider = req.body.provider || 'linkvertise';
    const cooldownHours = parseInt(process.env.FREEMIUM_COOLDOWN_HOURS || '24', 10);
    const cooldownMs = cooldownHours * 60 * 60 * 1000;

    // Check if IP recently got a key
    db.get(
        `SELECT created_at FROM freemium_sessions WHERE ip_address = ? AND status = 'completed' ORDER BY created_at DESC LIMIT 1`,
        [ip],
        (err, row) => {
            if (err) return res.status(500).json({ error: 'Database error' });

            if (row) {
                const lastCompleted = new Date(row.created_at + 'Z').getTime(); // SQLite CURRENT_TIMESTAMP is UTC
                if (Date.now() - lastCompleted < cooldownMs) {
                    const remainingHours = Math.ceil((cooldownMs - (Date.now() - lastCompleted)) / (60 * 60 * 1000));
                    return res.status(429).json({ error: `Cooldown active. Please wait ${remainingHours} hours before generating a new key.` });
                }
            }

            // Create a new session
            const sessionId = crypto.randomUUID();
            db.run(
                `INSERT INTO freemium_sessions (id, ip_address, status) VALUES (?, ?, 'pending')`,
                [sessionId, ip],
                (err) => {
                    if (err) return res.status(500).json({ error: 'Failed to create session' });
                    
                    const baseUrl = getBaseUrl();
                    const callbackUrl = encodeURIComponent(`${baseUrl}/api/freemium/callback?session_id=${sessionId}`);
                    
                    if (provider === 'lootlabs') {
                        const rawToken = process.env.LOOTLABS_API_TOKEN || process.env.LOOTLABS_URL;
                        let apiToken = rawToken;
                        
                        // Extract API key if user accidentally pasted the whole URL
                        if (rawToken && rawToken.includes('api_key=')) {
                            const match = rawToken.match(/api_key=([^&]+)/);
                            if (match) apiToken = match[1];
                        }
                        
                        if (!apiToken) return res.status(500).json({ error: 'LOOTLABS_API_TOKEN is not set in .env' });

                        const llUrl = `https://creators.lootlabs.gg/api/public/content_locker?api_token=${apiToken}&title=Zuperming+Key&url=${callbackUrl}&tier_id=1&number_of_tasks=4&theme=1`;
                        
                        https.get(llUrl, (apiRes) => {
                            let responseData = '';
                            apiRes.on('data', chunk => responseData += chunk);
                            apiRes.on('end', () => {
                                try {
                                    const json = JSON.parse(responseData);
                                    let lootUrl;
                                    
                                    // Handle both Object and Array responses because LootLabs docs vs actual response differ
                                    if (json && json.message) {
                                        if (Array.isArray(json.message) && json.message[0] && json.message[0].loot_url) {
                                            lootUrl = json.message[0].loot_url;
                                        } else if (json.message.loot_url) {
                                            lootUrl = json.message.loot_url;
                                        }
                                    }

                                    if (lootUrl) {
                                        return res.json({ success: true, redirect_url: lootUrl, session_id: sessionId });
                                    } else {
                                        console.error('LootLabs API Error:', json);
                                        return res.status(500).json({ error: 'Failed to generate LootLabs link (Check API Token)' });
                                    }
                                } catch (e) {
                                    console.error('LootLabs JSON Error:', e);
                                    return res.status(500).json({ error: 'Failed to parse LootLabs API response' });
                                }
                            });
                        }).on('error', (err) => {
                            console.error('LootLabs HTTP Error:', err);
                            return res.status(500).json({ error: 'Failed to connect to LootLabs API' });
                        });
                        return; // Stop execution here for lootlabs
                    } else {
                        adUrl = process.env.LINKVERTISE_URL || process.env.ADS_PROVIDER_URL;
                        if (!adUrl) adUrl = `${baseUrl}/api/freemium/callback?session_id={{DEST}}`;
                        adUrl = adUrl.replace('{{DEST}}', callbackUrl);
                        res.json({ success: true, redirect_url: adUrl, session_id: sessionId });
                    }
                }
            );
        }
    );
});

router.get('/callback', (req, res) => {
    let sessionId = req.query.session_id;
    if (Array.isArray(sessionId)) sessionId = sessionId[0];
    
    if (!sessionId) return res.redirect('/get-key?error=missing_session');

    // Verify session
    db.get(`SELECT * FROM freemium_sessions WHERE id = ?`, [sessionId], (err, session) => {
        if (err) return res.redirect('/get-key?error=database_error');
        if (!session) return res.redirect('/get-key?error=invalid_session');
        if (session.status === 'completed') {
            return res.redirect(`/get-key?session_id=${sessionId}`); // Already completed
        }

        // Generate key and complete session
        const newKey = generateFreemiumKey();
        const duration = process.env.FREEMIUM_KEY_DURATION || '24h';

        db.run(
            `INSERT INTO keys (key_string, duration, status, product) VALUES (?, ?, 'unused', 'freemium')`,
            [newKey, duration],
            function (err) {
                if (err) return res.redirect('/get-key?error=key_generation_failed');
                
                db.run(
                    `UPDATE freemium_sessions SET status = 'completed', generated_key = ? WHERE id = ?`,
                    [newKey, sessionId],
                    (err) => {
                        res.redirect(`/get-key?session_id=${sessionId}`);
                    }
                );
            }
        );
    });
});

router.get('/status/:sessionId', (req, res) => {
    db.get(`SELECT status, generated_key FROM freemium_sessions WHERE id = ?`, [req.params.sessionId], (err, row) => {
        if (err || !row) return res.status(404).json({ error: 'Session not found' });
        res.json({ status: row.status, key: row.generated_key });
    });
});

module.exports = router;
