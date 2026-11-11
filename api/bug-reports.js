/**
 * api/bug-reports.js
 * 🐞 Bug reports: a player tells you what went wrong (and can add up to 5
 * screenshots); you read them in admin → 🐞 Bug reports, mark them fixed or
 * not a bug, reply, and can send a thank-you gift (the gift itself goes
 * through api/tokens.js adminSendGift, like any other gift).
 *
 * Reports are written here, never by the browser, so the size limits, the
 * daily limit and "only your own screenshots" can't be skipped, and no
 * Firestore rules are needed (the browser never reads bugReports).
 * Screenshots are uploaded first like DM photos (chatImages/dm/<uid>/…,
 * shrunk on the phone; deleted after 90 days by the bucket's lifecycle rule).
 *
 * POST JSON { action, ... } with "Authorization: Bearer <id token>":
 *   submit { text, images: [{ url, path, w, h }] (0–5), page, device }  -> { ok, id }
 *   mine                                                               -> { reports: [...] }  (your last 20)
 *   adminList { status: "open" | "closed" | "all" }                    -> { reports: [...], open }
 *   adminUpdate { id, status: "open" | "fixed" | "notBug", reply, notify, gift }  -> { ok }
 *
 * Data: bugReports/{id} { uid, name, text, images, page, device, status, reply,
 *        gift (what was sent, if anything), createdAt, updatedAt, closedAt }
 *       bugReportLimits/{uid} { day, count }   (BUG_REPORTS_PER_DAY a day each)
 */
const { getFirebaseAdmin, ADMIN_UID } = require("./_lib");

const BUCKET = "kc-giveaway.firebasestorage.app"; // appState.js firebaseConfig.storageBucket
const MAX_IMAGES = 5;
const MAX_TEXT = 2000, MIN_TEXT = 5;
const BUG_REPORTS_PER_DAY = 5;
const STATUSES = ["open", "fixed", "notBug"];

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const isDocId = (s) => typeof s === "string" && s.length > 0 && s.length <= 200 && !s.includes("/");
const cleanText = (v, max) => typeof v === "string" ? v.trim().slice(0, max) : "";
const newId = (now) => now.toString(36) + Math.random().toString(36).slice(2, 10);
const dayOf = (now) => new Date(now).toISOString().slice(0, 10);

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

// A screenshot the reporter uploaded themselves: their own folder, this site's bucket.
function checkImage(img, uid) {
  const bad = new HttpError(400, "A screenshot didn't upload properly — try again.");
  const path = img && typeof img.path === "string" ? img.path : "";
  if (!/^[A-Za-z0-9]{1,128}$/.test(uid) || !new RegExp(`^chatImages/dm/${uid}/[A-Za-z0-9._-]{1,80}$`).test(path)) throw bad;
  const prefix = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(path)}?`;
  if (typeof img.url !== "string" || img.url.length > 1000 || !img.url.startsWith(prefix)) throw bad;
  const w = Math.round(Number(img.w)), h = Math.round(Number(img.h));
  if (!(w >= 1 && w <= 4000 && h >= 1 && h <= 4000)) throw bad;
  return { url: img.url, path, w, h };
}

async function submit(db, uid, body, now) {
  const text = cleanText(body.text, MAX_TEXT + 1);
  if (text.length < MIN_TEXT) throw new HttpError(400, "Tell us what went wrong (a few words at least).");
  if (text.length > MAX_TEXT) throw new HttpError(400, `Please keep it under ${MAX_TEXT} characters.`);
  const raw = Array.isArray(body.images) ? body.images : [];
  if (raw.length > MAX_IMAGES) throw new HttpError(400, `Up to ${MAX_IMAGES} screenshots.`);
  const images = raw.map(i => checkImage(i, uid));
  const d = body.device && typeof body.device === "object" ? body.device : {};
  const device = {
    ua: cleanText(d.ua, 300), screen: cleanText(d.screen, 40), lang: cleanText(d.lang, 20), standalone: d.standalone === true
  };
  const page = cleanText(body.page, 200);

  const profileSnap = await db.collection("users").doc(uid).get();
  const name = profileSnap.exists ? cleanText(profileSnap.data().name, 60) : "";
  const id = newId(now);
  const limitRef = db.collection("bugReportLimits").doc(uid);
  await db.runTransaction(async (tx) => {
    const [limSnap] = await tx.getAll(limitRef);
    const lim = limSnap.exists ? limSnap.data() : {};
    const count = lim.day === dayOf(now) ? (lim.count || 0) : 0;
    if (count >= BUG_REPORTS_PER_DAY) throw new HttpError(429, `That's ${BUG_REPORTS_PER_DAY} reports today — thanks! You can send more tomorrow.`);
    tx.set(limitRef, { day: dayOf(now), count: count + 1, updatedAt: now });
    tx.set(db.collection("bugReports").doc(id), {
      uid, name, text, images, page, device, status: "open", reply: "", gift: null, createdAt: now, updatedAt: now, closedAt: null
    });
  });
  // a note in your (the admin's) inbox
  try {
    await db.collection("users").doc(ADMIN_UID).collection("personalNotifications").add({
      type: "bugReport", title: `🐞 New bug report${name ? " from " + name : ""}`,
      body: text.slice(0, 160) + (text.length > 160 ? "…" : "") + (images.length ? ` (📷 ${images.length})` : "") + " — open admin → 🐞 Bug reports.",
      createdAt: now, read: false
    });
  } catch (e) { console.warn("Couldn't notify the admin about a bug report:", e.message); }
  return { ok: true, id };
}

