const { SlashCommandBuilder } = require('discord.js');
const db = require('../../database');
const crypto = require('crypto');
const { getProduct, PRODUCTS } = require('../../config/products');
const { normalizeDuration, formatDurationLabel } = require('../../utils/keys');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('generate-key')
        .setDescription('Generates a new license key (Admin Only)')
        .addStringOption(option =>
            option.setName('product')
                .setDescription('Premium or Service Provider')
                .setRequired(true)
                .addChoices(
                    { name: 'Zuperming Premium', value: 'premium' },
                    { name: 'Service Provider', value: 'service_provider' }
                ))
        .addStringOption(option =>
            option.setName('duration')
                .setDescription('Empty/lifetime = permanent. Examples: 1d, 7d, 30d')
                .setRequired(false))
        .addUserOption(option =>
            option.setName('user')
                .setDescription('DM the key to this user')
                .setRequired(false)),
    async execute(interaction) {
        if (!interaction.member.permissions.has('Administrator')) {
            return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }

        const product = getProduct(interaction.options.getString('product')) || PRODUCTS.premium;
        const duration = normalizeDuration(interaction.options.getString('duration'));
        const targetUser = interaction.options.getUser('user');
        const key = `${product.keyPrefix}-` + crypto.randomBytes(8).toString('hex').toUpperCase();

        db.run(
            `INSERT INTO keys (key_string, duration, product) VALUES (?, ?, ?)`,
            [key, duration, product.id],
            async function (err) {
                if (err) {
                    console.error(err);
                    return interaction.reply({ content: 'Failed to generate key. Database error.', ephemeral: true });
                }

                const label = formatDurationLabel(duration);
                let responseMsg = `Successfully generated **${product.name}** key:\n\`\`\`\n${key}\n\`\`\`\nDuration: **${label}**`;

                if (targetUser) {
                    try {
                        await targetUser.send(
                            `Hello! Here is your **${product.name}** license key:\n\`\`\`\n${key}\n\`\`\`\nDuration: **${label}**\n\nRedeem it in the **${product.name}** Discord panel.`
                        );
                        responseMsg += `\n\n✅ Key sent via DM to ${targetUser.tag}.`;
                    } catch (error) {
                        console.error('Could not send DM to user.', error);
                        responseMsg += `\n\n❌ Could not DM ${targetUser.tag}.`;
                    }
                }

                interaction.reply({ content: responseMsg, ephemeral: true });
            }
        );
    },
};
