'use strict';

/**
 * Prüft den Schlüsselauflöser — die Stelle, an der Pflanzen still aus dem Katalog fallen.
 *
 *     npm run test:aufloeser
 *
 * ## Warum es diesen Test gibt
 *
 * Am 23.08.2026 fehlten **309 Pflanzen** im Katalog, die Pl@ntNet mit deutschem Namen und Bildern
 * führt — darunter das Schmalblättrige Weidenröschen (25.588 Bilder), der Kleine Wiesenknopf und
 * Feldsalat. Sie sind nicht an einer Fehlermeldung gescheitert, sondern an einem stillen `null`:
 * GBIFs `species/match` antwortete auf einer anderen Rangstufe als der Art, der zurückgegebene
 * Schlüssel stand nicht in unserer Artenliste, und der Auflöser gab auf.
 *
 * Ein stiller Verlust wiederholt sich, wenn ihn nichts laut macht. Dieser Test macht ihn laut.
 *
 * ## Zwei Teile
 *
 * **A — ohne Netz.** Die Sperre gegen Raten: Wann darf aus Gattung + Epitheton ein Artname gebaut
 * werden? Ein erfundener Name, der zufällig in der Artenliste steht, hängt die Bilder einer Art an
 * eine andere, und das fällt niemandem auf.
 *
 * **B — mit Netz.** Sechs echte Fälle gegen GBIF, je einer für jede Rangstufe, auf der GBIF
 * antworten kann. Kostet sechs Anfragen; GBIF hat kein Kontingent für diesen Pfad.
 *
 * ⚠️ **Teil B braucht `data/raw/gbif/species_accepted.ndjson`.** Fehlt die Datei, wird B
 * übersprungen und der Test meldet das — statt grün zu melden, weil er nichts geprüft hat.
 */

const fs = require('fs');
const path = require('path');
const { resolveKeys, artepitheton } = require('../lib/gbif-key-resolver');

const WURZEL = path.join(__dirname, '..', '..');
const ARTENLISTE = path.join(WURZEL, 'data', 'raw', 'gbif', 'species_accepted.ndjson');

let fehler = 0;
const pruefe = (bestanden, text, gefunden = '') => {
  if (!bestanden) fehler++;
  console.log(`  ${bestanden ? '✓' : '🔴'} ${text}${gefunden ? `   ${gefunden}` : ''}`);
};

// ── A: Die Sperre gegen Raten (ohne Netz) ────────────────────────────────────

const teilA = () => {
  console.log('\nA — Artepitheton: wann darf geraten werden?');
  const faelle = [
    ['Waldsteinia ternata', 'ternata', 'echter Zweiwortname'],
    ['Epilobium angustifolium', 'angustifolium', 'echter Zweiwortname'],
    ['Crataegus × lavalleei', null, 'Hybrid — das × ist kein Epitheton'],
    ['Crataegus x lavalleei', null, 'Hybrid in ASCII-Schreibweise'],
    ['Geum ternatum subsp. ternatum', null, 'Rangzusatz — letztes Wort ist nicht die Art'],
    ['Quercus', null, 'nur die Gattung'],
    ['Rosa canina L.', null, 'mit Autorenangabe'],
  ];
  for (const [name, erwartet, warum] of faelle) {
    const ist = artepitheton(name);
    pruefe(ist === erwartet, `${name.padEnd(30)} → ${String(ist).padEnd(15)} (${warum})`);
  }
};

// ── B: Die Kaskade gegen echte GBIF-Antworten ────────────────────────────────

const teilB = async () => {
  console.log('\nB — Die Kaskade gegen GBIF');

  if (!fs.existsSync(ARTENLISTE)) {
    console.log(`  ⚠️  ÜBERSPRUNGEN — ${path.relative(WURZEL, ARTENLISTE)} fehlt.`);
    console.log('      Ohne Artenliste prueft dieser Teil nichts. Erst `npm run pipeline:species`.');
    return;
  }

  const akzeptiert = new Set();
  const nachName = new Map();
  for (const zeile of fs.readFileSync(ARTENLISTE, 'utf8').split('\n')) {
    if (!zeile.trim()) continue;
    const d = JSON.parse(zeile);
    akzeptiert.add(String(d.taxonKey));
    if (d.canonicalName && !nachName.has(d.canonicalName)) nachName.set(d.canonicalName, d.taxonKey);
  }
  console.log(`  (${akzeptiert.size.toLocaleString('de-DE')} akzeptierte Arten geladen)\n`);

  /**
   * Je ein Fall für jede Rangstufe, auf der GBIF antworten kann.
   *
   * Der letzte ist der wichtigste: Er MUSS ungeklärt bleiben. Ein Auflöser, der immer etwas
   * findet, findet auch das Falsche — und ein falscher Treffer ist schlimmer als keiner.
   */
  const faelle = [
    { quelle: '2986317', name: 'Waldsteinia ternata', ziel: 'Geum ternatum', via: 'artname',
      warum: 'GBIF antwortet mit der UNTERART' },
    { quelle: '8053718', name: 'Epilobium angustifolium', ziel: 'Chamaenerion angustifolium', via: 'gattung',
      warum: 'GBIF antwortet nur mit der GATTUNG' },
    { quelle: '4094753', name: 'Valeriana rubra', ziel: 'Centranthus ruber', via: 'artname',
      warum: 'Synonym, andere Gattung' },
    { quelle: '3029430', name: 'Sanguisorba minor', ziel: 'Poterium sanguisorba', via: 'artname',
      warum: 'Synonym, andere Gattung' },
    { quelle: '2986316', name: 'Crataegus × lavalleei', ziel: 'Crataegus lavallei', via: 'match',
      warum: 'Hybrid — GBIF liefert den Schluessel direkt, Stufe 3 genuegt' },
    { quelle: '7298919', name: 'Valeriana locusta', ziel: null, via: 'ohne',
      warum: '🔴 MUSS scheitern: GBIF antwortet nur mit der FAMILIE' },
  ];

  const { karte } = await resolveKeys(faelle, akzeptiert, nachName, { concurrency: 3 });
  const nachSchluessel = new Map([...nachName].map(([n, k]) => [k, n]));

  for (const f of faelle) {
    const r = karte.get(f.quelle);
    const zielName = r && r.ziel ? nachSchluessel.get(r.ziel) : null;
    const bestanden = zielName === f.ziel && (!r || r.via === f.via);
    pruefe(
      bestanden,
      `${f.name.padEnd(26)} → ${String(zielName || `ohne (Rang ${r && r.rang})`).padEnd(30)} via ${r ? r.via : '?'}`,
      bestanden ? '' : `erwartet: ${f.ziel || 'ohne'} via ${f.via}`,
    );
    if (!bestanden) console.log(`        (${f.warum})`);
  }
};

