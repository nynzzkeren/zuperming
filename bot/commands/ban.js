const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Ban a member from the server (Admin)')
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
        .addUserOption(o =>
            o.setName('user')
                .setDescription('User to ban')
                .setRequired(true))
        .addStringOption(o =>
            o.setName('reason')
                .setDescription('Reason for ban')
                .setRequired(false))
        .addIntegerOption(o =>
            o.setName('delete_days')
                .setDescription('Days of messages to delete (0-7)')
                .setMinValue(0)
                .setMaxValue(7)
                .setRequired(false)),

    async execute(interaction) {
        if (!interaction.member.permissions.has('BanMembers')) {
            return interaction.reply({ content: 'You need Ban Members permission.', ephemeral: true });
        }

        const target = interaction.options.getMember('user');
        const reason = interaction.options.getString('reason') || 'No reason provided';
        const deleteDays = interaction.options.getInteger('delete_days') ?? 0;

        if (!target) return interaction.reply({ content: 'Member not found.', ephemeral: true });
        if (!target.bannable) return interaction.reply({ content: 'I cannot ban that member (higher role or owner).', ephemeral: true });

        if (target.id === interaction.user.id) {
            return interaction.reply({ content: 'You cannot ban yourself.', ephemeral: true });
        }

        try {
            await target.ban({ deleteMessageDays: deleteDays, reason });
            return interaction.reply({
                content: `**${target.user.tag}** has been banned.\n**Reason:** ${reason}\n**Messages deleted:** Last ${deleteDays} day(s)`
            });
        } catch (e) {
            return interaction.reply({ content: `Failed to ban: ${e.message}`, ephemeral: true });
        }
    }
};
