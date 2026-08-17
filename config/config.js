// config/config.js - Sentral konfigurasjon
const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

module.exports = {
    vipps: {
        clientId: process.env.VIPPS_CLIENT_ID,
        clientSecret: process.env.VIPPS_CLIENT_SECRET,
        subscriptionKey: process.env.VIPPS_SUBSCRIPTION_KEY,
        merchantSerialNumber: process.env.VIPPS_MSN,
        baseUrl: process.env.VIPPS_BASE_URL || 'https://apitest.vipps.no',

        // Vipps setter selv sammen den endelige callback-URLen som
        // callbackPrefix + "/v2/payments/{orderId}". Prefixet skal derfor IKKE
        // inneholde ordreId eller ruten som tar imot kallet.
        // Ferdig URL blir: <prefix>/v2/payments/BOOK-...
        callbackPrefix: process.env.VIPPS_CALLBACK_PREFIX || `${baseUrl}/api/booking/vipps`,

        // Hemmelig token som sendes til Vipps ved betalingsstart og returneres i
        // Authorization-headeren på callbacken. Uten denne er callback-endepunktet
        // åpent for alle (vi verifiserer alltid status mot Vipps, men sett den).
        callbackAuthToken: process.env.VIPPS_CALLBACK_TOKEN,

        // Siden kunden sendes tilbake til etter betalingsforsøket (både ved
        // fullført og avbrutt betaling - utfallet må sjekkes serverside).
        fallbackUrl: `${baseUrl}/`
    },
    iglohome: {
        clientId: process.env.IGLOHOME_CLIENT_ID,
        clientSecret: process.env.IGLOHOME_CLIENT_SECRET,
        deviceId: process.env.IGLOHOME_DEVICE_ID,
        baseUrl: 'https://api.igloohome.co/v1'
    },

    // Maskinspesifikasjoner - vises i UI og brukes i kommunikasjon
    maskin: {
        navn: 'Volvo EC20E',
        beskrivelse: '2 tonns gravemaskin med tiltfeste',
        utstyrInkludert: [
            'Tiltfeste',
            'Graveskuff/pusseskuff',
            'Smalskuff'
        ],
        tilhenger: 'Brian James Digger Plant 2700 (totalvekt 2 700 kg)',
        forerkortKrav: 'BE-førerkort kreves for å hente selv',
        adresse: 'Bjørnøygata 42, 9019 Tromsø',
        koordinater: {
            lat: 69.639712,
            lng: 18.933157
        },
        spesifikasjoner: [
            { navn: 'Vekt',             verdi: '1 940 kg' },
            { navn: 'Maks tippehøyde',  verdi: '2,75 m' },
            { navn: 'Maks rekkevidde',  verdi: '4,36 m' },
            { navn: 'Drift',            verdi: 'Diesel' },
            { navn: 'Kobling bøtte',    verdi: 'S30' },
            { navn: 'Effekt',           verdi: '12 kW' },
            { navn: 'Lengde',           verdi: '3,746 m' },
            { navn: 'Bredde',           verdi: '0,995 m' },
            { navn: 'Høyde',            verdi: '2,395 m' },
        ]
    },

    // Prismatrise - alle priser eks mva, mva legges på i UI/regning
    priser: {
        mvaSats: 25, // prosent

        // Hovedprising basert på antall dager
        // Systemet velger den billigste matchende kategorien for kunden
        kategorier: [
            { dager: 1, navn: '1 dag',         pris: 2000 },
            { dager: 2, navn: 'Helg (2 dager)', pris: 4000 },
            { dager: 5, navn: 'Uke (5 dager)',  pris: 9000 },
            { dager: 7, navn: '7 dager',        pris: 12000 }
        ],
        // For dager utenfor matrise: lineær interpolasjon basert på 7-dagers-pris
        // Eks: 10 dager = 12000 + (3 * dagpris-etter-7) der dagpris-etter-7 = 1500
        prisPerEkstraDag: 1500,

        // Tilleggsutstyr - per døgn eks mva
        tillegg: [
            { id: 'klype',     navn: 'Klype',           pris: 400 },
        ],

        // Bringing og henting
        transport: [
            { id: 'bringing', navn: 'Bringing til adresse', pris: 800 },
            { id: 'henting',  navn: 'Henting fra adresse',  pris: 800 }
        ],

        depositum: 5000 // eks mva, reserveres ved henting
    },

    booking: {
        bufferMinutter: 30, // tid mellom utleier
        maksRadiusKmTransport: 30 // sjekk i admin før godkjenning
    },

    // Bilder ved inn/utsjekk
    inspeksjon: {
        // Obligatoriske kategorier - kunden må laste opp ett bilde i hver
        kategorier: [
            { id: 'foran',     navn: 'Foran',           beskrivelse: 'Hele maskinen sett forfra' },
            { id: 'bak',       navn: 'Bak',             beskrivelse: 'Hele maskinen sett bakfra' },
            { id: 'venstre',   navn: 'Venstre side',    beskrivelse: 'Hele venstre side' },
            { id: 'hoyre',     navn: 'Høyre side',      beskrivelse: 'Hele høyre side' },
            { id: 'skuff',     navn: 'Skuff',           beskrivelse: 'Nærbilde av skuff og tiltfeste' },
            { id: 'forerhus',  navn: 'Førerhus',        beskrivelse: 'Innsiden av førerhus, panel' }
        ],
        maksEkstraBilder: 4,
        maksFilstoerrelse: 15 * 1024 * 1024, // 15 MB original
        maksBredde: 1920, // resize til denne bredden
        kvalitet: 82, // JPEG-kvalitet 0-100
        baseUrl
    },

    sms: {
        provider: 'linkmobility',
        apiKey: process.env.SMS_API_KEY,
        avsender: 'Gravebooking'
    }
};
