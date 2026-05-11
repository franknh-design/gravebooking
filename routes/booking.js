// routes/booking.js - Bookingflyt
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/database');
const vippsService = require('../services/vippsService');
const iglohomeService = require('../services/iglohomeService');
const smsService = require('../services/smsService');
const prisService = require('../services/prisService');
const inspeksjonService = require('../services/inspeksjonService');
const { fmtDato, fmtPeriode } = require('../services/datoUtil');
const config = require('../config/config');

// Hent maskinkonfig og prismatrise (for frontend)
router.get('/konfig', async (req, res) => {
    try {
        const { hentPriser } = require('../services/prisService');
        const dbPriser = await hentPriser();
        const priser = dbPriser || config.priser;

        res.json({
            maskin: config.maskin,
            priser: {
                kategorier: priser.kategorier,
                prisPerEkstraDag: priser.prisPerEkstraDag,
                tillegg: priser.tillegg,
                transport: priser.transport,
                depositum: priser.depositum,
                mvaSats: priser.mvaSats
            }
        });
    } catch (e) {
        // Fallback til config hvis database feiler
        res.json({
            maskin: config.maskin,
            priser: {
                kategorier: config.priser.kategorier,
                prisPerEkstraDag: config.priser.prisPerEkstraDag,
                tillegg: config.priser.tillegg,
                transport: config.priser.transport,
                depositum: config.priser.depositum,
                mvaSats: config.priser.mvaSats
            }
        });
    }
});

// Beregn pris for valgt periode og tillegg
router.post('/beregn-pris', async (req, res) => {
    try {
        const { antallDager, tilleggIds, transportIds } = req.body;
        if (!antallDager || antallDager < 1) {
            return res.status(400).json({ feil: 'Ugyldig antall dager' });
        }
        const resultat = await prisService.beregnTotalpris({ 
            antallDager, 
            tilleggIds: tilleggIds || [], 
            transportIds: transportIds || [] 
        });
        res.json(resultat);
    } catch (error) {
        res.status(500).json({ feil: error.message });
    }
});

// Sjekk tilgjengelighet for spesifikk datoperiode (brukes ved bekreftelse)
router.get('/tilgjengelighet', async (req, res) => {
    const { startDato, sluttDato } = req.query;
    if (!startDato || !sluttDato) {
        return res.status(400).json({ feil: 'Mangler datoer' });
    }

    const db = getDb();
    const overlappende = await db.all(`
        SELECT * FROM bookings 
        WHERE status NOT IN ('avbrutt', 'fullført')
        AND NOT (sluttDato < ? OR startDato > ?)
    `, [startDato, sluttDato]);

    res.json({ 
        tilgjengelig: overlappende.length === 0,
        konflikter: overlappende.length 
    });
});

// Hent alle opptatte datoer i en periode (for kalendervisning)
router.get('/opptatte-datoer', async (req, res) => {
    const { fra, til } = req.query;
    
    // Default: fra i dag til 6 måneder fram
    const fraDato = fra || new Date().toISOString().split('T')[0];
    const tilDatoObj = new Date();
    tilDatoObj.setMonth(tilDatoObj.getMonth() + 6);
    const tilDato = til || tilDatoObj.toISOString().split('T')[0];

    const db = getDb();
    const bookinger = await db.all(`
        SELECT startDato, sluttDato, status FROM bookings 
        WHERE status NOT IN ('avbrutt', 'fullfoert')
        AND sluttDato >= ?
        AND startDato <= ?
    `, [fraDato, tilDato]);

    // Ekspander til en flat liste med alle opptatte datoer
    const opptatte = new Set();
    bookinger.forEach(b => {
        const start = new Date(b.startDato);
        const slutt = new Date(b.sluttDato);
        for (let d = new Date(start); d <= slutt; d.setDate(d.getDate() + 1)) {
            opptatte.add(d.toISOString().split('T')[0]);
        }
    });

    const sorterte = Array.from(opptatte).sort();
    res.json({ 
        opptatte: sorterte,
        opptatteDatoer: sorterte, // Beholdes for bakoverkompatibilitet
        antallBookinger: bookinger.length
    });
});

