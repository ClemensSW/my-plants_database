#!/usr/bin/env node
/**
 * Prüft für jede Art in galabau_missing.json, ob sie im PlantNet-Datensatz
 * auf GBIF Beobachtungen hat.
 *
 * Für jede Art wird ermittelt:
 * - GBIF taxonKey (via Species Match API)
 * - Taxonomischer Status und Rang
 * - Anzahl PlantNet-Occurrences
 * - Akzeptierter Name (falls Synonym)
 *
 * Output: data/output/galabau_plantnet_check.json + Konsolentabelle
 *
 * Usage: node scripts/check_galabau_plantnet.js
 */

const fs = require('fs');
const path = require('path');
const { fetchWithRetry, sleep, GBIF_API_BASE } = require('../utils/gbif-helpers');

const CONFIG = {
  MISSING_FILE: path.join(__dirname, '../../data/output/checks/galabau_missing.json'),
  OUTPUT_FILE: path.join(__dirname, '../../data/output/checks/galabau_plantnet_check.json'),
  DATASET_KEY: '7a3679ef-5582-4aaa-81f0-8c2545cafc81',
  CONCURRENCY: 5,
};

async function matchSpecies(name) {
  const url = `${GBIF_API_BASE}/species/match?name=${encodeURIComponent(name)}&verbose=true`;
  return fetchWithRetry(url);
}

async function countPlantNetOccurrences(taxonKey) {
  const url = `${GBIF_API_BASE}/occurrence/search?datasetKey=${CONFIG.DATASET_KEY}&taxonKey=${taxonKey}&limit=0`;
  const data = await fetchWithRetry(url);
  return data?.count || 0;
}

async function checkSpecies(name) {
  const match = await matchSpecies(name);
  if (!match || match.matchType === 'NONE') {
    return { input: name, matched: false, note: 'Kein GBIF-Match gefunden' };
  }

  const result = {
    input: name,
    matched: true,
    taxonKey: match.usageKey,
    scientificName: match.scientificName,
    canonicalName: match.canonicalName,
    rank: match.rank,
    status: match.status,
    matchType: match.matchType,
    confidence: match.confidence,
    plantnetCount: 0,
    acceptedName: null,
    acceptedKey: null,
    acceptedPlantnetCount: null,
  };

  // PlantNet-Count für den gematchten Key
  result.plantnetCount = await countPlantNetOccurrences(match.usageKey);

  // Falls Synonym: auch den akzeptierten Key prüfen
  if (match.status === 'SYNONYM' && match.acceptedUsageKey) {
    result.acceptedKey = match.acceptedUsageKey;
    const accepted = await fetchWithRetry(`${GBIF_API_BASE}/species/${match.acceptedUsageKey}`);
    result.acceptedName = accepted?.scientificName || null;
    result.acceptedPlantnetCount = await countPlantNetOccurrences(match.acceptedUsageKey);
  }

  return result;
}

async function processWithConcurrency(items, fn, concurrency) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
    if (i + concurrency < items.length) await sleep(500);
    process.stdout.write(`\r  ${results.length}/${items.length} geprüft`);
  }
  process.stdout.write('\n');
  return results;
}

async function main() {
  console.log('='.repeat(60));
  console.log('Galabau Missing: PlantNet-Verfügbarkeit prüfen');
  console.log('='.repeat(60));

  const missing = JSON.parse(fs.readFileSync(CONFIG.MISSING_FILE, 'utf-8'));
  const unique = [...new Set(missing)];
  console.log(`${unique.length} eindeutige Arten zu prüfen\n`);

  const results = await processWithConcurrency(unique, checkSpecies, CONFIG.CONCURRENCY);

  // Konsolentabelle
  console.log('\n' + '-'.repeat(120));
  console.log(
    'Input'.padEnd(35) +
    'TaxonKey'.padEnd(10) +
    'Status'.padEnd(12) +
    'Rang'.padEnd(12) +
    'PlantNet'.padEnd(10) +
    'Akzeptierter Name (PlantNet)'
  );
  console.log('-'.repeat(120));

  let withImages = 0;
  let withAcceptedImages = 0;

  for (const r of results) {
    if (!r.matched) {
      console.log(r.input.padEnd(35) + '—'.padEnd(10) + 'KEIN MATCH'.padEnd(12));
      continue;
    }
    const acceptedInfo = r.acceptedName
      ? `${r.acceptedName} (${r.acceptedPlantnetCount})`
      : '—';
    console.log(
      r.input.padEnd(35) +
      String(r.taxonKey).padEnd(10) +
      r.status.padEnd(12) +
      r.rank.padEnd(12) +
      String(r.plantnetCount).padEnd(10) +
      acceptedInfo
    );
    if (r.plantnetCount > 0) withImages++;
    if (r.acceptedPlantnetCount > 0) withAcceptedImages++;
  }

  console.log('-'.repeat(120));
  console.log(`\nZusammenfassung:`);
  console.log(`  Geprüft:                    ${results.length}`);
  console.log(`  Mit PlantNet-Bildern:       ${withImages}`);
  console.log(`  Synonym → Akzeptiert mit Bildern: ${withAcceptedImages}`);
  console.log(`  Ohne PlantNet-Bilder:       ${results.length - withImages}`);

  // JSON speichern
  fs.writeFileSync(CONFIG.OUTPUT_FILE, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`\nErgebnis gespeichert: ${CONFIG.OUTPUT_FILE}`);
}

main().catch(err => {
  console.error('Fehler:', err.message);
  process.exit(1);
});
