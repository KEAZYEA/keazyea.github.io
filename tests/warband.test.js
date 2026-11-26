/* ⚔️ Warband (warband-core.js + api/games.js wbStart / wbRound / wbGet): buy
   units each round, merge three of a kind, outlast 7 bots. The rules, the
   fights (the same in the browser and on the server), the bots, and the
   server playing every round itself so a result can't be made up — on an
   in-memory database. Run:  npm test */
const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { state, memoryFirestore, call } = require("./api-harness");
const W = require("../warband-core.js");
const { loadUnits } = require("../api/_units.js");

const cat = W.catalog(loadUnits());
const keyOf = (cost, n = 0) => Object.values(cat).filter(u => u.cost === cost).map(u => u.key).sort()[n];
// a match with your shop set by hand
function match(seed = "t", opts) {
    const st = W.newMatch(cat, seed, opts);
    return st;
}
const me = (st) => st.players[0];

describe("⚔️ the units", () => {
    test("all 75 troops and heroes; cost = rarity; every faction and attack type is a team bonus", () => {
        const all = Object.values(cat);
        assert.equal(all.length, 75);
        const counts = {}; all.forEach(u => { counts[u.cost] = (counts[u.cost] || 0) + 1; });
        assert.deepEqual(counts, { 1: 7, 2: 14, 3: 23, 4: 25, 5: 6 });
        all.forEach(u => {
            assert.ok(W.TRAITS[u.faction] && W.TRAITS[u.attack], u.key);
            assert.equal(u.cost, W.COST[u.rarity]);
            assert.ok(u.hp > 0 && u.atk > 0 && u.def >= 15 && u.def <= 45, u.key);
            assert.equal(u.range, u.attack === "Ranged" ? 3 : 1);
            assert.ok(W.ABILITIES[u.ability.kind] && u.ability.name && u.ability.cd >= 3 && u.ability.cd <= 7, u.key);
            assert.ok(u.name && u.img, u.key);
        });
    });
    test("dearer units are stronger (on average)", () => {
        const avg = (cost, f) => { const l = Object.values(cat).filter(u => u.cost === cost); return l.reduce((t, u) => t + f(u), 0) / l.length; };
        for (let c = 1; c < 5; c++) assert.ok(avg(c + 1, u => u.hp * u.atk) > avg(c, u => u.hp * u.atk), "cost " + c);
    });
    test("each uses its own ability, by name, doing what it says — on a countdown from its real cooldown", () => {
        const ab = (k) => cat[k].ability;
        assert.deepEqual([ab("dragonRider").name, ab("dragonRider").kind], ["Meteor Strike", "blast"]);
        assert.deepEqual([ab("iceMage").name, ab("iceMage").kind], ["Snowball", "stun"]);
        assert.deepEqual([ab("elevateSupport").name, ab("elevateSupport").kind], ["Healing Veil", "heal"]);
        assert.deepEqual([ab("undeadWarrior").name, ab("undeadWarrior").kind], ["Cursed Army", "summon"]);
        assert.deepEqual([ab("assasin").name, ab("assasin").kind], ["Teleport", "leap"]);
        assert.deepEqual([ab("paladin").name, ab("paladin").kind], ["Divine Guards", "shield"]);
        assert.deepEqual([ab("bardHero").name, ab("bardHero").kind], ["Song of Courage", "rally"]);
        assert.deepEqual([ab("flyingMonster").name, ab("flyingMonster").kind], ["Nightmare", "fear"]);
        // its countdown comes from the game's own cooldown: 40% of it, 3–7 s (Meteor Strike: 17 s → 7)
        assert.equal(ab("dragonRider").cd, 7);
        loadUnits().forEach(u => {
            const a = (u.abilityList || []).find(x => W.abilityKind(x));
            if (!a || !a.nums.cd) return;
            assert.equal(cat[u.key].ability.cd, Math.max(3, Math.min(7, Math.round(a.nums.cd[0][1] * 0.4))), u.key);
        });
        assert.equal(ab("baronBenua").own, false, "Gold Mark isn't a fighting ability: one that fits him instead");
        const own = Object.values(cat).filter(u => u.ability.own);
        assert.ok(own.length >= 50, "most use their own: " + own.length);
        // the rest get one that fits them
        Object.values(cat).filter(u => !u.ability.own).forEach(u => assert.ok(["guard", "volley", "strike", "blast"].includes(u.ability.kind), u.key));
    });
    test("a hero's talent is a bonus it always has", () => {
        assert.deepEqual(cat.dragonRider.talent, { name: "Aerial Support", kind: "atk", val: 15 });
        assert.deepEqual([cat.iceMage.talent.kind, cat.forestQueen.talent.kind, cat.airMage.talent.kind], ["hp", "thorns", "dodge"]);
        assert.equal(Object.values(cat).filter(u => u.talent).length, 20);
        assert.equal(cat.archer.talent, null, "troops have none");
        const f = W.fightStart(cat, [{ k: "dragonRider", s: 1, x: 0, y: 0 }, { k: "iceMage", s: 1, x: 1, y: 0 }], []);
        assert.equal(f[0].atk, Math.round(cat.dragonRider.atk * 1.15)); assert.equal(f[1].max, Math.round(cat.iceMage.hp * 1.15));
        assert.equal(f[0].talent, "Aerial Support");
    });
    test("team bonuses count different units: two Archers are one Human", () => {
        const humans = Object.values(cat).filter(u => u.faction === "Human").slice(0, 4);
        let t = W.traitsOf([humans[0], humans[0]]);
        assert.deepEqual([t.Human.n, t.Human.tier], [1, 0]);
        t = W.traitsOf([humans[0], humans[1]]);
        assert.deepEqual([t.Human.n, t.Human.tier, t.Human.val, t.Human.next], [2, 1, 20, 4]);
        t = W.traitsOf(humans);
        assert.deepEqual([t.Human.tier, t.Human.val], [2, 45]);
    });
});

