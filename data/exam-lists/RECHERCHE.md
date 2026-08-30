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
