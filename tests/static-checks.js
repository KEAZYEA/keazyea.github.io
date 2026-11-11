/* Fast checks that need no browser and no internet (CI runs them on every push):
   1. every JavaScript file, and every <script> inside every HTML page, is valid JavaScript;
   2. every JSON file is valid JSON;
   3. data/bundle.json matches the game data files (re-run tools/build-unit-pages.js if not);
   4. files a page loads from this site (scripts, styles, frames, pictures, links to pages) exist.
   Run:  node tests/static-checks.js */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const os = require("os");
const { execFileSync, spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const problems = [];
const fail = (where, what) => problems.push(`${where}: ${what}`);

// the files in the repo (what's committed, plus new files not yet ignored)
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" })
    .split("\n").filter(f => f && fs.existsSync(path.join(ROOT, f)));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const lineAt = (text, index) => text.slice(0, index).split("\n").length;
// HTML comments blanked out (same length, newlines kept) so "<script>" written in a comment isn't taken for one
const noComments = (html) => html.replace(/<!--[\s\S]*?-->/g, c => c.replace(/[^\n]/g, " "));

// ---------- 1. JavaScript ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kih-check-"));
function checkModule(code, where) {
    const f = path.join(tmp, "m" + Math.random().toString(36).slice(2) + ".mjs");
    fs.writeFileSync(f, code);
    const r = spawnSync(process.execPath, ["--check", f], { encoding: "utf8" });
    if (r.status !== 0) {
        const msg = (r.stderr || "").split("\n").filter(l => /Error/.test(l))[0] || r.stderr.trim();
        const line = ((r.stderr || "").match(/\.mjs:(\d+)/) || [])[1];
        fail(where + (line ? ` (script line ${line})` : ""), msg);
    }
}
function checkClassic(code, where) {
    try { new vm.Script(code, { filename: where }); } // compiles only, never runs
    catch (e) { fail(where, `${e.name}: ${e.message}`); }
}
let jsCount = 0, inlineCount = 0;
for (const f of files.filter(f => f.endsWith(".js") && !f.startsWith("vendor/"))) {
    const code = read(f);
    if (/^\s*(import|export)\s/m.test(code)) checkModule(code, f);
    else {
        const r = spawnSync(process.execPath, ["--check", path.join(ROOT, f)], { encoding: "utf8" });
        if (r.status !== 0) fail(f, (r.stderr || "").split("\n").filter(l => /Error/.test(l))[0] || r.stderr.trim());
    }
    jsCount++;
}
const htmlFiles = files.filter(f => f.endsWith(".html"));
for (const f of htmlFiles) {
    const html = noComments(read(f));
    const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html))) {
        const attrs = m[1], code = m[2];
        if (/\bsrc\s*=/.test(attrs) || !code.trim()) continue;
        const type = ((attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i) || [])[1] || "").toLowerCase();
        const where = `${f}:${lineAt(html, m.index)}`;
        inlineCount++;
        if (type === "module") checkModule(code, where);
        else if (!type || type === "text/javascript" || type === "application/javascript") checkClassic(code, where);
        else if (/json/.test(type)) { try { JSON.parse(code); } catch (e) { fail(where, "bad JSON in <script>: " + e.message); } }
    }
}
fs.rmSync(tmp, { recursive: true, force: true });

// ---------- 2. JSON ----------
let jsonCount = 0;
for (const f of files.filter(f => f.endsWith(".json"))) {
    try { JSON.parse(read(f)); jsonCount++; } catch (e) { fail(f, "not valid JSON: " + e.message); }
}

// ---------- 3. the game data bundle is up to date (same rule as tools/build-unit-pages.js) ----------
if (fs.existsSync(path.join(ROOT, "data/bundle.json"))) {
    const DATA_FILE = /^(ability|hero|troop|unit)[A-Za-z0-9_]*\.json$/;
    const bundle = {};
    fs.readdirSync(ROOT).filter(f => DATA_FILE.test(f) || f === "en.json" || f === "localization.json").sort()
        .forEach(f => { try { bundle[f] = JSON.parse(read(f)); } catch (e) { /* reported above */ } });
    if (JSON.stringify(bundle) !== read("data/bundle.json")) {
        const old = JSON.parse(read("data/bundle.json"));
        const differ = Object.keys({ ...bundle, ...old }).filter(k => JSON.stringify(bundle[k]) !== JSON.stringify(old[k]));
        fail("data/bundle.json", `out of date with ${differ.slice(0, 5).join(", ")}${differ.length > 5 ? ` and ${differ.length - 5} more` : ""} — run: node tools/build-unit-pages.js`);
    }
}

// ---------- 4. files pages load from this site exist ----------
let refCount = 0;
const REF = /<(script|img|iframe|link|a|source|video)\b[^>]*?\s(src|data-src|href)\s*=\s*"([^"]+)"/gi;
for (const f of htmlFiles) {
    const html = noComments(read(f)).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, m => m.replace(/[^\n]/g, " ")); // not inside scripts (built at runtime)
    let m;
    while ((m = REF.exec(html))) {
        const [, tag, attr, raw] = m;
        if (tag.toLowerCase() === "link" && !/rel\s*=\s*"(stylesheet|icon|manifest|apple-touch-icon)"/i.test(m[0]) && !/\.css(\?|$)/.test(raw)) continue;
        if (/^([a-z][a-z0-9+.-]*:|\/\/|#|\$\{|\{)/i.test(raw) || raw.includes("${")) continue; // other sites, mailto:, anchors, templates
        const clean = decodeURIComponent(raw.split(/[?#]/)[0]);
        if (!clean) continue;
        const target = clean.startsWith("/") ? path.join(ROOT, clean) : path.join(ROOT, path.dirname(f), clean);
        const ok = fs.existsSync(target) && (fs.statSync(target).isFile() || fs.existsSync(path.join(target, "index.html")))
            || (!path.extname(target) && fs.existsSync(target + ".html")); // GitHub Pages also serves page.html as /page
        refCount++;
        if (!ok) fail(`${f}:${lineAt(html, m.index)}`, `<${tag} ${attr}="${raw}"> — no such file`);
    }
}

console.log(`Checked ${jsCount} JavaScript files, ${inlineCount} scripts inside ${htmlFiles.length} pages, ${jsonCount} JSON files, ${refCount} links to files on this site.`);
if (problems.length) {
    console.error(`\n${problems.length} problem${problems.length > 1 ? "s" : ""}:`);
    problems.forEach(p => console.error("  ✗ " + p));
    process.exit(1);
}
console.log("✓ All good.");
