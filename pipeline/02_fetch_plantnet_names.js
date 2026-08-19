#!/usr/bin/env node
'use strict';
/**
 * Schritt 2 (neue Pipeline): Trivialnamen von Pl@ntNet holen.
 *
 * Quelle ist Pl@ntNets Weltflora-Projekt `k-world-flora` – dieselben Namen, die
 * auf identify.plantnet.org stehen, mit Nutzerprüfung und Rangfolge. Gegenüber
 * den `vernacularNames` des GBIF-Backbones ist die Abdeckung deutlich höher:
 * gemessen an einer Stichprobe 20,5 % gegenüber 2,4 % mit deutschem Namen.
 *
 * Der Listen-Endpunkt liefert je Art **einen** – den bestbewerteten – Namen je
 * Sprache. Die vollständige Rangliste (Betula pendula: 14 deutsche Namen) gibt
 * nur die Detailansicht heraus, die aber sämtliche Bilder mitschickt (7 MB für
 * Betula pendula). Deshalb ist das Nachladen der Ranglisten ein eigener,
 * ausdrücklich begrenzter Modus: `--details=<datei>`.
 *
 * Output: data/raw/plantnet/plantnet_names.ndjson (+ .meta.json)
 *
 * Usage:
 *   node pipeline/02_fetch_plantnet_names.js
 *   node pipeline/02_fetch_plantnet_names.js --languages=de,en,fr
 *   node pipeline/02_fetch_plantnet_names.js --details=data/work/detail_keys.txt
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const {
  WORLD_FLORA_PROJECT,
  fetchSpeciesPage,
  fetchSpeciesDetail,
  gbifKeyFromMapUrl,
  sleep,
} = require('./lib/plantnet');
const { DIRS, FILES } = require('./lib/paths');

const ROOT = path.join(__dirname, '..');

const CONFIG = {
  PROJECT: WORLD_FLORA_PROJECT,
  LANGUAGES: ['de'],
  PAGE_SIZE: 2000,          // vom Endpunkt akzeptiert, ~2,4 MB je Seite
  DELAY_MS: 500,            // Selbstdrosselung: Pl@ntNet antwortet sonst mit 429
  MAX_PAGES: 500,           // Reißleine gegen Endlosschleifen
  OUT_FILE: FILES.plantnetNames,
  META_FILE: FILES.plantnetNamesMeta,
  CATALOG_FILE: FILES.speciesAccepted,
  DETAILS_FILE: null,
  DETAILS_LIMIT: 2000,
};

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
  if (args.languages) {
    CONFIG.LANGUAGES = String(args.languages).split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (args.project) CONFIG.PROJECT = String(args.project);
  if (args['page-size']) CONFIG.PAGE_SIZE = Number(args['page-size']);
  if (args.delay) CONFIG.DELAY_MS = Number(args.delay);
  if (args.out) {
    CONFIG.OUT_FILE = path.resolve(args.out);
    CONFIG.META_FILE = CONFIG.OUT_FILE.replace(/\.ndjson$/, '') + '.meta.json';
  }
  if (args.details) CONFIG.DETAILS_FILE = path.resolve(args.details);
  if (args['details-limit']) CONFIG.DETAILS_LIMIT = Number(args['details-limit']);
}

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

const fmt = (n) => Number(n).toLocaleString('de-DE');

/**
 * Holt alle Seiten einer Sprache.
 * Abbruch bei HTTP 404 ("No species found") – so meldet der Endpunkt das Ende.
 */
async function harvestLanguage(lang, onSpecies) {
  // ⚠ `page` ist NULLBASIERT: page=1 liefert die Einträge ab Position pageSize+1.
  // Ein Start bei 1 überspringt lautlos die erste Seite – bei pageSize=2000 waren
  // das 2.000 Arten inklusive der gesamten Gattung Acer. Gegengeprüft: page=0
  // beginnt bei "× Amarcrinum memoria-corsii", page=1 bei "× Cattlianthe dabeibaensis".
  let page = 0;
  let total = 0;
  for (; page < CONFIG.MAX_PAGES; page++) {
    const results = await fetchSpeciesPage(CONFIG.PROJECT, lang, page, CONFIG.PAGE_SIZE);
    if (results === null) break;              // HTTP 404 = hinter dem Ende
    if (!Array.isArray(results) || !results.length) break;
    for (const entry of results) onSpecies(entry, lang);
    total += results.length;
    if (page % 5 === 0) log(`  ${lang}: Seite ${page}, ${fmt(total)} Arten`);
    await sleep(CONFIG.DELAY_MS);
  }
  return { pages: page, total };
}

