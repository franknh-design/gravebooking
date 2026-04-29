// routes/admin.js - Admin-funksjoner
const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const bookingRoutes = require('./booking');
const inspeksjonService = require('../services/inspeksjonService');
const smsService = require('../services/smsService');
const config = require('../config/config');

// Middleware: krever admin-token
function krevAdmin(req, res, next) {
    const token = req.headers['x-admin-token'] || req.query.token;
    if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
        return res.status(401).json({ feil: 'Uautorisert' });
    }
    next();
}

router.use(krevAdmin);

// Hent alle kunder med statistikk
router.get('/kunder', async (req, res) => {
    try {
        const { soek } = req.query;
        const db = getDb();
        
        let query = `
            SELECT 
                k.*,
                COUNT(b.id) as totalBookinger,
                COALESCE(SUM(CASE WHEN b.status IN ('aktiv','venter_godkjenning_retur','fullfoert') THEN b.totalPris ELSE 0 END), 0) as totalOmsetning,
                COUNT(CASE WHEN b.status = 'fullfoert' THEN 1 END) as antallFullfoert,
                COUNT(CASE WHEN b.status = 'skade_registrert' THEN 1 END) as antallSkader,
                MAX(b.startDato) as sisteBooking
            FROM kunder k
            LEFT JOIN bookings b ON b.kundeId = k.id
        `;
        
        const params = [];
        if (soek) {
            query += ` WHERE k.navn LIKE ? OR k.epost LIKE ? OR k.telefon LIKE ?`;
            const s = `%${soek}%`;
            params.push(s, s, s);
        }
        
        query += ` GROUP BY k.id ORDER BY k.sistAktiv DESC LIMIT 200`;
        
        const kunder = await db.all(query, params);
        res.json(kunder);
    } catch (error) {
        console.error('Kunder-feil:', error);
        res.status(500).json({ feil: error.message });
    }
});

// Hent én kunde med all booking-historikk
router.get('/kunde/:id', async (req, res) => {
    try {
        const db = getDb();
        const { hentKundeMedStatistikk } = require('../db/database');
        const kunde = await hentKundeMedStatistikk(req.params.id);
        if (!kunde) return res.status(404).json({ feil: 'Ikke funnet' });
        
        const bookinger = await db.all(`
            SELECT ordreId, startDato, sluttDato, antallDager, totalPris, status, opprettet
            FROM bookings 
            WHERE kundeId = ?
            ORDER BY opprettet DESC
        `, [req.params.id]);
        
        res.json({ ...kunde, bookinger });
    } catch (error) {
        res.status(500).json({ feil: error.message });
    }
});

// Oppdater kunde (notater, blokkering, firma-info)
router.patch('/kunde/:id', async (req, res) => {
    try {
        const { notater, blokkert, blokkertGrunn, firma, orgNummer, fakturaadresse } = req.body;
        const db = getDb();
        
        const oppdateringer = [];
        const verdier = [];
        
        if (notater !== undefined) {
            oppdateringer.push('notater = ?');
            verdier.push(notater);
        }
        if (blokkert !== undefined) {
            oppdateringer.push('blokkert = ?');
            verdier.push(blokkert ? 1 : 0);
        }
        if (blokkertGrunn !== undefined) {
            oppdateringer.push('blokkertGrunn = ?');
            verdier.push(blokkertGrunn);
        }
        if (firma !== undefined) {
            oppdateringer.push('firma = ?');
            verdier.push(firma);
        }
        if (orgNummer !== undefined) {
            oppdateringer.push('orgNummer = ?');
            verdier.push(orgNummer);
        }
        if (fakturaadresse !== undefined) {
            oppdateringer.push('fakturaadresse = ?');
            verdier.push(fakturaadresse);
        }
        
        if (oppdateringer.length === 0) {
            return res.status(400).json({ feil: 'Ingen felter å oppdatere' });
        }
        
        verdier.push(req.params.id);
        await db.run(`UPDATE kunder SET ${oppdateringer.join(', ')} WHERE id = ?`, verdier);
        
        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ feil: error.message });
    }
});

