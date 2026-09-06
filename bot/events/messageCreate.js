const { Events } = require('discord.js');
const db = require('../../database');

// Regex to detect URLs in messages
const URL_REGEX = /https?:\/\/[^\s<>"\]]+/gi;

// In-memory cooldown per user to avoid spam (5 seconds)
const _cooldown = new Map();
const COOLDOWN_MS = 5000;

module.exports = {
    name: Events.MessageCreate,
    async execute(message, client) {
        // Ignore bots
        if (message.author.bot || !message.guild) return;

        // ── Leveling / Chat XP System ──
        const { handleMessageXp } = require('../utils/levelManager');
        handleMessageXp(message).catch(console.error);

        // Check for custom bot commands (if this bot is a custom bot)
        if (client.developerId && client.developerId !== 'admin') {
            const prefix = '!'; // Default prefix for custom commands
            if (message.content.startsWith(prefix)) {
                const args = message.content.slice(prefix.length).trim().split(/ +/);
                const commandName = args.shift().toLowerCase();

                db.get(
                    `SELECT command_response FROM custom_bot_commands WHERE developer_id = ? AND command_name = ?`,
                    [client.developerId, commandName],
                    (err, row) => {
                        if (err || !row) return;
                        // Execute the custom command by sending the response
                        message.reply({ content: row.command_response }).catch(() => {});
                    }
                );
            }
        }

        // Check if message is in an active ticket channel and has attachments (payment proof)
        if (message.attachments.size > 0 && message.channel.type === 0 /* GuildText */) {
            db.get(
                `SELECT * FROM tickets WHERE channel_id = ? AND status != 'closed'`,
                [message.channel.id],
                (err, ticket) => {
                    if (err || !ticket) return;
                    const firstAttachment = message.attachments.first();
                    if (firstAttachment && (!firstAttachment.contentType || firstAttachment.contentType.startsWith('image/'))) {
                        db.run(
                            `UPDATE tickets SET proof_url = ?, status = 'proof_pending' WHERE id = ?`,
                            [firstAttachment.url, ticket.id]
                        );
                        message.reply({
                            content: `📥 **Receipt recorded!** Staff has been notified and can verify your transaction using the **Check Payment** button above.`
                        }).catch(() => {});
                    }
                }
            );
        }

        // Check if this channel is the configured auto-bypass channel
        db.get(`SELECT value FROM settings WHERE key = 'autobypass_channel'`, async (err, row) => {
            if (err || !row) return;
            if (message.channel.id !== row.value) return;

            // Extract URLs from message
            const urls = message.content.match(URL_REGEX);
            if (!urls || urls.length === 0) return;

            // Cooldown check
            const lastUsed = _cooldown.get(message.author.id) || 0;
            if (Date.now() - lastUsed < COOLDOWN_MS) return;
            _cooldown.set(message.author.id, Date.now());

            // Take the first URL
            const url = urls[0];

            // Add a reaction to show it's processing
            try {
                await message.react('⏳').catch(() => {});
            } catch {}

            // Import runBypass from bypass.js
            const { runBypass } = require('../commands/bypass');

            let bypassResult;
            try {
                bypassResult = await runBypass(url);
            } catch (e) {
                // Remove processing reaction
                message.reactions.cache.get('⏳')?.remove().catch(() => {});
                await message.react('❌').catch(() => {});
                try {
                    await message.author.send(
                        `**Auto-Bypass — Error**\nGagal memproses: \`${url}\`\n\nError: ${e.message}`
                    );
                } catch {}
                return;
            }

            // Remove processing reaction
            message.reactions.cache.get('⏳')?.remove().catch(() => {});

            if (!bypassResult.ok) {
                await message.react('❌').catch(() => {});
                try {
                    await message.author.send(
                        `**Auto-Bypass — Gagal**\nLink: \`${url}\`\n\nReason: ${bypassResult.reason}`
                    );
                } catch {
                    await message.reply({
                        content: `<@${message.author.id}> Bypass gagal: ${bypassResult.reason}. Pastikan DM kamu terbuka.`,
                    }).then(m => setTimeout(() => m.delete().catch(() => {}), 8000));
                }
                return;
            }

            // Success — DM the result
            await message.react('✅').catch(() => {});
            const result = bypassResult.result;

            try {
                await message.author.send(
                    `**Auto-Bypass — Result**\n` +
                    `**Original:** ${url}\n\n` +
                    `**Result:**\n${result}`
                );
            } catch {
                // DM failed — reply in channel with a mention, then delete after 10s
                const reply = await message.reply({
                    content: `<@${message.author.id}> Tidak bisa DM kamu. Buka DM dulu ya!\n\nResult: ${result.slice(0, 1800)}`,
                }).catch(() => null);
                if (reply) setTimeout(() => reply.delete().catch(() => {}), 15000);
            }
        });
    }
};
