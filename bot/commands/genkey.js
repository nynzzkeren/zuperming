const { SlashCommandBuilder } = require('discord.js');
const db = require('../../database');
const crypto = require('crypto');
const { getProduct, PRODUCTS } = require('../../config/products');
const { normalizeDuration, formatDurationLabel } = require('../../utils/keys');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('genkey')
        .setDescription('Generate license key (Admin)')
        .addStringOption(option =>
            option.setName('product')
                .setDescription('Premium or Service Provider')
                .setRequired(true)
                .addChoices(
                    { name: 'Premium', value: 'premium' },
                    { name: 'Service Provider', value: 'service_provider' }
                ))
        .addStringOption(option =>
            option.setName('duration')
                .setDescription('Empty = permanent. Ex: 1d, 7d, 30d')
                .setRequired(false))
        .addUserOption(option =>
            option.setName('user')
                .setDescription('DM key to this user')
                .setRequired(false)),
    async execute(interaction) {
        if (!interaction.member.permissions.has('Administrator')) {
            return interaction.reply({ content: 'Admin only.', ephemeral: true });
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
                    return interaction.reply({ content: 'DB error generating key.', ephemeral: true });
                }

                const label = formatDurationLabel(duration);
                let responseMsg = `**${product.name}** key:\n\`\`\`\n${key}\n\`\`\`\nDuration: **${label}**`;

                if (targetUser) {
                    try {
                        await targetUser.send(
                            `**${product.name}** key:\n\`\`\`\n${key}\n\`\`\`\nDuration: **${label}**\n\nRedeem di panel **${product.name}**.`
                        );
                        responseMsg += `\n✅ DM → ${targetUser.tag}`;
                    } catch {
                        responseMsg += `\n❌ Gagal DM ${targetUser.tag}`;
                    }
                }

                interaction.reply({ content: responseMsg, ephemeral: true });
            }
        );
    },
};
