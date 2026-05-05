// services/smsService.js - SMS-utsendelse via KeySMS
// API-dokumentasjon: https://github.com/ApilityLabs/keysms-sdk
//
// Mock-styring (eksplisitt per integrasjon):
//   SMS_MOCK=true    → simulerer SMS, logger til mock-sms-logg.json
//   SMS_MOCK=false   → sender ekte SMS via KeySMS
//   SMS_MOCK ikke satt → defaulter til mock (fail-safe)
//
// Påkrevde miljøvariabler ved live-modus:
//   KEYSMS_USERNAME  - brukernavn fra app.keysms.no
//   KEYSMS_API_KEY   - API-nøkkel fra app.keysms.no
//   KEYSMS_AVSENDER  - registrert avsendernavn (maks 11 tegn)

const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const config = require('../config/config');

const KEYSMS_ENDPOINT = 'https://app.keysms.no/messages';
const MOCK_LOGG = path.join(__dirname, '..', 'mock-sms-logg.json');
const MAX_LOGG_MELDINGER = 100;

// ---------- Mock-håndtering ----------

function erMock() {
    // Default true (fail-safe): kun eksplisitt 'false' aktiverer live-modus
    return process.env.SMS_MOCK !== 'false';
}

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

async function loggMockMelding(til, melding) {
    const tidspunkt = new Date().toISOString();
    const entry = { tidspunkt, til, melding };

    console.log('\n' + '='.repeat(60));
    console.log(`📱 [MOCK SMS] → ${til}`);
    console.log('-'.repeat(60));
    console.log(melding);
    console.log('='.repeat(60) + '\n');

    try {
        const logg = await lesMockLogg();
        logg.unshift(entry);
        await lagreMockLogg(logg.slice(0, MAX_LOGG_MELDINGER));
    } catch (e) {
        console.error('Kunne ikke skrive SMS-logg:', e.message);
    }
}

// ---------- KeySMS-håndtering ----------

/**
 * Normaliser telefonnummer til format KeySMS forventer.
 * KeySMS godtar både med og uten landskode for norske numre, men vi sender
 * konsekvent med 47-prefiks for å være robust mot internasjonale numre.
 */
function normaliserTelefonnummer(nummer) {
    if (!nummer) return nummer;

    // Fjern alle ikke-sifre
    let renset = String(nummer).replace(/\D/g, '');

    // Hvis det starter med 47 og er 10 sifre totalt, har det allerede landskode
    if (renset.length === 10 && renset.startsWith('47')) {
        return renset;
    }

    // Norsk nummer uten landskode (8 sifre)
    if (renset.length === 8) {
        return '47' + renset;
    }

    // Andre tilfeller: returner som-er, KeySMS validerer videre
    return renset;
}

/**
 * KeySMS-autentisering: signaturen er MD5(payload + apiKey).
 * Payload må være EKSAKT samme JSON-streng som sendes i requesten.
 */
function lagSignatur(payloadJson, apiKey) {
    return crypto.createHash('md5').update(payloadJson + apiKey).digest('hex');
}

async function sendViaKeySMS({ til, melding }) {
    const username = process.env.KEYSMS_USERNAME;
    const apiKey = process.env.KEYSMS_API_KEY;
    const avsender = process.env.KEYSMS_AVSENDER || config.sms.avsender;

    if (!username || !apiKey) {
        // Skal aldri skje hvis startup-validering er på plass, men beskytt likevel
        console.error('[SMS] FEIL: KEYSMS_USERNAME eller KEYSMS_API_KEY mangler');
        return { ok: false, simulert: false, feil: 'Manglende KeySMS-credentials' };
    }

    const tilNormalisert = normaliserTelefonnummer(til);

    const payloadObj = {
        message: melding,
        receivers: [tilNormalisert],
        sender: avsender
    };
    const payloadJson = JSON.stringify(payloadObj);
    const signature = lagSignatur(payloadJson, apiKey);

    // KeySMS tar imot form-encoded data, ikke JSON-body
    const formData = new URLSearchParams();
    formData.append('username', username);
    formData.append('payload', payloadJson);
    formData.append('signature', signature);

    try {
        console.log(`[SMS] Sender til ${tilNormalisert} via KeySMS (avsender: ${avsender})`);
        const response = await axios.post(KEYSMS_ENDPOINT, formData.toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            timeout: 10000  // 10 sek timeout
        });

        // KeySMS svarer alltid HTTP 200 - faktisk status ligger i body.ok
        const data = response.data || {};
        if (data.ok === false) {
            const feilmelding = data.error || 'Ukjent KeySMS-feil';
            console.error(`[SMS] KeySMS avviste melding: ${feilmelding}`);
            return {
                ok: false,
                simulert: false,
                feil: `KeySMS: ${feilmelding}`,
                leverandorRespons: data
            };
        }

        console.log(`[SMS] KeySMS-respons OK:`, response.status, data);
        return {
            ok: true,
            simulert: false,
            leverandorRespons: data
        };
    } catch (error) {
        const status = error.response ? error.response.status : 'ingen';
        const data = error.response ? error.response.data : null;
        const feilmelding = data ? JSON.stringify(data) : error.message;
        console.error(`[SMS] KeySMS-feil (status ${status}):`, feilmelding);
        return {
            ok: false,
            simulert: false,
            feil: `KeySMS feil (${status}): ${feilmelding}`
        };
    }
}

// ---------- Offentlig API ----------

/**
 * Send SMS. Returnerer { ok: bool, simulert: bool, ... }.
 * Kallere bør sjekke `ok`-flagget, men feiler ikke katastrofalt hvis ikke.
 */
async function sendSms({ til, melding }) {
    if (!til || !melding) {
        return { ok: false, feil: 'Mangler til eller melding' };
    }

    if (erMock()) {
        await loggMockMelding(til, melding);
        return { ok: true, simulert: true };
    }

    return await sendViaKeySMS({ til, melding });
}

async function hentMockMeldinger() {
    if (!erMock()) return [];
    return await lesMockLogg();
}

async function nullstillMockLogg() {
    if (!erMock()) return;
    await lagreMockLogg([]);
}

/**
 * Validerer SMS-konfigurasjon ved oppstart. Kalles fra server.js.
 * Returnerer en streng som beskriver tilstanden, eller kaster ved feil.
 */
function validerOppstart() {
    if (erMock()) {
        return '🧪 SMS: MOCK (sender ikke ekte SMS)';
    }

    const username = process.env.KEYSMS_USERNAME;
    const apiKey = process.env.KEYSMS_API_KEY;
    const avsender = process.env.KEYSMS_AVSENDER || config.sms.avsender;

    if (!username || !apiKey) {
        throw new Error(
            'SMS_MOCK=false men KEYSMS_USERNAME eller KEYSMS_API_KEY mangler i .env'
        );
    }

    if (avsender && avsender.length > 11) {
        throw new Error(
            `KEYSMS_AVSENDER er ${avsender.length} tegn (maks 11). Verdi: "${avsender}"`
        );
    }

    return `✅ SMS: LIVE (KeySMS, avsender: ${avsender})`;
}

module.exports = {
    sendSms,
    hentMockMeldinger,
    nullstillMockLogg,
    validerOppstart
};
