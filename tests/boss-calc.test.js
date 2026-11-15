/* 🐉 The Bosses tab (boss-calc.js + data/bosses.json): every boss and
   ability has its text, every number on a boss's page is the game's own
   (data/bosses.json, kept by tools/build-boss-data.js), at levels 1–300,
   Ashira's spiders from the troop table, and the tab itself.
   Run:  npm test */
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const B = require("../boss-calc.js");
const T = require("../tools/build-boss-data.js");

const ROOT = path.join(__dirname, "..");
const J = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));
const DATA = { bosses: J("data/bosses.json"), localization: J("localization.json"), en: J("en.json"), troopsLevel: J("troopsLevel.json"),
    abilityAoeDamageSuicide: J("abilityAoeDamageSuicide.json"), modifiers: J("unitParameterModifierNested.json") };
const rows = (d) => (Array.isArray(d) ? d : Object.values(d));
const row = (r, label) => (r.rows.find(x => x.label === label) || {}).value;
const ability = (bossId, level, name) => B.bossAt(DATA, bossId, level).abilities.find(a => a.name === name);

describe("the bosses", () => {
    test("6 bosses, as the game names them, each ability with English text", () => {
        assert.deepEqual(B.BOSSES.map(b => `${B.text(DATA, b.name)} — ${B.text(DATA, b.title)}`),
            ["Balthazar — Fire Dragon", "Ashira — Spider Queen", "Dagon — Ancient Kraken", "Kalidor — Lord of the Dunes", "Goltharax — Gold Keeper", "Shai-Khold — Ice Snake"]);
        for (const b of B.BOSSES) for (const a of b.abilities) {
            assert.ok(B.text(DATA, a.name), `${b.id}: ${JSON.stringify(a.name)}`);
            assert.ok(B.text(DATA, a.desc).length > 15, `${b.id}: ${JSON.stringify(a.desc)}`);
        }
    });
    test("every ability a boss's page reads is in data/bosses.json, with all 300 levels where it changes", () => {
        for (const b of B.BOSSES) {
            assert.ok(DATA.bosses.levelUp[b.levelUp] && DATA.bosses.levelUp[b.levelUp].length === 300, `${b.id} health bar`);
            for (const a of b.abilities) {
                for (const id of [a.data, a.cannon, a.unitAttack].filter(Boolean)) {
                    const d = DATA.bosses.abilities[id];
                    assert.ok(d, `${b.id}: ${id}`);
                    Object.entries(d.perLevel).forEach(([f, arr]) => assert.ok(arr.length === 300 && arr.every(v => typeof v === "number"), `${id}.${f}`));
                }
                if (a.unit) assert.ok(DATA.bosses.units[a.unit], a.unit);
            }
        }
    });
    test("every ability shows numbers", () => {
        for (const b of B.BOSSES) {
            const r = B.bossAt(DATA, b.id, 1);
            r.abilities.forEach(a => assert.ok(a.rows.length, `${b.id}: ${a.name}`));
        }
    });
    test("Shai-Khold: only his own two abilities — no other boss's passive (Wind Mantle is Kalidor's)", () => {
        const r = B.bossAt(DATA, "iceSnake", 300);
        assert.deepEqual(r.abilities.map(a => a.name), ["Frost Needles", "Summon Ice Guardians"]);
        // nobody shows another boss's text
        const own = { dragon: /^boss_dragon_/, gold: /^boss_dragon_gold_|^boss_dragon_/, spiderQueen: /^boss_spiderQueen_/, kraken: /^boss_kraken_/, sand: /^bossSand_/, iceSnake: /^boss_IceSnake_/ };
        for (const b of B.BOSSES) for (const a of b.abilities) {
            if (typeof a.desc === "string") assert.match(a.desc, own[b.id], `${b.id}: ${a.desc}`);
        }
    });
    test("text is always plain (the game's colour tags removed, however nested)", () => {
        for (const b of B.BOSSES) for (const a of b.abilities) assert.ok(!/[<>]/.test(B.text(DATA, a.desc)));
        const fake = { localization: { k: { key: "k", value: "1" } }, en: { 1: "a <<color=#fff>b>script> <color=#323549>2%</color> <img" } };
        assert.equal(B.text(fake, "k"), "a script 2% img");
    });
});

