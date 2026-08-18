const {
    SlashCommandBuilder,
    ContainerBuilder,
    MessageFlags,
    ChannelType
} = require('discord.js');
const db = require('../../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('set-autobypass')
        .setDescription('Set channel for auto-bypass (send a link → bot bypasses it and DMs you)')
        .addSubcommand(sub =>
            sub.setName('set')
                .setDescription('Set the auto-bypass channel')
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('Channel to monitor for links')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('off')
                .setDescription('Disable auto-bypass')
        )
        .addSubcommand(sub =>
            sub.setName('status')
                .setDescription('Check which channel is set for auto-bypass')
        ),

    async execute(interaction) {
        if (!interaction.member.permissions.has('Administrator')) {
            return interaction.reply({ content: 'Admin only.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });
        const sub = interaction.options.getSubcommand();

        if (sub === 'set') {
            const channel = interaction.options.getChannel('channel');
            db.run(
                `INSERT INTO settings (key, value, updated_at) VALUES ('autobypass_channel', ?, CURRENT_TIMESTAMP)
                 ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
                [channel.id],
                (err) => {
                    if (err) {
                        const c = new ContainerBuilder().addTextDisplayComponents(
                            t => t.setContent('## Auto-Bypass — Error'),
                            t => t.setContent('Gagal menyimpan pengaturan ke database.')
                        );
                        return interaction.editReply({ components: [c], flags: MessageFlags.IsComponentsV2 });
                    }
                    const c = new ContainerBuilder().addTextDisplayComponents(
                        t => t.setContent('## Auto-Bypass — Aktif'),
                        t => t.setContent(
                            `Channel <#${channel.id}> sekarang dipantau.\n\n` +
                            `Kirim link apapun di channel tersebut, bot akan:\n` +
                            `1. Bypass link-nya secara otomatis\n` +
                            `2. Mengirim hasilnya ke DM kamu`
                        )
                    );
                    return interaction.editReply({ components: [c], flags: MessageFlags.IsComponentsV2 });
                }
            );
        } else if (sub === 'off') {
            db.run(`DELETE FROM settings WHERE key = 'autobypass_channel'`, (err) => {
                const c = new ContainerBuilder().addTextDisplayComponents(
                    t => t.setContent('## Auto-Bypass — Dinonaktifkan'),
                    t => t.setContent('Auto-bypass channel telah dimatikan.')
                );
                return interaction.editReply({ components: [c], flags: MessageFlags.IsComponentsV2 });
            });
        } else if (sub === 'status') {
            db.get(`SELECT value FROM settings WHERE key = 'autobypass_channel'`, (err, row) => {
                const c = new ContainerBuilder().addTextDisplayComponents(
                    t => t.setContent('## Auto-Bypass — Status'),
                    t => t.setContent(row
                        ? `Auto-bypass aktif di channel: <#${row.value}>`
                        : 'Auto-bypass tidak aktif. Gunakan `/set-autobypass set` untuk mengaktifkan.')
                );
                return interaction.editReply({ components: [c], flags: MessageFlags.IsComponentsV2 });
            });
        }
    }
};
