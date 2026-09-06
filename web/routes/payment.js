const express = require('express');
const router  = express.Router();
const db      = require('../../database');
const { computeExpiresAt } = require('../../utils/keys');
const { PRODUCTS } = require('../../config/products');

const PLANS = {
    monthly:  { durationDays: 30,   label: '1 Month Premium',  planSuffix: 'PREM' },
    lifetime: { durationDays: null,  label: 'Lifetime Premium', planSuffix: 'LTM'  }
};

function generateKeyString(prefix) {
    const rand = () => Math.random().toString(36).substring(2, 7).toUpperCase();
    return `${prefix}-${rand()}-${rand()}-${rand()}`;
}

// ─── Pakasir QRIS Payment Callback ─────────────────────────────────────────
// POST /api/payment/callback
// Pakasir sends webhook when QRIS payment is completed
router.post('/callback', express.json(), async (req, res) => {
    const body = req.body || {};
    const { amount, order_id, project, status, payment_method } = body;

    console.log('[Payment] Pakasir webhook received:', { order_id, project, status, amount });

    // Validate project slug if configured
    const configuredSlug = process.env.PAKASIR_PROJECT_SLUG;
    if (configuredSlug && project && project !== configuredSlug) {
        console.warn('[Payment] Project slug mismatch. Expected:', configuredSlug, 'Got:', project);
        return res.status(403).json({ success: false, message: 'Invalid project slug' });
    }

    // Pakasir sends status: "completed" when paid
    if (status !== 'completed') {
        return res.json({ success: true, message: 'Status noted, not yet completed' });
    }

    if (!order_id) {
        return res.status(400).json({ success: false, message: 'Missing order_id' });
    }

    // 1. Find the pending order by order_id
    const order = await new Promise(resolve => {
        db.get(`SELECT * FROM payment_orders WHERE order_id = ?`, [order_id], (err, row) => resolve(row));
    });

    if (!order) {
        console.error('[Payment] Order not found:', order_id);
        return res.json({ success: false, message: 'Order not found' });
    }

    if (order.status === 'paid') {
        console.log('[Payment] Order already marked as paid:', order_id);
        return res.json({ success: true, message: 'Already processed' });
    }

    // 2. Generate key with correct prefix (MIE_PREM-xxx or MIE_LTM-xxx)
    const plan = PLANS[order.plan];
    if (!plan) {
        return res.json({ success: false, message: 'Unknown plan' });
    }

    const productConfig = PRODUCTS.premium || {};
    const keyPrefix = productConfig.keyPrefix || 'MIE';
    const keyString = generateKeyString(`${keyPrefix}_${plan.planSuffix}`);
    const duration  = plan.durationDays ? `${plan.durationDays}d` : 'lifetime';
    const expiresAt = computeExpiresAt(duration);

    // 3. Insert key into database
    await new Promise(resolve => {
        db.run(
            `INSERT INTO keys (key_string, duration, status, discord_id, product, expires_at, created_at) VALUES (?, ?, 'used', ?, 'premium', ?, CURRENT_TIMESTAMP)`,
            [keyString, duration, order.discord_id, expiresAt],
            resolve
        );
    });

    // 4. Mark order as paid
    await new Promise(resolve => {
        db.run(
            `UPDATE payment_orders SET status = 'paid', key_string = ?, tripay_ref = ?, paid_at = CURRENT_TIMESTAMP WHERE order_id = ?`,
            [keyString, project || 'PAKASIR', order_id],
            resolve
        );
    });

    console.log(`[Payment] Success! Generated key ${keyString} for user ${order.discord_id}`);

    // 5. DM the key to the user
    try {
        const botManager = require('../../bot/botManager');
        const client = botManager.activeBots.get(process.env.DISCORD_TOKEN);

        if (client) {
            const user = await client.users.fetch(order.discord_id).catch(() => null);
            if (user) {
                const expiryLine = expiresAt
                    ? `Expires: **${new Date(expiresAt).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' })}**`
                    : 'Duration: **Lifetime (selamanya)**';

                // Find the project UUID for the loader URL
                const projectRow = await new Promise(resolve => {
                    db.get(`SELECT uuid FROM projects WHERE is_free = 0 ORDER BY id ASC LIMIT 1`, [], (err, row) => resolve(row));
                });
                const baseUrl = process.env.BASE_URL || 'https://zuperming.store';
                const loaderUrl = projectRow
                    ? `${baseUrl}/scripts/v4/loaders/${projectRow.uuid}.lua`
                    : `${baseUrl}/scripts/v4/loaders/LOADER_UUID.lua`;

                await user.send([
                    `## ✅ Pembayaran Berhasil Dikonfirmasi!`,
                    `Akses **${plan.label}** kamu sekarang sudah aktif.`,
                    ``,
                    `**Key Kamu:**`,
                    `\`\`\``,
                    keyString,
                    `\`\`\``,
                    expiryLine,
                    ``,
                    `**Cara Pakai di Executor (Delta, Fluxus, Wave, dll):**`,
                    `\`\`\`lua`,
                    `script_key = "${keyString}";`,
                    `loadstring(game:HttpGet("${loaderUrl}"))()`,
                    `\`\`\``,
                    `Ada kendala? Hubungi admin atau buka tiket di server.`
                ].join('\n'));
            }
        }
    } catch (e) {
        console.error('[Payment] Failed to DM user:', e.message);
    }

    // 6. Auto-assign buyer role
    try {
        const botManager = require('../../bot/botManager');
        const client = botManager.activeBots.get(process.env.DISCORD_TOKEN);
        const guildId = process.env.GUILD_ID;
        const buyerRoleId = process.env.BUYER_ROLE_ID;

        if (client && guildId && buyerRoleId) {
            const guild = await client.guilds.fetch(guildId).catch(() => null);
            if (guild) {
                const member = await guild.members.fetch(order.discord_id).catch(() => null);
                if (member) {
                    await member.roles.add(buyerRoleId).catch(err => {
                        console.warn('[Payment] Could not assign buyer role:', err.message);
                    });
                    console.log(`[Payment] Assigned buyer role to ${member.user.tag}`);
                }
            }
        }
    } catch (e) {
        console.warn('[Payment] Failed to assign buyer role:', e.message);
    }

    return res.json({ success: true, message: 'Payment verified and key issued' });
});

// ─── Status check for UI polling or debug ─────────────────────────────────
router.get('/status/:orderId', async (req, res) => {
    const { orderId } = req.params;
    const order = await new Promise(resolve => {
        db.get(`SELECT order_id, plan, amount, status, key_string, paid_at FROM payment_orders WHERE order_id = ?`, [orderId], (err, row) => resolve(row));
    });

    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    return res.json({ success: true, order });
});

module.exports = router;
