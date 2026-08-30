'use strict';

/**
 * Die Regeln, nach denen aus einem Prüfungsblatt eine Lernliste wird.
 *
 * Sie stehen hier und nicht im Bauschritt, weil sie die eigentliche fachliche Entscheidung sind —
 * der Bauschritt daneben liest nur Dateien und schreibt Dateien. Geprüft werden sie in
 * `pipeline/tests/exam-liste_test.js`.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * WARUM EINE ZEILE DER CSV NICHT EINE PFLANZE IST
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Die AuGaLa-Liste ist ein Prüfungsblatt, kein Datensatz. Drei ihrer Eigenheiten muss der Bau
 * kennen, sonst entsteht wieder das, was am 28.08.2026 in `full.ndjson` stand: 293 Zeilen ohne
 * eine einzige Sorte, weil `Acer platanoides 'Globosum'`, `'Cleveland'` und `'Royal Red'` alle
 * drei zu `Acer platanoides` zusammengefallen waren.
 *
 *   1. **`'Sorte'` ist keine Sorte.** 40 Zeilen tragen es als Epitheton. `Prunus avium 'Sorte'`
 *      heißt „irgendeine Süßkirschsorte" — gemeint ist die ART. Wer das für einen Sortennamen
 *      hält, sucht im Katalog nach einer Pflanze, die es nirgends gibt.
 *
 *   2. **Zu einer Sorte gehört ihre Art.** Steht `Ajuga reptans 'Atropurpurea'` auf dem Blatt,
 *      muss der Azubi auch `Ajuga reptans` können. Beide werden aufgelistet.
 *
 *   3. **Manche Zeilen meinen eine Gattung.** `Dahlia 'Sorte'` heißt „eine Dahlie". Der Katalog
 *      führt keine Gattungen; solche Einträge bleiben dauerhaft ohne Datensatz und damit gesperrt.
 *
 * ⚠️ **Die Asymmetrie zwischen Regel 2 und 3 ist gewollt.** Bei `Dahlia 'Sorte'` IST die Gattung
 * der Prüfungsinhalt, sie wird also zum Eintrag. Bei `Achillea 'Coronation Gold'` ist die Sorte
 * der Prüfungsinhalt — die Gattung `Achillea` wird NICHT zusätzlich angelegt, weil sie niemand
 * abfragt. Eine Regel, die beide Fälle gleich behandelt, ist in dem einen oder dem anderen falsch.
 */

const { elternName, eigenesEpitheton } = require('./botanical-name');

/**
 * Vergleichsform eines botanischen Namens.
 *
 * 🔴 Alle vier Anführungsvarianten müssen hier hinein. Wikidata benutzt sie durcheinander
 * (gemessen: U+2019 1.324× · U+02BD 1.137× · U+0027 209× · U+2018 164×), die CSV benutzt eine
 * fünfte (U+00B4 in `Helianthemum 'Lawrenson´s Pink'`). Eine Normalisierung, die nur `'` kennt,
 * findet `Cupressus macrocarpa 'Goldcrest'` im Katalog nicht wieder, obwohl er dort steht.
 *
 * Geklammerte Zusätze fallen weg: `Aster 'Kassel' (Dumosus-Gruppe)` und `Aster 'Kassel'` sind
 * dieselbe Pflanze. Der ANZEIGENAME behält die Klammer — sie steht so auf dem Prüfungsblatt.
 *
 * 🔴 Schutzzeichen fallen **vor** der Zerlegung weg, nicht danach. `NFKD` löst `Ⓢ` (U+24C8) in ein
 * gewöhnliches `S` auf — aus `Calluna vulgaris 'ArabellaⓈ'` würde `arabellas`, und die Sorte wäre
 * im Katalog nicht mehr auffindbar. Betroffen ist der ganze Block der eingekreisten Buchstaben,
 * nicht nur dieses eine Zeichen.
 */
const vergleichsname = (s) =>
  String(s ?? '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[®™Ⓐ-ⓩ]/g, '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[×]/g, 'x')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Der Anzeigename: wie auf dem Prüfungsblatt, nur ohne doppelte Leerzeichen. */
const anzeigename = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** Zweiteilig heisst: Gattung + Art. Ein Wort ist eine Gattung, drei sind Rang oder Autor. */
const istBinomen = (name) => vergleichsname(name).split(' ').length >= 2;

/** Ist das Epitheton der Platzhalter `'Sorte'` und keine echte Sorte? */
const istPlatzhalter = (epitheton) => /^sorte$/i.test(String(epitheton ?? '').trim());

