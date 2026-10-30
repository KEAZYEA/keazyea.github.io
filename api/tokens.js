/**
 * api/tokens.js
 * Earns, stakes and refunds tokens. Tokens decide who wins special
 * giveaways, so the browser is never trusted with them: wallets and claims
 * are unwritable by clients in the Firestore rules, and every change happens
 * on the server through the Admin SDK — here, or for PAID tokens in
 * paypal-webhook.js (subscriptions) and token-packs.js (one-off packs).
 *
 * POST JSON { action, ... }:
 *   today           -> today's quests, what each pays, this week's days (Mon..Sun)
 *                      and when they reset (no sign-in needed)
 *   complete        { questId, proofId } -> marks today's quest done, ready to
 *                                           claim (no token yet), once per quest per day
 *   claim           { claimIds }           -> pays each ready reward (1 or 2; Sunday's
 *                                              login chest 3–5 after a Mon–Sat streak), once
 *   stake           { giveawayId, amount } -> wallet -> your entry
 *   setStake        { giveawayId, amount } -> sets your stake to exactly `amount`
 *                                              (lower refunds the difference, 0 removes it)
 *   unstake         { giveawayId }         -> refunds your whole stake (before leaving)
 *   reconcile       { giveawayId }         -> after a device switch, moves your
 *                                              stake to the new platform's total
 *   refundGiveaway  { giveawayId }         -> admin only, before deleting: refunds
 *                                              stakes on any platform not yet drawn
 *   maxStake        { giveawayId }         -> fills in the highest-stake figures on a
 *                                              giveaway staked on before they were kept
 *                                              (every stake change above refreshes them)
 *   claimGift       { giftId }             -> collects an admin gift from the inbox
 *   dailyPuzzle     { day, play }          -> pays 1 for finishing the day's puzzle in
 *                                              Games (checked against the puzzle), once a day
 *   admin*          (admin only)           -> look up / give / remove / set tokens,
 *                                              send and end gifts, refund alerts, pay a
 *                                              secret giveaway winner the tokens in its prize
 *
 * Why double-counting can't happen: each claim is a document with a fixed id
 * (`<day>_<quest>`) created inside a transaction. A second device, or the
 * same device tapping twice at the same instant, finds it already exists.
 */

const { getFirebaseAdmin, DAY_MS, dayKeyFor, dayStartMs, questsForDay, isBannedNow, toMillis,
  questReward, questRewardsFor, weekDayKeys, isSundayKey, sundayLoginReward } = require("./_lib");
const { FieldValue } = require("firebase-admin/firestore");
const GamesCore = require("../games-core.js");
const P = require("../progress-core.js");

// Your items' perks (all zero without any).
async function perksFor(db, uid) {
  const inv = await db.collection("inventories").doc(uid).get();
  return { ...P.perksOf([]), ...((inv.exists && inv.data().perks) || {}) };
}

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

// An "everyone" giveaway (allWinnerCount > 0) draws iOS and Android players
// from one pool, so its stakes are spent once anybody has been drawn. A split
// giveaway draws each platform separately.
function isEveryone(gd) {
  return (gd.allWinnerCount || 0) > 0;
}
function poolDrawn(gd, platform) {
  const winners = gd.winners || [];
  return isEveryone(gd) ? winners.length > 0 : winners.some(x => x.platform === platform);
}

// The highest single stake on each platform, kept on the giveaway doc so
// every player can see what they're up against (entries themselves are
// private). Worked out from the entries rather than adjusted step by step,
// because lowering the top stake means finding the next-highest. Runs in a
// transaction that also reads the giveaway: every stake change writes the
// giveaway's totals, so two of these can't interleave and leave a stale max.
async function refreshMaxStakes(db, gRef) {
  try {
    return await db.runTransaction(async (tx) => {
      const g = await tx.get(gRef);
      if (!g.exists) return null;
      const staked = await tx.get(gRef.collection("entries").where("tokens", ">", 0));
      let ios = 0;
      let android = 0;
      staked.forEach(d => {
        const e = d.data();
        const t = Math.floor(Number(e.tokens) || 0);
        if (e.platform === "ios") ios = Math.max(ios, t);
        else if (e.platform === "android") android = Math.max(android, t);
      });
      tx.update(gRef, { maxStakeIos: ios, maxStakeAndroid: android });
      return { maxStakeIos: ios, maxStakeAndroid: android };
    });
  } catch (e) {
    // Only the shown figure depends on this; the next stake change retries.
    console.warn(`Couldn't refresh the highest stake for ${gRef.id}:`, e.message);
    return null;
  }
}

