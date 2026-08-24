#!/usr/bin/env node
'use strict';

/**
 * Schritt 10 — Sorten, Formen, Varietäten und Unterarten aus Wikidata ernten.
 *
 *   node pipeline/10_fetch_wikidata_cultivars.js            # alle Arten des Katalogs
 *   node pipeline/10_fetch_wikidata_cultivars.js --limit=50 # Probelauf
 *
 * Eingabe:  data/build/plants.ndjson  (die Arten, die wir führen — mit ihrem taxonKey)
 * Ausgabe:  data/raw/wikidata/wikidata_cultivars.ndjson  (+ .done, + .meta.json)
 *
 * ## Warum Wikidata und nicht GBIF
 *
 * 🔴 GBIFs Backbone führt **null** Sorten. Gemessen am 24.08.2026:
 *
 *     VARIETY     421.934
 *     SUBSPECIES  380.481
 *     FORM         87.936
 *     CULTIVAR          0
 *
 * Das ist Bauart, kein Datenloch: GBIF bildet die botanische Nomenklatur (ICN) ab, Sortennamen
 * gehören in den Gartenbau-Code (ICNCP). Eine Sorte bekommt dort nie einen Schlüssel.
 *
 * ## Und warum auch die Formen hier laufen
 *
 * ⚠️ *Fagus sylvatica* f. *pendula* — die Hänge-Buche — HAT einen GBIF-Schlüssel (6289713), aber
 * mit Status **SYNONYM** auf die Art. Schritt 01 erntet `ACCEPTED`; sie käme also auch dann nicht
 * mit, wenn wir dort die Ränge erweitern. Die alten gärtnerischen Formen sind bei GBIF fast
 * durchweg Synonyme — botanisch richtig, für den Gartenbau die falsche Antwort.
 *
 * ## Die Brücke zurück in den Katalog
 *
 *     Sorte (Q-ID) ──P171 Elterntaxon──▶ Art (Q-ID) ──P846 GBIF-ID──▶ unser taxonKey
 *
 * An fünf Sorten geprüft, fünf Treffer. `P373` liefert den Commons-Kategorienamen gleich mit — er
 * muss nicht geraten werden.
 *
 * ## 🔴 Was hier NICHT passiert: raten
 *
 * Wikidata ist uneinheitlich. *Betula pendula* 'Youngii' trägt `P31 = Q16521` (Taxon), nicht
 * `Q4886` (Sorte); *Prunus* 'Kanzan' hat ZWEI Elterntaxa und ein zweites Wikidata-Objekt für
 * dieselbe Sorte. Deshalb:
 *
 *   - Der Rang wird aus `P225` abgeleitet, nicht aus `P31`.
 *   - Mehrere Elterntaxa mit GBIF-ID → **verworfen** und protokolliert.
 *   - Ein deutsches Label gilt nur als Name, wenn es sich von `P225` unterscheidet — Bots haben
 *     den botanischen Namen in jede Sprache kopiert (25 von 25 der Stichprobe).
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { DIRS, FILES } = require('./lib/paths');

const CONFIG = {
  ENDPOINT: 'https://query.wikidata.org/sparql',
  USER_AGENT: 'MyPlants-Database/2.0 (Pflanzenlern-App; +https://my-plants.app)',
  /** Mehr Arten je Abfrage als in Schritt 09: Hier ist die Antwortmenge klein. */
  BATCH: 60,
  PAUSE_MS: 1500,
  MAX_RETRIES: 4,
  TIMEOUT_MS: 90000,
};

const OUT_DIR = path.join(DIRS.raw, 'wikidata');
const OUT_FILE = path.join(OUT_DIR, 'wikidata_cultivars.ndjson');
const DONE_FILE = path.join(OUT_DIR, 'wikidata_cultivars.done');
const META_FILE = path.join(OUT_DIR, 'wikidata_cultivars.meta.json');
const VERWORFEN_FILE = path.join(OUT_DIR, 'wikidata_cultivars_verworfen.ndjson');

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const fmt = (n) => Number(n).toLocaleString('de-DE');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const parseArgs = () => {
  const out = {};
  for (const a of process.argv.slice(2)) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (m) out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
};

