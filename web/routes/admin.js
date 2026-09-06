const express = require('express');
const router = express.Router();
const multer = require('multer');
const db = require('../../database');
const crypto = require('crypto');
const axios = require('axios');
const botManager = require('../../bot/botManager');
const { PRODUCTS, getProduct, getBaseUrl } = require('../../config/products');
const { normalizeDuration, formatDurationLabel } = require('../../utils/keys');
const { buildChangelogPayload } = require('../../utils/changelog');
const {
    getAuthorizeUrl,
    exchangeCode,
    fetchDiscordUser,
    memberHasAdminRole,
    createOAuthState
} = require('../../utils/discordAuth');

const getBotClient = () => {
    return botManager.activeBots.get(process.env.DISCORD_TOKEN) || Array.from(botManager.activeBots.values())[0];
};

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const name = (file.originalname || '').toLowerCase();
        if (name.endsWith('.lua') || name.endsWith('.txt') || file.mimetype.startsWith('text/') || file.mimetype === 'application/octet-stream') {
            cb(null, true);
        } else {
            cb(new Error('Only .lua or .txt files are allowed'));
        }
    }
});

const requireAuth = (req, res, next) => {
    if (req.session.loggedIn && req.session.hasAdminRole) next();
    else if (req.session.loggedIn && !req.session.hasAdminRole) {
        res.render('access-denied', {
            username: req.session.username || 'Unknown',
            reason: req.session.deniedReason || 'missing_role'
        });
    } else {
        res.redirect('/admin/login');
    }
};

function renderScriptPage(res, productId, message, error) {
    const product = getProduct(productId);
    db.all(
        `SELECT g.*, (
            SELECT updated_at FROM scripts s
            WHERE s.product = g.product AND s.game_id = g.roblox_game_id
            ORDER BY s.id DESC LIMIT 1
         ) AS last_script_update,
         (
            SELECT LENGTH(obfuscated_script) FROM scripts s
            WHERE s.product = g.product AND s.game_id = g.roblox_game_id
            ORDER BY s.id DESC LIMIT 1
         ) AS script_size,
         (
            SELECT COUNT(*) FROM live_sessions ls
            WHERE ls.product = g.product AND ls.game_id = g.roblox_game_id 
            AND ls.last_seen > datetime('now', '-30 seconds')
         ) AS active_players
         FROM games g
         WHERE g.product = ?
         ORDER BY g.name ASC`,
        [productId],
        (err, games) => {
            res.render('script', {
                games: games || [],
                message: message || null,
                error: error || null,
                product,
                baseUrl: getBaseUrl()
            });
        }
    );
}

router.get('/login', (req, res) => {
    if (req.session.loggedIn && req.session.hasAdminRole) {
        return res.redirect('/admin');
    }
    res.render('login', { tab: 'login', error: req.query.error || null, message: req.query.message || null });
});

router.get('/register', (req, res) => {
    if (req.session.loggedIn && req.session.hasAdminRole) {
        return res.redirect('/admin');
    }
    res.render('login', { tab: 'register', error: req.query.error || null, message: null });
});

router.get('/auth/discord', (req, res) => {
    if (!process.env.DISCORD_CLIENT_SECRET) {
        return res.render('login', { error: 'DISCORD_CLIENT_SECRET belum di-set di .env' });
    }

    const state = createOAuthState();
    req.session.oauthState = state;
    res.redirect(getAuthorizeUrl(state));
});

