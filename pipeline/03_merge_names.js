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
  const rl = readline.createInterface({
    input: fs.createReadStream(CONFIG.NAMES_FILE, 'utf8'),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const rec = JSON.parse(line);
    if (rec.gbifKey) byKey.set(rec.gbifKey, rec);
  }
  return byKey;
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
  const plantnet = await loadPlantnetNames();
  log(`  ${fmt(plantnet.size)} Arten mit GBIF-Key`);

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
    const pn = plantnet.get(rec.taxonKey) || null;
    if (pn) joined++;

    const names = {};
    for (const lang of CONFIG.LANGUAGES) {
      const codes = LANGUAGE_ALIASES[lang] || [lang];
      const gbifNames = (rec.vernacularNames || [])
        .filter((v) => codes.includes(v.language))
        .map((v) => v.name);
      const pnNames = pn?.commonNames?.[lang] || [];

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
