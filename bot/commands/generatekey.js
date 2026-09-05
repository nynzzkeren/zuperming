const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
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
        .setName('generatekey')
        .setDescription('Generate new keys in bulk (Admin)')
        .addStringOption(option =>
            option.setName('product')
                .setDescription('Project/Product type')
                .setRequired(true)
                .addChoices(
                    { name: 'Premium', value: 'premium' },
                    { name: 'Freemium', value: 'freemium' }
                ))
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('Number of keys to generate (1-100)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(100))
        .addStringOption(option =>
            option.setName('duration')
                .setDescription('Empty = permanent. Ex: 1d, 7d, 30d')
                .setRequired(false))
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to DM the keys to (Optional)')
                .setRequired(false)),
    async execute(interaction) {
        if (!interaction.member.permissions.has('Administrator')) {
            const errEmbed = new EmbedBuilder().setColor('#FF0000').setDescription('❌ You do not have permission to use this command.');
            return interaction.reply({ embeds: [errEmbed], ephemeral: true });
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
            const errEmbed = new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Database error: ${e.message}`);
            return interaction.editReply({ embeds: [errEmbed] });
        }

        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `luavault-${product.id}-${amount}x-${stamp}.txt`;
        const header = [
            `Lua Vault Key Generator`,
            `Product: ${product.name}`,
            `Duration: ${label}`,
            `Amount: ${keys.length}`,
            `Generated: ${new Date().toISOString()}`,
            `---`,
            ''
        ].join('\n');
        const fileBody = header + keys.join('\n') + '\n';
        const makeFile = () => new AttachmentBuilder(Buffer.from(fileBody, 'utf8'), { name: fileName });

        const embed = new EmbedBuilder()
            .setColor('#0099FF')
            .setTitle('🔑 Keys Generated Successfully')
            .addFields(
                { name: 'Product', value: product.name, inline: true },
                { name: 'Amount', value: `${keys.length} keys`, inline: true },
                { name: 'Duration', value: label, inline: true }
            )
            .setFooter({ text: 'Lua Vault Script Whitelister' })
            .setTimestamp();
            
        if (amount === 1) {
            embed.addFields({ name: 'Key', value: `\`${keys[0]}\``, inline: false });
        } else {
            embed.setDescription('The keys have been attached as a `.txt` file.');
        }

        await interaction.editReply({ embeds: [embed], files: [makeFile()] });

        if (targetUser) {
            try {
                const dmEmbed = new EmbedBuilder()
                    .setColor('#0099FF')
                    .setTitle(`🔑 New ${product.name} Keys`)
                    .setDescription(`You have received **${keys.length}** keys from the admin.\n\nDuration: **${label}**`)
                    .setFooter({ text: 'Lua Vault Script Whitelister' });

                await targetUser.send({ embeds: [dmEmbed], files: [makeFile()] });
                await interaction.followUp({ content: `✅ Key file was successfully sent to ${targetUser.tag}`, ephemeral: true });
            } catch {
                await interaction.followUp({ content: `⚠️ Failed to DM ${targetUser.tag} (their DMs might be closed)`, ephemeral: true });
            }
        }
    },
};
