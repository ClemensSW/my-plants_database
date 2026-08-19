#!/usr/bin/env node
/**
 * Phase 5: Multimedia-Daten sammeln
 *
 * Sammelt Bild-URLs mit Organ-Tags für alle Species aus der GBIF Occurrence API.
 * Extrahiert Tags aus Audubon Core (ac:subjectPart) oder URL-Parametern.
 * Alle URLs nutzen die GBIF Image API (unbegrenzter Cache).
 *
 * Input:  data/output/species.ndjson
 * Output: data/output/multimedia.ndjson
 *
 * Usage: node scripts/05_collect_multimedia.js
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');
const pLimit = require('p-limit');
const { searchOccurrences, sleep } = require('./utils/gbif-helpers');

// Konfiguration - optimiert für 100% Zuverlässigkeit
const CONFIG = {
  INPUT_FILE: path.join(__dirname, '../data/output/species.ndjson'),
  OUTPUT_FILE: path.join(__dirname, '../data/output/multimedia.ndjson'),
  FAILED_FILE: path.join(__dirname, '../data/intermediate/failed_multimedia_keys.txt'),
  DATASET_KEY: '7a3679ef-5582-4aaa-81f0-8c2545cafc81',
  CONCURRENCY: 1,                    // Sequentiell um Rate Limits zu vermeiden
  PAGE_SIZE: 300,
  DELAY_BETWEEN_SPECIES: 500,        // 500ms Pause zwischen Species
  DELAY_BETWEEN_PAGES: 200,          // 200ms Pause zwischen Seiten
  GBIF_IMAGE_BASE: 'https://api.gbif.org/v1/image/cache/occurrence',
};

/**
 * Generiert GBIF Image API URL
 * Format: https://api.gbif.org/v1/image/cache/occurrence/{occurrenceId}/media/{md5}
 */
function gbifImageUrl(originalUrl, occurrenceKey) {
  const md5 = crypto.createHash('md5').update(originalUrl).digest('hex');
  return `${CONFIG.GBIF_IMAGE_BASE}/${occurrenceKey}/media/${md5}`;
}

/**
 * Liest ac:subjectPart aus Extension-Row
 */
function readSubjectPartFromExtRow(row) {
  const candidates = [
    'ac:subjectPart',
    'subjectPart',
    'http://rs.tdwg.org/ac/terms/subjectPart',
    'http://rs.tdwg.org/ac/terms/subject',
    'http://purl.org/dc/terms/subject',
  ];
  for (const k of candidates) {
    const v = row?.[k];
    if (typeof v === 'string' && v.trim()) return v.trim().toLowerCase();
  }
  return null;
}

/**
 * Liest subjectPart aus Media-Objekt
 */
function readSubjectPartFromMedia(m) {
  const candidates = ['ac:subjectPart', 'subjectPart', 'subject', 'subjectCategory'];
  for (const k of candidates) {
    const v = m?.[k];
    if (typeof v === 'string' && v.trim()) return v.trim().toLowerCase();
  }
  return null;
}

/**
 * Extrahiert Organ-Tag aus URL-Parametern
 */
function readOrganFromUrl(identifier) {
  try {
    const u = new URL(identifier);
    const organ = u.searchParams.get('organ') || u.searchParams.get('organs');
    if (organ && organ.trim()) return organ.toLowerCase();

    // Alternativ aus Pfad
    const p = u.pathname.toLowerCase();
    const hit = ['leaf', 'flower', 'fruit', 'bark', 'habit', 'other'].find((k) =>
      p.includes(`/${k}/`)
    );
    return hit || null;
  } catch {
    return null;
  }
}

/**
 * Iterator für Multimedia-Extension
 */
function* iterMultimediaExt(occ) {
  const ex =
    occ?.extensions?.['http://rs.tdwg.org/ac/terms/Multimedia'] ||
    occ?.extensions?.['http://rs.gbif.org/terms/1.0/Multimedia'] ||
    occ?.extensions?.Multimedia;
  if (Array.isArray(ex)) {
    for (const row of ex) yield row;
  }
}

/**
 * Konvertiert Lizenz-URL in Kurzformat
 */
