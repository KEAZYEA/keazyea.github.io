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
 *   badges  { badges: [ids] }  -> the achievements shown on your profile (3, or 4
 *                                 with the Badge Pin)
 *   like / unlike { targetUid } -> 👍 someone's profile (or take it back)
 *   openChest { count, free }  -> 1 or 10 draws from the chest (a 10-draw has at
 *                                 least one Rare); free: true spends a free draw
 *                                 (from a Gold achievement tier) instead of tokens
 *   equipStyle { type, id }    -> shows one of your borders / name effects / chat
 *                                 bubbles (id null takes it off)
 *   trickOrTreat { count }     -> 1 or 10 knocks at an event's door (P.EVENTS),
 *                                 only while it's on; each a treat or a trick
 *
 * Claiming an achievement's Gold tier also adds a free chest draw, and
 * its Mythic tier the exclusive items in P.ACHIEVEMENT_REWARDS.
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
 *   playerCards/{uid}        { badges: [{a, t}], likeCount, itemCount,
 *                              style: {border, name, bubble} }   (public)
 *   profileLikes/{target}/likers/{uid}  { active, at }
 *   inventories/{uid}        { items: {id: {at}} (items and styles), perks, count, freeDraws }
 *   chestOpens/{id}          a log of every chest opened
 */

const crypto = require("crypto");
const { getFirebaseAdmin, dayKeyFor, weekDayKeys, isBannedNow, toMillis, ADMIN_UID } = require("./_lib");
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
      // Collector: different things from chests (items and styles)
      items: inv.exists ? Object.keys(inv.data().items || {}).filter(id => P.BY_ID[id] && P.BY_ID[id].chest).length : 0
    },
    claimed: sd.claimed || {},
    card: card.exists ? card.data() : {},
    inv: inv.exists ? inv.data() : {}
  };
}

// Weekly Scroll and the like: their free draws arrive once a week (the
// week starting Monday, Singapore time), the first time you look that week.
function weeklyTopUp(invData, now) {
  const d = invData || {};
  const per = P.perksOf(Object.keys(d.items || {})).weeklyFreeDraw;
  const free = Math.max(0, d.freeDraws || 0);
  const week = weekOf(now);
  if (!(per > 0) || d.weeklyFreeWeek === week) return { freeDraws: free, changed: false };
  return { freeDraws: free + per, weeklyFreeWeek: week, changed: true };
}

// Super Supporter (VIP) right now: it comes with the Supporter Gold border.
async function isVip(db, uid, now) {
  const u = await db.collection("users").doc(uid).get();
  return u.exists && (u.data().vipExpiresAt || 0) > now;
}

async function status(db, uid, now) {
  const [{ stats, claimed, card, inv }, wallet, vip] = await Promise.all([
    computeStats(db, uid, now),
    db.collection("tokenWallets").doc(uid).get(),
    isVip(db, uid, now)
  ]);
  const items = Object.keys(inv.items || {});
  const perks = P.perksOf(items);
  const style = { border: null, name: null, bubble: null, background: null, ...(card.style || {}) };
  let freeDraws = Math.max(0, inv.freeDraws || 0);
  if (weeklyTopUp(inv, now).changed) {
    freeDraws = await db.runTransaction(async (tx) => {
      const [fresh] = await tx.getAll(invRef(db, uid));
      const top = weeklyTopUp(fresh.exists ? fresh.data() : {}, now);
      if (top.changed) tx.set(invRef(db, uid), { freeDraws: top.freeDraws, weeklyFreeWeek: top.weeklyFreeWeek }, { merge: true });
      return top.freeDraws;
    });
  }
  // The VIP border goes when VIP does.
  if (style.border === "b_supporter" && !vip) {
    style.border = null;
    await cardRef(db, uid).set({ style: { border: null }, updatedAt: now }, { merge: true });
  }
  return {
    ok: true, stats, claimed,
    badges: card.badges || [],
    badgeLimit: P.badgeLimit(perks),
    likeCount: Math.max(0, card.likeCount || 0),
    items, perks, style, vip,
    freeDraws,
    pity: inv.pity || { epic: 0, legendary: 0 },
    events: inv.events || {}, // your Trick or Treat counts: { [eventId]: { pity, freeUsed, knocks } }
    balance: wallet.exists ? (wallet.data().balance || 0) : 0
  };
}

