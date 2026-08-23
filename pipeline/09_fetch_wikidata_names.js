#!/usr/bin/env node
'use strict';
/**
 * Schritt 9: Deutsche Trivialnamen aus Wikidata — für die Arten, die keinen haben.
 *
 *     node pipeline/09_fetch_wikidata_names.js            # alle offenen Arten
 *     node pipeline/09_fetch_wikidata_names.js --limit=200  # Probelauf
 *
 * Input:  data/raw/plantnet/plantnet_names.ndjson · data/work/gbif_key_map.ndjson
 * Output: data/raw/wikidata/wikidata_names.ndjson (+ .done, + .meta.json)
 *
 * ## Warum es diesen Schritt gibt — und was er realistisch bringt
 *
 * 71.776 Pl@ntNet-Arten haben Bilder, aber keinen deutschen Namen. Am 23.08.2026 an **drei**
 * verschiedenen Stichproben à 80 gemessen (bildreichste · zufällig · aus Gattungen, die der
 * Katalog kennt): **je genau ein Treffer, also rund 1 %.** Hochgerechnet 200 bis 2.600 Arten,
 * wahrscheinlich um 700.
 *
 * Der Grund für die niedrige Quote ist keine Quellenlücke, sondern eine Wirklichkeitslücke: Wo
 * Pl@ntNet und GBIF keinen deutschen Namen führen, gibt es meistens keinen. *Scilla verna* — eine
 * europäische Art mit 1.900 Bildern — hat bei Wikidata weder deutsches Label noch deutschen
 * Wikipedia-Artikel.
 *
 * Was hier gewonnen wird, sind überwiegend Randtaxa: Bastarde, Kleinarten, Sippen. Der einzige
 * echte Treffer der dritten Stichprobe war *Betula × caerulea* → „Blau-Birke".
 *
 * ## 🔴 Die Falle, an der ein naiver Lauf scheitert
 *
 * Bei **56 von 57** gefundenen Arten ist das deutsche Wikidata-Label schlicht der wissenschaftliche
 * Name. Wer `rdfs:label@de` ungefiltert übernimmt, füllt den Katalog mit Scheinnamen — und entwertet
 * damit die Aufnahmeregel „hat einen deutschen Namen".
 *
 * Deshalb drei Verschärfungen gegenüber der alten Pipeline (`legacy/03_enrich_wikidata.js`):
 *
 *   1. **Zuordnung über die GBIF-ID (P846)**, nicht nur über den Namensstring. Ein Bezeichner kann
 *      nicht auf ein gleichlautendes Taxon eines anderen Reichs zeigen. P225 bleibt als Rückfall.
 *   2. **Herkunft je Name** wird mitgeschrieben (`p1843` · `wikipedia` · `label`). Der Bau kann
 *      damit streng sein, ohne dass hier etwas weggeworfen wird, das später nützlich wäre.
 *   3. **Ein Filter, der alles verwirft, was wie ein wissenschaftlicher Name aussieht** — siehe
 *      `istEchterTrivialname`. Er ist bewusst streng: Ein fehlender Name kostet eine Pflanze, ein
 *      falscher kostet Vertrauen in alle anderen.
 *
 * ## Vertrauensstufen
 *
 *     p1843      Wikidatas Eigenschaft „Trivialname" — die verlässlichste Quelle
 *     wikipedia  Titel des deutschen Wikipedia-Artikels — bei Pflanzen fast immer der Trivialname
 *     label      deutsches Wikidata-Label — nur, wenn es den Filter übersteht
 *
 * ## Wiederaufnahme
 *
 * Der Lauf dauert Stunden. Jede erledigte Art wird in `.done` vermerkt; ein Neustart überspringt
 * sie. Ein Abbruch kostet also nichts ausser der Zeit bis dahin.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { DIRS, FILES } = require('./lib/paths');

const CONFIG = {
  ENDPOINT: 'https://query.wikidata.org/sparql',
  USER_AGENT: 'MyPlants-Database/2.0 (Pflanzenlern-App; +https://my-plants.app)',
  /** 12 hat sich als stabil erwiesen; bei 40 antwortet der Endpunkt mit 502. */
  BATCH: 12,
  /** Wikidata bittet ausdrücklich um Zurückhaltung. Zwei Sekunden zwischen Bündeln. */
  PAUSE_MS: 2000,
  MAX_RETRIES: 4,
  TIMEOUT_MS: 90000,
};

