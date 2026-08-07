const { ActivityType } = require('discord.js');
const db = require('../database');

let toggleWatch = false;
let intervalId = null;

function countTotalKeys() {
    return new Promise((resolve) => {
        db.get(`SELECT COUNT(*) AS total FROM keys`, (err, row) => {
            resolve(err ? 0 : row?.total || 0);
        });
    });
}

function countOnlineMembers(guild) {
    if (!guild) return 0;
    return guild.members.cache.filter(
        (m) => m.presence?.status && m.presence.status !== 'offline' && !m.user.bot
    ).size;
}

async function buildActivities(client) {
    const totalKeys = await countTotalKeys();

    let onlineMembers = 0;
    try {
        const guildId = process.env.GUILD_ID;
        if (guildId && client.isReady()) {
            const guild = await client.guilds.fetch(guildId);
            if (guild) {
                await guild.members.fetch({ withPresences: true }).catch(() => null);
                onlineMembers = countOnlineMembers(guild);
            }
        }
    } catch (e) {
        console.error('[presence] Could not fetch online members:', e.message);
    }

    const activities = [];

    const presenceDetails = process.env.PRESENCE_DETAILS;
    const presenceState = process.env.PRESENCE_STATE;

    if (presenceDetails || presenceState) {
        const playing = {
            name: process.env.PRESENCE_APP_NAME || 'Zuperming',
            type: ActivityType.Playing,
            details: presenceDetails || undefined,
            state: presenceState || undefined
        };
        if (process.env.PRESENCE_LARGE_IMAGE) {
            playing.assets = {
                largeImage: process.env.PRESENCE_LARGE_IMAGE,
                largeText: process.env.PRESENCE_LARGE_TEXT || 'Zuperming'
            };
        }
        activities.push(playing);
    } else {
        const customText = process.env.PRESENCE_CUSTOM_STATUS || 'Made with 💗 Zuperming Team';
        if (customText) {
            activities.push({
                name: 'Custom Status',
                type: ActivityType.Custom,
                state: customText
            });
        }
    }

    toggleWatch = !toggleWatch;
    const watchLabel = toggleWatch
        ? `Total Keys: ${totalKeys}`
        : `Users Online: ${onlineMembers}`;

    activities.push({
        name: watchLabel,
        type: ActivityType.Watching
    });

    return activities;
}

async function updatePresence(client) {
    if (!client?.user) return;

    try {
        const activities = await buildActivities(client);
        await client.user.setPresence({
            status: 'online',
            activities
        });
    } catch (e) {
        console.error('[presence] Failed to update:', e.message);
    }
}

function startPresenceLoop(client, intervalMs = 60000) {
    if (intervalId) clearInterval(intervalId);

    updatePresence(client);
    intervalId = setInterval(() => updatePresence(client), intervalMs);
}

function stopPresenceLoop() {
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
    }
}

module.exports = {
    updatePresence,
    startPresenceLoop,
    stopPresenceLoop
};
