const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const db = require('../../database');
const { getProduct, getBaseUrl } = require('../../config/products');
const { isKeyExpired, computeExpiresAt } = require('../../utils/keys');
const { buildExecutorWarnDm } = require('../../utils/changelog');

// ─── IN-MEMORY RATE LIMITER ───────────────────────────────────────────────────
// Tracks bad key attempts per IP: { ip -> { count, firstAttempt } }
const _badAttempts = new Map();
const RATE_LIMIT_MAX = 5;       // max failed attempts before auto-ban
const RATE_LIMIT_WINDOW = 60000; // 1 minute window (ms)

function checkRateLimit(ip) {
    const now = Date.now();
    let entry = _badAttempts.get(ip);
    if (!entry || (now - entry.firstAttempt) > RATE_LIMIT_WINDOW) {
        entry = { count: 0, firstAttempt: now };
        _badAttempts.set(ip, entry);
    }
    entry.count++;
    if (entry.count >= RATE_LIMIT_MAX) {
        // Auto-ban this IP in the database
        db.run(`INSERT OR IGNORE INTO banned_ips (ip, reason, banned_at) VALUES (?, 'Auto-ban: brute-force key attempt', CURRENT_TIMESTAMP)`, [ip]);
        _badAttempts.delete(ip);
        return false; // blocked
    }
    return true; // still allowed
}

function clearRateLimit(ip) {
    _badAttempts.delete(ip);
}
// ─────────────────────────────────────────────────────────────────────────────


function serveLoader(req, res, productId) {
    const ua = req.headers['user-agent'] || '';

    // Blok browser biasa — tapi izinkan Roblox/executor (tidak ada 'Mozilla/' dll)
    const isBrowser = !ua
        || ua.includes('Mozilla/')
        || ua.includes('Chrome/')
        || ua.includes('Safari/')
        || ua.includes('Edge/')
        || ua.includes('Opera/');

    // Roblox HttpGet biasanya kirim UA yang mengandung 'Roblox' atau tidak ada UA sama sekali dari executor
    // Jadi kita izinkan kalau UA mengandung 'Roblox' ATAU tidak ada tanda browser
    const isRoblox = ua.toLowerCase().includes('roblox');

    if (isBrowser && !isRoblox) {
        return res.status(404).send('404 Not Found');
    }

    const product = getProduct(productId);
    if (!product) {
        return res.send('print("Unknown product")');
    }

    const loaderPath = path.join(__dirname, '../../lua', product.loaderFile);
    fs.readFile(loaderPath, 'utf8', (err, data) => {
        if (err) return res.send(`print("${product.brand}: Loader not found on server")`);
        res.type('text/plain');
        res.send(data.replace(/\{\{BASE_URL\}\}/g, getBaseUrl()));
    });
}

function maybeWarnExecutor(keyRow, req) {
    const quality = String(req.query.unc_quality || '').toLowerCase();
    if (quality !== 'bad' && quality !== 'medium') return;
    if (!keyRow.discord_id) return;

    const executor = String(req.query.executor || 'Unknown').slice(0, 64);
    const score = parseInt(req.query.unc_score || '0', 10) || 0;
    const total = parseInt(req.query.unc_total || '0', 10) || 0;

    db.get(`SELECT * FROM users WHERE discord_id = ?`, [keyRow.discord_id], async (err, userRow) => {
        if (err || !userRow) return;

        const last = userRow.last_executor_warn ? new Date(userRow.last_executor_warn).getTime() : 0;
        const cooldownMs = 12 * 60 * 60 * 1000;
        if (Date.now() - last < cooldownMs) return;

        db.run(
            `UPDATE users SET last_executor_warn = CURRENT_TIMESTAMP, last_executor_name = ? WHERE discord_id = ?`,
            [executor, keyRow.discord_id]
        );

        try {
            const botManager = require('../../bot/botManager');
            const bot = {
                get client() {
                    return botManager.activeBots.get(process.env.DISCORD_TOKEN);
                }
            };
            const user = await bot.client.users.fetch(keyRow.discord_id);
            const payload = buildExecutorWarnDm({ executorName: executor, score, total });
            await user.send(payload);
        } catch (e) {
            console.error('Failed to DM executor warning:', e.message);
        }
    });
}

