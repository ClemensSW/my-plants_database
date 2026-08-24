'use strict';

/**
 * Ein botanischer Name ohne die Autorenangabe.
 *
 *     Alyssum minutulum Schleich. ex DC.      ->  Alyssum minutulum
 *     Betula verrucosa Ehrh.                  ->  Betula verrucosa
 *     Mahonia aquifolium (Pursh) Nutt.        ->  Mahonia aquifolium
 *     Platanus × hispanica Mill.              ->  Platanus × hispanica
 *
 * ⚠️ **Kopie von `myplants-backend/src/common/utils/botanical-name.util.ts`.** Dort liegt die
 * maßgebliche Fassung samt Spec; sie kürzt beim AUSLIEFERN für die Handbuchseite. Diese hier kürzt
 * beim BAUEN, und zwar nur für den Suchindex. `nest build` bündelt alles in ein `main.js`, das beim
 * `require` den Server startet — ein Pipeline-Skript kann die TypeScript-Fassung also nicht laden.
 * Wer eine der beiden ändert, ändert die andere mit.
 *
 * ## Warum der Suchindex sie loswerden muss
 *
 * `buildSearchTerms` klebt jeden Namen zu einer Zeichenkette ohne Leerzeichen zusammen. Aus
 *
 *     Alyssum minutulum Schleich. ex DC.
 *
 * wird `alyssumminutulumschleichexdc` — und darin steckt **`eiche`**, weil die Autorenabkürzung
 * `Schleich.` und das `ex` aneinanderstoßen. Am 23.08.2026 gemessen: **58 der 244 Treffer** für
 * „Eiche" entstanden so. Alpen-Hornklee, Bunter Schachtelhalm, Lappland-Weide — Pflanzen ohne
 * jeden Bezug zur Suche.
 *
 * ## Warum nur im Index und nicht in den Daten
 *
 * Die Autorenangabe ist kein Schmutz: Sie gehört zur vollständigen botanischen Zitierung und
 * unterscheidet gleichlautende Namen verschiedener Autoren. Sie bleibt deshalb in `synonyms`
 * stehen. Gekürzt wird nur, was in die Suche geht.
 *
 * ## Die Regel
 *
 * Botanische Epitheta sind kleingeschrieben, Autorennamen groß oder eingeklammert. Also: Die
 * Gattung (das erste Wort) bleibt, danach bleibt alles Kleingeschriebene, und beim ersten
 * großgeschriebenen oder eingeklammerten Wort ist Schluss.
 *
 * Rangkürzel (`subsp.`, `var.`, `f.`) und das Hybridzeichen sind selbst kleingeschrieben und
 * überstehen die Regel von allein. Findet sie keinen Autor, bleibt der Name unverändert — sie kann
 * nichts kaputt machen, was sie nicht versteht.
 */
const stripAuthorship = (name) => {
  const teile = String(name ?? '').trim().split(/\s+/);
  if (teile.length <= 1) return teile.join(' ');

  const behalten = [teile[0]];
  let nachRangmarke = false;
  for (const teil of teile.slice(1)) {
    // Das Hybridzeichen kommt freistehend (`Platanus × hispanica`) und angehängt (`Rosa ×alba`)
    // vor und ist in beiden Formen kein Autor.
    if (teil === '×' || teil === 'x') {
      behalten.push(teil);
      continue;
    }
    /**
     * 🔴 Das Sortenepitheton — und es kommt in VIER Schreibweisen vor.
     *
     * Wikidata benutzt sie durcheinander, gemessen an 2.410 Taxa:
     *
     *     U+2019  ’   1.324×      U+02BD  ʽ   1.137×
     *     U+0027  '     209×      U+2018  ‘     164×
     *
     * Eine Regel, die nur `'` kennt, hält `ʽFastigiata’` für den AUTOR und wirft ihn weg. Aus
     * `Quercus robur ʽFastigiata’` wurde `Quercus robur` — die Säuleneiche stand als gewöhnliche
     * Stieleiche im Katalog, und ebenso 1.395 von 1.397 Sorten. Am Gerät gesehen am 24.08.2026.
     */
    if (/^['‘’ʽʼ`´]/.test(teil) || /['‘’ʽʼ`´]$/.test(teil)) {
      behalten.push(teil);
      // Alles bis zum schliessenden Zeichen gehört dazu: `‘Calebasse Bosc’` sind zwei Wörter.
      if (!/['‘’ʽʼ`´]$/.test(teil) || teil.length === 1) nachRangmarke = false;
      continue;
    }
    /**
     * ⚠️ Nach einer Rangmarke steht IMMER ein Epitheton, auch wenn es grossgeschrieben ist.
     *
     * `Malus domestica var. Opal` — „Opal" ist eine Sorte, die jemand als Varietät eingetragen
     * hat. Ohne diese Ausnahme bricht die Regel dort ab und liefert `Malus domestica var.`:
     * einen Namen, der mit einer Rangmarke ENDET und nichts dahinter hat. Drei Fälle im Bestand,
     * und alle drei standen so in der App.
     */
    if (nachRangmarke) {
      behalten.push(teil);
      nachRangmarke = false;
      continue;
    }
    if (/^(subsp|ssp|var|f|sect|agg|cv|ser|subg)\.$/.test(teil)) {
      behalten.push(teil);
      nachRangmarke = true;
      continue;
    }
    const kern = teil.replace(/^[×x]/, '');
    const istEpitheton = kern.length > 0 && kern === kern.toLowerCase();
    if (!istEpitheton) break;
    behalten.push(teil);
  }
  return behalten.join(' ');
};

