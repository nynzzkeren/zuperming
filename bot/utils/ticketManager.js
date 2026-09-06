const path = require('path');
const fs = require('fs');
const {
    ChannelType,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    MessageFlags,
    AttachmentBuilder,
    EmbedBuilder
} = require('discord.js');
const db = require('../../database');
const { computeExpiresAt } = require('../../utils/keys');
const { getBaseUrl, PRODUCTS } = require('../../config/products');

const PLANS = {
    monthly: {
        id: 'monthly',
        label: '1 Month Premium',
        price: 35000,
        durationDays: 30,
        planSuffix: 'PREM',
        duration: '30d'
    },
    lifetime: {
        id: 'lifetime',
        label: 'Lifetime Premium',
        price: 55000,
        durationDays: null,
        planSuffix: 'LTM',
        duration: 'lifetime'
    }
};

function generateKeyString(prefix) {
    const rand = () => Math.random().toString(36).substring(2, 7).toUpperCase();
    return `${prefix}-${rand()}-${rand()}-${rand()}`;
}

function isStaff(member) {
    if (!member) return false;
    if (member.permissions && member.permissions.has(PermissionFlagsBits.Administrator)) {
        return true;
    }
    const staffRoleIds = (process.env.STAFF_ROLE_IDS || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

    if (staffRoleIds.length === 0) return false;
    return member.roles.cache.some(r => staffRoleIds.includes(r.id));
}

async function getTicketByChannel(channelId) {
    return new Promise(resolve => {
        db.get(`SELECT * FROM tickets WHERE channel_id = ?`, [channelId], (err, row) => resolve(row));
    });
}

async function getTicketById(ticketId) {
    return new Promise(resolve => {
        db.get(`SELECT * FROM tickets WHERE id = ?`, [ticketId], (err, row) => resolve(row));
    });
}

/**
 * Creates a dedicated purchase ticket channel
 */
async function createTicketChannel(guild, user, planKey) {
    const plan = PLANS[planKey];
    if (!plan) throw new Error('Invalid plan selected');

    // Check if user already has an open ticket
    const existing = await new Promise(resolve => {
        db.get(
            `SELECT * FROM tickets WHERE discord_id = ? AND status != 'closed' ORDER BY id DESC LIMIT 1`,
            [user.id],
            (err, row) => resolve(row)
        );
    });

    if (existing) {
        const existingChannel = guild.channels.cache.get(existing.channel_id);
        if (existingChannel) {
            return { exists: true, channel: existingChannel };
        }
    }

    // Permission Overwrites
    const permissionOverwrites = [
        {
            id: guild.id, // @everyone
            deny: [PermissionFlagsBits.ViewChannel]
        },
        {
            id: user.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.EmbedLinks
            ]
        },
        {
            id: guild.client.user.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.EmbedLinks
            ]
        }
    ];

    // Add Staff roles if configured
    const staffRoleIds = (process.env.STAFF_ROLE_IDS || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

    for (const rId of staffRoleIds) {
        permissionOverwrites.push({
            id: rId,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.ReadMessageHistory
            ]
        });
    }

    const cleanUsername = user.username.toLowerCase().replace(/[^a-z0-9]/g, '');
    const planTag = planKey === 'monthly' ? '1m' : 'ltm';
    const channelName = `ticket-${planTag}-${cleanUsername}`;

    const channelOptions = {
        name: channelName,
        type: ChannelType.GuildText,
        permissionOverwrites
    };

    if (process.env.TICKET_CATEGORY_ID) {
        const cat = guild.channels.cache.get(process.env.TICKET_CATEGORY_ID);
        if (cat && cat.type === ChannelType.GuildCategory) {
            channelOptions.parent = process.env.TICKET_CATEGORY_ID;
        }
    }

    const channel = await guild.channels.create(channelOptions);

    // Save ticket to DB
    const ticketId = await new Promise(resolve => {
        db.run(
            `INSERT INTO tickets (channel_id, discord_id, plan, status) VALUES (?, ?, ?, 'open')`,
            [channel.id, user.id, planKey],
            function (err) {
                resolve(this ? this.lastID : null);
            }
        );
    });

    // ── Build Component V2 Welcome Container (Black Theme) ──
    const container = new ContainerBuilder().setAccentColor(0x000000);

    container.addTextDisplayComponents(
        (t) => t.setContent(`## Welcome to Zuperming Purchase Ticket`),
        (t) => t.setContent(
            `Hello <@${user.id}>! Welcome to your official purchase ticket for **${plan.label}**.\n\n` +
            `### Order Summary:\n` +
            `• **Product:** Zuperming Premium\n` +
            `• **Plan:** ${plan.label}\n` +
            `• **Price:** Rp${plan.price.toLocaleString('id-ID')}\n` +
            `• **Duration:** ${plan.durationDays ? `${plan.durationDays} Days` : 'Lifetime (Permanent)'}\n` +
            `• **Customer:** <@${user.id}>\n\n` +
            `### Payment Instructions:\n` +
            `1. Click **Open QRIS** below to view the official QRIS payment barcode.\n` +
            `2. Scan the QR code using DANA, GoPay, OVO, ShopeePay, or Mobile Banking.\n` +
            `3. After completing the payment, click **Done Payment** and upload your transfer screenshot / receipt.\n` +
            `4. Staff will verify your transaction with **Check Payment** and your license key will be issued immediately!`
        )
    );

    // 3 Buttons: Open QRIS, Close Ticket, Check Payment
    const openQrisBtn = new ButtonBuilder()
        .setCustomId('btn_ticket_open_qris')
        .setLabel('Open QRIS')
        .setStyle(ButtonStyle.Primary);

    const closeTicketBtn = new ButtonBuilder()
        .setCustomId('btn_ticket_close')
        .setLabel('Close Ticket')
        .setStyle(ButtonStyle.Danger);

    const checkPaymentBtn = new ButtonBuilder()
        .setCustomId('btn_ticket_check')
        .setLabel('Check Payment')
        .setStyle(ButtonStyle.Secondary);

    const actionRow = new ActionRowBuilder().addComponents(openQrisBtn, closeTicketBtn, checkPaymentBtn);
    container.addActionRowComponents(actionRow);

    // 1. Tag user creator first so they get Discord notification
    await channel.send({
        content: `👋 <@${user.id}> Welcome to your purchase ticket!`
    });

    // 2. Send Component V2 container without content field (avoids Discord API conflict)
    await channel.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2
    });

    return { exists: false, channel, ticketId };
}

