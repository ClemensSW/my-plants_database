'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { apiGet, pool } = require('./gbif');

/**
 * Pl@ntNets `gbifKey` in einen Schlüssel übersetzen, den GBIFs Backbone heute wirklich führt.
 *
 * ## Das Problem, das dieser Auflöser löst
 *
 * Pl@ntNet liefert zu jeder Art einen `gbifKey`. Der stimmt meistens — aber nicht immer, und wenn
 * er nicht stimmt, passiert nichts Lautes: Die Art wird über den Schlüssel gesucht, nicht gefunden,
 * und fällt still aus dem Katalog.
 *
 * Am 21.08.2026 gemessen, über alle Pl@ntNet-Arten mit deutschem Namen UND Bildern:
 *
 *     12.186 Arten
 *     11.514 Schlüssel passt
 *        672 Schlüssel zeigt ins Leere   ← 5,5 %, darunter Prüfungspflanzen
 *
 * Ein Beispiel: *Cercidiphyllum japonicum* (Japanischer Kuchenbaum, in der AuGaLa-Prüfungsliste)
 * hat 2.364 Bilder, alle `cc-by-sa`, und einen deutschen Namen. Pl@ntNet nennt den Schlüssel
 * 12281377, GBIFs Backbone führt die Art unter 8060423. Die Pflanze war deshalb nicht im Katalog.
 *
 * ## Warum GBIF entscheidet und nicht Pl@ntNet
 *
 * Weil GBIF bei den botanischen Namen aktueller ist. Der Backbone hängt Arten um, wenn die
 * Systematik sich ändert — *Dicentra spectabilis* heisst dort seit Jahren *Lamprocapnos
 * spectabilis*, *Anemone nemorosa* ist *Anemonoides nemorosa*. Pl@ntNets Schlüssel folgen dem
 * verzögert. Wo beide sich widersprechen, gilt GBIF.
 *
 * ## Die Kaskade
 *
 *   1. **direkt** — der `gbifKey` steht in unserer Liste akzeptierter Arten. Fertig, ohne Netz.
 *   2. **name** — der wissenschaftliche Name steht dort. Auch ohne Netz.
 *   3. **match** — GBIFs `species/match` befragen. Liefert es ein Synonym, wird dem
 *      `acceptedUsageKey` gefolgt. Nur ab hier kostet es eine Anfrage.
 *   4. **artname** — derselbe Anfrage, anderes Feld: GBIF nennt in `species` den Artnamen im
 *      Klartext, auch wenn der Schlüssel auf eine UNTERART zeigt. Kostet keine weitere Anfrage.
 *   5. **gattung** — GBIF löste nur bis zur GATTUNG auf. Gattung + Artepitheton der Anfrage
 *      ergibt den Artnamen. Nur bei echten Zweiwortnamen, nie bei Hybriden.
 *   6. **sammelart** — der Name trägt eine RANGMARKE (`sect.` · `agg.` · `ser.`), zu der GBIFs
 *      Backbone nichts führt. Dann `species/search` befragen und den obersten Treffer nehmen —
 *      aber nur, wenn er Rang SPECIES und Status ACCEPTED hat UND dieselbe Gattung trägt.
 *   7. **ohne** — nichts gefunden. Wird NICHT verschwiegen, sondern gezählt und mitsamt dem Rang,
 *      an dem es scheiterte, in eine eigene Datei geschrieben.
 *
 * Stufe 4 und 5 kamen am 23.08.2026 dazu. Vorher gab der Auflöser auf, sobald der zurückgegebene
 * Schlüssel nicht in unserer Artenliste stand — und das ist der Normalfall, wenn GBIF auf einer
 * anderen Rangstufe antwortet. Gemessen an 120 ungeklärten Arten: **57 % werden so gerettet.**
 *
 * ## Warum das Ergebnis auf Platte liegt
 *
 * `data/work/gbif_key_map.ndjson` ist ein Zwischenspeicher, kein Nebenprodukt. Ein zweiter Lauf
 * fragt nur nach dem, was neu dazugekommen ist — wie die `.done`-Datei der Bilderernte. Dadurch
 * kostet ein Neubau des Katalogs keine einzige Anfrage mehr, solange die Artenliste dieselbe ist.
 */

/** Was am Ende in der Karte steht. `via` sagt, wie der Schlüssel gefunden wurde. */
const VIA = {
  direkt: 'direkt',
  name: 'name',
  match: 'match',
  artname: 'artname',
  gattung: 'gattung',
  sammelart: 'sammelart',
  ohne: 'ohne',
};