// Marker faktura som sendt (admin har sendt faktura via e-post/regnskapsprogram)
router.post('/faktura-sendt/:ordreId', async (req, res) => {
    try {
        const { ordreId } = req.params;
        const { fakturanummer, notat } = req.body;
        const db = getDb();
        const booking = await db.get('SELECT * FROM bookings WHERE ordreId = ?', [ordreId]);
        
        if (!booking) return res.status(404).json({ feil: 'Ikke funnet' });
        if (booking.status !== 'venter_faktura') {
            return res.status(400).json({ feil: `Bookingen har feil status: ${booking.status}` });
        }

        const noteDeler = [`[${new Date().toISOString()}] Faktura sendt`];
        if (fakturanummer) noteDeler.push(`(faktura #${fakturanummer})`);
        if (notat) noteDeler.push(`- ${notat}`);

        await db.run(`
            UPDATE bookings 
            SET status = 'venter_betaling', notater = COALESCE(notater || char(10), '') || ?
            WHERE ordreId = ?
        `, [noteDeler.join(' '), ordreId]);

        // SMS til kunde
        try {
            await smsService.sendSms({
                til: booking.kundeTelefon,
                melding: `Hei ${booking.kundeNavn}! Faktura for booking ${ordreId} er sendt til ${booking.kundeEpost}. Nøkkelboks-kode aktiveres når faktura er betalt.`
            });
        } catch (e) { console.error('SMS feilet:', e); }

        res.json({ ok: true, melding: 'Faktura markert som sendt. Kunde varslet.' });
    } catch (error) {
        console.error('Faktura-sendt-feil:', error);
        res.status(500).json({ feil: error.message });
    }
});

// Marker faktura som betalt (admin har sett betaling i banken)
// Dette utløser samme flyt som Vipps-betaling: går til venter_godkjenning
router.post('/faktura-betalt/:ordreId', async (req, res) => {
    try {
        const { ordreId } = req.params;
        const db = getDb();
        const booking = await db.get('SELECT * FROM bookings WHERE ordreId = ?', [ordreId]);
        
        if (!booking) return res.status(404).json({ feil: 'Ikke funnet' });
        if (!['venter_betaling', 'venter_faktura'].includes(booking.status)) {
            return res.status(400).json({ feil: `Bookingen har feil status: ${booking.status}` });
        }

        await db.run(`
            UPDATE bookings 
            SET status = 'venter_godkjenning', 
                betalt = ?, 
                vippsTransaksjonsId = ?,
                notater = COALESCE(notater || char(10), '') || ?
            WHERE ordreId = ?
        `, [
            new Date().toISOString(),
            `FAKTURA-${Date.now()}`,
            `[${new Date().toISOString()}] Faktura registrert som betalt av admin`,
            ordreId
        ]);

        res.json({ ok: true, melding: 'Faktura markert som betalt. Bookingen kan nå godkjennes.' });
    } catch (error) {
        console.error('Faktura-betalt-feil:', error);
        res.status(500).json({ feil: error.message });
    }
});

// Hent oversikt: alle bookinger med valgfritt filter
router.get('/bookinger', async (req, res) => {
    try {
        const { status, fra, til } = req.query;
        const db = getDb();
        
        let query = 'SELECT * FROM bookings WHERE 1=1';
        const params = [];
        
        if (status) {
            const statuser = status.split(',');
            query += ` AND status IN (${statuser.map(() => '?').join(',')})`;
            params.push(...statuser);
        }
        if (fra) {
            query += ' AND startDato >= ?';
            params.push(fra);
        }
        if (til) {
            query += ' AND sluttDato <= ?';
            params.push(til);
        }
        
        query += ' ORDER BY opprettet DESC LIMIT 200';
        const bookinger = await db.all(query, params);

        // Beriker med parsede JSON-felter
        const beriket = bookinger.map(b => ({
            ...b,
            tilleggIds: b.tilleggIds ? JSON.parse(b.tilleggIds) : [],
            transportIds: b.transportIds ? JSON.parse(b.transportIds) : [],
            prisDetaljer: b.prisDetaljer ? JSON.parse(b.prisDetaljer) : null
        }));

        res.json(beriket);
    } catch (error) {
        console.error('Bookinger-feil:', error);
        res.status(500).json({ feil: error.message });
    }
});

