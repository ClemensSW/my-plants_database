#!/usr/bin/env node
'use strict';
/**
 * Schritt 4 (neue Pipeline): Bilder direkt von Pl@ntNet, mit Organ, Lizenz und
 * Community-Bewertung.
 *
 * Warum nicht über GBIF: Pl@ntNet teilt dort nur einen Bruchteil. Gemessen an
 * acht Arten kommen über GBIF 34.129 Bilder an, direkt bei Pl@ntNet sind es
 * 156.184 – Faktor 4,6, bei Taxus baccata sogar 8,6.
 *
 * Die Detailansicht liefert alles in EINEM Aufruf:
 *   - Bilder bereits nach Organ gruppiert (leaf, flower, fruit, bark, habit, other)
 *   - `license` am EINZELNEN Bild, nicht am Datensatz – kein Rückschluss nötig
 *   - `plus.count` als Zustimmung der Community (jedes Bild hat mindestens 1)
 *   - `commonNames` als vollständige Rangliste (der Listen-Endpunkt kürzt auf einen)
 *
 * Kein Deckel: Die Lern-App lebt davon, jedes Mal andere Bilder zu zeigen.
 * Gespeichert wird nur die Bild-`id` – die drei URL-Größen sind daraus ableitbar
 * (an 14.812 Bildern geprüft, null Abweichungen):
 *   https://bs.plantnet.org/image/{o|m|s}/{id}
 *
 * Output: data/raw/plantnet/plantnet_images.ndjson  (eine Zeile je Bild)
 *         data/raw/plantnet/plantnet_species_detail.ndjson  (Artebene: volle Namensrangliste,
 *         Traits, Nutzungen, IUCN, Fremd-IDs, Organzählung, Statistik)
 *
 * Usage:
 *   node pipeline/04_fetch_plantnet_images.js --only-named=de   # ~2 h, 12.187 Arten
 *   node pipeline/04_fetch_plantnet_images.js                   # ~14 h, 84.560 Arten
 *   node pipeline/04_fetch_plantnet_images.js --limit=50        # Probelauf
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const { WORLD_FLORA_PROJECT, fetchSpeciesDetail, sleep, rateLimit } = require('./lib/plantnet');
const { DIRS, FILES, ensureDirs, requireFiles, rel } = require('./lib/paths');

const ROOT = path.join(__dirname, '..');

const CONFIG = {
  PROJECT: WORLD_FLORA_PROJECT,
  LANG: 'de',
  // Die Grenze ist eine MENGE (10.000 Anfragen je 24 h), kein Tempo. Eine
  // langsamere Gangart spart kein Kontingent, sie verlängert nur den Lauf.
  // Gemessen am 18.08.2026: 100 Minuten bei 2,5–2,8 Anfragen/s ohne einen
  // einzigen 429er – ein Kurzzeitlimit gibt es bei dieser Größenordnung nicht.
  // Der 429er kam erst, als der Tageszähler bei 10.000 stand.
  // Gewählt zum Ausprobieren: rund 8,6 Anfragen/s. Belegt unproblematisch sind
  // bislang nur 2,8/s (100 Minuten am 18.08.2026 ohne einen 429er). Tauchen im
  // Lauf 429er auf, WÄHREND der Tageszähler noch niedrig steht, gibt es doch ein
  // Kurzzeitlimit – dann zurück auf --delay=250 --concurrency=2.
  DELAY_MS: 100,
  CONCURRENCY: 3,
  MAX_PER_ORGAN: 0,        // 0 = kein Deckel
  ONLY_NAMED: null,        // z. B. 'de': nur Arten mit Trivialnamen in dieser Sprache
  LIMIT: 0,
  NAMES_FILE: FILES.plantnetNames,
  OUT_FILE: FILES.plantnetImages,
  FULLNAMES_FILE: FILES.plantnetSpeciesDetail,
  META_FILE: FILES.plantnetImagesMeta,
  DONE_FILE: FILES.stateImagesDone,
  QUOTA_FILE: FILES.stateQuota,
  QUOTA_LIMIT: 10000,      // dokumentiert in x-ratelimit-userpathlimit
  QUOTA_WINDOW_MS: 24 * 3600 * 1000,
};

function parseArgs(argv) {
  const out = {};
  for (const arg of argv.slice(2)) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!m) throw new Error(`Unbekanntes Argument: ${arg}`);
    out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}
const fmt = (n) => Number(n).toLocaleString('de-DE');

/** Liest die Artenliste aus Schritt 2 und wählt aus, was geholt werden soll. */
async function loadTargets() {
  const targets = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(CONFIG.NAMES_FILE, 'utf8'),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const rec = JSON.parse(line);
    if (!rec.imagesCount) continue;
    if (CONFIG.ONLY_NAMED && !rec.commonNames?.[CONFIG.ONLY_NAMED]?.length) continue;
    targets.push({
      key: `${rec.plantnetName}|${rec.author || ''}`,
      lookup: `${rec.plantnetName} ${rec.author || ''}`.trim(),
      plantnetName: rec.plantnetName,
      taxonKey: rec.gbifKey || null,
      imagesCount: rec.imagesCount,
    });
  }
  // Die bilderreichsten zuerst – so liegt das Wertvollste früh vor, falls
  // ein Lauf abgebrochen wird.
  targets.sort((a, b) => b.imagesCount - a.imagesCount);
  return CONFIG.LIMIT ? targets.slice(0, CONFIG.LIMIT) : targets;
}

