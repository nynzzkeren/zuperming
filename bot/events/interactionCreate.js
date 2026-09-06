const {
    Events,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    ContainerBuilder,
    SectionBuilder,
    SeparatorBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags
} = require('discord.js');
const crypto = require('crypto');
const db = require('../../database');
const { computeExpiresAt, isKeyExpired, formatDurationLabel } = require('../../utils/keys');
const { getBaseUrl } = require('../../config/products');

function isUsableHttpUrl(str) {
    if (!str) return false;
    try {
        const url = new URL(str);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

function buildLoaderScript(project, keyString) {
    const uuid = (project && project.uuid) ? project.uuid : project;
    return `script_key="${keyString}"; loadstring(game:HttpGet("${getBaseUrl()}/scripts/v4/loaders/${uuid}.lua"))()`;
}

function getValidKey(discordId, projectId, cb) {
    db.get(
        `SELECT * FROM keys WHERE discord_id = ? AND status = 'used' AND (project_id = ? OR project_id IS NULL) ORDER BY id DESC LIMIT 1`,
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

            // ─── TICKET SYSTEM BUTTONS ─────────────────────────────────────────
            const ticketManager = require('../utils/ticketManager');

            if (customId === 'btn_buy_ticket_monthly' || customId === 'btn_buy_ticket_lifetime') {
                const planKey = customId === 'btn_buy_ticket_monthly' ? 'monthly' : 'lifetime';
                try {
                    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                    const res = await ticketManager.createTicketChannel(interaction.guild, interaction.user, planKey);
                    if (res.exists) {
                        return interaction.editReply({
                            content: `⚠️ You already have an open ticket in <#${res.channel.id}>! Please proceed there.`
                        });
                    }
                    return interaction.editReply({
                        content: `✅ Your purchase ticket has been created: <#${res.channel.id}>`
                    });
                } catch (err) {
                    console.error('[Ticket] Error creating ticket channel:', err);
                    return interaction.editReply({
                        content: `Failed to create ticket: ${err.message}`
                    });
                }
            }

            if (customId === 'btn_ticket_open_qris') {
                return ticketManager.handleOpenQris(interaction);
            }

            if (customId === 'btn_ticket_done_payment') {
                return ticketManager.handleDonePayment(interaction);
            }

            if (customId === 'btn_ticket_check') {
                return ticketManager.handleCheckPayment(interaction);
            }

            if (customId.startsWith('btn_ticket_approve_')) {
                const ticketId = parseInt(customId.replace('btn_ticket_approve_', ''));
                return ticketManager.handleApprovePayment(interaction, ticketId);
            }

            if (customId.startsWith('btn_ticket_reject_')) {
                const ticketId = parseInt(customId.replace('btn_ticket_reject_', ''));
                return ticketManager.handleRejectPayment(interaction, ticketId);
            }

            if (customId === 'btn_ticket_close') {
                return ticketManager.handleCloseTicket(interaction);
            }

            if (customId === 'btn_ticket_confirm_close') {
                return ticketManager.handleConfirmClose(interaction);
            }

            if (customId === 'btn_ticket_cancel_close') {
                return interaction.reply({ content: 'Ticket close cancelled.', flags: MessageFlags.Ephemeral });
            }
            // ──────────────────────────────────────────────────────────────────

            // Parse custom ID for dynamic panels (Format: btn_action_projectId)
            if (!customId.startsWith('btn_')) return;
            const parts = customId.split('_');
            const action = parts[1]; // e.g. redeem, script, copy, role, hwid, games
            const projectId = parts.length >= 3 ? parseInt(parts[2]) : null;

            if (!projectId) return;

            // ─── REDEEM KEY MODAL ─────────────────────────────────────────────
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

            // ─── GET SCRIPT (KEYLESS FREE OR PREMIUM) ─────────────────────────
            if (action === 'script' || action === 'copy') {
                await interaction.deferReply({ ephemeral: true }).catch(console.error);

                return db.get(`SELECT * FROM projects WHERE id = ?`, [projectId], (err, project) => {
                    if (err || !project) {
                        const c = new ContainerBuilder()
                            .setAccentColor(0x0a0a0a)
                            .addTextDisplayComponents((t) => t.setContent('## Error'), (t) => t.setContent('Project not found.'));
                        return interaction.editReply({ components: [c], flags: MessageFlags.IsComponentsV2 });
                    }

                    const isFree = project.is_free == 1;

                    // ─── FREE / KEYLESS FLOW (OTOMATIS GENERATE SCRIPT_KEY) ────
                    if (isFree) {
                        return db.get(
                            `SELECT * FROM keys WHERE discord_id = ? AND project_id = ? AND status = 'used' ORDER BY id DESC LIMIT 1`,
                            [interaction.user.id, projectId],
                            (err, existingKey) => {
                                const deliverFreeScript = (keyString) => {
                                    const loaderScript = buildLoaderScript(project, keyString);

                                    if (action === 'copy') {
                                        return interaction.editReply({ content: `\`${loaderScript}\`` }).catch(console.error);
                                    }

                                    const container = new ContainerBuilder()
                                        .setAccentColor(0x0a0a0a)
                                        .addTextDisplayComponents(
                                            (t) => t.setContent(`## Get Script (Keyless Free)`),
                                            (t) => t.setContent(`Akses: **Free / Keyless** • Auto-generated Key: \`${keyString}\``),
                                            (t) => t.setContent(`**Copy and paste into your executor:**\n\`\`\`lua\n${loaderScript}\n\`\`\``)
                                        );

                                    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

                                    const actionRow = new ActionRowBuilder().addComponents(
                                        new ButtonBuilder().setCustomId(`btn_copy_${projectId}`).setLabel('Mobile Copy').setStyle(ButtonStyle.Secondary).setEmoji('📋'),
                                        new ButtonBuilder().setCustomId(`btn_games_${projectId}`).setLabel('Game supported').setStyle(ButtonStyle.Secondary).setEmoji('🎮')
                                    );

                                    container.addActionRowComponents(actionRow);

                                    return interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(console.error);
                                };

                                if (existingKey && existingKey.key_string) {
                                    return deliverFreeScript(existingKey.key_string);
                                }

                                // Auto generate free key for this user
                                const newKey = 'MIE_FREE-' + crypto.randomBytes(4).toString('hex').toUpperCase();
                                db.run(
                                    `INSERT INTO keys (key_string, duration, status, discord_id, project_id) VALUES (?, 'free', 'used', ?, ?)`,
                                    [newKey, interaction.user.id, projectId],
                                    (insErr) => {
                                        db.run(`INSERT OR IGNORE INTO users (discord_id) VALUES (?)`, [interaction.user.id]);
                                        deliverFreeScript(newKey);
                                    }
                                );
                            }
                        );
                    }

                    // ─── PREMIUM FLOW ──────────────────────────────────────────
                    return getValidKey(interaction.user.id, projectId, (err, row, reason) => {
                        if (err) {
                            const c = new ContainerBuilder()
                                .setAccentColor(0x0a0a0a)
                                .addTextDisplayComponents((t) => t.setContent('## Error'), (t) => t.setContent('Database error.'));
                            return interaction.editReply({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(console.error);
                        }
                        if (!row) {
                            const msg = reason === 'expired' 
                                ? `Your key has expired.` 
                                : `You do not own a valid key for this project. Please redeem a license key first.`;
                            const c = new ContainerBuilder()
                                .setAccentColor(0x0a0a0a)
                                .addTextDisplayComponents((t) => t.setContent('## Access Denied'), (t) => t.setContent(msg));
                            return interaction.editReply({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(console.error);
                        }

                        const loaderScript = buildLoaderScript(project, row.key_string);

                        if (action === 'copy') {
                            return interaction.editReply({ content: `\`${loaderScript}\`` }).catch(console.error);
                        }

                        const expiresText = row.expires_at ? `Expires: ${row.expires_at}` : 'Expires: Permanent';
                        const container = new ContainerBuilder()
                            .setAccentColor(0x0a0a0a)
                            .addTextDisplayComponents(
                                (t) => t.setContent(`## Get Script (Premium)`),
                                (t) => t.setContent(`Duration: **${formatDurationLabel(row.duration)}** — ${expiresText}`),
                                (t) => t.setContent(`**Copy and paste into your executor:**\n\`\`\`lua\n${loaderScript}\n\`\`\``)
                            );

                        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

                        const actionRow = new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId(`btn_copy_${projectId}`).setLabel('Mobile Copy').setStyle(ButtonStyle.Secondary).setEmoji('📋'),
                            new ButtonBuilder().setCustomId(`btn_games_${projectId}`).setLabel('Game supported').setStyle(ButtonStyle.Secondary).setEmoji('🎮')
                        );

                        container.addActionRowComponents(actionRow);

                        return interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(console.error);
                    });
                });
            }

            // ─── GAME SUPPORTED CARD (PERSIS GAMBAR 2) ────────────────────────
            if (action === 'games') {
                await interaction.deferReply({ ephemeral: true }).catch(console.error);

                return db.all(
                    `SELECT * FROM games WHERE (project_id = ? OR project_id IS NULL) ORDER BY id ASC`,
                    [projectId],
                    async (err, games) => {
                        if (err || !games || games.length === 0) {
                            const c = new ContainerBuilder()
                                .setAccentColor(0x0a0a0a)
                                .addTextDisplayComponents(
                                    (t) => t.setContent('# Game supported'),
                                    (t) => t.setContent('Belum ada game yang didaftarkan untuk project ini.')
                                );
                            return interaction.editReply({ components: [c], flags: MessageFlags.IsComponentsV2 });
                        }

                        const container = new ContainerBuilder()
                            .setAccentColor(0x0a0a0a); // Black accent line on the edge

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

                        return interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                    }
                );
            }

            // ─── CLAIM BUYER ROLE ─────────────────────────────────────────────
            if (action === 'role') {
                return db.get(`SELECT buyer_role_id FROM projects WHERE id = ?`, [projectId], (err, project) => {
                    if (err || !project) return interaction.reply({ content: 'Project not found.', ephemeral: true });
                    const roleId = project.buyer_role_id || process.env.BUYER_ROLE_ID;
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
                            
                            const container = new ContainerBuilder()
                                .setAccentColor(0x0a0a0a)
                                .addTextDisplayComponents(
                                    (text) => text.setContent('# Role Granted'),
                                    (text) => text.setContent('Buyer role has been granted successfully to your Discord account!')
                                );

                            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                        } catch (error) {
                            console.error(error);
                            return interaction.reply({ content: 'Failed to grant role. Check bot permissions.', ephemeral: true });
                        }
                    });
                });
            }

            // ─── RESET HWID ───────────────────────────────────────────────────
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
                            .setAccentColor(0x0a0a0a)
                            .addTextDisplayComponents(
                                (text) => text.setContent('# HWID Reset Successful'),
                                (text) => text.setContent('Your HWID has been successfully reset. You can now use your key on a new device.')
                            );

                        return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                    });
                });
            }
        }

        // ─── MODAL SUBMITS ────────────────────────────────────────────────────
        if (interaction.isModalSubmit()) {
            if (interaction.customId.startsWith('modal_redeem_')) {
                const projectId = interaction.customId.split('_')[2];
                const key = interaction.fields.getTextInputValue('keyInput').trim();

                return db.get(
                    `SELECT * FROM keys WHERE key_string = ? AND (project_id = ? OR project_id IS NULL)`,
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
                                const roleId = (project && project.buyer_role_id) || process.env.BUYER_ROLE_ID;
                                if (roleId) {
                                    interaction.guild.members.fetch(interaction.user.id).then(member => {
                                        member.roles.add(roleId).catch(console.error);
                                    }).catch(console.error);
                                }
                            });

                            const container = new ContainerBuilder()
                                .setAccentColor(0x0a0a0a)
                                .addTextDisplayComponents(
                                    (text) => text.setContent('# Key Redeemed Successfully'),
                                    (text) => text.setContent(
                                        `Your key has been redeemed!\nDuration: **${formatDurationLabel(row.duration)}**` +
                                        (expiresAt ? `\nExpires: ${expiresAt}` : '\nExpires: Permanent') +
                                        `\n\nKlik **Get Script** untuk mengambil loader-mu.`
                                    )
                                );

                            container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

                            const actionRow = new ActionRowBuilder().addComponents(
                                new ButtonBuilder().setCustomId(`btn_script_${projectId}`).setLabel('Get Script').setStyle(ButtonStyle.Primary).setEmoji('📜')
                            );
                            container.addActionRowComponents(actionRow);

                            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                        });
                    }
                );
            }
        }
    },
};
