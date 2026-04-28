// db/database.js - SQLite-håndtering
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');

let db;

async function initDatabase() {
    db = await open({
        filename: path.join(__dirname, 'bookings.db'),
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS bookings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ordreId TEXT UNIQUE NOT NULL,
            kundeNavn TEXT NOT NULL,
            kundeTelefon TEXT NOT NULL,
            kundeEpost TEXT NOT NULL,
            startDato TEXT NOT NULL,
            sluttDato TEXT NOT NULL,
            antallDager INTEGER NOT NULL,
            totalPris INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'venter_betaling',
            vippsTransaksjonsId TEXT,
            iglohomeKode TEXT,
            iglohomeKodeId TEXT,
            opprettet TEXT DEFAULT CURRENT_TIMESTAMP,
            betalt TEXT,
            kodeSendt TEXT,
            ansvarBekreftet INTEGER DEFAULT 0,
            ansvarTidspunkt TEXT,
            ansvarIp TEXT,
            tilleggIds TEXT,
            transportIds TEXT,
            transportAdresse TEXT,
            prisDetaljer TEXT,
            inspeksjonToken TEXT,
            innsjekkStatus TEXT DEFAULT 'ikke_startet',
            innsjekkFullfoert TEXT,
            utsjekkStatus TEXT DEFAULT 'ikke_startet',
            utsjekkFullfoert TEXT,
            notater TEXT
        );

        CREATE TABLE IF NOT EXISTS inspeksjoner (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ordreId TEXT NOT NULL,
            type TEXT NOT NULL,
            kategori TEXT NOT NULL,
            filnavn TEXT NOT NULL,
            stiOriginal TEXT NOT NULL,
            stiThumbnail TEXT,
            stoerrelseBytes INTEGER,
            opplastet TEXT DEFAULT CURRENT_TIMESTAMP,
            ip TEXT,
            exifData TEXT,
            FOREIGN KEY (ordreId) REFERENCES bookings(ordreId)
        );

        CREATE INDEX IF NOT EXISTS idx_status ON bookings(status);
        CREATE INDEX IF NOT EXISTS idx_dato ON bookings(startDato, sluttDato);
        CREATE INDEX IF NOT EXISTS idx_token ON bookings(inspeksjonToken);
        CREATE INDEX IF NOT EXISTS idx_inspeksjon_ordre ON inspeksjoner(ordreId, type);
    `);

    console.log('Database initialisert');
    return db;
}

function getDb() {
    if (!db) throw new Error('Database ikke initialisert');
    return db;
}

module.exports = { initDatabase, getDb };
