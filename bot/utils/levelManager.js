const {
    ContainerBuilder,
    SectionBuilder,
    MessageFlags
} = require('discord.js');
const db = require('../../database');

// Cooldown to prevent chat spam (60 seconds per user)
const _xpCooldown = new Map();
const COOLDOWN_MS = 60_000;

// Milestone roles configuration
function getMilestoneRoles() {
    return {
        10: process.env.LEVEL_10_ROLE_ID,
        20: process.env.LEVEL_20_ROLE_ID,
        30: process.env.LEVEL_30_ROLE_ID,
        40: process.env.LEVEL_40_ROLE_ID,
        50: process.env.LEVEL_50_ROLE_ID
    };
}

/**
 * Formula for XP required to advance from current level to level + 1.
 * Level 50 is the MAX level.
 */
function getXpNeeded(level) {
    if (level >= 50) return Infinity;
    return 5 * (level * level) + 50 * level + 100;
}

/**
 * Handle incoming message for XP gain and leveling up
 */
async function handleMessageXp(message) {
    if (!message.guild || message.author.bot) return;

    const userId = message.author.id;

    // Cooldown check
    const now = Date.now();
    const lastXp = _xpCooldown.get(userId) || 0;
    if (now - lastXp < COOLDOWN_MS) {
        // Still count total messages even if on XP cooldown
        db.run(
            `UPDATE user_levels SET total_messages = total_messages + 1, last_message_at = CURRENT_TIMESTAMP WHERE discord_id = ?`,
            [userId]
        );
        return;
    }
    _xpCooldown.set(userId, now);

    // Random XP gain between 15 and 25
    const xpGain = Math.floor(Math.random() * 11) + 15;

    db.get(`SELECT * FROM user_levels WHERE discord_id = ?`, [userId], async (err, row) => {
        if (err) {
            console.error('[LevelManager] Database error:', err.message);
            return;
        }

        let currentXp = 0;
        let currentLevel = 0;
        let totalMessages = 1;

        if (!row) {
            currentXp = xpGain;
            currentLevel = 0;
            db.run(
                `INSERT INTO user_levels (discord_id, xp, level, total_messages, last_message_at) VALUES (?, ?, 0, 1, CURRENT_TIMESTAMP)`,
                [userId, currentXp]
            );
        } else {
            currentXp = (row.xp || 0) + xpGain;
            currentLevel = row.level || 0;
            totalMessages = (row.total_messages || 0) + 1;
        }

        // Check for level ups (Max level 50)
        let leveledUp = false;
        let nextLevelXp = getXpNeeded(currentLevel);

        while (currentXp >= nextLevelXp && currentLevel < 50) {
            currentXp -= nextLevelXp;
            currentLevel += 1;
            leveledUp = true;
            nextLevelXp = getXpNeeded(currentLevel);
        }

        if (currentLevel >= 50) {
            currentXp = 0; // Cap at max
        }

        // Save progress to database
        db.run(
            `UPDATE user_levels SET xp = ?, level = ?, total_messages = ?, last_message_at = CURRENT_TIMESTAMP WHERE discord_id = ?`,
            [currentXp, currentLevel, totalMessages, userId]
        );

        if (leveledUp) {
            await sendLevelUpNotification(message, currentLevel);
        }
    });
}

/**
 * Send level up announcement in the designated channel
 */
async function sendLevelUpNotification(message, newLevel) {
    const levelUpChannelId = process.env.LEVELUP_CHANNEL_ID || '1545310667811328031';
    const channel = message.guild.channels.cache.get(levelUpChannelId);
    if (!channel) {
        console.warn(`[LevelManager] Level-up channel ${levelUpChannelId} not found in guild.`);
        return;
    }

    const milestoneRoles = getMilestoneRoles();
    const milestoneRoleId = milestoneRoles[newLevel];
    let milestoneMessage = '';

    // Assign milestone role if unlocked
    if (milestoneRoleId && message.member) {
        try {
            await message.member.roles.add(milestoneRoleId);
            milestoneMessage = `\n\n🌟 **Milestone Role Unlocked!** You have been awarded <@&${milestoneRoleId}> for reaching **Level ${newLevel}**!`;
        } catch (e) {
            console.warn(`[LevelManager] Could not assign milestone role ${milestoneRoleId}:`, e.message);
            milestoneMessage = `\n\n🌟 **Milestone Reached!** You unlocked the **Level ${newLevel}** milestone!`;
        }
    } else if (newLevel >= 50) {
        milestoneMessage = `\n\n👑 **MAX LEVEL ACHIEVED!** You have reached the maximum level cap (Level 50)!`;
    }

    const avatarUrl = message.author.displayAvatarURL({ extension: 'png', size: 256 });

    // Build Component V2 Container (Black Theme)
    const container = new ContainerBuilder().setAccentColor(0x000000);

    const section = new SectionBuilder()
        .addTextDisplayComponents(
            (t) => t.setContent(`## 🎉 Congratulations! Level Up!`),
            (t) => t.setContent(
                `Great job <@${message.author.id}>!\n` +
                `You have advanced to **Level ${newLevel}**!${milestoneMessage}\n\n` +
                `Keep chatting and staying active to unlock higher milestone perks!`
            )
        )
        .setThumbnailAccessory((thumb) =>
            thumb.setURL(avatarUrl).setDescription(message.author.username)
        );

    container.addSectionComponents(section);

    try {
        // Tag user first so they get a notification ping
        await channel.send({
            content: `🎉 Congratulations <@${message.author.id}> on reaching Level **${newLevel}**!`
        });

        // Send Component V2 container (without content to prevent API conflict)
        await channel.send({
            components: [container],
            flags: MessageFlags.IsComponentsV2
        });
    } catch (err) {
        console.error('[LevelManager] Failed to send level up announcement:', err);
    }
}

/**
 * Get user rank and level stats
 */
async function getUserLevelData(userId) {
    return new Promise((resolve) => {
        db.get(`SELECT * FROM user_levels WHERE discord_id = ?`, [userId], (err, row) => {
            if (err || !row) {
                return resolve({
                    level: 0,
                    xp: 0,
                    neededXp: getXpNeeded(0),
                    totalMessages: 0,
                    rank: 1
                });
            }

            const currentLevel = row.level || 0;
            const neededXp = getXpNeeded(currentLevel);

            // Compute leaderboard rank
            db.get(
                `SELECT COUNT(*) as rank FROM user_levels WHERE (level > ?) OR (level = ? AND xp > ?)`,
                [currentLevel, currentLevel, row.xp || 0],
                (rErr, rankRow) => {
                    const rank = (rankRow?.rank || 0) + 1;
                    resolve({
                        level: currentLevel,
                        xp: row.xp || 0,
                        neededXp,
                        totalMessages: row.total_messages || 0,
                        rank
                    });
                }
            );
        });
    });
}

module.exports = {
    handleMessageXp,
    getUserLevelData,
    getXpNeeded,
    getMilestoneRoles
};
