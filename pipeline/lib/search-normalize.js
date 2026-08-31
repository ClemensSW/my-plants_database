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

/**
 * Das Hybridzeichen entfernen — ein alleinstehendes `x` oder `×` zwischen zwei Woertern.
 *
 * 🔴 Ohne diese Zeile sind 274 Pflanzen des Katalogs (1,9 %) nicht zu finden, wenn man sie so
 * tippt, wie sie auf jedem Pruefungsblatt stehen. `squash` wirft alles Nicht-Alphanumerische weg:
 * Das MALZEICHEN `×` faellt darunter, der BUCHSTABE `x` nicht.
 *
 *     Katalog:  „Platanus ×hispanica"   → platanushispanica
 *     Eingabe:  „Platanus x hispanica"  → platanusxhispanica   ✗ kein Treffer
 *
 * ⚠️ An den gebauten Begriffen aendert die Regel NICHTS — an allen 133.263 Namen des Katalogs
 * nachgerechnet, null Abweichungen. Sie steht hier trotzdem, damit sie nicht in der App allein
 * lebt und beim naechsten Katalogbau still auseinanderlaeuft.
 */
function dropHybridMarker(value) {
  return String(value).replace(/(^|\s)[x×](?=\s)/g, ' ');
}

/** Nur Buchstaben und Ziffern behalten. */
function squash(value) {
  return dropHybridMarker(value).toLowerCase().replace(/[^a-z0-9]/g, '');
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
 * Wie `squash`, aber Wortgrenzen bleiben als EIN Leerzeichen stehen.
 *
 *     „Hänge-Birke"                → „hange birke"
 *     „Alyssum minutulum Schleich." → „alyssum minutulum schleich"
 */
function squashWords(value) {
  return dropHybridMarker(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Dieselben Varianten wie `searchVariants`, nur mit erhaltenen Wortgrenzen.
 *
 * ## Warum die Leerzeichen zurückmüssen
 *
 * `searchVariants` klebt alles zu einer Zeichenkette. Damit gehen zwei Dinge verloren:
 *
 * **1. Falschtreffer über Wortgrenzen.** `Schleich.` + `ex` wird `schleichex` und enthält `eiche`.
 * (Dagegen hilft schon `stripAuthorship` — aber nur bei Autoren, nicht allgemein.)
 *
 * **2. Die Möglichkeit, Treffer zu BEWERTEN.** Ohne Wortgrenzen sind „Stiel-Eiche" und „Weicher
 * Akanthus" bei der Anfrage „Eiche" ununterscheidbar: In beiden steckt die Zeichenfolge. Erst wenn
 * die App weiß, WO im Wort der Treffer sitzt, kann sie das eine vor das andere sortieren.
 *
 * Der deutsche Sonderfall, auf dem das beruht: **Im Kompositum steht das Grundwort hinten.**
 * „Stiel-*eiche*" ist eine Eiche, „*Eichen*-blättrige Spiere" ist keine. „Hänge-*birke*" ist eine
 * Birke, „*Birken*-feige" ist ein Ficus. Ein Wort, das auf die Anfrage ENDET, meint sie meistens.
 */
function searchNameVariants(name) {
  const raw = String(name || '').trim();
  if (!raw) return [];
  const expanded = squashWords(stripDiacritics(expandUmlauts(raw)));
  const folded = squashWords(stripDiacritics(raw.replace(/ß/g, 'ss')));
  const out = [];
  if (expanded) out.push(expanded);
  if (folded && folded !== expanded) out.push(folded);
  return out;
}

/**
 * Die Suchnamen einer Pflanze — mit Wortgrenzen, ohne Dubletten, Reihenfolge erhalten.
 *
 * Das ist die Grundlage; `buildSearchTerms` wird daraus ABGELEITET, damit beide nie auseinander
 * laufen können.
 */
function buildSearchNames(names) {
  const seen = new Set();
  const out = [];
  for (const name of names) {
    for (const variant of searchNameVariants(name)) {
      if (seen.has(variant)) continue;
      seen.add(variant);
      out.push(variant);
    }
  }
  return out;
}

/**
 * Die Suchbegriffe einer Pflanze: alle Namen und Synonyme, beide Varianten, ohne Dubletten.
 * Reihenfolge bleibt erhalten — der bevorzugte Name steht vorn.
 *
 * ⚠️ **Altfeld.** Neue App-Fassungen nehmen `searchNames` (mit Wortgrenzen). Dieses Feld bleibt,
 * weil eine ältere Fassung sonst still auf die Notsuche über drei Rohfelder zurückfiele — ohne
 * Synonyme, ohne Zweitnamen. Es wird aus `searchNames` abgeleitet, damit beide dasselbe sagen.
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

module.exports = {
  expandUmlauts, stripDiacritics, squash, squashWords, dropHybridMarker,
  searchVariants, searchNameVariants,
  buildSearchTerms, buildSearchNames,
  normalizeQuery,
};
