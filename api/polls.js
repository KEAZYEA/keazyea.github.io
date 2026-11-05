/**
 * api/polls.js
 * Polls (in 📰 News → 📊 Polls): admin asks a question, everyone signed in
 * answers, and the first answer on each poll pays its gift (tokens, chest
 * draws, items — like an admin gift). Answers are made here, never by the
 * browser, so they can't be faked or counted twice and the gift can't be
 * claimed twice. Three kinds:
 *   single  pick one option
 *   multi   pick as many options as you like
 *   open    write your own answer; everyone's answers are shown (with names)
 * A single or multi poll can also have ✏️ Other (allowOther): its index is
 * options.length, it needs a written answer, it's counted like an option, and
 * the written answers are shown like an open poll's.
 *
 * POST JSON { action, ... } with "Authorization: Bearer <id token>":
 *   list                          -> the latest polls; their results (counts, or
 *                                    for an open poll everyone's answers) once
 *                                    you've answered or the poll's ended
 *   vote        { pollId, options: [i] } (single: one; multi: one or more;
 *                                   with Other picked, text too)
 *               { pollId, text }  (open)
 *                                 -> your answer, or a change to it, until the
 *                                    poll ends; the first one pays the gift
 *   adminCreate { kind, question, options, allowOther, expiresInHours, amount, draws, itemIds, notify }
 *   adminList                     -> every poll with its results and gifts paid
 *   adminEnd    { pollId }        -> ends it now (answers lock, results stay)
 *   adminDelete { pollId }        -> removes it, its answers and its notification
 *   adminRemoveAnswer { pollId, uid } -> takes one written answer down (open, or an Other)
 *
 * The gift only goes to accounts that already existed when the poll was
 * posted (like a gift for everyone), so it can't be farmed with new accounts;
 * newer accounts can still answer.
 *
 * Data (server-only; the Firestore rules give clients no access):
 *   polls/{pollId}              { kind, question, options: [text], allowOther, counts: [n] (+1 for Other), total, createdAt,
 *                                 expiresAt, reward: { amount, draws, itemIds }, rewardCount,
 *                                 notificationId, createdBy }
 *   polls/{pollId}/votes/{uid}  { picks: [i], text (open, or with Other), name, avatar, firstAt, at, rewarded }
 *   tokenWallets/{uid}/claims/poll_{pollId}   the gift, once
 *   notifications/poll-{pollId} the "new poll" message in everyone's inbox
 */

const { getFirebaseAdmin, isBannedNow } = require("./_lib");
const { FieldValue } = require("firebase-admin/firestore");
const P = require("../progress-core.js");
const { grantToInventory } = require("./tokens.js");

const ADMIN_UID = "Ts92RY0ipMYDRJa2s5toQfDYxtp1"; // same as tokens.js and appState.js
const KINDS = ["single", "multi", "open"];
const MAX_OPTIONS = 8;
const MAX_ANSWER = 200;
const ANSWERS_SHOWN = 50;
const MAX_GIFT_TOKENS = 1000;
const LIST_SIZE = 30;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const isDocId = (s) => typeof s === "string" && s.length > 0 && s.length <= 200 && !s.includes("/");
const cleanText = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, max) : "");
const newId = (now) => now.toString(36) + Math.random().toString(36).slice(2, 10);
const pollRef = (db, id) => db.collection("polls").doc(id);
const kindOf = (p) => (KINDS.includes(p.kind) ? p.kind : "single");
const hasOther = (p) => kindOf(p) !== "open" && !!p.allowOther;
// counts: one per option, and one more for ✏️ Other
const slotsOf = (p) => (p.options || []).length + (hasOther(p) ? 1 : 0);
// shows written answers: an open poll, or one with Other
const hasWritten = (p) => kindOf(p) === "open" || hasOther(p);

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
function assertAdmin(uid) {
  if (uid !== ADMIN_UID) throw new HttpError(403, "Not authorized.");
}

