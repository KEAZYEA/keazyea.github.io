/**
 * api/chat.js
 * 🌍 World Chat (in Social): one chat everyone signed in can talk in. Each
 * message carries a tag (General, Tips, Noobies, Formation, Games) so the
 * chat can be filtered without splitting people into separate rooms.
 *
 * Messages are written here, never by the browser, so slow mode, a paused
 * chat, timeouts/bans and the length limit can't be skipped. The browser
 * reads the chat live from Firestore and may only change its own reactions
 * on a message (the Firestore rules).
 *
 * POST JSON { action, ... } with "Authorization: Bearer <id token>":
 *   send   { text, tag, replyToId?, attachments? }  -> { id, ids }   (a reply quotes the message it answers)
 *          attachments: [{ image } | { video }] — one message each, in order, as many as
 *          today's limits allow (MAX_ATTACH is just a ceiling)
 *          (the text and the reply go with the first); or one image / video at the top.
 *   limits                         -> what you can post today: photos and videos left, video length, VIP's
 *          image: { url, path, w, h } — a photo the sender uploaded to
 *          chatImages/world/<their uid>/ (appState.js uploadChatPhoto); accounts
 *          at least PHOTO_MIN_AGE_DAYS old only. A photo needs no text.
 *          video: { url, path, posterUrl, posterPath, w, h, duration } — a video the
 *          sender's page shrank and uploaded to chatVideos/world/<uid>/ (appState.js
 *          uploadChatVideo): free players up to VIDEO_LIMITS.free.seconds, VIP up to
 *          .vip.seconds (the Storage rules cap the file size the same way), and
 *          VIDEOS_PER_DAY each; same account age as photos; none while videosOff.
 *          Photos: PHOTOS_PER_DAY each (World Chat).
 *   delete { msgId }                  -> your own message (the admin: anyone's);
 *                                        { imagePath, videoPath, posterPath } so the page removes the files
 *   adminSettings { slowSeconds, paused, videosOff } -> slow mode (seconds between someone's
 *                                     messages, 0-300), pausing the chat, and switching
 *                                     video uploads off everywhere (World Chat and DMs)
 *   translate { kind: "world" | "dm", msgId, threadId (dm), target } -> { text, from, same }
 *                                     a message in another language (🌐 Translate). Google
 *                                     Translate (GOOGLE_TRANSLATE_KEY), saved per message per
 *                                     language so it's only paid for once; DMs: members only.
 *                                     Limits: TRANSLATE_PER_DAY per player, and a monthly
 *                                     character cap (TRANSLATE_MONTHLY_CHARS, default 450,000 —
 *                                     Google's free 500,000 a month) so it can't run up a bill.
 *   adminStatus                    -> { translate: { month, chars, limit, configured } }
 *
 * Data:
 *   worldChat/{msgId}    { uid, name, avatar, text, tag, createdAt, image: { url, path, w, h } | null,
 *                          replyTo: { id, uid, name, text } | null, reactions: {} }
 * Photos are deleted by Cloud Storage after 90 days (a lifecycle rule on
 * chatImages/); the page then shows "Photo expired".
 *   chatConfig/world     { slowSeconds, paused, videosOff, updatedAt }   (everyone reads it;
 *                                                               the Storage rules check videosOff)
 *   chatUsers/{uid}      { lastAt, lastText, trDay, trCount }  (server-only: slow mode, repeats,
 *                                                               translations today)
 *   chatTranslations/{kind_thread_msg_lang}  { text, from, srcHash, at }  (server-only cache)
 *   chatStats/translate  { month, chars }                      (server-only: this month's use)
 */

const crypto = require("crypto");
const { getFirebaseAdmin, isBannedNow } = require("./_lib");
const { FieldValue } = require("firebase-admin/firestore");
const { videoDurationSeconds } = require("./_media");