/**
 * Ist das überhaupt ein Pflanzenname?
 *
 * Pl@ntNets Trivialnamen sind Gemeinschaftsdaten, und darin liegt Unrat. Am 23.08.2026 im Katalog
 * gefunden — sieben Einträge, die kein Name sind:
 *
 *     Viburnum tinus           „(7;7;€;€disproportionierterem Speicherprozesse… sizilianisches"
 *     Utricularia bremii       „Bremis Wasserschlauch <!-- auch: Zierlicher Wasserschlauch -->"
 *     Asplenium nidus          „Hirschzungenfarn ist Asplenium scolopendrium und kommt auch in …"
 *     Lonicera caerulea        „\"Kamtschatka Heckenkirsche\"   Lonicera caerulea var. 'kamtschatica' !!"
 *
 * Der erste ist Datenmüll oder Vandalismus, die anderen sind Korrekturnotizen und Anmerkungen von
 * Beitragenden, die im Namensfeld gelandet sind. Sie stehen im Handbuch unter „Weitere Namen" und
 * im Suchindex — der Viburnum-Eintrag trifft bei „Eiche", weil `Speicherprozesse` das Muster
 * enthält.
 *
 * Sieben von 40.919 ist kein systemisches Problem. Aber sie zu behalten kostet mehr, als sie
 * wegzuwerfen: Ein einziger sichtbarer Müllname beschädigt das Vertrauen in alle anderen.
 *
 * Bewusst zurückhaltend: Ein echter Trivialname ist kurz, enthält keine Ziffern, keine
 * Auszeichnungszeichen und keine Satzzeichen, die auf einen Satz statt auf einen Namen deuten.
 */
const istBrauchbarerName = (name) => {
  const n = String(name ?? '').trim();
  if (n.length === 0 || n.length > 60) return false;
  if (/\d/.test(n)) return false;
  if (/[<>{}[\]|@€$;"]/.test(n)) return false;
  if (/!!|\.\.\./.test(n)) return false;
  return true;
};

/** Vergleichsform: ohne Akzente, ohne Sonderzeichen, klein. */
const vergleichbar = (s) =>
  String(s ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Das unterscheidende Epitheton: der Sortenname oder das Wort hinter der Rangmarke. */
const eigenesEpitheton = (wissName) => {
  const s = String(wissName ?? '');
  const sorte = /['\u2018\u2019\u02bd\u02bc]([^'\u2018\u2019\u02bd\u02bc]+)['\u2018\u2019\u02bd\u02bc]/.exec(s);
  if (sorte) return sorte[1];
  const rang = /\b(?:subsp|ssp|var|f)\.\s+(\S+)/.exec(s);
  return rang ? rang[1] : null;
};

/** Der Name des Elterntaxons: alles VOR der Rangmarke oder dem Sortennamen. */
const elternName = (wissName) =>
  String(wissName ?? '').split(/\s*(?:\b(?:subsp|ssp|var|f)\.|['\u2018\u2019\u02bd\u02bc])/)[0].trim();

/**
 * Gehoert diese Commons-Kategorie einem ANDEREN Taxon — der Art oder einer Schwester?
 *
 * Wikidatas `P373` zeigt bei manchen Unterarten auf die Kategorie der Art. Deren Bilder zeigen
 * dann nicht die Unterart, sondern die Art — und mehrere Unterarten bekommen dieselben Fotos.
 *
 * Die Regel hat ZWEI Bedingungen, und beide braucht es:
 *
 *   1. Die Kategorie nennt das eigene Epitheton nicht, UND
 *   2. sie beginnt mit dem Namen des Elterntaxons.
 *
 * ⚠️ Ohne Bedingung 2 waere die Regel zu scharf: `Cedrus atlantica ʽGlauca Pendula’ →
 * „Cedre pleureur"` und `Musa acuminata ‘Lacatan’ → „Lakatan banana"` nennen das Epitheton auch
 * nicht — sie tragen einen volkstuemlichen Namen und sind richtig.
 */
const kategorieGehoertFremdem = (wissName, kategorie) => {
  if (!kategorie) return false;
  const epi = eigenesEpitheton(wissName);
  if (!epi) return false;
  const k = vergleichbar(kategorie);
  if (k.includes(vergleichbar(epi))) return false;
  return k.startsWith(vergleichbar(elternName(wissName)));
};

module.exports = { stripAuthorship, istBrauchbarerName, kategorieGehoertFremdem, eigenesEpitheton, elternName };
