const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../database');
const crypto = require('crypto');
const { getProduct, PRODUCTS, getProductRoleId, getBaseUrl } = require('../../config/products');
const { normalizeDuration, computeExpiresAt, formatDurationLabel } = require('../../utils/keys');

function whitelistUser(targetUser, product, duration, expiresAt, interaction) {
    return new Promise((resolve) => {
        const rand = () => crypto.randomBytes(3).toString('hex').toUpperCase();
        const key = `${product.keyPrefix}-${rand()}-${rand()}-${rand()}`;
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
                                roleMsg = `✅ Role **${product.name}** given`;
                            }
                        } catch (e) {
                            roleMsg = `⚠️ Role failed: ${e.message}`;
                        }
                    }

                    try {
                        const dmEmbed = new EmbedBuilder()
                            .setColor('#00FF00')
                            .setTitle('🎉 You have been whitelisted!')
                            .setDescription(`You were whitelisted for **${product.name}**. No need to redeem a key.`)
                            .addFields(
                                { name: 'Duration', value: formatDurationLabel(duration), inline: true },
                                { name: 'Expires At', value: expiresAt ? expiresAt : 'Permanent', inline: true }
                            )
                            .setFooter({ text: 'Lua Vault Script Whitelister' })
                            .setTimestamp();
                            
                        await targetUser.send({ embeds: [dmEmbed], content: `**Loader Script:**\n\`\`\`lua\n${loaderScript}\n\`\`\`` });
                    } catch {
                        // DMs closed
                    }

                    resolve({ success: true, key, roleMsg, user: targetUser });
                }
            );
        });
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('whitelist')
        .setDescription('Whitelist a user or role directly (Admin)')
        .addMentionableOption(o =>
            o.setName('target').setDescription('User or Role to whitelist').setRequired(true))
        .addStringOption(o =>
            o.setName('product')
                .setDescription('Project/Product type')
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
            const errEmbed = new EmbedBuilder().setColor('#FF0000').setDescription('❌ You do not have permission to use this command.');
            return interaction.reply({ embeds: [errEmbed], ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        const target = interaction.options.getMentionable('target');
        const product = getProduct(interaction.options.getString('product')) || PRODUCTS.premium;
        const duration = normalizeDuration(interaction.options.getString('duration'));
        const expiresAt = computeExpiresAt(duration);

        if (target.members) {
            // It's a role
            const role = target;
            await interaction.guild.members.fetch(); 
            const members = role.members;

            if (members.size === 0) {
                const errEmbed = new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Role **${role.name}** has no members.`);
                return interaction.editReply({ embeds: [errEmbed] });
            }

            const loadingEmbed = new EmbedBuilder().setColor('#FFFF00').setDescription(`🔄 Starting mass whitelist for **${members.size}** members in role **${role.name}**...`);
            await interaction.editReply({ embeds: [loadingEmbed] });

            let successCount = 0;
            let failCount = 0;

            for (const [memberId, member] of members) {
                if (!member.user.bot) {
                    const result = await whitelistUser(member.user, product, duration, expiresAt, interaction);
                    if (result.success) successCount++;
                    else failCount++;
                    await new Promise(r => setTimeout(r, 300));
                }
            }

            const resultEmbed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('✅ Mass Whitelist Complete')
                .addFields(
                    { name: 'Target Role', value: `${role.name}`, inline: true },
                    { name: 'Product', value: `${product.name}`, inline: true },
                    { name: 'Success', value: `${successCount}`, inline: true },
                    { name: 'Failed', value: `${failCount}`, inline: true }
                );

            return interaction.followUp({ embeds: [resultEmbed], ephemeral: true });

        } else {
            // It's a single user
            const targetUser = target.user || target;
            const result = await whitelistUser(targetUser, product, duration, expiresAt, interaction);

            if (!result.success) {
                const errEmbed = new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Failed to whitelist ${targetUser.tag}: ${result.reason}`);
                return interaction.editReply({ embeds: [errEmbed] });
            }

            const embed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('✅ User Whitelisted')
                .setThumbnail(targetUser.displayAvatarURL())
                .addFields(
                    { name: 'User', value: `<@${targetUser.id}>`, inline: true },
                    { name: 'Product', value: product.name, inline: true },
                    { name: 'Duration', value: formatDurationLabel(duration), inline: true },
                    { name: 'Key Generated', value: `\`${result.key}\``, inline: false }
                )
                .setFooter({ text: 'Lua Vault Security' });

            if (result.roleMsg) {
                embed.addFields({ name: 'Role Status', value: result.roleMsg });
            }

            return interaction.editReply({ embeds: [embed] });
        }
    },
};
