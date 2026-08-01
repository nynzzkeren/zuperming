const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const db = require('../../database');
const { getProduct, getBaseUrl } = require('../../config/products');
const { isKeyExpired } = require('../../utils/keys');
const { buildExecutorWarnDm } = require('../../utils/changelog');

function serveLoader(res, productId) {
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
        const cooldownMs = 12 * 60 * 60 * 1000; // 12h
        if (Date.now() - last < cooldownMs) return;

        db.run(
            `UPDATE users SET last_executor_warn = CURRENT_TIMESTAMP, last_executor_name = ? WHERE discord_id = ?`,
            [executor, keyRow.discord_id]
        );

        try {
            const bot = require('../../bot/bot');
            const user = await bot.client.users.fetch(keyRow.discord_id);
            const payload = buildExecutorWarnDm({ executorName: executor, score, total });
            await user.send(payload);
        } catch (e) {
            console.error('Failed to DM executor warning:', e.message);
        }
    });
}

function handleExecute(req, res, productId) {
    const product = getProduct(productId);
    if (!product) {
        return res.send('print("Unknown product")');
    }

    const { key, hwid, game_id: gameId } = req.query;
    const brand = product.brand;

    if (!key || !hwid) {
        return res.send(`print("${brand}: Missing Key or HWID")`);
    }

    if (!gameId) {
        return res.send(`game.Players.LocalPlayer:Kick("${brand}: Missing game_id")`);
    }

    db.get(
        `SELECT * FROM keys WHERE key_string = ? AND status = 'used' AND product = ?`,
        [key, productId],
        (err, keyRow) => {
            if (err || !keyRow) {
                return res.send(`game.Players.LocalPlayer:Kick("${brand}: Invalid or Unused Key")`);
            }

            if (isKeyExpired(keyRow)) {
                return res.send(`game.Players.LocalPlayer:Kick("${brand}: Key expired. Buy/renew your key.")`);
            }

            maybeWarnExecutor(keyRow, req);

            db.get(`SELECT * FROM users WHERE discord_id = ?`, [keyRow.discord_id], (err, userRow) => {
                if (err || !userRow) {
                    return res.send(`game.Players.LocalPlayer:Kick("${brand}: User not found in database")`);
                }

                if (userRow.is_blacklisted) {
                    return res.send(`game.Players.LocalPlayer:Kick("${brand}: You are blacklisted.")`);
                }

                const afterAuth = () => serveScript(res, productId, brand, String(gameId));

                if (!userRow.hwid) {
                    db.run(`UPDATE users SET hwid = ? WHERE discord_id = ?`, [hwid, keyRow.discord_id], (err) => {
                        if (err) return res.send(`print("${brand}: Failed to bind HWID")`);
                        afterAuth();
                    });
                } else if (userRow.hwid !== hwid) {
                    return res.send(
                        `game.Players.LocalPlayer:Kick("${brand}: HWID Mismatch. Please reset your HWID in Discord.")`
                    );
                } else {
                    afterAuth();
                }
            });
        }
    );
}

function serveScript(res, productId, brand, gameId) {
    db.get(
        `SELECT name FROM games WHERE product = ? AND roblox_game_id = ?`,
        [productId, gameId],
        (err, gameRow) => {
            if (err || !gameRow) {
                return res.send(
                    `game.Players.LocalPlayer:Kick("${brand}: Game not supported (GameId ${gameId})")`
                );
            }

            db.get(
                `SELECT obfuscated_script FROM scripts WHERE product = ? AND game_id = ? ORDER BY id DESC LIMIT 1`,
                [productId, gameId],
                (err, scriptRow) => {
                    if (err || !scriptRow || !scriptRow.obfuscated_script) {
                        return res.send(
                            `print("${brand}: No script uploaded yet for ${gameRow.name}.")`
                        );
                    }

                    db.run(`UPDATE stats SET total_executions = total_executions + 1 WHERE id = 1`);
                    res.type('text/plain');
                    res.send(scriptRow.obfuscated_script);
                }
            );
        }
    );
}

router.get('/execute', (req, res) => handleExecute(req, res, 'premium'));
router.get('/loader', (req, res) => serveLoader(res, 'premium'));
router.get('/sp/execute', (req, res) => handleExecute(req, res, 'service_provider'));
router.get('/sp/loader', (req, res) => serveLoader(res, 'service_provider'));

module.exports = router;
module.exports.serveLoader = serveLoader;
module.exports.handleExecute = handleExecute;
