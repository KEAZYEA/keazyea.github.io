/* 🏰 The Keep (dungeon-core.js): an open world — 🏘️ Hearthmoor (the city),
   four roads out of it, Story 1 (The Missing Warden) across them; your gear's
   stats, what drops, the bag, the furnace's fusions, selling. Run: npm test */
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const D = require("../dungeon-core.js");
const C = require("../character-core.js");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

// a road's map, walked from its gate: which 8px cells you can reach
function walkFrom(m) {
    const step = 8, W = Math.ceil(D.WILDS.pw / step), H = Math.ceil(D.WILDS.ph / step);
    const free = (gx, gy) => gx >= 0 && gy >= 0 && gx < W && gy < H && !D.blockedAt(m, gx * step + 4, gy * step + 4, 6);
    const seen = new Uint8Array(W * H), q = [[Math.floor(m.gate.x / step), Math.floor((m.gate.y - 30) / step)]];
    seen[q[0][1] * W + q[0][0]] = 1;
    while (q.length) { const [x, y] = q.pop(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (free(nx, ny) && !seen[ny * W + nx]) { seen[ny * W + nx] = 1; q.push([nx, ny]); } } }
    return (p) => { const gx = Math.floor(p.x / step), gy = Math.floor(p.y / step); for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (seen[(gy + dy) * W + gx + dx]) return true; return false; };
}

describe("🗺️ the four roads out of Hearthmoor", () => {
    test("south, west, east, north — each its land, its foes, three zones and its boss (tougher each time)", () => {
        assert.deepEqual(D.ROADS, ["south", "west", "east", "north"]);
        assert.deepEqual(Object.keys(D.REGIONS), D.ROADS);
        assert.deepEqual(D.ROADS.map(r => D.REGIONS[r].boss), D.BOSS_ORDER, "a boss a road, in the story's order");
        D.ROADS.forEach((r, i) => {
            const R = D.REGIONS[r];
            assert.ok(R.name && R.icon && R.dir && R.foes, r);
            assert.equal(R.zones.length, 3, `${r}: three zones`);
            R.zones.forEach(z => { assert.ok(z.name && z.colors.length === 2, r); z.pool.forEach(t => assert.ok(D.ENEMIES[t], `${r}: ${t}`)); assert.equal(D.ITEMS[z.node].kind, "mat", `${r}: ${z.node} grows`); });
            if (i) assert.ok(R.mult > D.REGIONS[D.ROADS[i - 1]].mult, `${r} is tougher than the road before`);
        });
        assert.equal(D.REGIONS.south.mult, 1, "the first road: as the monsters are");
    });
    test("the bosses: Captain Rattlebones, Ashira, Kalidor, Shai-Khold — each with its attacks and its look", () => {
        assert.deepEqual(Object.keys(D.BOSSES).sort(), [...D.BOSS_ORDER].sort());
        assert.ok(["boneVolley", "summonBones", "charge"].every(a => D.BOSSES.rattlebones.attacks.includes(a)));
        assert.ok(["summonSpiders", "poisonPuddles", "reflectAura"].every(a => D.BOSSES.ashira.attacks.includes(a)));
        assert.ok(["iceNeedles", "summonGuardians"].every(a => D.BOSSES.shaiKhold.attacks.includes(a)));
        assert.ok(["sandTraps", "hammerThrow", "spearLines"].every(a => D.BOSSES.kalidor.attacks.includes(a)));
        Object.values(D.BOSSES).forEach(b => { assert.ok(D.THEMES[b.theme], b.name); assert.ok(b.hp > 0 && b.r > 0 && b.speed > 0, b.name); });
    });
    test("which zone you're in: by the gate at the bottom, the far end at the top", () => {
        D.ROADS.forEach(r => {
            const Z = D.REGIONS[r].zones;
            assert.equal(D.zoneAt(r, D.WILDS.ph - 10), Z[0]);
            assert.equal(D.zoneAt(r, D.WILDS.ph * 0.45), Z[1]);
            assert.equal(D.zoneAt(r, 10), Z[2]);
            assert.equal(D.zoneAt(r, -50), Z[0], "off the map: the gate's");
        });
    });
    test("the same land every time; it fits the map; no road that isn't one", () => {
        D.ROADS.forEach(r => assert.deepEqual(D.regionMap(r), D.regionMap(r), r));
        assert.notDeepEqual(D.regionMap("south").obstacles, D.regionMap("west").obstacles);
        assert.equal(D.regionMap("nowhere"), null);
        assert.ok(D.WILDS.w * 16 <= 96 * 16 && D.WILDS.h <= 72);
        assert.ok(D.WILDS.pw <= (D.WILDS.w - 2) * 16 && D.WILDS.ph <= (D.WILDS.h - 2) * 16, "inside its walls");
    });
    test("every herb, ore, crate, pack — and the boss's lair — can be walked to from the gate; nothing in a rock; the lair's clear; no pack at the gate", () => {
        D.ROADS.forEach(r => {
            const m = D.regionMap(r), reach = walkFrom(m), R = D.REGIONS[r];
            m.nodes.forEach(n => { assert.ok(!D.blockedAt(m, n.x, n.y, 4), `${r}: ${n.kind} not in a rock`); assert.ok(reach(n), `${r}: ${n.kind} at ${Math.round(n.x)},${Math.round(n.y)} reachable`); });
            m.props.forEach(o => { assert.ok(D.PROPS[o.kind], o.kind); assert.ok(!D.blockedAt(m, o.x, o.y, 4) && reach(o), `${r}: a ${o.kind} you can get to`); });
            assert.ok(m.props.length >= 6 && m.props.some(o => o.kind === "crate") && m.props.some(o => o.kind === "barrel"), `${r}: crates and barrels to break`);
            m.packs.forEach(p => { assert.ok(reach(p), `${r}: pack reachable`); assert.ok(Math.hypot(p.x - m.gate.x, p.y - m.gate.y) >= 200, `${r}: no pack at the gate`); p.types.forEach(t => assert.ok(R.zones[p.zone].pool.includes(t), `${r}: ${t} belongs in its zone`)); });
            assert.ok(reach(m.lair) && reach({ x: m.lair.x, y: m.lair.y + m.lair.r * 0.6 }), `${r}: the lair can be reached`);
            [...m.obstacles, ...m.nodes, ...m.props, ...m.packs].forEach(o => assert.ok(Math.hypot(o.x - m.lair.x, o.y - m.lair.y) > m.lair.r, `${r}: nothing inside the lair`));
            assert.ok(m.nodes.length >= 15 && m.packs.length >= 10 && m.packs.filter(p => p.elite).length === 1, `${r}: plenty to do, and one elite`);
            assert.ok(m.packs.find(p => p.elite).zone === 2 && m.lair.y < D.WILDS.ph * 0.3, `${r}: the elite and the lair at the far end`);
            R.zones.forEach(z => assert.ok(m.nodes.some(n => n.kind === z.node), `${r}: some ${z.node}`));
            assert.ok(m.packs.every(p => p.mult >= R.mult), `${r}: as tough as the road at least`);
        });
    });
});

