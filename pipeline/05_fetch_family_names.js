#!/usr/bin/env node
'use strict';
/**
 * Schritt 5: Deutsche Familiennamen von GBIF holen.
 *
 * Warum ein eigener Schritt: Schritt 1 holt den Artbestand, aber GBIF liefert den deutschen
 * Familiennamen nicht im Suchergebnis mit — er hängt am Familien-Taxon. Die alte Pipeline holte
 * ihn je Art (mit Cache); das sind hunderttausende Abfragen für ein paar hundert Werte.
 *
 * Hier wird stattdessen **einmal je Familie** gefragt. Im ganzen Pflanzenreich gibt es rund 1.600
 * akzeptierte Familien — der Lauf ist in Minuten durch und danach für Jahre gültig.
 *
 * 🔴 Ohne diesen Schritt fehlt `germanFamily` im Katalog. Das ist ein **Rückschritt gegenüber dem
 * heutigen Bestand**: Die App zeigt den deutschen Familiennamen bereits (`CatalogPlant.germanFamily`).
 *
 * Wiederaufnahme: Die Ergebnisdatei ist zugleich der Zwischenstand. Ein zweiter Lauf fragt nur
 * Familien ab, die noch fehlen.
 *
 * Input:  data/raw/gbif/species_accepted.ndjson
 * Output: data/work/family_names.json   { "<familyKey>": { family, germanFamily } }
 *
 * Usage: node pipeline/05_fetch_family_names.js
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const { DIRS, FILES, ensureDirs, requireFiles, rel } = require('./lib/paths');
const { getSpeciesWithVernaculars, pool } = require('./lib/gbif');

const OUT_FILE = path.join(DIRS.work, 'family_names.json');

const CONFIG = { CONCURRENCY: 5 };

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}
const fmt = (n) => Number(n).toLocaleString('de-DE');

/** Deutsche Trivialnamen aus der GBIF-Antwort, kürzester zuerst. */
function pickGermanFamily(usage) {
  const direct = usage.vernacularName;
  const german = (usage.vernacularNames || [])
    .filter((v) => ['de', 'deu', 'ger'].includes(String(v.language || '').toLowerCase()))
    .map((v) => String(v.vernacularName || '').trim())
    .filter(Boolean);
  if (direct && /[a-zäöüß]/i.test(direct)) german.unshift(String(direct).trim());
  if (!german.length) return null;
  // Deutsche Pflanzenfamilien enden konventionell auf „-gewächse". Solche Namen haben Vorrang.
  //
  // Ohne diese Regel gewinnt die Kürze, und GBIF führt für Fagaceae sowohl „Buchengewächse" als
  // auch „Buchen" — dann stünde die Gattung als Familienname im Katalog. Gemessen an 1.225
  // Familien betrifft das mehrere Dutzend.
  const gewaechse = german.filter((n) => /gewächse$/i.test(n));
  const pool = gewaechse.length ? gewaechse : german;
  return pool.sort((a, b) => a.length - b.length)[0];
}

async function main() {
  requireFiles('speciesAccepted');
  ensureDirs('work');

  console.log('='.repeat(64));
  console.log('Schritt 5: Deutsche Familiennamen');
  console.log('='.repeat(64));

  // Alle Familien des Katalogs sammeln
  const families = new Map();
  const rl = readline.createInterface({
    input: fs.createReadStream(FILES.speciesAccepted, 'utf8'),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const sp = JSON.parse(line);
    if (sp.familyKey && sp.family && !families.has(sp.familyKey)) {
      families.set(sp.familyKey, sp.family);
    }
  }
  log(`${fmt(families.size)} Familien im Katalog`);

  // Zwischenstand
  let known = {};
  try { known = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')); } catch { /* erster Lauf */ }
  const open = [...families.keys()].filter((k) => !known[k]);
  log(`bereits bekannt: ${fmt(Object.keys(known).length)} · offen: ${fmt(open.length)}`);

  if (!open.length) {
    log('Nichts zu tun.');
    return;
  }

  let done = 0;
  let withGerman = 0;
  await pool(open, CONFIG.CONCURRENCY, async (familyKey) => {
    try {
      const usage = await getSpeciesWithVernaculars(familyKey);
      const germanFamily = pickGermanFamily(usage);
      known[familyKey] = { family: families.get(familyKey), germanFamily };
      if (germanFamily) withGerman++;
    } catch (err) {
      known[familyKey] = { family: families.get(familyKey), germanFamily: null, error: err.message };
    }
    done++;
    if (done % 100 === 0) {
      log(`  ${fmt(done)}/${fmt(open.length)} · mit deutschem Namen ${fmt(withGerman)}`);
      fs.writeFileSync(OUT_FILE, JSON.stringify(known, null, 1), 'utf8');
    }
  });
  fs.writeFileSync(OUT_FILE, JSON.stringify(known, null, 1), 'utf8');

  const total = Object.keys(known).length;
  const hit = Object.values(known).filter((f) => f.germanFamily).length;
  console.log();
  console.log('='.repeat(64));
  log(`Familien:             ${fmt(total)}`);
  log(`mit deutschem Namen:  ${fmt(hit)} (${(100 * hit / total).toFixed(0)} %)`);
  log(`Output:               ${rel(OUT_FILE)}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('\n❌ Fehler:', err.message);
    console.error(err.stack);
    process.exit(1);
  });
}

module.exports = { main, OUT_FILE, pickGermanFamily };
