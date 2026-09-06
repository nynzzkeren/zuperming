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

function buildSecureLoaderScript(project, baseUrl) {
    const isFree = project.is_free == 1;
    return `-- mie ayam Secure Loader v4.0
-- Project: ${project.name} (${project.uuid})
repeat task.wait() until game:IsLoaded()
repeat task.wait() until game.Players.LocalPlayer and game.Players.LocalPlayer.Character

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local StarterGui = game:GetService("StarterGui")
local LocalPlayer = Players.LocalPlayer

local function notify(title, text, duration)
    pcall(function()
        StarterGui:SetCore("SendNotification", {
            Title = title or "mie ayam",
            Text = text or "",
            Duration = duration or 4
        })
    end)
end

-- Key extraction (_G / getgenv / script_key)
local ZUPER_KEY = script_key or (getgenv and getgenv().script_key) or _G.script_key or _G.key
${isFree ? `
if not ZUPER_KEY or ZUPER_KEY == "" then
    ZUPER_KEY = "KEYLESS_FREE"
end
` : `
if not ZUPER_KEY or ZUPER_KEY == "" then
    notify("Authentication Error", "Please set script_key before loading.", 5)
    LocalPlayer:Kick("mie ayam: Please set script_key before executing.")
    return
end
`}

local function detectExecutor()
    local name = "Unknown"
    pcall(function()
        if identifyexecutor then name = tostring(identifyexecutor())
        elseif getexecutorname then name = tostring(getexecutorname())
        end
    end)
    return name
end

local execName = detectExecutor()
local hwid = ""
pcall(function()
    if gethwid then
        hwid = tostring(gethwid())
    elseif game:GetService("RbxAnalyticsService") then
        hwid = tostring(game:GetService("RbxAnalyticsService"):GetClientId())
    end
end)
if not hwid or hwid == "" then
    hwid = tostring(LocalPlayer.UserId)
end

local placeId = tostring(game.PlaceId)
local universeId = tostring(game.GameId)
local baseUrl = "${baseUrl}"

notify("mie ayam", "Connecting for Place ID: " .. placeId .. "...", 3)

local requestFunc = request or http_request or (syn and syn.request) or (http and http.request)
if not requestFunc then
    local getUrl = baseUrl .. "/api/execute/${project.uuid}?key=" .. HttpService:UrlEncode(tostring(ZUPER_KEY))
        .. "&hwid=" .. HttpService:UrlEncode(hwid)
        .. "&place_id=" .. placeId
        .. "&game_id=" .. universeId
        .. "&executor=" .. HttpService:UrlEncode(execName)

    local success, response = pcall(function()
        return game:HttpGet(getUrl)
    end)

    if success and response then
        local decoded
        local s2, _ = pcall(function() decoded = HttpService:JSONDecode(response) end)
        if s2 and decoded then
            if decoded.success and decoded.script then
                notify("mie ayam", "Key Validated! Loading Script...", 3)
                local func, err = loadstring(decoded.script)
                if func then
                    local ok, runErr = pcall(func)
                    if not ok then
                        warn("[mie ayam Runtime Error] " .. tostring(runErr))
                    end
                else
                    warn("[mie ayam Compile Error] " .. tostring(err))
                    LocalPlayer:Kick("mie ayam: Failed to compile script.")
                end
            else
                LocalPlayer:Kick("mie ayam: " .. (decoded.message or "Unauthorized."))
            end
        else
            loadstring(response)()
        end
    else
        LocalPlayer:Kick("mie ayam: Failed to connect to authentication server.")
    end
    return
end

local headers = {
    ["Content-Type"] = "application/json",
    ["User-Agent"] = "mieAyamLoader/4.0"
}

local body = HttpService:JSONEncode({
    key = ZUPER_KEY,
    hwid = hwid,
    executor = execName,
    place_id = placeId,
    game_id = universeId
})

local success, response = pcall(function()
    return requestFunc({
        Url = baseUrl .. "/api/execute/${project.uuid}",
        Method = "POST",
        Headers = headers,
        Body = body
    })
end)

if success and response then
    local decoded
    local s2, _ = pcall(function() decoded = HttpService:JSONDecode(response.Body) end)
    if s2 and decoded then
        if decoded.success and decoded.script then
            notify("mie ayam", "Key Validated! Loading Script...", 3)
            local func, err = loadstring(decoded.script)
            if func then
                local ok, runErr = pcall(func)
                if not ok then
                    pcall(function()
                        requestFunc({
                            Url = baseUrl .. "/api/report-error",
                            Method = "POST",
                            Headers = { ["Content-Type"] = "application/json" },
                            Body = HttpService:JSONEncode({
                                error = tostring(runErr),
                                executor = execName,
                                hwid = hwid,
                                place_id = placeId,
                                game_id = universeId,
                                project = "${project.uuid}"
                            })
                        })
                    end)
                    warn("[mie ayam Runtime Error] " .. tostring(runErr))
                end
            else
                warn("[mie ayam Compile Error] " .. tostring(err))
                LocalPlayer:Kick("mie ayam: Failed to compile script.")
            end
        else
            LocalPlayer:Kick("mie ayam: " .. (decoded.message or "Execution failed."))
        end
    else
        LocalPlayer:Kick("mie ayam: Invalid response from server.")
    end
else
    LocalPlayer:Kick("mie ayam: Failed to connect to secure server.")
end
`;
}