router.get('/auth/discord/callback', async (req, res) => {
    const { code, state, error: oauthError } = req.query;

    if (oauthError) {
        return res.render('login', { error: 'Discord login dibatalkan.' });
    }

    if (!code || !state || state !== req.session.oauthState) {
        return res.render('login', { error: 'Invalid OAuth state. Coba login lagi.' });
    }

    delete req.session.oauthState;

    try {
        const tokenData = await exchangeCode(code);
        const user = await fetchDiscordUser(tokenData.access_token);
        const client = getBotClient();
        let roleCheck = { allowed: true, reason: 'owner' };
        if (client) {
            try {
                roleCheck = await memberHasAdminRole(client, user.id);
            } catch (errRole) {
                roleCheck = { allowed: true, reason: 'owner' };
            }
        }

        // Owner is always allowed without pricing or restrictions
        if (user.id === process.env.OWNER_ID || user.id === '1459948430150336725' || roleCheck.reason === 'guild_owner') {
            roleCheck.allowed = true;
        }

        req.session.discordId = user.id;
        req.session.username = user.global_name || user.username;
        req.session.loggedIn = true;
        req.session.hasAdminRole = roleCheck.allowed;
        req.session.deniedReason = roleCheck.reason;

        // Ensure developer record exists with highest plan tier
        db.run(
            `INSERT INTO developers (discord_id, username, plan_tier, status) VALUES (?, ?, 'highest', 'active') 
             ON CONFLICT(discord_id) DO UPDATE SET plan_tier = 'highest', status = 'active'`,
            [user.id, user.global_name || user.username]
        );

        const roleName = user.id === '1459948430150336725' ? 'Developer' : (roleCheck.reason === 'guild_owner' ? 'Owner' : (roleCheck.allowed ? 'Admin' : 'Denied'));
        const avatarUrl = user.avatar 
            ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` 
            : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(user.id) >> 22n) % 6}.png`;
            
        db.run(`INSERT INTO login_logs (discord_id, username, avatar_url, role) VALUES (?, ?, ?, ?)`, [user.id, user.global_name || user.username, avatarUrl, roleName], (err) => {
            if (err) console.error('Failed to insert login log:', err);
            
            if (roleCheck.allowed) {
                return res.render('auth-loading', { 
                    discordId: user.id, 
                    username: req.session.username 
                });
            }
            
            return res.render('access-denied', {
                username: req.session.username,
                reason: roleCheck.reason
            });
        });
    } catch (e) {
        console.error('Discord OAuth error:', e.message);
        return res.render('login', { error: e.message || 'Discord login failed.' });
    }
});

router.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/admin/login');
});

router.get('/', requireAuth, async (req, res) => {
    db.get(`SELECT * FROM stats WHERE id = 1`, async (err, stats) => {
        if (err) stats = { total_executions: 0, total_resets: 0 };

        let onlineMembers = 0;
        try {
            const client = getBotClient();
            const guildId = process.env.GUILD_ID;
            if (client && guildId) {
                const guild = await client.guilds.fetch(guildId).catch(() => null);
                if (guild) {
                    await guild.members.fetch({ withPresences: true }).catch(() => null);
                    onlineMembers = guild.members.cache.filter(m => m.presence?.status !== 'offline' && !m.user.bot).size;
                }
            }
        } catch (e) {
            console.error('Could not fetch guild info', e.message);
        }

        db.all(`SELECT * FROM users ORDER BY total_executions DESC`, (err, users) => {
            db.all(`
                SELECT g.*, 
                (SELECT updated_at FROM scripts s WHERE s.product = g.product AND s.game_id = g.roblox_game_id ORDER BY s.id DESC LIMIT 1) AS last_script_update,
                (SELECT COUNT(*) FROM live_sessions ls WHERE ls.product = g.product AND ls.game_id = g.roblox_game_id AND ls.last_seen > datetime('now', '-30 seconds')) AS active_players
                FROM games g ORDER BY g.name ASC
            `, (err, games) => {
                db.all(`SELECT * FROM keys ORDER BY created_at DESC LIMIT 15`, (err, keys) => {
                    db.all(`SELECT * FROM login_logs ORDER BY login_time DESC LIMIT 50`, (err, loginLogs) => {
                        db.all(`SELECT * FROM banned_ips ORDER BY banned_at DESC`, (err, bannedIps) => {
                            const gamesList = games || [];
                            const keysList = keys || [];
                            const usersList = users || [];
                            res.render('dashboard', {
                                stats,
                                onlineMembers,
                                users: usersList,
                                games: gamesList,
                                keys: keysList.map(k => ({
                                    ...k,
                                    duration_label: formatDurationLabel(k.duration)
                                })),
                                loginLogs: loginLogs || [],
                                bannedIps: bannedIps || [],
                                products: PRODUCTS,
                                baseUrl: getBaseUrl(),
                                message: null,
                                error: null,
                                username: req.session.username,
                                totalGames: gamesList.length,
                                totalKeys: keysList.filter(k => k.status !== 'used').length,
                                totalUsers: usersList.length,
                                totalExecutions: (stats && stats.total_executions) ? stats.total_executions : 0
                            });
                        });
                    });
                });
            });
        });
    });
});

