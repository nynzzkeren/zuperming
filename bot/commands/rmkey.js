const { SlashCommandBuilder } = require('discord.js');
const db = require('../../database');
const { getProduct, PRODUCTS, getProductRoleId } = require('../../config/products');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rmkey')
        .setDescription('Remove / unbind key dari user (Admin) — buat batal WL salah')
        .addUserOption(o =>
            o.setName('user').setDescription('User yang mau dihapus key-nya').setRequired(true))
        .addStringOption(o =>
            o.setName('product')
                .setDescription('Panel key mana yang dihapus')
                .setRequired(true)
                .addChoices(
                    { name: 'Premium', value: 'premium' },
                    { name: 'Service Provider', value: 'service_provider' },
                    { name: 'Freemium', value: 'freemium' }
                ))
        .addBooleanOption(o =>
            o.setName('remove_role')
                .setDescription('Cabut role panel juga? (default: ya)')
                .setRequired(false)),
    async execute(interaction) {
        if (!interaction.member.permissions.has('Administrator')) {
            return interaction.reply({ content: 'Admin only.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        const targetUser = interaction.options.getUser('user');
        const product = getProduct(interaction.options.getString('product')) || PRODUCTS.premium;
        const removeRole = interaction.options.getBoolean('remove_role');
        const shouldRemoveRole = removeRole !== false; // default true

        db.get(
            `SELECT * FROM keys WHERE discord_id = ? AND product = ? AND status = 'used'`,
            [targetUser.id, product.id],
            async (err, row) => {
                if (err) return interaction.editReply({ content: 'Database error.' });
                if (!row) {
                    return interaction.editReply({
                        content: `${targetUser.tag} tidak punya key **${product.name}** aktif.`
                    });
                }

                db.serialize(() => {
                    // Hapus key sepenuhnya biar tidak bisa dipakai orang lain
                    db.run(`DELETE FROM keys WHERE id = ?`, [row.id]);
                    db.run(`UPDATE users SET hwid = NULL WHERE discord_id = ?`, [targetUser.id]);

                    (async () => {
                        let roleMsg = '';
                        if (shouldRemoveRole && interaction.guild) {
                            const roleId = getProductRoleId(product);
                            if (roleId) {
                                try {
                                    const member = await interaction.guild.members.fetch(targetUser.id);
                                    if (member.roles.cache.has(roleId)) {
                                        await member.roles.remove(roleId);
                                        roleMsg = `\n✅ Role **${product.name}** dicabut`;
                                    }
                                } catch (e) {
                                    roleMsg = `\n⚠️ Gagal cabut role: ${e.message}`;
                                }
                            }
                        }

                        return interaction.editReply({
                            content:
                                `✅ Key **${product.name}** dihapus dari **${targetUser.tag}**\n` +
                                `Key lama: \`${row.key_string}\`\n` +
                                `HWID di-reset.` +
                                roleMsg
                        });
                    })();
                });
            }
        );
    },
};