function handleLoaderRequest(req, res) {
    const rawParam = req.params.loaderFile || req.params.projectId || req.params[0] || '';
    const uuidOrId = rawParam.replace(/\.lua$/i, '').trim();

    db.get(`SELECT * FROM projects WHERE uuid = ? OR id = ?`, [uuidOrId, uuidOrId], (err, project) => {
        if (err || !project) {
            // Fallback check default projects
            db.get(`SELECT * FROM projects ORDER BY id ASC LIMIT 1`, (err2, defaultProj) => {
                if (!defaultProj) {
                    res.type('text/plain');
                    return res.send(`game.Players.LocalPlayer:Kick("mie ayam: Project not found.")`);
                }
                res.type('text/plain');
                return res.send(buildSecureLoaderScript(defaultProj, getBaseUrl()));
            });
            return;
        }

        res.type('text/plain');
        res.send(buildSecureLoaderScript(project, getBaseUrl()));
    });
}

// DX-SR / Luarmor style loader endpoints
router.get('/v4/loaders/:loaderFile', handleLoaderRequest);
router.get('/scripts/v4/loaders/:loaderFile', handleLoaderRequest);
router.get('/loader/:projectId', handleLoaderRequest);

function handleExecute(req, res) {
    const rawId = (req.params.identifier || req.params.projectId || '').replace(/\.lua$/i, '').trim();
    const isPost = req.method === 'POST';
    const data = isPost ? req.body : req.query;

    const key = data.key || '';
    const hwid = data.hwid || '';
    const universeId = String(data.game_id || '');
    const placeId = String(data.place_id || '');
    const executor = data.executor || 'Unknown';

    if (!rawId) {
        return res.json({ success: false, message: "Missing project identifier" });
    }

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;

    db.get(`SELECT * FROM banned_ips WHERE ip = ?`, [ip], (err, banned) => {
        if (banned) return res.json({ success: false, message: "Access denied." });
        if (!universeId && !placeId) return res.json({ success: false, message: "Missing game_id or place_id" });

        // Resolve project
        db.get(`SELECT * FROM projects WHERE uuid = ? OR id = ?`, [rawId, rawId], (err, project) => {
            if (err || !project) {
                return res.json({ success: false, message: "Project not found" });
            }

            const projectId = project.id;
            const isFree = project.is_free == 1;

            const checkGameAndDeliverScript = (keyRow) => {
                // Universal / Single loader verification determined by Place ID or Game ID
                db.get(
                    `SELECT * FROM games WHERE (project_id = ? OR project_id IS NULL) AND (place_id = ? OR roblox_game_id = ? OR place_id = ? OR roblox_game_id = ?)`,
                    [projectId, placeId, placeId, universeId, universeId],
                    (err, gameRow) => {
                        if (err || !gameRow) {
                            return res.json({ 
                                success: false, 
                                message: `Game not supported (Place ID: ${placeId}). Please check supported games in Discord.` 
                            });
                        }

                        // Fetch latest script for this game
                        const gameTarget = gameRow.place_id || gameRow.roblox_game_id;
                        db.get(
                            `SELECT obfuscated_script FROM scripts WHERE (project_id = ? OR project_id IS NULL) AND (game_id = ? OR game_id = ?) ORDER BY id DESC LIMIT 1`,
                            [projectId, gameTarget, gameRow.roblox_game_id],
                            (err, scriptRow) => {
                                if (err || !scriptRow || !scriptRow.obfuscated_script) {
                                    return res.json({ success: false, message: `No script uploaded yet for ${gameRow.name}.` });
                                }

                                db.run(`UPDATE stats SET total_executions = total_executions + 1 WHERE id = 1`);
                                if (keyRow && keyRow.discord_id) {
                                    db.run(`UPDATE users SET total_executions = COALESCE(total_executions, 0) + 1, last_ip = ? WHERE discord_id = ?`, [ip, keyRow.discord_id], () => {});
                                }

                                res.json({ success: true, script: scriptRow.obfuscated_script });
                            }
                        );
                    }
                );
            };

            // If Free Project: allow keyless or auto-validate
            if (isFree) {
                if (key && key !== 'KEYLESS_FREE') {
                    // Check if key exists
                    db.get(`SELECT * FROM keys WHERE key_string = ? AND project_id = ?`, [key, projectId], (err, kRow) => {
                        checkGameAndDeliverScript(kRow || null);
                    });
                } else {
                    checkGameAndDeliverScript(null);
                }
                return;
            }

            // Premium Project: strictly validate key and HWID
            if (!key || !hwid) {
                return res.json({ success: false, message: "Missing Key or HWID" });
            }

            db.get(
                `SELECT * FROM keys WHERE key_string = ? AND (project_id = ? OR project_id IS NULL)`,
                [key, projectId],
                (err, keyRow) => {
                    if (err || !keyRow) {
                        if (!checkRateLimit(ip)) {
                            return res.json({ success: false, message: "Too many failed attempts. IP banned." });
                        }
                        return res.json({ success: false, message: "Invalid license key." });
                    }

                    if (isKeyExpired(keyRow)) {
                        return res.json({ success: false, message: "Key expired." });
                    }

                    clearRateLimit(ip);
                    req.query = { executor };
                    maybeWarnExecutor(keyRow, req);

                    if (!keyRow.discord_id) {
                        // Key not bound to discord user yet, bind directly or deliver
                        return checkGameAndDeliverScript(keyRow);
                    }

                    db.get(`SELECT * FROM users WHERE discord_id = ?`, [keyRow.discord_id], (err, userRow) => {
                        if (userRow && userRow.is_blacklisted) {
                            return res.json({ success: false, message: "You are blacklisted." });
                        }

                        if (!userRow || !userRow.hwid) {
                            db.run(`INSERT INTO users (discord_id, hwid) VALUES (?, ?) ON CONFLICT(discord_id) DO UPDATE SET hwid = ?`, [keyRow.discord_id, hwid, hwid], (err) => {
                                checkGameAndDeliverScript(keyRow);
                            });
                        } else if (userRow.hwid !== hwid) {
                            return res.json({ success: false, message: "HWID Mismatch. Please reset your HWID using the Discord bot." });
                        } else {
                            checkGameAndDeliverScript(keyRow);
                        }
                    });
                }
            );
        });
    });
}

router.post('/execute/:identifier', express.json(), handleExecute);
router.get('/execute/:identifier', handleExecute);
router.post('/v4/execute/:identifier', express.json(), handleExecute);
router.get('/v4/execute/:identifier', handleExecute);

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