// Opprett booking + start Vipps-betaling ELLER faktura-forespørsel
router.post('/opprett', async (req, res) => {
    try {
        const { 
            kundeNavn, kundeTelefon, kundeEpost, 
            startDato, sluttDato, 
            ansvarBekreftet, ansvarTidspunkt,
            tilleggIds = [], transportIds = [], 
            transportAdresse,
            betalingsmetode = 'vipps',  // 'vipps' eller 'faktura'
            firma, orgNummer            // valgfritt for faktura
        } = req.body;

        if (!kundeNavn || !kundeTelefon || !kundeEpost || !startDato || !sluttDato) {
            return res.status(400).json({ feil: 'Mangler påkrevde felter' });
        }

        if (!ansvarBekreftet) {
            return res.status(400).json({ feil: 'Ansvarsvilkår må bekreftes' });
        }

        if (!['vipps', 'faktura'].includes(betalingsmetode)) {
            return res.status(400).json({ feil: 'Ugyldig betalingsmetode' });
        }

        // Hvis transport valgt, må adresse være angitt
        if (transportIds.length > 0 && !transportAdresse) {
            return res.status(400).json({ feil: 'Adresse kreves for bringing/henting' });
        }

        const db = getDb();
        const konflikter = await db.all(`
            SELECT id FROM bookings 
            WHERE status NOT IN ('avbrutt', 'fullfoert')
            AND NOT (sluttDato < ? OR startDato > ?)
        `, [startDato, sluttDato]);

        if (konflikter.length > 0) {
            return res.status(409).json({ feil: 'Maskinen er ikke tilgjengelig i denne perioden' });
        }

        const start = new Date(startDato);
        const slutt = new Date(sluttDato);
        const antallDager = Math.ceil((slutt - start) / (1000 * 60 * 60 * 24)) + 1;

        // Beregn pris med tillegg via prisService
        const pris = await prisService.beregnTotalpris({ antallDager, tilleggIds, transportIds });
        const totalPris = pris.sumInkMva;

        const ordreId = `BOOK-${Date.now()}-${uuidv4().slice(0, 8)}`;
        const inspeksjonToken = inspeksjonService.genererToken();
        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;

        // Finn eller opprett kunde
        const { finnEllerOpprettKunde } = require('../db/database');
        let kundeId;
        try {
            kundeId = await finnEllerOpprettKunde({
                navn: kundeNavn,
                telefon: kundeTelefon,
                epost: kundeEpost
            });
        } catch (e) {
            if (e.kundeBlokkert) {
                return res.status(403).json({ 
                    feil: 'Booking ikke mulig. ' + e.message
                });
            }
            throw e;
        }

        // Oppdater kundens firma-info hvis oppgitt (overskriver kun hvis ny verdi)
        if (firma || orgNummer) {
            const oppdat = [];
            const verdier = [];
            if (firma) { oppdat.push('firma = ?'); verdier.push(firma); }
            if (orgNummer) { oppdat.push('orgNummer = ?'); verdier.push(orgNummer); }
            verdier.push(kundeId);
            await db.run(`UPDATE kunder SET ${oppdat.join(', ')} WHERE id = ?`, verdier);
        }

        // Status avhenger av betalingsmetode
        const initialStatus = betalingsmetode === 'vipps' ? 'venter_betaling' : 'venter_faktura';
        
        // Notater (lagrer firma-info i selve bookingen for sporbarhet)
        let notater = null;
        if (betalingsmetode === 'faktura') {
            const noteDeler = [`[${new Date().toISOString()}] Faktura-forespørsel.`];
            if (firma) noteDeler.push(`Firma: ${firma}`);
            if (orgNummer) noteDeler.push(`Org.nr: ${orgNummer}`);
            notater = noteDeler.join(' ');
        }
        
        await db.run(`
            INSERT INTO bookings (
                ordreId, kundeNavn, kundeTelefon, kundeEpost, kundeId,
                startDato, sluttDato, antallDager, totalPris, status,
                tilleggIds, transportIds, transportAdresse, prisDetaljer,
                inspeksjonToken,
                ansvarBekreftet, ansvarTidspunkt, ansvarIp, notater
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
        `, [
            ordreId, kundeNavn, kundeTelefon, kundeEpost, kundeId,
            startDato, sluttDato, antallDager, totalPris, initialStatus,
            JSON.stringify(tilleggIds), 
            JSON.stringify(transportIds), 
            transportAdresse || null,
            JSON.stringify(pris),
            inspeksjonToken,
            ansvarTidspunkt || new Date().toISOString(), 
            ip,
            notater
        ]);

        // Hvis faktura: ferdig, returner umiddelbart (ingen Vipps)
        if (betalingsmetode === 'faktura') {
            // Varsle admin via SMS hvis ADMIN_TELEFON er satt
            if (process.env.ADMIN_TELEFON) {
                try {
                    await smsService.sendSms({
                        til: process.env.ADMIN_TELEFON,
                        melding: `Ny FAKTURA-forespørsel: ${kundeNavn} (${kundeTelefon}) ønsker å leie ${config.maskin.navn} ${fmtPeriode(startDato, sluttDato)} (${totalPris} kr). Behandle i admin.`
                    });
                } catch (e) { console.error('Admin-varsel feilet:', e.message); }
            }
            return res.json({
                ordreId,
                betalingsmetode: 'faktura',
                beloep: totalPris,
                antallDager,
                prisDetaljer: pris,
                melding: 'Forespørselen er mottatt. Vi behandler den og sender faktura innen 24 timer. Datoene er reservert for deg.'
            });
        }

        // Hvis Vipps: start betalingsflyt som før
        const beskrivelseDeler = [`Leie ${config.maskin.navn} ${antallDager} dag(er)`];
        if (tilleggIds.length) beskrivelseDeler.push('+ tillegg');
        if (transportIds.length) beskrivelseDeler.push('+ transport');

        const vippsResultat = await vippsService.initierBetaling({
            ordreId,
            beloep: totalPris,
            telefon: kundeTelefon,
            beskrivelse: beskrivelseDeler.join(' ')
        });

        res.json({
            ordreId,
            betalingsmetode: 'vipps',
            betalingsUrl: vippsResultat.url,
            beloep: totalPris,
            antallDager,
            prisDetaljer: pris
        });

    } catch (error) {
        console.error('Feil ved opprettelse:', error);
        res.status(500).json({ feil: 'Kunne ikke opprette booking', detaljer: error.message });
    }
});

