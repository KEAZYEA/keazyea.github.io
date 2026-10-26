/* Lets the real Troops & Heroes page draw every unit's card, at every level,
   so the guide pages can show exactly what the app shows (same stats, icons,
   abilities and talents, in the same format).
   It opens troopsandheroes.html in a hidden Chrome, from a tiny local server
   that swaps appState.js for a stand-in (no sign-in, no database), picks each
   unit and level the way a tap would, and copies out the card.
   Returns null (with a warning) when Chrome can't be used, so the guide still
   builds, just without the app cards. */
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http");

const sleep = ms => new Promise(r => setTimeout(r, ms));
const CHROME_PATHS = [
    process.env.CHROME,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    path.join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"
].filter(Boolean);

// Stands in for appState.js: anything the page asks of it does nothing.
const STUB_APPSTATE = `const noop = () => {};
window.AppState = new Proxy({}, { get: (t, p) => p === "then" ? undefined
    : String(p).startsWith("listen") ? () => noop
    : /^(is|has)/.test(String(p)) ? () => false
    : () => Promise.resolve(null) });`;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

async function renderUnitCards(ROOT) {
    const chrome = CHROME_PATHS.find(p => fs.existsSync(p));
    if (!chrome) { console.warn("⚠️  Chrome not found (set CHROME=path/to/chrome): guide pages built without the app cards."); return null; }
    if (typeof WebSocket === "undefined") { console.warn("⚠️  This Node.js is too old (needs 22+): guide pages built without the app cards."); return null; }

    const server = http.createServer((req, res) => {
        const url = decodeURIComponent(req.url.split("?")[0]);
        if (url === "/appState.js") { res.writeHead(200, { "Content-Type": "text/javascript" }); res.end(STUB_APPSTATE); return; }
        const file = path.join(ROOT, url);
        if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
        fs.createReadStream(file).pipe(res);
    });
    await new Promise(r => server.listen(0, "127.0.0.1", r));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kih-cards-"));
    const proc = spawn(chrome, ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "about:blank"], { stdio: "ignore" });
    let ws;
    try {
        const portFile = path.join(dir, "DevToolsActivePort");
        for (let i = 0; i < 150 && !fs.existsSync(portFile); i++) await sleep(100);
        const port = fs.readFileSync(portFile, "utf8").split("\n")[0].trim();
        const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p => p.type === "page");
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
        let id = 0; const pending = new Map(); const errors = [];
        ws.onmessage = (m) => {
            const msg = JSON.parse(m.data);
            if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
            if (msg.method === "Runtime.exceptionThrown") errors.push((msg.params.exceptionDetails.exception || {}).description || msg.params.exceptionDetails.text);
        };
        const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
        const ev = async (expression) => {
            const r = await send("Runtime.evaluate", { expression, returnByValue: true });
            if (r.result.exceptionDetails) throw new Error((r.result.exceptionDetails.exception || {}).description || "evaluate failed");
            return r.result.result.value;
        };
        await send("Runtime.enable"); await send("Page.enable");
        await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/troopsandheroes.html` });
        let ready = false;
        for (let i = 0; i < 300 && !ready; i++) { await sleep(100); ready = await ev("typeof troopList !== 'undefined' && troopList.length > 0 && typeof heroList !== 'undefined' && heroList.length > 0").catch(() => false); }
        if (!ready) throw new Error("the Troops & Heroes page didn't load its units");

        // The app's own order (as in its gallery): troops, then heroes.
        const order = await ev(`[...troopList.map(u => ({ key: u.key, name: u.displayName, type: "troop", rarity: u.rarity })),
                                 ...heroList.map(u => ({ key: u.key, name: u.displayName, type: "hero", rarity: u.rarity }))]`);
        const videos = await ev("JSON.parse(JSON.stringify(unitVideoMap))");
        const cards = {};
        for (const u of order) {
            cards[u.key] = await ev(`(() => {
                const u = [...troopList, ...heroList].find(x => x.key === ${JSON.stringify(u.key)});
                const out = [];
                selectTroop = u; troopType = troopList.includes(u) ? "troop" : "hero";
                troopNavStack = []; troopsCameFromCompare = false;
                for (let L = 1; L <= u.levels.length; L++) {
                    troopsLevel = L;
                    updateTroopsCard();
                    out.push(document.getElementById("troopsCard").innerHTML);
                }
                return out;
            })()`);
        }
        return { order, videos, cards, errors };
    } finally {
        try { if (ws) ws.close(); } catch (e) { }
        proc.kill();
        server.close();
        await sleep(300);
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
    }
}

module.exports = { renderUnitCards };
