#!/usr/bin/env node
/**
 * Phase 2: Species-Daten anreichern
 *
 * Reichert taxonKeys mit taxonomischen Daten und deutschen Namen
 * aus der GBIF Species API an. Normalisiert Synonyme auf akzeptierte Namen.
 *
 * Input:  data/intermediate/plantnet_taxonKeys.json
 * Output: data/intermediate/plantnet_species_raw.ndjson
 *
 * Usage: node scripts/02_enrich_species.js
 */

const fs = require('fs');
const path = require('path');
const pLimit = require('p-limit');
const {
  getSpecies,
  getVernacularNames,
  filterGermanNames,
  pickPreferredGerman,
  pickPreferredFamilyName,
  uniqBy,
} = require('./utils/gbif-helpers');

// Konfiguration
const CONFIG = {
  INPUT_FILE: path.join(__dirname, '../data/intermediate/plantnet_taxonKeys.json'),
  OUTPUT_FILE: path.join(__dirname, '../data/intermediate/plantnet_species_raw.ndjson'),
  FAILED_LOG: path.join(__dirname, '../data/intermediate/failed_keys.txt'),
  DATASET_KEY: '7a3679ef-5582-4aaa-81f0-8c2545cafc81',
  CONCURRENCY: 10, // Parallele Requests
};

// In-Memory Cache für Familien (vermeidet redundante API-Calls)
const familyCache = new Map();

/**
 * Holt deutsche Familiennamen mit Cache
 * @param {number} familyKey - GBIF familyKey
 * @returns {Promise<{germanFamilyName: string|null}>}
 */
async function getFamilyData(familyKey) {
  if (!familyKey) return { germanFamilyName: null };

  // Cache-Check
  if (familyCache.has(familyKey)) {
    return familyCache.get(familyKey);
  }

  // API-Aufruf für deutsche Familiennamen
  let germanFamilyName = null;
  try {
    const familyUsage = await getSpecies(familyKey, 'de');
    const familyVn = await getVernacularNames(familyKey);
    const germanNames = filterGermanNames(familyVn.results || []);
    germanFamilyName = pickPreferredFamilyName(familyUsage, germanNames);
  } catch (err) {
    // Fehler ignorieren - Familie bleibt ohne deutschen Namen
  }

  const result = { germanFamilyName };
  familyCache.set(familyKey, result);
  return result;
}

/**
 * Baut ein vollständiges Species-Dokument für einen taxonKey
 */
async function buildDocFromTaxonKey(originalKey) {
  // 1) Basis-Abruf (mit Sprache=de → evtl. vernacularName gesetzt)
  const base = await getSpecies(originalKey, 'de');

  // 2) Auf akzeptierten Namen normalisieren, falls Synonym
  const acceptedKey = base.acceptedKey || base.key;
  const usage = acceptedKey !== base.key
    ? await getSpecies(acceptedKey, 'de')
    : base;

  // 3) Alle deutschen Namen laden
  let germanNames = [];
  try {
    const vn = await getVernacularNames(usage.key);
    germanNames = filterGermanNames(vn.results || []);
    germanNames = uniqBy(germanNames, (x) => x.name.trim().toLowerCase());
  } catch (err) {
    // Bei Fehler: leere Liste
  }

  const germanName = pickPreferredGerman(usage, germanNames);

  // 4) Familie: Botanischer Name direkt aus GBIF, deutscher Name via Cache
  const family = usage.family || null;
  const familyKey = usage.familyKey || null;
  const { germanFamilyName } = await getFamilyData(familyKey);

  return {
    // Schlüssel
    taxonKey: usage.key, // eindeutiger Schlüssel im Backbone
    acceptedKey, // = taxonKey, falls bereits akzeptiert
    originalKey, // der aus plantnet_taxonKeys.json

    // Namen / Taxonomie
    scientificName: usage.scientificName || usage.canonicalName || null,
    canonicalName: usage.canonicalName || null,
    rank: usage.rank || null,
    status: usage.taxonomicStatus || base.taxonomicStatus || null,

    // Familie
    family,
    familyKey,
    germanFamilyName,

    // Deutsch
    germanName,
    germanNames,

    // Audit
    source: {
      derivedFromDatasetKey: CONFIG.DATASET_KEY,
      retrievedAt: new Date().toISOString(),
    },
  };
}

async function main() {
  console.log('='.repeat(60));
  console.log('Phase 2: Species-Daten anreichern');
  console.log('='.repeat(60));
  console.log(`Input:  ${CONFIG.INPUT_FILE}`);
  console.log(`Output: ${CONFIG.OUTPUT_FILE}`);
  console.log();

  // Input lesen
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

  // Output-Streams öffnen
  const nd = fs.createWriteStream(CONFIG.OUTPUT_FILE, { flags: 'w' });
  const failedLog = fs.createWriteStream(CONFIG.FAILED_LOG, { flags: 'w' });

  const limit = pLimit(CONFIG.CONCURRENCY);
  let done = 0;
  let failed = 0;

  // Fortschritt ausgeben
  function progress() {
    if (process.stdout.isTTY) {
      const percent = ((done / allKeys.length) * 100).toFixed(1);
      process.stdout.write(`\rVerarbeitet: ${done}/${allKeys.length} (${percent}%)`);
    }
  }

  // Parallele Verarbeitung
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
  console.log('Phase 2 abgeschlossen!');
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
