// services/telefon.js - Felles normalisering og validering av mobilnummer
//
// Vipps eCom v2 krever customerInfo.mobileNumber som 8 sifre UTEN landskode.
// Kunden kan skrive nummeret på mange måter ("+47 916 49 192", "0047916...",
// "91 64 91 92"), så alt normaliseres til ett format før det sendes videre.
//
// MERK: smsService.js har sin egen, løsere normalisering fordi KeySMS også
// skal kunne ta imot utenlandske numre. Denne modulen er strengt norsk-mobil.

/** Fjerner alt som ikke er siffer. */
function renseNummer(nummer) {
    return String(nummer ?? '').replace(/\D/g, '');
}

/**
 * Tolker et norsk mobilnummer.
 * Returnerer { gyldig, nasjonalt, msisdn } der
 *   nasjonalt = 8 sifre (formatet Vipps eCom v2 vil ha)
 *   msisdn    = 47 + 8 sifre (formatet SMS-leverandøren vil ha), null hvis ugyldig
 */
function tolkNorskMobil(nummer) {
    let sifre = renseNummer(nummer);

    // Internasjonalt prefiks: 0047... -> 47...
    if (sifre.startsWith('00')) sifre = sifre.slice(2);

    // Landskode: 4791649192 -> 91649192
    if (sifre.length === 10 && sifre.startsWith('47')) sifre = sifre.slice(2);

    // Norske mobilnumre er 8 sifre og starter på 4 eller 9
    const gyldig = /^[49]\d{7}$/.test(sifre);

    return {
        gyldig,
        nasjonalt: sifre,
        msisdn: gyldig ? '47' + sifre : null
    };
}

module.exports = { renseNummer, tolkNorskMobil };
