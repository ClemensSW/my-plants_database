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
  for (const teil of teile.slice(1)) {
    // Das Hybridzeichen kommt freistehend (`Platanus × hispanica`) und angehängt (`Rosa ×alba`)
    // vor und ist in beiden Formen kein Autor.
    if (teil === '×' || teil === 'x') {
      behalten.push(teil);
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

module.exports = { stripAuthorship, istBrauchbarerName };
