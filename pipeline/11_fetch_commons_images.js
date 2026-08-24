#!/usr/bin/env node
'use strict';

/**
 * Schritt 11 — Bilder der Sorten und Formen von Wikimedia Commons holen.
 *
 *   node pipeline/11_fetch_commons_images.js              # alles mit Commons-Kategorie
 *   node pipeline/11_fetch_commons_images.js --limit=20   # Probelauf
 *   node pipeline/11_fetch_commons_images.js --auch-titelsuche   # Weg B dazu
 *
 * Eingabe:  data/raw/wikidata/wikidata_cultivars.ndjson   (Schritt 10)
 * Ausgabe:  data/raw/commons/commons_images.ndjson  (+ .done, + .meta.json)
 *           data/raw/commons/sichtungsliste.ndjson  — was NICHT ungeprüft in die App darf
 *
 * ## Zwei Wege, und sie sind nicht gleich viel wert
 *
 * **Weg A — die Kategorie.** `P373` aus Schritt 10 nennt sie; sie muss nicht geraten werden. Die
 * Dateien darin hat ein Mensch dorthin einsortiert.
 *
 * **Weg B — der Dateititel.** Für Sorten ohne Kategorie: Dateien, deren Titel Art UND Sortenname
 * tragen. Gemessen an den 144 GaLaBau-Sorten holt Weg B **27 %** zusätzlich heraus — *Cedrus
 * atlantica* 'Glauca' hat keine Kategorie und 71 solcher Dateien.
 *
 * 🔴 Weg B kommt in die **Sichtungsliste**, nicht ungeprüft in die App. Ein Dateiname ist eine
 * Behauptung ohne Absender.
 *
 * ## Die Vertrauensstufen
 *
 *     depicts      die Datei trägt eine Strukturdaten-Aussage auf die richtige Q-ID   sicher
 *     kategorie    sie liegt in der Kategorie der Sorte                              wahrscheinlich
 *     dateititel   nur der Name deutet darauf hin                                    Sichtung
 *
 * ## Lizenz
 *
 * Commons erlaubt **keine** NC- und ND-Lizenzen; solche Uploads werden gelöscht. An 222 Bildern
 * aus 10 Sortenkategorien geprüft: 222 von 222 kommerziell nutzbar. Die Angabe wird trotzdem je
 * Datei mitgeschrieben — CC BY-SA verlangt Urheber UND Lizenznamen an der Anzeige.
 *
 * ## Gespeichert wird der DATEINAME, nicht die URL
 *
 * Commons legt jede Datei unter einem Pfad ab, der sich aus dem MD5 des Dateinamens ergibt. Alle
 * Größen sind daraus ableitbar — dieselbe Entscheidung wie bei Pl@ntNets `imageId`. Ein späterer
 * eigener Proxy ändert dann nur `plantImageUrl()` in der App.
 *
 * ⚠️ Nur **vier** Breiten funktionieren: 120 · 250 · 500 · 1280. Alles andere antwortet mit
 * HTTP 400 — nicht mit einem kleineren Bild. An zwei Dateien gegengeprüft.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { DIRS } = require('./lib/paths');

const CONFIG = {
  API: 'https://commons.wikimedia.org/w/api.php',
  /** Wikimedia verlangt einen aussagekräftigen User-Agent mit Kontakt. */
  USER_AGENT: 'MyPlantsBot/1.0 (https://my-plants.app; kontakt@my-plants.app)',
  DATEIEN_JE_KATEGORIE: 100,
  PAUSE_MS: 250,
  MAX_RETRIES: 3,
  TIMEOUT_MS: 60000,
};

const OUT_DIR = path.join(DIRS.raw, 'commons');
const OUT_FILE = path.join(OUT_DIR, 'commons_images.ndjson');
const DONE_FILE = path.join(OUT_DIR, 'commons_images.done');
const META_FILE = path.join(OUT_DIR, 'commons_images.meta.json');
const SICHT_FILE = path.join(OUT_DIR, 'sichtungsliste.ndjson');
const IN_FILE = path.join(DIRS.raw, 'wikidata', 'wikidata_cultivars.ndjson');

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

