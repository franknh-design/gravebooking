// services/iglohomeService.js - Genererer tidsbegrensede koder via iglooaccess API
const axios = require('axios');
const config = require('../config/config');

function erMock() { return process.env.MOCK_MODE === 'true'; }

let cachedToken = null;
let tokenExpiry = 0;

// Hent OAuth2-token fra iglooaccess
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
                username: config.iglohome.clientId,
                password: config.iglohome.clientSecret
            },
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }
    );

    cachedToken = response.data.access_token;
    tokenExpiry = Date.now() + (response.data.expires_in * 1000) - 60000;
    console.log('[iglohome] Token hentet, utløper om', Math.round(response.data.expires_in/60), 'min');
    return cachedToken;
}

// Hent liste over enheter på kontoen
async function hentEnheter() {
    const token = await getAccessToken();
    const response = await axios.get(
        'https://api.igloohome.co/v1/locks',
        { headers: { 'Authorization': `Bearer ${token}` } }
    );
    return response.data;
}

// Generer tidsbegrenset PIN-kode
async function genererLeiekode({ startDato, sluttDato, ordreId }) {
    const startTid = new Date(startDato);
    startTid.setHours(6, 0, 0, 0);
    const sluttTid = new Date(sluttDato);
    sluttTid.setHours(22, 0, 0, 0);

    if (erMock()) {
        const kode = String(Math.floor(100000 + Math.random() * 900000));
        const kodeId = `MOCK-${Date.now()}`;
        console.log(`[MOCK iglohome] Kode ${kode} for ${ordreId} (${startDato} → ${sluttDato})`);
        return { kode, kodeId, gyldigFra: startTid.toISOString(), gyldigTil: sluttTid.toISOString() };
    }

    if (!config.iglohome.clientId || !config.iglohome.clientSecret) {
        throw new Error('iglohome Client ID eller Secret mangler i .env');
    }
    if (!config.iglohome.deviceId) {
        throw new Error('IGLOHOME_DEVICE_ID mangler i .env');
    }

    const token = await getAccessToken();

    const response = await axios.post(
        `https://api.igloohome.co/v1/locks/${config.iglohome.deviceId}/algopin/daily`,
        {
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
        kodeId: response.data.algopinId || response.data.id,
        gyldigFra: startTid.toISOString(),
        gyldigTil: sluttTid.toISOString()
    };
}

module.exports = { genererLeiekode, hentEnheter, getAccessToken };
