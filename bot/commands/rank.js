const {
    SlashCommandBuilder,
    ContainerBuilder,
    SectionBuilder,
    MessageFlags
} = require('discord.js');
const { getUserLevelData } = require('../utils/levelManager');

function createProgressBar(current, total, barLength = 12) {
    if (total === Infinity || total <= 0) return '`████████████` (MAX)';
    const percentage = Math.min(Math.max(current / total, 0), 1);
    const filled = Math.round(percentage * barLength);
    const empty = barLength - filled;
    return `\`${'█'.repeat(filled)}${'░'.repeat(empty)}\` ${Math.round(percentage * 100)}%`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rank')
        .setDescription('Check your current level, XP, and server rank')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The user to check rank for (Optional)')
                .setRequired(false)),

    async execute(interaction) {
        await interaction.deferReply();

        const targetUser = interaction.options.getUser('target') || interaction.user;
        const data = await getUserLevelData(targetUser.id);
        const avatarUrl = targetUser.displayAvatarURL({ extension: 'png', size: 256 });
        const progressBar = createProgressBar(data.xp, data.neededXp);
        const nextXpText = data.neededXp === Infinity ? 'MAX' : `${data.xp.toLocaleString()} / ${data.neededXp.toLocaleString()} XP`;

        const container = new ContainerBuilder().setAccentColor(0x000000);

        const section = new SectionBuilder()
            .addTextDisplayComponents(
                (t) => t.setContent(`## 🏆 User Level & Rank Statistics`),
                (t) => t.setContent(
                    `• **Member:** <@${targetUser.id}>\n` +
                    `• **Server Rank:** #${data.rank}\n` +
                    `• **Level:** **${data.level}** / 50\n` +
                    `• **XP Progress:** ${progressBar}\n` +
                    `• **Current XP:** ${nextXpText}\n` +
                    `• **Total Messages Sent:** ${data.totalMessages.toLocaleString()}`
                )
            )
            .setThumbnailAccessory((thumb) =>
                thumb.setURL(avatarUrl).setDescription(targetUser.username)
            );

        container.addSectionComponents(section);

        return interaction.editReply({
            components: [container],
            flags: MessageFlags.IsComponentsV2
        });
    }
};
