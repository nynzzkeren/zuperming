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
const { getProduct, getBaseUrl, getProductRoleId } = require('../../config/products');
const { computeExpiresAt, isKeyExpired, formatDurationLabel } = require('../../utils/keys');

function resolveProductFromCustomId(customId) {
    if (customId.startsWith('btn_sp_') || customId === 'modal_sp_redeem' || customId === 'btn_sp_copy_script') {
        return getProduct('service_provider');
    }
    return getProduct('premium');
}

function buildLoaderScript(product, keyString) {
    return `_G.key_script = "${keyString}"\nloadstring(game:HttpGet("${getBaseUrl()}${product.loaderRoute}"))()`;
}

function getValidKey(discordId, productId, cb) {
    db.get(
        `SELECT * FROM keys WHERE discord_id = ? AND status = 'used' AND product = ?`,
        [discordId, productId],
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
            const product = resolveProductFromCustomId(customId);
            const action = customId
                .replace(/^btn_sp_/, '')
                .replace(/^btn_/, '');

            if (action === 'redeem') {
                const modal = new ModalBuilder()
                    .setCustomId(product.modalRedeem)
                    .setTitle(`Redeem · ${product.name}`);

                const keyInput = new TextInputBuilder()
                    .setCustomId('keyInput')
                    .setLabel('Enter your license key')
                    .setPlaceholder(`Example: ${product.keyPrefix}-A1B2C3D4`)
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                modal.addComponents(new ActionRowBuilder().addComponents(keyInput));
                return interaction.showModal(modal);
            }

            if (action === 'script' || action === 'copy_script') {
                return getValidKey(interaction.user.id, product.id, (err, row, reason) => {
                    if (err) return interaction.reply({ content: 'Database error.', ephemeral: true });
                    if (!row) {
                        return interaction.reply({
                            content: reason === 'expired'
                                ? `Your **${product.name}** key has expired.`
                                : `You do not own a valid **${product.name}** key.`,
                            ephemeral: true
                        });
                    }

                    const loaderScript = buildLoaderScript(product, row.key_string);

                    if (action === 'copy_script') {
                        return interaction.reply({
                            content: `\`${loaderScript}\``,
                            ephemeral: true
                        });
                    }

                    const copyId = product.id === 'service_provider' ? 'btn_sp_copy_script' : 'btn_copy_script';
                    const container = new ContainerBuilder()
                        .addTextDisplayComponents(
                            (text) => text.setContent(`# Your ${product.name} Loader`),
                            (text) => text.setContent(
                                `Duration: **${formatDurationLabel(row.duration)}**` +
                                (row.expires_at ? `\nExpires: ${row.expires_at}` : '\nExpires: Permanent')
                            ),
                            (text) => text.setContent('Copy and paste this script into your executor:')
                        )
                        .addTextDisplayComponents(
                            (text) => text.setContent(`\`\`\`lua\n${loaderScript}\n\`\`\``)
                        )
                        .addActionRowComponents((rowComp) =>
                            rowComp.addComponents(
                                new ButtonBuilder()
                                    .setCustomId(copyId)
                                    .setLabel('Mobile Copy')
                                    .setStyle(ButtonStyle.Secondary)
                            )
                        );

                    return interaction.reply({
                        components: [container],
                        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                    });
                });
            }

            if (action === 'role') {
                const roleId = getProductRoleId(product);
                if (!roleId) return interaction.reply({ content: `Role ID not configured (${product.roleEnv}).`, ephemeral: true });

                return getValidKey(interaction.user.id, product.id, async (err, row, reason) => {
                    if (err) return interaction.reply({ content: 'Database error.', ephemeral: true });
                    if (!row) {
                        return interaction.reply({
                            content: reason === 'expired'
                                ? `Your **${product.name}** key has expired.`
                                : `You do not own a valid **${product.name}** key to get this role.`,
                            ephemeral: true
                        });
                    }

                    const member = await interaction.guild.members.fetch(interaction.user.id);
                    if (member.roles.cache.has(roleId)) {
                        return interaction.reply({ content: 'You already have the buyer role.', ephemeral: true });
                    }

                    try {
                        await member.roles.add(roleId);
                        return interaction.reply({ content: `${product.name} role granted successfully.`, ephemeral: true });
                    } catch (error) {
                        console.error(error);
                        return interaction.reply({ content: 'Failed to grant role. Check bot permissions.', ephemeral: true });
                    }
                });
            }

            if (action === 'hwid') {
                return getValidKey(interaction.user.id, product.id, (err, keyRow, reason) => {
                    if (err) return interaction.reply({ content: 'Database error.', ephemeral: true });
                    if (!keyRow) {
                        return interaction.reply({
                            content: reason === 'expired'
                                ? `Your **${product.name}** key has expired.`
                                : `You need to redeem a **${product.name}** key first before you can reset HWID.`,
                            ephemeral: true
                        });
                    }

                    db.run(
                        `UPDATE users SET hwid = NULL, last_reset = CURRENT_TIMESTAMP WHERE discord_id = ?`,
                        [interaction.user.id],
                        function (updateErr) {
                            if (updateErr) return interaction.reply({ content: 'Database error.', ephemeral: true });
                            db.run(`UPDATE stats SET total_resets = total_resets + 1 WHERE id = 1`);

                            const container = new ContainerBuilder()
                                .addTextDisplayComponents(
                                    (text) => text.setContent('# HWID Reset Successful'),
                                    (text) => text.setContent('Your HWID has been successfully reset. You can now use your key on a new device.')
                                );

                            return interaction.reply({
                                components: [container],
                                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                            });
                        }
                    );
                });
            }

            if (action === 'stats') {
                return getValidKey(interaction.user.id, product.id, (err, keyRow, reason) => {
                    if (err) return interaction.reply({ content: 'Database error.', ephemeral: true });
                    if (!keyRow) {
                        return interaction.reply({
                            content: reason === 'expired'
                                ? `Your **${product.name}** key has expired.`
                                : `You do not own a valid **${product.name}** key.`,
                            ephemeral: true
                        });
                    }

                    db.get(`SELECT * FROM users WHERE discord_id = ?`, [interaction.user.id], (err, userRow) => {
                        const container = new ContainerBuilder()
                            .addTextDisplayComponents(
                                (text) => text.setContent(`# Your Stats · ${product.name}`)
                            )
                            .addTextDisplayComponents(
                                (text) => text.setContent(
                                    `**Key:** ||${keyRow.key_string}||\n` +
                                    `**Duration:** ${formatDurationLabel(keyRow.duration)}\n` +
                                    `**Expires:** ${keyRow.expires_at || 'Permanent'}\n` +
                                    `**HWID Bound:** ${userRow && userRow.hwid ? 'Yes' : 'No'}\n` +
                                    `**Last HWID Reset:** ${userRow && userRow.last_reset ? userRow.last_reset : 'Never'}`
                                )
                            );

                        return interaction.reply({
                            components: [container],
                            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                        });
                    });
                });
            }
        }

        if (interaction.isModalSubmit()) {
            const product = resolveProductFromCustomId(interaction.customId);
            if (interaction.customId !== product.modalRedeem) return;

            const key = interaction.fields.getTextInputValue('keyInput');

            return db.get(
                `SELECT * FROM keys WHERE key_string = ? AND product = ?`,
                [key, product.id],
                (err, row) => {
                    if (err) return interaction.reply({ content: 'Database error.', ephemeral: true });
                    if (!row) {
                        return interaction.reply({
                            content: `Invalid key for **${product.name}**.`,
                            ephemeral: true
                        });
                    }
                    if (row.status === 'used') {
                        return interaction.reply({ content: 'This key has already been used.', ephemeral: true });
                    }

                    const expiresAt = computeExpiresAt(row.duration);

                    db.serialize(() => {
                        db.run(
                            `UPDATE keys SET status = 'used', discord_id = ?, redeemed_at = CURRENT_TIMESTAMP, expires_at = ? WHERE key_string = ? AND product = ?`,
                            [interaction.user.id, expiresAt, key, product.id]
                        );
                        db.run(`INSERT OR IGNORE INTO users (discord_id) VALUES (?)`, [interaction.user.id]);

                        const roleId = getProductRoleId(product);
                        if (roleId) {
                            interaction.guild.members.fetch(interaction.user.id).then(member => {
                                member.roles.add(roleId).catch(console.error);
                            });
                        }

                        const container = new ContainerBuilder()
                            .addTextDisplayComponents(
                                (text) => text.setContent('# Key Redeemed Successfully'),
                                (text) => text.setContent(
                                    `Your **${product.name}** key has been redeemed!\n` +
                                    `Duration: **${formatDurationLabel(row.duration)}**` +
                                    (expiresAt ? `\nExpires: ${expiresAt}` : '\nExpires: Permanent') +
                                    `\n\nUse **Get Script** to copy your loader.`
                                )
                            );

                        return interaction.reply({
                            components: [container],
                            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                        });
                    });
                }
            );
        }
    },
};
