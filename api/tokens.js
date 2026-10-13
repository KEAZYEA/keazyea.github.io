/**
 * api/tokens.js
 * Earns, stakes and refunds tokens. Tokens decide who wins special
 * giveaways, so the browser is never trusted with them: wallets and claims
 * are unwritable by clients in the Firestore rules, and every change happens
 * on the server through the Admin SDK — here, or for PAID tokens in
 * paypal-webhook.js (subscriptions) and token-packs.js (one-off packs).
 *
 * POST JSON { action, ... }:
 *   today           -> today's quests and when they reset (no sign-in needed)
 *   complete        { questId, proofId } -> marks today's quest done, ready to
 *                                           claim (no token yet), once per quest per day
 *   claim           { claimIds }           -> +1 token per ready reward, paid once
 *   stake           { giveawayId, amount } -> wallet -> your entry
 *   unstake         { giveawayId }         -> refunds your whole stake (before leaving)
 *   reconcile       { giveawayId }         -> after a device switch, moves your
 *                                              stake to the new platform's total
 *   refundGiveaway  { giveawayId }         -> admin only, before deleting: refunds
 *                                              stakes on any platform not yet drawn
 *   claimGift       { giftId }             -> collects an admin gift from the inbox
 *   admin*          (admin only)           -> look up / give / remove / set tokens,
 *                                              send and end gifts, refund alerts
 *
 * Why double-counting can't happen: each claim is a document with a fixed id
 * (`<day>_<quest>`) created inside a transaction. A second device, or the
 * same device tapping twice at the same instant, finds it already exists.
 */

const { getFirebaseAdmin, DAY_MS, dayKeyFor, dayStartMs, questsForDay, isBannedNow, toMillis } = require("./_lib");
const { FieldValue } = require("firebase-admin/firestore");

// Same admin uid used in appState.js and cancel-subscription.js.
const ADMIN_UID = "Ts92RY0ipMYDRJa2s5toQfDYxtp1";

// How far past "now" a createdAt may be and still count as today — absorbs
// small clock differences between the writer's device and this server.
const CLOCK_SLACK_MS = 5 * 60 * 1000;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Firestore ids can't contain "/", and an unchecked one would let a caller
// point a lookup at a different path entirely.
function isDocId(s) {
  return typeof s === "string" && s.length > 0 && s.length <= 200 && !s.includes("/");
}

function counterField(platform) {
  return platform === "ios" ? "iosTokensStaked" : "androidTokensStaked";
}

function incrementsFrom(deltas) {
  const out = {};
  for (const [field, value] of Object.entries(deltas)) {
    if (value) out[field] = FieldValue.increment(value);
  }
  return out;
}

async function verifyCaller(admin, req) {
  const header = req.headers.authorization || "";
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!idToken) throw new HttpError(401, "Sign in first.");
  try {
    return (await admin.auth().verifyIdToken(idToken)).uid;
  } catch (e) {
    throw new HttpError(401, "Your session expired — refresh the page and try again.");
  }
}

async function assertNotBanned(db, uid) {
  const snap = await db.collection("users").doc(uid).get();
  if (snap.exists && isBannedNow(snap.data())) {
    throw new HttpError(403, "Your account is currently restricted.");
  }
}

/* ---------------- Quest proofs ----------------
   Each quest is checked against the thing it claims happened, by id, with a
   direct lookup. A search ("did they post anything today?") would need extra
   Firestore indexes; the page already knows the id of what it just made. */