// After what you own changes: the inventory, your public item count, and
// this week's Games total (a new Games perk counts on the board at once).
// Call inside a transaction, after all its reads.
function writeInventory(tx, db, uid, items, extra, lbRef, lbSnap, now) {
  const ids = Object.keys(items);
  const perks = P.perksOf(ids);
  tx.set(invRef(db, uid), { items, perks, count: ids.length, updatedAt: now, ...extra }, { merge: true });
  tx.set(cardRef(db, uid), { itemCount: ids.length, updatedAt: now }, { merge: true });
  if (lbSnap && lbSnap.exists && (lbSnap.data().total || 0) > 0) {
    const pts = G.lbPts(lbSnap.data());
    const perk = P.gamePerkBonus(perks, pts, lbSnap.data().dbl);
    tx.update(lbRef, { perk, total: G.lbTotal({ pts }) + perk });
  }
  return perks;
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
  const lbRef = db.collection("gameLeaderboards").doc(weekOf(now)).collection("players").doc(uid);
  return db.runTransaction(async (tx) => {
    const [s, w, c, inv, row] = await tx.getAll(statsRef(db, uid), walletRef, cardRef(db, uid), invRef(db, uid), lbRef);
    const claimed = { ...((s.exists && s.data().claimed) || {}) };
    let paid = 0, freeDraws = 0;
    const newly = [], gifts = [];
    const items = { ...((inv.exists && inv.data().items) || {}) };
    const perTier = Math.max(0, Math.floor(P.perksOf(Object.keys(items)).tierBonus || 0)); // Medal Polish
    let tiers = 0;
    for (const id of ids) {
      const a = P.ACHIEVEMENT_BY_ID[id];
      const have = Math.max(0, Math.floor(claimed[id] || 0));
      const reached = P.tiersReached(a, stats[a.stat]);
      if (reached <= have) continue;
      paid += P.rewardBetween(have, reached);
      tiers += reached - have;
      claimed[id] = reached;
      newly.push({ id, from: have, to: reached });
      // Gold: a free chest draw. Mythic: its exclusive rewards.
      if (have < P.FREE_DRAW_TIER && reached >= P.FREE_DRAW_TIER) freeDraws++;
      if (have < P.TIERS.length && reached >= P.TIERS.length) {
        (P.ACHIEVEMENT_REWARDS[id] || []).forEach(rid => { if (!(rid in items)) { items[rid] = { at: now, from: id }; gifts.push(rid); } });
      }
    }
    const balance = w.exists ? (w.data().balance || 0) : 0;
    if (!newly.length) return { ok: true, paid: 0, claimed: [], balance, claimedTiers: claimed };
    const tierBonus = tiers * perTier;
    paid += tierBonus;
    tx.set(statsRef(db, uid), { claimed }, { merge: true });
    tx.set(walletRef, { balance: balance + paid, lifetimeEarned: FieldValue.increment(paid), updatedAt: now }, { merge: true });
    const totalFree = Math.max(0, (inv.exists && inv.data().freeDraws) || 0) + freeDraws;
    let perks = P.perksOf(Object.keys(items));
    if (gifts.length || freeDraws) perks = writeInventory(tx, db, uid, items, { freeDraws: totalFree }, lbRef, row, now);
    // Shown badges move up with their tier; someone with none shown yet gets
    // their first ones shown without having to pick.
    let badges = ((c.exists && c.data().badges) || []).filter(b => P.ACHIEVEMENT_BY_ID[b.a]).map(b => ({ a: b.a, t: claimed[b.a] || b.t }));
    if (!badges.length) badges = newly.slice(0, P.badgeLimit(perks)).map(x => ({ a: x.id, t: x.to }));
    tx.set(cardRef(db, uid), { badges, updatedAt: now }, { merge: true });
    return { ok: true, paid, tierBonus, claimed: newly, balance: balance + paid, claimedTiers: claimed, badges, freeDraws: totalFree, newFreeDraws: freeDraws, gifts };
  });
}

