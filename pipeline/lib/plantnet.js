'use strict';
/**
 * Minimaler Pl@ntNet-Client.
 *
 * Genutzt wird der öffentliche Endpunkt, den auch identify.plantnet.org selbst
 * abfragt – ohne Schlüssel, ohne Anmeldung. Wir weisen uns im User-Agent ehrlich
 * aus und drosseln uns selbst; Pl@ntNet antwortet bei zu schnellen Folgen mit 429.
 *
 * Keine npm-Abhängigkeiten (Node >= 18).
 */

const API_BASE = 'https://api.plantnet.org/v1';
const USER_AGENT = 'MyPlants-Database/2.0 (Pflanzenlern-App; +https://my-plants.app)';

/** Pl@ntNets Weltflora-Projekt – der größte Namensbestand. */
const WORLD_FLORA_PROJECT = 'k-world-flora';

const DEFAULTS = {
  timeoutMs: 120000,
  maxRetries: 6,
  baseBackoffMs: 2000,
};

class PlantNetError extends Error {
  constructor(status, message, url) {
    super(`HTTP ${status} – ${message} (${url})`);
    this.name = 'PlantNetError';
    this.status = status;
  }
}

/**
 * Letzter gesehener Stand des Kontingents.
 *
 * Pl@ntNet dokumentiert sein Limit in Kopfzeilen – aber nur bei einer 429er
 * Antwort:
 *   x-ratelimit-userpathlimit:     10000   Anfragen je Pfad
 *   x-ratelimit-userpathremaining: -1      aufgebraucht
 *   x-ratelimit-userpathreset:     <ms>    Zeitpunkt der Rückstellung
 *
 * Das Fenster läuft 24 Stunden ab der ersten Anfrage. Wer das ignoriert,
 * verbrennt Stunden in Backoff-Schleifen, ohne einen Datensatz zu gewinnen –
 * genau das ist am 18.08.2026 passiert.
 */
const rateLimit = {
  limit: 10000,        // Vorgabewert, wird aus der Kopfzeile überschrieben
  remaining: null,
  resetAt: null,
  exhausted: false,
  requests: 0,         // von uns gezählt – die API meldet den Stand nur bei 429
};

function readRateLimit(res) {
  const limit = Number(res.headers.get('x-ratelimit-userpathlimit'));
  const remaining = Number(res.headers.get('x-ratelimit-userpathremaining'));
  const reset = Number(res.headers.get('x-ratelimit-userpathreset'));
  if (Number.isFinite(limit)) rateLimit.limit = limit;
  if (Number.isFinite(remaining)) rateLimit.remaining = remaining;
  if (Number.isFinite(reset) && reset > 0) rateLimit.resetAt = new Date(reset);
  if (Number.isFinite(remaining) && remaining <= 0) rateLimit.exhausted = true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiGet(path, params, options) {
  const cfg = { ...DEFAULTS, ...(options || {}) };
  const url = new URL(API_BASE + path);
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }

  let lastError = null;
  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    try {
      // Jede Anfrage zählt aufs Kontingent – auch ein Wiederholungsversuch.
      rateLimit.requests++;
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      });
      readRateLimit(res);
      if (res.ok) return { ok: true, data: await res.json() };

      // 404 markiert bei diesem Endpunkt das Ende der Paginierung
      // ("No species found") – das ist kein Fehler, sondern das Abbruchsignal.
      if (res.status === 404) return { ok: false, status: 404 };

      const body = await res.text();

      // Tageskontingent erschöpft: Weiterprobieren ist zwecklos, das Fenster
      // öffnet erst zur Reset-Zeit wieder. Sofort abbrechen statt zu warten.
      if (res.status === 429 && rateLimit.exhausted) {
        const err = new PlantNetError(429, 'Tageskontingent erschöpft', url.pathname);
        err.quotaExhausted = true;
        throw err;
      }

      if (res.status !== 429 && res.status < 500) {
        throw new PlantNetError(res.status, body.slice(0, 200), url.pathname);
      }
      lastError = new PlantNetError(res.status, body.slice(0, 120), url.pathname);
      const retryAfter = Number(res.headers.get('retry-after'));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : cfg.baseBackoffMs * 2 ** attempt;
      await sleep(waitMs);
    } catch (err) {
      if (err instanceof PlantNetError && err.quotaExhausted) throw err;
      if (err instanceof PlantNetError && err.status !== 429 && err.status < 500) throw err;
      lastError = err;
      if (attempt === cfg.maxRetries) break;
      await sleep(cfg.baseBackoffMs * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error(`Pl@ntNet-Anfrage fehlgeschlagen: ${url}`);
}

/**
 * Eine Seite der Artenliste eines Projekts.
 * Gibt `null` zurück, wenn die Seite hinter dem Ende liegt (HTTP 404).
 *
 * ⚠ Der Listen-Endpunkt kürzt `commonNames` auf **einen** Namen (den
 * bestbewerteten). Die vollständige Rangliste liefert nur die Detailansicht –
 * die aber alle Bilder mitschickt und für Betula pendula 7 MB groß ist.
 */
async function fetchSpeciesPage(project, lang, page, pageSize, options) {
  const res = await apiGet(`/projects/${project}/species`, { lang, page, pageSize }, options);
  if (!res.ok) return null;
  return res.data;
}

/** Detailansicht einer Art – vollständige Namensrangliste, aber sehr große Antwort. */
async function fetchSpeciesDetail(project, scientificNameWithAuthor, lang, options) {
  const res = await apiGet(
    `/projects/${project}/species/${encodeURIComponent(scientificNameWithAuthor)}`,
    { lang },
    options,
  );
  return res.ok ? res.data : null;
}

/**
 * Zieht die GBIF-taxonKey aus der Karten-URL.
 * Pl@ntNet liefert keine eigene ID mit, aber `map` zeigt auf
 * `https://api.plantnet.org/v1/gbif/{taxonKey}/map.png` – an drei Birkenarten
 * gegen GBIF geprüft, die Schlüssel stimmen exakt.
 */
function gbifKeyFromMapUrl(mapUrl) {
  if (typeof mapUrl !== 'string') return null;
  const match = /\/gbif\/(\d+)\//.exec(mapUrl);
  return match ? Number(match[1]) : null;
}

module.exports = {
  API_BASE,
  rateLimit,
  WORLD_FLORA_PROJECT,
  PlantNetError,
  apiGet,
  fetchSpeciesPage,
  fetchSpeciesDetail,
  gbifKeyFromMapUrl,
  sleep,
};
