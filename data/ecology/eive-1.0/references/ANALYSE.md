# EIVE 1.0 — Struktur, Abgleich und Machbarkeitsmessung

> Stand: 02.08.2026 (Abschnitt 4 und 8 fortgeschrieben) · Alle Zahlen dieses Berichts
> sind **gemessen**, nicht geschätzt.
> Reproduzierbar aus `EIVE_Paper_1.0_SM_08.xlsx` (MD5 `0f0ce19cd2a781eeed027d8b0acadbcb`).
> Selbsttragend: dieser Bericht reicht ohne den Chatverlauf, aus dem er entstand.

---

## 1 · Quelle

- **Zenodo-Record** `7534792`, DOI `10.5281/zenodo.7534792`, publiziert 13.01.2023, **CC BY 4.0**.
  Keine neuere Version dieses Records. EIVE 1.5 ist als Datensatz nicht auffindbar publiziert
  (Suchstand 01.08.2026); der angekündigte Zuwachs sind Moose, Flechten und Makroalgen und wäre für
  diesen Katalog irrelevant.
- **Paper:** Dengler J., Jansen F., … Gillet F. (2023): *Ecological Indicator Values for Europe
  (EIVE) 1.0.* Vegetation Classification and Survey 4: 7–29. `10.3897/VCS.98324`.
- **Dateien** (Download `https://zenodo.org/api/records/7534792/files/<name>/content`):

  | Datei | Bytes | MD5 | Inhalt |
  |---|---|---|---|
  | `EIVE_Paper_1.0_SM_08.xlsx` | 2.900.881 | `0f0ce19cd2a781eeed027d8b0acadbcb` | **die Werte** |
  | `EIVE_Paper_1.0_SM_03.xlsx` | 409.498 | `b94eec01646fde3cc8383146efcdbdff` | Backbone-Abweichungen |
  | `EIVE_Paper_1.0_SM_02.xlsx` | 16.095.770 | `d10bf808f7c4d734fe0875566c4069cb` | 31 Quellsysteme mit Original- und harmonisierten Namen |

- Es gibt **keine CSV-Variante, kein GitHub-Repo, kein CRAN-Paket**. Der R-Code ist laut Paper nur
  „available upon request". Die xlsx ist der einzige Weg.

---

## 2 · Struktur von SM_08 — gemessen, nicht vermutet

Zwei Blätter: `Readme` und **`mainTable`** (14.836 Zeilen, davon 1 Kopfzeile → **14.835 Datenzeilen**).

**Die Spalten heißen `EIVEres-…`, nicht `EIVE-…`** wie der Fließtext des Papers nahelegt:

```
TaxonConcept | UUID | TaxonRank | AccordingTo
EIVEres-M | EIVEres-M.nw3 | EIVEres-M.n
EIVEres-N | EIVEres-N.nw3 | EIVEres-N.n
EIVEres-R | EIVEres-R.nw3 | EIVEres-R.n
EIVEres-L | EIVEres-L.nw3 | EIVEres-L.n
EIVEres-T | EIVEres-T.nw3 | EIVEres-T.n
```

**Alle Kontrollzahlen des Papers stimmen exakt:**

| Prüfung | erwartet | gemessen |
|---|---|---|
| Datenzeilen | 14.835 | **14.835** ✅ |
| belegt M / N / R / L / T | 14.714 / 13.748 / 14.254 / 14.054 / 14.496 | **identisch** ✅ |
| Rang Species | 11.148 | **11.148** ✅ |
| Rang Subspecies | 2.899 | **2.899** ✅ |
| Aggregate / s. l. / Variety / Section | 664 / 60 / 42 / 22 | **identisch** ✅ |

`AccordingTo`: EuroMed 13.016 · additionalTaxa 901 · additionalAggregates 514 · additionalHybrids 404.
Wertebereiche: Position 0,00–10,00 · Breite 0,08–10,00 · `n` 1–29.

### 2.1 Semantische Prüfung — die Spaltenzuordnung ist bewiesen

Eine um eine Spalte verschobene Zuordnung liefert plausible Zahlen im richtigen Bereich und fiele
erst im Handbuch auf. Deshalb Korrelation gegen die heutigen Tichý-Werte über die Namensschnittmenge:

| EIVE | Tichý | Paare | Pearson r |
|---|---|---|---|
| L | light | 7.731 | **0,922** |
| T | temperature | 6.939 | **0,961** |
| M | moisture | 7.676 | **0,943** |
| R | ph | 7.011 | **0,932** |
| N | nutrients | 6.860 | **0,956** |

Kreuzprobe (jede EIVE-Spalte gegen jede Tichý-Spalte): die Diagonale liegt bei 0,92–0,96, **jede**
Fremdkorrelation bei |r| ≤ 0,37. Eine Vertauschung ist damit ausgeschlossen.

---

## 3 · 🔴 Der Befund, der das Konzept verändert hat

### 3.1 `n` ist viel kleiner als gedacht

Anteil der Arten (Rang Species), deren Wert auf mindestens *k* Quellsystemen beruht:

| Faktor | n ≥ 1 | n ≥ 2 | n ≥ 3 | n ≥ 5 | n ≥ 10 | Median |
|---|---|---|---|---|---|---|
| M | 100 % | 59,3 % | 43,5 % | 30,6 % | 19,8 % | **2** |
| N | 100 % | 58,5 % | 42,6 % | 29,4 % | 17,5 % | **2** |
| R | 100 % | 58,6 % | 42,8 % | 30,0 % | 18,2 % | **2** |
| L | 100 % | 58,1 % | 42,0 % | 28,7 % | 16,9 % | **2** |
| T | 100 % | 58,3 % | 42,4 % | 29,3 % | 17,7 % | **2** |

Rund **40 % aller Arten haben nur ein einziges Quellsystem** — dort gibt es gar keinen Konsens,
nur eine Meinung.

### 3.2 Die Nischenbreite misst zum Teil Uneinigkeit, nicht Toleranz

Median der Nischenbreite, aufgeschlüsselt nach der Zahl der Quellsysteme:

| n | M | N | R | L | T | Arten |
|---|---|---|---|---|---|---|
| 1 | 2,47 | 2,86 | 2,78 | 2,77 | 2,64 | 4.494 |
| 2 | 3,02 | 3,72 | 3,64 | 3,60 | 3,18 | 1.750 |
| 3–4 | 3,33 | 4,11 | 4,28 | 3,81 | 3,64 | 1.420 |
| 5–9 | 3,28 | 4,58 | 4,54 | 3,90 | 3,74 | 1.193 |
| 10+ | 3,24 | 4,92 | 4,55 | 4,42 | 3,83 | 2.189 |

Die Breite **wächst monoton mit `n`**. Sie ist als `nw3` = min(10, mittlere Amplitude + 2σ der
Position) definiert — der σ-Term ist die Streuung *zwischen den Quellsystemen*. Je mehr Systeme,
desto mehr Uneinigkeit fließt ein.

**Konkretes Beispiel:** *Abies alba* (Weiß-Tanne), L: Position **3,04** (ausgesprochener
Schattenzeiger), Breite **8,37** bei n = 15. Eine Weiß-Tanne ist nicht lichtindifferent — die 8,37
sind überwiegend Uneinigkeit der Quellwerke.

> **Konsequenz für das Handbuch:** Die Aussage „breites Band = duldsame Pflanze" ist für gut belegte
> Arten **falsch**. Wenn die Breite gezeigt wird, dann als Unschärfe der Quellenlage, nicht als
> ökologische Eigenschaft der Art — oder gar nicht.

### 3.3 Deshalb taugt die Bandbreite nicht als Filterregel

Anteil zufälliger Artenpaare mit mindestens einem Faktor, dessen **Bänder disjunkt** sind:

| Regel | mind. ein tauglicher Faktor |
|---|---|
| Bänder disjunkt, `n ≥ 1` | 56,5 % |
| Bänder disjunkt, `n ≥ 2` | **13,9 %** |
| Bänder disjunkt, `n ≥ 3` | 6,6 % |
| Bänder disjunkt, `n ≥ 5` | 2,9 % |

