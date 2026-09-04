#!/usr/bin/env node
'use strict';
/**
 * Baut die drei Listen, die an einen Datenpartner gehen.
 *
 *     node pipeline/werkzeuge/partnerlisten-bauen.js            # Bericht, schreibt nichts
 *     node pipeline/werkzeuge/partnerlisten-bauen.js --write    # Dateien schreiben
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * WOZU
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Ein Partner, der uns Pflanzendaten liefern soll, braucht drei Antworten:
 *
 *   1. our-catalogue.json        Was führen wir schon?
 *   2. exam-plants.json          Was verlangen die Prüfungen?
 *   3. exam-plants-missing.json  Was davon fehlt uns? ← der eigentliche Arbeitsvorrat
 *
 * Die dritte Datei ist eine Teilmenge der zweiten. Sie liegt trotzdem eigenständig bei, damit
 * der Partner nicht erst filtern muss, um zu sehen, worum es geht.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * DIE ENTSCHEIDUNGEN, DIE HIER DRIN STECKEN
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * **Der Name aus UNSERER Datenbank führt**, der aus der Prüfungsliste steht daneben. Wo wir die
 * Pflanze nicht haben, führt zwangsläufig der Listenname — und genau daran erkennt der Partner
 * seinen Auftrag. Beide Schreibweisen mitzuliefern ist kein Luxus: die Prüfungslisten schreiben
 * `Physalis alkekengi`, unser Katalog führt die Art nach heutiger Taxonomie als
 * `Alkekengi officinarum`. Wer nur eine Seite schickt, bekommt falsche Fehlmeldungen zurück.
 *
 * **Zusammengefasst wird über den Katalogschlüssel**, nicht über den Namen. Eine Pflanze steht in
 * bis zu acht der zehn Listen; ohne Zusammenfassung wären es 2.522 Zeilen statt 1.422 Pflanzen,
 * und jede Prozentzahl daraus wäre falsch.
 *
 * **Der Rang kommt bei Treffern aus dem Katalog, sonst aus dem NAMEN.** Die Prüfungslisten kennen
 * nur `art`/`sorte`/`gattung`, und `sorte` steht dort auch über Varietäten und Unterarten. Für
 * eine Pflanzendatenbank ist das zu grob — der Partner muss wissen, WAS er anzulegen hat.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ZWEI REPARATUREN, DIE NUR IN DER AUSGABE PASSIEREN
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Beide beheben Fehler im Katalog, ohne ihn anzufassen. Wer sie hier entfernt, muss sie vorher
 * in der Pipeline beheben — sonst bekommt der Partner Namen, gegen die er nicht abgleichen kann.
 *
 *   1. **Abgebrochene Sortennamen, botanisch (72).** Der `canonicalName` kappt mitten im
 *      Sortenteil: `Hydrangea macrophylla ʽAll` statt `ʽAll Summer Beauty’`. `scientificName`
 *      trägt ihn vollständig.
 *
 *   1b. **Abgebrochene Sortennamen, deutsch (38).** Derselbe Fehler eine Spalte weiter, nur an
 *      anderer Stelle gekappt — am Genitiv-Apostroph: `Felsen Storchschnabel ʽIngwersen’` statt
 *      `ʽIngwersen's Variety’`. Vorlage ist der botanische Sortenname.
 *
 *      Ersetzt wird in beiden Fällen NUR, wenn der gekappte Name wirklich der Anfang des vollen
 *      ist — alles andere wäre Raterei.
 *
 *   2. **Zwei Schreibweisen für Sortennamen.** 1.305 Einträge mit typografischen Zeichen (ʽ…’),
 *      117 mit geraden ('…'). Nach außen geht die gerade Form, wie ICNCP sie vorsieht. Sonst
 *      verliert der maschinelle Abgleich beim Partner Treffer, die es eigentlich gibt.
 *
 * ⚠️ `data/build/plants.ndjson` liegt NICHT im Git (zu groß). Ohne einen gelaufenen Katalogbau
 *    findet dieses Werkzeug nichts.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const WURZEL   = path.resolve(__dirname, '..', '..');
const KATALOG  = path.join(WURZEL, 'data', 'build', 'plants.ndjson');
const LISTEN   = path.join(WURZEL, 'data', 'exam-lists', 'gartenbau');
const ZIEL     = path.join(WURZEL, 'data', 'exports', 'openPlantData');
const SCHREIBEN = process.argv.includes('--write');

const OEFFNEND = /[ʽ‘'´`]/;

const geradeApostrophe = (n) => n.replace(/[ʽ‘’´`]/g, "'");

/**
 * Der Sortenteil eines Namens, oder `null`, wenn der Name mittendrin endet.
 *
 * ⚠️ NICHT über die Anzahl der Anführungszeichen prüfen. Ein Genitiv im Sortennamen
 * ('Cox's Orange Pippin', 'Anny's Magic Gold') bringt jede Paritätszählung durcheinander:
 * sie hält den vollständigen Namen für abgebrochen und den abgebrochenen für vollständig.
 * Sechs Sorten sind so schon einmal unrepariert durchgerutscht. Es zählt allein, ob der
 * Name mit einem schließenden Zeichen ENDET.
 */
