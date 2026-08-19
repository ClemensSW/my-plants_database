#!/usr/bin/env node
/**
 * Phase 1: TaxonKeys sammeln
 *
 * Sammelt alle eindeutigen taxonKeys aus dem PlantNet-Dataset auf GBIF
 * mittels Faceting der Occurrence API.
 *
 * Input: Keine (nutzt GBIF API)
 * Output: data/intermediate/plantnet_taxonKeys.json
 *
 * Usage: node scripts/01_fetch_taxonkeys.js
 */

const fs = require('fs');
const path = require('path');
const { getAllTaxonKeysFromDataset } = require('./utils/gbif-helpers');

// Konfiguration
const CONFIG = {
  DATASET_KEY: '7a3679ef-5582-4aaa-81f0-8c2545cafc81', // PlantNet observations
  OUTPUT_FILE: path.join(__dirname, '../data/intermediate/plantnet_taxonKeys.json'),
};

async function main() {
  console.log('='.repeat(60));
  console.log('Phase 1: TaxonKeys sammeln');
  console.log('='.repeat(60));
  console.log(`Dataset: ${CONFIG.DATASET_KEY}`);
  console.log(`Output:  ${CONFIG.OUTPUT_FILE}`);
  console.log();

  console.log('Sammle taxonKeys via GBIF Faceting...');
  const keys = await getAllTaxonKeysFromDataset(CONFIG.DATASET_KEY);

  console.log();
  console.log(`✓ ${keys.length} eindeutige taxonKeys gefunden`);

  // Ausgabe schreiben
  fs.writeFileSync(CONFIG.OUTPUT_FILE, JSON.stringify(keys, null, 2), 'utf8');
  console.log(`✓ Gespeichert: ${CONFIG.OUTPUT_FILE}`);
  console.log();
  console.log('Phase 1 abgeschlossen!');
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
