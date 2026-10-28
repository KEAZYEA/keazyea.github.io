/**
 * api/games.js
 * Games' endless runs for signed-in players, and the weekly leaderboard.
 *
 * The leaderboard pays tokens, so ranked runs are played HERE: the browser
 * is sent each question without its answer, sends back one move at a time,
 * and this decides what's right — a score can't simply be posted. The rules
 * are games-core.js, the same file the page uses for guests' (unranked)
 * runs, so both behave identically. Blur's picture is sent as a cropped,
 * blurred image made here, since the real picture's file name is the answer.
 *
 * POST JSON { action, ... } — as plain text (Content-Type text/plain) with
 * the sign-in token as body.idToken, so the browser sends it straight away
 * instead of first asking permission (a CORS preflight: a whole extra trip,
 * which for a player far from the server is the slowest part of a move).
 * An "Authorization: Bearer" header works too.
 *   ping                          -> nothing; wakes the server up (and checks the
 *                                    token) while the page loads, so the first
 *                                    real move doesn't wait for it
 *   runStart    { game }          -> a new run (sign-in needed): its first question
 *   runAnswer   { runId, input }  -> one move: what happened, then the next
 *                                    question or the end of the run
 *   leaderboard                   -> this week's top players, your place, the
 *                                    prizes and last week's winners — names only for
 *                                    a signed-in caller; anyone else gets just the
 *                                    week's end and the prizes
 *
 * Weekly score = your best run this week in each of the five games — a
 * run's score is its points, at most G.LB_CAP; a run started on the day its
 * game is Today's Puzzle (G.bonusGameFor) counts double — added up, so at
 * most G.LB_MAX. Weeks run Monday–Sunday,
 * Singapore time. The first leaderboard or run request after a week ends
 * pays its top 5 (WEEKLY_PRIZES), once — the week's summary doc records it
 * inside the same transaction.
 *
 * Data (server-only; the Firestore rules give clients no access):
 *   gameRuns/{runId}                          one run: owner, name, week, state
 *   gameLeaderboards/{week}                   { finalizedAt, winners } once paid
 *   gameLeaderboards/{week}/players/{uid}     { name, best: {game: score}, pts: {game: board points},
 *                                             dbl: {game: true if those points were a doubled run}, total, updatedAt }
 */

const crypto = require("crypto");
const { getFirebaseAdmin, DAY_MS, dayKeyFor, dayStartMs, weekDayKeys, isBannedNow } = require("./_lib");
const { FieldValue } = require("firebase-admin/firestore");
const G = require("../games-core.js");
const P = require("../progress-core.js");
const { loadUnits } = require("./_units");
const jpeg = require("../vendor/jpeg-js");

const WEEKLY_PRIZES = [30, 20, 15, 10, 10]; // 🪙 for 1st to 5th
const LEADERBOARD_SIZE = 20;
const SITE = "https://keazyea.github.io";

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function verifyCaller(admin, req, required, body) {
  const header = req.headers.authorization || "";
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : (body && typeof body.idToken === "string" ? body.idToken : null);
  if (!idToken) {
    if (required) throw new HttpError(401, "Sign in first.");
    return null;
  }
  try {
    return (await admin.auth().verifyIdToken(idToken)).uid;
  } catch (e) {
    if (!required) return null;
    throw new HttpError(401, "Your session expired — refresh the page and try again.");
  }
}

/* ---------------- weeks ---------------- */
const weekOf = (ms) => weekDayKeys(dayKeyFor(ms))[0]; // that week's Monday
function weekEndsAt(ms) {
  const day = dayKeyFor(ms);
  return dayStartMs(ms) + (7 - weekDayKeys(day).indexOf(day)) * DAY_MS;
}
const weeksBefore = (week, n) => new Date(Date.parse(week + "T00:00:00Z") - 7 * n * DAY_MS).toISOString().slice(0, 10);
const blankBest = () => Object.fromEntries(G.GAMES.map(g => [g, 0]));
const blankPts = () => Object.fromEntries(G.GAMES.map(g => [g, 0]));