/**
 * Handle "Open QRIS" button
 */
async function handleOpenQris(interaction) {
    const ticket = await getTicketByChannel(interaction.channelId);
    if (!ticket) {
        return interaction.reply({
            content: 'This channel is not an active purchase ticket.',
            flags: MessageFlags.Ephemeral
        });
    }

    const plan = PLANS[ticket.plan] || PLANS.monthly;
    const qrisPath = path.resolve(__dirname, '../../assets/qris.png');

    if (!fs.existsSync(qrisPath)) {
        return interaction.reply({
            content: 'QRIS image not found on the server. Please notify staff.',
            flags: MessageFlags.Ephemeral
        });
    }

    const attachment = new AttachmentBuilder(qrisPath, { name: 'qris.png' });

    const embed = new EmbedBuilder()
        .setColor(0x000000)
        .setTitle('💳 Official QRIS Payment')
        .setDescription(
            `**Store Name:** Nynzz. Store\n` +
            `**NMID:** ID1026483288308\n` +
            `**Package:** ${plan.label}\n` +
            `**Total Amount:** Rp${plan.price.toLocaleString('id-ID')}\n` +
            `**Accepted Providers:** DANA, GoPay, OVO, ShopeePay, BCA, Livin Mandiri, and all QRIS apps.\n\n` +
            `*Scan the QR code below using your banking or e-wallet application:*`
        )
        .setImage('attachment://qris.png');

    const donePayBtn = new ButtonBuilder()
        .setCustomId('btn_ticket_done_payment')
        .setLabel('Done Payment')
        .setStyle(ButtonStyle.Success);

    const row = new ActionRowBuilder().addComponents(donePayBtn);

    return interaction.reply({
        embeds: [embed],
        files: [attachment],
        components: [row]
    });
}

/**
 * Handle "Done Payment" button
 */