// We now use dynamic routes based on projectId instead of hardcoded products.
router.get('/loader/:projectId', (req, res) => {
    const projectId = req.params.projectId;
    const luaScript = `
-- Zuperming Loader (Project ID: ${projectId})
local HttpService = game:GetService("HttpService")
local executor = identifyexecutor and identifyexecutor() or "Unknown Executor"

local function requestExecute()
    local hwid = game:GetService("RbxAnalyticsService"):GetClientId()
    local url = "${getBaseUrl()}/api/execute/${projectId}"
    
    local headers = {
        ["Content-Type"] = "application/json",
        ["User-Agent"] = "ZupermingLoader/1.0"
    }
    
    local body = HttpService:JSONEncode({
        key = script_key or (getgenv and getgenv().script_key) or _G.script_key or _G.key_script,
        hwid = hwid,
        executor = executor,
        game_id = tostring(game.GameId),
        place_id = tostring(game.PlaceId)
    })
    
    local success, response = pcall(function()
        return request({
            Url = url,
            Method = "POST",
            Headers = headers,
            Body = body
        })
    end)
    
    if success and response then
        local decoded
        local s2, e2 = pcall(function() decoded = HttpService:JSONDecode(response.Body) end)
        if s2 and decoded then
            if decoded.success and decoded.script then
                loadstring(decoded.script)()
            else
                game.Players.LocalPlayer:Kick("Zuperming: " .. (decoded.message or "Unknown error"))
            end
        else
            game.Players.LocalPlayer:Kick("Zuperming: Failed to decode response from server.")
        end
    else
        game.Players.LocalPlayer:Kick("Zuperming: Server did not respond properly. Please contact support.")
    end
end

requestExecute()
    `;
    res.type('text/plain');
    res.send(luaScript);
});

router.post('/execute/:projectId', express.json(), (req, res) => {
    const projectId = req.params.projectId;
    const { key, hwid, game_id: universeId, place_id: placeId, executor } = req.body;
    const brand = "Zuperming Premium"; // Could be fetched from project settings

    if (!key || !hwid) {
        return res.json({ success: false, message: "Missing Key or HWID" });
    }

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;

    db.get(`SELECT * FROM banned_ips WHERE ip = ?`, [ip], (err, banned) => {
        if (banned) return res.json({ success: false, message: "Access denied." });
        if (!universeId && !placeId) return res.json({ success: false, message: "Missing game_id or place_id" });

        db.get(
            `SELECT * FROM keys WHERE key_string = ? AND status = 'used' AND project_id = ?`,
            [key, projectId],
            (err, keyRow) => {
                if (err || !keyRow) {
                    if (!checkRateLimit(ip)) {
                        return res.json({ success: false, message: "Too many failed attempts. IP banned." });
                    }
                    return res.json({ success: false, message: "Invalid Key" });
                }

                if (isKeyExpired(keyRow)) {
                    return res.json({ success: false, message: "Key expired." });
                }

                clearRateLimit(ip);
                req.query = { executor }; // shim for maybeWarnExecutor
                maybeWarnExecutor(keyRow, req);

                db.get(`SELECT * FROM users WHERE discord_id = ?`, [keyRow.discord_id], (err, userRow) => {
                    if (err || !userRow) return res.json({ success: false, message: "User not found in database" });
                    if (userRow.is_blacklisted) return res.json({ success: false, message: "You are blacklisted." });

                    const afterAuth = () => {
                        db.get(`SELECT name, roblox_game_id FROM games WHERE project_id = ? AND (roblox_game_id = ? OR roblox_game_id = ?)`, [projectId, String(universeId), String(placeId)], (err, gameRow) => {
                            if (err || !gameRow) return res.json({ success: false, message: `Game not supported` });

                            db.get(`SELECT obfuscated_script FROM scripts WHERE project_id = ? AND game_id = ? ORDER BY id DESC LIMIT 1`, [projectId, gameRow.roblox_game_id], (err, scriptRow) => {
                                if (err || !scriptRow || !scriptRow.obfuscated_script) return res.json({ success: false, message: `No script uploaded yet.` });

                                db.run(`UPDATE stats SET total_executions = total_executions + 1 WHERE id = 1`);
                                if (keyRow.discord_id) {
                                    db.run(`UPDATE users SET total_executions = COALESCE(total_executions, 0) + 1, last_ip = ? WHERE discord_id = ?`, [ip, keyRow.discord_id], () => {});
                                }
                                
                                res.json({ success: true, script: scriptRow.obfuscated_script });
                            });
                        });
                    };

                    if (!userRow.hwid) {
                        db.run(`UPDATE users SET hwid = ? WHERE discord_id = ?`, [hwid, keyRow.discord_id], (err) => {
                            if (err) return res.json({ success: false, message: "Failed to bind HWID" });
                            afterAuth();
                        });
                    } else if (userRow.hwid !== hwid) {
                        return res.json({ success: false, message: "HWID Mismatch. Please reset your HWID in Discord." });
                    } else {
                        afterAuth();
                    }
                });
            }
        );
    });
});