// ── C: Die Sammelart ─────────────────────────────────────────────────────────
//
// Anlass: Pl@ntNet fuehrt den Loewenzahn als `Taraxacum sect. Taraxacum`. GBIFs `species/match`
// antwortet darauf mit der GATTUNG — richtig, aber unbrauchbar, denn eine Gattung hat bei uns
// keine Bilder. Die 16.932 Loewenzahnbilder hingen an nichts.

const teilC = async () => {
  const { hatRangmarke, gattungVon, searchSammelart } = require('../lib/gbif-key-resolver');

  console.log('\nC — Sammelart: Rangmarke erkennen');
  for (const n of ['Taraxacum sect. Taraxacum', 'Rubus fruticosus agg.',
                   'Achillea ser. Millefolium', 'Carex subg. Carex']) {
    pruefe(hatRangmarke(n) === true, `Rangmarke erkannt: ${n}`);
  }
  // 🔴 subsp./var./f. stehen UNTERHALB der Art. Sie ueber species/search auf eine Art zu ziehen
  // waere kein Aufloesen, sondern ein Einebnen — die Unterart verloere ihre Identitaet.
  for (const n of ['Betula pendula', 'Quercus robur subsp. robur',
                   'Buxus sempervirens var. arborescens', 'Fagus sylvatica f. purpurea',
                   'Crataegus × lavalleei']) {
    pruefe(hatRangmarke(n) === false, `KEINE Rangmarke: ${n}`);
  }
  pruefe(gattungVon('Taraxacum sect. Taraxacum') === 'Taraxacum', 'Gattung aus dem Namen');
  pruefe(gattungVon('× Amarcrinum memoria-corsii') === 'Amarcrinum',
         'Gattung trotz freistehendem Hybridzeichen');

  if (process.env.OHNE_NETZ === '1') {
    console.log('  … Netzteil uebersprungen (OHNE_NETZ=1)');
    return;
  }

  console.log('\nC — Sammelart: der echte Loewenzahn (mit Netz)');
  const t = await searchSammelart('Taraxacum sect. Taraxacum', {});
  pruefe(!!t && t.species === 'Taraxacum officinale',
         'species/search findet Taraxacum officinale', t ? t.species : 'nichts');
  // 🔴 Der BACKBONE-Schluessel, nicht der Checklisten-Schluessel. Ohne die Bindung an
  // `datasetKey` antwortet GBIF mit 266900909 aus einer fremden Checkliste; unser Katalog kennt
  // nur 5394163 — die Art fiele still heraus, obwohl sie gefunden wurde.
  pruefe(!!t && Number(t.key) === 5394163,
         'Backbone-Schluessel 5394163, nicht der Checklisten-Schluessel',
         t ? String(t.key) : 'nichts');

  // Die Sperre: was nicht zur Gattung passt, darf nicht durchkommen.
  const fremd = await searchSammelart('Taraxacum sect. Erythrosperma', {});
  pruefe(fremd === null || String(fremd.species || '').startsWith('Taraxacum'),
         'fremde Gattung wird verworfen', fremd ? fremd.species : 'nichts');
};

(async () => {
  console.log('=== SCHLUESSELAUFLOESER ===');
  teilA();
  await teilB();
  await teilC();
  console.log('\n' + '─'.repeat(70));
  console.log(fehler === 0 ? '✓ alles gruen' : `🔴 ${fehler} Pruefung(en) fehlgeschlagen`);
  console.log('─'.repeat(70) + '\n');
  process.exit(fehler ? 1 : 0);
})();
