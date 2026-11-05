/**
 * api/polls.js
 * Polls (in 📰 News → 📊 Polls): admin asks one question or several, everyone
 * signed in answers, and the first time someone answers a poll it pays its
 * gift (tokens, chest draws, items — like an admin gift). Answers are made
 * here, never by the browser, so they can't be faked or counted twice and the
 * gift can't be claimed twice. Each question is one of:
 *   single  pick one option
 *   multi   pick as many options as you like
 *   open    write your own answer; everyone's answers are shown (with names)
 * A single or multi question can also have ✏️ Other (allowOther): its index is
 * options.length, it needs a written answer, it's counted like an option, and
 * the written answers are shown like an open question's.
 * A poll with several questions is answered all at once (every question).
 *
 * POST JSON { action, ... } with "Authorization: Bearer <id token>":
 *   list                          -> the latest polls; their results (counts, and
 *                                    what people wrote) once you've answered or
 *                                    the poll's ended
 *   vote        { pollId, answers: [{ options: [i], text }] } — one per question
 *               (a one-question poll can send { options } / { text } instead)
 *                                 -> your answers, or a change to them, until the
 *                                    poll ends; the first time pays the gift
 *   adminCreate { title, questions: [{ kind, question, options, allowOther }],
 *                 expiresInHours, amount, draws, itemIds, notify }
 *               (or one question's kind / question / options / allowOther at the top)
 *   adminList                     -> every poll with its results and gifts paid
 *   adminEnd    { pollId }        -> ends it now (answers lock, results stay)
 *   adminDelete { pollId }        -> removes it, its answers and its notification
 *   adminRemoveAnswer { pollId, uid, q } -> takes one written answer down
 *                                    (question q's: an open answer, or an Other)
 *
 * The gift only goes to accounts that already existed when the poll was
 * posted (like a gift for everyone), so it can't be farmed with new accounts;
 * newer accounts can still answer.
 *
 * Data (server-only; the Firestore rules give clients no access):
 *   polls/{pollId}              { title, questions: [{ kind, question, options: [text], allowOther,
 *                                 counts: [n] (+1 for Other) }], total (people who answered),
 *                                 createdAt, expiresAt, reward: { amount, draws, itemIds }, rewardCount,
 *                                 notificationId, createdBy }
 *                               (polls from before several questions keep kind / question /
 *                                options / allowOther / counts at the top: read as one question)
 *   polls/{pollId}/votes/{uid}  { answers: [{ picks: [i], text }], name, avatar, firstAt, at, rewarded }
 *                               (older: picks / text at the top)
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
const MAX_QUESTIONS = 10;
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

// A poll's questions, each { kind, question, options, allowOther, counts } with its
// counts the right length (one per option, +1 for Other). Older one-question polls too.
function questionsOf(p) {
  const raw = Array.isArray(p.questions) && p.questions.length ? p.questions
    : [{ kind: p.kind, question: p.question, options: p.options, allowOther: p.allowOther, counts: p.counts }];
  return raw.map(q => {
    const kind = KINDS.includes(q.kind) ? q.kind : "single";
    const options = kind === "open" ? [] : (q.options || []);
    const allowOther = kind !== "open" && !!q.allowOther;
    const slots = options.length + (allowOther ? 1 : 0);
    return { kind, question: q.question || "", options, allowOther, counts: Array.from({ length: slots }, (_, i) => (q.counts || [])[i] || 0) };
  });
}
// Someone's answers, one per question ({ picks, text }). Older votes too.
const answersOf = (v) => (v ? (Array.isArray(v.answers) ? v.answers : [{ picks: v.picks || [], ...(v.text ? { text: v.text } : {}) }]) : null);
const titleOf = (p, qs) => p.title || (qs.length === 1 ? qs[0].question : "");
const hasWritten = (q) => q.kind === "open" || q.allowOther;

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

// What people wrote, per question (an open question's answers, or its Others'), newest first.
async function writtenAnswers(ref, qs, me) {
  if (!qs.some(hasWritten)) return qs.map(() => null);
  const snap = await ref.collection("votes").orderBy("at", "desc").limit(ANSWERS_SHOWN * 4).get();
  const lists = qs.map(q => (hasWritten(q) ? [] : null));
  for (const d of snap.docs) {
    const v = d.data(), ans = answersOf(v) || [];
    qs.forEach((q, i) => {
      const t = ans[i] && ans[i].text;
      if (lists[i] && t && lists[i].length < ANSWERS_SHOWN) lists[i].push({ uid: d.id, name: v.name || "Commander", avatar: v.avatar || "", text: t, at: v.at || 0, me: d.id === me });
    });
  }
  return lists;
}

// What a player sees of a poll: the results only once they've answered, or it's over.
function viewOf(id, p, mine, now, written) {
  const qs = questionsOf(p);
  const ended = (p.expiresAt || 0) <= now;
  const myAns = answersOf(mine);
  const see = ended || !!mine;
  return {
    id, title: titleOf(p, qs), createdAt: p.createdAt, expiresAt: p.expiresAt, ended,
    total: see ? p.total || 0 : null,
    answered: !!mine,
    questions: qs.map((q, i) => ({
      kind: q.kind, question: q.question, options: q.options, allowOther: q.allowOther,
      counts: see && q.kind !== "open" ? q.counts : null,
      answers: see && hasWritten(q) ? (written && written[i]) || [] : null,
      myPicks: myAns && q.kind !== "open" ? (myAns[i] && myAns[i].picks) || [] : null,
      myText: myAns && myAns[i] && (q.kind === "open" || myAns[i].text) ? myAns[i].text || "" : null
    })),
    reward: hasGift(p.reward) ? { amount: p.reward.amount || 0, draws: p.reward.draws || 0, itemIds: p.reward.itemIds || [] } : null,
    rewarded: !!(mine && mine.rewarded)
  };
}

async function listPolls(db, uid, now) {
  const snap = await db.collection("polls").orderBy("createdAt", "desc").limit(LIST_SIZE).get();
  const docs = snap.docs;
  const votes = docs.length ? await db.getAll(...docs.map(d => d.ref.collection("votes").doc(uid))) : [];
  const polls = await Promise.all(docs.map(async (d, i) => {
    const p = d.data();
    const mine = votes[i] && votes[i].exists ? votes[i].data() : null;
    const see = (p.expiresAt || 0) <= now || !!mine;
    const written = see ? await writtenAnswers(d.ref, questionsOf(p), uid) : null;
    return viewOf(d.id, p, mine, now, written);
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

// One question's answer, checked: { picks: [i] } and/or { text }.
function checkAnswer(q, a, n, many) {
  const where = many ? `Question ${n + 1}: ` : "";
  a = a && typeof a === "object" ? a : {};
  if (q.kind === "open") {
    const text = cleanText(a.text, MAX_ANSWER);
    if (!text) throw new HttpError(400, where + "Write your answer first.");
    return { picks: [], text };
  }
  const raw = Array.isArray(a.options) ? a.options : Number.isInteger(a.option) ? [a.option] : [];
  const picks = [...new Set(raw)].sort((x, y) => x - y);
  const slots = q.options.length + (q.allowOther ? 1 : 0);
  if (!picks.length || !picks.every(i => Number.isInteger(i) && i >= 0 && i < slots)) throw new HttpError(400, where + (q.kind === "multi" ? "Pick at least one option." : "Pick an option."));
  if (q.kind === "single" && picks.length !== 1) throw new HttpError(400, where + "This question takes one answer.");
  // ✏️ Other: its index is just past the options, and it needs what you'd write
  if (q.allowOther && picks.includes(q.options.length)) {
    const text = cleanText(a.text, MAX_ANSWER);
    if (!text) throw new HttpError(400, where + "Write your answer for ✏️ Other.");
    return { picks, text };
  }
  return { picks };
}
const sameAnswers = (a, b) => JSON.stringify((a || []).map(x => [x.picks || [], x.text || null])) === JSON.stringify((b || []).map(x => [x.picks || [], x.text || null]));

async function vote(admin, db, uid, body, now) {
  const { pollId } = body;
  if (!isDocId(pollId)) throw new HttpError(400, "Missing poll.");
  const [banSnap, pubSnap, first] = await Promise.all([
    db.collection("users").doc(uid).get(), db.collection("publicProfiles").doc(uid).get(), pollRef(db, pollId).get()
  ]);
  if (banSnap.exists && isBannedNow(banSnap.data())) throw new HttpError(403, "Your account is currently restricted.");
  if (!first.exists) throw new HttpError(404, "This poll no longer exists.");
  const qs0 = questionsOf(first.data());
  // every question answered, each checked against its kind
  const sent = Array.isArray(body.answers) ? body.answers : qs0.length === 1 ? [{ options: body.options, option: body.option, text: body.text }] : [];
  if (sent.length !== qs0.length) throw new HttpError(400, qs0.length > 1 ? "Answer every question." : "Pick an option.");
  const answers = qs0.map((q, i) => checkAnswer(q, sent[i], i, qs0.length > 1));
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
    const prevAns = answersOf(prev);
    if (prev && sameAnswers(prevAns, answers)) return { p, mine: prev, unchanged: true };
    const qs = questionsOf(p);
    qs.forEach((q, i) => {
      if (q.kind === "open") return;
      ((prevAns && prevAns[i] && prevAns[i].picks) || []).forEach(k => { if (q.counts[k] > 0) q.counts[k]--; });
      answers[i].picks.forEach(k => { q.counts[k]++; });
    });
    const total = (p.total || 0) + (prev ? 0 : 1);
    // The gift: the first answer, once ever (the claim's fixed id), if their account is old enough.
    let gift = null, rewarded = prev ? !!prev.rewarded : false;
    const pollUpdate = { questions: qs, total, updatedAt: now };
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
    const mine = { answers, name, avatar, at: now, firstAt: prev ? prev.firstAt || now : now, rewarded };
    tx.set(voteRef, mine);
    return { p: { ...p, questions: qs, total }, mine, changed: !!prev, gift, giftTooNew: !prev && hasGift(p.reward) && !giftable };
  });
  const written = await writtenAnswers(ref, questionsOf(result.p), uid);
  return {
    ok: true, poll: viewOf(pollId, result.p, result.mine, now, written),
    gift: result.gift || null,
    ...(result.unchanged ? { unchanged: true } : {}), ...(result.changed ? { changed: true } : {}), ...(result.giftTooNew ? { giftTooNew: true } : {})
  };
}

/* ---------------- admin ---------------- */
function cleanQuestion(q, n, many) {
  const where = many ? `Question ${n + 1}: ` : "";
  const kind = KINDS.includes(q && q.kind) ? q.kind : "single";
  const question = cleanText(q && q.question, 200);
  const options = kind === "open" ? [] : (Array.isArray(q && q.options) ? q.options : []).map(o => cleanText(o, 80)).filter(Boolean);
  const allowOther = kind !== "open" && !!(q && q.allowOther === true);
  if (!question) throw new HttpError(400, where + "Write the question.");
  if (kind !== "open") {
    // (with ✏️ Other, one fixed option is enough: "Yes" + Other)
    if (options.length < (allowOther ? 1 : 2) || options.length > MAX_OPTIONS) throw new HttpError(400, where + (allowOther ? `Give it 1 to ${MAX_OPTIONS} options (plus ✏️ Other).` : `Give it 2 to ${MAX_OPTIONS} options.`));
    if (new Set(options.map(o => o.toLowerCase())).size !== options.length) throw new HttpError(400, where + "Two options are the same.");
  }
  return { kind, question, options, allowOther, counts: Array.from({ length: options.length + (allowOther ? 1 : 0) }, () => 0) };
}

