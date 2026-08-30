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
function leseGattungsblock(text, { abschnitte }) {
  /*
   * 🔴 Die Betonungszeichen fallen ZUERST, für die ganze Datei.
   *
   * Sonst scheitert jede Mustererkennung an ihnen: `Ailánthus` ist für einen Ausdruck über
   * `[A-Za-z]` kein Gattungsname, und die Zeile wird zur Artzeile der VORIGEN Gattung. Beim
   * ersten Lauf hiess der Götterbaum deshalb `Aesculus altissima` — die Gattung blieb bei
   * Aesculus stehen, weil `Ailánthus` nie als Gattungszeile erkannt wurde.
   *
   * Für die deutschen Namen ist das gefahrlos: Gestrichen werden nur Akut und Gravis (U+0301,
   * U+0300). Umlaute sind U+0308 und bleiben, ebenso das ß.
   */
  const zeilen = entferneBetonung(ohneSeitenvorschub(text)).split('\n');
  const aus = [];
  const verworfen = [];
  let gattung = null;
  let letzteArt = null;
  let kategorie = null;
  let aktiv = false;

  const istAbschnitt = (z) => {
    const m = /^\s*\d+\.\s+([A-ZÄÖÜ][A-ZÄÖÜa-zäöüß\s\-(),.]+?)\s*$/.exec(z);
    if (!m) return null;
    const name = saeubere(m[1]);
    return abschnitte.some((a) => name.toUpperCase().startsWith(a.toUpperCase())) ? name : null;
  };

  for (let i = 0; i < zeilen.length; i++) {
    const roh = zeilen[i];
    const z = roh.replace(/\s+$/, '');
    if (!z.trim()) { letzteArt = null; continue; }

    const abschnitt = istAbschnitt(z);
    if (abschnitt) { kategorie = abschnitt; aktiv = true; gattung = null; letzteArt = null; continue; }
    if (!aktiv) continue;

    // Seitenzahlen, Kopf- und Fusszeilen
    if (/^\s*\d+\s*$/.test(z) || /^\s*Notizen\s*$/.test(z)) continue;

    /*
     * Gattungszeile: „Acer - Ahorn, Aceraceae"
     *
     * ⚠️ Nach dem grossen Anfangsbuchstaben müssen KLEINE folgen. Ohne diese Bedingung war
     * `ZP   - deodara, Himalaja-Zeder` eine Gattungszeile mit der Gattung „ZP" — und die
     * Prüfungsmarke stand anschliessend im botanischen Namen.
     */
    const g = /^([A-ZÄÖÜ][a-zäöüß-]{2,})\s*-\s*(.+)$/.exec(z.trim());
    if (g && !z.trim().startsWith('-')) {
      gattung = entferneBetonung(g[1]);
      letzteArt = null;
      continue;
    }

    // Artzeile: alles vor dem `-` sind Marker (ZP, +, Pflanzenzeichen)
    const a = /^\s*([A-Z+\s]*)-\s*(.+)$/.exec(z);
    if (!a) {
      /*
       * Fortsetzung des deutschen Namens aus der Vorzeile.
       *
       * ⚠️ NICHT alles anhängen, was eingerückt ist. Die Listen setzen auch Familiennamen und
       * Gruppenüberschriften eingerückt; beim ersten Lauf hiess das Gänseblümchen deshalb
       * „Gänseblümchen Asteraceae (Compositae)". Eine Zeile, die auf einen Familiennamen endet
       * oder mit einem beginnt, gehört nicht zum Namen.
       */
      const istFamilie = /(^|\s)[A-ZÄÖÜ][a-zäöü]+aceae\b/.test(z);
      if (aus.length && /^\s{6,}\S/.test(roh) && !istFamilie && !/^\s*[A-ZÄÖÜ]\w+\s*-/.test(z)) {
        aus[aus.length - 1].deutsch = saeubere(`${aus[aus.length - 1].deutsch} ${z}`);
      }
      continue;
    }
    if (!gattung) { verworfen.push({ zeile: saeubere(z), grund: 'keine Gattung offen' }); continue; }

    const zp = /\bZP\b/.test(a[1]);
    let inhalt = a[2].trim();

    // „- - ‘Columnáris’, …" — Sorte der zuvor genannten Art
    let sorteVonVoriger = false;
    if (inhalt.startsWith('-')) {
      inhalt = inhalt.replace(/^-\s*/, '');
      sorteVonVoriger = true;
    }

    const komma = inhalt.indexOf(',');
    if (komma < 0) { verworfen.push({ zeile: saeubere(z), grund: 'kein deutscher Name' }); continue; }
    const botTeil = ohneSortenPlatzhalter(ohneKlammern(inhalt.slice(0, komma)));
    const { deutsch } = trenneAutor(inhalt.slice(komma + 1).trim());

    const basis = sorteVonVoriger ? letzteArt : `${gattung} ${entferneBetonung(botTeil)}`;
    if (!basis) { verworfen.push({ zeile: saeubere(z), grund: 'Sorte ohne vorhergehende Art' }); continue; }

    const botanisch = einheitlicheHochkommata(
      saeubere(sorteVonVoriger ? `${basis} ${entferneBetonung(botTeil)}` : basis),
    );
    if (!sorteVonVoriger && !/'/.test(botTeil)) letzteArt = botanisch;

    const dt = saeubere(deutsch);
    if (!botanisch || !dt) { verworfen.push({ zeile: saeubere(z), grund: 'Name unvollständig' }); continue; }
    aus.push({ botanisch, deutsch: dt, kategorie, zwischenpruefung: zp });
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

    const kopf = zeilen[i - 1];
    const deutsch = saeubere(zeilen[i + 1]);
    if (!deutsch || /aceae$/.test(deutsch)) { verworfen.push({ zeile: kopf.trim(), grund: 'kein deutscher Name' }); continue; }

    // „Zp" oder „ZP" vorn ist die Zwischenprüfungsmarke, danach der botanische Name.
    const m = /^\s*(Zp|ZP)?\s*([A-ZÄÖÜ][A-Za-zäöüß×x'’‘’.\s-]+?)\s{2,}/.exec(kopf + '  ');
    if (!m) { verworfen.push({ zeile: kopf.trim(), grund: 'botanischer Name nicht lesbar' }); continue; }

    aus.push({
      botanisch: einheitlicheHochkommata(saeubere(m[2])),
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
