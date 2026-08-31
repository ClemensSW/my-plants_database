'use strict';
/**
 * Die drei überbetrieblichen GaLaBau-Pflichtkurse (01, 07, 12) der Landwirtschaftskammer NRW.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * WARUM DIESE LISTEN EINEN EIGENEN LESER BRAUCHEN — UND KEINEN TEXTLESER
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Die sechs Fachrichtungslisten (`lwk-nrw-listen.js`) sind Fließtext mit Strichen und Einrückung.
 * Diese drei sind **echte Tabellen** mit sechs Spalten:
 *
 *     Nr.  Gattung  Art  Sorte  Deutscher Name  Hinweis
 *
 * Das klingt einfacher und ist es nicht. `pdftotext -layout` presst die Tabelle in Zeichenspalten,
 * und dabei gehen genau die Fälle verloren, auf die es ankommt:
 *
 *     4.   Dianthus   gratianopolitanus 'Sorte'   Garten-Pfingst-Nelke
 *     7.   Sedum      floriferum   'Weihenstephaner Teppich-Sedum
 *                                  Gold'
 *
 * Im ersten Fall steht zwischen Art und Sorte **ein einziges Leerzeichen** — die Art ist zu lang
 * für ihre Spalte. Im zweiten ragt die Sorte in die Namensspalte hinein und schiebt den deutschen
 * Namen nach rechts. Wer nach Zeichenspalten schneidet, zerlegt beide falsch; wer nach Grammatik
 * trennt, kann `'Weihenstephaner Teppich-Sedum` nicht auflösen, weil das Anführungszeichen erst
 * eine Zeile später schließt.
 *
 * Deshalb liest dieser Leser `pdftotext -bbox-layout`: XHTML mit der **x-Koordinate jedes Wortes**.
 * `gratianopolitanus` liegt bei x=147,6 und `'Sorte'` bei x=242,3 — im Flachtext ein Leerzeichen
 * auseinander, in Wahrheit zwei Spalten. Damit ist die Zuordnung eindeutig statt geschätzt.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 🔴 DIE SPALTEN GEHÖREN DEM TABELLENBLOCK, NICHT DER SEITE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Der erste Anlauf nahm je Seite eine Spaltenlage — die der ersten Kopfzeile. Auf Seite 4 von
 * Kurs 12 stehen aber FÜNF Tabellen untereinander (Zwiebelpflanzen, Ziergräser, Farne,
 * Beet- und Balkonpflanzen), jede mit eigener Spaltenlage. Ergebnis: Ab der zweiten Tabelle rutschte
 * der deutsche Name in die Sorte-Spalte, und `Hyazinthus orientalis` hatte plötzlich die Sorte
 * `'Sorte' Hyazinthe`. Jede Kopfzeile setzt die Spalten deshalb neu.
 */

/** Die Spalten der Tabelle, in der Reihenfolge, in der sie stehen. */
const SPALTEN = ['nr', 'gattung', 'art', 'sorte', 'deutsch', 'hinweis'];

/** Ein Wort darf drei Punkt links von seiner Spaltenkante beginnen — Kerning, kein Spaltenwechsel. */
const X_TOLERANZ = 3;

/** Zwei Wörter gehören zur selben Zeile, wenn ihre Oberkanten näher als das beieinanderliegen. */
const Y_TOLERANZ = 4;

