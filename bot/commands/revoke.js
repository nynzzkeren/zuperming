const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../database');
const { getProduct, PRODUCTS, getProductRoleId } = require('../../config/products');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('revoke')
        .setDescription('Revoke a user\'s key and remove their access (Admin)')
        .addUserOption(o =>
            o.setName('user').setDescription('Target user to revoke').setRequired(true))
        .addStringOption(o =>
            o.setName('product')
                .setDescription('Project/Product type to revoke')
                .setRequired(true)
                .addChoices(
                    { name: 'Premium', value: 'premium' },
                    { name: 'Freemium', value: 'freemium' }
                ))
        .addBooleanOption(o =>
            o.setName('remove_role')
                .setDescription('Remove Discord role as well? (default: yes)')
                .setRequired(false)),
    async execute(interaction) {
        if (!interaction.member.permissions.has('Administrator')) {
            const errEmbed = new EmbedBuilder().setColor('#FF0000').setDescription('❌ You do not have permission to use this command.');
            return interaction.reply({ embeds: [errEmbed], ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        const targetUser = interaction.options.getUser('user');
        const product = getProduct(interaction.options.getString('product')) || PRODUCTS.premium;
        const removeRole = interaction.options.getBoolean('remove_role');
        const shouldRemoveRole = removeRole !== false; // default true

        db.get(
            `SELECT * FROM keys WHERE discord_id = ? AND product = ? AND status = 'used'`,
            [targetUser.id, product.id],
            async (err, row) => {
                if (err) {
                    const errEmbed = new EmbedBuilder().setColor('#FF0000').setDescription('❌ Database error.');
                    return interaction.editReply({ embeds: [errEmbed] });
                }
                if (!row) {
                    const errEmbed = new EmbedBuilder().setColor('#FF0000').setDescription(`❌ ${targetUser.tag} does not have an active **${product.name}** key.`);
                    return interaction.editReply({ embeds: [errEmbed] });
                }

                db.serialize(() => {
                    db.run(`DELETE FROM keys WHERE id = ?`, [row.id]);
                    db.run(`UPDATE users SET hwid = NULL WHERE discord_id = ?`, [targetUser.id]);

                    (async () => {
                        let roleMsg = 'Skipped';
                        if (shouldRemoveRole && interaction.guild) {
                            const roleId = getProductRoleId(product);
                            if (roleId) {
                                try {
                                    const member = await interaction.guild.members.fetch(targetUser.id);
                                    if (member.roles.cache.has(roleId)) {
                                        await member.roles.remove(roleId);
                                        roleMsg = `✅ Removed`;
                                    } else {
                                        roleMsg = `User didn't have the role`;
                                    }
                                } catch (e) {
                                    roleMsg = `⚠️ Failed: ${e.message}`;
                                }
                            }
                        }

                        const embed = new EmbedBuilder()
                            .setColor('#FFA500') // Orange for revoke
                            .setTitle('🗑️ Access Revoked')
                            .setThumbnail(targetUser.displayAvatarURL())
                            .addFields(
                                { name: 'User', value: `<@${targetUser.id}>`, inline: true },
                                { name: 'Product', value: product.name, inline: true },
                                { name: 'Revoked Key', value: `\`${row.key_string}\``, inline: false },
                                { name: 'Role Update', value: roleMsg, inline: false },
                                { name: 'HWID', value: 'Reset automatically', inline: false }
                            )
                            .setFooter({ text: 'Lua Vault Security' })
                            .setTimestamp();

                        return interaction.editReply({ embeds: [embed] });
                    })();
                });
            }
        );
    },
};
