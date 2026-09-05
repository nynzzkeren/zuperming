const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription('View platform statistics (Admin)'),
    async execute(interaction) {
        if (!interaction.member.permissions.has('Administrator')) {
            const errEmbed = new EmbedBuilder().setColor('#FF0000').setDescription('❌ You do not have permission to use this command.');
            return interaction.reply({ embeds: [errEmbed], ephemeral: true });
        }

        await interaction.deferReply();

        db.serialize(() => {
            let totalUsers = 0;
            let blacklistedUsers = 0;
            let activeKeys = 0;
            let totalKeys = 0;

            db.get(`SELECT COUNT(*) as count FROM users`, [], (err, row) => totalUsers = row ? row.count : 0);
            db.get(`SELECT COUNT(*) as count FROM users WHERE is_blacklisted = 1`, [], (err, row) => blacklistedUsers = row ? row.count : 0);
            db.get(`SELECT COUNT(*) as count FROM keys WHERE status = 'used'`, [], (err, row) => activeKeys = row ? row.count : 0);
            db.get(`SELECT COUNT(*) as count FROM keys`, [], (err, row) => {
                totalKeys = row ? row.count : 0;
                
                const embed = new EmbedBuilder()
                    .setColor('#5865F2')
                    .setTitle('📊 Platform Analytics')
                    .setDescription('Current statistics for Lua Vault')
                    .addFields(
                        { name: '👥 Total Users', value: `${totalUsers}`, inline: true },
                        { name: '🔑 Total Keys', value: `${totalKeys}`, inline: true },
                        { name: '🟢 Active Keys', value: `${activeKeys}`, inline: true },
                        { name: '🚫 Blacklisted', value: `${blacklistedUsers}`, inline: true }
                    )
                    .setFooter({ text: 'Lua Vault Analytics' })
                    .setTimestamp();
                    
                interaction.editReply({ embeds: [embed] });
            });
        });
    },
};