/* ---------------- Blur pictures ----------------
   The page shows the picture zoomed in and blurred with CSS, which would
   hand the whole picture (and its name) to anyone who inspects it. For a
   ranked run the server makes the zoomed, blurred view itself — the same
   region and blur the CSS would show (G.blurCrop) — and sends only that. */
const CROP_OUT = 300; // px square
const pictureCache = new Map();
async function loadPicture(imgPath) {
  if (pictureCache.has(imgPath)) return pictureCache.get(imgPath);
  let bytes;
  if (process.env.GAMES_IMAGE_DIR) {
    bytes = require("fs").readFileSync(require("path").join(process.env.GAMES_IMAGE_DIR, imgPath.replace(/^images\//, "")));
  } else {
    const res = await fetch(`${SITE}/${imgPath.split("/").map(encodeURIComponent).join("/")}`);
    if (!res.ok) throw new Error(`picture ${imgPath}: ${res.status}`);
    bytes = Buffer.from(await res.arrayBuffer());
  }
  const pic = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
  if (pictureCache.size > 80) pictureCache.delete(pictureCache.keys().next().value);
  pictureCache.set(imgPath, pic);
  return pic;
}

// Three box blurs ≈ a Gaussian blur of the given radius (sigma), in place.
function blurRGBA(data, w, h, sigma) {
  const r = Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2);
  if (r < 1) return;
  const tmp = new Float32Array(w * h * 4);
  const pass = (src, dst, horizontal) => {
    const len = horizontal ? w : h, lines = horizontal ? h : w;
    for (let line = 0; line < lines; line++) {
      const at = (i) => (horizontal ? (line * w + i) : (i * w + line)) * 4;
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let i = -r; i <= r; i++) sum += src[at(Math.min(len - 1, Math.max(0, i))) + c];
        for (let i = 0; i < len; i++) {
          dst[at(i) + c] = sum / (2 * r + 1);
          sum += src[at(Math.min(len - 1, i + r + 1)) + c] - src[at(Math.max(0, i - r)) + c];
        }
      }
    }
  };
  for (let n = 0; n < 3; n++) { pass(data, tmp, true); pass(tmp, data, false); }
}

async function croppedPicture(imgPath, picture) {
  const pic = await loadPicture(imgPath);
  const c = G.blurCrop(pic.width, pic.height, picture.focus, picture.zoom);
  const out = new Float32Array(CROP_OUT * CROP_OUT * 4);
  const px = (x, y, ch) => pic.data[(Math.min(pic.height - 1, Math.max(0, y)) * pic.width + Math.min(pic.width - 1, Math.max(0, x))) * 4 + ch];
  for (let y = 0; y < CROP_OUT; y++) {
    const sy = c.y + (y + 0.5) * c.h / CROP_OUT - 0.5, y0 = Math.floor(sy), fy = sy - y0;
    for (let x = 0; x < CROP_OUT; x++) {
      const sx = c.x + (x + 0.5) * c.w / CROP_OUT - 0.5, x0 = Math.floor(sx), fx = sx - x0;
      for (let ch = 0; ch < 3; ch++) {
        out[(y * CROP_OUT + x) * 4 + ch] =
          (px(x0, y0, ch) * (1 - fx) + px(x0 + 1, y0, ch) * fx) * (1 - fy) +
          (px(x0, y0 + 1, ch) * (1 - fx) + px(x0 + 1, y0 + 1, ch) * fx) * fy;
      }
    }
  }
  // CSS blurs the picture before scaling it, so its blur is in the
  // picture's displayed pixels: convert to this crop's pixels.
  blurRGBA(out, CROP_OUT, CROP_OUT, (picture.blur / c.scale) * CROP_OUT / c.w);
  const rgba = Buffer.alloc(CROP_OUT * CROP_OUT * 4);
  for (let i = 0; i < rgba.length; i++) rgba[i] = (i & 3) === 3 ? 255 : Math.max(0, Math.min(255, Math.round(out[i])));
  const { data } = jpeg.encode({ width: CROP_OUT, height: CROP_OUT, data: rgba }, 75);
  return "data:image/jpeg;base64," + Buffer.from(data).toString("base64");
}

