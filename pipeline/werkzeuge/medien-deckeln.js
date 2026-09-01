#!/usr/bin/env node
'use strict';

/**
 * Medien deckeln — je Pflanze und Organ die bestbewerteten N behalten.
 *
 *   node pipeline/werkzeuge/medien-deckeln.js --pro-organ=120 --zaehlen
 *   node pipeline/werkzeuge/medien-deckeln.js --pro-organ=120 --aus=data/build/plantmedias.gedeckelt.ndjson
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 🔴 WARUM ES DIESEN DECKEL GIBT — DER PLATZ AUF DEM CLUSTER REICHT NICHT
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Am 02.09.2026 gemessen: Der M10 hat **9,90 GB** Platte, davon sind **3,44 GB** belegt. Der volle
 * Mediensatz braucht dort ~2 GB Daten und ~5 GB Indizes — `plant-media.schema.ts` legt **zehn**
 * Indizes an, fuenf davon noch auf `taxonKey`. Zusammen ~7 GB bei 6,46 GB frei. Es passt nicht.
 *
 * Die Verteilung macht den Deckel billig: **1.046 Pflanzen (7 %) tragen 11,7 Mio. Bilder (63 %)**,
 * waehrend 5.914 Pflanzen zusammen nur 78.869 haben. Wer die Spitze kappt, verliert fast nichts an
 * BREITE und sehr viel an Masse.
 *
 * ⚠️ Gedeckelt wird je (Pflanze, ORGAN), nicht je Pflanze. Ein reiner Deckel nach Bewertung
 * loescht bei einer Pflanze, deren bestbewertete Bilder alle Blueten sind, die Rinde vollstaendig —
 * und genau die Organvielfalt ist das, was `plantInContext` und `floraCheck` brauchen (Stufe 4 des
 * Datenbasis-Plans). Je Organ gedeckelt bleibt jedes Organ erhalten, das die Pflanze hat.
 *
 * ⚠️ Der Deckel ist KEINE Einbahnstrasse. Der Import ist ein Upsert auf
 * {plantKey, occurrenceId, organ, url} — ein spaeterer Lauf mit der vollen Datei traegt die
 * fehlenden Zeilen einfach nach, ohne eine einzige bestehende anzufassen.
 *
 * ⚠️ Das Bildfenster des Quiz ist 300 gross (`MEDIA_WINDOW_SIZE`) und WANDERT ueber den ganzen
 * Vorrat. Ein Deckel unter 300 haette daraus ein festes Fenster gemacht: dieselben Bilder bei
 * jeder Begegnung. Mit 120 je Organ und sechs Organen bleiben bis zu 720 Bilder je Pflanze, also
 * genug Vorrat, damit das Fenster sich weiterhin bewegt.
 *
 * Die Datei ist nach Pflanze GRUPPIERT (nachgemessen: jede Pflanze in einem zusammenhaengenden
 * Block), aber innerhalb eines Blocks nicht nach Bewertung sortiert. Deshalb wird je Block
 * gepuffert und sortiert — der groesste Block sind ~43.000 Zeilen, also wenige Megabyte.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const arg = n => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').split('=')[1];
const PRO_ORGAN = Number(arg('pro-organ') || 120);
const NUR_ZAEHLEN = process.argv.includes('--zaehlen');
const EIN = arg('ein') || 'data/build/plantmedias.ndjson';
const AUS = arg('aus') || 'data/build/plantmedias.gedeckelt.ndjson';

const fmt = n => n.toLocaleString('de-DE');

async function main() {
  const einPfad = path.resolve(EIN);
  const ausStrom = NUR_ZAEHLEN ? null : fs.createWriteStream(path.resolve(AUS));

  let gelesen = 0;
  let behalten = 0;
  let pflanzen = 0;
  let gekappt = 0;
  let block = [];
  let blockKey = null;

  /** Einen fertigen Block auswerten: je Organ die besten N. */
  const blockAbschliessen = () => {
    if (!block.length) return;
    pflanzen += 1;
    const jeOrgan = new Map();
    for (const z of block) {
      const o = z.organ || 'unknown';
      if (!jeOrgan.has(o)) jeOrgan.set(o, []);
      jeOrgan.get(o).push(z);
    }
    let ausBlock = 0;
    for (const [, zeilen] of jeOrgan) {
      // Stabil: erst Bewertung absteigend, bei Gleichstand die URL — sonst waere die Auswahl
      // von der Reihenfolge im Puffer abhaengig und damit nicht wiederholbar.
      zeilen.sort((a, b) => (b.rating || 0) - (a.rating || 0) || (a.url < b.url ? -1 : 1));
      const nehmen = zeilen.slice(0, PRO_ORGAN);
      ausBlock += nehmen.length;
      if (!NUR_ZAEHLEN) for (const z of nehmen) ausStrom.write(JSON.stringify(z) + '\n');
    }
    behalten += ausBlock;
    if (ausBlock < block.length) gekappt += 1;
    block = [];
  };

  const rl = readline.createInterface({
    input: fs.createReadStream(einPfad),
    crlfDelay: Infinity,
  });

  for await (const zeile of rl) {
    if (!zeile) continue;
    gelesen += 1;
    const d = JSON.parse(zeile);
    const key = d.plantKey ?? d.taxonKey;
    if (key !== blockKey) {
      blockAbschliessen();
      blockKey = key;
    }
    block.push(d);
    if (gelesen % 1000000 === 0) process.stdout.write(`\r  ${fmt(gelesen)} gelesen …`);
  }
  blockAbschliessen();
  if (ausStrom) await new Promise(r => ausStrom.end(r));

  console.log(`\r  gelesen   ${fmt(gelesen)}`);
  console.log(`  behalten  ${fmt(behalten)}  (${((behalten / gelesen) * 100).toFixed(1)} %)`);
  console.log(`  Pflanzen  ${fmt(pflanzen)}, davon gekappt ${fmt(gekappt)}`);
  if (!NUR_ZAEHLEN) console.log(`  geschrieben nach ${AUS}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
