# Datenstruktur & MongoDB-Integration

Dieses Dokument beschreibt die Schema-Definitionen, MongoDB-Integration und Query-Patterns für die My-Plants Datenbank.

## 📦 Übersicht

Die Datenbank besteht aus zwei Collections:

| Collection | Dokumente | Beschreibung |
|-----------|-----------|--------------|
| `species` | ~5.500 | Taxonomische Daten und deutsche Namen |
| `multimedia` | ~3.166.000 | Bild-URLs mit Organ-Tags |

**Verknüpfung:** Via `taxonKey` (1:N Relation)

Dazu kommt die Collection `ecology` (Zeigerwerte). Sie wird **nicht** von dieser Pipeline erzeugt;
hier liegt nur ein Backup des Altstands — siehe Abschnitt „Schema: ecology" weiter unten.

---

## 📄 Schema: species

### Beispiel-Dokument

```json
{
  "_id": ObjectId("..."),
  "taxonKey": 2650105,
  "scientificName": "Azolla caroliniana Willd.",
  "canonicalName": "Azolla caroliniana",
  "germanName": "Großer Algenfarn",
  "familyKey": 2650102,
  "family": "Salviniaceae",
  "germanFamilyName": "Schwimmfarngewächse"
}
```

### Feld-Definitionen

| Feld | Typ | Beschreibung | Beispiel |
|------|-----|--------------|----------|
| `_id` | ObjectId | MongoDB-ID (auto) | - |
| `taxonKey` | Number | **GBIF taxonKey** (eindeutig) | `2650105` |
| `scientificName` | String | Wissenschaftlicher Name mit Autor | `"Azolla caroliniana Willd."` |
| `canonicalName` | String | Name ohne Autor (für Suche) | `"Azolla caroliniana"` |
| `germanName` | String | Bevorzugter deutscher Name | `"Großer Algenfarn"` |
| `familyKey` | Number (optional) | GBIF-Key der Familie | `2650102` |
| `family` | String (optional) | Botanischer Familienname | `"Salviniaceae"` |
| `germanFamilyName` | String (optional) | Deutscher Familienname | `"Schwimmfarngewächse"` |

> `rank` und `status` stehen nicht im Output — nach dem Filter aus Phase 4 sind sie konstant
> `SPECIES` / `ACCEPTED`. Ebenso ist `germanNames[]` (alle Namensvarianten mit Quelle) nur in den
> Zwischendateien vorhanden; der Output führt nur den bevorzugten Namen.

### Constraints

- `taxonKey` – **Unique Index** (nur eine Art pro taxonKey)
- Nur Arten mit `rank === "SPECIES"` und `status === "ACCEPTED"` (gefiltert in Phase 4)
- `germanName` – immer gesetzt (Arten ohne deutschen Namen fallen in Phase 4 raus)

---

## 🖼️ Schema: multimedia

### Beispiel-Dokument

```json
{
  "_id": ObjectId("..."),
  "taxonKey": 2650105,
  "species": "Azolla caroliniana Willd.",
  "organ": "leaf",
  "occurrenceId": 3949914583,
  "url": "https://api.gbif.org/v1/image/cache/occurrence/3949914583/media/9ada0341236d166bae22e7ac1cd5cd53",
  "creator": "Alexandre Crégu",
  "license": "cc-by-sa",
  "wilsonScore": null
}
```

### Feld-Definitionen

| Feld | Typ | Beschreibung | Beispiel |
|------|-----|--------------|----------|
| `_id` | ObjectId | MongoDB-ID (auto) | - |
| `taxonKey` | Number | **Verknüpfung zu species** | `2650105` |
| `species` | String | Wissenschaftlicher Name (Display) | `"Azolla caroliniana Willd."` |
| `organ` | String (optional) | Organ-Tag | `"leaf"`, `"flower"`, `null` |
| `occurrenceId` | Number | GBIF Occurrence-ID | `3949914583` |
| `url` | String | GBIF-Image-API-URL (ohne Größe) | `"https://api.gbif.org/v1/image/cache/occurrence/..."` |
| `creator` | String (optional) | Urheber (Attribution) | `"Alexandre Crégu"` |
| `license` | String (optional) | Lizenz-Kurzform | `"cc-by-sa"` |
| `wilsonScore` | Number (optional) | Bildqualitäts-Score (Placeholder) | `null` |

