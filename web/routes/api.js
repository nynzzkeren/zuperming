const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const db = require('../../database');
const { getProduct, getBaseUrl } = require('../../config/products');
const { isKeyExpired, computeExpiresAt } = require('../../utils/keys');
const { buildExecutorWarnDm } = require('../../utils/changelog');

function serveLoader(req, res, productId) {
    const ua = req.headers['user-agent'] || '';
    if (!ua || ua.includes('Mozilla/') || ua.includes('Chrome/') || ua.includes('Safari/') || ua.includes('Edge/') || ua.includes('Opera/')) {
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

    // Freemium: key may be unused — activate on first execute (no Discord redeem needed)
    if (productId === 'freemium') {
        return handleFreemiumExecute(req, res, product, key, hwid, String(gameId));
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

function handleFreemiumExecute(req, res, product, key, hwid, gameId) {
    const brand = product.brand;

    db.get(
        `SELECT * FROM keys WHERE key_string = ? AND product = 'freemium'`,
        [key],
        (err, keyRow) => {
            if (err || !keyRow) {
                return res.send(`game.Players.LocalPlayer:Kick("${brand}: Invalid Key")`);
            }

            const activateAndServe = (row) => {
                if (isKeyExpired(row)) {
                    return res.send(`game.Players.LocalPlayer:Kick("${brand}: Key expired. Get a new key.")`);
                }

                if (row.bound_hwid && row.bound_hwid !== hwid) {
                    return res.send(
                        `game.Players.LocalPlayer:Kick("${brand}: HWID Mismatch. Get a new key.")`
                    );
                }

                if (row.discord_id) {
                    maybeWarnExecutor(row, req);
                }

                const finish = () => serveScript(res, 'freemium', brand, gameId);

                if (!row.bound_hwid) {
                    db.run(`UPDATE keys SET bound_hwid = ? WHERE id = ?`, [hwid, row.id], (e) => {
                        if (e) return res.send(`print("${brand}: Failed to bind HWID")`);
                        finish();
                    });
                } else {
                    finish();
                }
            };

            if (keyRow.status === 'unused') {
                const expiresAt = computeExpiresAt(keyRow.duration);
                db.run(
                    `UPDATE keys SET status = 'used', redeemed_at = CURRENT_TIMESTAMP, expires_at = ?, bound_hwid = ? WHERE id = ?`,
                    [expiresAt, hwid, keyRow.id],
                    (e) => {
                        if (e) return res.send(`print("${brand}: Failed to activate key")`);
                        db.get(`SELECT * FROM keys WHERE id = ?`, [keyRow.id], (err2, updated) => {
                            if (err2 || !updated) {
                                return res.send(`print("${brand}: Activate error")`);
                            }
                            activateAndServe(updated);
                        });
                    }
                );
            } else if (keyRow.status === 'used') {
                activateAndServe(keyRow);
            } else {
                return res.send(`game.Players.LocalPlayer:Kick("${brand}: Invalid Key")`);
            }
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
router.get('/loader', (req, res) => serveLoader(req, res, 'premium'));
router.get('/sp/execute', (req, res) => handleExecute(req, res, 'service_provider'));
router.get('/sp/loader', (req, res) => serveLoader(req, res, 'service_provider'));
router.get('/free/execute', (req, res) => handleExecute(req, res, 'freemium'));
router.get('/free/loader', (req, res) => serveLoader(req, res, 'freemium'));

module.exports = router;
module.exports.serveLoader = serveLoader;
module.exports.handleExecute = handleExecute;
