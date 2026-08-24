'use strict';

/**
 * Das Organ aus einem Commons-Dateinamen — **streng**, oder gar nicht.
 *
 * ## Warum diese Regel so eng ist
 *
 * Die naive Fassung (ein mehrsprachiges Organlexikon, Wortgrenzen, mehrdeutige verwerfen) traf
 * **17 %** von 536 Dateinamen. Die Sichtprüfung an den zugewiesenen Bildern zeigte, warum das
 * nichts wert ist:
 *
 *     …icicles from freezing rain on the flower buds of a Kanzan Cherry  → „flower"
 *        Das Bild zeigt einen KAHLEN WINTERBAUM.
 *     Sunburst Honey Locust leafing out with developing flowers          → „flower"
 *        Das Bild zeigt BLÄTTER.
 *     New foliage covered by a late spring wet snow                      → „leaf"
 *        Das Bild zeigt einen VERSCHNEITEN BAUM mit Autos im Hintergrund.
 *
 * 🔴 **Der Fehlermodus ist der beschreibende Satz.** Wo der Dateiname erzählt, was an dem Tag los
 * war, steht das Organwort im Nebensatz und meint nicht das Motiv. Wo der Name STRUKTURIERT ist —
 * `Taxon – Organ` — trifft er.
 *
 * Mit den fünf Sperren unten bleiben **2 %** übrig. Wenig, aber jedes davon stimmt; drei wurden am
 * Bild gegengeprüft (`Catalpa bignonioides "Nana" - feuilles` → Blatt, `Einzelne Blüte Kerria
 * japonica` → Blüte, `Kanzan Cherry Tree` → Habitus).
 *
 * ⚠️ Was hier herauskommt, wird als `organQuelle: 'dateiname'` vermerkt. Wer später wissen will,
 * welche Organe abgeleitet und welche geliefert wurden, filtert danach. Alles Übrige bekommt
 * `organ: 'unknown'` — **nicht** `other`: `other` wäre die Aussage „kein Blatt, keine Blüte",
 * und die App zeigt dafür einen Chip, der Zweige und Belege verspricht.
 */

/** Mehrsprachig, weil Commons es ist: `- feuilles` ist französisch, nicht englisch. */
const LEXIKON = {
  flower: ['flower', 'flowers', 'bloom', 'blossom', 'blossoms', 'inflorescence',
    'blüte', 'blüten', 'bluete', 'blueten', 'fleur', 'fleurs', 'floraison',
    'flor', 'flores', 'fiore', 'fiori', 'kwiat', 'kwiaty', 'virág'],
  leaf: ['leaf', 'leaves', 'foliage', 'blatt', 'blätter', 'blaetter', 'laub', 'laubblatt',
    'feuille', 'feuilles', 'feuillage', 'hoja', 'hojas', 'foglia', 'foglie',
    'liść', 'liście', 'liscie', 'levél'],
  fruit: ['fruit', 'fruits', 'seed', 'seeds', 'cone', 'cones', 'berry', 'berries', 'capsule',
    'frucht', 'früchte', 'fruechte', 'zapfen', 'samen', 'beere', 'beeren', 'fruchtstand',
    'fruto', 'frutos', 'frutto', 'frutti', 'owoc', 'owoce', 'termés'],
  bark: ['bark', 'trunk', 'écorce', 'ecorce', 'tronc', 'rinde', 'borke', 'stamm',
    'corteza', 'corteccia', 'kora', 'pień'],
  habit: ['habit', 'habitus', 'tree', 'shrub', 'baum', 'strauch', 'arbre', 'arbuste',
    'árbol', 'arbol', 'albero', 'drzewo', 'krzew', 'ganzer', 'whole'],
};

/**
 * Wörter, die wie ein Organ aussehen und keins sind — oder zu mehrdeutig, um zu tragen.
 *
 * `plant`/`Pflanze` sagt nichts. `form` ist ein Rang. `port` ist französisch für Habitus UND ein
 * Hafen. `Knospe`, `Zweig`, `branch` haben bei uns kein eigenes Organ (Pl@ntNet fasst sie zu
 * `other` zusammen), also wäre jede Zuordnung geraten. Jahreszeiten sind kein Organ.
 */
const NICHT_VERWENDEN = new Set([
  'plant', 'plants', 'pflanze', 'form', 'port', 'fa', 'blad', 'bast', 'bud', 'buds', 'knospe',
  'winter', 'autumn', 'herbst', 'spring', 'summer', 'fall', 'stem', 'branch', 'branches',
  'twig', 'zweig', 'ast', 'rameau',
]);

const WORT = new Map();
for (const [organ, woerter] of Object.entries(LEXIKON)) {
  for (const w of woerter) if (!NICHT_VERWENDEN.has(w)) WORT.set(w, organ);
}

