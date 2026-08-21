'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { apiGet, pool } = require('./gbif');

/**
 * Pl@ntNets `gbifKey` in einen Schlüssel übersetzen, den GBIFs Backbone heute wirklich führt.
 *
 * ## Das Problem, das dieser Auflöser löst
 *
 * Pl@ntNet liefert zu jeder Art einen `gbifKey`. Der stimmt meistens — aber nicht immer, und wenn
 * er nicht stimmt, passiert nichts Lautes: Die Art wird über den Schlüssel gesucht, nicht gefunden,
 * und fällt still aus dem Katalog.
 *
 * Am 21.08.2026 gemessen, über alle Pl@ntNet-Arten mit deutschem Namen UND Bildern:
 *
 *     12.186 Arten
 *     11.514 Schlüssel passt
 *        672 Schlüssel zeigt ins Leere   ← 5,5 %, darunter Prüfungspflanzen
 *
 * Ein Beispiel: *Cercidiphyllum japonicum* (Japanischer Kuchenbaum, in der AuGaLa-Prüfungsliste)
 * hat 2.364 Bilder, alle `cc-by-sa`, und einen deutschen Namen. Pl@ntNet nennt den Schlüssel
 * 12281377, GBIFs Backbone führt die Art unter 8060423. Die Pflanze war deshalb nicht im Katalog.
 *
 * ## Warum GBIF entscheidet und nicht Pl@ntNet
 *
 * Weil GBIF bei den botanischen Namen aktueller ist. Der Backbone hängt Arten um, wenn die
 * Systematik sich ändert — *Dicentra spectabilis* heisst dort seit Jahren *Lamprocapnos
 * spectabilis*, *Anemone nemorosa* ist *Anemonoides nemorosa*. Pl@ntNets Schlüssel folgen dem
 * verzögert. Wo beide sich widersprechen, gilt GBIF.
 *
 * ## Die Kaskade
 *
 *   1. **direkt** — der `gbifKey` steht in unserer Liste akzeptierter Arten. Fertig, ohne Netz.
 *   2. **name** — der wissenschaftliche Name steht dort. Auch ohne Netz.
 *   3. **match** — GBIFs `species/match` befragen. Liefert es ein Synonym, wird dem
 *      `acceptedUsageKey` gefolgt. Nur dieser Schritt kostet eine Anfrage.
 *   4. **ohne** — nichts gefunden. Wird NICHT verschwiegen, sondern gezählt und in eine eigene
 *      Datei geschrieben.
 *
 * ## Warum das Ergebnis auf Platte liegt
 *
 * `data/work/gbif_key_map.ndjson` ist ein Zwischenspeicher, kein Nebenprodukt. Ein zweiter Lauf
 * fragt nur nach dem, was neu dazugekommen ist — wie die `.done`-Datei der Bilderernte. Dadurch
 * kostet ein Neubau des Katalogs keine einzige Anfrage mehr, solange die Artenliste dieselbe ist.
 */

/** Was am Ende in der Karte steht. `via` sagt, wie der Schlüssel gefunden wurde. */
const VIA = {
  direkt: 'direkt',
  name: 'name',
  match: 'match',
  ohne: 'ohne',
};

const readMap = filePath => {
  const map = new Map();
  if (!fs.existsSync(filePath)) return map;
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      map.set(String(rec.quelle), rec);
    } catch {
      // Eine kaputte Zeile darf den ganzen Zwischenspeicher nicht wertlos machen.
    }
  }
  return map;
};

/**
 * GBIF nach dem heutigen Schlüssel eines Namens fragen.
 *
 * `null` bei allem, was nicht eindeutig ist. Ein unsicherer Treffer wäre schlimmer als keiner: Er
 * hängt die Bilder einer Art an eine andere, und das fällt niemandem auf.
 */
const matchName = async (name, opts) => {
  const res = await apiGet('/species/match', { kingdom: 'Plantae', name }, opts);
  if (!res || res.matchType === 'NONE') return null;
  // FUZZY nur ansehen, wenn GBIF selbst sehr sicher ist — sonst ist es geraten.
  if (res.matchType === 'FUZZY' && (res.confidence ?? 0) < 95) return null;
  const key = res.status === 'SYNONYM' ? res.acceptedUsageKey : res.usageKey;
  return key ? { key, status: res.status, matchType: res.matchType } : null;
};

