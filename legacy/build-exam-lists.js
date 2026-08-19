#!/usr/bin/env node
/**
 * Build Exam Lists
 *
 * Konvertiert galabau_pflanzen.json in NDJSON-Prüfungslisten.
 * Matcht botanische Namen gegen species.ndjson (taxonKey Lookup).
 *
 * Erzeugt:
 *   data/exam-lists/gartenbau/garten-und-landschaftsbau/national/full.ndjson
 *   data/exam-lists/gartenbau/garten-und-landschaftsbau/national/course-{01,07,12}.ndjson
 *
 * Usage: node scripts/build-exam-lists.js
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Pfade
const ROOT = path.join(__dirname, '..');
const SPECIES_FILE = path.join(ROOT, 'data/output/species.ndjson');
const GALABAU_FILE = path.join(ROOT, 'data/reference/galabau_pflanzen.json');
const OUTPUT_DIR = path.join(ROOT, 'data/exam-lists/gartenbau/garten-und-landschaftsbau/national');

/**
 * Normalisiert botanische Namen für den Vergleich:
 * - Entfernt Hybrid-Zeichen (× und x zwischen Wörtern)
 * - Normalisiert Whitespace
 * - Lowercase für Vergleich
 */
function normalize(name) {
  return name
    .replace(/\s[x×]\s/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Lädt species.ndjson als Lookup-Map: normalizedName → { taxonKey, canonicalName, germanName }
 */
async function loadSpeciesLookup() {
  const lookup = new Map();
  const rl = readline.createInterface({
    input: fs.createReadStream(SPECIES_FILE),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.canonicalName) {
        lookup.set(normalize(obj.canonicalName), {
          taxonKey: obj.taxonKey,
          canonicalName: obj.canonicalName,
          germanName: obj.germanName,
        });
      }
    } catch {
      // Fehlerhafte Zeilen überspringen
    }
  }

  return lookup;
}

/**
 * Matcht einen botanischen Namen aus der Prüfungsliste gegen die Species-DB.
 * Versucht verschiedene Normalisierungen.
 */
function matchPlant(botanischName, deutschName, lookup) {
  const norm = normalize(botanischName);

  // Direkter Match
  if (lookup.has(norm)) {
    const match = lookup.get(norm);
    return {
      taxonKey: match.taxonKey,
      canonicalName: match.canonicalName,
      germanName: deutschName,
    };
  }

  // Kein Match
  return {
    taxonKey: null,
    canonicalName: botanischName,
    germanName: deutschName,
  };
}

/**
 * Sortiert Pflanzen: Erst mit taxonKey (alphabetisch), dann ohne (alphabetisch)
 */
function sortPlants(plants) {
  const matched = plants.filter(p => p.taxonKey !== null);
  const unmatched = plants.filter(p => p.taxonKey === null);

  matched.sort((a, b) => a.canonicalName.localeCompare(b.canonicalName));
  unmatched.sort((a, b) => a.canonicalName.localeCompare(b.canonicalName));

  return [...matched, ...unmatched];
}

/**
 * Schreibt eine NDJSON-Datei
 */
function writeNdjson(filePath, plants) {
  const sorted = sortPlants(plants);
  const content = sorted.map(p => JSON.stringify(p)).join('\n') + '\n';
  fs.writeFileSync(filePath, content, 'utf-8');
}

/**
 * Dedupliziert Pflanzen nach canonicalName (normalisiert).
 * Behält den ersten Eintrag (der mit mehr Info).
 */
function deduplicatePlants(plants) {
  const seen = new Set();
  return plants.filter(p => {
    const key = normalize(p.canonicalName);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function main() {
  console.log('='.repeat(60));
  console.log('Build Exam Lists: GaLaBau / AuGaLa');
  console.log('='.repeat(60));
  console.log();

  // 1) Species-Lookup laden
  console.log('Lade species.ndjson...');
  const lookup = await loadSpeciesLookup();
  console.log(`  ${lookup.size} Arten in der Datenbank`);
  console.log();

  // 2) GaLaBau-Pflanzen laden
  console.log('Lade galabau_pflanzen.json...');
  const galabau = JSON.parse(fs.readFileSync(GALABAU_FILE, 'utf-8'));
  const kurse = galabau.pflanzen;

  // Kursnummern ermitteln
  const kursNummern = [...new Set(kurse.map(k => k.kurs))].sort((a, b) => a - b);
  console.log(`  Kurse: ${kursNummern.join(', ')}`);
  console.log();

  // 3) Alle Pflanzen matchen, gruppiert nach Kurs
  const kursMap = new Map(); // kursNummer → plants[]
  const allPlants = [];

  for (const kursGruppe of kurse) {
    const kursNr = kursGruppe.kurs;
    if (!kursMap.has(kursNr)) {
      kursMap.set(kursNr, []);
    }

    for (const eintrag of kursGruppe.eintraege) {
      const plant = matchPlant(eintrag.botanisch, eintrag.deutsch, lookup);
      kursMap.get(kursNr).push(plant);
      allPlants.push(plant);
    }
  }

  // 4) Output-Verzeichnis sicherstellen
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // 5) Gesamtliste schreiben (dedupliziert)
  const fullList = deduplicatePlants(allPlants);
  const fullPath = path.join(OUTPUT_DIR, 'full.ndjson');
  writeNdjson(fullPath, fullList);

  // 6) Kurslisten schreiben
  for (const [kursNr, plants] of kursMap) {
    const kursFile = `course-${String(kursNr).padStart(2, '0')}.ndjson`;
    const kursPath = path.join(OUTPUT_DIR, kursFile);
    const dedupedPlants = deduplicatePlants(plants);
    writeNdjson(kursPath, dedupedPlants);
  }

  // 7) Coverage-Report
  console.log('='.repeat(60));
  console.log('Coverage-Report');
  console.log('='.repeat(60));
  console.log();

  // Gesamtliste
  const fullMatched = fullList.filter(p => p.taxonKey !== null).length;
  const fullTotal = fullList.length;
  const fullPct = ((fullMatched / fullTotal) * 100).toFixed(1);
  console.log(`  Gesamtliste:      ${fullMatched}/${fullTotal} (${fullPct}%)`);

  // Pro Kurs
  for (const kursNr of kursNummern) {
    const plants = deduplicatePlants(kursMap.get(kursNr));
    const matched = plants.filter(p => p.taxonKey !== null).length;
    const total = plants.length;
    const pct = ((matched / total) * 100).toFixed(1);
    const label = `AuGaLa-Kurs ${String(kursNr).padStart(2, '0')}:`;
    console.log(`  ${label.padEnd(18)} ${matched}/${total} (${pct}%)`);
  }

  console.log();

  // Fehlende Pflanzen auflisten
  const missing = fullList.filter(p => p.taxonKey === null);
  if (missing.length > 0) {
    console.log(`Nicht in der Datenbank (${missing.length}):`);
    for (const p of missing.sort((a, b) => a.canonicalName.localeCompare(b.canonicalName))) {
      console.log(`  ${p.canonicalName}`);
    }
    console.log();
  }

  // Dateien-Übersicht
  console.log('Erzeugte Dateien:');
  console.log(`  ${fullPath}`);
  for (const kursNr of kursNummern) {
    const kursFile = `course-${String(kursNr).padStart(2, '0')}.ndjson`;
    console.log(`  ${path.join(OUTPUT_DIR, kursFile)}`);
  }
  console.log();
  console.log('Fertig!');
}

main().catch(err => {
  console.error('\nFehler:', err.message);
  console.error(err.stack);
  process.exit(1);
});
