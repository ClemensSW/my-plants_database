# pipeline/ — Katalog-Pipeline

Eigenständige Pipeline neben `legacy/` (der eingefrorenen GBIF-Pipeline). Sie teilt **keinen Code**
mit der alten und
hat **keine npm-Abhängigkeiten** (Node ≥ 18 reicht, `fetch` ist eingebaut). `legacy/` bleibt
unverändert und weiter lauffähig.

---

## 📅 Der tägliche Bilderlauf — Kurzanleitung

Pl@ntNet erlaubt **10.000 Anfragen je Pfad und 24-Stunden-Fenster**. Der Bildabruf braucht deshalb
mehrere Tage. Der Lauf ist wiederaufnehmbar und hört von selbst auf, wenn das Kontingent leer ist.

### 1. Vorher prüfen: bin ich noch gedrosselt?

```bash
curl -sI "https://api.plantnet.org/v1/projects/k-world-flora/species/Betula%20pendula%20Roth?lang=de" \
  | grep -iE "HTTP|ratelimit"
```

| Antwort | Bedeutung |
|---|---|
| `HTTP/2 200`, keine Ratelimit-Zeilen | **frei** — Lauf starten |
| `HTTP/2 429` + `x-ratelimit-userpathremaining: -1` | **gesperrt** — Freigabezeit steht in `x-ratelimit-userpathreset` (Millisekunden seit Epoch) |

Reset-Zeit lesbar machen:
```bash
python3 -c "import datetime;print(datetime.datetime.fromtimestamp(<WERT>/1000).strftime('%d.%m.%Y %H:%M'))"
```

### 2. Lauf starten

```bash
cd /Users/clemenssw/Developer/MyPlants/myplants-database
npm run new:fetch-images
```

Keine Argumente nötig. Der Lauf überspringt erledigte Arten, arbeitet **nach Bilderzahl absteigend**
(das Wertvollste zuerst) und hängt an die bestehenden Dateien an.

### 3. Was auf dem Schirm steht

```
Kontingent:       [........................] 0/10.000  – neues 24-Stunden-Fenster
heute noch frei:  10.000 Anfragen → reicht für etwa 10.000 der 74.397 offenen Arten
…
  1.250/74.397 Arten · 66.320 Bilder · 412s · Kontingent [###.....................] 1.254/10.000
  ⚠ nur noch 500 Anfragen frei
…
⛔ Tageskontingent von Pl@ntNet aufgebraucht – Lauf geordnet beendet.
   Wieder frei: 20.8.2026, 18:14:29 (in 23.9 h)
```

Der Lauf zählt **HTTP-Anfragen, nicht Arten** — ein Wiederholungsversuch belastet das Konto genauso.
Der Stand hält über Läufe hinweg in `data/state/plantnet_quota.json`.

### 4. Unterbrechen ist unproblematisch

Ctrl-C, Deckel zu, Netz weg — beim nächsten Start geht es an derselben Stelle weiter
(`data/state/plantnet_images.done`). Nur ein **harter** Abbruch mitten in einer Art kann deren
Bilder doppelt schreiben; ein Unique-Index auf `imageId` beim Import räumt das auf.

### 5. Wenn 429er kommen, obwohl der Zähler niedrig steht

Dann gibt es doch ein Kurzzeitlimit. Zurück auf die belegt unproblematische Gangart:

```bash
npm run new:fetch-images -- --delay=250 --concurrency=2
```

*(Standard sind 100 ms / 3 parallel ≈ 8,6 Anfragen/s. Gemessen und ohne Beanstandung gelaufen sind
bisher 2,8 Anfragen/s über 100 Minuten.)*

---

## Warum ein Neuaufbau

Die alte Pipeline beginnt mit **einem Bilddatensatz** (Pl@ntNet) und leitet daraus ab, welche
Pflanzen es im Katalog gibt. Damit entscheidet eine fremde Foto-Community über den Artbestand —
gemessen am AuGaLa-Prüfungssortiment fehlen so 17 % der Prüfungsarten, bei Gartenhybriden sogar
91 %, obwohl GBIF für **alle** davon genügend Bilder führt.

Die neue Pipeline dreht die Richtung um:

> **Schritt 1 holt das vollständige taxonomische Fundament. Gefiltert wird später.**

Bilder, Trivialnamen, Zeigerwerte und Verbreitung sind Eigenschaften, die sich ändern und aus
neuen Quellen nachwachsen können. Der akzeptierte Artbestand ist das Fundament — es wird einmal
vollständig geholt und danach nur noch angereichert.

