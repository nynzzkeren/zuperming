require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
// const helmet = require('helmet');
// const rateLimit = require('express-rate-limit');
const db = require('./database');
const bot = require('./bot/bot');

const app = express();
const port = process.env.PORT || 3000;

// Setup Express
// app.use(helmet({ contentSecurityPolicy: false })); // disable CSP for dashboard simplicity, but keep other protections

// Dashboard global limit
// const limiter = rateLimit({ ... });
// app.use('/admin', limiter);

// Stricter API limit
// const apiLimiter = rateLimit({ ... });
// app.use('/api', apiLimiter);
// app.use('/loader', apiLimiter);

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
const freemiumRoutes = require('./web/routes/freemium');

app.use('/admin', adminRoutes);
app.use('/api', apiRoutes);
app.use('/api/freemium', freemiumRoutes);

// Public loadstring endpoints (clean URLs for executors)
// https://zuperming.store/loader
// https://zuperming.store/loader/sp
app.get('/loader', (req, res) => apiRoutes.serveLoader(req, res, 'premium'));
app.get('/loader/sp', (req, res) => apiRoutes.serveLoader(req, res, 'service_provider'));
app.get('/loader/free', (req, res) => apiRoutes.serveLoader(req, res, 'freemium'));

// Freemium get-key page
app.get('/get-key', (req, res) => {
    res.render('get-key', { baseUrl: require('./config/products').getBaseUrl() });
});

// Root = web dashboard
app.get('/', (req, res) => {
    res.redirect('/admin');
});

// Start Server and Bot
app.listen(port, () => {
    console.log(`Web server running on port ${port}`);
    bot.init(); // Initialize Discord bot
});
