const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('resethwid')
        .setDescription('Reset Hardware ID for a user (Admin)')
        .addUserOption(o =>
            o.setName('user').setDescription('Target user to reset HWID').setRequired(true)),
    async execute(interaction) {
        if (!interaction.member.permissions.has('Administrator')) {
            const errEmbed = new EmbedBuilder().setColor('#FF0000').setDescription('❌ You do not have permission to use this command.');
            return interaction.reply({ embeds: [errEmbed], ephemeral: true });
        }

        const targetUser = interaction.options.getUser('user');

        db.get(`SELECT hwid FROM users WHERE discord_id = ?`, [targetUser.id], (err, row) => {
            if (err) {
                const errEmbed = new EmbedBuilder().setColor('#FF0000').setDescription('❌ Database error.');
                return interaction.reply({ embeds: [errEmbed], ephemeral: true });
            }

            if (!row || !row.hwid) {
                const errEmbed = new EmbedBuilder().setColor('#FFA500').setDescription(`⚠️ <@${targetUser.id}> does not have a registered HWID.`);
                return interaction.reply({ embeds: [errEmbed], ephemeral: true });
            }

            db.run(`UPDATE users SET hwid = NULL WHERE discord_id = ?`, [targetUser.id], (updateErr) => {
                if (updateErr) {
                    const errEmbed = new EmbedBuilder().setColor('#FF0000').setDescription('❌ Database update error.');
                    return interaction.reply({ embeds: [errEmbed], ephemeral: true });
                }

                const embed = new EmbedBuilder()
                    .setColor('#0099FF')
                    .setTitle('🔄 HWID Reset Successful')
                    .setThumbnail(targetUser.displayAvatarURL())
                    .addFields(
                        { name: 'User', value: `<@${targetUser.id}>`, inline: true },
                        { name: 'Previous HWID', value: `\`${row.hwid}\``, inline: false },
                        { name: 'New HWID', value: 'Will be bound on next execution', inline: false }
                    )
                    .setFooter({ text: 'Lua Vault Security' })
                    .setTimestamp();

                interaction.reply({ embeds: [embed] });
            });
        });
    },
};