### Organ-Tag-Werte

| Wert | Bedeutung | Häufigkeit |
|------|-----------|------------|
| `"leaf"` | Blatt | ~35% |
| `"flower"` | Blüte | ~30% |
| `"fruit"` | Frucht | ~15% |
| `"habit"` | Gesamtpflanze/Habitus | ~10% |
| `"bark"` | Rinde | ~5% |
| `"other"` | Sonstiges (Samen, Wurzel, etc.) | ~3% |
| `null` | Unbekannt | ~20% |

---

## 🌱 Schema: ecology (Backup des Altstands)

`data/ecology/backup-ecology-prod-2026-08-02.ndjson` ist ein `mongoexport` der Prod-Collection
`ecology` vom 02.08.2026 — **3.363 Pflanzen mit Tichý/Ellenberg-Werten**, gesichert vor dem
Umstieg auf EIVE. Die Datei ist ein Backup, kein Pipeline-Output; sie wird von keinem Script
erzeugt oder gelesen.

```json
{
  "_id": { "$oid": "6939164ae388721766ad9e61" },
  "taxonKey": 2882580,
  "ecology": {
    "light": 6.81,
    "moisture": 3.28,
    "nutrients": 1.71,
    "ph": "x",
    "temperature": 3.58,
    "salt": 0
  }
}
```

- Werte sind Zahlen oder der String `"x"` (indifferent / kein Wert).
- **Sechs** Faktoren inkl. `salt`. EIVE 1.0 hat nur **fünf** (L, T, M, R, N) und **kein Salz**,
  außerdem eine andere Skala — die beiden Datensätze sind nicht ineinander umrechenbar.
- Der aktuelle Datensatz liegt unter `data/ecology/eive-1.0/`; Abdeckung, Zonenregel und alle
  Messwerte stehen in [ANALYSE.md](../data/ecology/eive-1.0/references/ANALYSE.md).

---

## 🔗 MongoDB Import

### 1. Collections erstellen & Daten importieren

```bash
# Species importieren
mongoimport \
  --uri "mongodb://localhost:27017/myflora" \
  --collection species \
  --file data/output/species.ndjson

# Multimedia importieren
mongoimport \
  --uri "mongodb://localhost:27017/myflora" \
  --collection multimedia \
  --file data/output/multimedia.ndjson
```

**Optional:** Mit Authentication
```bash
mongoimport \
  --uri "mongodb://username:password@host:27017/myflora?authSource=admin" \
  --collection species \
  --file data/output/species.ndjson
```

### 2. Indexes erstellen

**Empfohlene Indexes für optimale Performance:**

```javascript
// Wechsel zur Datenbank
use myflora;

// Species Indexes
db.species.createIndex(
  { taxonKey: 1 },
  { unique: true, name: "idx_taxonKey_unique" }
);

db.species.createIndex(
  { canonicalName: 1 },
  { name: "idx_canonicalName" }
);

db.species.createIndex(
  { "germanName": 1 },
  { name: "idx_germanName" }
);

// Optional: Text-Index für Volltextsuche
db.species.createIndex(
  {
    canonicalName: "text",
    scientificName: "text",
    "germanName": "text"
  },
  {
    name: "idx_fulltext_search",
    default_language: "none",
    weights: {
      "germanName": 10,
      canonicalName: 5,
      scientificName: 1
    }
  }
);

// Multimedia Indexes
db.multimedia.createIndex(
  { taxonKey: 1 },
  { name: "idx_taxonKey" }
);

db.multimedia.createIndex(
  { organ: 1 },
  { name: "idx_organ" }
);

db.multimedia.createIndex(
  { taxonKey: 1, organ: 1 },
  { name: "idx_taxonKey_organ" }
);

// Optional: für zukünftige Qualitätsfilterung
db.multimedia.createIndex(
  { wilsonScore: -1 },
  { name: "idx_wilsonScore_desc", sparse: true }
);
```

