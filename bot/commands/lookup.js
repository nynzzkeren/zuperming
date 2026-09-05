const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('lookup')
        .setDescription('Lookup user information, keys, and HWID (Admin)')
        .addUserOption(o =>
            o.setName('user').setDescription('Target user').setRequired(true)),
    async execute(interaction) {
        if (!interaction.member.permissions.has('Administrator')) {
            const errEmbed = new EmbedBuilder().setColor('#FF0000').setDescription('❌ You do not have permission to use this command.');
            return interaction.reply({ embeds: [errEmbed], ephemeral: true });
        }

        await interaction.deferReply();

        const targetUser = interaction.options.getUser('user');

        db.get(`SELECT hwid, is_blacklisted FROM users WHERE discord_id = ?`, [targetUser.id], (err, userRow) => {
            if (err) {
                const errEmbed = new EmbedBuilder().setColor('#FF0000').setDescription('❌ Database error.');
                return interaction.editReply({ embeds: [errEmbed] });
            }

            db.all(`SELECT key_string, product, status, expires_at FROM keys WHERE discord_id = ?`, [targetUser.id], (keyErr, keys) => {
                if (keyErr) {
                    const errEmbed = new EmbedBuilder().setColor('#FF0000').setDescription('❌ Database error while fetching keys.');
                    return interaction.editReply({ embeds: [errEmbed] });
                }

                const embed = new EmbedBuilder()
                    .setColor('#2B2D31')
                    .setTitle(`🔍 User Lookup: ${targetUser.username}`)
                    .setThumbnail(targetUser.displayAvatarURL())
                    .addFields(
                        { name: 'Discord ID', value: `\`${targetUser.id}\``, inline: true },
                        { name: 'HWID Status', value: userRow && userRow.hwid ? `\`${userRow.hwid}\`` : 'Not Bound', inline: true },
                        { name: 'Blacklist', value: userRow && userRow.is_blacklisted ? '🔴 Yes' : '🟢 No', inline: true }
                    )
                    .setFooter({ text: 'Lua Vault Security' })
                    .setTimestamp();

                let keyList = '';
                if (keys && keys.length > 0) {
                    keys.forEach((k, i) => {
                        keyList += `**${i+1}.** \`${k.key_string}\` (${k.product}) - ${k.status === 'used' ? '🟢 Active' : '⚪ Unused'}\n`;
                    });
                } else {
                    keyList = 'No keys found for this user.';
                }
                
                embed.addFields({ name: '🔑 Owned Keys', value: keyList, inline: false });

                // Action Buttons (Component v2)
                const row = new ActionRowBuilder();
                
                // Add Reset HWID Button
                const resetBtn = new ButtonBuilder()
                    .setCustomId(`lookup_reset_${targetUser.id}`)
                    .setLabel('Reset HWID')
                    .setEmoji('🔄')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(!userRow || !userRow.hwid);
                    
                // Add Ban/Unban Button
                const isBanned = userRow && userRow.is_blacklisted;
                const banBtn = new ButtonBuilder()
                    .setCustomId(`lookup_ban_${targetUser.id}_${isBanned ? 'unban' : 'ban'}`)
                    .setLabel(isBanned ? 'Unblacklist' : 'Blacklist')
                    .setEmoji(isBanned ? '✅' : '🚫')
                    .setStyle(isBanned ? ButtonStyle.Success : ButtonStyle.Danger);

                row.addComponents(resetBtn, banBtn);

                interaction.editReply({ embeds: [embed], components: [row] });
            });
        });
    },
};
