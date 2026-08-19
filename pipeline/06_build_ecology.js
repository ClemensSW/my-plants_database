#!/usr/bin/env node
'use strict';
/**
 * Schritt 5: Ökologische Zeigerwerte je taxonKey zuordnen.
 *
 * Zwei Quellen, klare Rangfolge:
 *   1. **EIVE 1.0** (`data/raw/ecology/eive-1.0/eive-slim.json`) — der aktuelle Datensatz,
 *      fünf Faktoren L/T/M/R/N mit Nischenposition, -breite und Zahl der Quellsysteme.
 *   2. **Alt-Ellenberg/Tichý** (`backup-ecology-prod-2026-08-02.ndjson`) — nur als Rückfall
 *      dort, wo EIVE nichts hat. Sechs Faktoren inklusive Salz, andere Skala, teils `"x"`.
 *
 * 🔴 Die beiden werden **nicht vermischt**. Sie landen in getrennten Feldern (`eive` / `ecology`),
 * exakt wie im Backend-Schema begründet: Beide Systeme korrelieren mit r ≈ 0,95, eine Mischung
 * sähe deshalb völlig plausibel aus und wäre trotzdem falsch.
 *
 * Kein Netz. Die Synonyme kommen aus Pl@ntNet (Schritt 4), nicht aus GBIF-Abfragen.
 *
 * Input:  data/raw/gbif/species_accepted.ndjson · data/raw/plantnet/plantnet_species_detail.ndjson
 *         data/raw/ecology/eive-1.0/eive-slim.json · backup-ecology-prod-2026-08-02.ndjson
 * Output: data/work/ecology_by_taxon.ndjson (+ .meta.json)
 *
 * Usage: node pipeline/05_build_ecology.js
 */

const fs = require('fs');
const readline = require('readline');

const { FILES, ensureDirs, requireFiles, rel } = require('./lib/paths');
const { binomial, epithetStem, lookup, entryFromCandidates } = require('./lib/taxon-match');

const FACTORS = ['L', 'T', 'M', 'R', 'N'];

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}
const fmt = (n) => Number(n).toLocaleString('de-DE');

