/* Builds everything that comes from the game data files:
   - small thumbnails of every unit portrait (images/thumbs/), for lists and
     icons — a fraction of the full picture's size;
   - data/bundle.json: every game data file in one download, which Games and
     Troops & Heroes read instead of fetching ~120 files one by one;
   - the Troops & Heroes guide: one page per unit (units/<slug>.html) showing
     the app's own unit card at every level (drawn by the app itself — see
     render-unit-cards.js), an index laid out like the app's gallery
     (units/index.html), and the sitemap.
   The interactive Troops & Heroes page builds everything in the browser, so
   search engines (and Google's ad review) see almost no text there; the guide
   carries the same information as plain, readable pages.
   Re-run after the game data files change:  node tools/build-unit-pages.js */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const SITE = "https://keazyea.github.io";
const GAME = "Kingdom Cash";
const G = require(path.join(ROOT, "games-core.js"));
const { renderUnitCards } = require(path.join(__dirname, "render-unit-cards.js"));
const units = G.unitsFromFiles(f => require(path.join(ROOT, f)));
const byKey = new Map(units.map(u => [u.key, u]));
const OUT = path.join(ROOT, "units");
const TODAY = new Date().toISOString().slice(0, 10);

/* ---------------- helpers ---------------- */
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => (typeof n === "number" && isFinite(n) ? n.toLocaleString("en-US") : "—");
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
const slugOf = (u) => u.name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/['’.]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const RARITY_ORDER = ["mythic", "legendary", "epic", "rare", "common"];
const levelsOf = (u) => (Array.isArray(u.levels) ? u.levels : []).slice().sort((a, b) => a.level - b.level);
const isHero = (u) => u.type === "hero";
// Troop names are mostly plural ("Archers"): "Archers are…", "Dragon Rider is…".
const plural = (u) => !isHero(u) && /s$/i.test(u.name) && !/ss$/i.test(u.name);
const be = (u) => (plural(u) ? "are" : "is");
const it = (u) => (plural(u) ? "they" : "it");
const its = (u) => (plural(u) ? "their" : "its");
const pct = (from, to) => (from > 0 ? Math.round((to / from - 1) * 100) : null);

const slugs = new Map();
units.forEach(u => {
    let s = slugOf(u) || u.key.toLowerCase(), n = 2;
    while ([...slugs.values()].includes(s)) s = slugOf(u) + "-" + n++;
    slugs.set(u.key, s);
});
const urlOf = (u) => `${slugs.get(u.key)}.html`;
const imgOf = (u) => "../" + u.img;
const thumbOf = (u) => "../" + u.img.replace(/^images\//, "images/thumbs/");
const appLink = (u, compare) => `../?goto=troops&amp;unit=${encodeURIComponent(u.key)}${compare ? "&amp;compare=1" : ""}`;

/* ---------------- thumbnails ----------------
   160 px wide (sharp at up to 80 px on a phone's screen), averaged down from
   the full picture. Only (re)made when the picture is newer than its thumb. */
function buildThumbnails() {
    const jpeg = require(path.join(ROOT, "vendor", "jpeg-js"));
    const W = 160;
    const shrink = (src, w) => {
        const h = Math.max(1, Math.round(src.height * w / src.width));
        const out = Buffer.alloc(w * h * 4);
        const sx = src.width / w, sy = src.height / h;
        for (let y = 0; y < h; y++) {
            const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
            for (let x = 0; x < w; x++) {
                const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
                let r = 0, g = 0, b = 0, n = 0;
                for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
                    const i = (yy * src.width + xx) * 4;
                    r += src.data[i]; g += src.data[i + 1]; b += src.data[i + 2]; n++;
                }
                const o = (y * w + x) * 4;
                out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
            }
        }
        return { width: w, height: h, data: out };
    };
    // Every picture gets one (unit portraits, stat icons, ability pictures):
    // anything the app shows small asks for images/thumbs/<name>. One that's
    // already small, or that this decoder can't read, is copied as it is.
    const dir = path.join(ROOT, "images", "thumbs");
    fs.mkdirSync(dir, { recursive: true });
    const pics = fs.readdirSync(path.join(ROOT, "images")).filter(f => /\.jpe?g$/i.test(f));
    let made = 0, bytes = 0;
    for (const f of pics) {
        const src = path.join(ROOT, "images", f), dst = path.join(dir, f);
        if (!fs.existsSync(dst) || fs.statSync(dst).mtimeMs < fs.statSync(src).mtimeMs) {
            const raw = fs.readFileSync(src);
            let pic = null;
            try { pic = jpeg.decode(raw, { useTArray: true, formatAsRGBA: true }); } catch (e) { }
            fs.writeFileSync(dst, pic && pic.width > W ? jpeg.encode(shrink(pic, W), 78).data : raw);
            made++;
        }
        bytes += fs.statSync(dst).size;
    }
    console.log(`thumbnails: ${made} made, ${pics.length} in all, ${(bytes / 1024).toFixed(0)} KB`);
}

/* ---------------- data bundle ----------------
   Every game data file (abilities, heroes, troops, unit modifiers and the
   text files), minified, in one file: { "hero.json": ..., ... }. A page
   reads a file from here, and only fetches it on its own if it's missing. */
function buildBundle() {
    const DATA_FILE = /^(ability|hero|troop|unit)[A-Za-z0-9_]*\.json$|^(en|localization)\.json$/;
    const bundle = {};
    fs.readdirSync(ROOT).filter(f => DATA_FILE.test(f)).sort().forEach(f => { bundle[f] = JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8")); });
    fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
    const text = JSON.stringify(bundle);
    fs.writeFileSync(path.join(ROOT, "data", "bundle.json"), text);
    console.log(`data/bundle.json: ${Object.keys(bundle).length} files, ${(text.length / 1024).toFixed(0)} KB (${(zlib.gzipSync(text).length / 1024).toFixed(0)} KB compressed)`);
}

/* ---------------- page parts ---------------- */
const CSS_VERSION = "2";
function head({ title, description, canonical, image }) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}">
    <link rel="canonical" href="${canonical}">
    <meta property="og:type" content="article">
    <meta property="og:site_name" content="Keazyea's Intelligence Hub">
    <meta property="og:title" content="${esc(title)}">
    <meta property="og:description" content="${esc(description)}">
    ${image ? `<meta property="og:image" content="${SITE}/${esc(image)}">` : ""}
    <link rel="icon" href="../images/KIH.jpg">
    <link rel="stylesheet" href="../style.css">
    <link rel="stylesheet" href="units.css?v=${CSS_VERSION}">
    <meta name="google-adsense-account" content="ca-pub-7081980567861066">
    <script>
        // Google's ad code (about 650 KB) loads once the page has finished
        // showing, so it never holds up the guide itself.
        addEventListener("load", () => setTimeout(() => {
            const s = document.createElement("script");
            s.async = true; s.crossOrigin = "anonymous";
            s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-7081980567861066";
            document.head.appendChild(s);
        }, 2500));
    </script>
</head>`;
}

// Always there at the top: Back (to wherever you came from), the unit before
// and after (in the app's order), and the whole list.
function guideBar(prev, next, isIndex) {
    const step = (u, dir) => u
        ? `<a class="gb-step" href="${urlOf(u)}" title="${dir === "‹" ? "Previous" : "Next"}: ${esc(u.name)}" aria-label="${dir === "‹" ? "Previous" : "Next"}: ${esc(u.name)}">${dir}</a>`
        : `<span class="gb-step off" aria-hidden="true">${dir}</span>`;
    return `<nav class="guide-bar" aria-label="Guide">
        <button type="button" class="gb-back" onclick="guideBack()">← Back</button>
        ${isIndex ? `<span class="gb-title">📖 Troops &amp; Heroes guide</span>` : `${step(prev, "‹")}<a class="gb-all" href="./">📖 All units</a>${step(next, "›")}`}
        <a class="gb-app" href="../">🏠 App</a>
    </nav>`;
}
const footer = `<footer class="guide-foot">
        <p><a href="../">Open the app</a> · <a href="./">Troops &amp; heroes guide</a> · <a href="../about.html">About &amp; contact</a> · <a href="../privacy.html">Privacy</a> · <a href="../terms.html">Terms</a></p>
        <p class="disclaimer">Keazyea's Intelligence Hub is an unofficial, fan-made guide to ${GAME}. It isn't affiliated with or endorsed by the game's publisher or developer; game names, characters and images belong to their owners. Stats come from the game's data files (updated ${TODAY}).</p>
    </footer>`;

function chips(u) {
    const l = levelsOf(u);
    return [
        `<span class="chip r-${u.rarity}">${cap(u.rarity)}</span>`,
        `<a class="chip" href="./?q=${encodeURIComponent(u.faction)}">${esc(u.faction)}</a>`,
        `<span class="chip">${isHero(u) ? "Hero" : "Troop"}</span>`,
        `<span class="chip">${esc(u.attack)}</span>`,
        l.some(x => x.splash) ? `<span class="chip">Area damage</span>` : ""
    ].join("");
}

// A few plain sentences from the data, so each page reads as a guide.
function intro(u) {
    const l = levelsOf(u), first = l[0] || {}, last = l[l.length - 1] || {};
    const kind = `${cap(u.rarity)} ${u.faction} ${isHero(u) ? "hero" : "troop"}`;
    const range = /ranged/i.test(u.attack) ? "attacks from range" : "fights in melee";
    const s = [];
    const attacks = !!(first.atk || last.atk); // summoners and the like have no attack of their own
    s.push(`<strong>${esc(u.name)}</strong> ${be(u)} ${/^[aeiou]/i.test(u.rarity) ? "an" : "a"} ${esc(kind)} in ${GAME}${attacks ? ` that ${plural(u) ? range.replace("attacks", "attack").replace("fights", "fight") : range}${l.some(x => x.splash) ? ", dealing area damage" : ""}` : ""}.`);
    if (u.desc) s.push(esc(u.desc.replace(/\s*$/, "").replace(/([^.!?])$/, "$1.")));
    if (first.hp && last.hp && l.length > 1) {
        const growth = (a, b, what) => { const p = pct(a, b); return p == null ? null : b / a >= 3 ? `${Math.round(b / a * 10) / 10}× the ${what}` : `${p}% more ${what}`; };
        const hpUp = growth(first.hp, last.hp, "HP"), atkUp = growth(first.atk, last.atk, "attack");
        if (!first.atk && !last.atk) {
            // summoners and the like: no attack of their own
            s.push(`${cap(it(u))} ${plural(u) ? "don't" : "doesn't"} attack directly. At level ${first.level}, ${it(u)} ${plural(u) ? "have" : "has"} ${fmt(first.hp)} HP, growing to ${fmt(last.hp)} HP by level ${last.level} (${its(u)} maximum)${hpUp ? ` — ${hpUp}` : ""}.`);
        } else {
            s.push(`At level ${first.level}, ${it(u)} ${plural(u) ? "have" : "has"} ${fmt(first.hp)} HP and ${fmt(first.atk)} attack. By level ${last.level} (${its(u)} maximum), that grows to ${fmt(last.hp)} HP and ${fmt(last.atk)} attack${hpUp && atkUp ? ` — ${hpUp} and ${atkUp}` : ""}.`);
        }
    }
    if (!isHero(u) && first.count && last.count && last.count !== first.count) s.push(`The squad grows from ${first.count} to ${last.count} units as it levels up.`);
    else if (!isHero(u) && first.count) s.push(`A squad has ${first.count} unit${first.count === 1 ? "" : "s"}.`);
    const ab = (u.abilityList || []).map(a => a.title);
    if (ab.length) s.push(`${plural(u) ? "Their" : "Its"} abilit${ab.length === 1 ? "y is" : "ies are"} ${ab.map(t => `<em>${esc(t)}</em>`).join(ab.length === 2 ? " and " : ", ")}${u.talent ? `, and ${its(u)} talent is <em>${esc(u.talent)}</em>` : ""}.`);
    else if (u.talent) s.push(`${cap(its(u))} talent is <em>${esc(u.talent)}</em>.`);
    return `<p class="lead">${s.join(" ")}</p>`;
}

function levelTable(u) {
    const l = levelsOf(u);
    if (!l.length) return "";
    const troop = !isHero(u);
    const speedVaries = l.some(x => x.speed !== l[0].speed);
    return `<section class="guide-section"><h2>📈 Stats by level</h2>
        <p class="dim">HP, attack and defence for ${troop ? "each unit in the squad" : "the hero"} at every level${troop ? ", with how many units the squad has" : ""}. Power is the game's overall strength rating.</p>
        <div class="tbl"><table><thead><tr><th>Level</th><th>HP</th><th>Attack</th><th>Defence</th>${troop ? "<th>Units</th>" : ""}${speedVaries ? "<th>Speed</th>" : ""}<th>Power</th></tr></thead>
        <tbody>${l.map(x => `<tr><td>${x.level}</td><td>${fmt(x.hp)}</td><td>${fmt(x.atk)}</td><td>${fmt(x.def)}</td>${troop ? `<td>${fmt(x.count)}</td>` : ""}${speedVaries ? `<td>${fmt(x.speed)}</td>` : ""}<td>${fmt(x.power)}</td></tr>`).join("")}</tbody></table></div>
    </section>`;
}

// A unit as the app's gallery shows it: picture on its rarity colour, name below.
function galleryItem(u, appName) {
    return `<a class="gallery-item ${u.rarity}" href="${urlOf(u)}" data-name="${esc((appName || u.name).toLowerCase())}" data-type="${isHero(u) ? "hero" : "troop"}" data-rarity="${u.rarity}" data-faction="${esc(u.faction.toLowerCase())}" data-attack="${esc(String(u.attack).toLowerCase())}">
            <img src="${thumbOf(u)}" alt="" loading="lazy" decoding="async" width="100" height="100"><span>${esc(appName || u.name)}</span></a>`;
}

function related(u, names) {
    const sameFaction = units.filter(x => x !== u && x.faction === u.faction && x.type === u.type);
    const sameRarity = units.filter(x => x !== u && x.rarity === u.rarity && x.type === u.type && x.faction !== u.faction);
    const block = (title, list) => list.length ? `<div class="gallery-section-label">${title}</div><div class="unit-gallery">${list.map(x => galleryItem(x, names[x.key])).join("")}</div>` : "";
    return `<section class="guide-section"><h2>🔗 Related ${isHero(u) ? "heroes" : "troops"}</h2>
        <div id="troopsResults">${block(`More ${esc(u.faction)} ${isHero(u) ? "heroes" : "troops"}`, sameFaction)}${block(`More ${cap(u.rarity)} ${isHero(u) ? "heroes" : "troops"}`, sameRarity)}</div>
    </section>`;
}

/* The app's card, made to work on its own page: pictures one folder up, and
   its few app-only buttons (a unit's video, "Applies to" lists, "Switch to"
   a linked unit) pointed at their guide equivalents. */
const KNOWN_ONCLICK = [/^openUnitVideo\(/, /^let d = document\.getElementById\(/, /^openAppliesToList\(/];
const unknownHandlers = new Set();
function cardForGuide(html, names) {
    let h = html.replace(/\b(src|href)="images\//g, '$1="../images/');
    // "Switch to <linked unit>": go to that unit's page
    h = h.replace(/onclick="\s*selectTroop = troopList\.find\(t => t\.key === '([^']+)'\);\s*updateTroopsCard\(\)\s*"/g, (m, key) => {
        const t = byKey.get(key);
        return t ? `onclick="location.href='${urlOf(t)}'"` : "";
    });
    for (const m of h.matchAll(/onclick="([\s\S]*?)"/g)) {
        const code = m[1].trim();
        if (!KNOWN_ONCLICK.some(re => re.test(code)) && !/^location\.href=/.test(code)) unknownHandlers.add(code.replace(/\s+/g, " ").slice(0, 100));
    }
    return h;
}

function unitPage(u, ctx) {
    const { prev, next, cards, names, videos } = ctx;
    const kind = `${cap(u.rarity)} ${u.faction} ${isHero(u) ? "hero" : "troop"}`;
    const extras = [(u.abilityList || []).length ? `${(u.abilityList || []).map(a => a.title).join(", ")} ability stats` : "", u.talent ? `the ${u.talent} talent` : ""].filter(Boolean);
    const description = `${u.name} (${kind}) in ${GAME}: every stat at every level${extras.length ? ", " + extras.join(" and ") : ""}, as shown in the app.`;
    const levels = cards ? cards.map(c => cardForGuide(c, names)) : null;
    const max = levels ? levels.length : 0;
    const myVideos = {};
    if (levels) for (const m of levels.join("").matchAll(/openUnitVideo\('([^']+)'\)/g)) if (videos[m[1]]) myVideos[m[1]] = videos[m[1]];
    const card = levels ? `
        <section class="guide-section">
            <h2>📊 Unit card</h2>
            <p class="dim">Exactly as the app shows it. Slide to see any level; tap <b>i</b> next to a stat for what it means.</p>
            <div class="slider-row guide-slider">
                <input type="range" min="1" max="${max}" value="1" id="guideLevel" aria-label="Level">
                <span id="guideLevelText">Level 1</span>
            </div>
            <div id="troopsCard">${levels[0]}</div>
            ${levels.slice(1).map((c, i) => `<template id="lv-${i + 2}">${c}</template>`).join("\n            ")}
        </section>` : "";
    return `${head({ title: `${u.name} — ${GAME} ${isHero(u) ? "hero" : "troop"} stats & guide | Keazyea's Intelligence Hub`, description, canonical: `${SITE}/units/${urlOf(u)}`, image: u.img })}
<body class="kih-glow glow-troops kih-stars guide-page">
    ${guideBar(prev, next, false)}
    <main class="guide-main">
        <p class="crumbs"><a href="./">Troops &amp; Heroes</a> › <a href="./?type=${isHero(u) ? "hero" : "troop"}">${isHero(u) ? "Heroes" : "Troops"}</a> › ${esc(u.name)}</p>
        <div class="guide-hero">
            <img src="${imgOf(u)}" alt="${esc(u.name)}" width="120" height="120">
            <div><h1>${esc(u.name)}</h1><div class="chips">${chips(u)}</div></div>
        </div>
        ${intro(u)}
        <div class="guide-actions">
            <a class="ga-btn" href="${appLink(u, false)}">📊 Open in the app</a>
            <a class="ga-btn alt" href="${appLink(u, true)}">⚔️ Compare with another unit</a>
        </div>
        ${card}
        ${levelTable(u)}
        ${related(u, names)}
        <nav class="guide-prevnext" aria-label="More units">
            ${prev ? `<a href="${urlOf(prev)}">‹ ${esc(names[prev.key] || prev.name)}</a>` : "<span></span>"}
            ${next ? `<a href="${urlOf(next)}">${esc(names[next.key] || next.name)} ›</a>` : "<span></span>"}
        </nav>
    </main>
    ${footer}
    <script>
        // Back: to the page you came from on this site, or else the guide's list.
        function guideBack() {
            try { if (document.referrer && new URL(document.referrer).origin === location.origin && history.length > 1) { history.back(); return; } } catch (e) { }
            location.href = "./";
        }
        // The card's own buttons, here on their own page.
        var UNIT_VIDEOS = ${JSON.stringify(myVideos)};
        function openUnitVideo(key) { if (UNIT_VIDEOS[key]) window.open(UNIT_VIDEOS[key], "_blank", "noopener"); }
        function openAppliesToList(value) { location.href = "./?q=" + encodeURIComponent(value); }
        // The level slider shows that level's card (and remembers it in the address).
        (function () {
            var slider = document.getElementById("guideLevel");
            if (!slider) return;
            var text = document.getElementById("guideLevelText"), card = document.getElementById("troopsCard"), first = card.innerHTML;
            function show(level, remember) {
                var tpl = document.getElementById("lv-" + level);
                card.innerHTML = level === 1 ? first : tpl ? tpl.innerHTML : card.innerHTML;
                text.textContent = "Level " + level;
                slider.value = level;
                if (remember) history.replaceState(history.state, "", level > 1 ? "#level-" + level : location.pathname + location.search);
            }
            slider.addEventListener("input", function () { show(Number(slider.value), true); });
            function fromAddress() {
                var m = /#level-(\\d+)/.exec(location.hash);
                var level = m ? Number(m[1]) : 1;
                if (level >= 1 && level <= ${max}) show(level, false);
            }
            addEventListener("hashchange", fromAddress);
            if (location.hash) fromAddress();
        })();
        ${ZOOM_GUARD}
    </script>
</body>
</html>
`;
}

// The same pinch-zoom guard as the app's pages (see style.css .kih-zoomed).
const ZOOM_GUARD = `(function () {
            var vv = window.visualViewport;
            if (!vv) return;
            function mark() { document.documentElement.classList.toggle("kih-zoomed", vv.scale > 1.05); }
            vv.addEventListener("resize", mark);
            mark();
        })();`;

function indexPage(ordered, names) {
    const heroes = units.filter(isHero).length, troops = units.length - heroes;
    const factions = [...new Set(units.map(u => u.faction))];
    const withAb = units.filter(u => (u.abilityList || []).length).length;
    const chipRow = (group, items) => `<div class="filter-row" data-group="${group}">${items.map(([v, label], i) => `<button type="button" class="filter-chip${i === 0 ? " on" : ""}" data-value="${v}">${label}</button>`).join("")}</div>`;
    const section = (type, label) => `<div class="gallery-section-label" data-section="${type}">${label}</div>
            <div class="unit-gallery" data-section="${type}">${ordered.filter(u => u.type === type).map(u => galleryItem(u, names[u.key])).join("")}</div>`;
    return `${head({ title: `All ${GAME} troops & heroes — stats, abilities & talents | Keazyea's Intelligence Hub`, description: `Every ${GAME} hero and troop: every stat at every level, ability and talent details, as shown in the app. ${heroes} heroes and ${troops} troops.`, canonical: `${SITE}/units/`, image: "images/KIH_HP.jpg" })}
<body class="kih-glow glow-troops kih-stars guide-page">
    ${guideBar(null, null, true)}
    <main class="guide-main">
        <h1>Troops &amp; Heroes</h1>
        <p class="lead">A guide to every unit in ${GAME}: <strong>${heroes} heroes</strong> and <strong>${troops} troops</strong> across the ${factions.length} factions (${factions.join(", ")}). Each page shows the unit's card exactly as the app does, at every level: HP, attack, range, speed and more, ${withAb} units' abilities with their numbers, and each hero's talent.</p>
        <div class="guide-filters">
            <div class="search-row"><input type="text" id="guideSearch" placeholder="Search Troop/Hero" aria-label="Search troops and heroes"><button type="button" class="clear-btn" id="guideClear">Clear</button></div>
            ${chipRow("type", [["", "All"], ["troop", "Troops"], ["hero", "Heroes"]])}
            ${chipRow("rarity", [["", "Any rarity"], ...RARITY_ORDER.map(r => [r, cap(r)])])}
            ${chipRow("faction", [["", "Any faction"], ...factions.map(f => [f.toLowerCase(), f])])}
        </div>
        <div id="troopsResults">
            ${section("troop", "Troops")}
            ${section("hero", "Heroes")}
            <p class="none" id="guideNone" hidden>No units match — try another search or filter.</p>
        </div>
        <section class="guide-section">
            <h2>About this guide</h2>
            <p>Heroes are single, powerful units with abilities and talents; troops fight as squads that grow as they level up. Rarity runs from Common through Rare, Epic and Legendary up to Mythic. To compare two units side by side, build a formation or check the latest promo codes, <a href="../">open the app</a>.</p>
        </section>
    </main>
    ${footer}
    <script>
        function guideBack() {
            try { if (document.referrer && new URL(document.referrer).origin === location.origin && history.length > 1) { history.back(); return; } } catch (e) { }
            location.href = "../";
        }
        // Search and filters, as you type or tap. ?q= / ?type= in the address set them
        // (the unit pages link here, e.g. "Applies to: Human").
        (function () {
            var input = document.getElementById("guideSearch");
            var params = new URLSearchParams(location.search);
            var state = { type: params.get("type") || "", rarity: "", faction: "" };
            input.value = params.get("q") || "";
            document.querySelectorAll(".filter-row").forEach(function (row) {
                var group = row.dataset.group;
                row.querySelectorAll(".filter-chip").forEach(function (chip) {
                    chip.classList.toggle("on", chip.dataset.value === state[group]);
                    chip.addEventListener("click", function () {
                        state[group] = chip.dataset.value;
                        row.querySelectorAll(".filter-chip").forEach(function (c) { c.classList.toggle("on", c === chip); });
                        apply();
                    });
                });
            });
            function apply() {
                var q = input.value.trim().toLowerCase(), shown = 0;
                document.querySelectorAll("#troopsResults .gallery-item").forEach(function (el) {
                    var d = el.dataset;
                    var ok = (!state.type || d.type === state.type) && (!state.rarity || d.rarity === state.rarity) && (!state.faction || d.faction === state.faction)
                        && (!q || d.name.indexOf(q) >= 0 || d.faction === q || d.rarity === q || d.attack === q || d.type === q || (q === "troops" && d.type === "troop") || (q === "heroes" && d.type === "hero"));
                    el.hidden = !ok;
                    if (ok) shown++;
                });
                ["troop", "hero"].forEach(function (t) {
                    var any = document.querySelector('.unit-gallery[data-section="' + t + '"] .gallery-item:not([hidden])');
                    document.querySelectorAll('[data-section="' + t + '"]').forEach(function (el) { el.hidden = !any; });
                });
                document.getElementById("guideNone").hidden = shown > 0;
            }
            input.addEventListener("input", apply);
            document.getElementById("guideClear").addEventListener("click", function () { input.value = ""; apply(); input.focus(); });
            apply();
        })();
        ${ZOOM_GUARD}
    </script>
</body>
</html>
`;
}

/* ---------------- build ---------------- */
(async () => {
    buildThumbnails();
    buildBundle(); // before the cards: the app reads its data from the bundle
    const app = await renderUnitCards(ROOT).catch(e => { console.warn("⚠️  Couldn't draw the app's unit cards:", e.message); return null; });
    if (app && app.errors.length) console.warn("⚠️  The app reported errors while drawing cards:\n   " + [...new Set(app.errors)].slice(0, 5).join("\n   "));

    // the app's order when we have it, so ‹ › and the list match the app
    const appOrder = app ? app.order.map(o => byKey.get(o.key)).filter(Boolean) : [];
    const ordered = [...appOrder, ...units.filter(u => !appOrder.includes(u))];
    const names = Object.fromEntries((app ? app.order : []).map(o => [o.key, o.name]));

    fs.mkdirSync(OUT, { recursive: true });
    // start clean, so a unit that's gone from the game loses its page (units.css stays)
    fs.readdirSync(OUT).filter(f => f.endsWith(".html")).forEach(f => fs.unlinkSync(path.join(OUT, f)));
    ordered.forEach((u, i) => fs.writeFileSync(path.join(OUT, urlOf(u)), unitPage(u, {
        prev: ordered[i - 1] || null, next: ordered[i + 1] || null,
        cards: app && app.cards[u.key], names, videos: app ? app.videos : {}
    })));
    fs.writeFileSync(path.join(OUT, "index.html"), indexPage(ordered, names));
    if (unknownHandlers.size) console.warn("⚠️  Card buttons this page doesn't handle yet:\n   " + [...unknownHandlers].join("\n   "));

    const pages = ["", "units/", "about.html", "promo.html", "tips.html", "games.html", "troopsandheroes.html", "social.html", "store.html", "privacy.html", "terms.html"]
        .concat(ordered.map(u => "units/" + urlOf(u)));
    fs.writeFileSync(path.join(ROOT, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map(p => `  <url><loc>${SITE}/${p}</loc><lastmod>${TODAY}</lastmod></url>`).join("\n")}
</urlset>
`);
    console.log(`guide: ${ordered.length} unit pages${app ? " with the app's cards" : " (no app cards)"}, units/index.html, sitemap.xml (${pages.length} URLs)`);
})();
