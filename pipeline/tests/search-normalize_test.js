'use strict';

/**
 * Prüft den Suchindex — die Zusage, auf der die Rangfolge in der App steht.
 *
 *     npm run test:suchindex
 *
 * ## Warum Wortgrenzen
 *
 * Ohne sie sind „Stiel-Eiche" und „Weicher Akanthus" bei der Anfrage „Eiche" ununterscheidbar: In
 * beiden steckt die Zeichenfolge. Erst wenn die App weiß, WO im Wort der Treffer sitzt, kann sie
 * das eine vor das andere sortieren.
 *
 * Der deutsche Sonderfall dahinter: **Im Kompositum steht das Grundwort hinten.** Ein Wort, das auf
 * die Anfrage endet, meint sie meistens — „Stiel-*eiche*" ist eine Eiche, „*Eichen*-blättrige
 * Spiere" ist keine.
 *
 * Kein Netz, keine Daten.
 */

const {
  buildSearchNames, buildSearchTerms, searchNameVariants, normalizeQuery,
} = require('../lib/search-normalize');

let fehler = 0;
const pruefe = (bestanden, text) => {
  if (!bestanden) fehler++;
  console.log(`  ${bestanden ? '✓' : '🔴'} ${text}`);
};
const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('\n=== SUCHINDEX ===');

// ── Wortgrenzen ──────────────────────────────────────────────────────────────

console.log('\nA — Wortgrenzen bleiben, Umlaute werden gefaltet');
const varianten = [
  ['Stiel-Eiche', ['stiel eiche'], 'Bindestrich wird Wortgrenze'],
  ['Stieleiche', ['stieleiche'], 'Kompositum bleibt ein Wort'],
  ['Hängebirke', ['haengebirke', 'hangebirke'], 'beide Umlautvarianten'],
  ['Weißbirke', ['weissbirke'], 'ß wird ss — nicht ersatzlos weg'],
  ['Betula pendula', ['betula pendula'], 'lateinischer Name, ein Leerzeichen'],
  ['Alyssum   minutulum', ['alyssum minutulum'], 'mehrfache Leerzeichen fallen zusammen'],
  ['', [], 'leer'],
];
for (const [ein, erwartet, warum] of varianten) {
  const ist = searchNameVariants(ein);
  pruefe(gleich(ist, erwartet), `${(ein || '(leer)').padEnd(22)} → ${JSON.stringify(ist).padEnd(34)} ${warum}`);
}

// ── Die Trefferklassen, auf die es ankommt ───────────────────────────────────

/**
 * Nicht die Rangfolge selbst (die lebt in der App), sondern ihre Voraussetzung: Lassen sich die
 * vier Fälle an den Suchnamen überhaupt UNTERSCHEIDEN?
 *
 * Vorher konnten sie es nicht — deshalb steht dieser Test hier und nicht nur drüben.
 */