describe("⚔️ a match: gold, the shop, buying, merging", () => {
    test("you and 7 bots, 100 ❤️ each; you start at level 3 with 💰 10 and a shop of 5 — the same seed, the same match", () => {
        const st = match("a");
        assert.equal(st.players.length, 8);
        st.players.forEach((p, i) => { assert.equal(p.hp, 100); assert.equal(p.level, 3); assert.equal(p.shop.length, 5); assert.equal(!!p.bot, i > 0); });
        assert.equal(me(st).gold, 10);
        st.players.filter(p => p.bot).forEach(p => assert.ok(p.board.length >= 1, "the bots have planned already"));
        assert.equal(st.round, 1);
        assert.deepEqual(match("a").players.map(p => p.shop), st.players.map(p => p.shop));
        assert.notDeepEqual(match("b").players.map(p => p.shop), st.players.map(p => p.shop));
        const bought = {}; st.players.forEach(p => W.units(p).forEach(u => { bought[u.k] = (bought[u.k] || 0) + W.copiesOf(u.s); }));
        Object.values(cat).forEach(u => assert.equal(st.pool[u.key] + (bought[u.key] || 0), W.POOL[u.cost], u.key));
    });
    test("the shop shows what your level allows (level 1: only 1-gold units), and only what's left in the pool", () => {
        const st = match("s"), p = me(st);
        p.level = 1;
        for (let i = 0; i < 50; i++) W.rollShop(cat, st, 0, i).forEach(k => assert.equal(cat[k].cost, 1));
        p.level = 9;
        const costs = {};
        for (let i = 0; i < 300; i++) W.rollShop(cat, st, 0, i).forEach(k => { costs[cat[k].cost] = (costs[cat[k].cost] || 0) + 1; });
        assert.ok(costs[5] > 60 && costs[4] > costs[1], JSON.stringify(costs));
        // nothing left of a unit: never shown
        const gone = keyOf(1, 0);
        st.pool[gone] = 0; p.level = 1;
        for (let i = 0; i < 100; i++) assert.ok(!W.rollShop(cat, st, 0, i).includes(gone));
        // every 1-gold unit gone: a level-1 shop is empty
        Object.values(cat).filter(u => u.cost === 1).forEach(u => { st.pool[u.key] = 0; });
        assert.deepEqual(W.rollShop(cat, st, 0, 7), [null, null, null, null, null]);
    });
    test("a shop comes from the round's key — the page can redo a refresh, but not see next round's shop", () => {
        const key = (r) => "secret-" + r;
        const st = W.newMatch(cat, "k", { roundKey: key });
        assert.equal(st.rk, "secret-1");
        const page = W.forPlayer(st);
        assert.equal(page.seed, undefined, "the match's seed never goes to the page");
        // the page refreshes with the same rules and gets what the server gets
        W.planAction(cat, page, 0, { t: "reroll" });
        W.planAction(cat, st, 0, { t: "reroll" });
        assert.deepEqual(page.players[0].shop, st.players[0].shop);
        // a different key, a different shop
        const other = W.newMatch(cat, "k", { roundKey: (r) => "other-" + r });
        assert.notDeepEqual(other.players.map(p => p.shop), W.newMatch(cat, "k", { roundKey: key }).players.map(p => p.shop));
        W.endRound(cat, st, key);
        assert.equal(st.rk, "secret-2");
    });
    test("buy: costs its gold, leaves the pool, goes on the bench; not enough gold — refused", () => {
        const st = match("b"), p = me(st);
        const k = p.shop[0], left = st.pool[k];
        W.planAction(cat, st, 0, { t: "buy", i: 0 });
        assert.equal(p.gold, 10 - cat[k].cost);
        assert.equal(st.pool[k], left - 1);
        assert.deepEqual(p.bench[0], { k, s: 1 });
        assert.equal(p.shop[0], null);
        assert.throws(() => W.planAction(cat, st, 0, { t: "buy", i: 0 }), /Nothing to buy/);
        p.gold = 0;
        assert.throws(() => W.planAction(cat, st, 0, { t: "buy", i: 1 }), /Not enough gold/);
    });
    test("three of a kind merge into a ★2 (on the board, where the first one stood); nine into a ★3", () => {
        const st = match("m"), p = me(st), k = keyOf(1, 2);
        p.gold = 100; p.level = 3;
        p.board = [{ k, s: 1, x: 3, y: 0 }];
        p.bench[0] = { k, s: 1 };
        p.shop = [k, k, k, k, k];
        W.planAction(cat, st, 0, { t: "buy", i: 0 });
        assert.deepEqual(p.board, [{ k, s: 2, x: 3, y: 0 }]);
        assert.ok(p.bench.every(x => !x), "the other two are gone");
        p.bench[0] = { k, s: 2 }; p.bench[1] = { k, s: 1 }; p.bench[2] = { k, s: 1 };
        W.planAction(cat, st, 0, { t: "buy", i: 1 }); // three ★1 → ★2, three ★2 → ★3
        assert.deepEqual(p.board, [{ k, s: 3, x: 3, y: 0 }]);
        assert.ok(p.bench.every(x => !x));
    });
    test("a full bench takes one more only if it makes three", () => {
        const st = match("f"), p = me(st), k = keyOf(1, 0), other = keyOf(1, 1);
        p.gold = 50;
        p.bench = Array(W.BENCH).fill(null).map(() => ({ k: other, s: 1 }));
        p.bench[0] = { k, s: 1 }; p.bench[1] = { k, s: 1 };
        p.bench[2] = { k: keyOf(1, 3), s: 1 }; p.bench[3] = { k: keyOf(1, 4), s: 1 }; p.bench[4] = { k: keyOf(1, 5), s: 1 }; p.bench[5] = { k: keyOf(1, 6), s: 1 };
        p.bench[6] = { k: keyOf(2, 0), s: 1 }; p.bench[7] = { k: keyOf(2, 1), s: 1 }; p.bench[8] = { k: keyOf(2, 2), s: 1 };
        p.shop = [keyOf(2, 5), k, null, null, null];
        assert.throws(() => W.planAction(cat, st, 0, { t: "buy", i: 0 }), /bench is full/);
        W.planAction(cat, st, 0, { t: "buy", i: 1 });
        assert.equal(p.bench.filter(x => x && x.k === k && x.s === 2).length, 1);
        assert.equal(p.bench.filter(x => x && x.k === k).length, 1);
    });
    test("sell: its gold back (a ★2 for 3 × its cost − 1) and its copies back in the pool", () => {
        const st = match("v"), p = me(st), k = keyOf(3, 0);
        p.bench[0] = { k, s: 1 }; p.bench[1] = { k, s: 2 };
        st.pool[k] = 10;
        W.planAction(cat, st, 0, { t: "sell", from: "bench", i: 0 });
        assert.equal(p.gold, 10 + 3);
        W.planAction(cat, st, 0, { t: "sell", from: "bench", i: 1 });
        assert.equal(p.gold, 13 + 3 * 3 - 1);
        assert.equal(st.pool[k], 10 + 1 + 3);
        assert.throws(() => W.planAction(cat, st, 0, { t: "sell", from: "bench", i: 0 }), /Nothing to sell/);
    });
    test("refresh (2 gold, a new shop) and XP (4 gold for 4 XP — levels up)", () => {
        const st = match("r"), p = me(st);
        p.gold = 20;
        const before = p.shop.slice();
        W.planAction(cat, st, 0, { t: "reroll" });
        assert.equal(p.gold, 18);
        assert.notDeepEqual(p.shop, before);
        W.planAction(cat, st, 0, { t: "xp" });
        assert.deepEqual([p.gold, p.level, p.xp], [14, 4, 0], "4 XP: level 3 → 4");
        p.gold = 1;
        assert.throws(() => W.planAction(cat, st, 0, { t: "reroll" }), /Not enough gold/);
        assert.throws(() => W.planAction(cat, st, 0, { t: "xp" }), /Not enough gold/);
    });
    test("🔒 lock: the shop stays for the next round (what's bought stays empty), refresh still works, till it's unlocked", () => {
        const st = match("lock"), p = me(st);
        W.planAction(cat, st, 0, { t: "lock" });
        assert.equal(p.locked, true);
        W.planAction(cat, st, 0, { t: "buy", i: 0 });
        const kept = p.shop.slice();
        assert.equal(kept[0], null);
        W.endRound(cat, st);
        assert.deepEqual(p.shop, kept, "round 2: the same shop");
        W.endRound(cat, st);
        assert.deepEqual(p.shop, kept, "round 3: still");
        assert.equal(p.locked, true);
        p.gold = 20;
        W.planAction(cat, st, 0, { t: "reroll" });
        assert.notDeepEqual(p.shop, kept, "🔄 refresh still works");
        const rolled = p.shop.slice();
        W.endRound(cat, st);
        assert.deepEqual(p.shop, rolled, "…and the refreshed one's kept");
        W.planAction(cat, st, 0, { t: "lock" });
        assert.equal(p.locked, false);
        W.endRound(cat, st);
        assert.notDeepEqual(p.shop, rolled, "🔓 unlocked: a new shop");
        // the bots never lock
        assert.ok(st.players.every(x => x.id === 0 || !x.locked));
    });
    test("placing: only on your half, only as many as your level, swapping places and with the bench", () => {
        const st = match("p"), p = me(st), a = keyOf(1, 0), b = keyOf(1, 1);
        p.level = 1;
        p.bench[0] = { k: a, s: 1 }; p.bench[1] = { k: b, s: 1 };
        W.planAction(cat, st, 0, { t: "move", from: "bench", i: 0, to: "board", x: 3, y: 0 });
        assert.deepEqual(p.board, [{ k: a, s: 1, x: 3, y: 0 }]);
        assert.throws(() => W.planAction(cat, st, 0, { t: "move", from: "bench", i: 1, to: "board", x: 2, y: 0 }), /field 1 unit/);
        W.planAction(cat, st, 0, { t: "move", from: "bench", i: 1, to: "board", x: 3, y: 0 }); // onto it: a swap
        assert.deepEqual([p.board[0].k, p.bench[1].k], [b, a]);
        assert.throws(() => W.planAction(cat, st, 0, { t: "move", from: "board", i: 0, to: "board", x: 3, y: 4 }), /your side/);
        assert.throws(() => W.planAction(cat, st, 0, { t: "move", from: "board", i: 0, to: "board", x: 7, y: 0 }), /your side/);
        W.planAction(cat, st, 0, { t: "move", from: "board", i: 0, to: "board", x: 6, y: 3 });
        assert.deepEqual([p.board[0].x, p.board[0].y], [6, 3]);
        W.planAction(cat, st, 0, { t: "move", from: "board", i: 0, to: "bench", slot: 5 });
        assert.equal(p.board.length, 0);
        assert.equal(p.bench[5].k, b);
        assert.throws(() => W.planAction(cat, st, 0, { t: "fly" }), /Unknown move/);
    });
    test("pay each round: 5, +1 for every 10 saved (5 at most), + a streak", () => {
        assert.deepEqual([0, 9, 10, 35, 50, 99].map(W.interest), [0, 0, 1, 3, 5, 5]);
        assert.deepEqual([0, 1, 2, 3, 4, 5, 9, -2, -5].map(W.streakGold), [0, 0, 1, 1, 2, 3, 3, 1, 3]);
        const st = match("g"), p = me(st);
        p.gold = 23; p.streak = 3;
        W.endRound(cat, st);
        if (p.alive) assert.ok(p.gold >= 23 + 5 + 2, "5 + 2 interest (+ any streak) -> " + p.gold);
    });
});

