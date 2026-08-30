#!/usr/bin/env node
'use strict';
/**
 * Schritt 12: Die sechs Prüfungspflanzenlisten der Landwirtschaftskammer NRW bauen.
 *
 *     node pipeline/12_build_lwk_nrw_lists.js            # Trockenlauf mit Bericht
 *     node pipeline/12_build_lwk_nrw_lists.js --write    # full.ndjson schreiben
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * WAS DIESER SCHRITT VOM ACHTEN UNTERSCHEIDET
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Schritt 8 baut die GaLaBau-Liste aus einer fertigen CSV. Hier gibt es keine CSV — die Quelle
 * sind sechs PDFs, in vier verschiedenen Bauarten gesetzt (siehe `lib/lwk-nrw-listen.js`).
 * Alles danach ist dasselbe: auflösen gegen den Katalog, entdoppeln, nach Bekanntheit sortieren,
 * `full.ndjson` schreiben.
 *
 * ⚠️ Braucht `pdftotext` (poppler). Die extrahierten Texte werden NICHT ins Repo gelegt: Sie sind
 * ableitbar, und eine abgeleitete Datei neben ihrer Quelle ist eine zweite Wahrheit, die driften
 * kann. Im Repo liegt das PDF samt `quelle.json` mit Prüfsumme.
 *
 * 🔴 Die Auflösungsquote ist hier deutlich niedriger als bei GaLaBau, und das hat einen Grund, der
 * nicht am Parser liegt: Vier der sechs Listen stammen aus den Jahren 2006 bis 2009. Ihre
 * botanischen Namen sind teils drei Nomenklaturrevisionen alt — die Synonymbrücke des Katalogs
 * fängt viel davon, aber nicht alles.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execFileSync } = require('child_process');

const { DIRS, FILES, requireFiles, rel } = require('./lib/paths');
const { stripAuthorship } = require('./lib/botanical-name');
const { vergleichsname, verschmelzeAufloesungen, sortiere } = require('./lib/exam-liste');
const L = require('./lib/lwk-nrw-listen');

const WRITE = process.argv.includes('--write');
const fmt = (n) => Number(n).toLocaleString('de-DE');
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

/**
 * Die sechs Listen mit ihrer Bauart und ihren Abschnitten.
 *
 * Die Abschnittsnamen stehen hier und nicht im Parser: Sie sind eine Eigenschaft DIESER Ausgabe.
 * Kommt nächstes Jahr eine neue mit einem zusätzlichen Kapitel, ändert sich eine Zeile hier.
 */
const LISTEN = [
  { fachrichtung: 'baumschule', ausgabe: '2009-08', datei: 'gb-pflanzenliste-baumschule.pdf', bauart: 'gattungsblock',
    abschnitte: ['LAUBGEHÖLZE', 'NADELGEHÖLZE', 'ROSEN', 'OBSTGEHÖLZE', 'Kernobst', 'Steinobst', 'Beerenobst', 'Schalenobst', 'Schling', 'Stauden', 'Unkräuter'] },
  { fachrichtung: 'friedhofsgaertnerei', ausgabe: '2006-01', datei: 'gb-pflanzenliste-friedhof.pdf', bauart: 'gattungsblock',
    abschnitte: ['NADELGEHÖLZE', 'LAUBGEHÖLZE', 'STAUDEN', 'BEET', 'WICHTIGE', 'UNKRÄUTER'] },
  { fachrichtung: 'zierpflanzenbau', ausgabe: '2006-01', datei: 'gb-pflanzenliste-zierpflanzen.pdf', bauart: 'gattungsblock',
    abschnitte: ['Beet', 'Topfpflanzen', 'Schnittblumen', 'Stauden', 'Gehölze', 'Unkräuter'] },
  { fachrichtung: 'staudengaertnerei', ausgabe: '2006-09', datei: 'gb-pflanzenliste-staudengaertnerei.pdf', bauart: 'dreizeiler' },
  { fachrichtung: 'gemuesebau', ausgabe: '2023-12', datei: 'gb-pflanzenliste-gemuesebau.pdf', bauart: 'einzeiler' },
  { fachrichtung: 'obstbau', ausgabe: '2023-12', datei: 'gb-pflanzenliste-obstbau.pdf', bauart: 'obstbau' },
];

const BUNDESLAND = 'north-rhine-westphalia';

function leseListe(eintrag, pdfPfad) {
  const text = execFileSync('pdftotext', ['-layout', pdfPfad, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  switch (eintrag.bauart) {
    case 'gattungsblock': return L.leseGattungsblock(text, { abschnitte: eintrag.abschnitte });
    case 'dreizeiler': return L.leseDreizeiler(text);
    case 'einzeiler': return L.leseEinzeiler(text);
    case 'obstbau': return L.leseObstbau(text);
    default: throw new Error(`Unbekannte Bauart: ${eintrag.bauart}`);
  }
}

async function katalogIndex() {
  const index = new Map();
  const eintragen = (k, w, weg) => { if (k && !index.has(k)) index.set(k, { ...w, via: weg }); };
  let anzahl = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(FILES.buildPlants, 'utf8'), crlfDelay: Infinity });
  for await (const zeile of rl) {
    if (!zeile.trim()) continue;
    const p = JSON.parse(zeile);
    anzahl++;
    const w = { plantKey: p.plantKey ?? p.taxonKey ?? null, canonicalName: p.canonicalName, germanName: p.germanName || null, imagesCount: p.imagesCount || 0 };
    eintragen(vergleichsname(p.canonicalName), w, 'canonical');
    eintragen(vergleichsname(stripAuthorship(p.scientificName)), w, 'scientific');
    for (const s of p.synonyms || []) eintragen(vergleichsname(stripAuthorship(s)), w, 'synonym');
  }
  return { index, anzahl };
}