async function main() {
  const args = parseArgs(process.argv);
  applyArgs(args);
  fs.mkdirSync(path.dirname(CONFIG.OUT_FILE), { recursive: true });

  console.log('='.repeat(64));
  console.log('Schritt 2 (neu): Trivialnamen von Pl@ntNet');
  console.log('='.repeat(64));
  log(`Projekt:   ${CONFIG.PROJECT}`);
  log(`Sprachen:  ${CONFIG.LANGUAGES.join(', ')}`);
  log(`Seiten:    ${fmt(CONFIG.PAGE_SIZE)} Arten je Anfrage, ${CONFIG.DELAY_MS} ms Pause`);
  log(`Output:    ${CONFIG.OUT_FILE}`);
  console.log();

  // name+author identifiziert eine Art bei Pl@ntNet eindeutig.
  const species = new Map();
  let rawEntries = 0;
  let duplicates = 0;

  const perLanguage = {};
  for (const lang of CONFIG.LANGUAGES) {
    log(`Ernte Sprache "${lang}" …`);
    const started = Date.now();
    const stats = await harvestLanguage(lang, (entry) => {
      const id = `${entry.name}|${entry.author || ''}`;
      rawEntries++;
      let record = species.get(id);
      if (record && lang === CONFIG.LANGUAGES[0]) duplicates++;
      if (!record) {
        record = {
          plantnetName: entry.name,
          author: entry.author || null,
          genus: entry.genus || null,
          family: entry.family || null,
          gbifKey: gbifKeyFromMapUrl(entry.map),
          imagesCount: typeof entry.imagesCount === 'number' ? entry.imagesCount : null,
          observationsCount: typeof entry.observationsCount === 'number'
            ? entry.observationsCount : null,
          iucn: entry.iucn || null,
          commonNames: {},
        };
        species.set(id, record);
      }
      const names = Array.isArray(entry.commonNames)
        ? entry.commonNames.filter((n) => typeof n === 'string' && n.trim())
        : [];
      if (names.length) record.commonNames[lang] = names;
    });
    perLanguage[lang] = { ...stats, seconds: Math.round((Date.now() - started) / 1000) };
    log(`  ${lang}: ${fmt(stats.total)} Arten aus ${stats.pages} Seiten `
      + `in ${perLanguage[lang].seconds}s`);
  }

  // Kanarienvogel: Diese Gattungen MÜSSEN im Weltflora-Projekt vorkommen. Fehlt eine,
  // hat die Paginierung Seiten übersprungen – genau so fiel auf, dass `page`
  // nullbasiert ist und ein Start bei 1 die ersten 2.000 Arten verschluckt.
  const CANARIES = ['Acer', 'Betula', 'Quercus', 'Rosa', 'Salix', 'Prunus', 'Abies', 'Aesculus'];
  const genera = new Set([...species.values()].map((r) => r.genus).filter(Boolean));
  const missing = CANARIES.filter((g) => !genera.has(g));
  if (missing.length) {
    log(`  ⚠ FEHLENDE GATTUNGEN: ${missing.join(', ')} – die Ernte ist unvollständig.`);
  } else {
    log(`  ✓ Kanarienprüfung bestanden (${CANARIES.length} Gattungen vorhanden)`);
  }
  if (duplicates) log(`  ⚠ ${fmt(duplicates)} doppelte Einträge – Seiten überlappen.`);

  // Optional: vollständige Ranglisten für eine begrenzte Auswahl nachladen.
  let detailStats = null;
  if (CONFIG.DETAILS_FILE) {
    const wanted = fs.readFileSync(CONFIG.DETAILS_FILE, 'utf8')
      .split('\n').map((s) => s.trim()).filter(Boolean);
    const byKey = new Map();
    for (const rec of species.values()) if (rec.gbifKey) byKey.set(String(rec.gbifKey), rec);
    const targets = wanted.map((k) => byKey.get(k)).filter(Boolean).slice(0, CONFIG.DETAILS_LIMIT);
    log(`Lade vollständige Ranglisten für ${fmt(targets.length)} Arten nach `
      + `(von ${fmt(wanted.length)} gewünschten, Obergrenze ${fmt(CONFIG.DETAILS_LIMIT)}) …`);
    if (wanted.length > CONFIG.DETAILS_LIMIT) {
      log(`  ⚠ ${fmt(wanted.length - CONFIG.DETAILS_LIMIT)} Arten übersprungen `
        + '– die Detailansicht schickt sämtliche Bilder mit und ist entsprechend teuer.');
    }
    let done = 0;
    for (const rec of targets) {
      for (const lang of CONFIG.LANGUAGES) {
        const detail = await fetchSpeciesDetail(
          CONFIG.PROJECT, `${rec.plantnetName} ${rec.author || ''}`.trim(), lang,
        );
        const names = Array.isArray(detail?.commonNames) ? detail.commonNames : [];
        if (names.length) rec.commonNames[lang] = names;
        await sleep(CONFIG.DELAY_MS);
      }
      done++;
      if (done % 25 === 0) log(`  ${done}/${targets.length}`);
    }
    detailStats = { requested: wanted.length, fetched: targets.length };
  }

  // Schreiben
  const out = fs.createWriteStream(CONFIG.OUT_FILE, { encoding: 'utf8', flags: 'w' });
  for (const rec of species.values()) out.write(JSON.stringify(rec) + '\n');
  await new Promise((resolve) => out.end(resolve));

  // Auswertung
  const withGbif = [...species.values()].filter((r) => r.gbifKey).length;
  const perLangCounts = {};
  for (const lang of CONFIG.LANGUAGES) {
    perLangCounts[lang] = [...species.values()].filter((r) => r.commonNames[lang]?.length).length;
  }

  // Abgleich gegen den Katalog aus Schritt 1, falls vorhanden
  let join = null;
  if (fs.existsSync(CONFIG.CATALOG_FILE)) {
    log('Gleiche gegen den Katalog aus Schritt 1 ab …');
    const catalog = new Set();
    const rl = readline.createInterface({
      input: fs.createReadStream(CONFIG.CATALOG_FILE, 'utf8'),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (line.trim()) catalog.add(JSON.parse(line).taxonKey);
    }
    let matched = 0;
    let unmatched = 0;
    const namedMatched = {};
    for (const rec of species.values()) {
      if (rec.gbifKey && catalog.has(rec.gbifKey)) {
        matched++;
        for (const lang of CONFIG.LANGUAGES) {
          if (rec.commonNames[lang]?.length) namedMatched[lang] = (namedMatched[lang] || 0) + 1;
        }
      } else unmatched++;
    }
    join = { catalogSize: catalog.size, matched, unmatched, namedMatched };
  }

  const meta = {
    step: '02_fetch_plantnet_names',
    finishedAt: new Date().toISOString(),
    source: {
      api: 'https://api.plantnet.org/v1/projects/{project}/species',
      project: CONFIG.PROJECT,
      note: 'Listen-Endpunkt liefert je Sprache nur den bestbewerteten Namen',
    },
    settings: {
      languages: CONFIG.LANGUAGES,
      pageSize: CONFIG.PAGE_SIZE,
      delayMs: CONFIG.DELAY_MS,
    },
    result: {
      speciesTotal: species.size,
      rawEntries,
      duplicates,
      missingCanaryGenera: missing,
      withGbifKey: withGbif,
      withNames: perLangCounts,
      perLanguage,
      details: detailStats,
      join,
    },
  };
  fs.writeFileSync(CONFIG.META_FILE, JSON.stringify(meta, null, 2), 'utf8');

  console.log();
  console.log('='.repeat(64));
  log(`Arten bei Pl@ntNet:     ${fmt(species.size)}`);
  log(`davon mit GBIF-Key:     ${fmt(withGbif)} (${(100 * withGbif / species.size).toFixed(1)} %)`);
  for (const lang of CONFIG.LANGUAGES) {
    log(`mit Namen "${lang}":${' '.repeat(Math.max(0, 12 - lang.length))}`
      + `${fmt(perLangCounts[lang])} (${(100 * perLangCounts[lang] / species.size).toFixed(1)} %)`);
  }
  if (join) {
    log(`im Katalog wiedergefunden: ${fmt(join.matched)} `
      + `(${(100 * join.matched / species.size).toFixed(1)} % der Pl@ntNet-Arten)`);
    log(`nicht im Katalog:          ${fmt(join.unmatched)}`);
  }
  log(`Metadaten:              ${CONFIG.META_FILE}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('\n❌ Fehler:', err.message);
    console.error(err.stack);
    process.exit(1);
  });
}

module.exports = { main, CONFIG };
