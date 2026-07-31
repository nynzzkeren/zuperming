const {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    MessageFlags
} = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup-panel-sp')
        .setDescription('Spawns the Service Provider Panel (Admin Only)'),
    async execute(interaction) {
        if (!interaction.member.permissions.has('Administrator')) {
            return interaction.reply({
                content: 'You do not have permission to use this command.',
                ephemeral: true
            });
        }

        const logoUrl = 'https://cdn.discordapp.com/attachments/1449307932750643210/1531296832527929457/1783999829490.png?ex=6a6aad0e&is=6a695b8e&hm=f3d61e5f150a0fb9fb1210c202a9b51e555623f4956f3ca999adbf04e8178e2b';

        const container = new ContainerBuilder()
            .addSectionComponents((section) =>
                section
                    .addTextDisplayComponents(
                        (text) => text.setContent('# Service Provider Panel'),
                        (text) => text.setContent('This panel is for the project: **Service Provider**'),
                        (text) => text.setContent('Redeem your key, get your loader script, role, reset HWID, or view stats.')
                    )
                    .setThumbnailAccessory((thumbnail) =>
                        thumbnail
                            .setURL(logoUrl)
                            .setDescription('Service Provider Logo')
                    )
            );

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('btn_sp_redeem')
                    .setLabel('Redeem Key')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('btn_sp_script')
                    .setLabel('Get Script')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('btn_sp_role')
                    .setLabel('Get Role')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('btn_sp_hwid')
                    .setLabel('Reset Hwid')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('btn_sp_stats')
                    .setLabel('Get Stats')
                    .setStyle(ButtonStyle.Secondary)
            );

        await interaction.channel.send({
            components: [container, row],
            flags: MessageFlags.IsComponentsV2
        });

        await interaction.reply({
            content: 'Service Provider panel setup successfully.',
            ephemeral: true
        });
    },
};
