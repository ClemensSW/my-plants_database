#!/usr/bin/env node
'use strict';
/**
 * Schritt 8: Prüfungslisten gegen den neuen Katalog bauen.
 *
 * Die Listen in `data/exam-lists/` sind heute gegen den **alten** 5.551er-Katalog gebaut
 * (`legacy/build-exam-lists.js`). Von 205 Zeilen der GaLaBau-Gesamtliste tragen deshalb nur 149
 * einen `taxonKey` — 56 blieben unaufgelöst, darunter *Kolkwitzia amabilis*, *Skimmia japonica*
 * und *Festuca glauca*, die es im neuen Katalog längst gibt.
 *
 * ## Was hier anders ist als in der alten Fassung
 *
 * Gematcht wird **in vier Stufen**, nicht nur über den kanonischen Namen:
 *   1. kanonischer Name (normalisiert)
 *   2. botanisches **Synonym** — die Listen führen teils Namen, die GBIF längst umgehängt hat
 *   3. `searchTerms` — fängt Schreibvarianten und Bindestrich-Fassungen
 *   4. Art-Binomen des Sortennamens: „Acer platanoides 'Globosum'" → *Acer platanoides*
 *
 * ## Was bewusst NICHT passiert
 *
 * Reine Sortennamen ohne Art („Rosa 'Anastasia'", „Hosta 'Krossa Regal'") werden **nicht** auf die
 * Gattung reduziert. Eine Gattung ist keine Art; sie als Prüfungspflanze zu führen hieße, dem Azubi
 * eine beliebige andere Art derselben Gattung zu zeigen. Sie bleiben unaufgelöst und werden
 * gezählt — 55 der 428 AuGaLa-Zeilen sind solche Fälle.
 *
 * Input:  data/reference/galabau_pflanzen.json · data/build/plants.ndjson
 * Output: data/exam-lists/**\/*.ndjson (+ Bericht)
 *
 * Usage:
 *   node pipeline/08_build_exam_lists.js            # Trockenlauf mit Bericht
 *   node pipeline/08_build_exam_lists.js --write    # Dateien schreiben
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const { DIRS, FILES, requireFiles, rel } = require('./lib/paths');
const { searchVariants } = require('./lib/search-normalize');

const OUT_DIR = path.join(DIRS.examLists, 'gartenbau/garten-und-landschaftsbau/national');

/**
 * Zwei Quellen, weil jede etwas hat, das der anderen fehlt:
 *   - die 428er-CSV ist der **vollständige** AuGaLa-Bestand, aber ohne Kurszuordnung
 *   - die 212er-JSON trägt die Kurse (01/07/12), ist aber unvollständig
 * Die Gesamtliste kommt deshalb aus der CSV, die Kurslisten aus der JSON.
 */
const SOURCE_FULL = path.join(OUT_DIR, 'references/augala-pflanzen-428.csv');
const SOURCE_COURSES = path.join(DIRS.reference, 'galabau_pflanzen.json');

/** Minimaler CSV-Leser für die AuGaLa-Datei: "botanisch","deutsch","kategorie" */
function readAugalaCsv(file) {
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n').slice(1)) {
    if (!line.trim()) continue;
    const cols = line.match(/"([^"]*)"/g);
    if (!cols || cols.length < 2) continue;
    const [botanisch, deutsch] = cols.map((c) => c.slice(1, -1));
    out.push({ botanisch, deutsch });
  }
  return out;
}

const WRITE = process.argv.includes('--write');