function handlePoll(req, res) {
    const { project_id, game_id, hwid, discord_id, last_id } = req.query;
    if (!project_id || !game_id || !hwid) return res.send('');

    // Update active session
    db.run(
        `INSERT INTO live_sessions (hwid, discord_id, game_id, project_id, last_seen) 
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(hwid) DO UPDATE SET last_seen=CURRENT_TIMESTAMP, discord_id=excluded.discord_id, game_id=excluded.game_id, project_id=excluded.project_id`,
        [hwid, discord_id || null, game_id, project_id]
    );

    // Check for new notifications
    const lastIdNum = parseInt(last_id, 10) || 0;
    db.get(
        `SELECT id, message FROM notifications WHERE project_id = ? AND game_id = ? AND id > ? ORDER BY id DESC LIMIT 1`,
        [project_id, game_id, lastIdNum],
        (err, row) => {
            if (err || !row) {
                return res.send('');
            }
            res.json({ id: row.id, message: row.message });
        }
    );
}

router.get('/poll', handlePoll);

// ─── CRASH / ERROR REPORTER ───────────────────────────────────────────────
router.post('/report-error', express.json(), async (req, res) => {
    const { error, executor, hwid, game_id, product } = req.body;
    
    if (!error) return res.status(400).json({ success: false });

    try {
        const botManager = require('../../bot/botManager');
        const bot = {
            get client() {
                return botManager.activeBots.get(process.env.DISCORD_TOKEN);
            }
        };
        const channelId = '1537804443146526740';
        const channel = await bot.client.channels.fetch(channelId);
        if (channel) {
            const { EmbedBuilder } = require('discord.js');
            const embed = new EmbedBuilder()
                .setTitle('⚠️ Script Execution Error')
                .setColor('#ef4444')
                .addFields(
                    { name: 'Game ID', value: String(game_id || 'Unknown'), inline: true },
                    { name: 'Executor', value: String(executor || 'Unknown'), inline: true },
                    { name: 'Product', value: String(product || 'Unknown'), inline: true },
                    { name: 'HWID', value: String(hwid || 'Unknown'), inline: false },
                    { name: 'Error Trace', value: '```lua\n' + String(error).substring(0, 1000) + '\n```', inline: false }
                )
                .setTimestamp();
                
            await channel.send({ embeds: [embed] });
        }
    } catch (e) {
        console.error('Failed to send error report to Discord:', e.message);
    }
    
    res.json({ success: true });
});
// ─────────────────────────────────────────────────────────────────────────────

module.exports = router;
