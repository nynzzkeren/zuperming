const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
const db = require('../../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('referral')
        .setDescription('View your referral link or the referral leaderboard')
        .addSubcommand(sub => sub.setName('link').setDescription('Get your personal referral link'))
        .addSubcommand(sub => sub.setName('leaderboard').setDescription('Top referrers in this community')),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();

        if (sub === 'link') {
            const userId = interaction.user.id;
            const baseUrl = process.env.BASE_URL || 'https://yoursite.com';
            const referralLink = baseUrl + '/get-key?ref=' + userId;

            db.get('SELECT COUNT(*) as count FROM referrals WHERE referrer_discord_id = ?', [userId], (err, row) => {
                const count = row?.count || 0;
                const container = new ContainerBuilder()
                    .setAccentColor(0x000000)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        '## \uD83D\uDD17 Your Referral Link\nShare this link with friends to track referrals.'
                    ))
                    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        '**Referral URL:**\n```\n' + referralLink + '\n```'
                    ))
                    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false))
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        '\uD83D\uDC65 **Total Referrals:** `' + count + '` ' + (count === 1 ? 'person' : 'people') + '\n-# When someone redeems a key using your link, they appear here.'
                    ));
                interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            });

        } else if (sub === 'leaderboard') {
            db.all('SELECT referrer_discord_id, COUNT(*) as count FROM referrals GROUP BY referrer_discord_id ORDER BY count DESC LIMIT 10', async (err, rows) => {
                const medals = ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'];
                let board = '';
                if (!rows || rows.length === 0) {
                    board = '*No referrals recorded yet. Be the first!*';
                } else {
                    const lines = [];
                    for (let i = 0; i < rows.length; i++) {
                        const r = rows[i];
                        const medal = medals[i] || ('**' + (i + 1) + '.**');
                        let name = r.referrer_discord_id;
                        try { const u = await interaction.client.users.fetch(r.referrer_discord_id); name = u.globalName || u.username; } catch (_) {}
                        lines.push(medal + ' `' + name + '` \u2014 **' + r.count + '** referral' + (r.count !== 1 ? 's' : ''));
                    }
                    board = lines.join('\n');
                }
                const container = new ContainerBuilder()
                    .setAccentColor(0x000000)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent('## \uD83C\uDFC6 Referral Leaderboard\nTop community members by referrals.'))
                    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(board))
                    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false))
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent('-# Use `/referral link` to get your personal referral URL.'));
                interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            });
        }
    }
};