// What the browser gets for a run's current question (never its answer).
async function publicView(run) {
  const view = G.runView(loadUnits(), run);
  if (run.game === "blur") {
    view.image = await croppedPicture(view.img, view.picture);
    delete view.img;
    delete view.picture;
  }
  return view;
}

/* ---------------- runs ---------------- */
async function playerName(db, uid) {
  const pub = await db.collection("publicProfiles").doc(uid).get();
  const name = pub.exists && typeof pub.data().name === "string" ? pub.data().name.trim() : "";
  return (name || "Commander").slice(0, 40);
}

async function assertNotBanned(db, uid) {
  const snap = await db.collection("users").doc(uid).get();
  if (snap.exists && isBannedNow(snap.data())) throw new HttpError(403, "Your account is currently restricted.");
}

async function runStart(db, uid, body, now) {
  const game = body.game;
  if (!G.GAMES.includes(game)) throw new HttpError(400, "Unknown game.");
  const week = weekOf(now);
  // All at once rather than one after another: each is a trip to the database.
  // (Rescoring only changes totals, never the per-game bests read here.)
  const [, , name, lb, inv] = await Promise.all([
    assertNotBanned(db, uid),
    rescoreWeek(db, week),
    playerName(db, uid),
    db.collection("gameLeaderboards").doc(week).collection("players").doc(uid).get(),
    db.collection("inventories").doc(uid).get()
  ]);
  // Items: more time per question, extra lives, more Blur hints.
  const rp = P.runPerks(inv.exists ? inv.data().perks : null);
  const run = G.runNew(game, crypto.randomInt(2 ** 31), now, rp);
  const runId = crypto.randomBytes(12).toString("hex");
  // ⭐ Today's Puzzle game counts double for runs started today (even one
  // that finishes after midnight).
  const bonusGame = G.bonusGameFor(dayKeyFor(now));
  const bonus = bonusGame === game;
  await db.collection("gameRuns").doc(runId).set({ uid, name, game, week, bonus, run, createdAt: now, updatedAt: now });
  const best = lb.exists ? (lb.data().best || {})[game] || 0 : 0;
  const pts = lb.exists ? G.lbPts(lb.data())[game] : 0;
  return { ok: true, runId, game, week, bonus, bonusGame, score: 0, over: false, best, pts, deadline: run.deadline, now, extraMs: run.extraMs || 0, lives: run.lives || 0, view: await publicView(run) };
}

// Only the fields a move can have, with the right types.
function cleanInput(input) {
  if (!input || typeof input !== "object") return null;
  if (input.hint === true) return { hint: true }; // Blur
  if (Number.isInteger(input.answer)) return { answer: input.answer };
  if (typeof input.pick === "string") return { pick: input.pick.slice(0, 80) };
  if (typeof input.guess === "string") return { guess: input.guess.slice(0, 80) };
  if (typeof input.letter === "string") return { letter: input.letter.slice(0, 2) }; // Hangman
  return null;
}

