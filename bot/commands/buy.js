const {
    SlashCommandBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    ContainerBuilder,
    MessageFlags
} = require('discord.js');
const db = require('../../database');
const { createTicketChannel, PLANS } = require('../utils/ticketManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('buy')
        .setDescription('Purchase a Zuperming Premium license via ticket & QRIS payment'),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({
                content: 'This command can only be used inside a Discord server.',
                flags: MessageFlags.Ephemeral
            });
        }

        const discordId = interaction.user.id;

        // Check if user already has an active premium key
        const existingKey = await new Promise(resolve => {
            db.get(
                `SELECT * FROM keys WHERE discord_id = ? AND status = 'used' AND product = 'premium' AND (expires_at IS NULL OR expires_at > datetime('now')) ORDER BY id DESC LIMIT 1`,
                [discordId],
                (err, row) => resolve(row)
            );
        });

        if (existingKey) {
            const expiry = existingKey.expires_at
                ? `Expires: **${new Date(existingKey.expires_at).toLocaleDateString('en-US')}**`
                : 'Duration: **Lifetime (Permanent)**';
            return interaction.reply({
                content: `You already have an active Premium key!\n\`${existingKey.key_string}\`\n${expiry}`,
                flags: MessageFlags.Ephemeral
            });
        }

        // Check if user already has an open ticket
        const existingTicket = await new Promise(resolve => {
            db.get(
                `SELECT * FROM tickets WHERE discord_id = ? AND status != 'closed' ORDER BY id DESC LIMIT 1`,
                [discordId],
                (err, row) => resolve(row)
            );
        });

        if (existingTicket) {
            const ch = interaction.guild.channels.cache.get(existingTicket.channel_id);
            if (ch) {
                return interaction.reply({
                    content: `⚠️ You already have an open purchase ticket: <#${ch.id}>. Please continue your order there!`,
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        // Build Component V2 Container (Black Theme)
        const container = new ContainerBuilder().setAccentColor(0x000000);
        container.addTextDisplayComponents(
            (t) => t.setContent(`## Purchase Zuperming Premium`),
            (t) => t.setContent(
                `Select your subscription package below to open your private purchase ticket:\n\n` +
                `• **1 Month Premium** — Rp35.000 *(30 days access)*\n` +
                `• **Lifetime Premium** — Rp55.000 *(permanent access, never expires)*\n\n` +
                `*A private ticket channel with QRIS payment and staff support will be opened for you.*`
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

        return interaction.reply({
            components: [container],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
    }
};
