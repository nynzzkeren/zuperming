const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'data', 'database.sqlite');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');

        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS keys (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key_string TEXT UNIQUE NOT NULL,
                duration TEXT NOT NULL,
                status TEXT DEFAULT 'unused',
                discord_id TEXT,
                product TEXT DEFAULT 'premium',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS users (
                discord_id TEXT PRIMARY KEY,
                hwid TEXT,
                last_reset DATETIME,
                role_claimed BOOLEAN DEFAULT 0,
                is_blacklisted BOOLEAN DEFAULT 0
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS scripts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product TEXT DEFAULT 'premium',
                raw_script TEXT NOT NULL,
                obfuscated_script TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS stats (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                total_executions INTEGER DEFAULT 0,
                total_resets INTEGER DEFAULT 0
            )`);

            db.run(`INSERT OR IGNORE INTO stats (id, total_executions, total_resets) VALUES (1, 0, 0)`);

            // Migrate existing DBs that were created before product column
            db.run(`ALTER TABLE keys ADD COLUMN product TEXT DEFAULT 'premium'`, () => {});
            db.run(`ALTER TABLE scripts ADD COLUMN product TEXT DEFAULT 'premium'`, () => {});
            db.run(`UPDATE keys SET product = 'premium' WHERE product IS NULL`);
            db.run(`UPDATE scripts SET product = 'premium' WHERE product IS NULL`);
        });
    }
});

module.exports = db;