function sortenteil(n) {
  if (!n) return null;
  const m = n.match(/[ʽ‘'´`](.+)[’'´`]\s*$/);
  return m ? m[1] : null;
}

/** Macht auf, macht nie zu — also mittendrin abgebrochen. */
const bricht_ab = (n) => Boolean(n) && OEFFNEND.test(n) && sortenteil(n) === null;

function vollerName(p) {
  const c = p.canonicalName;
  const s = p.scientificName || '';
  if (bricht_ab(c) && s.startsWith(c) && sortenteil(s)) return s;
  return c;
}

/**
 * Repariert den deutschen Namen, dessen Sortenteil am Genitiv-Apostroph gekappt wurde.
 *
 * 'Felsen Storchschnabel ʽIngwersen’' soll 'Felsen Storchschnabel ʽIngwersen's Variety’'
 * heißen. Der volle Sortenname steht botanisch daneben; ersetzt wird nur, wenn der deutsche
 * Teil wirklich sein ANFANG ist — sonst wäre es geraten.
 */
function vollerDeutscherName(p) {
  const de = p.germanName;
  if (!de) return de;
  const bot = sortenteil(p.scientificName || '') || sortenteil(p.canonicalName);
  const kurz = sortenteil(de);
  if (!bot || !kurz || kurz === bot || !bot.startsWith(kurz)) return de;
  return de.replace(new RegExp(`([ʽ‘'´\`])${kurz.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([’'´\`])\\s*$`), `$1${bot}$2`);
}

/** Der Katalog lässt `rang` bei Arten leer — das ist die Vorgabe, keine Lücke. */
const katalogRang = (p) => p.rang || 'species';

function listenRang(r) {
  const n = r.botanicalName;
  if (r.rang === 'gattung') return 'genus';
  if (OEFFNEND.test(n)) return 'cultivar';
  if (n.includes(' var. ')) return 'variety';
  if (n.includes(' subsp. ') || n.includes(' ssp. ')) return 'subspecies';
  if (n.includes(' f. ')) return 'form';
  if (r.rang === 'sorte') return 'cultivar';
  return 'species';
}

async function zeilen(datei) {
  const raus = [];
  const rl = readline.createInterface({ input: fs.createReadStream(datei), crlfDelay: Infinity });
  for await (const l of rl) if (l.trim()) raus.push(JSON.parse(l));
  return raus;
}

function ndjsonDateien(verzeichnis) {
  const raus = [];
  for (const e of fs.readdirSync(verzeichnis, { withFileTypes: true })) {
    const p = path.join(verzeichnis, e.name);
    if (e.isDirectory()) raus.push(...ndjsonDateien(p));
    else if (e.name.endsWith('.ndjson')) raus.push(p);
  }
  return raus.sort();
}

const zaehle = (werte) => werte.reduce((a, w) => ((a[w] = (a[w] || 0) + 1), a), {});

async function main() {
  if (!fs.existsSync(KATALOG)) {
    console.error(`Katalog fehlt: ${KATALOG}\nErst den Katalogbau laufen lassen.`);
    process.exit(1);
  }

  const katalog = new Map();
  for (const p of await zeilen(KATALOG)) katalog.set(p.plantKey, p);

  const dateien = ndjsonDateien(LISTEN);
  const rows = [];
  for (const f of dateien) rows.push(...(await zeilen(f)));

  // Ein plantKey, der ins Leere zeigt, heißt: die Listen wurden gegen einen ANDEREN Katalog
  // gebaut als den, der hier liegt. Dann stimmt jede Abdeckungszahl darunter nicht mehr.
  const verwaist = rows.filter((r) => r.plantKey && !katalog.has(r.plantKey));
  if (verwaist.length) {
    console.error(`🔴 ${verwaist.length} Listeneinträge zeigen auf Pflanzen, die es im Katalog `
      + `nicht gibt. Prüfungslisten neu bauen (pipeline/08_build_exam_lists.js), sonst sind die `
      + `Zahlen falsch.`);
    process.exit(1);
  }

  const gruppen = new Map();
  for (const r of rows) {
    const k = r.plantKey ? `k:${r.plantKey}` : `n:${r.botanicalName.trim().toLowerCase()}`;
    if (!gruppen.has(k)) gruppen.set(k, []);
    gruppen.get(k).push(r);
  }

  const pruefung = [];
  for (const [k, g] of gruppen) {
    const erste = g[0];
    const treffer = k.startsWith('k:') ? katalog.get(Number(k.slice(2))) : null;

    const syn = [];
    for (const r of g) for (const s of r.alsoKnownAs || []) {
      const v = geradeApostrophe(s);
      if (!syn.includes(v)) syn.push(v);
    }
    if (treffer) for (const s of treffer.synonyms || []) if (!syn.includes(s)) syn.push(s);

    const e = treffer
      ? { botanicalName: geradeApostrophe(vollerName(treffer)),
          germanName: geradeApostrophe(vollerDeutscherName(treffer) || ''),
          rank: katalogRang(treffer), inDatabase: true }
      : { botanicalName: geradeApostrophe(erste.botanicalName),
          germanName: erste.germanName, rank: listenRang(erste), inDatabase: false };
    if (!e.germanName) delete e.germanName;

    const namen = [];
    for (const r of g) {
      const paar = [geradeApostrophe(r.botanicalName), r.germanName || null];
      if (!namen.some(([b, d]) => b === paar[0] && d === paar[1])) namen.push(paar);
    }
    e.examListName = namen[0][0];
    if (namen[0][1]) e.examListGermanName = namen[0][1];
    if (namen.length > 1) {
      e.examListNameVariants = namen.slice(1).map(([b, d]) =>
        d ? { botanicalName: b, germanName: d } : { botanicalName: b });
    }
    if (syn.length) e.synonyms = syn;
    pruefung.push(e);
  }

  const nachName = (a, b) => a.botanicalName.localeCompare(b.botanicalName, 'de');
  pruefung.sort(nachName);
  const luecke = pruefung.filter((e) => !e.inDatabase);

  const unsere = [...katalog.values()].map((p) => {
    const e = { botanicalName: geradeApostrophe(vollerName(p)), rank: katalogRang(p) };
    const de = vollerDeutscherName(p);
    if (de) e.germanName = geradeApostrophe(de);
    return e;
  }).sort(nachName);

  const stand = new Date().toISOString().slice(0, 10);
  const anteil = Math.round((1000 * luecke.length) / pruefung.length) / 10;
  const GELTUNG = 'German vocational horticulture exams (Gartenbau), all seven specialisations. '
    + 'State of North Rhine-Westphalia, plus the nationwide landscape gardening list.';

  const ausgaben = [
    ['exam-plants.json', {
      description: 'Every plant required by the German horticulture exam lists we currently cover.',
      scope: GELTUNG, generatedAt: stand,
      totalPlants: pruefung.length,
      inOurDatabase: pruefung.length - luecke.length,
      missing: luecke.length,
      fieldNotes: {
        'botanicalName / germanName': 'from our database where inDatabase is true, otherwise from the exam list',
        rank: 'species | subspecies | variety | cultivar | form | genus',
        'examListName / examListGermanName': 'the wording used in the official exam list',
        examListNameVariants: 'further wordings, where lists name the same plant differently',
        synonyms: 'from the exam lists and from our database',
      },
    }, pruefung],
    ['exam-plants-missing.json', {
      description: 'The exam plants our database does NOT cover yet.',
      scope: GELTUNG, generatedAt: stand,
      missing: luecke.length, ofTotalExamPlants: pruefung.length, shareMissingPercent: anteil,
      byRank: zaehle(luecke.map((e) => e.rank)),
      note: 'Entries with rank "genus" are collective entries in the exam list '
          + '(e.g. "Rosa (Beetrosen)"); they ask for any cultivar of that group, not for a single taxon.',
    }, luecke],
    ['our-catalogue.json', {
      description: 'Every plant our database currently holds.',
      generatedAt: stand, totalPlants: unsere.length,
      byRank: zaehle(unsere.map((e) => e.rank)),
    }, unsere],
  ];

  console.log(`Listen        : ${dateien.length} Dateien, ${rows.length} Zeilen`);
  console.log(`Prüfungspflanzen: ${pruefung.length} (zusammengefasst)`);
  console.log(`  abgedeckt     : ${pruefung.length - luecke.length} (${(100 - anteil).toFixed(1)} %)`);
  console.log(`  offen         : ${luecke.length} (${anteil.toFixed(1)} %)`);
  console.log(`  offen n. Rang : ${JSON.stringify(zaehle(luecke.map((e) => e.rank)))}`);
  console.log(`Katalog       : ${unsere.length}`);
  console.log();

  if (!SCHREIBEN) {
    console.log('Trockenlauf — nichts geschrieben. Mit --write erneut aufrufen.');
    return;
  }
  fs.mkdirSync(ZIEL, { recursive: true });
  for (const [name, meta, daten] of ausgaben) {
    const p = path.join(ZIEL, name);
    fs.writeFileSync(p, JSON.stringify({ meta, plants: daten }, null, 2), 'utf8');
    console.log(`${name.padEnd(28)} ${String(daten.length).padStart(6)} Einträge `
      + `${(fs.statSync(p).size / 1024).toFixed(0).padStart(6)} KB`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
