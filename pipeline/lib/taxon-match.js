'use strict';
/**
 * Namensabgleich Katalog ↔ Zeigerwert-Datensatz.
 *
 * Die Regeln stammen aus `myplants-backend/scripts/lib/taxon-match.js` und sind dort über zwei
 * Skripte (Analyse + Seed) gemeinsam benutzt und belegt worden. Übernommen sind **nur die reinen
 * Regeln** — der GBIF-Netzteil fehlt hier bewusst:
 *
 *   Das Backend musste GBIF nach Synonymen fragen, weil es keine hatte. Wir haben sie inzwischen
 *   im Datensatz: `plantnet_species_detail.ndjson` führt je Art die botanischen Synonyme mit.
 *   Damit wird aus einem Lauf mit tausenden Netzabfragen ein reiner Dateijoin — schneller,
 *   wiederholbar und ohne fremde Verfügbarkeit.
 *
 * Die drei Schutzstufen sind unverändert. Sie sind der Grund, warum der Abgleich keine
 * Verwechslungen produziert:
 *   1. Nur echte zweiteilige Binomen. Ein infraspezifisches Synonym („genus species varietas")
 *      wird nie auf „genus species" gekürzt — das träfe eine fremde akzeptierte Art.
 *   2. Das Artepitheton muss erhalten bleiben. Ein Synonym, das es behält, ist eine
 *      nomenklatorische Gattungsverschiebung (dasselbe Taxon); eines, das es ändert, ist eine
 *      taxonomische Zusammenlegung (Picea glauca ↔ Picea abies) — also eine andere Pflanze.
 *   3. Alle verbliebenen Treffer müssen übereinstimmen. Verschiedene Wertesätze heißen: die
 *      Quellen sind sich über die Taxongrenze uneins → überspringen.
 *
 * Jeder Fehlschlag gibt `null`. **Überspringen, niemals raten.**
 */

const normalize = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Latein ohne Diakritika. Euro+Med schreibt `hippophaë rhamnoides`, GBIF schreibt es plain —
 * Diakritika unterscheiden in der botanischen Nomenklatur nie zwei Arten.
 */
const fold = (value) => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '');

const binomial = (value) => normalize(value).split(' ').slice(0, 2).join(' ');

const isBinomial = (value) => !!value && value.split(' ').length === 2;

/** Epitheton ohne lateinische Genusendung: germanicus = germanicum, arundinaceum = arundinacea. */
const epithetStem = (binom) => (binom.split(' ')[1] || '').replace(/(us|um|a|is|e|os)$/, '');

/** Beide Schreibweisen eines Namens, gefaltet zuerst — der Slim führt in der Regel beide. */
const lookupKeys = (name) => {
  const key = binomial(name);
  const plain = fold(key);
  return plain === key ? [key] : [key, plain];
};

/** Schlägt einen Namen im Slim nach, mit und ohne Diakritika. */
function lookup(slim, name) {
  for (const key of lookupKeys(name)) {
    if (slim[key]) return slim[key];
  }
  return undefined;
}

/** Wendet die drei Schutzstufen auf eine Kandidatenliste an. */
function entryFromCandidates(candidates, slim, plantStem) {
  const hits = [];
  for (const name of candidates) {
    const binom = binomial(name);
    if (!isBinomial(binom)) continue;
    const entry = lookup(slim, binom);
    if (!entry) continue;
    if (epithetStem(binom) !== plantStem) continue;
    hits.push(entry);
  }
  if (hits.length === 0) return null;
  const first = JSON.stringify(hits[0]);
  if (hits.some((h) => JSON.stringify(h) !== first)) return null;
  return hits[0];
}

module.exports = {
  normalize, fold, binomial, isBinomial, epithetStem, lookupKeys, lookup, entryFromCandidates,
};
