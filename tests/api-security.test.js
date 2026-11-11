/* Security tests for the api/ routes (what Vercel runs). Each route is called
   directly with a made-up request; nothing is sent to Firebase or PayPal (see
   api-harness.js). They check that each route refuses the wrong method, no
   sign-in, a bad sign-in, a normal player trying admin actions, an unsigned
   cron call and a forged PayPal payment — before the database is touched.
   Run:  npm test   (needs `npm ci` first, for firebase-admin) */
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { state, call } = require("./api-harness");

// each signed-in route, with one ordinary action
const SIGNED_IN = [
    ["chat.js", "send"], ["polls.js", "vote"], ["progress.js", "status"], ["tokens.js", "complete"],
    ["token-packs.js", "createOrder"], ["games.js", "runStart"], ["cancel-subscription.js", undefined],
    ["bug-reports.js", "submit"], ["bug-reports.js", "mine"]
];
const ADMIN_ONLY = [
    ["chat.js", ["adminSettings", "adminStatus"]],
    ["polls.js", ["adminCreate", "adminList", "adminEnd", "adminDelete", "adminRemoveAnswer"]],
    ["tokens.js", ["adminUserTokens", "adminAdjust", "adminSendGift", "adminPaySecretPrize", "adminGrantItems",
        "adminListGifts", "adminEndGift", "adminListAlerts", "adminResolveAlert"]],
    ["bug-reports.js", ["adminList", "adminUpdate"]]
];
const POST_ONLY = ["chat.js", "polls.js", "progress.js", "tokens.js", "token-packs.js", "games.js", "cancel-subscription.js", "paypal-webhook.js", "bug-reports.js"];

describe("only POST is accepted", () => {
    for (const route of POST_ONLY) {
        test(`${route}: GET is refused`, async () => {
            const r = await call(route, { method: "GET" });
            assert.equal(r.status, 405);
            assert.equal(r.dbUsed, false);
        });
    }
});

describe("signing in is required", () => {
    for (const [route, action] of SIGNED_IN) {
        test(`${route} ${action || ""}: no sign-in → 401, database untouched`, async () => {
            const r = await call(route, { body: { action } });
            assert.equal(r.status, 401);
            assert.equal(r.dbUsed, false);
        });
        test(`${route} ${action || ""}: a made-up token → 401, database untouched`, async () => {
            const r = await call(route, { token: "forged.token.value", body: { action } });
            assert.equal(r.status, 401);
            assert.equal(r.dbUsed, false);
        });
        test(`${route} ${action || ""}: "Bearer" with nothing after it → 401`, async () => {
            const r = await call(route, { auth: "Bearer ", body: { action } });
            assert.equal(r.status, 401);
            assert.equal(r.dbUsed, false);
        });
    }
});

describe("admin actions are admin-only", () => {
    for (const [route, actions] of ADMIN_ONLY) {
        for (const action of actions) {
            test(`${route} ${action}: a normal player → 403, database untouched`, async () => {
                const r = await call(route, { token: "player-token", body: { action } });
                assert.equal(r.status, 403);
                assert.equal(r.dbUsed, false);
            });
            // control: the admin gets past the check (so the 403 above really came from it)
            test(`${route} ${action}: the admin gets past the check`, async () => {
                const r = await call(route, { token: "admin-token", body: { action } });
                assert.notEqual(r.status, 403);
                assert.notEqual(r.status, 401);
            });
        }
    }
});

describe("the daily cron job needs its secret", () => {
    test("weekly-notify: no secret → 401, database untouched", async () => {
        const r = await call("weekly-notify.js", { method: "GET" });
        assert.equal(r.status, 401);
        assert.equal(r.dbUsed, false);
    });
    test("weekly-notify: wrong secret → 401", async () => {
        const r = await call("weekly-notify.js", { method: "GET", auth: "Bearer guess" });
        assert.equal(r.status, 401);
        assert.equal(r.dbUsed, false);
    });
    test("weekly-notify: the right secret gets through (control)", async () => {
        const r = await call("weekly-notify.js", { method: "GET", auth: "Bearer ci-cron-secret" });
        assert.notEqual(r.status, 401);
    });
});

describe("forged PayPal payments are rejected", () => {
    const forged = [
        { event_type: "PAYMENT.SALE.COMPLETED", resource: { id: "FAKESALE123", billing_agreement_id: "I-FAKESUB0001", state: "completed" } },
        { event_type: "BILLING.SUBSCRIPTION.ACTIVATED", resource: { id: "I-FAKESUB0002", status: "ACTIVE", custom_id: "player-1" } },
        { event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "FAKECAPTURE1", status: "COMPLETED", custom_id: "player-1" } },
        { event_type: "BILLING.SUBSCRIPTION.CANCELLED", resource: { id: "I-FAKESUB0003", status: "CANCELLED" } }
    ];
    for (const ev of forged) {
        test(`paypal-webhook: forged ${ev.event_type} → rejected, database untouched`, async () => {
            const text = JSON.stringify({ id: "WH-FAKE", ...ev });
            const r = await call("paypal-webhook.js", { body: JSON.parse(text), rawBody: text });
            assert.equal(r.status, 400);
            assert.equal(r.dbUsed, false);
            assert.ok(state.paypalCalls.some(u => u.includes("verify-webhook-signature")), "it asked PayPal to check the signature");
        });
    }
});
