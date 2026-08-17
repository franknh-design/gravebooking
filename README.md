# nvnord

Bookingsystem for utleie av Volvo EC20E gravemaskin i Tromsø.

## Funksjoner

- Kalenderbasert bookingside med tilleggsutstyr (klype, bringing/henting)
- Vipps-betaling med callback-håndtering
- Automatisk iglohome-låskode for leieperioden
- Bildedokumentasjon ved henting og levering (mobil-optimert)
- Admin-panel med bildesammenligning og statushåndtering
- QR-kode + info-side for klistrelapp på maskinen
- Mock-modus for testing uten ekte API-er

## Komme i gang lokalt

### Krav

- Node.js 20 eller nyere ([nodejs.org](https://nodejs.org))
- En moderne nettleser

### Installasjon

```bash
cd nvnord
npm install
```

Hvis `sharp` eller `sqlite3` feiler under installasjon, se [TESTING.md](TESTING.md) for OS-spesifikke build-tools.

### Start i mock-modus (uten ekte API-er)

**Linux/macOS:**
```bash
MOCK_MODE=true ADMIN_TOKEN=test1234 npm start
```

**Windows (cmd):**
```cmd
set MOCK_MODE=true && set ADMIN_TOKEN=test1234 && npm start
```

**Windows (PowerShell):**
```powershell
$env:MOCK_MODE="true"; $env:ADMIN_TOKEN="test1234"; npm start
```

Åpne så:
- http://localhost:3000/ — bookingsiden
- http://localhost:3000/admin.html — admin-panel (bruk `test1234` som token)
- http://localhost:3000/mock/debug.html — debug-dashboard med SMS-logg og testdata

Se [TESTING.md](TESTING.md) for full testguide.

## Filstruktur

```
nvnord/
├── server.js                 Express-server, ruter
├── package.json              Avhengigheter
├── .env.example              Mal for miljøvariabler
├── .gitignore                Forhindrer at sensitiv data commitsjes
│
├── config/
│   └── config.js             Sentral konfigurasjon (priser, maskin, tjenester)
│
├── db/
│   └── database.js           SQLite-håndtering, schema
│
├── routes/
│   ├── booking.js            Bookingflyt for kunde
│   ├── admin.js              Admin-funksjoner (godkjenne, sammenligne)
│   ├── inspeksjon.js         Bildeopplasting ved henting/levering
│   ├── info.js               Offentlig info (kontakt)
│   └── mock.js               Test-API (kun aktivt i mock-modus)
│
├── services/
│   ├── prisService.js        Prisberegning med tillegg
│   ├── vippsService.js       Vipps-integrasjon
│   ├── iglohomeService.js    iglohome-låskoder
│   ├── smsService.js         SMS-utsending
│   └── inspeksjonService.js  Bildehåndtering, optimalisering
│
└── public/
    ├── index.html            Bookingsiden (forsiden)
    ├── admin.html/css/js     Admin-panel
    ├── checkin.html          Bilder ved henting
    ├── checkout.html         Bilder ved levering
    ├── inspeksjon.css/js     Felles for innsjekk/utsjekk
    ├── info.html             QR-koden peker hit
    ├── qr.html               Generer klistrelapp i admin
    ├── img/ec20e.jpg         Hero-bilde
    └── mock/                 Test-sider (Vipps-mock, debug)
```

## Brukerflyt

1. Kunde velger periode i kalenderen og fyller ut skjema
2. Vipps-betaling gjennomføres (mock i utvikling)
3. Booking havner som "venter godkjenning"
4. Admin godkjenner i `/admin.html` — iglohome-kode genereres
5. Kunde får SMS med lenker til **henting** og **levering**
6. Ved henting: kunde åpner lenken, tar 6 obligatoriske bilder
7. Etter alle bilder: kunde får SMS med iglohome-kode
8. Kunde bruker maskinen
9. Ved levering: nye bilder tas via lenken
10. Admin sammenligner før/etter, godkjenner retur eller registrerer skade

## Statusoversikt for bookinger

| Status | Betydning |
|---|---|
| `venter_betaling` | Booking opprettet, venter på Vipps-betaling |
| `venter_godkjenning` | Betalt, venter på manuell godkjenning |
| `godkjent` | Godkjent, men kunde har ikke tatt innsjekk-bilder |
| `aktiv` | Innsjekk fullført, kunde har koden |
| `venter_godkjenning_retur` | Utsjekk-bilder tatt, venter på admin-vurdering |
| `fullfoert` | Retur godkjent, depositum frigjort |
| `skade_registrert` | Skade dokumentert, depositum belastes |
| `avbrutt` | Avvist eller avbestilt |

## Produksjon

Mock-modus er **kun for utvikling**. For å gå live:

1. Sett opp egen server (Hetzner, DigitalOcean, etc.) — se [SIKKERHET.md](SIKKERHET.md)
2. Kjøp domene og koble til serverens IP
3. Få Vipps eCom-konto og fyll inn API-nøkler i `.env`
4. Skaff iglohome-konto med Bridge og enhet
5. Velg SMS-leverandør (LinkMobility, Twilio)
6. Sett `MOCK_MODE=false` (eller fjern variabelen)
7. Kjør tjenesten med systemd, ha skikkelig backup, HTTPS via Caddy

Detaljert produksjonsguide: [SIKKERHET.md](SIKKERHET.md)

## Hva som ikke er ferdig

Dette er et MVP. Disse tingene gjenstår eller må gjøres manuelt:

- **Vipps ePayment-migrering (blokkerer lansering)** — `services/vippsService.js` bruker eCom API v2, som er legacy hos Vipps MobilePay. Nye salgsenheter får normalt ikke eCom-tilgang; endepunkter og statusmodell må skrives om mot `/epayment/v1/payments`
- **Capture og cancel mangler** — betalingen blir kun reservert. Reservasjonen må hentes inn eller kanselleres manuelt i Vipps-portalen inntil dette er implementert
- **Ingen poll-fallback** — Vipps krever at status også hentes med `GET`-kall når callbacken ikke kommer fram. Bookinger kan i dag stå fast i `venter_betaling`
- **Vipps-knappen følger ikke designretningslinjene** — betalingsknappen bruker egen farge og tekst, ikke Vipps' offisielle knapp med logo
- **Vippsrefusjoner** håndteres manuelt via Vipps-portalen — ingen automatisk refund-flyt
- **Depositum** reserveres ikke i Vipps, selv om leievilkårene sier at det gjøres ved henting — administreres manuelt etter retur
- **ID-verifisering** skjer kun via avkrysning, ikke BankID
- **Skadevurdering** krever menneskelig vurdering — ingen AI-skadepåvisning
- **GDPR-sletteplan** er beskrevet men ikke implementert som automatisk job

Punktene under Vipps må løses før lansering. Resten kan legges til senere uten å endre kjernearkitekturen.

## Lisens

Proprietær. Ikke for distribusjon eller kommersiell bruk uten skriftlig tillatelse.

## Spørsmål

Kontakt utleier for spørsmål om koden eller systemet.
