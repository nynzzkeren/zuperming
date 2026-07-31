const { SlashCommandBuilder } = require('discord.js');
const db = require('../../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('manage-user')
        .setDescription('Manage a user (Whitelist, Blacklist, Remove Key) - Admin Only')
        .addSubcommand(subcommand =>
            subcommand
                .setName('blacklist')
                .setDescription('Blacklists a user from using the loader')
                .addUserOption(option => option.setName('user').setDescription('The user to blacklist').setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('whitelist')
                .setDescription('Whitelists a previously blacklisted user')
                .addUserOption(option => option.setName('user').setDescription('The user to whitelist').setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove-key')
                .setDescription('Unbinds the user\'s key so it can be used again')
                .addUserOption(option => option.setName('user').setDescription('The user to remove the key from').setRequired(true))),
    async execute(interaction) {
        if (!interaction.member.permissions.has('Administrator')) {
            return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }

        const subcommand = interaction.options.getSubcommand();
        const targetUser = interaction.options.getUser('user');

        if (subcommand === 'blacklist') {
            db.run(`UPDATE users SET is_blacklisted = 1 WHERE discord_id = ?`, [targetUser.id], function(err) {
                if (err) return interaction.reply({ content: 'Database error.', ephemeral: true });
                if (this.changes === 0) {
                    // Create user if they don't exist yet but want to preemptively blacklist
                    db.run(`INSERT OR IGNORE INTO users (discord_id, is_blacklisted) VALUES (?, 1)`, [targetUser.id]);
                }
                interaction.reply({ content: `✅ ${targetUser.tag} has been blacklisted.`, ephemeral: true });
            });
        } else if (subcommand === 'whitelist') {
            db.run(`UPDATE users SET is_blacklisted = 0 WHERE discord_id = ?`, [targetUser.id], function(err) {
                if (err) return interaction.reply({ content: 'Database error.', ephemeral: true });
                interaction.reply({ content: `✅ ${targetUser.tag} has been whitelisted.`, ephemeral: true });
            });
        } else if (subcommand === 'remove-key') {
            // Find their key and set it back to unused, remove their HWID
            db.get(`SELECT key_string FROM keys WHERE discord_id = ? AND status = 'used'`, [targetUser.id], (err, row) => {
                if (err) return interaction.reply({ content: 'Database error.', ephemeral: true });
                if (!row) return interaction.reply({ content: 'User does not have an active key.', ephemeral: true });

                db.serialize(() => {
                    db.run(`UPDATE keys SET status = 'unused', discord_id = NULL WHERE discord_id = ? AND status = 'used'`, [targetUser.id]);
                    db.run(`UPDATE users SET hwid = NULL WHERE discord_id = ?`, [targetUser.id]);
                    
                    interaction.reply({ content: `✅ Successfully unbound and removed key \`${row.key_string}\` from ${targetUser.tag}. The key is now free to be used by anyone again.`, ephemeral: true });
                });
            });
        }
    },
};
