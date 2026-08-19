#!/usr/bin/env node
/**
 * Validate Exam Lists
 *
 * Prüft die Integrität der Prüfungslisten:
 * - catalog.json: Alle referenzierten Dateien vorhanden?
 * - NDJSON-Dateien: Valides Format?
 * - Coverage: Wie viel Prozent der Pflanzen haben einen taxonKey?
 *
 * Usage: node scripts/validate-exam-lists.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EXAM_LISTS_DIR = path.join(ROOT, 'data/exam-lists');
const CATALOG_FILE = path.join(EXAM_LISTS_DIR, 'catalog.json');

let errors = 0;
let warnings = 0;

function error(msg) {
  console.error(`  [FEHLER] ${msg}`);
  errors++;
}

function warn(msg) {
  console.warn(`  [WARNUNG] ${msg}`);
  warnings++;
}

function ok(msg) {
  console.log(`  [OK] ${msg}`);
}

/**
 * Liest eine NDJSON-Datei und gibt die Einträge zurück
 */
function readNdjson(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());
  return lines.map((line, i) => {
    try {
      return JSON.parse(line);
    } catch {
      error(`${filePath}:${i + 1} — Ungültiges JSON`);
      return null;
    }
  }).filter(Boolean);
}

function main() {
  console.log('='.repeat(60));
  console.log('Validate Exam Lists');
  console.log('='.repeat(60));
  console.log();

  // 1) catalog.json prüfen
  console.log('1) catalog.json prüfen');
  if (!fs.existsSync(CATALOG_FILE)) {
    error(`catalog.json nicht gefunden: ${CATALOG_FILE}`);
    process.exit(1);
  }

  let catalog;
  try {
    catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf-8'));
    ok('catalog.json ist valides JSON');
  } catch (err) {
    error(`catalog.json Parse-Fehler: ${err.message}`);
    process.exit(1);
  }

  // Version + States prüfen
  if (!catalog.version) warn('catalog.json: Kein "version" Feld');
  if (!catalog.states || catalog.states.length === 0) warn('catalog.json: Keine States definiert');
  if (!catalog.domains || catalog.domains.length === 0) {
    error('catalog.json: Keine Domains definiert');
    process.exit(1);
  }
  console.log();

  // 2) Alle referenzierten Dateien prüfen
  console.log('2) Referenzierte Dateien prüfen');
  const allLists = [];

  for (const domain of catalog.domains) {
    for (const profession of domain.professions || []) {
      for (const list of profession.lists || []) {
        const filePath = path.join(EXAM_LISTS_DIR, list.file);
        allLists.push({ ...list, filePath, profession: profession.id, domain: domain.id });

        if (!fs.existsSync(filePath)) {
          error(`Datei nicht gefunden: ${list.file}`);
        } else {
          ok(`${list.file} vorhanden`);
        }

        // Pflichtfelder prüfen
        if (!list.id) error(`Liste ohne ID in ${profession.id}`);
        if (!list.displayName) error(`Liste ${list.id}: Kein displayName`);
        if (!list.type) error(`Liste ${list.id}: Kein type`);
        if (!list.scope) error(`Liste ${list.id}: Kein scope`);

        // Scope-Validierung
        if (list.scope) {
          if (list.scope.type === 'states' && (!list.scope.states || list.scope.states.length === 0)) {
            error(`Liste ${list.id}: scope.type=states aber keine States definiert`);
          }
          if (list.scope.type === 'states') {
            const stateIds = catalog.states.map(s => s.id);
            for (const stateId of list.scope.states || []) {
              if (!stateIds.includes(stateId)) {
                warn(`Liste ${list.id}: State "${stateId}" nicht in catalog.states definiert`);
              }
            }
          }
        }
      }
    }
  }
  console.log();

  // 3) NDJSON-Dateien inhaltlich prüfen + Coverage
  console.log('3) Coverage-Report');
  console.log();

  for (const list of allLists) {
    if (!fs.existsSync(list.filePath)) continue;

    const entries = readNdjson(list.filePath);
    const matched = entries.filter(e => e.taxonKey !== null);
    const unmatched = entries.filter(e => e.taxonKey === null);
    const total = entries.length;
    const pct = total > 0 ? ((matched.length / total) * 100).toFixed(1) : '0.0';

    // Sortierung prüfen
    let sortingOk = true;
    for (let i = 1; i < matched.length; i++) {
      if (matched[i].canonicalName.localeCompare(matched[i - 1].canonicalName) < 0) {
        sortingOk = false;
        break;
      }
    }
    for (let i = 1; i < unmatched.length; i++) {
      if (unmatched[i].canonicalName.localeCompare(unmatched[i - 1].canonicalName) < 0) {
        sortingOk = false;
        break;
      }
    }

    // Matched muss vor unmatched kommen
    if (matched.length > 0 && unmatched.length > 0) {
      const lastMatchedIdx = entries.findIndex(e => e === matched[matched.length - 1]);
      const firstUnmatchedIdx = entries.findIndex(e => e === unmatched[0]);
      if (lastMatchedIdx > firstUnmatchedIdx) {
        sortingOk = false;
      }
    }

    // Pflichtfelder prüfen
    for (const entry of entries) {
      if (!entry.canonicalName) error(`${list.file}: Eintrag ohne canonicalName`);
      if (!entry.germanName) warn(`${list.file}: ${entry.canonicalName || '?'} ohne germanName`);
      if (entry.taxonKey !== null && typeof entry.taxonKey !== 'number') {
        error(`${list.file}: ${entry.canonicalName} — taxonKey ist kein Number`);
      }
    }

    const label = `${list.profession}/${list.id}`;
    console.log(`  ${label}`);
    console.log(`    Datei:      ${list.file}`);
    console.log(`    Einträge:   ${total}`);
    console.log(`    In DB:      ${matched.length}/${total} (${pct}%)`);
    console.log(`    Nicht in DB: ${unmatched.length}`);
    console.log(`    Sortierung: ${sortingOk ? 'OK' : 'FEHLER'}`);
    if (!sortingOk) warn(`${list.file}: Sortierung nicht korrekt`);
    console.log();
  }

  // 4) Zusammenfassung
  console.log('='.repeat(60));
  console.log('Zusammenfassung');
  console.log('='.repeat(60));
  console.log(`  Domains:     ${catalog.domains.length}`);
  console.log(`  Professions: ${catalog.domains.reduce((sum, d) => sum + (d.professions || []).length, 0)}`);
  console.log(`  Listen:      ${allLists.length}`);
  console.log(`  States:      ${catalog.states.length}`);
  console.log();
  console.log(`  Fehler:      ${errors}`);
  console.log(`  Warnungen:   ${warnings}`);
  console.log();

  if (errors > 0) {
    console.log('VALIDIERUNG FEHLGESCHLAGEN');
    process.exit(1);
  } else {
    console.log('Validierung erfolgreich!');
  }
}

main();