describe("the game's numbers", () => {
    test("Balthazar's Fire Breath: 6,000 at level 1, 117,555 at 300, every 30s", () => {
        assert.equal(row(ability("dragon", 1, "Fire Breath"), "Damage"), 6000);
        assert.equal(row(ability("dragon", 300, "Fire Breath"), "Damage"), 117555);
        assert.equal(row(ability("dragon", 1, "Fire Breath"), "Cooldown"), "30s");
    });
    test("multi-hit attacks: damage per hit × hits", () => {
        const s = ability("dragon", 1, "Shattering Strikes");
        assert.deepEqual([row(s, "Damage per hit"), row(s, "Hits"), row(s, "Total damage")], [3600, 2, 7200]);
        const t = ability("kraken", 300, "Tentacle Smash");
        assert.deepEqual([row(t, "Damage per hit"), row(t, "Hits"), row(t, "Total damage")], [117555, 3, 352665]);
    });
    test("one damage figure per level — the table's own, level by level", () => {
        assert.deepEqual([1, 2, 3].map(l => row(ability("dragon", l, "Basic attack"), "Damage per hit")), [3600, 3636, 3672]);
        const fire = (lv) => row(ability("dragon", lv, "Fire Breath"), "Damage");
        assert.ok(fire(50) > fire(49) && fire(300) > fire(299));
    });
    test("Ashira: spiders summoned and their stats at the boss's level", () => {
        const bang = ability("spiderQueen", 1, "Explosive Spiders Summon"), melee = ability("spiderQueen", 300, "Battle Spiders Summon");
        assert.equal(row(bang, "Spiders summoned"), 40);
        assert.equal(row(melee, "Spiders summoned"), 75);
        assert.equal(bang.spider.blast, 550);
        const raw = rows(DATA.troopsLevel).find(r => r.troopId === "spiderMelee" && r.level === 300);
        assert.deepEqual([melee.spider.hp, melee.spider.attack, melee.spider.defense], [raw.health, raw.attack, raw.defense]);
        const acid = ability("spiderQueen", 1, "Acid Barrage");
        assert.deepEqual([row(acid, "Acid balls"), row(acid, "Acid pool lasts")], [7, "8s"]);
        assert.equal(row(ability("spiderQueen", 1, "Chitin Carapace"), "Basic attack damage reflected"), "20%");
        assert.ok(ability("spiderQueen", 1, "Chitin Carapace").desc.startsWith("20% of basic attack damage"));
    });
    test("Dagon swallows 15 → 60 units; your cannon does 20,000", () => {
        assert.equal(row(ability("kraken", 1, "Hungry Jaws"), "Units swallowed (at most)"), 15);
        assert.equal(row(ability("kraken", 300, "Hungry Jaws"), "Units swallowed (at most)"), 60);
        assert.equal(row(ability("kraken", 1, "Hungry Jaws"), "Your ship's cannon: damage"), 20000);
    });
    test("Kalidor's Quicksand: 5 areas, always miss, slowed", () => {
        const q = ability("sand", 1, "Quicksand");
        assert.deepEqual([row(q, "Quicksand areas"), row(q, "Attacks that miss"), row(q, "Reduced Movement Speed")], [5, "100%", "30%"]);
    });
    test("Shai-Khold: 7 needles; Ice Guardians with their own stats", () => {
        const n = ability("iceSnake", 1, "Frost Needles");
        assert.deepEqual([row(n, "Needles"), row(n, "Damage per needle"), row(n, "Shard burst when blocked")], [7, 10000, 5000]);
        const g = ability("iceSnake", 300, "Summon Ice Guardians");
        assert.deepEqual([row(g, "Guardian health"), row(g, "Guardian damage (per strike)"), row(g, "Hits up to (enemies)")], [17634, 16224, 9]);
    });
    test("resistance passives: 30% less damage", () => {
        assert.equal(row(ability("dragon", 1, "Sharp Growths"), "Damage taken from melee"), "−30%");
        assert.equal(row(ability("dragon", 1, "Smooth Scales"), "Damage taken from ranged"), "−30%");
    });
    test("health bar: total damage to reach the level, and to the next", () => {
        assert.deepEqual(B.bossAt(DATA, "dragon", 1).levelUp, { total: 0, next: 20000 });
        assert.deepEqual(B.bossAt(DATA, "dragon", 2).levelUp, { total: 20000, next: 20402 });
        assert.equal(B.bossAt(DATA, "dragon", 300).levelUp.next, null);
    });
    test("levels are 1–300, whole numbers", () => {
        assert.equal(B.bossAt(DATA, "dragon", 0).level, 1);
        assert.equal(B.bossAt(DATA, "dragon", 999).level, 300);
        assert.equal(B.bossAt(DATA, "dragon", "x").level, 1);
        assert.equal(B.bossAt(DATA, "dragon", 10.9).level, 10);
    });
    test("Goltharax: Balthazar's abilities (named as his, and says so), his own numbers", () => {
        const g = B.bossAt(DATA, "gold", 1);
        assert.equal(g.abilities[1].sameAs, "Balthazar");
        assert.equal(row(g.abilities[1], "Damage"), 6000);
    });
});

