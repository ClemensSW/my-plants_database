# AuGaLa-Pflanzenbuch: Rohdaten lokal ziehen

> **Für eine KI in einer künftigen Session.** Selbsttragend — du brauchst keinen Kontext aus
> früheren Gesprächen. Ergebnis ist `augala-appall.json`: der **komplette Datenbestand** des
> Pflanzenbuchs. Dauer ~2 Minuten, **null Requests** an den AuGaLa-Server.
>
> Was danach daraus gebaut wird (CSV, Import, Abgleich, …), ist eine separate Frage.
> Dieses Dokument beschafft die Rohdaten und dokumentiert, was drinsteht.

## Rechtlicher Rahmen (bitte nicht neu aufrollen)

Der Nutzer **besitzt die Lizenz** für das AuGaLa-Pflanzenbuch und darauf gestützt die
Zugangsdaten. `galabau-pflanzen.de` wird vom Ausbildungsförderwerk Garten-, Landschafts- und
Sportplatzbau e.V. (AuGaLa) selbst betrieben; es ist die digitale Ausgabe des
kostenpflichtigen Ausbildungsmediums. Der Export erfolgt im Rahmen dieser Lizenz und liest
ausschließlich den **lokalen Cache des eigenen Browsers**.

Zwei Dinge gelten trotzdem:

- **Keine Tarnung.** Siehe „Sackgassen": Der API-Zugriff per Skript wird von Cloudflare
  anhand der Client-Signatur geblockt. Das nicht per gefälschtem Fingerprint umgehen — der
  IndexedDB-Weg ist ohnehin besser.
- Die `t*`-Felder sind **2,38 MB verfasste Prosa** — der redaktionelle Buchtext, nicht bloß
  Daten. Andere Kategorie als Namen und Zahlen. Beim Weiterverarbeiten im Kopf behalten.

---

## Warum das ohne Serveranfragen geht

Die Angular-App lädt beim Start **einmal** den gesamten Bestand und legt ihn in **IndexedDB** ab:

```js
_getAllData() {
  this.api.get("appall").subscribe(e => {           // GET .../augala/appall
    this.localStorage.set("data_version", e.version);
    Object.keys(e).forEach(r => { /* … schreibt in die IndexedDB-Stores */ })
  })
}
```

Deshalb löst ein Klick auf eine Pflanze **keinen** Netzwerk-Request aus — die Detaildaten
sind längst lokal. Wir lesen nur diesen Cache aus.

---

## Anleitung

### 1. App laden

`https://www.galabau-pflanzen.de` einloggen und `app/home` öffnen. **Warten, bis die
Pflanzenliste steht** — erst dann ist die IndexedDB gefüllt.

### 2. Console-Snippet

DevTools (**F12** / **Cmd+Opt+I**) → Tab **Console** → einfügen, Enter:

```js
(async () => {
  const dbs = await indexedDB.databases();
  console.log('Gefundene DBs:', dbs.map(d => d.name));

  for (const { name } of dbs) {
    const db = await new Promise(r => {
      const q = indexedDB.open(name); q.onsuccess = e => r(e.target.result);
    });
    const stores = [...db.objectStoreNames];
    if (!stores.includes('pflanzen')) { db.close(); continue; }

    const out = {};
    for (const s of stores) {
      out[s] = await new Promise(r => {
        const q = db.transaction(s, 'readonly').objectStore(s).getAll();
        q.onsuccess = e => r(e.target.result);
        q.onerror = () => r([]);
      });
      console.log(`  ${s}: ${out[s].length}`);
    }
    db.close();

    const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'augala-appall.json';
    a.click();
    console.log('%c✓ augala-appall.json heruntergeladen', 'color:green;font-weight:bold');
    return;
  }
  console.log('%c✗ Kein pflanzen-Store — App einmal laden, dann erneut', 'color:red');
})()
```

Der DB-Name ist wegminifiziert — `indexedDB.databases()` findet ihn selbst, deshalb muss
nichts geraten werden.

### 3. Datei in den Projekt-Root

Landet als `augala-appall.json` (~6,1 MB) in den Downloads. In den Root von `MyPlants` legen.

---

## Kontrolle: hat es geklappt?

**Erwartete Console-Ausgabe** (Stand 17.07.2026 — Zahlen können mit neuen Ausgaben wachsen):

```
pflanzen: 2873   bilder: 5639   game: 974   stichworte: 494
veraltetenamen: 293   hinweisnomenklatur: 273   listen: 92
sortimente: 13   lebensbereiche: 13   roteliste: 9
game-result: 0   stichwortesynonyme: 0
```

Schnellprüfung:

