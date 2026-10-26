/* Builds everything that comes from the game data files:
   - the static Troops & Heroes guide: one page per unit (units/<slug>.html),
     an index of them all (units/index.html) and the sitemap;
   - small thumbnails of every unit portrait (images/thumbs/), for lists and
     icons — a fraction of the full picture's size;
   - data/bundle.json: every game data file in one download, which Games and
     Troops & Heroes read instead of fetching ~120 files one by one.
   The interactive Troops & Heroes page builds everything in the browser, so
   search engines (and Google's ad review) see almost no text there; these
   pages carry the same game data as plain, readable HTML.
   Re-run after the game data files change:  node tools/build-unit-pages.js */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SITE = "https://keazyea.github.io";
const GAME = "Kingdom Cash";
const G = require(path.join(ROOT, "games-core.js"));
const units = G.unitsFromFiles(f => require(path.join(ROOT, f)));
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
const NUM_LABELS = { dmg: ["Damage", ""], stun: ["Stun", " s"], cd: ["Cooldown", " s"], radius: ["Area radius", ""], heal: ["Heal", ""], fear: ["Fear", " s"], dur: ["Duration", " s"], max: ["Max targets", ""] };

// slugs must be unique
const slugs = new Map();
units.forEach(u => {
    let s = slugOf(u) || u.key.toLowerCase(), n = 2;
    while ([...slugs.values()].includes(s)) s = slugOf(u) + "-" + n++;
    slugs.set(u.key, s);
});
const urlOf = (u) => `${slugs.get(u.key)}.html`;
const imgOf = (u) => "../" + u.img;
const thumbOf = (u) => "../" + u.img.replace(/^images\//, "images/thumbs/"); // small cards

/* ---------------- page parts ---------------- */
const CSS_VERSION = "1";
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
const topbar = (crumb) => `<header class="top"><a class="brand" href="../"><img src="../images/KIH.jpg" alt="" width="28" height="28">Keazyea's Intelligence Hub</a>
    <nav class="crumbs"><a href="./">All troops &amp; heroes</a>${crumb ? ` <span>›</span> ${esc(crumb)}` : ""}</nav></header>`;
const footer = `<footer class="foot">
        <p><a href="../">Open the app</a> · <a href="./">Troops &amp; heroes guide</a> · <a href="../about.html">About &amp; contact</a> · <a href="../privacy.html">Privacy</a> · <a href="../terms.html">Terms</a></p>
        <p class="disclaimer">Keazyea's Intelligence Hub is an unofficial, fan-made guide to ${GAME}. It isn't affiliated with or endorsed by the game's publisher or developer; game names, characters and images belong to their owners. Stats come from the game's data files (updated ${TODAY}).</p>
    </footer>`;
function chips(u) {
    const l = levelsOf(u);
    return [
        `<span class="chip r-${u.rarity}">${cap(u.rarity)}</span>`,
        `<span class="chip">${esc(u.faction)}</span>`,
        `<span class="chip">${isHero(u) ? "Hero" : "Troop"}</span>`,
        `<span class="chip">${esc(u.attack)}</span>`,
        l.some(x => x.splash) ? `<span class="chip">Area damage</span>` : ""
    ].join("");
}

// A few plain sentences from the data, so each page reads as a guide, not just a table.
function intro(u) {
    const l = levelsOf(u), first = l[0] || {}, last = l[l.length - 1] || {};
    const kind = `${cap(u.rarity)} ${u.faction} ${isHero(u) ? "hero" : "troop"}`;
    const range = /ranged/i.test(u.attack) ? "attacks from range" : "fights in melee";
    const s = [];
    s.push(`<strong>${esc(u.name)}</strong> ${be(u)} ${/^[aeiou]/i.test(u.rarity) ? "an" : "a"} ${esc(kind)} in ${GAME} that ${plural(u) ? range.replace("attacks", "attack").replace("fights", "fight") : range}${l.some(x => x.splash) ? ", dealing area damage" : ""}.`);
    if (u.desc) s.push(esc(u.desc.replace(/\s*$/, "").replace(/([^.!?])$/, "$1.")));
    if (first.hp && last.hp && l.length > 1) {
        // "126% more HP", or for big jumps "23.8× the HP"
        const growth = (a, b, what) => { const p = pct(a, b); return p == null ? null : b / a >= 3 ? `${Math.round(b / a * 10) / 10}× the ${what}` : `${p}% more ${what}`; };
        const hpUp = growth(first.hp, last.hp, "HP"), atkUp = growth(first.atk, last.atk, "attack");
        s.push(`At level ${first.level}, ${it(u)} ${plural(u) ? "have" : "has"} ${fmt(first.hp)} HP and ${fmt(first.atk)} attack. By level ${last.level} (${its(u)} maximum), that grows to ${fmt(last.hp)} HP and ${fmt(last.atk)} attack${hpUp && atkUp ? ` — ${hpUp} and ${atkUp}` : ""}.`);
    }
    if (!isHero(u) && first.count && last.count && last.count !== first.count) s.push(`The squad grows from ${first.count} to ${last.count} units as it levels up.`);
    else if (!isHero(u) && first.count) s.push(`A squad has ${first.count} unit${first.count === 1 ? "" : "s"}.`);
    const ab = (u.abilityList || []).map(a => a.title);
    if (ab.length) s.push(`${plural(u) ? "Their" : "Its"} abilit${ab.length === 1 ? "y is" : "ies are"} ${ab.map(t => `<em>${esc(t)}</em>`).join(ab.length === 2 ? " and " : ", ")}${u.talent ? `, and ${its(u)} talent is <em>${esc(u.talent)}</em>` : ""}.`);
    else if (u.talent) s.push(`${cap(its(u))} talent is <em>${esc(u.talent)}</em>.`);
    return `<p class="lead">${s.join(" ")}</p>`;
}

function facts(u) {
    const l = levelsOf(u), last = l[l.length - 1] || {}, first = l[0] || {};
    const speedSame = l.every(x => x.speed === first.speed);
    const items = [
        ["Max HP", fmt(last.hp)], ["Max attack", fmt(last.atk)], ["Max defence", fmt(last.def)],
        ["Max power", fmt(last.power)], ["Max level", fmt(last.level || u.maxLevel)],
        speedSame && first.speed != null ? ["Speed", fmt(first.speed)] : null,
        !isHero(u) && last.count ? ["Squad size (max)", fmt(last.count)] : null
    ].filter(Boolean);
    return `<div class="facts">${items.map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join("")}</div>`;
}

function abilities(u) {
    const list = u.abilityList || [];
    if (!list.length) return "";
    return `<section><h2>${list.length === 1 ? "Ability" : "Abilities"}</h2>${list.map(a => {
        const ids = Object.keys(a.nums || {}).filter(id => NUM_LABELS[id]);
        const lvls = [...new Set(ids.flatMap(id => a.nums[id].map(v => v[0])))].sort((x, y) => x - y);
        const at = (id, L) => { const v = (a.nums[id] || []).find(x => x[0] === L); return v ? fmt(v[1]) + NUM_LABELS[id][1] : "—"; };
        const sum = ids.length ? ids.map(id => {
            const v = a.nums[id], lo = v[0][1], hi = v[v.length - 1][1], [label, unit] = NUM_LABELS[id];
            return lo === hi ? `${label.toLowerCase()} ${fmt(lo)}${unit}` : `${label.toLowerCase()} ${fmt(lo)}${unit} at level ${v[0][0]} to ${fmt(hi)}${unit} at level ${v[v.length - 1][0]}`;
        }).join("; ") : "";
        return `<article class="ability"><h3>${esc(a.title)}</h3>
            ${a.desc ? `<p>${esc(a.desc)}</p>` : ""}
            ${sum ? `<p class="dim">${cap(sum)}.</p>` : ""}
            ${ids.length && lvls.length > 1 ? `<div class="tbl"><table><thead><tr><th>Level</th>${ids.map(id => `<th>${NUM_LABELS[id][0]}</th>`).join("")}</tr></thead>
                <tbody>${lvls.map(L => `<tr><td>${L}</td>${ids.map(id => `<td>${at(id, L)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : ""}
        </article>`;
    }).join("")}</section>`;
}

function talent(u) {
    if (!u.talent) return "";
    const stats = u.talentStats || [];
    const lvls = [...new Set(stats.flatMap(s => s.values.map(v => v[0])))].sort((a, b) => a - b);
    return `<section><h2>Talent: ${esc(u.talent)}</h2>
        ${u.talentDesc ? `<p>${esc(u.talentDesc)}</p>` : ""}
        ${stats.length ? `<p class="dim">${stats.map(s => `${esc(s.label)}: +${fmt(s.values[0][1])}% at talent level ${s.values[0][0]}, up to +${fmt(s.values[s.values.length - 1][1])}% at level ${s.values[s.values.length - 1][0]}`).join(". ")}.</p>
        <div class="tbl"><table><thead><tr><th>Talent level</th>${stats.map(s => `<th>${esc(s.label)}</th>`).join("")}</tr></thead>
            <tbody>${lvls.map(L => `<tr><td>${L}</td>${stats.map(s => { const v = s.values.find(x => x[0] === L); return `<td>${v ? "+" + fmt(v[1]) + "%" : "—"}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div>` : ""}
    </section>`;
}

function levelTable(u) {
    const l = levelsOf(u);
    if (!l.length) return "";
    const troop = !isHero(u);
    const speedVaries = l.some(x => x.speed !== l[0].speed);
    return `<section><h2>Stats by level</h2>
        <p class="dim">HP, attack and defence for ${troop ? "each unit in the squad" : "the hero"} at every level${troop ? ", with how many units the squad has" : ""}. Power is the game's overall strength rating.</p>
        <div class="tbl"><table><thead><tr><th>Level</th><th>HP</th><th>Attack</th><th>Defence</th>${troop ? "<th>Units</th>" : ""}${speedVaries ? "<th>Speed</th>" : ""}<th>Power</th></tr></thead>
        <tbody>${l.map(x => `<tr><td>${x.level}</td><td>${fmt(x.hp)}</td><td>${fmt(x.atk)}</td><td>${fmt(x.def)}</td>${troop ? `<td>${fmt(x.count)}</td>` : ""}${speedVaries ? `<td>${fmt(x.speed)}</td>` : ""}<td>${fmt(x.power)}</td></tr>`).join("")}</tbody></table></div>
    </section>`;
}

function card(u) {
    const last = levelsOf(u).slice(-1)[0] || {};
    return `<a class="card" href="${urlOf(u)}"><img src="${thumbOf(u)}" alt="${esc(u.name)}" loading="lazy" decoding="async" width="56" height="56"><span><b>${esc(u.name)}</b><small>${cap(u.rarity)} ${esc(u.faction)} · ${esc(u.attack)}${last.hp ? ` · ${fmt(last.hp)} max HP` : ""}</small></span></a>`;
}

function related(u) {
    const sameFaction = units.filter(x => x !== u && x.faction === u.faction && x.type === u.type).slice(0, 8);
    const sameRarity = units.filter(x => x !== u && x.rarity === u.rarity && x.type === u.type && x.faction !== u.faction).slice(0, 6);
    const block = (title, list) => list.length ? `<h3>${title}</h3><div class="cards">${list.map(card).join("")}</div>` : "";
    return `<section><h2>Related ${isHero(u) ? "heroes" : "troops"}</h2>
        ${block(`Other ${esc(u.faction)} ${isHero(u) ? "heroes" : "troops"}`, sameFaction)}
        ${block(`Other ${cap(u.rarity)} ${isHero(u) ? "heroes" : "troops"}`, sameRarity)}
    </section>`;
}

function unitPage(u) {
    const kind = `${cap(u.rarity)} ${u.faction} ${isHero(u) ? "hero" : "troop"}`;
    const extras = [(u.abilityList || []).length ? `${(u.abilityList || []).map(a => a.title).join(", ")} ability numbers` : "", u.talent ? `the ${u.talent} talent` : ""].filter(Boolean);
    const description = `${u.name} (${kind}) in ${GAME}: HP, attack, defence and power at every level${extras.length ? ", " + extras.join(" and ") : ""}.`;
    return `${head({ title: `${u.name} — ${GAME} ${isHero(u) ? "hero" : "troop"} stats & guide | Keazyea's Intelligence Hub`, description, canonical: `${SITE}/units/${urlOf(u)}`, image: u.img })}
<body>
    ${topbar(u.name)}
    <main>
        <div class="hero-card">
            <img src="${imgOf(u)}" alt="${esc(u.name)}" width="120" height="120">
            <div><h1>${esc(u.name)}</h1><div class="chips">${chips(u)}</div></div>
        </div>
        ${intro(u)}
        ${facts(u)}
        ${abilities(u)}
        ${talent(u)}
        ${levelTable(u)}
        <p class="cta"><a href="../">⚔️ Compare ${esc(u.name)} side by side with any other unit in the app →</a></p>
        ${related(u)}
    </main>
    ${footer}
</body>
</html>
`;
}

function indexPage() {
    const group = (type) => RARITY_ORDER.map(r => {
        const list = units.filter(u => u.type === type && u.rarity === r).sort((a, b) => a.name.localeCompare(b.name));
        return list.length ? `<h3>${cap(r)} <small>(${list.length})</small></h3><div class="cards">${list.map(card).join("")}</div>` : "";
    }).join("");
    const heroes = units.filter(isHero).length, troops = units.length - heroes;
    const factions = [...new Set(units.map(u => u.faction))];
    const withAb = units.filter(u => (u.abilityList || []).length).length;
    return `${head({ title: `All ${GAME} troops & heroes — stats, abilities & talents | Keazyea's Intelligence Hub`, description: `Every ${GAME} hero and troop: HP, attack, defence and power at each level, plus ability numbers and hero talents. ${heroes} heroes and ${troops} troops.`, canonical: `${SITE}/units/`, image: "images/KIH_HP.jpg" })}
<body>
    ${topbar("")}
    <main>
        <h1>${GAME} troops &amp; heroes</h1>
        <p class="lead">A guide to every unit in ${GAME}: <strong>${heroes} heroes</strong> and <strong>${troops} troops</strong> across the ${factions.length} factions (${factions.join(", ")}). Each page lists the unit's HP, attack, defence and power at every level, ${withAb} units' abilities with their damage, cooldown and area numbers level by level, and each hero's talent and what it adds as it levels up.</p>
        <p>Heroes are single, powerful units with abilities and talents; troops fight as squads that grow as they level up. Rarity runs from Common through Rare, Epic and Legendary up to Mythic. To compare two units side by side, build a formation or check the latest promo codes, <a href="../">open the app</a>.</p>
        <section><h2>Heroes</h2>${group("hero")}</section>
        <section><h2>Troops</h2>${group("troop")}</section>
    </main>
    ${footer}
</body>
</html>
`;
}

/* ---------------- write ---------------- */
fs.mkdirSync(OUT, { recursive: true });
// start clean, so a unit that's gone from the game loses its page (units.css stays)
fs.readdirSync(OUT).filter(f => f.endsWith(".html")).forEach(f => fs.unlinkSync(path.join(OUT, f)));
units.forEach(u => fs.writeFileSync(path.join(OUT, urlOf(u)), unitPage(u)));
fs.writeFileSync(path.join(OUT, "index.html"), indexPage());

const pages = ["", "units/", "about.html", "promo.html", "tips.html", "games.html", "troopsandheroes.html", "social.html", "store.html", "privacy.html", "terms.html"]
    .concat(units.map(u => "units/" + urlOf(u)));
fs.writeFileSync(path.join(ROOT, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map(p => `  <url><loc>${SITE}/${p}</loc><lastmod>${TODAY}</lastmod></url>`).join("\n")}
</urlset>
`);
console.log(`wrote ${units.length} unit pages, units/index.html and sitemap.xml (${pages.length} URLs)`);

/* ---------------- thumbnails ----------------
   160 px wide (sharp at up to 80 px on a phone's screen), averaged down from
   the full picture. Only (re)made when the picture is newer than its thumb. */
const jpeg = require(path.join(ROOT, "vendor", "jpeg-js"));
const THUMB_W = 160;
function shrink(src, w) {
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
}
const THUMBS = path.join(ROOT, "images", "thumbs");
fs.mkdirSync(THUMBS, { recursive: true });
let made = 0, thumbBytes = 0;
for (const u of units) {
    const srcFile = path.join(ROOT, u.img), dst = path.join(THUMBS, path.basename(u.img));
    if (!fs.existsSync(srcFile)) continue;
    if (!fs.existsSync(dst) || fs.statSync(dst).mtimeMs < fs.statSync(srcFile).mtimeMs) {
        const pic = jpeg.decode(fs.readFileSync(srcFile), { useTArray: true, formatAsRGBA: true });
        fs.writeFileSync(dst, jpeg.encode(pic.width > THUMB_W ? shrink(pic, THUMB_W) : pic, 78).data);
        made++;
    }
    thumbBytes += fs.statSync(dst).size;
}
console.log(`thumbnails: ${made} made, ${units.length} in all, ${(thumbBytes / 1024).toFixed(0)} KB`);

/* ---------------- data bundle ----------------
   Every game data file (abilities, heroes, troops, unit modifiers and the
   text files), minified, in one file: { "hero.json": ..., ... }. A page
   reads a file from here, and only fetches it on its own if it's missing. */
const DATA_FILE = /^(ability|hero|troop|unit)[A-Za-z0-9_]*\.json$|^(en|localization)\.json$/;
const bundle = {};
fs.readdirSync(ROOT).filter(f => DATA_FILE.test(f)).sort().forEach(f => { bundle[f] = JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8")); });
fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
const bundleText = JSON.stringify(bundle);
fs.writeFileSync(path.join(ROOT, "data", "bundle.json"), bundleText);
console.log(`data/bundle.json: ${Object.keys(bundle).length} files, ${(bundleText.length / 1024).toFixed(0)} KB (${(require("zlib").gzipSync(bundleText).length / 1024).toFixed(0)} KB compressed)`);
