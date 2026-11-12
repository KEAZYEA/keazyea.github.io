/**
 * tools/build-boss-data.js
 *
 * Saves the bosses' numbers (every ability, levels 1–300) into one small
 * file, data/bosses.json, for the 🐉 Bosses tab of Troops & Heroes.
 *
 * The game's own files hold 300 levels of rows for every boss ability,
 * which made Troops & Heroes slow, so tools/strip-boss-data.js takes the
 * boss rows out of them. This keeps what the site needs from those rows
 * first: per ability, the numbers that stay the same as one value and the
 * ones that change with the level as a list (index 0 = level 1).
 *
 *   node tools/build-boss-data.js              the boss rows in the files now
 *   node tools/build-boss-data.js --git <ref>  the files as they were in a commit
 *                                              (e.g. 06c16e8^, before boss rows were stripped)
 *
 * tools/strip-boss-data.js runs this first, so a game update keeps it current.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "data", "bosses.json");
const BOSS = /^boss/i;
const LINK_FIELDS = ["troopId", "abilityInfoId", "multiAoeDamageAbilityId", "abilityDamageLevelUpId"];

function isBossRow(key, row) {
    if (BOSS.test(key)) return true;
    return !!row && typeof row === "object" && LINK_FIELDS.some(f => typeof row[f] === "string" && BOSS.test(row[f]));
}
// "bossDragonNew_defaultAoe_37" → ["bossDragonNew_defaultAoe", 37]
function splitLevel(key) {
    const m = /^(.*)_(\d+)$/.exec(key);
    return m ? [m[1], Number(m[2])] : [key, 0];
}
// Rows that come in levels → { fixed: {field: value}, perLevel: {field: [L1, L2, ...]} }
function squash(rowsByLevel) {
    const levels = Object.keys(rowsByLevel).map(Number).sort((a, b) => a - b);
    const out = { levels: levels.length ? levels[levels.length - 1] : 0, fixed: {}, perLevel: {} };
    const fields = new Set();
    levels.forEach(l => Object.entries(rowsByLevel[l]).forEach(([k, v]) => { if (typeof v === "number") fields.add(k); }));
    for (const f of fields) {
        if (f === "level") continue;
        const vals = levels.map(l => rowsByLevel[l][f]);
        if (vals.every(v => v === vals[0])) out.fixed[f] = vals[0];
        else {
            const arr = new Array(out.levels).fill(null);
            levels.forEach((l, i) => { arr[l - 1] = vals[i]; });
            out.perLevel[f] = arr;
        }
    }
    return out;
}

function build(readFile, files, note) {
    const rows = {}; // file → [[key, row]] boss rows
    for (const f of files) {
        let data;
        try { data = JSON.parse(readFile(f)); } catch (e) { continue; }
        const list = Object.entries(data).filter(([k, r]) => isBossRow(k, r));
        if (list.length) rows[f] = list;
    }
    const abilities = {}, units = {}, levelUp = {};
    // per-hit damage of "multi" abilities: abilityMultiAoeDamageHit rows, by the ability row they belong to
    const hitsOf = {};
    (rows["abilityMultiAoeDamageHit.json"] || []).forEach(([, r]) => { (hitsOf[r.multiAoeDamageAbilityId] = hitsOf[r.multiAoeDamageAbilityId] || []).push(r); });

    // Names, icons and links only — no numbers (and the same ids as the rows that have them).
    const NO_NUMBERS = new Set(["abilityMultiAoeDamageHit.json", "abilityInfo.json", "abilityDamageLevelup.json"]);
    for (const [file, list] of Object.entries(rows)) {
        if (NO_NUMBERS.has(file)) continue;
        if (file === "troopsLevel.json") {
            const by = {};
            list.forEach(([, r]) => { (by[r.troopId] = by[r.troopId] || {})[r.level] = r; });
            for (const [id, lv] of Object.entries(by)) units[id] = squash(lv);
            continue;
        }
        if (file === "abilityDamageLevelupNested.json") {
            const by = {};
            list.forEach(([, r]) => { (by[r.abilityDamageLevelUpId] = by[r.abilityDamageLevelUpId] || {})[r.level] = { damage: r.damage }; });
            for (const [id, lv] of Object.entries(by)) levelUp[id] = squash(lv).perLevel.damage || [];
            continue;
        }
        // Group by ability, then by key family (a few abilities have an old and a new set of rows):
        // the family with the most levels wins, a "New" one on a tie.
        const byAbility = {};
        list.forEach(([key, r]) => {
            const id = r.abilityInfoId || splitLevel(key)[0];
            const [family, level] = splitLevel(key);
            ((byAbility[id] = byAbility[id] || {})[family] = byAbility[id][family] || {})[level] = r;
        });
        for (const [id, families] of Object.entries(byAbility)) {
            const [, chosen] = Object.entries(families).sort(([fa, a], [fb, b]) =>
                Object.keys(b).length - Object.keys(a).length || (/New/.test(fb) ? 1 : 0) - (/New/.test(fa) ? 1 : 0))[0];
            const entry = { file: file.replace(/\.json$/, ""), ...squash(chosen) };
            // a "multi" ability: how many hits, and each hit's damage and radius, by level
            const hitRows = {};
            Object.entries(chosen).forEach(([lv, r]) => { if (hitsOf[r.key]) hitRows[lv] = hitsOf[r.key]; });
            if (Object.keys(hitRows).length) {
                const perLevel = {};
                Object.entries(hitRows).forEach(([lv, hs]) => { perLevel[lv] = { hits: hs.length, hitAttack: hs[0].attack, hitRadius: hs[0].aoeRadius }; });
                const h = squash(perLevel);
                Object.assign(entry.fixed, h.fixed);
                Object.assign(entry.perLevel, h.perLevel);
            }
            // never let a file with fewer levels replace one with more for the same ability
            if (!abilities[id] || entry.levels > abilities[id].levels) abilities[id] = entry;
        }
    }
    return { note, maxLevel: 300, abilities, units, levelUp };
}

function run(argv) {
    const gi = argv.indexOf("--git");
    const ref = gi >= 0 ? argv[gi + 1] : null;
    let files, readFile;
    if (ref) {
        files = execFileSync("git", ["ls-tree", "--name-only", ref], { cwd: ROOT, encoding: "utf8" }).split("\n")
            .filter(f => /^ability.*\.json$/.test(f) || f === "troopsLevel.json");
        readFile = (f) => execFileSync("git", ["show", `${ref}:${f}`], { cwd: ROOT, maxBuffer: 1 << 29 }).toString("utf8");
    } else {
        files = fs.readdirSync(ROOT).filter(f => /^ability.*\.json$/.test(f) || f === "troopsLevel.json");
        readFile = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
    }
    const data = build(readFile, files, `Boss numbers from the game data${ref ? ` (git ${ref})` : ""}, made by tools/build-boss-data.js`);
    const n = Object.keys(data.abilities).length;
    if (!n) {
        console.log("No boss rows found — data/bosses.json left as it is (already stripped? use --git <ref>).");
        return false;
    }
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(data) + "\n");
    console.log(`data/bosses.json: ${n} abilities, ${Object.keys(data.units).length} units, ${Object.keys(data.levelUp).length} level-up tables (${Math.round(fs.statSync(OUT).size / 1024)} KB)`);
    return true;
}

if (require.main === module) run(process.argv.slice(2));
module.exports = { build, run, isBossRow, squash, splitLevel };
