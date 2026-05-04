// services/prisService.js - Prisberegning fra database
const config = require('../config/config');

// Hent priser fra database (med fallback til config)
async function hentPriser() {
    try {
        const { getDb } = require('../db/database');
        const db = getDb();
        const rader = await db.all(`SELECT * FROM priser WHERE aktiv = 1 ORDER BY sortering, id`);
        
        if (!rader.length) return null;
        
        const kategorier = rader
            .filter(r => r.type === 'leie' && r.dager)
            .map(r => ({ dager: r.dager, navn: r.navn, pris: r.pris }));
        
        const prisPerEkstraDag = rader.find(r => r.id === 'leie_ekstra')?.pris 
            || config.priser.prisPerEkstraDag;

        const tillegg = rader
            .filter(r => r.type === 'tillegg')
            .map(r => ({ id: r.id, navn: r.navn, pris: r.pris, bilde: r.bilde }));

        const transport = rader
            .filter(r => r.type === 'transport')
            .map(r => ({ id: r.id, navn: r.navn, pris: r.pris }));

        const depositum = rader.find(r => r.id === 'depositum')?.pris 
            || config.priser.depositum;
        
        const mvaSats = rader.find(r => r.id === 'mva_sats')?.pris 
            || config.priser.mvaSats;

        return { kategorier, prisPerEkstraDag, tillegg, transport, depositum, mvaSats };
    } catch (e) {
        console.warn('Kunne ikke lese priser fra database, bruker config:', e.message);
        return null;
    }
}

function beregnLeiepris(antallDager, priser) {
    const { kategorier, prisPerEkstraDag } = priser;
    const sortert = [...kategorier].sort((a, b) => a.dager - b.dager);
    const stoersteKat = sortert[sortert.length - 1];

    const eksakt = sortert.find(k => k.dager === antallDager);
    if (eksakt) return { pris: eksakt.pris, kategori: eksakt.navn, antallDager };

    if (antallDager > stoersteKat.dager) {
        const ekstra = antallDager - stoersteKat.dager;
        return {
            pris: stoersteKat.pris + (ekstra * prisPerEkstraDag),
            kategori: `${stoersteKat.navn} + ${ekstra} dag${ekstra > 1 ? 'er' : ''}`,
            antallDager
        };
    }

    const naermesteMindre = [...sortert].reverse().find(k => k.dager < antallDager);
    const muligheter = [];

    if (naermesteMindre) {
        const ekstra = antallDager - naermesteMindre.dager;
        muligheter.push({
            pris: naermesteMindre.pris + (ekstra * prisPerEkstraDag),
            kategori: `${antallDager} dager (${naermesteMindre.navn.toLowerCase()} + ${ekstra} dag${ekstra > 1 ? 'er' : ''})`,
            antallDager
        });
    }

    const nesteOpp = sortert.find(k => k.dager > antallDager);
    if (nesteOpp) {
        muligheter.push({
            pris: nesteOpp.pris,
            kategori: `${antallDager} dag${antallDager > 1 ? 'er' : ''} (priset som ${nesteOpp.navn.toLowerCase()})`,
            antallDager
        });
    }

    return muligheter.reduce((best, curr) =>
        !best || curr.pris < best.pris ? curr : best, null);
}

async function beregnTotalpris({ antallDager, tilleggIds = [], transportIds = [] }) {
    const dbPriser = await hentPriser();
    const priser = dbPriser || config.priser;

    const leie = beregnLeiepris(antallDager, priser);

    const tilleggLinjer = tilleggIds
        .map(id => priser.tillegg.find(t => t.id === id))
        .filter(Boolean)
        .map(t => ({ navn: `${t.navn} (${antallDager} døgn)`, pris: t.pris * antallDager }));

    const transportLinjer = transportIds
        .map(id => priser.transport.find(t => t.id === id))
        .filter(Boolean)
        .map(t => ({ navn: t.navn, pris: t.pris }));

    const sumEksMva = leie.pris
        + tilleggLinjer.reduce((s, l) => s + l.pris, 0)
        + transportLinjer.reduce((s, l) => s + l.pris, 0);

    const mvaBeloep = Math.round(sumEksMva * priser.mvaSats / 100);
    const sumInkMva = sumEksMva + mvaBeloep;

    return {
        antallDager,
        leie: { navn: leie.kategori, pris: leie.pris },
        tillegg: tilleggLinjer,
        transport: transportLinjer,
        sumEksMva,
        mvaSats: priser.mvaSats,
        mvaBeloep,
        sumInkMva,
        depositum: priser.depositum,
        depositumInkMva: priser.depositum + Math.round(priser.depositum * priser.mvaSats / 100)
    };
}

// Synkron versjon for bakoverkompatibilitet (bruker config direkte)
function beregnTotalprisSync({ antallDager, tilleggIds = [], transportIds = [] }) {
    const priser = config.priser;
    const leie = beregnLeiepris(antallDager, priser);

    const tilleggLinjer = tilleggIds
        .map(id => priser.tillegg.find(t => t.id === id))
        .filter(Boolean)
        .map(t => ({ navn: `${t.navn} (${antallDager} døgn)`, pris: t.pris * antallDager }));

    const transportLinjer = transportIds
        .map(id => priser.transport.find(t => t.id === id))
        .filter(Boolean)
        .map(t => ({ navn: t.navn, pris: t.pris }));

    const sumEksMva = leie.pris
        + tilleggLinjer.reduce((s, l) => s + l.pris, 0)
        + transportLinjer.reduce((s, l) => s + l.pris, 0);

    const mvaBeloep = Math.round(sumEksMva * priser.mvaSats / 100);
    const sumInkMva = sumEksMva + mvaBeloep;

    return {
        antallDager,
        leie: { navn: leie.kategori, pris: leie.pris },
        tillegg: tilleggLinjer,
        transport: transportLinjer,
        sumEksMva,
        mvaSats: priser.mvaSats,
        mvaBeloep,
        sumInkMva,
        depositum: priser.depositum,
        depositumInkMva: priser.depositum + Math.round(priser.depositum * priser.mvaSats / 100)
    };
}

module.exports = { beregnLeiepris, beregnTotalpris, beregnTotalprisSync, hentPriser };
