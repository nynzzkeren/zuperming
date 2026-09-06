const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
let joinVoiceChannel, getVoiceConnection;
try {
    const voice = require('@discordjs/voice');
    joinVoiceChannel = voice.joinVoiceChannel;
    getVoiceConnection = voice.getVoiceConnection;
} catch (e) {
    console.warn('[BotManager] @discordjs/voice is not installed. Run "npm install" to enable 24/7 VC.');
}
const fs = require('fs');
const path = require('path');
const db = require('../database');

const activeBots = new Map(); // token -> client instance

function loadCommands(client) {
    client.commands = new Collection();
    const commandsPath = path.join(__dirname, 'commands');
    if (fs.existsSync(commandsPath)) {
        const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
        for (const file of commandFiles) {
            const filePath = path.join(commandsPath, file);
            // Delete cache so we get fresh commands if needed, though not strictly required
            delete require.cache[require.resolve(filePath)];
            const command = require(filePath);
            if ('data' in command && 'execute' in command) {
                client.commands.set(command.data.name, command);
            }
        }
    }
}

function loadEvents(client) {
    const eventsPath = path.join(__dirname, 'events');
    if (fs.existsSync(eventsPath)) {
        const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));
        for (const file of eventFiles) {
            const filePath = path.join(eventsPath, file);
            delete require.cache[require.resolve(filePath)];
            const event = require(filePath);
            if (event.once) {
                client.once(event.name, (...args) => event.execute(...args, client));
            } else {
                client.on(event.name, (...args) => event.execute(...args, client));
            }
        }
    }
}

async function startBot(token, developerId) {
    if (activeBots.has(token)) {
        console.log(`[BotManager] Bot for developer ${developerId} is already running.`);
        return activeBots.get(token);
    }

    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMembers,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.GuildPresences,
            GatewayIntentBits.GuildVoiceStates,
            GatewayIntentBits.DirectMessages
        ],
        partials: [Partials.Message, Partials.Channel, Partials.Reaction]
    });

    client.developerId = developerId; // Attach developer context to the client!

    loadCommands(client);
    loadEvents(client);

    try {
        await client.login(token);
        activeBots.set(token, client);
        console.log(`[BotManager] Successfully started bot for developer ${developerId} as ${client.user.tag}`);
        
        // Update database with bot_id
        db.run(`UPDATE developers SET bot_id = ? WHERE id = ?`, [client.user.id, developerId]);

        // ── 24/7 Voice Channel ──
        const VC_CHANNEL_ID = process.env.VC_24_7_CHANNEL_ID || '1545960548804333720';

        async function join24_7VC() {
            try {
                if (!joinVoiceChannel) return;
                const channel = await client.channels.fetch(VC_CHANNEL_ID).catch(() => null);
                if (!channel || !channel.isVoiceBased()) return;

                const existingConn = getVoiceConnection(channel.guildId);
                if (existingConn) return; // already connected

                joinVoiceChannel({
                    channelId: channel.id,
                    guildId: channel.guildId,
                    adapterCreator: channel.guild.voiceAdapterCreator,
                    selfDeaf: true,
                    selfMute: true
                });
                console.log(`[BotManager] Joined 24/7 VC: ${channel.name} (${VC_CHANNEL_ID})`);
            } catch (e) {
                console.error('[BotManager] Failed to join 24/7 VC:', e.message);
            }
        }

        // Join on ready
        client.once('ready', () => join24_7VC());

        // Rejoin if bot gets disconnected from the VC
        client.on('voiceStateUpdate', (oldState, newState) => {
            if (oldState.member?.id !== client.user.id) return;
            // Bot was disconnected (had a channel, now doesn't)
            if (oldState.channelId === VC_CHANNEL_ID && !newState.channelId) {
                console.log('[BotManager] Disconnected from 24/7 VC — rejoining in 3s...');
                setTimeout(() => join24_7VC(), 3000);
            }
        });

        return client;
    } catch (err) {
        console.error(`[BotManager] Failed to start bot for developer ${developerId}:`, err.message);
        return null;
    }
}

async function stopBot(token) {
    const client = activeBots.get(token);
    if (client) {
        client.destroy();
        activeBots.delete(token);
        console.log(`[BotManager] Stopped a bot instance.`);
    }
}

async function initAllBots() {
    console.log('[BotManager] Initializing all developer bots...');
    
    // Fallback: Start the main admin bot if token exists in .env
    if (process.env.DISCORD_TOKEN) {
        await startBot(process.env.DISCORD_TOKEN, 'admin');
    }

    db.all(`SELECT id, bot_token FROM developers WHERE status = 'active' AND bot_token IS NOT NULL`, async (err, rows) => {
        if (err) {
            console.error('[BotManager] Database error:', err);
            return;
        }
        
        for (const row of rows) {
            await startBot(row.bot_token, row.id);
        }
    });
}

module.exports = {
    startBot,
    stopBot,
    initAllBots,
    activeBots
};