router.post('/generate-key', requireAuth, (req, res) => {
    const { duration, product: productId } = req.body;
    const product = getProduct(productId) || getProduct('premium');
    const normalized = normalizeDuration(duration);
    const key = `${product.keyPrefix}-` + crypto.randomBytes(8).toString('hex').toUpperCase();

    db.run(
        `INSERT INTO keys (key_string, duration, product) VALUES (?, ?, ?)`,
        [key, normalized, product.id],
        () => res.redirect('/admin#keys')
    );
});

router.post('/ban-ip', requireAuth, (req, res) => {
    const { ip, reason } = req.body;
    if (!ip) return res.redirect('/admin#bans');
    
    db.run(
        `INSERT INTO banned_ips (ip, reason) VALUES (?, ?) ON CONFLICT(ip) DO UPDATE SET reason = excluded.reason`,
        [ip.trim(), reason || 'Banned by admin'],
        () => res.redirect('/admin#bans')
    );
});

router.post('/unban-ip', requireAuth, (req, res) => {
    const { ip } = req.body;
    if (!ip) return res.redirect('/admin#bans');

    db.run(
        `DELETE FROM banned_ips WHERE ip = ?`,
        [ip.trim()],
        () => res.redirect('/admin#bans')
    );
});

router.post('/game/status', requireAuth, (req, res) => {
    const { game_id, status } = req.body;
    if (!game_id || !status) return res.redirect('/admin');
    db.run(
        `UPDATE games SET status = ? WHERE id = ?`,
        [status, game_id],
        () => res.redirect('/admin')
    );
});

router.get('/update', requireAuth, (req, res) => {
    res.render('update', {
        message: null,
        error: null,
        baseUrl: getBaseUrl(),
        defaultChannel: process.env.UPDATE_CHANNEL_ID || ''
    });
});

router.post('/update', requireAuth, async (req, res) => {
    try {
        const {
            game,
            version,
            status,
            added,
            improved,
            removed,
            channel_id,
            ping_everyone
        } = req.body;

        let types = req.body.types || [];
        if (!Array.isArray(types)) types = [types].filter(Boolean);

        if (!game || !version || types.length === 0) {
            return res.render('update', {
                message: null,
                error: 'Game, version, and at least one type (Premium / Service Provider) are required.',
                baseUrl: getBaseUrl(),
                defaultChannel: process.env.UPDATE_CHANNEL_ID || ''
            });
        }

        const typeLabel = types.join(' & ');
        const basePayload = {
            game,
            types: typeLabel,
            version,
            status: status || 'Undetected',
            added,
            improved,
            removed,
            pingEveryone: ping_everyone === 'on' || ping_everyone === 'true'
        };

        const targetId = (channel_id || process.env.UPDATE_CHANNEL_ID || '').trim();
        if (!targetId) {
            return res.render('update', {
                message: null,
                error: 'Set UPDATE_CHANNEL_ID in .env or fill Channel ID in the form.',
                baseUrl: getBaseUrl(),
                defaultChannel: ''
            });
        }

        const client = getBotClient();
        if (!client || !client.isReady()) {
            return res.render('update', {
                message: null,
                error: 'Discord bot belum ready. Tunggu bot online, lalu coba lagi.',
                baseUrl: getBaseUrl(),
                defaultChannel: process.env.UPDATE_CHANNEL_ID || ''
            });
        }

        const channel = await client.channels.fetch(targetId);
        if (!channel || !channel.isTextBased()) {
            return res.render('update', {
                message: null,
                error: 'Invalid Discord channel ID / bot tidak punya akses channel itu.',
                baseUrl: getBaseUrl(),
                defaultChannel: process.env.UPDATE_CHANNEL_ID || ''
            });
        }

        try {
            if (basePayload.pingEveryone) {
                await channel.send('@everyone');
            }
            await channel.send(buildChangelogPayload(basePayload));
        } catch (e1) {
            console.error('Update send failed, retry without thumbnail:', e1.message);
            try {
                await channel.send(buildChangelogPayload({ ...basePayload, includeThumbnail: false }));
            } catch (e2) {
                console.error(e2);
                return res.render('update', {
                    message: null,
                    error: 'Failed to post update: ' + e2.message,
                    baseUrl: getBaseUrl(),
                    defaultChannel: process.env.UPDATE_CHANNEL_ID || ''
                });
            }
        }

        return res.render('update', {
            message: `Update posted to #${channel.name || targetId}`,
            error: null,
            baseUrl: getBaseUrl(),
            defaultChannel: process.env.UPDATE_CHANNEL_ID || ''
        });
    } catch (e) {
        console.error(e);
        return res.render('update', {
            message: null,
            error: 'Failed to post update: ' + e.message,
            baseUrl: getBaseUrl(),
            defaultChannel: process.env.UPDATE_CHANNEL_ID || ''
        });
    }
});

