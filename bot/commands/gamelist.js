const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('gamelist')
        .setDescription('Shows the list of supported games (Admin only)')
        .setDefaultMemberPermissions(8), // Administrator
    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('Zuperming List Game')
            .setColor('#2F3136') // Dark color matching Discord
            .setDescription(
                'This channel lists all the games available in the Zuperming Official\n' +
                '🟢 Working Script\n' +
                '🟠 Needs Update\n' +
                '🔴 Dead Script\n\n' +
                '🟢 **Working Script**\n' +
                '• Grow a Garden 2\n' +
                '• Violence District\n' +
                '• Fisch\n' +
                '• Capybara vs Plant\n' +
                '• Throw a Coin (Free)\n\n' +
                '🔴 **Dead Script**\n' +
                '• Fishit\n' +
                '• CDID\n' +
                '• Abyss'
            );

        await interaction.reply({ embeds: [embed] });
    },
};
