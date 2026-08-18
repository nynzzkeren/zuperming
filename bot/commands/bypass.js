const {
    SlashCommandBuilder,
    ContainerBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags
} = require('discord.js');
const crypto = require('crypto');

// In-memory cache for bypass results (TTL: 10 minutes)
const _cache = new Map();
const CACHE_TTL = 10 * 60 * 1000;

function cacheStore(result) {
    const id = crypto.randomBytes(6).toString('hex');
    _cache.set(id, { result, expires: Date.now() + CACHE_TTL });
    // Cleanup old entries
    for (const [k, v] of _cache.entries()) {
        if (Date.now() > v.expires) _cache.delete(k);
    }
    return id;
}

function cacheGet(id) {
    const entry = _cache.get(id);
    if (!entry) return null;
    if (Date.now() > entry.expires) { _cache.delete(id); return null; }
    return entry.result;
}

const API_KEY = 'zfe0N';
const API_BASE = 'https://api.theresav.biz.id/bypass/izen';

async function runBypass(url) {
    const apiUrl = `${API_BASE}?url=${encodeURIComponent(url)}&apikey=${API_KEY}`;
    const res = await fetch(apiUrl, {
        method: 'GET',
        headers: { 'User-Agent': 'ZupermingBot/1.0' },
        signal: AbortSignal.timeout(20000)
    });
    const data = await res.json();
    if (data && data.result) return { ok: true, result: String(data.result) };
    const reason = data && (data.message || data.error || data.msg)
        ? String(data.message || data.error || data.msg)
        : 'Unknown error from bypass API.';
    return { ok: false, reason };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bypass')
        .setDescription('Bypass a link to skip ads/redirects and get the real URL')
        .addStringOption(opt =>
            opt.setName('url').setDescription('The link to bypass').setRequired(true)
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const url = interaction.options.getString('url');

        // Validate URL
        try { new URL(url); } catch {
            const c = new ContainerBuilder().addTextDisplayComponents(
                t => t.setContent('## Bypass — Invalid URL'),
                t => t.setContent('URL tidak valid. Pastikan dimulai dengan `https://` atau `http://`.')
            );
            return interaction.editReply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }

        const c_loading = new ContainerBuilder().addTextDisplayComponents(
            t => t.setContent('## Bypass — Processing...'),
            t => t.setContent(`Bypassing link, harap tunggu...`)
        );
        await interaction.editReply({ components: [c_loading], flags: MessageFlags.IsComponentsV2 });

        let bypassResult;
        try {
            bypassResult = await runBypass(url);
        } catch (err) {
            const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError';
            const c = new ContainerBuilder().addTextDisplayComponents(
                t => t.setContent('## Bypass — Error'),
                t => t.setContent(isTimeout
                    ? 'API timeout (>20s). Link mungkin tidak didukung atau server down.'
                    : `Gagal menghubungi API.\n\`\`\`${err.message}\`\`\``)
            );
            return interaction.editReply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }

        if (!bypassResult.ok) {
            const c = new ContainerBuilder().addTextDisplayComponents(
                t => t.setContent('## Bypass — Failed'),
                t => t.setContent(`API tidak bisa memproses link ini.\n\n**Reason:** ${bypassResult.reason}`)
            );
            return interaction.editReply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }

        const result = bypassResult.result;
        const cacheId = cacheStore(result);

        const displayResult = result.length > 1500 ? result.slice(0, 1500) + '...' : result;

        const container = new ContainerBuilder().addTextDisplayComponents(
            t => t.setContent('## Bypass — Result'),
            t => t.setContent(`**Original:**\n${url}`),
            t => t.setContent(`**Result:**\n${displayResult}`)
        );

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`btn_bypass_copy_${cacheId}`)
                .setLabel('Mobile Copy')
                .setStyle(ButtonStyle.Secondary)
        );

        return interaction.editReply({
            components: [container, row],
            flags: MessageFlags.IsComponentsV2
        });
    },

    // Expose for use by messageCreate auto-bypass
    runBypass,
    cacheStore,
    cacheGet
};
