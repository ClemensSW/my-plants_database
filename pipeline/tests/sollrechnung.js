'use strict';

/**
 * Die Sollrechnung: Sind alle Pflanzen angekommen, die ankommen können?
 *
 *     npm run pruefe:soll
 *
 * ## Warum es diese Rechnung gibt
 *
 * Am 23.08.2026 fehlten **309 Pflanzen** im Katalog, die Pl@ntNet mit deutschem Namen und Bildern
 * führt — darunter das Schmalblättrige Weidenröschen (25.588 Bilder) und Feldsalat. Sie sind nicht
 * an einer Fehlermeldung gescheitert, sondern an einem stillen `null` in der Schlüsselauflösung.
 *
 * Ein stiller Verlust wiederholt sich, wenn ihn nichts laut macht. **Nach jedem Pipeline-Lauf
 * ausführen.** Weicht „angekommen" von der Sollmenge ab, ist wieder etwas verloren gegangen.
 *
 * ## Die Sollzahl kostet keine Anfrage
 *
 * Pl@ntNet liefert je Art seine eigene Bildzahl mit (`imagesCount` in der Namensernte). Wer einen
 * deutschen Namen UND mindestens ein Bild hat, gehört in den Katalog. Am 23.08.2026: **12.169**
 * Arten mit auflösbarem GBIF-Schlüssel.
 *
 * ## ⚠️ Nicht jede Lücke ist ein Fehler
 *
 * Ein Teil der Arten hat ausschliesslich Bilder unter NonCommercial-Lizenz. Die schliesst der
 * Lizenzfilter zu Recht aus — MyPlants hat ein Abo-Modell. Diese Rechnung trennt beides, damit
 * niemand später einem Gespenst hinterherjagt:
 *
 *     🔴 fehlt          deutscher Name + erlaubtes Bild vorhanden, trotzdem nicht im Katalog
 *     ℹ️  nur NC-Bilder  korrekt ausgeschlossen, kein Handlungsbedarf
 *
 * Der zweite Durchgang liest die 4,5-GB-Bilddatei und dauert ein bis zwei Minuten. Mit
 * `--schnell` entfällt er; dann werden alle Lücken als „fehlt" gezählt, was zu pessimistisch ist.
 */

const fs = require('fs');
const readline = require('readline');
const { FILES } = require('../lib/paths');

const ERLAUBT = new Set(['cc-by', 'cc-by-sa', 'cc0', 'cc-0', 'public']);
const SCHNELL = process.argv.includes('--schnell');
const fmt = (n) => Number(n).toLocaleString('de-DE');

async function* readNdjson(file) {
  const rl = readline.createInterface({
    input: fs.createReadStream(file, 'utf8'),
    crlfDelay: Infinity,
  });
  for await (const line of rl) if (line.trim()) yield JSON.parse(line);
}

const main = async () => {
  for (const [name, datei] of [
    ['Schlüsselkarte', FILES.gbifKeyMap],
    ['Namensernte', FILES.plantnetNames],
    ['gebaute Pflanzen', FILES.buildPlants],
  ]) {
    if (!fs.existsSync(datei)) {
      console.error(`\n🔴 ${name} fehlt: ${datei}\n   Ohne sie prueft diese Rechnung nichts.\n`);
      process.exit(1);
    }
  }

  console.log('\n=== SOLLRECHNUNG ===\n');

  const karte = new Map();
  for (const r of await readAll(FILES.gbifKeyMap)) karte.set(String(r.quelle), r.ziel);

  const gebaut = new Set();
  for (const p of await readAll(FILES.buildPlants)) gebaut.add(p.taxonKey);

  const soll = [];
  for (const d of await readAll(FILES.plantnetNames)) {
    const de = (d.commonNames || {}).de || [];
    if (de.length && (d.imagesCount || 0) > 0 && d.gbifKey) {
      soll.push({ name: d.plantnetName, schluessel: String(d.gbifKey), bilder: d.imagesCount });
    }
  }

  const luecken = [];
  let drin = 0;
  for (const s of soll) {
    const ziel = karte.get(s.schluessel);
    if (ziel && gebaut.has(ziel)) drin++;
    else luecken.push({ ...s, grund: ziel ? 'nicht gebaut' : 'nicht aufloesbar' });
  }

  // Zweiter Durchgang: Welche der Lücken haben überhaupt ein erlaubtes Bild?
  const nurNC = new Set();
  if (!SCHNELL && luecken.length) {
    const gesucht = new Set(luecken.map((l) => l.name));
    const mitErlaubtem = new Set();
    process.stdout.write(`  (pruefe Lizenzen von ${luecken.length} Luecken — ein Durchgang ueber die Bilddatei) …`);
    for await (const img of readNdjson(FILES.plantnetImages)) {
      if (!gesucht.has(img.species)) continue;
      if (ERLAUBT.has(String(img.license || '').toLowerCase())) mitErlaubtem.add(img.species);
    }
    for (const l of luecken) if (!mitErlaubtem.has(l.name)) nurNC.add(l.name);
    process.stdout.write('\r' + ' '.repeat(90) + '\r');
  }

  const echt = luecken.filter((l) => !nurNC.has(l.name));

  console.log(`  Sollmenge (dt. Name + Bild + Schluessel):  ${fmt(soll.length).padStart(7)}`);
  console.log(`  ✅ im Katalog angekommen:                   ${fmt(drin).padStart(7)}`);
  if (!SCHNELL) {
    console.log(`  ℹ️  nur NC-Bilder — korrekt gefiltert:       ${fmt(nurNC.size).padStart(7)}`);
  }
  console.log(`  ${echt.length ? '🔴' : '✅'} fehlt:                                   ${fmt(echt.length).padStart(7)}`);

  if (echt.length) {
    console.log('\n  Die bildreichsten Luecken:');
    for (const l of echt.sort((a, b) => b.bilder - a.bilder).slice(0, 10)) {
      console.log(`    ${fmt(l.bilder).padStart(7)} Bilder  ${l.name.padEnd(34)} ${l.grund}`);
    }
    console.log('\n  „nicht aufloesbar" → pipeline/lib/gbif-key-resolver.js, siehe test:aufloeser');
    console.log('  „nicht gebaut"     → Name kam im Merge nicht an, oder keine erlaubte Lizenz');
  }

  console.log('\n' + '─'.repeat(70));
  console.log(SCHNELL ? 'ℹ️  --schnell: Lizenzen ungeprueft, „fehlt" ist zu pessimistisch.' : '');
  console.log('─'.repeat(70) + '\n');
  process.exit(0);
};

async function readAll(file) {
  const out = [];
  for await (const r of readNdjson(file)) out.push(r);
  return out;
}

main().catch((err) => {
  console.error('\n❌', err.message);
  process.exit(1);
});