function getLicenseShort(licenseUrl) {
  if (!licenseUrl) return null;
  const url = String(licenseUrl).toLowerCase();

  // Bereits Kurzformat (cc-by-sa, cc-by, etc.)
  if (/^cc-/.test(url)) return url;

  // Text-Format "CC BY-SA 4.0" → "cc-by-sa"
  if (/^cc\s+by/i.test(url)) {
    return url.replace(/\s+/g, '-').replace(/-?\d+\.\d+/, '').toLowerCase().replace(/-+$/, '');
  }

  // URL-Format → extrahiere Lizenztyp
  if (url.includes('creativecommons.org/licenses/')) {
    const match = url.match(/licenses\/([a-z-]+)/);
    if (match) return `cc-${match[1]}`;
  }

  // CC0/Public Domain
  if (url.includes('publicdomain/zero')) return 'cc-0';

  return licenseUrl; // Fallback: Original behalten
}

/**
 * Extrahiert alle Bilder aus einem Occurrence
 */
function extractImagesFromOccurrence(occ) {
  const out = [];
  const mediaItems = Array.isArray(occ?.media) ? occ.media : [];
  const occurrenceKey = occ.key ?? occ.gbifID ?? null;

  // 1) ZUERST: Audubon Core Extension (enthält Organ-Tags!)
  for (const row of iterMultimediaExt(occ)) {
    const id = row?.identifier ||
               row?.['http://rs.tdwg.org/ac/terms/accessURI'] ||
               row?.['http://purl.org/dc/terms/identifier'];
    if (!id || typeof id !== 'string' || !/^https?:\/\//i.test(id)) continue;

    const tag = readSubjectPartFromExtRow(row) || readOrganFromUrl(id);
    const creator = row?.['http://purl.org/dc/terms/creator'] ||
                    row?.['http://purl.org/dc/elements/1.1/creator'] ||
                    row?.creator ||
                    row?.rightsHolder ||
                    row?.['http://purl.org/dc/terms/rightsHolder'] ||
                    occ?.rightsHolder ||
                    null;
    const license = row?.license ||
                    row?.['http://purl.org/dc/terms/license'] ||
                    occ?.license ||
                    null;
    out.push({
      url: gbifImageUrl(id, occurrenceKey),
      tag: tag || null,
      occurrenceKey,
      creator,
      license,
    });
  }

  // 2) DANACH: media[] als Fallback
  for (const m of mediaItems) {
    const id = m?.identifier;
    if (!id || typeof id !== 'string' || !/^https?:\/\//i.test(id)) continue;

    const tag = readSubjectPartFromMedia(m) || readOrganFromUrl(id);
    const creator = m?.creator || m?.rightsHolder || occ?.rightsHolder || null;
    const license = m?.license || occ?.license || null;
    out.push({
      url: gbifImageUrl(id, occurrenceKey),
      tag: tag || null,
      occurrenceKey,
      creator,
      license,
    });
  }

  // Deduplizierung behält jetzt Extension-Einträge (mit Tags)
  const seen = new Set();
  return out.filter((rec) => {
    if (seen.has(rec.url)) return false;
    seen.add(rec.url);
    return true;
  });
}

/**
 * Sammelt alle Bilder für einen taxonKey
 */
async function collectImagesForTaxon(taxonKey, canonicalName) {
  const images = [];
  let offset = 0;

  while (true) {
    const data = await searchOccurrences({
      datasetKey: CONFIG.DATASET_KEY,
      taxonKey,
      mediaType: 'StillImage',
      limit: CONFIG.PAGE_SIZE,
      offset,
    });

    for (const occ of data.results || []) {
      images.push(...extractImagesFromOccurrence(occ));
    }

    if (data.endOfRecords) break;
    offset += CONFIG.PAGE_SIZE;

    // Pause zwischen Seiten (wichtig für Species mit vielen Bildern)
    await sleep(CONFIG.DELAY_BETWEEN_PAGES);

    // Warnung bei sehr vielen Occurrences
    if (offset >= 100000) {
      console.warn(
        `\n⚠ taxonKey ${taxonKey}: >=100k Occurrences (API-Limit erreicht möglich)`
      );
    }
  }

  return images;
}

/**
 * Schreibt Multimedia-Einträge für alle Species
 */
async function main() {
  console.log('='.repeat(60));
  console.log('Phase 5: Multimedia-Daten sammeln');
  console.log('='.repeat(60));
  console.log(`Input:  ${CONFIG.INPUT_FILE}`);
  console.log(`Output: ${CONFIG.OUTPUT_FILE}`);
  console.log();

  const rl = readline.createInterface({
    input: fs.createReadStream(CONFIG.INPUT_FILE, 'utf8'),
    crlfDelay: Infinity,
  });

  const out = fs.createWriteStream(CONFIG.OUTPUT_FILE, { flags: 'w' });
  const failedOut = fs.createWriteStream(CONFIG.FAILED_FILE, { flags: 'w' });
  const queue = [];
  let active = 0;
  let seen = 0;
  let done = 0;
  let totalImages = 0;
  let failedCount = 0;

  const limit = pLimit(CONFIG.CONCURRENCY);

  function kick() {
    if (active >= CONFIG.CONCURRENCY || queue.length === 0) return;
    const job = queue.shift();
    active++;

    limit(async () => {
      try {
        const images = await collectImagesForTaxon(job.taxonKey, job.canonicalName);

        // Schreibe jedes Bild als separate NDJSON-Zeile
        for (const img of images) {
          const record = {
            taxonKey: job.taxonKey,
            species: job.scientificName,
            organ: img.tag,
            occurrenceId: img.occurrenceKey,
            url: img.url,
            creator: img.creator || null,
            license: getLicenseShort(img.license),
            wilsonScore: null, // Placeholder für zukünftige Bewertung
          };
          out.write(JSON.stringify(record) + '\n');
          totalImages++;
        }
      } catch (e) {
        console.error(`\n❌ Fehler bei taxonKey ${job.taxonKey}: ${e.message}`);
        failedOut.write(`${job.taxonKey}\t${job.scientificName}\t${e.message}\n`);
        failedCount++;
      } finally {
        active--;
        done++;

        if (process.stdout.isTTY) {
          const percent = ((done / seen) * 100).toFixed(1);
          process.stdout.write(
            `\rVerarbeitet: ${done}/${seen} (${percent}%) | Bilder: ${totalImages}`
          );
        }

        // Pause zwischen Species um Rate Limits zu vermeiden
        await sleep(CONFIG.DELAY_BETWEEN_SPECIES);

        kick();
      }
    });
  }

  // Species einlesen
  rl.on('line', (line) => {
    if (!line.trim()) return;

    try {
      const obj = JSON.parse(line);
      const taxonKey = obj?.taxonKey;
      const canonicalName = obj?.canonicalName;
      const scientificName = obj?.scientificName;

      if (taxonKey) {
        queue.push({ taxonKey, canonicalName, scientificName });
        seen++;
        kick();
      }
    } catch (e) {
      // Ignoriere ungültige Zeilen
    }
  });

  rl.on('close', async () => {
    // Warte bis alle Worker fertig sind
    while (active > 0 || queue.length > 0) {
      kick();
      await sleep(200);
    }

    out.end();
    failedOut.end();

    console.log();
    console.log();
    console.log(`✓ Species verarbeitet: ${done}/${seen}`);
    console.log(`✓ Bilder gesammelt:    ${totalImages}`);
    if (failedCount > 0) {
      console.log(`✗ Fehlgeschlagen:      ${failedCount}`);
      console.log(`  → Gespeichert in:    ${CONFIG.FAILED_FILE}`);
      console.log(`  → Zum Nachladen:     npm run retry-multimedia`);
    }
    console.log();
    console.log(`✓ Gespeichert: ${CONFIG.OUTPUT_FILE}`);
    console.log();
    console.log('Phase 5 abgeschlossen!');
  });
}

// Script ausführen
if (require.main === module) {
  main().catch((err) => {
    console.error('\n❌ Fehler:', err.message);
    console.error(err.stack);
    process.exit(1);
  });
}

module.exports = { main };