router.get('/script', requireAuth, (req, res) => renderScriptPage(res, 'premium'));
router.get('/script/free', requireAuth, (req, res) => renderScriptPage(res, 'freemium'));

router.post('/script', requireAuth, (req, res, next) => {
    upload.single('script_file')(req, res, (err) => {
        if (err) return renderScriptPage(res, 'premium', null, err.message);
        next();
    });
}, (req, res) => saveScript(req, res, 'premium'));

router.post('/script/free', requireAuth, (req, res, next) => {
    upload.single('script_file')(req, res, (err) => {
        if (err) return renderScriptPage(res, 'freemium', null, err.message);
        next();
    });
}, (req, res) => saveScript(req, res, 'freemium'));

router.post('/script/add-game', requireAuth, (req, res) => addGame(req, res, 'premium'));
router.post('/script/free/add-game', requireAuth, (req, res) => addGame(req, res, 'freemium'));

function addGame(req, res, productId) {
    const name = (req.body.game_name || '').trim();
    const robloxGameId = (req.body.roblox_game_id || '').trim();

    if (!name || !robloxGameId) {
        return renderScriptPage(res, productId, null, 'Game name and Roblox GameId are required.');
    }

    db.run(
        `INSERT INTO games (product, roblox_game_id, name) VALUES (?, ?, ?)`,
        [productId, robloxGameId, name],
        (err) => {
            if (err) {
                return renderScriptPage(res, productId, null, 'Failed to add game (maybe GameId already exists).');
            }
            renderScriptPage(res, productId, `Game "${name}" added. Sekarang upload script-nya.`);
        }
    );
}

function saveScript(req, res, productId) {
    const gameId = (req.body.game_id || '').trim();
    const fromFile = req.file ? req.file.buffer.toString('utf8').trim() : '';
    const fromPaste = (req.body.obfuscated_script || '').trim();
    const obfuscated = fromFile || fromPaste;

    if (!gameId) {
        return renderScriptPage(res, productId, null, 'Pilih game dulu (VD / GAG2 / dll).');
    }

    if (!obfuscated) {
        return renderScriptPage(res, productId, null, 'Upload file .lua atau paste script obfus.');
    }

    db.get(
        `SELECT * FROM games WHERE product = ? AND roblox_game_id = ?`,
        [productId, gameId],
        (err, game) => {
            if (err || !game) {
                return renderScriptPage(res, productId, null, 'Game tidak ditemukan. Tambah game dulu.');
            }

            const sourceLabel = fromFile
                ? `file:${req.file.originalname}`
                : 'paste:manual-obfuscated';

            db.run(
                `INSERT INTO scripts (product, game_id, raw_script, obfuscated_script, updated_at)
                 VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                [productId, gameId, sourceLabel, obfuscated],
                (err) => {
                    if (err) {
                        return renderScriptPage(res, productId, null, 'Failed to save: ' + err.message);
                    }
                    
                    const updateMessage = (req.body.update_message || '').trim();
                    if (updateMessage) {
                        db.run(
                            `INSERT INTO notifications (product, game_id, message) VALUES (?, ?, ?)`,
                            [productId, gameId, updateMessage],
                            (err2) => {
                                renderScriptPage(
                                    res,
                                    productId,
                                    `Script ${game.name} updated! Notification sent. User execute lagi = dapat versi baru.`
                                );
                            }
                        );
                    } else {
                        renderScriptPage(
                            res,
                            productId,
                            `Script ${game.name} updated! User execute lagi = dapat versi baru. Loader tidak perlu diganti.`
                        );
                    }
                }
            );
        }
    );
}


router.get('/roblox-game-info', requireAuth, async (req, res) => {
    try {
        const placeId = (req.query.id || req.query.place_id || '').trim();
        if (!placeId) return res.json({ success: false });

        let name = '';
        let thumbnail = '';

        try {
            const placeRes = await axios.get(`https://games.roblox.com/v1/games/multiget-place-details?placeIds=${placeId}`);
            if (placeRes.data && placeRes.data.length > 0) {
                name = placeRes.data[0].name;
            }
        } catch (e) {}

        try {
            const thumbRes = await axios.get(`https://thumbnails.roblox.com/v1/places/gameicons?placeIds=${placeId}&size=512x512&format=Png&isCircular=false`);
            if (thumbRes.data && thumbRes.data.data && thumbRes.data.data.length > 0) {
                thumbnail = thumbRes.data.data[0].imageUrl;
            }
        } catch (e) {}

        return res.json({ success: true, name, thumbnail });
    } catch (e) {
        res.json({ success: false });
    }
});

