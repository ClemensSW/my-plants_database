#!/usr/bin/env node
'use strict';
/**
 * Schritt 6: Die importfertigen Dokumente bauen.
 *
 * Führt alle Quellen zusammen und schreibt zwei Dateien in **exakt den Feldnamen des
 * Backend-Schemas** — das Importskript dort muss nichts mehr umbenennen.
 *
 * ## Aufnahmeregel
 *
 *   mindestens ein deutscher Name  UND  mindestens ein Bild mit erlaubter Lizenz
 *
 * ## Lizenz: Erlaubnisliste, keine Verbotsliste
 *
 * Gemessen kommen im Bestand vor: cc-by-sa · cc-by · cc-by-nc · cc-by-nc-sa · © · gpl · public.
 * Gefiltert wird gegen die **Erlaubnisliste** — ein Filter, der nur `cc-by-nc` ausschließt, ließe
 * `cc-by-nc-sa` und jede künftige Schreibvariante durch. NC schließt kommerzielle Nutzung aus, und
 * MyPlants hat ein Abo-Modell.
 *
 * ## Zwei Sammlungen, nicht eine
 *
 * Fagus sylvatica hat 43.095 Bilder ≈ 8,6 MB als eingebettetes Array — bei 16 MB Dokumentlimit.
 * Außerdem hängen die Cover-Aggregation, das 300er-Bildfenster und die Galerie-Paginierung im
 * Backend an eigenständigen Medienzeilen.
 *
 * Input:  data/work/species_enriched.ndjson · data/work/ecology_by_taxon.ndjson
 *         data/raw/plantnet/plantnet_species_detail.ndjson · plantnet_images.ndjson
 * Output: data/build/plants.ndjson · data/build/plantmedias.ndjson (+ build.meta.json)
 *
 * Usage:
 *   node pipeline/06_build_documents.js
 *   node pipeline/06_build_documents.js --licenses=cc-by,cc-by-sa,cc0,public
 */

const fs = require('fs');
const readline = require('readline');

const path = require('path');

const { DIRS, FILES, ensureDirs, requireFiles, rel } = require('./lib/paths');
const { buildSearchNames, squash } = require('./lib/search-normalize');
const { loadLookup } = require('./lib/gbif-key-resolver');
const { stripAuthorship, istBrauchbarerName } = require('./lib/botanical-name');

const CONFIG = {
  // Erlaubnisliste. `cc-by-nc`, `cc-by-nc-sa`, `©` und alles Unbekannte fallen damit heraus.
  LICENSES: ['cc-by', 'cc-by-sa', 'cc0', 'cc-0', 'public'],
  IMAGE_BASE: 'https://bs.plantnet.org/image',
};

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}
const fmt = (n) => Number(n).toLocaleString('de-DE');

