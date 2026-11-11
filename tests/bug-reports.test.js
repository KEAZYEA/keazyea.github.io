/* 🐞 Bug reports (api/bug-reports.js), start to finish, on an in-memory
   database: a player sends one, the limits hold, only their own screenshots
   are accepted, the admin lists it, replies, marks it fixed, records a gift,
   and the player gets a note in their inbox.
   Run:  npm test */
const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { state, touchyDb, memoryFirestore, call, ADMIN_UID } = require("./api-harness");

const BUCKET = "kc-giveaway.firebasestorage.app";
const shot = (uid, name = "a1b2c3.jpg") => {
    const path = `chatImages/dm/${uid}/${name}`;
    return { path, url: `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(path)}?alt=media&token=x`, w: 1080, h: 2340 };
};
const send = (body, token = "player-token") => call("bug-reports.js", { token, body: { action: "submit", ...body } });

let db;
beforeEach(() => {
    db = memoryFirestore();
    db._data.set("users/player1", { name: "Ezra" });
    state.db = db;
});

describe("sending a report", () => {
    test("a report with words and 2 screenshots is saved, and the admin gets an inbox note", async () => {
        const r = await send({ text: "Games: Start does nothing", images: [shot("player1"), shot("player1", "b.jpg")], page: "Games",
            device: { ua: "Mozilla/5.0 (Linux; Android 14)", screen: "412x915 @2.6x", lang: "en-SG" } });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        const [rep] = db._docs("bugReports");
        assert.equal(rep.uid, "player1");
        assert.equal(rep.name, "Ezra");
        assert.equal(rep.status, "open");
        assert.equal(rep.images.length, 2);
        assert.equal(rep.page, "Games");
        assert.equal(rep.device.screen, "412x915 @2.6x");
        const note = db._docs(`users/${ADMIN_UID}/personalNotifications`);
        assert.equal(note.length, 1);
        assert.match(note[0].title, /bug report from Ezra/);
    });
    test("words only (no screenshots) is fine", async () => {
        assert.equal((await send({ text: "The Store page is blank" })).status, 200);
    });
    test("too few words → 400, nothing saved", async () => {
        const r = await send({ text: "  hi " });
        assert.equal(r.status, 400);
        assert.equal(db._docs("bugReports").length, 0);
    });
    test("over 2000 characters → 400", async () => {
        assert.equal((await send({ text: "x".repeat(2001) })).status, 400);
    });
    test("6 screenshots → 400 (5 is the most)", async () => {
        const r = await send({ text: "Lots of pictures", images: Array.from({ length: 6 }, (_, i) => shot("player1", `p${i}.jpg`)) });
        assert.equal(r.status, 400);
        assert.equal(db._docs("bugReports").length, 0);
    });
    test("someone else's picture → 400, nothing saved", async () => {
        const r = await send({ text: "Look at this", images: [shot("player2")] });
        assert.equal(r.status, 400);
        assert.equal(db._docs("bugReports").length, 0);
    });
    test("a picture from another website → 400", async () => {
        const r = await send({ text: "Look at this", images: [{ ...shot("player1"), url: "https://evil.example/x.jpg" }] });
        assert.equal(r.status, 400);
    });
    test("a picture path that climbs folders → 400", async () => {
        const r = await send({ text: "Look at this", images: [shot("player1", "../player2/x.jpg")] });
        assert.equal(r.status, 400);
    });
    test("bad screenshots are refused before the database is touched", async () => {
        state.db = touchyDb;
        const r = await send({ text: "Look at this", images: [shot("player2")] });
        assert.equal(r.status, 400);
        assert.equal(r.dbUsed, false);
    });
    test("5 a day: the 6th the same day → 429", async () => {
        for (let i = 0; i < 5; i++) assert.equal((await send({ text: "Report number " + i })).status, 200);
        const r = await send({ text: "One too many" });
        assert.equal(r.status, 429);
        assert.equal(db._docs("bugReports").length, 5);
    });
    test("each player has their own 5 a day", async () => {
        for (let i = 0; i < 5; i++) await send({ text: "Report number " + i });
        assert.equal((await send({ text: "From someone else" }, "player2-token")).status, 200);
    });
});

