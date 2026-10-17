/**
 * tools/strip-boss-data.js
 *
 * Removes boss-only rows from the game data files the site loads. Bosses
 * (Kraken, Shai-Khold, ...) have 300 levels of ability data each, which made
 * up over 80% of what the Troops & Heroes page had to download and unpack on
 * every visit, yet the site never shows bosses. Troop and hero rows are left
 * exactly as they are.
 *
 * Run it from the repo folder after copying in new game files:
 *     node tools/strip-boss-data.js
 * It's safe to run more than once; files with nothing to remove are left alone.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const TARGETS = fs.readdirSync(ROOT).filter(f => /^ability.*\.json$/.test(f) || f === "troopsLevel.json");

// A row is boss-only when its own key, or the id it belongs to, starts with "boss".
function isBossRow(key, row) {
  if (/^boss/i.test(key)) return true;
  if (!row || typeof row !== "object") return false;
  return ["troopId", "troopLevelId", "abilityInfoId", "abilityDamageLevelUpId"]
    .some(field => typeof row[field] === "string" && /^boss/i.test(row[field]));
}

let totalBefore = 0;
let totalAfter = 0;
for (const file of TARGETS) {
  const full = path.join(ROOT, file);
  const raw = fs.readFileSync(full, "utf8");
  const data = JSON.parse(raw);
  const kept = {};
  let removed = 0;
  for (const [key, row] of Object.entries(data)) {
    if (isBossRow(key, row)) removed++;
    else kept[key] = row;
  }
  totalBefore += raw.length;
  if (!removed) { totalAfter += raw.length; continue; }
  // Keep the file's own layout (indented or one line) so diffs stay readable.
  const indentMatch = raw.match(/^\{\r?\n([ \t]+)"/);
  const out = JSON.stringify(kept, null, indentMatch ? indentMatch[1] : undefined) + (raw.endsWith("\n") ? "\n" : "");
  fs.writeFileSync(full, raw.includes("\r\n") ? out.replace(/\n/g, "\r\n") : out);
  totalAfter += out.length;
  console.log(`${file}: removed ${removed} boss rows (${Math.round(raw.length / 1024)} KB -> ${Math.round(out.length / 1024)} KB)`);
}
console.log(`Done: ${(totalBefore / 1048576).toFixed(1)} MB -> ${(totalAfter / 1048576).toFixed(1)} MB`);
