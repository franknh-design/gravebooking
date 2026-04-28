// routes/mock.js - Test-endpoints (kun i mock-modus)
const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/database');
const smsService = require('../services/smsService');
const inspeksjonService = require('../services/inspeksjonService');
const prisService = require('../services/prisService');
const config = require('../config/config');

// Middleware: Avvis alt hvis ikke mock-modus
function krevMock(req, res, next) {
    if (process.env.MOCK_MODE !== 'true') {
        return res.status(403).json({ feil: 'Mock-API er deaktivert (sett MOCK_MODE=true)' });
    }
    next();
}

router.use(krevMock);

// SMS-logg
router.get('/sms-logg', async (req, res) => {
    const meldinger = await smsService.hentMockMeldinger();
    res.json(meldinger);
});

router.delete('/sms-logg', async (req, res) => {
    await smsService.nullstillMockLogg();
    res.json({ ok: true });
});

// Generer testdata
router.post('/seed', async (req, res) => {
    try {
        const db = getDb();
        const navn = ['Frank Hansen', 'Kari Olsen', 'Per Nilsen', 'Ingrid Berg', 'Lars Pedersen'];
        const tlf = ['91234567', '40000001', '90000002', '47000003', '92000004'];
        const epost = ['frank@test.no', 'kari@test.no', 'per@test.no', 'ingrid@test.no', 'lars@test.no'];
        const statuser = ['venter_godkjenning', 'godkjent', 'aktiv', 'venter_godkjenning_retur', 'fullfoert'];

        const idag = new Date();
        let opprettet = 0;

        for (let i = 0; i < 5; i++) {
            // Forskjellige datoer for hver booking - ingen overlapp
            const startOffset = i * 8 - 6; // -6, +2, +10, +18, +26 dager fra i dag
            const start = new Date(idag);
            start.setDate(start.getDate() + startOffset);
            const slutt = new Date(start);
            slutt.setDate(slutt.getDate() + (i % 3) + 1); // 1-3 dagers leie
            
            const startStr = start.toISOString().split('T')[0];
            const sluttStr = slutt.toISOString().split('T')[0];
            const dager = Math.ceil((slutt - start) / 86400000) + 1;

            // Tillegg for variasjon
            const tilleggIds = i % 2 === 0 ? ['klype'] : [];
            const transportIds = i % 3 === 0 ? ['bringing'] : [];
            
            const pris = prisService.beregnTotalpris({ 
                antallDager: dager, 
                tilleggIds, 
                transportIds 
            });

            const ordreId = `BOOK-TEST-${Date.now()}-${i}`;
            const inspeksjonToken = inspeksjonService.genererToken();
            const status = statuser[i];

            // Bygg en realistisk booking basert på status
            const insertData = {
                ordreId,
                kundeNavn: navn[i],
                kundeTelefon: tlf[i],
                kundeEpost: epost[i],
                startDato: startStr,
                sluttDato: sluttStr,
                antallDager: dager,
                totalPris: pris.sumInkMva,
                status,
                tilleggIds: JSON.stringify(tilleggIds),
                transportIds: JSON.stringify(transportIds),
                transportAdresse: transportIds.length ? 'Storgata 1, 9008 Tromsø' : null,
                prisDetaljer: JSON.stringify(pris),
                inspeksjonToken,
                ansvarBekreftet: 1,
                ansvarTidspunkt: new Date().toISOString(),
                ansvarIp: '127.0.0.1',
                vippsTransaksjonsId: status !== 'venter_godkjenning' ? `MOCK-${Date.now()}-${i}` : null,
                betalt: status !== 'venter_godkjenning' ? new Date().toISOString() : null,
                iglohomeKode: ['godkjent','aktiv','venter_godkjenning_retur','fullfoert'].includes(status)
                    ? String(Math.floor(100000 + Math.random() * 900000))
                    : null,
                iglohomeKodeId: ['godkjent','aktiv','venter_godkjenning_retur','fullfoert'].includes(status)
                    ? `MOCK-IGLO-${i}`
                    : null,
                kodeSendt: ['godkjent','aktiv','venter_godkjenning_retur','fullfoert'].includes(status)
                    ? new Date().toISOString()
                    : null,
                innsjekkStatus: ['aktiv','venter_godkjenning_retur','fullfoert'].includes(status)
                    ? 'fullfoert' : 'ikke_startet',
                innsjekkFullfoert: ['aktiv','venter_godkjenning_retur','fullfoert'].includes(status)
                    ? new Date().toISOString() : null,
                utsjekkStatus: ['venter_godkjenning_retur','fullfoert'].includes(status)
                    ? 'fullfoert' : 'ikke_startet',
                utsjekkFullfoert: ['venter_godkjenning_retur','fullfoert'].includes(status)
                    ? new Date().toISOString() : null
            };

            await db.run(`
                INSERT INTO bookings (
                    ordreId, kundeNavn, kundeTelefon, kundeEpost,
                    startDato, sluttDato, antallDager, totalPris, status,
                    tilleggIds, transportIds, transportAdresse, prisDetaljer,
                    inspeksjonToken, ansvarBekreftet, ansvarTidspunkt, ansvarIp,
                    vippsTransaksjonsId, betalt,
                    iglohomeKode, iglohomeKodeId, kodeSendt,
                    innsjekkStatus, innsjekkFullfoert,
                    utsjekkStatus, utsjekkFullfoert
                ) VALUES (
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
                )
            `, [
                insertData.ordreId, insertData.kundeNavn, insertData.kundeTelefon, insertData.kundeEpost,
                insertData.startDato, insertData.sluttDato, insertData.antallDager, insertData.totalPris, insertData.status,
                insertData.tilleggIds, insertData.transportIds, insertData.transportAdresse, insertData.prisDetaljer,
                insertData.inspeksjonToken, insertData.ansvarBekreftet, insertData.ansvarTidspunkt, insertData.ansvarIp,
                insertData.vippsTransaksjonsId, insertData.betalt,
                insertData.iglohomeKode, insertData.iglohomeKodeId, insertData.kodeSendt,
                insertData.innsjekkStatus, insertData.innsjekkFullfoert,
                insertData.utsjekkStatus, insertData.utsjekkFullfoert
            ]);

            opprettet++;
        }

        res.json({ 
            ok: true, 
            melding: `Opprettet ${opprettet} testbookinger med ulik status. Logg inn i admin for å se dem.` 
        });
    } catch (error) {
        console.error('Seed-feil:', error);
        res.status(500).json({ feil: error.message });
    }
});

