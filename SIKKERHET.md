# SIKKERHET OG OPPSETT

## Hva ligger hvor?

```
┌─────────────────────────────────────────────────┐
│  GitHub (privat repo) - KUN KILDEKODE           │
│  • server.js, ruter, services, config-mal       │
│  • HTML, JS, CSS                                │
│  • .env.example (mal)                           │
│  • .gitignore (sørger for at ekte data blokkeres)│
└─────────────────────────────────────────────────┘
                       │
                       │ git clone (kun ved deployering)
                       ↓
┌─────────────────────────────────────────────────┐
│  VPS (Hetzner/DigitalOcean) - DRIFTSDATA        │
│  • Kjørende Node.js-server                      │
│  • SQLite-database (db/bookings.db)             │
│  • Bilder (uploads/BOOK-xxx/...)                │
│  • .env med ekte API-nøkler                     │
│  • Daglig backup til separat sted               │
└─────────────────────────────────────────────────┘
```

## Steg-for-steg førstegangsoppsett

### 1. Lag privat GitHub-repo

```bash
# I prosjektmappen lokalt
git init
git add .
git status   # SJEKK at .env og db/ IKKE er listet!
git commit -m "Initial commit"

# På github.com: lag nytt PRIVAT repo, så:
git remote add origin git@github.com:dittnavn/gravebooking.git
git push -u origin main
```

**KRITISK:** Sjekk alltid `git status` før commit. Hvis du ser `.env` eller `db/bookings.db`, har du
glemt å legge til `.gitignore`. Lekkede API-nøkler må roteres umiddelbart.

### 2. Sett opp en VPS (eksempel: Hetzner)

1. Lag konto på hetzner.com
2. Velg "Cloud" → "Add Server"
3. Velg minste maskin: CX11 (50 kr/mnd)
4. Velg Ubuntu 24.04 LTS
5. Last opp din SSH-nøkkel (eller bruk passord)
6. Velg datasenter i Nürnberg eller Helsinki

### 3. Koble til serveren og installer Node.js

```bash
ssh root@DIN-SERVER-IP

# Oppdater systemet
apt update && apt upgrade -y

# Installer Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs git

# Installer libheif for HEIC-bilder fra iPhone
apt install -y libheif-dev libvips libvips-dev

# Lag bruker for applikasjonen (ikke kjør som root!)
adduser --system --group --home /opt/gravebooking gravebooking
```

### 4. Klon kode og sett opp .env

```bash
cd /opt/gravebooking
sudo -u gravebooking git clone https://github.com/dittnavn/gravebooking.git .
sudo -u gravebooking npm install --omit=dev

# Lag .env fra mal
sudo -u gravebooking cp .env.example .env
sudo -u gravebooking nano .env   # FYLL INN EKTE VERDIER

# Generer admin-token
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 5. Sett opp Caddy som webserver (HTTPS)

Caddy gir automatisk HTTPS via Let's Encrypt:

```bash
apt install -y caddy
nano /etc/caddy/Caddyfile
```

Innhold:
```
booking.dindomain.no {
    reverse_proxy localhost:3000
    
    # Begrens uploadstørrelse (15 MB + buffer)
    request_body {
        max_size 20MB
    }
    
    # Sikkerhetshoder
    header {
        Strict-Transport-Security "max-age=31536000"
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
    }
}
```

Restart: `systemctl restart caddy`

### 6. Sett opp som tjeneste (systemd)

```bash
nano /etc/systemd/system/gravebooking.service
```

Innhold:
```
[Unit]
Description=Gravebooking server
After=network.target

[Service]
Type=simple
User=gravebooking
WorkingDirectory=/opt/gravebooking
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5

# Sikkerhet
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/gravebooking/db /opt/gravebooking/uploads

