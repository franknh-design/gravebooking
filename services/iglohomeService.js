// services/iglohomeService.js - Genererer tidsbegrensede koder (med mock-modus)
const axios = require('axios');
const config = require('../config/config');

function erMock() { return process.env.MOCK_MODE === 'true'; }

let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
    if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

    const response = await axios.post(
        'https://auth.igloohome.co/oauth2/token',
        new URLSearchParams({
            grant_type: 'client_credentials',
            scope: 'igloohomeapi/algopin-hourly igloohomeapi/algopin-daily igloohomeapi/algopin-permanent'
        }),
        {
            auth: {
                username: config.iglohome.apiKey,
                password: config.iglohome.apiSecret
            },
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }
    );

    cachedToken = response.data.access_token;
    tokenExpiry = Date.now() + (response.data.expires_in * 1000) - 60000;
    return cachedToken;
}

async function genererLeiekode({ startDato, sluttDato, ordreId }) {
    const startTid = new Date(startDato);
    startTid.setHours(8, 0, 0, 0);
    const sluttTid = new Date(sluttDato);
    sluttTid.setHours(20, 0, 0, 0);

    if (erMock()) {
        // Generer en realistisk 6-sifret kode
        const kode = String(Math.floor(100000 + Math.random() * 900000));
        const kodeId = `MOCK-${Date.now()}`;
        console.log(`[MOCK iglohome] Generert kode ${kode} for ${ordreId} (gyldig ${startTid.toISOString()} → ${sluttTid.toISOString()})`);
        return {
            kode,
            kodeId,
            gyldigFra: startTid.toISOString(),
            gyldigTil: sluttTid.toISOString()
        };
    }

    const token = await getAccessToken();
    const response = await axios.post(
        `${config.iglohome.baseUrl}/${config.iglohome.deviceId}/algopin/daily`,
        {
            variance: 1,
            startDate: startTid.toISOString(),
            endDate: sluttTid.toISOString(),
            accessName: `Leie-${ordreId}`
        },
        {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        }
    );

    return {
        kode: response.data.pin,
        kodeId: response.data.algopinId,
        gyldigFra: startTid.toISOString(),
        gyldigTil: sluttTid.toISOString()
    };
}

module.exports = { genererLeiekode };