const OUT_DIR = path.join(DIRS.raw, 'wikidata');
const OUT_FILE = path.join(OUT_DIR, 'wikidata_names.ndjson');
const DONE_FILE = path.join(OUT_DIR, 'wikidata_names.done');
const META_FILE = path.join(OUT_DIR, 'wikidata_names.meta.json');

const fmt = (n) => Number(n).toLocaleString('de-DE');
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Ist das ein echter deutscher Trivialname — oder nur der wissenschaftliche Name in Verkleidung?
 *
 * Bewusst streng. Jede Regel steht für einen Fall, der in der Stichprobe wirklich vorkam:
 *
 *   „Aerides houlettiana"  Schreibvariante des wiss. Namens                → Binom-Regel
 *   „Mammillaria vetula"   Label = wiss. Name                             → Gleichheitsregel
 *   „Betula"               nur die Gattung                                → Gattungsregel
 *   „Sedum (Gattung)"      Wikipedia-Klammerzusatz                        → wird abgeschnitten
 *
 * Ein fehlender Name kostet eine Pflanze. Ein falscher kostet das Vertrauen in alle anderen.
 */
const istEchterTrivialname = (kandidat, wissenschaftlich) => {
  const name = String(kandidat || '').trim();
  if (!name || name.length < 3 || name.length > 60) return false;

  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-zäöüß]/g, '');
  const sci = String(wissenschaftlich || '');
  if (norm(name) === norm(sci)) return false;

  // Nur die Gattung ist kein Artname.
  const gattung = sci.split(/\s+/)[0] || '';
  if (gattung && norm(name) === norm(gattung)) return false;

  /**
   * Beginnt es wie ein Binom — „Xxxxx yyyyy" mit kleingeschriebenem zweitem Wort?
   *
   * Am ANFANG geprueft, nicht am ganzen String: Sonst rutscht `Rosa canina L.` durch, weil die
   * Autorenangabe ein drittes Wort ist. Genau dieser Fall ist im Test aufgefallen.
   *
   * Fuer deutsche Namen ist die Regel ungefaehrlich: Im Deutschen wird das Substantiv gross
   * geschrieben, „Gewoehnlicher Loewenzahn" und „Echter Kuemmel" haben also ein grosses zweites
   * Wort und ueberstehen sie.
   */
  const woerter = name.split(/\s+/);
  if (woerter.length >= 2 && /^[A-Z][a-zë-]+$/.test(woerter[0]) && /^[a-zë-]+$/.test(woerter[1])) {
    return false;
  }
  // Eine angehaengte Autorenabkuerzung („… L.", „… Mill.") gibt es in Trivialnamen nicht.
  if (/\s[A-Z][a-z]{0,6}\.$/.test(name)) return false;
  // Rangkürzel gibt es in deutschen Trivialnamen nicht.
  if (/\b(subsp|var|f|cv|sect|ser|nothosubsp)\.\s/.test(name)) return false;
  // Autorenangaben und Jahreszahlen.
  if (/\(\s*[A-Z][a-z]*\.?\s*\)|\b\d{4}\b/.test(name)) return false;
  // Ein deutscher Trivialname hat mindestens einen Vokal und keine reinen Kürzel.
  if (!/[aeiouäöü]/i.test(name)) return false;

  return true;
};

/** Wikipedia-Titel tragen oft einen Klammerzusatz zur Unterscheidung: „Mahonie (Pflanze)". */
const ohneKlammerzusatz = (titel) => String(titel || '').replace(/\s*\([^)]*\)\s*$/, '').trim();