[Install]
WantedBy=multi-user.target
```

Aktiver:
```bash
systemctl daemon-reload
systemctl enable --now gravebooking
systemctl status gravebooking
```

### 7. Sett opp brannmur

```bash
ufw allow 22/tcp     # SSH
ufw allow 80/tcp     # HTTP (for Let's Encrypt)
ufw allow 443/tcp    # HTTPS
ufw enable
```

### 8. Daglig backup (KRITISK)

Lag `/opt/gravebooking/backup.sh`:

```bash
#!/bin/bash
DATO=$(date +%Y-%m-%d)
BACKUP_DIR=/var/backup/gravebooking

mkdir -p $BACKUP_DIR

# Database
sqlite3 /opt/gravebooking/db/bookings.db ".backup $BACKUP_DIR/db-$DATO.db"

# Bilder (kun de siste 90 dagene)
find /opt/gravebooking/uploads -mtime -90 | tar -czf $BACKUP_DIR/bilder-$DATO.tar.gz -T -

# Slett backups eldre enn 30 dager
find $BACKUP_DIR -name "*.db" -mtime +30 -delete
find $BACKUP_DIR -name "*.tar.gz" -mtime +30 -delete
```

Kjør hver natt: `crontab -e`
```
0 3 * * * /opt/gravebooking/backup.sh
```

**Backup må ligge ET ANNET STED enn serveren.** Sett opp rsync til en ekstern disk, OneDrive, eller en annen VPS:

```bash
# Eksempel - rsync til ekstern server
0 4 * * * rsync -avz /var/backup/gravebooking/ user@backup-server:/backup/
```

## Sikkerhetssjekkliste før produksjon

- [ ] `.env` er IKKE i git-repoet (sjekk `git log --all -- .env`)
- [ ] `.gitignore` blokkerer `db/`, `uploads/`, `.env`
- [ ] HTTPS fungerer (Caddy gir automatisk gyldig sertifikat)
- [ ] Admin-token er minst 32 tegn tilfeldig
- [ ] Brannmur er aktivert
- [ ] SSH-tilgang krever nøkkel, ikke passord
- [ ] Server kjører ikke som root
- [ ] Daglig backup er testet (prøv faktisk å gjenopprette)
- [ ] iglohome og Vipps står på produksjons-API (ikke test-API)
- [ ] Tilgangstoken til inspeksjons-URL er minst 24 tegn
- [ ] Database-filen har rettighet 600 (kun eier kan lese)

```bash
# Sjekk db-rettigheter
ls -la /opt/gravebooking/db/bookings.db
# Skal vise: -rw------- gravebooking gravebooking
```

## Hvis noe lekker

**API-nøkler (Vipps/iglohome/SMS) lekker på GitHub:**
1. Gå inn i hver tjeneste og roter nøklene umiddelbart
2. Sjekk `git log --all` for hva som ble eksponert
3. Selv etter sletting fra git, anta at nøklene er kompromittert
4. Følg med på Vipps-dashboardet for uvanlig aktivitet

**Database lekker:**
1. Du har plikt til å varsle Datatilsynet innen 72 timer (jf. GDPR)
2. Varsle alle berørte kunder
3. Varsle Datatilsynet på datatilsynet.no/melding

**Server hacket:**
1. Slå av serveren umiddelbart
2. Lag ny VPS, bygg opp på nytt fra GitHub + .env
3. Roter ALLE nøkler
4. Gjenopprett fra siste rene backup
5. Vurder å varsle Datatilsynet

## Lokalt utviklingsoppsett

For testing på din egen maskin før deployering:

```bash
git clone https://github.com/dittnavn/gravebooking.git
cd gravebooking
npm install
cp .env.example .env
# Rediger .env med TEST-verdier (Vipps test-API)

# Bruk Vipps testmiljø
# VIPPS_BASE_URL=https://apitest.vipps.no
# CALLBACK_URL=https://abc123.ngrok.io/api/booking/vipps-callback

npm run dev
```

Bruk **ngrok** eller **cloudflared** for å eksponere localhost til Vipps under testing:

```bash
# Installer ngrok, logg inn, deretter:
ngrok http 3000
# Bruk URL-en ngrok gir deg som CALLBACK_URL i .env
```