async function handleDonePayment(interaction) {
    const ticket = await getTicketByChannel(interaction.channelId);
    if (!ticket) {
        return interaction.reply({
            content: 'This channel is not an active purchase ticket.',
            flags: MessageFlags.Ephemeral
        });
    }

    // Update status in DB
    await new Promise(resolve => {
        db.run(
            `UPDATE tickets SET status = 'proof_pending' WHERE id = ?`,
            [ticket.id],
            resolve
        );
    });

    const container = new ContainerBuilder().setAccentColor(0x000000);
    container.addTextDisplayComponents(
        (t) => t.setContent(`## Payment Confirmation Submitted`),
        (t) => t.setContent(
            `Thank you, <@${interaction.user.id}>!\n\n` +
            `**Next Step:** Please **upload / attach your transfer screenshot or receipt image** right here in this channel.\n\n` +
            `Once uploaded, our staff will review your proof and click **Check Payment** to approve your purchase and deliver your license key!`
        )
    );

    // Notify staff
    const staffRoleIds = (process.env.STAFF_ROLE_IDS || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

    const staffPing = staffRoleIds.length > 0 ? staffRoleIds.map(id => `<@&${id}>`).join(' ') : 'Staff';

    await interaction.channel.send({
        content: `🔔 ${staffPing} — <@${interaction.user.id}> has marked payment as completed. Please inspect proof!`
    });

    await interaction.channel.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2
    });

    return interaction.reply({
        content: 'Payment marked as done! Please upload your payment receipt image.',
        flags: MessageFlags.Ephemeral
    });
}

/**
 * Handle "Check Payment" button
 */
