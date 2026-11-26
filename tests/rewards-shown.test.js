/* What a reward says it is, where it's given: a duplicate from the chest is
   ✨ Stardust (not 🪙), a poll's gift names its ✨ and 💗, and a 1st/2nd/3rd
   giveaway's places can hold every reward a single prize can. Run:  npm test */
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

describe("rewards say what they are", () => {
    test("🧰 the chest: a duplicate gives ✨ back — on every card of a 10-draw too", () => {
        const store = read("store.html");
        assert.match(store, /\$\{x\.duplicate \? "\+" \+ fmtN\(x\.refund\) \+ " ✨" : "NEW"\}/);
        assert.doesNotMatch(store, /x\.refund \+ "🪙"/, "never 🪙");
        assert.doesNotMatch(store, /x\.duplicate \? \["🪙"/, "…nor 🪙 flying out of it");
    });
    test("🗳️ a poll's gift: its ✨ and 💗 are named, and ✨ for what you had already", () => {
        const index = read("index.html");
        assert.match(index, /pollGiftText\(\{ amount: r\.gift\.amount, stardust: r\.gift\.stardust, hearts: r\.gift\.hearts, draws: r\.gift\.draws, items: r\.gift\.items \}\)/);
        assert.match(index, /r\.gift\.dupStardust \? ` \(\+\$\{Number\(r\.gift\.dupStardust\)\.toLocaleString\("en-US"\)\} ✨ for what you already had\)`/);
        assert.doesNotMatch(index, /r\.gift\.dupTokens \? `/, "a duplicate is never 🪙");
    });
    test("🏅 a 1st, 2nd, 3rd… giveaway: each place can have every reward the 🎁 Same prize can (✨ and 💗 too)", () => {
        const admin = read("admin.html");
        const same = [...admin.matchAll(/onclick="secretPrize\.add\('(\w+)'\)"/g)].map(m => m[1]);
        const tierSrc = admin.match(/const kinds = (\[\[.*?\]\]);/);
        assert.ok(tierSrc, "the places' reward buttons");
        const ranked = JSON.parse(tierSrc[1]).map(k => k[0]);
        assert.ok(same.length >= 9, same.join());
        assert.deepEqual([...ranked].sort(), [...same].sort());
        ["stardust", "hearts"].forEach(k => assert.ok(ranked.includes(k), k));
    });
    test("💬 a comment's picture keeps its shape (a reply's text doesn't stretch it)", () => {
        const social = read("social.html");
        assert.match(social, /\.formation-comment-item \{\s*display: flex;\s*align-items: flex-start;/);
    });
});

describe("🏅 a 1st, 2nd, 3rd… giveaway's winners get their place's ✨ and 💗 (api/tokens.js adminPaySecretPrize)", () => {
    const { beforeEach } = require("node:test");
    const { state, memoryFirestore, call, ADMIN_UID } = require("./api-harness");
    let db;
    const pay = (winnerUid) => call("tokens.js", { token: "admin-token", body: { action: "adminPaySecretPrize", giveawayId: "g1", winnerUid } });
    beforeEach(() => {
        db = memoryFirestore();
        db._data.set("users/" + ADMIN_UID, { name: "Admin" });
        db._data.set("secretGiveaways/g1", { title: "Ranked", winners: [{ uid: "player1", place: 1 }, { uid: "player2", place: 2 }, { uid: "p3", place: 3 }] });
        db._data.set("secretGiveaways/g1/private/config", { tiers: [
            { count: 1, prize: { items: [{ kind: "stardust", amount: 5000 }, { kind: "hearts", amount: 50 }, { kind: "tokens", amount: 20 }] } },
            { count: 1, prize: { items: [{ kind: "stardust", amount: 1000 }] } },
            { count: 1, prize: { items: [{ kind: "hearts", amount: 10 }, { kind: "item", itemId: "crown" }] } }
        ] });
        db._data.set("inventories/player1", { stardust: 100, hearts: 5 });
        db._data.set("inventories/p3", { items: { crown: { at: 1 } }, stardust: 0 });
        state.db = db;
    });
    test("each place's ✨ and 💗 land in that winner's inventory — once", async () => {
        const r1 = await pay("player1");
        assert.equal(r1.status, 200, JSON.stringify(r1.body));
        assert.equal(db._data.get("inventories/player1").stardust, 5100);
        assert.equal(db._data.get("inventories/player1").hearts, 55);
        assert.equal(db._data.get("tokenWallets/player1").balance, 20);
        const r2 = await pay("player2");
        assert.equal(r2.status, 200);
        assert.equal(db._data.get("inventories/player2").stardust, 1000);
        assert.equal(db._data.get("inventories/player2").hearts, undefined, "2nd won no 💗");
        const r3 = await pay("p3");
        assert.equal(r3.body.dupStardust > 0, true, "the crown they had: ✨ back, not 🪙");
        assert.equal(db._data.get("inventories/p3").hearts, 10);
        assert.equal(r3.body.dupTokens, 0);
        const again = await pay("player1");
        assert.equal(again.body.alreadyPaid, true);
        assert.equal(db._data.get("inventories/player1").stardust, 5100, "never twice");
    });
});
