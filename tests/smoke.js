/* Opens every page of the site in a headless Chrome (phone size, signed out),
   the way a visitor would, and fails if a page:
   - throws a JavaScript error of ours while loading, or
   - asks this site for a file that isn't there.
   It also measures how much of the site's own JavaScript ran while the pages
   loaded (code coverage), and prints it per file.
   Run:  node tests/smoke.js        (needs: npm i --no-save playwright && npx playwright install chromium)
   Set CHROME_PATH to use a Chrome you already have. */
const fs = require("fs");
const path = require("path");
const http = require("http");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("playwright-core"); }

const ROOT = path.join(__dirname, "..");
const SETTLE_MS = Number(process.env.SMOKE_SETTLE_MS || 2500);
// How long a page gets to finish loading everything, other sites' files
// included. Past it, only OUR files still loading fail the page: another
// site that hangs (an ad network, Google sign-in) is reported, not failed —
// it isn't ours to fix, and one slow outside server used to stall every page.
const LOAD_MS = Number(process.env.SMOKE_LOAD_MS || 20000);
const PAGES = [
    ...fs.readdirSync(ROOT).filter(f => f.endsWith(".html") && !/^google[0-9a-f]+\.html$/.test(f)).sort(),
    "units/index.html",
    "units/" + fs.readdirSync(path.join(ROOT, "units")).find(f => f.endsWith(".html") && f !== "index.html") // one unit page
];
// third-party noise that isn't ours to fix (ads, Google sign-in, Firebase's own retries)
const IGNORE_ERROR = /^Script error\.?$|adsbygoogle|googlesyndication|doubleclick|gstatic\.com|googleapis\.com|ResizeObserver loop/i;

// ---------- a tiny static server for the repo (like GitHub Pages: /page also serves page.html) ----------
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml",
    ".ico": "image/x-icon", ".txt": "text/plain", ".xml": "application/xml", ".mp4": "video/mp4", ".woff2": "font/woff2" };
function serve() {
    const server = http.createServer((req, res) => {
        let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
        let file = path.join(ROOT, p);
        if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
        if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
        else if (!fs.existsSync(file) && fs.existsSync(file + ".html")) file += ".html";
        if (!fs.existsSync(file)) { res.writeHead(404); res.end("not found"); return; }
        res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream" });
        fs.createReadStream(file).pipe(res);
    });
    return new Promise(r => server.listen(0, "127.0.0.1", () => r(server)));
}