async function* readNdjson(file) {
  const rl = readline.createInterface({
    input: fs.createReadStream(file, 'utf8'),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (line.trim()) yield JSON.parse(line);
  }
}

/** Lizenz auf Kleinschreibung normalisieren; `©` und Leeres fallen durch die Erlaubnisliste. */
function licenseAllowed(license, allowed) {
  return allowed.has(String(license || '').trim().toLowerCase());
}

async function main() {
  const args = new Map(process.argv.slice(2).map((a) => {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (!m) throw new Error(`Unbekanntes Argument: ${a}`);
    return [m[1], m[2] === undefined ? true : m[2]];
  }));
  if (args.has('licenses')) CONFIG.LICENSES = String(args.get('licenses')).split(',');
  const allowed = new Set(CONFIG.LICENSES.map((l) => l.trim().toLowerCase()));

  requireFiles('speciesEnriched', 'plantnetImages');
  ensureDirs('build');

  console.log('='.repeat(64));
  console.log('Schritt 6: Importfertige Dokumente bauen');
  console.log('='.repeat(64));
  log(`Erlaubte Lizenzen: ${[...allowed].join(' · ')}`);
  console.log();

  // ── Durchgang 1: Welche Arten haben erlaubte Bilder? ────────────────────────
  /**
   * Dieselbe Übersetzung, die Schritt 03 für die Namen benutzt — jetzt für die Bilder.
   *
   * Die Bilder tragen den Schlüssel, den Pl@ntNet beim Ernten genannt hat. Weicht der von GBIFs
   * heutigem ab, sucht die Schleife weiter unten unter dem GBIF-Schlüssel und findet nichts: Die
   * Art landet ohne Bilder im Katalog und fällt damit aus der Auswahlregel („dt. Name UND ≥1 Bild“).
   * Genau so verschwanden 672 Arten, darunter Prüfungspflanzen.
   *
   * Fehlt die Karte, wird NICHT still weitergemacht — dann liefe der Bau in denselben Verlust,
   * ohne dass es jemand merkt.
   */
  const keyLookup = loadLookup(FILES.gbifKeyMap);
  if (keyLookup.size === 0) {
    console.error(
      '\n🔴 ABBRUCH: Die Schluesselkarte fehlt (' + FILES.gbifKeyMap + ').\n' +
      '   Sie entsteht in Schritt 03. Ohne sie fallen ~672 Arten mit deutschem Namen und Bildern\n' +
      '   still aus dem Katalog. Erst `npm run pipeline:merge` laufen lassen.\n');
    process.exit(1);
  }
  log(`Schlüsselkarte: ${fmt(keyLookup.size)} Übersetzungen`);
  /** Pl@ntNets Schlüssel → GBIFs heutiger. Unbekanntes bleibt, wie es ist. */
  const auflösen = (k) => keyLookup.get(String(k)) ?? k;

  log('Durchgang 1/3 — Bilder sichten (4,4 GB, dauert einige Minuten) …');
  const imageStats = new Map();   // taxonKey → { total, byOrgan }
  const licenseSeen = {};
  let imagesRead = 0;
  let imagesAllowed = 0;
  let imagesOhneKey = 0;   // ueber `name:<Pl@ntNet-Name>` gerettet

  for await (const img of readNdjson(FILES.plantnetImages)) {
    imagesRead++;
    const lic = String(img.license || '(ohne)').toLowerCase();
    licenseSeen[lic] = (licenseSeen[lic] || 0) + 1;
    if (!licenseAllowed(img.license, allowed)) continue;
    /**
     * 🔴 Ein Bild OHNE `taxonKey` ist nicht verloren — es ist nur nicht beschriftet.
     *
     * Schritt 04 schreibt Pl@ntNets rohen `gbifKey` an jedes Bild. Wo Pl@ntNet keinen hat, stand
     * dort `null`, und diese Zeile warf das Bild weg. Gemessen am 24.08.2026: **60.228 Bilder in
     * 54 Arten**, darunter der Löwenzahn (16.931) und der Ackersenf (11.898).
     *
     * Die Übersetzung dafür liegt längst in der Schlüsselkarte — Schritt 03 legt genau für diese
     * Fälle einen Eintrag unter `name:<Pl@ntNet-Name>` an. Sie wurde nur nie befragt.
     */
    const key = img.taxonKey
      ? auflösen(img.taxonKey)
      : (keyLookup.get(`name:${img.species}`) ?? null);
    if (!key) continue;
    imagesAllowed++;
    if (!img.taxonKey) imagesOhneKey++;
    let s = imageStats.get(key);
    if (!s) { s = { total: 0, byOrgan: {} }; imageStats.set(key, s); }
    s.total++;
    s.byOrgan[img.organ] = (s.byOrgan[img.organ] || 0) + 1;
    if (imagesRead % 5000000 === 0) log(`  ${fmt(imagesRead)} Bilder gelesen …`);
  }
  log(`  ${fmt(imagesRead)} Bilder gelesen · ${fmt(imagesAllowed)} mit erlaubter Lizenz · `
    + `${fmt(imageStats.size)} Arten`);
  if (imagesOhneKey > 0) {
    log(`  davon ${fmt(imagesOhneKey)} ohne Pl@ntNet-Schlüssel, über den Namen zugeordnet`);
  }

  // ── Artebene: Detaildaten und Zeigerwerte in den Speicher ──────────────────
  log('Durchgang 2/3 — Artebene zusammenführen …');
  const detail = new Map();
  if (fs.existsSync(FILES.plantnetSpeciesDetail)) {
    for await (const d of readNdjson(FILES.plantnetSpeciesDetail)) {
      if (d.taxonKey) detail.set(d.taxonKey, d);
    }
  }
  // Deutsche Familiennamen aus Schritt 5
  let familyNames = {};
  const familyFile = path.join(DIRS.work, 'family_names.json');
  if (fs.existsSync(familyFile)) {
    familyNames = JSON.parse(fs.readFileSync(familyFile, 'utf8'));
  } else {
    log('⚠ data/work/family_names.json fehlt — `germanFamily` bliebe leer. Schritt 5 laufen lassen.');
  }

  /**
   * Deutsche Trivialnamen aus Wikidata — Schritt 09.
   *
   * 🔴 Sie sind die EINZIGE Namensquelle fuer diese 316 Arten. Pl@ntNet und GBIF kennen dort
   * keinen deutschen Namen, und ohne Namen faellt eine Art am Tor unten heraus. Wer diese Datei
   * beim Bauen vergisst, verliert sie still — der Lauf, der sie geholt hat, dauerte sechs Stunden.
   */
  const wikidataNames = new Map();   // taxonKey → [{ name, quelle }]
  if (fs.existsSync(FILES.wikidataNames)) {
    for await (const w of readNdjson(FILES.wikidataNames)) {
      if (!w.taxonKey || !Array.isArray(w.namen) || w.namen.length === 0) continue;
      const bisher = wikidataNames.get(w.taxonKey) || [];
      wikidataNames.set(w.taxonKey, [...bisher, ...w.namen]);
    }
    log(`  Wikidata-Namen fuer ${fmt(wikidataNames.size)} Arten geladen`);
  } else {
    log(`⚠ ${rel(FILES.wikidataNames)} fehlt — ${'316'} Arten blieben ohne deutschen Namen. Schritt 09 laufen lassen.`);
  }

  const ecology = new Map();
  if (fs.existsSync(FILES.ecologyByTaxon)) {
    for await (const e of readNdjson(FILES.ecologyByTaxon)) {
      if (e.taxonKey) ecology.set(e.taxonKey, e);
    }
  }
  log(`  Detaildaten ${fmt(detail.size)} · Zeigerwerte ${fmt(ecology.size)} · `
    + `Familien ${fmt(Object.keys(familyNames).length)}`);

  // ── plants.ndjson schreiben ────────────────────────────────────────────────
  const plantsOut = fs.createWriteStream(FILES.buildPlants, { encoding: 'utf8', flags: 'w' });
  const selected = new Set();
  const stats = {
    speciesSeen: 0, withGermanName: 0, withImages: 0, selected: 0,
    withEive: 0, withLegacyEcology: 0, withSynonyms: 0, withGrowthForm: 0, withGermanFamily: 0,
    namesTotal: 0, synonymsTotal: 0, searchTermsTotal: 0, nurWikidata: 0, mitRang: 0,
  };

  for await (const sp of readNdjson(FILES.speciesEnriched)) {
    stats.speciesSeen++;
    /**
     * Das Aufnahmetor: ohne deutschen Namen keine Pflanze.
     *
     * 🔴 Wikidata zaehlt hier als vollwertige Quelle. Vorher stand hier nur `if (!de) continue`,
     * und eine Art, die AUSSCHLIESSLICH ueber Wikidata benannt ist, kam nie bis zur Zeile, in der
     * ihre Namen zusammengesetzt werden. Der Erntelauf war dann umsonst.
     */
    const wikidata = (wikidataNames.get(sp.taxonKey) || []).map(x => x.name).filter(Boolean);
    const de = sp.commonNames?.de;
    if (!de && wikidata.length === 0) continue;
    stats.withGermanName++;
    if (!de && wikidata.length > 0) stats.nurWikidata++;

    const img = imageStats.get(sp.taxonKey);
    if (!img || img.total === 0) continue;
    stats.withImages++;

    const d = detail.get(sp.taxonKey) || {};
    const eco = ecology.get(sp.taxonKey) || {};

    // Namen: Pl@ntNets vollständige Rangliste, sonst der eine aus dem Listen-Endpunkt,
    // ergänzt um die GBIF-Namen. Reihenfolge = Rangfolge, Dubletten fallen raus.
    const plantnetNames = (d.commonNames && d.commonNames.length ? d.commonNames : de?.plantnet) || [];
    // Reihenfolge = Rangfolge: Pl@ntNet, dann GBIF, dann Wikidata. Wikidata steht hinten, weil
    // seine Namen aus Wikipedia-Artikeltiteln stammen und oefter die seltenere Bezeichnung sind.
    const germanNames = [...new Set(
      [...plantnetNames, ...(de?.gbif || []), ...wikidata]
        .map((n) => String(n).trim())
        // Unrat aus den Gemeinschaftsdaten faellt hier heraus — er stuende sonst im Handbuch
        // unter „Weitere Namen" und im Suchindex. Siehe `istBrauchbarerName`.
        .filter(istBrauchbarerName),
    )];

    /**
     * Synonyme — aus zwei Quellen, und die zweite ist die, die lange gefehlt hat.
     *
     * **1. Pl@ntNets eigene Synonymliste.** Wie bisher.
     *
     * **2. Die Namen, unter denen Pl@ntNet DIESE Art führt**, sofern sie vom akzeptierten Namen
     * abweichen. Das ist kein Beiwerk: Pl@ntNet nennt die Pflanze `Waldsteinia ternata`, GBIF
     * führt sie als `Geum ternatum` — und Pl@ntNet listet den eigenen Namen naturgemäß nicht als
     * Synonym seiner selbst. Wer ihn gelernt hat, fand die Pflanze deshalb nicht.
     *
     * Dasselbe gilt, wenn mehrere Pl@ntNet-Arten auf eine akzeptierte abgebildet werden:
     * `Aconitum vulparia` und `Aconitum moldavicum` sind beide `Aconitum lycoctonum`, und unter
     * beiden Namen wird gesucht.
     *
     * Am 23.08.2026 gemessen: 271 bereits zugeordnete Pflanzen tragen einen Pl@ntNet-Namen, der
     * heute nirgends im Index steht — überwiegend Schreibvarianten wie `serpillifolia` gegen
     * `serpyllifolia`, die auch jemand so sucht.
     */
    const zuordnungsNamen = (sp.plantnet?.alleNamen || [])
      .filter((n) => n && squash(n) !== squash(sp.canonicalName));

    const synonyms = [...new Set([
      ...(d.synonyms || [])
        .map((s) => (typeof s === 'string' ? s : s && (s.name || s.scientificName)))
        .filter(Boolean),
      ...zuordnungsNamen,
    ])];

    const growthForm = (d.traits || [])
      .find((t) => t.key === 'growth_form')?.values?.map((v) => v.key).join(', ') || null;

    /**
     * Der Suchindex bekommt die Namen OHNE Autorenangabe.
     *
     * `buildSearchTerms` klebt jeden Namen zu einer Zeichenkette ohne Leerzeichen. Aus
     * `Alyssum minutulum Schleich. ex DC.` wird `alyssumminutulumschleichexdc` — und darin steckt
     * `eiche`, weil `Schleich.` und `ex` aneinanderstossen. 58 der 244 Treffer fuer „Eiche" kamen
     * am 23.08.2026 auf diesem Weg zustande.
     *
     * Die vollen Zitierungen bleiben in `synonyms` stehen; gekuerzt wird nur, was in die Suche geht.
     */
    const searchNames = buildSearchNames([
      ...germanNames,
      sp.canonicalName,
      // ⚠️ Auch hier — und zwar VOR ALLEM hier. Der wissenschaftliche Name ist der Haupttraeger
      // der Autorenangabe: `Lotus alpinus (Ser.) Schleich. ex Ramond`. Genau dieser Eintrag, nicht
      // ein Synonym, hat den Alpen-Hornklee bei „Eiche" auftauchen lassen. Nach dem Kuerzen ist er
      // meist identisch mit `canonicalName` — das Set wirft die Dublette weg.
      stripAuthorship(sp.scientificName),
      ...synonyms.map(stripAuthorship),
    ].filter(Boolean));

    /**
     * Das Altfeld — ABGELEITET, nicht zweitgebaut.
     *
     * Eine aeltere App-Fassung kennt `searchNames` nicht und fiele sonst still auf die Notsuche
     * ueber drei Rohfelder zurueck: ohne Synonyme, ohne Zweitnamen. Wer „Mahonia aquifolium" tippt,
     * fande dann nichts mehr.
     *
     * Aus denselben Zeichenketten abgeleitet statt getrennt gebaut, damit beide nie
     * auseinanderlaufen. Nach dem Entfernen der Leerzeichen fallen Dubletten an, die es mit
     * Leerzeichen nicht gab („Stiel Eiche" und „Stieleiche" werden beide `stieleiche`) — das Set
     * raeumt sie weg.
     */
    const searchTerms = [...new Set(searchNames.map((n) => n.replace(/ /g, '')))];

    /**
     * Der Rang unterhalb der Art — soweit er sich AUS DEN DATEN ergibt.
     *
     * 🔴 Nur die Sammelart steht hier. Hybride, Sorte, Unterart, Varietät und Form sind am Namen
     * ablesbar; die App leitet sie selbst ab und braucht kein Feld dafür.
     *
     * Die Sammelart ist es NICHT. Der Löwenzahn heißt im Katalog *Taraxacum officinale* — das
     * sieht aus wie eine gewöhnliche Art. Dass Pl@ntNet ihn als *Taraxacum* sect. *Taraxacum*
     * führt, steht ausschließlich in seinen Synonymen. Wer diesen Vermerk nicht mitgibt, verliert
     * die Auskunft an genau der Stelle, an der sie gelernt werden soll.
     */
    const rang = synonyms.some((x) => /\b(sect|agg)\.?(\s|$)/i.test(String(x)))
      ? 'aggregate'
      : null;
    if (rang) stats.mitRang++;

    const doc = {
      taxonKey: sp.taxonKey,
      /**
       * Der quellenunabhaengige Schluessel.
       *
       * Fuer eine GBIF-Art ist er der `taxonKey` selbst — die Baender fangen erst bei 10⁹ an.
       * Eine Sorte, die spaeter aus Wikidata kommt, bekommt `1_000_000_000 + Q-Nummer` und
       * `taxonKey: null`. Siehe `plant-media.schema.ts` im Backend.
       */
      plantKey: sp.taxonKey,
      /** Bei einer Art gibt es kein Elterntaxon im Katalog. Sorten tragen hier ihre Art. */
      parentPlantKey: null,
      rang,
      scientificName: sp.scientificName,
      canonicalName: sp.canonicalName,
      germanName: germanNames[0] || de?.primary || wikidata[0],   // Altfeld — bleibt gefüllt
      germanNames,                                    // NEU: Rangfolge erhalten
      synonyms,                                       // NEU
      searchNames,                                    // NEU — mit Wortgrenzen, fuer die Rangfolge
      searchTerms,                                    // Altfeld, aus searchNames abgeleitet
      botanicalFamily: sp.family || null,
      germanFamily: familyNames[sp.familyKey]?.germanFamily || null,
      familyKey: sp.familyKey || null,
      growthForm,                                     // NEU
      uses: d.uses || [],                             // NEU
      iucn: d.iucn || null,                           // NEU
      externalIds: {                                  // NEU
        gbif: sp.taxonKey,
        powo: d.powo?.id || null,
        ipni: d.ipni?.id || null,
        eppo: d.eppo?.code || null,
        taxref: d.taxref?.id || null,
      },
      imagesCountByOrgan: img.byOrgan,                // NEU — nur erlaubte Bilder gezählt
      imagesCount: img.total,
      isActive: true,
    };
    if (eco.eive) { doc.eive = eco.eive; stats.withEive++; }
    if (eco.ecology) { doc.ecology = eco.ecology; stats.withLegacyEcology++; }
    if (synonyms.length) stats.withSynonyms++;
    if (growthForm) stats.withGrowthForm++;
    if (doc.germanFamily) stats.withGermanFamily++;
    stats.namesTotal += germanNames.length;
    stats.synonymsTotal += synonyms.length;
    stats.searchTermsTotal += searchTerms.length;

    plantsOut.write(JSON.stringify(doc) + '\n');
    selected.add(sp.taxonKey);
    stats.selected++;
  }
  await new Promise((r) => plantsOut.end(r));
  log(`  plants.ndjson: ${fmt(stats.selected)} Pflanzen`);

  // ── Durchgang 3: plantmedias.ndjson ────────────────────────────────────────
  log('Durchgang 3/3 — Medienzeilen schreiben …');
  const mediaOut = fs.createWriteStream(FILES.buildPlantMedias, { encoding: 'utf8', flags: 'w' });
  let mediaWritten = 0;
  const organCount = {};
  let ratingSum = 0;

  for await (const img of readNdjson(FILES.plantnetImages)) {
    // Derselbe Rückweg wie in Durchgang 1 — sonst zählt Durchgang 1 die Bilder des Löwenzahns
    // mit, und Durchgang 3 schreibt sie nicht. Die Pflanze käme mit `imagesCount: 16.931` in den
    // Katalog und hätte kein einziges Bild.
    const key = img.taxonKey
      ? auflösen(img.taxonKey)
      : (keyLookup.get(`name:${img.species}`) ?? null);
    if (!key || !selected.has(key)) continue;
    if (!licenseAllowed(img.license, allowed)) continue;
    const occurrenceId = Number(img.observationId);
    mediaOut.write(JSON.stringify({
      taxonKey: key,
      // Derselbe Wert, anderer Schluesselraum — siehe oben. Der Import verknuepft hierueber.
      plantKey: key,
      species: img.species,
      organ: img.organ,
      occurrenceId: Number.isFinite(occurrenceId) ? occurrenceId : null,
      // Die Original-URL. Die App leitet daraus `m` und `s` ab, indem sie das
      // Pfadsegment tauscht — an 14.812 Bildern geprüft, null Abweichungen.
      url: `${CONFIG.IMAGE_BASE}/o/${img.imageId}`,
      license: img.license,
      creator: img.author || null,
      rating: img.plus ?? 0,       // ← Pl@ntNets Community-Zustimmung
      // Das Aufnahmedatum, wie Pl@ntNet es liefert: ein fertig formatierter deutscher
      // ANZEIGESTRING („14. Jan. 2024"), weil die Ernte mit `lang=de` lief. Deshalb heisst
      // das Feld `dateText` und nicht `date` — `new Date(m.dateText)` ergibt „Invalid Date",
      // und zwar still. Es gehoert in die Bildangabe, nicht in eine Sortierung.
      //
      // Beim Wechsel auf API v2 kommt das Datum als `date: { timestamp, string }`; dann kann
      // hier zusaetzlich der Zeitstempel mitgeschrieben werden, ohne diesen String zu verlieren.
      dateText: img.date || null,
      isActive: true,
    }) + '\n');
    mediaWritten++;
    organCount[img.organ] = (organCount[img.organ] || 0) + 1;
    ratingSum += img.plus || 0;
  }
  await new Promise((r) => mediaOut.end(r));

  // ── Meta ───────────────────────────────────────────────────────────────────
  const meta = {
    step: '06_build_documents',
    finishedAt: new Date().toISOString(),
    rule: 'deutscher Name UND mindestens ein Bild mit erlaubter Lizenz',
    licensesAllowed: [...allowed],
    licensesSeen: licenseSeen,
    result: {
      ...stats,
      mediaWritten,
      organCount,
      ratingAvg: mediaWritten ? Number((ratingSum / mediaWritten).toFixed(2)) : 0,
      namesPerPlant: stats.selected ? Number((stats.namesTotal / stats.selected).toFixed(1)) : 0,
      synonymsPerPlant: stats.selected ? Number((stats.synonymsTotal / stats.selected).toFixed(1)) : 0,
    },
  };
  fs.writeFileSync(FILES.buildMeta, JSON.stringify(meta, null, 2), 'utf8');

  console.log();
  console.log('='.repeat(64));
  log(`Arten gesichtet:      ${fmt(stats.speciesSeen)}`);
  log(`  mit dt. Namen:      ${fmt(stats.withGermanName)}`);
  // Laut sagen, was NUR durch Wikidata hereinkam — sonst ist der Sechs-Stunden-Lauf unsichtbar.
  log(`     davon nur Wikidata: ${fmt(stats.nurWikidata)}`);
  log(`   als Sammelart vermerkt: ${fmt(stats.mitRang)}`);
  log(`  + mit Bildern:      ${fmt(stats.withImages)}`);
  log(`➜ PFLANZEN:           ${fmt(stats.selected)}`);
  log(`   Trivialnamen Ø     ${meta.result.namesPerPlant} · Synonyme Ø ${meta.result.synonymsPerPlant}`);
  log(`   mit EIVE           ${fmt(stats.withEive)} · Alt-Zeigerwerte ${fmt(stats.withLegacyEcology)}`);
  log(`   mit Wuchsform      ${fmt(stats.withGrowthForm)} · mit dt. Familie ${fmt(stats.withGermanFamily)}`);
  log(`➜ MEDIENZEILEN:       ${fmt(mediaWritten)}  (Ø Bewertung ${meta.result.ratingAvg})`);
  log(`   je Organ:          ${Object.entries(organCount).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${fmt(v)}`).join(' · ')}`);
  console.log();
  log('Lizenzen im Rohbestand:');
  for (const [k, v] of Object.entries(licenseSeen).sort((a, b) => b[1] - a[1])) {
    console.log(`     ${allowed.has(k) ? '✓' : '✗'} ${k.padEnd(14)} ${fmt(v).padStart(12)}`);
  }
  console.log();
  log(`${rel(FILES.buildPlants)} · ${rel(FILES.buildPlantMedias)}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('\n❌ Fehler:', err.message);
    console.error(err.stack);
    process.exit(1);
  });
}

module.exports = { main };
