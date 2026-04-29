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

        CREATE TABLE IF NOT EXISTS kunder (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            navn TEXT NOT NULL,
            telefon TEXT NOT NULL,
            epost TEXT UNIQUE NOT NULL,
            firma TEXT,
            orgNummer TEXT,
            fakturaadresse TEXT,
            opprettet TEXT DEFAULT CURRENT_TIMESTAMP,
            sistAktiv TEXT DEFAULT CURRENT_TIMESTAMP,
            blokkert INTEGER DEFAULT 0,
            blokkertGrunn TEXT,
            notater TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_status ON bookings(status);
        CREATE INDEX IF NOT EXISTS idx_dato ON bookings(startDato, sluttDato);
        CREATE INDEX IF NOT EXISTS idx_token ON bookings(inspeksjonToken);
        CREATE INDEX IF NOT EXISTS idx_inspeksjon_ordre ON inspeksjoner(ordreId, type);
        CREATE INDEX IF NOT EXISTS idx_kunde_epost ON kunder(epost);
        CREATE INDEX IF NOT EXISTS idx_kunde_telefon ON kunder(telefon);
    `);

    // Migrering: legg til kundeId-kolonne på bookings hvis den mangler
    const kolonner = await db.all(`PRAGMA table_info(bookings)`);
    const harKundeId = kolonner.some(k => k.name === 'kundeId');
    
    if (!harKundeId) {
        console.log('Migrerer database: legger til kundeId-kolonne...');
        await db.exec(`ALTER TABLE bookings ADD COLUMN kundeId INTEGER REFERENCES kunder(id)`);
        
        // Opprett kunder fra eksisterende bookinger
        const eksisterende = await db.all(`
            SELECT DISTINCT kundeEpost, kundeNavn, kundeTelefon 
            FROM bookings 
            WHERE kundeEpost != 'admin@internt' 
            AND ordreId NOT LIKE 'BLOKK-%'
        `);
        
        for (const b of eksisterende) {
            try {
                const result = await db.run(`
                    INSERT OR IGNORE INTO kunder (navn, telefon, epost) 
                    VALUES (?, ?, ?)
                `, [b.kundeNavn, b.kundeTelefon, b.kundeEpost]);
                
                if (result.lastID) {
                    await db.run(`
                        UPDATE bookings SET kundeId = ? WHERE kundeEpost = ?
                    `, [result.lastID, b.kundeEpost]);
                }
            } catch (e) {
                console.warn('Kunne ikke migrere kunde:', b.kundeEpost, e.message);
            }
        }
        
        // Koble eksisterende kunder til bookinger som mangler kundeId
        const kunder = await db.all(`SELECT id, epost FROM kunder`);
        for (const k of kunder) {
            await db.run(`
                UPDATE bookings SET kundeId = ? 
                WHERE kundeEpost = ? AND kundeId IS NULL
            `, [k.id, k.epost]);
        }
        
        console.log(`Migrert ${eksisterende.length} kunder fra eksisterende bookinger`);
    }

    console.log('Database initialisert');
    return db;
}

function getDb() {
    if (!db) throw new Error('Database ikke initialisert');
    return db;
}

// Hjelpefunksjon: finn eller opprett kunde basert på e-post
// Returnerer kundeId
async function finnEllerOpprettKunde({ navn, telefon, epost }) {
    const db = getDb();
    
    // Normaliser e-post (lowercase, trim)
    const epostNorm = epost.toLowerCase().trim();
    
    const eksisterende = await db.get(`SELECT * FROM kunder WHERE epost = ?`, [epostNorm]);
    
    if (eksisterende) {
        // Sjekk om kunden er blokkert
        if (eksisterende.blokkert) {
            const error = new Error(eksisterende.blokkertGrunn || 'Kontakt utleier for booking');
            error.kundeBlokkert = true;
            throw error;
        }
        
        // Oppdater navn/telefon hvis kunden har endret det
        await db.run(`
            UPDATE kunder 
            SET navn = ?, telefon = ?, sistAktiv = CURRENT_TIMESTAMP 
            WHERE id = ?
        `, [navn, telefon, eksisterende.id]);
        
        return eksisterende.id;
    }
    
    // Opprett ny kunde
    const result = await db.run(`
        INSERT INTO kunder (navn, telefon, epost) 
        VALUES (?, ?, ?)
    `, [navn, telefon, epostNorm]);
    
    return result.lastID;
}

// Hent kunde med statistikk (totalBookinger, totalOmsetning)
async function hentKundeMedStatistikk(kundeId) {
    const db = getDb();
    
    const kunde = await db.get(`SELECT * FROM kunder WHERE id = ?`, [kundeId]);
    if (!kunde) return null;
    
    const stats = await db.get(`
        SELECT 
            COUNT(*) as totalBookinger,
            COALESCE(SUM(CASE WHEN status IN ('aktiv','venter_godkjenning_retur','fullfoert') THEN totalPris ELSE 0 END), 0) as totalOmsetning,
            COUNT(CASE WHEN status = 'fullfoert' THEN 1 END) as antallFullfoert,
            COUNT(CASE WHEN status = 'skade_registrert' THEN 1 END) as antallSkader,
            MAX(startDato) as sisteBooking
        FROM bookings 
        WHERE kundeId = ?
    `, [kundeId]);
    
    return { ...kunde, ...stats };
}

module.exports = { initDatabase, getDb, finnEllerOpprettKunde, hentKundeMedStatistikk };