// ---------- coverage: which bytes of each script ran (V8 block coverage) ----------
const cover = new Map(); // key -> { name, length, ran: Uint8Array }
function addCoverage(entry, base) {
    if (!entry.url.startsWith(base) || !entry.source) return;
    const rel = new URL(entry.url).pathname.replace(/^\//, "") || "index.html";
    const inline = /\.html?$/.test(rel) || !path.extname(rel);
    const key = inline ? rel + " ⟨inline⟩ " + entry.source.length + ":" + entry.source.slice(0, 80) : rel;
    let c = cover.get(key);
    if (!c) { c = { name: inline ? rel + " (scripts in the page)" : rel, length: entry.source.length, ran: new Uint8Array(entry.source.length) }; cover.set(key, c); }
    const counts = new Int32Array(entry.source.length).fill(0);
    for (const fn of entry.functions) for (const r of fn.ranges) counts.fill(r.count > 0 ? 1 : 0, r.startOffset, Math.min(r.endOffset, counts.length));
    for (let i = 0; i < counts.length; i++) if (counts[i]) c.ran[i] = 1;
}

(async () => {
    // SMOKE_BASE_URL=https://keazyea.github.io/ checks the live site instead of this folder
    const live = (process.env.SMOKE_BASE_URL || "").trim();
    const server = live ? null : await serve();
    const base = live ? live.replace(/\/?$/, "/") : `http://127.0.0.1:${server.address().port}/`;
    const browser = await pw.chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
    const problems = [], slowOthers = new Set();
    for (const pg of PAGES) {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
        await ctx.addInitScript(() => { try { localStorage.setItem("kih_terms_accepted_version", "9999"); } catch (e) { } });
        const page = await ctx.newPage();
        const errs = [], missing = [];
        page.on("pageerror", e => {
            const where = (e.stack || "") + " " + e.message;
            if (IGNORE_ERROR.test(e.message) || (!where.includes(base) && IGNORE_ERROR.test(where))) return;
            errs.push(e.message.split("\n")[0] + ((e.stack || "").match(new RegExp(base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[^\\s)]+"))?.[0]?.replace(base, " @ ") || ""));
        });
        page.on("response", r => { if (r.url().startsWith(base) && r.status() >= 400) missing.push(`${r.status()} ${r.url().replace(base, "/")}`); });
        const pending = new Map(); // requests still on their way
        page.on("request", r => pending.set(r, r.url()));
        page.on("requestfinished", r => pending.delete(r));
        page.on("requestfailed", r => pending.delete(r));
        const slowHere = new Set();
        await page.coverage.startJSCoverage({ resetOnNavigation: false });
        const t0 = Date.now();
        try {
            // the page itself has to arrive; then everything it loads gets LOAD_MS
            await page.goto(base + pg, { waitUntil: "commit", timeout: 45000 });
            const loaded = await page.waitForLoadState("load", { timeout: LOAD_MS }).then(() => true, () => false);
            if (!loaded) {
                const waiting = [...pending.values()];
                const ours = waiting.filter(u => u.startsWith(base)).map(u => u.replace(base, "/"));
                if (ours.length) errs.push(`didn't finish loading — still waiting for ${ours.slice(0, 3).join(", ")}`);
                waiting.filter(u => !u.startsWith(base)).forEach(u => { try { slowHere.add(new URL(u).host); slowOthers.add(new URL(u).host); } catch (e) { } });
            }
            await page.waitForTimeout(SETTLE_MS);
        } catch (e) { errs.push("didn't finish loading: " + e.message.split("\n")[0]); }
        for (const entry of await page.coverage.stopJSCoverage()) addCoverage(entry, base);
        const ok = !errs.length && !missing.length;
        console.log(`${ok ? "✓" : "✗"} ${pg}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
        if (slowHere.size) console.log(`    (other sites still loading after ${LOAD_MS / 1000}s: ${[...slowHere].join(", ")} — not ours, not a failure)`);
        errs.forEach(e => { console.log("    error: " + e); problems.push(`${pg}: ${e}`); });
        missing.forEach(m => { console.log("    missing: " + m); problems.push(`${pg}: missing ${m}`); });
        await ctx.close();
    }
    await browser.close();
    if (server) server.close();

    // ---------- coverage report ----------
    const byName = new Map();
    for (const c of cover.values()) {
        const t = byName.get(c.name) || { total: 0, ran: 0 };
        t.total += c.length; t.ran += c.ran.reduce((a, b) => a + b, 0);
        byName.set(c.name, t);
    }
    const rows = [...byName.entries()].sort((a, b) => b[1].total - a[1].total);
    const total = rows.reduce((a, [, t]) => a + t.total, 0), ran = rows.reduce((a, [, t]) => a + t.ran, 0);
    const pct = (r, t) => t ? (100 * r / t).toFixed(1) : "0.0";
    console.log(`\nBrowser code coverage while loading the pages: ${pct(ran, total)}% of the site's own JavaScript ran (${(ran / 1024).toFixed(0)} of ${(total / 1024).toFixed(0)} KB)`);
    rows.slice(0, 25).forEach(([n, t]) => console.log(`  ${pct(t.ran, t.total).padStart(5)}%  ${n}`));
    fs.mkdirSync(path.join(ROOT, "coverage"), { recursive: true });
    fs.writeFileSync(path.join(ROOT, "coverage", "browser-coverage.json"), JSON.stringify({ percent: +pct(ran, total), ranBytes: ran, totalBytes: total,
        files: rows.map(([name, t]) => ({ name, percent: +pct(t.ran, t.total), totalBytes: t.total })) }, null, 2));
    if (process.env.GITHUB_STEP_SUMMARY) {
        fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### 🌐 Browser code coverage: ${pct(ran, total)}%\n` +
            `How much of the site's own JavaScript ran while every page loaded (signed out).\n\n| Covered | File |\n|---:|---|\n` +
            rows.slice(0, 30).map(([n, t]) => `| ${pct(t.ran, t.total)}% | ${n} |`).join("\n") + "\n\n");
    }

    if (slowOthers.size) {
        console.log(`\n⚠ Other sites that were slow to answer (not a failure): ${[...slowOthers].join(", ")}`);
        if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `⚠ Other sites slow to answer during the page check (not a failure): ${[...slowOthers].join(", ")}\n\n`);
    }
    if (problems.length) {
        console.error(`\n${problems.length} problem${problems.length > 1 ? "s" : ""} on ${PAGES.length} pages.`);
        process.exit(1);
    }
    console.log(`\n✓ All ${PAGES.length} pages loaded without errors.`);
})().catch(e => { console.error(e); process.exit(1); });
