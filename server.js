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