/**
 * Eine CSV-Zeile → ein oder zwei Listeneinträge.
 *
 * Gibt immer ein Array zurück, auch bei einem einzigen Eintrag. Der zweite Eintrag ist die
 * Elternart einer Sorte; er trägt **keinen** deutschen Namen, weil der der CSV zur SORTE gehört
 * („Rotblättriger Kriechender Günsel" ist nicht `Ajuga reptans`). Der Name der Art kommt beim
 * Auflösen aus dem Katalog.
 */
function zeileZuEintraegen({ botanisch, deutsch, kategorie }) {
  const name = anzeigename(botanisch);
  if (!name) return [];

  const epitheton = eigenesEpitheton(name);
  const eltern = anzeigename(elternName(name));

  // Regel 1: kein Epitheton — eine gewöhnliche Art.
  if (!epitheton) {
    return [{ botanicalName: name, germanName: deutsch || null, kategorie, rang: 'art', parentBotanicalName: null }];
  }

  // Regel 3: `'Sorte'` ist der Platzhalter — gemeint ist das Elterntaxon, mit dem Namen der CSV.
  if (istPlatzhalter(epitheton)) {
    return [{
      botanicalName: eltern,
      germanName: deutsch || null,
      kategorie,
      rang: istBinomen(eltern) ? 'art' : 'gattung',
      parentBotanicalName: null,
    }];
  }

  // Regel 2: eine echte Sorte — und ihre Art dazu, sofern die Art eine Art ist.
  const eintraege = [{
    botanicalName: name,
    germanName: deutsch || null,
    kategorie,
    rang: 'sorte',
    parentBotanicalName: eltern || null,
  }];
  if (istBinomen(eltern)) {
    eintraege.push({ botanicalName: eltern, germanName: null, kategorie, rang: 'art', parentBotanicalName: null });
  }
  return eintraege;
}

/**
 * Mehrere Zeilen → die entdoppelte Liste.
 *
 * Zusammengeführt wird über den Vergleichsnamen. Wo zwei Einträge denselben Namen tragen, gewinnt
 * der mit dem deutschen Namen: Eine Zeile, die so auf dem Prüfungsblatt steht, sagt mehr als eine
 * Elternart, die nur abgeleitet wurde.
 *
 * ⚠️ Die CSV enthält 12 echte Dubletten (`Taxus baccata`, `Galanthus nivalis`, `Malus domestica
 * 'Sorte'` …). Sie fallen hier zusammen, ohne dass es auffällt — deshalb zählt der Bauschritt sie
 * und meldet sie.
 */
function zeilenZuListe(zeilen) {
  const nachName = new Map();
  for (const zeile of zeilen) {
    for (const eintrag of zeileZuEintraegen(zeile)) {
      const schluessel = vergleichsname(eintrag.botanicalName);
      if (!schluessel) continue;
      const vorhanden = nachName.get(schluessel);
      if (!vorhanden) {
        nachName.set(schluessel, { ...eintrag, schluessel });
        continue;
      }
      // Der deutsche Name der Prüfungsliste hat Vorrang vor einem leeren.
      if (!vorhanden.germanName && eintrag.germanName) vorhanden.germanName = eintrag.germanName;
      if (!vorhanden.kategorie && eintrag.kategorie) vorhanden.kategorie = eintrag.kategorie;
    }
  }
  return [...nachName.values()];
}

/**
 * Einen Namen im Katalog suchen — mit den Schreibweisen, die dieselbe Pflanze meinen.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * DREI ANLÄUFE, WEIL DREI SCHREIBWEISEN ÜBLICH SIND
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * 🔴 Diese drei Wege sind kein Entgegenkommen, sondern eine Korrektur: Ohne sie sahen 60 Einträge
 * im Bericht aus wie Katalog-Lücken, obwohl die Pflanze längst da ist.
 *
 *  1. **Wie geschrieben.**
 *  2. **Ohne Kreuzungszeichen.** GBIF führt Hybriden unter ihrem `canonicalName` OHNE das `×`:
 *     `Forsythia intermedia`, nicht `Forsythia × intermedia`. Die Prüfungslisten schreiben es,
 *     wie es sich gehört. 52 Einträge scheiterten allein daran — `Magnolia x soulangeana`,
 *     `Platanus x hispanica`, `Tilia x euchlora`.
 *  3. **`ssp.` als `subsp.`** Beides ist die gebräuchliche Abkürzung für dieselbe Rangstufe; die
 *     Listen benutzen die kurze, der Katalog die lange.
 *
 * ⚠️ Was hier bewusst NICHT passiert: eine unscharfe Suche über die Zeichenähnlichkeit. Sie
 * ordnete beim Ausprobieren `Lonicera pileata` der `Lonicera canadensis` zu und `Potentilla
 * spinosa` der `Potentilla inclinata` — verschiedene Arten. Ein falscher Treffer in einer
 * Prüfungsliste ist schlimmer als eine sichtbare Lücke.
 */
