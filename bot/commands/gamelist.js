const {
    SlashCommandBuilder,
    ContainerBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags
} = require('discord.js');
const db = require('../../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('gamelist')
        .setDescription('Manage games and view scripts (Admin only)')
        .setDefaultMemberPermissions(8), // Administrator
    async execute(interaction) {
        db.all(`
            SELECT g.*, 
            (SELECT COUNT(*) FROM scripts s WHERE s.product = g.product AND s.game_id = g.roblox_game_id) as script_count 
            FROM games g
            ORDER BY g.name ASC
        `, async (err, games) => {
            if (err) {
                console.error(err);
                return interaction.reply({ content: 'Database error', ephemeral: true });
            }

            const premium = games.filter(g => g.product === 'premium');
            const free = games.filter(g => g.product === 'freemium');
            const sp = games.filter(g => g.product === 'service_provider');

            const formatList = (list) => {
                if (list.length === 0) return 'No games yet.';
                return list.map(g => {
                    const status = g.script_count > 0 ? '🟢 Uploaded' : '🔴 Missing Script';
                    return `• ${g.name} (ID: ${g.roblox_game_id}) - ${status}`;
                }).join('\n');
            };

            const container = new ContainerBuilder();
            container.addTextDisplayComponents(
                (text) => text.setContent('# 🎮 Zuperming Game Manager'),
                (text) => text.setContent('Live sync with the web dashboard. Manage all your games and scripts below.'),
                (text) => text.setContent(
                    '**💎 Premium Games**\n' + formatList(premium) + '\n\n' +
                    '**🎁 Free Games**\n' + formatList(free) + '\n\n' +
                    '**🛠️ Service Provider Games**\n' + formatList(sp)
                )
            );

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('btn_add_game_modal')
                    .setLabel('Add New Game')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('btn_upload_script_flow')
                    .setLabel('Upload Script')
                    .setStyle(ButtonStyle.Success)
            );

            await interaction.reply({ 
                components: [container, row],
                flags: MessageFlags.IsComponentsV2
            });
        });
    },
};
