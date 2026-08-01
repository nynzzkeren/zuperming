const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { buildChangelogPayload } = require('../../utils/changelog');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping-update')
        .setDescription('Post a Change Log update ping (Admin Only)')
        .addStringOption(o => o.setName('game').setDescription('Game name').setRequired(true))
        .addStringOption(o =>
            o.setName('type')
                .setDescription('Whitelist type')
                .setRequired(true)
                .addChoices(
                    { name: 'Premium', value: 'Premium' },
                    { name: 'Service Provider', value: 'Service Provider' },
                    { name: 'Service Provider & Premium', value: 'Service Provider & Premium' }
                ))
        .addStringOption(o => o.setName('version').setDescription('Version e.g. 1.4').setRequired(true))
        .addStringOption(o => o.setName('status').setDescription('Status e.g. Undetected').setRequired(false))
        .addStringOption(o => o.setName('added').setDescription('Added items, separate with | ').setRequired(false))
        .addStringOption(o => o.setName('improved').setDescription('Improved items, separate with | ').setRequired(false))
        .addStringOption(o => o.setName('removed').setDescription('Removed items, separate with | ').setRequired(false))
        .addBooleanOption(o => o.setName('ping_everyone').setDescription('Ping @everyone').setRequired(false))
        .addChannelOption(o =>
            o.setName('channel')
                .setDescription('Target channel (default: UPDATE_CHANNEL_ID)')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false)),
    async execute(interaction) {
        if (!interaction.member.permissions.has('Administrator')) {
            return interaction.reply({ content: 'Admin only.', ephemeral: true });
        }

        const pipeToLines = (v) => (v || '').split('|').map(s => s.trim()).filter(Boolean).join('\n');

        const payload = buildChangelogPayload({
            game: interaction.options.getString('game'),
            types: interaction.options.getString('type'),
            version: interaction.options.getString('version'),
            status: interaction.options.getString('status') || 'Undetected',
            added: pipeToLines(interaction.options.getString('added')),
            improved: pipeToLines(interaction.options.getString('improved')),
            removed: pipeToLines(interaction.options.getString('removed')),
            pingEveryone: interaction.options.getBoolean('ping_everyone') || false
        });

        const channel =
            interaction.options.getChannel('channel') ||
            (process.env.UPDATE_CHANNEL_ID
                ? await interaction.client.channels.fetch(process.env.UPDATE_CHANNEL_ID).catch(() => null)
                : null) ||
            interaction.channel;

        if (!channel || !channel.isTextBased()) {
            return interaction.reply({ content: 'Invalid channel.', ephemeral: true });
        }

        await channel.send(payload);
        return interaction.reply({ content: `Update posted in ${channel}.`, ephemeral: true });
    },
};