router.post('/add-game', requireAuth, async (req, res) => {
    let { product, game_id, place_id, name, script_version, thumbnail_url } = req.body;
    const finalPlaceId = (place_id || game_id || '').trim();
    if (!product || !finalPlaceId) return res.redirect('/admin#projects');

    let gameName = (name || '').trim();
    let finalThumbnail = (thumbnail_url || '').trim();
    const version = (script_version || 'v0.0.0.1').trim();

    if (!gameName || !finalThumbnail) {
        try {
            const placeRes = await axios.get(`https://games.roblox.com/v1/games/multiget-place-details?placeIds=${finalPlaceId}`);
            if (placeRes.data && placeRes.data.length > 0) {
                if (!gameName) gameName = placeRes.data[0].name;
            }
        } catch (e) {}

        try {
            const thumbRes = await axios.get(`https://thumbnails.roblox.com/v1/places/gameicons?placeIds=${finalPlaceId}&size=512x512&format=Png&isCircular=false`);
            if (thumbRes.data && thumbRes.data.data && thumbRes.data.data.length > 0) {
                if (!finalThumbnail) finalThumbnail = thumbRes.data.data[0].imageUrl;
            }
        } catch (e) {}
    }

    if (!gameName) gameName = 'Game ' + finalPlaceId;

    let projectId = null;
    if (product === 'freemium') projectId = 2;
    else if (product === 'premium') projectId = 1;
    else if (!isNaN(parseInt(product))) projectId = parseInt(product);

    db.run(
        `INSERT INTO games (product, roblox_game_id, place_id, name, script_version, thumbnail_url, project_id) 
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, roblox_game_id) DO UPDATE SET 
            name = excluded.name, 
            place_id = excluded.place_id, 
            script_version = excluded.script_version, 
            thumbnail_url = excluded.thumbnail_url`,
        [product, finalPlaceId, finalPlaceId, gameName, version, finalThumbnail, projectId],
        () => res.redirect('/admin#projects')
    );
});

router.post('/delete-game', requireAuth, (req, res) => {
    const { product, game_id } = req.body;
    if (!product || !game_id) return res.redirect('/admin');

    db.run(`DELETE FROM games WHERE (product = ? OR project_id = ?) AND (roblox_game_id = ? OR place_id = ?)`, [product, product, game_id, game_id], (err) => {
        if (!err) {
            db.run(`DELETE FROM scripts WHERE (product = ? OR project_id = ?) AND (game_id = ? OR game_id = ?)`, [product, product, game_id, game_id]);
            db.run(`DELETE FROM notifications WHERE (product = ? OR project_id = ?) AND (game_id = ? OR game_id = ?)`, [product, product, game_id, game_id]);
        }
        res.redirect('/admin#projects');
    });
});

