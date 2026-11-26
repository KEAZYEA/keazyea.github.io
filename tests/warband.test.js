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
            assert.ok(W.SKILLS[u.skill], u.key);
            assert.ok(u.name && u.img, u.key);
        });
    });
    test("dearer units are stronger (on average); tanks have the HP, hitters the attack", () => {
        const avg = (cost, f) => { const l = Object.values(cat).filter(u => u.cost === cost); return l.reduce((t, u) => t + f(u), 0) / l.length; };
        for (let c = 1; c < 5; c++) assert.ok(avg(c + 1, u => u.hp * u.atk) > avg(c, u => u.hp * u.atk), "cost " + c);
        const guards = Object.values(cat).filter(u => u.skill === "guard"), strikers = Object.values(cat).filter(u => u.skill === "strike");
        assert.ok(guards.length >= 10 && strikers.length >= 5);
        const ratio = (l) => l.reduce((t, u) => t + u.hp / u.atk, 0) / l.length;
        assert.ok(ratio(guards) > ratio(strikers) * 1.5);
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
    test("you and 7 bots, 100 ❤️ each, 5 gold and a shop of 5 to start — the same seed, the same match", () => {
        const st = match("a");
        assert.equal(st.players.length, 8);
        st.players.forEach((p, i) => { assert.equal(p.hp, 100); assert.equal(p.gold, 5); assert.equal(p.shop.length, 5); assert.equal(!!p.bot, i > 0); });
        assert.equal(st.round, 1);
        assert.deepEqual(match("a").players.map(p => p.shop), st.players.map(p => p.shop));
        assert.notDeepEqual(match("b").players.map(p => p.shop), st.players.map(p => p.shop));
        Object.values(cat).forEach(u => assert.equal(st.pool[u.key], W.POOL[u.cost]));
    });
    test("the shop shows what your level allows (level 1: only 1-gold units), and only what's left in the pool", () => {
        const st = match("s");
        st.players.forEach(p => p.shop.forEach(k => assert.equal(cat[k].cost, 1)));
        const p = me(st); p.level = 9;
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
        const k = p.shop[0];
        W.planAction(cat, st, 0, { t: "buy", i: 0 });
        assert.equal(p.gold, 5 - cat[k].cost);
        assert.equal(st.pool[k], W.POOL[cat[k].cost] - 1);
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
        assert.equal(p.gold, 5 + 3);
        W.planAction(cat, st, 0, { t: "sell", from: "bench", i: 1 });
        assert.equal(p.gold, 8 + 3 * 3 - 1);
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
        assert.deepEqual([p.gold, p.level, p.xp], [14, 3, 0], "2 to level 2, 2 to level 3");
        p.gold = 1;
        assert.throws(() => W.planAction(cat, st, 0, { t: "reroll" }), /Not enough gold/);
        assert.throws(() => W.planAction(cat, st, 0, { t: "xp" }), /Not enough gold/);
    });
    test("placing: only on your half, only as many as your level, swapping places and with the bench", () => {
        const st = match("p"), p = me(st), a = keyOf(1, 0), b = keyOf(1, 1);
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
    test("losing costs ❤️: 1, +1 every 4 rounds, + every enemy ★ left standing", () => {
        assert.equal(W.lossDamage(1, 0), 1);
        assert.equal(W.lossDamage(8, 5), 1 + 2 + 5);
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
        assert.ok(st.players.every(p => p.shop.length === 5 && p.level >= 2));
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
            for (let g = 0; g < 12; g++) {
                const st = match("skill" + g, { skill: 0.5 });
                me(st).bot = { skill, style: "Undead" };
                while (!st.over) W.endRound(cat, st);
                total += me(st).place;
            }
            return total / 12;
        };
        const good = avg(0.95), poor = avg(0.05);
        assert.ok(good + 1.5 < poor, `skill 0.95: ${good} · skill 0.05: ${poor}`);
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
    test("a move that isn't allowed refuses the whole round (nothing changes)", async () => {
        const start = await act({ action: "wbStart" });
        const before = db._data.get("warbandRuns/" + start.body.runId).state;
        for (const actions of [[{ t: "buy", i: 0 }, { t: "buy", i: 1 }, { t: "buy", i: 2 }, { t: "buy", i: 3 }, { t: "buy", i: 4 }, { t: "buy", i: 0 }], [{ t: "xp" }, { t: "xp" }], [{ t: "sell", from: "bench", i: 0 }], [{ t: "move", from: "bench", i: 0, to: "board", x: 3, y: 0 }]]) {
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