// Same figures, worked out INSIDE a stake change's own transaction (reads
// before writes) as they'll be once `uid`'s entry holds `tokens` on
// `platform` — so the stake and the new highest are saved in one write,
// one round trip, instead of a second transaction afterwards.
async function maxStakesWith(tx, gRef, uid, platform, tokens) {
  const staked = await tx.get(gRef.collection("entries").where("tokens", ">", 0));
  const max = { ios: 0, android: 0 };
  staked.forEach(d => {
    if (d.id === uid) return;
    const e = d.data();
    const t = Math.floor(Number(e.tokens) || 0);
    if (e.platform === "ios" || e.platform === "android") max[e.platform] = Math.max(max[e.platform], t);
  });
  if (tokens > 0 && (platform === "ios" || platform === "android")) max[platform] = Math.max(max[platform], tokens);
  return { maxStakeIos: max.ios, maxStakeAndroid: max.android };
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
// A comment quest needs real text, not "a".
const MIN_COMMENT_CHARS = 8;

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

    // The other "check out" quests work the same way as readTip: viewing
    // can't be proven, so each checks only that the thing viewed is real.
    // They pay 1 and once a day, so pretending earns little.
    case "readNews":
      return isDocId(proofId) && (await db.collection("news").doc(proofId).get()).exists;
    case "viewFormation":
      return isDocId(proofId) && (await db.collection("formationPosts").doc(proofId).get()).exists;
    case "viewTierList":
      return isDocId(proofId) && (await db.collection("tierLists").doc(proofId).get()).exists;
    case "viewProfile":
      // Someone else's profile.
      return isDocId(proofId) && proofId !== uid && (await db.collection("publicProfiles").doc(proofId).get()).exists;
    case "viewUnit":
    case "compareUnits":
      // Troop/hero data isn't in the database; a sensible unit key is enough.
      return typeof proofId === "string" && /^[A-Za-z0-9_]{1,80}$/.test(proofId);
    case "checkPromo":
      return true;

    case "likeOrVote": {
      // "f/<postId>" (liked a formation) or "t/<tierListId>" (voted on a tier
      // list), done today: the like/vote doc is keyed by the voter's uid.
      const [kind, id, extra] = typeof proofId === "string" ? proofId.split("/") : [];
      if (!["f", "t"].includes(kind) || !isDocId(id) || extra !== undefined) return false;
      const ref = kind === "f"
        ? db.collection("formationPosts").doc(id).collection("likes").doc(uid)
        : db.collection("tierLists").doc(id).collection("votes").doc(uid);
      const snap = await ref.get();
      return snap.exists && madeToday(snap.data().createdAt);
    }

    case "comment": {
      // "f/<postId>/<commentId>" or "t/<tierListId>/<commentId>": your own
      // comment, written today, on SOMEONE ELSE's post, with real text — so
      // "a" under your own post doesn't earn 2 tokens.
      const [kind, postId, commentId, extra] = typeof proofId === "string" ? proofId.split("/") : [];
      if (!["f", "t"].includes(kind) || !isDocId(postId) || !isDocId(commentId) || extra !== undefined) return false;
      const postRef = db.collection(kind === "f" ? "formationPosts" : "tierLists").doc(postId);
      const [post, comment] = await Promise.all([postRef.get(), postRef.collection("comments").doc(commentId).get()]);
      if (!post.exists || !comment.exists) return false;
      const c = comment.data();
      return c.uid === uid && post.data().uid !== uid && madeToday(c.createdAt)
        && typeof c.text === "string" && c.text.trim().length >= MIN_COMMENT_CHARS;
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

  const perks = questId === "login" ? await perksFor(db, uid) : null;
  const claims = db.collection("tokenWallets").doc(uid).collection("claims");
  const claimRef = claims.doc(`${dayKey}_${questId}`);
  // Sunday's login is the weekly chest: it needs this week's Mon–Sat logins.
  const sundayChest = questId === "login" && isSundayKey(dayKey);
  const weekLoginRefs = sundayChest ? weekDayKeys(dayKey).slice(0, 6).map(k => claims.doc(`${k}_login`)) : [];
  return db.runTransaction(async (tx) => {
    const [claimSnap, ...weekSnaps] = await tx.getAll(claimRef, ...weekLoginRefs);
    if (claimSnap.exists) return { ...base, completed: false, alreadyCompleted: true };
    // The reward is fixed when the quest is done, so what the page shows is
    // exactly what Claim pays.
    let reward = questReward(questId);
    let fullStreak;
    if (sundayChest) {
      const loggedIn = new Set(weekSnaps.filter(s => s.exists).map(s => s.data().dayKey));
      ({ reward, fullStreak } = sundayLoginReward(dayKey, loggedIn));
      if (fullStreak) reward += Math.max(0, Math.floor(perks.sundayBonus || 0)); // Juice Box, Torch
    }
    if (questId === "login") reward += Math.max(0, Math.floor(perks.loginBonus || 0)); // Ration Pack
    tx.set(claimRef, {
      questId,
      dayKey,
      proofId: proofId == null ? null : String(proofId).slice(0, 200),
      status: "ready",
      reward,
      ...(sundayChest ? { chest: true, fullStreak } : {}),
      completedAt: now
    });
    return { ...base, completed: true, reward };
  });
}

const MAX_CLAIMS_PER_CALL = 20;

// What one ready reward pays. Never more than 12 (a Sunday chest with every
// login item), whatever a doc says.
function rewardOf(claim) {
  const r = Math.floor(Number(claim.reward));
  return Number.isFinite(r) && r >= 1 ? Math.min(r, 12) : 1;
}

// Pays each listed reward that's still "ready" — its `reward` (1 or 2, 3–5
// for the Sunday chest; rewards from before amounts varied have none and
// pay 1). Anything already claimed (another device, a double tap) or never
// completed is skipped, so sending the same ids twice can't pay twice.
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
  const claimsColl = walletRef.collection("claims");
  const claimRefs = unique.map(id => claimsColl.doc(id));
  // Quest-token items (Quill, Coin Pouch…): once every quest of a day is
  // claimed, that day's quest tokens × the items' bonus, rounded up, once.
  const perks = await perksFor(db, uid);
  const days = perks.questMult > 0 || perks.questFlat > 0 ? [...new Set(unique.map(id => id.slice(0, 10)))] : [];
  const dayInfo = days.map(d => ({ d, ids: questsForDay(d).map(q => `${d}_${q}`), bonusRef: claimsColl.doc(`${d}_itemBonus`) }));
  // Each document read once, even when it's both being claimed and checked.
  const extraIds = [...new Set(dayInfo.flatMap(x => [...x.ids, `${x.d}_itemBonus`]))].filter(id => !unique.includes(id));
  const extraRefs = extraIds.map(id => claimsColl.doc(id));
  return db.runTransaction(async (tx) => {
    const [walletSnap, ...snaps] = await tx.getAll(walletRef, ...claimRefs, ...extraRefs);
    const claimSnaps = snaps.slice(0, claimRefs.length);
    const byId = new Map([...unique, ...extraIds].map((id, i) => [id, snaps[i]]));
    const balance = walletSnap.exists ? (walletSnap.data().balance || 0) : 0;
    let paid = 0;
    let count = 0;
    const claimedNow = new Set();
    claimSnaps.forEach((snap, i) => {
      if (!snap.exists || snap.data().status !== "ready") return;
      tx.update(claimRefs[i], { status: "claimed", claimedAt: now });
      paid += rewardOf(snap.data());
      count++;
      claimedNow.add(unique[i]);
    });
    let itemBonus = 0;
    for (const { d, ids, bonusRef } of dayInfo) {
      const bonusSnap = byId.get(`${d}_itemBonus`);
      if (bonusSnap && bonusSnap.exists) continue;
      // Claimed: claimed just now, or before (old claim docs have no status).
      const done = ids.every(id => { const sn = byId.get(id); return claimedNow.has(id) || (sn && sn.exists && sn.data().status !== "ready"); });
      if (!done) continue;
      const earned = ids.reduce((sum, id) => sum + rewardOf(byId.get(id).data()), 0);
      const bonus = P.questBonus(perks, earned) + Math.max(0, Math.floor(perks.questFlat || 0)); // + Quest Ledger
      if (!bonus) continue;
      tx.set(bonusRef, { questId: "itemBonus", dayKey: d, status: "claimed", reward: bonus, earned, questMult: perks.questMult, completedAt: now, claimedAt: now });
      itemBonus += bonus;
    }
    paid += itemBonus;
    if (paid) {
      tx.set(walletRef, {
        balance: balance + paid,
        lifetimeEarned: FieldValue.increment(paid),
        updatedAt: now
      }, { merge: true });
    }
    return { ok: true, claimed: paid, count, itemBonus, balance: balance + paid };
  });
}

