// services/iglohomeService.js - Genererer tidsbegrensede koder via iglooaccess API
const axios = require('axios');
const config = require('../config/config');

function erMock() { return process.env.MOCK_MODE === 'true'; }

let cachedToken = null;
let tokenExpiry = 0;

// Hent OAuth2-token fra iglooaccess
async function getAccessToken() {
    if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

    const httpsAgent = new (require('https').Agent)({ rejectUnauthorized: false });

    // Prøv med client_id/secret i body (ikke Basic Auth)
    try {
        const response = await axios.post(
            'https://auth.igloohome.co/oauth2/token',
            new URLSearchParams({
                grant_type: 'client_credentials',
                client_id: config.iglohome.clientId,
                client_secret: config.iglohome.clientSecret,
                scope: 'igloohomeapi/algopin-hourly igloohomeapi/algopin-daily igloohomeapi/algopin-permanent'
            }),
            {
                httpsAgent,
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            }
        );

        cachedToken = response.data.access_token;
        tokenExpiry = Date.now() + (response.data.expires_in * 1000) - 60000;
        console.log('[iglohome] Token hentet OK');
        return cachedToken;
    } catch (e) {
        // Logg detaljert feil for debugging
        const detalj = e.response?.data || e.message;
        console.error('[iglohome] Token-feil:', JSON.stringify(detalj));
        throw new Error('igloohome token-feil: ' + JSON.stringify(detalj));
    }
}

// Hent liste over enheter på kontoen
async function hentEnheter() {
    const token = await getAccessToken();
    const httpsAgent = new (require('https').Agent)({ rejectUnauthorized: false });
    const headers = { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };

    // Prøv alle kjente endepunkter
    const endepunkter = [
        'https://api.igloohome.co/v1/locks',
        'https://api.igloohome.co/v1/devices',
        'https://api.igloohome.co/v2/locks',
        'https://partnerapi.igloohome.co/v1/locks',
        'https://api.igloohome.co/igloohome/devices/v1',
    ];

    for (const url of endepunkter) {
        try {
            console.log(`[iglohome] Prøver ${url}`);
            const response = await axios.get(url, { httpsAgent, headers });
            console.log(`[iglohome] Suksess på ${url}:`, JSON.stringify(response.data).slice(0, 200));
            return { url, data: response.data };
        } catch (e) {
            const status = e.response?.status;
            const detalj = e.response?.data || e.message;
            console.log(`[iglohome] ${url} → ${status}: ${JSON.stringify(detalj).slice(0, 100)}`);
        }
    }
    throw new Error('Ingen iglohome-endepunkter svarte OK');
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
