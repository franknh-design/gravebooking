# Lokal testing med mock-modus

Denne guiden viser hvordan du tester hele bookingsystemet lokalt på din egen maskin **uten** å trenge ekte Vipps-, iglohome- eller SMS-konto.

## Krav

- Node.js 20 eller nyere ([nodejs.org](https://nodejs.org))
- En moderne nettleser (Chrome, Firefox, Safari, Edge)
- Ca. 200 MB ledig diskplass (for `node_modules`)

## Førstegangs-oppsett

```bash
cd nvnord
npm install
```

Dette kan ta 1-3 minutter første gang fordi `sharp` (bildebibliotek) og `sqlite3` må kompileres.

**Hvis npm install feiler:**

På Windows kan du trenge build tools:
```bash
npm install -g windows-build-tools
```

På macOS:
```bash
xcode-select --install
```

På Linux (Ubuntu/Debian):
```bash
sudo apt install build-essential libvips-dev
```

## Start i mock-modus

På Linux/macOS:
```bash
MOCK_MODE=true ADMIN_TOKEN=test-token-1234 npm start
```

På Windows (cmd):
```cmd
set MOCK_MODE=true && set ADMIN_TOKEN=test-token-1234 && npm start
```

På Windows (PowerShell):
```powershell
$env:MOCK_MODE="true"; $env:ADMIN_TOKEN="test-token-1234"; npm start
```

Du skal nå se:
```
🧪 MOCK_MODE aktivert - Vipps, iglohome og SMS er simulert
   Gå til http://localhost:3000/mock/debug.html for testing
Bookingserver kjører på port 3000
```

## Hva mock-modus gjør

| Tjeneste | Mock-oppførsel |
|----------|-----------------|
| **Vipps** | Sender deg til en simulert betalingsside med "Godkjenn"-knapp. Ingen ekte penger flyttes. |
| **iglohome** | Genererer tilfeldig 6-sifret kode. Ingen ekte lås åpnes. |
| **SMS** | Skriver til konsoll og lagres i fil. Vises i debug-side. |

## Test-flyt

### 1. Lag testdata
Gå til **http://localhost:3000/mock/debug.html** og klikk "Generer 5 testbookinger". Du får:
- 1 venter godkjenning
- 1 godkjent (ikke aktivert)
- 1 aktiv (i bruk nå)
- 1 venter retur (kunde har levert tilbake)
- 1 fullført

### 2. Test bookingflyten som kunde
Gå til **http://localhost:3000/**:
- Velg datoer i kalenderen
- Fyll inn navn, telefon, e-post
- Hak av tillegg (klype, bringing/henting)
- Bekreft alle ansvarspunkter
- Klikk "Book og betal med Vipps"
- Du sendes til **mock Vipps**-siden – klikk "Godkjenn betaling"
- Tilbake på hovedsiden – bookingen er nå opprettet

### 3. Godkjenn som admin
Gå til **http://localhost:3000/admin.html**:
- Logg inn med `test-token-1234`
- Finn bookingen din under "Venter godkjenning"
- Klikk på den, klikk "Godkjenn booking"
- I debug-siden ser du nå **SMS-en som ville blitt sendt** (med inspeksjonslenker)

### 4. Test innsjekk-flyten (kunden)
Kopier lenken til "Innsjekk" fra SMS-en i debug-siden. Lim inn i nettleseren:
- Du ser innsjekksiden
- Trykk på en kategori, åpner filvelger
- Last opp et bilde (kan være hva som helst – test.jpg eller lignende)
- Gjenta for alle 6 obligatoriske kategorier
- Trykk "Bekreft og send"
- Sjekk at SMS med iglohome-kode kommer i debug-siden

### 5. Test bildesammenligning i admin
Gå tilbake til admin, åpne bookingen:
- Du ser nå "Bildesammenligning" med innsjekk-bildene
- Klikk på et bilde for å forstørre
- Test "Send lenker på nytt" – ny SMS kommer i debug-siden

### 6. Test utsjekk og retur
Bruk utsjekk-lenken fra debug-siden:
- Last opp 6 nye bilder
- Trykk "Bekreft levering"
- I admin: status er nå "Venter retur"
- Klikk "Godkjenn retur" – kunde får SMS, depositum er klar til frigjøring

### 7. Test skaderegistrering
For en booking i "Venter retur":
- Klikk "Registrer skade"
- Skriv inn beskrivelse og beløp
- SMS sendes til kunde, status blir "Skade"

### 8. Andre ting å teste
- **QR-kode**: http://localhost:3000/qr.html – generer og test utskrift
- **Info-side**: http://localhost:3000/info.html – det QR-en peker til
- **Eksport**: Klikk "Eksporter CSV" i admin – du får en fil med alle bookinger

## Nyttige debug-funksjoner

Debug-siden (**/mock/debug.html**) har:
- **SMS-logg**: Se alle simulerte SMS som er sendt
- **Generer testbookinger**: Lager 5 bookinger med ulik status
- **Slett alle bookinger**: Tøm databasen for å starte på nytt
- **Auto-oppdatering**: SMS-loggen oppdateres hvert 5. sekund

## Vanlige problemer

**Port 3000 er allerede i bruk:**
```bash
PORT=3001 MOCK_MODE=true ADMIN_TOKEN=test-token-1234 npm start
```

**Sharp/sqlite3 feiler under installasjon:**
Følg [Krav](#krav)-seksjonen og installer build tools for ditt OS.

**Kameraet åpner ikke seg på telefon:**
For å teste fra mobil må du:
1. Sette opp serveren slik at telefonen kan nå den (samme WiFi)
2. Bruke `https://` (kameraet krever HTTPS i moderne nettlesere)
3. Bruk f.eks. `ngrok http 3000` for å få en HTTPS-URL midlertidig

## Bytte til ekte modus

Når du er klar for ekte tjenester, sett `MOCK_MODE=false` og fyll inn ekte API-nøkler i `.env`. Se `SIKKERHET.md` for full deployment-guide.

## Hva mock-modus IKKE tester

- **Ekte Vipps-integrasjon**: Du må teste mot Vipps testmiljø (`apitest.vipps.no`) før produksjon
- **iglohome med ekte lås**: Du må ha en fysisk iglohome-enhet og bridge for å teste at koder faktisk åpner låsen
- **SMS-leveringsrate**: Bare ekte SMS-leverandør viser om meldingene kommer fram
- **HTTPS og Caddy**: Du tester på `http://localhost`, men produksjon krever skikkelig sertifikat

Når du har testet alt i mock-modus, gå videre til Vipps-testmiljø før du går live med ekte penger.
