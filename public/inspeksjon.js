// public/inspeksjon.js - Felles logikk for innsjekk og utsjekk
(function() {
    const params = new URLSearchParams(window.location.search);
    const ordreId = params.get('ordre');
    const token = params.get('token');
    
    // Type bestemmes av filnavnet på siden
    const type = window.location.pathname.includes('checkin') ? 'innsjekk' : 'utsjekk';
    const apiBase = `/api/inspeksjon/${type}/${ordreId}/${token}`;
    
    let kategorier = [];
    let booking = null;
    let aktivKategori = null;

    function fmtDato(iso) {
        if (!iso) return '';
        const [y, m, d] = String(iso).split('T')[0].split('-');
        if (!y || !m || !d) return iso;
        return `${d}.${m}.${y}`;
    }

    if (!ordreId || !token) {
        document.body.innerHTML = '<div class="feilside"><h1>Ugyldig lenke</h1><p>Mangler informasjon i URL.</p></div>';
        return;
    }

    function visMelding(tekst, type) {
        const el = document.getElementById('melding');
        if (!el) return;
        if (!tekst) { el.innerHTML = ''; return; }
        el.innerHTML = `<div class="melding ${type}">${tekst}</div>`;
        if (type === 'ok') {
            setTimeout(() => { el.innerHTML = ''; }, 4000);
        }
    }

    async function lastStatus() {
        try {
            const res = await fetch(`${apiBase}/status`);
            if (!res.ok) {
                const data = await res.json();
                document.body.innerHTML = `<div class="feilside"><h1>Ugyldig lenke</h1><p>${data.feil || 'Lenken er ikke gyldig'}</p></div>`;
                return;
            }
            const data = await res.json();
            booking = data.booking;
            kategorier = data.kategorier;
            renderSide(data);
        } catch (err) {
            visMelding('Kunne ikke laste status: ' + err.message, 'feil');
        }
    }

    function renderSide(data) {
        // Header med booking-info
        const header = document.getElementById('booking-info');
        const tittel = type === 'innsjekk' ? 'Bilder ved henting' : 'Bilder ved levering';
        const datoFelt = type === 'innsjekk' ? 'startDato' : 'sluttDato';
        const datoTekst = type === 'innsjekk' ? 'Hentes' : 'Leveres';
        
        header.innerHTML = `
            <h1>${tittel}</h1>
            <p class="kunde">${data.booking.kundeNavn} · Booking ${data.booking.ordreId}</p>
            <p class="dato">${datoTekst}: ${fmtDato(data.booking[datoFelt])}</p>
        `;

        // Hvis allerede fullført, vis melding
        const erFullfoert = type === 'innsjekk' 
            ? data.booking.innsjekkStatus === 'fullfoert'
            : data.booking.utsjekkStatus === 'fullfoert';
        
        if (erFullfoert) {
            document.getElementById('innhold').innerHTML = `
                <div class="ferdig-boks">
                    <div class="ferdig-ikon">✓</div>
                    <h2>${type === 'innsjekk' ? 'Innsjekk' : 'Utsjekk'} er fullført</h2>
                    <p>${type === 'innsjekk' 
                        ? 'Du har fått tilsendt koden på SMS. God leie!' 
                        : 'Takk for retur! Vi sjekker bildene og frigjør depositum så snart som mulig.'}</p>
                </div>
                <h3>Dine bilder</h3>
                <div class="bilder-grid">${renderBilder(data)}</div>
            `;
            return;
        }

        // Ikke fullført - vis kategorier
        renderKategorier(data);
    }

    function renderKategorier(data) {
        const innhold = document.getElementById('innhold');
        const introTekst = type === 'innsjekk' 
            ? 'Ta bilder av maskinen for å dokumentere tilstanden ved henting. Du får koden til nøkkelboksen så snart alle bildene er tatt.'
            : 'Ta bilder av maskinen ved levering. Bildene sammenliknes med bilder fra henting for å vurdere om det er nye skader.';

        let html = `
            <p class="intro">${introTekst}</p>
            <h3>Obligatoriske bilder (${data.kategorier.filter(k => k.opplastet).length}/${data.kategorier.length})</h3>
            <div class="kategorier-grid">
        `;

        data.kategorier.forEach(kat => {
            const klasser = ['kategori-kort'];
            if (kat.opplastet) klasser.push('opplastet');
            html += `
                <div class="${klasser.join(' ')}" onclick="velgKategori('${kat.id}')">
                    ${kat.opplastet ? `<img src="${kat.bilde.thumbnailUrl}" class="thumb" alt="">` : ''}
                    <div class="kat-info">
                        <div class="kat-navn">${kat.navn} ${kat.opplastet ? '✓' : ''}</div>
                        <div class="kat-beskrivelse">${kat.beskrivelse}</div>
                    </div>
                    <div class="kat-status">
                        ${kat.opplastet ? '<span class="status-ok">Endre</span>' : '<span class="status-mangler">Ta bilde →</span>'}
                    </div>
                </div>
            `;
        });

        html += `</div>`;

        // Ekstra-bilder
        html += `
            <h3>Ekstra bilder (valgfritt) ${data.ekstra.length}/4</h3>
            <div class="ekstra-grid">
                ${data.ekstra.map(b => `
                    <div class="ekstra-bilde">
                        <img src="${b.thumbnailUrl}" alt="">
                        <button class="slett-btn" onclick="slettBilde(${b.id})">×</button>
                    </div>
                `).join('')}
                ${data.ekstra.length < 4 ? `
                    <div class="ekstra-bilde legg-til" onclick="velgKategori('ekstra')">
                        <span>+ Legg til</span>
                    </div>
                ` : ''}
            </div>
        `;

        // Fullfør-knapp
        const kanFullfoere = data.kanFullfoere;
        html += `
            <button class="primary fullfoer-knapp" 
                    onclick="fullfoer()" 
                    ${kanFullfoere ? '' : 'disabled'}>
                ${kanFullfoere 
                    ? (type === 'innsjekk' ? 'Bekreft og send – jeg får koden på SMS' : 'Bekreft levering')
                    : `Ta alle ${data.kategorier.length} bildene først (${data.kategorier.filter(k => k.opplastet).length}/${data.kategorier.length})`}
            </button>

            <input type="file" id="fil-input" accept="image/*" capture="environment" style="display:none;" onchange="lastOpp(event)">
        `;

        innhold.innerHTML = html;
    }

    function renderBilder(data) {
        const alle = [
            ...data.kategorier.filter(k => k.opplastet).map(k => ({ ...k.bilde, navn: k.navn })),
            ...data.ekstra.map(b => ({ ...b, navn: 'Ekstra' }))
        ];
        if (alle.length === 0) return '<p>Ingen bilder</p>';
        return alle.map(b => `
            <div class="bilde-vis">
                <img src="${b.thumbnailUrl}" alt="${b.navn}">
                <span>${b.navn}</span>
            </div>
        `).join('');
    }

    window.velgKategori = function(kategori) {
        aktivKategori = kategori;
        document.getElementById('fil-input').click();
    };

    window.lastOpp = async function(event) {
        const fil = event.target.files[0];
        if (!fil || !aktivKategori) return;
        
        // Reset input så samme fil kan velges igjen
        event.target.value = '';

        // Vis lasteindikator
        visMelding(`Laster opp ${aktivKategori}...`, 'info');

        const formData = new FormData();
        formData.append('bilde', fil);
        formData.append('kategori', aktivKategori);

        try {
            const res = await fetch(`${apiBase}/upload`, {
                method: 'POST',
                body: formData
            });
            const data = await res.json();

            if (!res.ok) {
                visMelding(data.feil || 'Opplasting feilet', 'feil');
                return;
            }

            visMelding('Bilde lastet opp!', 'ok');
            await lastStatus();
        } catch (err) {
            visMelding('Nettverksfeil: ' + err.message, 'feil');
        }
    };

    window.slettBilde = async function(bildeId) {
        if (!confirm('Slette dette bildet?')) return;
        try {
            const res = await fetch(`/api/inspeksjon/${type}/${ordreId}/${token}/bilde/${bildeId}`, {
                method: 'DELETE'
            });
            if (res.ok) {
                visMelding('Slettet', 'ok');
                await lastStatus();
            } else {
                const data = await res.json();
                visMelding(data.feil, 'feil');
            }
        } catch (err) {
            visMelding('Feil: ' + err.message, 'feil');
        }
    };

    window.fullfoer = async function() {
        const tekst = type === 'innsjekk' 
            ? 'Bekreft at du har tatt alle bildene? Du får koden på SMS.'
            : 'Bekreft levering? Bildene blir sjekket før depositum frigjøres.';
        if (!confirm(tekst)) return;

        const knapp = document.querySelector('.fullfoer-knapp');
        knapp.disabled = true;
        knapp.textContent = 'Sender...';

        try {
            const res = await fetch(`${apiBase}/fullfoer`, { method: 'POST' });
            const data = await res.json();

            if (!res.ok) {
                visMelding(data.feil || 'Feil', 'feil');
                knapp.disabled = false;
                return;
            }

            // Reload for å vise fullført-skjerm
            await lastStatus();
            window.scrollTo(0, 0);
        } catch (err) {
            visMelding('Nettverksfeil: ' + err.message, 'feil');
            knapp.disabled = false;
        }
    };

    // Start
    lastStatus();
})();
