// routes/inspeksjon.js - Bilder ved henting og levering
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const router = express.Router();
const inspeksjonService = require('../services/inspeksjonService');
const config = require('../config/config');

// Multer-oppsett for midlertidig lagring av opplastinger
const upload = multer({
    dest: path.join(__dirname, '..', 'uploads', '_tmp'),
    limits: {
        fileSize: config.inspeksjon.maksFilstoerrelse
    },
    fileFilter: (req, file, cb) => {
        const tillatt = ['image/jpeg', 'image/jpg', 'image/png', 'image/heic', 'image/heif', 'image/webp'];
        if (tillatt.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Kun bilder er tillatt (JPEG, PNG, HEIC, WebP)'));
        }
    }
});

// Middleware: validér token og last booking
async function valgterToken(req, res, next) {
    const { ordreId, token } = req.params;
    const booking = await inspeksjonService.valgterBooking(ordreId, token);
    if (!booking) {
        return res.status(404).json({ feil: 'Ugyldig lenke' });
    }
    req.booking = booking;
    next();
}

// Middleware: bestem inspeksjonstype basert på rute
function settType(type) {
    return (req, res, next) => {
        req.inspeksjonType = type;
        next();
    };
}

// Hent status for innsjekk
router.get('/innsjekk/:ordreId/:token/status', valgterToken, async (req, res) => {
    try {
        const status = await inspeksjonService.hentInspeksjonStatus(req.params.ordreId, 'innsjekk');
        res.json({
            ...status,
            booking: {
                ordreId: req.booking.ordreId,
                kundeNavn: req.booking.kundeNavn,
                startDato: req.booking.startDato,
                sluttDato: req.booking.sluttDato,
                status: req.booking.status,
                innsjekkStatus: req.booking.innsjekkStatus
            },
            kanFullfoere: status.obligatoriskeFullfoert && req.booking.innsjekkStatus !== 'fullfoert'
        });
    } catch (error) {
        res.status(500).json({ feil: error.message });
    }
});

// Hent status for utsjekk
router.get('/utsjekk/:ordreId/:token/status', valgterToken, async (req, res) => {
    try {
        const status = await inspeksjonService.hentInspeksjonStatus(req.params.ordreId, 'utsjekk');
        res.json({
            ...status,
            booking: {
                ordreId: req.booking.ordreId,
                kundeNavn: req.booking.kundeNavn,
                startDato: req.booking.startDato,
                sluttDato: req.booking.sluttDato,
                status: req.booking.status,
                utsjekkStatus: req.booking.utsjekkStatus
            },
            kanFullfoere: status.obligatoriskeFullfoert && req.booking.utsjekkStatus !== 'fullfoert'
        });
    } catch (error) {
        res.status(500).json({ feil: error.message });
    }
});

// Last opp bilde (innsjekk)
router.post('/innsjekk/:ordreId/:token/upload', valgterToken, upload.single('bilde'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ feil: 'Ingen fil mottatt' });
        const { kategori } = req.body;
        if (!kategori) return res.status(400).json({ feil: 'Mangler kategori' });

        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
        const resultat = await inspeksjonService.lagreBilde({
            ordreId: req.params.ordreId,
            type: 'innsjekk',
            kategori,
            fil: req.file,
            ip
        });
        res.json(resultat);
    } catch (error) {
        // Rens opp midlertidig fil ved feil
        if (req.file) {
            try { await fs.unlink(req.file.path); } catch (e) { /* */ }
        }
        res.status(400).json({ feil: error.message });
    }
});

// Last opp bilde (utsjekk)
router.post('/utsjekk/:ordreId/:token/upload', valgterToken, upload.single('bilde'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ feil: 'Ingen fil mottatt' });
        const { kategori } = req.body;
        if (!kategori) return res.status(400).json({ feil: 'Mangler kategori' });

        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
        const resultat = await inspeksjonService.lagreBilde({
            ordreId: req.params.ordreId,
            type: 'utsjekk',
            kategori,
            fil: req.file,
            ip
        });
        res.json(resultat);
    } catch (error) {
        if (req.file) {
            try { await fs.unlink(req.file.path); } catch (e) { /* */ }
        }
        res.status(400).json({ feil: error.message });
    }
});

// Fullfør innsjekk - aktiverer iglohome-koden og sender SMS
router.post('/innsjekk/:ordreId/:token/fullfoer', valgterToken, async (req, res) => {
    try {
        const resultat = await inspeksjonService.fullfoerInspeksjon(req.params.ordreId, 'innsjekk');
        res.json({
            ...resultat,
            melding: 'Takk for bildene! Du får nå en SMS med koden til nøkkelboksen.'
        });
    } catch (error) {
        res.status(400).json({ feil: error.message });
    }
});

// Fullfør utsjekk
router.post('/utsjekk/:ordreId/:token/fullfoer', valgterToken, async (req, res) => {
    try {
        const resultat = await inspeksjonService.fullfoerInspeksjon(req.params.ordreId, 'utsjekk');
        res.json({
            ...resultat,
            melding: 'Utsjekk fullført! Du vil få en bekreftelse når jeg har gjennomgått bildene og frigjort depositum.'
        });
    } catch (error) {
        res.status(400).json({ feil: error.message });
    }
});

// Hent bilde
router.get('/bilde/:id', async (req, res) => {
    try {
        const sti = await inspeksjonService.hentBildeSti(req.params.id, false);
        if (!sti) return res.status(404).send('Ikke funnet');
        res.sendFile(path.resolve(sti));
    } catch (error) {
        res.status(500).send('Feil');
    }
});

// Hent thumbnail
router.get('/thumbnail/:id', async (req, res) => {
    try {
        const sti = await inspeksjonService.hentBildeSti(req.params.id, true);
        if (!sti) return res.status(404).send('Ikke funnet');
        res.sendFile(path.resolve(sti));
    } catch (error) {
        res.status(500).send('Feil');
    }
});

// Slett ekstra-bilde (kun ekstra-kategorien kan slettes av kunde)
router.delete('/:type/:ordreId/:token/bilde/:bildeId', valgterToken, async (req, res) => {
    try {
        const { getDb } = require('../db/database');
        const db = getDb();
        const bilde = await db.get(
            'SELECT * FROM inspeksjoner WHERE id = ? AND ordreId = ? AND type = ? AND kategori = ?',
            [req.params.bildeId, req.params.ordreId, req.params.type, 'ekstra']
        );
        if (!bilde) return res.status(404).json({ feil: 'Ikke funnet eller kan ikke slettes' });
        
        try {
            await fs.unlink(bilde.stiOriginal);
            if (bilde.stiThumbnail) await fs.unlink(bilde.stiThumbnail);
        } catch (e) { /* */ }
        
        await db.run('DELETE FROM inspeksjoner WHERE id = ?', [req.params.bildeId]);
        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ feil: error.message });
    }
});

// Hent konfigurasjon for inspeksjon (kategorier osv)
router.get('/konfig', (req, res) => {
    res.json({
        kategorier: config.inspeksjon.kategorier,
        maksEkstraBilder: config.inspeksjon.maksEkstraBilder,
        maksFilstoerrelse: config.inspeksjon.maksFilstoerrelse,
        maskin: config.maskin
    });
});

module.exports = router;
