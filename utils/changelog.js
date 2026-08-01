const {
    ContainerBuilder,
    SeparatorSpacingSize,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags
} = require('discord.js');

const LOGO_URL = process.env.BRAND_LOGO_URL ||
    'https://cdn.discordapp.com/attachments/1449307932750643210/1531296832527929457/1783999829490.png';

function linesFromTextarea(text) {
    return (text || '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => (l.startsWith('-') || l.startsWith('•') ? l.replace(/^[-•]\s*/, '') : l));
}

function buildChangelogPayload({
    game,
    types,
    version,
    status,
    added,
    improved,
    removed,
    pingEveryone,
    reportUrl,
    suggestionUrl
}) {
    const typeLabel = Array.isArray(types) ? types.filter(Boolean).join(' & ') : String(types || 'Premium');
    const addedLines = linesFromTextarea(added);
    const improvedLines = linesFromTextarea(improved);
    const removedLines = linesFromTextarea(removed);

    let changelogBody = '';
    if (addedLines.length) {
        changelogBody += `**[+] Added**\n${addedLines.map((l) => `• ${l}`).join('\n')}\n\n`;
    }
    if (improvedLines.length) {
        changelogBody += `**[!] Improved**\n${improvedLines.map((l) => `• ${l}`).join('\n')}\n\n`;
    }
    if (removedLines.length) {
        changelogBody += `**[-] Removed**\n${removedLines.map((l) => `• ${l}`).join('\n')}\n\n`;
    }
    changelogBody = changelogBody.trim() || '_No changelog details provided._';

    const container = new ContainerBuilder()
        .addSectionComponents((section) =>
            section
                .addTextDisplayComponents(
                    (text) => text.setContent(`**Game:** ${game}`),
                    (text) => text.setContent(`**Type:** ${typeLabel}`),
                    (text) => text.setContent(`**Version:** ${version}`),
                    (text) => text.setContent(`**Status:** ${status || 'Undetected'}`)
                )
                .setThumbnailAccessory((thumb) =>
                    thumb.setURL(LOGO_URL).setDescription('Zuperming')
                )
        )
        .addSeparatorComponents((sep) =>
            sep.setDivider(true).setSpacing(SeparatorSpacingSize.Small)
        )
        .addTextDisplayComponents(
            (text) => text.setContent('# Change Log'),
            (text) => text.setContent(changelogBody)
        );

    const report = reportUrl || process.env.REPORT_BUG_URL || 'https://discord.com/channels/@me';
    const suggestion = suggestionUrl || process.env.SUGGESTION_URL || 'https://discord.com/channels/@me';

    container.addActionRowComponents((row) =>
        row.addComponents(
            new ButtonBuilder()
                .setLabel('Report Bug')
                .setStyle(ButtonStyle.Link)
                .setURL(report)
                .setEmoji('🐞'),
            new ButtonBuilder()
                .setLabel('Suggestion')
                .setStyle(ButtonStyle.Link)
                .setURL(suggestion)
                .setEmoji('✉️')
        )
    );

    const content = pingEveryone ? '@everyone' : undefined;

    return {
        content,
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: pingEveryone ? { parse: ['everyone'] } : { parse: [] }
    };
}

function buildExecutorWarnDm({ executorName, score, total }) {
    const executors = require('../config/executors');

    const container = new ContainerBuilder()
        .addTextDisplayComponents(
            (text) => text.setContent('# Change Your Executor'),
            (text) => text.setContent(
                `Executor kamu (**${executorName || 'Unknown'}**) terdeteksi **UNC/sUNC lemah** (${score}/${total}).\n\n` +
                `Script Zuperming butuh executor yang support UNC dengan baik.\n` +
                `Silakan ganti executor, lalu execute ulang.`
            )
        )
        .addSeparatorComponents((sep) =>
            sep.setDivider(true).setSpacing(SeparatorSpacingSize.Small)
        )
        .addTextDisplayComponents(
            (text) => text.setContent('### Recommended Executors')
        );

    const buttons = executors.slice(0, 3).map((ex) =>
        new ButtonBuilder()
            .setLabel(ex.label || ex.name)
            .setStyle(ButtonStyle.Link)
            .setURL(ex.url)
    );

    if (buttons.length) {
        container.addActionRowComponents((row) => row.addComponents(...buttons));
    }

    return {
        components: [container],
        flags: MessageFlags.IsComponentsV2
    };
}

module.exports = {
    buildChangelogPayload,
    buildExecutorWarnDm,
    linesFromTextarea
};
