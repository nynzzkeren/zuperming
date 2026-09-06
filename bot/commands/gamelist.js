const {
    SlashCommandBuilder,
    ContainerBuilder,
    SectionBuilder,
    SeparatorBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags
} = require('discord.js');
const db = require('../../database');

function isUsableHttpUrl(str) {
    if (!str) return false;
    try {
        const url = new URL(str);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('gamelist')
        .setDescription('View supported games and details')
        .addIntegerOption(option =>
            option.setName('project_id')
                .setDescription('Optional project ID to filter')
                .setRequired(false)
        ),
    async execute(interaction) {
        const projectId = interaction.options.getInteger('project_id');
        const query = projectId 
            ? `SELECT * FROM games WHERE project_id = ? ORDER BY id ASC`
            : `SELECT * FROM games ORDER BY id ASC`;
        const queryParams = projectId ? [projectId] : [];

        db.all(query, queryParams, async (err, games) => {
            if (err) {
                console.error(err);
                return interaction.reply({ content: 'Database error', ephemeral: true });
            }

            if (!games || games.length === 0) {
                const emptyContainer = new ContainerBuilder()
                    .setAccentColor(0x0a0a0a)
                    .addTextDisplayComponents(
                        (text) => text.setContent('# Game supported'),
                        (text) => text.setContent('Belum ada game yang didaftarkan.')
                    );
                return interaction.reply({
                    components: [emptyContainer],
                    flags: MessageFlags.IsComponentsV2
                });
            }

            const container = new ContainerBuilder()
                .setAccentColor(0x0a0a0a); // Black accent border on left

            const playButtons = [];

            games.forEach((game, idx) => {
                const placeId = game.place_id || game.roblox_game_id;
                const statusEmoji = (game.status && (game.status.includes('Dead') || game.status.includes('Patched'))) ? '🔴'
                    : (game.status && (game.status.includes('Update') || game.status.includes('Maintenance'))) ? '🟠'
                    : '🟢';

                const section = new SectionBuilder()
                    .addTextDisplayComponents(
                        (t) => t.setContent('# Game supported'),
                        (t) => t.setContent(
                            `• **Game name :** **${game.name}**\n` +
                            `• **Script version :** **${game.script_version || 'v0.0.0.1'}**\n` +
                            `• **Status :** ${statusEmoji}`
                        )
                    );

                const thumbUrl = game.thumbnail_url;
                if (thumbUrl && isUsableHttpUrl(thumbUrl)) {
                    section.setThumbnailAccessory((thumb) => thumb.setURL(thumbUrl).setDescription(game.name));
                }

                container.addSectionComponents(section);

                if (idx < games.length - 1) {
                    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
                }

                if (playButtons.length < 5 && placeId) {
                    playButtons.push(
                        new ButtonBuilder()
                            .setLabel(games.length === 1 ? 'Play on Roblox' : `Play ${game.name.slice(0, 18)}`)
                            .setEmoji('🔗')
                            .setStyle(ButtonStyle.Link)
                            .setURL(`https://www.roblox.com/games/${placeId}`)
                    );
                }
            });

            if (playButtons.length > 0) {
                container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
                const actionRow = new ActionRowBuilder().addComponents(...playButtons);
                container.addActionRowComponents(actionRow);
            }

            await interaction.reply({ 
                components: [container],
                flags: MessageFlags.IsComponentsV2
            });
        });
    },
};
