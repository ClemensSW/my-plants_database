#!/usr/bin/env node
'use strict';
/**
 * Schritt 8: Prüfungslisten gegen den Katalog bauen.
 *
 *     node pipeline/08_build_exam_lists.js            # Trockenlauf mit Bericht
 *     node pipeline/08_build_exam_lists.js --write    # Dateien schreiben
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * WAS AN DER VORIGEN FASSUNG FALSCH WAR
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Sie reduzierte **jede** Zeile auf ihr Art-Binomen (`toSpecies`). Aus `Acer platanoides
 * 'Globosum'`, `'Cleveland'` und `'Royal Red'` wurde dreimal `Acer platanoides`, und die 184
 * Sortenzeilen der AuGaLa-Liste fielen auf 0 zusammen: `full.ndjson` hatte 293 Zeilen und keine
 * einzige Sorte. Ein Azubi, der den Kugel-Ahorn lernen soll, bekam den gewöhnlichen Spitz-Ahorn.
 *
 * Das war zu ihrer Zeit richtig — der Katalog kannte keine Sorten. Seit dem Wikidata-Band
 * (`plantKey` 1.000.001.474 … 1.137.807.335) kennt er 2.349 davon.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * DIE VIER DINGE, DIE DIESE FASSUNG ANDERS MACHT
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 *  1. **Sorten bleiben Sorten** und bringen ihre Art mit. Die Regeln stehen in
 *     `lib/exam-liste.js`, geprüft in `tests/exam-liste_test.js`.
 *
 *  2. **`plantKey` statt `taxonKey`.** GBIF führt keine Sorten; sie haben `taxonKey: null`. Eine
 *     Liste, die auf `taxonKey` verweist, kann Sorten grundsätzlich nicht auflösen.
 *
 *  3. **Nicht auflösbare Einträge bleiben drin**, mit `plantKey: null`. Entscheidung von Clemens
 *     am 28.08.2026: Die Liste muss gegenüber dem Prüfungsblatt vollständig sein; die App zeigt
 *     solche Einträge gesperrt. Die Lücke ist damit sichtbar statt verschwiegen.
 *
 *     ⚠️ Sie ist groß und sie schließt sich nicht von allein: 152 der 157 fehlenden Einträge
 *     stehen auch in der Wikidata-Sortenernte nicht (31.979 Sorten durchsucht). `Aster 'Kassel'`,
 *     `Bergenia 'Silberlicht'`, `Chamaecyparis lawsoniana 'Ellwoodii'` — Gärtnersorten, die
 *     botanische Datenbanken nicht führen.
 *
 *  4. **`sortIndex` nach Bekanntheit**, Sorten hinter ihrer Art. Begründung in `lib/exam-liste.js`.
 *
 * Eingabe:  data/build/plants.ndjson · references/augala-pflanzen-428.csv · data/reference/galabau_pflanzen.json
 * Ausgabe:  data/exam-lists/gartenbau/garten-und-landschaftsbau/national/*.ndjson
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const { DIRS, FILES, requireFiles, rel } = require('./lib/paths');
const { stripAuthorship } = require('./lib/botanical-name');
const { vergleichsname, zeilenZuListe, verschmelzeAufloesungen, sortiere } = require('./lib/exam-liste');

const OUT_DIR = path.join(DIRS.examLists, 'gartenbau/garten-und-landschaftsbau/national');
const QUELLE_GESAMT = path.join(OUT_DIR, 'references/augala-pflanzen-428.csv');
const QUELLE_KURSE = path.join(DIRS.reference, 'galabau_pflanzen.json');
const QUELLE_DUMP = path.join(OUT_DIR, 'references/augala-appall.json');

const WRITE = process.argv.includes('--write');
const fmt = (n) => Number(n).toLocaleString('de-DE');
const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

/**
 * Der CSV-Leser.
 *
 * ⚠️ Die Datei beginnt mit einer Byte-Reihenfolge-Marke (U+FEFF). Ohne sie zu entfernen heißt die
 * erste Spalte `﻿botanisch` — und die erste Zeile fällt still heraus.
 */