const api = async (params, versuch = 1) => {
  const body = new URLSearchParams({ ...params, format: 'json', action: 'query' }).toString();
  try {
    const res = await fetch(CONFIG.API, {
      method: 'POST',
      headers: {
        'User-Agent': CONFIG.USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(CONFIG.TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch (err) {
    if (versuch >= CONFIG.MAX_RETRIES) throw err;
    await sleep(1500 * versuch);
    return api(params, versuch + 1);
  }
};

/** Nur Bilddateien. SVG, PDF, Audio und Video gehören nicht in ein Pflanzenkarussell. */
const istBild = (titel) => /\.(jpe?g|png|tiff?|webp)$/i.test(titel);

/**
 * Die Lizenz aus `extmetadata`.
 *
 * Commons verbietet NC und ND, aber geprüft wird trotzdem — eine Regel, auf die man sich verlässt,
 * ohne sie zu messen, ist eine Annahme.
 */
const NICHT_ERLAUBT = /\b(NC|ND|nonfree|non-free|fair use)\b/i;

const holeKategorie = async (kategorie) => {
  const d = await api({
    generator: 'categorymembers',
    gcmtitle: `Category:${kategorie}`,
    gcmtype: 'file',
    gcmlimit: String(CONFIG.DATEIEN_JE_KATEGORIE),
    prop: 'imageinfo',
    iiprop: 'extmetadata|size|url',
    iiextmetadatafilter: 'LicenseShortName|Artist|DateTimeOriginal|Credit',
  });
  return Object.values(d?.query?.pages || {});
};

const sucheNachTitel = async (art, epitheton) => {
  const d = await api({
    list: 'search',
    srsearch: `intitle:"${art}" intitle:"${epitheton}"`,
    srnamespace: '6',
    srlimit: '30',
  });
  const titel = (d?.query?.search || []).map((r) => r.title);
  if (titel.length === 0) return [];
  const info = await api({
    titles: titel.join('|'),
    prop: 'imageinfo',
    iiprop: 'extmetadata|size|url',
    iiextmetadatafilter: 'LicenseShortName|Artist|DateTimeOriginal|Credit',
  });
  return Object.values(info?.query?.pages || {});
};

/** Der reine Text aus einem HTML-Schnipsel — `Artist` kommt als `<a href=…>Name</a>`. */
const nurText = (html) =>
  String(html || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

const zuZeile = (seite, rec, zuordnung) => {
  const ii = seite.imageinfo?.[0];
  if (!ii) return null;
  const em = ii.extmetadata || {};
  const lizenz = nurText(em.LicenseShortName?.value);
  if (!lizenz || NICHT_ERLAUBT.test(lizenz)) return null;
  return {
    plantKey: rec.plantKey,
    wikidataId: rec.wikidataId,
    // Der Dateiname ohne „File:" — alle URLs sind daraus ableitbar.
    commonsFile: seite.title.replace(/^File:/, ''),
    width: ii.width ?? null,
    height: ii.height ?? null,
    license: lizenz,
    creator: nurText(em.Artist?.value) || null,
    dateText: nurText(em.DateTimeOriginal?.value) || null,
    zuordnung,
    // Organ und Bewertung entstehen in Schritt 12 bzw. gar nicht — Commons hat keine Bewertung.
    organ: null,
    rating: 0,
  };
};

(async () => {
  const args = parseArgs();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  if (!fs.existsSync(IN_FILE)) {
    console.error(`\n🔴 ABBRUCH: ${IN_FILE} fehlt. Erst Schritt 10 laufen lassen.\n`);
    process.exit(1);
  }

  const ziele = [];
  const rl = readline.createInterface({ input: fs.createReadStream(IN_FILE, 'utf8'), crlfDelay: Infinity });
  for await (const z of rl) {
    if (!z.trim()) continue;
    const r = JSON.parse(z);
    if (r.commonsCategory || args['auch-titelsuche']) ziele.push(r);
  }
  log(`${fmt(ziele.length)} Taxa mit Commons-Kategorie${args['auch-titelsuche'] ? ' (+ Titelsuche)' : ''}`);

  const done = fs.existsSync(DONE_FILE)
    ? new Set(fs.readFileSync(DONE_FILE, 'utf8').split('\n').filter(Boolean))
    : new Set();
  let offen = ziele.filter((r) => !done.has(r.wikidataId));
  if (args.limit) offen = offen.slice(0, Number(args.limit));
  log(`${fmt(offen.length)} offen`);
  if (offen.length === 0) { log('Nichts zu tun.'); return; }

  const out = fs.createWriteStream(OUT_FILE, { flags: 'a' });
  const sicht = fs.createWriteStream(SICHT_FILE, { flags: 'a' });
  const doneOut = fs.createWriteStream(DONE_FILE, { flags: 'a' });

  const stat = { taxa: 0, mitBildern: 0, bilder: 0, ausKategorie: 0, ausTitel: 0,
                 verworfenLizenz: 0, keineBilder: 0, lizenzen: {} };
  const begonnen = Date.now();

  for (const [i, rec] of offen.entries()) {
    stat.taxa++;
    let zeilen = [];
    try {
      if (rec.commonsCategory) {
        const seiten = await holeKategorie(rec.commonsCategory);
        for (const s of seiten) {
          if (!istBild(s.title)) continue;
          const z = zuZeile(s, rec, 'kategorie');
          if (z) { zeilen.push(z); stat.ausKategorie++; }
          else stat.verworfenLizenz++;
        }
      }
      if (zeilen.length === 0 && args['auch-titelsuche']) {
        const m = /^(\S+(?:\s+\S+)?)\s*[×x]?\s*.*?['‘’ʽ]([^'‘’ʽ]+)['‘’ʽ]/.exec(rec.scientificName);
        if (m) {
          const seiten = await sucheNachTitel(m[1], m[2]);
          for (const s of seiten) {
            if (!istBild(s.title)) continue;
            const z = zuZeile(s, rec, 'dateititel');
            if (z) { zeilen.push(z); stat.ausTitel++; }
          }
        }
      }
    } catch (err) {
      log(`  ⚠ ${rec.scientificName}: ${err.message} — beim nächsten Lauf erneut`);
      await sleep(CONFIG.PAUSE_MS);
      continue;
    }

    if (zeilen.length === 0) stat.keineBilder++;
    else stat.mitBildern++;

    for (const z of zeilen) {
      stat.bilder++;
      stat.lizenzen[z.license] = (stat.lizenzen[z.license] || 0) + 1;
      // 🔴 Weg B kommt in die Sichtungsliste, nicht ungeprüft in den Bau.
      (z.zuordnung === 'dateititel' ? sicht : out).write(JSON.stringify(z) + '\n');
    }
    doneOut.write(rec.wikidataId + '\n');

    if ((i + 1) % 100 === 0) {
      const anteil = (i + 1) / offen.length;
      const rest = ((Date.now() - begonnen) / anteil) * (1 - anteil);
      log(`  ${fmt(i + 1)}/${fmt(offen.length)} · ${fmt(stat.bilder)} Bilder · noch ~${(rest / 60000).toFixed(0)} min`);
    }
    await sleep(CONFIG.PAUSE_MS);
  }

  out.end(); sicht.end(); doneOut.end();
  fs.writeFileSync(META_FILE, JSON.stringify({
    step: '11_fetch_commons_images', finishedAt: new Date().toISOString(), result: stat,
  }, null, 2));

  console.log();
  console.log('='.repeat(64));
  log(`Taxa bearbeitet:      ${fmt(stat.taxa)}`);
  log(`  mit Bildern:        ${fmt(stat.mitBildern)}   ohne: ${fmt(stat.keineBilder)}`);
  log(`➜ BILDER:             ${fmt(stat.bilder)}`);
  log(`   aus Kategorie:     ${fmt(stat.ausKategorie)}   aus Dateititel: ${fmt(stat.ausTitel)} (Sichtungsliste)`);
  log(`   Lizenz verworfen:  ${fmt(stat.verworfenLizenz)}`);
  console.log();
  log('Lizenzen:');
  for (const [k, v] of Object.entries(stat.lizenzen).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`     ${k.padEnd(24)} ${fmt(v).padStart(8)}`);
  }
  console.log();
})().catch((e) => { console.error(e); process.exit(1); });
