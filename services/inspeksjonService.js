// services/inspeksjonService.js - Bilde-opplasting og inspeksjon
const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');
const crypto = require('crypto');
const { getDb } = require('../db/database');
const config = require('../config/config');

const UPLOAD_BASE = path.join(__dirname, '..', 'uploads');

/**
 * Genererer en sikker tilfeldig token for inspeksjons-URL.
 */
function genererToken() {
    return crypto.randomBytes(24).toString('base64url');
}

/**
 * Sikrer at upload-katalogen finnes.
 */
async function sikreKatalog(ordreId, type) {
    const sti = path.join(UPLOAD_BASE, ordreId, type);
    await fs.mkdir(sti, { recursive: true });
    return sti;
}

/**
 * Validerer token mot booking. Returnerer booking hvis gyldig, eller null.
 */
async function valgterBooking(ordreId, token) {
    const db = getDb();
    const booking = await db.get(
        'SELECT * FROM bookings WHERE ordreId = ? AND inspeksjonToken = ?',
        [ordreId, token]
    );
    return booking || null;
}

/**
 * Henter status for inspeksjon (innsjekk eller utsjekk).
 * @param {string} ordreId
 * @param {string} type 'innsjekk' eller 'utsjekk'
 * @returns {Object} status med kategorier og opplastede bilder
 */
async function hentInspeksjonStatus(ordreId, type) {
    const db = getDb();
    const bilder = await db.all(
        'SELECT * FROM inspeksjoner WHERE ordreId = ? AND type = ? ORDER BY opplastet',
        [ordreId, type]
    );

    const kategorier = config.inspeksjon.kategorier.map(kat => {
        const bilde = bilder.find(b => b.kategori === kat.id);
        return {
            ...kat,
            opplastet: !!bilde,
            bilde: bilde ? {
                id: bilde.id,
                filnavn: bilde.filnavn,
                opplastet: bilde.opplastet,
                url: `/api/inspeksjon/bilde/${bilde.id}`,
                thumbnailUrl: `/api/inspeksjon/thumbnail/${bilde.id}`
            } : null
        };
    });

    const ekstra = bilder.filter(b => b.kategori === 'ekstra').map(b => ({
        id: b.id,
        url: `/api/inspeksjon/bilde/${b.id}`,
        thumbnailUrl: `/api/inspeksjon/thumbnail/${b.id}`,
        opplastet: b.opplastet
    }));

    const obligatoriskeFullfoert = kategorier.every(k => k.opplastet);

    return {
        type,
        kategorier,
        ekstra,
        obligatoriskeFullfoert,
        totalAntall: bilder.length
    };
}

/**
 * Lagrer et opplastet bilde - optimaliserer og oppretter thumbnail.
 * @returns {Object} info om lagret bilde
 */