```bash
python3 -c "
import json; d=json.load(open('augala-appall.json',encoding='utf-8'))
print({k: len(v) for k,v in d.items()})
print('AuGaLa-Liste:', sum(1 for p in d['pflanzen'] if p.get('augalaliste')), '(erwartet 428)')
print('ohne dt. Namen:', sum(1 for p in d['pflanzen'] if not (p.get('nameDeutsch') or '').strip()))
"
```

`game-result: 0` und `stichwortesynonyme: 0` sind **normal** (leere Stores), kein Fehlschlag.

---

## Referenz: was in der JSON steht

### Die 12 Stores

| Store | n | Inhalt |
|---|---|---|
| `pflanzen` | 2873 | **die Pflanzendatensätze** (s.u.) — der ganze Bestand, nicht nur die AuGaLa-Liste |
| `bilder` | 5639 | Bild-**Metadaten**: `dateiname`, `unterschrift`, `pflanzenId`, `reihenfolge`, `lernspiel` — **keine** Bilddateien |
| `game` | 974 | Lernspiel + Fortschritt (`plantId`, `beginner`/`advanced`/`expert` je `{done, correct}`) |
| `stichworte` | 494 | Fachglossar (`stichwort`, `kurzdefinition`, `abkuerzung`, `symbol`) |
| `veraltetenamen` | 293 | veraltete Synonyme (`nameLateinVeraltet` → `pflId`) |
| `hinweisnomenklatur` | 273 | Nomenklatur-Gruppen (`gruppe`, `kurz`, `lang`) — Ziel von `pflanzen[].hnkGruppe` |
| `listen` | 92 | **Decodier-Tabelle für die Zahlencodes** (s.u.) — *nicht* die AuGaLa-Liste! |
| `sortimente` | 13 | die 13 Kategorien (`id` → `name`) |
| `lebensbereiche` | 13 | Lebensbereiche (`lebArray`, `dateiname`) |
| `roteliste` | 9 | Gefährdungsstufen im Klartext |
| `game-result` | 0 | leer |
| `stichwortesynonyme` | 0 | leer |

> ⚠️ **Zwei Fallen:**
> 1. Der Store `listen` klingt nach der AuGaLa-Liste, ist aber die Code-Tabelle.
>    Die Zugehörigkeit steht im Boolean **`pflanzen[].augalaliste`** (→ exakt 428 `true`).
> 2. `pflanzen` enthält **2873** Einträge — die 428 sind nur eine Teilmenge.

### Store `pflanzen` — Felder