const ADMIN_UID = "Ts92RY0ipMYDRJa2s5toQfDYxtp1"; // same as tokens.js and appState.js
const TAGS = ["general", "tips", "noobies", "formation", "games"]; // same as social.html WORLD_TAGS
const MAX_TEXT = 2000;
const QUOTE_LEN = 140;
const DEFAULT_SLOW_SECONDS = 5;
const MAX_SLOW_SECONDS = 300;
const REPEAT_WINDOW_MS = 60 * 1000; // the same message again within a minute is refused
const PHOTO_MIN_AGE_DAYS = 1; // same as appState.js CHAT_PHOTO_MIN_AGE_DAYS (videos too)
const ageText = () => `${PHOTO_MIN_AGE_DAYS} day${PHOTO_MIN_AGE_DAYS === 1 ? "" : "s"}`;
const VIDEO_LIMITS = { free: { seconds: 20 }, vip: { seconds: 60 } }; // same as appState.js VIDEO_LIMITS
const VIDEOS_PER_DAY = { free: 5, vip: 10 }; // World Chat videos a player can post a day
const PHOTOS_PER_DAY = { free: 30, vip: 60 }; // …and photos (VIP gets about double, not a lot more)
// photos / videos in one send (each becomes its own message): as many as your daily
// limits allow — this is only a technical ceiling (same as social.html's World Chat)
const MAX_ATTACH = 100;
const BUCKET = "kc-giveaway.firebasestorage.app"; // appState.js firebaseConfig.storageBucket
const TRANSLATE_PER_DAY = 150; // translations a player can ask for a day (saved ones are free and don't count)
const TRANSLATE_LANGS = ["en", "zh-CN", "zh-TW", "es", "pt", "fr", "de", "it", "ru", "ar", "hi", "id", "ms", "tl",
  "th", "vi", "ja", "ko", "tr", "pl", "nl", "uk", "bn", "fa"]; // same as social.html TRANSLATE_LANGS
