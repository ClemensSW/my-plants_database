'use strict';
/**
 * DIE Normalisierungsregel der Pflanzensuche.
 *
 * 🔴 Diese Regel existiert an zwei Orten und MUSS identisch bleiben:
 *   - hier, beim Bauen der `searchTerms` (Schritt 6)
 *   - in der App, beim Normalisieren der **Eingabe** (`myplants-app/src/catalog/`)
 * Laufen sie auseinander, findet die Suche stillschweigend weniger — ohne Fehlermeldung.
 *
 * ## Das Problem, das sie löst
 *
 * Heute steht je Pflanze ein Name in der Datenbank, und die Suche vergleicht Teilzeichenketten in
 * Kleinschreibung. Damit findet „Hänge-Birke" nur, wer exakt so tippt:
 *
 *   Hängebirke · Hänge Birke · Hänge-Birke · Haengebirke · Hangebirke
 *
 * Fünf Schreibweisen desselben Namens — und ein Azubi tippt irgendeine davon.
 *
 * ## Die Regel
 *
 * 1. Kleinschreibung
 * 2. Deutsche Umlaute **ausschreiben**: ä→ae, ö→oe, ü→ue, ß→ss
 * 3. Alle übrigen Diakritika falten (é→e, ë→e) — botanische Namen schreiben `Hippophaë` und
 *    `Hippophae` für dieselbe Art
 * 4. **Alles Nicht-Alphanumerische entfernen** — Bindestriche, Leerzeichen, Punkte, `×`
 *
 * Damit fallen alle fünf Schreibweisen oben auf denselben Schlüssel `haengebirke`.
 *
 * ## Warum zwei Varianten je Name
 *
 * Regel 2 erzeugt `haengebirke`. Wer aber „Hangebirke" ohne Umlaut tippt, träfe das nicht.
 * Deshalb wird zusätzlich die **gefaltete** Variante erzeugt (ä→a): `hangebirke`.
 * Beide werden gespeichert, die Eingabe wird gegen beide geprüft.
 */

/** Umlaute ausschreiben — die deutsche Konvention (ae/oe/ue/ss). */
function expandUmlauts(value) {
  return String(value)
    .replace(/ä/g, 'ae').replace(/Ä/g, 'Ae')
    .replace(/ö/g, 'oe').replace(/Ö/g, 'Oe')
    .replace(/ü/g, 'ue').replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss');
}

/** Übrige Diakritika entfernen: é→e, ë→e, ñ→n. */
function stripDiacritics(value) {
  return String(value).normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Nur Buchstaben und Ziffern behalten. */
function squash(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Beide Suchvarianten eines Namens.
 *   „Hänge-Birke" → ['haengebirke', 'hangebirke']
 *   „Betula pendula" → ['betulapendula']   (identisch, einmal)
 */
function searchVariants(name) {
  const raw = String(name || '').trim();
  if (!raw) return [];
  const expanded = squash(stripDiacritics(expandUmlauts(raw)));
  // In der gefalteten Variante werden Umlaute zum Grundbuchstaben (ä→a). Für ß gibt es keinen —
  // `ss` ist die einzige sinnvolle Abbildung. Ohne diese Zeile fiele das ß ersatzlos weg und
  // „Weißbirke" ergäbe `weibirke`.
  const folded = squash(stripDiacritics(raw.replace(/ß/g, 'ss')));
  const out = [];
  if (expanded) out.push(expanded);
  if (folded && folded !== expanded) out.push(folded);
  return out;
}

/**
 * Die Suchbegriffe einer Pflanze: alle Namen und Synonyme, beide Varianten, ohne Dubletten.
 * Reihenfolge bleibt erhalten — der bevorzugte Name steht vorn.
 */
function buildSearchTerms(names) {
  const seen = new Set();
  const out = [];
  for (const name of names) {
    for (const variant of searchVariants(name)) {
      if (seen.has(variant)) continue;
      seen.add(variant);
      out.push(variant);
    }
  }
  return out;
}

/** Die Eingabe des Nutzers, gegen `searchTerms` zu prüfen. Gibt beide Varianten zurück. */
function normalizeQuery(query) {
  return searchVariants(query);
}

module.exports = { expandUmlauts, stripDiacritics, squash, searchVariants, buildSearchTerms, normalizeQuery };