// "10 tokens + 1 free chest draw + 👑 Royal Crown"
function giftWhat(reward) {
  const r = reward || {};
  return [r.amount ? `${r.amount} token${r.amount === 1 ? "" : "s"}` : "", r.draws ? `${r.draws} free chest draw${r.draws === 1 ? "" : "s"}` : "",
    ...(r.itemIds || []).map(id => P.BY_ID[id] ? `${P.BY_ID[id].icon} ${P.BY_ID[id].name}` : "")].filter(Boolean).join(" + ");
}
const hasGift = (r) => !!(r && (r.amount || r.draws || (r.itemIds && r.itemIds.length)));
const answerOf = (uid, v, me) => ({ uid, name: v.name || "Commander", avatar: v.avatar || "", text: v.text || "", at: v.at || 0, me: uid === me });

// What a player sees of a poll: the results only once they've answered, or it's over.
function viewOf(id, p, mine, now, answers) {
  const kind = kindOf(p);
  const ended = (p.expiresAt || 0) <= now;
  const answered = !!mine;
  const see = ended || answered;
  return {
    id, kind, question: p.question, options: kind === "open" ? [] : p.options, allowOther: hasOther(p), createdAt: p.createdAt, expiresAt: p.expiresAt, ended,
    total: see ? p.total || 0 : null,
    counts: see && kind !== "open" ? Array.from({ length: slotsOf(p) }, (_, i) => (p.counts || [])[i] || 0) : null,
    answers: see && hasWritten(p) ? answers || [] : null,
    myPicks: mine && kind !== "open" ? mine.picks || [] : null,
    myText: mine && (kind === "open" || mine.text) ? mine.text || "" : null,
    reward: hasGift(p.reward) ? { amount: p.reward.amount || 0, draws: p.reward.draws || 0, itemIds: p.reward.itemIds || [] } : null,
    rewarded: !!(mine && mine.rewarded)
  };
}

// The latest written answers (an open poll's, or an Other's), newest first.
async function openAnswers(ref, me) {
  const snap = await ref.collection("votes").orderBy("at", "desc").limit(ANSWERS_SHOWN * 4).get();
  return snap.docs.filter(d => d.data().text).slice(0, ANSWERS_SHOWN).map(d => answerOf(d.id, d.data(), me));
}

async function listPolls(db, uid, now) {
  const snap = await db.collection("polls").orderBy("createdAt", "desc").limit(LIST_SIZE).get();
  const docs = snap.docs;
  const votes = docs.length ? await db.getAll(...docs.map(d => d.ref.collection("votes").doc(uid))) : [];
  const polls = await Promise.all(docs.map(async (d, i) => {
    const p = d.data();
    const mine = votes[i] && votes[i].exists ? votes[i].data() : null;
    const see = (p.expiresAt || 0) <= now || !!mine;
    const answers = hasWritten(p) && see ? await openAnswers(d.ref, uid) : null;
    return viewOf(d.id, p, mine, now, answers);
  }));
  return { ok: true, now, polls };
}

// Was this account made before the poll went up? (Only those get its gift.)
async function existedBefore(admin, uid, at) {
  try {
    const created = Date.parse((await admin.auth().getUser(uid)).metadata.creationTime) || 0;
    return created > 0 && created <= at;
  } catch (e) { return false; }
}