describe("tools/build-boss-data.js", () => {
    test("keeps a value that never changes once, and one that does as a list from level 1", () => {
        const s = T.squash({ 1: { a: 5, b: 10 }, 2: { a: 5, b: 11 }, 3: { a: 5, b: 12 } });
        assert.deepEqual(s, { levels: 3, fixed: { a: 5 }, perLevel: { b: [10, 11, 12] } });
    });
    test("boss rows only, by key or by what they belong to", () => {
        assert.ok(T.isBossRow("bossDragon_pull_1", {}));
        assert.ok(T.isBossRow("x", { abilityInfoId: "bossKraken_tentacle" }));
        assert.ok(T.isBossRow("x", { troopId: "bossIceSnakeSummon" }));
        assert.ok(!T.isBossRow("archer_1", { troopId: "archer" }));
    });
    test("an ability with an old and a new set of rows: the one with all the levels", () => {
        const file = { "bossX_hit_1": { key: "bossX_hit_1", abilityInfoId: "bossX_hit", attack: 1 } };
        for (let l = 1; l <= 3; l++) file[`bossXNew_hit_${l}`] = { key: `bossXNew_hit_${l}`, abilityInfoId: "bossX_hit", attack: 100 * l };
        const out = T.build((f) => (f === "abilityTest.json" ? JSON.stringify(file) : "{}"), ["abilityTest.json"], "test");
        assert.deepEqual(out.abilities.bossX_hit.perLevel.attack, [100, 200, 300]);
    });
    test("tools/strip-boss-data.js saves the boss numbers before taking the rows out", () => {
        const strip = fs.readFileSync(path.join(ROOT, "tools/strip-boss-data.js"), "utf8");
        const save = strip.indexOf('require("./build-boss-data.js").run([])');
        assert.ok(save > 0 && save < strip.indexOf("for (const file of TARGETS)"));
    });
});