async function adminCreate(db, adminUid, body, now) {
  const rawQs = Array.isArray(body.questions) && body.questions.length ? body.questions
    : [{ kind: body.kind, question: body.question, options: body.options, allowOther: body.allowOther }];
  if (rawQs.length > MAX_QUESTIONS) throw new HttpError(400, `Up to ${MAX_QUESTIONS} questions.`);
  const questions = rawQs.map((q, i) => cleanQuestion(q, i, rawQs.length > 1));
  const title = cleanText(body.title, 200) || (questions.length === 1 ? questions[0].question : "");
  if (!title) throw new HttpError(400, "Give a poll with several questions a title.");
  const amount = body.amount == null || body.amount === "" ? 0 : Number(body.amount);
  const draws = body.draws == null || body.draws === "" ? 0 : Number(body.draws);
  const itemIds = Array.isArray(body.itemIds) ? [...new Set(body.itemIds.filter(Boolean))] : [];
  const hours = Number(body.expiresInHours);
  if (!Number.isInteger(amount) || amount < 0 || amount > MAX_GIFT_TOKENS) throw new HttpError(400, `Tokens: a whole number from 0 to ${MAX_GIFT_TOKENS}.`);
  if (!Number.isInteger(draws) || draws < 0 || draws > 20) throw new HttpError(400, "Chest draws: a whole number from 0 to 20.");
  if (itemIds.length > 2 || !itemIds.every(id => P.BY_ID[id])) throw new HttpError(400, "Pick up to 2 items or styles from the list.");
  if (!(hours > 0) || hours > 24 * 90) throw new HttpError(400, "Set how long it runs (up to 90 days).");
  const id = newId(now);
  const expiresAt = now + Math.round(hours * 3600 * 1000);
  const reward = { amount, draws, itemIds };
  const notify = body.notify !== false;
  const notificationId = notify ? `poll-${id}` : null;
  await pollRef(db, id).set({ title, questions, total: 0, createdAt: now, expiresAt, reward, rewardCount: 0, notificationId, createdBy: adminUid });
  if (notify) {
    const what = giftWhat(reward);
    const how = questions.length > 1 ? `Answer its ${questions.length} questions` : questions[0].kind === "open" ? "Answer it" : "Vote";
    await db.collection("notifications").doc(notificationId).set({
      type: "poll", pollId: id, sourceId: id, title: `📊 New poll: ${title}`.slice(0, 220),
      body: what ? `${how} in 📰 News → 📊 Polls and get ${what}! You can change your answers until it ends.` : `Have your say in 📰 News → 📊 Polls. You can change your answers until it ends.`,
      expiresAt, createdAt: now
    });
  }
  return { ok: true, pollId: id, expiresAt };
}