// Hent én booking med all info inkludert bilder
router.get('/booking/:ordreId', async (req, res) => {
    try {
        const db = getDb();
        const booking = await db.get('SELECT * FROM bookings WHERE ordreId = ?', [req.params.ordreId]);
        if (!booking) return res.status(404).json({ feil: 'Ikke funnet' });

        const innsjekk = await inspeksjonService.hentInspeksjonStatus(req.params.ordreId, 'innsjekk');
        const utsjekk = await inspeksjonService.hentInspeksjonStatus(req.params.ordreId, 'utsjekk');

        // Lenke for kunden (hvis admin trenger å sende på nytt)
        const baseUrl = config.inspeksjon.baseUrl;
        const kundeLenker = {
            innsjekk: `${baseUrl}/checkin.html?ordre=${booking.ordreId}&token=${booking.inspeksjonToken}`,
            utsjekk: `${baseUrl}/checkout.html?ordre=${booking.ordreId}&token=${booking.inspeksjonToken}`
        };

        res.json({
            ...booking,
            tilleggIds: booking.tilleggIds ? JSON.parse(booking.tilleggIds) : [],
            transportIds: booking.transportIds ? JSON.parse(booking.transportIds) : [],
            prisDetaljer: booking.prisDetaljer ? JSON.parse(booking.prisDetaljer) : null,
            innsjekk,
            utsjekk,
            kundeLenker
        });
    } catch (error) {
        console.error('Booking-detalj-feil:', error);
        res.status(500).json({ feil: error.message });
    }
});

// Godkjenn booking - genererer kode og sender SMS med lenker
router.post('/godkjenn/:ordreId', async (req, res) => {
    try {
        const { ordreId } = req.params;
        const db = getDb();
        const booking = await db.get('SELECT * FROM bookings WHERE ordreId = ?', [ordreId]);

        if (!booking) return res.status(404).json({ feil: 'Ikke funnet' });
        if (booking.status !== 'venter_godkjenning') {
            return res.status(400).json({ feil: `Feil status: ${booking.status}` });
        }

        const kode = await bookingRoutes.genererOgSendKode(ordreId);
        res.json({ ok: true, kode: kode.kode });
    } catch (error) {
        console.error('Godkjenningsfeil:', error);
        res.status(500).json({ feil: error.message });
    }
});

// Send eksisterende kode på SMS igjen (kunde har glemt SMS)
router.post('/send-kode-igjen/:ordreId', async (req, res) => {
    try {
        const { ordreId } = req.params;
        const db = getDb();
        const booking = await db.get('SELECT * FROM bookings WHERE ordreId = ?', [ordreId]);
        
        if (!booking) return res.status(404).json({ feil: 'Ikke funnet' });
        if (!booking.iglohomeKode) {
            return res.status(400).json({ feil: 'Ingen kode generert ennå. Bookingen må først godkjennes og innsjekk-bilder må være tatt.' });
        }
        if (!['godkjent','aktiv','venter_godkjenning_retur'].includes(booking.status)) {
            return res.status(400).json({ feil: `Kan ikke sende kode for status: ${booking.status}` });
        }

        await smsService.sendSms({
            til: booking.kundeTelefon,
            melding: `Hei ${booking.kundeNavn}! Her er din kode på nytt:\n\nNøkkelboks: ${booking.iglohomeKode}\n\nGyldig under hele leieperioden ${booking.startDato} - ${booking.sluttDato}.`
        });

        // Logg handlingen
        const notat = `[${new Date().toISOString()}] Kode sendt på nytt til ${booking.kundeTelefon}`;
        await db.run(`
            UPDATE bookings 
            SET notater = COALESCE(notater || char(10), '') || ?
            WHERE ordreId = ?
        `, [notat, ordreId]);

        res.json({ ok: true, melding: 'Kode sendt på SMS' });
    } catch (error) {
        console.error('Send-kode-igjen-feil:', error);
        res.status(500).json({ feil: error.message });
    }
});

