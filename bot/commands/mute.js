const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const DURATION_MAP = {
    '60s':   60,
    '5m':    5 * 60,
    '10m':   10 * 60,
    '30m':   30 * 60,
    '1h':    60 * 60,
    '6h':    6 * 60 * 60,
    '12h':   12 * 60 * 60,
    '1d':    24 * 60 * 60,
    '7d':    7 * 24 * 60 * 60,
    '28d':   28 * 24 * 60 * 60,
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mute')
        .setDescription('Timeout (mute) or unmute a member (Admin)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('Timeout (mute) a member')
                .addUserOption(o => o.setName('user').setDescription('User to mute').setRequired(true))
                .addStringOption(o =>
                    o.setName('duration')
                        .setDescription('Duration of timeout')
                        .setRequired(true)
                        .addChoices(
                            { name: '1 minute',  value: '60s' },
                            { name: '5 minutes', value: '5m' },
                            { name: '10 minutes',value: '10m' },
                            { name: '30 minutes',value: '30m' },
                            { name: '1 hour',    value: '1h' },
                            { name: '6 hours',   value: '6h' },
                            { name: '12 hours',  value: '12h' },
                            { name: '1 day',     value: '1d' },
                            { name: '7 days',    value: '7d' },
                            { name: '28 days',   value: '28d' }
                        ))
                .addStringOption(o =>
                    o.setName('reason')
                        .setDescription('Reason for mute')
                        .setRequired(false)))
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('Remove timeout from a member')
                .addUserOption(o => o.setName('user').setDescription('User to unmute').setRequired(true))),

    async execute(interaction) {
        if (!interaction.member.permissions.has('ModerateMembers')) {
            return interaction.reply({ content: 'You need Moderate Members permission.', ephemeral: true });
        }

        const sub = interaction.options.getSubcommand();
        const target = interaction.options.getMember('user');

        if (!target) return interaction.reply({ content: 'Member not found.', ephemeral: true });

        if (sub === 'add') {
            const durationKey = interaction.options.getString('duration');
            const reason = interaction.options.getString('reason') || 'No reason provided';
            const seconds = DURATION_MAP[durationKey];

            if (!seconds) return interaction.reply({ content: 'Invalid duration.', ephemeral: true });
            if (!target.moderatable) return interaction.reply({ content: 'I cannot timeout that member.', ephemeral: true });

            try {
                await target.timeout(seconds * 1000, reason);
                const readableTime = durationKey.replace('s', ' second(s)').replace('m', ' minute(s)').replace('h', ' hour(s)').replace('d', ' day(s)');
                return interaction.reply({
                    content: `**${target.user.tag}** has been muted for **${readableTime}**.\n**Reason:** ${reason}`
                });
            } catch (e) {
                return interaction.reply({ content: `Failed to mute: ${e.message}`, ephemeral: true });
            }
        }

        if (sub === 'remove') {
            if (!target.moderatable) return interaction.reply({ content: 'I cannot modify that member.', ephemeral: true });
            try {
                await target.timeout(null);
                return interaction.reply({ content: `**${target.user.tag}** has been unmuted.` });
            } catch (e) {
                return interaction.reply({ content: `Failed to unmute: ${e.message}`, ephemeral: true });
            }
        }
    }
};