async function verifyQuestProof(db, uid, questId, proofId, now, dayKey) {
  const dayStart = dayStartMs(now);
  const madeToday = (v) => {
    const ms = toMillis(v);
    return ms >= dayStart && ms <= now + CLOCK_SLACK_MS;
  };

  switch (questId) {
    case "login":
      return true; // a verified ID token already proves they're signed in

    case "postClan": {
      // A user's clan post id IS their uid, so no proof is needed.
      const snap = await db.collection("clanPosts").doc(uid).get();
      return snap.exists && snap.data().uid === uid && madeToday(snap.data().createdAt);
    }

    case "shareFormation":
    case "shareTierList": {
      if (!isDocId(proofId)) return false;
      const coll = questId === "shareFormation" ? "formationPosts" : "tierLists";
      const snap = await db.collection(coll).doc(proofId).get();
      return snap.exists && snap.data().uid === uid && madeToday(snap.data().createdAt);
    }

    case "sendMessage": {
      const [threadId, msgId, extra] = typeof proofId === "string" ? proofId.split("/") : [];
      if (!isDocId(threadId) || !isDocId(msgId) || extra !== undefined) return false;
      const snap = await db.collection("dmThreads").doc(threadId).collection("messages").doc(msgId).get();
      return snap.exists && snap.data().senderUid === uid && madeToday(snap.data().createdAt);
    }

    case "enterWeekly": {
      // The proof is the weekId they entered under: the upcoming Sunday in
      // THEIR local time, which can be a day off from ours. Accept any
      // Sunday from yesterday to a week ahead, i.e. the current draw.
      if (typeof proofId !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(proofId)) return false;
      const daysAhead = Math.round((Date.parse(proofId + "T00:00:00Z") - Date.parse(dayKey + "T00:00:00Z")) / DAY_MS);
      if (daysAhead < -1 || daysAhead > 7) return false;
      const snap = await db.collection("giveawayEntries").doc(`${uid}_${proofId}`).get();
      return snap.exists && snap.data().uid === uid && snap.data().weekId === proofId;
    }

    case "readTip": {
      // Nobody can prove a tip was READ. This only checks the tip is real;
      // the once-per-day claim caps what pretending can earn at 1 token.
      if (!isDocId(proofId)) return false;
      return (await db.collection("tips").doc(proofId).get()).exists;
    }

    default:
      return false;
  }
}

/* ---------------- Quests: complete, then claim ----------------
   Doing a quest only marks it READY (status "ready"); the token arrives when
   the player taps Claim, which flips it to "claimed". A ready reward never
   expires, so missing the reset doesn't cost anyone a token they earned.
   Claim docs written before this two-step flow have no status and were
   already paid, so they count as claimed. */
async function completeQuest(db, uid, body, now, dayKey, resetAt) {
  const { questId, proofId } = body;
  const base = { ok: true, dayKey, resetAt };
  if (!questsForDay(dayKey).includes(questId)) return { ...base, completed: false, reason: "not-active-today" };
  await assertNotBanned(db, uid);
  if (!(await verifyQuestProof(db, uid, questId, proofId, now, dayKey))) {
    return { ...base, completed: false, reason: "not-verified" };
  }

  const claimRef = db.collection("tokenWallets").doc(uid).collection("claims").doc(`${dayKey}_${questId}`);
  return db.runTransaction(async (tx) => {
    const [claimSnap] = await tx.getAll(claimRef);
    if (claimSnap.exists) return { ...base, completed: false, alreadyCompleted: true };
    tx.set(claimRef, {
      questId,
      dayKey,
      proofId: proofId == null ? null : String(proofId).slice(0, 200),
      status: "ready",
      completedAt: now
    });
    return { ...base, completed: true };
  });
}

const MAX_CLAIMS_PER_CALL = 20;

