#!/usr/bin/env node
/**
 * Phase 4: Species-Daten filtern und bereinigen
 *
 * Filtert die angereicherten Species-Daten nach folgenden Kriterien:
 * - Nur rank === "SPECIES"
 * - Nur status === "ACCEPTED"
 * - Nur mit deutschen Namen (germanNames nicht leer)
 * - Vereinfacht auf 4 Felder: taxonKey, scientificName, canonicalName, germanName
 *
 * Input:  data/intermediate/plantnet_species_enriched.ndjson
 * Output: data/output/species.ndjson
 *
 * Usage: node scripts/04_filter_species.js
 */

const fs = require('fs');
const path = require('path');
const {
  transformNDJSON,
  filterSpeciesRank,
  filterAcceptedStatus,
  filterHasGermanNames,
  combineFilters,
  removeFields,
  countLines,
} = require('./utils/filter-helpers');

// Konfiguration
const CONFIG = {
  INPUT_FILE: path.join(__dirname, '../data/intermediate/plantnet_species_enriched.ndjson'),
  OUTPUT_FILE: path.join(__dirname, '../data/output/species.ndjson'),
};

async function main() {
  console.log('='.repeat(60));
  console.log('Phase 4: Species-Daten filtern');
  console.log('='.repeat(60));
  console.log(`Input:  ${CONFIG.INPUT_FILE}`);
  console.log(`Output: ${CONFIG.OUTPUT_FILE}`);
  console.log();

  // Zähle Input-Zeilen
  const inputCount = await countLines(CONFIG.INPUT_FILE);
  console.log(`✓ Input: ${inputCount} Einträge`);
  console.log();

  // Filter-Funktion kombinieren
  const filter = combineFilters(
    filterSpeciesRank,
    filterAcceptedStatus,
    filterHasGermanNames
  );

  // Transform-Funktion: Vereinfachen + Felder entfernen
  const transform = (obj) => {
    // Extrahiere bevorzugten deutschen Namen aus germanNames Array
    let germanName = null;
    if (Array.isArray(obj.germanNames) && obj.germanNames.length > 0) {
      // Bevorzugte Reihenfolge: preferred:true, sonst kürzester Name
      const preferred = obj.germanNames.find(g => g.preferred);
      if (preferred) {
        germanName = preferred.name;
      } else {
        // Kürzesten Namen wählen
        germanName = obj.germanNames
          .map(g => g.name)
          .sort((a, b) => a.length - b.length)[0];
      }
    }

    // Erweiterte Struktur: 7 Felder
    return {
      taxonKey: obj.taxonKey,
      scientificName: obj.scientificName,
      canonicalName: obj.canonicalName,
      germanName: germanName,
      familyKey: obj.familyKey || null,
      family: obj.family || null,
      germanFamilyName: obj.germanFamilyName || null
    };
  };

  console.log('Filter anwenden:');
  console.log('  - rank === "SPECIES"');
  console.log('  - status === "ACCEPTED"');
  console.log('  - germanNames nicht leer');
  console.log();
  console.log('Vereinfachen auf 7 Felder:');
  console.log('  - taxonKey, scientificName, canonicalName, germanName');
  console.log('  - family, familyKey, germanFamilyName');
  console.log('  - germanName: bevorzugter Name aus germanNames Array');
  console.log();

  // Filtern und transformieren
  const { seen, kept } = await transformNDJSON(CONFIG.INPUT_FILE, CONFIG.OUTPUT_FILE, {
    filter,
    transform,
  });

  const removed = seen - kept;
  const percent = ((kept / seen) * 100).toFixed(1);

  console.log(`✓ Behalten: ${kept}/${seen} (${percent}%)`);
  console.log(`✗ Entfernt: ${removed}`);
  console.log();
  console.log(`✓ Gespeichert: ${CONFIG.OUTPUT_FILE}`);
  console.log();
  console.log('Phase 4 abgeschlossen!');
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