async function handleCheckPayment(interaction) {
    const ticket = await getTicketByChannel(interaction.channelId);
    if (!ticket) {
        return interaction.reply({
            content: 'This channel is not an active purchase ticket.',
            flags: MessageFlags.Ephemeral
        });
    }

    const plan = PLANS[ticket.plan] || PLANS.monthly;
    const staffUser = isStaff(interaction.member);

    // If STAFF clicks Check Payment
    if (staffUser) {
        const container = new ContainerBuilder().setAccentColor(0x000000);

        if (ticket.status === 'paid') {
            container.addTextDisplayComponents(
                (t) => t.setContent(`## Staff Payment Verification`),
                (t) => t.setContent(
                    `✅ **This ticket is already marked as PAID.**\n\n` +
                    `• **Customer:** <@${ticket.discord_id}>\n` +
                    `• **Plan:** ${plan.label}\n` +
                    `• **Issued Key:** \`${ticket.key_string || 'N/A'}\``
                )
            );
            return interaction.reply({
                components: [container],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
        }

        container.addTextDisplayComponents(
            (t) => t.setContent(`## Staff Payment Verification`),
            (t) => t.setContent(
                `Reviewing payment for this ticket:\n\n` +
                `• **Customer:** <@${ticket.discord_id}>\n` +
                `• **Plan:** ${plan.label} (Rp${plan.price.toLocaleString('id-ID')})\n` +
                `• **Current Status:** \`${ticket.status}\`\n` +
                `• **Proof URL:** ${ticket.proof_url ? ticket.proof_url : 'Uploaded in channel messages above'}\n\n` +
                `Click **Approve & Issue Key** to generate the license key, assign the buyer role, and deliver it automatically.`
            )
        );

        const approveBtn = new ButtonBuilder()
            .setCustomId(`btn_ticket_approve_${ticket.id}`)
            .setLabel('Approve & Issue Key')
            .setStyle(ButtonStyle.Success);

        const rejectBtn = new ButtonBuilder()
            .setCustomId(`btn_ticket_reject_${ticket.id}`)
            .setLabel('Reject')
            .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder().addComponents(approveBtn, rejectBtn);
        container.addActionRowComponents(row);

        return interaction.reply({
            components: [container],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
    }

    // If MEMBER clicks Check Payment
    if (ticket.status === 'paid') {
        return interaction.reply({
            content: `✅ Your payment has been verified!\nYour license key is: \`${ticket.key_string}\``,
            flags: MessageFlags.Ephemeral
        });
    }

    if (ticket.status === 'proof_pending') {
        return interaction.reply({
            content: `⏳ Your payment confirmation and proof have been submitted and are waiting for staff review. Please wait patiently!`,
            flags: MessageFlags.Ephemeral
        });
    }

    return interaction.reply({
        content: `⚠️ You have not confirmed your payment yet. Please click **Open QRIS**, scan and pay, then click **Done Payment** and upload your receipt screenshot.`,
        flags: MessageFlags.Ephemeral
    });
}

/**
 * Handle "Approve & Issue Key" button
 */
async function handleApprovePayment(interaction, ticketId) {
    if (!isStaff(interaction.member)) {
        return interaction.reply({
            content: '❌ Only staff members can approve payments.',
            flags: MessageFlags.Ephemeral
        });
    }

    const ticket = await getTicketById(ticketId);
    if (!ticket) {
        return interaction.reply({
            content: 'Ticket not found.',
            flags: MessageFlags.Ephemeral
        });
    }

    if (ticket.status === 'paid') {
        return interaction.reply({
            content: `This ticket has already been approved. Key: \`${ticket.key_string}\``,
            flags: MessageFlags.Ephemeral
        });
    }

    const plan = PLANS[ticket.plan] || PLANS.monthly;
    const productConfig = PRODUCTS.premium || {};
    const keyPrefix = productConfig.keyPrefix || 'MIE_PREM';
    const keyString = generateKeyString(keyPrefix);
    const expiresAt = computeExpiresAt(plan.duration);

    // 1. Insert key into DB
    await new Promise(resolve => {
        db.run(
            `INSERT INTO keys (key_string, duration, status, discord_id, product, expires_at, created_at) VALUES (?, ?, 'used', ?, 'premium', ?, CURRENT_TIMESTAMP)`,
            [keyString, plan.duration, ticket.discord_id, expiresAt],
            resolve
        );
    });

    // 2. Update ticket status
    await new Promise(resolve => {
        db.run(
            `UPDATE tickets SET status = 'paid', key_string = ? WHERE id = ?`,
            [keyString, ticket.id],
            resolve
        );
    });

    // 3. Assign buyer role
    const buyerRoleId = process.env.BUYER_ROLE_ID;
    if (buyerRoleId && interaction.guild) {
        const buyerMember = await interaction.guild.members.fetch(ticket.discord_id).catch(() => null);
        if (buyerMember) {
            await buyerMember.roles.add(buyerRoleId).catch(e => {
                console.warn('[Ticket] Could not assign buyer role:', e.message);
            });
        }
    }

    // 4. Find project loader URL
    const project = await new Promise(resolve => {
        db.get(`SELECT uuid FROM projects WHERE is_free = 0 ORDER BY id ASC LIMIT 1`, [], (err, row) => resolve(row));
    });
    const baseUrl = getBaseUrl();
    const loaderUrl = project
        ? `${baseUrl}/scripts/v4/loaders/${project.uuid}.lua`
        : `${baseUrl}/scripts/v4/loaders/LOADER_UUID.lua`;

    const expiryDisplay = expiresAt
        ? `Expires: **${new Date(expiresAt).toLocaleDateString('en-US', { timeZone: 'Asia/Jakarta' })}**`
        : 'Duration: **Lifetime (Permanent)**';

    // 5. Send Celebration container into the ticket channel
    const container = new ContainerBuilder().setAccentColor(0x000000);
    container.addTextDisplayComponents(
        (t) => t.setContent(`## 🎉 Payment Approved & Key Issued!`),
        (t) => t.setContent(
            `Congratulations <@${ticket.discord_id}>! Your payment has been verified by <@${interaction.user.id}>.\n\n` +
            `### Your License Key:\n\`\`\`\n${keyString}\n\`\`\`\n` +
            `${expiryDisplay}\n\n` +
            `### Execution Script (Roblox Executor):\n\`\`\`lua\nscript_key = "${keyString}";\nloadstring(game:HttpGet("${loaderUrl}"))()\n\`\`\`\n` +
            `*Your key and loader script have also been dispatched to your private Discord DMs.*`
        )
    );

    // Send notification ping first, then container
    await interaction.channel.send({
        content: `🎉 <@${ticket.discord_id}> Your purchase has been approved!`
    });

    await interaction.channel.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2
    });

    // 6. DM the buyer
    try {
        const buyerUser = await interaction.client.users.fetch(ticket.discord_id).catch(() => null);
        if (buyerUser) {
            await buyerUser.send([
                `## ✅ Payment Approved!`,
                `Your **${plan.label}** license is now activated.`,
                ``,
                `**License Key:**`,
                `\`\`\``,
                keyString,
                `\`\`\``,
                expiryDisplay,
                ``,
                `**How to use:**`,
                `\`\`\`lua`,
                `script_key = "${keyString}";`,
                `loadstring(game:HttpGet("${loaderUrl}"))()`,
                `\`\`\``,
                `Thank you for supporting Zuperming!`
            ].join('\n'));
        }
    } catch (e) {
        console.warn('[Ticket] Could not DM user:', e.message);
    }

    return interaction.reply({
        content: `✅ Successfully approved payment and issued key \`${keyString}\` to <@${ticket.discord_id}>.`,
        flags: MessageFlags.Ephemeral
    });
}

/**
 * Handle "Reject" button
 */
async function handleRejectPayment(interaction, ticketId) {
    if (!isStaff(interaction.member)) {
        return interaction.reply({
            content: '❌ Only staff members can reject payments.',
            flags: MessageFlags.Ephemeral
        });
    }

    const ticket = await getTicketById(ticketId);
    if (!ticket) {
        return interaction.reply({ content: 'Ticket not found.', flags: MessageFlags.Ephemeral });
    }

    await new Promise(resolve => {
        db.run(`UPDATE tickets SET status = 'open' WHERE id = ?`, [ticket.id], resolve);
    });

    await interaction.channel.send({
        content: `❌ <@${ticket.discord_id}> Your payment verification was rejected by staff. Please ensure valid payment proof was provided or ask for assistance here.`
    });

    return interaction.reply({
        content: 'Payment rejected. Ticket status set back to open.',
        flags: MessageFlags.Ephemeral
    });
}

/**
 * Handle "Close Ticket" button
 */
async function handleCloseTicket(interaction) {
    if (!isStaff(interaction.member)) {
        return interaction.reply({
            content: '❌ Access Denied: Only staff members (Staff to Founder) can close this ticket.',
            flags: MessageFlags.Ephemeral
        });
    }

    const container = new ContainerBuilder().setAccentColor(0x000000);
    container.addTextDisplayComponents(
        (t) => t.setContent(`## Close Ticket Confirmation`),
        (t) => t.setContent(`Are you sure you want to close and permanently delete this ticket channel?`)
    );

    const confirmBtn = new ButtonBuilder()
        .setCustomId('btn_ticket_confirm_close')
        .setLabel('Confirm Close')
        .setStyle(ButtonStyle.Danger);

    const cancelBtn = new ButtonBuilder()
        .setCustomId('btn_ticket_cancel_close')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(confirmBtn, cancelBtn);
    container.addActionRowComponents(row);

    return interaction.reply({
        components: [container],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
    });
}

/**
 * Handle "Confirm Close"
 */
async function handleConfirmClose(interaction) {
    if (!isStaff(interaction.member)) {
        return interaction.reply({
            content: '❌ Access Denied: Only staff members can close this ticket.',
            flags: MessageFlags.Ephemeral
        });
    }

    const channel = interaction.channel;
    await new Promise(resolve => {
        db.run(
            `UPDATE tickets SET status = 'closed', closed_at = CURRENT_TIMESTAMP WHERE channel_id = ?`,
            [channel.id],
            resolve
        );
    });

    await interaction.reply({
        content: '🔒 Ticket will be permanently closed and deleted in 5 seconds...',
        flags: MessageFlags.Ephemeral
    });

    await channel.send({
        content: `🔒 **Ticket closed by ${interaction.user.tag}. Deleting channel in 5 seconds...**`
    }).catch(() => {});

    setTimeout(() => {
        channel.delete().catch(() => {});
    }, 5000);
}

module.exports = {
    PLANS,
    isStaff,
    createTicketChannel,
    handleOpenQris,
    handleDonePayment,
    handleCheckPayment,
    handleApprovePayment,
    handleRejectPayment,
    handleCloseTicket,
    handleConfirmClose
};