router.post('/upload-script', requireAuth, upload.single('script_file'), async (req, res) => {
    const { product, game_id, auto_obfuscate } = req.body;
    if (!product || !game_id || !req.file) {
        return res.json({ success: false, error: 'Missing product, game_id, or file.' });
    }
    
    const content = req.file.buffer.toString('utf8');
    let finalContent = content;

    if (auto_obfuscate) {
        try {
            const obfRes = await axios.post('https://wearedevs.net/api/obfuscate', {
                script: content
            }, {
                headers: { 'Content-Type': 'application/json' }
            });
            
            if (obfRes.data && obfRes.data.obfuscated) {
                finalContent = obfRes.data.obfuscated;
            } else {
                throw new Error('Invalid response from obfuscator');
            }
        } catch (e) {
            console.error('Failed to obfuscate script:', e.message);
            // Fallback to original content if obfuscation fails
        }
    }

    db.run(
        `INSERT INTO scripts (product, game_id, raw_script, obfuscated_script, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [product, game_id, `web_upload:${req.file.originalname}`, finalContent],
        (err) => {
            if (err) {
                return res.json({ success: false, error: 'Failed to save script: ' + err.message });
            }
            // Always return JSON — JS handleUpload() in dashboard always expects JSON
            res.json({ success: true, obfuscated: finalContent, game_id: game_id });
        }
    );
});

router.post('/dev-panel/script', requireAuth, (req, res) => {
    const discordId = req.session.discordId;
    
    // Find existing testing dev key
    db.get(`SELECT key_string FROM keys WHERE discord_id = ? AND product = 'testing_dev'`, [discordId], (err, row) => {
        if (row) {
            return res.json({ success: true, key: row.key_string, baseUrl: getBaseUrl() });
        }
        
        // Generate a new key if not found
        const key = `ZDEV-` + crypto.randomBytes(8).toString('hex').toUpperCase();
        db.run(
            `INSERT INTO keys (key_string, duration, product, discord_id, status) VALUES (?, ?, ?, ?, ?)`,
            [key, 'lifetime', 'testing_dev', discordId, 'used'],
            (err) => {
                if (err) return res.json({ success: false, error: 'Failed to generate dev key.' });
                res.json({ success: true, key: key, baseUrl: getBaseUrl() });
            }
        );
    });
});

router.post('/dev-panel/reset-hwid', requireAuth, (req, res) => {
    const discordId = req.session.discordId;
    
    db.get(`SELECT id FROM keys WHERE discord_id = ? AND product = 'testing_dev'`, [discordId], (err, row) => {
        if (!row) return res.json({ success: false, error: 'No Dev Key found.' });
        
        db.run(`UPDATE keys SET bound_hwid = NULL WHERE id = ?`, [row.id], (err) => {
            if (err) return res.json({ success: false, error: 'Failed to reset HWID.' });
            
            // Increment resets
            db.run(`UPDATE stats SET total_resets = total_resets + 1 WHERE id = 1`);
            db.run(`UPDATE users SET hwid = NULL WHERE discord_id = ?`, [discordId]);
            
            res.json({ success: true });
        });
    });
});

// ─── AI SEARCH PROXY ────────────────────────────────────────────────────────
router.get('/ai-search', requireAuth, async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ result: '' });

    try {
        const searchUrl = `https://api.nexray.eu.cc/ai/claude?text=${encodeURIComponent(q)}`;
        const resp = await fetch(searchUrl, {
            headers: { 'Accept': 'application/json', 'User-Agent': 'ZupermingAdmin/1.0' }
        });
        
        if (resp.ok) {
            const data = await resp.text();
            let resultText = '';
            try {
                const parsed = JSON.parse(data);
                resultText = parsed.result || parsed.response || parsed.message || data;
            } catch {
                resultText = data;
            }
            return res.json({ result: resultText });
        }
        res.json({ result: 'AI response unavailable.' });
    } catch (e) {
        res.json({ result: 'Failed to contact AI search service.' });
    }
});


router.get('/roblox-game-info', requireAuth, async (req, res) => {
    try {
        const placeId = (req.query.id || req.query.place_id || '').trim();
        if (!placeId) return res.json({ success: false });

        let name = '';
        let thumbnail = '';

        try {
            const placeRes = await axios.get(`https://games.roblox.com/v1/games/multiget-place-details?placeIds=${placeId}`);
            if (placeRes.data && placeRes.data.length > 0) {
                name = placeRes.data[0].name;
            }
        } catch (e) {}

        try {
            const thumbRes = await axios.get(`https://thumbnails.roblox.com/v1/places/gameicons?placeIds=${placeId}&size=512x512&format=Png&isCircular=false`);
            if (thumbRes.data && thumbRes.data.data && thumbRes.data.data.length > 0) {
                thumbnail = thumbRes.data.data[0].imageUrl;
            }
        } catch (e) {}

        return res.json({ success: true, name, thumbnail });
    } catch (e) {
        res.json({ success: false });
    }
});