### 3. Index-Statistiken prüfen

```javascript
// Index-Nutzung prüfen
db.species.getIndexes();
db.multimedia.getIndexes();

// Index-Größe
db.species.stats().indexSizes;
db.multimedia.stats().indexSizes;
```

**Typische Index-Größen:**
- `species.idx_taxonKey_unique`: ~200 KB
- `multimedia.idx_taxonKey_organ`: ~150 MB (große Collection!)

---

## 🔍 Query-Patterns

### Häufige Queries für die App

#### 1. Alle Species mit deutschem Namen

```javascript
// Einfache Liste
db.species.find({
  germanName: { $exists: true, $ne: null }
});

// Mit Projektion (nur benötigte Felder)
db.species.find(
  { germanName: { $exists: true, $ne: null } },
  {
    taxonKey: 1,
    canonicalName: 1,
    "germanName": 1
  }
);
```

#### 2. Species nach deutschem Namen suchen

```javascript
// Exakte Suche (case-insensitive)
db.species.find({
  "germanName": { $regex: /^Algenfarn$/i }
});

// Prefix-Suche (für Autocomplete)
db.species.find({
  "germanName": { $regex: /^Algen/i }
});

// Volltextsuche (wenn Text-Index vorhanden)
db.species.find({
  $text: { $search: "Algenfarn" }
});
```

#### 3. Species Details mit Bildern

```javascript
// Aggregation: Species + Bilder verknüpfen
db.species.aggregate([
  { $match: { taxonKey: 2650105 } },
  {
    $lookup: {
      from: "multimedia",
      localField: "taxonKey",
      foreignField: "taxonKey",
      as: "images"
    }
  },
  {
    $project: {
      taxonKey: 1,
      canonicalName: 1,
      germanName: 1,
      imageCount: { $size: "$images" },
      images: {
        $slice: ["$images", 10]  // Nur erste 10 Bilder
      }
    }
  }
]);
```

#### 4. Bilder nach Organ filtern

```javascript
// Alle Blatt-Bilder für eine Art
db.multimedia.find({
  taxonKey: 2650105,
  organ: "leaf"
}).limit(20);

// Mehrere Organe
db.multimedia.find({
  taxonKey: 2650105,
  organ: { $in: ["leaf", "flower"] }
});

// Nur Bilder MIT Organ-Tag (null ausschließen)
db.multimedia.find({
  taxonKey: 2650105,
  organ: { $ne: null }
});
```

#### 5. Zufällige Art für Quiz

```javascript
// MongoDB $sample (effizient)
db.species.aggregate([
  { $match: { germanName: { $exists: true, $ne: null } } },
  { $sample: { size: 1 } }
]);

// Mit Bildern
db.species.aggregate([
  { $match: { germanName: { $exists: true, $ne: null } } },
  { $sample: { size: 1 } },
  {
    $lookup: {
      from: "multimedia",
      let: { tk: "$taxonKey" },
      pipeline: [
        { $match: { $expr: { $eq: ["$taxonKey", "$$tk"] } } },
        { $sample: { size: 4 } }  // 4 zufällige Bilder
      ],
      as: "images"
    }
  },
  { $match: { "images.3": { $exists: true } } }  // Mind. 4 Bilder
]);
```

#### 6. Species mit Bildern für bestimmtes Organ

```javascript
// Alle Arten mit Blüten-Bildern
db.multimedia.distinct("taxonKey", { organ: "flower" });

// Species-Details für diese Arten
const taxonKeys = db.multimedia.distinct("taxonKey", { organ: "flower" });
db.species.find({ taxonKey: { $in: taxonKeys } });
```

---

## ⚡ Performance-Optimierung

### Query-Optimierung

**1. Projektion nutzen (nur benötigte Felder):**
```javascript
// ❌ Schlecht (lädt alle Felder)
db.species.find({ taxonKey: 2650105 });

// ✅ Gut (nur benötigte Felder)
db.species.find(
  { taxonKey: 2650105 },
  { canonicalName: 1, germanName: 1, _id: 0 }
);
```

