/**
 * api/progress.js
 * Achievements (claimed for tokens), profile badges, profile likes and item
 * chests. Tokens and items are only ever changed here, on the server; the
 * rules (progress-core.js) are shared with the pages so both show the same.
 *
 * POST JSON { action, ... } with "Authorization: Bearer <Firebase ID token>":
 *   status                     -> what you've counted for each achievement, what's
 *                                 claimed, your badges, items, perks, likes, balance
 *   track   { kind, proofId }  -> counts one thing you did, checked against the
 *                                 database by id (kind: post, comment, visit, secret)
 *   claim   { achievementId }  -> pays every tier of it you've reached and not
 *   claim   { all: true }         claimed yet (or of every achievement)
 *   badges  { badges: [ids] }  -> the (up to 3) achievements shown on your profile
 *   like / unlike { targetUid } -> 👍 someone's profile (or take it back)
 *   openChest                  -> spends the chest's price on one random item
 *
 * What's counted, and where from:
 *   posts, comments, visits, likesGiven, secret — one event doc each, with a
 *     fixed id (e.g. "comment_f_<postId>"), so nothing counts twice:
 *     achievementEvents/{uid}/events/{eventId}  { kind, at }
 *   logins, puzzles   — your claim docs (tokenWallets/{uid}/claims)
 *   weekly            — your weekly giveaway entries (giveawayEntries)
 *   purchases         — token pack captures + subscription payments
 *   lbTop5            — weekly Games winners lists (gameLeaderboards/{week})
 *   likesReceived     — playerCards/{uid}.likeCount
 *   gamePoints        — achievementStats/{uid}.gamePoints, added to by api/games.js
 *   items             — inventories/{uid}.items
 *
 * Data (written only here and in api/games.js; the Firestore rules let
 * clients read their own, and anyone signed in read playerCards):
 *   achievementStats/{uid}   { claimed: {achievementId: tiers}, gamePoints, backfilledAt }
 *   playerCards/{uid}        { badges: [{a, t}], likeCount, itemCount }   (public)
 *   profileLikes/{target}/likers/{uid}  { active, at }
 *   inventories/{uid}        { items: {itemId: {at}}, perks, count }
 *   chestOpens/{id}          a log of every chest opened
 */

const crypto = require("crypto");
const { getFirebaseAdmin, dayKeyFor, weekDayKeys, isBannedNow, toMillis } = require("./_lib");
const { FieldValue } = require("firebase-admin/firestore");
const P = require("../progress-core.js");
const G = require("../games-core.js");

const MIN_COMMENT_CHARS = 8; // same as the comment quest

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function isDocId(s) {
  return typeof s === "string" && s.length > 0 && s.length <= 200 && !s.includes("/");
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
  if (snap.exists && isBannedNow(snap.data())) throw new HttpError(403, "Your account is currently restricted.");
}

const statsRef = (db, uid) => db.collection("achievementStats").doc(uid);
const cardRef = (db, uid) => db.collection("playerCards").doc(uid);
const invRef = (db, uid) => db.collection("inventories").doc(uid);
const eventsOf = (db, uid) => db.collection("achievementEvents").doc(uid).collection("events");
const weekOf = (ms) => weekDayKeys(dayKeyFor(ms))[0]; // that week's Monday, as api/games.js

/* ---------------- counting ---------------- */
const countOf = async (q) => (await q.count().get()).data().count;

// The first time someone opens their achievements, what they did before
// achievements existed is counted too: their posts still on the site, the
// secret giveaways they're in, and their Games weekly points. Event ids are
// the same ones `track` uses, so nothing is counted twice afterwards.
async function backfill(db, uid, now) {
  const events = eventsOf(db, uid);
  const [formations, tierLists, clan, secrets, weeks] = await Promise.all([
    db.collection("formationPosts").where("uid", "==", uid).get(),
    db.collection("tierLists").where("uid", "==", uid).get(),
    db.collection("clanPosts").doc(uid).get(),
    db.collection("secretGiveaways").get(),
    db.collection("gameLeaderboards").get()
  ]);
  const ids = [];
  formations.docs.forEach(d => ids.push([`post_f_${d.id}`, "post", toMillis(d.data().createdAt)]));
  tierLists.docs.forEach(d => ids.push([`post_t_${d.id}`, "post", toMillis(d.data().createdAt)]));
  if (clan.exists && clan.data().uid === uid) ids.push([`post_clan_${dayKeyFor(toMillis(clan.data().createdAt) || now)}`, "post", toMillis(clan.data().createdAt)]);
  const entries = await Promise.all(secrets.docs.map(g => g.ref.collection("entries").doc(uid).get()));
  entries.forEach((e, i) => { if (e.exists) ids.push([`secret_${secrets.docs[i].id}`, "secret", toMillis(e.data().enteredAt)]); });
  const rows = await Promise.all(weeks.docs.map(w => w.ref.collection("players").doc(uid).get()));
  const pastPoints = rows.reduce((s, r) => s + (r.exists ? G.lbTotal({ pts: G.lbPts(r.data()) }) : 0), 0);

  let batch = db.batch(), n = 0;
  for (const [id, kind, at] of ids) {
    batch.set(events.doc(id), { kind, at: at || now }, { merge: true });
    if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
  }
  if (n % 400) await batch.commit();
  await db.runTransaction(async (tx) => {
    const [s] = await tx.getAll(statsRef(db, uid));
    const d = s.exists ? s.data() : {};
    if (d.backfilledAt) return;
    // Games points counted since then are already in gamePoints; the weekly
    // rows can't be split by run, so take whichever is bigger.
    tx.set(statsRef(db, uid), { backfilledAt: now, gamePoints: Math.max(d.gamePoints || 0, pastPoints) }, { merge: true });
  });
}

