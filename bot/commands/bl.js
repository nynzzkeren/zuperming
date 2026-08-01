const { SlashCommandBuilder } = require('discord.js');
const db = require('../../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bl')
        .setDescription('Blacklist / unblacklist user (Admin)')
        .addUserOption(o =>
            o.setName('user').setDescription('Target user').setRequired(true))
        .addStringOption(o =>
            o.setName('action')
                .setDescription('blacklist or unblacklist')
                .setRequired(true)
                .addChoices(
                    { name: 'Blacklist', value: 'blacklist' },
                    { name: 'Unblacklist', value: 'unblacklist' }
                )),
    async execute(interaction) {
        if (!interaction.member.permissions.has('Administrator')) {
            return interaction.reply({ content: 'Admin only.', ephemeral: true });
        }

        const targetUser = interaction.options.getUser('user');
        const action = interaction.options.getString('action');
        const flag = action === 'blacklist' ? 1 : 0;

        db.run(
            `INSERT INTO users (discord_id, is_blacklisted) VALUES (?, ?)
             ON CONFLICT(discord_id) DO UPDATE SET is_blacklisted = excluded.is_blacklisted`,
            [targetUser.id, flag],
            (err) => {
                if (err) return interaction.reply({ content: 'Database error.', ephemeral: true });
                interaction.reply({
                    content: action === 'blacklist'
                        ? `✅ ${targetUser.tag} blacklisted.`
                        : `✅ ${targetUser.tag} unblacklisted.`,
                    ephemeral: true
                });
            }
        );
    },
};