/* ---------------- badges ---------------- */
async function setBadges(db, uid, body, now) {
  const list = body.badges;
  const [s, inv] = await Promise.all([statsRef(db, uid).get(), invRef(db, uid).get()]);
  const limit = P.badgeLimit(P.perksOf(Object.keys((inv.exists && inv.data().items) || {})));
  if (!Array.isArray(list) || list.length > limit || new Set(list).size !== list.length || !list.every(id => P.ACHIEVEMENT_BY_ID[id])) {
    throw new HttpError(400, `Pick up to ${limit} different badges.`);
  }
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

/* ---------------- the chest ----------------
   1 or 10 draws, with the guarantees in P.drawChest. Anything you already
   own — or get twice in one 10-draw — is a duplicate, paid back in tokens
   by its rarity. A free draw (from a Gold achievement tier) costs nothing. */
async function openChest(db, uid, body, now) {
  await assertNotBanned(db, uid);
  const count = body.count === 10 ? 10 : 1;
  const free = body.free === true;
  if (free && count !== 1) throw new HttpError(400, "A free draw is one draw.");
  const dayKey = dayKeyFor(now);
  const walletRef = db.collection("tokenWallets").doc(uid);
  const lbRef = db.collection("gameLeaderboards").doc(weekOf(now)).collection("players").doc(uid);
  const logRef = db.collection("chestOpens").doc(now.toString(36) + crypto.randomBytes(6).toString("hex"));
  const rolls = Array.from({ length: count }, () => crypto.randomInt(1000000000) / 1000000000);
  const rescue = crypto.randomInt(1000000000) / 1000000000;
  return db.runTransaction(async (tx) => {
    const [w, inv, row] = await tx.getAll(walletRef, invRef(db, uid), lbRef);
    const balance = w.exists ? (w.data().balance || 0) : 0;
    const items = { ...((inv.exists && inv.data().items) || {}) };
    const perksBefore = P.perksOf(Object.keys(items));
    const top = weeklyTopUp(inv.exists ? inv.data() : {}, now);
    const freeLeft = top.freeDraws;
    if (free && freeLeft < 1) throw new HttpError(400, "You don't have a free draw.");
    const price = free ? 0 : P.chestPrice(count, perksBefore);
    if (balance < price) throw new HttpError(400, `That costs ${price} 🪙 — you have ${balance}.`);

    // The draws, with the guarantees (Epic every P.PITY.epic, Legendary every
    // P.PITY.legendary, a Rare in every 10-draw).
    const drawn = P.drawChest(count, rolls, rescue, (inv.exists && inv.data().pity) || {}, dayKey);
    const ids = drawn.ids;
    let refund = 0;
    const results = ids.map(id => {
      if (id in items) {
        const r = P.refundFor(id, perksBefore);
        refund += r;
        return { id, duplicate: true, refund: r };
      }
      items[id] = { at: now };
      return { id, duplicate: false, refund: 0 };
    });
    const after = balance - price + refund;
    tx.set(walletRef, { balance: after, updatedAt: now }, { merge: true });
    const extra = { pity: drawn.pity, ...(free || top.changed ? { freeDraws: freeLeft - (free ? 1 : 0) } : {}), ...(top.changed ? { weeklyFreeWeek: top.weeklyFreeWeek } : {}) };
    const perks = writeInventory(tx, db, uid, items, extra, lbRef, row, now);
    tx.set(logRef, { uid, count, free, price, refund, results, pity: drawn.pity, at: now });
    return { ok: true, count, free, price, refund, results, balance: after, items: Object.keys(items), perks, pity: drawn.pity, freeDraws: free ? freeLeft - 1 : freeLeft };
  });
}

/* ---------------- events: Trick or Treat ----------------
   1 or 10 knocks at the event's door, each a treat (something of the
   event's you don't have yet) or a trick (nothing) — see P.knock. Only while
   the event is on; the admin can knock any time, to try it out. Your first
   knock of an event is free. Once you own all of the event's things you
   can't knock any more (a ×10 that finishes the set pays candy for the
   treats after the last one). Your count of tricks in a row (for the
   guarantee) is kept on your inventory: events.{id}.pity. */
async function trickOrTreat(db, uid, body, now) {
  await assertNotBanned(db, uid);
  const ev = P.activeEvent(dayKeyFor(now)) || (uid === ADMIN_UID && P.EVENTS[body.eventId]) || null;
  if (!ev) throw new HttpError(400, "Trick or Treat isn't on right now.");
  const count = body.count === 10 ? 10 : 1;
  const walletRef = db.collection("tokenWallets").doc(uid);
  const lbRef = db.collection("gameLeaderboards").doc(weekOf(now)).collection("players").doc(uid);
  const logRef = db.collection("chestOpens").doc(now.toString(36) + crypto.randomBytes(6).toString("hex"));
  const rolls = Array.from({ length: count }, () => [crypto.randomInt(1000000000) / 1000000000, crypto.randomInt(1000000000) / 1000000000]);
  return db.runTransaction(async (tx) => {
    const [w, inv, row] = await tx.getAll(walletRef, invRef(db, uid), lbRef);
    const balance = w.exists ? (w.data().balance || 0) : 0;
    const data = inv.exists ? inv.data() : {};
    const items = { ...(data.items || {}) };
    const mine = (data.events || {})[ev.id] || {};
    // Got everything: no more knocking (a treat would only be candy now).
    if (P.eventThings(ev.id).every(x => x.id in items)) throw new HttpError(400, "You've collected every treat — nothing left to knock for!");
    // free: your first knock, or one from a Spooky Gift (bonusKnocks)
    const bonus = Math.max(0, mine.bonusKnocks || 0);
    const free = count === 1 && (!mine.freeUsed || bonus > 0);
    const usesBonus = free && !!mine.freeUsed;
    const price = free ? 0 : P.eventPrice(ev, count);
    if (balance < price) throw new HttpError(400, `That costs ${price} 🪙 — you have ${balance}.`);
    const out = P.knock(ev, count, rolls, Object.keys(items), mine.pity);
    let candy = 0;
    out.results.forEach(r => {
      if (r.id) items[r.id] = { at: now, from: ev.id };
      if (r.candy) candy += r.candy;
    });
    const after = balance - price + candy;
    tx.set(walletRef, { balance: after, updatedAt: now }, { merge: true });
    const state = { pity: out.pity, freeUsed: true, knocks: (mine.knocks || 0) + count, bonusKnocks: usesBonus ? bonus - 1 : bonus };
    const perks = writeInventory(tx, db, uid, items, { events: { [ev.id]: state } }, lbRef, row, now);
    tx.set(logRef, { uid, kind: "event", event: ev.id, count, free, price, refund: candy, results: out.results, at: now });
    return { ok: true, event: ev.id, count, free, price, candy, results: out.results, balance: after, items: Object.keys(items), perks, state };
  });
}

/* ---------------- events: the login gift and the shop ----------------
   eventGift: logging in while an event is on gives you one of its profile
   pictures, picked at random from the ones you don't have — once per event
   (events.{id}.giftId). buyEventItem: the others, for their price in tokens,
   only while the event is on. Both logged in chestOpens like a draw. */
function liveEvent(uid, body, now) {
  return P.activeEvent(dayKeyFor(now)) || (uid === ADMIN_UID && P.EVENTS[body.eventId]) || null;
}
async function eventGift(db, uid, body, now) {
  await assertNotBanned(db, uid);
  const ev = liveEvent(uid, body, now);
  if (!ev) throw new HttpError(400, "There's no event on right now.");
  const pics = P.eventAvatars(ev.id);
  // pictures switched off: nothing given (and nothing recorded, so it comes once they're on)
  if (!pics.length) return { ok: true, already: false, id: null };
  const logRef = db.collection("chestOpens").doc(now.toString(36) + crypto.randomBytes(6).toString("hex"));
  const roll = crypto.randomInt(1000000000) / 1000000000;
  return db.runTransaction(async (tx) => {
    const [inv] = await tx.getAll(invRef(db, uid));
    const data = inv.exists ? inv.data() : {};
    const mine = (data.events || {})[ev.id] || {};
    if (mine.giftId) return { ok: true, already: true, id: mine.giftId };
    const items = { ...(data.items || {}) };
    const missing = pics.filter(p => !(p.id in items));
    const pick = missing.length ? missing[Math.min(missing.length - 1, Math.floor(roll * missing.length))] : null;
    if (pick) items[pick.id] = { at: now, from: ev.id + "_gift" };
    writeInventory(tx, db, uid, items, { events: { [ev.id]: { giftId: pick ? pick.id : "none" } } }, null, null, now);
    tx.set(logRef, { uid, kind: "event", event: ev.id, count: 1, free: true, price: 0, refund: 0, results: pick ? [{ id: pick.id }] : [], gift: true, at: now });
    return { ok: true, already: false, id: pick ? pick.id : null, items: Object.keys(items) };
  });
}
async function buyEventItem(db, uid, body, now) {
  await assertNotBanned(db, uid);
  const ev = liveEvent(uid, body, now);
  if (!ev) throw new HttpError(400, "There's no event on right now.");
  const x = P.eventAvatars(ev.id).find(p => p.id === body.id);
  if (!x || !(x.price > 0)) throw new HttpError(400, "That isn't for sale.");
  const walletRef = db.collection("tokenWallets").doc(uid);
  const logRef = db.collection("chestOpens").doc(now.toString(36) + crypto.randomBytes(6).toString("hex"));
  return db.runTransaction(async (tx) => {
    const [w, inv] = await tx.getAll(walletRef, invRef(db, uid));
    const balance = w.exists ? (w.data().balance || 0) : 0;
    const items = { ...((inv.exists && inv.data().items) || {}) };
    if (x.id in items) throw new HttpError(400, "You already have it.");
    if (balance < x.price) throw new HttpError(400, `That costs ${x.price} 🪙 — you have ${balance}.`);
    items[x.id] = { at: now, from: ev.id + "_shop" };
    tx.set(walletRef, { balance: balance - x.price, updatedAt: now }, { merge: true });
    writeInventory(tx, db, uid, items, {}, null, null, now);
    tx.set(logRef, { uid, kind: "event", event: ev.id, count: 1, free: false, price: x.price, refund: 0, results: [{ id: x.id }], bought: true, at: now });
    return { ok: true, id: x.id, price: x.price, balance: balance - x.price, items: Object.keys(items) };
  });
}

/* ---------------- 🎃 Spooky Gifts ----------------
   While an event with spookyGifts is on, everyone has one gift to send to
   another player (events.{id}.spookyTo once sent). It lands in their inbox
   (users/{to}/personalNotifications/spooky-{giftId}); opening it rolls the
   reward on the server (P.rollSpooky) — tokens, a free chest draw, a free
   knock at the door, or a treat they don't have — once, by them only.
   spookyGifts/{giftId} is server-only. */
async function sendSpookyGift(db, uid, body, now) {
  await assertNotBanned(db, uid);
  const ev = liveEvent(uid, body, now);
  if (!ev || !ev.spookyGifts) throw new HttpError(400, "There are no Spooky Gifts to send right now.");
  const to = body.toUid;
  if (!isDocId(to)) throw new HttpError(400, "Missing player.");
  if (to === uid) throw new HttpError(400, "Send it to someone else — not yourself! 🎃");
  const [toProf, meProf] = await Promise.all([db.collection("publicProfiles").doc(to).get(), db.collection("publicProfiles").doc(uid).get()]);
  if (!toProf.exists) throw new HttpError(404, "That player doesn't exist.");
  const fromName = String((meProf.exists && meProf.data().name) || "Someone").slice(0, 40);
  const fromAvatar = String((meProf.exists && meProf.data().avatar) || "").slice(0, 500);
  const toName = String(toProf.data().name || "them").slice(0, 40);
  const giftId = now.toString(36) + crypto.randomBytes(6).toString("hex");
  const giftRef = db.collection("spookyGifts").doc(giftId);
  const noteRef = db.collection("users").doc(to).collection("personalNotifications").doc("spooky-" + giftId);
  return db.runTransaction(async (tx) => {
    const [inv] = await tx.getAll(invRef(db, uid));
    const mine = ((inv.exists && inv.data().events) || {})[ev.id] || {};
    if (mine.spookyTo) throw new HttpError(400, `You've already sent your Spooky Gift (to ${mine.spookyToName || "someone"}).`);
    tx.set(invRef(db, uid), { events: { [ev.id]: { spookyTo: to, spookyToName: toName } }, updatedAt: now }, { merge: true });
    tx.set(giftRef, { event: ev.id, from: uid, fromName, to, toName, at: now, opened: false });
    tx.set(noteRef, {
      type: "spookyGift", giftId, fromUid: uid, fromName, fromAvatar,
      title: `🎃 ${fromName} sent you a Spooky Gift!`,
      body: "Open it for a random treat — tokens, a free chest draw, a free knock at Trick or Treat, or even a limited Halloween treat.",
      createdAt: now, read: false, opened: false
    });
    return { ok: true, giftId, toName };
  });
}
async function openSpookyGift(db, uid, body, now) {
  if (!isDocId(body.giftId)) throw new HttpError(400, "Missing gift.");
  const giftRef = db.collection("spookyGifts").doc(body.giftId);
  const noteRef = db.collection("users").doc(uid).collection("personalNotifications").doc("spooky-" + body.giftId);
  const walletRef = db.collection("tokenWallets").doc(uid);
  const r1 = crypto.randomInt(1000000000) / 1000000000, r2 = crypto.randomInt(1000000000) / 1000000000;
  return db.runTransaction(async (tx) => {
    const [g, inv, w] = await tx.getAll(giftRef, invRef(db, uid), walletRef);
    if (!g.exists || g.data().to !== uid) throw new HttpError(404, "That gift isn't yours to open.");
    const gd = g.data();
    if (gd.opened) return { ok: true, already: true, reward: gd.reward, text: gd.rewardText };
    const data = inv.exists ? inv.data() : {};
    const items = { ...(data.items || {}) };
    const evLive = P.activeEvent(dayKeyFor(now));
    let roll = P.rollSpooky(r1), reward, text;
    const tokens = (n) => { reward = { kind: "tokens", amount: n }; text = `+${n} 🪙`; };
    if (roll.kind === "tokens") tokens(roll.amount);
    else if (roll.kind === "draw") { reward = { kind: "draw" }; text = "🧰 a free chest draw"; }
    else if (roll.kind === "knock") {
      if (evLive && evLive.id === gd.event) { reward = { kind: "knock" }; text = "🚪 a free knock at Trick or Treat"; } else tokens(10);
    } else {
      const id = P.pickMissingTreat(gd.event, Object.keys(items), r2);
      if (id) { reward = { kind: "treat", id }; text = `${P.BY_ID[id].icon} ${P.BY_ID[id].name}`; } else tokens(10);
    }
    const balance = w.exists ? (w.data().balance || 0) : 0;
    if (reward.kind === "tokens") {
      tx.set(walletRef, { balance: balance + reward.amount, lifetimeGifted: FieldValue.increment(reward.amount), updatedAt: now }, { merge: true });
    } else if (reward.kind === "draw") {
      tx.set(invRef(db, uid), { freeDraws: Math.max(0, data.freeDraws || 0) + 1, updatedAt: now }, { merge: true });
    } else if (reward.kind === "knock") {
      const mine = (data.events || {})[gd.event] || {};
      tx.set(invRef(db, uid), { events: { [gd.event]: { bonusKnocks: Math.max(0, mine.bonusKnocks || 0) + 1 } }, updatedAt: now }, { merge: true });
    } else {
      items[reward.id] = { at: now, from: gd.event + "_spooky" };
      writeInventory(tx, db, uid, items, {}, null, null, now);
    }
    tx.update(giftRef, { opened: true, openedAt: now, reward, rewardText: text });
    tx.set(noteRef, { opened: true, rewardText: text, read: true }, { merge: true });
    return { ok: true, already: false, reward, text, balance: reward.kind === "tokens" ? balance + reward.amount : balance };
  });
}

/* ---------------- styles ----------------
   One border, one name effect and one chat bubble show at a time, on your
   public card. The Supporter Gold border needs Super Supporter (VIP). */
const STYLE_SLOTS = ["border", "name", "bubble", "background"];
async function equipStyle(db, uid, body, now) {
  const type = body.type;
  if (!STYLE_SLOTS.includes(type)) throw new HttpError(400, "Pick a border, name effect, chat bubble or background.");
  const id = body.id == null ? null : body.id;
  if (id !== null) {
    const st = P.STYLE_BY_ID[id];
    if (!st || st.type !== type) throw new HttpError(400, "That isn't one of those.");
    if (st.vip) {
      if (!(await isVip(db, uid, now))) throw new HttpError(400, "The Supporter Gold border comes with Super Supporter.");
    } else {
      const inv = await invRef(db, uid).get();
      if (!(inv.exists && id in (inv.data().items || {}))) throw new HttpError(400, "You don't have that one yet.");
    }
  }
  await cardRef(db, uid).set({ style: { [type]: id }, updatedAt: now }, { merge: true });
  return { ok: true, type, id };
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
      case "equipStyle": result = await equipStyle(db, uid, body, now); break;
      case "trickOrTreat": result = await trickOrTreat(db, uid, body, now); break;
      case "eventGift": result = await eventGift(db, uid, body, now); break;
      case "buyEventItem": result = await buyEventItem(db, uid, body, now); break;
      case "sendSpookyGift": result = await sendSpookyGift(db, uid, body, now); break;
      case "openSpookyGift": result = await openSpookyGift(db, uid, body, now); break;
      default: throw new HttpError(400, "Unknown action.");
    }
    res.status(200).json(result);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error("progress failed:", e);
    res.status(status).json({ ok: false, error: status >= 500 ? "Something went wrong — try again." : e.message });
  }
};
