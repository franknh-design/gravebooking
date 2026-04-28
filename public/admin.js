// public/admin.js - Admin-funksjonalitet
(function() {
    let adminToken = sessionStorage.getItem('adminToken');
    let aktivtFilter = 'alle';
    let aktivBooking = null;

    // ----- Login -----
    function visLogin() {
        document.getElementById('loginSkjerm').style.display = 'flex';
        document.getElementById('hovedinnhold').style.display = 'none';
    }

    function skjulLogin() {
        document.getElementById('loginSkjerm').style.display = 'none';
        document.getElementById('hovedinnhold').style.display = 'block';
    }

    window.loggInn = async function() {
        const token = document.getElementById('loginToken').value.trim();
        if (!token) return;

        try {
            const res = await fetch('/api/admin/statistikk', {
                headers: { 'x-admin-token': token }
            });
            if (res.ok) {
                adminToken = token;
                sessionStorage.setItem('adminToken', token);
                skjulLogin();
                lastData();
            } else {
                document.getElementById('loginFeil').textContent = 'Feil token';
            }
        } catch (err) {
            document.getElementById('loginFeil').textContent = 'Feil: ' + err.message;
        }
    };

    window.loggUt = function() {
        sessionStorage.removeItem('adminToken');
        adminToken = null;
        location.reload();
    };

    // Trykk Enter på login
    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('loginToken').addEventListener('keydown', e => {
            if (e.key === 'Enter') loggInn();
        });
    });

    // ----- API-kall -----
    async function api(sti, opts = {}) {
        const res = await fetch(sti, {
            ...opts,
            headers: {
                'x-admin-token': adminToken,
                'Content-Type': 'application/json',
                ...(opts.headers || {})
            }
        });
        if (res.status === 401) {
            visLogin();
            throw new Error('Uautorisert');
        }
        return res;
    }

    // ----- Last og vis data -----
    async function lastData() {
        await Promise.all([lastStatistikk(), lastBookinger()]);
        // Oppdater eksport-lenken med token
        document.getElementById('eksportLenke').href = `/api/admin/eksport.csv?token=${encodeURIComponent(adminToken)}`;
    }

    async function lastStatistikk() {
        try {
            const res = await api('/api/admin/statistikk');
            const data = await res.json();

            const stats = [
                { label: 'Totalt', verdi: data.totalBookinger || 0, klasse: '' },
                { label: 'Venter godkjenning', verdi: data.venterGodkjenning || 0, klasse: 'warning' },
                { label: 'Aktive', verdi: data.aktive || 0, klasse: 'success' },
                { label: 'Venter retur', verdi: data.venterRetur || 0, klasse: 'warning' },
                { label: 'Fullført', verdi: data.fullfoerte || 0, klasse: 'info' },
                { label: 'Omsetning', verdi: ((data.totalOmsetning || 0)).toLocaleString('nb-NO') + ' kr', klasse: '' }
            ];

            document.getElementById('statistikkRad').innerHTML = stats.map(s => `
                <div class="stat-kort">
                    <div class="stat-tall ${s.klasse}">${s.verdi}</div>
                    <div class="stat-label">${s.label}</div>
                </div>
            `).join('');
        } catch (e) { console.error(e); }
    }

    async function lastBookinger() {
        try {
            const status = aktivtFilter === 'alle' ? '' : `?status=${aktivtFilter}`;
            const res = await api(`/api/admin/bookinger${status}`);
            const bookinger = await res.json();
            renderBookinger(bookinger);
        } catch (e) { console.error(e); }
    }

    function renderBookinger(bookinger) {
        const el = document.getElementById('bookingListe');
        if (!bookinger.length) {
            el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--tekst-muted);">Ingen bookinger funnet</div>';
            return;
        }

        el.innerHTML = bookinger.map(b => {
            const tillegg = b.tilleggIds.length || b.transportIds.length;
            return `
                <div class="booking-rad" onclick="visDetaljer('${b.ordreId}')">
                    <div class="booking-info">
                        <div class="booking-tittel">${b.kundeNavn}</div>
                        <div class="booking-meta">
                            <span class="booking-meta-item">${b.startDato} → ${b.sluttDato}</span>
                            <span class="booking-meta-item">${b.antallDager} dag${b.antallDager > 1 ? 'er' : ''}</span>
                            <span class="status-pille status-${b.status}">${formaterStatus(b.status)}</span>
                            ${tillegg ? '<span>• tillegg</span>' : ''}
                        </div>
                    </div>
                    <div class="booking-pris">${b.totalPris.toLocaleString('nb-NO')} kr</div>
                </div>
            `;
        }).join('');
    }

    function formaterStatus(s) {
        const m = {
            'venter_betaling': 'Venter betaling',
            'venter_godkjenning': 'Venter godkjenning',
            'godkjent': 'Godkjent',
            'aktiv': 'Aktiv',
            'venter_godkjenning_retur': 'Venter retur',
            'fullfoert': 'Fullført',
            'avbrutt': 'Avbrutt',
            'skade_registrert': 'Skade'
        };
        return m[s] || s;
    }

    window.settFilter = function(status) {
        aktivtFilter = status;
        document.querySelectorAll('.filter-knapp').forEach(b => {
            b.classList.toggle('aktiv', b.dataset.status === status);
        });
        lastBookinger();
    };

    // ----- Detaljer -----
    window.visDetaljer = async function(ordreId) {
        try {
            const res = await api(`/api/admin/booking/${ordreId}`);
            const data = await res.json();
            aktivBooking = data;
            renderDetaljer(data);
            document.getElementById('detaljModal').classList.add('synlig');
        } catch (e) { alert('Feil: ' + e.message); }
    };

    window.lukkDetalj = function() {
        document.getElementById('detaljModal').classList.remove('synlig');
        aktivBooking = null;
    };

    function renderDetaljer(b) {
        const tillegg = b.tilleggIds.length ? b.tilleggIds.join(', ') : 'ingen';
        const transport = b.transportIds.length ? b.transportIds.join(', ') : 'henter selv';
        
        let html = `
            <div class="detalj-header">
                <div>
                    <div class="detalj-tittel">${b.kundeNavn}</div>
                    <div style="font-size:0.85rem;color:var(--tekst-muted);">${b.ordreId}</div>
                </div>
                <button class="lukk-btn" onclick="lukkDetalj()">×</button>
            </div>

            <div class="detalj-seksjon">
                <h3>Status</h3>
                <span class="status-pille status-${b.status}">${formaterStatus(b.status)}</span>
            </div>

            <div class="detalj-seksjon">
                <h3>Kunde</h3>
                <div class="detalj-rad"><span class="label">Navn:</span><span class="verdi">${b.kundeNavn}</span></div>
                <div class="detalj-rad"><span class="label">Telefon:</span><span class="verdi"><a href="tel:${b.kundeTelefon}">${b.kundeTelefon}</a> · <a href="sms:${b.kundeTelefon}">SMS</a></span></div>
                <div class="detalj-rad"><span class="label">E-post:</span><span class="verdi"><a href="mailto:${b.kundeEpost}">${b.kundeEpost}</a></span></div>
            </div>

            <div class="detalj-seksjon">
                <h3>Booking</h3>
                <div class="detalj-rad"><span class="label">Periode:</span><span class="verdi">${b.startDato} → ${b.sluttDato} (${b.antallDager} dag${b.antallDager > 1 ? 'er' : ''})</span></div>
                <div class="detalj-rad"><span class="label">Tillegg:</span><span class="verdi">${tillegg}</span></div>
                <div class="detalj-rad"><span class="label">Transport:</span><span class="verdi">${transport}</span></div>
                ${b.transportAdresse ? `<div class="detalj-rad"><span class="label">Adresse:</span><span class="verdi">${b.transportAdresse}</span></div>` : ''}
                <div class="detalj-rad"><span class="label">Total:</span><span class="verdi">${b.totalPris.toLocaleString('nb-NO')} kr</span></div>
                <div class="detalj-rad"><span class="label">Opprettet:</span><span class="verdi">${b.opprettet}</span></div>
                ${b.betalt ? `<div class="detalj-rad"><span class="label">Betalt:</span><span class="verdi">${b.betalt}</span></div>` : ''}
                ${b.iglohomeKode ? `<div class="detalj-rad"><span class="label">Låskode:</span><span class="verdi" style="font-family:monospace;font-size:1.05rem;">${b.iglohomeKode}</span></div>` : ''}
            </div>
        `;

        // Bildesammenligning - kun hvis det er relevant
        const harBilder = b.innsjekk.totalAntall > 0 || b.utsjekk.totalAntall > 0;
        if (harBilder || ['aktiv','venter_godkjenning_retur','fullfoert'].includes(b.status)) {
            html += `
                <div class="detalj-seksjon">
                    <h3>Bildesammenligning</h3>
                    ${renderBildesammenligning(b)}
                </div>
            `;
        }

        // Notater
        if (b.notater) {
            html += `
                <div class="detalj-seksjon">
                    <h3>Notater</h3>
                    <div class="notater-boks">${b.notater}</div>
                </div>
            `;
        }

        // Action-knapper avhengig av status
        html += renderActions(b);

        document.getElementById('detaljInnhold').innerHTML = html;
    }

    function renderBildesammenligning(b) {
        const innsjekkMap = {};
        const utsjekkMap = {};
        b.innsjekk.kategorier.forEach(k => { if (k.opplastet) innsjekkMap[k.id] = k.bilde; });
        b.utsjekk.kategorier.forEach(k => { if (k.opplastet) utsjekkMap[k.id] = k.bilde; });

        const kategorier = b.innsjekk.kategorier;
        return `
            <div style="font-size:0.8rem;color:var(--tekst-muted);margin-bottom:8px;">
                Innsjekk: ${b.innsjekk.totalAntall} bilder · Utsjekk: ${b.utsjekk.totalAntall} bilder
            </div>
            <div class="bilder-sammenligning">
                ${kategorier.map(kat => {
                    const inn = innsjekkMap[kat.id];
                    const ut = utsjekkMap[kat.id];
                    return `
                        <div class="kategori-sammenligning">
                            <div class="kategori-tittel">${kat.navn}</div>
                            <div class="bilde-par">
                                ${inn 
                                    ? `<div class="bilde-celle"><img src="${inn.thumbnailUrl}" onclick="visBilde('${inn.url}', '${kat.navn} - innsjekk')"><div class="bilde-tag">Innsjekk</div></div>`
                                    : `<div class="bilde-celle mangler">Ikke tatt</div>`
                                }
                                ${ut 
                                    ? `<div class="bilde-celle"><img src="${ut.thumbnailUrl}" onclick="visBilde('${ut.url}', '${kat.navn} - utsjekk')"><div class="bilde-tag">Utsjekk</div></div>`
                                    : `<div class="bilde-celle mangler">Ikke tatt</div>`
                                }
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    function renderActions(b) {
        let knapper = [];

        // Spesialhåndtering for blokkeringer
        if (b.ordreId.startsWith('BLOKK-')) {
            knapper.push(`<button class="action-btn danger" onclick="slettBlokkering('${b.ordreId}')">Fjern blokkering</button>`);
            return `<div class="actions-rad">${knapper.join('')}</div>`;
        }

        if (b.status === 'venter_godkjenning') {
            knapper.push(`<button class="action-btn primary" onclick="godkjenn('${b.ordreId}')">Godkjenn booking</button>`);
            knapper.push(`<button class="action-btn danger" onclick="avvis('${b.ordreId}')">Avvis</button>`);
        }

        if (['godkjent','aktiv','venter_godkjenning_retur'].includes(b.status)) {
            knapper.push(`<button class="action-btn tekst" onclick="sendLenkerIgjen('${b.ordreId}')">Send lenker på nytt</button>`);
        }

        if (b.status === 'venter_godkjenning_retur') {
            knapper.push(`<button class="action-btn success" onclick="godkjennRetur('${b.ordreId}')">Godkjenn retur (frigi depositum)</button>`);
            knapper.push(`<button class="action-btn warning" onclick="registrerSkade('${b.ordreId}')">Registrer skade</button>`);
        }

        if (knapper.length === 0) return '';
        return `<div class="actions-rad">${knapper.join('')}</div>`;
    }

    // ----- Actions -----
    window.godkjenn = async function(ordreId) {
        if (!confirm('Godkjenn denne bookingen? Kunden får SMS med lenker til henting/levering, og koden blir låst opp etter at innsjekk-bilder er tatt.')) return;
        try {
            const res = await api(`/api/admin/godkjenn/${ordreId}`, { method: 'POST' });
            const data = await res.json();
            if (!res.ok) { alert('Feil: ' + data.feil); return; }
            alert('Godkjent! Kode generert: ' + data.kode + ' (sendes til kunde først etter innsjekk-bilder)');
            lukkDetalj();
            lastData();
        } catch (e) { alert('Feil: ' + e.message); }
    };

    window.avvis = async function(ordreId) {
        const begrunnelse = prompt('Begrunnelse for avvisning (sendes til kunde via SMS):');
        if (begrunnelse === null) return;
        try {
            const res = await api(`/api/admin/avvis/${ordreId}`, {
                method: 'POST',
                body: JSON.stringify({ begrunnelse })
            });
            const data = await res.json();
            if (!res.ok) { alert('Feil: ' + data.feil); return; }
            alert(data.advarsel || 'Avvist');
            lukkDetalj();
            lastData();
        } catch (e) { alert('Feil: ' + e.message); }
    };

    window.sendLenkerIgjen = async function(ordreId) {
        try {
            const res = await api(`/api/admin/send-lenker-igjen/${ordreId}`, { method: 'POST' });
            if (res.ok) alert('Lenker sendt på nytt');
            else alert('Feil ved sending');
        } catch (e) { alert('Feil: ' + e.message); }
    };

    window.godkjennRetur = async function(ordreId) {
        const notater = prompt('Notater (valgfritt - blir lagret):') || '';
        try {
            const res = await api(`/api/admin/godkjenn-retur/${ordreId}`, {
                method: 'POST',
                body: JSON.stringify({ notater })
            });
            if (res.ok) {
                alert('Retur godkjent. Husk å frigjøre depositum manuelt i Vipps.');
                lukkDetalj();
                lastData();
            }
        } catch (e) { alert('Feil: ' + e.message); }
    };

    window.registrerSkade = async function(ordreId) {
        const beskrivelse = prompt('Beskrivelse av skade:');
        if (!beskrivelse) return;
        const beloep = prompt('Beløp som skal belastes (kr):');
        if (!beloep || isNaN(parseInt(beloep))) return;
        try {
            const res = await api(`/api/admin/registrer-skade/${ordreId}`, {
                method: 'POST',
                body: JSON.stringify({ beskrivelse, beloep: parseInt(beloep) })
            });
            const data = await res.json();
            if (!res.ok) { alert('Feil: ' + data.feil); return; }
            alert(data.advarsel);
            lukkDetalj();
            lastData();
        } catch (e) { alert('Feil: ' + e.message); }
    };

    // ----- Blokker datoer (med kalender) -----
    let blokkerVisMaaned = new Date();
    let blokkerStart = null;
    let blokkerSlutt = null;
    let blokkerOpptatte = new Set();

    function formaterNorskDato(iso) {
        const [y, m, d] = iso.split('-');
        const maaneder = ['januar','februar','mars','april','mai','juni','juli','august','september','oktober','november','desember'];
        return `${parseInt(d)}. ${maaneder[parseInt(m)-1]} ${y}`;
    }

    function isoDato(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    window.visBlokker = async function() {
        blokkerStart = null;
        blokkerSlutt = null;
        blokkerVisMaaned = new Date();
        document.getElementById('blokkerGrunn').value = '';
        document.getElementById('blokkerValgInfo').style.display = 'none';
        document.getElementById('bekreftBlokkerBtn').disabled = true;

        // Hent opptatte datoer (eksisterende bookinger)
        try {
            const fra = isoDato(new Date());
            const til = new Date();
            til.setMonth(til.getMonth() + 12);
            const tilStr = isoDato(til);
            const res = await fetch(`/api/booking/opptatte-datoer?fra=${fra}&til=${tilStr}`);
            const data = await res.json();
            blokkerOpptatte = new Set(data.opptatte || []);
        } catch (e) {
            blokkerOpptatte = new Set();
        }

        renderBlokkerKalender();
        document.getElementById('blokkerModal').classList.add('synlig');
    };

    window.lukkBlokker = function() {
        document.getElementById('blokkerModal').classList.remove('synlig');
    };

    function renderBlokkerKalender() {
        const aar = blokkerVisMaaned.getFullYear();
        const maaned = blokkerVisMaaned.getMonth();
        const maaneder = ['Januar','Februar','Mars','April','Mai','Juni','Juli','August','September','Oktober','November','Desember'];
        const idag = new Date();
        idag.setHours(0, 0, 0, 0);

        // Første dag i måneden
        const forsteDag = new Date(aar, maaned, 1);
        // Hvilken ukedag (0=søn, 1=man, ..., 6=lør) -> konverter til man=0, søn=6
        let starter = forsteDag.getDay() - 1;
        if (starter < 0) starter = 6;

        const dagerIMaaned = new Date(aar, maaned + 1, 0).getDate();

        let html = `
            <div class="kal-header">
                <button class="kal-nav" onclick="blokkerForrigeMaaned()">‹</button>
                <h4>${maaneder[maaned]} ${aar}</h4>
                <button class="kal-nav" onclick="blokkerNesteMaaned()">›</button>
            </div>
            <div class="kal-ukedager">
                <div>man</div><div>tir</div><div>ons</div><div>tor</div><div>fre</div><div>lør</div><div>søn</div>
            </div>
            <div class="kal-grid">
        `;

        // Tomme celler før starten
        for (let i = 0; i < starter; i++) {
            html += '<div class="kal-dag kal-tom"></div>';
        }

        // Dager i måneden
        for (let dag = 1; dag <= dagerIMaaned; dag++) {
            const dato = new Date(aar, maaned, dag);
            const iso = isoDato(dato);
            
            let klasser = ['kal-dag'];
            
            if (dato < idag) {
                klasser.push('kal-fortid');
            } else if (blokkerOpptatte.has(iso)) {
                klasser.push('kal-opptatt');
            }
            
            if (iso === isoDato(idag)) {
                klasser.push('kal-i-dag');
            }

            // Markér valg
            if (blokkerStart && blokkerSlutt) {
                if (iso >= blokkerStart && iso <= blokkerSlutt) {
                    if (iso === blokkerStart || iso === blokkerSlutt) {
                        klasser.push('kal-valgt');
                    } else {
                        klasser.push('kal-i-omraade');
                    }
                }
            } else if (blokkerStart && iso === blokkerStart) {
                klasser.push('kal-valgt');
            }

            const onclick = (dato >= idag && !blokkerOpptatte.has(iso))
                ? `onclick="velgBlokkerDato('${iso}')"`
                : '';

            html += `<div class="${klasser.join(' ')}" ${onclick}>${dag}</div>`;
        }

        html += '</div>';
        document.getElementById('blokkerKalender').innerHTML = html;
    }

    window.blokkerForrigeMaaned = function() {
        blokkerVisMaaned.setMonth(blokkerVisMaaned.getMonth() - 1);
        renderBlokkerKalender();
    };

    window.blokkerNesteMaaned = function() {
        blokkerVisMaaned.setMonth(blokkerVisMaaned.getMonth() + 1);
        renderBlokkerKalender();
    };

    window.velgBlokkerDato = function(iso) {
        if (!blokkerStart || (blokkerStart && blokkerSlutt)) {
            // Start ny seleksjon
            blokkerStart = iso;
            blokkerSlutt = null;
        } else if (iso < blokkerStart) {
            // Klikket før start - bytt om
            blokkerSlutt = blokkerStart;
            blokkerStart = iso;
        } else if (iso === blokkerStart) {
            // Klikket samme dag - en-dags blokk
            blokkerSlutt = iso;
        } else {
            blokkerSlutt = iso;
        }

        // Sjekk om det er konflikt i området
        if (blokkerStart && blokkerSlutt) {
            for (let d = new Date(blokkerStart); d <= new Date(blokkerSlutt); d.setDate(d.getDate() + 1)) {
                if (blokkerOpptatte.has(isoDato(d))) {
                    alert('Det er allerede bookinger i denne perioden. Velg en annen periode.');
                    blokkerStart = null;
                    blokkerSlutt = null;
                    document.getElementById('blokkerValgInfo').style.display = 'none';
                    document.getElementById('bekreftBlokkerBtn').disabled = true;
                    renderBlokkerKalender();
                    return;
                }
            }
        }

        // Oppdater info
        if (blokkerStart && blokkerSlutt) {
            const dager = Math.round((new Date(blokkerSlutt) - new Date(blokkerStart)) / 86400000) + 1;
            document.getElementById('blokkerPeriodeTekst').textContent = 
                `${formaterNorskDato(blokkerStart)} → ${formaterNorskDato(blokkerSlutt)} (${dager} dag${dager > 1 ? 'er' : ''})`;
            document.getElementById('blokkerValgInfo').style.display = 'block';
            document.getElementById('bekreftBlokkerBtn').disabled = false;
        } else if (blokkerStart) {
            document.getElementById('blokkerPeriodeTekst').textContent = 
                `Start: ${formaterNorskDato(blokkerStart)} - klikk på sluttdato`;
            document.getElementById('blokkerValgInfo').style.display = 'block';
            document.getElementById('bekreftBlokkerBtn').disabled = true;
        }

        renderBlokkerKalender();
    };

    window.bekreftBlokker = async function() {
        if (!blokkerStart || !blokkerSlutt) return;
        const grunn = document.getElementById('blokkerGrunn').value || 'Blokkert av admin';
        
        try {
            const res = await api('/api/admin/blokker-datoer', {
                method: 'POST',
                body: JSON.stringify({ startDato: blokkerStart, sluttDato: blokkerSlutt, grunn })
            });
            const data = await res.json();
            if (!res.ok) {
                if (data.konflikter) {
                    alert('Konflikt med eksisterende booking:\n' + data.konflikter.join('\n'));
                } else {
                    alert('Feil: ' + data.feil);
                }
                return;
            }
            alert(data.melding);
            lukkBlokker();
            lastData();
        } catch (err) {
            alert('Feil: ' + err.message);
        }
    };

    // Slett blokkering fra detaljvisning (når bookingen er BLOKK-*)
    window.slettBlokkering = async function(ordreId) {
        if (!confirm('Fjern blokkeringen?')) return;
        try {
            const res = await api(`/api/admin/blokker-datoer/${ordreId}`, { method: 'DELETE' });
            if (res.ok) {
                alert('Blokkering fjernet');
                lukkDetalj();
                lastData();
            } else {
                const data = await res.json();
                alert('Feil: ' + data.feil);
            }
        } catch (e) { alert('Feil: ' + e.message); }
    };

    // ----- Lightbox -----
    window.visBilde = function(url, tekst) {
        document.getElementById('lightboxBilde').src = url;
        document.getElementById('lightboxTekst').textContent = tekst;
        document.getElementById('lightbox').classList.add('synlig');
    };
    window.lukkLightbox = function() {
        document.getElementById('lightbox').classList.remove('synlig');
    };

    // Init
    if (adminToken) {
        skjulLogin();
        lastData();
    } else {
        visLogin();
    }

    // Auto-oppdater hvert 60. sekund
    setInterval(() => {
        if (adminToken && document.getElementById('hovedinnhold').style.display !== 'none') {
            lastStatistikk();
            if (!document.getElementById('detaljModal').classList.contains('synlig')) {
                lastBookinger();
            }
        }
    }, 60000);
})();