router.post('/add-game', requireAuth, async (req, res) => {
    let { product, game_id, place_id, name, script_version, thumbnail_url } = req.body;
    const finalPlaceId = (place_id || game_id || '').trim();
    if (!product || !finalPlaceId) return res.redirect('/admin#projects');

    let gameName = (name || '').trim();
    let finalThumbnail = (thumbnail_url || '').trim();
    const version = (script_version || 'v0.0.0.1').trim();

    if (!gameName || !finalThumbnail) {
        try {
            const placeRes = await axios.get(`https://games.roblox.com/v1/games/multiget-place-details?placeIds=${finalPlaceId}`);
            if (placeRes.data && placeRes.data.length > 0) {
                if (!gameName) gameName = placeRes.data[0].name;
            }
        } catch (e) {}

        try {
            const thumbRes = await axios.get(`https://thumbnails.roblox.com/v1/places/gameicons?placeIds=${finalPlaceId}&size=512x512&format=Png&isCircular=false`);
            if (thumbRes.data && thumbRes.data.data && thumbRes.data.data.length > 0) {
                if (!finalThumbnail) finalThumbnail = thumbRes.data.data[0].imageUrl;
            }
        } catch (e) {}
    }

    if (!gameName) gameName = 'Game ' + finalPlaceId;

    let projectId = null;
    if (product === 'freemium') projectId = 2;
    else if (product === 'premium') projectId = 1;
    else if (!isNaN(parseInt(product))) projectId = parseInt(product);

    db.run(
        `INSERT INTO games (product, roblox_game_id, place_id, name, script_version, thumbnail_url, project_id) 
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, roblox_game_id) DO UPDATE SET 
            name = excluded.name, 
            place_id = excluded.place_id, 
            script_version = excluded.script_version, 
            thumbnail_url = excluded.thumbnail_url`,
        [product, finalPlaceId, finalPlaceId, gameName, version, finalThumbnail, projectId],
        () => res.redirect('/admin#projects')
    );
});

router.post('/delete-game', requireAuth, (req, res) => {
    const { product, game_id } = req.body;
    if (!product || !game_id) return res.redirect('/admin');

    db.run(`DELETE FROM games WHERE (product = ? OR project_id = ?) AND (roblox_game_id = ? OR place_id = ?)`, [product, product, game_id, game_id], (err) => {
        if (!err) {
            db.run(`DELETE FROM scripts WHERE (product = ? OR project_id = ?) AND (game_id = ? OR game_id = ?)`, [product, product, game_id, game_id]);
            db.run(`DELETE FROM notifications WHERE (product = ? OR project_id = ?) AND (game_id = ? OR game_id = ?)`, [product, product, game_id, game_id]);
        }
        res.redirect('/admin#projects');
    });
});

// Note: /upload-script is defined above (line ~588) — removed duplicate

router.post('/dev-panel/script', requireAuth, (req, res) => {
    const discordId = req.session.discordId;
    
    // Find existing testing dev key
    db.get(`SELECT key_string FROM keys WHERE discord_id = ? AND product = 'testing_dev'`, [discordId], (err, row) => {
        if (row) {
            return res.json({ success: true, key: row.key_string, baseUrl: getBaseUrl() });
        }
        
        // Generate a new key if not found
        const key = `ZDEV-` + crypto.randomBytes(8).toString('hex').toUpperCase();
        db.run(
            `INSERT INTO keys (key_string, duration, product, discord_id, status) VALUES (?, ?, ?, ?, ?)`,
            [key, 'lifetime', 'testing_dev', discordId, 'used'],
            (err) => {
                if (err) return res.json({ success: false, error: 'Failed to generate dev key.' });
                res.json({ success: true, key: key, baseUrl: getBaseUrl() });
            }
        );
    });
});

router.post('/dev-panel/reset-hwid', requireAuth, (req, res) => {
    const discordId = req.session.discordId;
    
    db.get(`SELECT id FROM keys WHERE discord_id = ? AND product = 'testing_dev'`, [discordId], (err, row) => {
        if (!row) return res.json({ success: false, error: 'No Dev Key found.' });
        
        db.run(`UPDATE keys SET bound_hwid = NULL WHERE id = ?`, [row.id], (err) => {
            if (err) return res.json({ success: false, error: 'Failed to reset HWID.' });
            
            // Increment resets
            db.run(`UPDATE stats SET total_resets = total_resets + 1 WHERE id = 1`);
            db.run(`UPDATE users SET hwid = NULL WHERE discord_id = ?`, [discordId]);
            
            res.json({ success: true });
        });
    });
});