## Schritt 1 — `01_fetch_species.js`

Holt **alle** Taxa mit `rank = SPECIES` und `status = ACCEPTED` unterhalb eines Wurzeltaxons aus
der **GBIF Backbone Taxonomy** (`d7dddbf4-2cf0-4f39-9b2a-bb099caae36c`). Standard-Wurzel ist
Plantae (`key 6`) mit derzeit **446.842 akzeptierten Arten**.

Kein Filter nach Bildern, Trivialnamen, Verbreitung oder Aussterbestatus. Hybriden auf Artrang
(`Forsythia × intermedia` und Verwandte) sind enthalten — sie sind im Backbone reguläre Arten und
im Gartenbau Kernsortiment.

```bash
node pipeline/01_fetch_species.js                 # Plantae, komplett
node pipeline/01_fetch_species.js --plan-only     # nur den Scheibenplan bauen
node pipeline/01_fetch_species.js --root-key=7707728   # nur Gefäßpflanzen
node pipeline/01_fetch_species.js --languages=deu,ger,eng
node pipeline/01_fetch_species.js --fresh         # von vorn
```

| Option | Standard | Bedeutung |
|---|---|---|
| `--root-key` | `6` (Plantae) | Wurzeltaxon |
| `--max-slice` | `5000` | Obergrenze Arten je Scheibe |
| `--page-size` | `1000` | Treffer je Seite (API-Maximum) |
| `--concurrency` | `5` | parallele Anfragen |
| `--languages` | alle | Sprachcodes der zu behaltenden Trivialnamen |
| `--out` | `data/raw/gbif/species_accepted.ndjson` | Zieldatei (Zustand folgt mit) |
| `--plan-only` | – | nur planen, nicht ernten |
| `--fresh` | – | Ausgabe und Zustand löschen |

## Drei gemessene API-Eigenschaften, auf denen der Aufbau beruht

**1. `offset ≥ 100.000` beantwortet `species/search` mit HTTP 400.** 446.842 Arten passen damit
nicht in eine Abfrage. Der Bestand muss geschnitten werden.

**2. Ab Offset 10.000 bricht die Antwortzeit ein.** Gemessen mit `limit=1000`:

| Offset | 0 | 2.000 | 5.000 | **10.000** | 20.000 | 30.000 | 80.000 |
|---|---|---|---|---|---|---|---|
| Antwort | 1,5 s | 1,8 s | 0,5 s | **29,1 s** | 34,0 s | 44,6 s | 31,0 s |

Deshalb `--max-slice=5000`: So bleibt jeder Offset unter 5.000 und jede Seite unter zwei Sekunden.
Größere Scheiben sparen Zählabfragen, kosten aber ein Vielfaches an Seitenzeit.

**3. `species/search` liefert die Trivialnamen mit** — 168 Namen für *Fagus sylvatica*, identisch
mit dem eigenen `vernacularNames`-Endpunkt (167). Das ersetzt einen kompletten zusätzlichen
API-Durchlauf; in der alten Pipeline war das Phase 2 mit 4–6 Stunden Laufzeit.

## Wie geschnitten wird

Adaptiv, nicht nach fester Rangebene:

```
zähle Arten unter Knoten
  ≤ max-slice  → Scheibe, wird direkt paginiert
  > max-slice  → Kinder holen, mit jedem Kind von vorn
```

Das ist vollständig, ohne eine Annahme über die Rangstruktur zu treffen — GBIF hängt Familien
teils direkt unter das Reich, Ränge fehlen stellenweise ganz. Zwei Fallstricke sind behandelt:

- **`highertaxonKey` schließt den Knoten selbst nicht ein** (an einer Art geprüft: Rückgabe 0).
  Arten, die direkt unter einem zerlegten Knoten hängen, würden also durchs Raster fallen. Sie
  werden beim Aufklappen erkannt und einzeln nachgeladen.
- Ränge unterhalb der Art (Unterart, Varietät, Form, Sorte) werden nicht weiterverfolgt — dort
  kann keine Art mehr liegen.

## Prüfung statt Vertrauen

Am Ende zählt der Lauf die eindeutigen `taxonKey` in der Datei und vergleicht sie mit der Zahl,
die GBIF für dieselbe Abfrage meldet. Abweichung ≠ 0 wird als Warnung ausgegeben, Dubletten
werden entfernt. Zwei Belege aus Testläufen:

