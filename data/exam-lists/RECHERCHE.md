# Prüfungspflanzenlisten im Gartenbau — Recherche

*Stand 30.08.2026. Alle Angaben sind an den Originaldokumenten geprüft, nicht aus Zusammenfassungen
übernommen. Wo eine Aussage aus einem Vorwort stammt, ist die Stelle genannt.*

---

## Die Kernfrage: Sind die Listen bundesweit gleich?

**Nein.** Jedes Bundesland gibt eigene Listen heraus, mit eigenem Herausgeber, eigenem Stand und
eigener Gliederung. Das gilt auch für den Garten- und Landschaftsbau — dort **zusätzlich** zur
bundesweiten AuGaLa-Liste.

| Bundesland | Herausgeber | Stand | Fachrichtungen | Bemerkung |
|---|---|---|---|---|
| **Nordrhein-Westfalen** | Landwirtschaftskammer NRW, Münster | Dezember 2023 (5. Auflage) | 6 eigene + GaLaBau über AuGaLa | vollständig, einheitlich gestaltet |
| **Bayern** | Bayer. Staatsministerium (StMELF) / ÄELF | 2018 – 2025/26, je Liste verschieden | 7, **inkl. eigener GaLaBau-Liste** | eigene Gliederung nach Schwerpunkten |
| **Niedersachsen** | Landwirtschaftskammer Niedersachsen | 2022 – 2023 | 6 + eigene GaLaBau-Liste | „kein rechtlicher Anspruch, dass nur Pflanzen dieser Liste geprüft werden" |
| **Baden-Württemberg** | Landwirtschaftsamt Landkreis Karlsruhe | 2025 | 7 | ausdrücklich als **Empfehlung** gekennzeichnet |

### 🔴 Der Befund, der die bisherige Annahme einschränkt

Im Repo steht die GaLaBau-Liste als `scope: national`, mit der Begründung, die AuGaLa-Liste gelte
bundesweit. Das stimmt **für die AuGaLa-Liste**, aber nicht für die Prüfung überall:

> „Pflanzenliste für den Bestimmungsteil der Pflanzenkenntnis-Prüfung bei der
> Berufsabschlussprüfung im Garten- und Landschaftsbau **in Bayern**" — Stand 05/2022

Bayern prüft also nach einer eigenen GaLaBau-Liste, Niedersachsen hat ebenfalls eine. Die
AuGaLa-Liste bleibt richtig und bundesweit als **Ausbildungs**grundlage (sie kommt vom
Ausbildungsförderwerk und wird über die Umlage an die Betriebe verteilt); die **Prüfungs**liste
kann davon abweichen.

**Folge für die App:** Die Bundeslandauswahl ist nicht nur Vorbereitung für später — sie ist schon
heute fachlich nötig. Ein Azubi in Bayern lernt für eine andere GaLaBau-Liste als einer in NRW.

---

## Was übernommen wurde: Nordrhein-Westfalen

Für die sechs fehlenden Fachrichtungen ist NRW aus drei Gründen die richtige erste Quelle:

1. **Vollständig.** Alle sechs Listen liegen vor, von einem Herausgeber, in einem Guss und mit
   demselben Stand (Dezember 2023).
2. **Anschlussfähig.** Dieselbe Landwirtschaftskammer gibt auch die drei überbetrieblichen
   GaLaBau-Kurse heraus, die im Repo schon liegen.
3. **Belastbar.** Die Listen nennen Herausgeber, Ort und Auflage im Vorwort. Bei Baden-Württemberg
   sind sie ausdrücklich nur eine Empfehlung, bei Niedersachsen steht ausdrücklich, dass auch
   anderes geprüft werden darf.

### Die sechs Quelldateien

| Fachrichtung | Datei | Seiten/Umfang |
|---|---|---|
| Baumschule | `gb-pflanzenliste-baumschule.pdf` | 155 KB |
| Friedhofsgärtnerei | `gb-pflanzenliste-friedhof.pdf` | 644 KB |
| Gemüsebau | `gb-pflanzenliste-gemuesebau.pdf` | 154 KB |
| Obstbau | `gb-pflanzenliste-obstbau.pdf` | 181 KB |
| Staudengärtnerei | `gb-pflanzenliste-staudengaertnerei.pdf` | 182 KB |
| Zierpflanzenbau | `gb-pflanzenliste-zierpflanzen.pdf` | 646 KB |