async function runAnswer(db, uid, body, now) {
  const { runId } = body;
  if (typeof runId !== "string" || !/^[0-9a-f]{24}$/.test(runId)) throw new HttpError(400, "Missing run.");
  const input = cleanInput(body.input);
  const runRef = db.collection("gameRuns").doc(runId);
  const result = await db.runTransaction(async (tx) => {
    // The run and your leaderboard row in one round trip. The row belongs to
    // the run's week, which is almost always this week; a run started just
    // before the weekly reset reads its own week's row separately.
    const thisWeek = weekOf(now);
    const guessRef = db.collection("gameLeaderboards").doc(thisWeek).collection("players").doc(uid);
    const invRef = db.collection("inventories").doc(uid); // item perks add to the total
    const [runSnap, guessSnap, invSnap] = await tx.getAll(runRef, guessRef, invRef);
    if (!runSnap.exists || runSnap.data().uid !== uid) throw new HttpError(404, "That run doesn't exist.");
    const doc = runSnap.data();
    if (doc.run.over) throw new HttpError(409, "This run has already ended.");
    const lbRef = doc.week === thisWeek ? guessRef : db.collection("gameLeaderboards").doc(doc.week).collection("players").doc(uid);
    const lbSnap = doc.week === thisWeek ? guessSnap : await tx.get(lbRef);
    let step;
    try {
      step = G.runStep(loadUnits(), doc.run, input, now, G.RUN_GRACE_MS);
    } catch (e) {
      throw new HttpError(400, e.message);
    }
    const perks = invSnap.exists ? invSnap.data().perks || {} : {};
    // Muddy Boots: a token the first time each day a ranked run reaches 10.
    const day = dayKeyFor(now);
    const tenRef = db.collection("tokenWallets").doc(uid).collection("claims").doc(`${day}_gameTen`);
    const walletRef = db.collection("tokenWallets").doc(uid);
    const hitTen = perks.gameTen > 0 && doc.run.score < 10 && step.run.score >= 10;
    const [tenSnap, walletSnap] = hitTen ? await tx.getAll(tenRef, walletRef) : [null, null];
    tx.update(runRef, { run: step.run, updatedAt: now });
    let tenPaid = 0;
    if (hitTen && !tenSnap.exists) {
      tenPaid = Math.min(5, Math.floor(perks.gameTen));
      tx.set(tenRef, { questId: "gameTen", dayKey: day, status: "claimed", reward: tenPaid, completedAt: now, claimedAt: now });
      tx.set(walletRef, { balance: (walletSnap.exists ? walletSnap.data().balance || 0 : 0) + tenPaid, lifetimeEarned: FieldValue.increment(tenPaid), updatedAt: now }, { merge: true });
    }
    const row = lbSnap.exists ? lbSnap.data() : {};
    const best = { ...blankBest(), ...(row.best || {}) };
    const pts = { ...blankPts(), ...G.lbPts(row) };
    const dbl = { ...(row.dbl || {}) }; // which games' points came from a doubled run
    // A better score, or more points on the board (a doubled run can beat a
    // higher plain one) — either is saved.
    const runPts = G.lbRunPoints(doc.game, step.run.score, doc.bonus);
    const betterScore = step.run.score > (best[doc.game] || 0);
    const morePts = runPts > pts[doc.game];
    if (betterScore) best[doc.game] = step.run.score;
    if (morePts) { pts[doc.game] = runPts; dbl[doc.game] = !!doc.bonus; }
    if (betterScore || morePts) {
      const perk = P.gamePerkBonus(perks, pts, dbl);
      tx.set(lbRef, { uid, name: doc.name, week: doc.week, best, pts, dbl, perk, total: G.lbTotal({ pts }) + perk, updatedAt: now }, { merge: true });
    }
    // Every point a run scores counts towards the Gamer achievement (as it's
    // scored, so a run left unfinished still counts what it got).
    const gained = runPts - G.lbRunPoints(doc.game, doc.run.score, doc.bonus);
    if (gained > 0) tx.set(db.collection("achievementStats").doc(uid), { gamePoints: FieldValue.increment(gained) }, { merge: true });
    return { step, best: best[doc.game] || 0, pts: pts[doc.game], newBest: betterScore || morePts, game: doc.game, tenPaid };
  });
  const { run } = result.step;
  return {
    ok: true,
    score: run.score,
    over: run.over,
    feedback: result.step.feedback,
    best: result.best,
    pts: result.pts,
    newBest: result.newBest,
    lives: run.lives || 0,
    ...(result.tenPaid ? { tenPaid: result.tenPaid } : {}),
    deadline: run.deadline,
    now,
    view: run.over ? null : await publicView(run),
    // Once it's over the seed gives nothing away, and lets a friend replay
    // the same run as a challenge.
    seed: run.over ? run.seed : undefined
  };
}

/* ---------------- weekly prizes ---------------- */
const finalizedWeeks = new Set(); // per server instance, saves a read

