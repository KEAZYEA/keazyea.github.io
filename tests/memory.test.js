/* 🃏 Memory: the rules (games-core.js) and its ranked runs on the server
   (api/games.js), on an in-memory database.
   - Today's Puzzle: Memory joins the rotation on 2026-11-16 — every day
     before keeps the game it had; from then on each week has all six games.
   - A day's cards: only a possible, finished play counts; fewer moves is better.
   - A run: each level waits for "start", doubles the cards and scores its
     level number once the whole deck is handed in, in time.
   - Ranked: the cards never leave the server all at once — each card is asked
     for on its own (runPeek, no database), only with the level's signature
     from this server, and only while its clock runs.
   Run:  npm test */
const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { state, touchyDb, memoryFirestore, call } = require("./api-harness");
const G = require("../games-core.js");
const { loadUnits } = require("../api/_units");
const games = require("../api/games.js");
const { weekOf, memDeckFor, resetMemKey } = games._internals;

const UNITS = loadUnits();
const dayAfter = (day, n) => new Date(Date.parse(day + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);

describe("Today's Puzzle rotation", () => {
    // Each day's game from 2026-06-01 to 2026-11-15 as it was before Memory (t g u h b).
    const BEFORE = "uhgtguhugththughtguguthgtuhtughgthutuhghtgutuhgtguhghuthugthtugughtgthuguthuthguhtghtguguthuhtghtguthughgututghtughgthuhugtughthtguhtguthgutugtgbhugtubhtgtuhgbgbgthubtg";
    test("every day before 2026-11-16 keeps its game (and its ⭐ double game)", () => {
        const letter = { trivia: "t", guess: "g", unitle: "u", hilo: "h", blur: "b" };
        let got = "";
        for (let i = 0; i < BEFORE.length; i++) got += letter[G.dailyGameFor(dayAfter("2026-06-01", i))] || "?";
        assert.equal(got, BEFORE);
        assert.equal(dayAfter("2026-06-01", BEFORE.length - 1), "2026-11-15");
        assert.equal(G.bonusGameFor("2026-11-11"), "hilo");
    });
    test("from 2026-11-16 every Monday–Sunday week has all six games, never the same two days running", () => {
        let prev = G.dailyGameFor("2026-11-15");
        for (let w = 0; w < 104; w++) {
            const week = [...Array(7)].map((_, d) => G.dailyGameFor(dayAfter("2026-11-16", w * 7 + d)));
            assert.equal(new Set(week).size, 6, `week ${w}: ${week}`);
            for (const g of week) { assert.notEqual(g, prev, `week ${w}: ${week}`); prev = g; }
        }
    });
});

describe("a day's cards", () => {
    const day = (() => { let d = "2026-11-16"; while (G.dailyGameFor(d) !== "memory") d = dayAfter(d, 1); return d; })();
    const p = G.dailyPuzzle(UNITS, day);
    const twin = (i) => p.cards.findIndex((k, j) => j !== i && k === p.cards[i]);
    const perfect = () => { const f = [], seen = new Set(); p.cards.forEach((k, i) => { if (!seen.has(k)) { seen.add(k); f.push(i, twin(i)); } }); return f; };
    test(`${G.MEM_DAILY_PAIRS} different units, two cards each`, () => {
        assert.equal(p.cards.length, G.MEM_DAILY_PAIRS * 2);
        assert.equal(new Set(p.cards).size, G.MEM_DAILY_PAIRS);
        assert.ok(p.cards.every(k => G.unitByKey(UNITS, k)));
    });
    test("a perfect play: finished in 10 moves", () => {
        assert.deepEqual(G.dailyResult(UNITS, day, { flips: perfect() }), { game: "memory", finished: true, won: true, score: 10, total: 10 });
    });
    test("a miss costs a move; half done isn't finished", () => {
        const f = perfect();
        const a = f[0], b = f[2]; // two cards of different pairs
        const r = G.dailyResult(UNITS, day, { flips: [a, b, ...f] });
        assert.equal(r.finished, true);
        assert.equal(r.score, 11);
        assert.equal(G.dailyResult(UNITS, day, { flips: f.slice(0, 6) }).finished, false);
    });
    test("impossible plays are refused", () => {
        const f = perfect();
        assert.equal(G.dailyResult(UNITS, day, { flips: [f[0], f[1], f[0]] }), null, "a card already found");
        assert.equal(G.dailyResult(UNITS, day, { flips: [f[0], f[0]] }), null, "the open card again");
        assert.equal(G.dailyResult(UNITS, day, { flips: [99] }), null, "no such card");
        assert.equal(G.dailyResult(UNITS, day, { flips: [0.5] }), null, "not a card");
        assert.equal(G.dailyResult(UNITS, day, { flips: [...f, f[0]] }), null, "after the last pair");
        assert.equal(G.dailyResult(UNITS, day, { flips: "1,2" }), null);
        assert.equal(G.dailyResult(UNITS, day, { flips: new Array(G.MEM_MAX_FLIPS + 2).fill(0) }), null, "too long");
    });
});

describe("the levels", () => {
    test("cards double to 64, the time grows, then 64 with less time (never under a minute)", () => {
        const rows = [1, 2, 3, 4, 5, 6, 7, 20].map(n => [G.memLevelInfo(n).cards, G.memLevelInfo(n).ms / 1000]);
        assert.deepEqual(rows, [[4, 18], [8, 26], [16, 42], [32, 74], [64, 138], [64, 124], [64, 112], [64, 60]]);
        assert.equal(G.memPoints(6), 6);
    });
});

describe("a run (the same rules the page plays unranked)", () => {
    const deckOf = (run) => G.memRunDeck(UNITS, run);
    test("waits for start; a cleared level scores its number and waits again", () => {
        let run = G.runNew("memory", 12345, 1000);
        assert.equal(run.waiting, true);
        assert.equal(run.deadline, null);
        assert.deepEqual(G.runView(UNITS, run), { level: 1, pairs: 2, cards: 4, cols: 2, ms: 18000, waiting: true, deal: 0 });
        assert.throws(() => G.runStep(UNITS, run, { cards: deckOf(run) }, 1000), /Start the level/);
        run = G.runStep(UNITS, run, { start: true }, 2000).run;
        assert.equal(run.deadline, 2000 + 18000);
        const wrong = deckOf(run).slice(), j = wrong.findIndex(k => k !== wrong[0]);
        [wrong[0], wrong[j]] = [wrong[j], wrong[0]]; // two different cards swapped
        assert.throws(() => G.runStep(UNITS, run, { cards: wrong }, 3000), /aren't this level's cards/);
        assert.throws(() => G.runStep(UNITS, run, { start: true }, 3000), /already started/);
        let s = G.runStep(UNITS, run, { cards: deckOf(run) }, 5000);
        assert.equal(s.feedback.cleared, true);
        assert.equal(s.feedback.points, 1);
        assert.equal(s.feedback.leftMs, 15000);
        assert.equal(s.run.score, 1);
        assert.equal(s.run.waiting, true);
        assert.equal(G.runView(UNITS, s.run).cards, 8);
        run = G.runStep(UNITS, s.run, { start: true }, 6000).run;
        s = G.runStep(UNITS, run, { cards: deckOf(run) }, 7000);
        assert.equal(s.run.score, 3, "1 + 2");
    });
    test("too late: the run ends and shows the cards", () => {
        let run = G.runStep(UNITS, G.runNew("memory", 7, 0), { start: true }, 0).run;
        const late = G.runStep(UNITS, run, { cards: deckOf(run) }, 18001 + G.RUN_GRACE_MS, G.RUN_GRACE_MS);
        assert.equal(late.run.over, true);
        assert.equal(late.feedback.timedOut, true);
        assert.deepEqual(late.feedback.deck, deckOf(run));
        assert.equal(late.run.score, 0);
        const timeUp = G.runStep(UNITS, run, null, 18001);
        assert.equal(timeUp.run.over, true);
    });
    test("an extra life: the same level again with new cards, no points", () => {
        let run = G.runStep(UNITS, G.runNew("memory", 99, 0, { lives: 1 }), { start: true }, 0).run;
        const s = G.runStep(UNITS, run, null, 20000);
        assert.equal(s.run.over, false);
        assert.equal(s.feedback.lifeUsed, true);
        assert.equal(s.run.lives, 0);
        assert.equal(s.run.step, 0, "still level 1");
        assert.equal(s.run.deal, 1);
        assert.equal(s.run.waiting, true);
    });
    test("items: more time on every level", () => {
        const run = G.runStep(UNITS, G.runNew("memory", 5, 0, { extraMs: 4000 }), { start: true }, 0).run;
        assert.equal(run.deadline, 22000);
        assert.equal(G.runView(UNITS, run).ms, 22000);
    });
    test("leaving between levels ends it", () => {
        const s = G.runStep(UNITS, G.runNew("memory", 5, 0), null, 0);
        assert.equal(s.run.over, true);
    });
});

describe("ranked runs on the server", () => {
    let db;
    beforeEach(() => {
        db = memoryFirestore();
        db._data.set("publicProfiles/player1", { name: "Ezra" });
        db._data.set(`gameLeaderboards/${weekOf(Date.now())}`, { scoring: 3 }); // already up to date
        state.db = db;
    });
    const start = async (token = "player-token") => {
        const r = await call("games.js", { token, body: { action: "runStart", game: "memory" } });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        return r.body;
    };
    const answer = (runId, input, token = "player-token") => call("games.js", { token, body: { action: "runAnswer", runId, input } });
    const peek = (runId, p, card, token = "player-token") => call("games.js", { token, body: { action: "runPeek", runId, ...p, card } });
    const withClock = async (ms, fn) => { const real = Date.now; Date.now = () => real() + ms; try { return await fn(); } finally { Date.now = real; } };

    test("a level: start, ask for each card (no database), hand in the deck → its points on the board", async () => {
        const s = await start();
        assert.deepEqual(s.view, { level: 1, pairs: 2, cards: 4, cols: 2, ms: 18000, waiting: true, deal: 0 });
        assert.equal(s.deadline, null, "no clock before the level starts");
        const go = await answer(s.runId, { start: true });
        assert.equal(go.status, 200, JSON.stringify(go.body));
        const p = go.body.view.peek;
        assert.ok(p && p.sig, "a started level comes with what it needs to ask for cards");
        assert.ok(!JSON.stringify(go.body).match(/"key"|cards"\s*:\s*\[/), "the cards themselves aren't sent");
        state.db = touchyDb; // asking for a card must not touch the database
        const deck = [];
        for (let i = 0; i < 4; i++) {
            const r = await peek(s.runId, p, i);
            assert.equal(r.status, 200, JSON.stringify(r.body));
            assert.equal(r.dbUsed, false);
            assert.ok(G.unitByKey(UNITS, r.body.key));
            assert.equal(r.body.img, G.unitByKey(UNITS, r.body.key).img);
            deck.push(r.body.key);
        }
        state.db = db;
        assert.equal(new Set(deck).size, 2);
        const done = await answer(s.runId, { cards: deck });
        assert.equal(done.status, 200, JSON.stringify(done.body));
        assert.equal(done.body.score, 1);
        assert.equal(done.body.feedback.cleared, true);
        assert.equal(done.body.view.waiting, true);
        assert.equal(done.body.view.cards, 8);
        assert.equal(done.body.view.peek, undefined, "the next level's cards can't be asked for before it starts");
        const run = db._data.get(`gameRuns/${s.runId}`);
        const row = db._data.get(`gameLeaderboards/${run.week}/players/player1`);
        assert.equal(row.best.memory, 1);
        assert.equal(row.pts.memory, G.lbRunPoints("memory", 1, run.bonus));
        assert.equal(row.total, G.lbRunPoints("memory", 1, run.bonus));
    });
    test("the server's deck comes from its secret: another secret, other cards", async () => {
        const id = "0123456789abcdef01234567";
        const mine = memDeckFor(id, 0, 32).join();
        process.env.GAMES_SECRET = "a different server";
        resetMemKey();
        try { assert.notEqual(memDeckFor(id, 0, 32).join(), mine); }
        finally { delete process.env.GAMES_SECRET; resetMemKey(); }
        assert.equal(memDeckFor(id, 0, 32).join(), mine, "the same secret, the same cards (the clear check needs that)");
    });
    test("the server's deck can't be worked out from the run's seed (which players get at the end)", async () => {
        const s = await start();
        const run = db._data.get(`gameRuns/${s.runId}`).run;
        // the seed's decks (what a page would deal) vs the server's, for 20 deals of 64 cards
        let same = 0;
        for (let deal = 0; deal < 20; deal++) if (memDeckFor(s.runId, deal, 32).join() === G.memRunDeck(UNITS, { ...run, deal, step: 4 }).join()) same++;
        assert.equal(same, 0);
    });
    test("a wrong deck isn't accepted", async () => {
        const s = await start();
        await answer(s.runId, { start: true });
        const r = await answer(s.runId, { cards: ["archer", "archer", "infantry", "infantry"] });
        const real = memDeckFor(s.runId, 0, 2);
        if (real.join() === "archer,archer,infantry,infantry") return; // (1 in thousands: it was right)
        assert.equal(r.status, 400);
        assert.equal(db._data.get(`gameRuns/${s.runId}`).run.score, 0);
    });
    test("cards can't be asked for with a made-up signature, someone else's level, or a card that isn't there", async () => {
        const s = await start();
        const p = (await answer(s.runId, { start: true })).body.view.peek;
        state.db = touchyDb;
        assert.equal((await peek(s.runId, { ...p, sig: "x".repeat(p.sig.length) }, 0)).status, 403);
        assert.equal((await peek(s.runId, { ...p, deadline: p.deadline + 60000 }, 0)).status, 403, "a longer clock");
        assert.equal((await peek(s.runId, { ...p, pairs: 32 }, 40)).status, 403, "a bigger level");
        assert.equal((await peek(s.runId, { ...p, deal: p.deal + 1 }, 0)).status, 403, "another deal");
        assert.equal((await peek("a".repeat(24), p, 0)).status, 403, "another run");
        assert.equal((await peek(s.runId, p, 0, "player2-token")).status, 403, "another player");
        assert.equal((await peek(s.runId, p, 4)).status, 400, "card 5 of 4");
        assert.equal((await peek(s.runId, p, -1)).status, 400);
        assert.equal((await call("games.js", { body: { action: "runPeek", runId: s.runId, ...p, card: 0 } })).status, 401, "signed out");
        state.db = db;
    });
    test("after the clock runs out: no more cards, and the deck no longer scores", async () => {
        const s = await start();
        const p = (await answer(s.runId, { start: true })).body.view.peek;
        const deck = memDeckFor(s.runId, 0, 2);
        const later = 18000 + G.RUN_GRACE_MS + 1000;
        assert.equal((await withClock(later, () => peek(s.runId, p, 0))).status, 409);
        const r = await withClock(later, () => answer(s.runId, { cards: deck }));
        assert.equal(r.status, 200);
        assert.equal(r.body.over, true);
        assert.equal(r.body.score, 0);
        assert.deepEqual(r.body.feedback.deck, deck, "shown once it's over");
    });
    test("a cleared level can't be handed in twice", async () => {
        const s = await start();
        await answer(s.runId, { start: true });
        const deck = memDeckFor(s.runId, 0, 2);
        assert.equal((await answer(s.runId, { cards: deck })).body.score, 1);
        const again = await answer(s.runId, { cards: deck });
        assert.equal(again.status, 400);
        assert.equal(db._data.get(`gameRuns/${s.runId}`).run.score, 1);
    });
});
