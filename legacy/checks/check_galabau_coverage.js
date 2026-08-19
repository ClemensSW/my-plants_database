import { readFileSync } from "fs";
import { writeFileSync } from "fs";
import { createReadStream } from "fs";
import { createInterface } from "readline";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

// Normalisiert botanische Namen für den Vergleich:
// - Entfernt Hybrid-Zeichen (× und x zwischen Wörtern)
// - Normalisiert Whitespace
function normalize(name) {
  return name.replace(/\s[x×]\s/gi, " ").replace(/\s+/g, " ").trim();
}

async function main() {
  // 1. Load all canonicalNames from species.ndjson into a Set (normalized)
  const speciesNames = new Set();
  const rl = createInterface({
    input: createReadStream(join(ROOT, "data/output/species.ndjson")),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    const { canonicalName } = JSON.parse(line);
    if (canonicalName) speciesNames.add(normalize(canonicalName));
  }

  // 2. Extract all botanisch names from galabau_pflanzen.json
  const galabau = JSON.parse(
    readFileSync(join(ROOT, "data/reference/galabau_pflanzen.json"), "utf-8")
  );
  const botanischNames = galabau.pflanzen.flatMap((k) =>
    k.eintraege.map((e) => e.botanisch)
  );

  // 3. Check coverage (using normalized names for comparison)
  const found = [];
  const missing = [];
  for (const name of botanischNames) {
    if (speciesNames.has(normalize(name))) {
      found.push(name);
    } else {
      missing.push(name);
    }
  }

  const total = botanischNames.length;
  const pct = ((found.length / total) * 100).toFixed(1);
  console.log(`${found.length} von ${total} gefunden (${pct}%)`);
  console.log(`${missing.length} nicht gefunden`);

  // 4. Write missing names to JSON
  const outPath = join(ROOT, "data/output/checks/galabau_missing.json");
  writeFileSync(outPath, JSON.stringify(missing, null, 2), "utf-8");
  console.log(`Missing names written to: ${outPath}`);
}

main();
