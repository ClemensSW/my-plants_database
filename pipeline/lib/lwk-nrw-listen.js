'use strict';

/**
 * Die Prüfungspflanzenlisten der Landwirtschaftskammer Nordrhein-Westfalen lesen.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * VIER BAUARTEN IN SECHS DATEIEN
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Die sechs Listen stammen von einem Herausgeber, sind aber über dreissig Jahre gewachsen (die
 * älteste Auflage von 1976) und nach vier verschiedenen Mustern gesetzt. Ein gemeinsamer Parser
 * wäre eine Kette von Sonderfällen; vier kleine sind ehrlicher.
 *
 *   A  Gattungsblock   Baumschule · Friedhofsgärtnerei · Zierpflanzenbau
 *   B  Dreizeiler      Staudengärtnerei
 *   C  Einzeiler       Gemüsebau
 *   D  Deutsch zuerst  Obstbau
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 🔴 DIE BETONUNGSZEICHEN
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Drei der Listen schreiben `Ábies`, `álba`, `campéstre`. Das sind KEINE Namensbestandteile,
 * sondern eine Lesehilfe — die Listen erklären sie selbst unter „2. Betonungszeichen". Wer sie
 * stehen lässt, sucht im Katalog nach `Ácer campéstre` und findet nichts.
 *
 * ⚠️ Sie lassen sich nicht mit der üblichen Akzentfaltung entfernen: `NFKD` würde auch das `ß`
 * und die Umlaute der deutschen Namen anfassen. Deshalb greift die Faltung hier NUR auf den
 * botanischen Namen zu.
 */

/** Betonungszeichen entfernen — nur die fünf, die als Lesehilfe vorkommen. */
const entferneBetonung = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[́̀]/g, '') // Akut und Gravis
    .normalize('NFC');

