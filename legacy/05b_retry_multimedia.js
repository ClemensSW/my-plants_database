#!/usr/bin/env node
/**
 * Phase 5b: Fehlgeschlagene Multimedia-Keys erneut verarbeiten
 *
 * Liest taxonKeys aus failed_multimedia_keys.txt und versucht erneut,
 * die Bilder zu sammeln. Verwendet niedrigere Concurrency und längere Pausen.
 *
 * Input:  data/intermediate/failed_multimedia_keys.txt
 * Output: data/output/multimedia.ndjson (Anhängen)
 *
 * Usage: node scripts/05b_retry_multimedia.js
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');
const pLimit = require('p-limit');
const { searchOccurrences, sleep } = require('./utils/gbif-helpers');

// Konfiguration - SEHR konservativ für schwierige Keys
const CONFIG = {
  INPUT_FILE: path.join(__dirname, '../data/intermediate/failed_multimedia_keys.txt'),
  OUTPUT_FILE: path.join(__dirname, '../data/output/multimedia.ndjson'),
  FAILED_FILE: path.join(__dirname, '../data/intermediate/failed_multimedia_keys_retry.txt'),
  DATASET_KEY: '7a3679ef-5582-4aaa-81f0-8c2545cafc81',
  CONCURRENCY: 1,                    // Strikt sequentiell
  PAGE_SIZE: 300,
  DELAY_BETWEEN_REQUESTS: 2000,      // 2 Sekunden zwischen Species
  DELAY_BETWEEN_PAGES: 500,          // 500ms zwischen Seiten
  GBIF_IMAGE_BASE: 'https://api.gbif.org/v1/image/cache/occurrence',
};

/**
 * Generiert GBIF Image API URL
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
async function collectImagesForTaxon(taxonKey) {
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

    // Längere Pause zwischen Seiten für schwierige Keys
    await sleep(CONFIG.DELAY_BETWEEN_PAGES);
  }

  return images;
}

/**
 * Hauptfunktion
 */
async function main() {
  console.log('='.repeat(60));
  console.log('Phase 5b: Fehlgeschlagene Multimedia-Keys erneut verarbeiten');
  console.log('='.repeat(60));

  // Prüfe ob Input-Datei existiert
  if (!fs.existsSync(CONFIG.INPUT_FILE)) {
    console.log(`\n✓ Keine fehlgeschlagenen Keys gefunden.`);
    console.log(`  (${CONFIG.INPUT_FILE} existiert nicht)`);
    return;
  }

  const content = fs.readFileSync(CONFIG.INPUT_FILE, 'utf8');
  const lines = content.trim().split('\n').filter(l => l.trim());

  if (lines.length === 0) {
    console.log(`\n✓ Keine fehlgeschlagenen Keys zum Verarbeiten.`);
    return;
  }

  console.log(`Input:  ${CONFIG.INPUT_FILE}`);
  console.log(`Output: ${CONFIG.OUTPUT_FILE} (Anhängen)`);
  console.log(`\n⚙ Keys zu verarbeiten: ${lines.length}`);
  console.log(`⚙ Concurrency: ${CONFIG.CONCURRENCY}`);
  console.log();

  // Parse failed keys (Format: taxonKey\tscientificName\terrorMessage)
  const jobs = lines.map(line => {
    const [taxonKey, scientificName] = line.split('\t');
    return { taxonKey: parseInt(taxonKey, 10), scientificName: scientificName || '' };
  }).filter(j => !isNaN(j.taxonKey));

  const out = fs.createWriteStream(CONFIG.OUTPUT_FILE, { flags: 'a' }); // Anhängen!
  const failedOut = fs.createWriteStream(CONFIG.FAILED_FILE, { flags: 'w' });

  const limit = pLimit(CONFIG.CONCURRENCY);
  let done = 0;
  let totalImages = 0;
  let successCount = 0;
  let failedCount = 0;

  const tasks = jobs.map(job => limit(async () => {
    try {
      // Zusätzliche Pause vor jedem Request
      await sleep(CONFIG.DELAY_BETWEEN_REQUESTS);

      const images = await collectImagesForTaxon(job.taxonKey);

      for (const img of images) {
        const record = {
          taxonKey: job.taxonKey,
          species: job.scientificName,
          organ: img.tag,
          occurrenceId: img.occurrenceKey,
          url: img.url,
          creator: img.creator || null,
          license: getLicenseShort(img.license),
          wilsonScore: null,
        };
        out.write(JSON.stringify(record) + '\n');
        totalImages++;
      }

      successCount++;
    } catch (e) {
      console.error(`\n❌ Erneut fehlgeschlagen: taxonKey ${job.taxonKey}: ${e.message}`);
      failedOut.write(`${job.taxonKey}\t${job.scientificName}\t${e.message}\n`);
      failedCount++;
    } finally {
      done++;
      if (process.stdout.isTTY) {
        const percent = ((done / jobs.length) * 100).toFixed(1);
        process.stdout.write(
          `\rVerarbeitet: ${done}/${jobs.length} (${percent}%) | Bilder: ${totalImages}`
        );
      }
    }
  }));

  await Promise.all(tasks);

  out.end();
  failedOut.end();

  console.log();
  console.log();
  console.log(`✓ Erfolgreich nachgeladen: ${successCount}/${jobs.length}`);
  console.log(`✓ Bilder gesammelt:        ${totalImages}`);

  if (failedCount > 0) {
    console.log(`✗ Weiterhin fehlgeschlagen: ${failedCount}`);
    console.log(`  → Gespeichert in: ${CONFIG.FAILED_FILE}`);

    // Ersetze alte failed-Datei mit neuer
    fs.renameSync(CONFIG.FAILED_FILE, CONFIG.INPUT_FILE);
    console.log(`  → Originaldatei aktualisiert für weiteren Retry`);
  } else {
    // Alle erfolgreich - lösche failed files
    fs.unlinkSync(CONFIG.INPUT_FILE);
    if (fs.existsSync(CONFIG.FAILED_FILE)) {
      fs.unlinkSync(CONFIG.FAILED_FILE);
    }
    console.log(`\n✓ Alle Keys erfolgreich verarbeitet!`);
    console.log(`  → ${CONFIG.INPUT_FILE} gelöscht`);
  }

  console.log();
  console.log(`✓ Angehängt an: ${CONFIG.OUTPUT_FILE}`);
  console.log();
  console.log('Phase 5b abgeschlossen!');
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