console.log('\nB — Sind die Trefferklassen unterscheidbar?');
const klasse = (suchname, anfrage) => {
  if (suchname === anfrage) return 'name-genau';
  const woerter = suchname.split(' ');
  if (woerter.includes(anfrage)) return 'wort-genau';
  if (woerter.some((w) => w.endsWith(anfrage))) return 'wort-endet';
  if (woerter.some((w) => w.startsWith(anfrage))) return 'wort-beginnt';
  if (woerter.some((w) => w.includes(anfrage))) return 'im-wort';
  return 'kein-treffer';
};
const klassenFaelle = [
  ['Eiche', 'eiche', 'name-genau', 'die Anfrage selbst'],
  ['Stiel Eiche', 'eiche', 'wort-genau', 'Grundwort als eigenes Wort'],
  ['Stieleiche', 'eiche', 'wort-endet', '🔴 der deutsche Kompositumsfall'],
  ['Eichenblättrige Spiere', 'eiche', 'wort-beginnt', 'beginnt mit — ist aber KEINE Eiche'],
  ['Weicher Akanthus', 'eiche', 'im-wort', '🔴 der Falschtreffer, den es zu erkennen gilt'],
  // ⚠️ BEKANNTE GRENZE, absichtlich als Erwartung festgeschrieben:
  // „bleiche" endet auf „eiche". Die Kompositumsregel kann nicht unterscheiden, ob das Wortende
  // ein Grundwort ist oder Zufall — dafuer braeuchte es ein Morphemwoerterbuch. Solche Treffer
  // landen also in derselben Klasse wie echte Eichen.
  //
  // Der Schaden ist begrenzt, weil die zweite Sortierschicht (Bildzahl) innerhalb der Klasse
  // ordnet: Quercus robur (23.544 Bilder) steht vor Stellaria media (16.677). „Bleiche
  // Sternmiere" rutscht damit zwischen die selteneren Eichen, nicht an die Spitze.
  //
  // Wer diesen Test spaeter rot sieht, weil jemand die Regel verfeinert hat: pruefen, ob die
  // Verfeinerung „Stieleiche" noch trifft. Das ist der teurere Fehler.
  ['Bleiche Sternmiere', 'eiche', 'wort-endet', '⚠️ Grenze: „bleiche" endet auch auf „eiche"'],
  ['Rotbuche', 'eiche', 'kein-treffer', 'trifft gar nicht'],
  // Erfreulich: Bei lateinischen Binomen ist die Gattung ein eigenes Wort, also ein EXAKTER
  // Worttreffer — nicht nur ein Wortanfang. „Quercus" landet damit eine Klasse hoeher als gedacht.
  ['Quercus robur', 'quercus', 'wort-genau', 'lateinisch: Gattung ist ein eigenes Wort'],
  ['Waldsteinia ternata', 'waldsteinia ternata', 'name-genau', 'vollstaendiger botanischer Name'],
];
for (const [name, anfrage, erwartet, warum] of klassenFaelle) {
  const suchname = searchNameVariants(name)[0];
  const ist = klasse(suchname, anfrage);
  pruefe(ist === erwartet, `„${anfrage}" in „${name}"`.padEnd(44) + `→ ${ist.padEnd(14)} ${warum}`);
}

// ── Das Altfeld muss mitlaufen ───────────────────────────────────────────────

console.log('\nC — Das Altfeld wird abgeleitet, nicht zweitgebaut');
const namen = ['Stiel-Eiche', 'Stieleiche', 'Hängebirke', 'Quercus robur'];
const sn = buildSearchNames(namen);
const abgeleitet = [...new Set(sn.map((n) => n.replace(/ /g, '')))];
const direkt = buildSearchTerms(namen);
pruefe(gleich(abgeleitet, direkt), `abgeleitet === buildSearchTerms   ${JSON.stringify(abgeleitet)}`);
pruefe(
  abgeleitet.filter((t) => t === 'stieleiche').length === 1,
  '„Stiel-Eiche" und „Stieleiche" fallen zu EINEM Begriff zusammen',
);

// ── Die Anfrage wird gleich normalisiert wie der Index ───────────────────────

console.log('\nD — Anfrage und Index nach derselben Regel');
const paare = [
  ['Haengebirke', 'Hängebirke'],
  ['HÄNGEBIRKE', 'Hängebirke'],
  ['weissbirke', 'Weißbirke'],
];
for (const [anfrage, name] of paare) {
  const q = normalizeQuery(anfrage);
  const terms = buildSearchTerms([name]);
  const trifft = q.some((n) => terms.some((t) => t.includes(n)));
  pruefe(trifft, `„${anfrage}" findet „${name}"`);
}

console.log('\n' + '─'.repeat(70));
console.log(fehler === 0 ? '✓ alles gruen' : `🔴 ${fehler} Pruefung(en) fehlgeschlagen`);
console.log('─'.repeat(70) + '\n');
process.exit(fehler ? 1 : 0);
