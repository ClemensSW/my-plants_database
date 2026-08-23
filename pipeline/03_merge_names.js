#!/usr/bin/env node
'use strict';
/**
 * Schritt 3 (neue Pipeline): Pl@ntNet-Trivialnamen in den Katalog einhängen.
 *
 * Verbindet `species_accepted.ndjson` (Schritt 1) mit `plantnet_names.ndjson`
 * (Schritt 2) über die GBIF-taxonKey. Pl@ntNet hat Vorrang vor den
 * GBIF-`vernacularNames`: die Namen dort sind von Nutzern geprüft und nach
 * Zustimmung sortiert, GBIF sammelt sie ungewichtet aus Fremdquellen.
 *
 * Beide Quellen bleiben im Datensatz sichtbar – wer später eine andere
 * Rangfolge will, braucht die Pipeline nicht neu zu laufen.
 *
 * Output: data/work/species_enriched.ndjson (+ .meta.json)
 *
 * Usage:
 *   node pipeline/03_merge_names.js
 *   node pipeline/03_merge_names.js --languages=de,en
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { DIRS, FILES } = require('./lib/paths');
const { resolveKeys, toLookup } = require('./lib/gbif-key-resolver');

const ROOT = path.join(__dirname, '..');

const CONFIG = {
  LANGUAGES: ['de'],
  CATALOG_FILE: FILES.speciesAccepted,
  NAMES_FILE: FILES.plantnetNames,
  OUT_FILE: FILES.speciesEnriched,
  META_FILE: FILES.speciesEnrichedMeta,
};

/** GBIF nutzt für Deutsch drei Codes nebeneinander. */
const LANGUAGE_ALIASES = {
  de: ['deu', 'ger', 'de'],
  en: ['eng', 'en'],
  fr: ['fra', 'fre', 'fr'],
  es: ['spa', 'es'],
  it: ['ita', 'it'],
  nl: ['nld', 'dut', 'nl'],
};

function parseArgs(argv) {
  const out = {};
  for (const arg of argv.slice(2)) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!m) throw new Error(`Unbekanntes Argument: ${arg}`);
    out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

const fmt = (n) => Number(n).toLocaleString('de-DE');

function normalize(name) {
  return String(name).trim().toLowerCase().replace(/[\s-]+/g, ' ');
}

async function loadPlantnetNames() {
  const byKey = new Map();
  const alle = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(CONFIG.NAMES_FILE, 'utf8'),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const rec = JSON.parse(line);
    if (rec.gbifKey) byKey.set(rec.gbifKey, rec);
    alle.push(rec);
  }
  return { byKey, alle };
}

/**
 * Die Artenliste zweimal indizieren: nach Schlüssel und nach Namen.
 *
 * Beides braucht der Auflöser, und beides steht in derselben Datei — sie zweimal zu lesen wäre
 * ein zweiter Durchgang über 446.842 Zeilen für nichts.
 */
