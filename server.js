require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const db = require('./database');
const bot = require('./bot/bot');

const app = express();
const port = process.env.PORT || 3000;

// Setup Express
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'web', 'views'));
app.use(express.static(path.join(__dirname, 'web', 'public')));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'zuperming-secret-key',
    resave: false,
    saveUninitialized: false
}));

// Setup Routes
const adminRoutes = require('./web/routes/admin');
const apiRoutes = require('./web/routes/api');

app.use('/admin', adminRoutes);
app.use('/api', apiRoutes);

app.get('/', (req, res) => {
    res.redirect('/admin');
});

// Start Server and Bot
app.listen(port, () => {
    console.log(`Web server running on port ${port}`);
    bot.init(); // Initialize Discord bot
});
