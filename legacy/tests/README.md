# Test-Scripts für schnelles Testen

Diese Scripts sind identisch mit den Haupt-Scripts, aber verarbeiten nur **50 Pflanzen** und **max. 10 Bilder pro Art** für schnelles Testen.

## 🚀 Alle Tests auf einmal ausführen

```bash
npm test
# oder
npm run test:all
```

Dieser Befehl führt alle 5 Phasen nacheinander aus (~6-10 Minuten).

---

## 🎯 Verwendung

```bash
# Phase 1: Erste 50 taxonKeys sammeln (~10 Sekunden)
node scriptsTest/01_fetch_taxonkeys_test.js

# Phase 2: 50 Species anreichern (~2-3 Minuten)
node scriptsTest/02_enrich_species_test.js

# Phase 3: Wikidata-Anreicherung (~30 Sekunden)
node scriptsTest/03_enrich_wikidata_test.js

# Phase 4: Filtern (~1 Sekunde)
node scriptsTest/04_filter_species_test.js

# Phase 5: Bilder sammeln, max 10/Art (~3-5 Minuten)
node scriptsTest/05_collect_multimedia_test.js
```

## ⏱️ Geschätzte Dauer

- **Phase 1:** ~10 Sekunden
- **Phase 2:** ~2-3 Minuten
- **Phase 3:** ~30 Sekunden
- **Phase 4:** ~1 Sekunde
- **Phase 5:** ~3-5 Minuten

**Gesamt: ~6-10 Minuten** (statt 12-18 Stunden!)

## 📁 Output-Dateien

Test-Dateien werden mit `_test` Suffix gespeichert:

```
data/
├── intermediate/
│   ├── plantnet_taxonKeys_test.json          # 50 taxonKeys
│   ├── plantnet_species_raw_test.ndjson      # 50 Species (roh)
│   ├── plantnet_species_enriched_test.ndjson # Nach Wikidata-Anreicherung
│   ├── failed_keys_test.txt                  # Fehlgeschlagene Keys
│   └── wikidata_failed_test.txt              # Fehlgeschlagene Wikidata-Queries
└── output/
    ├── species_test.ndjson                    # Gefilterte Species
    └── multimedia_test.ndjson                 # Bilder (max 10/Art)
```

## 🔧 Anpassungen

Die Test-Scripts haben folgende Limits:

| Parameter | Produktion | Test |
|-----------|------------|------|
| TaxonKeys | ~18.000 | **50** |
| Concurrency Phase 2 | 10 | **5** |
| Batch Size Phase 3 | 50 | **50** |
| Batch Delay Phase 3 | 1000ms | **500ms** |
| Concurrency Phase 5 | 3 | **3** |
| Bilder pro Art | Unbegrenzt | **10** |
| Page Size Phase 5 | 300 | **50** |

## 🔄 Bei Fehlern in Phase 5

Falls bei Phase 5 429-Fehler (Rate Limit) auftreten:

```bash
npm run retry-multimedia
```

Dieses Script lädt fehlgeschlagene Keys nach und funktioniert auch für Test-Daten.

## ✅ Nach dem Test

Wenn die Test-Scripts erfolgreich durchlaufen:

```bash
# Normale Scripts mit allen Daten ausführen
cd ..
npm run build-all
```

## 🧹 Test-Daten löschen

```bash
# Windows
del data\intermediate\*_test.* data\output\*_test.*

# Linux/Mac
rm data/intermediate/*_test.* data/output/*_test.*
```

---

**Hinweis:** Test-Dateien werden automatisch von `.gitignore` ausgeschlossen.