Qualitätsfilter und Spielmechanik arbeiten **gegeneinander**: Je besser ein Wert belegt ist, desto
breiter das Band, desto seltener die Trennung. Die ursprünglich vorgesehene Regel („Bänder disjunkt
**und** niedriges `n` fällt raus") hätte den Quiztyp praktisch unsichtbar gemacht.

---

## 4 · Die Zonenregel — der Ausweg, gemessen

Statt Bandtrennung: die Skala wird je Faktor in **drei benannte Zonen** geteilt.

> ### 🔴 Fortgeschrieben am 02.08.2026 — die Grenzen dieses Abschnitts galten kurz und sind ersetzt
>
> Die erste Fassung nahm die **Terzile der europäischen Gesamtflora** (L 7,19 / 8,20 · M 3,10 / 4,41
> · T 4,01 / 5,50 · N 2,94 / 4,92 · R 5,86 / 7,29). Abgenommen und ausgeliefert sind andere: die
> **aus Ellenberg hergeleiteten**. Wer nach den alten baut, bekommt andere Zonenwörter.

| Faktor | untere Grenze | obere Grenze | Wort 1 | Wort 2 | Wort 3 |
|---|---|---|---|---|---|
| **L** Licht | 3,15 | 6,40 | Schattig | Halbschattig | Sonnig |
| **M** Feuchte | 3,70 | 5,19 | Trocken | Frisch | Feucht |
| **T** Wärme | 2,69 | 4,98 | Kühl | Mäßig warm | Warm |
| **N** Stickstoff | 3,62 | 6,55 | Mager | Mäßig | Stickstoffreich |
| **R** Boden-pH | 3,73 | 6,68 | Sauer | Mäßig sauer | Kalkreich |

**Herkunft:** Die Klassengrenzen von Ellenberg et al. (1991) wurden über eine Regression
EIVE ↔ Tichý (n = 6.860–7.731 Arten, r = 0,92–0,96) auf die EIVE-Skala abgebildet. Die Wörter sind
Ellenbergs Stufenbezeichnungen, zu Dritteln zusammengefasst.

⚠️ **Feste Drittel (3,33 / 6,67) wären grob falsch.** Die Verteilungen sind stark verschoben: der
L-Median liegt bei 7,70 — fast alle europäischen Arten sind lichtliebend.

### Der Einwand gegen die hergeleiteten Grenzen — nachgemessen, sie halten

Gegen L 3,15 / 6,40 lässt sich einwenden, dass damit fast alles „Sonnig" heißt. Über die **gesamte
Flora** stimmt das; über das Sortiment, das die App zeigt, nicht:

| Grundgesamtheit | Schattig | Halbschattig | Sonnig |
|---|---|---|---|
| europäische Flora (10.121 Arten mit L) | 1,5 % | 17,9 % | **80,6 %** |
| **AuGaLa-Prüfungssortiment (131 Arten)** | **4,6 %** | **57,3 %** | **38,2 %** |

Und die Stichproben sitzen botanisch: Rot-Buche 3,00 schattig · Hainbuche 3,65, Eibe 3,39,
Feld-Ahorn 5,05, Stiel-Eiche 6,24 halbschattig · Birke 6,84, Kiefer 7,10, Besenheide 7,25,
Thymian 7,35, Lavendel 7,41 sonnig.

Im Sortiment liegen alle fünf Faktoren bei 57–72 % in der Mittelzone — für ein Gartensortiment zu
erwarten. Die feinere Aussage tragen **Band und Positionsmarke**, nicht das Wort.

### Wie oft die Runde erscheint — die Fassung, die gebaut wurde

Die Runde entsteht, wenn die Nischenpositionen auf einem Faktor mindestens **2,0** auseinanderliegen
(`FAIR_DISTANCE`). Sonst wird sie zum Infoscreen; hat eine Pflanze keine Werte, entfällt sie ganz.

| Liste | Arten mit EIVE | **Zuordnen** | Infoscreen | übersprungen |
|---|---|---|---|---|
| `full` | 131 von 201 | **30,1 %** | 12,3 % | 57,6 % |
| `course-01` | 45 von 71 | 25,4 % | 14,5 % | 60,2 % |
| `course-07` | 39 von 61 | 30,3 % | 10,2 % | 59,5 % |
| `course-12` | 53 von 76 | **34,7 %** | 13,6 % | 51,6 % |

Bezogen nur auf Paare, bei denen **beide** Pflanzen Werte haben: 71 % Zuordnen zu 29 % Infoscreen.
Beides sind richtige Zahlen für verschiedene Fragen — die Tabelle oben ist die produktrelevante.

**Die Bänder sind unterscheidbar:** Jaccard-Überlappung auf dem gewählten Faktor Median **0,20**,
Abstand der linken Bandkanten Median **3,4 Punkte**; nur 3–4 % der zuordenbaren Paare verschwimmen.

⚠️ Bei **44 %** der Karten berührt das Band alle drei Zonen (Weiß-Tanne, Licht: Position 3,0
„Schattig", Band aber 0,0–7,2). Deshalb trägt jedes Band eine **Positionsmarke** — ohne sie
widerspräche das Bild dem Wort.

**Kein `n`-Filter:** `n ≥ 2` halbiert das Zuordnen-Format (71 % → 44–61 %) und kauft nichts, was
`FAIR_DISTANCE` nicht schon leistet.

---

## 5 · Abdeckung — gemessen an den echten Prüfungspflanzen

Gemessen gegen die AuGaLa-Prüfungslisten aus diesem Repo
(`data/exam-lists/gartenbau/garten-und-landschaftsbau/national/`) — also gegen genau die Arten, die
Azubis lernen, nicht gegen einen Zufallskatalog.

| Liste | Arten | **EIVE** | Tichý (heute) |
|---|---|---|---|
| `full.ndjson` | 205 | **133 = 65 %** | 111 = 54 % |
| `course-01` | 71 | **45 = 63 %** | 39 = 55 % |
| `course-07` | 63 | **39 = 62 %** | 36 = 57 % |
| `course-12` | 78 | **55 = 71 %** | 42 = 54 % |

**EIVE deckt die Prüfungspflanzen um rund 11 Prozentpunkte besser ab als Tichý** — ein relativer
Zugewinn von etwa einem Fünftel. Das beantwortet die offene Frage „lohnt der Wechsel überhaupt" mit
einer Zahl statt einer Schätzung.

Was auch EIVE nicht hat, ist erwartungsgemäß das außereuropäische Ziersortiment:
*Abies koreana*, *Cornus kousa*, *Ginkgo biloba*, *Chamaecyparis obtusa*, *Cortaderia selloana*,
*Euonymus fortunei*, *Carex morrowii*, *Deutzia gracilis* … Diese Arten stehen in **keinem** der
beiden Datensätze, weil beide die europäische Wildflora beschreiben.

*(Nur Direktpass über normalisierte Binomen. Die GBIF-Synonymbrücke und der `taxonKey`-Pass sind
noch nicht gelaufen — sie können die Zahlen nur verbessern.)*

---

## 6 · Wie oft der Quiztyp erscheinen würde

Gemessen über **alle Paare innerhalb derselben Liste** — die Warteschlange zieht die Pflanzen aus
der Sammlung des Nutzers, also aus derselben gemeinsam hinzugefügten Liste:

| Liste | beidseitige Abdeckung | 2 Zonen | 1 Zone | gleiche Zone | Abstand ≥ 2,5 |
|---|---|---|---|---|---|
| `full` | **42 %** | 36 % | 58 % | 5 % | 52 % |
| `course-01` | **40 %** | 28 % | 67 % | 5 % | 41 % |
| `course-07` | **38 %** | 37 % | 60 % | 3 % | 57 % |
| `course-12` | **50 %** | 37 % | 56 % | 7 % | 52 % |

**→ Die Runde erschiene an 38–50 % der Zwischenstände.** Begrenzt wird sie allein durch die
Abdeckung: Von den Paaren, bei denen beide Pflanzen Werte haben, liefert die Zonenregel in **100 %**
der Fälle eine Aufgabe.

Zum Vergleich, was die Alternativen gekostet hätten:

| Regel | Anteil der Zwischenstände |
|---|---|
| **Zonenregel** (Gleichstand ist eine eigene Aussage) | **38–50 %** |
| Positionsabstand ≥ 2,5 | 17–26 % |
| Bänder disjunkt, `n ≥ 1` | ~21 % |
| Bänder disjunkt, `n ≥ 2` (ursprüngliche Vorgabe) | ~5 % |

---

## 7 · Der abgeleitete Slim-Datensatz

`eive-slim.json` — **10.693 Arten**, 1.779.996 Bytes, keyed nach normalisiertem Binomial
(Kleinschreibung, `genus species`).

Aufbau je Art: `{ L: {p, w, n}, T: {…}, M: {…}, R: {…}, N: {…} }` — Position, Breite, Quellsysteme,
auf zwei Nachkommastellen gerundet. Fehlende Faktoren fehlen, sie werden nicht mit Null aufgefüllt.

Abdeckung im Slim: L 10.121 · T 10.405 · M 10.599 · R 10.196 · N 9.849.

Übersprungen: 3.687 Nicht-Arten (Unterarten, Aggregate, Sektionen, Varietäten), 427 Hybriden,
25 Namenskollisionen nach Normalisierung. Die Kollisionen behalten den **ersten** Treffer — das ist
für einen Lernkatalog vertretbar, für eine wissenschaftliche Auswertung nicht.

---

## 8 · Der volle Katalogabgleich — gelaufen am 02.08.2026

Gegen den lokalen Spiegel (`localhost:27017/myflora`, 5.551 Pflanzen), mit
`npm run analyze:eive-match -- --report`:

| | |
|---|---|
| Pflanzen im Katalog | 5.551 |
| **mit EIVE** | **3.705 = 66,7 %** |
| heute mit Tichý | 3.341 (Spiegel) · 3.363 (Prod) |
| **gewonnen** (heute leer, mit EIVE belegt) | **445** |
| **verloren** (heute belegt, in EIVE nicht auffindbar) | **81** |
| netto | **+364** |
| je Faktor | L 3.689 · T 3.695 · M 3.694 · R 3.650 · N 3.648 |

Direktpass 3.639, GBIF-Synonymbrücke +66, dabei **274 Verwechslungskandidaten abgelehnt** statt
geraten (fremdes Epitheton oder uneindeutig).

ℹ️ Prod (Atlas `dev`) führt **3.363** mit Tichý-Werten, der lokale Spiegel **3.341** — der Spiegel
hinkt um 22 Pflanzen hinterher. Der EIVE-Abgleich ergibt auf beiden dieselben **3.705**.

**Von 188 Prüfungspflanzen verlieren vier ihre Karte:** Polster-Glockenblume, Amberbaum, Kulturapfel,
Brombeere. Alle vier in der Quelle nachgeschlagen — EIVE führt sie nicht, und die Alternative wäre
der Wert einer *anderen* Art gewesen (beim Amberbaum stünde sonst *Liquidambar orientalis*). Das
Überspringen ist richtig.

**Die Synonymbrücke ist bewiesen:** *Papaver cambricum* fehlt im Direktpass und löst über den
Euro+Med-Namen *Meconopsis cambrica* auf.

### 🔴 Ein Datenfehler, gefunden beim Bauen des Slim

**Sanddorn steht zweimal in EIVE:**

```
"Hippophae rhamnoides"  Species  additionalTaxa  L 7,63  w 2,20  n 1
"Hippophaë rhamnoides"  Species  EuroMed         L 8,30  w 4,41  n 13
```

Dieselbe Art, einmal unter dem Euro+Med-Backbone-Namen und einmal als ASCII-Dublette aus **einem**
Quellsystem. Der Katalog schreibt sie ohne Trema — eine Erst-gewinnt-Regel hätte dem Azubi den
n=1-Wert gegeben, und weil beide auf „sonnig" runden, wäre es nie aufgefallen. `build-eive-dataset.js`
bevorzugt jetzt den Euro+Med-Datensatz und meldet jede Wertänderung, bevor es schreibt.

Sieben Schlüssel tragen Diakritika (`hierochloë ×5`, `hippophaë`, `limonium tarcoënse`); der Slim
führt beide Schreibweisen, damit weder Katalog noch Matcher davon wissen muss. **Fünf davon hätten
sonst ihre heutigen Tichý-Werte verloren.**

## 9 · Was noch offen ist

- **`taxonKey`-Pass** als dritter Abgleichweg: nicht gebaut. Direktpass und Synonymbrücke laufen.
- **`n` im Handbuch anzeigen?** Der Wert reist im Datensatz und im Standort-Block mit, wird aber
  nirgends gezeigt.