/* ---------------- Staking ----------------
   An entry's `tokens` is its stake; its draw weight is 1 + tokens, so
   someone with none still has a chance. `stakePlatform` records which
   platform's running total the stake is currently counted in — after a
   device switch, `platform` changes first and reconcile catches the total up. */
// A secret giveaway admin made without tokens (tokensAllowed: false):
// everyone in it has the same one chance.
const NO_TOKENS_HERE = "Tokens can't be used in this giveaway — everyone has the same chance.";

// One line per token movement on a Secret Giveaway, so admin can see where a
// player's tokens went: amount > 0 went onto the giveaway, < 0 came back.
// tokenSpends is server-only (no rule matches it, so clients can't read it).
function logSpend(writer, db, uid, now, { amount, giveawayId, title, kind, balanceAfter }) {
  writer.set(db.collection("tokenSpends").doc(newId(now)), {
    uid, kind, amount, giveawayId, title: String(title || "").slice(0, 100),
    ...(balanceAfter == null ? {} : { balanceAfter }), at: now
  });
}

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
    if (gd.tokensAllowed === false) throw new HttpError(400, NO_TOKENS_HERE);
    const platform = ed.platform;
    if (poolDrawn(gd, platform)) {
      throw new HttpError(400, isEveryone(gd) ? "The draw has already happened." : "The draw for your platform has already happened.");
    }
    const balance = w.exists ? (w.data().balance || 0) : 0;
    if (balance < amount) throw new HttpError(400, `You only have ${balance} token${balance === 1 ? "" : "s"}.`);

    const prev = ed.tokens || 0;
    const countedOn = ed.stakePlatform || platform;
    const deltas = {};
    const add = (p, v) => { const f = counterField(p); deltas[f] = (deltas[f] || 0) + v; };
    if (prev > 0 && countedOn !== platform) { add(countedOn, -prev); add(platform, prev); }
    add(platform, amount);
    const max = await maxStakesWith(tx, gRef, uid, platform, prev + amount);

    tx.set(wRef, { balance: balance - amount, updatedAt: now }, { merge: true });
    tx.update(eRef, { tokens: prev + amount, stakePlatform: platform });
    tx.update(gRef, { ...incrementsFrom(deltas), ...max });
    logSpend(tx, db, uid, now, { amount, giveawayId, title: gd.title, kind: "stake", balanceAfter: balance - amount });
    return { ok: true, balance: balance - amount, tokens: prev + amount, ...max };
  });
}

