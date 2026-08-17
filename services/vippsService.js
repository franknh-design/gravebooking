// services/vippsService.js - Vipps eCom API (med mock-modus)
//
// ⚠️ VIKTIG FØR PRODUKSJON: denne tjenesten snakker med eCom API v2, som er
// legacy hos Vipps MobilePay. Nye salgsenheter skal bruke ePayment API
// (/epayment/v1/payments). Se "Gjenstår" i README.md. Headere, idempotens og
// beløpsformat under er satt opp etter Vipps' API-krav slik at migreringen blir
// mindre, men selve endepunktene og statusmodellen må skrives om.
//
// Det finnes fortsatt ingen capture/cancel her - reservasjonen må håndteres
// manuelt i Vipps-portalen inntil ePayment-migreringen er gjort.

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const config = require('../config/config');
const pkg = require('../package.json');
const { tolkNorskMobil } = require('./telefon');

// Vipps krever at integrasjonen identifiserer seg i alle kall, slik at
// supporten deres kan spore problemer tilbake til riktig system.
const SYSTEM_HEADERE = {
    'Vipps-System-Name': 'nvnord',
    'Vipps-System-Version': pkg.version,
    'Vipps-System-Plugin-Name': 'nvnord-booking',
    'Vipps-System-Plugin-Version': pkg.version
};

function erMock() {
    if (process.env.VIPPS_MOCK === 'true') return true;
    if (process.env.VIPPS_MOCK === 'false') return false;
    return process.env.MOCK_MODE === 'true';
}

let cachedToken = null;
let tokenExpiry = 0;

/** Felles headere for alle autentiserte Vipps-kall. */
function apiHeadere(token, ekstra = {}) {
    return {
        'Authorization': `Bearer ${token}`,
        'Ocp-Apim-Subscription-Key': config.vipps.subscriptionKey,
        'Merchant-Serial-Number': config.vipps.merchantSerialNumber,
        'X-Request-Id': uuidv4(),
        ...SYSTEM_HEADERE,
        ...ekstra
    };
}

async function getAccessToken() {
    if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

    const response = await axios.post(
        `${config.vipps.baseUrl}/accesstoken/get`,
        {},
        {
            headers: {
                'client_id': config.vipps.clientId,
                'client_secret': config.vipps.clientSecret,
                'Ocp-Apim-Subscription-Key': config.vipps.subscriptionKey,
                'Merchant-Serial-Number': config.vipps.merchantSerialNumber,
                ...SYSTEM_HEADERE
            }
        }
    );

    cachedToken = response.data.access_token;
    tokenExpiry = Date.now() + (response.data.expires_in * 1000) - 60000;
    return cachedToken;
}

async function initierBetaling({ ordreId, beloep, telefon, beskrivelse }) {
    if (erMock()) {
        console.log(`[MOCK Vipps] Betaling initiert for ${ordreId}: ${beloep} kr`);
        // Returner en URL som peker til vår egen mock-side
        return {
            orderId: ordreId,
            url: `/mock/vipps-betaling.html?ordre=${ordreId}&beloep=${beloep}`
        };
    }

    const mobil = tolkNorskMobil(telefon);
    if (!mobil.gyldig) {
        throw new Error(`Ugyldig mobilnummer for Vipps: "${telefon}"`);
    }

    // Vipps vil ha beløpet i øre som heltall - prisberegningen kan gi desimaler
    const oere = Math.round(Number(beloep) * 100);
    if (!Number.isInteger(oere) || oere <= 0) {
        throw new Error(`Ugyldig beløp for Vipps: "${beloep}"`);
    }

    const token = await getAccessToken();
    const payload = {
        merchantInfo: {
            merchantSerialNumber: config.vipps.merchantSerialNumber,
            callbackPrefix: config.vipps.callbackPrefix,
            fallBack: `${config.vipps.fallbackUrl}?retur=${encodeURIComponent(ordreId)}`
        },
        customerInfo: { mobileNumber: mobil.nasjonalt },
        transaction: {
            orderId: ordreId,
            amount: oere,
            // transactionText har maks 100 tegn hos Vipps
            transactionText: String(beskrivelse || '').slice(0, 100),
            timeStamp: new Date().toISOString()
        }
    };

    // Callbacken fra Vipps er offentlig tilgjengelig. Vi sender med et hemmelig
    // token som Vipps returnerer i Authorization-headeren, slik at vi kan
    // avvise kall som ikke kommer fra Vipps.
    if (config.vipps.callbackAuthToken) {
        payload.merchantInfo.authToken = config.vipps.callbackAuthToken;
    }

    const response = await axios.post(
        `${config.vipps.baseUrl}/ecomm/v2/payments`,
        payload,
        {
            // Idempotency-Key hindrer dobbel betaling hvis kallet må gjentas
            headers: apiHeadere(token, {
                'Content-Type': 'application/json',
                'Idempotency-Key': ordreId
            })
        }
    );

    return response.data;
}

async function sjekkBetalingsStatus(ordreId) {
    if (erMock()) {
        console.log(`[MOCK Vipps] Sjekker status for ${ordreId} - returnerer "betalt"`);
        return {
            transactionLogHistory: [
                { operation: 'RESERVE', operationSuccess: true, transactionId: `MOCK-${Date.now()}` }
            ]
        };
    }

    const token = await getAccessToken();
    const response = await axios.get(
        `${config.vipps.baseUrl}/ecomm/v2/payments/${ordreId}/details`,
        { headers: apiHeadere(token) }
    );
    return response.data;
}

module.exports = { initierBetaling, sjekkBetalingsStatus, erMock };
