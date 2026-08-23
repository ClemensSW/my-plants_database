'use strict';

/**
 * Prüft, was in den Suchindex darf — und was nicht.
 *
 *     npm run test:namen
 *
 * Beide Regeln stammen aus einem einzigen Befund: Die Suche nach „Eiche" lieferte am 23.08.2026
 * **244 Treffer**, von denen ein Viertel keinen Bezug zur Anfrage hatte. Nicht wegen schlechter
 * Sortierung, sondern weil im Index Zeichen standen, die dort nichts zu suchen haben.
 *
 * Kein Netz nötig, keine Daten nötig — reine Funktionen.
 */

const { stripAuthorship, istBrauchbarerName } = require('../lib/botanical-name');

let fehler = 0;
const pruefe = (bestanden, text) => {
  if (!bestanden) fehler++;
  console.log(`  ${bestanden ? '✓' : '🔴'} ${text}`);
};

console.log('\n=== NAMEN FUER DEN SUCHINDEX ===');

// ── Autorenangabe entfernen ──────────────────────────────────────────────────

console.log('\nA — Autorenangabe entfernen');
const autorFaelle = [
  // Die echten Übeltäter: `Schleich.` + `ex` klebt zu `schleichex` → enthält `eiche`
  ['Alyssum minutulum Schleich. ex DC.', 'Alyssum minutulum', 'DER Fall — 58 Falschtreffer bei „Eiche"'],
  ['Lotus alpinus (Ser.) Schleich. ex Ramond', 'Lotus alpinus', 'Alpen-Hornklee — steht im scientificName, nicht in einem Synonym'],
  ['Pyrola intermedia Schleich. ex Arcang.', 'Pyrola intermedia', 'Kleines Wintergrün'],
  // Gewöhnliche Formen
  ['Betula verrucosa Ehrh.', 'Betula verrucosa', 'einfacher Autor'],
  ['Mahonia aquifolium (Pursh) Nutt.', 'Mahonia aquifolium', 'Autor in Klammern'],
  // Was NICHT zerschnitten werden darf
  ['Platanus × hispanica Mill.', 'Platanus × hispanica', 'freistehendes Hybridzeichen bleibt'],
  ['Rosa ×alba L.', 'Rosa ×alba', 'angehängtes Hybridzeichen bleibt'],
  ['Geum ternatum subsp. ternatum', 'Geum ternatum subsp. ternatum', 'Rangkürzel ist kein Autor'],
  ['Betula pendula', 'Betula pendula', 'ohne Autor bleibt unverändert'],
  ['Quercus', 'Quercus', 'ein einziges Wort'],
  ['', '', 'leer'],
];
for (const [ein, erwartet, warum] of autorFaelle) {
  const ist = stripAuthorship(ein);
  pruefe(ist === erwartet, `${(ein || '(leer)').padEnd(40)} → ${(ist || '(leer)').padEnd(30)} ${warum}`);
}

/**
 * Die Gegenprobe, die zählt: Nach dem Kürzen darf `eiche` nicht mehr drinstecken.
 *
 * Sie prüft die WIRKUNG, nicht die Form. Eine Regel, die zufällig anders kürzt, aber die
 * Verklebung stehen lässt, käme hier durch — und der Fehler wäre wieder da.
 */
console.log('\nB — Die Wirkung: keine verklebten Falschtreffer mehr');
const squash = (v) => String(v).toLowerCase().replace(/[^a-z0-9]/g, '');
const uebeltaeter = [
  'Alyssum minutulum Schleich. ex DC.',
  'Lotus alpinus (Ser.) Schleich. ex Ramond',
  'Salix gnaphaloides Schleich. ex Andersson',
  'Poa glaucantha Schleich. ex Gaudin',
];
for (const name of uebeltaeter) {
  const vorher = squash(name).includes('eiche');
  const nachher = squash(stripAuthorship(name)).includes('eiche');
  pruefe(vorher && !nachher, `${name.padEnd(44)} „eiche" vorher: ${vorher} → nachher: ${nachher}`);
}

// ── Unrat aussortieren ───────────────────────────────────────────────────────

console.log('\nC — Unrat aus den Gemeinschaftsdaten');
const namensFaelle = [
  ['Rotbuche', true, 'gewöhnlicher Name'],
  ['Gewöhnliche Hänge-Birke', true, 'lang, mit Bindestrich und Umlaut'],
  ['Bremis Wasserschlauch', true, 'Eigenname im Trivialnamen'],
  ['“(7;7;€;€disproportionierterem Speicherprozesse Hinzustellenden Irish', false, 'Datenmüll bei Viburnum tinus'],
  ['Bremis Wasserschlauch <!-- auch: Zierlicher Wasserschlauch -->', false, 'HTML-Kommentar'],
  ['Liquidambar styraciflua Gumball(Amerikanischer Kugelamberbaum)', false, 'Sortenname mit Klammer'],
  ['"Kamtschatka Heckenkirsche"   Lonicera caerulea var. \'kamtschatica\' !!', false, 'Anmerkung eines Beitragenden'],
  ['Hirschzungenfarn ist Asplenium scolopendrium und kommt auch in unseren Gärten vor', false, 'ganzer Satz'],
  ['', false, 'leer'],
];
for (const [ein, erwartet, warum] of namensFaelle) {
  const ist = istBrauchbarerName(ein);
  const kurz = ein.length > 42 ? ein.slice(0, 39) + '…' : ein || '(leer)';
  pruefe(ist === erwartet, `${kurz.padEnd(44)} → ${String(ist).padEnd(6)} ${warum}`);
}

console.log('\n' + '─'.repeat(70));
console.log(fehler === 0 ? '✓ alles gruen' : `🔴 ${fehler} Pruefung(en) fehlgeschlagen`);
console.log('─'.repeat(70) + '\n');
process.exit(fehler ? 1 : 0);