const sparql = async (query, versuch = 1) => {
  const body = new URLSearchParams({ query }).toString();
  try {
    const res = await fetch(CONFIG.ENDPOINT, {
      method: 'POST',
      headers: {
        'User-Agent': CONFIG.USER_AGENT,
        Accept: 'application/sparql-results+json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(CONFIG.TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json.results.bindings;
  } catch (err) {
    if (versuch >= CONFIG.MAX_RETRIES) throw err;
    // Wikidata drosselt still. Exponentiell zurueckweichen statt haemmern.
    await sleep(3000 * 2 ** (versuch - 1));
    return sparql(query, versuch + 1);
  }
};

/**
 * Ein Bündel Arten abfragen — über die GBIF-ID UND den Namen.
 *
 * `UNION` statt zweier Abfragen: Wikidatas Optimierer kommt damit gut zurecht, und es halbiert die
 * Zahl der Anfragen. `?quelle` sagt hinterher, welcher Weg getroffen hat.
 */
const frageBuendel = async (arten) => {
  const keys = arten.map((a) => `"${a.taxonKey}"`).join(' ');
  const namen = arten.map((a) => `"${a.name.replace(/"/g, '')}"`).join(' ');
  const query = `
SELECT ?sci ?gbif ?p1843 ?label ?wpTitel WHERE {
  {
    VALUES ?gbif { ${keys} }
    ?item wdt:P846 ?gbif .
    OPTIONAL { ?item wdt:P225 ?sci . }
  } UNION {
    VALUES ?sci { ${namen} }
    ?item wdt:P225 ?sci .
    OPTIONAL { ?item wdt:P846 ?gbif . }
  }
  OPTIONAL { ?item wdt:P1843 ?p1843 . FILTER(LANG(?p1843) = "de") }
  OPTIONAL { ?item rdfs:label ?label . FILTER(LANG(?label) = "de") }
  OPTIONAL {
    ?art schema:about ?item ; schema:isPartOf <https://de.wikipedia.org/> ; schema:name ?wpTitel .
  }
}`;
  const rows = await sparql(query);

  // Zeilen je Art einsammeln. Ein Item liefert eine Zeile je Kombination — das ist normal.
  const proArt = new Map();
  const holen = (schluessel) => {
    if (!proArt.has(schluessel)) proArt.set(schluessel, { p1843: new Set(), label: new Set(), wiki: new Set() });
    return proArt.get(schluessel);
  };
  for (const r of rows) {
    const perKey = r.gbif && arten.some((a) => String(a.taxonKey) === r.gbif.value);
    const schluessel = perKey
      ? arten.find((a) => String(a.taxonKey) === r.gbif.value).name
      : r.sci?.value;
    if (!schluessel) continue;
    const e = holen(schluessel);
    e.perKey = e.perKey || !!perKey;
    if (r.p1843) e.p1843.add(r.p1843.value);
    if (r.label) e.label.add(r.label.value);
    if (r.wpTitel) e.wiki.add(ohneKlammerzusatz(r.wpTitel.value));
  }

  return arten.map((a) => {
    const e = proArt.get(a.name);
    if (!e) return { ...a, gefunden: false, namen: [] };
    const namenListe = [];
    const nimm = (werte, quelle) => {
      for (const w of werte) {
        if (!istEchterTrivialname(w, a.name)) continue;
        if (namenListe.some((n) => n.name.toLowerCase() === w.toLowerCase())) continue;
        namenListe.push({ name: w, quelle });
      }
    };
    nimm(e.p1843, 'p1843');
    nimm(e.wiki, 'wikipedia');
    nimm(e.label, 'label');
    return { ...a, gefunden: true, ueberSchluessel: !!e.perKey, namen: namenListe };
  });
};

const main = async () => {
  const args = new Map(process.argv.slice(2).map((a) => {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }));
  const limit = args.has('limit') ? Number(args.get('limit')) : 0;

  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('='.repeat(64));
  console.log('Schritt 9: Deutsche Namen aus Wikidata');
  console.log('='.repeat(64));

  // ── Welche Arten sind offen? ────────────────────────────────────────────────
  const karte = new Map();
  for (const line of fs.readFileSync(FILES.gbifKeyMap, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (r.ziel) karte.set(String(r.quelle), r.ziel);
  }

  const erledigt = new Set(
    fs.existsSync(DONE_FILE) ? fs.readFileSync(DONE_FILE, 'utf8').split('\n').filter(Boolean) : [],
  );

  const offen = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(FILES.plantnetNames, 'utf8'),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const d = JSON.parse(line);
    const de = (d.commonNames || {}).de || [];
    if (de.length || !(d.imagesCount > 0)) continue;
    const ziel = karte.get(String(d.gbifKey));
    if (!ziel) continue;
    if (erledigt.has(d.plantnetName)) continue;
    offen.push({ name: d.plantnetName, taxonKey: ziel, bilder: d.imagesCount });
  }

  const arbeit = limit ? offen.slice(0, limit) : offen;
  log(`offen: ${fmt(offen.length)}${limit ? ` (Probelauf: ${fmt(arbeit.length)})` : ''}`);
  if (erledigt.size) log(`bereits erledigt: ${fmt(erledigt.size)}`);
  const buendel = Math.ceil(arbeit.length / CONFIG.BATCH);
  log(`${fmt(buendel)} Bündel à ${CONFIG.BATCH} · geschätzt ${(buendel * (CONFIG.PAUSE_MS + 1200) / 3600000).toFixed(1)} h`);
  console.log();

  const out = fs.createWriteStream(OUT_FILE, { flags: 'a' });
  const done = fs.createWriteStream(DONE_FILE, { flags: 'a' });
  const stats = { abgefragt: 0, gefunden: 0, mitNamen: 0, namenGesamt: 0, ueberSchluessel: 0, quellen: {} };
  const begonnen = Date.now();

  for (let i = 0; i < arbeit.length; i += CONFIG.BATCH) {
    const buendelArten = arbeit.slice(i, i + CONFIG.BATCH);
    let ergebnisse;
    try {
      ergebnisse = await frageBuendel(buendelArten);
    } catch (err) {
      // Nicht als erledigt markieren — der naechste Lauf versucht es erneut. Ein falsches
      // „nichts gefunden" waere dauerhaft.
      log(`  ⚠ Bündel übersprungen (${String(err.message).slice(0, 40)}) — wird beim nächsten Lauf erneut versucht`);
      await sleep(CONFIG.PAUSE_MS);
      continue;
    }

    for (const e of ergebnisse) {
      stats.abgefragt++;
      if (e.gefunden) stats.gefunden++;
      if (e.ueberSchluessel) stats.ueberSchluessel++;
      if (e.namen.length) {
        stats.mitNamen++;
        stats.namenGesamt += e.namen.length;
        for (const n of e.namen) stats.quellen[n.quelle] = (stats.quellen[n.quelle] || 0) + 1;
        out.write(JSON.stringify({
          plantnetName: e.name,
          taxonKey: e.taxonKey,
          bilder: e.bilder,
          ueberSchluessel: !!e.ueberSchluessel,
          namen: e.namen,
        }) + '\n');
      }
      done.write(e.name + '\n');
    }

    if (stats.abgefragt % 600 === 0 || i + CONFIG.BATCH >= arbeit.length) {
      const proSek = stats.abgefragt / ((Date.now() - begonnen) / 1000);
      const rest = ((arbeit.length - stats.abgefragt) / proSek / 3600).toFixed(1);
      log(`  ${fmt(stats.abgefragt)}/${fmt(arbeit.length)} · ${fmt(stats.mitNamen)} mit Namen `
        + `(${(100 * stats.mitNamen / Math.max(stats.abgefragt, 1)).toFixed(1)} %) · noch ~${rest} h`);
    }
    await sleep(CONFIG.PAUSE_MS);
  }

  await new Promise((r) => out.end(r));
  await new Promise((r) => done.end(r));

  const meta = {
    step: '09_fetch_wikidata_names',
    finishedAt: new Date().toISOString(),
    regel: 'nur Arten OHNE deutschen Namen bei Pl@ntNet/GBIF, mit Bildern und aufloesbarem Schluessel',
    zuordnung: 'P846 (GBIF-ID) bevorzugt, P225 (Taxonname) als Rueckfall',
    filter: 'istEchterTrivialname — verwirft Binome, Rangkuerzel, Autorenangaben, Gattungsnamen',
    result: stats,
  };
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2));

  console.log();
  console.log('='.repeat(64));
  log(`abgefragt:        ${fmt(stats.abgefragt)}`);
  log(`in Wikidata:      ${fmt(stats.gefunden)}  (davon ${fmt(stats.ueberSchluessel)} über die GBIF-ID)`);
  log(`MIT deutschem Namen: ${fmt(stats.mitNamen)}  = ${(100 * stats.mitNamen / Math.max(stats.abgefragt, 1)).toFixed(1)} %`);
  log(`Namen gesamt:     ${fmt(stats.namenGesamt)} · je Quelle ${JSON.stringify(stats.quellen)}`);
  log(`→ ${OUT_FILE}`);
};

main().catch((err) => {
  console.error('\n❌', err);
  process.exit(1);
});