| Wurzel | GBIF meldet | geschrieben | Dauer |
|---|---|---|---|
| Pinopsida (194) | 2.233 | **2.233** | 12 s |
| Polypodiopsida (7228684) | 14.537 | **14.537** | 22 s |

Hochgerechnet auf Plantae: **~12–20 Minuten**, Datei **~260 MB** (Ø 580 Bytes je Zeile, mit allen
Trivialnamen). Ohne Trivialnamen wären es ~200 MB.

## Wiederaufnahme

Plan und erledigte Scheiben liegen unter `data/state/`. Ein abgebrochener Lauf wird beim
nächsten Start fortgesetzt; erledigte Scheiben werden übersprungen. `--max-slice` zu ändern baut
den Plan neu.

## Ausgabeformat

`data/raw/gbif/species_accepted.ndjson`, eine Art je Zeile:

```json
{
  "taxonKey": 2650128,
  "scientificName": "Ophioglossum lusitanicum L.",
  "canonicalName": "Ophioglossum lusitanicum",
  "authorship": "L.",
  "rank": "SPECIES",
  "status": "ACCEPTED",
  "extinct": false,
  "kingdom": "Plantae", "kingdomKey": 6,
  "phylum": "Tracheophyta", "phylumKey": 7707728,
  "class": "Polypodiopsida", "classKey": 7228684,
  "order": "Ophioglossales", "orderKey": 393,
  "family": "Ophioglossaceae", "familyKey": 6627,
  "genus": "Ophioglossum", "genusKey": 2650127,
  "numDescendants": 0,
  "constituentKey": "7ddf754f-d193-4cc9-b351-99906754a03b",
  "vernacularNames": [
    { "name": "Least Adder's-tongue", "language": "eng" },
    { "name": "Kleine Natternzunge", "language": "deu" }
  ]
}
```

`data/raw/gbif/species_accepted.meta.json` hält Laufzeitdaten fest: Quelle, Einstellungen, Zahl der
Scheiben, geschriebene Arten, Abweichung gegenüber GBIF.

Beide Dateien sind gitignored — die NDJSON ist zu groß für Git und jederzeit reproduzierbar.

## Schritt 2 — `02_fetch_plantnet_names.js`

Holt die Trivialnamen aus **Pl@ntNets eigenem Weltflora-Projekt** (`k-world-flora`) statt aus den
`vernacularNames` des GBIF-Backbones. Es sind dieselben Namen, die auf identify.plantnet.org
stehen: von Nutzern geprüft und nach Zustimmung sortiert.

```bash
node pipeline/02_fetch_plantnet_names.js
node pipeline/02_fetch_plantnet_names.js --languages=de,en,fr
```

| Option | Standard | Bedeutung |
|---|---|---|
| `--languages` | `de` | Sprachen, je Sprache ein eigener Durchlauf |
| `--project` | `k-world-flora` | Pl@ntNet-Projekt |
| `--page-size` | `2000` | Arten je Anfrage |
| `--delay` | `500` | Pause zwischen Anfragen (ms) |
| `--details` | – | Datei mit taxonKeys, für die die **volle Rangliste** nachgeladen wird |
| `--details-limit` | `2000` | Obergrenze dafür |

**Endpunkt:** `GET https://api.plantnet.org/v1/projects/{project}/species?lang=&page=&pageSize=`
— öffentlich, ohne Schlüssel, derselbe, den die Pl@ntNet-Weboberfläche benutzt. Wir weisen uns im
User-Agent aus und drosseln uns selbst; ohne Pause antwortet Pl@ntNet mit HTTP 429.

### Vier gemessene Eigenschaften

**1. Der Bestand ist 84.560 Arten groß.** 43 Seiten à 2.000, danach meldet der Endpunkt
`404 "No species found"` — das ist das Abbruchsignal, kein Fehler. Ein Durchlauf für Deutsch
dauert 35–170 Sekunden.

**1a. `page` ist NULLBASIERT — und das kostete stumm 2.000 Arten.** `page=1` liefert nicht die
erste Seite, sondern die Einträge ab Position `pageSize+1`. Der erste Lauf startete bei 1 und
verlor damit die komplette Gattung *Acer* (94 Arten) und alles andere vor „Agave indagatorum" —
ohne Fehlermeldung, mit einer plausibel aussehenden Gesamtzahl. Deshalb prüft der Lauf jetzt am
Ende, ob acht Pflichtgattungen (*Acer*, *Betula*, *Quercus*, *Rosa*, *Salix*, *Prunus*, *Abies*,
*Aesculus*) vorhanden sind, und zählt Dubletten.