async function computeStats(db, uid, now) {
  let statsSnap = await statsRef(db, uid).get();
  if (!(statsSnap.exists && statsSnap.data().backfilledAt)) {
    await backfill(db, uid, now);
    statsSnap = await statsRef(db, uid).get();
  }
  const events = eventsOf(db, uid);
  const claims = db.collection("tokenWallets").doc(uid).collection("claims");
  const [posts, comments, visits, likesGiven, secret, logins, puzzles, weekly, packs, subs, weeks, card, inv] = await Promise.all([
    countOf(events.where("kind", "==", "post")),
    countOf(events.where("kind", "==", "comment")),
    countOf(events.where("kind", "==", "visit")),
    countOf(events.where("kind", "==", "like")),
    countOf(events.where("kind", "==", "secret")),
    countOf(claims.where("questId", "==", "login")),
    countOf(claims.where("questId", "==", "dailyPuzzle")),
    countOf(db.collection("giveawayEntries").where("uid", "==", uid)),
    countOf(db.collection("processedPaypalCaptures").where("uid", "==", uid)),
    countOf(db.collection("processedPaypalSales").where("uid", "==", uid)),
    db.collection("gameLeaderboards").get(),
    cardRef(db, uid).get(),
    invRef(db, uid).get()
  ]);
  const lbTop5 = weeks.docs.filter(w => (w.data().winners || []).some(x => x.uid === uid)).length;
  const sd = statsSnap.exists ? statsSnap.data() : {};
  return {
    stats: {
      posts, comments, visits, likesGiven, secret, logins, puzzles, weekly, lbTop5,
      purchases: packs + subs,
      likesReceived: card.exists ? Math.max(0, card.data().likeCount || 0) : 0,
      gamePoints: Math.max(0, Math.floor(sd.gamePoints || 0)),
      items: inv.exists ? Object.keys(inv.data().items || {}).length : 0
    },
    claimed: sd.claimed || {},
    card: card.exists ? card.data() : {},
    inv: inv.exists ? inv.data() : {}
  };
}

async function status(db, uid, now) {
  const [{ stats, claimed, card, inv }, wallet] = await Promise.all([
    computeStats(db, uid, now),
    db.collection("tokenWallets").doc(uid).get()
  ]);
  const items = Object.keys(inv.items || {});
  return {
    ok: true, stats, claimed,
    badges: card.badges || [],
    likeCount: Math.max(0, card.likeCount || 0),
    items, perks: P.perksOf(items),
    balance: wallet.exists ? (wallet.data().balance || 0) : 0
  };
}

/* ---------------- track ----------------
   One thing you just did, checked by id. Each makes one event doc with a
   fixed id, so reporting it again (another device, a retry) counts nothing. */