// Pays +1 for each listed reward that's still "ready". Anything already
// claimed (another device, a double tap) or never completed is skipped, so
// sending the same ids twice can't pay twice.
async function claimRewards(db, uid, body, now) {
  const ids = body.claimIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > MAX_CLAIMS_PER_CALL) {
    throw new HttpError(400, "Nothing to claim.");
  }
  const unique = [...new Set(ids)];
  if (!unique.every(id => typeof id === "string" && /^\d{4}-\d{2}-\d{2}_[A-Za-z]+$/.test(id))) {
    throw new HttpError(400, "Nothing to claim.");
  }
  await assertNotBanned(db, uid);

  const walletRef = db.collection("tokenWallets").doc(uid);
  const claimRefs = unique.map(id => walletRef.collection("claims").doc(id));
  return db.runTransaction(async (tx) => {
    const [walletSnap, ...claimSnaps] = await tx.getAll(walletRef, ...claimRefs);
    const balance = walletSnap.exists ? (walletSnap.data().balance || 0) : 0;
    let paid = 0;
    claimSnaps.forEach((snap, i) => {
      if (!snap.exists || snap.data().status !== "ready") return;
      tx.update(claimRefs[i], { status: "claimed", claimedAt: now });
      paid++;
    });
    if (paid) {
      tx.set(walletRef, {
        balance: balance + paid,
        lifetimeEarned: FieldValue.increment(paid),
        updatedAt: now
      }, { merge: true });
    }
    return { ok: true, claimed: paid, balance: balance + paid };
  });
}

/* ---------------- Staking ----------------
   An entry's `tokens` is its stake; its draw weight is 1 + tokens, so
   someone with none still has a chance. `stakePlatform` records which
   platform's running total the stake is currently counted in — after a
   device switch, `platform` changes first and reconcile catches the total up. */
async function stake(db, uid, body, now) {
  const { giveawayId } = body;
  const amount = Number(body.amount);
  if (!isDocId(giveawayId)) throw new HttpError(400, "Missing giveaway.");
  if (!Number.isInteger(amount) || amount < 1) throw new HttpError(400, "Enter a whole number of tokens, 1 or more.");
  await assertNotBanned(db, uid);

  const gRef = db.collection("secretGiveaways").doc(giveawayId);
  const eRef = gRef.collection("entries").doc(uid);
  const wRef = db.collection("tokenWallets").doc(uid);
  return db.runTransaction(async (tx) => {
    const [g, e, w] = await tx.getAll(gRef, eRef, wRef);
    if (!g.exists) throw new HttpError(404, "This giveaway no longer exists.");
    if (!e.exists) throw new HttpError(400, "Enter the giveaway before adding tokens.");
    const gd = g.data();
    const ed = e.data();
    if ((gd.expiresAt || 0) <= now) throw new HttpError(400, "Entries have closed, so tokens can't be added now.");
    const platform = ed.platform;
    if ((gd.winners || []).some(x => x.platform === platform)) {
      throw new HttpError(400, "The draw for your platform has already happened.");
    }
    const balance = w.exists ? (w.data().balance || 0) : 0;
    if (balance < amount) throw new HttpError(400, `You only have ${balance} token${balance === 1 ? "" : "s"}.`);

    const prev = ed.tokens || 0;
    const countedOn = ed.stakePlatform || platform;
    const deltas = {};
    const add = (p, v) => { const f = counterField(p); deltas[f] = (deltas[f] || 0) + v; };
    if (prev > 0 && countedOn !== platform) { add(countedOn, -prev); add(platform, prev); }
    add(platform, amount);

    tx.set(wRef, { balance: balance - amount, updatedAt: now }, { merge: true });
    tx.update(eRef, { tokens: prev + amount, stakePlatform: platform });
    tx.update(gRef, incrementsFrom(deltas));
    return { ok: true, balance: balance - amount, tokens: prev + amount };
  });
}

async function unstake(db, uid, body, now) {
  const { giveawayId } = body;
  if (!isDocId(giveawayId)) throw new HttpError(400, "Missing giveaway.");
  const gRef = db.collection("secretGiveaways").doc(giveawayId);
  const eRef = gRef.collection("entries").doc(uid);
  const wRef = db.collection("tokenWallets").doc(uid);
  return db.runTransaction(async (tx) => {
    const [g, e] = await tx.getAll(gRef, eRef);
    if (!e.exists) return { ok: true, refunded: 0 };
    const ed = e.data();
    const prev = ed.tokens || 0;
    if (prev <= 0) return { ok: true, refunded: 0 };
    if (g.exists && (g.data().winners || []).some(x => x.platform === ed.platform)) {
      throw new HttpError(400, "The draw for your platform has already happened, so these tokens are spent.");
    }
    tx.set(wRef, { balance: FieldValue.increment(prev), updatedAt: now }, { merge: true });
    tx.update(eRef, { tokens: 0 });
    if (g.exists) tx.update(gRef, { [counterField(ed.stakePlatform || ed.platform)]: FieldValue.increment(-prev) });
    return { ok: true, refunded: prev };
  });
}