function sucheImKatalog(index, botanicalName) {
  const wege = [
    botanicalName,
    botanicalName.replace(/\s+[x×]\s+/g, ' '),
    botanicalName.replace(/\bssp\./g, 'subsp.'),
    botanicalName.replace(/\s+[x×]\s+/g, ' ').replace(/\bssp\./g, 'subsp.'),
  ];
  for (const weg of wege) {
    const treffer = index.get(vergleichsname(weg));
    if (treffer) return treffer;
  }
  return null;
}

/**
 * Zwei Prüfungszeilen, eine Pflanze — zusammenlegen.
 *
 * 🔴 Das passiert erst NACH der Auflösung und lässt sich vorher nicht sehen. `Crocus albiflorus`
 * und `Crocus vernus` stehen als zwei Zeilen auf dem AuGaLa-Blatt; der Katalog führt die erste als
 * Synonym der zweiten. Nach dem Auflösen zeigen beide Einträge auf `plantKey 2747567`.
 *
 * Bliebe es dabei, stünde dieselbe Pflanze zweimal in der Liste — und weil der Aktivierungsstand
 * an der Pflanze hängt und nicht am Listeneintrag, würde der Haken bei der einen still den bei der
 * anderen setzen. Der Nutzer sähe eine Pflanze, die sich von selbst aktiviert.
 *
 * Es überlebt der Eintrag, den der Katalog **selbst so nennt** (`canonical` oder `scientific`) —
 * das ist der heute gültige Name. Der Name der Prüfungsliste geht nicht verloren, er wandert nach
 * `alsoKnownAs`: Der Azubi sucht nach dem, was auf seinem Blatt steht.
 *
 * Einträge ohne Auflösung (`plantKey: null`) sind hiervon unberührt. Sie sind über ihren Namen
 * schon in {@link zeilenZuListe} entdoppelt worden, und `null` ist kein gemeinsamer Schlüssel.
 */
function verschmelzeAufloesungen(eintraege) {
  const nachSchluessel = new Map();
  const aus = [];
  for (const e of eintraege) {
    if (e.plantKey == null) { aus.push(e); continue; }
    const vorhanden = nachSchluessel.get(e.plantKey);
    if (!vorhanden) { nachSchluessel.set(e.plantKey, e); aus.push(e); continue; }

    // Wer den heutigen Namen trägt, bleibt stehen.
    const direkt = (x) => x.matchedVia === 'canonical' || x.matchedVia === 'scientific';
    const [bleibt, weicht] = direkt(e) && !direkt(vorhanden) ? [e, vorhanden] : [vorhanden, e];
    if (bleibt !== vorhanden) {
      aus[aus.indexOf(vorhanden)] = bleibt;
      nachSchluessel.set(e.plantKey, bleibt);
    }
    bleibt.alsoKnownAs = [...new Set([...(bleibt.alsoKnownAs || []), ...(weicht.alsoKnownAs || []), weicht.botanicalName])];
    if (!bleibt.germanName && weicht.germanName) bleibt.germanName = weicht.germanName;
    if (!bleibt.kategorie && weicht.kategorie) bleibt.kategorie = weicht.kategorie;
  }
  return aus;
}