// Sets the stake on your entry to exactly `amount`: lower refunds the
// difference to your wallet, higher takes the difference from it, 0 removes
// it all. Only while entries are open and your side hasn't been drawn, so
// nobody can rearrange chances once the field is final.
async function setStake(db, uid, body, now) {
  const { giveawayId } = body;
  // Must be an actual number: Number(null) and Number("") are 0, which would
  // quietly mean "remove my whole stake".
  const amount = body.amount;
  if (!isDocId(giveawayId)) throw new HttpError(400, "Missing giveaway.");
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 0 || amount > 1000000) {
    throw new HttpError(400, "Enter a whole number of tokens, 0 or more.");
  }
  await assertNotBanned(db, uid);

  const gRef = db.collection("secretGiveaways").doc(giveawayId);
  const eRef = gRef.collection("entries").doc(uid);
  const wRef = db.collection("tokenWallets").doc(uid);
  return db.runTransaction(async (tx) => {
    const [g, e, w] = await tx.getAll(gRef, eRef, wRef);
    if (!g.exists) throw new HttpError(404, "This giveaway no longer exists.");
    if (!e.exists) throw new HttpError(400, "Enter the giveaway first.");
    const gd = g.data();
    const ed = e.data();
    if ((gd.expiresAt || 0) <= now) throw new HttpError(400, "Entries have closed, so your stake can't be changed now.");
    // Tokens off for this one: they can only come back out, never go in.
    if (gd.tokensAllowed === false && amount > (e.data().tokens || 0)) throw new HttpError(400, NO_TOKENS_HERE);
    const platform = ed.platform;
    if (poolDrawn(gd, platform)) {
      throw new HttpError(400, isEveryone(gd) ? "The draw has already happened." : "The draw for your platform has already happened.");
    }
    const balance = w.exists ? (w.data().balance || 0) : 0;
    const prev = ed.tokens || 0;
    const change = amount - prev;
    if (change === 0) return { ok: true, balance, tokens: prev, refunded: 0 };
    if (change > balance) throw new HttpError(400, `You only have ${balance} more token${balance === 1 ? "" : "s"} to add.`);

    // Take the old stake off whichever platform total it was counted in
    // (it may differ after a device switch) and put the new one on yours.
    const deltas = {};
    const add = (p, v) => { const f = counterField(p); deltas[f] = (deltas[f] || 0) + v; };
    add(ed.stakePlatform || platform, -prev);
    add(platform, amount);
    const max = await maxStakesWith(tx, gRef, uid, platform, amount);

    tx.set(wRef, { balance: balance - change, updatedAt: now }, { merge: true });
    tx.update(eRef, { tokens: amount, stakePlatform: platform });
    tx.update(gRef, { ...incrementsFrom(deltas), ...max });
    logSpend(tx, db, uid, now, { amount: change, giveawayId, title: gd.title, kind: change > 0 ? "stake" : "back", balanceAfter: balance - change });
    return { ok: true, balance: balance - change, tokens: amount, refunded: Math.max(0, -change), ...max };
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
    if (g.exists && poolDrawn(g.data(), ed.platform)) {
      throw new HttpError(400, "The draw has already happened, so these tokens are spent.");
    }
    const max = g.exists ? await maxStakesWith(tx, gRef, uid, ed.platform, 0) : {};
    tx.set(wRef, { balance: FieldValue.increment(prev), updatedAt: now }, { merge: true });
    tx.update(eRef, { tokens: 0 });
    if (g.exists) tx.update(gRef, { [counterField(ed.stakePlatform || ed.platform)]: FieldValue.increment(-prev), ...max });
    logSpend(tx, db, uid, now, { amount: -prev, giveawayId, title: g.exists ? g.data().title : "", kind: "back" });
    return { ok: true, refunded: prev, ...max };
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
    if (g.exists && poolDrawn(g.data(), ed.platform)) continue;
    const prev = ed.tokens || 0;
    batch.set(db.collection("tokenWallets").doc(doc.id), { balance: FieldValue.increment(prev), updatedAt: now }, { merge: true });
    batch.update(doc.ref, { tokens: 0 });
    logSpend(batch, db, doc.id, now, { amount: -prev, giveawayId, title: g.exists ? g.data().title : "", kind: "refund" });
    const field = counterField(ed.stakePlatform || ed.platform);
    deltas[field] = (deltas[field] || 0) - prev;
    ops += 3;
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
  const invRef = db.collection("inventories").doc(uid);
  const claimRef = walletRef.collection("claims").doc(`gift_${giftId}`);
  return db.runTransaction(async (tx) => {
    const [giftSnap, claimSnap, walletSnap, invSnap] = await tx.getAll(giftRef, claimRef, walletRef, invRef);
    const balance = walletSnap.exists ? (walletSnap.data().balance || 0) : 0;
    if (claimSnap.exists) return { ok: true, claimed: 0, alreadyClaimed: true, balance };
    // Re-checked inside: the admin may have ended it a moment ago.
    if (!giftSnap.exists || (giftSnap.data().expiresAt || 0) <= now) throw new HttpError(400, "This gift has expired.");
    const gd = giftSnap.data();
    const amount = gd.amount || 0;
    const draws = gd.draws || 0;
    const itemIds = Array.isArray(gd.itemIds) ? gd.itemIds : [];
    // chest draws and items go to the inventory (something already owned → its duplicate tokens)
    const got = draws || itemIds.length ? grantToInventory(tx, db, uid, invSnap, { draws, itemIds }, now) : { added: [], dups: [], dupTokens: 0 };
    const total = amount + got.dupTokens;
    tx.set(claimRef, { kind: "gift", giftId, amount, draws, items: got.added, claimedAt: now });
    if (total) {
      tx.set(walletRef, {
        balance: balance + total,
        lifetimeGifted: FieldValue.increment(total),
        updatedAt: now
      }, { merge: true });
    }
    tx.update(giftRef, { claimCount: FieldValue.increment(1), claimedTokens: FieldValue.increment(amount) });
    return { ok: true, claimed: amount, draws, items: got.added, duplicates: got.dups, dupTokens: got.dupTokens, balance: balance + total };
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
  const [walletSnap, adjSnap, invSnap, cardSnap, statsSnap, opensSnap, packsSnap, salesSnap] = await Promise.all([
    db.collection("tokenWallets").doc(body.uid).get(),
    db.collection("tokenAdjustments").where("uid", "==", body.uid).get(),
    db.collection("inventories").doc(body.uid).get(),
    db.collection("playerCards").doc(body.uid).get(),
    db.collection("achievementStats").doc(body.uid).get(),
    db.collection("chestOpens").where("uid", "==", body.uid).get(),
    db.collection("processedPaypalCaptures").where("uid", "==", body.uid).get(),
    db.collection("processedPaypalSales").where("uid", "==", body.uid).get()
  ]);
  const w = walletSnap.exists ? walletSnap.data() : {};
  const adjustments = adjSnap.docs.map(d => d.data()).sort((a, b) => b.at - a.at).slice(0, 15);
  // What they own and have bought (items, styles, chest draws, payments).
  const inv = invSnap.exists ? invSnap.data() : {};
  const card = cardSnap.exists ? cardSnap.data() : {};
  const chestOpens = opensSnap.docs.map(d => d.data()).sort((a, b) => b.at - a.at).slice(0, 30)
    .map(o => ({ at: o.at, count: o.count || 1, free: !!o.free, price: o.price || 0, refund: o.refund || 0, event: o.event || null,
      results: o.results || (o.item ? [{ id: o.item, duplicate: !!o.duplicate, refund: o.refund || 0 }] : []) }));
  const purchases = [
    ...packsSnap.docs.map(d => ({ kind: "pack", at: d.data().processedAt || 0, pack: d.data().packId || "", tokens: d.data().tokensGranted || 0, amount: d.data().amount || "", currency: d.data().currency || "" })),
    ...salesSnap.docs.map(d => ({ kind: "plan", at: d.data().processedAt || 0, plan: d.data().planKey || "", tokens: d.data().tokensGranted || 0 }))
  ].sort((a, b) => b.at - a.at).slice(0, 40);
  const spending = await spendingOf(db, body.uid, w, adjSnap.docs.map(d => d.data()), opensSnap.docs.map(d => d.data()));
  return {
    spending,
    ok: true,
    uid: body.uid,
    name: profile.name || "",
    balance: w.balance || 0,
    lifetimeEarned: w.lifetimeEarned || 0,
    lifetimePurchased: w.lifetimePurchased || 0,
    lifetimeGifted: w.lifetimeGifted || 0,
    adjustments,
    items: Object.keys(inv.items || {}),
    freeDraws: Math.max(0, inv.freeDraws || 0),
    pity: inv.pity || { epic: 0, legendary: 0 },
    style: card.style || {},
    badges: card.badges || [],
    likeCount: card.likeCount || 0,
    claimed: (statsSnap.exists && statsSnap.data().claimed) || {},
    chestOpens,
    purchases
  };
}

// Where a player's tokens went: everything in (earned, bought, gifts,
// duplicate refunds, admin) against everything out (chests, Secret Giveaway
// tokens, admin removals). A giveaway's tokens are read from their entry
// while the giveaway still exists (that's exact, even from before the
// tokenSpends log), otherwise from the log. Whatever is left over after
// that is "untraced": tokens on giveaways deleted before the log existed.
async function spendingOf(db, uid, w, adjustments, opens) {
  const [gSnap, logSnap] = await Promise.all([
    db.collection("secretGiveaways").get(),
    db.collection("tokenSpends").where("uid", "==", uid).get()
  ]);
  const log = logSnap.docs.map(d => d.data()).sort((a, b) => b.at - a.at);
  const logNet = {};
  for (const s of log) {
    const n = logNet[s.giveawayId] || (logNet[s.giveawayId] = { net: 0, title: s.title || "", at: 0 });
    n.net += s.amount || 0;
    n.at = Math.max(n.at, s.at || 0);
  }
  const entries = await Promise.all(gSnap.docs.map(g => g.ref.collection("entries").doc(uid).get()));
  const giveaways = [];
  gSnap.docs.forEach((g, i) => {
    const gd = g.data();
    const e = entries[i];
    const tokens = e.exists ? (e.data().tokens || 0) : 0;
    if (tokens > 0) {
      giveaways.push({ giveawayId: g.id, title: gd.title || "", tokens, used: poolDrawn(gd, e.data().platform), expiresAt: gd.expiresAt || 0 });
    }
  });
  const live = new Set(gSnap.docs.map(g => g.id));
  for (const [id, n] of Object.entries(logNet)) {
    // Deleted since: anything not refunded before deletion was used in its draw.
    if (!live.has(id) && n.net > 0) giveaways.push({ giveawayId: id, title: n.title, tokens: n.net, used: true, deleted: true, expiresAt: n.at });
  }
  giveaways.sort((a, b) => b.expiresAt - a.expiresAt);

  const sum = (xs, f) => xs.reduce((s, x) => s + (f(x) || 0), 0);
  const chestPaid = sum(opens, o => o.price);
  const chestBack = sum(opens, o => o.refund);
  const chestDraws = sum(opens, o => o.count || 1);
  // Manual changes only (prize payments and grants already count as gifts).
  const manual = adjustments.filter(a => ["add", "remove", "set"].includes(a.mode) && !a.giveawayId);
  const adminIn = sum(manual, a => Math.max(0, (a.after || 0) - (a.before || 0)));
  const adminOut = sum(manual, a => Math.max(0, (a.before || 0) - (a.after || 0)));
  const onGiveaways = sum(giveaways.filter(g => !g.used), g => g.tokens);
  const usedInDraws = sum(giveaways.filter(g => g.used), g => g.tokens);
  const totalIn = (w.lifetimeEarned || 0) + (w.lifetimePurchased || 0) + (w.lifetimeGifted || 0) + chestBack + adminIn;
  const totalOut = chestPaid + onGiveaways + usedInDraws + adminOut;
  return {
    chestDraws, chestPaid, chestBack, adminIn, adminOut, onGiveaways, usedInDraws, totalIn, totalOut,
    untraced: totalIn - totalOut - (w.balance || 0),
    giveaways: giveaways.slice(0, 40),
    log: log.slice(0, 40).map(s => ({ at: s.at, kind: s.kind, amount: s.amount, title: s.title || "", balanceAfter: s.balanceAfter }))
  };
}

async function adminAdjust(db, adminUid, body, now) {
  const { uid: target, mode } = body;
  // A real number only — Number(null) is 0, and "set to 0" would wipe a balance.
  const amount = body.amount;
  const reason = cleanText(body.reason, 200);
  if (!["add", "remove", "set"].includes(mode)) throw new HttpError(400, "Choose add, remove or set.");
  const min = mode === "set" ? 0 : 1;
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount < min || amount > MAX_ADJUST_TOKENS) {
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

// "50 tokens + 2 chest draws + 👑 Royal Crown"
function giftWhat(amount, draws, itemIds) {
  return [amount ? `${amount} token${amount === 1 ? "" : "s"}` : "", draws ? `${draws} free chest draw${draws === 1 ? "" : "s"}` : "",
    ...(itemIds || []).map(id => P.BY_ID[id] ? `${P.BY_ID[id].icon} ${P.BY_ID[id].name}` : "")].filter(Boolean).join(" + ");
}

async function adminSendGift(db, adminUid, body, now) {
  const amount = body.amount == null || body.amount === "" ? 0 : Number(body.amount);
  const draws = body.draws == null || body.draws === "" ? 0 : Number(body.draws);
  const itemIds = Array.isArray(body.itemIds) ? [...new Set(body.itemIds)] : [];
  const hours = Number(body.expiresInHours);
  if (!Number.isInteger(amount) || amount < 0 || amount > MAX_GIFT_TOKENS) throw new HttpError(400, "Tokens: a whole number, 0 or more.");
  if (!Number.isInteger(draws) || draws < 0 || draws > 100) throw new HttpError(400, "Chest draws: a whole number from 0 to 100.");
  if (itemIds.length > 4 || !itemIds.every(id => P.BY_ID[id])) throw new HttpError(400, "Pick up to 4 items or styles from the list.");
  if (!amount && !draws && !itemIds.length) throw new HttpError(400, "Put something in the gift: tokens, chest draws or an item.");
  if (!(hours > 0) || hours > 24 * 366) throw new HttpError(400, "Set how long it lasts (up to a year).");
  const target = body.target === "all" ? "all" : body.target;
  let targetName = "";
  if (target !== "all") targetName = (await requireUser(db, target)).name || "";

  const giftId = newId(now);
  const expiresAt = now + Math.round(hours * 3600 * 1000);
  const what = giftWhat(amount, draws, itemIds);
  const title = cleanText(body.title, 100) || `🎁 A gift: ${what}!`;
  const message = cleanText(body.message, 500) ||
    `Here's ${what} — tap Claim to get it before this expires.`;
  const notifId = `gift-${giftId}`;
  const notifRef = target === "all"
    ? db.collection("notifications").doc(notifId)
    : db.collection("users").doc(target).collection("personalNotifications").doc(notifId);

  await db.collection("tokenGifts").doc(giftId).set({
    target, targetName, amount, draws, itemIds, title, message, createdAt: now, expiresAt,
    createdBy: adminUid, claimCount: 0, claimedTokens: 0, notificationPath: notifRef.path
  });
  await notifRef.set({
    type: "tokenGift", giftId, amount, draws, itemIds, expiresAt, title, body: message, createdAt: now,
    ...(target === "all" ? {} : { read: false })
  });
  return { ok: true, giftId, expiresAt };
}

/* A secret giveaway whose prize includes tokens: once a winner is recorded,
   admin calls this and their tokens go straight into their wallet. The
   amount comes from the giveaway's own prize (its private config), never
   from the request. Paying is logged under a fixed id per giveaway and
   winner, so a double tap or a resend never pays twice. */
async function adminPaySecretPrize(db, adminUid, body, now) {
  const { giveawayId, winnerUid } = body;
  if (!isDocId(giveawayId) || !isDocId(winnerUid)) throw new HttpError(400, "Missing giveaway or winner.");
  const giveawayRef = db.collection("secretGiveaways").doc(giveawayId);
  const [gSnap, cfgSnap] = await Promise.all([giveawayRef.get(), giveawayRef.collection("private").doc("config").get()]);
  if (!gSnap.exists) throw new HttpError(404, "No such giveaway.");
  const g = gSnap.data();
  const record = (g.winners || []).find(w => w.uid === winnerUid);
  if (!record) throw new HttpError(400, "Record them as a winner first.");
  // A ranked giveaway (1st, 2nd, 3rd… prizes): what their place wins.
  const cfg = cfgSnap.exists ? cfgSnap.data() : {};
  const tiers = Array.isArray(cfg.tiers) && cfg.tiers.length ? cfg.tiers : null;
  const prize = tiers ? ((tiers[(record.place || 0) - 1] || {}).prize || null) : (cfg.prize || null);
  const items = prize && Array.isArray(prize.items) ? prize.items : [];
  const amount = items.filter(i => i && i.kind === "tokens" && Number.isInteger(i.amount) && i.amount > 0).reduce((s, i) => s + i.amount, 0);
  // Chest draws and items/styles are delivered the same way.
  const draws = Math.min(100, items.filter(i => i && i.kind === "draws" && Number.isInteger(i.amount) && i.amount > 0).reduce((s, i) => s + i.amount, 0));
  const itemIds = items.filter(i => i && i.kind === "item" && P.BY_ID[i.itemId]).map(i => i.itemId);
  if (!(amount > 0) && !draws && !itemIds.length) throw new HttpError(400, "This giveaway's prize has nothing that's sent automatically (tokens, chest draws or items).");
  if (amount > MAX_GIFT_TOKENS) throw new HttpError(400, "That prize is more tokens than one payment allows.");

  const walletRef = db.collection("tokenWallets").doc(winnerUid);
  const invRef = db.collection("inventories").doc(winnerUid);
  const logRef = db.collection("tokenAdjustments").doc(`secretPrize_${giveawayId}_${winnerUid}`);
  return db.runTransaction(async (tx) => {
    const [logSnap, walletSnap, invSnap] = await tx.getAll(logRef, walletRef, invRef);
    const before = walletSnap.exists ? (walletSnap.data().balance || 0) : 0;
    if (logSnap.exists) return { ok: true, paid: 0, alreadyPaid: true, amount, balance: before };
    const got = draws || itemIds.length ? grantToInventory(tx, db, winnerUid, invSnap, { draws, itemIds }, now) : { added: [], dups: [], dupTokens: 0 };
    const total = amount + got.dupTokens;
    if (total) tx.set(walletRef, { balance: before + total, lifetimeGifted: FieldValue.increment(total), updatedAt: now }, { merge: true });
    tx.set(logRef, {
      uid: winnerUid, mode: "add", amount: total, before, after: before + total, draws, items: got.added, duplicates: got.dups,
      reason: cleanText(`Secret giveaway prize: ${g.title || giveawayId}`, 200), by: adminUid, at: now, giveawayId
    });
    return { ok: true, paid: amount, amount, draws, items: got.added, duplicates: got.dups, dupTokens: got.dupTokens, balance: before + total };
  });
}

// Free chest draws and items/styles into someone's inventory, inside a
// transaction after its reads (pass the inventory snapshot). Something they
// already own is paid out as its duplicate tokens instead, like the chest.
function grantToInventory(tx, db, uid, invSnap, { draws = 0, itemIds = [] }, now) {
  const inv = invSnap.exists ? invSnap.data() : {};
  const items = { ...(inv.items || {}) };
  const added = [], dups = [];
  let dupTokens = 0;
  for (const id of itemIds) {
    if (!P.BY_ID[id]) continue;
    if (id in items) { dupTokens += P.refundFor(id, P.perksOf(Object.keys(items))); dups.push(id); }
    else { items[id] = { at: now, from: "admin" }; added.push(id); }
  }
  const ids = Object.keys(items);
  const update = { items, perks: P.perksOf(ids), count: ids.length, updatedAt: now };
  if (draws > 0) update.freeDraws = Math.max(0, inv.freeDraws || 0) + draws;
  tx.set(db.collection("inventories").doc(uid), update, { merge: true });
  tx.set(db.collection("playerCards").doc(uid), { itemCount: ids.length, updatedAt: now }, { merge: true });
  return { added, dups, dupTokens };
}

// Admin: give someone free chest draws and/or items (logged like any change).
async function adminGrantItems(db, adminUid, body, now) {
  const draws = body.draws == null ? 0 : body.draws;
  const itemIds = Array.isArray(body.itemIds) ? [...new Set(body.itemIds)] : [];
  if (!Number.isInteger(draws) || draws < 0 || draws > 100) throw new HttpError(400, "Free draws: a whole number from 0 to 100.");
  if (itemIds.length > 8 || !itemIds.every(id => P.BY_ID[id])) throw new HttpError(400, "Pick up to 8 items or styles from the list.");
  if (!draws && !itemIds.length) throw new HttpError(400, "Pick some free draws or an item to give.");
  const profile = await requireUser(db, body.uid);
  const reason = cleanText(body.reason, 200);
  const walletRef = db.collection("tokenWallets").doc(body.uid);
  const invRef = db.collection("inventories").doc(body.uid);
  const logRef = db.collection("tokenAdjustments").doc(newId(now));
  const r = await db.runTransaction(async (tx) => {
    const [walletSnap, invSnap] = await tx.getAll(walletRef, invRef);
    const before = walletSnap.exists ? (walletSnap.data().balance || 0) : 0;
    const got = grantToInventory(tx, db, body.uid, invSnap, { draws, itemIds }, now);
    if (got.dupTokens) tx.set(walletRef, { balance: before + got.dupTokens, lifetimeGifted: FieldValue.increment(got.dupTokens), updatedAt: now }, { merge: true });
    tx.set(logRef, { uid: body.uid, mode: "grant", amount: got.dupTokens, before, after: before + got.dupTokens, draws, items: got.added, duplicates: got.dups, reason, by: adminUid, at: now });
    return { ...got, balance: before + got.dupTokens };
  });
  const names = r.added.map(id => `${P.BY_ID[id].icon} ${P.BY_ID[id].name}`);
  const what = [draws ? `🧰 ${draws} free chest draw${draws === 1 ? "" : "s"}` : "", ...names, r.dupTokens ? `🪙 ${r.dupTokens} tokens (for what you already had)` : ""].filter(Boolean).join(", ");
  if (body.notify === true && what) {
    try {
      await db.collection("users").doc(body.uid).collection("personalNotifications").add({
        type: "itemsGranted", title: "🎁 You got a gift!", body: `An admin sent you: ${what}.${reason ? " " + reason : ""} Open Profile → 🎒 Items to see them${draws ? ", and the Store's chest for your free draws" : ""}.`,
        createdAt: now, read: false
      });
    } catch (e) { console.warn(`Couldn't notify ${body.uid} about a grant:`, e.message); }
  }
  return { ok: true, name: profile.name || "", draws, ...r };
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

// Stake changes that don't already save the new highest stake themselves
// (stake, setStake and unstake do, in their own transaction).
const STAKE_ACTIONS = new Set(["reconcile", "refundGiveaway"]);

// For giveaways staked on before the highest stake was tracked: works it out
// once. Anyone signed in may ask, but it only recomputes when the figures are
// missing, so repeated calls cost a single read.
async function maxStake(db, body) {
  if (!isDocId(body.giveawayId)) throw new HttpError(400, "Missing giveaway.");
  const gRef = db.collection("secretGiveaways").doc(body.giveawayId);
  const g = await gRef.get();
  if (!g.exists) throw new HttpError(404, "This giveaway no longer exists.");
  const gd = g.data();
  if (typeof gd.maxStakeIos === "number" && typeof gd.maxStakeAndroid === "number") {
    return { ok: true, maxStakeIos: gd.maxStakeIos, maxStakeAndroid: gd.maxStakeAndroid };
  }
  const max = await refreshMaxStakes(db, gRef);
  if (!max) throw new HttpError(503, "Couldn't work out the highest stake — try again.");
  return { ok: true, ...max };
}

/* ---------------- Today's puzzle (Games) ----------------
   Finishing the day's puzzle pays 1 token, once per account per day, whatever
   the score. The play is replayed against the very puzzle the page built
   (games-core.js, from the same game data files), so only a possible,
   finished play of that day's puzzle counts. The claim doc has a fixed id
   like a quest's, so a second device or a double tap can't pay twice. */
const DAILY_PUZZLE_REWARD = 1;
// A puzzle started just before the reset can still be handed in a little after.
const DAILY_PUZZLE_GRACE_MS = 30 * 60 * 1000;
const { loadUnits: loadGameUnits } = require("./_units"); // the same units the page builds

async function dailyPuzzle(db, uid, body, now, dayKey) {
  const { day, play } = body;
  const lateForYesterday = day === dayKeyFor(now - DAY_MS) && now - dayStartMs(now) < DAILY_PUZZLE_GRACE_MS;
  if (day !== dayKey && !lateForYesterday) return { ok: true, paid: 0, expired: true };
  const result = GamesCore.dailyResult(loadGameUnits(), day, play);
  if (!result) throw new HttpError(400, "Couldn't check that puzzle — reload Games and try again.");
  if (!result.finished) throw new HttpError(400, "Finish the puzzle first.");
  await assertNotBanned(db, uid);
  const reward = DAILY_PUZZLE_REWARD + Math.max(0, Math.floor((await perksFor(db, uid)).puzzleBonus || 0)); // Candle

  const walletRef = db.collection("tokenWallets").doc(uid);
  const claimRef = walletRef.collection("claims").doc(`${day}_dailyPuzzle`);
  return db.runTransaction(async (tx) => {
    const [walletSnap, claimSnap] = await tx.getAll(walletRef, claimRef);
    const balance = walletSnap.exists ? (walletSnap.data().balance || 0) : 0;
    if (claimSnap.exists) return { ok: true, paid: 0, already: true, balance };
    tx.set(claimRef, {
      questId: "dailyPuzzle",
      dayKey: day,
      game: result.game,
      score: result.score,
      status: "claimed",
      reward,
      completedAt: now,
      claimedAt: now
    });
    tx.set(walletRef, {
      balance: balance + reward,
      lifetimeEarned: FieldValue.increment(reward),
      updatedAt: now
    }, { merge: true });
    return { ok: true, paid: reward, balance: balance + reward };
  });
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
      const quests = questsForDay(dayKey);
      res.status(200).json({ ok: true, dayKey, resetAt, quests, rewards: questRewardsFor(quests), week: weekDayKeys(dayKey) });
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
      case "setStake": result = await setStake(db, uid, body, now); break;
      case "reconcile": result = await reconcile(db, uid, body); break;
      case "refundGiveaway": result = await refundGiveaway(db, uid, body, now); break;
      case "claimGift": result = await claimGift(admin, db, uid, body, now); break;
      case "adminUserTokens": assertAdmin(uid); result = await adminUserTokens(db, body); break;
      case "adminAdjust": assertAdmin(uid); result = await adminAdjust(db, uid, body, now); break;
      case "adminSendGift": assertAdmin(uid); result = await adminSendGift(db, uid, body, now); break;
      case "adminPaySecretPrize": assertAdmin(uid); result = await adminPaySecretPrize(db, uid, body, now); break;
      case "adminGrantItems": assertAdmin(uid); result = await adminGrantItems(db, uid, body, now); break;
      case "adminListGifts": assertAdmin(uid); result = await adminListGifts(db, now); break;
      case "adminEndGift": assertAdmin(uid); result = await adminEndGift(db, body, now); break;
      case "adminListAlerts": assertAdmin(uid); result = await adminListAlerts(db); break;
      case "adminResolveAlert": assertAdmin(uid); result = await adminResolveAlert(db, uid, body, now); break;
      case "maxStake": result = await maxStake(db, body); break;
      case "dailyPuzzle": result = await dailyPuzzle(db, uid, body, now, dayKey); break;
      default: throw new HttpError(400, "Unknown action.");
    }
    // Device switches and pre-delete refunds change the highest stake too.
    if (STAKE_ACTIONS.has(body.action)) {
      const max = await refreshMaxStakes(db, db.collection("secretGiveaways").doc(body.giveawayId));
      if (max) result = { ...result, ...max };
    }
    res.status(200).json(result);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error("tokens failed:", e);
    res.status(status).json({ ok: false, error: status >= 500 ? "Something went wrong — try again." : e.message });
  }
};
