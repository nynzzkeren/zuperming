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

            const working = games.filter(g => g.status === 'Working Script' || g.status === 'Working');
            const needsUpdate = games.filter(g => g.status === 'Needs Update');
            const dead = games.filter(g => g.status === 'Dead Script' || g.status === 'Dead');
            const unknown = games.filter(g => g.status !== 'Working Script' && g.status !== 'Working' && g.status !== 'Needs Update' && g.status !== 'Dead Script' && g.status !== 'Dead');
            
            // Push unknown ones to working as a fallback
            working.push(...unknown);

            const formatList = (list) => {
                if (list.length === 0) return '_None_';
                return list.map(g => `• ${g.name}${g.product === 'freemium' ? ' (Free)' : ''}`).join('\n');
            };

            const container = new ContainerBuilder();
            container.addTextDisplayComponents(
                (text) => text.setContent('# Zuperming List Game'),
                (text) => text.setContent('This channel lists all the games available in the Zuperming Official\n🟢 Working Script\n🟠 Needs Update\n🔴 Dead Script'),
                (text) => text.setContent(
                    '🟢 **Working Script**\n' + formatList(working) + '\n\n' +
                    '🟠 **Needs Update**\n' + formatList(needsUpdate) + '\n\n' +
                    '🔴 **Dead Script**\n' + formatList(dead)
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
