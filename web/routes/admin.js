const express = require('express');
const router = express.Router();
const multer = require('multer');
const db = require('../../database');
const crypto = require('crypto');
const bot = require('../../bot/bot');
const { PRODUCTS, getProduct, getBaseUrl } = require('../../config/products');

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
    if (req.session.loggedIn) next();
    else res.redirect('/admin/login');
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
         ) AS script_size
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
    res.render('login', { error: null });
});

router.post('/login', (req, res) => {
    const { password } = req.body;
    if (password === process.env.ADMIN_PASSWORD) {
        req.session.loggedIn = true;
        res.redirect('/admin');
    } else {
        res.render('login', { error: 'Invalid password' });
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
                onlineMembers = guild.members.cache.filter(m => m.presence?.status !== 'offline' && !m.user.bot).size;
            }
        } catch (e) {
            console.error('Could not fetch guild info', e.message);
        }

        db.all(`SELECT * FROM keys ORDER BY created_at DESC LIMIT 15`, (err, keys) => {
            res.render('dashboard', {
                stats,
                onlineMembers,
                keys: keys || [],
                products: PRODUCTS,
                baseUrl: getBaseUrl()
            });
        });
    });
});

router.post('/generate-key', requireAuth, (req, res) => {
    const { duration, product: productId } = req.body;
    const product = getProduct(productId) || getProduct('premium');
    const key = `${product.keyPrefix}-` + crypto.randomBytes(8).toString('hex').toUpperCase();

    db.run(
        `INSERT INTO keys (key_string, duration, product) VALUES (?, ?, ?)`,
        [key, duration, product.id],
        () => res.redirect('/admin')
    );
});

router.get('/script', requireAuth, (req, res) => renderScriptPage(res, 'premium'));
router.get('/script/sp', requireAuth, (req, res) => renderScriptPage(res, 'service_provider'));

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

router.post('/script/add-game', requireAuth, (req, res) => {
    addGame(req, res, 'premium');
});

router.post('/script/sp/add-game', requireAuth, (req, res) => {
    addGame(req, res, 'service_provider');
});

function addGame(req, res, productId) {
    const product = getProduct(productId);
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
                    renderScriptPage(
                        res,
                        productId,
                        `Script ${game.name} updated! User execute lagi = dapat versi baru. Loader tidak perlu diganti.`
                    );
                }
            );
        }
    );
}

module.exports = router;
