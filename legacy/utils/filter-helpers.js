/**
 * Filter-Helper-Funktionen
 *
 * Utility-Funktionen zum Filtern von NDJSON-Daten.
 */

const fs = require('fs');
const readline = require('readline');

/**
 * Filtert NDJSON-Zeilen nach einer benutzerdefinierten Bedingung
 *
 * @param {string} inputFile - Pfad zur Input-NDJSON-Datei
 * @param {string} outputFile - Pfad zur Output-NDJSON-Datei
 * @param {Function} filterFn - Filter-Funktion (obj) => boolean
 * @returns {Promise<{seen: number, kept: number}>} Statistiken
 */
async function filterNDJSON(inputFile, outputFile, filterFn) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: fs.createReadStream(inputFile, 'utf8'),
      crlfDelay: Infinity
    });

    const out = fs.createWriteStream(outputFile, { flags: 'w' });
    let seen = 0;
    let kept = 0;

    rl.on('line', (line) => {
      if (!line.trim()) return;

      try {
        const obj = JSON.parse(line);
        seen++;

        if (filterFn(obj)) {
          out.write(JSON.stringify(obj) + '\n');
          kept++;
        }
      } catch (err) {
        // Ignoriere ungültige JSON-Zeilen
        console.warn(`Warnung: Ungültige JSON-Zeile ignoriert (Zeile ${seen + 1})`);
      }
    });

    rl.on('close', () => {
      out.end();
      resolve({ seen, kept });
    });

    rl.on('error', reject);
    out.on('error', reject);
  });
}

/**
 * Filter: Nur Einträge mit rank === "SPECIES"
 */
function filterSpeciesRank(obj) {
  return obj?.rank === 'SPECIES';
}

/**
 * Filter: Nur Einträge mit status === "ACCEPTED"
 */
function filterAcceptedStatus(obj) {
  const status = obj?.status || obj?.taxonomicStatus;
  return status === 'ACCEPTED';
}

/**
 * Filter: Nur Einträge mit nicht-leeren germanNames
 */
function filterHasGermanNames(obj) {
  const arr = obj?.germanNames;
  return (
    Array.isArray(arr) &&
    arr.some(x => typeof x?.name === 'string' && x.name.trim().length > 0)
  );
}

/**
 * Kombiniert mehrere Filter-Funktionen mit AND-Logik
 *
 * @param {...Function} filters - Beliebig viele Filter-Funktionen
 * @returns {Function} Kombinierte Filter-Funktion
 */
function combineFilters(...filters) {
  return (obj) => filters.every(filter => filter(obj));
}

/**
 * Entfernt bestimmte Felder aus einem Objekt
 *
 * @param {Object} obj - Das Objekt
 * @param {string[]} fields - Array von Feldnamen zum Entfernen
 * @returns {Object} Neues Objekt ohne die angegebenen Felder
 */
function removeFields(obj, fields) {
  const result = { ...obj };
  fields.forEach(field => delete result[field]);
  return result;
}

/**
 * Transformiert NDJSON-Datei (filtert und modifiziert)
 *
 * @param {string} inputFile - Input-NDJSON
 * @param {string} outputFile - Output-NDJSON
 * @param {Object} options - Optionen
 * @param {Function} options.filter - Filter-Funktion (optional)
 * @param {Function} options.transform - Transform-Funktion (optional)
 * @returns {Promise<{seen: number, kept: number}>} Statistiken
 */
async function transformNDJSON(inputFile, outputFile, options = {}) {
  const { filter = () => true, transform = (obj) => obj } = options;

  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: fs.createReadStream(inputFile, 'utf8'),
      crlfDelay: Infinity
    });

    const out = fs.createWriteStream(outputFile, { flags: 'w' });
    let seen = 0;
    let kept = 0;

    rl.on('line', (line) => {
      if (!line.trim()) return;

      try {
        const obj = JSON.parse(line);
        seen++;

        if (filter(obj)) {
          const transformed = transform(obj);
          out.write(JSON.stringify(transformed) + '\n');
          kept++;
        }
      } catch (err) {
        console.warn(`Warnung: Ungültige JSON-Zeile ignoriert (Zeile ${seen + 1})`);
      }
    });

    rl.on('close', () => {
      out.end();
      resolve({ seen, kept });
    });

    rl.on('error', reject);
    out.on('error', reject);
  });
}

/**
 * Zählt Zeilen in NDJSON-Datei
 *
 * @param {string} filePath - Pfad zur NDJSON-Datei
 * @returns {Promise<number>} Anzahl Zeilen
 */
async function countLines(filePath) {
  return new Promise((resolve, reject) => {
    let count = 0;
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath, 'utf8'),
      crlfDelay: Infinity
    });

    rl.on('line', () => count++);
    rl.on('close', () => resolve(count));
    rl.on('error', reject);
  });
}

module.exports = {
  filterNDJSON,
  transformNDJSON,

  // Vordefinierte Filter
  filterSpeciesRank,
  filterAcceptedStatus,
  filterHasGermanNames,
  combineFilters,

  // Utilities
  removeFields,
  countLines,
};