async function reconcile(db, uid, body) {
  const { giveawayId } = body;
  if (!isDocId(giveawayId)) throw new HttpError(400, "Missing giveaway.");
  const gRef = db.collection("secretGiveaways").doc(giveawayId);
  const eRef = gRef.collection("entries").doc(uid);
  return db.runTransaction(async (tx) => {
    const [g, e] = await tx.getAll(gRef, eRef);
    if (!e.exists) return { ok: true, moved: 0 };
    const ed = e.data();
    const prev = ed.tokens || 0;
    const countedOn = ed.stakePlatform || ed.platform;
    if (prev <= 0 || countedOn === ed.platform) return { ok: true, moved: 0 };
    tx.update(eRef, { stakePlatform: ed.platform });
    if (g.exists) {
      tx.update(gRef, {
        [counterField(countedOn)]: FieldValue.increment(-prev),
        [counterField(ed.platform)]: FieldValue.increment(prev)
      });
    }
    return { ok: true, moved: prev };
  });
}

// Admin-only, run before a giveaway is deleted: entries are the only record
// of who staked what, so this has to finish before they're removed. Stakes
// on a platform that's already been drawn are spent and stay that way.
async function refundGiveaway(db, uid, body, now) {
  if (uid !== ADMIN_UID) throw new HttpError(403, "Not authorized.");
  const { giveawayId } = body;
  if (!isDocId(giveawayId)) throw new HttpError(400, "Missing giveaway.");

  const gRef = db.collection("secretGiveaways").doc(giveawayId);
  const g = await gRef.get();
  const drawn = new Set(g.exists ? (g.data().winners || []).map(w => w.platform) : []);
  const staked = await gRef.collection("entries").where("tokens", ">", 0).get();

  let refundedEntries = 0;
  let refundedTokens = 0;
  let batch = db.batch();
  let ops = 0;
  let deltas = {};
  // Each batch carries its own share of the counter change, so even a run
  // that dies partway leaves balances and totals consistent — and a rerun
  // only touches entries that still have tokens on them.
  const flush = async () => {
    if (!ops) return;
    const inc = incrementsFrom(deltas);
    if (g.exists && Object.keys(inc).length) batch.update(gRef, inc);
    await batch.commit();
    batch = db.batch();
    ops = 0;
    deltas = {};
  };

  for (const doc of staked.docs) {
    const ed = doc.data();
    if (drawn.has(ed.platform)) continue;
    const prev = ed.tokens || 0;
    batch.set(db.collection("tokenWallets").doc(doc.id), { balance: FieldValue.increment(prev), updatedAt: now }, { merge: true });
    batch.update(doc.ref, { tokens: 0 });
    const field = counterField(ed.stakePlatform || ed.platform);
    deltas[field] = (deltas[field] || 0) - prev;
    ops += 2;
    refundedEntries++;
    refundedTokens += prev;
    if (ops >= 400) await flush();
  }
  await flush();
  return { ok: true, refundedEntries, refundedTokens };
}

/* ---------------- Token gifts ----------------
   A gift is admin-made free tokens with an expiry, sent to everyone or to one
   person (e.g. as a giveaway prize). It shows up in the inbox with a Claim
   button; claiming is what credits it, once per person, before it expires.
   tokenGifts/{giftId} is server-only. Who has claimed what is recorded as
   tokenWallets/{uid}/claims/gift_<giftId> (kind "gift"), which the owner
   can already read — the quest queries never match these docs (no dayKey,
   never "ready"), and the quest claim action only accepts dated ids. */