const ENTITAETEN = {
  '&apos;': "'", '&amp;': '&', '&quot;': '"', '&lt;': '<', '&gt;': '>', '&#39;': "'",
};
const entschluesseln = (s) => s.replace(/&(?:apos|amp|quot|lt|gt|#39);/g, (m) => ENTITAETEN[m]);

/**
 * Die typografischen Anführungszeichen der Vorlage auf das gerade Zeichen bringen.
 *
 * Der Katalog und die übrigen Listen führen `'`; ein `’` an derselben Stelle wäre für jeden
 * Vergleich ein anderer Name.
 */
const einheitlicheHochkommata = (s) => s.replace(/[‘’‛′]/g, "'");

/** Seiten → Zeilen → Wörter, jedes mit seiner x-Koordinate. */
function leseSeiten(xml) {
  const seiten = [];
  for (const s of xml.matchAll(/<page\b[^>]*>([\s\S]*?)<\/page>/g)) {
    const woerter = [];
    for (const w of s[1].matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="[\d.]+" yMax="[\d.]+">([\s\S]*?)<\/word>/g)) {
      const t = einheitlicheHochkommata(entschluesseln(w[3])).trim();
      if (t) woerter.push({ x: +w[1], y: +w[2], t });
    }
    seiten.push(woerter);
  }
  return seiten;
}

function zeilenVon(woerter) {
  const sortiert = [...woerter].sort((a, b) => a.y - b.y || a.x - b.x);
  const zeilen = [];
  let aktuell = null;
  for (const w of sortiert) {
    if (!aktuell || Math.abs(w.y - aktuell.y) > Y_TOLERANZ) {
      aktuell = { y: w.y, woerter: [] };
      zeilen.push(aktuell);
    }
    aktuell.woerter.push(w);
  }
  for (const z of zeilen) z.woerter.sort((a, b) => a.x - b.x);
  return zeilen;
}

/** Ist das die Kopfzeile einer Tabelle? Dann trägt sie die Spaltenlage für alles danach. */
const istKopf = (zeile) =>
  zeile.woerter[0]?.t === 'Nr.' && zeile.woerter.some((w) => w.t === 'Gattung');

function spaltenAus(kopf) {
  const x = (name) => kopf.woerter.find((w) => w.t === name)?.x;
  // `Deutscher Name` sind zwei Wörter — die Spalte beginnt beim ersten.
  const kanten = [x('Nr.'), x('Gattung'), x('Art'), x('Sorte'), x('Deutscher'), x('Hinweis')];
  if (kanten.some((k) => k == null)) return null;
  return kanten;
}

const inSpalte = (x, kanten) => {
  let k = 0;
  for (let i = 0; i < kanten.length; i++) if (x + X_TOLERANZ >= kanten[i]) k = i;
  return SPALTEN[k];
};

/** `1. Laubgehölze`, `11. Beet- und Balkonpflanzen, Wechselflor` — die Warengruppe. */
const ABSCHNITT = /^(\d{1,2})\.\s+([A-ZÄÖÜ].*)$/;

/** Die Titelzeile und die Fußnote. Beide sind kein Eintrag und keine Störung. */
const istTitel = (text) => /^Pflanzenliste zum GaLaBau-Pflichtkurs\s*\d+/.test(text);
const istFussnote = (text) =>
  /^Hinweis:?$/.test(text) || /^\*\s*ggf\./.test(text) || /^Stand[: ]/i.test(text);

/**
 * Eine Tabellenzeile in Zellen zerlegen.
 *
 * Zeilen ohne Nummer sind Fortsetzungen: Ihre Wörter gehören zur zuletzt begonnenen Zeile, und
 * zwar spaltenweise — so wächst `Buxus sempervirens` über zwei Fortsetzungen zu
 * `Buxus sempervirens var. arborescens`, ohne dass der deutsche Name danebengerät.
 */
function zellenAus(zeile, kanten) {
  const zellen = { nr: [], gattung: [], art: [], sorte: [], deutsch: [], hinweis: [] };
  for (const w of zeile.woerter) zellen[inSpalte(w.x, kanten)].push(w.t);
  const fertig = {};
  for (const k of SPALTEN) fertig[k] = zellen[k].join(' ').trim();
  return fertig;
}

/**
 * Eine Fortsetzungszeile an das schon Gelesene hängen.
 *
 * 🔴 Endet das Bisherige auf einem Bindestrich, wird OHNE Leerzeichen verbunden. Die Vorlage
 * trennt deutsche Namen am Zeilenende: „Sand-Birke, Weiß-Birke, Hänge-" / „Birke". Mit Leerzeichen
 * entstünde „Hänge- Birke" — ein Name, den niemand sucht und den kein Vergleich findet.
 */
function anfuegen(bisher, neu) {
  if (!bisher) return neu;
  if (/-$/.test(bisher)) return bisher + neu;
  return `${bisher} ${neu}`;
}

/** Der Platzhalter der Vorlage für „irgendeine Sorte". Er ist kein Sortenname. */
const IST_PLATZHALTER = (s) => /^'?Sorte'?$/i.test(s.trim());

/** Ränge, die zum botanischen Namen gehören — im Gegensatz zu einer Sorte. */
const RANG_MARKE = /^(subsp\.|ssp\.|var\.|f\.|sect\.|convar\.)$/i;
const BEGINNT_MIT_RANG = /^(subsp\.|ssp\.|var\.|f\.|sect\.|convar\.)\s/i;

/**
 * Aus den Zellen einen botanischen Namen bauen.
 *
 * Die Sorte-Spalte trägt DREIERLEI, und die drei dürfen nicht verwechselt werden:
 *
 *  1. `'Sorte'` — der Platzhalter. Er fällt weg: Geprüft wird die Art, nicht eine bestimmte Sorte.
 *  2. `'Otto Luyken'` — eine echte Sorte. Sie bleibt, in Anführungszeichen.
 *  3. `subsp. petiolaris`, `Ruderalia` (nach `sect.` in der Artspalte) — ein RANG, kein Sortenname.
 *     Er gehört an den botanischen Namen, sonst hiesse die Pflanze `Hydrangea anomala` und wäre
 *     eine andere.
 *
 * Und ein vierter Fall, der nur bei Rosen vorkommt: Steht in der Artspalte der Platzhalter und in
 * der Sortenspalte ein unquotiertes Wort (`Beetrosen`), dann ist das die ROSENKLASSE. Die Vorlage
 * verlangt „irgendeine Beetrose". Sie wird in Klammern gesetzt — dieselbe Schreibweise, die die
 * bundesweite AuGaLa-Liste für ihre Rosen führt (`Rosa 'Anastasia' (Edel-Rosen)`), damit die drei
 * Zeilen unterscheidbar bleiben. Ohne sie fielen Beet-, Edel- und Kletter-Rose beim Entdoppeln zu
 * einem einzigen `Rosa` zusammen.
 */
function baueNamen(z) {
  const teile = [];
  if (z.gattung) teile.push(z.gattung);

  const artRoh = z.art.trim();
  const art = IST_PLATZHALTER(artRoh) ? '' : artRoh;
  if (art) teile.push(art);

  const sorteRoh = z.sorte.trim();
  let sorte = null;
  let klasse = null;

  if (sorteRoh && !IST_PLATZHALTER(sorteRoh)) {
    const artEndetAufRang = RANG_MARKE.test(art.split(/\s+/).pop() || '');
    if (BEGINNT_MIT_RANG.test(sorteRoh) || artEndetAufRang) {
      teile.push(sorteRoh);
    } else if (/^'.*'$/.test(sorteRoh)) {
      sorte = sorteRoh;
    } else if (!art) {
      klasse = sorteRoh;
    } else {
      // Unquotiert, aber eine Art steht schon da: In den drei Vorlagen kommt das nicht vor. Als
      // Sortenname behandeln und im Bericht melden, statt still etwas zu erfinden.
      sorte = `'${sorteRoh}'`;
    }
  }

  let name = teile.join(' ').replace(/\s+/g, ' ').trim();
  if (sorte) name += ` ${sorte}`;
  if (klasse) name += ` (${klasse})`;
  return { name, hatSorte: !!sorte, hatKlasse: !!klasse, hatArt: !!art };
}

/**
 * Eine Kursliste lesen.
 *
 * @param {string} xml Die Ausgabe von `pdftotext -bbox-layout`.
 * @returns {{eintraege: Array, verworfen: Array, sternchen: number}}
 */
function leseKurs(xml) {
  const eintraege = [];
  const verworfen = [];
  let sternchen = 0;
  let kanten = null;
  let abschnitt = null;
  let letzter = null;

  for (const woerter of leseSeiten(xml)) {
    for (const zeile of zeilenVon(woerter)) {
      const text = zeile.woerter.map((w) => w.t).join(' ');

      if (istKopf(zeile)) {
        const neu = spaltenAus(zeile);
        if (neu) kanten = neu;
        else verworfen.push({ grund: 'Kopfzeile ohne alle sechs Spalten', text });
        letzter = null;
        continue;
      }
      if (istTitel(text) || istFussnote(text)) continue;

      const ab = ABSCHNITT.exec(text);
      // Ein Abschnittskopf hat NUR eine Nummer und Worte — nie eine Gattung in ihrer Spalte.
      // Unterschieden wird über die Nummernzelle: bei einem Eintrag steht dort `12.` und sonst
      // nichts, bei einem Abschnitt `12. Unkräuter,`.
      if (ab && (!kanten || zellenAus(zeile, kanten).nr !== `${ab[1]}.`)) {
        abschnitt = ab[2].trim();
        letzter = null;
        continue;
      }

      if (!kanten) {
        verworfen.push({ grund: 'Zeile vor der ersten Kopfzeile', text });
        continue;
      }

      const z = zellenAus(zeile, kanten);
      if (z.hinweis.includes('*')) sternchen++;

      if (/^\d{1,3}\.$/.test(z.nr)) {
        letzter = { nr: z.nr, abschnitt, ...z, sternchen: z.hinweis.includes('*') };
        eintraege.push(letzter);
        continue;
      }

      if (letzter) {
        // Fortsetzung: spaltenweise anhängen.
        for (const k of ['gattung', 'art', 'sorte', 'deutsch']) {
          if (z[k]) letzter[k] = anfuegen(letzter[k], z[k]);
        }
        if (z.hinweis.includes('*')) letzter.sternchen = true;
        continue;
      }

      verworfen.push({ grund: 'Zeile ohne Nummer und ohne Vorgänger', text });
    }
  }

  const fertig = eintraege.map((e) => {
    const { name, hatSorte, hatKlasse } = baueNamen(e);
    return {
      botanisch: name,
      /*
       * Ein fehlendes Leerzeichen nach dem Komma ist ein Satzfehler der Vorlage
       * („Korkflügelstrauch,Flügel-Spindelstrauch"). Er wird behoben, weil er eindeutig ist —
       * anders als alles, was Auslegung bräuchte.
       */
      deutsch: e.deutsch.replace(/,(?=\S)/g, ', ').replace(/\s+/g, ' ').trim() || null,
      kategorie: e.abschnitt,
      rang: hatSorte ? 'sorte' : hatKlasse || !e.art || IST_PLATZHALTER(e.art) ? 'gattung' : 'art',
      sternchen: !!e.sternchen,
    };
  });

  return { eintraege: fertig, verworfen, sternchen };
}

module.exports = { leseKurs, baueNamen, einheitlicheHochkommata };
