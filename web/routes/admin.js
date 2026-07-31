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
    db.get(
        `SELECT * FROM scripts WHERE product = ? ORDER BY id DESC LIMIT 1`,
        [productId],
        (err, script) => {
            res.render('script', {
                script,
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

// Premium script manager
router.get('/script', requireAuth, (req, res) => {
    renderScriptPage(res, 'premium');
});

router.post('/script', requireAuth, (req, res, next) => {
    upload.single('script_file')(req, res, (err) => {
        if (err) return renderScriptPage(res, 'premium', null, err.message);
        next();
    });
}, (req, res) => saveScript(req, res, 'premium'));

// Service Provider script manager
router.get('/script/sp', requireAuth, (req, res) => {
    renderScriptPage(res, 'service_provider');
});

router.post('/script/sp', requireAuth, (req, res, next) => {
    upload.single('script_file')(req, res, (err) => {
        if (err) return renderScriptPage(res, 'service_provider', null, err.message);
        next();
    });
}, (req, res) => saveScript(req, res, 'service_provider'));

function saveScript(req, res, productId) {
    const fromFile = req.file ? req.file.buffer.toString('utf8').trim() : '';
    const fromPaste = (req.body.obfuscated_script || '').trim();
    const obfuscated = fromFile || fromPaste;

    if (!obfuscated) {
        return renderScriptPage(res, productId, null, 'Upload a .lua file or paste the obfuscated script.');
    }

    const sourceLabel = fromFile
        ? `file:${req.file.originalname}`
        : 'paste:manual-obfuscated';

    db.run(
        `INSERT INTO scripts (product, raw_script, obfuscated_script, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
        [productId, sourceLabel, obfuscated],
        (err) => {
            if (err) return renderScriptPage(res, productId, null, 'Failed to save script: ' + err.message);
            renderScriptPage(
                res,
                productId,
                'Script updated! Users get this version on next execute. Loader tidak perlu diganti.'
            );
        }
    );
}

module.exports = router;