async function finalizeWeek(db, week, now) {
  if (finalizedWeeks.has(week)) return;
  const metaRef = db.collection("gameLeaderboards").doc(week);
  const meta = await metaRef.get();
  if (meta.exists && meta.data().finalizedAt) { finalizedWeeks.add(week); return; }
  // The top players, ties going to whoever got there first.
  const top = (await metaRef.collection("players").orderBy("total", "desc").limit(10).get()).docs
    .map(d => d.data())
    .filter(p => p.total > 0)
    .sort((a, b) => b.total - a.total || a.updatedAt - b.updatedAt);
  const eligible = [];
  for (const p of top) {
    if (eligible.length === WEEKLY_PRIZES.length) break;
    const user = await db.collection("users").doc(p.uid).get();
    if (!(user.exists && isBannedNow(user.data()))) eligible.push(p);
  }
  // Victor's Trophy and the like: a bigger prize (rounded up).
  const invs = await Promise.all(eligible.map(p => db.collection("inventories").doc(p.uid).get()));
  const winners = eligible.map((p, i) => {
    const mult = invs[i].exists ? Math.max(0, Number((invs[i].data().perks || {}).prizeMult) || 0) : 0;
    return { uid: p.uid, name: p.name, total: p.total, rank: i + 1, prize: Math.ceil(WEEKLY_PRIZES[i] * (1 + mult / 100)) };
  });
  const paid = await db.runTransaction(async (tx) => {
    const walletRefs = winners.map(w => db.collection("tokenWallets").doc(w.uid));
    const [again, ...wallets] = await tx.getAll(metaRef, ...walletRefs);
    if (again.exists && again.data().finalizedAt) return false;
    winners.forEach((w, i) => {
      const balance = wallets[i].exists ? (wallets[i].data().balance || 0) : 0;
      tx.set(walletRefs[i], { balance: balance + w.prize, lifetimeEarned: FieldValue.increment(w.prize), updatedAt: now }, { merge: true });
    });
    tx.set(metaRef, { week, finalizedAt: now, winners }, { merge: true });
    return true;
  });
  finalizedWeeks.add(week);
  if (!paid) return;
  const place = ["1st 🥇", "2nd 🥈", "3rd 🥉", "4th 🏅", "5th 🏅"];
  await Promise.all(winners.map(w => db.collection("users").doc(w.uid).collection("personalNotifications").add({
    type: "tokensGranted",
    title: `🏆 You came ${place[w.rank - 1]} in Games this week! +${w.prize} tokens`,
    body: `Your ${w.total} points put you ${place[w.rank - 1].split(" ")[0]} on the weekly Games leaderboard (week of ${week}), and ${w.prize} tokens are in your wallet. A new week has started — go defend your spot!`,
    createdAt: now,
    read: false
  }).catch(e => console.warn(`Couldn't send leaderboard notification to ${w.uid}:`, e.message))));
}

// The last two weeks, in case nobody looked in for a whole week.
async function finalizePastWeeks(db, now) {
  const week = weekOf(now);
  for (const w of [weeksBefore(week, 2), weeksBefore(week, 1)]) {
    try { await finalizeWeek(db, w, now); } catch (e) { console.error("finalize", w, e); }
  }
}

/* ---------------- leaderboard ---------------- */
const SCORING = 3; // 3: a run's score is its points (at most G.LB_CAP), Today's Puzzle game ×2, kept as pts
const rescored = new Set();
async function rescoreWeek(db, week) {
  if (rescored.has(week)) return;
  const metaRef = db.collection("gameLeaderboards").doc(week);
  const meta = await metaRef.get();
  if (!(meta.exists && meta.data().scoring === SCORING)) {
    const snap = await metaRef.collection("players").get();
    let batch = db.batch(), n = 0;
    for (const d of snap.docs) {
      const pts = G.lbPts(d.data()), total = G.lbTotal({ pts }) + (d.data().perk || 0); // keeps item perks
      if (total !== d.data().total || !d.data().pts) { batch.update(d.ref, { pts, total }); if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); } }
    }
    if (n % 400) await batch.commit();
    await metaRef.set({ week, scoring: SCORING }, { merge: true });
  }
  rescored.add(week);
}

