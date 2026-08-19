#!/usr/bin/env node
/**
 * TEST-VERSION: Phase 2.5 - Deutsche Namen aus Wikidata ergänzen
 *
 * Ergänzt fehlende deutsche Namen aus der Wikidata SPARQL API (nur Test-Daten).
 *
 * Input:  data/intermediate/plantnet_species_raw_test.ndjson
 * Output: data/intermediate/plantnet_species_enriched_test.ndjson
 *
 * Usage: node scriptsTest/03_enrich_wikidata_test.js
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { queryWikidataGermanNamesBatch } = require('../utils/wikidata-helpers');
const { pickPreferredGerman } = require('../utils/gbif-helpers');

// Konfiguration
const CONFIG = {
  INPUT_FILE: path.join(__dirname, '../../data/intermediate/plantnet_species_raw_test.ndjson'),
  OUTPUT_FILE: path.join(__dirname, '../../data/intermediate/plantnet_species_enriched_test.ndjson'),
  FAILED_LOG: path.join(__dirname, '../../data/intermediate/wikidata_failed_test.txt'),
  BATCH_SIZE: 50, // Anzahl Species pro Batch-Query
  BATCH_DELAY_MS: 500, // Delay zwischen Batches (kürzer für Tests)
};

/**
 * Verzögerung zwischen Requests
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Liest alle Species aus NDJSON Input
 */
async function readAllSpecies(filePath) {
  const species = [];
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (line.trim()) {
      try {
        species.push(JSON.parse(line));
      } catch (err) {
        // Fehlerhafte Zeilen überspringen
      }
    }
  }

  return species;
}

async function main() {
  console.log('='.repeat(60));
  console.log('TEST-VERSION: Phase 2.5 - Wikidata-Ergänzung');
  console.log('='.repeat(60));
  console.log(`Input:  ${CONFIG.INPUT_FILE}`);
  console.log(`Output: ${CONFIG.OUTPUT_FILE}`);
  console.log();

  // 1) Input lesen
  console.log('Lade Test-Daten...');
  const allSpecies = await readAllSpecies(CONFIG.INPUT_FILE);
  console.log(`✓ ${allSpecies.length} Species geladen`);
  console.log();

  // 2) Filtere Species OHNE deutsche Namen
  const speciesWithoutGerman = allSpecies.filter(
    s => !s.germanNames || s.germanNames.length === 0
  );
  const speciesWithGerman = allSpecies.filter(
    s => s.germanNames && s.germanNames.length > 0
  );

  console.log(`✓ Mit deutschen Namen: ${speciesWithGerman.length}`);
  console.log(`✗ Ohne deutsche Namen: ${speciesWithoutGerman.length}`);
  console.log();

  if (speciesWithoutGerman.length === 0) {
    console.log('Keine Species ohne deutsche Namen gefunden.');
    console.log('Kopiere Input → Output ohne Änderungen...');
    fs.copyFileSync(CONFIG.INPUT_FILE, CONFIG.OUTPUT_FILE);
    console.log('✓ TEST Phase 2.5 abgeschlossen!');
    return;
  }

  // 3) Wikidata Batch-Queries
  const totalBatches = Math.ceil(speciesWithoutGerman.length / CONFIG.BATCH_SIZE);
  console.log(`Wikidata-Abfragen für ${speciesWithoutGerman.length} Species...`);
  console.log(`Batch-Größe: ${CONFIG.BATCH_SIZE} Species/Batch`);
  console.log(`Anzahl Batches: ${totalBatches}`);
  console.log();

  const output = fs.createWriteStream(CONFIG.OUTPUT_FILE, { flags: 'w' });
  const failedLog = fs.createWriteStream(CONFIG.FAILED_LOG, { flags: 'w' });

  let enriched = 0;
  let failed = 0;
  let batchNumber = 0;

  // Verarbeite in Batches
  for (let i = 0; i < speciesWithoutGerman.length; i += CONFIG.BATCH_SIZE) {
    const batch = speciesWithoutGerman.slice(i, i + CONFIG.BATCH_SIZE);
    batchNumber++;

    console.log(`\n[Batch ${batchNumber}/${totalBatches}] ${batch.length} Species...`);

    try {
      // Batch-Query: Alle canonicalNames auf einmal
      const canonicalNames = batch.map(s => s.canonicalName || s.scientificName);
      const results = await queryWikidataGermanNamesBatch(canonicalNames);

      // Ergebnisse zuordnen
      for (const species of batch) {
        const searchName = species.canonicalName || species.scientificName;
        const wikidataNames = results[searchName] || [];

        if (wikidataNames.length > 0) {
          console.log(`  ✓ ${searchName}: ${wikidataNames.map(n => n.name).join(', ')}`);
          species.germanNames = wikidataNames;
          species.germanName = pickPreferredGerman({}, wikidataNames);
          enriched++;
        } else {
          failed++;
          failedLog.write(`${species.taxonKey}\t${species.scientificName}\n`);
        }

        output.write(JSON.stringify(species) + '\n');
      }

      // Delay zwischen Batches
      if (i + CONFIG.BATCH_SIZE < speciesWithoutGerman.length) {
        await sleep(CONFIG.BATCH_DELAY_MS);
      }
    } catch (err) {
      console.log(`  ✗ Batch Fehler: ${err.message}`);
      for (const species of batch) {
        failed++;
        failedLog.write(`${species.taxonKey}\t${species.scientificName}\t${err.message}\n`);
        output.write(JSON.stringify(species) + '\n');
      }
    }
  }

  // 4) Schreibe Species MIT deutschen Namen (unverändert)
  for (const species of speciesWithGerman) {
    output.write(JSON.stringify(species) + '\n');
  }

  output.end();
  failedLog.end();

  console.log();
  console.log('='.repeat(60));
  console.log('Zusammenfassung:');
  console.log('='.repeat(60));
  console.log(`Gesamt Species:           ${allSpecies.length}`);
  console.log(`Bereits mit dt. Namen:    ${speciesWithGerman.length}`);
  console.log(`Ohne dt. Namen (vorher):  ${speciesWithoutGerman.length}`);
  console.log(`✓ Ergänzt aus Wikidata:   ${enriched}`);
  console.log(`✗ Keine Treffer:          ${failed}`);
  console.log();

  const totalWithGerman = speciesWithGerman.length + enriched;
  const totalWithoutGerman = allSpecies.length - totalWithGerman;
  const percent = ((totalWithGerman / allSpecies.length) * 100).toFixed(1);

  console.log(`Ergebnis:`);
  console.log(`  Mit deutschen Namen:    ${totalWithGerman} (${percent}%)`);
  console.log(`  Ohne deutschen Namen:   ${totalWithoutGerman}`);
  console.log();
  console.log(`✓ Gespeichert: ${CONFIG.OUTPUT_FILE}`);
  console.log();
  console.log('TEST Phase 2.5 abgeschlossen!');
}

// Script ausführen
if (require.main === module) {
  main().catch((err) => {
    console.error('\n❌ Fehler:', err.message);
    console.error(err.stack);
    process.exit(1);
  });
}

module.exports = { main };
