const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const router = express.Router();
const db = require('../../database');
const { getProduct, getBaseUrl } = require('../../config/products');
const { isKeyExpired, computeExpiresAt } = require('../../utils/keys');
const { buildExecutorWarnDm } = require('../../utils/changelog');

// ─── LOADER ANTI-TAMPER (HMAC-SHA256) ──────────────────────────────────────────────
const LOADER_SECRET = process.env.LOADER_SECRET || 'zuperming_loader_secret_change_me';

function generateLoaderSignature(projectUUID) {
    const ts = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac('sha256', LOADER_SECRET)
        .update(projectUUID + ':' + ts)
        .digest('hex');
    return { ts, sig };
}
// ─────────────────────────────────────────────────────────────────────────────

// ─── GEO-TRACKING ───────────────────────────────────────────────────────────────
function lookupIpGeo(ip) {
    return new Promise((resolve) => {
        if (!ip || ip === '::1' || ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
            return resolve({ country: 'Local', country_code: 'LO', region: 'Local', city: 'Local' });
        }
        const cleanIp = ip.replace(/^::ffff:/, '');
        const reqUrl = 'http://ip-api.com/json/' + cleanIp + '?fields=status,country,countryCode,regionName,city';
        const r = http.get(reqUrl, (resp) => {
            let data = '';
            resp.on('data', d => { data += d; });
            resp.on('end', () => {
                try {
                    const j = JSON.parse(data);
                    if (j.status === 'success') {
                        resolve({ country: j.country, country_code: j.countryCode, region: j.regionName, city: j.city });
                    } else {
                        resolve({ country: 'Unknown', country_code: '??', region: 'Unknown', city: 'Unknown' });
                    }
                } catch (_) { resolve({ country: 'Unknown', country_code: '??', region: 'Unknown', city: 'Unknown' }); }
            });
        });
        r.on('error', () => resolve({ country: 'Unknown', country_code: '??', region: 'Unknown', city: 'Unknown' }));
        r.setTimeout(3000, () => { r.destroy(); resolve({ country: 'Unknown', country_code: '??', region: 'Unknown', city: 'Unknown' }); });
    });
}
// ─────────────────────────────────────────────────────────────────────────────

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