const fmt = (n) => Number(n).toLocaleString('de-DE');
function log(msg) { console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`); }

/** Normalisiert einen botanischen Namen für den Vergleich. */
const norm = (s) => String(s || '')
  .replace(/\s*[×x]\s+/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

/**
 * Reduziert einen Katalognamen auf das Art-Binomen.
 * Gibt `null`, wenn keine Art ableitbar ist (reiner Sortenname auf Gattungsebene).
 */
function toSpecies(botanical) {
  let s = String(botanical).replace(/[’]/g, "'").replace(/\(.*?\)/g, '').replace(/[®Ⓢ™]/g, '');
  s = s.split("'")[0];
  const words = [];
  for (const w of norm(s).split(' ').filter(Boolean)) {
    if (['subsp.', 'ssp.', 'var.', 'f.', 'cv.'].includes(w)) break;
    words.push(w);
  }
  return words.length >= 2 ? words.slice(0, 2).join(' ') : null;
}

async function main() {
  requireFiles('buildPlants');
  for (const f of [SOURCE_FULL, SOURCE_COURSES]) {
    if (!fs.existsSync(f)) throw new Error(`Fehlt: ${f}`);
  }

  console.log('='.repeat(64));
  console.log('Schritt 8: Prüfungslisten gegen den neuen Katalog');
  console.log('='.repeat(64));

  // ── Nachschlagewerk aus dem Katalog ────────────────────────────────────────
  const byCanonical = new Map();
  const bySynonym = new Map();
  const byTerm = new Map();
  let plantCount = 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(FILES.buildPlants, 'utf8'),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const p = JSON.parse(line);
    plantCount++;
    const entry = { taxonKey: p.taxonKey, canonicalName: p.canonicalName, germanName: p.germanName };
    const c = norm(p.canonicalName);
    if (c && !byCanonical.has(c)) byCanonical.set(c, entry);
    for (const s of p.synonyms || []) {
      const n = norm(s);
      if (n && !bySynonym.has(n)) bySynonym.set(n, entry);
    }
    for (const t of p.searchTerms || []) {
      if (!byTerm.has(t)) byTerm.set(t, entry);
    }
  }
  log(`Katalog: ${fmt(plantCount)} Pflanzen · ${fmt(bySynonym.size)} Synonyme · ${fmt(byTerm.size)} Suchbegriffe`);

  /** Die vier Stufen. Gibt `{entry, via}` oder `null`. */
  function match(botanical) {
    const species = toSpecies(botanical);
    if (!species) return null;
    let e = byCanonical.get(species);
    if (e) return { entry: e, via: 'name' };
    e = bySynonym.get(species);
    if (e) return { entry: e, via: 'synonym' };
    for (const v of searchVariants(species)) {
      e = byTerm.get(v);
      if (e) return { entry: e, via: 'suchbegriff' };
    }
    return null;
  }

  // ── Quellen ────────────────────────────────────────────────────────────────
  const stats = { rows: 0, noSpecies: 0, matched: 0, unmatched: 0, via: {} };
  const unresolved = [];

  const resolve = (item) => {
    stats.rows++;
    const hit = match(item.botanisch);
    if (!hit) {
      if (!toSpecies(item.botanisch)) stats.noSpecies++;
      else { stats.unmatched++; unresolved.push(item.botanisch); }
      return null;
    }
    stats.matched++;
    stats.via[hit.via] = (stats.via[hit.via] || 0) + 1;
    return {
      taxonKey: hit.entry.taxonKey,
      canonicalName: hit.entry.canonicalName,
      germanName: item.deutsch || hit.entry.germanName,   // die Prüfungsschreibweise hat Vorrang
    };
  };

  const all = readAugalaCsv(SOURCE_FULL).map(resolve).filter(Boolean);

  const courseSource = JSON.parse(fs.readFileSync(SOURCE_COURSES, 'utf8'));
  const groups = new Map();
  for (const block of courseSource.pflanzen || []) {
    if (block.kurs == null) continue;
    for (const item of block.eintraege || []) {
      const row = resolve(item);
      if (!row) continue;
      if (!groups.has(block.kurs)) groups.set(block.kurs, []);
      groups.get(block.kurs).push(row);
    }
  }

  // Dubletten je Liste entfernen, Reihenfolge erhalten
  const dedupe = (rows) => {
    const seen = new Set();
    return rows.filter((r) => (seen.has(r.taxonKey) ? false : seen.add(r.taxonKey)));
  };
  const fullList = dedupe(all);

  // ── Bericht ────────────────────────────────────────────────────────────────
  console.log();
  log(`Quellzeilen:            ${fmt(stats.rows)}`);
  log(`  reine Sortennamen:    ${fmt(stats.noSpecies)}  (keine Art ableitbar — bleiben draußen)`);
  log(`  aufgelöst:            ${fmt(stats.matched)}  (${Object.entries(stats.via).map(([k, v]) => `${k} ${v}`).join(' · ')})`);
  log(`  nicht im Katalog:     ${fmt(stats.unmatched)}`);
  console.log();
  log(`Gesamtliste (eindeutig): ${fmt(fullList.length)}`);
  for (const [kurs, rows] of [...groups].sort((a, b) => a[0] - b[0])) {
    log(`  Kurs ${String(kurs).padStart(2, '0')}: ${fmt(dedupe(rows).length)}`);
  }

  if (unresolved.length) {
    console.log();
    log(`Nicht aufgelöst (${unresolved.length}):`);
    console.log('  ' + unresolved.slice(0, 20).join(' · ') + (unresolved.length > 20 ? ' …' : ''));
  }

  if (!WRITE) {
    console.log();
    log('── TROCKENLAUF ── mit --write werden die Dateien geschrieben');
    return;
  }

  // ── Schreiben ──────────────────────────────────────────────────────────────
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const write = (name, rows) => {
    const file = path.join(OUT_DIR, name);
    fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
    log(`  ${rel(file)}: ${fmt(rows.length)}`);
  };
  console.log();
  write('full.ndjson', fullList);
  for (const [kurs, rows] of [...groups].sort((a, b) => a[0] - b[0])) {
    write(`course-${String(kurs).padStart(2, '0')}.ndjson`, dedupe(rows));
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('\n❌ Fehler:', err.message);
    console.error(err.stack);
    process.exit(1);
  });
}

module.exports = { main, toSpecies };
