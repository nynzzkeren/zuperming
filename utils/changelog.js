const {
    ContainerBuilder,
    SeparatorBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags
} = require('discord.js');

function linesFromTextarea(text) {
    return (text || '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => (l.startsWith('-') || l.startsWith('•') ? l.replace(/^[-•]\s*/, '') : l));
}

function isUsableHttpUrl(url) {
    try {
        const u = new URL(String(url || ''));
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
        return false;
    }
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
    suggestionUrl,
    includeThumbnail = true
}) {
    const typeLabel = Array.isArray(types) ? types.filter(Boolean).join(' & ') : String(types || 'Premium');
    const addedLines = linesFromTextarea(added);
    const improvedLines = linesFromTextarea(improved);
    const removedLines = linesFromTextarea(removed);

    const logoUrl = process.env.BRAND_LOGO_URL || '';
    const canThumb = includeThumbnail && isUsableHttpUrl(logoUrl);

    // ── Container 1: Game info (game name, version, status) ──
    const infoContainer = new ContainerBuilder();

    if (canThumb) {
        infoContainer.addSectionComponents((section) =>
            section
                .addTextDisplayComponents(
                    (text) => text.setContent(`# ${game} Script Update Logs`),
                    (text) => text.setContent(`• **Game:** ${game}`),
                    (text) => text.setContent(`• **Version:** ${version}`),
                    (text) => text.setContent(`• **Status:** ${status || 'Undetected'}`)
                )
                .setThumbnailAccessory((thumb) =>
                    thumb.setURL(logoUrl).setDescription(game)
                )
        );
    } else {
        infoContainer.addTextDisplayComponents(
            (text) => text.setContent(`# ${game} Script Update Logs`),
            (text) => text.setContent(`• **Game:** ${game}`),
            (text) => text.setContent(`• **Version:** ${version}`),
            (text) => text.setContent(`• **Status:** ${status || 'Undetected'}`)
        );
    }

    // ── Container 2: Changelog (Fixed / Added / Removed) ──
    const changelogContainer = new ContainerBuilder();

    const sections = [];

    if (addedLines.length) {
        sections.push({
            header: '[ + ] Added',
            lines: addedLines
        });
    }
    if (improvedLines.length) {
        sections.push({
            header: '[ ~ ] Fixed',
            lines: improvedLines
        });
    }
    if (removedLines.length) {
        sections.push({
            header: '[ - ] Removed',
            lines: removedLines
        });
    }

    if (sections.length === 0) {
        changelogContainer.addTextDisplayComponents(
            (text) => text.setContent('**[ ~ ] Fixed**'),
            (text) => text.setContent('• No changelog details provided.')
        );
    } else {
        sections.forEach((section, i) => {
            changelogContainer.addTextDisplayComponents(
                (text) => text.setContent(`**${section.header}**`),
                (text) => text.setContent(section.lines.map((l) => `• ${l}`).join('\n'))
            );
            // Add separator between sections, not after last one
            if (i < sections.length - 1) {
                changelogContainer.addSeparatorComponents(
                    new SeparatorBuilder().setDivider(true)
                );
            }
        });
    }

    const report = reportUrl || process.env.REPORT_BUG_URL || '';
    const suggestion = suggestionUrl || process.env.SUGGESTION_URL || '';
    const buttons = [];

    if (isUsableHttpUrl(report)) {
        buttons.push(
            new ButtonBuilder()
                .setLabel('Report Bugs')
                .setStyle(ButtonStyle.Link)
                .setURL(report)
        );
    }
    if (isUsableHttpUrl(suggestion)) {
        buttons.push(
            new ButtonBuilder()
                .setLabel('Suggest a Feature')
                .setStyle(ButtonStyle.Link)
                .setURL(suggestion)
        );
    }

    // ── Container 3: Buttons (only if URLs are set) ──
    const containers = [infoContainer, changelogContainer];

    if (buttons.length) {
        const buttonContainer = new ContainerBuilder();
        buttonContainer.addActionRowComponents((row) => row.addComponents(...buttons));
        containers.push(buttonContainer);
    }

    const payload = {
        components: containers,
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: pingEveryone ? { parse: ['everyone'] } : { parse: [] }
    };

    return payload;
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
        .addSeparatorComponents((sep) => sep.setDivider(true))
        .addTextDisplayComponents(
            (text) => text.setContent('### Recommended Executors')
        );

    const buttons = executors
        .filter((ex) => isUsableHttpUrl(ex.url))
        .slice(0, 3)
        .map((ex) =>
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
    linesFromTextarea,
    isUsableHttpUrl
};