async function adminList(db, now) {
  const snap = await db.collection("polls").orderBy("createdAt", "desc").limit(50).get();
  const polls = await Promise.all(snap.docs.map(async (d) => {
    const p = d.data();
    const qs = questionsOf(p);
    const written = await writtenAnswers(d.ref, qs, null);
    return { id: d.id, title: titleOf(p, qs), questions: qs.map((q, i) => ({ ...q, answers: written[i] })), total: p.total || 0, createdAt: p.createdAt, expiresAt: p.expiresAt,
      ended: (p.expiresAt || 0) <= now, reward: p.reward || null, rewardCount: p.rewardCount || 0, notified: !!p.notificationId };
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

// A written answer that shouldn't be up (question q's): gone from the list, their gift stays.
// An open question's: that answer is taken back — and if it was their only answer, their whole
// vote. An Other's: just the Other (their other picks stay; a single question with only Other
// picked is taken back like an open one).
async function adminRemoveAnswer(db, body) {
  if (!isDocId(body.pollId) || !isDocId(body.uid)) throw new HttpError(400, "Missing poll or player.");
  const qi = Number.isInteger(body.q) ? body.q : 0;
  const ref = pollRef(db, body.pollId);
  const voteRef = ref.collection("votes").doc(body.uid);
  return db.runTransaction(async (tx) => {
    const [pollSnap, voteSnap] = await tx.getAll(ref, voteRef);
    if (!pollSnap.exists) throw new HttpError(404, "No such poll.");
    if (!voteSnap.exists) return { ok: true, alreadyGone: true };
    const p = pollSnap.data(), v = voteSnap.data();
    const qs = questionsOf(p), ans = answersOf(v).map(a => ({ ...a }));
    const q = qs[qi], a = ans[qi];
    if (!q || !a || !a.text) return { ok: true, alreadyGone: true };
    const other = q.allowOther ? q.options.length : -1;
    const keep = q.kind === "open" ? [] : (a.picks || []).filter(k => k !== other);
    (a.picks || []).filter(k => !keep.includes(k)).forEach(k => { if (q.counts[k] > 0) q.counts[k]--; });
    ans[qi] = { picks: keep };
    // nothing left of their answers at all: the whole vote goes (and the count with it)
    const anyLeft = ans.some((x, i) => (x.picks && x.picks.length) || (x.text && i !== qi));
    if (!anyLeft) {
      qs.forEach((qq, i) => { if (i !== qi && qq.kind !== "open") (ans[i].picks || []).forEach(k => { if (qq.counts[k] > 0) qq.counts[k]--; }); });
      tx.update(ref, { questions: qs, total: Math.max(0, (p.total || 0) - 1) });
      tx.delete(voteRef);
    } else {
      tx.update(ref, { questions: qs });
      const { picks: _p, text: _t, ...rest } = v;
      tx.set(voteRef, { ...rest, answers: ans });
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