// ─── FORBIDDEN PAGE (shown to browsers accessing loader URLs) ────────────────
function buildForbiddenPage(loaderSnippet) {
    const escaped = loaderSnippet
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Forbidden — Loader Protected</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;
background:radial-gradient(ellipse at 60% 0%,rgba(120,20,60,.35) 0%,transparent 60%),
radial-gradient(ellipse at 10% 80%,rgba(40,10,80,.4) 0%,transparent 55%),
#0d0d14;
font-family:'Inter',sans-serif;color:#e8eaf6;padding:24px;}
.card{width:100%;max-width:560px;background:rgba(16,17,30,.82);
border:1px solid rgba(255,255,255,.08);border-radius:20px;
backdrop-filter:blur(18px);overflow:hidden;box-shadow:0 32px 80px rgba(0,0,0,.6);}
.hero{display:flex;flex-direction:column;align-items:center;padding:48px 40px 36px;text-align:center;border-bottom:1px solid rgba(255,255,255,.07);}
.icon-wrap{width:80px;height:80px;border-radius:20px;background:rgba(220,50,50,.15);
border:1px solid rgba(220,50,50,.25);display:flex;align-items:center;justify-content:center;margin-bottom:20px;}
.icon-wrap svg{width:40px;height:40px;stroke:#ef4444;stroke-width:1.8;fill:none;}
h1{font-size:26px;font-weight:700;letter-spacing:-.01em;margin-bottom:8px;}
.sub{color:rgba(200,205,230,.55);font-size:14.5px;}
.body{padding:28px 32px 32px;display:flex;flex-direction:column;gap:16px;}
.section-label{font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:rgba(200,205,230,.35);margin-bottom:4px;}
.code-wrap{position:relative;background:rgba(10,12,22,.8);border:1px solid rgba(255,255,255,.08);border-radius:12px;overflow:hidden;}
.copy-btn{position:absolute;top:10px;right:10px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.15);
color:#c9d1f5;border-radius:8px;padding:5px 11px;font-size:12px;font-family:'Inter',sans-serif;
font-weight:500;cursor:pointer;display:flex;align-items:center;gap:6px;transition:background .18s;}
.copy-btn:hover{background:rgba(255,255,255,.17);}
.copy-btn svg{width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:2;}
pre{padding:18px 16px 16px;font-family:'JetBrains Mono',monospace;font-size:13px;line-height:1.65;overflow-x:auto;color:#a5b4fc;white-space:pre-wrap;word-break:break-all;}
.keyword{color:#f472b6}
.string{color:#34d399}
.notice{display:flex;align-items:center;gap:10px;padding:13px 16px;background:rgba(245,158,11,.06);
border:1px solid rgba(245,158,11,.2);border-radius:10px;font-size:13px;color:rgba(245,158,11,.85);}
.notice svg{flex-shrink:0;width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:2;}
</style>
</head>
<body>
<div class="card">
  <div class="hero">
    <div class="icon-wrap">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
    </div>
    <h1>Forbidden</h1>
    <p class="sub">You are not allowed to view these files.</p>
  </div>
  <div class="body">
    <div>
      <div class="section-label">Loader Script</div>
      <div class="code-wrap">
        <button class="copy-btn" onclick="copySnippet()">
          <svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          <span id="copy-lbl">Copy</span>
        </button>
        <pre id="snippet"><span class="keyword">script_key</span> = <span class="string">"YOUR_KEY_HERE"</span>;  <span style="color:rgba(165,180,252,.4);font-style:italic">-- A key might be required, if not, delete this line</span>
<span class="keyword">loadstring</span>(<span class="keyword">game</span>:<span class="keyword">HttpGet</span>(<span class="string">"${escaped.split('\n')[1]?.match(/loadstring\(game:HttpGet\("([^"]+)"\)\)/)?.[1] || ''}"</span>))()</pre>
      </div>
    </div>
    <div class="notice">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      Contents can not be displayed on browser
    </div>
  </div>
</div>
<script>
const RAW = ${JSON.stringify(loaderSnippet)};
function copySnippet(){
  navigator.clipboard.writeText(RAW).then(()=>{
    const lbl=document.getElementById('copy-lbl');
    lbl.textContent='Copied!';
    setTimeout(()=>lbl.textContent='Copy',2000);
  });
}
</script>
</body>
</html>`;
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
    // Generate per-request HMAC signature (anti-tamper)
    const { ts, sig } = generateLoaderSignature(project.uuid);
    // Randomize variable names (anti-leak / anti-share)
    const rnd = crypto.randomBytes(4).toString('hex');
    return `-- Secure Loader v4.2 [${rnd.toUpperCase()}]
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

function isBrowserRequest(req) {
    const ua = req.headers['user-agent'] || '';
    if (!ua) return false; // no UA = likely executor
    const isRoblox = ua.toLowerCase().includes('roblox');
    if (isRoblox) return false;
    // Any standard browser UA
    return (
        ua.includes('Mozilla/') ||
        ua.includes('Chrome/') ||
        ua.includes('Safari/') ||
        ua.includes('Edge/') ||
        ua.includes('Opera/') ||
        ua.includes('Firefox/')
    );
}

function handleLoaderRequest(req, res) {
    const rawParam = req.params.loaderFile || req.params.projectId || req.params[0] || '';
    const uuidOrId = rawParam.replace(/\.lua$/i, '').trim();

    // ── Block browsers: show Forbidden page ──
    if (isBrowserRequest(req)) {
        const loaderSnippet = `script_key = "YOUR_KEY_HERE";\nloadstring(game:HttpGet("${getBaseUrl()}/scripts/v4/loaders/${uuidOrId}.lua"))()`;
        return res.status(403).send(buildForbiddenPage(loaderSnippet));
    }

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

                                // ─── Geo-tracking (async, non-blocking) ───────────────
                                lookupIpGeo(ip).then(geo => {
                                    db.run(
                                        `INSERT INTO execution_logs (project_id, key_string, discord_id, ip, country, country_code, region, city, executor, hwid, place_id, game_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
                                        [projectId, key, keyRow?.discord_id || null, ip, geo.country, geo.country_code, geo.region, geo.city, executor, hwid, placeId, universeId]
                                    );
                                }).catch(() => {});

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

// ─── GEO STATS (for dashboard Analytics tab) ─────────────────────────────────
router.get('/geo-stats', (req, res) => {
    db.all(
        `SELECT country, country_code, COUNT(*) as count FROM execution_logs
         WHERE country IS NOT NULL AND country != '' AND country != 'Unknown' AND country != 'Local'
         GROUP BY country ORDER BY count DESC LIMIT 12`,
        (err, countries) => {
            if (err) return res.json({ countries: [], regions: [], total: 0 });
            db.all(
                `SELECT region, country, COUNT(*) as count FROM execution_logs
                 WHERE region IS NOT NULL AND region != '' AND region != 'Unknown' AND region != 'Local'
                 GROUP BY region ORDER BY count DESC LIMIT 12`,
                (err2, regions) => {
                    db.get(`SELECT COUNT(*) as total FROM execution_logs`, (err3, row) => {
                        res.json({
                            countries: countries || [],
                            regions: regions || [],
                            total: row?.total || 0
                        });
                    });
                }
            );
        }
    );
});
// ─────────────────────────────────────────────────────────────────────────────

module.exports = router;
