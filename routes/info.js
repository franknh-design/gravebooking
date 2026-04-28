// routes/info.js - Offentlige info-endpoints (ingen autentisering)
const express = require('express');
const router = express.Router();
const config = require('../config/config');

// Returner kontaktinformasjon for info-siden
// Publikum-vennlig - ingen sensitive detaljer
router.get('/kontakt', (req, res) => {
    res.json({
        // Bruker en egen public-telefon hvis satt, ellers admin-telefon
        telefon: process.env.PUBLIC_TELEFON || process.env.ADMIN_TELEFON || null,
        adresse: config.maskin.adresse,
        koordinater: config.maskin.koordinater
    });
});

module.exports = router;