describe("on the Troops, Heroes & Bosses page", () => {
    const page = fs.readFileSync(path.join(ROOT, "troopsandheroes.html"), "utf8");
    const index = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    test("a Bosses tab laid out like the troops: sticky bar (search, slider + a box to type), gallery, card", () => {
        assert.match(page, /onclick="switchTab\('bosses'\)">Bosses</);
        assert.match(page, /<script src="boss-calc\.js"><\/script>/);
        assert.match(page, /id="bossesPage"[\s\S]*class="sticky-controls"[\s\S]*id="bossSearch"[\s\S]*class="slider-row"[\s\S]*type="range"[^>]*id="bossSlider"[\s\S]*id="bcLevel"[\s\S]*id="bossBackBtnSlot"[\s\S]*id="bossResults"[\s\S]*id="bossCard"/);
        assert.match(page, /BossCalc\.mount\(\{ loadJSON, record: recordTroopsView \}\)/);
        assert.match(page, /q\.get\("tab"\) === "bosses"\) \{[\s\S]{0,200}history\.replaceState\(\{ thView: "bosses", key: null \}, ""\);\s*if \(q\.get\("boss"\)\) openBoss\(q\.get\("boss"\)\); else switchTab\("bosses"\);/, "?tab=bosses (its first step), and &boss= opens one");
        assert.match(page, /function openBoss\(id\) \{\s*if \([^\n]*\) window\.BossCalc\.show\(null\);\s*switchTab\("bosses"\);[\s\S]{0,300}BossCalc\.show\(id\)/, "Back from it: the gallery");
        assert.match(page, /thView: "bosses", key:/, "Back knows which boss");
    });
    test("named Troops, Heroes & Bosses; the three tabs are plain words, the same style", () => {
        assert.match(page, /<title>Troops, Heroes &amp; Bosses — /);
        assert.match(page, /<h1>Troops, Heroes &amp; Bosses<\/h1>/);
        assert.match(index, /home-menu-text">Troops, Heroes & Bosses<small>/);
        const tabs = [...page.match(/<div class="tabs">([\s\S]*?)<\/div>/)[1].matchAll(/<button class="tab-btn[^"]*" onclick="switchTab\('(\w+)'\)">([^<]*)<\/button>/g)].map(m => [m[1], m[2]]);
        assert.deepEqual(tabs, [["troops", "Troops & Heroes"], ["compare", "Compare"], ["bosses", "Bosses"]]);
    });
    test("Compare: any two units (a troop with a hero too), or two bosses", () => {
        assert.doesNotMatch(page, /Cannot compare a Troop with a Hero/);
        assert.match(page, /data-cmp-mode="units"[^>]*>Troops &amp; Heroes<[\s\S]*data-cmp-mode="bosses"[^>]*>Bosses</);
        assert.match(page, /id="unitPickers"[\s\S]*id="bossPickers" hidden[\s\S]*id="bccSelL"[\s\S]*id="bccSliderL"[\s\S]*id="bccLevelL"[\s\S]*id="bccSelR"[\s\S]*id="bccSliderR"[\s\S]*id="bccLevelR"/);
        assert.match(page, /function setCompareMode\(mode\)[\s\S]{0,600}BossCalc\.mountCompare\(\{ loadJSON \}\)/);
        assert.match(page, /Object\.keys\(rightData \|\| \{\}\)\.forEach/, "every stat either side has");
        assert.match(index, /setCompareMode\("units"\)/, "the compare quest opens on units");
    });
    test("the boss gallery and card share the troop gallery's and card's styles", () => {
        const css = fs.readFileSync(path.join(ROOT, "style.css"), "utf8");
        const troopRules = (css.match(/#troops(Card|Results)[^{,]*[,{]/g) || []).length;
        const bossRules = (css.match(/#boss(Card|Results)[^{,]*[,{]/g) || []).length;
        assert.ok(troopRules > 10);
        assert.equal(bossRules, troopRules);
    });
    test("each skill's picture is named after the game's own icon for it; Dagon's and the dragons' are in images/", () => {
        ["BOSSDRAGON_PIERCINGFIRE", "BOSSDRAGON_PULL", "BOSSDRAGON_EARTHQUAKE", "BOSSDRAGON_PASSIVE_MELEE", "BOSSDRAGON_PASSIVE_RANGE"].forEach(i => assert.ok(fs.existsSync(path.join(ROOT, `images/${i}.jpg`)), i));
        const gameIcons = new Set(rows(J("resource.json")).map(r => String(r.prefabPath || "")).filter(p => /BossAbilitiesIcons\//.test(p)).map(p => p.split("/").pop().toUpperCase()));
        for (const b of B.BOSSES) for (const a of b.abilities) {
            if (a.name && a.name.text === "Basic attack") { assert.equal(a.icon, undefined, `${b.id} basic attack has no icon in the game`); continue; }
            assert.ok(gameIcons.has(a.icon), `${b.id}: ${a.icon} is one of the game's boss icons`);
        }
        ["BOSSKRAKEN_TENTACLESTRIKESAOE", "BOSSKRAKEN_TENTACLE", "BOSSKRAKEN_TENTACLETHROW"].forEach(i => assert.ok(fs.existsSync(path.join(ROOT, `images/${i}.jpg`)), i));
        const kraken = B.bossAt(DATA, "kraken", 1).abilities;
        assert.deepEqual(["Tentacle Smash", "Hungry Jaws", "Gift From the Depths"].map(n => kraken.find(a => a.name === n).icon),
            ["BOSSKRAKEN_TENTACLESTRIKESAOE", "BOSSKRAKEN_TENTACLE", "BOSSKRAKEN_TENTACLETHROW"]);
        ["BOSSICESNAKE_ICEARROWS", "BOSSICESNAKE_SUMMON"].forEach(i => assert.ok(fs.existsSync(path.join(ROOT, `images/${i}.jpg`)), i));
        const snake = B.bossAt(DATA, "iceSnake", 1).abilities;
        assert.deepEqual(["Frost Needles", "Summon Ice Guardians"].map(n => snake.find(a => a.name === n).icon),
            ["BOSSICESNAKE_ICEARROWS", "BOSSICESNAKE_SUMMON"]);
    });
    test("every boss has a picture (+ a small gallery copy); Goltharax shares Balthazar's", () => {
        for (const b of B.BOSSES) {
            assert.ok(fs.existsSync(path.join(ROOT, `images/${b.img}.jpg`)), b.img);
            assert.ok(fs.existsSync(path.join(ROOT, `images/thumbs/${b.img}.jpg`)), "thumb " + b.img);
        }
        assert.equal(B.BOSSES.find(b => b.id === "gold").img, B.BOSSES.find(b => b.id === "dragon").img);
        assert.equal(new Set(B.BOSSES.map(b => b.img)).size, 5);
    });
});

describe("the Troops, Heroes & Bosses guide (units/)", () => {
    const page = (f) => fs.readFileSync(path.join(ROOT, "units", f), "utf8");
    const slug = (name) => "boss-" + name.toLowerCase().normalize("NFKD").replace(/['’.]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".html";
    test("every boss has a guide page with all its abilities and the game's numbers", () => {
        for (const b of B.BOSSES) {
            const r = B.bossAt(DATA, b.id, 300), html = page(slug(r.name));
            assert.match(html, new RegExp(`<h1>${r.name}</h1>`), b.id);
            r.abilities.forEach(a => assert.ok(html.includes(`<h3>${a.name.replace(/&/g, "&amp;").replace(/'/g, "&#39;")}</h3>`), `${b.id}: ${a.name}`));
            const first = r.abilities.find(a => a.rows.some(x => typeof x.value === "number"));
            const v = first.rows.find(x => typeof x.value === "number").value;
            assert.ok(html.includes(Math.round(v * 100) / 100 >= 1000 ? (Math.round(v * 100) / 100).toLocaleString("en-US") : String(Math.round(v * 100) / 100)), `${b.id}: its level-300 numbers are there`);
            assert.ok(html.includes(`../?goto=troops&amp;boss=${b.id}`), `${b.id}: Open in the app`);
        }
    });
    test("the guide's index lists the bosses (with a Bosses filter); the sitemap has their pages", () => {
        const index = page("index.html");
        assert.match(index, /<h1>Troops, Heroes &amp; Bosses<\/h1>/);
        assert.match(index, /data-value="boss">Bosses<\/button>/);
        for (const b of B.BOSSES) assert.ok(index.includes(`href="${slug(B.bossAt(DATA, b.id, 1).name)}"`), b.id);
        const map = fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf8");
        for (const b of B.BOSSES) assert.ok(map.includes("units/" + slug(B.bossAt(DATA, b.id, 1).name)), "sitemap: " + b.id);
    });
    test("the app: ?goto=troops&boss=<id> opens that boss; Home's guide link is a real button", () => {
        const home = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
        assert.match(home, /"troopsandheroes\.html\?tab=bosses&boss=" \+ encodeURIComponent\(linkBoss\)/);
        assert.match(home, /<a href="units\/" class="home-guide-btn">📖 Troops, Heroes &amp; Bosses guide/);
        assert.match(home, /\.home-guide-links \.home-guide-btn \{ display: inline-flex;[^}]*padding: 9px 16px;[^}]*background: linear-gradient/);
        // About the Creator + About & contact: one page (about.html), one button the same kind as the guide's
        assert.match(home, /<a href="about\.html" class="home-guide-btn" id="aboutHomeBtn">👋 About &amp; contact/);
        assert.doesNotMatch(home, /id="page-about"|>About the Creator</, "no second, in-app About page");
        assert.match(home, /if \(page === "about"\) \{ location\.href = "about\.html"; return; \}/, "anything opening About (the 🧭 guide) gets about.html");
        assert.match(home, /if \(gotoPage === "bug"\) \{[\s\S]{0,300}AppState\.waitForAuthReady\(\)\.then\(\(\) => window\.openBugReport\(\)\)/, "?goto=bug opens the bug report, once sign-in is known");
        const about = fs.readFileSync(path.join(ROOT, "about.html"), "utf8");
        for (const s of ['href="./?goto=bug">🐞 Report a bug', 'href="mailto:keazyea@gmail.com"', 'discord.gg', 'youtube.com/@keazyea', 'Join my clan', 'Troops, heroes &amp; bosses', 'href="./?goto=character"', 'href="./?goto=achievements"'])
            assert.ok(about.includes(s), "about.html: " + s);
    });
});