/** Die vier Anführungsvarianten der Listen auf eine bringen. */
const einheitlicheHochkommata = (s) =>
  String(s ?? '').replace(/[‘’ʽʼ`´]/g, "'");

/**
 * Ein Autorenkürzel hinter dem botanischen Namen abtrennen.
 *
 * 🔴 `- julianae, Schneid, Großblättrige Berberitze` — zwischen Epitheton und deutschem Namen
 * steht der AUTOR. Wer am ersten Komma trennt, bekommt „Schneid, Großblättrige Berberitze" als
 * deutschen Namen; wer am letzten trennt, verliert deutsche Namen, die selbst ein Komma tragen
 * („Sand-, Weiß- oder Warzen-Birke").
 *
 * Die Regel: Ein EINZELNES grossgeschriebenes Wort, das wie eine Abkürzung aussieht (kurz, ohne
 * Bindestrich, gefolgt von einem weiteren Komma), ist der Autor.
 */
const trenneAutor = (rest) => {
  const m = /^([A-ZÄÖÜ][a-zäöüß.]{1,9})\.?,\s*(.+)$/.exec(rest);
  if (!m) return { autor: null, deutsch: rest };
  // Ein deutscher Name mit Bindestrich oder Leerzeichen im ersten Wort ist kein Autor.
  if (/[-\s]/.test(m[1])) return { autor: null, deutsch: rest };
  return { autor: m[1], deutsch: m[2] };
};

/**
 * Seitenvorschubzeichen entfernen.
 *
 * 🔴 `pdftotext` setzt U+000C an den Anfang der ersten Zeile jeder Seite — aus `Birnbaum` wird
 * `\f\fBirnbaum`, und kein Ausdruck über `[A-ZÄÖÜ]` trifft das noch. Im Obstbau fielen dadurch
 * VIER der elf Obstarten heraus, und zwar ausgerechnet die, die oben auf einer Seite stehen —
 * ein Verlust, der nach einem Inhaltsproblem aussieht und keines ist.
 */
const ohneSeitenvorschub = (s) => String(s ?? '').replace(/\f/g, '');

const saeubere = (s) => String(s ?? '').replace(/\s+/g, ' ').replace(/\s+'/g, " '").trim();

/**
 * Klammerzusätze aus dem botanischen Namen entfernen.
 *
 * Die Listen führen dort Synonyme (`(syn. A. nobilis 'Glauca')`) und Hinweise. Sie gehören nicht
 * in den Namen, mit dem im Katalog gesucht wird — und ein Name mit Klammer findet dort nichts.
 */
const ohneKlammern = (s) => saeubere(String(s ?? '').replace(/\([^)]*\)/g, ' '));

/**
 * `in Sorten` ist ein Platzhalter, kein Namensbestandteil.
 *
 * 🔴 Dieselbe Sache wie `'Sorte'` auf dem AuGaLa-Blatt (siehe `exam-liste.js`): Gemeint ist „eine
 * beliebige Sorte dieser Art", nicht eine bestimmte. Wer es im Namen stehen lässt, sucht im
 * Katalog nach `Ageratum houstonianum in Sorten` und findet nichts.
 */
const ohneSortenPlatzhalter = (s) =>
  saeubere(String(s ?? '').replace(/\s+in\s+Sorten\b.*$/i, ''));

/**
 * BAUART A — Gattungsblock.
 *
 *     1. LAUBGEHÖLZE                             ← Abschnitt
 *     Ácer - Ahorn, Aceráceae                    ← Gattung eröffnet den Block
 *           - campéstre, Feld-Ahorn              ← Art, erbt die Gattung
 *           - platanoídes ‘Globosum’, Kugel-Ahorn ← Art mit Sorte
 *     ZP    - péndula, Sand-, Weiß- oder Warzen-Birke
 *           - - ‘Columnáris’, Lawsons-Scheinzypresse ← Sorte der VORIGEN Art
 *
 * ⚠️ Der deutsche Name kann in der nächsten Zeile weiterlaufen (`ZP - péndula ‘Yoúngii’,` und
 * darunter eingerückt der Name). Solche Fortsetzungszeilen tragen kein `-` und beginnen tief
 * eingerückt — sie werden an den letzten Eintrag angehängt.
 */
/**
 * Ein Datensatz aus mehreren Zeilen zusammensetzen.
 *
 * 🔴 Die Listen brechen einen Eintrag um, wo die Spalte zu Ende ist — nicht, wo der Eintrag zu
 * Ende ist:
 *
 *     ZP    - pendula ‘Youngii’,
 *              Hängeform der Sand-Birke/Hänge-Birke
 *
 * Zeilenweise gelesen ist die erste Zeile ein Name ohne deutsche Bezeichnung und die zweite
 * Beiwerk. Erst zusammengesetzt ergibt sich der Eintrag. 32 der 120 Ausfälle waren genau das.
 *
 * Ein Datensatz beginnt bei einem `-` (mit den Marken davor) und läuft, bis der nächste beginnt,
 * eine neue Gattung anfängt oder ein Abschnitt wechselt.
 */
function baueDatensaetze(zeilen, { istAbschnitt, istGattung, istRauschen, endeBei }) {
  const saetze = [];
  let offen = null;
  const schliessen = () => { if (offen) { saetze.push(offen); offen = null; } };

  for (const z of zeilen) {
    /*
     * Der Anhang ist keine Pflanzenliste. Die Baumschulliste hängt hinter die Pflanzen die
     * „Gütebestimmungen" — und die sind ebenfalls in Strichlisten gesetzt (`- Anzuchtform,`,
     * `- Stammbildner,`). Ohne diese Grenze werden Qualitätsmerkmale zu Prüfungspflanzen.
     */
    // ⚠️ Erst, wenn die Liste begonnen hat: „Gütebestimmungen" steht auch im Inhaltsverzeichnis
    // auf Seite 1, und dort abzubrechen liefert null Einträge.
    if (endeBei && saetze.some((x) => x.art === 'eintrag') && endeBei.test(z)) break;
    if (!z.trim() || istRauschen(z)) continue;

    const abschnitt = istAbschnitt(z);
    if (abschnitt) { schliessen(); saetze.push({ art: 'abschnitt', wert: abschnitt }); continue; }

    /*
     * 🔴 JEDE nummerierte Überschrift beendet einen offenen Datensatz — auch eine, die kein
     * bekannter Abschnitt ist.
     *
     * Die Friedhofsliste gliedert die Rhododendren in `2.2 Kleinblumige Sorten z.B.:`. Solche
     * Zeilen sind keine Kategorie, aber sie sind eine Grenze. Ohne diese Regel hängte sich die
     * Überschrift an den Eintrag davor, und die Sorte darunter fand ihre Basis nicht mehr —
     * drei Rhododendron-Sorten fielen so heraus.
     */
    if (/^\s*(?:ZP|Zp|\+|\s)*\d+(\.\d+)*\.?\s+\S/.test(z) && !/-/.test(z.split(/\s+/)[0] || '')) { schliessen(); continue; }

    const gattung = istGattung(z);
    if (gattung) { schliessen(); saetze.push({ art: 'gattung', wert: gattung }); continue; }

    /*
     * 🔴 Die Striche stehen NICHT immer beieinander: Die Baumschulliste schreibt `- -`, die
     * Friedhofsliste `-  -` mit Leerzeichen. Wer nur `-+` zählt, sieht dort EINEN Strich, hält
     * die Sorte für eine Art und findet für sie keine Basis. 89 Ausfälle waren genau das.
     */
    const beginn = /^\s*((?:ZP|Zp|\+|[A-Z]\b|\s)*)((?:-\s*)+)(\S.*)$/.exec(z);
    if (beginn) {
      schliessen();
      offen = {
        art: 'eintrag',
        marken: beginn[1] || '',
        ebene: (beginn[2].match(/-/g) || []).length,
        text: beginn[3].trim(),
      };
      continue;
    }

    /*
     * 🔴 Ein Eintrag muss NICHT mit einem Strich beginnen.
     *
     * Die Friedhofsliste setzt innerhalb eines Gattungsblocks auch volle Namen frei:
     * `Rhododendron-Hybride ‘Beethoven’`, `Rhododendron mölle ssp. mölle in Sorten`. Die Striche
     * darunter beziehen sich dann auf DIESE Zeile. Wer sie als Fortsetzung liest, verliert nicht
     * nur sie, sondern auch jede Sorte, die auf ihr aufbaut.
     *
     * Erkennbar am selben Merkmal wie überall: grossgeschriebenes erstes Wort, danach ein
     * kleingeschriebenes, ein Hybridzeichen oder ein Anführungsstrich.
     */
    /*
     * ⚠️ Nicht, solange eine Klammer offen steht. Die Listen brechen mitten in einem Synonym um:
     *
     *     Rhododendron molle ssp. molle in Sorten (syn.
     *     Azalea mollis), Chines. Azalee
     *
     * Die zweite Zeile beginnt gross und hat ein kleines Wort dahinter — sie sähe aus wie ein
     * eigener Eintrag und riss den deutschen Namen vom ersten ab.
     */
    const klammerOffen = offen && (offen.text.split('(').length > offen.text.split(')').length);
    const frei = klammerOffen
      ? null
      : /^\s*(?:ZP|Zp|\+|\s)*([A-ZÄÖÜ][A-Za-zäöüß-]{2,})\s+(['‘’][^'‘’]|x\b|×|[a-zäöüß][a-zäöüß-]*(?:\b|$))/.exec(z);
    /*
     * ⚠️ Eine deutsche Abkürzung ist kein Artepitheton. `Garten-Goldglöckchen bzw. - Forsythie`
     * sieht aus wie „Gattung + kleingeschriebenes Wort" — es ist aber die Fortsetzung eines
     * deutschen Namens. Rangmarken (`ssp.`, `var.`) enden ebenfalls auf einem Punkt und müssen
     * bleiben; alles andere mit Punkt ist Text.
     */
    const zweites = frei ? (z.trim().split(/\s+/)[1] || '') : '';
    if (frei && /\.$/.test(zweites) && !RANGMARKEN.has(zweites.toLowerCase())) {
      if (offen) { offen.text = `${offen.text} ${z.trim()}`.replace(/\s+/g, ' '); continue; }
    }
    if (frei) {
      schliessen();
      offen = { art: 'eintrag', marken: /ZP|Zp/.test(z.slice(0, z.indexOf(frei[1]))) ? 'ZP' : '', ebene: 1, text: z.replace(/^\s*(?:ZP|Zp|\+|\s)*/, '').trim(), vollerName: true };
      continue;
    }

    /*
     * 🔴 Der Anhang der Friedhofsliste („Schnittgrün und Beiwerk") setzt OHNE Striche:
     *
     *     Abies alba, Weiß-Tanne, Pinaceae
     *          grandis, Große Küsten-Tanne          ← Art derselben Gattung
     *          ‘Ellwoodii’, Lawsons Scheinzypresse  ← Sorte der vorigen Art
     *
     * Die Wiederholung steckt hier in der Einrückung statt in einem Zeichen. 28 Einträge — fast
     * das ganze Kapitel — gingen dadurch verloren.
     *
     * Erkennbar ist es eng genug, um nicht mit Fliesstext zu kollidieren: ein EINZELNES
     * kleingeschriebenes Wort oder ein Sortenname in Anführungsstrichen, gefolgt von einem Komma.
     */
    const fortsetzung = /^\s*(?:ZP|Zp|\+|\s)*((?:[a-zäöüß][a-zäöüß-]+|['‘’][^'‘’]+['‘’])[^,]{0,40}),\s*\S/.exec(z);
    if (fortsetzung && offen && !klammerOffen) {
      schliessen();
      offen = { art: 'eintrag', marken: /ZP|Zp/.test(z) ? 'ZP' : '', ebene: /^['‘’]/.test(fortsetzung[1]) ? 2 : 1, text: z.replace(/^\s*(?:ZP|Zp|\+|\s)*/, '').trim(), einrueckung: true };
      continue;
    }

    // Alles andere ist Fortsetzung — aber nur, solange ein Eintrag offen ist.
    if (offen) offen.text = `${offen.text} ${z.trim()}`.replace(/\s+/g, ' ');
  }
  schliessen();
  return saetze;
}

/**
 * Botanischen und deutschen Namen trennen — nach der Grammatik, die die Liste selbst angibt.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * DIE REGELN STEHEN IM DOKUMENT, NICHT IN EINER VERMUTUNG
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Unter „Schreibweise der Pflanzennamen" erklärt jede Liste ihre eigene Grammatik:
 *
 *   · „Der Gattungsname wird stets mit großem Anfangsbuchstaben geschrieben, der **Artname
 *     klein**."
 *   · „Die Namen der **Sorten** werden stets mit großem Anfangsbuchstaben geschrieben und in
 *     einfache, hochgestellte **Anführungsstriche** gesetzt."
 *   · Varietäten tragen `var.`, Kreuzungen ein `x`.
 *   · „Werden **Gruppen von Hybriden** zusammengefasst, so wird der Artname — abweichend von dem
 *     oben Gesagten — **groß** geschrieben." (`Rhododendron Repens-Gruppe`, `Clematis-Hybriden`,
 *     `Clematis Cultivaris in Sorten`)
 *
 * Daraus folgt eine Trennung, die kein Komma braucht: Der botanische Teil läuft, solange die
 * Wörter kleingeschrieben, in Anführungsstrichen, Rangmarken oder Gruppenwörter sind. Beim ersten
 * gewöhnlichen grossgeschriebenen Wort beginnt der deutsche Name.
 *
 * 🔴 Das ist der Grund, warum die 76 Zeilen ohne Komma („- mollis Chinesiche Zaubernuß") lesbar
 * sind. Ein Azubi liest sie auch ohne Komma — er kennt die Regel.
 */
const RANGMARKEN = new Set(['var.', 'subsp.', 'ssp.', 'f.', 'cv.', 'sect.']);
/**
 * Die Wörter, an denen ein GROSS geschriebener Namensteil trotzdem botanisch ist.
 *
 * Die Liste erklärt es selbst: „Werden Gruppen von Hybriden zusammengefasst, so wird der Artname
 * — abweichend von dem oben Gesagten — groß geschrieben." Sie schreibt dabei mal `Hybride`, mal
 * `Hybriden`, mal `Cultivars`, mal `Cultivaris`; der Wortstamm trägt, die Endung nicht.
 */
const GRUPPENWORT = /(gruppe|hybrid|cultivar|sorten)/i;

function trenneNamen(text) {
  const woerter = text.split(/\s+/).filter(Boolean);
  /*
   * 🔴 Manche Zeilen wiederholen die Gattung, statt nur das Epitheton zu nennen —
   * `Chrysanthemum x grandiflorum in Sorten`. Erkennbar daran, dass auf ein grossgeschriebenes
   * erstes Wort ein kleingeschriebenes oder ein Hybridzeichen folgt: Ein deutscher Name fängt
   * nicht so an.
   */
  const vollerName =
    woerter.length >= 2 &&
    /^[A-ZÄÖÜ][a-zäöüß]{2,}$/.test(woerter[0].replace(/[,;]+$/, '')) &&
    /^([a-zäöüß]|x$|×$)/.test(woerter[1]);
  const bot = [];
  let i = 0;
  let nachRangmarke = false;

  while (i < woerter.length) {
    const w = woerter[i];
    if (i === 0 && vollerName) { bot.push(w.replace(/[,;]+$/, '')); i++; if (/,$/.test(w)) break; continue; }
    const nackt = w.replace(/[,;]+$/, '');
    const endetMitKomma = /,$/.test(w);

    const istKlein = /^[a-zäöüß]/.test(nackt);
    const istHybridzeichen = nackt === 'x' || nackt === '×';
    const istRangmarke = RANGMARKEN.has(nackt.toLowerCase());
    const istSorte = /^['‘’]/.test(nackt) || (bot.length > 0 && /['‘’]$/.test(nackt) && /['‘’]/.test(bot.join(' ')));
    const istGruppe = GRUPPENWORT.test(nackt);

    if (istKlein || istHybridzeichen || istRangmarke || istSorte || istGruppe || nachRangmarke) {
      bot.push(nackt);
      nachRangmarke = istRangmarke;
      i++;
      // Ein Komma beendet den botanischen Teil — dahinter steht der deutsche Name.
      if (endetMitKomma) break;
      continue;
    }

    /*
     * Ein grossgeschriebenes Wort. Zwei Fälle:
     *   · Es steht in Anführungsstrichen oder eröffnet sie → Sortenname, gehört dazu.
     *   · Sonst beginnt hier der deutsche Name.
     */
    if (/^['‘’]/.test(w) || (i + 1 < woerter.length && /['‘’]/.test(woerter[i + 1]) && /['‘’]/.test(w))) {
      bot.push(nackt); i++; continue;
    }
    break;
  }

  let rest = woerter.slice(i).join(' ').replace(/^[,;]\s*/, '').trim();
  const { deutsch } = trenneAutor(rest);
  return { botanisch: saeubere(bot.join(' ')), deutsch: saeubere(deutsch) };
}

/**
 * BAUART A — Gattungsblock.
 *
 *     1. LAUBGEHÖLZE                              ← Abschnitt
 *     Ácer - Ahorn, Aceráceae                     ← Gattung eröffnet den Block
 *           - campéstre, Feld-Ahorn               ← Art, erbt die Gattung
 *           - - ‘Columnáris’, Lawsons-Scheinzypresse   ← Sorte der vorigen ART
 *     + - - - ‘Scarlet Wonder’, Flacher Rhododendron  ← Sorte der vorigen UNTERART
 *
 * 🔴 Die Zahl der Striche ist die Verschachtelungstiefe. Zwei Striche hatte ich erkannt, drei
 * nicht — die zehn Ausfälle „Sorte ohne vorhergehende Art" waren alle dritte Ebene.
 */
function leseGattungsblock(text, { abschnitte, endeBei = null }) {
  /*
   * Betonungszeichen und Seitenvorschub fallen ZUERST, für die ganze Datei — sonst scheitert
   * jede Mustererkennung an ihnen. Für die deutschen Namen gefahrlos: gestrichen werden nur Akut
   * und Gravis, Umlaute (U+0308) und ß bleiben.
   */
  const zeilen = entferneBetonung(ohneSeitenvorschub(text)).split('\n');

  const istAbschnitt = (z) => {
    const m = /^\s*\d+\.\s+([A-ZÄÖÜ][A-ZÄÖÜa-zäöüß\s\-(),.]+?)\s*$/.exec(z);
    if (!m) return null;
    const name = saeubere(m[1]);
    return abschnitte.some((a) => name.toUpperCase().startsWith(a.toUpperCase())) ? name : null;
  };
  /*
   * Gattungszeile. Nach dem grossen Anfangsbuchstaben müssen KLEINE folgen — ohne diese Bedingung
   * war `ZP   - deodara, …` eine Gattungszeile mit der Gattung „ZP".
   */
  const istGattung = (z) => {
    const t = z.trim();
    if (t.startsWith('-')) return null;
    const m = /^([A-ZÄÖÜ][a-zäöüß-]{2,})\s*-\s*(.+)$/.exec(t);
    /*
     * 🔴 Ein KOMMA muss folgen. Eine Gattungszeile lautet „Acer - Ahorn, Aceraceae" — Name,
     * deutscher Name, Familie. Ohne diese Bedingung war `Rhododendron-Hybride ‘Beethoven’` eine
     * Gattungszeile (Gattung „Rhododendron", Rest „Hybride ‘Beethoven’") und verschwand als
     * Eintrag — mit ihr die beiden Sorten, die auf ihr aufbauen.
     *
     * Die Familie darf in der nächsten Zeile stehen (`Buddleja - Sommerflieder/…,` mit
     * `Buddlejaceae` darunter), das Komma steht immer.
     */
    return m && m[2].includes(',') ? m[1] : null;
  };
  // Seitenzahlen, Spaltenüberschriften und der Impressumsblock am Fuß.
  const istRauschen = (z) =>
    /^\s*\d+\s*$/.test(z) ||
    /^\s*Notizen\s*$/.test(z) ||
    /(Mail:|Internet:|www\.|@)/.test(z);

  /*
   * 🔴 Die Liste beginnt bei der ersten GATTUNGSZEILE MIT FAMILIE, nicht bei der ersten
   * Überschrift.
   *
   * Das Inhaltsverzeichnis sieht aus wie die Liste: „Laubgehölze", „Nadelgehölze", „Rosen" —
   * dieselben Wörter, dieselbe Nummerierung. Wer dort anfängt, liest elf Abschnitte und drei
   * Sätze Vorwort als Pflanzen und bricht dann am Wort „Gütebestimmungen" ab, das ebenfalls im
   * Verzeichnis steht. Genau das ist passiert: null Einträge aus einer 400-Pflanzen-Liste.
   *
   * Eine Zeile wie `Acer - Ahorn, Aceraceae` gibt es im Vorwort nicht. Sie ist der sichere Anfang.
   */
  const beginn = zeilen.findIndex((z) =>
    /^[A-ZÄÖÜ][a-zäöüß-]{2,}\s*-\s*.+,\s*[A-ZÄÖÜ][a-zäöü]+aceae/.test(z.trim()),
  );
  const koerper = beginn >= 0 ? zeilen.slice(beginn) : zeilen;

  const saetze = baueDatensaetze(koerper, { istAbschnitt, istGattung, istRauschen, endeBei });

  const aus = [];
  const verworfen = [];
  let gattung = null;
  let kategorie = null;
  /** Der zuletzt gebaute vollständige Name — die Striche der nächsten Zeile beziehen sich darauf. */
  const stand = { letzter: null };

  for (const satz of saetze) {
    if (satz.art === 'abschnitt') { kategorie = satz.wert; gattung = null; continue; }
    if (satz.art === 'gattung') { gattung = satz.wert; stand[1] = null; stand[2] = null; continue; }
    /*
     * Ein Eintrag ohne offenen Gattungsblock ist kein Fehler, wenn er seinen Namen selbst nennt.
     *
     * Das Unkrautkapitel der Friedhofsliste steht so: `Cirsium arvense, Asteraceae …` — ohne
     * Gattungszeile darüber, weil jede Zeile eine andere Gattung hat. Hier noch einmal auf den
     * vollen Namen zu prüfen ist billiger und sicherer, als im Zerleger jeden Weg abzudecken,
     * über den so eine Zeile ankommen kann.
     */
    const nenntGattungSelbst =
      satz.vollerName || /^[A-ZÄÖÜ][A-Za-zäöüß-]{2,}\s+([a-zäöüß]|x\b|×)/.test(satz.text);
    if (!gattung && !nenntGattungSelbst) { verworfen.push({ zeile: satz.text, grund: 'keine Gattung offen' }); continue; }

    const zp = /\bZP\b/i.test(satz.marken);
    const text2 = ohneKlammern(satz.text);
    const { botanisch: botTeil, deutsch } = trenneNamen(text2);
    if (!botTeil) { verworfen.push({ zeile: satz.text, grund: 'kein botanischer Name' }); continue; }

    // Ebene 1 hängt an der Gattung, tiefere am zuletzt gesehenen Namen der Ebene darüber.
    /*
     * ═══════════════════════════════════════════════════════════════════════════════════════════
     * 🔴 DIE STRICHE ERSETZEN, SIE SCHACHTELN NICHT
     * ═══════════════════════════════════════════════════════════════════════════════════════════
     *
     * Das ist der Punkt, den ich zweimal falsch hatte. Ein Strich steht nicht für „eine Ebene
     * tiefer", sondern für „hier wiederholt sich, was oben steht". **n Striche = die ersten n
     * Namensteile des vorigen Eintrags**, danach folgt der neue Teil:
     *
     *     Chamaecyparis - Scheinzypresse, Cupressaceae
     *           - lawsoniana              →  Chamaecyparis lawsoniana
     *           - - ‘Columnaris’          →  Chamaecyparis lawsoniana ‘Columnaris’
     *
     * ⚠️ Und die Ausnahme, an der die naive Fassung scheiterte: Endet der vorige Name selbst auf
     * einem Sortennamen, wird der ERSETZT und nicht behalten —
     *
     *     Rhododendron-Hybride ‘Beethoven’
     *           - - ‘Vuyk’s Scarlet’      →  Rhododendron-Hybride ‘Vuyk’s Scarlet’
     *
     * Sonst entstünde `Rhododendron-Hybride ‘Beethoven’ ‘Vuyk’s Scarlet’` — zwei Sorten in einem
     * Namen. Deshalb: vom vorigen Namen erst die abschliessende Sorte abziehen, dann die ersten
     * n Teile nehmen.
     */
    let basis;
    if (satz.vollerName || (!gattung && nenntGattungSelbst)) {
      basis = '';
    } else if (satz.ebene === 1) {
      basis = gattung;
    } else {
      const vorher = stand.letzter;
      if (!vorher) { verworfen.push({ zeile: satz.text, grund: `keine Basis für Ebene ${satz.ebene}` }); continue; }
      const ohneSorte = vorher.replace(/\s*['‘’][^'‘’]*['‘’]\s*$/, '').trim();
      const teile = ohneSorte.split(/\s+/);
      basis = teile.slice(0, Math.min(satz.ebene, teile.length)).join(' ');
    }
    if (basis === null || basis === undefined) { verworfen.push({ zeile: satz.text, grund: `keine Basis für Ebene ${satz.ebene}` }); continue; }

    const botanisch = einheitlicheHochkommata(saeubere(`${basis} ${ohneSortenPlatzhalter(botTeil)}`));
    stand.letzter = botanisch;
    // Ein frei stehender Eintrag eröffnet seine Gattung für die eingerückten Zeilen darunter.
    if (satz.vollerName) gattung = botanisch.split(/\s+/)[0];

    aus.push({ botanisch, deutsch, kategorie, zwischenpruefung: zp });
  }

  return { eintraege: aus, verworfen };
}

/**
 * BAUART B — Dreizeiler (Staudengärtnerei).
 *
 *     Zp   Ajuga reptans            V-VI        GR
 *          Lamiaceae
 *          Kriechender Günsel
 *
 * Erkennungsmerkmal ist die MITTLERE Zeile: ein einzelnes Wort auf `aceae`. Sie trennt zwei
 * Einträge sicherer als jede Einrückung — Blütezeit und Lebensbereich stehen mal da, mal nicht.
 */
function leseDreizeiler(text) {
  const zeilen = ohneSeitenvorschub(text).split('\n').map((z) => z.replace(/\s+$/, ''));
  const aus = [];
  const verworfen = [];

  for (let i = 1; i < zeilen.length - 1; i++) {
    const familie = zeilen[i].trim();
    if (!/^[A-ZÄÖÜ][a-zäöü]+aceae$/.test(familie)) continue;

    /*
     * 🔴 Der Kopf steht nicht immer direkt über der Familie.
     *
     *     Zp   Cimicifuga racemosa    VII-VIII   GR
     *           - var. racemosa                      ← Zusatz zum Namen
     *          Ranunculaceae
     *          Juli-Silberkerze
     *
     * Zwei Einträge der Staudenliste tragen eine Zwischenzeile: einen Rangzusatz (`- var.
     * racemosa`) oder ein Synonym (`(syn. Fallopia aubertii)`). Wer stur eine Zeile nach oben
     * greift, liest die Zwischenzeile als Namen und verliert den Eintrag.
     *
     * Beide sind erkennbar: Ein Rangzusatz beginnt mit einem Strich, ein Synonym mit einer
     * Klammer. Der Rangzusatz gehört an den Namen, das Synonym nicht.
     */
    let kopfIndex = i - 1;
    let zusatz = '';
    const istZwischenzeile = (t) => /^\s*-\s/.test(t) || /^\s*\(/.test(t);
    while (kopfIndex > 0 && istZwischenzeile(zeilen[kopfIndex])) {
      if (/^\s*-\s/.test(zeilen[kopfIndex])) zusatz = `${zeilen[kopfIndex].replace(/^\s*-\s*/, '').trim()} ${zusatz}`;
      kopfIndex--;
    }
    const kopf = zeilen[kopfIndex];
    const deutsch = saeubere(zeilen[i + 1]);
    if (!deutsch || /aceae$/.test(deutsch)) { verworfen.push({ zeile: kopf.trim(), grund: 'kein deutscher Name' }); continue; }

    // „Zp" oder „ZP" vorn ist die Zwischenprüfungsmarke, danach der botanische Name.
    const m = /^\s*(Zp|ZP)?\s*([A-ZÄÖÜ][A-Za-zäöüß×x'’‘’.\s-]+?)\s{2,}/.exec(kopf + '  ');
    if (!m) { verworfen.push({ zeile: kopf.trim(), grund: 'botanischer Name nicht lesbar' }); continue; }

    aus.push({
      botanisch: einheitlicheHochkommata(saeubere(`${m[2]} ${zusatz}`)),
      deutsch,
      familie,
      kategorie: null,
      zwischenpruefung: !!m[1],
    });
  }
  return { eintraege: aus, verworfen };
}

/**
 * BAUART C — Einzeiler (Gemüsebau).
 *
 *     Allium cepa            Alliaceae      Küchen-Zwiebel
 *
 * Drei Spalten, durch mehrere Leerzeichen getrennt. Ein `S` hinter dem Namen heisst „muss auch
 * als Samen bestimmt werden können" und gehört nicht in den Namen.
 */
function leseEinzeiler(text) {
  const aus = [];
  const verworfen = [];
  for (const roh of ohneSeitenvorschub(text).split('\n')) {
    const z = roh.replace(/\s+$/, '');
    if (!z.trim() || /^\s*\d+\s*$/.test(z)) continue;
    const m = /^\s{2,}([A-ZÄÖÜ][A-Za-zäöüß×x'’‘’.\s-]+?)\s{2,}([A-ZÄÖÜ][a-zäöü]+aceae)\s{2,}(.+)$/.exec(z);
    if (!m) continue;
    const botanisch = saeubere(m[1]).replace(/\s+´?S\s*´?$/, '');
    const deutsch = saeubere(m[3]).replace(/\s+´?S\s*´?$/, '');
    if (!deutsch) { verworfen.push({ zeile: saeubere(z), grund: 'kein deutscher Name' }); continue; }
    aus.push({ botanisch: einheitlicheHochkommata(botanisch), deutsch, familie: m[2], kategorie: null, zwischenpruefung: false });
  }
  return { eintraege: aus, verworfen };
}

/**
 * BAUART D — Deutsch zuerst, mit Unterblöcken (Obstbau).
 *
 *     Apfelbaum   Malus domestica   Fam.: Rosaceae
 *     Sorten:     Delbarestival (=Delcorf)
 *                 Gala
 *     Unterlagen: M27, M9
 *
 * 🔴 Die Unterblöcke werden NICHT übernommen. `Sorten:` führt Handelssorten ohne botanischen
 * Namen, `Unterlagen:` und `Zwischenveredelungen:` führen Veredelungsunterlagen wie `M9` oder
 * `Bittenfelder Sämling` — das sind keine Pflanzen im Sinne eines Lernkatalogs, sondern
 * Anbautechnik. Sie als Prüfungspflanzen zu führen hiesse, dem Azubi Karten ohne Bild und ohne
 * Art zu zeigen.
 *
 * Übernommen wird nur die Kopfzeile: der deutsche Name, der botanische Name und die Familie.
 */
function leseObstbau(text) {
  const aus = [];
  const verworfen = [];
  /*
   * 🔴 Seitenumbrüche zuerst. `pdftotext` setzt ein Seitenvorschubzeichen (U+000C) an den Anfang
   * der ersten Zeile jeder Seite — aus `Birnbaum` wird `\f\fBirnbaum`, und kein Ausdruck über
   * `[A-ZÄÖÜ]` trifft das noch. Vier der elf Obstarten fielen genau daran heraus, und zwar
   * ausgerechnet die, die oben auf einer Seite stehen.
   */
  const zeilen = ohneSeitenvorschub(text).split('\n').map((z) => z.replace(/\s+$/, ''));

  // ⚠️ Das Komma gehört in die deutsche Spalte: „Nashi, Asienbirne" ist EIN Name.
  const re = /^([A-ZÄÖÜ][A-Za-zäöüß,\s-]*?)\s{2,}([A-ZÄÖÜ][A-Za-zäöüß×x'’‘’.\s-]+?)\s{2,}Fam\.:?\s*([A-Za-zäöü]+)\s*$/;
  // Steht die Familie allein auf einer Zeile, gehören Name und Art in die Zeile darüber.
  const reGeteilt = /^\s*Fam\.:?\s*([A-Za-zäöü]+)\s*$/;
  const reOhneFamilie = /^([A-ZÄÖÜ][A-Za-zäöüß,\s-]*?)\s{2,}([A-ZÄÖÜ][A-Za-zäöüß×x'’‘’.\s-]+?)\s*$/;

  for (let i = 0; i < zeilen.length; i++) {
    const z = zeilen[i];
    let m = re.exec(z);
    let deutsch;
    let botanisch;
    let familie;

    if (m) {
      [, deutsch, botanisch, familie] = m;
    } else if (reGeteilt.test(z) && i > 0) {
      const oben = reOhneFamilie.exec(zeilen[i - 1]);
      if (!oben) continue;
      [, deutsch, botanisch] = oben;
      familie = reGeteilt.exec(z)[1];
    } else {
      continue;
    }

    deutsch = saeubere(deutsch);
    botanisch = saeubere(botanisch);
    /*
     * 🔴 Die Unterblöcke fallen weg. `Sorten:` führt Handelssorten ohne botanischen Namen,
     * `Unterlagen:` und `Zwischenveredelungen:` führen Veredelungsunterlagen wie `M9` oder
     * `Bittenfelder Sämling` — das ist Anbautechnik, keine Pflanze im Sinne eines Lernkatalogs.
     * Sie als Prüfungspflanzen zu führen hiesse, dem Azubi Karten ohne Bild und ohne Art zu zeigen.
     */
    if (/^(Sorten|Pollenspender|Unterlagen|Zwischenveredelungen|Sämling)$/i.test(deutsch)) {
      verworfen.push({ zeile: saeubere(z), grund: 'Unterblock' });
      continue;
    }
    if (!deutsch || !botanisch) { verworfen.push({ zeile: saeubere(z), grund: 'Name unvollständig' }); continue; }
    aus.push({
      botanisch: einheitlicheHochkommata(botanisch),
      deutsch,
      familie,
      kategorie: null,
      zwischenpruefung: false,
    });
  }
  return { eintraege: aus, verworfen };
}

module.exports = {
  entferneBetonung,
  einheitlicheHochkommata,
  trenneAutor,
  leseGattungsblock,
  leseDreizeiler,
  leseEinzeiler,
  leseObstbau,
};
