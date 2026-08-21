const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const db = require('../../database');
const crypto = require('crypto');
const { getProduct, PRODUCTS } = require('../../config/products');
const { normalizeDuration, formatDurationLabel } = require('../../utils/keys');

function insertKey(key, duration, productId) {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO keys (key_string, duration, product) VALUES (?, ?, ?)`,
            [key, duration, productId],
            function (err) {
                if (err) reject(err);
                else resolve(key);
            }
        );
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('genkey')
        .setDescription('Generate keys (max 100) → file .txt (Admin)')
        .addStringOption(option =>
            option.setName('product')
                .setDescription('Script / panel type')
                .setRequired(true)
                .addChoices(
                    { name: 'Premium', value: 'premium' },
                    { name: 'Freemium', value: 'freemium' }
                ))
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('Berapa key (1–100)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(100))
        .addStringOption(option =>
            option.setName('duration')
                .setDescription('Empty = permanent. Ex: 1d, 7d, 30d')
                .setRequired(false))
        .addUserOption(option =>
            option.setName('user')
                .setDescription('DM file keys ke user ini (opsional)')
                .setRequired(false)),
    async execute(interaction) {
        if (!interaction.member.permissions.has('Administrator')) {
            return interaction.reply({ content: 'Admin only.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        const product = getProduct(interaction.options.getString('product')) || PRODUCTS.premium;
        const amount = interaction.options.getInteger('amount') || 1;
        const duration = normalizeDuration(interaction.options.getString('duration'));
        const targetUser = interaction.options.getUser('user');
        const label = formatDurationLabel(duration);

        const keys = [];
        try {
            for (let i = 0; i < amount; i++) {
                const key = `${product.keyPrefix}-` + crypto.randomBytes(8).toString('hex').toUpperCase();
                await insertKey(key, duration, product.id);
                keys.push(key);
            }
        } catch (e) {
            console.error(e);
            return interaction.editReply({ content: 'DB error: ' + e.message });
        }

        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `zuperming-${product.id}-${amount}x-${stamp}.txt`;
        const header = [
            `Zuperming Keys`,
            `Product: ${product.name}`,
            `Duration: ${label}`,
            `Amount: ${keys.length}`,
            `Generated: ${new Date().toISOString()}`,
            `---`,
            ''
        ].join('\n');
        const fileBody = header + keys.join('\n') + '\n';
        const makeFile = () => new AttachmentBuilder(Buffer.from(fileBody, 'utf8'), { name: fileName });

        const msg =
            `✅ Generated **${keys.length}** × **${product.name}**\n` +
            `Duration: **${label}**\n` +
            `File .txt terlampir.` +
            (amount === 1 ? `\nKey: \`${keys[0]}\`` : '');

        await interaction.editReply({ content: msg, files: [makeFile()] });

        if (targetUser) {
            try {
                await targetUser.send({
                    content:
                        `**${product.name}** keys (${keys.length}x)\n` +
                        `Duration: **${label}**\n` +
                        (product.id === 'freemium'
                            ? `Paste key ke loader freemium (tidak perlu redeem Discord).`
                            : `Redeem di panel **${product.name}**.`),
                    files: [makeFile()]
                });
                await interaction.followUp({ content: `✅ File juga di-DM ke ${targetUser.tag}`, ephemeral: true });
            } catch {
                await interaction.followUp({ content: `❌ Gagal DM ${targetUser.tag}`, ephemeral: true });
            }
        }
    },
};