async function vote(admin, db, uid, body, now) {
  const { pollId } = body;
  if (!isDocId(pollId)) throw new HttpError(400, "Missing poll.");
  const [banSnap, pubSnap, first] = await Promise.all([
    db.collection("users").doc(uid).get(), db.collection("publicProfiles").doc(uid).get(), pollRef(db, pollId).get()
  ]);
  if (banSnap.exists && isBannedNow(banSnap.data())) throw new HttpError(403, "Your account is currently restricted.");
  if (!first.exists) throw new HttpError(404, "This poll no longer exists.");
  const kind = kindOf(first.data());
  // what was sent, checked against the poll's kind
  let picks = null, text = null;
  if (kind === "open") {
    text = cleanText(body.text, MAX_ANSWER);
    if (!text) throw new HttpError(400, "Write your answer first.");
  } else {
    const raw = Array.isArray(body.options) ? body.options : Number.isInteger(body.option) ? [body.option] : [];
    picks = [...new Set(raw)].sort((a, b) => a - b);
    const n = slotsOf(first.data());
    if (!picks.length || !picks.every(i => Number.isInteger(i) && i >= 0 && i < n)) throw new HttpError(400, kind === "multi" ? "Pick at least one option." : "Pick an option.");
    if (kind === "single" && picks.length !== 1) throw new HttpError(400, "This poll takes one answer.");
    // ✏️ Other: its index is just past the options, and it needs what you'd write
    if (hasOther(first.data()) && picks.includes(first.data().options.length)) {
      text = cleanText(body.text, MAX_ANSWER);
      if (!text) throw new HttpError(400, "Write your answer for ✏️ Other.");
    }
  }
  const pub = pubSnap.exists ? pubSnap.data() : {};
  const name = (typeof pub.name === "string" && pub.name.trim() ? pub.name.trim() : "Commander").slice(0, 40);
  const avatar = typeof pub.avatar === "string" ? pub.avatar.slice(0, 500) : "";
  // Checked before the transaction (it's a call to Auth, not the database).
  const giftable = hasGift(first.data().reward) && await existedBefore(admin, uid, first.data().createdAt || 0);

  const ref = pollRef(db, pollId);
  const voteRef = ref.collection("votes").doc(uid);
  const walletRef = db.collection("tokenWallets").doc(uid);
  const invRef = db.collection("inventories").doc(uid);
  const claimRef = walletRef.collection("claims").doc(`poll_${pollId}`);
  const result = await db.runTransaction(async (tx) => {
    const [pollSnap, voteSnap, claimSnap, walletSnap, invSnap] = await tx.getAll(ref, voteRef, claimRef, walletRef, invRef);
    if (!pollSnap.exists) throw new HttpError(404, "This poll no longer exists.");
    const p = pollSnap.data();
    if ((p.expiresAt || 0) <= now) throw new HttpError(400, "This poll has ended — the results are final.");
    const prev = voteSnap.exists ? voteSnap.data() : null;
    const same = prev && (kind === "open" ? prev.text === text : JSON.stringify(prev.picks || []) === JSON.stringify(picks) && (prev.text || null) === (text || null));
    if (same) return { p, mine: prev, unchanged: true };
    const counts = Array.from({ length: slotsOf(p) }, (_, i) => (p.counts || [])[i] || 0);
    if (kind !== "open") {
      (prev ? prev.picks || [] : []).forEach(i => { if (counts[i] > 0) counts[i]--; });
      picks.forEach(i => { counts[i]++; });
    }
    const total = (p.total || 0) + (prev ? 0 : 1);
    // The gift: the first answer, once ever (the claim's fixed id), if their account is old enough.
    let gift = null, rewarded = prev ? !!prev.rewarded : false;
    const pollUpdate = { counts, total, updatedAt: now };
    if (!prev && giftable && !claimSnap.exists) {
      const r = p.reward || {};
      const balance = walletSnap.exists ? (walletSnap.data().balance || 0) : 0;
      const got = r.draws || (r.itemIds || []).length ? grantToInventory(tx, db, uid, invSnap, { draws: r.draws || 0, itemIds: r.itemIds || [] }, now) : { added: [], dups: [], dupTokens: 0 };
      const tokens = (r.amount || 0) + got.dupTokens;
      tx.set(claimRef, { kind: "poll", pollId, amount: r.amount || 0, draws: r.draws || 0, items: got.added, dupTokens: got.dupTokens, claimedAt: now });
      if (tokens) tx.set(walletRef, { balance: balance + tokens, lifetimeGifted: FieldValue.increment(tokens), updatedAt: now }, { merge: true });
      pollUpdate.rewardCount = FieldValue.increment(1);
      gift = { amount: r.amount || 0, draws: r.draws || 0, items: got.added, duplicates: got.dups, dupTokens: got.dupTokens, balance: balance + tokens };
      rewarded = true;
    }
    tx.update(ref, pollUpdate);
    const mine = { ...(kind === "open" ? { text } : { picks, ...(text ? { text } : {}) }), name, avatar, at: now, firstAt: prev ? prev.firstAt || now : now, rewarded };
    tx.set(voteRef, mine);
    return { p: { ...p, counts, total }, mine, changed: !!prev, gift, giftTooNew: !prev && hasGift(p.reward) && !giftable };
  });
  const answers = hasWritten(result.p) ? await openAnswers(ref, uid) : null;
  return {
    ok: true, poll: viewOf(pollId, result.p, result.mine, now, answers),
    gift: result.gift || null,
    ...(result.unchanged ? { unchanged: true } : {}), ...(result.changed ? { changed: true } : {}), ...(result.giftTooNew ? { giftTooNew: true } : {})
  };
}

