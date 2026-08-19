/**
 * Wikidata API Helper-Funktionen
 *
 * Funktionen für die Interaktion mit der Wikidata SPARQL API.
 * Verwendet für die Ergänzung fehlender deutscher Namen aus Wikidata.
 */

const axios = require('axios');

// Konstanten
const WIKIDATA_SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
const DEFAULT_TIMEOUT = 20000;
const DEFAULT_RETRIES = 5;
const BASE_BACKOFF_MS = 1000; // Wikidata ist langsamer → längerer Backoff

/**
 * Wartet eine bestimmte Zeit (async sleep)
 * @param {number} ms - Millisekunden zu warten
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Führt einen SPARQL Query mit automatischen Retries durch
 *
 * @param {string} sparqlQuery - Der SPARQL Query String
 * @param {number} tries - Anzahl der Retry-Versuche (default: 5)
 * @param {number} timeout - Timeout in ms (default: 20000)
 * @returns {Promise<Object>} Die Response-Daten
 * @throws {Error} Wenn alle Retry-Versuche fehlschlagen
 */
async function querySparqlWithRetry(sparqlQuery, tries = DEFAULT_RETRIES, timeout = DEFAULT_TIMEOUT) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await axios.get(WIKIDATA_SPARQL_ENDPOINT, {
        params: {
          query: sparqlQuery,
          format: 'json'
        },
        headers: {
          'User-Agent': 'My-Plants-Database/1.0 (https://github.com/yourusername/my-plants-database)',
          'Accept': 'application/sparql-results+json'
        },
        timeout
      });
      return res.data;
    } catch (err) {
      const status = err.response?.status;

      // Retry bei Netzfehlern, 429 (Rate Limit) & 5xx (Server-Fehler)
      if (
        i < tries - 1 &&
        (status === 429 || (status >= 500 && status <= 599) || !status)
      ) {
        const backoff = BASE_BACKOFF_MS * Math.pow(2, i);
        await sleep(backoff);
        continue;
      }
      throw err;
    }
  }
}

/**
 * Sucht deutsche Namen für einen wissenschaftlichen Namen in Wikidata
 *
 * @param {string} scientificName - Wissenschaftlicher Name, vorzugsweise canonicalName ohne Namensgeber (z.B. "Azolla caroliniana" statt "Azolla caroliniana Willd.")
 * @returns {Promise<Array>} Array von deutschen Namen [{name, preferred, source}]
 */
async function queryWikidataGermanNames(scientificName) {
  // SPARQL Query: Suche nach P225 (taxon name) → P1843 (common name) ODER rdfs:label (lang=de)
  // WICHTIG: canonicalName (ohne Autorennamen) liefert bessere Treffer, da Wikidata P225 oft ohne Autorennamen speichert
  // UNION mit rdfs:label nötig, weil viele Arten den deutschen Namen nur als Item-Label haben, nicht als P1843
  const sparql = `
    SELECT DISTINCT ?germanName WHERE {
      ?item wdt:P225 "${scientificName}" .
      {
        ?item wdt:P1843 ?germanName .
        FILTER(LANG(?germanName) = "de")
      } UNION {
        ?item rdfs:label ?germanName .
        FILTER(LANG(?germanName) = "de")
      }
    }
    LIMIT 10
  `;

  try {
    const data = await querySparqlWithRetry(sparql);
    const bindings = data?.results?.bindings || [];

    // Extrahiere deutsche Namen
    // Sicherheitsfilter: rdfs:label kann auch den wissenschaftlichen Namen enthalten
    const germanNames = bindings
      .map(b => b.germanName?.value)
      .filter(name => name && name.trim().length > 0)
      .filter(name => name.trim().toLowerCase() !== scientificName.toLowerCase())
      .map(name => ({
        name: name.trim(),
        preferred: false, // Wikidata hat kein preferred Flag → immer false
        source: 'Wikidata'
      }));

    // Deduplizierung (case-insensitive)
    const seen = new Set();
    return germanNames.filter(item => {
      const key = item.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch (err) {
    // Bei Fehler: leere Liste zurückgeben (nicht kritisch)
    // Fehler nicht werfen, damit Pipeline nicht abbricht
    return [];
  }
}

/**
 * Batch-Query für mehrere wissenschaftliche Namen
 * Optimierung: Reduziert Anzahl der Requests
 *
 * @param {Array<string>} scientificNames - Array von wissenschaftlichen Namen
 * @returns {Promise<Object>} Map von scientificName → germanNames Array
 */
async function queryWikidataGermanNamesBatch(scientificNames) {
  if (!scientificNames || scientificNames.length === 0) {
    return {};
  }

  // VALUES Clause für Batch-Query (max 50 auf einmal)
  const namesList = scientificNames.slice(0, 50).map(n => `"${n}"`).join(' ');

  // UNION mit rdfs:label, da viele Arten den deutschen Namen nur als Item-Label haben
  const sparql = `
    SELECT ?scientificName ?germanName WHERE {
      VALUES ?scientificName { ${namesList} }
      ?item wdt:P225 ?scientificName .
      {
        ?item wdt:P1843 ?germanName .
        FILTER(LANG(?germanName) = "de")
      } UNION {
        ?item rdfs:label ?germanName .
        FILTER(LANG(?germanName) = "de")
      }
    }
  `;

  try {
    const data = await querySparqlWithRetry(sparql, DEFAULT_RETRIES, 30000); // Längerer Timeout
    const bindings = data?.results?.bindings || [];

    // Gruppiere nach scientificName
    const resultMap = {};
    bindings.forEach(b => {
      const sciName = b.scientificName?.value;
      const germanName = b.germanName?.value;

      // Sicherheitsfilter: rdfs:label kann den wissenschaftlichen Namen enthalten
      if (sciName && germanName && germanName.trim().toLowerCase() !== sciName.toLowerCase()) {
        if (!resultMap[sciName]) {
          resultMap[sciName] = [];
        }
        resultMap[sciName].push({
          name: germanName.trim(),
          preferred: false,
          source: 'Wikidata'
        });
      }
    });

    // Deduplizierung pro scientificName
    Object.keys(resultMap).forEach(sciName => {
      const seen = new Set();
      resultMap[sciName] = resultMap[sciName].filter(item => {
        const key = item.name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    });

    return resultMap;
  } catch (err) {
    // Bei Fehler: leeres Objekt (nicht kritisch)
    return {};
  }
}

module.exports = {
  // API-Funktionen
  querySparqlWithRetry,
  queryWikidataGermanNames,
  queryWikidataGermanNamesBatch,

  // Hilfsfunktionen
  sleep,

  // Konstanten
  WIKIDATA_SPARQL_ENDPOINT,
};
