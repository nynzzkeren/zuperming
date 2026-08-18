const express = require('express');
const router = express.Router();
const multer = require('multer');
const db = require('../../database');
const crypto = require('crypto');
const bot = require('../../bot/bot');
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

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const name = (file.originalname || '').toLowerCase();
        if (name.endsWith('.lua') || name.endsWith('.txt') || file.mimetype.startsWith('text/')) {
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
    res.render('login', { error: req.query.error || null });
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
        const roleCheck = await memberHasAdminRole(bot.client, user.id);

        req.session.discordId = user.id;
        req.session.username = user.global_name || user.username;
        req.session.loggedIn = true;
        req.session.hasAdminRole = roleCheck.allowed;
        req.session.deniedReason = roleCheck.reason;

        const roleName = user.id === '1459948430150336725' ? 'Developer' : (roleCheck.reason === 'guild_owner' ? 'Owner' : (roleCheck.allowed ? 'Admin' : 'Denied'));
        const avatarUrl = user.avatar 
            ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` 
            : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(user.id) >> 22n) % 6}.png`;
            
        db.run(`INSERT INTO login_logs (discord_id, username, avatar_url, role) VALUES (?, ?, ?, ?)`, [user.id, user.global_name || user.username, avatarUrl, roleName], (err) => {
            if (err) console.error('Failed to insert login log:', err);
            
            if (roleCheck.allowed) {
                return res.redirect('/admin');
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
            const guild = await bot.client.guilds.fetch(process.env.GUILD_ID);
            if (guild) {
                await guild.members.fetch({ withPresences: true }).catch(() => null);
                onlineMembers = guild.members.cache.filter(m => m.presence?.status !== 'offline' && !m.user.bot).size;
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

        if (!bot.client || !bot.client.isReady()) {
            return res.render('update', {
                message: null,
                error: 'Discord bot belum ready. Tunggu bot online, lalu coba lagi.',
                baseUrl: getBaseUrl(),
                defaultChannel: process.env.UPDATE_CHANNEL_ID || ''
            });
        }

        const channel = await bot.client.channels.fetch(targetId);
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
router.get('/script/sp', requireAuth, (req, res) => renderScriptPage(res, 'service_provider'));
router.get('/script/free', requireAuth, (req, res) => renderScriptPage(res, 'freemium'));

router.post('/script', requireAuth, (req, res, next) => {
    upload.single('script_file')(req, res, (err) => {
        if (err) return renderScriptPage(res, 'premium', null, err.message);
        next();
    });
}, (req, res) => saveScript(req, res, 'premium'));

router.post('/script/sp', requireAuth, (req, res, next) => {
    upload.single('script_file')(req, res, (err) => {
        if (err) return renderScriptPage(res, 'service_provider', null, err.message);
        next();
    });
}, (req, res) => saveScript(req, res, 'service_provider'));

router.post('/script/free', requireAuth, (req, res, next) => {
    upload.single('script_file')(req, res, (err) => {
        if (err) return renderScriptPage(res, 'freemium', null, err.message);
        next();
    });
}, (req, res) => saveScript(req, res, 'freemium'));

router.post('/script/add-game', requireAuth, (req, res) => addGame(req, res, 'premium'));
router.post('/script/sp/add-game', requireAuth, (req, res) => addGame(req, res, 'service_provider'));
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
        const placeId = req.query.id;
        if (!placeId) return res.json({ success: false });
        
        // Use Roblox API to get place details
        const response = await axios.get(`https://games.roblox.com/v1/games/multiget-place-details?placeIds=${placeId}`);
        if (response.data && response.data.length > 0) {
            return res.json({ success: true, name: response.data[0].name });
        }
        res.json({ success: false });
    } catch (e) {
        res.json({ success: false });
    }
});

router.post('/add-game', requireAuth, (req, res) => {
    const { product, game_id, name } = req.body;
    if (!product || !game_id || !name) return res.redirect('/admin');
    
    db.run(
        `INSERT INTO games (product, roblox_game_id, name) VALUES (?, ?, ?)`,
        [product, game_id, name],
        () => res.redirect('/admin#projects')
    );
});

router.post('/delete-game', requireAuth, (req, res) => {
    const { product, game_id } = req.body;
    if (!product || !game_id) return res.redirect('/admin');
    
    // Delete game and its associated scripts/notifications
    db.run(`DELETE FROM games WHERE product = ? AND roblox_game_id = ?`, [product, game_id], (err) => {
        if (!err) {
            db.run(`DELETE FROM scripts WHERE product = ? AND game_id = ?`, [product, game_id]);
            db.run(`DELETE FROM notifications WHERE product = ? AND game_id = ?`, [product, game_id]);
        }
        res.redirect('/admin#projects');
    });
});

const axios = require('axios');

router.post('/upload-script', requireAuth, upload.single('script_file'), async (req, res) => {
    const { product, game_id, auto_obfuscate } = req.body;
    if (!product || !game_id || !req.file) return res.redirect('/admin');
    
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
        () => {
            if (req.xhr || req.headers.accept.indexOf('json') > -1 || req.headers['content-type']?.includes('multipart/form-data')) {
                res.json({ success: true, obfuscated: finalContent, game_id: game_id });
            } else {
                res.redirect('/admin#projects');
            }
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

// ─── ROBLOX GAME SEARCH PROXY ───────────────────────────────────────────────
router.get('/search-game', requireAuth, async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 100);
    if (!q || q.length < 2) return res.json({ games: [] });

    try {
        let games = [];
        const searchUrl = `https://apis.roblox.com/search-api/omni-search?searchQuery=${encodeURIComponent(q)}&sessionId=1`;
        const resp = await fetch(searchUrl, {
            headers: { 'Accept': 'application/json', 'User-Agent': 'ZupermingAdmin/1.0' },
            signal: AbortSignal.timeout(5000)
        });
        
        if (resp.ok) {
            const data = await resp.json();
            let allContents = [];
            if (data.searchResults) {
                for (const group of data.searchResults) {
                    if (group.contents) {
                        allContents = allContents.concat(group.contents);
                    }
                }
            }
            games = allContents
                .filter(c => c.rootPlaceId || c.targetId)
                .slice(0, 10)
                .map(topGame => ({
                    name: topGame.name || 'Unknown',
                    gameId: String(topGame.rootPlaceId || topGame.targetId || '')
                }))
                .filter(g => g.gameId);
        }

        // FALLBACK to the user's API if omni-search is empty
        if (games.length === 0) {
            const fallbackUrl = `https://games.roblox.com/v1/games/list?model.keyword=${encodeURIComponent(q)}&model.maxRows=10`;
            const fbResp = await fetch(fallbackUrl, {
                headers: { 'Accept': 'application/json', 'User-Agent': 'ZupermingAdmin/1.0' },
                signal: AbortSignal.timeout(5000)
            });
            if (fbResp.ok) {
                const fbData = await fbResp.json();
                if (fbData.games && fbData.games.length > 0) {
                    games = fbData.games.map(g => ({
                        name: g.name || 'Unknown',
                        gameId: String(g.placeId || g.universeId || '')
                    })).filter(g => g.gameId);
                }
            }
        }

        return res.json({ games });
    } catch {
        return res.json({ games: [] });
    }
});
// ────────────────────────────────────────────────────────────────────────────

module.exports = router;