describe("the admin side", () => {
    test("the list shows open ones (newest first) and counts them; closed ones move to Closed", async () => {
        await send({ text: "First problem here" });
        await new Promise(r => setTimeout(r, 5));
        await send({ text: "Second problem here" });
        let r = await call("bug-reports.js", { token: "admin-token", body: { action: "adminList", status: "open" } });
        assert.equal(r.status, 200);
        assert.equal(r.body.open, 2);
        assert.deepEqual(r.body.reports.map(x => x.text), ["Second problem here", "First problem here"]);
        const id = r.body.reports[0].id;
        r = await call("bug-reports.js", { token: "admin-token", body: { action: "adminUpdate", id, status: "fixed", reply: "Fixed in today's update", notify: true } });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        r = await call("bug-reports.js", { token: "admin-token", body: { action: "adminList", status: "open" } });
        assert.equal(r.body.open, 1);
        r = await call("bug-reports.js", { token: "admin-token", body: { action: "adminList", status: "closed" } });
        assert.equal(r.body.reports.length, 1);
        assert.equal(r.body.reports[0].status, "fixed");
        assert.ok(r.body.reports[0].closedAt > 0);
    });
    test("marking it fixed with 'tell them' puts the reply (and the gift) in the player's inbox", async () => {
        await send({ text: "Chest animation freezes" });
        const [rep] = db._docs("bugReports");
        await call("bug-reports.js", { token: "admin-token", body: { action: "adminUpdate", id: rep.id, status: "open", gift: { giftId: "g1", what: "50 tokens" } } });
        const r = await call("bug-reports.js", { token: "admin-token", body: { action: "adminUpdate", id: rep.id, status: "fixed", reply: "Thanks, fixed!", notify: true } });
        assert.equal(r.status, 200);
        const inbox = db._docs("users/player1/personalNotifications");
        assert.equal(inbox.length, 1);
        assert.match(inbox[0].title, /Fixed/);
        assert.match(inbox[0].body, /Thanks, fixed!/);
        assert.match(inbox[0].body, /50 tokens/);
        assert.equal(db._docs("bugReports")[0].gift.what, "50 tokens");
    });
    test("without 'tell them', the player isn't messaged", async () => {
        await send({ text: "Chest animation freezes" });
        const [rep] = db._docs("bugReports");
        await call("bug-reports.js", { token: "admin-token", body: { action: "adminUpdate", id: rep.id, status: "notBug", reply: "", notify: false } });
        assert.equal(db._docs("users/player1/personalNotifications").length, 0);
        assert.equal(db._docs("bugReports")[0].status, "notBug");
    });
    test("reopening clears when it was closed", async () => {
        await send({ text: "Chest animation freezes" });
        const [rep] = db._docs("bugReports");
        await call("bug-reports.js", { token: "admin-token", body: { action: "adminUpdate", id: rep.id, status: "fixed" } });
        await call("bug-reports.js", { token: "admin-token", body: { action: "adminUpdate", id: rep.id, status: "open" } });
        const now = db._docs("bugReports")[0];
        assert.equal(now.status, "open");
        assert.equal(now.closedAt, null);
    });
    test("an unknown status or a report that doesn't exist → 400 / 404", async () => {
        await send({ text: "Chest animation freezes" });
        const [rep] = db._docs("bugReports");
        assert.equal((await call("bug-reports.js", { token: "admin-token", body: { action: "adminUpdate", id: rep.id, status: "deleted" } })).status, 400);
        assert.equal((await call("bug-reports.js", { token: "admin-token", body: { action: "adminUpdate", id: "nope", status: "fixed" } })).status, 404);
    });
});

describe("a player's own reports", () => {
    test("'mine' shows only your reports, with the admin's reply — and not your device details", async () => {
        await send({ text: "Mine: the map is blank", device: { ua: "secret-ish UA" } });
        await send({ text: "Theirs: something else" }, "player2-token");
        const [rep] = db._docs("bugReports").filter(x => x.uid === "player1");
        await call("bug-reports.js", { token: "admin-token", body: { action: "adminUpdate", id: rep.id, status: "fixed", reply: "Fixed!" } });
        const r = await call("bug-reports.js", { token: "player-token", body: { action: "mine" } });
        assert.equal(r.status, 200);
        assert.equal(r.body.reports.length, 1);
        assert.equal(r.body.reports[0].text, "Mine: the map is blank");
        assert.equal(r.body.reports[0].reply, "Fixed!");
        assert.equal(r.body.reports[0].device, undefined);
        assert.equal(r.body.reports[0].uid, undefined);
    });
});