const shape = (d) => {
  const r = d.data();
  return { id: d.id, uid: r.uid, name: r.name || "", text: r.text, images: r.images || [], page: r.page || "", device: r.device || {},
    status: r.status, reply: r.reply || "", gift: r.gift || null, createdAt: r.createdAt, updatedAt: r.updatedAt || r.createdAt, closedAt: r.closedAt || null };
};

async function mine(db, uid) {
  // (no index needed: one player's few reports, sorted here)
  const snap = await db.collection("bugReports").where("uid", "==", uid).limit(50).get();
  const reports = snap.docs.map(shape).sort((a, b) => b.createdAt - a.createdAt).slice(0, 20)
    .map(({ uid: _u, device: _d, ...r }) => r);
  return { reports };
}

async function adminList(db, body) {
  const want = ["open", "closed", "all"].includes(body.status) ? body.status : "open";
  const snap = await db.collection("bugReports").orderBy("createdAt", "desc").limit(300).get();
  const all = snap.docs.map(shape);
  const reports = all.filter(r => want === "all" || (want === "open" ? r.status === "open" : r.status !== "open")).slice(0, 100);
  return { reports, open: all.filter(r => r.status === "open").length };
}

async function adminUpdate(db, adminUid, body, now) {
  if (!isDocId(body.id)) throw new HttpError(400, "Missing report.");
  const status = body.status;
  if (!STATUSES.includes(status)) throw new HttpError(400, "Choose open, fixed or not a bug.");
  const reply = cleanText(body.reply, 500);
  const g = body.gift && typeof body.gift === "object" ? body.gift : null;
  const gift = g ? { giftId: cleanText(g.giftId, 60), what: cleanText(g.what, 200) } : undefined;
  const ref = db.collection("bugReports").doc(body.id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpError(404, "No such report.");
  const r = snap.data();
  await ref.set({
    status, reply, updatedAt: now, closedAt: status === "open" ? null : (r.closedAt || now), by: adminUid,
    ...(gift !== undefined ? { gift } : {})
  }, { merge: true });

  if (body.notify === true) {
    const sentGift = gift || r.gift;
    const title = status === "fixed" ? "🐞 Fixed — thanks for your bug report!" : status === "notBug" ? "🐞 About your bug report" : "🐞 We're looking at your bug report";
    const lines = [
      `You reported: "${(r.text || "").slice(0, 120)}${(r.text || "").length > 120 ? "…" : ""}"`,
      reply,
      sentGift && sentGift.what ? `🎁 As a thank-you: ${sentGift.what} — claim it from your inbox.` : ""
    ].filter(Boolean);
    try {
      await db.collection("users").doc(r.uid).collection("personalNotifications").add({
        type: "bugReportReply", title, body: lines.join("\n\n"), createdAt: now, read: false
      });
    } catch (e) { console.warn(`Couldn't tell ${r.uid} about their bug report:`, e.message); }
  }
  return { ok: true };
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
      case "submit": result = await submit(db, uid, body, now); break;
      case "mine": result = await mine(db, uid); break;
      case "adminList": assertAdmin(uid); result = await adminList(db, body); break;
      case "adminUpdate": assertAdmin(uid); result = await adminUpdate(db, uid, body, now); break;
      default: throw new HttpError(400, "Unknown action.");
    }
    res.status(200).json(result);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error("bug-reports failed:", e);
    res.status(status).json({ ok: false, error: status >= 500 ? "Something went wrong — try again." : e.message });
  }
};
module.exports._internals = { checkImage, MAX_IMAGES, BUG_REPORTS_PER_DAY };
