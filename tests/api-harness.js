/* Shared set-up for the api/ tests. Nothing is ever sent to Firebase or PayPal:
   - the database: by default a stand-in that records any use and fails it
     ("was the database touched?"); a test can swap in memoryFirestore() instead,
     a small in-memory copy of the bits of Firestore the routes use;
   - signing in: "player-token" is a normal player (uid "player1"),
     "admin-token" is the admin, anything else is a bad token;
   - fetch(): a stand-in for PayPal (every webhook signature is wrong, and it
     knows of no payments). Any other network call fails the test.
   Require this file before any api/ file. */
const crypto = require("crypto");
const path = require("path");

const API = path.join(__dirname, "..", "api");
const ADMIN_UID = "Ts92RY0ipMYDRJa2s5toQfDYxtp1"; // as in api/_lib.js

const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
Object.assign(process.env, {
    FIREBASE_PROJECT_ID: "ci-test-project",
    FIREBASE_CLIENT_EMAIL: "ci@ci-test-project.iam.gserviceaccount.com",
    FIREBASE_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }),
    PAYPAL_CLIENT_ID: "ci-client", PAYPAL_SECRET: "ci-secret", PAYPAL_WEBHOOK_ID: "ci-webhook", PAYPAL_ENV: "sandbox", // secret-scan: fake
    CRON_SECRET: "ci-cron-secret" // secret-scan: fake
});

const state = { dbUses: [], paypalCalls: [], db: null };
const touchyDb = new Proxy({}, {
    get(_, prop) {
        if (prop === "then" || typeof prop === "symbol") return undefined;
        state.dbUses.push(String(prop));
        throw new Error(`TEST: the database was used (${String(prop)})`);
    }
});
state.db = touchyDb;

function swapModule(name, changes) {
    const file = require.resolve(name);
    const real = require(file);
    require.cache[file].exports = { ...real, ...changes };
}
swapModule("firebase-admin/firestore", { getFirestore: () => state.db });
swapModule("firebase-admin/auth", {
    getAuth: () => ({
        verifyIdToken: async (token) => {
            if (token === "player-token") return { uid: "player1" };
            if (token === "player2-token") return { uid: "player2" };
            if (token === "admin-token") return { uid: ADMIN_UID };
            const e = new Error("Decoding Firebase ID token failed."); e.code = "auth/argument-error"; throw e;
        },
        getUser: async () => { throw new Error("TEST: auth lookup"); }
    })
});
global.fetch = async (url) => {
    url = String(url);
    state.paypalCalls.push(url);
    const reply = (status, data) => ({ ok: status < 300, status, json: async () => data, text: async () => JSON.stringify(data) });
    let u;
    try { u = new URL(url); } catch (e) { throw new Error("TEST: bad URL " + url); }
    // PayPal's API hosts only (api-m.paypal.com / api-m.sandbox.paypal.com) — matched on the host, not anywhere in the text
    if (u.protocol === "https:" && /^api-m\.(sandbox\.)?paypal\.com$/.test(u.hostname)) {
        if (u.pathname === "/v1/oauth2/token") return reply(200, { access_token: "ci-paypal-token" });
        if (u.pathname === "/v1/notifications/verify-webhook-signature") return reply(200, { verification_status: "FAILURE" });
        return reply(404, { name: "RESOURCE_NOT_FOUND" });
    }
    throw new Error("TEST: unexpected network call to " + url);
};

/* A small in-memory Firestore: doc get/set (merge), collection add/where(==)/
   orderBy/limit/get, subcollections, runTransaction with getAll/get/set/update. */
function memoryFirestore() {
    const data = new Map();
    let n = 0;
    const copy = (v) => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
    const snap = (p) => ({ exists: data.has(p), id: p.split("/").pop(), ref: docRef(p), data: () => copy(data.get(p)) });
    const write = (p, v, o) => data.set(p, o && o.merge ? { ...(data.get(p) || {}), ...copy(v) } : copy(v));
    function docRef(p) {
        return { path: p, id: p.split("/").pop(), get: async () => snap(p), set: async (v, o) => write(p, v, o), collection: (c) => colRef(p + "/" + c) };
    }
    function colRef(c, filters = [], order = null, max = Infinity) {
        return {
            path: c,
            doc: (id) => docRef(c + "/" + (id || "auto" + (++n))),
            add: async (v) => { const r = docRef(c + "/auto" + (++n)); write(r.path, v); return r; },
            where: (f, op, v) => { if (op !== "==") throw new Error("TEST: only == is faked"); return colRef(c, [...filters, [f, v]], order, max); },
            orderBy: (f, dir = "asc") => colRef(c, filters, [f, dir], max),
            limit: (k) => colRef(c, filters, order, k),
            get: async () => {
                let docs = [...data.keys()].filter(k => k.startsWith(c + "/") && !k.slice(c.length + 1).includes("/")).map(snap);
                docs = docs.filter(d => filters.every(([f, v]) => d.data()[f] === v));
                if (order) docs.sort((a, b) => (a.data()[order[0]] > b.data()[order[0]] ? 1 : -1) * (order[1] === "desc" ? -1 : 1));
                return { docs: docs.slice(0, max), size: Math.min(docs.length, max), empty: !docs.length };
            }
        };
    }
    return {
        collection: (c) => colRef(c),
        runTransaction: async (fn) => fn({ getAll: async (...refs) => refs.map(r => snap(r.path)), get: async (r) => snap(r.path), set: (r, v, o) => write(r.path, v, o), update: (r, v) => write(r.path, v, { merge: true }) }),
        _data: data,
        _docs: (c) => [...data.entries()].filter(([k]) => k.startsWith(c + "/") && !k.slice(c.length + 1).includes("/")).map(([k, v]) => ({ id: k.split("/").pop(), ...v }))
    };
}

function fakeRes() {
    const res = { statusCode: 0, body: undefined, headers: {} };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    res.send = (b) => { res.body = b; return res; };
    res.end = () => res;
    res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
    return res;
}
// Calls a route like Vercel would: { status, body, dbUsed }
async function call(route, { method = "POST", token, auth, body = {}, headers = {}, rawBody } = {}) {
    const handler = require(path.join(API, route));
    state.dbUses = [];
    const req = { method, headers: { ...headers }, body };
    if (token) req.headers.authorization = "Bearer " + token;
    if (auth) req.headers.authorization = auth;
    if (rawBody !== undefined) req.rawBody = rawBody;
    const res = fakeRes();
    const quiet = console.error, warn = console.warn;
    console.error = () => { }; console.warn = () => { }; // the routes log refusals; keep the test output readable
    try { await handler(req, res); } finally { console.error = quiet; console.warn = warn; }
    return { status: res.statusCode, body: res.body, dbUsed: state.dbUses.length > 0 };
}

module.exports = { ADMIN_UID, state, touchyDb, memoryFirestore, call };
