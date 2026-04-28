// services/prisService.js - Prisberegning
const config = require('../config/config');

/**
 * Beregner leiepris basert på antall dager.
 * Velger den billigste kombinasjonen for kunden, men sikrer at lengre
 * periode aldri er billigere enn kortere periode (monotonisk prising).
 */
function beregnLeiepris(antallDager) {
    const { kategorier, prisPerEkstraDag } = config.priser;
    const sortert = [...kategorier].sort((a, b) => a.dager - b.dager);
    const stoersteKat = sortert[sortert.length - 1];

    // Eksakt match
    const eksakt = sortert.find(k => k.dager === antallDager);
    if (eksakt) {
        return { pris: eksakt.pris, kategori: eksakt.navn, antallDager };
    }

    // Lengre enn største kategori
    if (antallDager > stoersteKat.dager) {
        const ekstra = antallDager - stoersteKat.dager;
        return {
            pris: stoersteKat.pris + (ekstra * prisPerEkstraDag),
            kategori: `${stoersteKat.navn} + ${ekstra} dag${ekstra > 1 ? 'er' : ''}`,
            antallDager
        };
    }

    // Mellom kategorier - bygg på fra NÆRMESTE mindre kategori
    // (ikke nødvendigvis billigste, fordi det skaper rare hopp)
    const naermesteMindre = [...sortert].reverse().find(k => k.dager < antallDager);
    
    // Alternativer
    const muligheter = [];
    
    // Alt 1: Bygg på fra nærmeste mindre kategori
    if (naermesteMindre) {
        const ekstra = antallDager - naermesteMindre.dager;
        muligheter.push({
            pris: naermesteMindre.pris + (ekstra * prisPerEkstraDag),
            kategori: `${antallDager} dager (${naermesteMindre.navn.toLowerCase()} + ${ekstra} dag${ekstra > 1 ? 'er' : ''})`,
            antallDager
        });
    }

    // Alt 2: Neste kategori opp (kan være billigere f.eks 3 dager til ukepris)
    const nesteOpp = sortert.find(k => k.dager > antallDager);
    if (nesteOpp) {
        muligheter.push({
            pris: nesteOpp.pris,
            kategori: `${antallDager} dag${antallDager > 1 ? 'er' : ''} (priset som ${nesteOpp.navn.toLowerCase()})`,
            antallDager
        });
    }

    // Velg billigste
    return muligheter.reduce((best, curr) => 
        !best || curr.pris < best.pris ? curr : best
    , null);
}

/**
 * Beregner total pris inkludert tillegg og transport.
 * @param {Object} input
 * @param {number} input.antallDager
 * @param {string[]} input.tilleggIds - id-er fra config.priser.tillegg
 * @param {string[]} input.transportIds - id-er fra config.priser.transport  
 * @returns {Object} - detaljert prisoversikt
 */
function beregnTotalpris({ antallDager, tilleggIds = [], transportIds = [] }) {
    const leie = beregnLeiepris(antallDager);

    // Tillegg per døgn
    const tilleggLinjer = tilleggIds
        .map(id => config.priser.tillegg.find(t => t.id === id))
        .filter(Boolean)
        .map(t => ({
            navn: `${t.navn} (${antallDager} døgn)`,
            pris: t.pris * antallDager
        }));

    // Transport - engangskostnad
    const transportLinjer = transportIds
        .map(id => config.priser.transport.find(t => t.id === id))
        .filter(Boolean)
        .map(t => ({ navn: t.navn, pris: t.pris }));

    const sumEksMva = leie.pris 
        + tilleggLinjer.reduce((s, l) => s + l.pris, 0)
        + transportLinjer.reduce((s, l) => s + l.pris, 0);
    
    const mvaBeloep = Math.round(sumEksMva * config.priser.mvaSats / 100);
    const sumInkMva = sumEksMva + mvaBeloep;

    return {
        antallDager,
        leie: { navn: leie.kategori, pris: leie.pris },
        tillegg: tilleggLinjer,
        transport: transportLinjer,
        sumEksMva,
        mvaSats: config.priser.mvaSats,
        mvaBeloep,
        sumInkMva,
        depositum: config.priser.depositum,
        depositumInkMva: config.priser.depositum + Math.round(config.priser.depositum * config.priser.mvaSats / 100)
    };
}

module.exports = { beregnLeiepris, beregnTotalpris };
