/* 💬 / ➕ on someone's profile (Home's popup — from the leaderboards, polls,
   friend requests): where you stand with them, worked out by appState.js's
   own getFriendStatus, run here against a pretend database. Run: npm test */
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const app = read("appState.js"), index = read("index.html");

// the two functions, word for word from appState.js
function grab(name) {
    const at = app.indexOf(`function ${name}(`);
    assert.ok(at > 0, name);
    let i = app.indexOf("{", at), depth = 0;
    for (; i < app.length; i++) { if (app[i] === "{") depth++; else if (app[i] === "}" && --depth === 0) break; }
    const start = app.lastIndexOf("\n", at) + 1;
    return app.slice(start, i + 1);
}
function make(me, docs) {
    const read = [];
    const fn = new Function("currentUser", "db", "doc", "getDoc", "waitForAuthReady",
        `${grab("friendshipId")}\n${grab("getFriendStatus")}\nreturn getFriendStatus;`);
    const doc = (_db, coll, id) => ({ coll, id });
    const getDoc = async (ref) => { read.push(ref.coll + "/" + ref.id); const d = docs[ref.id]; return { exists: () => !!d, data: () => d }; };
    return { status: fn(me ? { uid: me } : null, {}, doc, getDoc, async () => { }), read };
}

describe("👥 where you stand with someone", () => {
    test("signed out, or it's you: no lookup", async () => {
        const a = make(null, {});
        assert.deepEqual(await a.status("bob"), { status: "signedout" });
        const b = make("amy", {});
        assert.deepEqual(await b.status("amy"), { status: "self" });
        assert.deepEqual(await b.status(""), { status: "self" });
        assert.equal(b.read.length, 0);
    });
    test("one request doc between two people, whichever way round: amy_bob", async () => {
        const a = make("bob", {});
        assert.deepEqual(await a.status("amy"), { status: "none", reqId: "amy_bob" });
        assert.deepEqual(a.read, ["friendRequests/amy_bob"]);
    });
    test("friends · your request waiting · theirs waiting · declined (ask again)", async () => {
        assert.equal((await make("amy", { amy_bob: { fromUid: "amy", toUid: "bob", status: "accepted" } }).status("bob")).status, "friends");
        assert.equal((await make("amy", { amy_bob: { fromUid: "amy", toUid: "bob", status: "pending" } }).status("bob")).status, "sent");
        assert.deepEqual(await make("amy", { amy_bob: { fromUid: "bob", toUid: "amy", status: "pending" } }).status("bob"), { status: "received", reqId: "amy_bob" });
        assert.equal((await make("amy", { amy_bob: { fromUid: "bob", toUid: "amy", status: "declined" } }).status("bob")).status, "none");
    });
    test("it's on AppState", () => {
        assert.match(app, /sendFriendRequest, respondToFriendRequest, getFriendStatus,/);
    });
});

describe("🏠 the profile popup's buttons", () => {
    test("filled in for whoever's opened; 💬 only opens a chat between friends; a stale answer is dropped", () => {
        assert.match(index, /<div class="vp-actions" id="viewProfileActionsHome"><\/div>/);
        assert.match(index, /renderProfileActionsHome\(uid, fallbackName, fallbackAvatar\);/);
        assert.match(index, /if \(token !== profileActionsToken\) return;/);
        assert.match(index, /if \(status !== "friends"\) \{[\s\S]{0,400}?return;\s*\}\s*closeViewProfileModalHome\(\);\s*openInboxFriendChat\(who\.uid, who\.name, who\.avatar\);/);
    });
});
