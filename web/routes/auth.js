const express = require('express');
const router = express.Router();
const db = require('../../database');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

// Utility to generate a temp discord_id for users who haven't linked
const generateTempDiscordId = () => 'temp_' + crypto.randomBytes(8).toString('hex');

router.post('/register', async (req, res) => {
    const { username, email, password } = req.body;
    
    if (!username || !email || !password) {
        return res.redirect('/register?error=All+fields+are+required');
    }

    try {
        const hash = await bcrypt.hash(password, 10);
        const tempDiscordId = generateTempDiscordId();
        
        db.run(
            `INSERT INTO developers (discord_id, email, username, password_hash, plan_tier) VALUES (?, ?, ?, ?, ?)`,
            [tempDiscordId, email, username, hash, 'highest'], // Set to highest plan tier (Owner Access)
            function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE')) {
                        return res.redirect('/register?error=Email+already+in+use');
                    }
                    console.error("Register Error:", err);
                    return res.redirect('/register?error=Internal+server+error');
                }
                
                // Set session
                req.session.loggedIn = true;
                req.session.hasAdminRole = true;
                req.session.discordId = tempDiscordId;
                req.session.username = username;
                req.session.email = email;
                
                res.redirect('/admin');
            }
        );
    } catch (e) {
        console.error("Register Exception:", e);
        res.redirect('/register?error=Registration+failed');
    }
});

router.post('/login', (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.redirect('/login?error=All+fields+are+required');
    }

    db.get(`SELECT * FROM developers WHERE email = ?`, [email], async (err, user) => {
        if (err || !user) {
            return res.redirect('/login?error=Invalid+email+or+password');
        }

        try {
            const match = await bcrypt.compare(password, user.password_hash);
            if (match) {
                // Ensure owner tier
                db.run(`UPDATE developers SET plan_tier = 'highest' WHERE id = ?`, [user.id]);

                req.session.loggedIn = true;
                req.session.hasAdminRole = true;
                req.session.discordId = user.discord_id;
                req.session.username = user.username;
                req.session.email = user.email;
                
                return res.redirect('/admin');
            } else {
                return res.redirect('/login?error=Invalid+email+or+password');
            }
        } catch (e) {
            return res.redirect('/login?error=Login+failed');
        }
    });
});

// Simple mock/placeholder for Google OAuth redirect since we don't have real credentials yet
router.get('/google', (req, res) => {
    // In production, redirect to Google OAuth URL
    res.redirect('/api/auth/google/callback?mock=true');
});

router.get('/google/callback', (req, res) => {
    // Handler for Google OAuth
    const mockEmail = req.query.email || "owner@luavault.io";
    const mockName = req.query.name || "Owner";
    const googleId = "google_owner_" + crypto.randomBytes(4).toString('hex');

    db.get(`SELECT * FROM developers WHERE google_id = ? OR email = ?`, [googleId, mockEmail], (err, user) => {
        if (user) {
            db.run(`UPDATE developers SET plan_tier = 'highest' WHERE id = ?`, [user.id]);
            req.session.loggedIn = true;
            req.session.hasAdminRole = true;
            req.session.discordId = user.discord_id;
            req.session.username = user.username;
            res.redirect('/admin');
        } else {
            const tempDiscordId = generateTempDiscordId();
            db.run(
                `INSERT INTO developers (discord_id, email, username, google_id, plan_tier) VALUES (?, ?, ?, ?, ?)`,
                [tempDiscordId, mockEmail, mockName, googleId, 'highest'],
                function(err) {
                    if (err) return res.redirect('/login?error=Failed+to+link+Google');
                    req.session.loggedIn = true;
                    req.session.hasAdminRole = true;
                    req.session.discordId = tempDiscordId;
                    req.session.username = mockName;
                    res.redirect('/admin');
                }
            );
        }
    });
});

module.exports = router;