describe("📜 Story 1: The Missing Warden", () => {
    const S = D.STORY[0];
    const line = (l, where) => { assert.ok(Array.isArray(l) && l.length === 3 && l.every(x => typeof x === "string"), where); assert.ok(l[0] && l[2].length > 10, where); };
    test("set in Hearthmoor, across the four roads: the Elder's intro, a goal and a clue for each road, then the end", () => {
        assert.equal(S.title, "The Missing Warden"); assert.equal(S.city, "Hearthmoor");
        assert.deepEqual(S.roads, D.ROADS);
        assert.ok(S.intro.length >= 2); S.intro.forEach((l, i) => line(l, `intro ${i}`));
        D.ROADS.forEach(r => { const b = S.beats[r]; assert.ok(b.goal.length > 10, r); assert.ok(b.after.length >= 1, r); b.after.forEach((l, i) => line(l, `${r} after ${i}`)); });
        assert.ok(S.end.length >= 1); S.end.forEach((l, i) => line(l, `end ${i}`));
        assert.match(S.intro[0][2], /Elda/, "it starts with who's missing");
        assert.ok(S.beats.north.after.some(l => /Elda/.test(l[1])), "and ends with her found");
        assert.match(S.beats.south.goal, /Rattlebones/); assert.match(S.beats.north.goal, /Elda/);
    });
    test("each clue points to the next road", () => {
        assert.match(S.beats.south.after.map(l => l[2]).join(" "), /west/i);
        assert.match(S.beats.west.after.map(l => l[2]).join(" "), /east/i);
        assert.match(S.beats.east.after.map(l => l[2]).join(" "), /north/i);
    });
    test("the roads open one after another: south first; each once the one before is cleared", () => {
        assert.deepEqual(D.ROADS.map(r => D.roadOpen({}, r)), [true, false, false, false]);
        assert.deepEqual(D.ROADS.map(r => D.roadOpen({ south: true }, r)), [true, true, false, false]);
        assert.deepEqual(D.ROADS.map(r => D.roadOpen({ south: true, west: true, east: true }, r)), [true, true, true, true]);
        assert.deepEqual(D.ROADS.map(r => D.roadOpen({ west: true }, r)), [true, false, true, false], "only the one just before counts");
        assert.equal(D.roadOpen(null, "south"), true); assert.equal(D.roadOpen(null, "west"), false);
        assert.equal(D.roadOpen({ south: true }, "nowhere"), false);
        assert.equal(D.nextRoad({}), "south"); assert.equal(D.nextRoad(undefined), "south");
        assert.equal(D.nextRoad({ south: true, west: true }), "east");
        assert.equal(D.nextRoad({ south: true, west: true, east: true, north: true }), null, "the story's done");
    });
});

describe("👕 your gear is your loadout", () => {
    test("the starter look: the base stats and a sling", () => {
        const s = D.statsOf(C.cleanOutfit({}, []));
        assert.deepEqual([s.hp, s.mana, s.def, s.speed, s.crit, s.luck, s.dmg, s.weapon, s.pet], [D.BASE.hp, D.BASE.mana, 0, D.BASE.speed, D.BASE.crit, 0, 0, "sling", null]);
    });
    test("boots = speed, top = HP, bottom = defense, hat = crit, necklace = luck, hair = mana — the rarer, the more", () => {
        const one = (slot, id) => D.statsOf({ wear: { [slot]: id } });
        assert.equal(one("shoes", "boots").speed, D.BASE.speed + 5 * D.TIER.uncommon);
        assert.equal(one("shoes", "sw_wings").speed, D.BASE.speed + 5 * D.TIER.legendary);
        assert.equal(one("top", "sh_dragon").hp, D.BASE.hp + 10 * D.TIER.legendary);
        assert.equal(one("bottom", "pa_shadow").def, 4 * D.TIER.epic);
        assert.equal(one("hat", "crown").crit, D.BASE.crit + 3 * D.TIER.epic);
        assert.equal(one("neck", "amulet").luck, 6 * D.TIER.epic);
    });
    test("never past the caps, however much you stack", () => {
        const all = { shoes: "sw_wings", top: "sh_dragon", bottom: "pa_shadow", hat: "ht_halo", glasses: "a_joystick", neck: "jackpot", eyes: "ey_dragon", mouth: "mo_stache", held: "blade" };
        const saved = JSON.parse(JSON.stringify(D.STATS_BY_SLOT));
        try {
            Object.values(D.STATS_BY_SLOT).forEach(o => Object.keys(o).forEach(k => { o[k] *= 100; })); // gear far past every cap
            ["def", "speed", "crit", "luck", "dmg", "mana"].forEach(k => { D.STATS_BY_SLOT.hat[k] = 1000; });
            const s = D.statsOf({ wear: all });
            Object.entries(D.CAPS).forEach(([k, cap]) => assert.equal(s[k], cap, `${k} stops at ${cap}`));
        } finally { Object.keys(saved).forEach(k => { D.STATS_BY_SLOT[k] = saved[k]; }); }
        const s = D.statsOf({ wear: all });
        Object.entries(D.CAPS).forEach(([k, cap]) => assert.ok(s[k] <= cap, `${k} ${s[k]} ≤ ${cap}`));
    });
    test("what you hold is your weapon (a sword swings, a staff casts, a bow shoots); a pet fights beside you", () => {
        assert.equal(D.statsOf({ wear: { held: "blade" } }).weapon, "sword");
        assert.equal(D.statsOf({ wear: { held: "hd_staff" } }).weapon, "staff");
        assert.equal(D.statsOf({ wear: { held: "hd_bow" } }).weapon, "bow");
        assert.equal(D.statsOf({ wear: { held: "torch" } }).weapon, "torch");
        assert.equal(D.statsOf({ wear: { held: "compass" } }).weapon, "sling", "anything else: the sling");
        const pet = D.statsOf({ wear: { pet: "dragon" } });
        assert.equal(pet.pet, "dragon"); assert.ok(pet.petDmg > 0);
        Object.values(D.HELD_WEAPON).forEach(w => assert.ok(D.WEAPONS[w], w));
    });
    test("🔷 mana runs out: only the sling is free; holding ⚔️ empties a bar in seconds, and it refills slowly", () => {
        assert.equal(D.WEAPONS.sling.mana, 0, "the sling: what you fall back on");
        Object.entries(D.WEAPONS).forEach(([k, w]) => {
            assert.ok(Number.isInteger(w.mana) && w.mana >= 0 && w.mana < 20, k);
            if (k === "sling") return;
            const perSec = w.rate * w.mana, lasts = D.BASE.mana / perSec;
            assert.ok(lasts >= 6 && lasts <= 25, `${k}: a full bar lasts ${lasts.toFixed(1)} s of holding ⚔️`);
            assert.ok(perSec > D.LOOT.manaRegen * 2.5, `${k}: spends far faster than it refills`);
        });
        assert.ok(D.LOOT.manaRegen <= 1 && D.LOOT.manaRegenDelay >= 1, "a slow refill, only after you stop attacking");
    });
    test("the weapons you can find are the game's troops' — the Lancer's lance, the Axe-Thrower's axes, the Bomber's bombs…", () => {
        assert.deepEqual(D.FIND_WEAPONS.map(k => D.WEAPONS[k].name), ["Lancer's Lance", "Axe-Thrower's Axes", "Bomber's Bombs", "Archer's Longbow", "Necromancer's Skull Staff", "Pyrotechnician's Rockets"]);
    });
});

describe("💰 loot", () => {
    test("what an enemy drops: gold always, 🔷 mana often, sometimes ✨, potions, 💗, a weapon — and, rarely, a 🪙", () => {
        const r = D.rng("t"), kinds = new Set();
        let gold = 0;
        for (let i = 0; i < 4000; i++) D.rollDrop("boneWarrior", r, 0).forEach(d => { kinds.add(d.kind); if (d.kind === "gold") gold++; });
        assert.ok(gold >= 4000, "at least a coin each");
        ["gold", "mana", "stardust", "potion", "manaPotion", "heart", "weapon", "token"].forEach(k => assert.ok(kinds.has(k), k));
    });
    test("crates and barrels: a little gold, often mana or a potion", () => {
        const r = D.rng("crate"), kinds = new Set();
        for (let i = 0; i < 500; i++) { const d = D.rollProp(r, 0); assert.ok(d.filter(x => x.kind === "gold").length >= 1); d.forEach(x => kinds.add(x.kind)); }
        ["gold", "potion", "manaPotion", "mana"].forEach(k => assert.ok(kinds.has(k), k));
    });
    test("luck (your necklace) brings more", () => {
        const count = (luck) => { const r = D.rng("luck"); let n = 0; for (let i = 0; i < 4000; i++) n += D.rollDrop("imp", r, luck).filter(d => d.kind !== "gold" && d.kind !== "mana").length; return n; };
        assert.ok(count(60) > count(0) * 1.3);
    });
    test("a boss: the big drops — gold, ✨, 🪙 and 💗, sometimes gear", () => {
        const r = D.rng("boss");
        const drop = D.rollBoss(r, 0), by = Object.fromEntries(drop.map(d => [d.kind, d.amount]));
        assert.ok(by.token >= D.LOOT.boss.tokens[0] && by.token <= D.LOOT.boss.tokens[1]);
        assert.ok(by.stardust >= D.LOOT.boss.stardust[0]);
        let gear = 0; for (let i = 0; i < 2000; i++) if (D.rollBoss(r, 0).some(d => d.kind === "gear")) gear++;
        assert.ok(gear > 200 && gear < 420, `about ${D.LOOT.boss.gearChance * 100}% (${gear / 20}%)`);
    });
});