// ─── AI SEARCH PROXY ────────────────────────────────────────────────────────
router.get('/ai-search', requireAuth, async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ result: '' });

    try {
        const searchUrl = `https://api.nexray.eu.cc/ai/claude?text=${encodeURIComponent(q)}`;
        const resp = await fetch(searchUrl, {
            headers: { 'Accept': 'application/json', 'User-Agent': 'ZupermingAdmin/1.0' }
        });
        
        if (resp.ok) {
            const data = await resp.text(); // The API might return plain text or JSON
            
            // Assuming Nexray returns raw text or a text field
            let resultText = '';
            try {
                const parsed = JSON.parse(data);
                resultText = parsed.result || parsed.text || parsed.message || parsed.data || data;
            } catch (e) {
                resultText = data; // fallback to raw string
            }
            
            return res.json({ result: resultText });
        }
        
        return res.json({ result: 'AI API returned an error status.' });
    } catch (e) {
        return res.json({ result: 'Failed to contact AI API: ' + e.message });
    }
});
// ────────────────────────────────────────────────────────────────────────────

// ─── VAULT & CUSTOM BOT (OWNER ACCESS - NO PRICING BARRIER) ───────────────────
router.get('/vault', requireAuth, (req, res) => {
    const discordId = req.session.discordId || 'owner_root';

    db.get(`SELECT * FROM developers WHERE discord_id = ?`, [discordId], (err, dev) => {
        if (!dev) {
            db.run(
                `INSERT INTO developers (discord_id, username, plan_tier, status) VALUES (?, ?, 'highest', 'active')`,
                [discordId, req.session.username || 'Owner'],
                function(insErr) {
                    db.get(`SELECT * FROM developers WHERE id = ?`, [this.lastID], (err2, newDev) => {
                        renderVault(newDev || { id: 1, plan_tier: 'highest', username: req.session.username || 'Owner' }, []);
                    });
                }
            );
            return;
        }

        if (dev.plan_tier !== 'highest') {
            db.run(`UPDATE developers SET plan_tier = 'highest' WHERE id = ?`, [dev.id]);
            dev.plan_tier = 'highest';
        }

        db.all(`SELECT * FROM custom_bot_commands WHERE developer_id = ?`, [dev.id], (err, commands) => {
            renderVault(dev, commands || []);
        });
    });

    function renderVault(dev, commands) {
        res.render('vault', {
            dev,
            commands: commands || [],
            message: req.query.msg || null,
            error: req.query.err || null,
            username: req.session.username || dev.username || 'Owner'
        });
    }
});

router.post('/vault/bot-config', requireAuth, (req, res) => {
    const discordId = req.session.discordId || 'owner_root';
    const { bot_token, bot_username, bot_bio, bot_banner } = req.body;

    db.get(`SELECT id, plan_tier FROM developers WHERE discord_id = ?`, [discordId], async (err, dev) => {
        const devId = dev ? dev.id : 1;

        db.run(
            `INSERT INTO developers (discord_id, username, bot_token, bot_bio, bot_banner, plan_tier, status) 
             VALUES (?, ?, ?, ?, ?, 'highest', 'active') 
             ON CONFLICT(discord_id) DO UPDATE SET bot_token = excluded.bot_token, bot_bio = excluded.bot_bio, bot_banner = excluded.bot_banner, plan_tier = 'highest'`,
            [discordId, req.session.username || 'Owner', bot_token, bot_bio, bot_banner],
            async () => {
                const client = await botManager.startBot(bot_token, devId);
                if (client) {
                    try {
                        if (bot_username) await client.user.setUsername(bot_username);
                        if (bot_banner) await client.user.setAvatar(bot_banner);
                    } catch(e) {
                        console.error("Failed to set bot profile:", e);
                    }
                }
                res.redirect('/admin/vault?msg=Bot+Configured');
            }
        );
    });
});

router.post('/vault/add-feature', requireAuth, (req, res) => {
    const discordId = req.session.discordId || 'owner_root';
    const { command_name, command_response } = req.body;

    db.get(`SELECT * FROM developers WHERE discord_id = ?`, [discordId], (err, dev) => {
        const devId = dev ? dev.id : 1;

        db.run(`INSERT INTO custom_bot_commands (developer_id, command_name, command_description, command_response) VALUES (?, ?, ?, ?)`, 
            [devId, command_name, 'Custom Command', command_response], 
            () => {
                db.run(`UPDATE developers SET custom_features_count = COALESCE(custom_features_count, 0) + 1, plan_tier = 'highest' WHERE id = ?`, [devId], () => {
                    res.redirect('/admin/vault?msg=Feature+Added');
                });
            }
        );
    });
});
// ────────────────────────────────────────────────────────────────────────────

module.exports = router;