/**
 * Kontingent-Buchführung.
 *
 * Pl@ntNet nennt den Stand nur in der 429er Antwort – bei Erfolg steht keine
 * Zählung in den Kopfzeilen (an einer 200er Antwort geprüft). Also führen wir
 * selbst Buch: 10.000 Anfragen je Pfad, Fenster von 24 Stunden ab der ersten
 * Anfrage. Gezählt werden echte HTTP-Anfragen, nicht Arten – ein
 * Wiederholungsversuch belastet das Konto genauso.
 */
function loadQuota() {
  let q = null;
  try { q = JSON.parse(fs.readFileSync(CONFIG.QUOTA_FILE, 'utf8')); } catch { /* neu */ }
  const now = Date.now();
  if (!q || !q.windowStart || now - q.windowStart >= CONFIG.QUOTA_WINDOW_MS) {
    return { windowStart: null, used: 0, fresh: true };
  }
  return { ...q, fresh: false };
}

function saveQuota(q) {
  fs.writeFileSync(CONFIG.QUOTA_FILE, JSON.stringify(q, null, 2), 'utf8');
}

function quotaBar(used, limit) {
  const width = 24;
  const filled = Math.min(width, Math.round((used / limit) * width));
  return `[${'#'.repeat(filled)}${'.'.repeat(width - filled)}] ${fmt(used)}/${fmt(limit)}`;
}

function loadDone() {
  try {
    return new Set(fs.readFileSync(CONFIG.DONE_FILE, 'utf8').split('\n').filter(Boolean));
  } catch {
    return new Set();
  }
}