describe("🎒 the Keep's things · 🔥 the furnace's fusions", () => {
    const I = D.ITEMS;
    test("every recipe uses real things, and makes one; chances between 0 and 1; no two recipes from the same pair; nothing makes slag on purpose", () => {
        const pairs = new Set();
        D.RECIPES.forEach(([a, b, out, p]) => {
            [a, b, out].forEach(id => assert.ok(I[id], id));
            assert.ok(p > 0 && p <= 1, `${out}: ${p}`);
            assert.ok(!I[out].junk && !I[a].junk && !I[b].junk, `${out}: slag's in no recipe`);
            const k = [a, b].sort().join("+");
            assert.ok(!pairs.has(k), "one recipe a pair: " + k); pairs.add(k);
        });
    });
    test("everything can be had: from what drops, grows and the shop sells, every recipe can be made in turn (slag: from a fusion that doesn't go)", () => {
        const drops = new Set(Object.values(D.MAT_DROPS).flat().map(x => x[0])), grows = new Set(D.ROADS.flatMap(r => D.REGIONS[r].zones.map(z => z.node))), made = new Set(D.RECIPES.map(r => r[2]));
        const have = new Set([...drops, ...grows, "hpPot", "mpPot"]);
        for (let more = true; more;) { more = false; D.RECIPES.forEach(([a, b, out]) => { if (have.has(a) && have.has(b) && !have.has(out)) { have.add(out); more = true; } }); }
        Object.entries(I).forEach(([id, it]) => {
            if (it.junk) assert.equal(D.fuse("bone", "frostHeart", () => 0).out, id, `${id}: what a bad pair makes`);
            else assert.ok(have.has(id), `${id} can be had`);
            if (it.kind === "mat" && !it.junk && !made.has(id)) assert.ok(drops.has(id) || grows.has(id), `${id} drops or grows`);
            if (it.kind !== "mat") assert.ok(made.has(id), `${id} is made in the furnace`);
            assert.ok(["common", "uncommon", "rare", "epic", "legendary"].includes(it.rarity), id);
            assert.ok(["mat", "potion", "gear", "bag"].includes(it.kind), id);
        });
        assert.equal(Object.values(I).filter(it => it.junk).length, 1, "one kind of junk");
        Object.keys(D.MAT_DROPS).forEach(k => assert.ok(D.ENEMIES[k] || D.BOSSES[k], k));
        D.BOSS_ORDER.forEach(b => assert.equal(D.MAT_DROPS[b][0][1], 1, `${b} always leaves its own`));
    });
    test("the better gear needs the lesser — up to legendaries, each from a boss's material", () => {
        const tier = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };
        D.RECIPES.forEach(([a, b, out]) => assert.ok(tier[I[out].rarity] >= Math.max(tier[I[a].rarity], tier[I[b].rarity]) - 1, out));
        const bossMats = D.BOSS_ORDER.map(b => D.MAT_DROPS[b][0][0]);
        assert.deepEqual(bossMats, ["captainJaw", "queenSilk", "sandCore", "frostHeart"]);
        Object.entries(I).filter(([, it]) => it.rarity === "legendary").forEach(([id]) => { const r = D.RECIPES.find(x => x[2] === id); assert.ok(bossMats.some(m => r.includes(m)), id + " needs a boss's"); });
    });
    test("🧪 two potions go together too: health + mana = a twin potion; two of a kind = a greater one", () => {
        assert.deepEqual(D.recipeFor("mpPot", "hpPot").slice(2), ["twinPot", 0.85]);
        assert.equal(D.recipeFor("hpPot", "hpPot")[2], "bigHp");
        assert.equal(D.recipeFor("mpPot", "mpPot")[2], "bigMp");
        assert.ok(I.twinPot.heal > 0 && I.twinPot.mana > 0, "the twin does both");
        assert.ok(I.bigMp.mana > I.mpPot.mana);
    });
    test("fuse: works under its chance, fails above it; a pair with no recipe always makes 🪨 slag (either way round)", () => {
        assert.deepEqual(D.fuse("bone", "iron", () => 0.79), { ok: true, out: "bonePlate", chance: 0.8 });
        assert.deepEqual(D.fuse("iron", "bone", () => 0.79), { ok: true, out: "bonePlate", chance: 0.8 });
        assert.deepEqual(D.fuse("bone", "iron", () => 0.8), { ok: false, chance: 0.8 });
        assert.deepEqual(D.fuse("mpPot", "fang", () => 0), { ok: true, out: "slag", junk: true });
        assert.deepEqual(D.fuse("fang", "mpPot", () => 0.99), { ok: true, out: "slag", junk: true });
        let n = 0; const r = D.rng("fuse"); for (let i = 0; i < 4000; i++) if (D.fuse("silkBow", "frost", r).ok) n++;
        assert.ok(Math.abs(n / 4000 - 0.45) < 0.03, `about 45% (${n / 40}%)`);
    });
    test("gear: on top of your outfit, a gear weapon is your weapon, never past the caps", () => {
        const base = D.statsOf({ wear: {} });
        const s = D.gearStats(base, { weapon: "ironMace", armour: "chainShirt", charm: "fangCharm" });
        assert.deepEqual([s.weapon, s.dmg, s.def, s.hp, s.luck], ["sword", base.dmg + 20, base.def + 8, base.hp + 15, base.luck + 10]);
        assert.equal(D.gearStats(base, { weapon: "chainShirt" }).weapon, base.weapon, "armour in the weapon slot does nothing");
        assert.equal(D.gearStats(base, { charm: "nope" }).luck, base.luck);
        const max = D.gearStats({ ...base, dmg: 55 }, { weapon: "queenBow", charm: "phoenixCharm" });
        assert.equal(max.dmg, D.CAPS.dmg);
    });
    test("a material drops as often as its chance (luck brings more); a boss's own, every time", () => {
        const r = D.rng("mats"); let n = 0; for (let i = 0; i < 4000; i++) n += D.rollMats("ironGuard", r, 0).length;
        assert.ok(Math.abs(n / 4000 - 0.4) < 0.03, `${n / 40}%`);
        const r2 = D.rng("mats"); let m = 0; for (let i = 0; i < 4000; i++) m += D.rollMats("ironGuard", r2, 50).length;
        assert.ok(m > n * 1.3);
        assert.deepEqual(D.rollMats("kalidor", () => 0.999, 0), ["sandCore"]);
        assert.deepEqual(D.rollMats("rattlebones", () => 0.999, 0), ["captainJaw"]);
        assert.deepEqual(D.rollMats("nobody", () => 0, 0), []);
    });
});

