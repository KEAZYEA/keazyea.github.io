/* 🏰 The Keep: 🪙 for each of its rare (or better) things the first time you
   find it (api/progress.js keepFinds) — common and uncommon ones pay nothing. The Keep saves in the browser, so the server
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
        const r = await act({ action: "keepFinds", ids: ["frost"] });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.paid, 1);
        assert.deepEqual(r.body.fresh, ["frost"]);
        assert.deepEqual(r.body.found, ["frost"]);
        assert.equal(r.body.balance, 11);
        assert.equal(wallet().balance, 11);
        assert.equal(wallet().lifetimeEarned, 6, "earned, like Games (the admin's token check adds up)");
        const f = db._data.get("keepFinds/player1");
        assert.deepEqual(Object.keys(f.ids), ["frost"]);
        assert.equal(f.count, 1);
        assert.equal(f.tokens, 1);
    });

    test("never twice for the same thing — asked again, or twice in one go", async () => {
        await act({ action: "keepFinds", ids: ["frost"] });
        const again = await act({ action: "keepFinds", ids: ["frost"] });
        assert.equal(again.status, 200);
        assert.equal(again.body.paid, 0);
        assert.deepEqual(again.body.found, ["frost"], "…and it says what's already paid for (the page remembers it)");
        assert.equal(wallet().balance, 11);
        const dup = await act({ action: "keepFinds", ids: ["ember", "ember", "ember", "frost"] });
        assert.equal(dup.body.paid, 1, "ember once; frost was paid already");
        assert.deepEqual(dup.body.fresh, ["ember"]);
        assert.deepEqual(dup.body.found.sort(), ["ember", "frost"]);
        assert.equal(wallet().balance, 12);
        assert.equal(wallet().lifetimeEarned, 7);
    });

    test("several at once (what you'd found before this) — and never more than The Keep's 50 rare-or-better things", async () => {
        const all = Object.keys(D.ITEMS).filter(D.findPays);
        assert.equal(all.length, 50);
        assert.ok(all.every(id => ["rare", "epic", "legendary"].includes(D.ITEMS[id].rarity)));
        const r = await act({ action: "keepFinds", ids: all });
        assert.equal(r.body.paid, all.length * D.FIND_TOKENS);
        assert.equal(wallet().balance, 10 + all.length);
        const more = await act({ action: "keepFinds", ids: all });
        assert.equal(more.body.paid, 0, "everything's paid for: nothing more, ever");
        assert.equal(wallet().balance, 10 + all.length);
        assert.equal(db._data.get("keepFinds/player1").tokens, all.length);
    });

    test("only The Keep's own rare-or-better things count: common ones, made-up ids, the app's items, odd values — nothing paid", async () => {
        // common and uncommon things (bone, iron scrap) never pay
        assert.equal(D.ITEMS.bone.rarity, "common"); assert.equal(D.ITEMS.iron.rarity, "uncommon");
        assert.equal(D.findPays("bone"), false); assert.equal(D.findPays("frost"), true);
        for (const ids of [["bone"], ["iron", "herb"], ["notAThing"], ["crown"], ["__proto__"], ["constructor"], ["toString"], [42], [null], [{ id: "frost" }], [], undefined, "frost"]) {
            const r = await act({ action: "keepFinds", ids });
            assert.equal(r.status, 400, JSON.stringify(ids));
        }
        const mixed = await act({ action: "keepFinds", ids: ["notAThing", "bone", "frost", "iron", "__proto__"] });
        assert.equal(mixed.body.paid, 1, "the real one only");
        assert.equal(wallet().balance, 11);
        const tooMany = await act({ action: "keepFinds", ids: Array(201).fill("frost") });
        assert.equal(tooMany.status, 400);
        assert.equal(wallet().balance, 11);
    });

    test("each account is paid for its own finds", async () => {
        db._data.set("users/player2", { name: "Bo" });
        await act({ action: "keepFinds", ids: ["frost"] });
        const r = await act({ action: "keepFinds", ids: ["frost"] }, "player2-token");
        assert.equal(r.body.paid, 1);
        assert.equal(db._data.get("tokenWallets/player2").balance, 1, "a wallet that wasn't there yet");
        assert.equal(wallet().balance, 11);
    });

    test("signed in only; a restricted account gets nothing", async () => {
        const anon = await call("progress.js", { body: { action: "keepFinds", ids: ["frost"] } });
        assert.equal(anon.status, 401);
        db._data.set("users/player1", { name: "Ezra", banned: true, banUntil: 0 });
        const r = await act({ action: "keepFinds", ids: ["frost"] });
        assert.equal(r.status, 403);
        assert.equal(wallet().balance, 10);
        assert.equal(db._data.has("keepFinds/player1"), false);
    });
});
