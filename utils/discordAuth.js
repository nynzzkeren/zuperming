const axios = require('axios');
const crypto = require('crypto');

const DISCORD_API = 'https://discord.com/api/v10';

function getRedirectUri() {
    const base = (process.env.BASE_URL || '').replace(/\/$/, '');
    return `${base}/admin/auth/discord/callback`;
}

function getAuthorizeUrl(state) {
    const params = new URLSearchParams({
        client_id: process.env.CLIENT_ID,
        redirect_uri: getRedirectUri(),
        response_type: 'code',
        scope: 'identify',
        prompt: 'none',
        state
    });
    return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
}

async function exchangeCode(code) {
    const body = new URLSearchParams({
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: getRedirectUri()
    });

    const { data } = await axios.post(`${DISCORD_API}/oauth2/token`, body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    return data;
}

async function fetchDiscordUser(accessToken) {
    const { data } = await axios.get(`${DISCORD_API}/users/@me`, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });
    return data;
}

function getAllowedRoleIds() {
    return [process.env.DEVELOPER_ROLE_ID, process.env.OWNER_ROLE_ID].filter(Boolean);
}

async function memberHasAdminRole(botClient, userId) {
    const guildId = process.env.GUILD_ID;
    if (!guildId || !botClient?.isReady?.()) {
        throw new Error('Discord bot is not ready. Try again in a few seconds.');
    }

    const guild = await botClient.guilds.fetch(guildId);
    if (!guild) throw new Error('Configured guild not found.');

    if (guild.ownerId === userId) return { allowed: true, reason: 'guild_owner' };
    
    // Explicit hardcoded developer ID
    if (userId === '1459948430150336725') return { allowed: true, reason: 'developer_id' };

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) {
        return { allowed: false, reason: 'not_in_guild' };
    }

    const allowedRoleIds = getAllowedRoleIds();
    if (allowedRoleIds.length === 0) {
        throw new Error('DEVELOPER_ROLE_ID or OWNER_ROLE_ID must be set in .env');
    }

    const hasRole = allowedRoleIds.some((roleId) => member.roles.cache.has(roleId));
    return { allowed: hasRole, reason: hasRole ? 'role' : 'missing_role', member };
}

function createOAuthState() {
    return crypto.randomBytes(16).toString('hex');
}

module.exports = {
    getRedirectUri,
    getAuthorizeUrl,
    exchangeCode,
    fetchDiscordUser,
    memberHasAdminRole,
    createOAuthState,
    getAllowedRoleIds
};
