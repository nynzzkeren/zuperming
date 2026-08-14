const { SlashCommandBuilder, ContainerBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('gamelist')
        .setDescription('Shows the list of supported games (Admin only)')
        .setDefaultMemberPermissions(8), // Administrator
    async execute(interaction) {
        const container = new ContainerBuilder();

        container.addTextDisplayComponents(
            (text) => text.setContent('# Zuperming List Game'),
            (text) => text.setContent(
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
            )
        );

        await interaction.reply({ 
            components: [container],
            flags: MessageFlags.IsComponentsV2
        });
    },
};