**2. `map` enthält die GBIF-taxonKey.** Pl@ntNet gibt keine eigene ID heraus, aber jede Art trägt
`https://api.plantnet.org/v1/gbif/{taxonKey}/map.png`. An drei Birkenarten gegen GBIF geprüft —
*Betula pendula* 5331916, *B. pubescens* 9118014, *B. nana* 5332004 — alle exakt identisch mit
`species/match`. **99,7 % der Pl@ntNet-Arten tragen so einen Schlüssel**, der Abgleich braucht
also kein Namensraten.

**3. Der Listen-Endpunkt kürzt auf einen Namen.** *Betula pendula* liefert in der Liste nur
`["Hängebirke"]`, in der Detailansicht dagegen alle 14 (`Hängebirke, Hänge Birke, Weißbirke,
Gemeine Birke, Warzenbirke, Sandbirke …`). Für den bevorzugten Namen reicht die Liste; wer die
volle Rangfolge braucht, nimmt `--details`.

**4. Die Detailansicht ist teuer.** Sie schickt **alle** Bilder mit — für *Betula pendula* mit
14.812 Bildern sind das 7,5 MB in einer Antwort. Für alle 82.560 Arten wäre das unvertretbar,
deshalb ist der Detailmodus begrenzt und muss ausdrücklich angefordert werden.

## Schritt 3 — `03_merge_names.js`

Hängt die Pl@ntNet-Namen über die taxonKey in den Katalog ein. **Pl@ntNet hat Vorrang**, die
GBIF-Namen bleiben als zweite Quelle im Datensatz stehen — wer die Rangfolge später anders will,
muss die Pipeline nicht neu laufen lassen.

```bash
node pipeline/03_merge_names.js
```

Ergebnis für Deutsch, gemessen am vollständigen Katalog:

| | Arten mit deutschem Namen |
|---|---|
| GBIF-`vernacularNames` allein (bisher) | 10.690 |
| **Pl@ntNet** | **11.514** |
| **beide zusammen** | **14.464** |
| nur bei Pl@ntNet | 3.774 |
| nur bei GBIF | 2.950 |

**+35,3 % gegenüber GBIF allein.** Bemerkenswert ist die zweite Zeile von unten: GBIF ist keine
Teilmenge — 2.950 Arten haben *nur* dort einen deutschen Namen. Deshalb bleibt GBIF als Rückfall
eingeschaltet statt ersetzt zu werden.

80.384 Katalogarten (18,0 %) haben überhaupt einen Pl@ntNet-Eintrag; die Namensabdeckung ist also
kein Zufallsprodukt der Artenzahl, sondern folgt dem, was Pl@ntNet tatsächlich pflegt.

Ausgabeformat je Sprache:

```json
"commonNames": {
  "de": {
    "primary": "Hängebirke",
    "source": "plantnet",
    "plantnet": ["Hängebirke"],
    "gbif": ["Hänge-Birke", "Sandbirke"]
  }
}
```

## Schritt 4 — `04_fetch_plantnet_images.js`

Holt die Bilder **direkt bei Pl@ntNet** statt über GBIF — mit Organ, Lizenz und
Community-Bewertung je Bild.

```bash
node pipeline/04_fetch_plantnet_images.js --only-named=de   # 12.187 Arten, ~2 h
node pipeline/04_fetch_plantnet_images.js                   # 84.560 Arten, ~14 h
node pipeline/04_fetch_plantnet_images.js --limit=50        # Probelauf
```

| Option | Standard | Bedeutung |
|---|---|---|
| `--only-named` | – | nur Arten mit Trivialnamen dieser Sprache |
| `--max-per-organ` | `0` = **kein Deckel** | Obergrenze je Organ, nach Bewertung sortiert |
| `--concurrency` | `3` | parallele Anfragen |
| `--delay` | `100` | Pause zwischen Anfragen (ms) |
| `--limit` | – | nur die N bilderreichsten Arten |
| `--fresh` | – | Ausgabe und Zustand löschen |

### Warum direkt statt über GBIF — gemessen

Pl@ntNet teilt auf GBIF nur einen Bruchteil des eigenen Bestands:

| Art | über GBIF | Pl@ntNet direkt | Faktor |
|---|---|---|---|
| Fagus sylvatica | 9.401 | 43.095 | 4,6× |
| Hedera helix | 5.206 | 27.849 | 5,3× |
| Quercus robur | 3.677 | 23.913 | 6,5× |
| Taxus baccata | 2.089 | 17.890 | **8,6×** |
| Betula pendula | 1.767 | 14.812 | **8,4×** |
| **Summe (8 Arten)** | **34.129** | **156.184** | **4,6×** |

Insgesamt hängen an den 84.560 Pl@ntNet-Arten **20,25 Mio. Bilder**; 93 % davon (18,86 Mio.)
entfallen auf die 12.187 Arten, die einen deutschen Namen haben.

### Lizenz am einzelnen Bild

Das Feld `license` steht am Bild, nicht am Datensatz — der Fehlschluss „Record CC BY, also Bild
CC BY" entfällt. Aus dem Probelauf über 209.770 Bilder:

`cc-by-sa 208.932 · © 398 · cc-by-nc 283 · cc-by-nc-sa 106 · cc-by 31 · gpl 11 · public 9`

Die 398 mit `©` sind urheberrechtlich geschützt und müssen raus. Gespeichert wird alles, gefiltert
wird später per Abfrage — das Feld ist da.

### Bewertung

`plus` ist die Zustimmung der Community. **Jedes Bild hat einen Wert**, keine Nullwerte. Verteilung
über 209.770 Bilder:

| plus | 1–2 | 3–4 | 5–9 | 10–24 | 25+ |
|---|---|---|---|---|---|
| Anteil | 84,2 % | 13,1 % | 2,6 % | 0,2 % | 0,003 % |

Spitzenwert im Probelauf: 267 (ein Blattfoto der Rot-Buche). Das Signal ist schief verteilt, taugt
aber genau deshalb zum Herausgreifen der besten Bilder — und ersetzt das `wilsonScore`-Feld der
alten Pipeline, das dort immer `null` blieb.

### Kein Deckel

Die Lern-App zeigt bei jedem Durchgang andere Bilder; eine Begrenzung je Organ würde ihr genau das
nehmen. Deshalb ist `--max-per-organ` standardmäßig aus. Der Preis ist tragbar:

| | alle Arten | nur mit deutschem Namen |
|---|---|---|
| Arten | 84.560 | 12.187 |
| Bilder | 20,25 Mio. | 18,86 Mio. |
| Download (JSON) | ~10 GB | ~9,4 GB |
| **Ausgabe (NDJSON)** | **4,6 GB** | **4,3 GB** |
| Laufzeit | ~14 h | ~2 h |

### Nur die id wird gespeichert

Die drei Bildgrößen sind vollständig aus der `id` ableitbar — an 14.812 Bildern geprüft, null
Abweichungen:

```
https://bs.plantnet.org/image/o/{imageId}   # Original
https://bs.plantnet.org/image/m/{imageId}   # mittel
https://bs.plantnet.org/image/s/{imageId}   # klein
```

Das spart rund 120 Bytes je Zeile; eine Zeile wiegt so 226 Bytes:

```json
{
  "taxonKey": 2925892,
  "species": "Echium vulgare",
  "organ": "flower",
  "imageId": "8cd5aab12852cf98bfb081d9bd1abaf387e7bb04",
  "license": "cc-by-sa",
  "author": "Terrisse Delin Julien",
  "plus": 25,
  "observationId": "1006924575",
  "date": "31. Mai 2020"
}
```

### Nebenprodukt: alles auf Artebene

Derselbe Aufruf liefert weit mehr als Bilder. Alles davon landet in
`data/raw/plantnet/plantnet_species_detail.ndjson` (~1,6 KB je Art) — **wird es hier nicht mitgeschrieben,
kostet es später einen kompletten zweiten Durchlauf**:

| Feld | Beispiel *Fagus sylvatica* |
|---|---|
| `commonNames` | volle Rangliste: Rotbuche, Buche, Rot Buche, Blutbuche, Buchbaum … (8) |
| `traits` | `growth_form: tree` |
| `uses` | GIFT (bei *Betula*: Zierpflanze, Holz, Lipide, Medizin) |
| `iucn` | `LC – Nicht gefährdet` |
| `imagesCountByOrgan` | feiner als die Bildgruppen: auch `branch`, `scan`, `sheet` |
| `stats` | `probaAvg 0.994`, `validatedRate 56.9`, `revisedRate 6.7`, `mismatchIaRate 23.8` |
| `ids` | gbif 2882316 · powo 305836-2 · ipni 305836-2 · eppo FAUSY · taxref 97947 |
| `synonyms`, `links`, `observationsCount`, `needRevision` | — |