async function eventFor(db, uid, kind, proofId) {
  switch (kind) {
    case "post": {
      if (proofId === "clan") {
        const snap = await db.collection("clanPosts").doc(uid).get();
        if (!snap.exists || snap.data().uid !== uid) return null;
        // One clan post a day is all anyone can make, so a day counts once.
        return { id: `post_clan_${dayKeyFor(toMillis(snap.data().createdAt))}`, kind: "post" };
      }
      const [k, id, extra] = typeof proofId === "string" ? proofId.split("/") : [];
      if (!["f", "t"].includes(k) || !isDocId(id) || extra !== undefined) return null;
      const snap = await db.collection(k === "f" ? "formationPosts" : "tierLists").doc(id).get();
      return snap.exists && snap.data().uid === uid ? { id: `post_${k}_${id}`, kind: "post" } : null;
    }
    case "comment": {
      // Your own comment, with real text, on someone else's post. One per
      // post counts, so ten comments under one post are one.
      const [k, postId, commentId, extra] = typeof proofId === "string" ? proofId.split("/") : [];
      if (!["f", "t"].includes(k) || !isDocId(postId) || !isDocId(commentId) || extra !== undefined) return null;
      const postRef = db.collection(k === "f" ? "formationPosts" : "tierLists").doc(postId);
      const [post, comment] = await Promise.all([postRef.get(), postRef.collection("comments").doc(commentId).get()]);
      if (!post.exists || !comment.exists) return null;
      const c = comment.data();
      const ok = c.uid === uid && post.data().uid !== uid && typeof c.text === "string" && c.text.trim().length >= MIN_COMMENT_CHARS;
      return ok ? { id: `comment_${k}_${postId}`, kind: "comment" } : null;
    }
    case "visit": {
      if (!isDocId(proofId) || proofId === uid) return null;
      const snap = await db.collection("publicProfiles").doc(proofId).get();
      return snap.exists ? { id: `visit_${proofId}`, kind: "visit" } : null;
    }
    case "secret": {
      if (!isDocId(proofId)) return null;
      const snap = await db.collection("secretGiveaways").doc(proofId).collection("entries").doc(uid).get();
      return snap.exists ? { id: `secret_${proofId}`, kind: "secret" } : null;
    }
    default:
      return null;
  }
}

async function track(db, uid, body, now) {
  await assertNotBanned(db, uid);
  const ev = await eventFor(db, uid, body.kind, body.proofId);
  if (!ev) return { ok: true, counted: false, reason: "not-verified" };
  const ref = eventsOf(db, uid).doc(ev.id);
  return db.runTransaction(async (tx) => {
    const [snap] = await tx.getAll(ref);
    if (snap.exists) return { ok: true, counted: false, already: true };
    tx.set(ref, { kind: ev.kind, at: now });
    return { ok: true, counted: true };
  });
}

/* ---------------- claim ---------------- */
async function claim(db, uid, body, now) {
  await assertNotBanned(db, uid);
  const ids = body.all === true ? P.ACHIEVEMENTS.map(a => a.id) : [body.achievementId];
  if (!ids.every(id => P.ACHIEVEMENT_BY_ID[id])) throw new HttpError(400, "Unknown achievement.");
  const { stats } = await computeStats(db, uid, now);
  const walletRef = db.collection("tokenWallets").doc(uid);
  return db.runTransaction(async (tx) => {
    const [s, w, c] = await tx.getAll(statsRef(db, uid), walletRef, cardRef(db, uid));
    const claimed = { ...((s.exists && s.data().claimed) || {}) };
    let paid = 0;
    const newly = [];
    for (const id of ids) {
      const a = P.ACHIEVEMENT_BY_ID[id];
      const have = Math.max(0, Math.floor(claimed[id] || 0));
      const reached = P.tiersReached(a, stats[a.stat]);
      if (reached <= have) continue;
      paid += P.rewardBetween(have, reached);
      claimed[id] = reached;
      newly.push({ id, from: have, to: reached });
    }
    const balance = w.exists ? (w.data().balance || 0) : 0;
    if (!newly.length) return { ok: true, paid: 0, claimed: [], balance, claimedTiers: claimed };
    tx.set(statsRef(db, uid), { claimed }, { merge: true });
    tx.set(walletRef, { balance: balance + paid, lifetimeEarned: FieldValue.increment(paid), updatedAt: now }, { merge: true });
    // Shown badges move up with their tier; someone with none shown yet gets
    // their first ones shown without having to pick.
    let badges = ((c.exists && c.data().badges) || []).filter(b => P.ACHIEVEMENT_BY_ID[b.a]).map(b => ({ a: b.a, t: claimed[b.a] || b.t }));
    if (!badges.length) badges = newly.slice(0, P.MAX_BADGES).map(x => ({ a: x.id, t: x.to }));
    tx.set(cardRef(db, uid), { badges, updatedAt: now }, { merge: true });
    return { ok: true, paid, claimed: newly, balance: balance + paid, claimedTiers: claimed, badges };
  });
}

/* ---------------- badges ---------------- */
async function setBadges(db, uid, body, now) {
  const list = body.badges;
  if (!Array.isArray(list) || list.length > P.MAX_BADGES || new Set(list).size !== list.length || !list.every(id => P.ACHIEVEMENT_BY_ID[id])) {
    throw new HttpError(400, `Pick up to ${P.MAX_BADGES} different badges.`);
  }
  const s = await statsRef(db, uid).get();
  const claimed = (s.exists && s.data().claimed) || {};
  if (!list.every(id => (claimed[id] || 0) >= 1)) throw new HttpError(400, "Claim an achievement before showing its badge.");
  const badges = list.map(id => ({ a: id, t: claimed[id] }));
  await cardRef(db, uid).set({ badges, updatedAt: now }, { merge: true });
  return { ok: true, badges };
}