// Generer ny kode (gammel kode kompromittert)
router.post('/ny-kode/:ordreId', async (req, res) => {
    try {
        const { ordreId } = req.params;
        const { grunn } = req.body;
        const db = getDb();
        const booking = await db.get('SELECT * FROM bookings WHERE ordreId = ?', [ordreId]);
        
        if (!booking) return res.status(404).json({ feil: 'Ikke funnet' });
        if (!['godkjent','aktiv','venter_godkjenning_retur'].includes(booking.status)) {
            return res.status(400).json({ feil: `Kan ikke generere ny kode for status: ${booking.status}` });
        }

        // Generer ny kode via iglohome
        const iglohomeService = require('../services/iglohomeService');
        const ny = await iglohomeService.genererLeiekode({
            startDato: booking.startDato,
            sluttDato: booking.sluttDato,
            ordreId: booking.ordreId
        });

        const gammelKode = booking.iglohomeKode;

        // Oppdater booking
        await db.run(`
            UPDATE bookings 
            SET iglohomeKode = ?, iglohomeKodeId = ?
            WHERE ordreId = ?
        `, [ny.kode, ny.kodeId, ordreId]);

        // Send ny kode til kunde
        await smsService.sendSms({
            til: booking.kundeTelefon,
            melding: `Hei ${booking.kundeNavn}! Ny kode til nøkkelboksen: ${ny.kode}\n\nDen gamle koden fungerer ikke lenger. Gyldig under hele leieperioden.`
        });

        // Logg handlingen
        const notat = `[${new Date().toISOString()}] Ny kode generert (gammel: ${gammelKode}). Grunn: ${grunn || 'Ikke spesifisert'}`;
        await db.run(`
            UPDATE bookings 
            SET notater = COALESCE(notater || char(10), '') || ?
            WHERE ordreId = ?
        `, [notat, ordreId]);

        res.json({ ok: true, kode: ny.kode, melding: 'Ny kode generert og sendt til kunde' });
    } catch (error) {
        console.error('Ny-kode-feil:', error);
        res.status(500).json({ feil: error.message });
    }
});

// Avvis booking - må refundere via Vipps separat
router.post('/avvis/:ordreId', async (req, res) => {
    try {
        const { ordreId } = req.params;
        const { begrunnelse } = req.body;
        const db = getDb();
        
        const booking = await db.get('SELECT * FROM bookings WHERE ordreId = ?', [ordreId]);
        if (!booking) return res.status(404).json({ feil: 'Ikke funnet' });

        await db.run(`
            UPDATE bookings 
            SET status = 'avbrutt', notater = ?
            WHERE ordreId = ?
        `, [begrunnelse || 'Avvist av admin', ordreId]);

        // Varsle kunden
        try {
            await smsService.sendSms({
                til: booking.kundeTelefon,
                melding: `Hei ${booking.kundeNavn}, dessverre kan vi ikke gjennomføre bookingen ${ordreId}. ${begrunnelse || ''} Du vil motta refusjon innen 1-3 virkedager. Spørsmål? Svar på denne SMS.`
            });
        } catch (e) { console.error('SMS feilet:', e); }

        res.json({ 
            ok: true, 
            advarsel: 'Husk å refundere ' + booking.totalPris + ' kr via Vipps-portalen manuelt' 
        });
    } catch (error) {
        res.status(500).json({ feil: error.message });
    }
});

// Markér retur som godkjent (depositum frigjøres)
router.post('/godkjenn-retur/:ordreId', async (req, res) => {
    try {
        const { ordreId } = req.params;
        const { notater } = req.body;
        const db = getDb();

        const booking = await db.get('SELECT * FROM bookings WHERE ordreId = ?', [ordreId]);
        if (!booking) return res.status(404).json({ feil: 'Ikke funnet' });
        if (booking.utsjekkStatus !== 'fullfoert') {
            return res.status(400).json({ feil: 'Utsjekk er ikke fullført ennå' });
        }

        await db.run(`
            UPDATE bookings 
            SET status = 'fullfoert', notater = COALESCE(notater || char(10), '') || ?
            WHERE ordreId = ?
        `, [`[${new Date().toISOString()}] Retur godkjent. ${notater || ''}`, ordreId]);

        try {
            await smsService.sendSms({
                til: booking.kundeTelefon,
                melding: `Takk for at du leverte ${config.maskin.navn}! Retur godkjent uten anmerkninger. Depositumet på ${config.priser.depositum} kr eks mva er frigjort. God dag!`
            });
        } catch (e) { console.error('SMS feilet:', e); }

        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ feil: error.message });
    }
});

