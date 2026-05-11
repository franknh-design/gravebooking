// services/datoUtil.js - Felles datoformatering

function fmtDato(iso) {
    if (!iso) return '';
    const [y, m, d] = String(iso).split('T')[0].split('-');
    if (!y || !m || !d) return iso;
    return `${d}.${m}.${y}`;
}

function fmtPeriode(start, slutt) {
    return `${fmtDato(start)} → ${fmtDato(slutt)}`;
}

module.exports = { fmtDato, fmtPeriode };
