const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ContainerBuilder,
    SectionBuilder,
    SeparatorBuilder,
    MessageFlags
} = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('sendrules')
        .setDescription('Send official community rules to the rules channel (Admin)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption(option =>
            option.setName('target_channel')
                .setDescription('The channel to send the rules to (Default: #rules channel)')
                .setRequired(false)),

    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                content: '❌ You do not have permission to execute this command.',
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const defaultChannelId = process.env.RULES_CHANNEL_ID || '1543305866734866453';
        const targetChannel = interaction.options.getChannel('target_channel') || 
                              interaction.guild.channels.cache.get(defaultChannelId);

        if (!targetChannel || !targetChannel.isTextBased()) {
            return interaction.editReply({
                content: `❌ Could not find target rules channel with ID: \`${defaultChannelId}\`. Please check channel permissions or specify the channel in the option.`
            });
        }

        // ─── Component V2 Rules Container (Black Theme) ───────────────────
        const container = new ContainerBuilder().setAccentColor(0x000000);

        container.addTextDisplayComponents(
            (t) => t.setContent(`# 📜 Official Community Guidelines & Server Rules`),
            (t) => t.setContent(
                `Welcome to **MIE AYAM HUB Community**!\n` +
                `To preserve an enjoyable, productive, and safe environment for all members and developers, everyone is required to strictly observe the server rules outlined below.\n` +
                `Joining and participating in this server signifies your full agreement to these terms.`
            )
        );

        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

        container.addTextDisplayComponents(
            (t) => t.setContent(
                `### 1. General Respect & Civil Conduct\n` +
                `Treat every community member and staff member with decency. Harassment, hate speech, racism, sexism, bullying, or derogatory remarks will result in an immediate sanction.\n\n` +

                `### 2. Strictly Zero Tolerance for Drama\n` +
                `**No drama allowed.** Keep personal grievances, toxic arguments, hostile bickering, and grudge matches out of this server. Do NOT drag outside drama or disputes from other servers into public chat. If you have an issue with someone, handle it privately in DMs or submit a staff support ticket.\n\n` +

                `### 3. Competitor Hub Policy (No Direct Hub Naming)\n` +
                `**Do NOT explicitly name or advertise other script hubs by their full, clear names.**\n` +
                `• Direct promotion, naming, or sharing links/invites of competing script hubs is strictly prohibited.\n` +
                `• Shortened abbreviations, masked names, or subtle/implicit mentions are acceptable when discussing game mechanics, but explicit hub naming or endorsement is forbidden.\n\n` +

                `### 4. No Spamming or Unsolicited Promotion\n` +
                `Avoid flood chatting, copy-paste spam, excessive emoji spam, or unapproved self-promotion. Advertising via unsolicited private DMs to our members will result in an instant permanent ban.\n\n` +

                `### 5. Prohibited & Malicious Content\n` +
                `Any distribution of NSFW/adult media, gore, malicious files, token loggers, account theft tools, or illegal material is strictly forbidden and reported.\n\n` +

                `### 6. Channel Usage & On-Topic Discussions\n` +
                `Keep your conversations relevant to their respective channels. Use dedicated channels for script support, executor discussions, bug reporting, and bot commands.\n\n` +

                `### 7. Staff Authority & Inquiries\n` +
                `Staff members maintain server integrity. Follow staff instructions without causing public arguments. If you feel a moderation decision was inaccurate, appeal politely via a private ticket.`
            )
        );

        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

        container.addTextDisplayComponents(
            (t) => t.setContent(
                `-# ⚖️ Disciplinary actions include verbal warnings, timeouts, kicks, and permanent bans at staff discretion.`
            )
        );

        try {
            await targetChannel.send({
                components: [container],
                flags: MessageFlags.IsComponentsV2
            });

            return interaction.editReply({
                content: `✅ Rules successfully published to <#${targetChannel.id}>!`
            });
        } catch (err) {
            console.error('[SendRules] Failed to send rules container:', err);
            return interaction.editReply({
                content: `Failed to send rules: ${err.message}`
            });
        }
    }
};