const monthlyCharLimit = () => {
  const n = parseInt(process.env.TRANSLATE_MONTHLY_CHARS || "", 10);
  return Number.isFinite(n) && n >= 0 ? n : 450000;
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const isDocId = (s) => typeof s === "string" && s.length > 0 && s.length <= 200 && !s.includes("/");
// Keeps line breaks and tabs; drops other control characters; at most 3 blank lines in a row.
const cleanText = (v, max) => (typeof v === "string"
  ? v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").replace(/\n{4,}/g, "\n\n\n").trim().slice(0, max)
  : "");
const newId = (now) => now.toString(36) + Math.random().toString(36).slice(2, 10);
const configRef = (db) => db.collection("chatConfig").doc("world");
const settingsOf = (snap) => {
  const c = snap && snap.exists ? snap.data() : {};
  const slow = Number.isFinite(c.slowSeconds) ? c.slowSeconds : DEFAULT_SLOW_SECONDS;
  return { slowSeconds: Math.max(0, Math.min(MAX_SLOW_SECONDS, slow)), paused: c.paused === true, videosOff: c.videosOff === true };
};

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

// A photo the sender uploaded themselves: their own folder, this site's bucket.
function checkPhoto(img, uid) {
  if (img == null) return null;
  const bad = new HttpError(400, "That photo didn't upload properly — try again.");
  const path = img && typeof img.path === "string" ? img.path : "";
  if (!/^[A-Za-z0-9]{1,128}$/.test(uid) || !new RegExp(`^chatImages/world/${uid}/[A-Za-z0-9._-]{1,80}$`).test(path)) throw bad;
  const prefix = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(path)}?`;
  if (typeof img.url !== "string" || img.url.length > 1000 || !img.url.startsWith(prefix)) throw bad;
  const w = Math.round(Number(img.w)), h = Math.round(Number(img.h));
  if (!(w >= 1 && w <= 4000 && h >= 1 && h <= 4000)) throw bad;
  return { url: img.url, path, w, h };
}

// A video the sender's page shrank and uploaded: their own folder, this bucket.
function checkVideo(v, uid) {
  if (v == null) return null;
  const bad = new HttpError(400, "That video didn't upload properly — try again.");
  const path = v && typeof v.path === "string" ? v.path : "";
  const enc = (x) => `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(x)}?`;
  if (!/^[A-Za-z0-9]{1,128}$/.test(uid) || !new RegExp(`^chatVideos/world/${uid}/[A-Za-z0-9._-]{1,80}[.](mp4|webm|mov)$`).test(path)) throw bad;
  if (typeof v.url !== "string" || v.url.length > 1000 || !v.url.startsWith(enc(path))) throw bad;
  let posterUrl = "", posterPath = "";
  if (v.posterPath) {
    posterPath = String(v.posterPath);
    if (!new RegExp(`^chatImages/world/${uid}/[A-Za-z0-9._-]{1,80}$`).test(posterPath)) throw bad;
    if (typeof v.posterUrl !== "string" || v.posterUrl.length > 1000 || !v.posterUrl.startsWith(enc(posterPath))) throw bad;
    posterUrl = v.posterUrl;
  }
  const w = Math.round(Number(v.w) || 0), h = Math.round(Number(v.h) || 0), duration = Math.round((Number(v.duration) || 0) * 10) / 10;
  if (!(w >= 0 && w <= 4000 && h >= 0 && h <= 4000 && duration >= 0)) throw bad;
  return { url: v.url, path, posterUrl, posterPath, w, h, duration };
}

// A video's real length, read from the uploaded file itself — the page's own
// figure could have been edited. null if it can't be read (the file-size cap
// in the Storage rules still holds then). Costs one download of the (small,
// already shrunk) file per video posted.
async function realVideoSeconds(path) {
  try {
    const { getStorage } = require("firebase-admin/storage");
    const [buf] = await getStorage().bucket(BUCKET).file(path).download();
    return videoDurationSeconds(buf);
  } catch (e) {
    console.warn("video length check skipped:", path, e.message);
    return null;
  }
}
function deleteStoredFile(path) {
  try {
    const { getStorage } = require("firebase-admin/storage");
    return getStorage().bucket(BUCKET).file(path).delete().catch(() => { });
  } catch (e) { return Promise.resolve(); }
}

// What's attached: up to MAX_ATTACH photos / videos (attachments: [{ image } | { video }]),
// or one the older way (image / video at the top).
function attachmentsOf(body, uid) {
  const list = Array.isArray(body.attachments) ? body.attachments
    : (body.image || body.video) ? [{ image: body.image, video: body.video }] : [];
  if (list.length > MAX_ATTACH) throw new HttpError(400, `Up to ${MAX_ATTACH} photos or videos at once.`);
  return list.map(a => {
    const image = checkPhoto(a && a.image, uid), video = checkVideo(a && a.video, uid);
    if (image && video) throw new HttpError(400, "Send a photo or a video, not both.");
    if (!image && !video) throw new HttpError(400, "That attachment didn't upload properly — try again.");
    return { image, video };
  });
}

async function send(admin, db, uid, body, now) {
  const text = cleanText(body.text, MAX_TEXT);
  const atts = attachmentsOf(body, uid);
  const videos = atts.filter(a => a.video), photos = atts.filter(a => a.image);
  if (!text && !atts.length) throw new HttpError(400, "Write a message first.");
  if (typeof body.text === "string" && body.text.trim().length > MAX_TEXT) throw new HttpError(400, `Messages can be up to ${MAX_TEXT} characters.`);
  const tag = TAGS.includes(body.tag) ? body.tag : "general";
  const isAdmin = uid === ADMIN_UID;
  if (atts.length && !isAdmin) {
    // new accounts can chat, but photos and videos wait a few days (no throwaway accounts posting them)
    const made = Date.parse(((await admin.auth().getUser(uid)).metadata || {}).creationTime) || now;
    if (now - made < PHOTO_MIN_AGE_DAYS * 86400000) throw new HttpError(403, `${videos.length ? "Videos" : "Photos"} unlock ${ageText()} after you join — you can still send messages.`);
  }
  const [userSnap, pubSnap, cfgSnap, replySnap] = await Promise.all([
    db.collection("users").doc(uid).get(),
    db.collection("publicProfiles").doc(uid).get(),
    configRef(db).get(),
    isDocId(body.replyToId) ? db.collection("worldChat").doc(body.replyToId).get() : Promise.resolve(null)
  ]);
  if (userSnap.exists && isBannedNow(userSnap.data())) throw new HttpError(403, "Your account is currently restricted.");
  const settings = settingsOf(cfgSnap);
  if (settings.paused && !isAdmin) throw new HttpError(403, "World Chat is paused for now — check back soon.");
  const vip = userSnap.exists && (userSnap.data().vipExpiresAt || 0) > now;
  if (videos.length && !isAdmin) {
    if (settings.videosOff) throw new HttpError(403, "Videos are switched off for now — photos and messages still work.");
    const max = (vip ? VIDEO_LIMITS.vip : VIDEO_LIMITS.free).seconds;
    const tooLong = (secs) => new HttpError(400, (vip ? `Videos can be up to ${max} seconds` : `Free accounts can send videos up to ${max} seconds — VIP up to ${VIDEO_LIMITS.vip.seconds}`)
      + (secs ? ` (that one is ${Math.round(secs)}s).` : "."));
    if (videos.some(a => a.video.duration > max + 1)) throw tooLong(0);
    // what the page said is checked against the file itself
    const real = await Promise.all(videos.map(a => realVideoSeconds(a.video.path)));
    const bad = real.findIndex(sec => sec != null && sec > max + 1);
    if (bad >= 0) {
      videos.forEach(a => deleteStoredFile(a.video.path)); // nothing was posted: don't keep them
      throw tooLong(real[bad]);
    }
    real.forEach((sec, i) => { if (sec != null) videos[i].video.duration = Math.round(sec * 10) / 10; }); // the true length is what's shown
  }
  const pub = pubSnap.exists ? pubSnap.data() : {};
  const name = (typeof pub.name === "string" && pub.name.trim() ? pub.name.trim() : "Commander").slice(0, 40);
  const avatar = typeof pub.avatar === "string" ? pub.avatar.slice(0, 500) : "";
  let replyTo = null;
  if (body.replyToId) {
    if (!replySnap || !replySnap.exists) throw new HttpError(404, "The message you're replying to was deleted.");
    const r = replySnap.data();
    replyTo = { id: replySnap.id, uid: r.uid || "", name: (r.name || "Commander").slice(0, 40), text: String(r.text || (r.image ? "📷 Photo" : r.video ? "🎬 Video" : "")).slice(0, QUOTE_LEN) };
  }

  // one message per attachment (the text and the reply go with the first), in order
  const docs = atts.length ? atts.map((a, i) => ({ text: i ? "" : text, replyTo: i ? null : replyTo, image: a.image, video: a.video }))
    : [{ text, replyTo, image: null, video: null }];
  const ids = docs.map((d, i) => newId(now + i) + i);
  const userRef = db.collection("chatUsers").doc(uid);
  await db.runTransaction(async (tx) => {
    const last = await tx.get(userRef);
    const l = last.exists ? last.data() : {};
    if (!isAdmin) {
      const wait = Math.ceil(((l.lastAt || 0) + settings.slowSeconds * 1000 - now) / 1000);
      if (settings.slowSeconds && wait > 0) {
        const err = new HttpError(429, `Slow mode — wait ${wait}s before your next message.`);
        err.retryIn = wait;
        throw err;
      }
      if (!atts.length && l.lastText === text && now - (l.lastAt || 0) < REPEAT_WINDOW_MS) throw new HttpError(429, "You just sent that — try saying something new.");
    }
    const day = sgDay(now);
    // today's videos and photos (each its own daily limit)
    const overLimit = (n, used, perDay, vipPerDay, what) => {
      if (!n || isAdmin || used + n <= perDay) return;
      const left = Math.max(0, perDay - used);
      throw new HttpError(429, (left ? `You can post ${left} more ${what}${left === 1 ? "" : "s"} today (${perDay} a day)` : `That's ${perDay} ${what}s today — more tomorrow`)
        + (vip ? "." : ` — VIP can post ${vipPerDay} a day.`));
    };
    const vidCount = l.vidDay === day ? (l.vidCount || 0) : 0;
    const phoCount = l.phoDay === day ? (l.phoCount || 0) : 0;
    overLimit(videos.length, vidCount, vip ? VIDEOS_PER_DAY.vip : VIDEOS_PER_DAY.free, VIDEOS_PER_DAY.vip, "video");
    overLimit(photos.length, phoCount, vip ? PHOTOS_PER_DAY.vip : PHOTOS_PER_DAY.free, PHOTOS_PER_DAY.vip, "photo");
    // merge: the same record keeps today's translations count
    tx.set(userRef, {
      lastAt: now, lastText: text,
      ...(videos.length ? { vidDay: day, vidCount: vidCount + videos.length } : {}),
      ...(photos.length ? { phoDay: day, phoCount: phoCount + photos.length } : {})
    }, { merge: true });
    docs.forEach((d, i) => tx.set(db.collection("worldChat").doc(ids[i]), { uid, name, avatar, text: d.text, tag, createdAt: now + i, image: d.image, video: d.video, replyTo: d.replyTo, reactions: {} }));
  });
  return { id: ids[0], ids, slowSeconds: isAdmin ? 0 : settings.slowSeconds };
}

