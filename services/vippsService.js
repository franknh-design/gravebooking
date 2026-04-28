// services/vippsService.js - Vipps eCom API (med mock-modus)
const axios = require('axios');
const config = require('../config/config');

function erMock() { return process.env.MOCK_MODE === 'true'; }

let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
    if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

    const response = await axios.post(
        `${config.vipps.baseUrl}/accesstoken/get`,
        {},
        {
            headers: {
                'client_id': config.vipps.clientId,
                'client_secret': config.vipps.clientSecret,
                'Ocp-Apim-Subscription-Key': config.vipps.subscriptionKey
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

    const token = await getAccessToken();
    const payload = {
        merchantInfo: {
            merchantSerialNumber: config.vipps.merchantSerialNumber,
            callbackPrefix: config.vipps.callbackPrefix,
            fallBack: `${config.vipps.callbackPrefix}/fallback/${ordreId}`
        },
        customerInfo: { mobileNumber: telefon },
        transaction: {
            orderId: ordreId,
            amount: beloep * 100,
            transactionText: beskrivelse,
            timeStamp: new Date().toISOString()
        }
    };

    const response = await axios.post(
        `${config.vipps.baseUrl}/ecomm/v2/payments`,
        payload,
        {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Ocp-Apim-Subscription-Key': config.vipps.subscriptionKey,
                'Content-Type': 'application/json'
            }
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
        {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Ocp-Apim-Subscription-Key': config.vipps.subscriptionKey,
                'merchant-serial-number': config.vipps.merchantSerialNumber
            }
        }
    );
    return response.data;
}

module.exports = { initierBetaling, sjekkBetalingsStatus };