/**
 * Die Reihenfolge — **nur nach Bekanntheit**, Sorten direkt hinter ihrer Art.
 *
 * Bekanntheit ist die Bildanzahl im Katalog (`imagesCount`). Das ist kein Ersatzwert, sondern ein
 * echter Häufigkeitswert: Wie oft eine Art fotografiert und bestimmt wurde, sagt ziemlich genau,
 * wie oft man ihr begegnet. *Fagus sylvatica* trägt 43.095 Bilder, *Peltaria alliacea* zwei.
 *
 * 🔴 Die Kursstufe ist BEWUSST keine Sortierachse. Entscheidung von Clemens am 28.08.2026: Die
 * überbetrieblichen Kurse sind je Bundesland und je Kammer anders geschnitten — eine Reihenfolge,
 * die sich daran ausrichtet, stimmt für die meisten Nutzer nicht. Die Kurszugehörigkeit bleibt als
 * Merkmal in den Daten (`courses`), damit sie später ein Filter werden kann.
 *
 * ## Blöcke statt einzelner Zeilen
 *
 * Sortiert wird nicht Eintrag für Eintrag, sondern in **Artblöcken**: eine Art mit allen ihren
 * Sorten. Sonst rutschte `Acer platanoides 'Globosum'` (44 Bilder) ans Listenende, weit weg von
 * `Acer platanoides` (28.000) — und der Azubi lernt die Kugelform, ohne den Spitzahorn daneben zu
 * haben.
 *
 * Der Rang eines Blocks ist das MAXIMUM seiner Mitglieder, nicht der Wert des Kopfes. Ein Block
 * ohne Kopf (`Achillea 'Coronation Gold'` — die Gattung ist kein Eintrag) hätte sonst den Rang 0
 * und stünde am Ende, obwohl die Sorte durchaus bekannt sein kann.
 *
 * Alles ohne Auflösung trägt 0 und landet hinten, dort alphabetisch. Kein `Math.random`, kein
 * Zeitstempel: Zwei Läufe über dieselbe Eingabe müssen byteweise dasselbe ergeben.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * DIE ZWISCHENPRÜFUNG KOMMT ZUERST
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Vier der sechs NRW-Listen heben Pflanzen mit `ZP` hervor: „Die mit ZP gekennzeichneten
 * Pflanzennamen werden bei der Zwischenprüfung als Pflanzenkenntnisse bevorzugt angesprochen."
 * Das ist die einzige Angabe im ganzen Dokument, die etwas über den ZEITPUNKT sagt — und der
 * Zeitpunkt ist für einen Azubi wichtiger als die Häufigkeit: Wer im Frühjahr Zwischenprüfung
 * hat, muss diese Pflanzen JETZT können.
 *
 * Deshalb steht der Prüfungszeitpunkt vor der Bekanntheit. Innerhalb beider Gruppen gilt sie
 * weiter.
 *
 * 🔴 Die Marke gilt für den BLOCK, nicht für die einzelne Zeile. Ist die Art für die
 * Zwischenprüfung markiert und eine ihrer Sorten nicht, dürfen sie trotzdem nicht auseinander-
 * gerissen werden — sonst steht der Kugel-Ahorn am Listenende, weit weg vom Spitz-Ahorn.
 *
 * Gemüsebau und Obstbau kennen keine Marke; dort ist die Gruppe leer und alles sortiert wie
 * bisher nach Bekanntheit.
 */
function sortiere(eintraege) {
  const bloecke = new Map();
  for (const e of eintraege) {
    const schluessel = vergleichsname(e.parentBotanicalName || e.botanicalName);
    if (!bloecke.has(schluessel)) bloecke.set(schluessel, []);
    bloecke.get(schluessel).push(e);
  }

  const bekanntheit = (e) => Number(e.imagesCount) || 0;
  const nachNamen = (a, b) => (a.botanicalName < b.botanicalName ? -1 : a.botanicalName > b.botanicalName ? 1 : 0);

  const geordnet = [...bloecke.entries()]
    .map(([schluessel, mitglieder]) => ({
      schluessel,
      // 0 = Zwischenprüfung, 1 = erst zur Abschlussprüfung. Ein einziges markiertes Mitglied
      // zieht den ganzen Block nach vorn — er gehört zusammen.
      pruefung: mitglieder.some((e) => e.zwischenpruefung) ? 0 : 1,
      rang: Math.max(0, ...mitglieder.map(bekanntheit)),
      mitglieder: mitglieder.sort((a, b) => {
        // Der Kopf des Blocks zuerst: die Art (oder Gattung), dann ihre Sorten.
        const kopf = (e) => (e.rang === 'sorte' ? 1 : 0);
        return kopf(a) - kopf(b) || bekanntheit(b) - bekanntheit(a) || nachNamen(a, b);
      }),
    }))
    .sort(
      (a, b) =>
        a.pruefung - b.pruefung ||
        b.rang - a.rang ||
        (a.schluessel < b.schluessel ? -1 : a.schluessel > b.schluessel ? 1 : 0),
    );

  const flach = [];
  for (const block of geordnet) for (const e of block.mitglieder) flach.push(e);
  return flach.map((e, i) => ({ ...e, sortIndex: i }));
}

module.exports = { vergleichsname, anzeigename, istBinomen, istPlatzhalter, zeileZuEintraegen, zeilenZuListe, sucheImKatalog, verschmelzeAufloesungen, sortiere };