describe("⚔️ the fight", () => {
    const strong = () => [{ k: keyOf(5, 0), s: 3, x: 3, y: 0 }, { k: keyOf(5, 1), s: 3, x: 2, y: 0 }];
    const weak = () => [{ k: keyOf(1, 0), s: 1, x: 3, y: 0 }];
    test("the same fight always ends the same way (and recording it changes nothing)", () => {
        const a = [{ k: keyOf(3, 0), s: 2, x: 3, y: 0 }, { k: keyOf(2, 4), s: 1, x: 1, y: 3 }], b = [{ k: keyOf(3, 5), s: 2, x: 4, y: 1 }, { k: keyOf(2, 7), s: 2, x: 0, y: 0 }];
        const r1 = W.fight(cat, a, b, "x"), r2 = W.fight(cat, a, b, "x"), r3 = W.fight(cat, a, b, "x", true);
        assert.deepEqual(r1, r2);
        assert.deepEqual([r3.winner, r3.ticks, r3.survivors], [r1.winner, r1.ticks, r1.survivors]);
        assert.ok(r3.events.length > 10 && r3.start.length === 4);
        assert.ok(r3.events.some(e => e[1] === "hit") && r3.events.some(e => e[1] === "die"));
    });
    test("much stronger wins, either side; nobody vs someone: someone wins", () => {
        assert.equal(W.fight(cat, strong(), weak(), "1").winner, 0);
        assert.equal(W.fight(cat, weak(), strong(), "1").winner, 1);
        assert.equal(W.fight(cat, [], weak(), "1").winner, 1);
        assert.equal(W.fight(cat, weak(), [], "1").winner, 0);
        const r = W.fight(cat, strong(), weak(), "1");
        assert.deepEqual(r.survivors, [6, 0], "★3 + ★3 left standing");
    });
    test("units walk to each other and fight; skills go off; it never runs past its time", () => {
        const r = W.fight(cat, [{ k: keyOf(4, 0), s: 2, x: 0, y: 3 }], [{ k: keyOf(4, 1), s: 2, x: 0, y: 3 }], "w", true);
        assert.ok(r.events.some(e => e[1] === "move"));
        assert.ok(r.events.some(e => e[1] === "skill"));
        assert.ok(r.ticks <= W.MAX_TICKS);
    });
    test("team bonuses work in a fight: Humans' defense makes them last longer", () => {
        const humans = Object.values(cat).filter(u => u.faction === "Human" && u.cost === 2).slice(0, 6).map((u, i) => ({ k: u.key, s: 1, x: i, y: 0 }));
        const t = W.traitsOf(humans.map(u => cat[u.k]));
        assert.equal(t.Human.tier, 3);
        const f = W.fightStart(cat, humans, []);
        assert.ok(f.every(x => x.def === cat[x.k].def + 80));
    });
    test("losing costs ❤️: 2 + the round, + 2 for every enemy ★ left standing", () => {
        assert.equal(W.lossDamage(1, 0), 3);
        assert.equal(W.lossDamage(8, 5), 2 + 8 + 2 * 5);
    });
});

