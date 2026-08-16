const {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    MessageFlags
} = require('discord.js');
const { isUsableHttpUrl } = require('../../utils/changelog');
const { getFreemiumGetKeyUrl, getSupportUrl } = require('../../config/products');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('panel-free')
        .setDescription('Spawn Freemium panel (Admin)'),
    async execute(interaction) {
        if (!interaction.member.permissions.has('Administrator')) {
            return interaction.reply({ content: 'Admin only.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        const logoUrl = process.env.BRAND_LOGO_URL || '';
        const getKeyUrl = getFreemiumGetKeyUrl();
        const supportUrl = getSupportUrl();

        const container = new ContainerBuilder();
        if (isUsableHttpUrl(logoUrl)) {
            container.addSectionComponents((section) =>
                section
                    .addTextDisplayComponents(
                        (text) => text.setContent('# Zuperming Freemium Panel'),
                        (text) => text.setContent('Project: **Freemium**'),
                        (text) => text.setContent('Get script, get free key from web, or open support.')
                    )
                    .setThumbnailAccessory((thumbnail) =>
                        thumbnail.setURL(logoUrl).setDescription('Freemium')
                    )
            );
        } else {
            container.addTextDisplayComponents(
                (text) => text.setContent('# Zuperming Freemium Panel'),
                (text) => text.setContent('Project: **Freemium**'),
                (text) => text.setContent('Get script, get free key from web, or open support.')
            );
        }

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('btn_free_script')
                .setLabel('Get Script')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('btn_free_check_key')
                .setLabel('Check Key')
                .setStyle(ButtonStyle.Secondary),
            isUsableHttpUrl(getKeyUrl)
                ? new ButtonBuilder()
                    .setLabel('Get Key')
                    .setStyle(ButtonStyle.Link)
                    .setURL(getKeyUrl)
                : new ButtonBuilder()
                    .setCustomId('btn_free_getkey')
                    .setLabel('Get Key')
                    .setStyle(ButtonStyle.Primary),
            isUsableHttpUrl(supportUrl)
                ? new ButtonBuilder()
                    .setLabel('Support')
                    .setStyle(ButtonStyle.Link)
                    .setURL(supportUrl)
                : new ButtonBuilder()
                    .setCustomId('btn_free_support')
                    .setLabel('Support')
                    .setStyle(ButtonStyle.Secondary)
        );

        try {
            await interaction.channel.send({
                components: [container, row],
                flags: MessageFlags.IsComponentsV2
            });
        } catch {
            const plain = new ContainerBuilder().addTextDisplayComponents(
                (text) => text.setContent('# Zuperming Freemium Panel'),
                (text) => text.setContent('Project: **Freemium**'),
                (text) => text.setContent('Get script, get free key from web, or open support.')
            );
            await interaction.channel.send({
                components: [plain, row],
                flags: MessageFlags.IsComponentsV2
            });
        }

        return interaction.editReply({ content: 'Freemium panel setup OK.' });
    },
};
