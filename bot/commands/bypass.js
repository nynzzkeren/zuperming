const {
    SlashCommandBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    MessageFlags
} = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bypass')
        .setDescription('Bypass a link to skip ads/redirects and get the real URL')
        .addStringOption(option =>
            option
                .setName('url')
                .setDescription('The link you want to bypass')
                .setRequired(true)
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const url = interaction.options.getString('url');

        // Validate URL
        let parsedUrl;
        try {
            parsedUrl = new URL(url);
        } catch {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    (t) => t.setContent('## Bypass — Invalid URL'),
                    (t) => t.setContent('The URL you provided is not a valid URL. Make sure it starts with `https://` or `http://`.')
                );
            return interaction.editReply({
                components: [container],
                flags: MessageFlags.IsComponentsV2
            });
        }

        const apiKey = 'zfe0N';
        const apiUrl = `https://api.theresav.biz.id/bypass/izen?url=${encodeURIComponent(url)}&apikey=${apiKey}`;

        try {
            const res = await fetch(apiUrl, {
                method: 'GET',
                headers: { 'User-Agent': 'ZupermingBot/1.0' },
                signal: AbortSignal.timeout(20000)
            });

            const data = await res.json();

            if (data && data.result) {
                const result = String(data.result).slice(0, 1800);
                const container = new ContainerBuilder()
                    .addTextDisplayComponents(
                        (t) => t.setContent('## Bypass — Result'),
                        (t) => t.setContent(`**Original URL:**\n${url}`),
                        (t) => t.setContent(`**Bypassed Result:**\n${result}`)
                    );
                return interaction.editReply({
                    components: [container],
                    flags: MessageFlags.IsComponentsV2
                });
            } else {
                const reason = data && (data.message || data.error || data.msg) ? String(data.message || data.error || data.msg) : 'Unknown error from bypass API.';
                const container = new ContainerBuilder()
                    .addTextDisplayComponents(
                        (t) => t.setContent('## Bypass — Failed'),
                        (t) => t.setContent(`The bypass API could not process this link.\n\n**Reason:** ${reason}`)
                    );
                return interaction.editReply({
                    components: [container],
                    flags: MessageFlags.IsComponentsV2
                });
            }
        } catch (err) {
            const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError';
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    (t) => t.setContent('## Bypass — Error'),
                    (t) => t.setContent(isTimeout
                        ? 'The bypass API took too long to respond (>20s). The link might be unsupported or the server is down.'
                        : `Failed to contact the bypass API.\n\`\`\`${err.message}\`\`\``)
                );
            return interaction.editReply({
                components: [container],
                flags: MessageFlags.IsComponentsV2
            });
        }
    }
};