const MAX_GIFT_TOKENS = 100000;
const MAX_ADJUST_TOKENS = 1000000;

function cleanText(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function newId(now) {
  return now.toString(36) + Math.random().toString(36).slice(2, 10);
}

async function claimGift(admin, db, uid, body, now) {
  const { giftId } = body;
  if (!isDocId(giftId)) throw new HttpError(400, "Missing gift.");
  await assertNotBanned(db, uid);

  const giftRef = db.collection("tokenGifts").doc(giftId);
  const first = await giftRef.get();
  if (!first.exists) throw new HttpError(404, "This gift no longer exists.");
  const gift = first.data();
  if (gift.target !== "all" && gift.target !== uid) throw new HttpError(403, "This gift isn't for your account.");
  if ((gift.expiresAt || 0) <= now) throw new HttpError(400, "This gift has expired.");
  if (gift.target === "all") {
    // Only accounts that existed when it was sent. Otherwise every new
    // account could claim it again, turning one gift into unlimited tokens.
    let createdAt = 0;
    try {
      createdAt = Date.parse((await admin.auth().getUser(uid)).metadata.creationTime) || 0;
    } catch (e) { /* unknown → treated as too new */ }
    if (!createdAt || createdAt > gift.createdAt) {
      throw new HttpError(403, "This gift was for accounts that already existed when it was sent.");
    }
  }

  const walletRef = db.collection("tokenWallets").doc(uid);
  const claimRef = walletRef.collection("claims").doc(`gift_${giftId}`);
  return db.runTransaction(async (tx) => {
    const [giftSnap, claimSnap, walletSnap] = await tx.getAll(giftRef, claimRef, walletRef);
    const balance = walletSnap.exists ? (walletSnap.data().balance || 0) : 0;
    if (claimSnap.exists) return { ok: true, claimed: 0, alreadyClaimed: true, balance };
    // Re-checked inside: the admin may have ended it a moment ago.
    if (!giftSnap.exists || (giftSnap.data().expiresAt || 0) <= now) throw new HttpError(400, "This gift has expired.");
    const amount = giftSnap.data().amount;
    tx.set(claimRef, { kind: "gift", giftId, amount, claimedAt: now });
    tx.set(walletRef, {
      balance: balance + amount,
      lifetimeGifted: FieldValue.increment(amount),
      updatedAt: now
    }, { merge: true });
    tx.update(giftRef, { claimCount: FieldValue.increment(1), claimedTokens: FieldValue.increment(amount) });
    return { ok: true, claimed: amount, balance: balance + amount };
  });
}

/* ---------------- Admin tools ----------------
   Everything below is refused unless the caller is ADMIN_UID. Every manual
   balance change is logged in tokenAdjustments (server-only), so there's a
   record of who changed what and why. */
function assertAdmin(uid) {
  if (uid !== ADMIN_UID) throw new HttpError(403, "Not authorized.");
}

async function requireUser(db, uid) {
  if (!isDocId(uid)) throw new HttpError(400, "Missing user.");
  const snap = await db.collection("users").doc(uid).get();
  if (!snap.exists) throw new HttpError(404, "No account with that user id.");
  return snap.data();
}

async function adminUserTokens(db, body) {
  const profile = await requireUser(db, body.uid);
  const [walletSnap, adjSnap] = await Promise.all([
    db.collection("tokenWallets").doc(body.uid).get(),
    db.collection("tokenAdjustments").where("uid", "==", body.uid).get()
  ]);
  const w = walletSnap.exists ? walletSnap.data() : {};
  const adjustments = adjSnap.docs.map(d => d.data()).sort((a, b) => b.at - a.at).slice(0, 15);
  return {
    ok: true,
    uid: body.uid,
    name: profile.name || "",
    balance: w.balance || 0,
    lifetimeEarned: w.lifetimeEarned || 0,
    lifetimePurchased: w.lifetimePurchased || 0,
    lifetimeGifted: w.lifetimeGifted || 0,
    adjustments
  };
}

async function adminAdjust(db, adminUid, body, now) {
  const { uid: target, mode } = body;
  const amount = Number(body.amount);
  const reason = cleanText(body.reason, 200);
  if (!["add", "remove", "set"].includes(mode)) throw new HttpError(400, "Choose add, remove or set.");
  const min = mode === "set" ? 0 : 1;
  if (!Number.isInteger(amount) || amount < min || amount > MAX_ADJUST_TOKENS) {
    throw new HttpError(400, `Enter a whole number${mode === "set" ? " (0 or more)" : " (1 or more)"}.`);
  }
  await requireUser(db, target);

  const walletRef = db.collection("tokenWallets").doc(target);
  const logRef = db.collection("tokenAdjustments").doc(newId(now));
  const result = await db.runTransaction(async (tx) => {
    const [walletSnap] = await tx.getAll(walletRef);
    const before = walletSnap.exists ? (walletSnap.data().balance || 0) : 0;
    // Never below 0: removing more than they have empties the wallet.
    const after = mode === "add" ? before + amount : mode === "remove" ? Math.max(0, before - amount) : amount;
    tx.set(walletRef, { balance: after, updatedAt: now }, { merge: true });
    tx.set(logRef, { uid: target, mode, amount, before, after, reason, by: adminUid, at: now });
    return { before, after };
  });

  const change = result.after - result.before;
  if (body.notify === true && change !== 0) {
    try {
      await db.collection("users").doc(target).collection("personalNotifications").add({
        type: "tokenAdjust",
        title: change > 0 ? `🪙 +${change} tokens added` : "🪙 Your token balance was adjusted",
        body: (change > 0
          ? `An admin added ${change} tokens to your wallet.`
          : `An admin removed ${-change} tokens from your wallet.`) +
          (reason ? ` Reason: ${reason}` : "") + ` You now have ${result.after}.`,
        createdAt: now,
        read: false
      });
    } catch (e) {
      console.warn(`Couldn't notify ${target} about an adjustment:`, e.message);
    }
  }
  return { ok: true, ...result, change };
}

async function adminSendGift(db, adminUid, body, now) {
  const amount = Number(body.amount);
  const hours = Number(body.expiresInHours);
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_GIFT_TOKENS) throw new HttpError(400, "Enter a whole number of tokens, 1 or more.");
  if (!(hours > 0) || hours > 24 * 366) throw new HttpError(400, "Set how long it lasts (up to a year).");
  const target = body.target === "all" ? "all" : body.target;
  let targetName = "";
  if (target !== "all") targetName = (await requireUser(db, target)).name || "";

  const giftId = newId(now);
  const expiresAt = now + Math.round(hours * 3600 * 1000);
  const title = cleanText(body.title, 100) || `🎁 ${amount} free tokens!`;
  const message = cleanText(body.message, 500) ||
    `Here are ${amount} free tokens — tap Claim to add them to your wallet before this expires.`;
  const notifId = `gift-${giftId}`;
  const notifRef = target === "all"
    ? db.collection("notifications").doc(notifId)
    : db.collection("users").doc(target).collection("personalNotifications").doc(notifId);

  await db.collection("tokenGifts").doc(giftId).set({
    target, targetName, amount, title, message, createdAt: now, expiresAt,
    createdBy: adminUid, claimCount: 0, claimedTokens: 0, notificationPath: notifRef.path
  });
  await notifRef.set({
    type: "tokenGift", giftId, amount, expiresAt, title, body: message, createdAt: now,
    ...(target === "all" ? {} : { read: false })
  });
  return { ok: true, giftId, expiresAt };
}