**2. Limit verwenden:**
```javascript
// ❌ Schlecht (lädt alle ~3M Bilder)
db.multimedia.find({ taxonKey: 2650105 });

// ✅ Gut (nur benötigte Anzahl)
db.multimedia.find({ taxonKey: 2650105 }).limit(20);
```

**3. Covered Queries (Index-Only):**
```javascript
// Query nutzt nur Index-Felder → sehr schnell
db.species.find(
  { taxonKey: 2650105 },
  { taxonKey: 1, canonicalName: 1, _id: 0 }
).hint("idx_taxonKey_unique");
```

### Index-Strategie

**Wichtig:** Indexes beschleunigen Queries, verlangsamen aber Writes!

**Für Read-Heavy Apps (wie My-Plants):**
- ✅ Großzügig Indexes verwenden
- ✅ Compound-Indexes für häufige Kombinationen
- ✅ Text-Index für Volltextsuche

**Für Write-Heavy Apps:**
- ⚠️ Minimale Indexes (nur Primary Keys)
- ⚠️ Keine Compound-Indexes

### Aggregation-Pipeline-Optimierung

**1. $match früh in Pipeline:**
```javascript
// ✅ Gut (filtert früh)
db.species.aggregate([
  { $match: { germanName: { $exists: true, $ne: null } } },  // Früh!
  { $lookup: { ... } },
  { $project: { ... } }
]);

// ❌ Schlecht (filtert spät)
db.species.aggregate([
  { $lookup: { ... } },
  { $project: { ... } },
  { $match: { germanName: { $exists: true, $ne: null } } }  // Zu spät!
]);
```

**2. $project früh in Pipeline (reduziert Datenvolumen):**
```javascript
db.species.aggregate([
  { $match: { ... } },
  { $project: { taxonKey: 1, canonicalName: 1 } },  // Früh!
  { $lookup: { ... } }
]);
```

---

## 📊 Monitoring & Statistiken

### Collection-Statistiken

```javascript
// Anzahl Dokumente
db.species.countDocuments();
db.multimedia.countDocuments();

// Speichernutzung
db.species.stats();
db.multimedia.stats();

// Durchschnittliche Dokumentgröße
db.species.stats().avgObjSize;  // ~500 Bytes
db.multimedia.stats().avgObjSize;  // ~250 Bytes
```

### Query-Performance analysieren

```javascript
// Explain-Plan anzeigen
db.species.find({ taxonKey: 2650105 }).explain("executionStats");

// Wichtige Metriken:
// - executionTimeMillis: Dauer in ms
// - totalDocsExamined: Anzahl geprüfter Dokumente
// - totalKeysExamined: Anzahl geprüfter Index-Einträge
// - indexName: Verwendeter Index

// ✅ Ideal: totalDocsExamined = nReturned (kein Overhead)
```

### Slow-Queries loggen

```javascript
// Slow-Queries ab 100ms loggen
db.setProfilingLevel(1, { slowms: 100 });

// Log anzeigen
db.system.profile.find().limit(10).sort({ ts: -1 }).pretty();

// Profiling deaktivieren
db.setProfilingLevel(0);
```

---

## 🔄 Daten-Updates

### Upsert für inkrementelle Updates

```javascript
// Neue/geänderte Species importieren (ohne Duplikate)
db.species.updateOne(
  { taxonKey: 2650105 },
  {
    $set: {
      scientificName: "...",
      canonicalName: "...",
      // ...
    }
  },
  { upsert: true }
);

// Bulk-Upsert via MongoDB-Tool
mongoimport \
  --uri "mongodb://localhost:27017/myflora" \
  --collection species \
  --file data/output/species_delta.ndjson \
  --mode upsert \
  --upsertFields taxonKey
```

### Alte Daten entfernen

```javascript
// Species ohne Bilder entfernen (optional)
const taxonKeysWithImages = db.multimedia.distinct("taxonKey");

db.species.deleteMany({
  taxonKey: { $nin: taxonKeysWithImages }
});

// Bilder für nicht mehr existierende Species entfernen
const validTaxonKeys = db.species.distinct("taxonKey");

db.multimedia.deleteMany({
  taxonKey: { $nin: validTaxonKeys }
});
```

