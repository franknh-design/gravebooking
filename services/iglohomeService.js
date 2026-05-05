// services/iglohomeService.js - Genererer tidsbegrensede koder via iglooaccess API
const axios = require('axios');
const config = require('../config/config');
const https = require('https');

const AUTH_URL = 'https://auth.igloohome.co/oauth2/token';
const API_BASE = 'https://api.igloodeveloper.co/igloohome';
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

function erMock() {
    if (process.env.IGLOHOME_MOCK !== undefined) {
        return process.env.IGLOHOME_MOCK === 'true';
    }
    return process.env.MOCK_MODE === 'true';
}

let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
    if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
    try {
        const { data } = await axios.post(
            AUTH_URL,
            new URLSearchParams({
                grant_type: 'client_credentials',
                client_id: config.iglohome.clientId,
                client_secret: config.iglohome.clientSecret,
                scope: 'igloohomeapi/algopin-hourly igloohomeapi/algopin-daily igloohomeapi/algopin-permanent igloohomeapi/get-devices'
            }),
            { httpsAgent, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
        cachedToken = data.access_token;
        tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000;
        console.log('[iglohome] Token hentet OK');
        return cachedToken;
    } catch (e) {
        const detalj = e.response?.data || e.message;
        console.error('[iglohome] Token-feil:', JSON.stringify(detalj));
        throw new Error('igloohome token-feil: ' + JSON.stringify(detalj));
    }
}

function iglooDato(dato) {
    const d = new Date(dato);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:00:00+00:00`;
}

async function hentEnheter() {
    const token = await getAccessToken();
    const alle = [];
    let cursor = '';
    do {
        const url = `${API_BASE}/devices${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`;
        const { data } = await axios.get(url, {
            httpsAgent,
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
        });
        alle.push(...(data.payload || []));
        cursor = data.nextCursor || '';
    } while (cursor);
    return alle;
}

async function genererLeiekode({ startDato, sluttDato, ordreId }) {
    const nå = new Date();
    const startTid = new Date(startDato);

    // Hvis startdato er i dag - bruk inneværende time (kode gyldig fra nå)
    // Hvis fremtidig dato - start fra midnatt UTC
    if (startTid.toDateString() === nå.toDateString()) {
        startTid.setUTCHours(nå.getUTCHours(), 0, 0, 0);
    } else {
        startTid.setUTCHours(0, 0, 0, 0);
    }

    const sluttTid = new Date(sluttDato);
    sluttTid.setUTCHours(22, 0, 0, 0);

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

    try {
        const { data } = await axios.post(
            `${API_BASE}/devices/${config.iglohome.deviceId}/algopin/hourly`,
            {
                variance: 1,
                startDate: iglooDato(startTid),
                endDate: iglooDato(sluttTid),
                accessName: `Leie-${ordreId}`
            },
            {
                httpsAgent,
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    Accept: 'application/json'
                }
            }
        );
        return {
            kode: data.pin,
            kodeId: data.pinId,
            gyldigFra: startTid.toISOString(),
            gyldigTil: sluttTid.toISOString()
        };
    } catch (e) {
        const detalj = e.response?.data || e.message;
        console.error('[iglohome] algoPIN-feil:', JSON.stringify(detalj));
        throw new Error('igloohome algoPIN-feil: ' + JSON.stringify(detalj));
    }
}

async function deaktiverKode(kodeId) {
    if (erMock()) {
        console.log(`[MOCK iglohome] Deaktiverer kode ${kodeId}`);
        return true;
    }
    const token = await getAccessToken();
    try {
        await axios.delete(
            `${API_BASE}/devices/${config.iglohome.deviceId}/algopin/${kodeId}`,
            {
                httpsAgent,
                headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
            }
        );
        console.log(`[iglohome] Kode ${kodeId} deaktivert`);
        return true;
    } catch (e) {
        const detalj = e.response?.data || e.message;
        console.error('[iglohome] Deaktiver-feil:', JSON.stringify(detalj));
        throw new Error('igloohome deaktiver-feil: ' + JSON.stringify(detalj));
    }
}

module.exports = { genererLeiekode, deaktiverKode, hentEnheter, getAccessToken };
