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
                { label: 'Totalt', verdi: data.totalBookinger || 0, klasse: '', filter: 'alle' },
                { label: 'Venter faktura', verdi: data.venterFaktura || 0, klasse: 'info', filter: 'venter_faktura,venter_betaling' },
                { label: 'Venter godkjenning', verdi: data.venterGodkjenning || 0, klasse: 'warning', filter: 'venter_godkjenning' },
                { label: 'Aktive', verdi: data.aktive || 0, klasse: 'success', filter: 'godkjent,aktiv' },
                { label: 'Venter retur', verdi: data.venterRetur || 0, klasse: 'warning', filter: 'venter_godkjenning_retur' },
                { label: 'Fullført', verdi: data.fullfoerte || 0, klasse: 'info', filter: 'fullfoert' },
                { label: 'Omsetning', verdi: ((data.totalOmsetning || 0)).toLocaleString('nb-NO') + ' kr', klasse: '', filter: null }
            ];

            document.getElementById('statistikkRad').innerHTML = stats.map(s => `
                <div class="stat-kort ${s.filter ? 'stat-klikkbar' : ''}" 
                     ${s.filter ? `onclick="settFilter('${s.filter}')" title="Filtrer på ${s.label}"` : ''}>
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
                            <span class="booking-meta-item">${fmt(b.startDato)} → ${fmt(b.sluttDato)}</span>
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
            'venter_faktura': 'Venter faktura',
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
                <div class="detalj-rad"><span class="label">Navn:</span><span class="verdi">${b.kundeNavn} ${b.kundeId ? `<a href="#" onclick="lukkDetalj(); visKundeDetalj(${b.kundeId}); return false;" style="margin-left:6px;font-size:0.8rem;">(se kunde)</a>` : ''}</span></div>
                <div class="detalj-rad"><span class="label">Telefon:</span><span class="verdi"><a href="tel:${b.kundeTelefon}">${b.kundeTelefon}</a> · <a href="sms:${b.kundeTelefon}">SMS</a></span></div>
                <div class="detalj-rad"><span class="label">E-post:</span><span class="verdi"><a href="mailto:${b.kundeEpost}">${b.kundeEpost}</a></span></div>
            </div>

            <div class="detalj-seksjon">
                <h3>Booking</h3>
                <div class="detalj-rad"><span class="label">Periode:</span><span class="verdi">${fmt(b.startDato)} → ${fmt(b.sluttDato)} (${b.antallDager} dag${b.antallDager > 1 ? 'er' : ''})</span></div>
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

        // Faktura-håndtering
        if (b.status === 'venter_faktura') {
            knapper.push(`<button class="action-btn primary" onclick="markerFakturaSendt('${b.ordreId}')">Marker faktura sendt</button>`);
            knapper.push(`<button class="action-btn danger" onclick="avvis('${b.ordreId}')">Avvis</button>`);
        }
        
        if (b.status === 'venter_betaling' && b.vippsTransaksjonsId === null) {
            // Faktura sendt, venter på innbetaling
            knapper.push(`<button class="action-btn success" onclick="markerFakturaBetalt('${b.ordreId}')">Marker faktura betalt</button>`);
            knapper.push(`<button class="action-btn danger" onclick="avvis('${b.ordreId}')">Avvis</button>`);
        }

        if (b.status === 'venter_godkjenning') {
            knapper.push(`<button class="action-btn primary" onclick="godkjenn('${b.ordreId}')">Godkjenn booking</button>`);
            knapper.push(`<button class="action-btn danger" onclick="avvis('${b.ordreId}')">Avvis</button>`);
        }

        if (['godkjent','aktiv','venter_godkjenning_retur'].includes(b.status)) {
            knapper.push(`<button class="action-btn tekst" onclick="sendLenkerIgjen('${b.ordreId}')">Send lenker på nytt</button>`);
            if (b.iglohomeKode) {
                knapper.push(`<button class="action-btn tekst" onclick="sendKodeIgjen('${b.ordreId}')">Send kode på SMS</button>`);
                knapper.push(`<button class="action-btn warning" onclick="lagNyKode('${b.ordreId}')">Lag ny kode</button>`);
            }
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

    window.sendKodeIgjen = async function(ordreId) {
        if (!confirm('Send eksisterende låskode på SMS til kunden?')) return;
        try {
            const res = await api(`/api/admin/send-kode-igjen/${ordreId}`, { method: 'POST' });
            const data = await res.json();
            if (!res.ok) {
                alert('Feil: ' + data.feil);
                return;
            }
            alert(data.melding);
        } catch (e) { alert('Feil: ' + e.message); }
    };

    window.lagNyKode = async function(ordreId) {
        const grunn = prompt('Grunn for å generere ny kode:\n\n(F.eks. "Kunde mistenker at andre har sett SMS")');
        if (grunn === null) return;
        if (!confirm('Den gamle koden vil slutte å fungere. Kunden får ny kode på SMS. Fortsette?')) return;
        try {
            const res = await api(`/api/admin/ny-kode/${ordreId}`, {
                method: 'POST',
                body: JSON.stringify({ grunn })
            });
            const data = await res.json();
            if (!res.ok) {
                alert('Feil: ' + data.feil);
                return;
            }
            alert(`${data.melding}\n\nNy kode: ${data.kode}`);
            lukkDetalj();
            lastData();
        } catch (e) { alert('Feil: ' + e.message); }
    };

    window.markerFakturaSendt = async function(ordreId) {
        const fakturanummer = prompt('Fakturanummer (valgfritt):');
        if (fakturanummer === null) return;
        const notat = prompt('Notat (valgfritt - f.eks. "Sendt til frank@firma.no"):') || '';
        try {
            const res = await api(`/api/admin/faktura-sendt/${ordreId}`, {
                method: 'POST',
                body: JSON.stringify({ fakturanummer, notat })
            });
            const data = await res.json();
            if (!res.ok) {
                alert('Feil: ' + data.feil);
                return;
            }
            alert(data.melding);
            lukkDetalj();
            lastData();
        } catch (e) { alert('Feil: ' + e.message); }
    };

    window.markerFakturaBetalt = async function(ordreId) {
        if (!confirm('Bekreft at faktura er betalt? Bookingen flyttes til "venter godkjenning" så du kan godkjenne den og starte leieperioden.')) return;
        try {
            const res = await api(`/api/admin/faktura-betalt/${ordreId}`, { method: 'POST' });
            const data = await res.json();
            if (!res.ok) {
                alert('Feil: ' + data.feil);
                return;
            }
            alert(data.melding);
            lukkDetalj();
            lastData();
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

    // ----- Hjelp -----
    window.visHjelp = function() {
        document.getElementById('hjelpModal').classList.add('synlig');
    };
    window.lukkHjelp = function() {
        document.getElementById('hjelpModal').classList.remove('synlig');
    };

    // ----- Eksport -----
    window.visEksport = function() {
        // Sett standard datoer: første dag i inneværende måned til i dag
        const nå = new Date();
        const førsteDag = new Date(nå.getFullYear(), nå.getMonth(), 1);
        document.getElementById('eksportFra').value = førsteDag.toISOString().split('T')[0];
        document.getElementById('eksportTil').value = nå.toISOString().split('T')[0];
        document.getElementById('eksportStatus').value = '';
        document.getElementById('eksportModal').classList.add('synlig');
    };

    window.lukkEksport = function() {
        document.getElementById('eksportModal').classList.remove('synlig');
    };

    window.lastNedEksport = function() {
        const fra = document.getElementById('eksportFra').value;
        const til = document.getElementById('eksportTil').value;
        const status = document.getElementById('eksportStatus').value;
        const token = adminToken;

        const params = new URLSearchParams({ token });
        if (fra) params.set('fra', fra);
        if (til) params.set('til', til);
        if (status) params.set('status', status);

        window.location.href = `/api/admin/eksport.csv?${params.toString()}`;
        lukkEksport();
    };

    // ----- Priser -----
    window.visPriser = async function() {
        document.getElementById('priserModal').classList.add('synlig');
        await lastPriser();
    };

    window.lukkPriser = function() {
        document.getElementById('priserModal').classList.remove('synlig');
    };

    async function lastPriser() {
        try {
            const res = await api('/api/admin/priser');
            const priser = await res.json();
            renderPriser(priser);
        } catch (e) { console.error(e); }
    }

    function renderPriser(priser) {
        const leie = priser.filter(p => p.type === 'leie' && p.dager);
        const ekstra = priser.find(p => p.id === 'leie_ekstra');
        const tillegg = priser.filter(p => p.type === 'tillegg');
        const transport = priser.filter(p => p.type === 'transport');
        const depositum = priser.find(p => p.id === 'depositum');
        const mva = priser.find(p => p.id === 'mva_sats');

        const prisRad = (p, enhet = 'kr eks mva') => `
            <div class="pris-redigerings-rad" data-id="${p.id}">
                <span class="pris-navn">${p.navn}</span>
                <div class="pris-input-gruppe">
                    <input type="number" class="pris-input" value="${p.pris}" min="0" 
                        onchange="oppdaterPris('${p.id}', this.value)">
                    <span class="pris-enhet">${enhet}</span>
                </div>
            </div>
        `;

        document.getElementById('priserInnhold').innerHTML = `
            <div class="pris-seksjon">
                <h3>Leiepriser (eks mva)</h3>
                ${leie.map(p => prisRad(p)).join('')}
                ${ekstra ? prisRad(ekstra) : ''}
            </div>

            <div class="pris-seksjon">
                <h3>Tilleggsutstyr (per døgn, eks mva)</h3>
                ${tillegg.map(p => `
                    <div class="pris-redigerings-rad" data-id="${p.id}">
                        <span class="pris-navn">${p.navn}</span>
                        <div class="pris-input-gruppe">
                            <input type="number" class="pris-input" value="${p.pris}" min="0"
                                onchange="oppdaterPris('${p.id}', this.value)">
                            <span class="pris-enhet">kr/døgn</span>
                            <button class="action-btn danger liten" onclick="slettPris('${p.id}')">Slett</button>
                        </div>
                    </div>
                `).join('')}
                <button class="action-btn tekst" onclick="leggTilTillegg()" style="margin-top:8px;">+ Legg til tillegg</button>
            </div>

            <div class="pris-seksjon">
                <h3>Bringing og henting (per gang, eks mva)</h3>
                ${transport.map(p => prisRad(p, 'kr/gang')).join('')}
            </div>

            <div class="pris-seksjon">
                <h3>Andre innstillinger</h3>
                ${depositum ? prisRad(depositum, 'kr eks mva') : ''}
                ${mva ? `
                    <div class="pris-redigerings-rad">
                        <span class="pris-navn">MVA-sats</span>
                        <div class="pris-input-gruppe">
                            <input type="number" class="pris-input" value="${mva.pris}" min="0" max="100"
                                onchange="oppdaterPris('${mva.id}', this.value)">
                            <span class="pris-enhet">%</span>
                        </div>
                    </div>
                ` : ''}
            </div>

            <div style="background: #fff8e1; border: 1px solid #ffe082; border-radius: 8px; padding: 12px; font-size: 0.85rem; color: #795548; margin-top: 8px;">
                ⚠️ Prisendringer gjelder kun for nye bookinger. Eksisterende bookinger beholder opprinnelig pris.
            </div>
        `;
    }

    window.oppdaterPris = async function(id, verdi) {
        try {
            const res = await api(`/api/admin/pris/${id}`, {
                method: 'PATCH',
                body: JSON.stringify({ pris: Number(verdi) })
            });
            const data = await res.json();
            if (!res.ok) alert('Feil: ' + data.feil);
        } catch (e) { alert('Feil: ' + e.message); }
    };

    window.slettPris = async function(id) {
        if (!confirm('Slette dette tillegget?')) return;
        try {
            const res = await api(`/api/admin/pris/${id}`, { method: 'DELETE' });
            if (res.ok) lastPriser();
            else {
                const d = await res.json();
                alert('Feil: ' + d.feil);
            }
        } catch (e) { alert('Feil: ' + e.message); }
    };

    window.leggTilTillegg = async function() {
        const navn = prompt('Navn på tillegg:');
        if (!navn) return;
        const pris = prompt('Pris per døgn (eks mva):');
        if (!pris || isNaN(pris)) return;
        const id = navn.toLowerCase().replace(/[^a-z0-9]/g, '_');
        try {
            const res = await api('/api/admin/pris', {
                method: 'POST',
                body: JSON.stringify({ id, type: 'tillegg', navn, pris: Number(pris) })
            });
            const data = await res.json();
            if (res.ok) lastPriser();
            else alert('Feil: ' + data.feil);
        } catch (e) { alert('Feil: ' + e.message); }
    };

    // ----- Kunder -----
    window.visKunder = function() {
        document.getElementById('kunderModal').classList.add('synlig');
        document.getElementById('kundeSoek').value = '';
        lastKunder();
    };

    window.lukkKunder = function() {
        document.getElementById('kunderModal').classList.remove('synlig');
    };

    window.lastKunder = async function() {
        const soek = document.getElementById('kundeSoek').value.trim();
        const url = soek ? `/api/admin/kunder?soek=${encodeURIComponent(soek)}` : '/api/admin/kunder';
        
        try {
            const res = await api(url);
            const kunder = await res.json();
            renderKundeListe(kunder);
        } catch (e) { console.error(e); }
    };

    function renderKundeListe(kunder) {
        const el = document.getElementById('kundeListe');
        if (!kunder.length) {
            el.innerHTML = '<div style="text-align:center;padding:30px;color:var(--tekst-muted);">Ingen kunder funnet</div>';
            return;
        }

        el.innerHTML = kunder.map(k => `
            <div class="booking-rad" onclick="visKundeDetalj(${k.id})" style="grid-template-columns: 1fr auto auto;">
                <div class="booking-info">
                    <div class="booking-tittel">
                        ${k.navn}
                        ${k.blokkert ? '<span class="status-pille status-avbrutt" style="margin-left:6px;">Blokkert</span>' : ''}
                    </div>
                    <div class="booking-meta">
                        <span class="booking-meta-item">${k.epost}</span>
                        <span class="booking-meta-item">${k.telefon}</span>
                        ${k.firma ? `<span class="booking-meta-item">${k.firma}</span>` : ''}
                        ${k.antallSkader > 0 ? `<span class="booking-meta-item" style="color:var(--feil);">⚠ ${k.antallSkader} skade(r)</span>` : ''}
                    </div>
                </div>
                <div style="text-align:right;font-size:0.85rem;">
                    <div>${k.totalBookinger || 0} bookinger</div>
                    <div style="color:var(--tekst-muted);">${(k.totalOmsetning || 0).toLocaleString('nb-NO')} kr</div>
                </div>
            </div>
        `).join('');
    }

    window.visKundeDetalj = async function(kundeId) {
        try {
            const res = await api(`/api/admin/kunde/${kundeId}`);
            const k = await res.json();
            renderKundeDetalj(k);
            document.getElementById('kundeDetaljModal').classList.add('synlig');
        } catch (e) { alert('Feil: ' + e.message); }
    };

    window.lukkKundeDetalj = function() {
        document.getElementById('kundeDetaljModal').classList.remove('synlig');
    };

    function renderKundeDetalj(k) {
        const html = `
            <div class="detalj-header">
                <div>
                    <div class="detalj-tittel">${k.navn}</div>
                    <div style="font-size:0.85rem;color:var(--tekst-muted);">Kunde #${k.id}</div>
                </div>
                <button class="lukk-btn" onclick="lukkKundeDetalj()">×</button>
            </div>

            ${k.blokkert ? `
                <div style="background:var(--feil-bg);color:var(--feil);padding:10px 14px;border-radius:8px;margin-bottom:14px;">
                    <strong>BLOKKERT</strong> ${k.blokkertGrunn ? '— ' + k.blokkertGrunn : ''}
                </div>
            ` : ''}

            <div class="detalj-seksjon">
                <h3>Kontakt</h3>
                <div class="detalj-rad"><span class="label">E-post:</span><span class="verdi"><a href="mailto:${k.epost}">${k.epost}</a></span></div>
                <div class="detalj-rad"><span class="label">Telefon:</span><span class="verdi"><a href="tel:${k.telefon}">${k.telefon}</a> · <a href="sms:${k.telefon}">SMS</a></span></div>
                <div class="detalj-rad"><span class="label">Kunde siden:</span><span class="verdi">${new Date(k.opprettet).toLocaleDateString('nb-NO')}</span></div>
            </div>

            <div class="detalj-seksjon">
                <h3>Statistikk</h3>
                <div class="detalj-rad"><span class="label">Totalt bookinger:</span><span class="verdi">${k.totalBookinger}</span></div>
                <div class="detalj-rad"><span class="label">Total omsetning:</span><span class="verdi">${(k.totalOmsetning || 0).toLocaleString('nb-NO')} kr</span></div>
                <div class="detalj-rad"><span class="label">Fullførte:</span><span class="verdi">${k.antallFullfoert}</span></div>
                ${k.antallSkader > 0 ? `<div class="detalj-rad"><span class="label">Skader:</span><span class="verdi" style="color:var(--feil);">${k.antallSkader}</span></div>` : ''}
                ${k.sisteBooking ? `<div class="detalj-rad"><span class="label">Siste booking:</span><span class="verdi">${k.sisteBooking}</span></div>` : ''}
            </div>

            <div class="detalj-seksjon">
                <h3>Firmainformasjon (valgfritt)</h3>
                <div class="felt"><label>Firma</label><input type="text" id="kFirma" value="${k.firma || ''}" placeholder="Firmanavn"></div>
                <div class="felt"><label>Org.nr</label><input type="text" id="kOrgNr" value="${k.orgNummer || ''}" placeholder="999999999"></div>
                <div class="felt"><label>Fakturaadresse</label><textarea id="kFakturaadr" placeholder="Gateadresse, postnr, sted">${k.fakturaadresse || ''}</textarea></div>
            </div>

            <div class="detalj-seksjon">
                <h3>Interne notater</h3>
                <textarea id="kNotater" rows="4" placeholder="Notater om denne kunden (kun synlig for admin)" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:0.9rem;">${k.notater || ''}</textarea>
            </div>

            ${k.bookinger && k.bookinger.length > 0 ? `
                <div class="detalj-seksjon">
                    <h3>Bookinghistorikk</h3>
                    ${k.bookinger.map(b => `
                        <div style="padding:8px;background:var(--bg);border-radius:6px;margin-bottom:6px;font-size:0.85rem;cursor:pointer;" 
                             onclick="lukkKundeDetalj(); visDetaljer('${b.ordreId}');">
                            <div style="display:flex;justify-content:space-between;align-items:center;">
                                <div>
                                    <strong>${fmt(b.startDato)} → ${fmt(b.sluttDato)}</strong>
                                    <span class="status-pille status-${b.status}" style="margin-left:6px;">${formaterStatus(b.status)}</span>
                                </div>
                                <div>${b.totalPris.toLocaleString('nb-NO')} kr</div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            ` : ''}

            <div class="actions-rad">
                <button class="action-btn primary" onclick="lagreKunde(${k.id})">Lagre endringer</button>
                ${k.blokkert 
                    ? `<button class="action-btn success" onclick="opphevBlokkering(${k.id})">Opphev blokkering</button>`
                    : `<button class="action-btn danger" onclick="blokkerKunde(${k.id})">Blokker kunde</button>`
                }
            </div>
        `;
        document.getElementById('kundeDetaljInnhold').innerHTML = html;
    }

    window.lagreKunde = async function(kundeId) {
        try {
            const data = {
                firma: document.getElementById('kFirma').value,
                orgNummer: document.getElementById('kOrgNr').value,
                fakturaadresse: document.getElementById('kFakturaadr').value,
                notater: document.getElementById('kNotater').value
            };
            const res = await api(`/api/admin/kunde/${kundeId}`, {
                method: 'PATCH',
                body: JSON.stringify(data)
            });
            if (res.ok) {
                alert('Lagret');
            } else {
                const d = await res.json();
                alert('Feil: ' + d.feil);
            }
        } catch (e) { alert('Feil: ' + e.message); }
    };

    window.blokkerKunde = async function(kundeId) {
        const grunn = prompt('Grunn for blokkering (vises til kunden ved booking-forsøk):');
        if (grunn === null) return;
        try {
            const res = await api(`/api/admin/kunde/${kundeId}`, {
                method: 'PATCH',
                body: JSON.stringify({ blokkert: true, blokkertGrunn: grunn })
            });
            if (res.ok) {
                alert('Kunde blokkert');
                lukkKundeDetalj();
                lastKunder();
            }
        } catch (e) { alert('Feil: ' + e.message); }
    };

    window.opphevBlokkering = async function(kundeId) {
        if (!confirm('Opphev blokkeringen?')) return;
        try {
            const res = await api(`/api/admin/kunde/${kundeId}`, {
                method: 'PATCH',
                body: JSON.stringify({ blokkert: false, blokkertGrunn: null })
            });
            if (res.ok) {
                alert('Blokkering opphevet');
                lukkKundeDetalj();
                lastKunder();
            }
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

    function fmt(iso) {
        if (!iso) return '';
        const [y, m, d] = iso.split('-');
        return `${d}.${m}.${y}`;
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
