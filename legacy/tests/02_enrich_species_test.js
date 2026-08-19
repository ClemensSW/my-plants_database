#!/usr/bin/env node
/**
 * TEST-VERSION: Phase 2 - Species-Daten anreichern (nur 50)
 *
 * Reichert die 50 Test-taxonKeys mit taxonomischen Daten an.
 *
 * Input:  data/intermediate/plantnet_taxonKeys_test.json
 * Output: data/intermediate/plantnet_species_raw_test.ndjson
 *
 * Usage: node scriptsTest/02_enrich_species_test.js
 */

const fs = require('fs');
const path = require('path');
const {
  getSpecies,
  getVernacularNames,
  filterGermanNames,
  pickPreferredGerman,
  pickPreferredFamilyName,
  uniqBy,
} = require('../utils/gbif-helpers');

// Konfiguration
const CONFIG = {
  INPUT_FILE: path.join(__dirname, '../../data/intermediate/plantnet_taxonKeys_test.json'),
  OUTPUT_FILE: path.join(__dirname, '../../data/intermediate/plantnet_species_raw_test.ndjson'),
  FAILED_LOG: path.join(__dirname, '../../data/intermediate/failed_keys_test.txt'),
  DATASET_KEY: '7a3679ef-5582-4aaa-81f0-8c2545cafc81',
  CONCURRENCY: 5, // Niedriger für Test
};

// In-Memory Cache für Familien (vermeidet redundante API-Calls)
const familyCache = new Map();

/**
 * Holt deutsche Familiennamen mit Cache
 */
async function getFamilyData(familyKey) {
  if (!familyKey) return { germanFamilyName: null };

  if (familyCache.has(familyKey)) {
    return familyCache.get(familyKey);
  }

  let germanFamilyName = null;
  try {
    const familyUsage = await getSpecies(familyKey, 'de');
    const familyVn = await getVernacularNames(familyKey);
    const germanNames = filterGermanNames(familyVn.results || []);
    germanFamilyName = pickPreferredFamilyName(familyUsage, germanNames);
  } catch (err) {
    // Fehler ignorieren
  }

  const result = { germanFamilyName };
  familyCache.set(familyKey, result);
  return result;
}

async function buildDocFromTaxonKey(originalKey) {
  const base = await getSpecies(originalKey, 'de');
  const acceptedKey = base.acceptedKey || base.key;
  const usage = acceptedKey !== base.key
    ? await getSpecies(acceptedKey, 'de')
    : base;

  let germanNames = [];
  try {
    const vn = await getVernacularNames(usage.key);
    germanNames = filterGermanNames(vn.results || []);
    germanNames = uniqBy(germanNames, (x) => x.name.trim().toLowerCase());
  } catch (err) {
    // Bei Fehler: leere Liste
  }

  const germanName = pickPreferredGerman(usage, germanNames);

  // Familie: Botanischer Name direkt aus GBIF, deutscher Name via Cache
  const family = usage.family || null;
  const familyKey = usage.familyKey || null;
  const { germanFamilyName } = await getFamilyData(familyKey);

  return {
    taxonKey: usage.key,
    acceptedKey,
    originalKey,
    scientificName: usage.scientificName || usage.canonicalName || null,
    canonicalName: usage.canonicalName || null,
    rank: usage.rank || null,
    status: usage.taxonomicStatus || base.taxonomicStatus || null,
    family,
    familyKey,
    germanFamilyName,
    germanName,
    germanNames,
    source: {
      derivedFromDatasetKey: CONFIG.DATASET_KEY,
      retrievedAt: new Date().toISOString(),
    },
  };
}

async function main() {
  console.log('='.repeat(60));
  console.log('TEST-VERSION: Phase 2 - Species-Daten anreichern (nur 50)');
  console.log('='.repeat(60));
  console.log(`Input:  ${CONFIG.INPUT_FILE}`);
  console.log(`Output: ${CONFIG.OUTPUT_FILE}`);
  console.log();

  // p-limit dynamisch importieren (ESM)
  const { default: pLimit } = await import('p-limit');

  const raw = JSON.parse(fs.readFileSync(CONFIG.INPUT_FILE, 'utf8'));
  const allKeys = Array.from(
    new Set(raw.map((k) => Number(k)).filter((n) => Number.isFinite(n)))
  );

  if (!allKeys.length) {
    throw new Error('Keine taxonKeys im Input gefunden.');
  }

  console.log(`✓ ${allKeys.length} taxonKeys geladen`);
  console.log(`⚙ Concurrency: ${CONFIG.CONCURRENCY}`);
  console.log();

  const nd = fs.createWriteStream(CONFIG.OUTPUT_FILE, { flags: 'w' });
  const failedLog = fs.createWriteStream(CONFIG.FAILED_LOG, { flags: 'w' });

  const limit = pLimit(CONFIG.CONCURRENCY);
  let done = 0;
  let failed = 0;

  function progress() {
    if (process.stdout.isTTY) {
      const percent = ((done / allKeys.length) * 100).toFixed(1);
      process.stdout.write(`\rVerarbeitet: ${done}/${allKeys.length} (${percent}%)`);
    }
  }

  const tasks = allKeys.map((k) =>
    limit(async () => {
      try {
        const doc = await buildDocFromTaxonKey(k);
        nd.write(JSON.stringify(doc) + '\n');
      } catch (e) {
        failedLog.write(String(k) + '\n');
        failed++;
      } finally {
        done++;
        progress();
      }
    })
  );

  await Promise.all(tasks);

  nd.end();
  failedLog.end();

  console.log();
  console.log();
  console.log(`✓ Erfolgreich: ${done - failed}/${allKeys.length}`);
  console.log(`✗ Fehler:      ${failed}`);
  if (failed > 0) {
    console.log(`  → siehe ${CONFIG.FAILED_LOG}`);
  }
  console.log();
  console.log('TEST Phase 2 abgeschlossen!');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('\n❌ Fehler:', err.message);
    console.error(err.stack);
    process.exit(1);
  });
}

module.exports = { main };