const readMap = filePath => {
  const map = new Map();
  // Ohne Pfad gibt es nichts zu lesen. `fs.existsSync(undefined)` warnt seit Node 22 und wirft
  // spaeter — der Aufloeser laesst sich aber bewusst auch ohne Zwischenspeicher betreiben (Tests).
  if (!filePath || !fs.existsSync(filePath)) return map;
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      map.set(String(rec.quelle), rec);
    } catch {
      // Eine kaputte Zeile darf den ganzen Zwischenspeicher nicht wertlos machen.
    }
  }
  return map;
};

/**
 * GBIF nach dem heutigen Schlüssel eines Namens fragen.
 *
 * `null` bei allem, was nicht eindeutig ist. Ein unsicherer Treffer wäre schlimmer als keiner: Er
 * hängt die Bilder einer Art an eine andere, und das fällt niemandem auf.
 *
 * ## Warum hier mehr zurückkommt als der Schlüssel
 *
 * GBIF antwortet nicht immer auf der Ebene, nach der gefragt wurde. Am 23.08.2026 gemessen:
 *
 *     Waldsteinia ternata     → Geum ternatum subsp. ternatum   (Rang UNTERART)
 *     Epilobium angustifolium → Chamaenerion                    (Rang GATTUNG)
 *
 * Unsere Artenliste führt nur Taxa im Rang ART. Der zurückgegebene Schlüssel steht also nicht
 * darin, und früher gab der Auflöser an dieser Stelle auf — still, ohne Fehlermeldung. So sind
 * Pflanzen wie das Schmalblättrige Weidenröschen (25.588 Bilder) aus dem Katalog gefallen.
 *
 * GBIF liefert aber in derselben Antwort `species` und `genus` im Klartext. Damit lässt sich der
 * Treffer über den NAMEN retten, wo er über den Schlüssel scheitert — siehe `resolveKeys`.
 */
const matchName = async (name, opts) => {
  const res = await apiGet('/species/match', { kingdom: 'Plantae', name }, opts);
  if (!res || res.matchType === 'NONE') return null;
  // FUZZY nur ansehen, wenn GBIF selbst sehr sicher ist — sonst ist es geraten.
  if (res.matchType === 'FUZZY' && (res.confidence ?? 0) < 95) return null;
  const key = res.status === 'SYNONYM' ? res.acceptedUsageKey : res.usageKey;
  return {
    key: key ?? null,
    status: res.status,
    matchType: res.matchType,
    rank: res.rank,
    species: res.species ?? null,
    genus: res.genus ?? null,
  };
};

/**
 * Trägt der Name eine Rangmarke oberhalb der Art?
 *
 * `Taraxacum sect. Taraxacum` · `Rubus fruticosus agg.` · `Achillea ser. Millefolium`.
 *
 * ⚠️ Bewusst NICHT `subsp.`, `var.` und `f.` — die stehen UNTERHALB der Art. Sie über
 * `species/search` auf eine Art zu ziehen wäre kein Auflösen, sondern ein Einebnen.
 */
/** GBIFs Backbone-Taxonomie. Alles andere sind Checklisten mit eigenen Schlüsselräumen. */
const BACKBONE_DATASET = 'd7dddbf4-2cf0-4f39-9b2a-bb099caae36c';

const RANGMARKE = /\b(sect|agg|ser|subg|subsect)\.?(\s|$)/i;
const hatRangmarke = name => RANGMARKE.test(String(name || ''));

/** Die Gattung — das erste Wort, ohne ein vorangestelltes Hybridzeichen. */
const gattungVon = name =>
  String(name || '').trim().replace(/^[×x]\s*/, '').split(/\s+/)[0] || null;

/**
 * Der Sammelart-Rückfall.
 *
 * ## Warum `species/search` und nicht noch einmal `species/match`
 *
 * `match` ist auf einen exakten Namen ausgelegt und gibt bei `Taraxacum sect. Taraxacum` die
 * Gattung zurück — richtig, aber unbrauchbar: Eine Gattung hat keine Bilder bei uns. `search` ist
 * unscharf und findet die Art, die der Sammelname meint.
 *
 * ## Warum das trotzdem nicht Raten ist
 *
 * 🔴 Drei Bedingungen, und alle drei müssen halten:
 *
 *   1. der Treffer hat Rang **SPECIES** — keine Gattung, keine Unterart,
 *   2. sein Status ist **ACCEPTED** — kein Synonym, dem wir dann noch folgen müssten,
 *   3. seine **Gattung stimmt** mit der Gattung der Anfrage überein.
 *
 * Bedingung 3 ist die tragende. `search` liefert auf einen unklaren Namen gern etwas aus einer
 * ganz anderen Gattung; ohne diese Prüfung hingen die 16.932 Löwenzahnbilder irgendwann an einer
 * fremden Pflanze. Und weil der Weg als `via: 'sammelart'` in der Karte steht, lässt sich später
 * genau danach filtern, wer so zugeordnet wurde.
 */
