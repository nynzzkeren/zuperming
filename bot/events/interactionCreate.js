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
const { getProduct, getBaseUrl, getProductRoleId, getFreemiumGetKeyUrl, getSupportUrl } = require('../../config/products');
const { computeExpiresAt, isKeyExpired, formatDurationLabel } = require('../../utils/keys');
const { isUsableHttpUrl } = require('../../utils/changelog');

function resolveProductFromCustomId(customId) {
    if (customId.startsWith('btn_free_') || customId === 'modal_free_redeem' || customId === 'btn_free_copy_script') {
        return getProduct('freemium');
    }
    if (customId.startsWith('btn_sp_') || customId === 'modal_sp_redeem' || customId === 'btn_sp_copy_script') {
        return getProduct('service_provider');
    }
    return getProduct('premium');
}

function buildLoaderScript(product, keyString) {
    return `_G.key_script = "${keyString}"\nloadstring(game:HttpGet("${getBaseUrl()}${product.loaderRoute}"))()`;
}

function freemiumLoaderTemplate() {
    const url = getFreemiumGetKeyUrl();
    return (
        `-- 1) Ambil key di: ${url}\n` +
        `-- 2) Paste key di bawah, lalu execute\n` +
        `_G.key_script = "PASTE_YOUR_KEY_HERE"\n` +
        `loadstring(game:HttpGet("${getBaseUrl()}/loader/free"))()`
    );
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

function copyButtonId(product) {
    if (product.id === 'freemium') return 'btn_free_copy_script';
    if (product.id === 'service_provider') return 'btn_sp_copy_script';
    return 'btn_copy_script';
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
            if (customId === 'btn_add_game_modal') {
                const modal = new ModalBuilder()
                    .setCustomId('modal_add_game')
                    .setTitle('Add New Game');

                const productInput = new TextInputBuilder()
                    .setCustomId('productInput')
                    .setLabel('Product (premium, freemium, service_provider)')
                    .setPlaceholder('premium')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                const gameIdInput = new TextInputBuilder()
                    .setCustomId('gameIdInput')
                    .setLabel('Roblox Game ID')
                    .setPlaceholder('e.g., 10200395747')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                const gameNameInput = new TextInputBuilder()
                    .setCustomId('gameNameInput')
                    .setLabel('Game Name')
                    .setPlaceholder('e.g., Grow a Garden 2')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(productInput),
                    new ActionRowBuilder().addComponents(gameIdInput),
                    new ActionRowBuilder().addComponents(gameNameInput)
                );
                return interaction.showModal(modal);
            }

            if (customId === 'btn_upload_script_flow') {
                await interaction.reply({
                    content: `**[Upload Script]**\nSilakan ketik balas di channel ini dengan format:\n\`Product_Type Roblox_Game_ID\`\nContoh: \`premium 10200395747\`\nDan pastikan kamu **ATTACH/LAMPIRKAN** file \`.lua\` atau \`.txt\` pada pesan tersebut.\n*(Waktu kamu 60 detik)*`,
                    ephemeral: true
                });

                const filter = m => m.author.id === interaction.user.id && m.attachments.size > 0;
                const collector = interaction.channel.createMessageCollector({ filter, time: 60000, max: 1 });

                collector.on('collect', async m => {
                    const contentArgs = m.content.trim().split(' ');
                    if (contentArgs.length < 2) {
                        return interaction.followUp({ content: 'Format salah. Harus ada Product Type dan Game ID di pesannya. Contoh: `premium 12345`', ephemeral: true });
                    }
                    const productArg = contentArgs[0].toLowerCase();
                    const gameIdArg = contentArgs[1];
                    const attachment = m.attachments.first();
                    
                    if (!attachment.name.endsWith('.lua') && !attachment.name.endsWith('.txt')) {
                        return interaction.followUp({ content: 'File harus berakhiran .lua atau .txt', ephemeral: true });
                    }

                    try {
                        const response = await fetch(attachment.url);
                        const scriptContent = await response.text();

                        // Check if game exists
                        db.get(`SELECT * FROM games WHERE product = ? AND roblox_game_id = ?`, [productArg, gameIdArg], (err, gameRow) => {
                            if (err || !gameRow) return interaction.followUp({ content: `Game ID ${gameIdArg} untuk produk ${productArg} belum terdaftar! Silahkan "Add New Game" dulu.`, ephemeral: true });

                            db.run(
                                `INSERT INTO scripts (product, game_id, raw_script, obfuscated_script, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                                [productArg, gameIdArg, `discord_upload:${attachment.name}`, scriptContent],
                                (err) => {
                                    if (err) return interaction.followUp({ content: 'Gagal save ke database.', ephemeral: true });
                                    m.delete().catch(()=>null); 
                                    interaction.followUp({ content: `✅ Script untuk **${gameRow.name}** berhasil diupload dan otomatis live ke Web!`, ephemeral: true });
                                }
                            );
                        });
                    } catch (e) {
                        interaction.followUp({ content: 'Gagal mendownload file.', ephemeral: true });
                    }
                });

                collector.on('end', collected => {
                    if (collected.size === 0) {
                        interaction.followUp({ content: 'Waktu upload habis / dibatalkan.', ephemeral: true });
                    }
                });
                return;
            }

            const action = customId
                .replace(/^btn_free_/, '')
                .replace(/^btn_sp_/, '')
                .replace(/^btn_/, '');

            // Freemium-only buttons
            if (product.id === 'freemium' && (action === 'getkey' || action === 'support' || action === 'check_key')) {
                if (action === 'getkey') {
                    const url = getFreemiumGetKeyUrl();
                    return interaction.reply({
                        content: `**Get Freemium Key:**\n${url}`,
                        ephemeral: true
                    });
                }
                if (action === 'check_key') {
                    return getValidKey(interaction.user.id, product.id, (err, row, reason) => {
                        if (err) return interaction.reply({ content: 'Database error.', ephemeral: true });
                        if (!row) {
                            return interaction.reply({
                                content: `Kamu belum mengklaim / me-redeem key apapun atau key sudah expired.\nAlasan: ${reason}`,
                                ephemeral: true
                            });
                        }
                        
                        const expText = row.expires_at 
                            ? `<t:${Math.floor(new Date(row.expires_at).getTime() / 1000)}:R>` 
                            : 'Lifetime';
                            
                        return interaction.reply({
                            content: `**Freemium Key Information**\n🔑 **Key:** \`${row.key_string}\`\n⏳ **Duration:** ${formatDurationLabel(row.duration)}\n📅 **Expires:** ${expText}\n💻 **HWID:** ${row.bound_hwid ? 'Bound' : 'Not Bound'}`,
                            ephemeral: true
                        });
                    });
                }
                return interaction.reply({
                    content: `**Support:**\n${getSupportUrl()}`,
                    ephemeral: true
                });
            }

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
                // Freemium: always give loader template (key from web). If Discord-bound key exists, fill it.
                if (product.id === 'freemium') {
                    return getValidKey(interaction.user.id, product.id, (err, row) => {
                        const loaderScript = row
                            ? buildLoaderScript(product, row.key_string)
                            : freemiumLoaderTemplate();

                        if (action === 'copy_script') {
                            return interaction.reply({ content: `\`${loaderScript}\``, ephemeral: true });
                        }

                        const components = [
                            new ActionRowBuilder().addComponents(
                                new ButtonBuilder()
                                    .setCustomId('btn_free_copy_script')
                                    .setLabel('Mobile Copy')
                                    .setStyle(ButtonStyle.Secondary),
                                ...(isUsableHttpUrl(getFreemiumGetKeyUrl())
                                    ? [new ButtonBuilder().setLabel('Get Key').setStyle(ButtonStyle.Link).setURL(getFreemiumGetKeyUrl())]
                                    : [])
                            )
                        ];

                        const textContent = `**Freemium Loader**\n` +
                            (row ? `Key Discord-bound · Duration: **${formatDurationLabel(row.duration)}**` : `Ambil key di **Get Key** (web), paste ke \`_G.key_script\`, lalu execute.`) +
                            `\n\nCopy and paste into your executor:\n\`\`\`lua\n${loaderScript}\n\`\`\``;

                        return interaction.reply({
                            content: textContent,
                            components: components,
                            ephemeral: true
                        }).catch(console.error);
                    });
                }

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

                    const components = [
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId(copyButtonId(product))
                                .setLabel('Mobile Copy')
                                .setStyle(ButtonStyle.Secondary)
                        )
                    ];

                    const textContent = `**Your ${product.name} Loader**\n` +
                        `Duration: **${formatDurationLabel(row.duration)}**\n` +
                        (row.expires_at ? `Expires: ${row.expires_at}` : 'Expires: Permanent') +
                        `\n\nCopy and paste this script into your executor:\n\`\`\`lua\n${loaderScript}\n\`\`\``;

                    return interaction.reply({
                        content: textContent,
                        components: components,
                        ephemeral: true
                    }).catch(console.error);
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
                            db.run(`UPDATE users SET total_resets = COALESCE(total_resets, 0) + 1 WHERE discord_id = ?`, [interaction.user.id], () => {});
                            
                            db.get(`SELECT total_executions, total_resets, last_ip FROM users WHERE discord_id = ?`, [interaction.user.id], (err, user) => {
                                const totalExec = user ? (user.total_executions || 0) : 0;
                                const totalReset = user ? (user.total_resets || 0) + 1 : 1;
                                const ip = user && user.last_ip ? user.last_ip : 'Unknown (No prior execution)';
                                
                                const { sendWebhook } = require('../../utils/webhook');
                                sendWebhook({
                                    title: 'HWID Reset',
                                    color: 0xFF9900,
                                    fields: [
                                        { name: 'User', value: `<@${interaction.user.id}>`, inline: true },
                                        { name: 'Product', value: product.name, inline: true },
                                        { name: 'IP Address', value: ip, inline: true },
                                        { name: 'Total Executions', value: String(totalExec), inline: true },
                                        { name: 'Total HWID Resets', value: String(totalReset), inline: true }
                                    ],
                                    timestamp: new Date().toISOString()
                                });
                            });

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
            if (interaction.customId === 'modal_add_game') {
                const product = interaction.fields.getTextInputValue('productInput').toLowerCase();
                const gameId = interaction.fields.getTextInputValue('gameIdInput').trim();
                const gameName = interaction.fields.getTextInputValue('gameNameInput').trim();

                const validProducts = ['premium', 'freemium', 'service_provider'];
                if (!validProducts.includes(product)) {
                    return interaction.reply({ content: 'Product tidak valid. Harus premium, freemium, atau service_provider', ephemeral: true });
                }

                return db.run(`INSERT INTO games (product, roblox_game_id, name) VALUES (?, ?, ?)`, [product, gameId, gameName], (err) => {
                    if (err) return interaction.reply({ content: 'Gagal menambahkan game. Mungkin Game ID dan Product ini sudah ada.', ephemeral: true });
                    return interaction.reply({ content: `✅ Game **${gameName}** (${gameId}) untuk produk **${product}** berhasil ditambahkan! Silahkan cek \`/gamelist\` lagi.`, ephemeral: true });
                });
            }

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
