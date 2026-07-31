const {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    TextDisplayBuilder,
    SectionBuilder,
    ThumbnailBuilder,
    SeparatorBuilder,
    MessageFlags
} = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup-panel')
        .setDescription('Spawns the Zuperming Premium Panel (Admin Only)'),
    async execute(interaction) {
        if (!interaction.member.permissions.has('Administrator')) {
            return interaction.reply({
                content: 'You do not have permission to use this command.',
                ephemeral: true
            });
        }

        const logoUrl = 'https://cdn.discordapp.com/attachments/1449307932750643210/1531296832527929457/1783999829490.png?ex=6a6aad0e&is=6a695b8e&hm=f3d61e5f150a0fb9fb1210c202a9b51e555623f4956f3ca999adbf04e8178e2b';

        // Container V2 - Dark theme mirip screenshot
        const container = new ContainerBuilder()
            // Tanpa accent color = default dark (mirip screenshot lo)
            .addSectionComponents((section) =>
                section
                    .addTextDisplayComponents(
                        (text) => text.setContent('# Zuperming Premium Panel'),
                        (text) => text.setContent('This panel is for the project: **Zuperming**'),
                        (text) => text.setContent('If you\'re a buyer, click on the buttons below for manage your key, redeem your key, get the script or get your role')
                    )
                    .setThumbnailAccessory((thumbnail) =>
                        thumbnail
                            .setURL(logoUrl)
                            .setDescription('Zuperming Logo')
                    )
            );

        // Action Row - tetap di luar container (mirip screenshot)
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('btn_redeem')
                    .setLabel('Redeem Key')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('btn_script')
                    .setLabel('Get Script')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('btn_role')
                    .setLabel('Get Role')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('btn_hwid')
                    .setLabel('Reset Hwid')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('btn_stats')
                    .setLabel('Get Stats')
                    .setStyle(ButtonStyle.Secondary)
            );

        await interaction.channel.send({
            components: [container, row],
            flags: MessageFlags.IsComponentsV2
        });

        await interaction.reply({
            content: 'Panel setup successfully.',
            ephemeral: true
        });
    },
};