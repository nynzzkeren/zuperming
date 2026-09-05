const {
    Events,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    ContainerBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags
} = require('discord.js');
const db = require('../../database');
const { computeExpiresAt, isKeyExpired, formatDurationLabel } = require('../../utils/keys');
const { getBaseUrl } = require('../../config/products');

function buildLoaderScript(projectId, keyString) {
    return `script_key = "${keyString}"\nloadstring(game:HttpGet("${getBaseUrl()}/loader/${projectId}"))()`;
}

function getValidKey(discordId, projectId, cb) {
    db.get(
        `SELECT * FROM keys WHERE discord_id = ? AND status = 'used' AND project_id = ?`,
        [discordId, projectId],
        (err, row) => {
            if (err) return cb(err);
            if (!row) return cb(null, null);
            if (isKeyExpired(row)) return cb(null, null, 'expired');
            return cb(null, row);
        }
    );
}

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction, client) {
        if (interaction.isChatInputCommand()) {
            const command = client.commands.get(interaction.commandName);
            if (!command) return;
            try {
                await command.execute(interaction);
            } catch (error) {
                console.error(error);
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
                } else {
                    await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
                }
            }
            return;
        }

        if (interaction.isButton()) {
            const { customId } = interaction;

            // ─── BYPASS COPY BUTTON ────────────────────────────────────────────
            if (customId.startsWith('btn_bypass_copy_')) {
                const cacheId = customId.replace('btn_bypass_copy_', '');
                const { cacheGet } = require('../commands/bypass');
                const result = cacheGet(cacheId);
                if (!result) return interaction.reply({ content: 'Result expired.', ephemeral: true });
                return interaction.reply({ content: result, ephemeral: true });
            }
            // ──────────────────────────────────────────────────────────────────

            // Parse custom ID for dynamic panels (Format: btn_action_projectId)
            if (!customId.startsWith('btn_')) return;
            const parts = customId.split('_');
            const action = parts[1]; // e.g. redeem, script, role, hwid
            const projectId = parts.length >= 3 ? parseInt(parts[2]) : null;

            if (!projectId) return; // Not a dynamic panel button

            if (action === 'redeem') {
                const modal = new ModalBuilder()
                    .setCustomId(`modal_redeem_${projectId}`)
                    .setTitle(`Redeem Key`);

                const keyInput = new TextInputBuilder()
                    .setCustomId('keyInput')
                    .setLabel('Enter your license key')
                    .setPlaceholder(`Example: KEY-A1B2C3D4`)
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                modal.addComponents(new ActionRowBuilder().addComponents(keyInput));
                return interaction.showModal(modal);
            }

            if (action === 'script' || action === 'copy') {
                await interaction.deferReply({ ephemeral: true }).catch(console.error);

                return getValidKey(interaction.user.id, projectId, (err, row, reason) => {
                    if (err) {
                        const c = new ContainerBuilder().addTextDisplayComponents((t) => t.setContent('## Error'), (t) => t.setContent('Database error.'));
                        return interaction.editReply({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(console.error);
                    }
                    if (!row) {
                        const msg = reason === 'expired' ? `Your key has expired.` : `You do not own a valid key for this project.`;
                        const c = new ContainerBuilder().addTextDisplayComponents((t) => t.setContent('## Access Denied'), (t) => t.setContent(msg));
                        return interaction.editReply({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(console.error);
                    }

                    const loaderScript = buildLoaderScript(projectId, row.key_string);

                    if (action === 'copy') {
                        return interaction.editReply({ content: `\`${loaderScript}\`` }).catch(console.error);
                    }

                    const expiresText = row.expires_at ? `Expires: ${row.expires_at}` : 'Expires: Permanent';
                    const container = new ContainerBuilder()
                        .addTextDisplayComponents(
                            (t) => t.setContent(`## Get Script`),
                            (t) => t.setContent(`Duration: **${formatDurationLabel(row.duration)}** — ${expiresText}`),
                            (t) => t.setContent(`**Copy and paste into your executor:**\n\`\`\`lua\n${loaderScript}\n\`\`\``)
                        );

                    const actionRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`btn_copy_${projectId}`).setLabel('Mobile Copy').setStyle(ButtonStyle.Secondary)
                    );

                    return interaction.editReply({ components: [container, actionRow], flags: MessageFlags.IsComponentsV2 }).catch(console.error);
                });
            }

            if (action === 'role') {
                db.get(`SELECT buyer_role_id FROM projects WHERE id = ?`, [projectId], (err, project) => {
                    if (err || !project) return interaction.reply({ content: 'Project not found.', ephemeral: true });
                    const roleId = project.buyer_role_id;
                    if (!roleId) return interaction.reply({ content: `Role ID not configured for this project.`, ephemeral: true });

                    return getValidKey(interaction.user.id, projectId, async (err, row, reason) => {
                        if (err) return interaction.reply({ content: 'Database error.', ephemeral: true });
                        if (!row) {
                            return interaction.reply({
                                content: reason === 'expired' ? `Your key has expired.` : `You do not own a valid key to get this role.`,
                                ephemeral: true
                            });
                        }

                        try {
                            const member = await interaction.guild.members.fetch(interaction.user.id);
                            if (member.roles.cache.has(roleId)) return interaction.reply({ content: 'You already have the buyer role.', ephemeral: true });
                            await member.roles.add(roleId);
                            return interaction.reply({ content: `Role granted successfully.`, ephemeral: true });
                        } catch (error) {
                            console.error(error);
                            return interaction.reply({ content: 'Failed to grant role. Check bot permissions.', ephemeral: true });
                        }
                    });
                });
            }

            if (action === 'hwid') {
                return getValidKey(interaction.user.id, projectId, (err, keyRow, reason) => {
                    if (err) return interaction.reply({ content: 'Database error.', ephemeral: true });
                    if (!keyRow) {
                        return interaction.reply({
                            content: reason === 'expired' ? `Your key has expired.` : `You need to redeem a key first.`,
                            ephemeral: true
                        });
                    }

                    db.run(`UPDATE users SET hwid = NULL, last_reset = CURRENT_TIMESTAMP WHERE discord_id = ?`, [interaction.user.id], function (updateErr) {
                        if (updateErr) return interaction.reply({ content: 'Database error.', ephemeral: true });
                        db.run(`UPDATE stats SET total_resets = total_resets + 1 WHERE id = 1`);
                        db.run(`UPDATE users SET total_resets = COALESCE(total_resets, 0) + 1 WHERE discord_id = ?`, [interaction.user.id], () => {});
                        
                        const container = new ContainerBuilder()
                            .addTextDisplayComponents(
                                (text) => text.setContent('# HWID Reset Successful'),
                                (text) => text.setContent('Your HWID has been successfully reset. You can now use your key on a new device.')
                            );

                        return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                    });
                });
            }
        }

        if (interaction.isModalSubmit()) {
            if (interaction.customId.startsWith('modal_redeem_')) {
                const projectId = interaction.customId.split('_')[2];
                const key = interaction.fields.getTextInputValue('keyInput');

                return db.get(
                    `SELECT * FROM keys WHERE key_string = ? AND project_id = ?`,
                    [key, projectId],
                    (err, row) => {
                        if (err) return interaction.reply({ content: 'Database error.', ephemeral: true });
                        if (!row) return interaction.reply({ content: `Invalid key for this project.`, ephemeral: true });
                        if (row.status === 'used') return interaction.reply({ content: 'This key has already been used.', ephemeral: true });

                        const expiresAt = computeExpiresAt(row.duration);

                        db.serialize(() => {
                            db.run(`UPDATE keys SET status = 'used', discord_id = ?, redeemed_at = CURRENT_TIMESTAMP, expires_at = ? WHERE id = ?`, [interaction.user.id, expiresAt, row.id]);
                            db.run(`INSERT OR IGNORE INTO users (discord_id) VALUES (?)`, [interaction.user.id]);

                            db.get(`SELECT buyer_role_id FROM projects WHERE id = ?`, [projectId], (err, project) => {
                                if (project && project.buyer_role_id) {
                                    interaction.guild.members.fetch(interaction.user.id).then(member => {
                                        member.roles.add(project.buyer_role_id).catch(console.error);
                                    });
                                }
                            });

                            const container = new ContainerBuilder()
                                .addTextDisplayComponents(
                                    (text) => text.setContent('# Key Redeemed Successfully'),
                                    (text) => text.setContent(
                                        `Your key has been redeemed!\nDuration: **${formatDurationLabel(row.duration)}**` +
                                        (expiresAt ? `\nExpires: ${expiresAt}` : '\nExpires: Permanent') +
                                        `\n\nUse **Get Script** to copy your loader.`
                                    )
                                );

                            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                        });
                    }
                );
            }
        }
    },
};
