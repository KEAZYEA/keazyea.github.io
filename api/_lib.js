/**
 * api/_lib.js
 * Shared helpers used by the api/ routes (PayPal, Firebase Admin, tokens).
 * Not itself an API route (the leading underscore keeps Vercel from treating it as one).
 */
const { initializeApp, getApps, cert } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

/* ---------------- Firebase Admin (singleton) ---------------- */
function getFirebaseAdmin() {
  if (!getApps().length) {
    const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
    if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
      throw new Error("Missing required Firebase Admin env vars (FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY).");
    }
    initializeApp({
      credential: cert({
        projectId: FIREBASE_PROJECT_ID,
        clientEmail: FIREBASE_CLIENT_EMAIL,
        privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
      })
    });
  }
  return {
    firestore: getFirestore,
    auth: getAuth
  };
}

/* ---------------- PayPal ---------------- */
const PAYPAL_ENV = process.env.PAYPAL_ENV || "sandbox";
const PAYPAL_API = PAYPAL_ENV === "live"
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";

async function getPayPalAccessToken() {
  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`
  ).toString("base64");
  const res = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });

  let data;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error(`PayPal auth failed: non-JSON response (status ${res.status})`);
  }

  if (!res.ok || !data.access_token) {
    throw new Error(`PayPal auth failed (status ${res.status}): ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

// The site owner's account: the only one allowed to use admin tools, and
// who refund/chargeback alerts are sent to.
const ADMIN_UID = "Ts92RY0ipMYDRJa2s5toQfDYxtp1";

// Tokens credited on EVERY successful subscription payment (each monthly
// renewal, not just the first), keyed by plan. VIP is the $2 plan, noAds the
// $1 plan — see PLAN_MANIFEST in paypal-catalog.js for the prices.
const TOKENS_PER_PAYMENT = { vip: 180, noAds: 80 };

// Calls the PayPal REST API and returns { status, data } without throwing on
// a non-2xx reply, so callers can react to PayPal's specific error codes.
async function paypalJson(path, { method = "GET", body, headers = {} } = {}) {
  const token = await getPayPalAccessToken();
  const res = await fetch(`${PAYPAL_API}${path}`, {
    method,
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let data = {};
  try { data = await res.json(); } catch (e) { /* empty or non-JSON reply */ }
  return { status: res.status, data };
}

/* ---------------- One-off token packs ----------------
   The ONLY place pack prices live. The page only says WHICH pack; the
   server builds the PayPal order at this price and credits this many
   tokens, so editing the page in a browser can't change either. Bigger
   packs give more tokens per dollar. Prices are in US cents so there's no
   float rounding when comparing against what PayPal says was paid. If you
   change these, change the pack tiles in store.html to match. */
const TOKEN_PACKS = {
  small: { tokens: 70, cents: 100 },
  medium: { tokens: 150, cents: 200 },
  large: { tokens: 240, cents: 300 }
};
const PACK_CURRENCY = "USD";

// Own keys only: TOKEN_PACKS["constructor"] would otherwise be truthy.
function getPack(packId) {
  return typeof packId === "string" && Object.prototype.hasOwnProperty.call(TOKEN_PACKS, packId)
    ? TOKEN_PACKS[packId]
    : null;
}

function packPrice(pack) {
  return (pack.cents / 100).toFixed(2);
}

// Stored on the PayPal order as custom_id, so whoever later sees the
// payment (checkout or webhook) knows who paid and for which pack.
function packCustomId(packId, uid) {
  return `pack:${packId}:${uid}`;
}

function parsePackCustomId(customId) {
  const m = typeof customId === "string" ? customId.match(/^pack:([a-z]+):([^:/]+)$/) : null;
  return m && getPack(m[1]) ? { packId: m[1], uid: m[2] } : null;
}

function amountMatchesPack(amount, pack) {
  return !!amount && !!pack && amount.currency_code === PACK_CURRENCY &&
    Math.round(Number(amount.value) * 100) === pack.cents;
}

// Credits one PayPal capture's tokens, at most once. The checkout call and
// the webhook both land here, and whichever arrives second finds the
// capture id already recorded — it's a fixed document id written in the
// same transaction as the balance change.
async function creditTokenPack(db, { captureId, uid, packId, orderId, amount, source }) {
  const pack = getPack(packId);
  if (!pack || !uid || !captureId) return { credited: false, reason: "unresolved" };
  if (!amountMatchesPack(amount, pack)) return { credited: false, reason: "amount-mismatch" };

  const processedRef = db.collection("processedPaypalCaptures").doc(captureId);
  const walletRef = db.collection("tokenWallets").doc(uid);
  const now = Date.now();
  return db.runTransaction(async (tx) => {
    const [processedSnap] = await tx.getAll(processedRef);
    if (processedSnap.exists) return { credited: false, duplicate: true, tokens: pack.tokens };
    tx.set(processedRef, {
      uid, packId, orderId: orderId || null, tokensGranted: pack.tokens,
      amount: amount.value, currency: amount.currency_code, source, processedAt: now
    });
    tx.set(walletRef, {
      balance: FieldValue.increment(pack.tokens),
      lifetimePurchased: FieldValue.increment(pack.tokens),
      updatedAt: now
    }, { merge: true });
    return { credited: true, tokens: pack.tokens };
  });
}

// Inbox receipt for a pack. Best-effort: the tokens are already credited,
// and a failed message must not fail the purchase or make PayPal retry.
async function notifyPackCredited(db, uid, tokens) {
  try {
    await db.collection("users").doc(uid).collection("personalNotifications").add({
      type: "tokensGranted",
      title: `🪙 +${tokens} tokens added`,
      body: `Your token pack payment went through, and ${tokens} tokens are in your wallet. To use them, enter a Secret Giveaway (Promo → Secret Giveaways) and add them to your entry — each token is one extra chance to win.`,
      createdAt: Date.now(),
      read: false
    });
  } catch (e) {
    console.warn(`Couldn't send token pack notification to ${uid}:`, e.message);
  }
}

// Maps a PayPal Plan ID (from the webhook payload) back to which of our
// two plans it is, so we know which Firestore fields to update.
function planKeyFromPlanId(planId) {
  if (planId === process.env.PAYPAL_VIP_PLAN_ID) return "vip";
  if (planId === process.env.PAYPAL_NOADS_PLAN_ID) return "noAds";
  return null;
}

/* ---------------- Daily reset ----------------
   Everything daily (quest rotation, quest claims, the clan post cooldown)
   resets at 00:00 in ONE timezone, decided here. Never trust a visitor's
   device clock for this: anyone can set their phone a day ahead to try to
   claim tomorrow's quests early. The Firestore rule for clan posts uses the
   same +8h offset, so if you ever change it, change both. */
const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_TZ_OFFSET_MS = parseFloat(process.env.GIVEAWAY_TZ_OFFSET_HOURS || "8") * 60 * 60 * 1000;

function dayKeyFor(ms) {
  return new Date(ms + DAY_TZ_OFFSET_MS).toISOString().slice(0, 10);
}

// Epoch ms of 00:00 (in the reset timezone) on the day containing `ms`.
function dayStartMs(ms) {
  const shifted = ms + DAY_TZ_OFFSET_MS;
  return shifted - (shifted % DAY_MS) - DAY_TZ_OFFSET_MS;
}

/* ---------------- Daily quest rotation ----------------
   Login is always on. On top of it, each day has quests worth exactly
   QUEST_POINTS_PER_DAY tokens, in one of the mixes below: "check out"
   quests pay 1, "do something" quests pay 2. The day's set is DERIVED from
   the date rather than stored, so every device and every server instance
   agrees on it without anything needing to have run first. */
const VIEW_QUESTS = ["readNews", "viewUnit", "compareUnits", "readTip", "checkPromo",
  "viewFormation", "viewTierList", "viewProfile", "likeOrVote", "enterWeekly"];
const ACTION_QUESTS = ["postClan", "sendMessage", "shareFormation", "shareTierList", "comment"];
const QUEST_POINTS_PER_DAY = 4;
const QUEST_MIXES = [[1, 1, 2], [2, 2], [1, 1, 1, 1]];

// Tokens a quest pays. Login is 1, except the Sunday chest (see sundayLoginReward).
function questReward(questId) {
  if (ACTION_QUESTS.includes(questId)) return 2;
  return 1;
}

// Monday..Sunday day keys of the week containing dayKey (weeks start Monday).
function weekDayKeys(dayKey) {
  const d = new Date(dayKey + "T00:00:00Z");
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  const monday = d.getTime() - sinceMonday * DAY_MS;
  return Array.from({ length: 7 }, (_, i) => new Date(monday + i * DAY_MS).toISOString().slice(0, 10));
}

function isSundayKey(dayKey) {
  return new Date(dayKey + "T00:00:00Z").getUTCDay() === 0;
}

// Sunday's login is a chest: 3–5 tokens after logging in every day Monday to
// Saturday, otherwise the usual 1. `loggedInDays` is a Set of day keys.
function sundayLoginReward(dayKey, loggedInDays, random = Math.random) {
  const monToSat = weekDayKeys(dayKey).slice(0, 6);
  const fullStreak = monToSat.every(k => loggedInDays.has(k));
  return { fullStreak, reward: fullStreak ? 3 + Math.floor(random() * 3) : 1 };
}

// FNV-1a: turns the date into a stable 32-bit seed.
function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Small seeded PRNG, so the shuffle below is identical every time for a date.
function seededRandom(seed) {
  return function () {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(list, rand) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function questsForDay(dayKey) {
  // Weekly giveaway entries are closed on Sundays (draw day), so that quest
  // must never come up then — it would be impossible to complete.
  const views = VIEW_QUESTS.filter(q => !(isSundayKey(dayKey) && q === "enterWeekly"));
  const rand = seededRandom(hashString("kih-quests-v2:" + dayKey));
  const mix = QUEST_MIXES[Math.floor(rand() * QUEST_MIXES.length)];
  const viewPick = shuffled(views, rand);
  const actionPick = shuffled(ACTION_QUESTS, rand);
  const picked = mix.map(points => (points === 2 ? actionPick : viewPick).shift());
  return ["login", ...picked];
}

// { questId: tokens } for a day's quests, for the page to show.
function questRewardsFor(quests) {
  const out = {};
  quests.forEach(q => { out[q] = questReward(q); });
  return out;
}

/* ---------------- Small shared helpers ---------------- */
// Same ban test the Firestore rules use: banned with no end date, or an end
// date that hasn't arrived yet.
function isBannedNow(user) {
  if (!user || user.banned !== true) return false;
  const until = user.banUntil || 0;
  return until === 0 || until > Date.now();
}

// createdAt is stored as plain epoch ms everywhere today, but this also
// accepts a Firestore Timestamp so a future change can't silently fail checks.
function toMillis(v) {
  if (typeof v === "number") return v;
  if (v && typeof v.toMillis === "function") return v.toMillis();
  return 0;
}

module.exports = {
  getFirebaseAdmin, getPayPalAccessToken, PAYPAL_API, paypalJson, ADMIN_UID, planKeyFromPlanId, TOKENS_PER_PAYMENT,
  TOKEN_PACKS, PACK_CURRENCY, getPack, packPrice, packCustomId, parsePackCustomId, amountMatchesPack,
  creditTokenPack, notifyPackCredited,
  DAY_MS, dayKeyFor, dayStartMs, questsForDay, isBannedNow, toMillis,
  VIEW_QUESTS, ACTION_QUESTS, QUEST_POINTS_PER_DAY, questReward, questRewardsFor, weekDayKeys, isSundayKey, sundayLoginReward
};