/**
 * Kein Pflanzenfoto, sondern ein Druck, ein Beleg, eine Karte oder eine Briefmarke.
 *
 * 🔴 Diese Liste entscheidet nicht nur ueber das Organ, sondern ueber die AUFNAHME: Eine
 * Commons-Kategorie enthaelt auch botanische Tafeln aus dem 19. Jahrhundert, Verbreitungskarten
 * und Wappen. Ohne den Filter zeigte die Kachel der Saeuleneiche ein **Wappen** — am 24.08.2026
 * an der echten Karte gesehen.
 *
 * ⚠️ Was hier NICHT stehen darf, obwohl es verlockend ist:
 *
 *     crest     steckt im Sortennamen 'Goldcrest'
 *     grave     eine Zypresse auf einem Friedhof ist ein Pflanzenfoto
 *     sign      Wegweiser und Pflanzenschilder sind nicht zu trennen
 *     monument  „National Monument" ist eine Landschaft, in der die Pflanze steht
 *
 * Gemessen an 30.866 Bildern: 742 verworfen (2,4 %).
 */
const KEIN_FOTO =
  /\b(coat[_ ]of[_ ]arms|wappen|blason|escudo|stemma|flag|flagge|drapeau|catalogue|catalog|katalog|plate|tafel|herbarium|specimen|illustration|abbildung|drawing|engraving|zeichnung|gravure|lithograph|woodcut|range[_ ]map|map|karte|mapa|distribution|diagram|schema|logo|stamp|briefmarke|banknote|coin|BHL\d+|page[_ ]\d+)\b/i;

/** Ist das ueberhaupt ein Pflanzenfoto? Entscheidet ueber die Aufnahme, nicht nur ueber das Organ. */
const istPflanzenfoto = (dateiname) => !KEIN_FOTO.test(String(dateiname || ''));

/**
 * 🔴 Die wichtigste Sperre: Umstandsbeschreibungen.
 *
 * Wetter, Ort, Ereignis. Wo eines dieser Wörter steht, erzählt der Name eine Geschichte, und das
 * Organwort darin meint nicht das Motiv.
 */
const UMSTAND =
  /\b(snow|ice|icicle|icicles|frost|freezing|rain|storm|wind|damage|damaged|covered|glaze|schnee|eis|regen|sturm|neige|along|near|street|road|avenue|park|garden|arboretum|cemetery|friedhof|jardin|ogród|strasse|straße)\b/i;

/** Technisches Rauschen: Datum, Zähler, Kamerakürzel, Fotografensignatur. */
const RAUSCHEN =
  /^(\d+|[a-z]{1,3}\d{1,3}|dsc|img|p\d+|by|von|de|the|a|an|and|und|in|at|on|of|mit|with|zz|kz)$/i;

/**
 * @param {string} dateiname   z. B. `Catalpa bignonioides "Nana" - feuilles.JPG`
 * @param {string} wissName    der botanische Name des Taxons
 * @param {number} maxFreieWoerter  Ab wie vielen freien Wörtern der Name ein SATZ ist
 * @returns {{ organ: string|null, grund: string }}
 */
function organAusDateiname(dateiname, wissName, maxFreieWoerter = 4) {
  const stamm = String(dateiname || '').replace(/\.(jpe?g|png|tiff?|gif|webp|svg)$/i, '');
  if (KEIN_FOTO.test(stamm)) return { organ: null, grund: 'kein Pflanzenfoto' };
  if (UMSTAND.test(stamm)) return { organ: null, grund: 'Umstandsbeschreibung' };

  const klein = stamm.toLowerCase();
  // Der Taxonname MUSS im Dateinamen stehen — sonst ist es ein Orts- oder Ereignisname, der
  // zufällig ein Organwort enthält.
  const taxonWoerter = String(wissName || '')
    .replace(/['‘’ʽ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3);
  if (!taxonWoerter.some((t) => klein.includes(t.toLowerCase()))) {
    return { organ: null, grund: 'Taxon nicht im Dateinamen' };
  }

  const woerter = klein.match(/[\wÀ-ÿ]+/g) || [];
  const treffer = new Set();
  for (const w of woerter) if (WORT.has(w)) treffer.add(WORT.get(w));
  if (treffer.size === 0) return { organ: null, grund: 'kein Organwort' };
  if (treffer.size > 1) return { organ: null, grund: `mehrdeutig (${[...treffer].join('/')})` };

  // Der Name muss STRUKTURIERT sein, nicht erzählend.
  const rest = woerter.filter(
    (w) =>
      !WORT.has(w) &&
      !RAUSCHEN.test(w) &&
      !taxonWoerter.some((t) => w.includes(t.toLowerCase()) || t.toLowerCase().includes(w)),
  );
  if (rest.length > maxFreieWoerter) {
    return { organ: null, grund: `erzaehlender Name (${rest.length} freie Woerter)` };
  }
  return { organ: [...treffer][0], grund: 'eindeutig' };
}

module.exports = { organAusDateiname, istPflanzenfoto, LEXIKON, NICHT_VERWENDEN };