/**
 * Die Karte aufbauen oder ergänzen.
 *
 * @param kandidaten  `[{ quelle, name }]` — Pl@ntNets Schlüssel und der zugehörige wissenschaftliche Name
 * @param akzeptiert  Set der taxonKeys, die unsere Artenliste führt
 * @param nachName    Map canonicalName → taxonKey aus derselben Liste
 * @returns `{ karte, statistik }`
 */
const resolveKeys = async (kandidaten, akzeptiert, nachName, options = {}) => {
  const {
    mapFile,
    unresolvedFile,
    concurrency = 4,
    log = () => {},
    onProgress = () => {},
  } = options;

  const karte = readMap(mapFile);
  const statistik = { gesamt: kandidaten.length, direkt: 0, name: 0, match: 0, ohne: 0, ausSpeicher: 0 };

  const offen = [];
  for (const k of kandidaten) {
    const quelle = String(k.quelle);

    if (karte.has(quelle)) {
      statistik.ausSpeicher++;
      statistik[karte.get(quelle).via] = (statistik[karte.get(quelle).via] ?? 0) + 1;
      continue;
    }
    if (k.quelle && akzeptiert.has(quelle)) {
      karte.set(quelle, { quelle, ziel: Number(k.quelle), via: VIA.direkt });
      statistik.direkt++;
      continue;
    }
    const perName = nachName.get(k.name);
    if (perName) {
      karte.set(quelle, { quelle, ziel: perName, via: VIA.name });
      statistik.name++;
      continue;
    }
    offen.push(k);
  }

  if (offen.length > 0) {
    log(`GBIF befragen fuer ${offen.length} ungeklaerte Schluessel …`);
    let erledigt = 0;
    await pool(offen, concurrency, async k => {
      const quelle = String(k.quelle);
      let treffer = null;
      try {
        treffer = await matchName(k.name, options);
      } catch {
        // Ein Netzfehler ist kein Ergebnis. Nicht in die Karte schreiben, damit der naechste Lauf
        // es erneut versucht — ein falsches „ohne“ waere dauerhaft.
        erledigt++;
        return;
      }
      // Nur was unsere Artenliste auch fuehrt. GBIF kennt mehr, als wir uebernommen haben.
      if (treffer && akzeptiert.has(String(treffer.key))) {
        karte.set(quelle, { quelle, ziel: treffer.key, via: VIA.match, status: treffer.status });
        statistik.match++;
      } else {
        karte.set(quelle, { quelle, ziel: null, via: VIA.ohne, name: k.name });
        statistik.ohne++;
      }
      erledigt++;
      if (erledigt % 50 === 0) onProgress(erledigt, offen.length);
    });
  }

  if (mapFile) {
    fs.mkdirSync(path.dirname(mapFile), { recursive: true });
    const zeilen = [...karte.values()].map(r => JSON.stringify(r));
    fs.writeFileSync(mapFile, zeilen.join('\n') + (zeilen.length ? '\n' : ''));
  }

  // Die Ungeklärten kommen in eine eigene Datei. Eine Zahl im Log ist vergessen, sobald das
  // Fenster zu ist; eine Datei kann man sich beim nächsten Mal ansehen.
  if (unresolvedFile) {
    const ohne = [...karte.values()].filter(r => r.via === VIA.ohne);
    fs.mkdirSync(path.dirname(unresolvedFile), { recursive: true });
    fs.writeFileSync(unresolvedFile, ohne.map(r => JSON.stringify(r)).join('\n') + (ohne.length ? '\n' : ''));
  }

  return { karte, statistik };
};

/** Nur die brauchbaren Übersetzungen: Pl@ntNet-Schlüssel → GBIF-Schlüssel. */
const toLookup = karte => {
  const lookup = new Map();
  for (const rec of karte.values()) {
    if (rec.ziel) lookup.set(String(rec.quelle), Number(rec.ziel));
  }
  return lookup;
};

/** Die Karte von der Platte lesen, ohne etwas aufzulösen — für Schritte, die nur übersetzen. */
const loadLookup = mapFile => toLookup(readMap(mapFile));

module.exports = { resolveKeys, toLookup, loadLookup, matchName, VIA };
