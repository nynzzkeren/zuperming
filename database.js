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
            db.run(`CREATE TABLE IF NOT EXISTS keys (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key_string TEXT UNIQUE NOT NULL,
                duration TEXT NOT NULL DEFAULT 'lifetime',
                status TEXT DEFAULT 'unused',
                discord_id TEXT,
                product TEXT DEFAULT 'premium',
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
                product TEXT NOT NULL,
                roblox_game_id TEXT NOT NULL,
                name TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(product, roblox_game_id)
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS scripts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product TEXT DEFAULT 'premium',
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

            db.run(`INSERT OR IGNORE INTO stats (id, total_executions, total_resets) VALUES (1, 0, 0)`);

            // Settings / config table (key-value store)
            db.run(`CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            const alterIgnore = () => {};
            db.run(`ALTER TABLE keys ADD COLUMN product TEXT DEFAULT 'premium'`, alterIgnore);
            db.run(`ALTER TABLE keys ADD COLUMN redeemed_at DATETIME`, alterIgnore);
            db.run(`ALTER TABLE keys ADD COLUMN expires_at DATETIME`, alterIgnore);
            db.run(`ALTER TABLE scripts ADD COLUMN product TEXT DEFAULT 'premium'`, alterIgnore);
            db.run(`ALTER TABLE scripts ADD COLUMN game_id TEXT DEFAULT 'default'`, alterIgnore);
            db.run(`ALTER TABLE keys ADD COLUMN bound_hwid TEXT`, alterIgnore);
            db.run(`ALTER TABLE users ADD COLUMN last_executor_warn DATETIME`, alterIgnore);
            db.run(`ALTER TABLE users ADD COLUMN last_executor_name TEXT`, alterIgnore);
            db.run(`ALTER TABLE users ADD COLUMN total_executions INTEGER DEFAULT 0`, alterIgnore);
            db.run(`ALTER TABLE games ADD COLUMN status TEXT DEFAULT 'Working Script'`, alterIgnore);
            db.run(`ALTER TABLE login_logs ADD COLUMN avatar_url TEXT`, alterIgnore);

            db.run(`UPDATE keys SET product = 'premium' WHERE product IS NULL`);
            db.run(`UPDATE keys SET duration = 'lifetime' WHERE duration IS NULL OR TRIM(duration) = ''`);
            db.run(`UPDATE scripts SET product = 'premium' WHERE product IS NULL`);
            db.run(`UPDATE scripts SET game_id = 'default' WHERE game_id IS NULL`);

            const seed = [
                ['premium', '10200395747', 'GAG2'],
                ['premium', '6739698191', 'VD'],
                ['service_provider', '10200395747', 'GAG2'],
                ['service_provider', '6739698191', 'VD'],
                ['freemium', '10200395747', 'GAG2'],
                ['freemium', '6739698191', 'VD']
            ];
            seed.forEach(([product, roblox_game_id, name]) => {
                db.run(
                    `INSERT OR IGNORE INTO games (product, roblox_game_id, name) VALUES (?, ?, ?)`,
                    [product, roblox_game_id, name]
                );
            });
        });
    }
});

module.exports = db;