/* ---------------- admin ---------------- */
async function adminCreate(db, adminUid, body, now) {
  const kind = KINDS.includes(body.kind) ? body.kind : "single";
  const question = cleanText(body.question, 200);
  const options = kind === "open" ? [] : (Array.isArray(body.options) ? body.options : []).map(o => cleanText(o, 80)).filter(Boolean);
  const allowOther = kind !== "open" && body.allowOther === true;
  const amount = body.amount == null || body.amount === "" ? 0 : Number(body.amount);
  const draws = body.draws == null || body.draws === "" ? 0 : Number(body.draws);
  const itemIds = Array.isArray(body.itemIds) ? [...new Set(body.itemIds.filter(Boolean))] : [];
  const hours = Number(body.expiresInHours);
  if (!question) throw new HttpError(400, "Write the question.");
  if (kind !== "open") {
    // (with ✏️ Other, one fixed option is enough: "Yes" + Other)
    if (options.length < (allowOther ? 1 : 2) || options.length > MAX_OPTIONS) throw new HttpError(400, allowOther ? `Give it 1 to ${MAX_OPTIONS} options (plus ✏️ Other).` : `Give it 2 to ${MAX_OPTIONS} options.`);
    if (new Set(options.map(o => o.toLowerCase())).size !== options.length) throw new HttpError(400, "Two options are the same.");
  }
  if (!Number.isInteger(amount) || amount < 0 || amount > MAX_GIFT_TOKENS) throw new HttpError(400, `Tokens: a whole number from 0 to ${MAX_GIFT_TOKENS}.`);
  if (!Number.isInteger(draws) || draws < 0 || draws > 20) throw new HttpError(400, "Chest draws: a whole number from 0 to 20.");
  if (itemIds.length > 2 || !itemIds.every(id => P.BY_ID[id])) throw new HttpError(400, "Pick up to 2 items or styles from the list.");
  if (!(hours > 0) || hours > 24 * 90) throw new HttpError(400, "Set how long it runs (up to 90 days).");
  const id = newId(now);
  const expiresAt = now + Math.round(hours * 3600 * 1000);
  const reward = { amount, draws, itemIds };
  const notify = body.notify !== false;
  const notificationId = notify ? `poll-${id}` : null;
  await pollRef(db, id).set({
    kind, question, options, allowOther, counts: Array.from({ length: options.length + (allowOther ? 1 : 0) }, () => 0), total: 0, createdAt: now, expiresAt, reward, rewardCount: 0,
    notificationId, createdBy: adminUid
  });
  if (notify) {
    const what = giftWhat(reward);
    const how = kind === "open" ? "Answer it" : "Vote";
    await db.collection("notifications").doc(notificationId).set({
      type: "poll", pollId: id, sourceId: id, title: `📊 New poll: ${question}`.slice(0, 220),
      body: what ? `${how} in 📰 News → 📊 Polls and get ${what}! You can change your answer until it ends.` : `Have your say in 📰 News → 📊 Polls. You can change your answer until it ends.`,
      expiresAt, createdAt: now
    });
  }
  return { ok: true, pollId: id, expiresAt };
}

async function adminList(db, now) {
  const snap = await db.collection("polls").orderBy("createdAt", "desc").limit(50).get();
  const polls = await Promise.all(snap.docs.map(async (d) => {
    const p = d.data();
    const kind = kindOf(p);
    return { id: d.id, kind, question: p.question, options: p.options || [], allowOther: hasOther(p), counts: Array.from({ length: slotsOf(p) }, (_, i) => (p.counts || [])[i] || 0), total: p.total || 0, createdAt: p.createdAt, expiresAt: p.expiresAt,
      ended: (p.expiresAt || 0) <= now, reward: p.reward || null, rewardCount: p.rewardCount || 0, notified: !!p.notificationId,
      ...(hasWritten(p) ? { answers: await openAnswers(d.ref, null) } : {}) };
  }));
  return { ok: true, now, polls };
}