Alle unter `https://www.landwirtschaftskammer.de/bildung/pdf/`, verlinkt von der Übersichtsseite
[Pflanzenlisten, Arbeitsblätter](https://www.landwirtschaftskammer.de/bildung/gaertner/formulare/texte/index.htm).
Je Datei liegt eine `quelle.json` daneben — mit URL, Abrufdatum, Herausgeber, Auflage und
SHA-256-Prüfsumme. Damit ist in zwei Jahren beantwortbar, ob die Datei noch dieselbe ist.

⚠️ Die Landwirtschaftskammer führt **keine Jahreszahl im Dateinamen**. Eine neue Auflage ersetzt
die alte unter derselben URL. Ohne die Prüfsumme neben der Datei wäre nicht feststellbar, welcher
Stand gebaut wurde.

---

## 🔴 `ZP` — die Zwischenprüfung, und warum sie die Sortierung trägt

Vier der sechs Listen heben Pflanzen mit `ZP` (Staudengärtnerei: `Zp`) hervor. Die Listen erklären
es selbst:

> „Die mit ZP gekennzeichneten Pflanzennamen werden bei der **Zwischenprüfung** als
> Pflanzenkenntnisse bevorzugt angesprochen."

| Liste | markiert | von |
|---|---|---|
| Baumschule | 112 | 394 |
| Zierpflanzenbau | 95 | 371 |
| Staudengärtnerei | 89 | 301 |
| Friedhofsgärtnerei | 74 | 370 |
| Gemüsebau · Obstbau | — | keine Marke |

Das ist die **einzige Angabe im ganzen Dokument, die etwas über den Zeitpunkt sagt** — und der
Zeitpunkt wiegt für einen Azubi schwerer als die Häufigkeit: Wer im Frühjahr Zwischenprüfung hat,
muss diese Pflanzen jetzt können. Deshalb sortiert die Liste seit dem 30.08.2026 **erst nach
Prüfungszeitpunkt, dann nach Bekanntheit**.

⚠️ Die Marke gilt für den BLOCK, nicht die einzelne Zeile: Ist die Art markiert und eine ihrer
Sorten nicht, bleiben sie trotzdem beieinander — sonst stünde der Kugel-Ahorn am Listenende, weit
weg vom Spitz-Ahorn.

Gemüsebau und Obstbau kennen die Marke nicht; dort sortiert weiterhin allein die Bekanntheit.

⚠️ Die Zahlen oben sind am 31.08.2026 an den gebauten `full.ndjson` nachgezählt worden. Die
ursprüngliche Tabelle nannte Zierpflanzenbau mit 93 von 377 und Friedhofsgärtnerei mit 386 — das
war ein Stand VOR den letzten Parserkorrekturen und ist mitgewandert, ohne dass die Tabelle
nachgezogen wurde.

🔴 Und ein zweiter Befund, der die Marke fast wertlos gemacht hätte: Sie stand zwar in jeder
`full.ndjson`, aber im **Schema der Datenbank fehlte das Feld**. Mongoose hat sie beim Import
wortlos verworfen — in der Datenbank stand über alle zehn Listen hinweg NULL. Aufgefallen ist es
nicht, weil die Sortierung trotzdem stimmte: Die steckt fertig im `sortIndex`, den diese Pipeline
berechnet. Verloren war nur die Marke selbst. Behoben am 31.08.2026.

---

## Vier verschiedene Bauarten in sechs Dateien

Die Listen sind nicht nach einem gemeinsamen Muster gesetzt. Wer einen Parser schreibt, braucht
vier:

**A — Gattungsblock mit Betonungszeichen** (Baumschule, Friedhofsgärtnerei, Zierpflanzenbau)

```
Ábies - Tanne, Pináceae
      - álba, Weiß-Tanne
ZP + - balsámea ‘Nána’, Kleine Balsam-Tanne
```

Die Gattung eröffnet den Block, die Zeilen darunter tragen nur das Artepitheton. `- -` markiert
eine Sorte der zuvor genannten Art. Vorangestellt stehen Prüfungs- und Pflanzenzeichen (`ZP`, `+`).
🔴 Die Namen tragen **Betonungsakzente** (`Ábies`, `álba`, `campéstre`) — die sind keine Diakritika
des Namens, sondern eine Lesehilfe und müssen für den botanischen Namen weg.

**B — Dreizeiler** (Staudengärtnerei)

```
Zp   Ajuga reptans            V-VI        GR
     Lamiaceae
     Kriechender Günsel
```

Botanischer Name, Blütezeit, Lebensbereich · Familie · deutscher Name.

**C — Einzeiler** (Gemüsebau)

```
Allium cepa            Alliaceae      Küchen-Zwiebel
```

**D — Deutsch zuerst, mit Unterblöcken** (Obstbau)

```
Apfelbaum   Malus domestica   Fam.: Rosaceae
Sorten:     Delbarestival (=Delcorf)
            Gala …
Unterlagen: M27, M9 …
```

⚠️ Der Obstbau führt Sorten, Pollenspender, **Unterlagen** und Zwischenveredelungen. Unterlagen
(`M9`, `Bittenfelder Sämling`) sind keine Pflanzen im Sinne des Katalogs — sie gehören nicht in die
Lernliste und müssen ausdrücklich verworfen werden.

**E — ohne Striche, mit Einrückung** (Anhang der Friedhofsgärtnerei)

```
Abies alba, Weiß-Tanne, Pinaceae
     grandis, Große Küsten-Tanne          ← Art derselben Gattung
     ‘Ellwoodii’, Lawsons Scheinzypresse  ← Sorte der vorigen Art
```

Die Wiederholung steckt hier in der Einrückung statt in einem Zeichen.

### 🔴 Die Striche ERSETZEN, sie schachteln nicht

Der Punkt, an dem zwei Anläufe gescheitert sind. **n Striche = die ersten n Namensteile des
vorigen Eintrags**, danach folgt der neue Teil:

```
Chamaecyparis - Scheinzypresse, Cupressaceae
      - lawsoniana          →  Chamaecyparis lawsoniana
      - - ‘Columnaris’      →  Chamaecyparis lawsoniana ‘Columnaris’
```

Mit einer Ausnahme, die alles entscheidet: Endet der vorige Name selbst auf einem Sortennamen,
wird der **ersetzt** und nicht behalten —

```
Rhododendron-Hybride ‘Beethoven’
      - - ‘Vuyk’s Scarlet’  →  Rhododendron-Hybride ‘Vuyk’s Scarlet’
```

Sonst entsteht `Rhododendron-Hybride ‘Beethoven’ ‘Vuyk’s Scarlet’` — zwei Sorten in einem Namen.

---

## Die drei überbetrieblichen Pflichtkurse (01 · 07 · 12)

Sie liegen unter `garten-und-landschaftsbau/north-rhine-westphalia/` und sind **keine bundesweiten
Listen**: Die Lehrgänge richtet die Landwirtschaftskammer NRW aus, die Kursnummern gibt es nur dort.
Ihre Vorlagen sind die drei PDFs in `sources/2026-02/`.

Bis zum 31.08.2026 stammten die `course-*.ndjson` **nicht** aus diesen PDFs, sondern aus
`data/reference/galabau_pflanzen.json` — einer selbst schon sortenbereinigten Datei. Was dabei
herauskam, war zu kurz:

| | vorher | aus dem PDF |
|---|---|---|
| Kurs 01 | 67 | **71** |
| Kurs 07 | 59 | **63** |
| Kurs 12 | 69 | **78** |

### 🔴 Warum diese drei einen eigenen Leser brauchen

Die sechs Fachrichtungslisten sind Fließtext mit Strichen. Diese drei sind echte Tabellen —
`Nr. · Gattung · Art · Sorte · Deutscher Name · Hinweis` — und das ist die schwierigere Vorlage,
nicht die leichtere. `pdftotext -layout` presst sie in Zeichenspalten und zerlegt dabei genau die
Zeilen falsch, auf die es ankommt:

```
4.   Dianthus   gratianopolitanus 'Sorte'   Garten-Pfingst-Nelke
7.   Sedum      floriferum   'Weihenstephaner Teppich-Sedum
                             Gold'
```

Im ersten Fall trennt Art und Sorte **ein einziges Leerzeichen**; im zweiten ragt die Sorte in die
Namensspalte und schiebt den deutschen Namen nach rechts. Gelesen wird deshalb mit
`pdftotext -bbox-layout`: XHTML mit der **x-Koordinate jedes Wortes**. `gratianopolitanus` liegt bei
x=147,6 und `'Sorte'` bei x=242,3 — im Flachtext ein Leerzeichen auseinander, in Wahrheit zwei
Spalten.

**Die Spalten gehören dem Tabellenblock, nicht der Seite.** Auf Seite 4 von Kurs 12 stehen fünf
Tabellen untereinander, jede mit eigener Spaltenlage. Wer je Seite eine Lage nimmt, bekommt ab der
zweiten Tabelle den deutschen Namen in die Sortenspalte.

### Die Sonderfälle, benannt

| Vorlage | Ergebnis | Regel |
|---|---|---|
| `'Sorte'` | fällt weg | Platzhalter für „irgendeine Sorte", kein Sortenname |
| `Buxus sempervirens` + `var.` + `arborescens` über drei Zeilen | `Buxus sempervirens var. arborescens` | Fortsetzung wird spaltenweise angehängt |
| `Hydrangea anomala` + Sorte `subsp. petiolaris` | `Hydrangea anomala subsp. petiolaris` | ein RANG in der Sortenspalte gehört an den Namen |
| `Taraxacum` + Art `sect.` + Sorte `Ruderalia` | `Taraxacum sect. Ruderalia` | dito, über die Artspalte erkannt |
| `Rosa` + Art `'Sorte'` + Sorte `Beetrosen` | `Rosa (Beetrosen)` | Rosenklasse, in Klammern wie in der bundesweiten Liste |
| `Hänge-` / `Birke` über zwei Zeilen | `Hänge-Birke` | Silbentrennung: bei `-` ohne Leerzeichen verbinden |

⚠️ Die Rosen waren zugleich die Falle beim Entdoppeln: `vergleichsname` wirft geklammerte Zusätze
weg — für den Katalogabgleich richtig, hier fatal. Alle drei Klassen ergaben „rosa", und zwei
Zeilen des Prüfungsblatts verschwanden. Entdoppelt wird deshalb über den Anzeigenamen, abgeglichen
weiter über `vergleichsname`.

### Der Beweis, dass nichts fehlt

Die Vorlage nummeriert je Abschnitt von 1 an. Geparste Anzahl und höchste Nummer im PDF müssen
deshalb übereinstimmen — in allen 18 Abschnitten der drei Kurse tun sie das:

```
Kurs 01  Laubgehölze 34/34 · Nadelgehölze 6/6 · Stauden 30/30 · Ziergräser 1/1
Kurs 07  Laubgehölze 32/32 · Nadelgehölze 13/13 · Obstgehölze 8/8 · Stauden 8/8 · Ziergräser 2/2
Kurs 12  Laubgehölze 45/45 · Nadelgehölze 3/3 · Innenraum 4/4 · Stauden 12/12 · Zwiebeln 1/1
         Ziergräser 3/3 · Farne 3/3 · Beet/Balkon 1/1 · Unkräuter 6/6
```

**212 Einträge · 0 verworfen · 0 Dubletten · 165 aufgelöst (78 %).**

### 🔴 Ein Befund über die Suche, nicht über die Listen

Sechzehn Kursnamen weichen vom Katalognamen ab. Acht davon sind Hybriden — und die waren in der App
**nicht auffindbar**, wenn man sie so tippt, wie sie auf dem Blatt stehen:

```
Katalog:  „Platanus ×hispanica"   → platanushispanica
Eingabe:  „Platanus x hispanica"  → platanusxhispanica   ✗
```

Die Normalisierung wirft alles Nicht-Alphanumerische weg. Das **Malzeichen** `×` fällt darunter,
der **Buchstabe** `x` nicht. Betroffen sind **274 Pflanzen des Katalogs (1,9 %)** — und die App
zeigt das Malzeichen an, wer also abtippt, was er sieht, findet nichts.

Behoben durch `dropHybridMarker` in `pipeline/lib/search-normalize.js` und der Zwillingsdatei der
App. ⚠️ An den gebauten Suchbegriffen ändert die Regel **nichts** — an allen 133.263 Namen
nachgerechnet, null Abweichungen. Ein Neuaufbau des Katalogs ist dafür nicht nötig.

---

## Quellen

- Landwirtschaftskammer NRW — [Pflanzenlisten, Arbeitsblätter](https://www.landwirtschaftskammer.de/bildung/gaertner/formulare/texte/index.htm)
- Landwirtschaftskammer NRW — [Informationen zur Prüfung](https://www.landwirtschaftskammer.de/bildung/gaertner/pruefungen/index.htm)
- StMELF Bayern — [Formulare, Verträge, Arbeitsunterlagen Gärtner/in](https://www.stmelf.bayern.de/bildung/agrarbereich/formulare-vertraege-arbeitsunterlagen-gaertner-in/index.html)
- AELF Augsburg — [Pflanzenliste für die Baumschule (Stand März 2018)](https://www.aelf-au.bayern.de/mam/cms10/aelf-au/bildung/dateien/pflanenliste_f%C3%BCr_die_baumschule.pdf)
- StMELF Bayern — [Pflanzenliste GaLaBau (Stand 05/2022)](https://www.stmelf.bayern.de/mam/cms01/berufsbildung/dateien/pflanzenliste_gala.pdf)
- Landwirtschaftskammer Niedersachsen — [Downloadcenter Gärtner/in](https://www.lwk-niedersachsen.de/lwk/downloadcenter/825_Gaertnerin)
- Landwirtschaftsamt Landkreis Karlsruhe — [Pflanzenlisten](https://karlsruhe.landwirtschaft-bw.de/,Lde/Startseite/Fachschule+und+Ausbildung/Pflanzenlisten)
- AuGaLa — [Lernmittel](https://www.augala.de/lernmittel.aspx) (Quelle der bestehenden GaLaBau-Liste)
