// server.js - Hovedserver
require('dotenv').config(); // Last miljøvariabler fra .env-fil først

const express = require('express');
const path = require('path');
const fs = require('fs');
const bookingRoutes = require('./routes/booking');
const adminRoutes = require('./routes/admin');
const inspeksjonRoutes = require('./routes/inspeksjon');
const infoRoutes = require('./routes/info');
const { initDatabase } = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Sørg for at upload-katalog finnes
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

app.use(express.json({ limit: '1mb' }));

// Vedlikehold-middleware: vis vedlikeholdsside for vanlige besøkende
app.use(async (req, res, next) => {
    // Admin, API og statiske filer er alltid tilgjengelig
    if (req.path.startsWith('/api/') || 
        req.path.startsWith('/mock/') ||
        req.path === '/admin.html' ||
        req.path.startsWith('/img/') ||
        req.path.endsWith('.css') ||
        req.path.endsWith('.js') ||
        req.path.endsWith('.png') ||
        req.path.endsWith('.jpg')) {
        return next();
    }

    try {
        const { getDb } = require('./db/database');
        const db = getDb();
        const innst = await db.get(`SELECT verdi FROM innstillinger WHERE nokkel = 'vedlikehold_aktiv'`);
        
        if (innst && innst.verdi === '1') {
            const melding = await db.get(`SELECT verdi FROM innstillinger WHERE nokkel = 'vedlikehold_melding'`);
            return res.send(`<!DOCTYPE html>
<html lang="no">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Midlertidig nede – Norvetuva Nord AS</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: #f5f5f3; 
            display: flex; align-items: center; justify-content: center;
            min-height: 100vh; padding: 20px;
        }
        .kort {
            background: white; border-radius: 16px;
            padding: 48px 40px; max-width: 480px; width: 100%;
            text-align: center;
            box-shadow: 0 4px 24px rgba(0,0,0,0.08);
        }
        .ikon { font-size: 3rem; margin-bottom: 20px; }
        h1 { font-size: 1.4rem; font-weight: 600; margin-bottom: 12px; color: #1a1a1a; }
        p { color: #666; line-height: 1.6; margin-bottom: 24px; font-size: 1rem; }
        .kontakt { font-size: 0.9rem; color: #999; }
        .kontakt a { color: #ff5b24; text-decoration: none; }
    </style>
</head>
<body>
    <div class="kort">
        <div class="ikon">🔧</div>
        <h1>Midlertidig utilgjengelig</h1>
        <p>${melding ? melding.verdi : 'Vi er snart tilbake!'}</p>
        <div class="kontakt">
            Spørsmål? Ring <a href="tel:+4791649192">+47 91 64 91 92</a>
        </div>
    </div>
</body>
</html>`);
        }
    } catch (e) { /* Hvis database ikke er klar ennå, vis siden normalt */ }

    next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/booking', bookingRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/inspeksjon', inspeksjonRoutes);
app.use('/api/info', infoRoutes);

// Mock-API kun aktivt når MOCK_MODE=true
if (process.env.MOCK_MODE === 'true') {
    const mockRoutes = require('./routes/mock');
    app.use('/api/mock', mockRoutes);
    console.log('🧪 MOCK_MODE aktivert - Vipps, iglohome og SMS er simulert');
    console.log('   Gå til http://localhost:' + PORT + '/mock/debug.html for testing');
}

// Initialiser database og start server
initDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`Bookingserver kjører på port ${PORT}`);
    });
});
