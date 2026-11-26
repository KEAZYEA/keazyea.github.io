/* 🏰 The Keep: 🪙 for each of its things the first time you find it
   (api/progress.js keepFinds). The Keep saves in the browser, so the server
   takes the player's word for what they've found — what it must never do is
   pay for a thing twice, or for anything that isn't one of The Keep's.
   Runs on an in-memory database. Run:  npm test */
const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { state, memoryFirestore, call } = require("./api-harness");
const D = require("../dungeon-core.js");

describe("🏰 The Keep: 🪙 for a new find (api/progress.js keepFinds)", () => {
    let db;
    const act = (body, token = "player-token") => call("progress.js", { token, body });
    const wallet = () => db._data.get("tokenWallets/player1") || {};
    beforeEach(() => {
        db = memoryFirestore();
        db._data.set("users/player1", { name: "Ezra" });
        db._data.set("tokenWallets/player1", { balance: 10, lifetimeEarned: 5 });
        state.db = db;
    });

    test("1 🪙 a thing, the first time — counted as earned", async () => {
        assert.equal(D.FIND_TOKENS, 1);
        const r = await act({ action: "keepFinds", ids: ["bone"] });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.paid, 1);
        assert.deepEqual(r.body.fresh, ["bone"]);
        assert.deepEqual(r.body.found, ["bone"]);
        assert.equal(r.body.balance, 11);
        assert.equal(wallet().balance, 11);
        assert.equal(wallet().lifetimeEarned, 6, "earned, like Games (the admin's token check adds up)");
        const f = db._data.get("keepFinds/player1");
        assert.deepEqual(Object.keys(f.ids), ["bone"]);
        assert.equal(f.count, 1);
        assert.equal(f.tokens, 1);
    });

    test("never twice for the same thing — asked again, or twice in one go", async () => {
        await act({ action: "keepFinds", ids: ["bone"] });
        const again = await act({ action: "keepFinds", ids: ["bone"] });
        assert.equal(again.status, 200);
        assert.equal(again.body.paid, 0);
        assert.deepEqual(again.body.found, ["bone"], "…and it says what's already paid for (the page remembers it)");
        assert.equal(wallet().balance, 11);
        const dup = await act({ action: "keepFinds", ids: ["fang", "fang", "fang", "bone"] });
        assert.equal(dup.body.paid, 1, "fang once; bone was paid already");
        assert.deepEqual(dup.body.fresh, ["fang"]);
        assert.deepEqual(dup.body.found.sort(), ["bone", "fang"]);
        assert.equal(wallet().balance, 12);
        assert.equal(wallet().lifetimeEarned, 7);
    });

    test("several at once (what you'd found before this) — and never more than The Keep has", async () => {
        const all = Object.keys(D.ITEMS);
        assert.equal(all.length, 76);
        const r = await act({ action: "keepFinds", ids: all });
        assert.equal(r.body.paid, all.length * D.FIND_TOKENS);
        assert.equal(wallet().balance, 10 + all.length);
        const more = await act({ action: "keepFinds", ids: all });
        assert.equal(more.body.paid, 0, "everything's paid for: nothing more, ever");
        assert.equal(wallet().balance, 10 + all.length);
        assert.equal(db._data.get("keepFinds/player1").tokens, all.length);
    });

    test("only The Keep's own things count: made-up ids, the app's items, odd values — nothing paid", async () => {
        for (const ids of [["notAThing"], ["crown"], ["__proto__"], ["constructor"], ["toString"], [42], [null], [{ id: "bone" }], [], undefined, "bone"]) {
            const r = await act({ action: "keepFinds", ids });
            assert.equal(r.status, 400, JSON.stringify(ids));
        }
        const mixed = await act({ action: "keepFinds", ids: ["notAThing", "bone", "__proto__"] });
        assert.equal(mixed.body.paid, 1, "the real one only");
        assert.equal(wallet().balance, 11);
        const tooMany = await act({ action: "keepFinds", ids: Array(201).fill("bone") });
        assert.equal(tooMany.status, 400);
        assert.equal(wallet().balance, 11);
    });

    test("each account is paid for its own finds", async () => {
        db._data.set("users/player2", { name: "Bo" });
        await act({ action: "keepFinds", ids: ["bone"] });
        const r = await act({ action: "keepFinds", ids: ["bone"] }, "player2-token");
        assert.equal(r.body.paid, 1);
        assert.equal(db._data.get("tokenWallets/player2").balance, 1, "a wallet that wasn't there yet");
        assert.equal(wallet().balance, 11);
    });

    test("signed in only; a restricted account gets nothing", async () => {
        const anon = await call("progress.js", { body: { action: "keepFinds", ids: ["bone"] } });
        assert.equal(anon.status, 401);
        db._data.set("users/player1", { name: "Ezra", banned: true, banUntil: 0 });
        const r = await act({ action: "keepFinds", ids: ["bone"] });
        assert.equal(r.status, 403);
        assert.equal(wallet().balance, 10);
        assert.equal(db._data.has("keepFinds/player1"), false);
    });
});