// Players' name effects for the board ({ uid: class }), cached a minute.
const fxCache = new Map();
async function nameEffects(db, uids, now) {
  const out = {};
  await Promise.all(uids.map(async (u) => {
    const hit = fxCache.get(u);
    if (hit && now - hit.at < 60000) { out[u] = hit.fx; return; }
    let fx = "";
    try {
      const card = await db.collection("playerCards").doc(u).get();
      fx = card.exists ? P.styleClass(card.data().style, "name") : "";
    } catch (e) { /* no effect shown */ }
    fxCache.set(u, { at: now, fx });
    out[u] = fx;
  }));
  return out;
}

async function leaderboard(db, uid, now) {
  await finalizePastWeeks(db, now);
  const week = weekOf(now);
  // Names are only for signed-in players.
  const bonus = G.bonusGameFor(dayKeyFor(now)); // today's ⭐ double-points game
  const base = { ok: true, week, bonus, endsAt: weekEndsAt(now), now, prizes: WEEKLY_PRIZES, cap: G.LB_CAP, gameMax: G.LB_GAME_MAX, max: G.LB_MAX };
  if (!uid) return { ...base, top: [], me: null, lastWeek: [], signedOut: true };
  await rescoreWeek(db, week);
  const players = db.collection("gameLeaderboards").doc(week).collection("players");
  const [topSnap, meSnap, lastMeta] = await Promise.all([
    players.orderBy("total", "desc").limit(LEADERBOARD_SIZE + 10).get(),
    uid ? players.doc(uid).get() : Promise.resolve(null),
    db.collection("gameLeaderboards").doc(weeksBefore(week, 1)).get()
  ]);
  const top = topSnap.docs.map(d => d.data()).filter(p => p.total > 0)
    .sort((a, b) => b.total - a.total || a.updatedAt - b.updatedAt)
    .slice(0, LEADERBOARD_SIZE);
  const fx = await nameEffects(db, top.map(p => p.uid), now);
  const rows = top.map((p, i) => ({ rank: i + 1, name: p.name, total: p.total, best: { ...blankBest(), ...p.best }, pts: G.lbPts(p), dbl: p.dbl || {}, perk: p.perk || 0, nameFx: fx[p.uid] || "", me: p.uid === uid }));
  let me = null;
  if (meSnap && meSnap.exists && meSnap.data().total > 0) {
    const mine = meSnap.data();
    const listed = rows.find(r => r.me);
    const rank = listed ? listed.rank : 1 + (await players.where("total", ">", mine.total).count().get()).data().count;
    me = { rank, total: mine.total, best: { ...blankBest(), ...mine.best }, pts: G.lbPts(mine), dbl: mine.dbl || {}, perk: mine.perk || 0 };
  } else if (uid) {
    me = { rank: null, total: 0, best: blankBest(), pts: blankPts(), dbl: {}, perk: 0 };
  }
  const lastWeek = lastMeta.exists && lastMeta.data().winners
    ? lastMeta.data().winners.map(w => ({ rank: w.rank, name: w.name, total: w.total, prize: w.prize }))
    : [];
  return { ...base, top: rows, me, lastWeek };
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  // Lets the browser skip the permission check before every move (2 h).
  res.setHeader("Access-Control-Max-Age", "7200");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "Method not allowed" }); return; }

  // Plain-text bodies (see the top) arrive as a string.
  let body = req.body || {};
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const now = Date.now();
  try {
    const admin = getFirebaseAdmin();
    const db = admin.firestore();
    let result;
    switch (body.action) {
      case "ping": loadUnits(); await verifyCaller(admin, req, false, body); result = { ok: true }; break;
      case "runStart": result = await runStart(db, await verifyCaller(admin, req, true, body), body, now); break;
      case "runAnswer": result = await runAnswer(db, await verifyCaller(admin, req, true, body), body, now); break;
      case "leaderboard": result = await leaderboard(db, await verifyCaller(admin, req, false, body), now); break;
      default: throw new HttpError(400, "Unknown action.");
    }
    res.status(200).json(result);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error("games failed:", e);
    res.status(status).json({ ok: false, error: status >= 500 ? "Something went wrong — try again." : e.message });
  }
};

// For tests.
module.exports._internals = { weekOf, weekEndsAt, weeksBefore, finalizeWeek, rescoreWeek, WEEKLY_PRIZES };