describe("⚔️ who you'll fight, before you plan", () => {
    test("the pairs are made when the round starts — you can see your opponent's board, and it's the board you fight", () => {
        const st = match("pair");
        assert.equal(st.pairs.length, 4);
        assert.equal(new Set(st.pairs.flatMap(p => [p[0], p[1]])).size, 8);
        const opp = W.opponentOf(st, 0);
        assert.ok(opp && opp.vs > 0);
        const seen = JSON.stringify(st.players[opp.vs].board);
        assert.ok(st.players[opp.vs].board.length >= 1, "their formation's there to see");
        const res = W.endRound(cat, st);
        const mine = res.results.find(r => r.a === 0 || r.b === 0);
        assert.equal(mine.a === 0 ? mine.b : mine.a, opp.vs, "you fight who it said");
        assert.equal(JSON.stringify(mine.a === 0 ? mine.boards[1] : mine.boards[0]), seen, "…with the board you saw");
        assert.ok(W.opponentOf(st, 0), "the next round's is known straight away");
    });
});

describe("⚔️ abilities, in a fight", () => {
    const evs = (r, kind) => r.events.filter(e => e[1] === kind);
    const one = (k, x = 3, y = 0) => ({ k, s: 2, x, y });
    test("a countdown: the first comes early — at a quarter of it (Mages with their bonus: a tenth), then every full countdown", () => {
        const r = W.fight(cat, [{ k: "dragonRider", s: 3, x: 3, y: 0 }], [{ k: "stoneGolem", s: 2, x: 3, y: 0 }, { k: "stoneGolem", s: 2, x: 2, y: 0 }], "cd", true);
        const casts = evs(r, "skill").filter(e => e[2] === 0).map(e => e[0]);
        assert.ok(casts.length >= 2, JSON.stringify(casts));
        assert.equal(casts[0], Math.round(cat.dragonRider.ability.cd * 10 * 0.25) - 1);
        assert.equal(casts[1] - casts[0], cat.dragonRider.ability.cd * 10);
        const start = r.start.find(s => s.id === 0);
        assert.deepEqual([start.abName, start.ab, start.cdMax], ["Meteor Strike", "blast", 70]);
        const mages = Object.values(cat).filter(u => u.faction === "Mage").slice(0, 2).map((u, i) => ({ k: u.key, s: 1, x: i, y: 0 }));
        assert.ok(W.fightStart(cat, mages, []).every(f => f.cdLeft === Math.round(f.cdMax * 0.1)));
    });
    test("each does what it says: heal, stun, summon, leap, shield, fear, rally", () => {
        const pal = one("paladin"), r1 = W.fight(cat, [one("elevateSupport", 3, 1), { k: "archer", s: 1, x: 3, y: 0 }], [one("dragonRider"), one("stoneGolem", 1, 0)], "h", true);
        assert.ok(evs(r1, "heal").length >= 1, "💚 Healing Veil heals");
        // …and their HP really goes up: what it was (after the last hit) + the heal
        const healed = evs(r1, "heal").find(e => e[3] > 0);
        assert.ok(healed, "someone was hurt and healed");
        const lastHit = r1.events.slice(0, r1.events.indexOf(healed)).filter(e => e[1] === "hit" && e[3] === healed[2]).pop(); // (the last before it, in order)
        const before = lastHit ? lastHit[5] : r1.start.find(x => x.id === healed[2]).hp;
        assert.equal(healed[4], before + healed[3]);
        const r2 = W.fight(cat, [one("iceMage")], [one("stoneGolem"), one("paladin", 2, 0)], "s", true);
        const stun = evs(r2, "stun")[0];
        assert.ok(stun, "💫 Snowball stuns");
        assert.ok(!r2.events.some(e => (e[1] === "hit" || e[1] === "skill" || e[1] === "move") && e[2] === stun[2] && e[0] > stun[0] && e[0] < stun[3]), "…and a stunned unit does nothing till it wears off");
        const r3 = W.fight(cat, [one("undeadWarrior")], [one("stoneGolem"), one("paladin", 2, 0)], "u", true);
        const sm = evs(r3, "summon")[0];
        assert.ok(sm && r3.events.some(e => e[1] === "hit" && e[2] === sm[2]), "👻 Cursed Army calls up a helper, and it fights");
        const r4 = W.fight(cat, [one("assasin")], [one("stoneGolem", 3, 0), one("archer", 0, 3)], "l", true);
        assert.ok(r4.events.some(e => e[1] === "move" && e[2] === 0 && e[5] === 1), "🌀 Teleport leaps");
        const r5 = W.fight(cat, [pal], [one("stoneGolem")], "sh", true);
        assert.ok(evs(r5, "shield").length >= 1, "🛡️ Divine Guards shields");
        const r6 = W.fight(cat, [one("flyingMonster")], [one("stoneGolem"), one("paladin", 2, 0)], "f", true);
        assert.ok(evs(r6, "fear").length >= 1, "😱 Nightmare scares");
        // …and a scared unit doesn't attack till it wears off
        evs(r6, "fear").forEach(f => {
            assert.ok(f[3] > f[0], "it lasts");
            assert.ok(!r6.events.some(e => e[1] === "hit" && e[2] === f[2] && e[6] === "a" && e[0] > f[0] && e[0] < f[3]), "no attacks while scared");
        });
        const r7 = W.fight(cat, [one("bardHero"), one("archer", 2, 1)], [one("stoneGolem")], "r", true);
        assert.ok(evs(r7, "rally").length >= 1, "📯 Song of Courage rallies");
    });
    test("talents in a fight: thorns hit back, evasion dodges", () => {
        const r = W.fight(cat, [one("forestQueen")], [{ k: "infantry", s: 3, x: 3, y: 0 }, { k: "lancer", s: 2, x: 2, y: 0 }], "t", true);
        assert.ok(r.events.some(e => e[1] === "hit" && e[2] === 0 && e[6] === "r"), "Thorns: damage sent back");
        const d = W.fight(cat, [one("airMage")], [{ k: "infantry", s: 3, x: 3, y: 0 }, { k: "archer", s: 3, x: 1, y: 1 }], "d", true);
        assert.ok(evs(d, "miss").some(e => e[3] === 0), "Wind Tamer: some attacks miss it");
    });
});

