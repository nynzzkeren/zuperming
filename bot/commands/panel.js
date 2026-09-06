const {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    SeparatorBuilder,
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
        .setDescription('Spawn Panel (Admin)')
        .addStringOption(option =>
            option.setName('type')
                .setDescription('Type of panel to spawn')
                .setRequired(false)
                .addChoices(
                    { name: 'Free (Keyless)', value: 'free' },
                    { name: 'Premium (Key Whitelist)', value: 'premium' }
                )
        )
        .addIntegerOption(option =>
            option.setName('panel_id')
                .setDescription('Optional specific panel ID')
                .setRequired(false)
        )
        .addIntegerOption(option =>
            option.setName('project_id')
                .setDescription('Optional specific project ID')
                .setRequired(false)
        ),
    async execute(interaction) {
        if (!interaction.member.permissions.has('Administrator')) {
            return interaction.reply({ content: 'Admin only.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        const panelId = interaction.options.getInteger('panel_id');
        const projectId = interaction.options.getInteger('project_id');
        const type = interaction.options.getString('type') || 'premium';

        /**
         * Renders 2 containers:
         * - Container 1: Brand info / description (with optional thumbnail)
         * - Container 2: Buttons row
         */
        const renderPanel = async (project, title, description, buttons) => {
            const logoUrl = project.brand_logo_url || process.env.BRAND_LOGO_URL || '';

            // ── Container 1: Info / Description ──
            const infoContainer = new ContainerBuilder().setAccentColor(0xFFFFFF);

            if (isUsableHttpUrl(logoUrl)) {
                infoContainer.addSectionComponents((section) =>
                    section
                        .addTextDisplayComponents(
                            (text) => text.setContent(`**${title}**`),
                            (text) => text.setContent(description)
                        )
                        .setThumbnailAccessory((thumbnail) =>
                            thumbnail.setURL(logoUrl).setDescription(project.name)
                        )
                );
            } else {
                infoContainer.addTextDisplayComponents(
                    (text) => text.setContent(`**${title}**`),
                    (text) => text.setContent(description)
                );
            }

            // ── Container 2: Action Buttons ──
            const buttonContainer = new ContainerBuilder().setAccentColor(0xFFFFFF);

            const actionRows = [];
            let currentRow = new ActionRowBuilder();

            buttons.forEach((btn, i) => {
                if (i > 0 && i % 5 === 0) {
                    actionRows.push(currentRow);
                    currentRow = new ActionRowBuilder();
                }

                const button = new ButtonBuilder().setLabel(btn.label);
                if (btn.style === 5 && btn.url) {
                    button.setStyle(ButtonStyle.Link).setURL(btn.url);
                } else {
                    button.setStyle(btn.style || ButtonStyle.Secondary)
                          .setCustomId(btn.customId || `${btn.custom_id}_${project.id}`);
                }
                // No emoji — intentional per design

                currentRow.addComponents(button);
            });

            if (currentRow.components.length > 0) {
                actionRows.push(currentRow);
            }

            actionRows.forEach(row => {
                buttonContainer.addActionRowComponents(row);
            });

            try {
                await interaction.channel.send({
                    components: [infoContainer, buttonContainer],
                    flags: MessageFlags.IsComponentsV2
                });
                return interaction.editReply({ content: `Panel "${title}" successfully spawned!` });
            } catch (e) {
                console.error('Failed to spawn Components V2 panel:', e);
                return interaction.editReply({ content: 'Failed to spawn panel: ' + e.message });
            }
        };

        if (panelId) {
            db.get(`SELECT * FROM panels WHERE id = ?`, [panelId], (err, panel) => {
                if (err || !panel) {
                    return interaction.editReply({ content: 'Panel not found.' });
                }

                db.get(`SELECT * FROM projects WHERE id = ?`, [panel.project_id], (err2, project) => {
                    if (err2 || !project) return interaction.editReply({ content: 'Project not found.' });

                    db.all(`SELECT * FROM panel_buttons WHERE panel_id = ?`, [panel.id], (err3, buttons) => {
                        renderPanel(project, panel.title, panel.description, buttons || []);
                    });
                });
            });
            return;
        }

        // Auto spawn based on project or type
        const query = projectId
            ? `SELECT * FROM projects WHERE id = ?`
            : (type === 'free' ? `SELECT * FROM projects WHERE is_free = 1 ORDER BY id ASC LIMIT 1` : `SELECT * FROM projects WHERE is_free = 0 ORDER BY id ASC LIMIT 1`);
        const queryParams = projectId ? [projectId] : [];

        db.get(query, queryParams, (err, project) => {
            if (err || !project) {
                // Fallback to any project
                db.get(`SELECT * FROM projects ORDER BY id ASC LIMIT 1`, (err2, fallbackProj) => {
                    if (!fallbackProj) {
                        return interaction.editReply({ content: 'No project found in database. Create one in dashboard first.' });
                    }
                    buildAndSendDefault(fallbackProj);
                });
                return;
            }
            buildAndSendDefault(project);
        });

        function buildAndSendDefault(project) {
            const isFree = project.is_free == 1 || type === 'free';

            // Get prefix from products config or env
            const { PRODUCTS } = require('../../config/products');
            const productConfig = isFree ? PRODUCTS.freemium : PRODUCTS.premium;
            const keyPrefix = productConfig.keyPrefix || process.env.KEY_PREFIX || 'MIE';

            if (isFree) {
                const title = `${project.name} • Free Access`;
                const description =
                    `**KEYLESS ZONE**\n` +
                    `No purchase required. Your hardware is auto-registered on first execution.\n\n` +
                    `- Platform: **Roblox**\n` +
                    `- Auth method: **HWID Lock**\n` +
                    `- Key required: **None**\n\n` +
                    `Press **Get Script** to receive your loader instantly.`;

                const buttons = [
                    { label: 'Get Script', customId: `btn_script_${project.id}`, style: ButtonStyle.Success },
                    { label: 'Game List',  customId: `btn_games_${project.id}`,  style: ButtonStyle.Secondary }
                ];
                renderPanel(project, title, description, buttons);
            } else {
                const premPrefix = `${keyPrefix}_PREM`;
                const title = `${project.name} • Premium Access`;
                const description =
                    `**LICENSED TERMINAL**\n` +
                    `This panel is restricted to verified license holders only.\n\n` +
                    `- Platform: **Roblox**\n` +
                    `- Auth method: **Key + HWID Lock**\n` +
                    `- Key format: \`${premPrefix}-XXXXX-XXX\`\n\n` +
                    `Use **Redeem Key** to activate your license, then **Get Script** to load.`;

                const buttons = [
                    { label: 'Get Script',  customId: `btn_script_${project.id}`, style: ButtonStyle.Success },
                    { label: 'Reset HWID',  customId: `btn_hwid_${project.id}`,   style: ButtonStyle.Secondary },
                    { label: 'Get Stats',   customId: `btn_stats_${project.id}`,  style: ButtonStyle.Secondary },
                    { label: 'Redeem Key',  customId: `btn_redeem_${project.id}`, style: ButtonStyle.Primary }
                ];
                renderPanel(project, title, description, buttons);
            }
        }
    },
};