// Blokker datoer (admin reserverer for egen bruk eller vedlikehold)
router.post('/blokker-datoer', async (req, res) => {
    try {
        const { startDato, sluttDato, grunn } = req.body;
        
        if (!startDato || !sluttDato) {
            return res.status(400).json({ feil: 'Mangler datoer' });
        }
        
        const db = getDb();
        
        // Sjekk om periode allerede har bookinger
        const konflikter = await db.all(`
            SELECT ordreId, kundeNavn FROM bookings 
            WHERE status NOT IN ('avbrutt', 'fullfoert')
            AND NOT (sluttDato < ? OR startDato > ?)
        `, [startDato, sluttDato]);

        if (konflikter.length > 0) {
            return res.status(409).json({ 
                feil: 'Det finnes eksisterende bookinger i denne perioden',
                konflikter: konflikter.map(k => `${k.ordreId} (${k.kundeNavn})`)
            });
        }

        const start = new Date(startDato);
        const slutt = new Date(sluttDato);
        const antallDager = Math.ceil((slutt - start) / (1000 * 60 * 60 * 24)) + 1;
        
        const ordreId = `BLOKK-${Date.now()}`;
        
        await db.run(`
            INSERT INTO bookings (
                ordreId, kundeNavn, kundeTelefon, kundeEpost,
                startDato, sluttDato, antallDager, totalPris, status,
                notater, ansvarBekreftet
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'aktiv', ?, 1)
        `, [
            ordreId,
            'BLOKKERT (Admin)',
            '0',
            'admin@internt',
            startDato,
            sluttDato,
            antallDager,
            0,
            grunn || 'Blokkert av admin'
        ]);

        res.json({ 
            ok: true, 
            ordreId,
            melding: `Blokkert ${antallDager} dag(er) fra ${startDato} til ${sluttDato}` 
        });
    } catch (error) {
        console.error('Blokker-feil:', error);
        res.status(500).json({ feil: error.message });
    }
});

// Slett blokkering (kun for BLOKK-ordre)
router.delete('/blokker-datoer/:ordreId', async (req, res) => {
    try {
        const { ordreId } = req.params;
        if (!ordreId.startsWith('BLOKK-')) {
            return res.status(400).json({ feil: 'Kan kun slette blokkeringer (BLOKK-*)' });
        }
        
        const db = getDb();
        const result = await db.run('DELETE FROM bookings WHERE ordreId = ?', [ordreId]);
        
        if (result.changes === 0) {
            return res.status(404).json({ feil: 'Ikke funnet' });
        }
        
        res.json({ ok: true, melding: 'Blokkering fjernet' });
    } catch (error) {
        res.status(500).json({ feil: error.message });
    }
});

// Registrer skade - belaster (deler av) depositum
router.post('/registrer-skade/:ordreId', async (req, res) => {
    try {
        const { ordreId } = req.params;
        const { beskrivelse, beloep } = req.body;
        if (!beskrivelse || !beloep) return res.status(400).json({ feil: 'Mangler beskrivelse eller beløp' });

        const db = getDb();
        const booking = await db.get('SELECT * FROM bookings WHERE ordreId = ?', [ordreId]);
        if (!booking) return res.status(404).json({ feil: 'Ikke funnet' });

        const notat = `[${new Date().toISOString()}] SKADE registrert: ${beloep} kr - ${beskrivelse}`;
        await db.run(`
            UPDATE bookings 
            SET status = 'skade_registrert', notater = COALESCE(notater || char(10), '') || ?
            WHERE ordreId = ?
        `, [notat, ordreId]);

        try {
            await smsService.sendSms({
                til: booking.kundeTelefon,
                melding: `Hei ${booking.kundeNavn}. Vi har registrert skade på maskinen etter retur av booking ${ordreId}: ${beskrivelse}. Beløp: ${beloep} kr. Du vil motta detaljert oppgjør på e-post. Kontakt meg ved spørsmål.`
            });
        } catch (e) { console.error('SMS feilet:', e); }

        res.json({ 
            ok: true, 
            advarsel: `Husk å belaste ${beloep} kr fra depositum manuelt via Vipps`
        });
    } catch (error) {
        res.status(500).json({ feil: error.message });
    }
});

