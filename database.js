const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const dataDir = path.resolve(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.resolve(dataDir, 'database.sqlite');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');

        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS developers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                discord_id TEXT UNIQUE NOT NULL,
                bot_token TEXT,
                bot_id TEXT,
                status TEXT DEFAULT 'active',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                developer_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                uuid TEXT UNIQUE NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(developer_id) REFERENCES developers(id)
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS keys (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key_string TEXT UNIQUE NOT NULL,
                duration TEXT NOT NULL DEFAULT 'lifetime',
                status TEXT DEFAULT 'unused',
                discord_id TEXT,
                project_id INTEGER,
                redeemed_at DATETIME,
                expires_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS login_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                discord_id TEXT,
                username TEXT,
                avatar_url TEXT,
                role TEXT,
                login_time DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS users (
                discord_id TEXT PRIMARY KEY,
                hwid TEXT,
                last_reset DATETIME,
                role_claimed BOOLEAN DEFAULT 0,
                is_blacklisted BOOLEAN DEFAULT 0,
                last_executor_warn DATETIME,
                last_executor_name TEXT,
                total_executions INTEGER DEFAULT 0,
                total_resets INTEGER DEFAULT 0,
                last_ip TEXT
            )`);

            // Migrations (ignore errors if columns already exist)
            db.run(`ALTER TABLE users ADD COLUMN total_executions INTEGER DEFAULT 0`, () => {});
            db.run(`ALTER TABLE users ADD COLUMN total_resets INTEGER DEFAULT 0`, () => {});
            db.run(`ALTER TABLE users ADD COLUMN last_ip TEXT`, () => {});

            db.run(`CREATE TABLE IF NOT EXISTS games (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER,
                roblox_game_id TEXT NOT NULL,
                name TEXT NOT NULL,
                status TEXT DEFAULT 'Working Script',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(project_id, roblox_game_id)
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS scripts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER,
                game_id TEXT NOT NULL DEFAULT 'default',
                raw_script TEXT NOT NULL,
                obfuscated_script TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS stats (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                total_executions INTEGER DEFAULT 0,
                total_resets INTEGER DEFAULT 0
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS live_sessions (
                hwid TEXT PRIMARY KEY,
                discord_id TEXT,
                game_id TEXT,
                product TEXT,
                last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                game_id TEXT NOT NULL,
                product TEXT NOT NULL,
                message TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS freemium_sessions (
                id TEXT PRIMARY KEY,
                ip_address TEXT,
                status TEXT DEFAULT 'pending',
                generated_key TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS custom_bot_commands (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                developer_id INTEGER NOT NULL,
                command_name TEXT NOT NULL,
                command_description TEXT,
                command_response TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(developer_id) REFERENCES developers(id)
            )`);

            db.run(`INSERT OR IGNORE INTO stats (id, total_executions, total_resets) VALUES (1, 0, 0)`);

            db.run(`CREATE TABLE IF NOT EXISTS panels (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                title TEXT DEFAULT 'Zuperming Premium Panel',
                description TEXT DEFAULT 'Redeem key, get script, role, reset HWID, or view stats.',
                FOREIGN KEY(project_id) REFERENCES projects(id)
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS panel_buttons (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                panel_id INTEGER NOT NULL,
                label TEXT NOT NULL,
                custom_id TEXT,
                url TEXT,
                style INTEGER DEFAULT 1,
                FOREIGN KEY(panel_id) REFERENCES panels(id)
            )`);

            // Settings / config table (key-value store)
            db.run(`CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            const alterIgnore = () => {};
            db.run(`ALTER TABLE keys ADD COLUMN project_id INTEGER`, alterIgnore);
            db.run(`ALTER TABLE scripts ADD COLUMN project_id INTEGER`, alterIgnore);
            db.run(`ALTER TABLE games ADD COLUMN project_id INTEGER`, alterIgnore);
            db.run(`ALTER TABLE keys ADD COLUMN bound_hwid TEXT`, alterIgnore);
            db.run(`ALTER TABLE users ADD COLUMN last_executor_warn DATETIME`, alterIgnore);
            db.run(`ALTER TABLE users ADD COLUMN last_executor_name TEXT`, alterIgnore);
            db.run(`ALTER TABLE users ADD COLUMN total_executions INTEGER DEFAULT 0`, alterIgnore);
            db.run(`ALTER TABLE games ADD COLUMN status TEXT DEFAULT 'Working Script'`, alterIgnore);
            db.run(`ALTER TABLE login_logs ADD COLUMN avatar_url TEXT`, alterIgnore);
            
            // New columns for custom bots & vault
            db.run(`ALTER TABLE developers ADD COLUMN plan_tier TEXT DEFAULT 'none'`, alterIgnore);
            db.run(`ALTER TABLE developers ADD COLUMN custom_features_count INTEGER DEFAULT 0`, alterIgnore);
            db.run(`ALTER TABLE developers ADD COLUMN features_cooldown_until DATETIME`, alterIgnore);
            db.run(`ALTER TABLE developers ADD COLUMN bot_bio TEXT`, alterIgnore);
            db.run(`ALTER TABLE developers ADD COLUMN bot_banner TEXT`, alterIgnore);

            // Dynamic panel / discord settings per project
            db.run(`ALTER TABLE projects ADD COLUMN guild_id TEXT`, alterIgnore);
            db.run(`ALTER TABLE projects ADD COLUMN buyer_role_id TEXT`, alterIgnore);
            db.run(`ALTER TABLE projects ADD COLUMN update_channel_id TEXT`, alterIgnore);
            db.run(`ALTER TABLE projects ADD COLUMN brand_logo_url TEXT`, alterIgnore);
            db.run(`ALTER TABLE projects ADD COLUMN is_free BOOLEAN DEFAULT 0`, alterIgnore);
            db.run(`ALTER TABLE projects ADD COLUMN description TEXT`, alterIgnore);

            // Web authentication columns
            db.run(`ALTER TABLE developers ADD COLUMN email TEXT`, alterIgnore);
            db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_developers_email ON developers(email)`, alterIgnore);
            db.run(`ALTER TABLE developers ADD COLUMN password_hash TEXT`, alterIgnore);
            db.run(`ALTER TABLE developers ADD COLUMN google_id TEXT`, alterIgnore);
            db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_developers_google_id ON developers(google_id)`, alterIgnore);
            db.run(`ALTER TABLE developers ADD COLUMN username TEXT`, alterIgnore);

            // New columns for games (Place ID, version, thumbnail)
            db.run(`ALTER TABLE games ADD COLUMN place_id TEXT`, alterIgnore);
            db.run(`ALTER TABLE games ADD COLUMN script_version TEXT DEFAULT 'v0.0.0.1'`, alterIgnore);
            db.run(`ALTER TABLE games ADD COLUMN thumbnail_url TEXT`, alterIgnore);
            db.run(`UPDATE games SET place_id = roblox_game_id WHERE place_id IS NULL OR place_id = ''`, alterIgnore);

            // Payment orders table (Tripay / QRIS payment tracking)
            db.run(`CREATE TABLE IF NOT EXISTS payment_orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id TEXT UNIQUE NOT NULL,
                discord_id TEXT NOT NULL,
                plan TEXT NOT NULL,
                amount INTEGER NOT NULL,
                status TEXT DEFAULT 'pending',
                key_string TEXT,
                tripay_ref TEXT,
                paid_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            // Purchase Tickets table
            db.run(`CREATE TABLE IF NOT EXISTS tickets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                channel_id TEXT UNIQUE NOT NULL,
                discord_id TEXT NOT NULL,
                plan TEXT NOT NULL,
                status TEXT DEFAULT 'open',
                key_string TEXT,
                proof_url TEXT,
                closed_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`, alterIgnore);

            db.run(`ALTER TABLE keys ADD COLUMN product TEXT DEFAULT 'premium'`, alterIgnore);

            // Ensure default developer and projects exist
            db.run(`INSERT OR IGNORE INTO developers (id, discord_id, username, plan_tier, status) VALUES (1, 'owner_root', 'Owner', 'highest', 'active')`, alterIgnore);
            db.run(`UPDATE developers SET plan_tier = 'highest' WHERE plan_tier = 'none' OR plan_tier IS NULL`, alterIgnore);

            // Seed default projects if not present
            db.get(`SELECT COUNT(*) as count FROM projects`, (err, row) => {
                if (!err && (!row || row.count === 0)) {
                    db.run(`INSERT OR IGNORE INTO projects (id, developer_id, name, uuid, is_free, description) 
                            VALUES (1, 1, 'mie ayam Premium', '373dac54-b41c-4ae6-9819-76a3e60941b8', 0, 'Official Premium Script Hub')`);
                    db.run(`INSERT OR IGNORE INTO projects (id, developer_id, name, uuid, is_free, description) 
                            VALUES (2, 1, 'mie ayam Free', 'f4ee2a10-89bc-4cd8-b3d9-95e219712ab1', 1, 'Official Keyless Free Script Hub')`);
                    console.log('[Database] Seeded default Premium and Free projects.');
                }
            });
        });
    }
});

module.exports = db;