// Vipps callback
router.post('/vipps-callback/:ordreId', async (req, res) => {
    try {
        const { ordreId } = req.params;
        const { transactionInfo } = req.body;

        const db = getDb();
        const booking = await db.get('SELECT * FROM bookings WHERE ordreId = ?', [ordreId]);
        
        if (!booking) {
            return res.status(404).json({ feil: 'Booking ikke funnet' });
        }

        const vippsStatus = await vippsService.sjekkBetalingsStatus(ordreId);
        const erBetalt = vippsStatus.transactionLogHistory.some(
            t => t.operation === 'RESERVE' && t.operationSuccess
        );

        if (!erBetalt) {
            return res.status(400).json({ feil: 'Betaling ikke bekreftet' });
        }

        const innst = await db.get(
            `SELECT verdi FROM innstillinger WHERE nokkel = 'vipps_krever_godkjenning'`
        );
        const kreverGodkjenning = innst?.verdi !== '0';
        const nyStatus = kreverGodkjenning ? 'venter_godkjenning' : 'godkjent';

        await db.run(`
            UPDATE bookings
            SET status = ?, betalt = CURRENT_TIMESTAMP, vippsTransaksjonsId = ?
            WHERE ordreId = ?
        `, [nyStatus, transactionInfo?.transactionId || 'ukjent', ordreId]);

        if (!kreverGodkjenning) {
            await genererOgSendKode(ordreId);
        } else {
            await smsService.sendSms({
                til: process.env.ADMIN_TELEFON,
                melding: `Ny booking ${ordreId} venter på godkjenning. Kunde: ${booking.kundeNavn}`
            });
        }

        res.json({ ok: true });

    } catch (error) {
        console.error('Vipps callback-feil:', error);
        res.status(500).json({ feil: error.message });
    }
});

async function genererOgSendKode(ordreId) {
    const db = getDb();
    const booking = await db.get('SELECT * FROM bookings WHERE ordreId = ?', [ordreId]);

    // Generer iglohome-koden, men IKKE send den ennå - vent på innsjekk
    const kode = await iglohomeService.genererLeiekode({
        startDato: booking.startDato,
        sluttDato: booking.sluttDato,
        ordreId
    });

    await db.run(`
        UPDATE bookings 
        SET iglohomeKode = ?, iglohomeKodeId = ?, kodeSendt = CURRENT_TIMESTAMP, status = 'godkjent'
        WHERE ordreId = ?
    `, [kode.kode, kode.kodeId, ordreId]);

    // SMS med lenker til innsjekk og utsjekk
    const baseUrl = config.inspeksjon.baseUrl;
    const innsjekkUrl = `${baseUrl}/checkin.html?ordre=${ordreId}&token=${booking.inspeksjonToken}`;
    const utsjekkUrl = `${baseUrl}/checkout.html?ordre=${ordreId}&token=${booking.inspeksjonToken}`;

    const melding = `Hei ${booking.kundeNavn}! Bookingen din for ${config.maskin.navn} er godkjent.

VED HENTING (${fmtDato(booking.startDato)}):
Ta bilder av maskinen her: ${innsjekkUrl}
Du får låskoden etter at bildene er tatt.

VED LEVERING (${fmtDato(booking.sluttDato)}):
Ta bilder av maskinen her: ${utsjekkUrl}

Adresse: ${config.maskin.adresse}
Spørsmål? Svar på denne SMS-en.`;

    await smsService.sendSms({ til: booking.kundeTelefon, melding });

    return kode;
}

router.genererOgSendKode = genererOgSendKode;

module.exports = router;