const sparql = async (query, versuch = 1) => {
  try {
    const res = await fetch(CONFIG.ENDPOINT, {
      method: 'POST',
      headers: {
        'User-Agent': CONFIG.USER_AGENT,
        Accept: 'application/sparql-results+json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ query }).toString(),
      signal: AbortSignal.timeout(CONFIG.TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()).results.bindings;
  } catch (err) {
    if (versuch >= CONFIG.MAX_RETRIES) throw err;
    await sleep(3000 * 2 ** (versuch - 1));
    return sparql(query, versuch + 1);
  }
};

/**
 * Der Rang — aus dem NAMEN, nicht aus `P31`.
 *
 * ⚠️ Die Reihenfolge ist tragend. `Forsythia ×intermedia 'Lynwood'` ist beides, Hybride UND Sorte.
 * Für den Lernenden ist die Sorte die speziellere Auskunft, also gewinnt sie. Dieselbe Regel wie
 * `taxonRang` in der App und `taxonRank` im Backend — drei Orte, eine Regel.
 */
const rangAusNamen = (name) => {
  const n = String(name || '');
  if (/['‘’ʽ][^'‘’ʽ]+['‘’ʽ]/.test(n)) return 'cultivar';
  if (/\bsubsp\.|\bssp\./.test(n)) return 'subspecies';
  if (/\bvar\./.test(n)) return 'variety';
  if (/\bf\.\s+[a-z]/.test(n)) return 'form';
  if (/\bsect\.|\bagg\./.test(n)) return 'aggregate';
  if (n.includes('×')) return 'hybrid';
  return null;
};

/** Apostrophvarianten vereinheitlichen — Wikidata benutzt mindestens vier. */
const gleichApostroph = (s) => String(s || '').replace(/[‘’ʽʼ`´]/g, "'").trim();

/**
 * Ist das deutsche Label ein echter Trivialname — oder der botanische Name in Tarnung?
 *
 * 🔴 8.881 von 9.879 Sorten haben ein deutsches Label, und 25 von 25 der Stichprobe sind WÖRTLICH
 * der botanische Name. Ein Bot hat ihn in jede Sprache kopiert. Wer das nicht prüft, importiert
 * 8.787 botanische Namen als deutsche.
 */
const istEchterName = (label, botanisch, labelEn) => {
  if (!label) return false;
  const l = gleichApostroph(label);
  if (l === gleichApostroph(botanisch)) return false;
  if (labelEn && l === gleichApostroph(labelEn)) return false;
  // Ein Name, der mit der Gattung beginnt und ein Anführungszeichen trägt, ist der botanische.
  if (/^[A-Z][a-z]+ .*'/.test(l) && l.split(' ')[0] === String(botanisch).split(' ')[0]) return false;
  return true;
};

const frageBuendel = async (gbifIds) => {
  const werte = gbifIds.map((k) => `"${k}"`).join(' ');
  const query = `
SELECT ?kind ?p225 ?commons ?labelDe ?labelEn ?wpTitel ?gbif WHERE {
  VALUES ?gbif { ${werte} }
  ?art wdt:P846 ?gbif .
  ?kind wdt:P171 ?art ; wdt:P225 ?p225 .
  OPTIONAL { ?kind wdt:P373 ?commons }
  OPTIONAL { ?kind rdfs:label ?labelDe . FILTER(LANG(?labelDe) = "de") }
  OPTIONAL { ?kind rdfs:label ?labelEn . FILTER(LANG(?labelEn) = "en") }
  OPTIONAL {
    ?art2 schema:about ?kind ; schema:isPartOf <https://de.wikipedia.org/> ; schema:name ?wpTitel .
  }
}`;
  return sparql(query);
};

(async () => {
  const args = parseArgs();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  if (!fs.existsSync(FILES.buildPlants)) {
    console.error(`\n🔴 ABBRUCH: ${FILES.buildPlants} fehlt. Erst \`npm run pipeline:build\`.\n`);
    process.exit(1);
  }

  // Die Arten, die wir führen — nur sie können Eltern sein.
  const arten = new Map(); // gbifId (String) → { taxonKey, germanName, searchTerms }
  const rl = readline.createInterface({
    input: fs.createReadStream(FILES.buildPlants, 'utf8'),
    crlfDelay: Infinity,
  });
  for await (const zeile of rl) {
    if (!zeile.trim()) continue;
    const p = JSON.parse(zeile);
    if (p.taxonKey) {
      arten.set(String(p.taxonKey), {
        taxonKey: p.taxonKey,
        germanName: p.germanName || null,
        germanNames: p.germanNames || [],
        searchTerms: p.searchTerms || [],
        germanFamily: p.germanFamily || null,
        botanicalFamily: p.botanicalFamily || null,
      });
    }
  }
  log(`${fmt(arten.size)} Arten im Katalog`);

  const done = fs.existsSync(DONE_FILE)
    ? new Set(fs.readFileSync(DONE_FILE, 'utf8').split('\n').filter(Boolean))
    : new Set();
  let offen = [...arten.keys()].filter((k) => !done.has(k));
  if (args.limit) offen = offen.slice(0, Number(args.limit));
  log(`${fmt(offen.length)} offen (${fmt(done.size)} bereits erledigt)`);
  if (offen.length === 0) { log('Nichts zu tun.'); return; }

  const out = fs.createWriteStream(OUT_FILE, { flags: 'a' });
  const verworfenOut = fs.createWriteStream(VERWORFEN_FILE, { flags: 'a' });
  const doneOut = fs.createWriteStream(DONE_FILE, { flags: 'a' });

  const stat = { abgefragt: 0, kinder: 0, geschrieben: 0, verworfen: 0, mitCommons: 0,
                 mitDeutschemNamen: 0, jeRang: {} };
  const begonnen = Date.now();

  for (let i = 0; i < offen.length; i += CONFIG.BATCH) {
    const buendel = offen.slice(i, i + CONFIG.BATCH);
    let zeilen;
    try {
      zeilen = await frageBuendel(buendel);
    } catch (err) {
      log(`  ⚠ Bündel ${i}–${i + buendel.length} fehlgeschlagen (${err.message}) — wird beim nächsten Lauf erneut versucht`);
      await sleep(CONFIG.PAUSE_MS);
      continue;
    }
    stat.abgefragt += buendel.length;

    // Je Kind-Objekt sammeln — SPARQL liefert eine Zeile je Wertkombination.
    const kinder = new Map();
    for (const z of zeilen) {
      const q = z.kind.value.split('/').pop();
      const rec = kinder.get(q) || {
        wikidataId: q, p225: z.p225.value, eltern: new Set(),
        commons: null, labelDe: null, labelEn: null, wpTitel: null,
      };
      rec.eltern.add(z.gbif.value);
      if (z.commons) rec.commons = z.commons.value;
      if (z.labelDe) rec.labelDe = z.labelDe.value;
      if (z.labelEn) rec.labelEn = z.labelEn.value;
      if (z.wpTitel) rec.wpTitel = z.wpTitel.value;
      kinder.set(q, rec);
    }
    stat.kinder += kinder.size;

    for (const rec of kinder.values()) {
      const rang = rangAusNamen(rec.p225);
      // 🔴 Ohne erkennbaren Rang ist es kein Taxon unterhalb der Art, sondern etwas anderes,
      // das jemand als Kind eingetragen hat. Nicht raten.
      if (!rang) {
        stat.verworfen++;
        verworfenOut.write(JSON.stringify({ ...rec, eltern: [...rec.eltern], grund: 'kein Rang im Namen' }) + '\n');
        continue;
      }
      if (rec.eltern.size !== 1) {
        stat.verworfen++;
        verworfenOut.write(JSON.stringify({ ...rec, eltern: [...rec.eltern], grund: 'mehrere Elterntaxa' }) + '\n');
        continue;
      }
      const elternKey = [...rec.eltern][0];
      const art = arten.get(elternKey);
      if (!art) { stat.verworfen++; continue; }

      // Der deutsche Name: Wikipedia-Titel zuerst (er ist ein echter Name), dann das Label —
      // aber nur, wenn es nicht der botanische Name in Tarnung ist.
      let germanName = null;
      let quelle = null;
      if (rec.wpTitel && istEchterName(rec.wpTitel, rec.p225, rec.labelEn)) {
        germanName = rec.wpTitel.replace(/\s*\([^)]*\)\s*$/, '').trim();
        quelle = 'dewiki';
      } else if (istEchterName(rec.labelDe, rec.p225, rec.labelEn)) {
        germanName = rec.labelDe;
        quelle = 'label';
      }
      if (germanName) stat.mitDeutschemNamen++;
      if (rec.commons) stat.mitCommons++;
      stat.jeRang[rang] = (stat.jeRang[rang] || 0) + 1;

      out.write(JSON.stringify({
        wikidataId: rec.wikidataId,
        plantKey: 1_000_000_000 + Number(rec.wikidataId.slice(1)),
        parentPlantKey: art.taxonKey,
        rang,
        scientificName: rec.p225,
        commonsCategory: rec.commons,
        germanName,
        germanNameQuelle: quelle,
        elternGermanName: art.germanName,
        elternSearchTerms: art.searchTerms,
        germanFamily: art.germanFamily,
        botanicalFamily: art.botanicalFamily,
      }) + '\n');
      stat.geschrieben++;
    }

    for (const k of buendel) doneOut.write(k + '\n');
    if ((i / CONFIG.BATCH) % 10 === 0) {
      const anteil = (i + buendel.length) / offen.length;
      const rest = anteil > 0 ? ((Date.now() - begonnen) / anteil) * (1 - anteil) : 0;
      log(`  ${fmt(i + buendel.length)}/${fmt(offen.length)} Arten · ${fmt(stat.geschrieben)} Taxa · noch ~${(rest / 3600000).toFixed(1)} h`);
    }
    await sleep(CONFIG.PAUSE_MS);
  }

  out.end(); verworfenOut.end(); doneOut.end();

  const meta = {
    step: '10_fetch_wikidata_cultivars',
    finishedAt: new Date().toISOString(),
    regel: 'P171-Kinder unserer Arten, Rang AUS DEM NAMEN, ein Elterntaxon, Name nur wenn != P225',
    result: { ...stat },
  };
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2));

  console.log();
  console.log('='.repeat(64));
  log(`Arten abgefragt:      ${fmt(stat.abgefragt)}`);
  log(`Kind-Taxa gefunden:   ${fmt(stat.kinder)}`);
  log(`➜ GESCHRIEBEN:        ${fmt(stat.geschrieben)}`);
  log(`   je Rang:           ${Object.entries(stat.jeRang).map(([k, v]) => `${k} ${fmt(v)}`).join(' · ')}`);
  log(`   mit Commons-Kat.:  ${fmt(stat.mitCommons)}`);
  log(`   mit dt. Namen:     ${fmt(stat.mitDeutschemNamen)}`);
  log(`   verworfen:         ${fmt(stat.verworfen)}  → ${VERWORFEN_FILE}`);
  console.log();
})().catch((e) => { console.error(e); process.exit(1); });