describe("⚔️ rounds, the bots, the end", () => {
    test("a round: the bots plan, everyone fights, losers lose ❤️, the next round starts with pay and a shop", () => {
        const st = match("e");
        const res = W.endRound(cat, st);
        assert.equal(res.results.length, 4, "8 players: 4 fights");
        assert.equal(new Set(res.results.flatMap(r => [r.a, r.b])).size, 8);
        st.players.filter(p => p.bot).forEach(p => assert.ok(p.board.length >= 1, "every bot fields someone"));
        assert.equal(st.round, 2);
        assert.ok(st.players.filter(p => p.alive).every(p => p.shop.length === 5 && p.level >= 3));
        // you fielded nobody: you lost
        const mine = res.results.find(r => r.a === 0 || r.b === 0);
        assert.equal(mine.winner, mine.a === 0 ? 1 : 0);
        assert.ok(me(st).hp < 100);
    });
    test("a whole match ends: everyone placed 1st–8th, you included", () => {
        for (const seed of ["end1", "end2", "end3"]) {
            const st = match(seed);
            me(st).bot = { skill: 0.7, style: "Human" }; // (you, played by a bot)
            let guard = 0;
            while (!st.over && guard++ < 100) W.endRound(cat, st);
            assert.ok(st.over && st.round <= W.MAX_ROUNDS);
            const places = st.players.map(p => p.place).filter(Boolean).sort((a, b) => a - b);
            assert.ok(me(st).place >= 1 && me(st).place <= 8);
            assert.equal(new Set(places).size, places.length, "no two the same place");
            assert.throws(() => W.endRound(cat, st), /over/);
        }
    });
    test("an odd number left: one fights a copy of someone (who loses nothing)", () => {
        for (const seed of ["o1", "o2", "o3", "o4", "o5", "o6"]) {
            const st = match(seed);
            st.players[7].alive = false; st.players[7].place = 8;
            st.pairs = W.makePairs(st);
            const hp = st.players.map(p => p.hp);
            const res = W.endRound(cat, st);
            const ghost = res.results.filter(r => r.ghost);
            assert.equal(ghost.length, 1);
            assert.equal(ghost[0].dmg[1], 0);
            // the copied player loses only what their own fight cost them
            const owner = ghost[0].b, own = res.results.find(r => !r.ghost && (r.a === owner || r.b === owner));
            assert.equal(hp[owner] - st.players[owner].hp, own.a === owner ? own.dmg[0] : own.dmg[1], seed);
        }
    });
    test("a better bot does better (over many matches)", () => {
        const avg = (skill) => {
            let total = 0;
            for (let g = 0; g < 20; g++) {
                const st = match("skill" + g, { skill: 0.5 });
                me(st).bot = { skill, style: "Undead" };
                W.botPlan(cat, st, 0); // (round 1 too)
                while (!st.over) W.endRound(cat, st);
                total += me(st).place;
            }
            return total / 20;
        };
        const good = avg(0.95), poor = avg(0.05);
        assert.ok(good <= 4.3 && good + 2 < poor, `skill 0.95: ${good} · skill 0.05: ${poor} (a good bot fields its strongest — ranks will need this)`);
    });
});