async function loadKatalogIndex() {
  const akzeptiert = new Set();
  const nachName = new Map();
  const rl = readline.createInterface({
    input: fs.createReadStream(CONFIG.CATALOG_FILE, 'utf8'),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const rec = JSON.parse(line);
    akzeptiert.add(String(rec.taxonKey));
    if (rec.canonicalName && !nachName.has(rec.canonicalName)) {
      nachName.set(rec.canonicalName, rec.taxonKey);
    }
  }
  return { akzeptiert, nachName };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.languages) {
    CONFIG.LANGUAGES = String(args.languages).split(',').map((s) => s.trim()).filter(Boolean);
  }
  for (const file of [CONFIG.CATALOG_FILE, CONFIG.NAMES_FILE]) {
    if (!fs.existsSync(file)) throw new Error(`Fehlt: ${file} – vorherigen Schritt laufen lassen.`);
  }

  console.log('='.repeat(64));
  console.log('Schritt 3 (neu): Pl@ntNet-Namen in den Katalog einhängen');
  console.log('='.repeat(64));
  log(`Sprachen: ${CONFIG.LANGUAGES.join(', ')}`);
  console.log();

  log('Lade Pl@ntNet-Namen …');
  const { byKey: plantnetRoh, alle: plantnetAlle } = await loadPlantnetNames();
  log(`  ${fmt(plantnetRoh.size)} Arten mit GBIF-Key`);

  /**
   * Pl@ntNets Schlüssel auf GBIFs heutige übersetzen — BEVOR verknüpft wird.
   *
   * Ohne diesen Schritt fielen am 21.08.2026 gemessen 672 von 12.186 Arten mit deutschem Namen und
   * Bildern still aus dem Katalog, weil ihr `gbifKey` auf einen Datensatz zeigt, den GBIFs Backbone
   * nicht mehr als akzeptierte Art führt. Darunter Prüfungspflanzen. Siehe lib/gbif-key-resolver.js.
   */
  log('Schlüssel gegen GBIF abgleichen …');
  const { akzeptiert, nachName } = await loadKatalogIndex();
  const kandidaten = plantnetAlle
    .filter(r => r.gbifKey || r.plantnetName)
    .map(r => ({ quelle: r.gbifKey ?? `name:${r.plantnetName}`, name: r.plantnetName }));
  const { karte, statistik } = await resolveKeys(kandidaten, akzeptiert, nachName, {
    mapFile: FILES.gbifKeyMap,
    unresolvedFile: FILES.gbifKeyUnresolved,
    log: m => log(`  ${m}`),
    onProgress: (n, gesamt) => process.stdout.write(`\r  ${fmt(n)}/${fmt(gesamt)} …`),
  });
  if (statistik.match || statistik.ohne) process.stdout.write('\r');
  log(`  direkt ${fmt(statistik.direkt)} · über den Namen ${fmt(statistik.name)} · ` +
      `über GBIF ${fmt(statistik.match)} · ohne Treffer ${fmt(statistik.ohne)}`);
  if (statistik.ohne > 0) log(`  ungeklärt stehen in ${FILES.gbifKeyUnresolved}`);
  const lookup = toLookup(karte);

  /**
   * Die Namen unter dem AUFGELÖSTEN Schlüssel ablegen, damit der Join darunter findet.
   *
   * ## Warum hier eine LISTE steht und nicht ein Datensatz
   *
   * Mehrere Pl@ntNet-Arten zeigen regelmäßig auf dieselbe akzeptierte Art — genau das tun
   * Synonyme. `Aconitum vulparia` und `Aconitum moldavicum` sind beide `Aconitum lycoctonum`.
   *
   * Hier stand früher `if (ziel && !plantnet.has(ziel))` — der erste Schreiber gewann, alle
   * weiteren wurden verworfen. Wenn der erste keinen deutschen Namen hatte, blieb das Feld leer,
   * obwohl ein späterer einen hatte:
   *
   *     Antigonon cinerascens  (4034359)  de=[]                          ← gewann, weil zuerst
   *     Antigonon leptopus     (2889355)  de=['Mexikanischer Knöterich'] ← verworfen
   *
   * Am 23.08.2026 gemessen: **283 Ziele** haben mehrere Quellen. Bei **36** davon verlor das Ziel
   * dadurch seinen deutschen Namen komplett; bei den übrigen gingen zusätzliche Namen verloren,
   * die die Suche gebraucht hätte.
   *
   * Der Reihenfolge nach zusammengeführt: Der Datensatz, dessen `gbifKey` das Ziel SELBST ist,
   * steht vorn — seine Namen sind die der Art, nicht die eines Synonyms.
   */
  const plantnetListe = new Map();
  for (const rec of plantnetAlle) {
    const quelle = String(rec.gbifKey ?? `name:${rec.plantnetName}`);
    const ziel = lookup.get(quelle);
    if (!ziel) continue;
    if (!plantnetListe.has(ziel)) plantnetListe.set(ziel, []);
    // Der eigene Datensatz nach vorn, Synonyme dahinter.
    if (String(rec.gbifKey) === String(ziel)) plantnetListe.get(ziel).unshift(rec);
    else plantnetListe.get(ziel).push(rec);
  }
  const mehrfach = [...plantnetListe.values()].filter((v) => v.length > 1).length;
  log(`  verknüpfbar nach Auflösung: ${fmt(plantnetListe.size)} (vorher ${fmt(plantnetRoh.size)})`);
  log(`  davon mit mehreren Pl@ntNet-Quellen: ${fmt(mehrfach)} — deren Namen werden vereinigt`);

  const stats = {};
  for (const lang of CONFIG.LANGUAGES) {
    stats[lang] = {
      fromPlantnet: 0, fromGbif: 0, fromBoth: 0, fromEither: 0,
      onlyPlantnet: 0, onlyGbif: 0, differentPrimary: 0,
    };
  }
  let total = 0;
  let joined = 0;

  const out = fs.createWriteStream(CONFIG.OUT_FILE, { encoding: 'utf8', flags: 'w' });
  const rl = readline.createInterface({
    input: fs.createReadStream(CONFIG.CATALOG_FILE, 'utf8'),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    const rec = JSON.parse(line);
    total++;
    const pnAlle = plantnetListe.get(rec.taxonKey) || [];
    const pn = pnAlle[0] || null;
    if (pn) joined++;

    const names = {};
    for (const lang of CONFIG.LANGUAGES) {
      const codes = LANGUAGE_ALIASES[lang] || [lang];
      const gbifNames = (rec.vernacularNames || [])
        .filter((v) => codes.includes(v.language))
        .map((v) => v.name);
      // Über ALLE Quellen vereinigt, Reihenfolge erhalten, ohne Dubletten. Bei nur einer
      // Quelle ist das Ergebnis identisch zu vorher.
      const pnNames = [...new Set(pnAlle.flatMap((r) => r?.commonNames?.[lang] || []))];

      const s = stats[lang];
      if (pnNames.length) s.fromPlantnet++;
      if (gbifNames.length) s.fromGbif++;
      if (pnNames.length && gbifNames.length) s.fromBoth++;
      if (pnNames.length || gbifNames.length) s.fromEither++;
      if (pnNames.length && !gbifNames.length) s.onlyPlantnet++;
      if (!pnNames.length && gbifNames.length) s.onlyGbif++;
      if (pnNames.length && gbifNames.length
        && normalize(pnNames[0]) !== normalize(gbifNames[0])) s.differentPrimary++;

      if (pnNames.length || gbifNames.length) {
        names[lang] = {
          primary: pnNames[0] || gbifNames[0],
          source: pnNames.length ? 'plantnet' : 'gbif',
          plantnet: pnNames,
          gbif: gbifNames,
        };
      }
    }

    const enriched = { ...rec, commonNames: names };
    delete enriched.vernacularNames;
    enriched.allVernacularNames = rec.vernacularNames || [];
    if (pn) {
      enriched.plantnet = {
        name: pn.plantnetName,
        author: pn.author,
        imagesCount: pn.imagesCount,
        observationsCount: pn.observationsCount,
        /**
         * JEDER Pl@ntNet-Name, der auf diese Art abgebildet wurde.
         *
         * Wer unter einem dieser Namen sucht, meint diese Pflanze — auch wenn GBIF sie inzwischen
         * anders führt. Schritt 07 macht daraus Synonyme, sonst bleibt der gelernte Name
         * unauffindbar: „Waldsteinia ternata" fände `Geum ternatum` nicht, weil Pl@ntNet den Namen
         * nicht als Synonym seiner selbst führt.
         */
        alleNamen: [...new Set(pnAlle.map((r) => r.plantnetName).filter(Boolean))],
      };
    }
    out.write(JSON.stringify(enriched) + '\n');
  }
  await new Promise((resolve) => out.end(resolve));

  const meta = {
    step: '03_merge_names',
    finishedAt: new Date().toISOString(),
    inputs: { catalog: CONFIG.CATALOG_FILE, names: CONFIG.NAMES_FILE },
    rule: 'Pl@ntNet vor GBIF; beide Quellen bleiben erhalten',
    result: { catalogSpecies: total, joinedWithPlantnet: joined, perLanguage: stats },
  };
  fs.writeFileSync(CONFIG.META_FILE, JSON.stringify(meta, null, 2), 'utf8');

  console.log();
  console.log('='.repeat(64));
  log(`Katalogarten:              ${fmt(total)}`);
  log(`mit Pl@ntNet verknüpft:    ${fmt(joined)} (${(100 * joined / total).toFixed(1)} %)`);
  for (const lang of CONFIG.LANGUAGES) {
    const s = stats[lang];
    console.log();
    log(`Sprache "${lang}":`);
    log(`  nur GBIF (bisher):       ${fmt(s.fromGbif)}`);
    log(`  Pl@ntNet:                ${fmt(s.fromPlantnet)}`);
    log(`  beide zusammen:          ${fmt(s.fromEither)}   ` +
      `= +${fmt(s.fromEither - s.fromGbif)} gegenüber GBIF allein`);
    log(`  nur bei Pl@ntNet:        ${fmt(s.onlyPlantnet)}`);
    log(`  nur bei GBIF:            ${fmt(s.onlyGbif)}`);
    log(`  abweichender Erstname:   ${fmt(s.differentPrimary)} von ${fmt(s.fromBoth)} überlappenden`);
  }
  log(`\nOutput: ${CONFIG.OUT_FILE}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('\n❌ Fehler:', err.message);
    console.error(err.stack);
    process.exit(1);
  });
}

module.exports = { main, CONFIG };
