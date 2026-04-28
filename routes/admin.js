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
