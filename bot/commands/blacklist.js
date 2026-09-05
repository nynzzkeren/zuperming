const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('blacklist')
        .setDescription('Blacklist or unblacklist a user (Admin)')
        .addUserOption(o =>
            o.setName('user').setDescription('Target user').setRequired(true))
        .addStringOption(o =>
            o.setName('action')
                .setDescription('Select action')
                .setRequired(true)
                .addChoices(
                    { name: 'Blacklist', value: 'blacklist' },
                    { name: 'Unblacklist', value: 'unblacklist' }
                )),
    async execute(interaction) {
        if (!interaction.member.permissions.has('Administrator')) {
            const errEmbed = new EmbedBuilder().setColor('#FF0000').setDescription('❌ You do not have permission to use this command.');
            return interaction.reply({ embeds: [errEmbed], ephemeral: true });
        }

        const targetUser = interaction.options.getUser('user');
        const action = interaction.options.getString('action');
        const flag = action === 'blacklist' ? 1 : 0;

        db.run(
            `INSERT INTO users (discord_id, is_blacklisted) VALUES (?, ?)
             ON CONFLICT(discord_id) DO UPDATE SET is_blacklisted = excluded.is_blacklisted`,
            [targetUser.id, flag],
            (err) => {
                if (err) {
                    const errEmbed = new EmbedBuilder().setColor('#FF0000').setDescription('❌ Database error.');
                    return interaction.reply({ embeds: [errEmbed], ephemeral: true });
                }

                const embed = new EmbedBuilder()
                    .setColor(action === 'blacklist' ? '#FF0000' : '#00FF00')
                    .setTitle(action === 'blacklist' ? '🚫 User Blacklisted' : '✅ User Unblacklisted')
                    .setThumbnail(targetUser.displayAvatarURL())
                    .addFields(
                        { name: 'User', value: `<@${targetUser.id}>`, inline: true },
                        { name: 'Status', value: action === 'blacklist' ? 'Banned from all scripts' : 'Access Restored', inline: true }
                    )
                    .setFooter({ text: 'Lua Vault Security' })
                    .setTimestamp();

                interaction.reply({ embeds: [embed] });
            }
        );
    },
};
