'use strict';

/**
 * Die strenge Organregel — geprüft an Fällen, deren Bild ich ANGESEHEN habe.
 *
 *     npm run test:organ
 *
 * ## Warum es diesen Test gibt
 *
 * Die naive Fassung traf 17 % der Dateinamen. Die Sichtprüfung zeigte, dass ein Drittel davon
 * falsch war — und zwar systematisch: bei BESCHREIBENDEN SÄTZEN. Ein „flower" im Nebensatz meint
 * nicht das Motiv.
 *
 * Die Fälle unten sind keine erfundenen Beispiele. Es sind echte Commons-Dateien; bei den drei mit
 * ✓✓ markierten habe ich das Bild geöffnet.
 */

const { organAusDateiname } = require('../lib/organ-aus-dateiname');

let fehler = 0;
const pruefe = (bestanden, text, gefunden = '') => {
  if (!bestanden) fehler++;
  console.log(`  ${bestanden ? '✓' : '🔴'} ${text}${gefunden ? `   ${gefunden}` : ''}`);
};

console.log('=== ORGAN AUS DATEINAME ===');
console.log('\nA — strukturierte Namen treffen');
const treffer = [
  // ✓✓ am Bild geprüft: Nahaufnahme von Catalpa-Blättern.
  ['Catalpa bignonioides "Nana" - feuilles.JPG', "Catalpa bignonioides 'Nana'", 'leaf'],
  // ✓✓ am Bild geprüft: eine einzelne gefüllte gelbe Blüte.
  ['Einzelne Blüte Kerria japonica.JPG', "Kerria japonica 'Pleniflora'", 'flower'],
  // ✓✓ am Bild geprüft: ein ganzer blühender Baum vor einem Haus.
  ['Kanzan Cherry Tree.jpg', "Prunus serrulata 'Kanzan'", 'habit'],
  ["Fagus sylvatica 'atropurpurea pendula' leaves 01 by Line1.jpg", "Fagus sylvatica 'Pendula'", 'leaf'],
  ['Fiore di Kerria japonica a fiore doppio.jpg', "Kerria japonica 'Pleniflora'", 'flower'],
];
for (const [datei, taxon, erwartet] of treffer) {
  const r = organAusDateiname(datei, taxon);
  pruefe(r.organ === erwartet, `${erwartet.padEnd(7)} ← ${datei.slice(0, 52)}`, r.organ === erwartet ? '' : `bekam: ${r.organ} (${r.grund})`);
}

console.log('\nB — der Fehlermodus: beschreibende Saetze');
const abgelehnt = [
  // Das Bild zeigt einen KAHLEN WINTERBAUM. Die naive Regel sagte „flower".
  ['2018-02-04 12 49 20 A light glaze of ice and icicles from freezing rain on the flower buds of a Kanzan Cherry.jpg', "Prunus serrulata 'Kanzan'"],
  // Das Bild zeigt BLAETTER. Die naive Regel sagte „flower".
  ['2020-05-04 13 25 22 Sunburst Honey Locust leafing out with developing flowers.jpg', "Gleditsia triacanthos 'Sunburst'"],
  // Das Bild zeigt einen VERSCHNEITEN BAUM mit Autos. Die naive Regel sagte „leaf".
  ['2015-05-07 07 36 15 New foliage covered by a late spring wet snow.jpg', "Prunus serrulata 'Kanzan'"],
];
for (const [datei, taxon] of abgelehnt) {
  const r = organAusDateiname(datei, taxon);
  pruefe(r.organ === null, `abgelehnt: ${datei.slice(0, 50)}`, r.organ ? `bekam: ${r.organ}` : `(${r.grund})`);
}

console.log('\nC — die uebrigen Sperren');
const sperren = [
  ['Catalogue of trees, shrubs, vines and garden plants (1900).jpg', 'Betula pendula', 'kein Pflanzenfoto'],
  ['Birch tree in Veselá, Pelhřimov District.jpg', "Betula pendula 'Youngii'", 'Taxon nicht im Dateinamen'],
  ["Betula pendula 'Youngii' leaf and flower detail.jpg", "Betula pendula 'Youngii'", 'mehrdeutig'],
  ["Betula pendula 'Youngii'.jpg", "Betula pendula 'Youngii'", 'kein Organwort'],
];
for (const [datei, taxon, grund] of sperren) {
  const r = organAusDateiname(datei, taxon);
  pruefe(r.organ === null && r.grund.startsWith(grund.split(' (')[0]),
    `${grund.padEnd(26)} ← ${datei.slice(0, 44)}`, r.organ ? `bekam: ${r.organ}` : `(${r.grund})`);
}

console.log('\n' + '─'.repeat(70));
console.log(fehler === 0 ? '✓ alles gruen' : `🔴 ${fehler} Pruefung(en) fehlgeschlagen`);
console.log('─'.repeat(70) + '\n');
process.exit(fehler ? 1 : 0);