async function lagreBilde({ ordreId, type, kategori, fil, ip }) {
    // Validering
    if (!['innsjekk', 'utsjekk'].includes(type)) {
        throw new Error('Ugyldig type');
    }
    
    const gyldigeKategorier = [
        ...config.inspeksjon.kategorier.map(k => k.id),
        'ekstra'
    ];
    if (!gyldigeKategorier.includes(kategori)) {
        throw new Error('Ugyldig kategori');
    }

    if (fil.size > config.inspeksjon.maksFilstoerrelse) {
        throw new Error('Filen er for stor (maks 15 MB)');
    }

    const db = getDb();

    // Hvis obligatorisk kategori (ikke ekstra), erstatt evt. tidligere bilde
    if (kategori !== 'ekstra') {
        const eksisterende = await db.get(
            'SELECT * FROM inspeksjoner WHERE ordreId = ? AND type = ? AND kategori = ?',
            [ordreId, type, kategori]
        );
        if (eksisterende) {
            // Slett gammel fil
            try {
                await fs.unlink(eksisterende.stiOriginal);
                if (eksisterende.stiThumbnail) await fs.unlink(eksisterende.stiThumbnail);
            } catch (e) { /* fil mangler kanskje */ }
            await db.run('DELETE FROM inspeksjoner WHERE id = ?', [eksisterende.id]);
        }
    } else {
        // Sjekk maks ekstra-bilder
        const ekstraCount = await db.get(
            'SELECT COUNT(*) as c FROM inspeksjoner WHERE ordreId = ? AND type = ? AND kategori = ?',
            [ordreId, type, 'ekstra']
        );
        if (ekstraCount.c >= config.inspeksjon.maksEkstraBilder) {
            throw new Error(`Maks ${config.inspeksjon.maksEkstraBilder} ekstra-bilder`);
        }
    }

    const katalog = await sikreKatalog(ordreId, type);
    const tidsstempel = Date.now();
    const filnavn = `${kategori}_${tidsstempel}.jpg`;
    const thumbnavn = `thumb_${kategori}_${tidsstempel}.jpg`;
    const stiOriginal = path.join(katalog, filnavn);
    const stiThumbnail = path.join(katalog, thumbnavn);

    // Hent EXIF før transformering (for GPS, tidspunkt)
    let exifData = null;
    try {
        const metadata = await sharp(fil.path).metadata();
        if (metadata.exif) {
            // Lagre EXIF som base64 - kan tolkes senere ved behov
            exifData = JSON.stringify({
                width: metadata.width,
                height: metadata.height,
                format: metadata.format,
                orientation: metadata.orientation
            });
        }
    } catch (e) { /* ignorer */ }

    // Optimaliser hovedbilde: maks bredde, JPEG kvalitet
    await sharp(fil.path)
        .rotate() // automatisk rotering basert på EXIF
        .resize({ width: config.inspeksjon.maksBredde, withoutEnlargement: true })
        .jpeg({ quality: config.inspeksjon.kvalitet })
        .toFile(stiOriginal);

    // Lag thumbnail
    await sharp(fil.path)
        .rotate()
        .resize({ width: 300, height: 300, fit: 'cover' })
        .jpeg({ quality: 75 })
        .toFile(stiThumbnail);

    // Slett midlertidig opplastingsfil
    try { await fs.unlink(fil.path); } catch (e) { /* */ }

    const stoerrelse = (await fs.stat(stiOriginal)).size;

    // Lagre i database
    const result = await db.run(`
        INSERT INTO inspeksjoner 
        (ordreId, type, kategori, filnavn, stiOriginal, stiThumbnail, stoerrelseBytes, ip, exifData)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [ordreId, type, kategori, filnavn, stiOriginal, stiThumbnail, stoerrelse, ip, exifData]);

    return {
        id: result.lastID,
        kategori,
        filnavn,
        url: `/api/inspeksjon/bilde/${result.lastID}`,
        thumbnailUrl: `/api/inspeksjon/thumbnail/${result.lastID}`
    };
}

/**
 * Markerer en inspeksjon som fullført. Sjekker at alle obligatoriske bilder er tatt.
 * Ved innsjekk: sender SMS med iglohome-kode til kunden.
 * Ved utsjekk: setter status til 'venter_godkjenning_retur' og varsler admin.
 */
async function fullfoerInspeksjon(ordreId, type) {
    const status = await hentInspeksjonStatus(ordreId, type);
    if (!status.obligatoriskeFullfoert) {
        throw new Error('Ikke alle obligatoriske bilder er tatt');
    }

    const db = getDb();
    const booking = await db.get('SELECT * FROM bookings WHERE ordreId = ?', [ordreId]);
    if (!booking) throw new Error('Booking ikke funnet');

    const feltStatus = type === 'innsjekk' ? 'innsjekkStatus' : 'utsjekkStatus';
    const feltFullfoert = type === 'innsjekk' ? 'innsjekkFullfoert' : 'utsjekkFullfoert';
    
    if (type === 'innsjekk') {
        await db.run(`
            UPDATE bookings 
            SET ${feltStatus} = 'fullfoert', ${feltFullfoert} = CURRENT_TIMESTAMP, status = 'aktiv'
            WHERE ordreId = ?
        `, [ordreId]);

        // Send SMS med selve koden NÅ
        const smsService = require('./smsService');
        const melding = `Takk for bildene! 

Din kode til nøkkelboksen: ${booking.iglohomeKode}

Koden er gyldig fra nå til ${booking.sluttDato} kl 20:00.
Adresse: ${config.maskin.adresse}

Husk å ta bilder ved levering også - lenken finner du i forrige SMS.`;
        
        await smsService.sendSms({ til: booking.kundeTelefon, melding });
    } else {
        // utsjekk
        await db.run(`
            UPDATE bookings 
            SET ${feltStatus} = 'fullfoert', ${feltFullfoert} = CURRENT_TIMESTAMP, status = 'venter_godkjenning_retur'
            WHERE ordreId = ?
        `, [ordreId]);

        // Varsle admin
        const smsService = require('./smsService');
        const adminMelding = `Booking ${ordreId} (${booking.kundeNavn}) har levert tilbake. Sjekk bildene og frigjør depositum.`;
        if (process.env.ADMIN_TELEFON) {
            await smsService.sendSms({ til: process.env.ADMIN_TELEFON, melding: adminMelding });
        }
    }

    return { ok: true, type, fullfoert: new Date().toISOString() };
}

/**
 * Henter en bildefil ved id (returnerer sti for å kunne sende fil)
 */
async function hentBildeSti(bildeId, thumbnail = false) {
    const db = getDb();
    const bilde = await db.get('SELECT * FROM inspeksjoner WHERE id = ?', [bildeId]);
    if (!bilde) return null;
    return thumbnail ? bilde.stiThumbnail : bilde.stiOriginal;
}

module.exports = {
    genererToken,
    valgterBooking,
    hentInspeksjonStatus,
    lagreBilde,
    fullfoerInspeksjon,
    hentBildeSti
};
