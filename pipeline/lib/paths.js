'use strict';
/**
 * Alle Dateipfade der Pipeline an genau einer Stelle.
 *
 * Warum das ein eigenes Modul ist: Die alte Pipeline hatte die Dateinamen in den
 * Skripten stehen — `seed-plants-and-media.js` im Backend liest bis heute
 * `../species_2026-02-12.ndjson` aus dem Repo-Root, eine Datei, die dort längst
 * nicht mehr liegt. Ein Umbau der Verzeichnisse war damit ein Suchen-und-Ersetzen
 * über alle Skripte, und wer eines übersah, merkte es erst zur Laufzeit.
 *
 * Verzeichnisordnung:
 *
 *   data/raw/<quelle>/   unveränderte Ernte je Quelle — nie von Hand editieren
 *   data/work/           Zwischenstände der Zusammenführung
 *   data/build/          importfertige Dateien für das Backend
 *   data/state/          Laufzustand (Fortschritt, Kontingent) — nicht im Git
 *
 * Eine neue Quelle (z. B. eine Baumschule) legt `data/raw/<name>/` an und trägt
 * ihre Dateien hier ein. Zusammengeführt wird ausschließlich in 06_build_documents.
 */

const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..', '..');

const DIRS = {
  root: ROOT,
  raw: path.join(ROOT, 'data/raw'),
  rawGbif: path.join(ROOT, 'data/raw/gbif'),
  rawPlantnet: path.join(ROOT, 'data/raw/plantnet'),
  rawEcology: path.join(ROOT, 'data/raw/ecology'),
  rawWikidata: path.join(ROOT, 'data/raw/wikidata'),
  work: path.join(ROOT, 'data/work'),
  build: path.join(ROOT, 'data/build'),
  state: path.join(ROOT, 'data/state'),
  examLists: path.join(ROOT, 'data/exam-lists'),
  reference: path.join(ROOT, 'data/reference'),
};

const FILES = {
  // 01 — GBIF-Backbone
  speciesAccepted: path.join(DIRS.rawGbif, 'species_accepted.ndjson'),
  speciesAcceptedMeta: path.join(DIRS.rawGbif, 'species_accepted.meta.json'),

  // 02 / 04 — Pl@ntNet
  plantnetNames: path.join(DIRS.rawPlantnet, 'plantnet_names.ndjson'),
  plantnetNamesMeta: path.join(DIRS.rawPlantnet, 'plantnet_names.meta.json'),
  plantnetImages: path.join(DIRS.rawPlantnet, 'plantnet_images.ndjson'),
  plantnetImagesMeta: path.join(DIRS.rawPlantnet, 'plantnet_images.meta.json'),
  plantnetSpeciesDetail: path.join(DIRS.rawPlantnet, 'plantnet_species_detail.ndjson'),

  // Zeigerwerte
  // Deutsche Trivialnamen aus Wikidata — Schritt 09. Nur fuer Arten, die weder Pl@ntNet noch
  // GBIF benennen; der dewiki-Sitelink traegt davon die grosse Mehrheit.
  wikidataNames: path.join(DIRS.rawWikidata, 'wikidata_names.ndjson'),
  // Schritt 10/11 — Taxa unterhalb der Art und ihre Commons-Bilder.
  wikidataCultivars: path.join(DIRS.rawWikidata, 'wikidata_cultivars.ndjson'),
  commonsImages: path.join(ROOT, 'data/raw/commons/commons_images.ndjson'),
  wikidataNamesMeta: path.join(DIRS.rawWikidata, 'wikidata_names.meta.json'),

  eiveSlim: path.join(DIRS.rawEcology, 'eive-1.0/eive-slim.json'),
  eiveManifest: path.join(DIRS.rawEcology, 'eive-1.0/manifest.json'),
  ecologyLegacyBackup: path.join(DIRS.rawEcology, 'backup-ecology-prod-2026-08-02.ndjson'),

  // 03 / 05 — Zwischenstände
  speciesEnriched: path.join(DIRS.work, 'species_enriched.ndjson'),
  speciesEnrichedMeta: path.join(DIRS.work, 'species_enriched.meta.json'),
  /**
   * Pl@ntNets `gbifKey` → der Schlüssel, den GBIFs Backbone heute führt.
   *
   * Zwischenspeicher, kein Nebenprodukt: Ein zweiter Lauf fragt nur nach dem, was neu dazukam.
   * Löschen erzwingt eine vollständige Neuauflösung (~700 GBIF-Anfragen). Siehe
   * `lib/gbif-key-resolver.js`.
   */
  gbifKeyMap: path.join(DIRS.work, 'gbif_key_map.ndjson'),
  /** Die Arten, für die auch GBIF keinen heutigen Schlüssel kennt — zum Nachsehen, nicht zum Ignorieren. */
  gbifKeyUnresolved: path.join(DIRS.work, 'gbif_key_unresolved.ndjson'),
  ecologyByTaxon: path.join(DIRS.work, 'ecology_by_taxon.ndjson'),
  ecologyByTaxonMeta: path.join(DIRS.work, 'ecology_by_taxon.meta.json'),

  // 06 — importfertig
  buildPlants: path.join(DIRS.build, 'plants.ndjson'),
  buildPlantMedias: path.join(DIRS.build, 'plantmedias.ndjson'),
  buildMeta: path.join(DIRS.build, 'build.meta.json'),

  // Laufzustand
  stateStep1Plan: path.join(DIRS.state, 'step1_plan.json'),
  stateStep1Done: path.join(DIRS.state, 'step1_done.json'),
  stateImagesDone: path.join(DIRS.state, 'plantnet_images.done'),
  stateQuota: path.join(DIRS.state, 'plantnet_quota.json'),

  // Prüfungslisten
  examCatalog: path.join(DIRS.examLists, 'catalog.json'),
};

/** Legt die Verzeichnisse an, die ein Schritt beschreibt. */
function ensureDirs(...keys) {
  for (const key of keys) {
    const dir = DIRS[key];
    if (!dir) throw new Error(`Unbekanntes Verzeichnis: ${key}`);
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Wirft mit klarer Meldung, wenn eine Eingabedatei eines Schrittes fehlt. */
function requireFiles(...keys) {
  const missing = keys.filter((key) => !fs.existsSync(FILES[key]));
  if (missing.length) {
    const lines = missing.map((key) => `  ${key}: ${FILES[key]}`).join('\n');
    throw new Error(`Eingabedatei fehlt — vorherigen Schritt laufen lassen:\n${lines}`);
  }
}

/** Kurzer, lesbarer Pfad für Logausgaben. */
function rel(absolute) {
  return path.relative(ROOT, absolute);
}

module.exports = { ROOT, DIRS, FILES, ensureDirs, requireFiles, rel };
