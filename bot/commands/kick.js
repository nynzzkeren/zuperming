const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Kick a member from the server (Admin)')
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
        .addUserOption(o =>
            o.setName('user')
                .setDescription('User to kick')
                .setRequired(true))
        .addStringOption(o =>
            o.setName('reason')
                .setDescription('Reason for kick')
                .setRequired(false)),

    async execute(interaction) {
        if (!interaction.member.permissions.has('KickMembers')) {
            return interaction.reply({ content: 'You need Kick Members permission.', ephemeral: true });
        }

        const target = interaction.options.getMember('user');
        const reason = interaction.options.getString('reason') || 'No reason provided';

        if (!target) return interaction.reply({ content: 'Member not found.', ephemeral: true });
        if (!target.kickable) return interaction.reply({ content: 'I cannot kick that member (higher role or owner).', ephemeral: true });

        if (target.id === interaction.user.id) {
            return interaction.reply({ content: 'You cannot kick yourself.', ephemeral: true });
        }

        try {
            await target.kick(reason);
            return interaction.reply({
                content: `**${target.user.tag}** has been kicked.\n**Reason:** ${reason}`
            });
        } catch (e) {
            return interaction.reply({ content: `Failed to kick: ${e.message}`, ephemeral: true });
        }
    }
};