// What you can post today (shown by the 📷 button): videos left, how long, VIP's.
async function limits(admin, db, uid, now) {
  const [userSnap, chatSnap, cfgSnap] = await Promise.all([db.collection("users").doc(uid).get(), db.collection("chatUsers").doc(uid).get(), configRef(db).get()]);
  const isAdmin = uid === ADMIN_UID;
  const vip = isAdmin || (userSnap.exists && (userSnap.data().vipExpiresAt || 0) > now);
  const l = chatSnap.exists ? chatSnap.data() : {};
  const day = sgDay(now);
  const perDay = vip ? VIDEOS_PER_DAY.vip : VIDEOS_PER_DAY.free;
  const used = l.vidDay === day ? (l.vidCount || 0) : 0;
  const photosPerDay = vip ? PHOTOS_PER_DAY.vip : PHOTOS_PER_DAY.free;
  const photosUsed = l.phoDay === day ? (l.phoCount || 0) : 0;
  let mediaOk = isAdmin;
  if (!isAdmin) {
    const made = Date.parse(((await admin.auth().getUser(uid)).metadata || {}).creationTime) || now;
    mediaOk = now - made >= PHOTO_MIN_AGE_DAYS * 86400000;
  }
  return {
    vip, maxAttach: MAX_ATTACH, mediaOk, videosOff: settingsOf(cfgSnap).videosOff,
    videosPerDay: perDay, videosToday: used, videosLeft: isAdmin ? perDay : Math.max(0, perDay - used),
    videoSeconds: (vip ? VIDEO_LIMITS.vip : VIDEO_LIMITS.free).seconds,
    vipVideoSeconds: VIDEO_LIMITS.vip.seconds, vipVideosPerDay: VIDEOS_PER_DAY.vip,
    photosPerDay, photosToday: photosUsed, photosLeft: isAdmin ? photosPerDay : Math.max(0, photosPerDay - photosUsed), vipPhotosPerDay: PHOTOS_PER_DAY.vip
  };
}