/* ---------------- profile likes ---------------- */
async function setLike(db, uid, body, now, on) {
  const target = body.targetUid;
  if (!isDocId(target)) throw new HttpError(400, "Missing player.");
  if (target === uid) throw new HttpError(400, "You can't like your own profile.");
  await assertNotBanned(db, uid);
  if (!(await db.collection("publicProfiles").doc(target).get()).exists) throw new HttpError(404, "That player doesn't exist.");
  const likerRef = db.collection("profileLikes").doc(target).collection("likers").doc(uid);
  const eventRef = eventsOf(db, uid).doc(`like_${target}`);
  return db.runTransaction(async (tx) => {
    const [l, c, e] = await tx.getAll(likerRef, cardRef(db, target), eventRef);
    const count = c.exists ? Math.max(0, c.data().likeCount || 0) : 0;
    const active = l.exists && l.data().active === true;
    if (active === on) return { ok: true, liked: on, likeCount: count };
    const likeCount = Math.max(0, count + (on ? 1 : -1));
    tx.set(likerRef, { active: on, at: now }, { merge: true });
    tx.set(cardRef(db, target), { likeCount, updatedAt: now }, { merge: true });
    // Liking someone counts once for the Friendly achievement, ever, so
    // liking and unliking the same person over and over earns nothing.
    if (on && !e.exists) tx.set(eventRef, { kind: "like", at: now });
    return { ok: true, liked: on, likeCount };
  });
}

/* ---------------- chests ---------------- */
async function openChest(db, uid, body, now) {
  await assertNotBanned(db, uid);
  const chest = P.CHEST;
  const walletRef = db.collection("tokenWallets").doc(uid);
  const lbRef = db.collection("gameLeaderboards").doc(weekOf(now)).collection("players").doc(uid);
  const logRef = db.collection("chestOpens").doc(now.toString(36) + crypto.randomBytes(6).toString("hex"));
  const roll = crypto.randomInt(1000000000) / 1000000000;
  return db.runTransaction(async (tx) => {
    const [w, inv, row] = await tx.getAll(walletRef, invRef(db, uid), lbRef);
    const balance = w.exists ? (w.data().balance || 0) : 0;
    if (balance < chest.price) throw new HttpError(400, `A chest costs ${chest.price} 🪙 — you have ${balance}.`);
    const itemId = P.rollItem(roll);
    const items = { ...((inv.exists && inv.data().items) || {}) };
    const duplicate = itemId in items;
    const refund = duplicate ? chest.duplicateRefund : 0;
    const after = balance - chest.price + refund;
    tx.set(walletRef, { balance: after, updatedAt: now }, { merge: true });
    let perks = P.perksOf(Object.keys(items));
    if (!duplicate) {
      items[itemId] = { at: now };
      perks = P.perksOf(Object.keys(items));
      tx.set(invRef(db, uid), { items, perks, count: Object.keys(items).length, updatedAt: now }, { merge: true });
      tx.set(cardRef(db, uid), { itemCount: Object.keys(items).length, updatedAt: now }, { merge: true });
      // A new Games perk counts on this week's board straight away.
      if (row.exists && (row.data().total || 0) > 0) {
        const pts = G.lbPts(row.data());
        const perk = P.gamePerkBonus(perks, pts);
        tx.update(lbRef, { perk, total: G.lbTotal({ pts }) + perk });
      }
    }
    tx.set(logRef, { uid, chest: chest.id, item: itemId, duplicate, price: chest.price, refund, at: now });
    return { ok: true, item: itemId, duplicate, refund, balance: after, items: Object.keys(items), perks };
  });
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "Method not allowed" }); return; }

  const body = req.body || {};
  const now = Date.now();
  try {
    const admin = getFirebaseAdmin();
    const uid = await verifyCaller(admin, req);
    const db = admin.firestore();
    let result;
    switch (body.action) {
      case "status": result = await status(db, uid, now); break;
      case "track": result = await track(db, uid, body, now); break;
      case "claim": result = await claim(db, uid, body, now); break;
      case "badges": result = await setBadges(db, uid, body, now); break;
      case "like": result = await setLike(db, uid, body, now, true); break;
      case "unlike": result = await setLike(db, uid, body, now, false); break;
      case "openChest": result = await openChest(db, uid, body, now); break;
      default: throw new HttpError(400, "Unknown action.");
    }
    res.status(200).json(result);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error("progress failed:", e);
    res.status(status).json({ ok: false, error: status >= 500 ? "Something went wrong — try again." : e.message });
  }
};
