const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { buildChangelogPayload } = require('../../utils/changelog');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('update')
        .setDescription('Post Change Log update (Admin)')
        .addStringOption(o => o.setName('game').setDescription('Game name').setRequired(true))
        .addStringOption(o =>
            o.setName('type')
                .setDescription('Project type')
                .setRequired(true)
                .addChoices(
                    { name: 'Premium', value: 'Premium' },
                    { name: 'Freemium', value: 'Freemium' }
                ))
        .addStringOption(o => o.setName('version').setDescription('Version e.g. 1.4').setRequired(true))
        .addStringOption(o => o.setName('status').setDescription('Status e.g. Undetected').setRequired(false))
        .addStringOption(o => o.setName('added').setDescription('Added items, separate with |').setRequired(false))
        .addStringOption(o => o.setName('improved').setDescription('Fixed/improved items, separate with |').setRequired(false))
        .addStringOption(o => o.setName('removed').setDescription('Removed items, separate with |').setRequired(false))
        // Role ping: choose which role to mention
        .addRoleOption(o =>
            o.setName('ping_role')
                .setDescription('Role to ping inside the update (e.g. @Members)')
                .setRequired(false))
        .addBooleanOption(o => o.setName('ping_everyone').setDescription('Ping @everyone instead of a role').setRequired(false))
        .addChannelOption(o =>
            o.setName('channel')
                .setDescription('Target channel (default UPDATE_CHANNEL_ID)')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false)),

    async execute(interaction) {
        if (!interaction.member.permissions.has('Administrator')) {
            return interaction.reply({ content: 'Admin only.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        const pipeToLines = (v) => (v || '').split('|').map(s => s.trim()).filter(Boolean).join('\n');

        const pingRole   = interaction.options.getRole('ping_role') || null;
        const pingEveryone = interaction.options.getBoolean('ping_everyone') || false;

        // Build the mention string that goes inside the container
        let roleMention = null;
        if (pingEveryone) {
            roleMention = '@everyone';
        } else if (pingRole) {
            roleMention = `<@&${pingRole.id}>`;
        }

        const base = {
            game:         interaction.options.getString('game'),
            types:        interaction.options.getString('type'),
            version:      interaction.options.getString('version'),
            status:       interaction.options.getString('status') || 'Undetected',
            added:        pipeToLines(interaction.options.getString('added')),
            improved:     pipeToLines(interaction.options.getString('improved')),
            removed:      pipeToLines(interaction.options.getString('removed')),
            pingEveryone,
            roleMention,
        };

        const channel =
            interaction.options.getChannel('channel') ||
            (process.env.UPDATE_CHANNEL_ID
                ? await interaction.client.channels.fetch(process.env.UPDATE_CHANNEL_ID).catch(() => null)
                : null) ||
            interaction.channel;

        const { EmbedBuilder } = require('discord.js');

        if (!channel || !channel.isTextBased()) {
            const errEmbed = new EmbedBuilder().setColor('#FF0000').setDescription('Invalid channel.');
            return interaction.editReply({ embeds: [errEmbed] });
        }

        try {
            await channel.send(buildChangelogPayload(base));
        } catch (e1) {
            try {
                await channel.send(buildChangelogPayload({ ...base, includeThumbnail: false }));
            } catch (e2) {
                const errEmbed = new EmbedBuilder().setColor('#FF0000').setDescription(`Failed: ${e2.message}`);
                return interaction.editReply({ embeds: [errEmbed] });
            }
        }

        const mentionNote = roleMention ? ` — pinged ${roleMention}` : '';
        const successEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setDescription(`Update posted in ${channel}${mentionNote}.`);
        return interaction.editReply({ embeds: [successEmbed] });
    },
};