async function remove(db, uid, body) {
  if (!isDocId(body.msgId)) throw new HttpError(400, "Missing message.");
  const ref = db.collection("worldChat").doc(body.msgId);
  const snap = await ref.get();
  if (!snap.exists) return { deleted: false };
  if (snap.data().uid !== uid && uid !== ADMIN_UID) throw new HttpError(403, "You can only delete your own messages.");
  await ref.delete();
  const img = snap.data().image, vid = snap.data().video;
  return {
    deleted: true,
    imagePath: img && typeof img.path === "string" ? img.path : null,
    videoPath: vid && typeof vid.path === "string" ? vid.path : null,
    posterPath: vid && typeof vid.posterPath === "string" && vid.posterPath ? vid.posterPath : null
  };
}

// The day / month in Singapore time (the site's day boundary).
const sgDay = (ms) => new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
const hashOf = (text) => crypto.createHash("sha1").update(text).digest("hex").slice(0, 16);

async function googleTranslate(text, target) {
  const key = process.env.GOOGLE_TRANSLATE_KEY;
  if (!key) throw new HttpError(503, "Translation isn't switched on yet.");
  const res = await fetch("https://translation.googleapis.com/language/translate/v2?key=" + encodeURIComponent(key), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q: text, target, format: "text" })
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* not JSON */ }
  const t = data && data.data && data.data.translations && data.data.translations[0];
  if (!res.ok || !t) {
    console.error("translate failed:", res.status, JSON.stringify(data).slice(0, 300));
    throw new HttpError(502, "Couldn't translate right now — try again in a bit.");
  }
  return { text: String(t.translatedText || ""), from: String(t.detectedSourceLanguage || "") };
}