// Slett alle bookinger og bilder
router.delete('/slett-alt', async (req, res) => {
    try {
        const db = getDb();
        await db.run('DELETE FROM inspeksjoner');
        await db.run('DELETE FROM bookings');
        
        // Slett bildemappe
        const uploadsDir = path.join(__dirname, '..', 'uploads');
        try {
            const entries = await fs.readdir(uploadsDir);
            for (const e of entries) {
                if (e.startsWith('BOOK-') || e === '_tmp') {
                    await fs.rm(path.join(uploadsDir, e), { recursive: true, force: true });
                }
            }
        } catch (e) { /* katalog finnes kanskje ikke */ }

        // Tøm SMS-logg
        await smsService.nullstillMockLogg();

        res.json({ ok: true, melding: 'Alle bookinger, bilder og SMS-logg er slettet' });
    } catch (error) {
        res.status(500).json({ feil: error.message });
    }
});

// Vis konfigstatus (nyttig debug-info)
router.get('/status', (req, res) => {
    res.json({
        mockModus: process.env.MOCK_MODE === 'true',
        nodeEnv: process.env.NODE_ENV,
        baseUrl: config.inspeksjon.baseUrl,
        port: process.env.PORT || 3000,
        adminTokenSatt: !!process.env.ADMIN_TOKEN,
        maskin: config.maskin.navn
    });
});

module.exports = router;
