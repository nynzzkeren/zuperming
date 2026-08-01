const { SlashCommandBuilder } = require('discord.js');
const db = require('../../database');
const crypto = require('crypto');
const { getProduct, PRODUCTS, getProductRoleId, getBaseUrl } = require('../../config/products');
const { normalizeDuration, computeExpiresAt, formatDurationLabel } = require('../../utils/keys');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('wl')
        .setDescription('Whitelist user — auto key, no redeem, langsung Get Script (Admin)')
        .addUserOption(o =>
            o.setName('user').setDescription('User to whitelist').setRequired(true))
        .addStringOption(o =>
            o.setName('product')
                .setDescription('Panel type')
                .setRequired(true)
                .addChoices(
                    { name: 'Premium', value: 'premium' },
                    { name: 'Service Provider', value: 'service_provider' },
                    { name: 'Freemium', value: 'freemium' }
                ))
        .addStringOption(o =>
            o.setName('duration')
                .setDescription('Empty = permanent. Ex: 1d, 7d, 30d')
                .setRequired(false)),
    async execute(interaction) {
        if (!interaction.member.permissions.has('Administrator')) {
            return interaction.reply({ content: 'Admin only.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        const targetUser = interaction.options.getUser('user');
        const product = getProduct(interaction.options.getString('product')) || PRODUCTS.premium;
        const duration = normalizeDuration(interaction.options.getString('duration'));
        const expiresAt = computeExpiresAt(duration);
        const key = `${product.keyPrefix}-` + crypto.randomBytes(8).toString('hex').toUpperCase();
        const loaderScript =
            `_G.key_script = "${key}"\nloadstring(game:HttpGet("${getBaseUrl()}${product.loaderRoute}"))()`;

        db.serialize(() => {
            // Clear previous used key for this user+product (replace whitelist)
            db.run(
                `UPDATE keys SET status = 'unused', discord_id = NULL WHERE discord_id = ? AND product = ? AND status = 'used'`,
                [targetUser.id, product.id]
            );

            db.run(
                `INSERT INTO keys (key_string, duration, product, status, discord_id, redeemed_at, expires_at)
                 VALUES (?, ?, ?, 'used', ?, CURRENT_TIMESTAMP, ?)`,
                [key, duration, product.id, targetUser.id, expiresAt],
                async function (err) {
                    if (err) {
                        console.error(err);
                        return interaction.editReply({ content: 'DB error: ' + err.message });
                    }

                    db.run(
                        `INSERT INTO users (discord_id, is_blacklisted) VALUES (?, 0)
                         ON CONFLICT(discord_id) DO UPDATE SET is_blacklisted = 0`,
                        [targetUser.id]
                    );

                    let roleMsg = '';
                    const roleId = getProductRoleId(product);
                    if (roleId && interaction.guild) {
                        try {
                            const member = await interaction.guild.members.fetch(targetUser.id);
                            await member.roles.add(roleId);
                            roleMsg = `\n✅ Role **${product.name}** given`;
                        } catch (e) {
                            roleMsg = `\n⚠️ Role gagal: ${e.message}`;
                        }
                    } else {
                        roleMsg = `\n⚠️ Role ID belum di-set di .env (${product.roleEnv})`;
                    }

                    try {
                        await targetUser.send(
                            `# Whitelisted · ${product.name}\n` +
                            `Kamu sudah di-whitelist. **Tidak perlu redeem.**\n\n` +
                            `Duration: **${formatDurationLabel(duration)}**` +
                            (expiresAt ? `\nExpires: ${expiresAt}` : '\nExpires: Permanent') +
                            `\n\nLoader:\n\`\`\`lua\n${loaderScript}\n\`\`\`\n` +
                            `Atau pakai tombol **Get Script** di panel.`
                        );
                    } catch {
                        // DMs closed — still ok
                    }

                    return interaction.editReply({
                        content:
                            `✅ **${targetUser.tag}** whitelisted ke **${product.name}**\n` +
                            `Key: \`${key}\`\n` +
                            `Duration: **${formatDurationLabel(duration)}**` +
                            roleMsg +
                            `\nUser bisa langsung **Get Script** (tanpa redeem).`
                    });
                }
            );
        });
    },
};
