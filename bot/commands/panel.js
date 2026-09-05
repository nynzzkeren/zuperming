const {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
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
        .setName('panel')
        .setDescription('Spawn Custom Panel (Admin)')
        .addIntegerOption(option => 
            option.setName('panel_id')
                .setDescription('The ID of the panel to spawn')
                .setRequired(true)
        ),
    async execute(interaction) {
        if (!interaction.member.permissions.has('Administrator')) {
            return interaction.reply({ content: 'Admin only.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        const panelId = interaction.options.getInteger('panel_id');

        db.get(`SELECT * FROM panels WHERE id = ?`, [panelId], (err, panel) => {
            if (err || !panel) {
                return interaction.editReply({ content: 'Panel not found.' });
            }

            db.get(`SELECT * FROM projects WHERE id = ?`, [panel.project_id], (err, project) => {
                if (err || !project) {
                    return interaction.editReply({ content: 'Project not found.' });
                }

                db.all(`SELECT * FROM panel_buttons WHERE panel_id = ?`, [panel.id], async (err, buttons) => {
                    if (err) buttons = [];

                    const logoUrl = project.brand_logo_url || process.env.BRAND_LOGO_URL || '';
                    const container = new ContainerBuilder();

                    if (isUsableHttpUrl(logoUrl)) {
                        container.addSectionComponents((section) =>
                            section
                                .addTextDisplayComponents(
                                    (text) => text.setContent('# ' + panel.title),
                                    (text) => text.setContent(panel.description)
                                )
                                .setThumbnailAccessory((thumbnail) =>
                                    thumbnail.setURL(logoUrl).setDescription(project.name)
                                )
                        );
                    } else {
                        container.addTextDisplayComponents(
                            (text) => text.setContent('# ' + panel.title),
                            (text) => text.setContent(panel.description)
                        );
                    }

                    const rows = [];
                    let currentRow = new ActionRowBuilder();

                    buttons.forEach((btn, i) => {
                        if (i > 0 && i % 5 === 0) {
                            rows.push(currentRow);
                            currentRow = new ActionRowBuilder();
                        }
                        
                        const button = new ButtonBuilder().setLabel(btn.label);
                        
                        if (btn.style === 5 && btn.url) {
                            button.setStyle(ButtonStyle.Link).setURL(btn.url);
                        } else {
                            // Custom ID buttons (Redeem, Get Script, etc)
                            // We embed the project_id into the custom_id so interactionCreate knows which project it belongs to!
                            // Format: custom_id_projectId e.g., btn_redeem_1
                            button.setStyle(btn.style || ButtonStyle.Secondary)
                                  .setCustomId(`${btn.custom_id}_${project.id}`);
                        }
                        
                        currentRow.addComponents(button);
                    });

                    if (currentRow.components.length > 0) {
                        rows.push(currentRow);
                    }

                    try {
                        await interaction.channel.send({
                            components: [container, ...rows],
                            flags: MessageFlags.IsComponentsV2
                        });
                    } catch (e) {
                        // Retry without thumbnail just in case
                        const plain = new ContainerBuilder().addTextDisplayComponents(
                            (text) => text.setContent('# ' + panel.title),
                            (text) => text.setContent(panel.description)
                        );
                        await interaction.channel.send({
                            components: [plain, ...rows],
                            flags: MessageFlags.IsComponentsV2
                        });
                    }

                    return interaction.editReply({ content: 'Panel setup OK.' });
                });
            });
        });
    },
};
