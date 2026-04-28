// services/smsService.js - SMS-utsendelse (med mock-modus)
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const config = require('../config/config');

function erMock() { return process.env.MOCK_MODE === 'true'; }
const MOCK_LOGG = path.join(__dirname, '..', 'mock-sms-logg.json');

async function lesMockLogg() {
    try {
        const data = await fs.readFile(MOCK_LOGG, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return [];
    }
}

async function lagreMockLogg(meldinger) {
    await fs.writeFile(MOCK_LOGG, JSON.stringify(meldinger, null, 2));
}

async function sendSms({ til, melding }) {
    if (erMock()) {
        const tidspunkt = new Date().toISOString();
        const eintry = { tidspunkt, til, melding };
        
        // Skriv til konsoll med tydelig formatering
        console.log('\n' + '='.repeat(60));
        console.log(`📱 [MOCK SMS] → ${til}`);
        console.log('-'.repeat(60));
        console.log(melding);
        console.log('='.repeat(60) + '\n');
        
        // Lagre til fil for å kunne se i admin
        try {
            const logg = await lesMockLogg();
            logg.unshift(eintry); // Nyeste først
            // Behold maks 100 meldinger
            await lagreMockLogg(logg.slice(0, 100));
        } catch (e) {
            console.error('Kunne ikke skrive SMS-logg:', e.message);
        }
        
        return { ok: true, simulert: true };
    }

    if (process.env.NODE_ENV !== 'production') {
        console.log(`[SMS-konsoll] Til ${til}: ${melding}`);
        return { ok: true, simulert: true };
    }

    try {
        const response = await axios.post(
            'https://wsx.sp247.net/sms/send',
            {
                source: config.sms.avsender,
                destination: til,
                userData: melding
            },
            {
                headers: {
                    'Authorization': `Bearer ${config.sms.apiKey}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        return response.data;
    } catch (error) {
        console.error('SMS-feil:', error.message);
        return { ok: false, feil: error.message };
    }
}

async function hentMockMeldinger() {
    if (!erMock()) return [];
    return await lesMockLogg();
}

async function nullstillMockLogg() {
    if (!erMock()) return;
    await lagreMockLogg([]);
}

module.exports = { sendSms, hentMockMeldinger, nullstillMockLogg };
