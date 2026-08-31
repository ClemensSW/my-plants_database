#!/usr/bin/env node
'use strict';
/**
 * Schritt 13: Die drei überbetrieblichen GaLaBau-Pflichtkurse (01, 07, 12) bauen.
 *
 *     node pipeline/13_build_uebk_courses.js            # Trockenlauf mit Bericht
 *     node pipeline/13_build_uebk_courses.js --write    # course-NN.ndjson schreiben
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * WAS DIESER SCHRITT ERSETZT
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Die bisherigen `course-01/07/12.ndjson` stammten NICHT aus diesen PDFs. Sie entstanden als
 * Teilmengen von `data/reference/galabau_pflanzen.json` — einer Datei, die selbst schon
 * sortenbereinigt war. Was dabei herauskam, war zu kurz und an den Sorten falsch:
 *
 *     | | bisher | aus dem PDF |
 *     |---|---|---|
 *     | Kurs 01 | 67 | **71** |
 *     | Kurs 07 | 59 | **63** |
 *     | Kurs 12 | 69 | **78** |
 *
 * Die PDFs liegen seit jeher daneben (`sources/2026-02/`). Sie sind die Vorlage, nach der geprüft
 * wird; alles andere ist eine Ableitung davon.
 *
 * ⚠️ Braucht `pdftotext` (poppler) — und zwar mit `-bbox-layout`, nicht `-layout`. Warum, steht
 * ausführlich in `lib/uebk-kurse.js`: Die Tabellenspalten überlappen an mehreren Stellen im
 * Zeichenraster und sind nur über die x-Koordinaten der Wörter sauber zu trennen.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execFileSync } = require('child_process');

const { DIRS, FILES, requireFiles, rel } = require('./lib/paths');
const { stripAuthorship } = require('./lib/botanical-name');
const { vergleichsname, sucheImKatalog, verschmelzeAufloesungen, sortiere } = require('./lib/exam-liste');
const { leseKurs } = require('./lib/uebk-kurse');
const { searchVariants } = require('./lib/search-normalize');

const WRITE = process.argv.includes('--write');
const fmt = (n) => Number(n).toLocaleString('de-DE');

const BUNDESLAND = 'north-rhine-westphalia';
const AUSGABE = '2026-02';
const KURSE = [
  { nummer: '01', datei: 'gb-galabau-pflanzen-01.pdf' },
  { nummer: '07', datei: 'gb-galabau-pflanzen-07.pdf' },
  { nummer: '12', datei: 'gb-galabau-pflanzen-12.pdf' },
];

async function katalogIndex() {
  const index = new Map();
  const eintragen = (k, w, weg) => { if (k && !index.has(k)) index.set(k, { ...w, via: weg }); };
  let anzahl = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(FILES.buildPlants, 'utf8'), crlfDelay: Infinity });
  for await (const zeile of rl) {
    if (!zeile.trim()) continue;
    const p = JSON.parse(zeile);
    anzahl++;
    const w = { plantKey: p.plantKey ?? p.taxonKey ?? null, canonicalName: p.canonicalName, germanName: p.germanName || null, imagesCount: p.imagesCount || 0, searchTerms: p.searchTerms || [] };
    eintragen(vergleichsname(p.canonicalName), w, 'canonical');
    eintragen(vergleichsname(stripAuthorship(p.scientificName)), w, 'scientific');
    for (const s of p.synonyms || []) eintragen(vergleichsname(stripAuthorship(s)), w, 'synonym');
  }
  return { index, anzahl };
}

async function main() {
  requireFiles('buildPlants');
  console.log('='.repeat(78));
  console.log('Schritt 13: Überbetriebliche GaLaBau-Pflichtkurse 01 · 07 · 12');
  console.log('='.repeat(78));

  const { index, anzahl } = await katalogIndex();
  console.log(`Katalog: ${fmt(anzahl)} Pflanzen · ${fmt(index.size)} Schlüssel\n`);

  const basis = path.join(DIRS.examLists, 'gartenbau', 'garten-und-landschaftsbau', BUNDESLAND);
  const bericht = [];

  for (const kurs of KURSE) {
    const pdf = path.join(basis, 'sources', AUSGABE, kurs.datei);
    if (!fs.existsSync(pdf)) { console.log(`  ⚠ Kurs ${kurs.nummer}: PDF fehlt (${rel(pdf)})`); continue; }

    const xml = execFileSync('pdftotext', ['-bbox-layout', pdf, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const { eintraege, verworfen, sternchen } = leseKurs(xml);

    /*
     * Entdoppeln — aber NICHT über `vergleichsname`.
     *
     * 🔴 Der wirft geklammerte Zusätze weg, und das ist für den Katalogabgleich richtig
     * (`Aster 'Kassel' (Dumosus-Gruppe)` und `Aster 'Kassel'` sind dieselbe Pflanze). Bei den
     * Rosen des Kurses 07 ist die Klammer aber das EINZIGE Unterscheidungsmerkmal:
     *
     *     Rosa (Beetrosen) · Rosa (Edelrosen) · Rosa (Kletterrosen)
     *
     * Alle drei ergeben `vergleichsname` = „rosa". Der erste Anlauf hat daraus einen Eintrag
     * gemacht und zwei Zeilen des Prüfungsblatts verloren — gemeldet als „2 Dubletten", was wie
     * ein Befund über die Vorlage aussah und ein Fehler im Werkzeug war.
     *
     * Entdoppelt wird deshalb über den ANZEIGENAMEN; abgeglichen wird weiterhin über
     * `vergleichsname`.
     */
    const entdopplungsschluessel = (name) => vergleichsname(name.replace(/[()]/g, ' '));
    const nachName = new Map();
    for (const e of eintraege) {
      const schluessel = entdopplungsschluessel(e.botanisch);
      if (!schluessel) continue;
      if (!nachName.has(schluessel)) {
        nachName.set(schluessel, {
          schluessel,
          botanicalName: e.botanisch,
          germanName: e.deutsch,
          kategorie: e.kategorie,
          rang: e.rang,
          parentBotanicalName: null,
          zwischenpruefung: false,
        });
      }
    }
    const liste = [...nachName.values()];
    const doppelt = eintraege.length - liste.length;

    /*
     * 🔴 Die Prüfung, die der Nutzer ausdrücklich verlangt hat: Der KATALOGNAME gewinnt in der
     * Anzeige — aber der Name des Kursblatts muss suchbar bleiben.
     *
     * 🔴 Geprüft wird gegen die Regel der APP-SUCHE (`searchVariants`), nicht gegen den
     * Vergleichsschlüssel der Prüfungslisten. Die beiden sind verschieden, und der erste Anlauf
     * hat deshalb acht Fehlalarme gemeldet: `Cotoneaster x suecicus` ist kein Listenschlüssel des
     * Katalogs, über die Suche aber sehr wohl auffindbar — sofern die Suche das Hybridzeichen
     * gleich behandelt. Genau das tat sie NICHT, und das war ein echter Fund; siehe
     * `dropHybridMarker` in `lib/search-normalize.js`.
     */
    let nichtSuchbar = [];
    let abweichend = 0;
    for (const e of liste) {
      const treffer = sucheImKatalog(index, e.botanicalName);
      e.plantKey = treffer?.plantKey ?? null;
      e.imagesCount = treffer?.imagesCount ?? 0;
      e.matchedVia = treffer?.via ?? null;
      e.matchedName =
        treffer && vergleichsname(treffer.canonicalName) !== vergleichsname(e.botanicalName)
          ? treffer.canonicalName
          : null;
      if (e.matchedName) {
        abweichend++;
        const terme = new Set(treffer.searchTerms || []);
        if (!searchVariants(e.botanicalName).some((v) => terme.has(v))) {
          nichtSuchbar.push(`${e.botanicalName} → ${e.matchedName}`);
        }
      }
    }

    const zeilen = sortiere(verschmelzeAufloesungen(liste)).map((e) => ({
      sortIndex: e.sortIndex,
      botanicalName: e.botanicalName,
      germanName: e.germanName,
      kategorie: e.kategorie,
      rang: e.rang,
      parentBotanicalName: e.parentBotanicalName,
      plantKey: e.plantKey,
      parentPlantKey: null,
      matchedVia: e.matchedVia,
      matchedName: e.matchedName,
      alsoKnownAs: e.alsoKnownAs || [],
      /** Der Kurs, aus dem der Eintrag stammt. */
      courses: [kurs.nummer],
      zwischenpruefung: false,
      imagesCount: e.imagesCount,
    }));

    const aufgeloest = zeilen.filter((z) => z.plantKey != null).length;
    const prozent = Math.round((100 * aufgeloest) / zeilen.length);
    console.log(
      `  Kurs ${kurs.nummer}  ${String(zeilen.length).padStart(3)} Einträge  ` +
      `${String(aufgeloest).padStart(3)} aufgelöst = ${String(prozent).padStart(3)} %  ` +
      `${String(abweichend).padStart(2)} Namen weichen ab  ` +
      `${String(verworfen.length).padStart(2)} verworfen  ${doppelt} Dubletten  ${sternchen} Sternchen`,
    );
    for (const v of verworfen) console.log(`      ⚠ ${v.grund}: ${v.text.slice(0, 90)}`);
    for (const n of nichtSuchbar) console.log(`      🔴 Blattname NICHT im Index: ${n}`);

    bericht.push({ kurs, zeilen, verworfen, nichtSuchbar });

    if (WRITE) {
      fs.writeFileSync(path.join(basis, `course-${kurs.nummer}.ndjson`), zeilen.map((z) => JSON.stringify(z)).join('\n') + '\n', 'utf8');
    }
  }

  const gesamt = bericht.reduce((s, b) => s + b.zeilen.length, 0);
  const auf = bericht.reduce((s, b) => s + b.zeilen.filter((z) => z.plantKey != null).length, 0);
  const ausfaelle = bericht.reduce((s, b) => s + b.verworfen.length + b.nichtSuchbar.length, 0);
  console.log(`\n  GESAMT  ${gesamt} Einträge  ${auf} aufgelöst = ${Math.round((100 * auf) / gesamt)} %  ${ausfaelle} Ausfälle`);

  if (!WRITE) console.log('\n── TROCKENLAUF ── mit --write werden die Dateien geschrieben');
  else console.log('\nGeschrieben: je Kurs `course-NN.ndjson`');
}

if (require.main === module) {
  main().catch((err) => { console.error('\n❌ Fehler:', err.message); console.error(err.stack); process.exit(1); });
}