const searchSammelart = async (name, opts) => {
  const gattung = gattungVon(name);
  if (!gattung) return null;
  const res = await apiGet(
    '/species/search',
    {
      q: name,
      rank: 'SPECIES',
      status: 'ACCEPTED',
      // 🔴 Ans Backbone gebunden, und das ist keine Feinheit. Ohne `datasetKey` antwortet GBIF
      // auch aus fremden Checklisten, und deren `key` ist ein LOKALER Schlüssel des jeweiligen
      // Datensatzes — beim Löwenzahn 266900909, während der Backbone ihn unter 5394163 führt.
      // Wer den ungeprüft übernimmt, schreibt einen Schlüssel in die Karte, den unser Katalog
      // nie kennt: die Art fiele still heraus, obwohl sie gefunden wurde.
      datasetKey: BACKBONE_DATASET,
      limit: 5,
    },
    opts,
  );
  for (const t of res?.results || []) {
    if (t.rank !== 'SPECIES') continue;
    if (t.taxonomicStatus !== 'ACCEPTED') continue;
    if (String(t.genus || '') !== gattung) continue;
    // `nubKey` zuerst — er ist der Backbone-Schlüssel. `key` nur als Rückfall.
    return { key: t.nubKey ?? t.key ?? null, species: t.species ?? t.canonicalName ?? null };
  }
  return null;
};

/**
 * Das Artepitheton einer Anfrage — nur bei einem echten Zweiwortnamen.
 *
 * `null` bei Hybriden (`Crataegus × lavalleei`) und bei Namen mit Rangzusatz (`… subsp. …`): Dort
 * ist das letzte Wort nicht das Artepitheton, und die Gattung davorzusetzen ergäbe einen Namen,
 * den es nicht gibt. Ein erfundener Name, der zufällig in der Artenliste steht, hängt die Bilder
 * einer Art an eine andere — genau der Schaden, den dieser Auflöser verhindern soll.
 */
const artepitheton = name => {
  const teile = String(name || '').trim().split(/\s+/);
  if (teile.length !== 2) return null;
  if (teile.some(t => t === '×' || t === 'x')) return null;
  return /^[a-z-]+$/.test(teile[1]) ? teile[1] : null;
};

/**
 * Die Karte aufbauen oder ergänzen.
 *
 * @param kandidaten  `[{ quelle, name }]` — Pl@ntNets Schlüssel und der zugehörige wissenschaftliche Name
 * @param akzeptiert  Set der taxonKeys, die unsere Artenliste führt
 * @param nachName    Map canonicalName → taxonKey aus derselben Liste
 * @returns `{ karte, statistik }`
 */