async function translate(db, uid, body, now) {
  const kind = body.kind === "dm" ? "dm" : "world";
  const target = TRANSLATE_LANGS.includes(body.target) ? body.target : null;
  if (!target) throw new HttpError(400, "Pick a language.");
  if (!isDocId(body.msgId) || (kind === "dm" && !isDocId(body.threadId))) throw new HttpError(400, "Missing message.");
  let msgSnap;
  if (kind === "dm") {
    const thread = await db.collection("dmThreads").doc(body.threadId).get();
    if (!thread.exists || !(thread.data().members || []).includes(uid)) throw new HttpError(403, "That isn't your chat.");
    msgSnap = await thread.ref.collection("messages").doc(body.msgId).get();
  } else {
    msgSnap = await db.collection("worldChat").doc(body.msgId).get();
  }
  if (!msgSnap.exists) throw new HttpError(404, "That message was deleted.");
  const text = String(msgSnap.data().text || "").trim();
  if (!text) throw new HttpError(400, "There's no text to translate.");
  const srcHash = hashOf(text);
  const cacheRef = db.collection("chatTranslations").doc(`${kind}_${kind === "dm" ? body.threadId : "w"}_${body.msgId}_${target}`);
  const cached = await cacheRef.get();
  // saved (and the message hasn't been edited since): free, doesn't count
  if (cached.exists && cached.data().srcHash === srcHash) {
    const c = cached.data();
    return { text: c.text, from: c.from, same: c.same === true, cached: true };
  }
  if (!process.env.GOOGLE_TRANSLATE_KEY) throw new HttpError(503, "Translation isn't switched on yet.");
  // limits: yours today, everyone's this month
  const userRef = db.collection("chatUsers").doc(uid);
  const statsRef = db.collection("chatStats").doc("translate");
  const day = sgDay(now), month = day.slice(0, 7), limit = monthlyCharLimit();
  const isAdmin = uid === ADMIN_UID;
  await db.runTransaction(async (tx) => {
    const [u, st] = await Promise.all([tx.get(userRef), tx.get(statsRef)]);
    const ud = u.exists ? u.data() : {}, sd = st.exists ? st.data() : {};
    const count = ud.trDay === day ? (ud.trCount || 0) : 0;
    const used = sd.month === month ? (sd.chars || 0) : 0;
    if (!isAdmin && count >= TRANSLATE_PER_DAY) throw new HttpError(429, `That's ${TRANSLATE_PER_DAY} translations today — more tomorrow.`);
    if (used + text.length > limit) throw new HttpError(429, "Translation is resting until next month (this month's free amount is used up).");
    tx.set(userRef, { trDay: day, trCount: count + 1 }, { merge: true });
    tx.set(statsRef, { month, chars: used + text.length });
  });
  let out;
  try {
    out = await googleTranslate(text, target);
  } catch (e) {
    // a failed one isn't counted
    await Promise.all([
      userRef.set({ trCount: FieldValue.increment(-1) }, { merge: true }),
      statsRef.set({ chars: FieldValue.increment(-text.length) }, { merge: true })
    ]).catch(() => { });
    throw e;
  }
  // already in that language (Google says so, or gives the same text back)
  const base = (code) => String(code || "").toLowerCase().split("-")[0];
  const same = base(out.from) === base(target) || out.text.trim() === text;
  await cacheRef.set({ text: out.text, from: out.from, same, srcHash, at: now });
  return { text: out.text, from: out.from, same, cached: false };
}

async function adminStatus(db, now) {
  const st = await db.collection("chatStats").doc("translate").get();
  const month = sgDay(now).slice(0, 7), d = st.exists ? st.data() : {};
  return { translate: { month, chars: d.month === month ? (d.chars || 0) : 0, limit: monthlyCharLimit(), configured: !!process.env.GOOGLE_TRANSLATE_KEY } };
}

async function adminSettings(db, body, now) {
  const slow = Math.round(Number(body.slowSeconds));
  if (!Number.isFinite(slow) || slow < 0 || slow > MAX_SLOW_SECONDS) throw new HttpError(400, `Slow mode is 0–${MAX_SLOW_SECONDS} seconds.`);
  const settings = { slowSeconds: slow, paused: body.paused === true, videosOff: body.videosOff === true, updatedAt: now };
  await configRef(db).set(settings);
  return settings;
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
      case "send": result = await send(admin, db, uid, body, now); break;
      case "delete": result = await remove(db, uid, body); break;
      case "adminSettings": assertAdmin(uid); result = await adminSettings(db, body, now); break;
      case "translate": result = await translate(db, uid, body, now); break;
      case "limits": result = await limits(admin, db, uid, now); break;
      case "adminStatus": assertAdmin(uid); result = await adminStatus(db, now); break;
      default: throw new HttpError(400, "Unknown action.");
    }
    res.status(200).json(result);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error("chat failed:", e);
    res.status(status).json({ ok: false, error: status >= 500 ? "Something went wrong — try again." : e.message, ...(e.retryIn ? { retryIn: e.retryIn } : {}) });
  }
};

module.exports.TAGS = TAGS;
module.exports.TRANSLATE_LANGS = TRANSLATE_LANGS;