/** Baut aus der Detailantwort die Bildzeilen. */
function toImageRecords(detail, target) {
  const out = [];
  const groups = detail?.images;
  if (!groups || typeof groups !== 'object') return out;

  for (const [organ, list] of Object.entries(groups)) {
    if (!Array.isArray(list)) continue;
    let entries = list;
    if (CONFIG.MAX_PER_ORGAN > 0) {
      entries = [...list]
        .sort((a, b) => ((b.plus?.count || 0) - (a.plus?.count || 0)))
        .slice(0, CONFIG.MAX_PER_ORGAN);
    }
    for (const img of entries) {
      if (!img?.id) continue;
      out.push({
        taxonKey: target.taxonKey,
        species: target.plantnetName,
        organ,
        imageId: img.id,
        license: img.license || null,
        author: img.author || null,
        plus: img.plus?.count ?? null,
        observationId: img.observationId || null,
        date: img.date || null,
      });
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.lang) CONFIG.LANG = String(args.lang);
  if (args.delay) CONFIG.DELAY_MS = Number(args.delay);
  if (args.concurrency) CONFIG.CONCURRENCY = Number(args.concurrency);
  if (args['max-per-organ']) CONFIG.MAX_PER_ORGAN = Number(args['max-per-organ']);
  if (args['only-named']) CONFIG.ONLY_NAMED = String(args['only-named']);
  if (args.limit) CONFIG.LIMIT = Number(args.limit);
  if (args.out) CONFIG.OUT_FILE = path.resolve(args.out);
  if (args.fresh) {
    for (const f of [CONFIG.OUT_FILE, CONFIG.FULLNAMES_FILE, CONFIG.DONE_FILE]) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  }
  fs.mkdirSync(path.dirname(CONFIG.OUT_FILE), { recursive: true });
  fs.mkdirSync(path.dirname(CONFIG.DONE_FILE), { recursive: true });

  console.log('='.repeat(64));
  console.log('Schritt 4 (neu): Bilder direkt von Pl@ntNet');
  console.log('='.repeat(64));
  log(`Auswahl:      ${CONFIG.ONLY_NAMED ? `nur Arten mit Namen "${CONFIG.ONLY_NAMED}"` : 'alle Arten mit Bildern'}`);
  log(`Deckel:       ${CONFIG.MAX_PER_ORGAN || 'keiner – alle Bilder'}`);
  log(`Tempo:        ${CONFIG.CONCURRENCY} parallel, ${CONFIG.DELAY_MS} ms Pause`);
  console.log();

  const targets = await loadTargets();
  const done = loadDone();
  const open = targets.filter((t) => !done.has(t.key));
  const plannedImages = open.reduce((s, t) => s + t.imagesCount, 0);

  log(`Arten gesamt:     ${fmt(targets.length)}`);
  log(`bereits erledigt: ${fmt(targets.length - open.length)}`);
  log(`offen:            ${fmt(open.length)} mit ~${fmt(plannedImages)} Bildern`);
  log(`geschätzt:        ~${(plannedImages * 500 / 1e9).toFixed(1)} GB Download, `
    + `~${(plannedImages * 199 / 1e9).toFixed(2)} GB Ausgabe`);

  const quota = loadQuota();
  const budget = Math.max(0, CONFIG.QUOTA_LIMIT - quota.used);
  console.log();
  if (quota.fresh) {
    log(`Kontingent:       ${quotaBar(0, CONFIG.QUOTA_LIMIT)}  – neues 24-Stunden-Fenster`);
  } else {
    const endsIn = (quota.windowStart + CONFIG.QUOTA_WINDOW_MS - Date.now()) / 3600000;
    log(`Kontingent:       ${quotaBar(quota.used, CONFIG.QUOTA_LIMIT)}  `
      + `– Fenster endet in ${endsIn.toFixed(1)} h`);
  }
  log(`heute noch frei:  ${fmt(budget)} Anfragen `
    + `→ reicht für etwa ${fmt(Math.min(budget, open.length))} der ${fmt(open.length)} offenen Arten`);
  if (budget === 0) {
    const endsIn = (quota.windowStart + CONFIG.QUOTA_WINDOW_MS - Date.now()) / 3600000;
    log(`⛔ Kontingent aufgebraucht. Wieder frei in ${endsIn.toFixed(1)} h.`);
    return;
  }
  console.log();

  const imagesOut = fs.createWriteStream(CONFIG.OUT_FILE, { flags: 'a', encoding: 'utf8' });
  const namesOut = fs.createWriteStream(CONFIG.FULLNAMES_FILE, { flags: 'a', encoding: 'utf8' });
  const doneOut = fs.createWriteStream(CONFIG.DONE_FILE, { flags: 'a', encoding: 'utf8' });

  const started = Date.now();
  let quotaUsed = quota.used;
  let quotaWindowStart = quota.windowStart;
  let lastRequests = rateLimit.requests;
  const persistQuota = () => saveQuota({
    windowStart: quotaWindowStart, used: quotaUsed, limit: CONFIG.QUOTA_LIMIT,
    updatedAt: new Date().toISOString(),
  });
  let quotaStop = false;
  let processed = 0;
  let images = 0;
  let failed = 0;
  const licenses = {};
  const organs = {};
  let cursor = 0;

  async function worker() {
    for (;;) {
      if (quotaStop) return;
      if (quotaUsed >= CONFIG.QUOTA_LIMIT) { quotaStop = true; return; }
      const index = cursor++;
      if (index >= open.length) return;
      const target = open[index];
      try {
        const detail = await fetchSpeciesDetail(CONFIG.PROJECT, target.lookup, CONFIG.LANG);
        if (detail) {
          const records = toImageRecords(detail, target);
          if (records.length) {
            imagesOut.write(records.map((r) => JSON.stringify(r)).join('\n') + '\n');
          }
          for (const r of records) {
            licenses[r.license || '(ohne)'] = (licenses[r.license || '(ohne)'] || 0) + 1;
            organs[r.organ] = (organs[r.organ] || 0) + 1;
          }
          images += records.length;

          // Nebenprodukt: die Artebene VERBATIM, so wie Pl@ntNet sie ausliefert –
          // nur ohne `images`, die in die eigene Datei gehen. Nichts wird
          // ausgewählt oder umbenannt: alles, was die Antwort trägt, bleibt
          // erhalten (commonNames als volle Rangliste, traits, uses, iucn,
          // stats, synonyms, links, projects, map, gbif/powo/ipni/eppo/taxref …),
          // und künftige neue Felder kommen automatisch mit.
          // Kosten: ~2,6 KB je Art, für 84.560 Arten rund 220 MB.
          // Wird es hier nicht mitgeschrieben, kostet es später einen
          // kompletten zweiten Durchlauf über alle Arten.
          const { images: _images, ...speciesLevel } = detail;
          namesOut.write(JSON.stringify({
            taxonKey: target.taxonKey,
            lang: CONFIG.LANG,
            retrievedAt: new Date().toISOString(),
            ...speciesLevel,
          }) + '\n');
        } else {
          failed++;
        }
        doneOut.write(target.key + '\n');
      } catch (err) {
        if (err.quotaExhausted) {
          // Tageskontingent aufgebraucht – geordnet aufhören. Die Art bleibt
          // unmarkiert und wird beim nächsten Lauf erneut geholt.
          // Den eigenen Zähler auf die Wahrheit der API setzen, damit der
          // nächste Start nicht erneut ins Limit rennt: das Fenster endet zur
          // gemeldeten Reset-Zeit, begann also 24 h davor.
          quotaUsed = CONFIG.QUOTA_LIMIT;
          if (rateLimit.resetAt) {
            quotaWindowStart = rateLimit.resetAt.getTime() - CONFIG.QUOTA_WINDOW_MS;
          }
          quotaStop = true;
          return;
        }
        failed++;
        log(`  ⚠ ${target.plantnetName}: ${err.message}`);
      }
      // Verbrauch fortschreiben: echte Anfragen, inkl. Wiederholungen.
      const spent = rateLimit.requests - lastRequests;
      lastRequests = rateLimit.requests;
      if (spent > 0) {
        if (!quotaWindowStart) quotaWindowStart = Date.now();
        quotaUsed += spent;
      }
      processed++;
      if (processed % 10 === 0) persistQuota();
      if (processed % 25 === 0 || processed === open.length) {
        const elapsed = (Date.now() - started) / 1000;
        const rate = processed / elapsed;
        const eta = rate > 0 ? (open.length - processed) / rate / 60 : 0;
        const left = CONFIG.QUOTA_LIMIT - quotaUsed;
        log(`  ${fmt(processed)}/${fmt(open.length)} Arten · ${fmt(images)} Bilder · `
          + `${elapsed.toFixed(0)}s · Rest ~${eta.toFixed(0)} min · `
          + `Kontingent ${quotaBar(quotaUsed, CONFIG.QUOTA_LIMIT)}`);
        if (left <= 500 && left > 0) log(`  ⚠ nur noch ${fmt(left)} Anfragen frei`);
      }
      await sleep(CONFIG.DELAY_MS);
    }
  }

  await Promise.all(Array.from({ length: CONFIG.CONCURRENCY }, worker));
  persistQuota();

  await new Promise((r) => imagesOut.end(r));
  await new Promise((r) => namesOut.end(r));
  await new Promise((r) => doneOut.end(r));

  const meta = {
    step: '04_fetch_plantnet_images',
    finishedAt: new Date().toISOString(),
    source: {
      api: 'https://api.plantnet.org/v1/projects/{project}/species/{name}',
      project: CONFIG.PROJECT,
      urlPattern: 'https://bs.plantnet.org/image/{o|m|s}/{imageId}',
    },
    settings: {
      onlyNamed: CONFIG.ONLY_NAMED, maxPerOrgan: CONFIG.MAX_PER_ORGAN,
      concurrency: CONFIG.CONCURRENCY, delayMs: CONFIG.DELAY_MS,
    },
    result: { speciesProcessed: processed, images, failed, licenses, organs },
  };
  fs.writeFileSync(CONFIG.META_FILE, JSON.stringify(meta, null, 2), 'utf8');

  console.log();
  console.log('='.repeat(64));
  if (quotaStop) {
    const reset = rateLimit.resetAt
      || (quotaWindowStart ? new Date(quotaWindowStart + CONFIG.QUOTA_WINDOW_MS) : null);
    log('⛔ Tageskontingent von Pl@ntNet aufgebraucht – Lauf geordnet beendet.');
    log(`   Limit: ${fmt(rateLimit.limit || 10000)} Anfragen je Pfad und 24-Stunden-Fenster.`);
    if (reset) {
      const hours = (reset.getTime() - Date.now()) / 3600000;
      log(`   Wieder frei: ${reset.toLocaleString('de-DE')} (in ${hours.toFixed(1)} h)`);
    }
    log('   Einfach später erneut starten – erledigte Arten werden übersprungen.');
  }
  log(`Kontingent:        ${quotaBar(quotaUsed, CONFIG.QUOTA_LIMIT)}`);
  log(`Arten verarbeitet: ${fmt(processed)}`);
  log(`Bilder:            ${fmt(images)}`);
  if (failed) log(`Fehlgeschlagen:    ${fmt(failed)}`);
  log(`Organe:            ${Object.entries(organs).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${fmt(v)}`).join(' · ')}`);
  log(`Lizenzen:          ${Object.entries(licenses).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${fmt(v)}`).join(' · ')}`);
  log(`Output:            ${CONFIG.OUT_FILE}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('\n❌ Fehler:', err.message);
    console.error(err.stack);
    process.exit(1);
  });
}

module.exports = { main, toImageRecords, CONFIG };