---

## 🎨 Frontend-Integration

### REST API Beispiele (Node.js/Express)

```javascript
const { MongoClient } = require('mongodb');
const express = require('express');
const app = express();

const client = new MongoClient('mongodb://localhost:27017');
const db = client.db('myflora');

// 1. Suche nach deutschem Namen
app.get('/api/species/search', async (req, res) => {
  const { q } = req.query;

  const results = await db.collection('species').find({
    "germanName": { $regex: new RegExp(q, 'i') }
  }).limit(20).toArray();

  res.json(results);
});

// 2. Species-Details mit Bildern
app.get('/api/species/:taxonKey', async (req, res) => {
  const taxonKey = parseInt(req.params.taxonKey);

  const species = await db.collection('species').findOne({ taxonKey });
  if (!species) return res.status(404).json({ error: 'Not found' });

  const images = await db.collection('multimedia')
    .find({ taxonKey })
    .limit(50)
    .toArray();

  res.json({ ...species, images });
});

// 3. Zufällige Art für Quiz
app.get('/api/quiz/random', async (req, res) => {
  const [species] = await db.collection('species').aggregate([
    { $match: { germanName: { $exists: true, $ne: null } } },
    { $sample: { size: 1 } },
    {
      $lookup: {
        from: "multimedia",
        let: { tk: "$taxonKey" },
        pipeline: [
          { $match: { $expr: { $eq: ["$taxonKey", "$$tk"] } } },
          { $sample: { size: 4 } }
        ],
        as: "images"
      }
    },
    { $match: { "images.3": { $exists: true } } }
  ]).toArray();

  res.json(species);
});
```

### GraphQL Schema (optional)

```graphql
type Species {
  taxonKey: Int!
  scientificName: String!
  canonicalName: String!
  germanName: String!
  family: String
  familyKey: Int
  germanFamilyName: String
  images(organ: String, limit: Int = 20): [Image!]!
}

type Image {
  occurrenceId: Int!
  url: String!
  organ: String
  creator: String
  license: String
}

type Query {
  species(taxonKey: Int!): Species
  searchSpecies(query: String!, limit: Int = 20): [Species!]!
  randomSpecies(withImages: Boolean = true): Species
}
```

---

## 📝 Best Practices

### 1. Daten-Validierung

```javascript
// Schema-Validierung in MongoDB (optional)
db.createCollection("species", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["taxonKey", "canonicalName", "scientificName", "germanName"],
      properties: {
        taxonKey: { bsonType: "int" },
        canonicalName: { bsonType: "string" },
        scientificName: { bsonType: "string" },
        germanName: { bsonType: "string" },
        familyKey: { bsonType: ["int", "null"] },
        family: { bsonType: ["string", "null"] },
        germanFamilyName: { bsonType: ["string", "null"] }
      }
    }
  }
});
```

### 2. Caching-Strategie

**Für read-heavy Zugriffe:**

```javascript
// Redis-Cache für häufige Queries
const redis = require('redis');
const cache = redis.createClient();

async function getSpeciesWithCache(taxonKey) {
  const cacheKey = `species:${taxonKey}`;

  // 1. Cache-Lookup
  const cached = await cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  // 2. DB-Query
  const species = await db.collection('species').findOne({ taxonKey });

  // 3. Cache schreiben (TTL: 1 Stunde)
  await cache.setEx(cacheKey, 3600, JSON.stringify(species));

  return species;
}
```

### 3. Backup-Strategie

```bash
# Backup erstellen
mongodump \
  --uri "mongodb://localhost:27017" \
  --db myflora \
  --out /backup/myflora_$(date +%Y%m%d)

# Restore
mongorestore \
  --uri "mongodb://localhost:27017" \
  --db myflora \
  /backup/myflora_20250907
```

---

**Dokumentversion:** 1.1 (August 2026) — Schema an den tatsächlichen Pipeline-Output angeglichen
