import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

const html = readFileSync(join(ROOT, "tools/full-galabaul-plantlist.md"), "utf-8");

// Extract all title="..." attributes
const titleRegex = /title="([^"]+)"/g;
const entries = [];
const seen = new Set();

let match;
while ((match = titleRegex.exec(html)) !== null) {
  const raw = match[1];
  // Split at last " (" to separate name from category
  const lastParen = raw.lastIndexOf(" (");
  if (lastParen === -1) continue;

  const botanisch = raw.slice(0, lastParen).trim();
  const kategorie = raw.slice(lastParen + 2, -1).trim(); // remove trailing ")"

  // Skip cultivars, subspecies, varieties, sections
  if (botanisch.includes("'")) continue;
  if (/\b(subsp\.|var\.|sect\.)/.test(botanisch)) continue;

  if (seen.has(botanisch)) continue;
  seen.add(botanisch);

  entries.push(botanisch);
}

// Sort by botanical name
entries.sort((a, b) => a.localeCompare(b, "de"));

writeFileSync(
  join(ROOT, "data", "reference", "galabau_plantlist.json"),
  JSON.stringify(entries, null, 2),
  "utf-8"
);

console.log(`Wrote ${entries.length} entries to data/reference/galabau_plantlist.json`);
