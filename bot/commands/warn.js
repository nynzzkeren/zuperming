const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

// Simple in-memory warn store (resets on bot restart)
// For persistent warns, use a database table
const warnings = new Map(); // guildId -> Map(userId -> [{reason, by, at}])

module.exports = {
    data: new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Warn a member or view/clear their warnings (Admin)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('Add a warning to a member')
                .addUserOption(o => o.setName('user').setDescription('User to warn').setRequired(true))
                .addStringOption(o => o.setName('reason').setDescription('Reason for warning').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('List all warnings for a member')
                .addUserOption(o => o.setName('user').setDescription('User to check').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('clear')
                .setDescription('Clear all warnings for a member')
                .addUserOption(o => o.setName('user').setDescription('User to clear').setRequired(true))),

    async execute(interaction) {
        if (!interaction.member.permissions.has('ModerateMembers')) {
            return interaction.reply({ content: 'You need Moderate Members permission.', ephemeral: true });
        }

        const sub = interaction.options.getSubcommand();
        const target = interaction.options.getUser('user');
        const guildId = interaction.guildId;

        if (!warnings.has(guildId)) warnings.set(guildId, new Map());
        const guildWarns = warnings.get(guildId);

        if (sub === 'add') {
            const reason = interaction.options.getString('reason');
            const entry = { reason, by: interaction.user.tag, at: new Date().toUTCString() };

            if (!guildWarns.has(target.id)) guildWarns.set(target.id, []);
            guildWarns.get(target.id).push(entry);

            const count = guildWarns.get(target.id).length;

            // DM the user about the warning
            try {
                await target.send(
                    `You have received a warning in **${interaction.guild.name}**.\n**Reason:** ${reason}\n**Total warnings:** ${count}`
                );
            } catch { /* User has DMs closed */ }

            return interaction.reply({
                content: `**${target.tag}** has been warned. (**${count}** total warning(s))\n**Reason:** ${reason}`
            });
        }

        if (sub === 'list') {
            const userWarns = guildWarns.get(target.id) || [];
            if (userWarns.length === 0) {
                return interaction.reply({ content: `**${target.tag}** has no warnings.`, ephemeral: true });
            }
            const lines = userWarns.map((w, i) => `**${i + 1}.** ${w.reason} — by ${w.by} (${w.at})`).join('\n');
            return interaction.reply({
                content: `**Warnings for ${target.tag}** (${userWarns.length} total):\n${lines}`,
                ephemeral: true
            });
        }

        if (sub === 'clear') {
            guildWarns.delete(target.id);
            return interaction.reply({ content: `Cleared all warnings for **${target.tag}**.` });
        }
    }
};