describe("⬆️ gear levels · 📜 recipes you find", () => {
    test("rarer gear goes higher: Lv 5 common … Lv 20 legendary; only gear has levels", () => {
        assert.deepEqual(["boneClub", "fangDagger", "ironMace", "frostBow", "queenBow"].map(D.levelCap), [5, 8, 12, 16, 20]);
        assert.equal(D.levelCap("bone"), 1); assert.equal(D.levelCap("nope"), 1);
        Object.entries(D.ITEMS).filter(([, it]) => it.kind === "gear").forEach(([id, it]) => assert.equal(D.levelCap(id), D.LEVELS.cap[it.rarity], id));
    });
    test("XP from what you beat while wearing it: levels up, stops at the cap", () => {
        const e = D.gearEntry("boneClub");
        assert.deepEqual(e, { id: "boneClub", lv: 1, xp: 0 }, "a plain id (an old save) → Lv 1");
        assert.equal(D.addXp(e, D.xpToNext(1) - 1), 0); assert.equal(e.lv, 1);
        assert.equal(D.addXp(e, 1), 1); assert.deepEqual([e.lv, e.xp], [2, 0]);
        assert.equal(D.addXp(e, 1e6), 3, "Lv 2 → 5, the cap"); assert.deepEqual([e.lv, e.xp], [5, 0]);
        assert.equal(D.addXp(e, 100), 0, "no more past the cap");
        assert.ok(D.LEVELS.xp.boss > D.LEVELS.xp.elite && D.LEVELS.xp.elite > D.LEVELS.xp.enemy && D.LEVELS.xp.enemy > 0);
        assert.ok(D.xpToNext(5) > D.xpToNext(1), "each level takes more");
    });
    test("a level adds 6% to a piece's stats — your stats with it on follow", () => {
        assert.deepEqual(D.gearAdd("ironMace", 1), { dmg: 20 });
        assert.deepEqual(D.gearAdd("ironMace", 11), { dmg: 32 });
        assert.deepEqual(D.gearAdd("ironMace", 99), D.gearAdd("ironMace", 12), "never past its cap");
        const base = D.statsOf({ wear: {} });
        assert.equal(D.gearStats(base, { weapon: { id: "ironMace", lv: 11 } }).dmg, base.dmg + 32);
        assert.equal(D.gearStats(base, { weapon: "ironMace" }).dmg, base.dmg + 20, "an old save's plain id still works");
        assert.equal(D.gearStats(base, { weapon: { id: "chainShirt", lv: 5 } }).dmg, base.dmg, "in the wrong slot: nothing");
    });
    test("🔥 levelled gear fuses with a better chance (+2% a level past 1), never past 95%, never below the recipe's", () => {
        assert.ok(Math.abs(D.levelBonus(1, 1)) < 1e-12); assert.ok(Math.abs(D.levelBonus(4, 3) - 0.1) < 1e-12); assert.ok(Math.abs(D.levelBonus() - 0) < 1e-12);
        const rec = D.recipeFor("ironMace", "ironIngot");
        assert.equal(D.fuseChance(rec, 0), rec[3]); assert.ok(Math.abs(D.fuseChance(rec, 0.1) - (rec[3] + 0.1)) < 1e-12);
        assert.equal(D.fuseChance(rec, 5), 0.95); assert.equal(D.fuseChance(rec, -1), rec[3]);
        assert.deepEqual(D.fuse("ironMace", "ironIngot", () => rec[3] + 0.05, 0.1), { ok: true, out: "steelMace", chance: rec[3] + 0.1 });
        assert.equal(D.fuse("ironMace", "ironIngot", () => rec[3] + 0.05).ok, false, "without the levels: it fails");
    });
    test("a failure: gear drops a level (Lv 1 breaks); anything else is lost — and what's made starts at half the best level in", () => {
        assert.deepEqual(D.afterFail({ id: "ironMace", lv: 4, xp: 30 }), { id: "ironMace", lv: 3, xp: 0 });
        assert.equal(D.afterFail({ id: "ironMace", lv: 1 }), null);
        assert.equal(D.afterFail({ id: "bone" }), null); assert.equal(D.afterFail(null), null);
        assert.equal(D.startLevel("steelMace", []), 1); assert.equal(D.startLevel("steelMace", [1, 1]), 1);
        assert.equal(D.startLevel("steelMace", [7]), 4); assert.equal(D.startLevel("boneClub", [12]), 5, "never past the new piece's cap");
    });
    test("🎒 gear in the bag keeps its level; to the chest and back too", () => {
        const b = D.cleanBag({}), c = D.cleanBag({ slots: 40 });
        D.bagAdd(b, "ironMace", 1, { lv: 6, xp: 10 }); D.bagAdd(b, "ironMace"); D.bagAdd(b, "bone", 12);
        assert.deepEqual(b.items.filter(x => x.id === "ironMace").map(x => x.lv), [6, 1]);
        assert.equal(D.bagMoveAll(b, c, "ironMace"), 2); assert.equal(D.bagMoveAll(b, c, "bone"), 12);
        assert.deepEqual(c.items, [{ n: 1, id: "ironMace", lv: 6, xp: 10 }, { n: 1, id: "ironMace", lv: 1, xp: 0 }, { id: "bone", n: 10 }, { id: "bone", n: 2 }]);
        assert.deepEqual(b.items, []);
        const full = D.cleanBag({}); for (let i = 0; i < 20; i++) D.bagAdd(full, "boneClub");
        assert.equal(D.bagMoveAll(c, full, "ironMace"), 0, "no room: nothing moves, nothing's lost"); assert.equal(D.bagCount(c, "ironMace"), 2);
        assert.equal(D.sellPrice("ironMace", 5), Math.round(D.SELL.gear.rare * 2), "a levelled piece sells for more");
    });
    test("📜 a recipe drops now and then (a boss always has one) — one you don't know, the commoner more often", () => {
        const kinds = (f, n) => { const r = D.rng("rec"); let k = 0; for (let i = 0; i < n; i++) k += f(r).filter(d => d.kind === "recipe").length; return k / n; };
        const e = kinds(r => D.rollDrop("imp", r, 0), 8000), p = kinds(r => D.rollProp(r, 0), 8000);
        assert.equal(D.LOOT.enemy.recipe, 0.025, "a monster: 1 in 40"); assert.equal(D.LOOT.prop.recipe, 0.05, "a crate: 1 in 20");
        assert.ok(Math.abs(e - 0.025) < 0.01, `a monster: ${e}`); assert.ok(Math.abs(p - 0.05) < 0.012, `a crate: ${p}`);
        assert.ok([1, 2, 3].every(i => D.rollBoss(D.rng("b" + i), 0).some(d => d.kind === "recipe")), "a boss: always");
        const outs = [...new Set(D.RECIPES.map(r => r[2]))], allBut = Object.fromEntries(outs.filter(x => x !== "ironMace").map(x => [x, true]));
        assert.equal(D.recipeToLearn(allBut, Math.random), "ironMace", "only the one you don't know");
        assert.equal(D.recipeToLearn(Object.fromEntries(outs.map(x => [x, true])), Math.random), null, "you know them all");
        const r = D.rng("learn"), by = {}; for (let i = 0; i < 6000; i++) { const id = D.recipeToLearn({}, r); by[D.ITEMS[id].rarity] = (by[D.ITEMS[id].rarity] || 0) + 1; }
        const per = (k) => by[k] / outs.filter(x => D.ITEMS[x].rarity === k).length;
        assert.ok(per("common") > per("rare") && per("rare") > per("legendary"), JSON.stringify(by));
    });
    test("lots to make: 60+ recipes, every kind of weapon among them", () => {
        assert.ok(D.RECIPES.length >= 60, D.RECIPES.length);
        const kinds = new Set(Object.values(D.ITEMS).filter(it => it.weapon).map(it => it.weapon));
        ["sword", "bow", "staff", "torch", "lance", "axes", "bombs", "longbow", "skulls", "rocket"].forEach(k => assert.ok(kinds.has(k), k));
        Object.values(D.ITEMS).filter(it => it.weapon).forEach(it => assert.ok(D.WEAPONS[it.weapon], it.name));
    });
});