function leseCsv(datei) {
  const zeilen = fs.readFileSync(datei, 'utf8').replace(/^﻿/, '').split('\n');
  const aus = [];
  for (const zeile of zeilen.slice(1)) {
    if (!zeile.trim()) continue;
    const felder = zeile.match(/"([^"]*)"/g);
    if (!felder || felder.length < 2) continue;
    const [botanisch, deutsch, kategorie] = felder.map((f) => f.slice(1, -1));
    aus.push({ botanisch, deutsch, kategorie: kategorie || null });
  }
  return aus;
}

/** Vergleichsform eines deutschen Namens — für die Kurszuordnung. */
const deutschVergleich = (s) =>
  String(s ?? '').toLowerCase().replace(/[^a-zäöüß0-9]+/g, ' ').trim();

async function main() {
  requireFiles('buildPlants');
  for (const f of [QUELLE_GESAMT, QUELLE_KURSE]) {
    if (!fs.existsSync(f)) throw new Error(`Fehlt: ${f}`);
  }

  console.log('='.repeat(72));
  console.log('Schritt 8: Prüfungslisten gegen den Katalog');
  console.log('='.repeat(72));

  // ── Nachschlagewerk aus dem Katalog ─────────────────────────────────────────
  //
  // Drei Zugänge in absteigender Verlässlichkeit. Der Synonymweg ist kein Zusatz, sondern der
  // Grund, warum die Liste überhaupt auflöst: Die Prüfungslisten führen Namen, die die Taxonomie
  // längst umgehängt hat — `Dicentra spectabilis` heißt heute `Lamprocapnos spectabilis`.
  const index = new Map();
  const eintragen = (schluessel, wert, weg) => {
    if (!schluessel || index.has(schluessel)) return;
    index.set(schluessel, { ...wert, via: weg });
  };

  let katalogAnzahl = 0;
  let sortenImKatalog = 0;
  const rl = readline.createInterface({
    input: fs.createReadStream(FILES.buildPlants, 'utf8'),
    crlfDelay: Infinity,
  });
  for await (const zeile of rl) {
    if (!zeile.trim()) continue;
    const p = JSON.parse(zeile);
    katalogAnzahl++;
    if (p.taxonKey == null) sortenImKatalog++;
    const wert = {
      plantKey: p.plantKey ?? p.taxonKey ?? null,
      taxonKey: p.taxonKey ?? null,
      canonicalName: p.canonicalName,
      germanName: p.germanName || null,
      imagesCount: p.imagesCount || 0,
    };
    eintragen(vergleichsname(p.canonicalName), wert, 'canonical');
    eintragen(vergleichsname(stripAuthorship(p.scientificName)), wert, 'scientific');
    for (const s of p.synonyms || []) eintragen(vergleichsname(stripAuthorship(s)), wert, 'synonym');
  }
  log(`Katalog: ${fmt(katalogAnzahl)} Pflanzen (davon ${fmt(sortenImKatalog)} Sorten) · ${fmt(index.size)} Schlüssel`);

  // ── Die Gesamtliste ─────────────────────────────────────────────────────────
  const csv = leseCsv(QUELLE_GESAMT);
  const liste = zeilenZuListe(csv);

  const wege = {};
  for (const e of liste) {
    const treffer = index.get(e.schluessel);
    if (treffer) {
      e.plantKey = treffer.plantKey;
      e.imagesCount = treffer.imagesCount;
      e.matchedVia = treffer.via;
      // Nur festhalten, wenn der Katalog die Pflanze ANDERS nennt — sonst ist es Rauschen.
      e.matchedName = vergleichsname(treffer.canonicalName) === e.schluessel ? null : treffer.canonicalName;
      if (!e.germanName) e.germanName = treffer.germanName;
      wege[treffer.via] = (wege[treffer.via] || 0) + 1;
    } else {
      e.plantKey = null;
      e.imagesCount = 0;
      e.matchedVia = null;
      e.matchedName = null;
    }
  }

  // Die Elternart einer Sorte auflösen — sie ist der Anker, an dem die App eine gesperrte Sorte
  // trotzdem einordnen kann.
  for (const e of liste) {
    e.parentPlantKey = e.parentBotanicalName ? index.get(vergleichsname(e.parentBotanicalName))?.plantKey ?? null : null;
  }

  // Zwei Prüfungszeilen können auf dieselbe Pflanze zeigen — das sieht man erst jetzt.
  const vorVerschmelzung = liste.length;
  const bereinigt = verschmelzeAufloesungen(liste);

  /*
   * ── Veraltete Namen aus AuGaLas eigener Datenbank ────────────────────────────────────────────
   *
   * `augala-appall.json` führt eine Tabelle `veraltetenamen`: 293 Namenspaare „so hiess sie
   * früher" → „so heisst sie heute", 140 davon zu Pflanzen der Prüfungsliste.
   *
   * 🔴 Das ist genau die Auskunft, die der Azubi braucht und die aus dem PDF nicht hervorgeht.
   * Sein Ausbilder sagt `Cornus alba 'Argenteomarginata'`, die Liste sagt `'Elegantissima'` —
   * ohne diese Paare findet er in der App nichts. Sie landen in `alsoKnownAs` und sind damit
   * suchbar, ohne den angezeigten Namen zu verändern.
   *
   * ⚠️ AuGaLas Sicht auf „veraltet" ist nicht die des Katalogs. Beide Richtungen werden geprüft:
   * Manchmal ist der Katalogname der, den AuGaLa für veraltet hält (`Buxus sempervirens` →
   * `B. sempervirens var. arborescens`), und dann ist das Paar trotzdem ein Suchweg.
   */
  const veraltete = new Map();
  if (fs.existsSync(QUELLE_DUMP)) {
    const dump = JSON.parse(fs.readFileSync(QUELLE_DUMP, 'utf8'));
    const nachId = new Map((dump.pflanzen || []).map((p) => [p.id, p]));
    for (const v of dump.veraltetenamen || []) {
      const heutige = nachId.get(v.pflId);
      if (!heutige?.nameLatein || !v.nameLateinVeraltet) continue;
      for (const schluessel of [vergleichsname(heutige.nameLatein), vergleichsname(v.nameLateinVeraltet)]) {
        if (!schluessel) continue;
        if (!veraltete.has(schluessel)) veraltete.set(schluessel, new Set());
        veraltete.get(schluessel).add(v.nameLateinVeraltet);
      }
    }
    log(`AuGaLa-Datenbank: ${fmt(veraltete.size)} Schlüssel mit veralteten Namen`);
  }
  for (const e of bereinigt) {
    const alt = veraltete.get(e.schluessel);
    if (!alt) continue;
    e.alsoKnownAs = [...new Set([...(e.alsoKnownAs || []), ...alt])].filter(
      (n) => vergleichsname(n) !== e.schluessel,
    );
  }

  // ── Kurszugehörigkeit ───────────────────────────────────────────────────────
  //
  // ⚠️ Merkmal, KEINE Sortierachse. Und die Quelle ist schwach: `galabau_pflanzen.json` ist selbst
  // schon sortenbereinigt (`Acer platanoides` mit dem deutschen Namen „Kugel-Ahorn" — das IST
  // 'Globosum'). Der deutsche Name hat den Sortenverlust überlebt, deshalb wird über ihn
  // zugeordnet und erst danach über den botanischen Namen.
  //
  // Die eigentliche Quelle sind die drei PDFs unter `references/`. Sie neu zu ziehen steht als
  // Stufe A2 im Plan; bis dahin ist `courses` ein Hinweis, keine Zusage.
  const nachDeutsch = new Map();
  for (const e of bereinigt) {
    const k = deutschVergleich(e.germanName);
    if (!k) continue;
    if (!nachDeutsch.has(k)) nachDeutsch.set(k, []);
    nachDeutsch.get(k).push(e);
  }
  const kursQuelle = JSON.parse(fs.readFileSync(QUELLE_KURSE, 'utf8'));
  let kursZugeordnet = 0;
  let kursOffen = 0;
  for (const block of kursQuelle.pflanzen || []) {
    if (block.kurs == null) continue;
    const kurs = String(block.kurs).padStart(2, '0');
    for (const eintrag of block.eintraege || []) {
      const ueberDeutsch = nachDeutsch.get(deutschVergleich(eintrag.deutsch)) || [];
      const ziel = ueberDeutsch.length === 1 ? ueberDeutsch[0] : bereinigt.find((e) => e.schluessel === vergleichsname(eintrag.botanisch));
      if (!ziel) { kursOffen++; continue; }
      ziel.courses = ziel.courses || [];
      if (!ziel.courses.includes(kurs)) ziel.courses.push(kurs);
      kursZugeordnet++;
    }
  }

  // ── Reihenfolge ─────────────────────────────────────────────────────────────
  const sortiert = sortiere(bereinigt);

  const zeilen = sortiert.map((e) => ({
    sortIndex: e.sortIndex,
    botanicalName: e.botanicalName,
    germanName: e.germanName || null,
    kategorie: e.kategorie || null,
    rang: e.rang,
    parentBotanicalName: e.parentBotanicalName || null,
    plantKey: e.plantKey,
    parentPlantKey: e.parentPlantKey ?? null,
    matchedVia: e.matchedVia,
    matchedName: e.matchedName,
    alsoKnownAs: e.alsoKnownAs || [],
    /*
     * 🔴 Immer `false` — und das ist eine Aussage, keine Lücke.
     *
     * Die AuGaLa-Liste kennt KEINE Zwischenprüfungsmarke: null Treffer auf „Zwischenprüfung",
     * null `ZP` im ganzen Dokument. Die sechs NRW-Listen haben sie (112 bis 74 Pflanzen je
     * Liste), die bundesweite nicht.
     *
     * Das Feld steht hier trotzdem, damit alle sieben Listen dieselbe Form haben — eine Liste,
     * der ein Feld fehlt, zwingt jede lesende Stelle zu einer Fallunterscheidung. Die Sortierung
     * ist dieselbe wie überall; sie fällt hier nur auf die Bekanntheit zurück, weil keine Pflanze
     * markiert ist.
     *
     * ⚠️ Die überbetrieblichen Kurse 01/07/12 wären der nächstliegende Ersatz (Kurs 01 liegt im
     * ersten Ausbildungsjahr). Sie gelten aber nur für Nordrhein-Westfalen und taugen deshalb
     * nicht als Reihenfolge einer bundesweiten Liste.
     */
    zwischenpruefung: false,
    courses: (e.courses || []).sort(),
    imagesCount: e.imagesCount,
  }));

  // ── Bericht ─────────────────────────────────────────────────────────────────
  const zaehle = (pruefung) => zeilen.filter(pruefung).length;
  const aufgeloest = zaehle((z) => z.plantKey != null);
  const gesperrt = zeilen.filter((z) => z.plantKey == null);

  console.log();
  log(`CSV-Zeilen:            ${fmt(csv.length)}`);
  log(`Einträge nach Regeln:  ${fmt(vorVerschmelzung)}`);
  log(`  nach Verschmelzung:  ${fmt(zeilen.length)}   (${fmt(vorVerschmelzung - zeilen.length)} zeigten auf dieselbe Pflanze)`);
  log(`  Arten:               ${fmt(zaehle((z) => z.rang === 'art'))}`);
  log(`  Sorten:              ${fmt(zaehle((z) => z.rang === 'sorte'))}`);
  log(`  Gattungen:           ${fmt(zaehle((z) => z.rang === 'gattung'))}   (aus dem Platzhalter 'Sorte' — nie auflösbar)`);
  console.log();
  log(`Aufgelöst:             ${fmt(aufgeloest)} von ${fmt(zeilen.length)}  =  ${Math.round((100 * aufgeloest) / zeilen.length)} %`);
  log(`  Wege:                ${Object.entries(wege).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}`);
  log(`  davon Arten:         ${fmt(zaehle((z) => z.rang === 'art' && z.plantKey != null))} von ${fmt(zaehle((z) => z.rang === 'art'))}`);
  log(`  davon Sorten:        ${fmt(zaehle((z) => z.rang === 'sorte' && z.plantKey != null))} von ${fmt(zaehle((z) => z.rang === 'sorte'))}`);
  log(`🔴 GESPERRT:           ${fmt(gesperrt.length)}  (bleiben in der Liste, ohne Datensatz)`);
  console.log();
  log(`Kurszuordnung:         ${fmt(kursZugeordnet)} zugeordnet · ${fmt(kursOffen)} ohne Ziel   (Merkmal, keine Sortierachse)`);

  const umbenannt = zeilen.filter((z) => z.matchedName);
  if (umbenannt.length) {
    console.log();
    log(`Über ein Synonym gefunden — der Katalog ist neuer als die Prüfungsliste (${umbenannt.length}):`);
    for (const z of umbenannt.slice(0, 12)) console.log(`    ${z.botanicalName}  →  ${z.matchedName}`);
    if (umbenannt.length > 12) console.log(`    … und ${umbenannt.length - 12} weitere`);
  }

  if (gesperrt.length) {
    console.log();
    log(`Gesperrt (${gesperrt.length}) — nach Rang:`);
    for (const rang of ['sorte', 'art', 'gattung']) {
      const treffer = gesperrt.filter((z) => z.rang === rang);
      if (!treffer.length) continue;
      console.log(`  ${rang.padEnd(8)} ${String(treffer.length).padStart(4)}   ${treffer.slice(0, 6).map((z) => z.botanicalName).join(' · ')}${treffer.length > 6 ? ' …' : ''}`);
    }
  }

  console.log();
  log('Die ersten zwölf der fertigen Liste:');
  for (const z of zeilen.slice(0, 12)) {
    console.log(`  ${String(z.sortIndex).padStart(3)}  ${z.plantKey ? '✓' : '🔒'} ${z.botanicalName.padEnd(42)} ${String(z.germanName || '').padEnd(32)} ${fmt(z.imagesCount)}`);
  }

  if (!WRITE) {
    console.log();
    log('── TROCKENLAUF ── mit --write werden die Dateien geschrieben');
    return;
  }

  // ── Schreiben ───────────────────────────────────────────────────────────────
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const schreibe = (name, rows) => {
    const datei = path.join(OUT_DIR, name);
    fs.writeFileSync(datei, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
    log(`  ${rel(datei)}: ${fmt(rows.length)}`);
  };
  console.log();
  schreibe('full.ndjson', zeilen);
  /*
   * 🔴 Die Kurslisten gehören NICHT neben die AuGaLa-Liste.
   *
   * Die AuGaLa-Liste gilt bundesweit (`national`). Die überbetrieblichen Kurse 01/07/12 richtet
   * die Landwirtschaftskammer NRW aus — es sind Lehrgänge EINES Bundeslandes, und ihre Nummern
   * gibt es nur dort. Sie lagen unter `national/` und behaupteten damit eine Reichweite, die sie
   * nicht haben.
   */
  const nrw = path.join(DIRS.examLists, 'gartenbau/garten-und-landschaftsbau/north-rhine-westphalia');
  fs.mkdirSync(nrw, { recursive: true });
  for (const kurs of ['01', '07', '12']) {
    // Die Kurslisten sind ABLEITUNGEN der Gesamtliste, keine eigenen Quellen mehr — mit derselben
    // Reihenfolge und denselben Schlüsseln. Bis die PDFs neu gezogen sind (Stufe A2), sind sie
    // unvollständig; sie stehen deshalb nicht in `catalog.json` als auswählbare Listen.
    const datei = path.join(nrw, `course-${kurs}.ndjson`);
    const rows = zeilen.filter((z) => z.courses.includes(kurs));
    fs.writeFileSync(datei, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
    log(`  ${rel(datei)}: ${fmt(rows.length)}`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('\n❌ Fehler:', err.message);
    console.error(err.stack);
    process.exit(1);
  });
}

module.exports = { main, leseCsv };
