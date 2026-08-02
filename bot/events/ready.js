const { REST, Routes } = require('discord.js');
const { startPresenceLoop } = require('../../utils/presence');

module.exports = {
    name: 'ready',
    once: true,
    async execute(client) {
        console.log(`Logged in as ${client.user.tag}!`);

        startPresenceLoop(client, 60000);

        const commands = [];
        for (const command of client.commands.values()) {
            commands.push(command.data.toJSON());
        }

        if (process.env.CLIENT_ID && process.env.GUILD_ID && process.env.DISCORD_TOKEN) {
            const rest = new REST().setToken(process.env.DISCORD_TOKEN);
            try {
                console.log(`Started refreshing ${commands.length} application (/) commands.`);
                const data = await rest.put(
                    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
                    { body: commands }
                );
                console.log(`Successfully reloaded ${data.length} application (/) commands.`);
            } catch (error) {
                console.error(error);
            }
        } else {
            console.log('Missing CLIENT_ID, GUILD_ID, or DISCORD_TOKEN in .env. Skipping slash command registration.');
        }
    }
};
