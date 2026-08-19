#!/usr/bin/env node
'use strict';
/**
 * Schritt 1 (neue Pipeline): Vollständiger akzeptierter Artbestand aus dem
 * GBIF-Backbone.
 *
 * Holt ALLE Taxa mit `rank = SPECIES` und `status = ACCEPTED` unterhalb eines
 * Wurzeltaxons (Standard: Plantae, key 6) – ohne jede Filterung nach Bildern,
 * Trivialnamen oder Verbreitung. Das Aussortieren passiert in späteren
 * Schritten, damit neue Bildquellen später nachziehen können, ohne dass das
 * Fundament neu gebaut werden muss.
 *
 * Warum in Scheiben?
 *   `species/search` beantwortet `offset >= 100000` mit HTTP 400, und die
 *   Antwortzeit wächst mit dem Offset stark an. Deshalb wird der Taxonbaum
 *   adaptiv zerlegt: Ein Knoten mit mehr als MAX_SLICE Arten wird durch seine
 *   Kinder ersetzt, bis jede Scheibe klein genug ist. Arten, die direkt unter
 *   einem zerlegten Knoten hängen, werden einzeln nachgeladen – sonst würden
 *   sie durch das Raster fallen.
 *
 * Output: data/raw/gbif/species_accepted.ndjson  (+ .meta.json)
 *
 * Usage:
 *   node pipeline/01_fetch_species.js
 *   node pipeline/01_fetch_species.js --max-slice=20000 --concurrency=6
 *   node pipeline/01_fetch_species.js --languages=deu,ger,eng
 *   node pipeline/01_fetch_species.js --plan-only
 *   node pipeline/01_fetch_species.js --fresh
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const {
  BACKBONE_DATASET_KEY,
  PLANTAE_KEY,
  apiGet,
  countAcceptedSpecies,
  searchAcceptedSpecies,
  listChildren,
  getSpeciesWithVernaculars,
  pool,
} = require('./lib/gbif');
const { DIRS, FILES } = require('./lib/paths');

// ---------------------------------------------------------------- Konfiguration

const ROOT = path.join(__dirname, '..');

const CONFIG = {
  ROOT_KEY: PLANTAE_KEY,
  ROOT_NAME: null, // wird zur Laufzeit aus dem Backbone gelesen
  // Obergrenze für eine Scheibe. Gemessen: Seiten mit Offset < 5.000 antworten
  // in unter 2 s, ab Offset 10.000 dauern sie ~30 s. Deshalb 5.000 – so bleibt
  // jeder Offset flach. Siehe README, Abschnitt "Warum 5.000".
  MAX_SLICE: 5000,
  PAGE_SIZE: 1000,
  CONCURRENCY: 5,
  // Sprachcodes der zu behaltenden Trivialnamen. Leer = alle behalten.
  LANGUAGES: [],
  OUT_DIR: DIRS.rawGbif,
  OUT_FILE: FILES.speciesAccepted,
  META_FILE: FILES.speciesAcceptedMeta,
  STATE_DIR: DIRS.state,
  PLAN_FILE: FILES.stateStep1Plan,
  DONE_FILE: FILES.stateStep1Done,
};

/** Ränge, unterhalb derer keine Art mehr liegen kann – dort nicht weitersuchen. */
const SPECIES_OR_BELOW = new Set([
  'SPECIES', 'SUBSPECIES', 'VARIETY', 'SUBVARIETY', 'FORM', 'SUBFORM',
  'CULTIVAR', 'CULTIVAR_GROUP', 'CONVARIETY', 'STRAIN',
  'INFRASPECIFIC_NAME', 'INFRASUBSPECIFIC_NAME',
]);

// ------------------------------------------------------------------- Hilfsmittel

function parseArgs(argv) {
  const out = {};
  for (const arg of argv.slice(2)) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!match) throw new Error(`Unbekanntes Argument: ${arg}`);
    out[match[1]] = match[2] === undefined ? true : match[2];
  }
  return out;
}