describe("⭐ your level", () => {
    test("30 × your level to the next; up to Lv 30; an odd save is cleaned", () => {
        assert.equal(D.HERO.cap, 30); assert.equal(D.heroNext(1), 30); assert.equal(D.heroNext(10), 300);
        assert.deepEqual(D.heroEntry(undefined), { lv: 1, xp: 0 });
        assert.deepEqual(D.heroEntry({ lv: 99, xp: 50 }), { lv: 30, xp: 0 }, "past the top: Lv 30");
        assert.deepEqual(D.heroEntry({ lv: 2.7, xp: 1e9 }), { lv: 2, xp: 59 }, "XP below the next level");
        assert.deepEqual(D.heroEntry({ lv: -3, xp: -5 }), { lv: 1, xp: 0 });
        assert.deepEqual(D.heroEntry({ lv: "x", xp: "y" }), { lv: 1, xp: 0 });
    });
    test("XP: levels up (more than one at once), keeps what's over, stops at Lv 30", () => {
        const e = { lv: 1, xp: 0 };
        assert.equal(D.heroXp(e, 29), 0); assert.deepEqual(e, { lv: 1, xp: 29 });
        assert.equal(D.heroXp(e, 1), 1); assert.deepEqual(e, { lv: 2, xp: 0 });
        assert.equal(D.heroXp(e, 60 + 90 + 5), 2); assert.deepEqual(e, { lv: 4, xp: 5 }, "60 to Lv 3, 90 to Lv 4, 5 over");
        const top = { lv: 29, xp: 0 }; assert.equal(D.heroXp(top, 1e6), 1); assert.deepEqual(top, { lv: 30, xp: 0 });
        assert.equal(D.heroXp(top, 500), 0); assert.deepEqual(top, { lv: 30, xp: 0 });
        assert.equal(D.heroXp({ lv: 1, xp: 0 }, -50), 0, "no XP taken away");
        // a monster is 4, an elite 25, a boss 120: Lv 2 after 8 monsters
        const k = { lv: 1, xp: 0 }; for (let i = 0; i < 8; i++) D.heroXp(k, D.LEVELS.xp.enemy); assert.equal(k.lv, 2);
    });
    test("each level: +3 ❤️, +2 🔷, +1% ⚔️; +1% 🛡️ every 2, +1% 🎯 every 3 — on top of your gear, the caps still hold", () => {
        assert.deepEqual(D.heroAdd(1), { hp: 0, mana: 0, dmg: 0, def: 0, crit: 0 });
        assert.deepEqual(D.heroAdd(2), { hp: 3, mana: 2, dmg: 1, def: 0, crit: 0 });
        assert.deepEqual(D.heroAdd(7), { hp: 18, mana: 12, dmg: 6, def: 3, crit: 2 });
        assert.deepEqual(D.heroAdd(30), { hp: 87, mana: 58, dmg: 29, def: 14, crit: 9 });
        assert.deepEqual(D.heroAdd(99), D.heroAdd(30)); assert.deepEqual(D.heroAdd(0), D.heroAdd(1));
        const base = D.statsOf({ wear: {} }), s = D.heroStats(base, 7);
        assert.equal(s.hp, base.hp + 18); assert.equal(s.mana, base.mana + 12); assert.equal(s.dmg, base.dmg + 6); assert.equal(s.def, base.def + 3); assert.equal(s.crit, base.crit + 2);
        assert.equal(s.speed, base.speed); assert.equal(s.luck, base.luck); assert.equal(s.weapon, base.weapon, "your weapon's your gear's");
        assert.deepEqual(D.heroStats(base, 1), base, "Lv 1 adds nothing");
        const capped = D.heroStats({ ...base, dmg: 55, def: 44, mana: 210 }, 30);
        assert.equal(capped.dmg, D.CAPS.dmg); assert.equal(capped.def, D.CAPS.def); assert.equal(capped.mana, D.CAPS.mana);
        assert.equal(D.heroStats(D.gearStats(base, { weapon: "ironMace" }), 5).dmg, base.dmg + 20 + 4, "gear, then your level");
    });
});

describe("💰 selling to the shop", () => {
    test("rarer pays more; gear more than materials; slag is worth 1 🔶; anything else, nothing", () => {
        const kinds = ["mat", "potion", "gear", "bag"], rar = ["common", "uncommon", "rare", "epic", "legendary"];
        kinds.forEach(k => rar.forEach((r, i) => { if (i) assert.ok(D.SELL[k][r] > D.SELL[k][rar[i - 1]], `${k} ${r}`); }));
        rar.forEach(r => assert.ok(D.SELL.gear[r] > D.SELL.mat[r], r));
        Object.keys(D.ITEMS).forEach(id => { const p = D.sellPrice(id); assert.ok(Number.isInteger(p) && p >= 1, id); });
        assert.equal(D.sellPrice("slag"), 1);
        assert.equal(D.sellPrice("bone"), D.SELL.mat[D.ITEMS.bone.rarity]);
        assert.equal(D.sellPrice("boneReaver"), D.SELL.gear.legendary);
        ["nope", "__proto__", "constructor", "toString", ""].forEach(id => assert.equal(D.sellPrice(id), 0, `"${id}"`));
    });

});

describe("🎒 the bag", () => {
    test("20 slots to start; materials and potions stack 10 a slot; gear one a slot", () => {
        const b = D.cleanBag({});
        assert.equal(b.slots, 20);
        assert.equal(D.bagAdd(b, "bone", 25), 25);
        assert.deepEqual(b.items, [{ id: "bone", n: 10 }, { id: "bone", n: 10 }, { id: "bone", n: 5 }]);
        assert.equal(D.bagAdd(b, "bone", 3), 3, "tops up the last stack first");
        assert.equal(b.items.length, 3);
        assert.equal(D.bagAdd(b, "ironMace", 2), 2);
        assert.equal(b.items.length, 5, "gear doesn't stack");
    });
    test("a full bag: a new kind doesn't fit (it says how many went in); one that stacks on yours still does", () => {
        const b = D.cleanBag({});
        for (let i = 0; i < 19; i++) D.bagAdd(b, "boneClub");
        D.bagAdd(b, "herb", 4);
        assert.equal(b.items.length, 20);
        assert.ok(D.bagFull(b, "silk") && !D.bagFull(b, "herb"));
        assert.equal(D.bagAdd(b, "silk", 1), 0);
        assert.equal(D.bagAdd(b, "herb", 9), 6, "only what fits: 4 → 10");
    });
    test("taking out is all or nothing, and empties slots", () => {
        const b = D.cleanBag({}); D.bagAdd(b, "silk", 12);
        assert.equal(D.bagTake(b, "silk", 13), false);
        assert.equal(D.bagCount(b, "silk"), 12);
        assert.equal(D.bagTake(b, "silk", 12), true);
        assert.deepEqual(b.items, []);
    });
    test("a saved bag is cleaned: unknown things dropped, stacks capped, slots 20–50", () => {
        const b = D.cleanBag({ slots: 999, items: [{ id: "bone", n: 99 }, { id: "zzz", n: 1 }, { id: "__proto__", n: 1 }, { id: "ironMace", n: 5 }, null] });
        assert.equal(b.slots, D.BAG.max);
        assert.deepEqual(b.items, [{ id: "bone", n: 10 }, { n: 1, id: "ironMace", lv: 1, xp: 0 }]);
        assert.equal(D.cleanBag({ slots: 3 }).slots, 20);
        assert.deepEqual(D.cleanBag({ items: [{ id: "boneClub", n: 3, lv: 99, xp: 9999 }, { id: "ironMace", n: 1, lv: 3, xp: 9999 }, { id: "ironMace", n: 1, lv: "x" }] }).items,
            [{ n: 1, id: "boneClub", lv: 5, xp: 0 }, { n: 1, id: "ironMace", lv: 3, xp: 59 }, { n: 1, id: "ironMace", lv: 1, xp: 0 }], "levels kept, but never past the cap");
    });
});