const resolveKeys = async (kandidaten, akzeptiert, nachName, options = {}) => {
  const {
    mapFile,
    unresolvedFile,
    concurrency = 4,
    log = () => {},
    onProgress = () => {},
  } = options;

  const karte = readMap(mapFile);
  const statistik = { gesamt: kandidaten.length, direkt: 0, name: 0, match: 0, artname: 0, gattung: 0, sammelart: 0, ohne: 0, ausSpeicher: 0 };

  const offen = [];
  for (const k of kandidaten) {
    const quelle = String(k.quelle);

    if (karte.has(quelle)) {
      statistik.ausSpeicher++;
      statistik[karte.get(quelle).via] = (statistik[karte.get(quelle).via] ?? 0) + 1;
      continue;
    }
    if (k.quelle && akzeptiert.has(quelle)) {
      karte.set(quelle, { quelle, ziel: Number(k.quelle), via: VIA.direkt });
      statistik.direkt++;
      continue;
    }
    const perName = nachName.get(k.name);
    if (perName) {
      karte.set(quelle, { quelle, ziel: perName, via: VIA.name });
      statistik.name++;
      continue;
    }
    offen.push(k);
  }

  if (offen.length > 0) {
    log(`GBIF befragen fuer ${offen.length} ungeklaerte Schluessel …`);
    let erledigt = 0;
    await pool(offen, concurrency, async k => {
      const quelle = String(k.quelle);
      let treffer = null;
      try {
        treffer = await matchName(k.name, options);
      } catch {
        // Ein Netzfehler ist kein Ergebnis. Nicht in die Karte schreiben, damit der naechste Lauf
        // es erneut versucht — ein falsches „ohne“ waere dauerhaft.
        erledigt++;
        return;
      }
      /**
       * Drei Wege, in dieser Reihenfolge — jeder darf NUR treffen, was unsere Artenliste führt.
       *
       *   1. der Schlüssel selbst        wie bisher
       *   2. der Artname aus derselben Antwort   rettet die Unterart-Fälle
       *   3. Gattung + Artepitheton              rettet die Gattungs-Fälle
       *
       * An 120 ungeklärten Arten gemessen (23.08.2026): 57 % werden so gerettet — 57 über den
       * Artnamen, 10 über Gattung + Epitheton. Der Rest bleibt ungeklärt, weil GBIF nur bis zur
       * Familie oder gar nicht auflöst; dort wäre jeder weitere Versuch geraten.
       */
      let ziel = null;
      let via = null;
      if (treffer && treffer.key && akzeptiert.has(String(treffer.key))) {
        ziel = treffer.key;
        via = VIA.match;
      } else if (treffer && treffer.species && nachName.has(treffer.species)) {
        ziel = nachName.get(treffer.species);
        via = VIA.artname;
      } else if (treffer && treffer.genus) {
        const epi = artepitheton(k.name);
        const kandidat = epi ? `${treffer.genus} ${epi}` : null;
        if (kandidat && nachName.has(kandidat)) {
          ziel = nachName.get(kandidat);
          via = VIA.gattung;
        }
      }

      // Vierter Rückfall: nur für Namen mit Rangmarke, und nur wenn oben nichts griff.
      if (!ziel && hatRangmarke(k.name)) {
        try {
          const s = await searchSammelart(k.name, options);
          if (s && s.key && akzeptiert.has(String(s.key))) {
            ziel = s.key;
            via = VIA.sammelart;
          } else if (s && s.species && nachName.has(s.species)) {
            ziel = nachName.get(s.species);
            via = VIA.sammelart;
          }
        } catch {
          // Wie oben: ein Netzfehler ist kein Ergebnis.
        }
      }

      if (ziel) {
        karte.set(quelle, { quelle, ziel, via, status: treffer ? treffer.status : null });
        statistik[via]++;
      } else {
        karte.set(quelle, {
          quelle,
          ziel: null,
          via: VIA.ohne,
          name: k.name,
          // Woran es lag — sonst steht in der Datei nur „ohne“, und beim nächsten Mal fängt die
          // Ursachensuche wieder bei null an.
          rang: treffer ? treffer.rank : null,
        });
        statistik.ohne++;
      }
      erledigt++;
      if (erledigt % 50 === 0) onProgress(erledigt, offen.length);
    });
  }

  if (mapFile) {
    fs.mkdirSync(path.dirname(mapFile), { recursive: true });
    const zeilen = [...karte.values()].map(r => JSON.stringify(r));
    fs.writeFileSync(mapFile, zeilen.join('\n') + (zeilen.length ? '\n' : ''));
  }

  // Die Ungeklärten kommen in eine eigene Datei. Eine Zahl im Log ist vergessen, sobald das
  // Fenster zu ist; eine Datei kann man sich beim nächsten Mal ansehen.
  if (unresolvedFile) {
    const ohne = [...karte.values()].filter(r => r.via === VIA.ohne);
    fs.mkdirSync(path.dirname(unresolvedFile), { recursive: true });
    fs.writeFileSync(unresolvedFile, ohne.map(r => JSON.stringify(r)).join('\n') + (ohne.length ? '\n' : ''));
  }

  return { karte, statistik };
};

/** Nur die brauchbaren Übersetzungen: Pl@ntNet-Schlüssel → GBIF-Schlüssel. */
const toLookup = karte => {
  const lookup = new Map();
  for (const rec of karte.values()) {
    if (rec.ziel) lookup.set(String(rec.quelle), Number(rec.ziel));
  }
  return lookup;
};

/** Die Karte von der Platte lesen, ohne etwas aufzulösen — für Schritte, die nur übersetzen. */
const loadLookup = mapFile => toLookup(readMap(mapFile));

module.exports = {
  resolveKeys, toLookup, loadLookup, matchName, artepitheton,
  hatRangmarke, gattungVon, searchSammelart, VIA,
};