async function* readNdjson(file) {
  const rl = readline.createInterface({
    input: fs.createReadStream(file, 'utf8'),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (line.trim()) yield JSON.parse(line);
  }
}

async function main() {
  requireFiles('speciesAccepted', 'eiveSlim');
  ensureDirs('work');

  console.log('='.repeat(64));
  console.log('Schritt 5: Zeigerwerte zuordnen');
  console.log('='.repeat(64));

  // --- Quellen laden ----------------------------------------------------------
  const slimRaw = JSON.parse(fs.readFileSync(FILES.eiveSlim, 'utf8'));
  const slim = slimRaw.values || slimRaw;
  const eiveVersion = slimRaw.version || '1.0';
  log(`EIVE ${eiveVersion}: ${fmt(Object.keys(slim).length)} Schlüssel`);

  // Synonyme aus Pl@ntNet — optional, verbessert nur die Trefferquote
  const synonyms = new Map();
  if (fs.existsSync(FILES.plantnetSpeciesDetail)) {
    for await (const rec of readNdjson(FILES.plantnetSpeciesDetail)) {
      const list = (rec.synonyms || [])
        .map((s) => (typeof s === 'string' ? s : s && (s.name || s.scientificName)))
        .filter(Boolean);
      if (rec.taxonKey && list.length) synonyms.set(rec.taxonKey, list);
    }
    log(`Pl@ntNet-Synonyme: ${fmt(synonyms.size)} Arten`);
  } else {
    log('⚠ Keine Pl@ntNet-Detaildaten — nur Direktpass möglich');
  }

  // Alt-Zeigerwerte, direkt über taxonKey verschlüsselt
  const legacy = new Map();
  if (fs.existsSync(FILES.ecologyLegacyBackup)) {
    for await (const rec of readNdjson(FILES.ecologyLegacyBackup)) {
      if (rec.taxonKey && rec.ecology) legacy.set(rec.taxonKey, rec.ecology);
    }
    log(`Alt-Zeigerwerte (Tichý): ${fmt(legacy.size)} Arten`);
  }

  // --- Zuordnen ---------------------------------------------------------------
  ensureDirs('work');
  const out = fs.createWriteStream(FILES.ecologyByTaxon, { encoding: 'utf8', flags: 'w' });

  const stats = {
    speciesTotal: 0,
    eiveDirect: 0,
    eiveViaSynonym: 0,
    eiveRejected: 0,
    legacyOnly: 0,
    none: 0,
    perFactor: Object.fromEntries(FACTORS.map((f) => [f, 0])),
  };

  for await (const sp of readNdjson(FILES.speciesAccepted)) {
    stats.speciesTotal++;
    const name = sp.canonicalName || sp.scientificName;
    if (!name) { stats.none++; continue; }

    const binom = binomial(name);
    const stem = epithetStem(binom);

    // 1) Direktpass
    let values = lookup(slim, binom);
    let via = 'direct';

    // 2) Synonymbrücke — mit den drei Schutzstufen
    if (!values) {
      const candidates = synonyms.get(sp.taxonKey) || [];
      if (candidates.length) {
        values = entryFromCandidates(candidates, slim, stem);
        if (values) via = 'synonym';
        else if (candidates.some((c) => lookup(slim, c))) stats.eiveRejected++;
      }
    }

    const doc = { taxonKey: sp.taxonKey, canonicalName: sp.canonicalName };

    if (values) {
      const eive = { version: eiveVersion };
      for (const f of FACTORS) {
        if (values[f]) { eive[f] = values[f]; stats.perFactor[f]++; }
      }
      doc.eive = eive;
      doc.eiveVia = via;
      if (via === 'direct') stats.eiveDirect++; else stats.eiveViaSynonym++;
    }

    // 3) Alt-Werte als getrenntes Feld, unabhängig davon ob EIVE traf
    const old = legacy.get(sp.taxonKey);
    if (old) {
      doc.ecology = old;
      if (!values) stats.legacyOnly++;
    }

    if (!values && !old) { stats.none++; continue; }
    out.write(JSON.stringify(doc) + '\n');
  }

  await new Promise((resolve) => out.end(resolve));

  const withEive = stats.eiveDirect + stats.eiveViaSynonym;
  const meta = {
    step: '05_build_ecology',
    finishedAt: new Date().toISOString(),
    sources: {
      eive: { file: rel(FILES.eiveSlim), version: eiveVersion },
      legacy: { file: rel(FILES.ecologyLegacyBackup), note: 'nur Rückfall, nie mit EIVE vermischt' },
      synonyms: { file: rel(FILES.plantnetSpeciesDetail), note: 'ersetzt die GBIF-Synonymabfragen' },
    },
    result: { ...stats, withEive },
  };
  fs.writeFileSync(FILES.ecologyByTaxonMeta, JSON.stringify(meta, null, 2), 'utf8');

  console.log();
  console.log('='.repeat(64));
  log(`Arten geprüft:        ${fmt(stats.speciesTotal)}`);
  log(`mit EIVE:             ${fmt(withEive)}  (direkt ${fmt(stats.eiveDirect)} · über Synonym ${fmt(stats.eiveViaSynonym)})`);
  log(`Synonymtreffer abgelehnt (Schutzstufen): ${fmt(stats.eiveRejected)}`);
  log(`nur Alt-Zeigerwerte:  ${fmt(stats.legacyOnly)}`);
  log(`je Faktor:            ${FACTORS.map((f) => `${f} ${fmt(stats.perFactor[f])}`).join(' · ')}`);
  log(`Output:               ${rel(FILES.ecologyByTaxon)}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('\n❌ Fehler:', err.message);
    console.error(err.stack);
    process.exit(1);
  });
}

module.exports = { main };
