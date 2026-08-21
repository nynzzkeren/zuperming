const { SlashCommandBuilder } = require('discord.js');
const db = require('../../database');
const crypto = require('crypto');
const { getProduct, PRODUCTS, getProductRoleId, getBaseUrl } = require('../../config/products');
const { normalizeDuration, computeExpiresAt, formatDurationLabel } = require('../../utils/keys');

function whitelistUser(targetUser, product, duration, expiresAt, interaction) {
    return new Promise((resolve) => {
        const key = `${product.keyPrefix}-` + crypto.randomBytes(8).toString('hex').toUpperCase();
        const loaderScript = `_G.key_script = "${key}"\nloadstring(game:HttpGet("${getBaseUrl()}${product.loaderRoute}"))()`;

        db.serialize(() => {
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
                        return resolve({ success: false, reason: err.message, user: targetUser });
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
                            const member = await interaction.guild.members.fetch(targetUser.id).catch(()=>null);
                            if (member) {
                                await member.roles.add(roleId);
                                roleMsg = `\n✅ Role **${product.name}** given`;
                            }
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

                    resolve({ success: true, key, roleMsg, user: targetUser });
                }
            );
        });
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('wl')
        .setDescription('Whitelist user or role — auto key, no redeem, langsung Get Script (Admin)')
        .addMentionableOption(o =>
            o.setName('target').setDescription('User or Role to whitelist').setRequired(true))
        .addStringOption(o =>
            o.setName('product')
                .setDescription('Panel type')
                .setRequired(true)
                .addChoices(
                    { name: 'Premium', value: 'premium' },
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

        const target = interaction.options.getMentionable('target');
        const product = getProduct(interaction.options.getString('product')) || PRODUCTS.premium;
        const duration = normalizeDuration(interaction.options.getString('duration'));
        const expiresAt = computeExpiresAt(duration);

        // Check if target is a Role
        if (target.members) {
            // It's a role
            const role = target;
            await interaction.guild.members.fetch(); // Ensure all members are cached
            const members = role.members;

            if (members.size === 0) {
                return interaction.editReply({ content: `Role **${role.name}** tidak memiliki member.` });
            }

            await interaction.editReply({ content: `🔄 Memulai mass whitelist untuk **${members.size}** member di role **${role.name}**... (Mungkin butuh waktu agak lama)` });

            let successCount = 0;
            let failCount = 0;

            for (const [memberId, member] of members) {
                if (!member.user.bot) {
                    const result = await whitelistUser(member.user, product, duration, expiresAt, interaction);
                    if (result.success) successCount++;
                    else failCount++;
                    
                    // Small delay to prevent Discord API rate limiting
                    await new Promise(r => setTimeout(r, 300));
                }
            }

            return interaction.followUp({ 
                content: `✅ Mass whitelist selesai untuk role **${role.name}**.\nBerhasil: **${successCount}**\nGagal: **${failCount}**`,
                ephemeral: true 
            });

        } else {
            // It's a single user
            const targetUser = target.user || target;
            const result = await whitelistUser(targetUser, product, duration, expiresAt, interaction);

            if (!result.success) {
                return interaction.editReply({ content: `❌ Gagal whitelist ${targetUser.tag}: ${result.reason}` });
            }

            return interaction.editReply({
                content:
                    `✅ **${targetUser.tag}** whitelisted ke **${product.name}**\n` +
                    `Key: \`${result.key}\`\n` +
                    `Duration: **${formatDurationLabel(duration)}**` +
                    result.roleMsg +
                    `\nUser bisa langsung **Get Script** (tanpa redeem).`
            });
        }
    },
};
