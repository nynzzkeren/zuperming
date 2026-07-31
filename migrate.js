const db = require('./database');
db.run("ALTER TABLE users ADD COLUMN is_blacklisted BOOLEAN DEFAULT 0", (err) => {
    if (err) console.error("Migration error (or already migrated):", err.message);
    else console.log("Migration successful.");
    process.exit(0);
});