async function adminEnd(db, body, now) {
  if (!isDocId(body.pollId)) throw new HttpError(400, "Missing poll.");
  const ref = pollRef(db, body.pollId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpError(404, "No such poll.");
  if ((snap.data().expiresAt || 0) <= now) return { ok: true, alreadyEnded: true };
  await ref.update({ expiresAt: now, endedEarly: true });
  // the inbox shows it as ended (See results) instead of Vote
  if (snap.data().notificationId) {
    try { await db.collection("notifications").doc(snap.data().notificationId).update({ expiresAt: now }); } catch (e) { console.warn("poll notification", e.message); }
  }
  return { ok: true };
}

async function adminDelete(db, body) {
  if (!isDocId(body.pollId)) throw new HttpError(400, "Missing poll.");
  const ref = pollRef(db, body.pollId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: true, alreadyGone: true };
  // its answers first (in batches), then the poll and its inbox message
  for (;;) {
    const votes = await ref.collection("votes").limit(400).get();
    if (votes.empty) break;
    const batch = db.batch();
    votes.docs.forEach(v => batch.delete(v.ref));
    await batch.commit();
    if (votes.size < 400) break;
  }
  await ref.delete();
  if (snap.data().notificationId) {
    try { await db.collection("notifications").doc(snap.data().notificationId).delete(); } catch (e) { console.warn("poll notification", e.message); }
  }
  return { ok: true };
}

// A written answer that shouldn't be up: gone from the list (their gift stays).
// An open poll's: the whole answer. An Other's: just the Other (their other picks stay).
async function adminRemoveAnswer(db, body) {
  if (!isDocId(body.pollId) || !isDocId(body.uid)) throw new HttpError(400, "Missing poll or player.");
  const ref = pollRef(db, body.pollId);
  const voteRef = ref.collection("votes").doc(body.uid);
  return db.runTransaction(async (tx) => {
    const [pollSnap, voteSnap] = await tx.getAll(ref, voteRef);
    if (!pollSnap.exists) throw new HttpError(404, "No such poll.");
    if (!voteSnap.exists) return { ok: true, alreadyGone: true };
    const p = pollSnap.data(), v = voteSnap.data();
    const counts = Array.from({ length: slotsOf(p) }, (_, i) => (p.counts || [])[i] || 0);
    const other = hasOther(p) ? p.options.length : -1;
    const keep = kindOf(p) === "open" ? [] : (v.picks || []).filter(i => i !== other);
    (v.picks || []).filter(i => !keep.includes(i)).forEach(i => { if (counts[i] > 0) counts[i]--; });
    if (keep.length) {
      tx.update(ref, { counts });
      const { text: _removed, ...rest } = v;
      tx.set(voteRef, { ...rest, picks: keep });
    } else {
      tx.update(ref, { counts, total: Math.max(0, (p.total || 0) - 1) });
      tx.delete(voteRef);
    }
    return { ok: true };
  });
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "Method not allowed" }); return; }
  let body = req.body || {};
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const now = Date.now();
  try {
    const admin = getFirebaseAdmin();
    const db = admin.firestore();
    const uid = await verifyCaller(admin, req);
    let result;
    switch (body.action) {
      case "list": result = await listPolls(db, uid, now); break;
      case "vote": result = await vote(admin, db, uid, body, now); break;
      case "adminCreate": assertAdmin(uid); result = await adminCreate(db, uid, body, now); break;
      case "adminList": assertAdmin(uid); result = await adminList(db, now); break;
      case "adminEnd": assertAdmin(uid); result = await adminEnd(db, body, now); break;
      case "adminDelete": assertAdmin(uid); result = await adminDelete(db, body); break;
      case "adminRemoveAnswer": assertAdmin(uid); result = await adminRemoveAnswer(db, body); break;
      default: throw new HttpError(400, "Unknown action.");
    }
    res.status(200).json(result);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error("polls failed:", e);
    res.status(status).json({ ok: false, error: status >= 500 ? "Something went wrong — try again." : e.message });
  }
};