// Send lenker på nytt (hvis kunden mister SMS)
router.post('/send-lenker-igjen/:ordreId', async (req, res) => {
    try {
        const { ordreId } = req.params;
        const db = getDb();
        const booking = await db.get('SELECT * FROM bookings WHERE ordreId = ?', [ordreId]);
        if (!booking) return res.status(404).json({ feil: 'Ikke funnet' });

        const baseUrl = config.inspeksjon.baseUrl;
        const innsjekkUrl = `${baseUrl}/checkin.html?ordre=${ordreId}&token=${booking.inspeksjonToken}`;
        const utsjekkUrl = `${baseUrl}/checkout.html?ordre=${ordreId}&token=${booking.inspeksjonToken}`;

        await smsService.sendSms({
            til: booking.kundeTelefon,
            melding: `Hei ${booking.kundeNavn}, her er lenkene til din booking ${ordreId}:

Henting (bilder): ${innsjekkUrl}
Levering (bilder): ${utsjekkUrl}

Adresse: ${config.maskin.adresse}`
        });

        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ feil: error.message });
    }
});

// Statistikk for forsiden
router.get('/statistikk', async (req, res) => {
    try {
        const db = getDb();
        const stats = await db.get(`
            SELECT 
                COUNT(*) as totalBookinger,
                COUNT(CASE WHEN status = 'venter_faktura' THEN 1 END) as venterFaktura,
                COUNT(CASE WHEN status = 'venter_godkjenning' THEN 1 END) as venterGodkjenning,
                COUNT(CASE WHEN status = 'aktiv' THEN 1 END) as aktive,
                COUNT(CASE WHEN status = 'venter_godkjenning_retur' THEN 1 END) as venterRetur,
                COUNT(CASE WHEN status = 'fullfoert' THEN 1 END) as fullfoerte,
                SUM(CASE WHEN status IN ('aktiv','venter_godkjenning_retur','fullfoert') THEN totalPris ELSE 0 END) as totalOmsetning
            FROM bookings
        `);
        
        // Kommende bookinger
        const idag = new Date().toISOString().split('T')[0];
        const kommende = await db.all(`
            SELECT ordreId, kundeNavn, startDato, sluttDato, status 
            FROM bookings 
            WHERE startDato >= ? AND status NOT IN ('avbrutt')
            ORDER BY startDato ASC LIMIT 10
        `, [idag]);

        res.json({ ...stats, kommende });
    } catch (error) {
        res.status(500).json({ feil: error.message });
    }
});

// Eksporter til CSV (for regnskap)
router.get('/eksport.csv', async (req, res) => {
    try {
        const db = getDb();
        const bookinger = await db.all(`
            SELECT ordreId, kundeNavn, kundeTelefon, kundeEpost, 
                   startDato, sluttDato, antallDager, totalPris, status,
                   opprettet, betalt, vippsTransaksjonsId
            FROM bookings 
            ORDER BY opprettet DESC
        `);

        const headers = 'OrdreId,Kunde,Telefon,Epost,Start,Slutt,Dager,Total,Status,Opprettet,Betalt,VippsId';
        const rows = bookinger.map(b => 
            [b.ordreId, b.kundeNavn, b.kundeTelefon, b.kundeEpost, 
             b.startDato, b.sluttDato, b.antallDager, b.totalPris, b.status,
             b.opprettet, b.betalt, b.vippsTransaksjonsId || '']
            .map(v => `"${(v || '').toString().replace(/"/g, '""')}"`)
            .join(',')
        );

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="bookinger-${new Date().toISOString().split('T')[0]}.csv"`);
        res.send([headers, ...rows].join('\n'));
    } catch (error) {
        res.status(500).json({ feil: error.message });
    }
});

module.exports = router;