describe("⚔️ on the server (api/games.js): it plays every round itself", () => {
    let db;
    const act = (body, token = "player-token") => call("games.js", { token, body });
    beforeEach(() => {
        db = memoryFirestore();
        db._data.set("users/player1", { name: "Ezra" });
        db._data.set("publicProfiles/player1", { name: "Ezra" });
        state.db = db;
    });
    test("a new match: you (by your name) and 7 bots — the page never gets the seed; asked again, the same match", async () => {
        const r = await act({ action: "wbStart" });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.match(r.body.runId, /^[0-9a-f]{24}$/);
        assert.equal(r.body.match.seed, undefined);
        assert.equal(r.body.match.players[0].name, "Ezra");
        assert.equal(r.body.match.round, 1);
        assert.ok(r.body.match.rk && r.body.match.rk.length >= 16, "this round's key, for refreshes");
        const doc = db._data.get("warbandRuns/" + r.body.runId);
        assert.ok(JSON.parse(doc.state).seed, "the seed stays here");
        const again = await act({ action: "wbStart" });
        assert.equal(again.body.runId, r.body.runId);
        assert.equal(again.body.resumed, true);
        const got = await act({ action: "wbGet" });
        assert.equal(got.body.runId, r.body.runId);
    });
    test("a round: your moves replayed here, the same as the page worked out; then the round played", async () => {
        const start = await act({ action: "wbStart" });
        const page = start.body.match; // the page plans on its copy
        const moves = [{ t: "buy", i: 0 }, { t: "move", from: "bench", i: 0, to: "board", x: 3, y: 0 }, { t: "reroll" }];
        moves.forEach(a => W.planAction(cat, page, 0, a));
        const r = await act({ action: "wbRound", runId: start.body.runId, round: 1, actions: moves });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.match.round, 2);
        assert.equal(r.body.results.length, 4);
        const mine = r.body.results.find(x => x.a === 0 || x.b === 0);
        const myBoard = mine.a === 0 ? mine.boards[0] : mine.boards[1];
        assert.deepEqual(myBoard, page.players[0].board, "what you fielded is what the page had");
        // the page can replay its fight and see the same ending
        const replay = W.fight(cat, mine.boards[0], mine.boards[1], mine.seed);
        assert.equal(replay.winner, mine.winner);
        assert.ok(r.body.match.rk !== page.rk, "a new round, a new key");
        const seed = JSON.parse(db._data.get("warbandRuns/" + start.body.runId).state).seed;
        assert.ok(r.body.results.every(x => !x.seed.includes(seed)) && !JSON.stringify(r.body).includes(seed), "nothing sent gives the match's seed away");
        // the same round again: refused
        const twice = await act({ action: "wbRound", runId: start.body.runId, round: 1, actions: [] });
        assert.equal(twice.status, 409);
    });
    test("🔒 lock is a move the server takes: the next round has the same shop", async () => {
        const start = await act({ action: "wbStart" });
        const shop = start.body.match.players[0].shop;
        const r = await act({ action: "wbRound", runId: start.body.runId, round: 1, actions: [{ t: "lock" }] });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.match.players[0].locked, true);
        assert.deepEqual(r.body.match.players[0].shop, shop);
    });
    test("a move that isn't allowed refuses the whole round (nothing changes)", async () => {
        const start = await act({ action: "wbStart" });
        const before = db._data.get("warbandRuns/" + start.body.runId).state;
        for (const actions of [[{ t: "buy", i: 0 }, { t: "buy", i: 1 }, { t: "buy", i: 2 }, { t: "buy", i: 3 }, { t: "buy", i: 4 }, { t: "buy", i: 0 }], [{ t: "xp" }, { t: "xp" }, { t: "xp" }], [{ t: "sell", from: "bench", i: 0 }], [{ t: "move", from: "bench", i: 0, to: "board", x: 3, y: 0 }]]) {
            const r = await act({ action: "wbRound", runId: start.body.runId, round: 1, actions });
            assert.equal(r.status, 400, JSON.stringify(actions));
            assert.match(r.body.error, /^Move \d+:/);
        }
        for (const actions of [[{ t: "steal" }], "buy", [null], Array(401).fill({ t: "reroll" })]) {
            const r = await act({ action: "wbRound", runId: start.body.runId, round: 1, actions });
            assert.equal(r.status, 400);
            if (Array.isArray(actions) && actions.length > 400) assert.match(r.body.error, /Too many moves/);
        }
        assert.equal(db._data.get("warbandRuns/" + start.body.runId).state, before);
    });
    test("a match from before an update isn't carried on: a new one starts", async () => {
        const start = await act({ action: "wbStart" });
        const doc = db._data.get("warbandRuns/" + start.body.runId), old = JSON.parse(doc.state);
        old.v = 1; db._data.set("warbandRuns/" + start.body.runId, { ...doc, state: JSON.stringify(old) });
        assert.equal((await act({ action: "wbGet" })).body.match, null);
        assert.equal((await act({ action: "wbRound", runId: start.body.runId, round: 1, actions: [] })).status, 409);
        const fresh = await act({ action: "wbStart" });
        assert.notEqual(fresh.body.runId, start.body.runId);
        assert.equal(fresh.body.match.v, W.VERSION);
        const gone = db._data.get("warbandRuns/" + start.body.runId);
        assert.deepEqual([gone.over, gone.outdated, gone.place], [true, true, null], "ended, unplaced (not 8th)");
    });
    test("someone else's match, a made-up one, no sign-in — refused", async () => {
        const start = await act({ action: "wbStart" });
        db._data.set("users/player2", { name: "Bo" });
        assert.equal((await act({ action: "wbRound", runId: start.body.runId, round: 1, actions: [] }, "player2-token")).status, 404);
        assert.equal((await act({ action: "wbRound", runId: "0".repeat(24), round: 1, actions: [] })).status, 404);
        assert.equal((await act({ action: "wbRound", runId: "nope", round: 1, actions: [] })).status, 400);
        assert.equal((await call("games.js", { body: { action: "wbStart" } })).status, 401);
        db._data.set("users/player1", { name: "Ezra", banned: true, banUntil: 0 });
        assert.equal((await act({ action: "wbStart", fresh: true })).status, 403);
    });
    test("played to the end: your place is kept, and a new match can start; starting again mid-match gives the old one up (8th)", async () => {
        let s = await act({ action: "wbStart" });
        const id = s.body.runId;
        let round = 1, r;
        do { r = await act({ action: "wbRound", runId: id, round, actions: [] }); round = r.body.match.round; } while (!r.body.over && round < 80);
        assert.equal(r.body.over, true);
        assert.equal(r.body.place, 8, "fielding nobody: last");
        assert.equal(db._data.get("warbandRuns/" + id).place, 8);
        assert.deepEqual(db._data.get("warbandPlayers/player1").last.runId, id);
        assert.equal((await act({ action: "wbRound", runId: id, round, actions: [] })).status, 409);
        const next = await act({ action: "wbStart" });
        assert.notEqual(next.body.runId, id);
        const fresh = await act({ action: "wbStart", fresh: true });
        assert.notEqual(fresh.body.runId, next.body.runId);
        assert.deepEqual([db._data.get("warbandRuns/" + next.body.runId).over, db._data.get("warbandRuns/" + next.body.runId).place, db._data.get("warbandRuns/" + next.body.runId).abandoned], [true, 8, true]);
    });
});