describe("🏰 the page", () => {
    const page = read("dungeon.html");
    const between = (a, b) => { const i = page.indexOf(a), j = page.indexOf(b, i); assert.ok(i >= 0 && j > i, `${a} … ${b}`); return page.slice(i, j); };
    test("every script on the page parses", () => {
        const vm = require("vm"), scripts = page.split("<script>").slice(1).map(x => x.split("</script>")[0]); // (the inline ones)
        assert.ok(scripts.length >= 1 && scripts.some(x => x.includes("window.KeepDebug")));
        scripts.forEach((src, i) => assert.doesNotThrow(() => new vm.Script(src, { filename: `dungeon.html <script> ${i + 1}` })));
    });
    test("drawn from the rules: your outfit and gear, each road's map, the loot rolls, mana", () => {
        assert.match(page, /<script src="dungeon-core\.js"><\/script>/);
        assert.match(page, /stats = withBuffs\(baseStats\(outfit, gear\(\)\), runBuffs\);/, "your outfit, then your Keep gear on top, your level, then the shop's tonics");
        assert.match(page, /const baseStats = \(o, g\) => D\.heroStats\(D\.gearStats\(D\.statsOf\(o\), g\), hero\(\)\.lv\);/);
        assert.ok(!/D\.gearStats\(D\.statsOf\(/.test(page.replace("const baseStats = (o, g) => D.heroStats(D.gearStats(D.statsOf(o), g), hero().lv);", "")), "every stat sum goes through baseStats (so your level counts everywhere)");
        assert.match(page, /M = D\.regionMap\(road\);/);
        assert.match(page, /M\.props\.forEach\(o => \{ const p = W2\(o\.x, o\.y\), P = D\.PROPS\[o\.kind\]; G\.enemies\.push\(\{ prop: true, kind: o\.kind,/, "📦 the road's crates and barrels");
        assert.match(page, /G\.things\.push\(\{ kind: "fire", x: camp\.x, y: camp\.y, benches: true \}, \{ kind: "merchant", x: camp\.x \+ 40, y: camp\.y - 4 \}\);/, "🔥 a camp fire by the gate, 🧙 a merchant beside it");
        assert.match(page, /z = D\.zoneAt\(G\.wild\.road, G\.player\.y - G\.wild\.oy\)/);
        assert.match(page, /D\.rollDrop\(e\.type, rnd, stats\.luck\)/);
        assert.match(page, /D\.rollProp\(rnd, stats\.luck\)/);
        assert.match(page, /D\.rollBoss\(rnd, stats\.luck\)/);
        assert.match(page, /if \(G\.time - \(p\.lastAtk \|\| -99\) > D\.LOOT\.manaRegenDelay\) p\.mana = Math\.min\(p\.maxMana, p\.mana \+ D\.LOOT\.manaRegen \* dt\);/, "mana refills only once you stop attacking");
        ["D.chapterStage", "D.dailyStage", "D.endlessFloor", "D.starsFor", "D.wildsMap"].forEach(f => assert.ok(!page.includes(f), `no ${f} — the dungeon's gone`));
    });
    test("progress is per player; names in a conversation are escaped; it says plainly it's an early version", () => {
        assert.match(page, /const SAVE_KEY = \(\) => "kih_keep_v1:" \+ uid;/);
        assert.match(page, /box\.innerHTML = `<b>\$\{esc\(who\)\}<\/b><p>\$\{esc\(text\)\}<\/p>/);
        assert.match(page, /<div class="tag demo" id="demoTag">🧪 Demo — still being built<\/div>/, "🧪 always on screen: it's a demo");
        assert.match(page, /<p class="demo-note">🧪 <b>This is a demo<\/b> — The Keep is still being built/, "…and the ☰ menu says so");
        assert.match(page, /This is a demo — The Keep is still being built\. What you pick up stays in the Keep for now — ✨ 💗 🪙 aren't added to your account yet \(but each new rare or better thing for your 📖 collection is \+\$\{D\.FIND_TOKENS\} 🪙 in your account/);
    });
    test("🏘️ it opens in Hearthmoor: four gates, the shop, the wardrobe, your house, the Elder — each asks ✅ Yes / No", () => {
        assert.match(page, /makeHeroImg\(\); startLobby\(\); loadMe\(\);/);
        const st = between("const STATIONS = [", "];");
        assert.deepEqual([...st.matchAll(/\{ id: "(\w+)", (?:road: "(\w+)"|icon)/g)].map(m => m[1]), ["north", "south", "west", "east", "shop", "wardrobe", "house", "elder"]);
        [...st.matchAll(/\{ id: "(\w+)", road: "(\w+)"/g)].forEach(m => assert.equal(m[1], m[2], "a gate leads to its own road"));
        assert.match(page, /<button type="button" class="sel" id="promptYes" data-v="yes">✅ Yes<\/button><button type="button" id="promptNo" data-v="no">✖ No<\/button><\/div><small><kbd>←<\/kbd> <kbd>→<\/kbd> choose · <kbd>Space<\/kbd> picks · or tap ⚔️<\/small>/);
        assert.match(page, /if \(\["ArrowLeft", "ArrowRight", "KeyA", "KeyD"\]\.includes\(code\)\) \{ if \(!e\.repeat\) setSel\(G\.promptSel === "no" \? "yes" : "no"\);/, "← → switch Yes / No");
        assert.match(page, /if \(code === "Enter" \|\| \(\(code === "Space" \|\| code === "KeyE"\) && promptSafe\(\)\)\) \{ if \(!e\.repeat\) confirmPrompt\(\);/, "Enter picks; Space too — unless something's attacking you");
        assert.match(page, /const promptSafe = \(\) => \(near && near\.kind === "exit"\) \|\|/, "the gate home always works");
        assert.match(page, /\$\("promptText"\)\.textContent = promptFor\(t\)/, "the question is text, never markup");
    });
    test("📜 the story: the Elder tells it the first time; a road's barred till the one before is cleared", () => {
        assert.match(page, /if \(!story\(\)\.seen\.intro\) \{[^\n]*\n\s*const intro = \(\) => \{ if \(!me\.loaded\) return setTimeout\(intro, 200\); if \(!story\(\)\.seen\.intro && G && plan\.mode === "lobby" && \$\("sheet"\)\.hidden\) \{ story\(\)\.seen\.intro = true; writeSave\(save\); storyTalk\(STORY1\.intro\); \} \};\s*setTimeout\(intro, 700\);/);
        assert.match(page, /const roadOpen = \(road\) => D\.roadOpen\(story\(\)\.cleared, road\);/);
        assert.match(between("function joinRoad(road) {", "function playRoad"), /if \(!roadOpen\(road\)\) \{ [^\n]*return openSheet\(/, "barred: it says so, and you can't set out");
        assert.match(page, /if \(st && st\.road\) return joinRoad\(st\.road\);/);
    });
    test("👑 each road's boss waits in its lair: walk in and the fight's on, run off and it falls back; beat it and the story moves on (once)", () => {
        assert.match(page, /if \(!G\.boss && !G\.lairDone && d < lair\.r \* 0\.7\) startBoss\(lair\);/);
        assert.match(page, /else if \(G\.boss && d > lair\.r \+ 190\) \{/);
        const down = between("function bossDown(b) {", "function bossThink");
        assert.match(down, /const road = G\.wild\.road, first = !story\(\)\.cleared\[road\];\s*story\(\)\.cleared\[road\] = true; writeSave\(save\);/);
        assert.match(down, /if \(first\) setTimeout\(\(\) => \{ if \(G && !G\.over\) storyTalk\(STORY1\.beats\[road\]\.after, road === "north" \? \(\) => storyTalk\(STORY1\.end\) : null\); \}, 1300\);/, "the clue — and after the north road, the end");
    });
    test("🏠 your house: the furnace fuses, the chest keeps 40 slots, the bed heals, the door goes back out", () => {
        const os = between("function openStation(id) {", "\n    }\n");
        assert.match(os, /if \(id === "house"\) return startRun\(\{ mode: "house"/);
        assert.match(os, /if \(id === "furnace"\) return openPanel\("fusion"\);/);
        assert.match(os, /if \(id === "storage"\) return openPanel\("storage"\);/);
        assert.match(os, /if \(id === "bed"\) \{ const p = G\.player; p\.hp = p\.maxHp; p\.mana = p\.maxMana;/);
        assert.match(os, /if \(id === "door"\) return startLobby\("house"\);/);
        assert.match(page, /save\.chest = D\.cleanBag\(\{ slots: 40, \.\.\.\(save\.chest \|\| \{\}\) \}\); save\.chest\.slots = 40;/);
        assert.match(between("function moveStack(to, id) {", "function renderStorage"), /const went = D\.bagMoveAll\(from, dest, id\);/, "only what fits moves — gear keeps its level, nothing's lost");
    });
    test("🛒 the shop and 🪞 the wardrobe are your account's: the Store's prices, bought and worn through the server", () => {
        assert.match(page, /const r = await window\.AppState\.buyItem\(id, deal\);/);
        assert.match(page, /const r = await window\.AppState\.saveOutfit\(next\);/);
        assert.match(page, /const t = thing\(id\), day = sgtDay\(\), deal = P\.dealPrice\(id, day\), price = deal \|\| P\.buyPrice\(id\);/);
        assert.match(page, /const wearing = \(slot, id\) => C\.cleanOutfit\(\{ base: outfit\.base, wear: \{ \.\.\.outfit\.wear, \[slot\]: id \|\| undefined \} \}, me\.items\);/, "only what you own");
    });
    test("💰 the Sell tab: only what's in your Keep bag, for 🔶 — never the Store's things, never ✨", () => {
        assert.match(page, /if \(shopTab === "sell"\) \{ \/\/ what's in your bag, and what the shop pays for one\s*const b = inv\(\), ids = \[\.\.\.new Set\(b\.items\.filter\(x => !D\.isGear\(x\.id\)\)\.map\(x => x\.id\)\)\];/);
        assert.match(page, /if \(x && D\.isGear\(x\.id\)\) \{ bag\.items\.splice\(\+b\.dataset\.sellbi, 1\); save\.gold = gold\(\) \+ D\.sellPrice\(x\.id, x\.lv\);/, "a piece of gear: sold at its level");
        assert.match(page, /if \(shopTab !== "sell"\) shopTab = "supplies";\s*const tabs = \[\["supplies", "🧪 Supplies"\], \["sell", "💰 Sell"\]\];/, "the shop: supplies and selling (the Store's things are in the wardrobe)");
        assert.match(page, /if \(D\.bagTake\(inv\(\), id, n\)\) \{ save\.gold = gold\(\) \+ D\.sellPrice\(id\) \* n; writeSave\(save\);/, "paid only for what came out of the bag");
    });
    test("🧪 supplies cost 🔶 shards, never ✨, and sell back for less; the fountain gives back fewer shards than it takes", () => {
        assert.match(page, /save\.gold = gold\(\) \+ Math\.max\(0, G\.loot\.gold\); writeSave\(save\);/, "the shards you find are kept");
        const sup = [...page.matchAll(/\{ id: "(\w+)", icon: "[^"]+", name: "[^"]+", desc: "[^"]+", price: (\d+)/g)].map(m => [m[1], +m[2]]);
        assert.deepEqual(sup.map(x => x[0]), ["hpPot", "mpPot", "might", "iron", "swift", "lucky"]);
        sup.forEach(([id, p]) => { assert.ok(p >= 20 && p <= 100, id); if (D.ITEMS[id]) assert.ok(D.sellPrice(id) < p, `${id}: buy ${p}, sell ${D.sellPrice(id)} — no money machine`); });
        const wishes = [...page.matchAll(/\{ p: ([\d.]+)(?:, gold: (\d+))?/g)].map(m => [+m[1], +(m[2] || 0)]);
        assert.ok(Math.abs(wishes.reduce((a, w) => a + w[0], 0) - 1) < 1e-9, "the chances add up to 1");
        assert.ok(wishes.reduce((a, w) => a + w[0] * w[1], 0) < 10, "a 10 🔶 toss gives back less than 10 🔶 on average");
        assert.doesNotMatch(between("function tossCoin", "// 🧭 the guide"), /stardust|AppState/, "the fountain never touches ✨ or your account");
    });
    test("🔶 the Keep's money is shards — never a coin that looks like the app's 🪙", () => {
        assert.ok(!page.includes("🟡"), "no 🟡 coins anywhere");
        assert.match(page, /if \(k\.kind === "gold"\) return shard\(k\.x, k\.y \+ bob, 3\.4\);/, "a shard on the floor is drawn as one");
        assert.match(page, /🔶 Shards are the Keep's own money \(not the app's 🪙 tokens\)/);
    });
    test("a weapon is shown side by side with yours before you equip it (bought, or off the floor)", () => {
        assert.match(page, /if \(t\.kind === "weapon"\) return offerWeapon\(t, "floor"\);/);
        assert.match(page, /offerWeapon\(pk, "bought"\);/);
        assert.match(page, /\$\{weaponCard\(G\.weapon, "Yours now", null, false\)\}\$\{weaponCard\(pickup\.weapon, "New", G\.weapon, true\)\}/);
    });
    test("🎒 the bag's on B and the 🎒 button; what you find goes in it — potions too (left on the ground if it's full)", () => {
        assert.match(page, /if \(e\.code === "KeyB" && running && !paused && !e\.repeat\) openPanel\("bag"\);/);
        assert.match(page, /<button type="button" class="hud-btn" id="bagBtn"/);
        assert.match(page, /D\.rollMats\(e\.type, rnd, stats\.luck\)\.forEach\(id => dropAt\(e\.x, e\.y, \{ kind: "mat", id \}\)\)/);
        assert.match(page, /it\.kind === "potion" \? potionSvg\(it\.color, sz\)/, "potions are drawn as bottles");
        assert.match(page, /if \(\(k\.kind === "potion" \|\| k\.kind === "manaPotion"\) && D\.bagFull\(inv\(\), k\.kind === "potion" \? "hpPot" : "mpPot"\)\) continue;/);
        assert.match(page, /else if \(k\.kind === "potion" \|\| k\.kind === "manaPotion"\) \{ const id = k\.kind === "potion" \? "hpPot" : "mpPot"; if \(gainItem\(id\)\)/);
    });
    test("🔥 the furnace: ⚠️ asks first (what a failure costs), takes both, rolls (levelled gear: a better chance), then empties; a failure knocks gear a level down", () => {
        assert.match(page, /if \(b\.id === "fuseGo"\) return askFuse\(\);/, "🔥 Fuse asks first");
        assert.match(page, /\[\{ label: "🔥 Fuse", main: true, id: "fuseSure", go: \(\) => \{ closeSheet\(\); doFuse\(\); \} \}, NOT_NOW\]/);
        assert.match(page, /<div class="warn-box">⚠️ <b>Fusing can fail\.<\/b>/, "always said up front");
        const df = between("function doFuse() {", "// 📖 the collection");
        assert.match(df, /const ea = take\(a\), ec = take\(c\);\s*fuseA = fuseB = null;/, "both taken, the furnace emptied");
        assert.match(df, /const res = D\.fuse\(ea\.id, ec\.id, fuseRoll, D\.levelBonus\(\.\.\.lvs\)\);/);
        assert.match(df, /const after = !res\.ok \|\| res\.junk \? \[ea, ec\]\.map\(e => \{ const back = D\.afterFail\(e\); if \(back\) D\.bagAdd\(b, back\.id, 1, back\);/);
        assert.match(df, /const newLv = res\.ok && !res\.junk && D\.isGear\(res\.out\) \? D\.startLevel\(res\.out, lvs\) : 1;/, "made gear starts at half the best level in");
        assert.match(df, /if \(res\.ok\) gainItem\(res\.out, 1, \{ lv: newLv \}\); else writeSave\(save\);/);
    });
    test("⬆️ what you beat grows the gear you wear; 📜 a recipe on the ground teaches one; every potion drinks itself", () => {
        assert.match(between("function killEnemy(e) {", "function dropAt"), /const xp = e\.boss \? D\.LEVELS\.xp\.boss : e\.elite \? D\.LEVELS\.xp\.elite : D\.LEVELS\.xp\.enemy;\s*gearXp\(xp\); heroGain\(xp\);[^\n]*\n\s*if \(e\.boss\) return bossDown\(e\);/);
        assert.match(page, /worn\.forEach\(e => \{ if \(D\.addXp\(e, n\)\) up = e; \}\);\s*writeSave\(save\);/);
        assert.match(page, /else if \(k\.kind === "recipe"\) \{ [^}]*learnRecipe\(\); \}/);
        assert.match(page, /const id = D\.recipeToLearn\(Object\.fromEntries\(D\.RECIPES\.map\(r => \[r\[2\], known\(r\[2\]\)\]\)\), rnd\);/);
        assert.match(page, /const potFor = \(k\) => Object\.keys\(D\.ITEMS\)\.filter\(id => D\.ITEMS\[id\]\.kind === "potion" && D\.ITEMS\[id\]\[k\] && D\.bagCount\(b, id\)\)/);
        assert.match(page, /stats = withBuffs\(baseStats\(outfit, gear\(\)\), \(G && G\.buffs\) \|\| \[\]\);\s*if \(!G \|\| !plan\) return;\s*const p = G\.player, home = plan\.mode === "lobby" \|\| plan\.mode === "house";/, "a level-up mid-run keeps your elixirs (and your HP as it is)");
        assert.match(page, /const intro = \(\) => \{ if \(!me\.loaded\) return setTimeout\(intro, 200\); if \(!story\(\)\.seen\.intro && /, "the intro waits for your account (or it's remembered in the guest's save)");
        // 🪙 for a new find: asked of the server (once per thing), on a find and on signing in
        assert.match(page, /const isNew = !seen\(\)\[id\];\s*seen\(\)\[id\] = true;\s*if \(isNew && D\.findPays\(id\)\) setTimeout\(payFinds, 0\);/);
        assert.match(page, /ids = Object\.keys\(seen\(\)\)\.filter\(id => D\.findPays\(id\) && !coined\(\)\[id\]\)/, "only rare-or-better finds are asked for");
        assert.match(page, /emoji\(t\.open \? "📭" : "🧰"/, "an opened crate is an empty box, not a 🪙");
        assert.ok(!/emoji\(t\.open \? "🪙"/.test(page));
        assert.match(page, /me\.signedIn = true;\s*setTimeout\(payFinds, 0\);/);
        assert.match(page, /if \(!me\.signedIn \|\| paying \|\| !window\.AppState \|\| !window\.AppState\.keepFinds\) return;/, "a guest's never asked; one at a time");
        assert.match(page, /\(r\.found \|\| \[\]\)\.forEach\(id => \{ coined\(\)\[id\] = true; \}\);/, "what the server's paid is remembered (not asked again)");
        assert.match(page, /const hero = \(\) => \(save\.hero = D\.heroEntry\(save\.hero\)\);/, "⭐ your level, kept in your save");
        assert.match(page, /const h = hero\(\), was = h\.lv, ups = D\.heroXp\(h, n\);\s*writeSave\(save\);\s*if \(!ups\) return;\s*refreshStats\(\);\s*if \(G && G\.player\) \{ const p = G\.player; p\.hp = p\.maxHp; p\.mana = p\.maxMana;/, "a level up: your stats again, fully healed");
        assert.match(page, /<i id="xpFill"><\/i><\/div><span id="lvText"><\/span>/);
        assert.match(page, /\$\("lvText"\)\.textContent = `⭐ Lv \$\{h\.lv\}`;/);
        assert.match(page, /<div class="hero-lv" id="heroLv">⭐ Lv \$\{hero\(\)\.lv\}/);
        assert.match(page, /if \(weaponToo \|\| home\) G\.weapon = stats\.weapon;/, "gear put on (or taken off) in the city or house is in your hand at once");
    });
    test("🪞 the wardrobe sells the Store's things too: sorted by any stat, filtered, ✨ your best overall or for one stat", () => {
        assert.match(page, /const buy = C\.WEARABLE\.filter\(id => \{ const w = C\.wearOf\(id\); return w && w\.slot === sl && !ownsIt\(id\) && P\.buyPrice\(id\) && C\.thingOf\(id\); \}\);/);
        assert.match(page, /return `<button type="button" class="opt buyable" data-buy="\$\{o\}">/, "what you don't own: tap to buy");
        assert.deepEqual([...between("const WARD_SORTS = [", "];").matchAll(/\["(\w+)", "/g)].map(m => m[1]), ["overall", "attack", "def", "hp", "speed", "luck", "mana", "crit"]);
        assert.match(page, /const sc = scoreBy\(wardSort\), val = new Map\(list\.map\(id => \[id, sc\(statsWith\(tryOn\(sl, id\)\)\)\]\)\);/);
        assert.match(page, /if \(b\.dataset\.best\) return askBest\(b\.dataset\.best\);/);
        assert.match(page, /const tryOn = \(sl, id\) => C\.cleanOutfit\(\{ base: outfit\.base, wear: \{ \.\.\.outfit\.wear, \[sl\]: id \|\| undefined \} \}, id \? \[\.\.\.me\.items, id\] : me\.items\);/);
        assert.match(between("function bestOutfit(mode) {", "function askBest"), /C\.forSlot\(sl, me\.items\)/, "your best: only from what you own");
        assert.match(page, /\.chips \{ display: flex; flex-wrap: wrap;/, "chips wrap (a row that scrolls sideways can't be scrolled with a mouse)");
    });
    test("❔ what you don't know stays a secret: the furnace won't say what comes out, the collection shows ???", () => {
        assert.match(page, /const known = \(id\) => !!seen\(\)\[id\] \|\| !!recipesKnown\(\)\[id\];/, "known: had it, or found its 📜 recipe");
        assert.match(page, /shown = rec && known\(rec\[2\]\);/, "the furnace names it only once you know it");
        assert.match(page, /❔ An unknown mix — find its 📜 recipe on the roads, or try it and see/);
        assert.match(page, /const mine = D\.RECIPES\.filter\(r => known\(r\[2\]\)\)/, "📜 your recipes: only the ones you know");
        assert.match(page, /if \(!known\(id\)\) return `<div class="recipe unseen"><span class="pic2" style="font-size:1\.4rem">❔<\/span><span class="eq"><b>\?\?\?<\/b><br>📍 \?\?\?<\/span><\/div>`;/);
    });
    test("💀 fall on a road and this trip's materials go — only what this trip found", () => {
        assert.match(page, /if \(plan\.mode === "wilds" && !won\) Object\.entries\(G\.trip \|\| \{\}\)\.forEach\(\(\[id, n\]\) => \{ const k = Math\.min\(n, D\.bagCount\(inv\(\), id\)\);/);
        assert.match(page, /if \(got && G && G\.trip && it\.kind === "mat"\) G\.trip\[id\] = \(G\.trip\[id\] \|\| 0\) \+ got;/);
    });
    test("⏸ shows the controls", () => {
        ["<b>Move</b>", "<b>Attack</b>", "<b>Dash</b>", "<b>Use</b>", "<b>Bag</b>", "<b>Pause</b>", "WASD", "Space or J", "Shift or K", "← → to choose, Space or Enter to pick", "Esc"].forEach(t => assert.ok(page.includes(t), t));
        assert.match(page, /🎮 Controls<\/h2>\$\{CONTROLS\}/);
    });
    test("phones: a joystick, ⚔️ that aims for you, 💨 dash, ✋ use; keyboard too", () => {
        ["id=\"pad\"", "id=\"atkBtn\"", "id=\"dashBtn\"", "id=\"useBtn\"", "KeyW", "ArrowUp", "Space", "ShiftLeft", "KeyE"].forEach(s => assert.ok(page.includes(s), s));
    });
});