async function adminListGifts(db, now) {
  const since = now - 180 * 24 * 3600 * 1000;
  const snap = await db.collection("tokenGifts").where("createdAt", ">", since).get();
  const gifts = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => b.createdAt - a.createdAt).slice(0, 30);
  return { ok: true, gifts };
}

async function adminEndGift(db, body, now) {
  if (!isDocId(body.giftId)) throw new HttpError(400, "Missing gift.");
  const giftRef = db.collection("tokenGifts").doc(body.giftId);
  const snap = await giftRef.get();
  if (!snap.exists) throw new HttpError(404, "No such gift.");
  if ((snap.data().expiresAt || 0) <= now) return { ok: true, alreadyEnded: true };
  await giftRef.update({ expiresAt: now, endedEarly: true });
  // So the inbox shows it as expired instead of offering a Claim that fails.
  const path = snap.data().notificationPath;
  if (path) {
    try {
      const parts = path.split("/");
      let ref = db.collection(parts[0]).doc(parts[1]);
      for (let i = 2; i < parts.length; i += 2) ref = ref.collection(parts[i]).doc(parts[i + 1]);
      await ref.update({ expiresAt: now });
    } catch (e) {
      console.warn(`Couldn't expire the notification for gift ${body.giftId}:`, e.message);
    }
  }
  return { ok: true };
}

