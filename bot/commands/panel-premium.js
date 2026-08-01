const {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    MessageFlags
} = require('discord.js');
const { isUsableHttpUrl } = require('../../utils/changelog');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('panel-premium')
        .setDescription('Spawn Premium panel (Admin)'),
    async execute(interaction) {
        if (!interaction.member.permissions.has('Administrator')) {
            return interaction.reply({ content: 'Admin only.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        const logoUrl = process.env.BRAND_LOGO_URL || '';
        const container = new ContainerBuilder();

        if (isUsableHttpUrl(logoUrl)) {
            container.addSectionComponents((section) =>
                section
                    .addTextDisplayComponents(
                        (text) => text.setContent('# Zuperming Premium Panel'),
                        (text) => text.setContent('Project: **Zuperming Premium**'),
                        (text) => text.setContent('Redeem key, get script, role, reset HWID, or view stats.')
                    )
                    .setThumbnailAccessory((thumbnail) =>
                        thumbnail.setURL(logoUrl).setDescription('Zuperming')
                    )
            );
        } else {
            container.addTextDisplayComponents(
                (text) => text.setContent('# Zuperming Premium Panel'),
                (text) => text.setContent('Project: **Zuperming Premium**'),
                (text) => text.setContent('Redeem key, get script, role, reset HWID, or view stats.')
            );
        }

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('btn_redeem').setLabel('Redeem Key').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('btn_script').setLabel('Get Script').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('btn_role').setLabel('Get Role').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('btn_hwid').setLabel('Reset Hwid').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('btn_stats').setLabel('Get Stats').setStyle(ButtonStyle.Secondary)
        );

        try {
            await interaction.channel.send({
                components: [container, row],
                flags: MessageFlags.IsComponentsV2
            });
        } catch (e) {
            // Retry without thumbnail
            const plain = new ContainerBuilder().addTextDisplayComponents(
                (text) => text.setContent('# Zuperming Premium Panel'),
                (text) => text.setContent('Project: **Zuperming Premium**'),
                (text) => text.setContent('Redeem key, get script, role, reset HWID, or view stats.')
            );
            await interaction.channel.send({
                components: [plain, row],
                flags: MessageFlags.IsComponentsV2
            });
        }

        return interaction.editReply({ content: 'Premium panel setup OK.' });
    },
};
