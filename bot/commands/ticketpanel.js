const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    ContainerBuilder,
    MessageFlags
} = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ticketpanel')
        .setDescription('Send the persistent Premium Purchase ticket panel in this channel')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({
                content: 'This command can only be used in a server.',
                flags: MessageFlags.Ephemeral
            });
        }

        const container = new ContainerBuilder().setAccentColor(0x000000);
        container.addTextDisplayComponents(
            (t) => t.setContent(`## Zuperming Premium — Purchase Panel`),
            (t) => t.setContent(
                `Welcome to the official **Zuperming Premium** store!\n\n` +
                `Select a package below to open your private purchase ticket with QRIS payment:\n\n` +
                `• **1 Month Premium** — Rp35.000 *(30 days full premium access)*\n` +
                `• **Lifetime Premium** — Rp55.000 *(permanent access, never expires)*\n\n` +
                `*Supports all QRIS providers (DANA, GoPay, OVO, ShopeePay, Mobile Banking).*`
            )
        );

        const monthBtn = new ButtonBuilder()
            .setCustomId('btn_buy_ticket_monthly')
            .setLabel('1 Month — Rp35.000')
            .setStyle(ButtonStyle.Primary);

        const lifeBtn = new ButtonBuilder()
            .setCustomId('btn_buy_ticket_lifetime')
            .setLabel('Lifetime — Rp55.000')
            .setStyle(ButtonStyle.Success);

        const row = new ActionRowBuilder().addComponents(monthBtn, lifeBtn);
        container.addActionRowComponents(row);

        await interaction.channel.send({
            components: [container],
            flags: MessageFlags.IsComponentsV2
        });

        return interaction.reply({
            content: '✅ Purchase ticket panel sent successfully!',
            flags: MessageFlags.Ephemeral
        });
    }
};