function applyArgs(args) {
  if (args['root-key']) CONFIG.ROOT_KEY = Number(args['root-key']);
  if (args['max-slice']) CONFIG.MAX_SLICE = Number(args['max-slice']);
  if (args.concurrency) CONFIG.CONCURRENCY = Number(args.concurrency);
  if (args['page-size']) CONFIG.PAGE_SIZE = Number(args['page-size']);
  if (args.languages) {
    CONFIG.LANGUAGES = String(args.languages).split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (args.out) {
    CONFIG.OUT_FILE = path.resolve(args.out);
    const stem = CONFIG.OUT_FILE.replace(/\.ndjson$/, '');
    CONFIG.META_FILE = `${stem}.meta.json`;
    CONFIG.OUT_DIR = path.dirname(CONFIG.OUT_FILE);
    // Zustand folgt dem Output, sonst überschreibt ein Testlauf den echten.
    CONFIG.STATE_DIR = path.join(CONFIG.OUT_DIR, '.state');
    CONFIG.PLAN_FILE = path.join(CONFIG.STATE_DIR, `${path.basename(stem)}_plan.json`);
    CONFIG.DONE_FILE = path.join(CONFIG.STATE_DIR, `${path.basename(stem)}_done.json`);
  }
  if (CONFIG.PAGE_SIZE > 1000) throw new Error('page-size > 1000 lehnt die GBIF-API ab.');
  if (CONFIG.MAX_SLICE >= 100000) {
    throw new Error('max-slice muss unter 100000 liegen – darüber antwortet species/search mit HTTP 400.');
  }
}

function log(msg) {
  const now = new Date().toISOString().slice(11, 19);
  console.log(`[${now}] ${msg}`);
}

function fmt(n) {
  return Number(n).toLocaleString('de-DE');
}

function ensureDirs() {
  fs.mkdirSync(CONFIG.OUT_DIR, { recursive: true });
  fs.mkdirSync(CONFIG.STATE_DIR, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

// ------------------------------------------------------------- Datensatz-Aufbau

/** Wandelt eine GBIF-NameUsage in unsere Katalogzeile. */
function toRecord(usage) {
  const vernaculars = [];
  const seen = new Set();
  for (const entry of usage.vernacularNames || []) {
    const name = (entry.vernacularName || '').trim();
    if (!name) continue;
    const language = entry.language || null;
    if (CONFIG.LANGUAGES.length && !CONFIG.LANGUAGES.includes(language)) continue;
    const dedupeKey = `${language}|${name.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    vernaculars.push({ name, language });
  }

  return {
    taxonKey: usage.key,
    scientificName: usage.scientificName || null,
    canonicalName: usage.canonicalName || null,
    authorship: usage.authorship || null,
    rank: usage.rank || null,
    status: usage.taxonomicStatus || null,
    extinct: typeof usage.extinct === 'boolean' ? usage.extinct : null,
    kingdom: usage.kingdom || null,
    kingdomKey: usage.kingdomKey || null,
    phylum: usage.phylum || null,
    phylumKey: usage.phylumKey || null,
    class: usage.class || null,
    classKey: usage.classKey || null,
    order: usage.order || null,
    orderKey: usage.orderKey || null,
    family: usage.family || null,
    familyKey: usage.familyKey || null,
    genus: usage.genus || null,
    genusKey: usage.genusKey || null,
    numDescendants: typeof usage.numDescendants === 'number' ? usage.numDescendants : null,
    constituentKey: usage.constituentKey || null,
    vernacularNames: vernaculars,
  };
}

// ------------------------------------------------------------------ Planungslauf

/**
 * Zerlegt den Baum adaptiv in Scheiben von höchstens MAX_SLICE Arten.
 * Gibt { slices, singles, rootCount, nodesVisited } zurück.
 */
async function buildPlan() {
  const slices = [];
  const singles = new Set();
  let nodesVisited = 0;

  const rootCount = await countAcceptedSpecies(CONFIG.ROOT_KEY);
  log(`Wurzel ${CONFIG.ROOT_NAME || '?'} (${CONFIG.ROOT_KEY}): ${fmt(rootCount)} akzeptierte Arten`);

  let frontier = [{ key: CONFIG.ROOT_KEY, name: CONFIG.ROOT_NAME, rank: 'ROOT' }];
  let depth = 0;

  while (frontier.length) {
    depth++;
    const counted = await pool(frontier, CONFIG.CONCURRENCY, async (node) => {
      nodesVisited++;
      return { ...node, count: await countAcceptedSpecies(node.key) };
    });

    const tooBig = [];
    for (const node of counted) {
      if (node.count === 0) continue;
      if (node.count <= CONFIG.MAX_SLICE) slices.push(node);
      else tooBig.push(node);
    }

    log(`  Ebene ${depth}: ${fmt(counted.length)} Knoten geprüft, `
      + `${fmt(slices.length)} Scheiben fertig, ${fmt(tooBig.length)} noch zu groß`);

    if (!tooBig.length) break;

    const childLists = await pool(tooBig, CONFIG.CONCURRENCY, async (node) => {
      const children = await listChildren(node.key);
      const expandable = [];
      for (const child of children) {
        const rank = child.rank || '';
        if (rank === 'SPECIES') {
          // Direkt unter einem zerlegten Knoten hängende Art: `highertaxonKey`
          // schließt den Knoten selbst nicht ein, sie käme sonst nie vor.
          if (child.taxonomicStatus === 'ACCEPTED') singles.add(child.key);
          continue;
        }
        if (SPECIES_OR_BELOW.has(rank)) continue;
        expandable.push({ key: child.key, name: child.canonicalName || child.scientificName, rank });
      }
      return expandable;
    });

    frontier = childLists.flat();
  }

  // Deterministische Reihenfolge, damit Läufe vergleichbar bleiben.
  slices.sort((a, b) => a.key - b.key);
  return { slices, singles: [...singles].sort((a, b) => a - b), rootCount, nodesVisited };
}

// ------------------------------------------------------------------ Erntelauf

async function fetchSlice(slice) {
  const records = [];
  let offset = 0;
  for (;;) {
    const data = await searchAcceptedSpecies(slice.key, offset, CONFIG.PAGE_SIZE);
    const results = data.results || [];
    for (const usage of results) records.push(toRecord(usage));
    if (data.endOfRecords || results.length === 0) break;
    offset += CONFIG.PAGE_SIZE;
    if (offset >= 100000) {
      log(`  ⚠ Scheibe ${slice.name} (${slice.key}) überschreitet das Offset-Limit `
        + `– mit kleinerem --max-slice erneut laufen lassen.`);
      break;
    }
  }
  return records;
}

function appendRecords(records) {
  if (!records.length) return;
  const payload = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  fs.appendFileSync(CONFIG.OUT_FILE, payload, 'utf8');
}

// -------------------------------------------------------------------- Prüflauf

/** Zählt Zeilen und eindeutige taxonKeys; entfernt Dubletten, falls vorhanden. */
async function verifyAndDedupe(expectedCount) {
  const keys = new Set();
  let lines = 0;
  let duplicates = 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(CONFIG.OUT_FILE, 'utf8'),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    lines++;
    const key = JSON.parse(line).taxonKey;
    if (keys.has(key)) duplicates++;
    else keys.add(key);
  }

  if (duplicates > 0) {
    log(`Dubletten gefunden (${fmt(duplicates)}) – Datei wird bereinigt.`);
    const tmp = `${CONFIG.OUT_FILE}.dedupe`;
    const out = fs.createWriteStream(tmp, { encoding: 'utf8' });
    const seen = new Set();
    const rl2 = readline.createInterface({
      input: fs.createReadStream(CONFIG.OUT_FILE, 'utf8'),
      crlfDelay: Infinity,
    });
    for await (const line of rl2) {
      if (!line.trim()) continue;
      const key = JSON.parse(line).taxonKey;
      if (seen.has(key)) continue;
      seen.add(key);
      out.write(line + '\n');
    }
    await new Promise((resolve) => out.end(resolve));
    fs.renameSync(tmp, CONFIG.OUT_FILE);
    lines = seen.size;
  }

  return { lines, unique: keys.size, duplicates, expected: expectedCount };
}

// ----------------------------------------------------------------------- Main

async function main() {
  const args = parseArgs(process.argv);
  applyArgs(args);
  ensureDirs();

  const rootUsage = await apiGet(`/species/${CONFIG.ROOT_KEY}`, {});
  CONFIG.ROOT_NAME = rootUsage.canonicalName || rootUsage.scientificName || String(CONFIG.ROOT_KEY);

  console.log('='.repeat(64));
  console.log('Schritt 1 (neu): akzeptierter Artbestand aus dem GBIF-Backbone');
  console.log('='.repeat(64));
  log(`Wurzel:        ${CONFIG.ROOT_NAME} (${CONFIG.ROOT_KEY}, ${rootUsage.rank})`);
  log(`Backbone:      ${BACKBONE_DATASET_KEY}`);
  log(`max-slice:     ${fmt(CONFIG.MAX_SLICE)}`);
  log(`concurrency:   ${CONFIG.CONCURRENCY}`);
  log(`Sprachen:      ${CONFIG.LANGUAGES.length ? CONFIG.LANGUAGES.join(', ') : 'alle'}`);
  log(`Output:        ${CONFIG.OUT_FILE}`);
  console.log();

  if (args.fresh) {
    for (const file of [CONFIG.OUT_FILE, CONFIG.PLAN_FILE, CONFIG.DONE_FILE, CONFIG.META_FILE]) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    log('--fresh: bisherige Ausgabe und Zustand gelöscht.');
  }

  // 1) Plan
  let plan = readJson(CONFIG.PLAN_FILE, null);
  if (plan && plan.maxSlice !== CONFIG.MAX_SLICE) {
    log('max-slice hat sich geändert – Plan wird neu gebaut.');
    plan = null;
  }
  if (!plan) {
    log('Baue Scheibenplan …');
    const built = await buildPlan();
    plan = {
      createdAt: new Date().toISOString(),
      rootKey: CONFIG.ROOT_KEY,
      maxSlice: CONFIG.MAX_SLICE,
      rootCount: built.rootCount,
      nodesVisited: built.nodesVisited,
      slices: built.slices,
      singles: built.singles,
    };
    writeJson(CONFIG.PLAN_FILE, plan);
  } else {
    log('Vorhandenen Scheibenplan wiederverwendet.');
  }

  const planned = plan.slices.reduce((sum, s) => sum + s.count, 0);
  log(`Plan: ${fmt(plan.slices.length)} Scheiben, ${fmt(plan.singles.length)} Einzelarten, `
    + `Summe ${fmt(planned + plan.singles.length)} von ${fmt(plan.rootCount)} erwarteten Arten`);
  if (planned + plan.singles.length !== plan.rootCount) {
    log(`  ⚠ Planabweichung ${fmt(plan.rootCount - planned - plan.singles.length)} – `
      + 'wird nach dem Lauf gegen die Datei geprüft.');
  }
  console.log();

  if (args['plan-only']) {
    log('--plan-only: Ernte übersprungen.');
    return;
  }

  // 2) Ernte
  const done = new Set(readJson(CONFIG.DONE_FILE, { slices: [], singlesDone: false }).slices);
  const openSlices = plan.slices.filter((s) => !done.has(s.key));
  log(`Ernte ${fmt(openSlices.length)} offene Scheiben `
    + `(${fmt(plan.slices.length - openSlices.length)} bereits erledigt) …`);

  const started = Date.now();
  let harvested = 0;
  let finished = 0;

  await pool(openSlices, CONFIG.CONCURRENCY, async (slice) => {
    const records = await fetchSlice(slice);
    appendRecords(records);
    done.add(slice.key);
    harvested += records.length;
    finished++;
    writeJson(CONFIG.DONE_FILE, { slices: [...done], singlesDone: false });
    if (finished % 25 === 0 || finished === openSlices.length) {
      const elapsed = (Date.now() - started) / 1000;
      const rate = finished / elapsed;
      const eta = rate > 0 ? (openSlices.length - finished) / rate : 0;
      log(`  ${finished}/${openSlices.length} Scheiben · ${fmt(harvested)} Arten · `
        + `${elapsed.toFixed(0)}s · Rest ~${eta.toFixed(0)}s`);
    }
  });

  // 3) Einzelarten, die direkt unter zerlegten Knoten hängen
  const state = readJson(CONFIG.DONE_FILE, { slices: [], singlesDone: false });
  if (plan.singles.length && !state.singlesDone) {
    log(`Lade ${fmt(plan.singles.length)} Einzelarten nach …`);
    const records = await pool(plan.singles, CONFIG.CONCURRENCY, async (key) => {
      const usage = await getSpeciesWithVernaculars(key);
      return toRecord(usage);
    });
    appendRecords(records);
    harvested += records.length;
    writeJson(CONFIG.DONE_FILE, { slices: [...done], singlesDone: true });
  }

  // 4) Prüfen
  console.log();
  log('Prüfe Ergebnis …');
  const authoritative = await countAcceptedSpecies(CONFIG.ROOT_KEY);
  const check = await verifyAndDedupe(authoritative);

  const meta = {
    step: '01_fetch_species',
    finishedAt: new Date().toISOString(),
    source: {
      api: 'https://api.gbif.org/v1/species/search',
      datasetKey: BACKBONE_DATASET_KEY,
      rootKey: CONFIG.ROOT_KEY,
      filter: 'rank=SPECIES, status=ACCEPTED',
    },
    settings: {
      maxSlice: CONFIG.MAX_SLICE,
      pageSize: CONFIG.PAGE_SIZE,
      concurrency: CONFIG.CONCURRENCY,
      languages: CONFIG.LANGUAGES.length ? CONFIG.LANGUAGES : 'alle',
    },
    plan: {
      slices: plan.slices.length,
      singles: plan.singles.length,
      nodesVisited: plan.nodesVisited,
    },
    result: {
      speciesWritten: check.unique,
      duplicatesRemoved: check.duplicates,
      gbifReports: authoritative,
      difference: authoritative - check.unique,
    },
  };
  writeJson(CONFIG.META_FILE, meta);

  console.log();
  console.log('='.repeat(64));
  log(`Geschrieben:   ${fmt(check.unique)} Arten`);
  log(`GBIF meldet:   ${fmt(authoritative)} Arten`);
  if (check.duplicates) log(`Dubletten:     ${fmt(check.duplicates)} entfernt`);
  if (authoritative === check.unique) {
    log('✓ Vollständig – Datei und GBIF stimmen exakt überein.');
  } else {
    log(`⚠ Differenz ${fmt(authoritative - check.unique)}. Mögliche Ursachen: `
      + 'GBIF hat während des Laufs aktualisiert, oder eine Scheibe fehlt. '
      + 'Erneut laufen lassen – erledigte Scheiben werden übersprungen.');
  }
  log(`Metadaten:     ${CONFIG.META_FILE}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('\n❌ Fehler:', err.message);
    console.error(err.stack);
    process.exit(1);
  });
}

module.exports = { main, toRecord, buildPlan, CONFIG };
