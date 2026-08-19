'use strict';
/**
 * Minimaler GBIF-Client für die neue Katalog-Pipeline.
 *
 * Bewusst ohne npm-Abhängigkeiten: Node >= 18 bringt `fetch` und `AbortController`
 * mit. Damit läuft pipeline/ unabhängig von legacy/ und von package.json.
 */

const API_BASE = 'https://api.gbif.org/v1';
const USER_AGENT = 'MyPlants-Database/2.0 (Pflanzenkatalog; +https://my-plants.app)';

/** GBIF Backbone Taxonomy – die Namensautorität, gegen die wir arbeiten. */
const BACKBONE_DATASET_KEY = 'd7dddbf4-2cf0-4f39-9b2a-bb099caae36c';

/** taxonKey des Reichs Plantae im Backbone. */
const PLANTAE_KEY = 6;

const DEFAULTS = {
  timeoutMs: 180000,
  maxRetries: 6,
  baseBackoffMs: 1000,
};

class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} – ${url}`);
    this.name = 'HttpError';
    this.status = status;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUrl(path, params) {
  const url = new URL(API_BASE + path);
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

/**
 * GET mit Retry und Exponential Backoff.
 * Wiederholt wird nur bei 429, 5xx und Netzwerk-/Timeout-Fehlern –
 * ein 400 oder 404 ist ein Programmierfehler und soll laut scheitern.
 */
async function apiGet(path, params, options) {
  const cfg = { ...DEFAULTS, ...(options || {}) };
  const url = buildUrl(path, params);
  let lastError = null;

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      });
      if (res.ok) return await res.json();

      const err = new HttpError(res.status, url.toString());
      if (res.status !== 429 && res.status < 500) throw err;

      lastError = err;
      const retryAfter = Number(res.headers.get('retry-after'));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : cfg.baseBackoffMs * 2 ** attempt;
      await sleep(waitMs);
    } catch (err) {
      if (err instanceof HttpError && err.status !== 429 && err.status < 500) throw err;
      lastError = err;
      if (attempt === cfg.maxRetries) break;
      await sleep(cfg.baseBackoffMs * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error(`Anfrage fehlgeschlagen: ${url}`);
}

/**
 * Zählt akzeptierte Arten unterhalb eines Taxons.
 * `highertaxonKey` schließt den Knoten selbst NICHT ein – geprüft an einer Art
 * (Rückgabe 0). Wer einen Artknoten zählt, bekommt also immer 0.
 */
async function countAcceptedSpecies(higherTaxonKey, opts) {
  const data = await apiGet('/species/search', {
    datasetKey: BACKBONE_DATASET_KEY,
    highertaxonKey: higherTaxonKey,
    rank: 'SPECIES',
    status: 'ACCEPTED',
    limit: 0,
  }, opts);
  return data.count;
}

/**
 * Holt eine Seite akzeptierter Arten unterhalb eines Taxons.
 * ACHTUNG: `offset` muss < 100.000 bleiben – darüber antwortet die API mit
 * HTTP 400. Deshalb schneidet 01_fetch_species.js den Baum in kleine Scheiben.
 */
async function searchAcceptedSpecies(higherTaxonKey, offset, limit, opts) {
  return apiGet('/species/search', {
    datasetKey: BACKBONE_DATASET_KEY,
    highertaxonKey: higherTaxonKey,
    rank: 'SPECIES',
    status: 'ACCEPTED',
    limit,
    offset,
  }, opts);
}

/** Listet alle direkten Kinder eines Taxons (alle Ränge, alle Status). */
async function listChildren(taxonKey, opts) {
  const out = [];
  let offset = 0;
  const limit = 1000;
  for (;;) {
    const data = await apiGet(`/species/${taxonKey}/children`, { limit, offset }, opts);
    const results = data.results || [];
    out.push(...results);
    if (data.endOfRecords || results.length === 0) break;
    offset += limit;
  }
  return out;
}

/** Einzelnes Taxon inklusive Trivialnamen (für die wenigen Direkt-Treffer). */
async function getSpeciesWithVernaculars(taxonKey, opts) {
  const usage = await apiGet(`/species/${taxonKey}`, {}, opts);
  const vernaculars = await apiGet(`/species/${taxonKey}/vernacularNames`, { limit: 1000 }, opts);
  return { ...usage, vernacularNames: vernaculars.results || [] };
}

/**
 * Arbeitet `items` mit fester Parallelität ab. Bewusst simpel gehalten,
 * damit keine Abhängigkeit auf p-limit nötig ist.
 */
async function pool(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runnerCount = Math.max(1, Math.min(concurrency, items.length));
  const runners = Array.from({ length: runnerCount }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

module.exports = {
  API_BASE,
  BACKBONE_DATASET_KEY,
  PLANTAE_KEY,
  HttpError,
  apiGet,
  countAcceptedSpecies,
  searchAcceptedSpecies,
  listChildren,
  getSpeciesWithVernaculars,
  pool,
  sleep,
};