async function main() {
  requireFiles('buildPlants');
  console.log('='.repeat(78));
  console.log('Schritt 12: Prüfungspflanzenlisten der Landwirtschaftskammer NRW');
  console.log('='.repeat(78));

  const { index, anzahl } = await katalogIndex();
  log(`Katalog: ${fmt(anzahl)} Pflanzen · ${fmt(index.size)} Schlüssel\n`);

  const bericht = [];
  for (const liste of LISTEN) {
    const basis = path.join(DIRS.examLists, 'gartenbau', liste.fachrichtung, BUNDESLAND);
    const pdf = path.join(basis, 'sources', liste.ausgabe, liste.datei);
    if (!fs.existsSync(pdf)) { console.log(`  ⚠ ${liste.fachrichtung}: PDF fehlt (${rel(pdf)})`); continue; }

    const { eintraege, verworfen } = leseListe(liste, pdf);

    // Entdoppeln über den Vergleichsnamen — die Listen nennen manche Pflanze in zwei Abschnitten.
    const nachName = new Map();
    for (const e of eintraege) {
      const schluessel = vergleichsname(e.botanisch);
      if (!schluessel) continue;
      if (!nachName.has(schluessel)) {
        nachName.set(schluessel, {
          schluessel,
          botanicalName: e.botanisch,
          germanName: e.deutsch || null,
          kategorie: e.kategorie || null,
          rang: /'/.test(e.botanisch) ? 'sorte' : 'art',
          parentBotanicalName: null,
          zwischenpruefung: !!e.zwischenpruefung,
        });
      } else if (e.zwischenpruefung) {
        nachName.get(schluessel).zwischenpruefung = true;
      }
    }
    const liste2 = [...nachName.values()];

    let synonym = 0;
    for (const e of liste2) {
      const treffer = index.get(e.schluessel);
      e.plantKey = treffer?.plantKey ?? null;
      e.imagesCount = treffer?.imagesCount ?? 0;
      e.matchedVia = treffer?.via ?? null;
      e.matchedName = treffer && vergleichsname(treffer.canonicalName) !== e.schluessel ? treffer.canonicalName : null;
      if (treffer?.via === 'synonym') synonym++;
    }

    const zeilen = sortiere(verschmelzeAufloesungen(liste2)).map((e) => ({
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
      courses: [],
      /** Die Liste hebt diese Pflanzen für die Zwischenprüfung hervor (`ZP`). */
      zwischenpruefung: e.zwischenpruefung,
      imagesCount: e.imagesCount,
    }));

    const aufgeloest = zeilen.filter((z) => z.plantKey != null).length;
    const prozent = zeilen.length ? Math.round((100 * aufgeloest) / zeilen.length) : 0;
    console.log(
      `  ${liste.fachrichtung.padEnd(20)} ${String(zeilen.length).padStart(4)} Einträge  ` +
      `${String(aufgeloest).padStart(4)} aufgelöst = ${String(prozent).padStart(3)} %  ` +
      `(davon ${String(synonym).padStart(3)} über ein Synonym)  ` +
      `${String(verworfen.length).padStart(3)} Zeilen verworfen`,
    );
    bericht.push({ liste, zeilen, verworfen });

    if (WRITE) {
      fs.writeFileSync(path.join(basis, 'full.ndjson'), zeilen.map((z) => JSON.stringify(z)).join('\n') + '\n', 'utf8');
      // Die verworfenen Zeilen NEBEN die Liste, nicht in ein Protokoll: Wer die Liste prüft, soll
      // sehen, was der Parser nicht verstanden hat, ohne danach suchen zu müssen.
      fs.writeFileSync(
        path.join(basis, 'sources', liste.ausgabe, 'verworfen.json'),
        JSON.stringify(verworfen, null, 1) + '\n',
        'utf8',
      );
    }
  }

  const gesamt = bericht.reduce((s, b) => s + b.zeilen.length, 0);
  const auf = bericht.reduce((s, b) => s + b.zeilen.filter((z) => z.plantKey != null).length, 0);
  console.log(`\n  ${'GESAMT'.padEnd(20)} ${String(gesamt).padStart(4)} Einträge  ${String(auf).padStart(4)} aufgelöst = ${Math.round((100 * auf) / gesamt)} %`);

  if (!WRITE) console.log('\n── TROCKENLAUF ── mit --write werden die Dateien geschrieben');
  else console.log('\nGeschrieben: je Fachrichtung `full.ndjson` und `sources/<ausgabe>/verworfen.json`');
}

if (require.main === module) {
  main().catch((err) => { console.error('\n❌ Fehler:', err.message); console.error(err.stack); process.exit(1); });
}
