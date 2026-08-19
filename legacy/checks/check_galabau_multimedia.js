import { readFileSync } from "fs";
import { writeFileSync } from "fs";
import { createReadStream } from "fs";
import { createInterface } from "readline";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

const ORGANS = ["flower", "leaf", "fruit", "bark", "habit", "other", "branch"];

function normalize(name) {
  return name.replace(/\s[x×]\s/gi, " ").replace(/\s+/g, " ").trim();
}

async function main() {
  // 1. Load galabau botanisch names
  const galabau = JSON.parse(
    readFileSync(join(ROOT, "data/reference/galabau_pflanzen.json"), "utf-8")
  );
  const botanischNames = [
    ...new Set(galabau.pflanzen.flatMap((k) => k.eintraege.map((e) => e.botanisch))),
  ];
  console.log(`${botanischNames.length} eindeutige Galabau-Namen geladen`);

  // 2. Load species.ndjson → Map: normalized canonicalName → { taxonKey, scientificName }
  const speciesMap = new Map();
  const rl1 = createInterface({
    input: createReadStream(join(ROOT, "data/output/species.ndjson")),
    crlfDelay: Infinity,
  });
  for await (const line of rl1) {
    if (!line.trim()) continue;
    const obj = JSON.parse(line);
    if (obj.canonicalName) {
      speciesMap.set(normalize(obj.canonicalName), {
        taxonKey: obj.taxonKey,
        scientificName: obj.scientificName,
      });
    }
  }

  // 3. Match galabau names → taxonKeys
  const taxonKeyToName = new Map(); // taxonKey → botanisch name
  const matched = [];
  for (const name of botanischNames) {
    const entry = speciesMap.get(normalize(name));
    if (entry) {
      taxonKeyToName.set(entry.taxonKey, name);
      matched.push(name);
    }
  }
  console.log(`${matched.length} von ${botanischNames.length} in species.ndjson gefunden`);

  // 4. Stream multimedia.ndjson → count per taxonKey per organ
  const counts = new Map(); // taxonKey → { flower: n, leaf: n, ... }
  for (const tk of taxonKeyToName.keys()) {
    const c = {};
    for (const o of ORGANS) c[o] = 0;
    c["null"] = 0;
    counts.set(tk, c);
  }

  const rl2 = createInterface({
    input: createReadStream(join(ROOT, "data/output/multimedia.ndjson")),
    crlfDelay: Infinity,
  });

  let processed = 0;
  for await (const line of rl2) {
    if (!line.trim()) continue;
    processed++;
    if (processed % 500000 === 0) {
      process.stdout.write(`\r  ${(processed / 1000000).toFixed(1)}M Zeilen verarbeitet`);
    }

    const obj = JSON.parse(line);
    const c = counts.get(obj.taxonKey);
    if (!c) continue;

    const organ = obj.organ || "null";
    if (c[organ] !== undefined) {
      c[organ]++;
    } else {
      c["null"]++;
    }
  }
  process.stdout.write(`\r  ${(processed / 1000000).toFixed(1)}M Zeilen verarbeitet\n`);

  // 5. Build results sorted by botanisch name
  const results = [];
  for (const [tk, name] of taxonKeyToName) {
    const c = counts.get(tk);
    const total = Object.values(c).reduce((a, b) => a + b, 0);
    results.push({ botanisch: name, taxonKey: tk, ...c, total });
  }
  results.sort((a, b) => a.botanisch.localeCompare(b.botanisch));

  // 6. Console table
  const cols = [...ORGANS, "null"];
  const hdr =
    "Botanisch".padEnd(42) +
    cols.map((c) => c.padStart(8)).join("") +
    "   Total".padStart(8);
  console.log("\n" + "-".repeat(hdr.length));
  console.log(hdr);
  console.log("-".repeat(hdr.length));

  for (const r of results) {
    const row =
      r.botanisch.padEnd(42) +
      cols.map((c) => String(r[c]).padStart(8)).join("") +
      String(r.total).padStart(8);
    console.log(row);
  }
  console.log("-".repeat(hdr.length));

  // Totals
  const totals = {};
  for (const c of cols) totals[c] = 0;
  totals.total = 0;
  for (const r of results) {
    for (const c of cols) totals[c] += r[c];
    totals.total += r.total;
  }
  const totalRow =
    "SUMME".padEnd(42) +
    cols.map((c) => String(totals[c]).padStart(8)).join("") +
    String(totals.total).padStart(8);
  console.log(totalRow);

  // 7. Save JSON
  const outPath = join(ROOT, "data/output/checks/galabau_multimedia_coverage.json");
  writeFileSync(outPath, JSON.stringify(results, null, 2), "utf-8");
  console.log(`\nErgebnis gespeichert: ${outPath}`);
}

main();