Damit reagiert die Suche später auch auf „Gewöhnliche Birke", und der Katalog bekommt Wuchsform
und Nutzung geschenkt.

### Wiederaufnahme

Erledigte Arten stehen zeilenweise in `data/state/plantnet_images.done`; ein abgebrochener
Lauf setzt fort. Abgearbeitet wird **nach Bilderzahl absteigend** — bricht der Lauf ab, liegt das
Wertvollste bereits vor.

### Das Kontingent: 10.000 Anfragen je Pfad und 24 Stunden

Pl@ntNet drosselt nach **Menge**, nicht nach Tempo. Die Grenze steht in den Kopfzeilen — aber
**nur in der 429er Antwort**, eine erfolgreiche Antwort trägt keinen Zählerstand:

```
x-ratelimit-userpathlimit:     10000
x-ratelimit-userpathremaining: -1
x-ratelimit-userpathreset:     1787156069373
```

Das Fenster läuft 24 Stunden ab der ersten Anfrage und gilt **je Pfad** — der Listen-Endpunkt aus
Schritt 2 hat sein eigenes Kontingent und läuft weiter, auch wenn die Detailansicht gesperrt ist.

Weil die API bei Erfolg nichts meldet, führt der Lauf **selbst Buch**
(`data/state/plantnet_quota.json`) und zeigt den Stand fortlaufend an:

```
1.250/74.397 Arten · 66.320 Bilder · 412s · Kontingent [###.....................] 1.254/10.000
```

Gezählt werden **HTTP-Anfragen, nicht Arten** — ein Wiederholungsversuch belastet das Konto
genauso. Ist das Kontingent erschöpft, endet der Lauf **geordnet** mit Angabe der Freigabezeit,
statt sich in Backoff-Schleifen festzufressen. Meldet die API eine 429 mit Reset-Zeit, übernimmt
der Lauf diese als Wahrheit und korrigiert den eigenen Zähler.

> ⚠ Am 18.08.2026 fehlte diese Erkennung: Der Lauf lief nach dem Erreichen der 10.000 noch **drei
> Stunden** gegen die Wand und holte dabei 13 Arten. Daher der geordnete Abbruch.

**Zum Tempo:** Langsam laufen spart kein Kontingent, es verlängert nur den Lauf. Belegt
unproblematisch sind 2,8 Anfragen/s (100 Minuten am 18.08. ohne einen 429er). Der Standard steht
auf 100 ms / 3 parallel ≈ 8,6/s — das ist ungetestet. Treten 429er auf, während der Tageszähler
noch niedrig steht, gibt es doch ein Kurzzeitlimit: dann `--delay=250 --concurrency=2`.

Für den vollen Bestand sind rund **8 Tageskontingente** nötig. Der Lauf arbeitet nach Bilderzahl
absteigend, deshalb liegen nach dem ersten Tag bereits 95,6 % aller Bilder vor.

⚠ Die Bilder selbst liegen danach auf `bs.plantnet.org`, nicht mehr in GBIFs Cache. Die App würde
also Pl@ntNets Auslieferung belasten — das ist eine bewusste Entscheidung, kein Nebeneffekt.

## Was Schritt 1 bewusst **nicht** tut

- **Keine Bilder.** Bildbeschaffung wird ein eigener Schritt über mehrere Datensätze, mit Filter
  auf die Lizenz **am einzelnen Bild** (gemessen: 3,6–5,4 % der Bilder in CC-BY-Records tragen in
  Wahrheit eine NC-Lizenz).
- **Keine Auswahl.** Kein Filter auf deutschen Namen — selbst mit Pl@ntNet haben nur 14.307 von
  446.842 Arten (3,2 %) einen. Als Pflichtkriterium würde er den Weltkatalog auf einen Rest
  eindampfen.
- **Keine Synonyme.** Nur akzeptierte Namen. Die Synonymauflösung für Prüfungslisten mit
  veralteten Namen ist ein eigener Schritt; `species/match` liefert dort in etwa 1,5 % der Fälle
  eine Familie oder Gattung statt einer Art zurück und braucht deshalb eine harte Rangprüfung.
- **Keine Sorten.** Das Backbone kennt keine Kultivare. Von 428 AuGaLa-Prüfungszeilen sind 55
  reine Sortennamen ohne Art — die sind über GBIF grundsätzlich nicht erreichbar.
