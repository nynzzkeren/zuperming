const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('purge')
        .setDescription('Delete messages in bulk (Admin)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addIntegerOption(o =>
            o.setName('amount')
                .setDescription('Number of messages to delete (1-100)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(100))
        .addUserOption(o =>
            o.setName('user')
                .setDescription('Only delete messages from this user')
                .setRequired(false)),

    async execute(interaction) {
        if (!interaction.member.permissions.has('ManageMessages')) {
            return interaction.reply({ content: 'You need Manage Messages permission.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        const amount = interaction.options.getInteger('amount');
        const targetUser = interaction.options.getUser('user');

        try {
            let deleted = 0;

            if (targetUser) {
                // Fetch up to 100 messages, filter by user, delete up to `amount`
                const fetched = await interaction.channel.messages.fetch({ limit: 100 });
                const filtered = fetched
                    .filter(m => m.author.id === targetUser.id)
                    .first(amount);

                if (filtered.length === 0) {
                    return interaction.editReply({ content: `No recent messages from **${targetUser.tag}** found.` });
                }

                const toDelete = filtered.filter(m => Date.now() - m.createdTimestamp < 14 * 24 * 60 * 60 * 1000);
                await interaction.channel.bulkDelete(toDelete, true);
                deleted = toDelete.size || toDelete.length;
            } else {
                const messages = await interaction.channel.bulkDelete(amount, true);
                deleted = messages.size;
            }

            return interaction.editReply({
                content: `Deleted **${deleted}** message(s)${targetUser ? ` from **${targetUser.tag}**` : ''}.`
            });
        } catch (e) {
            return interaction.editReply({ content: `Failed to purge: ${e.message}` });
        }
    }
};