| Gruppe | Felder |
|---|---|
| **Namen** | `nameLatein`, `nameDeutsch`, `nameLateinSort`, `gattung`, `art`, `sorte`, `familieLatein`, `familieDeutsch` |
| **Zuordnung** | `id`, `parentId`, `sortimentId`, **`augalaliste`**, `ordnungsziffer` |
| **Volltexte** | `tbluete`, `tfrucht`, `therkunft`, `tlaub`, `tstandort`, `tvermehrung`, `tverwendung`, `twuchs`, `thinweis`, `tlb`, `weitereArtenSorten`, `erklaerung` (Etymologie: *„concolor = einfarbig"*) |
| **Maße** | `hoeheVonM`, `hoeheBisM`, `breiteVonM`, `breiteBisM` (Meter) |
| **Codes** | `standortanspruch`, `bodenart`, `bodenfeuchte`, `ph`, `kalk`, `naehrstoff`, `geselligkeit`, `bluetenfarbe`, `herbstfarbe`, `gefaehrdung`, `giftigNr`, `immergruenNr`, `hnkGruppe` |
| **Flags** | `wildpflanze`, `heimisch`, `geschuetzt`, `zuechtung`, `fruchtschmuck` |
| **Blütezeit** | `monatVon1`, `monatBis1`, `monatVon2`, `monatBis2` |

### Die 13 Sortimente

```
1082 Laubgehölze              1083 Nadelgehölze         1084 Obstgehölze
1085 Küchen-/Gewürzkräuter    1086 Innenraum-Begrünung  1087 Stauden
1088 Zwiebel-/Knollenpflanzen 1089 Ziergräser           1090 Farne
1091 Sumpf-/Wasserpflanzen    1092 Beet-/Balkonpflanzen 1093 Unkräuter/Wildkräuter
1094 Heimische, besonders geschützte Pflanzen
```

### Zahlencodes decodieren — `listen` ist die Tabelle

`listen` liefert je Kategorie `name` + `wert`. **Die meisten Codes sind Bitmasken**
(mit `&` prüfen), einige sind einfache Enums (direkt vergleichen).

| Feld | `listen`-Kategorie | Typ |
|---|---|---|
| `standortanspruch` | Sonneneinstrahlung | **Bitmaske** (1 vollsonnig, 2 sonnig, 4 absonnig, 8 halbschattig, 16 schattig) |
| `bodenart` | Bodenart | **Bitmaske** (1 Humus, 2 Kies, 4 kult. Böden, 8 Lehm, 16 Sand, 32 Stein, 64 Substrat, 128 Ton) |
| `bodenfeuchte` | Bodenfeuchtigkeit | **Bitmaske** (1 trocken … 32 nass) |
| `ph` | ph-Bereich | **Bitmaske** (1 alkalisch … 16 sauer) |
| `naehrstoff` | Nährstoffbedarf | **Bitmaske** (1/2/4) |
| `kalk` | Kalktoleranz | **Bitmaske** (1/2/4) |
| `bluetenfarbe` | Blütenfarbe | **Bitmaske** (1 Blau … 256 Weiß) |
| `herbstfarbe` | Herbstfarbe | **Bitmaske** (2 Braun … 32 Rot) |
| `gefaehrdung` | Gefährdungsgruppe | **Bitmaske** (1 ausgestorben … 256 ungefährdet) |
| `geselligkeit` | Geselligkeit | **Bitmaske** (2 = I einzeln … 32 = V großflächig) |
| `giftigNr` | Giftigkeit | **Enum** — 0 keine Angabe, 1 sehr giftig, 2 giftig, 3 gering giftig |
| `immergruenNr` | Laub | **Enum** — 0 keine Angabe, 1 immergrün, 2 wintergrün, 3 sommergrün |
| `monatVon*`/`monatBis*` | Blütezeit | **Enum** 1–12. **`13` = keine zweite Blüte** (2352 Pflanzen) |
| `hnkGruppe` | — | Verweis in Store `hinweisnomenklatur` |

```python
import json
d = json.load(open("augala-appall.json", encoding="utf-8"))

lst = {}
for x in d["listen"]:
    lst.setdefault(x["kategorie"], []).append(x)

def bits(kategorie, wert):
    """Bitmasken-Feld -> Liste von Klartext-Namen."""
    return [e["name"] for e in lst[kategorie] if e["wert"] and wert & e["wert"]]

def enum(kategorie, wert):
    """Enum-Feld -> ein Klartext-Name."""
    return next((e["name"] for e in lst[kategorie] if e["wert"] == wert), None)

p = next(x for x in d["pflanzen"] if x["nameLatein"] == "Abies concolor")
print(bits("Sonneneinstrahlung", p["standortanspruch"]))  # ['sonnig', 'absonnig']
print(bits("Bodenart",          p["bodenart"]))           # ['Lehm', 'Sand']
print(enum("Laub",              p["immergruenNr"]))       # 'immergrün'
```

**Gegengeprüft:** `Abies concolor` hat `standortanspruch=6` → *sonnig, absonnig*,
`bodenart=24` → *Lehm, Sand*, `bodenfeuchte=6` → *mäßig trocken, frisch*. Der Fließtext
`tstandort` sagt: *„Auf sonnigen bis absonnigen Standorten mit sandig-lehmigen, mäßig
trockenen bis frischen … Böden"*. Deckt sich vollständig.

---

## Sackgassen — hier nicht nochmal Zeit verbrennen

### ❌ Die API mit curl/Python aufrufen

```
GET https://api-prod.galabau-pflanzen.de/augala/appall
HTTP 403 — Cloudflare Error 1010: browser_signature_banned
"The site owner has blocked access based on your browser's signature."
```

Cloudflare blockt anhand der Client-Signatur. **Nicht** per gefälschtem User-Agent, TLS-
Fingerprint oder Proxy umgehen. Der IndexedDB-Weg liefert dieselben Daten ohne jeden Request.

### ❌ `sessionStorage.access_token`

Gibt `undefined`. Die App nutzt **`angular-auth-oidc-client`**, die anders ablegt:

```js
getAccessToken(i)  { return this.read("authzData", i) }                 // Access-Token
getRefreshToken(i) { return this.read("authnResult", i)?.refresh_token }
```

Verschachtelt in einem JSON-Blob unter der `configId` (vermutlich `0-frontend`).
**Für diesen Export irrelevant** — IndexedDB braucht kein Token.

### ❌ Detail-Requests pro Pflanze erwarten

Gibt es nicht. Ein Klick löst nur `appsuchfilter/` und `vwapppflanzenveraltetenamen/<id>`
aus — letzteres oft **404**, weil die meisten Pflanzen keine veralteten Namen haben. **Kein Fehler.**

### ❌ Deutsche Namen aus GBIF/Wikidata ergänzen

Liefert *einen* gängigen Trivialnamen, aber nicht **den von AuGaLa gelehrten** — für eine
Prüfungsliste der falsche Wert. Auf Sortenebene hat GBIF ohnehin nichts
(`rank === SPECIES`). Autoritativ ist allein diese Quelle.

---

## Technische Eckdaten

```
Frontend   https://www.galabau-pflanzen.de            (Angular)
API        https://api-prod.galabau-pflanzen.de/augala/   (Java, hinter Cloudflare)
Auth       https://keycloak-prod.galabau-pflanzen.de/realms/pflanzenbuch
           clientId: frontend  ·  PKCE (S256)  ·  Token-Lebensdauer 48 h
Header     X-App: WEB   (setzt ein Angular-Interceptor auf jeden API-Request)
Bulk       GET {api}appall  ->  alle Stores in einer Response
```

---

## Anhang: Beispiel — CSV der 428 AuGaLa-Pflanzen

Nur als Muster, wie man aus der JSON etwas baut. Erzeugt `augala-pflanzen-428.csv`
(`botanisch, deutsch, kategorie`):

```python
import csv, json

d = json.load(open("augala-appall.json", encoding="utf-8"))
sortimente = {s["id"]: s["name"] for s in d["sortimente"]}
al = [p for p in d["pflanzen"] if p.get("augalaliste")]      # das Flag, kein Namensraten

def sortkey(s):
    """DIN 5007-1: ä=a, ö=o, ü=u, ß=ss. Botanische Namen sind Latein, ABER
    Sortennamen tragen Umlaute (z.B. Aster ... 'Andenken an Alma Pötschke')."""
    s = s.lower()
    for a, b in (("ä","a"), ("ö","o"), ("ü","u"), ("ß","ss")):
        s = s.replace(a, b)
    return s

rows = sorted(
    [{"bot": p["nameLatein"].strip(),
      "de": (p.get("nameDeutsch") or "").strip(),
      "kat": sortimente.get(p["sortimentId"], "")} for p in al],
    key=lambda r: (sortkey(r["bot"]), sortkey(r["kat"])),
)

# utf-8-sig = BOM, sonst zerlegt Excel die Umlaute.
# QUOTE_ALL ist Pflicht: die deutschen Namen enthalten selbst Kommas
# ("Korea-Tanne, Zapfen-Tanne") und wuerden sonst in zwei Spalten zerfallen.
with open("augala-pflanzen-428.csv", "w", encoding="utf-8-sig", newline="") as fh:
    w = csv.writer(fh, quoting=csv.QUOTE_ALL)
    w.writerow(["botanisch", "deutsch", "kategorie"])
    for r in rows:
        w.writerow([r["bot"], r["de"], r["kat"]])

assert len(rows) == 428, f"erwartet 428, bekommen {len(rows)}"
assert not [r for r in rows if not r["de"]], "Eintraege ohne deutschen Namen"
print(f"OK: {len(rows)} Zeilen")
```

Ergebnis — 428 Zeilen, 416 eindeutige botanische Namen (12 Pflanzen stehen in zwei Kategorien):

```csv
botanisch,deutsch,kategorie
"Abies koreana","Korea-Tanne, Zapfen-Tanne","Nadelgehölze"
"Acer campestre","Feld-Ahorn","Laubgehölze"
```

Verteilung zur Kontrolle: Laubgehölze 161 · Stauden 92 · Heimische geschützte 35 ·
Nadelgehölze 29 · Zwiebel/Knollen 20 · Unkräuter 17 · Innenraum 16 · Beet/Balkon 16 ·
Ziergräser 13 · Obstgehölze 13 · Sumpf/Wasser 11 · Farne 5

---

## Bekannter Datenfehler im Projekt (Stand 17.07.2026)

Beim Abgleich mit `myplants-database/data/exam-lists/**/*.ndjson` wichen **65 von 202**
Werten ab. Bei einem Teil ist der **Sortenname auf die Art gerutscht**:

| botanisch | im Projekt (falsch) | AuGaLa-Original |
|---|---|---|
| `Acer platanoides` | Kugel-Ahorn | **Spitz-Ahorn** |
| `Catalpa bignonioides` | Kugel-Trompetenbaum | **Trompetenbaum** |
| `Corylus avellana` | Korkenzieher-Haselnuss | **Gewöhnliche Hasel, Haselnuss, Wald-Hasel** |

Ursache: Die Liste führt Art *und* Sorte getrennt (`Acer platanoides` **und**
`Acer platanoides 'Globosum'`). Beim Strippen der Sorte auf GBIF-Art-Ebene kollabieren beide
auf denselben `taxonKey` — die Sorte überschreibt die Art.

**Nicht ungefragt reparieren.** Der Nutzer hat die Daten bewusst neu gezogen und will an
`myplants-docs/**`, `galabau_pflanzen.json`, den Exam-Lists und der Pipeline **nichts**
geändert haben.