async function adminListAlerts(db) {
  const snap = await db.collection("adminAlerts").where("resolved", "==", false).get();
  const alerts = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => b.createdAt - a.createdAt).slice(0, 50);
  return { ok: true, alerts };
}

async function adminResolveAlert(db, adminUid, body, now) {
  if (!isDocId(body.alertId)) throw new HttpError(400, "Missing alert.");
  const ref = db.collection("adminAlerts").doc(body.alertId);
  if (!(await ref.get()).exists) throw new HttpError(404, "No such alert.");
  await ref.update({ resolved: true, resolvedAt: now, resolvedBy: adminUid });
  return { ok: true };
}

module.exports = async (req, res) => {
  // The site is served from GitHub Pages and this API from Vercel, so the
  // browser sends a CORS preflight first; without these headers it's blocked
  // before reaching any of the code below.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "Method not allowed" }); return; }

  const body = req.body || {};
  const now = Date.now();
  const dayKey = dayKeyFor(now);
  const resetAt = dayStartMs(now) + DAY_MS;

  try {
    if (body.action === "today") {
      res.status(200).json({ ok: true, dayKey, resetAt, quests: questsForDay(dayKey) });
      return;
    }

    const admin = getFirebaseAdmin();
    const uid = await verifyCaller(admin, req);
    const db = admin.firestore();

    let result;
    switch (body.action) {
      case "complete": result = await completeQuest(db, uid, body, now, dayKey, resetAt); break;
      case "claim": result = await claimRewards(db, uid, body, now); break;
      case "stake": result = await stake(db, uid, body, now); break;
      case "unstake": result = await unstake(db, uid, body, now); break;
      case "reconcile": result = await reconcile(db, uid, body); break;
      case "refundGiveaway": result = await refundGiveaway(db, uid, body, now); break;
      case "claimGift": result = await claimGift(admin, db, uid, body, now); break;
      case "adminUserTokens": assertAdmin(uid); result = await adminUserTokens(db, body); break;
      case "adminAdjust": assertAdmin(uid); result = await adminAdjust(db, uid, body, now); break;
      case "adminSendGift": assertAdmin(uid); result = await adminSendGift(db, uid, body, now); break;
      case "adminListGifts": assertAdmin(uid); result = await adminListGifts(db, now); break;
      case "adminEndGift": assertAdmin(uid); result = await adminEndGift(db, body, now); break;
      case "adminListAlerts": assertAdmin(uid); result = await adminListAlerts(db); break;
      case "adminResolveAlert": assertAdmin(uid); result = await adminResolveAlert(db, uid, body, now); break;
      default: throw new HttpError(400, "Unknown action.");
    }
    res.status(200).json(result);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error("tokens failed:", e);
    res.status(status).json({ ok: false, error: status >= 500 ? "Something went wrong — try again." : e.message });
  }
};
