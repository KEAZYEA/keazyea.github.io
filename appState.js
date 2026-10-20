/* ============================================================
   appState.js  (Stage 3 — adds clan recruiting, friends, DMs,
   unique names, reports, and admin ban tools on top of Stage 2)
   ------------------------------------------------------------
   Everything from Stage 2 (Firebase auth/profile, PayPal-driven
   VIP/noAds, giveaway, promo codes, tips, notifications) is
   unchanged below. New sections are clearly marked.
   ============================================================ */
import {
    getFirestore,
    doc,
    getDoc,
    setDoc,
    addDoc,
    updateDoc,
    deleteDoc,
    collection,
    query,
    where,
    orderBy,
    limit,
    startAfter,
    getDocs,
    onSnapshot,
    Timestamp,
    documentId,
    increment,
    runTransaction,
    arrayUnion
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import {
    getStorage,
    ref,
    uploadBytes,
    getDownloadURL,
    deleteObject
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-storage.js";
import {
    getAuth,
    signInWithPopup,
    GoogleAuthProvider,
    signOut as firebaseSignOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
const firebaseConfig = {
    apiKey: "AIzaSyBYaZg000g9wxMIzDLONsSXLUgZIoJ4GNQ",
    authDomain: "kc-giveaway.firebaseapp.com",
    projectId: "kc-giveaway",
    storageBucket: "kc-giveaway.firebasestorage.app",
    messagingSenderId: "834851088471",
    appId: "1:834851088471:web:3cb65f42f3546000c9db12"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
// browserLocalPersistence is already the default for web apps — calling
// setPersistence() explicitly here forces Firebase Auth to re-verify its
// session internally, which can fire onAuthStateChanged an extra time
// with user=null BEFORE the real restored user comes through. Since
// waitForAuthReady() below only resolves on the FIRST onAuthStateChanged
// callback, that spurious null firing wins the race — currentUser looks
// signed-out for a moment, and getProfile() falls back to the local
// default profile (Bomber avatar) until the real callback (and manual
// refreshTopbar() from onAuthChange) catches up. Removing this call
// avoids the extra internal reset entirely.
const db = getFirestore(app);
const storage = getStorage(app);
const googleProvider = new GoogleAuthProvider();

const ADMIN_UID = "Ts92RY0ipMYDRJa2s5toQfDYxtp1"; // your uid — only this account can use admin.html
const BACKEND_BASE = "https://kih-store.vercel.app"; // same Vercel API store.html calls
const AppState = (function () {
    const KEYS = {
        inbox: "kih_inbox",
        localProfile: "kih_local_profile"
    };

    let currentUser = null;
let authReadyResolve;
const authReady = new Promise(resolve => { authReadyResolve = resolve; });

let adGeneration = 0;

// ---- CROSS-IFRAME SIGN-IN SYNC ----
// Every page (home.html + every iframe: promo/social/tips/troops/store)
// loads its OWN copy of appState.js, each with its OWN Firebase Auth
// instance. Firebase syncs a signed-in session across these via
// localStorage, but that sync can lag a couple seconds — long enough
// that a page you're ALREADY on (e.g. Social, opened before you signed
// in on Promo) keeps showing "Sign in with Google" until something
// forces it to recheck. Instead of waiting on Firebase's own timing,
// broadcast our own signal the moment sign-in succeeds, and have any
// OTHER already-open page reload itself the instant it sees that
// signal — a reload guarantees a clean re-read of the now fully
// persisted session, no race possible.
//
// Guarded to iframes only (window.self !== window.top) — we never want
// this to reload home.html itself, since that would kick the user back
// to the landing screen and reload every other iframe with it.
const AUTH_BROADCAST_KEY = "kih_auth_broadcast_at";
if (window.self !== window.top) {
    window.addEventListener("storage", (e) => {
        if (e.key !== AUTH_BROADCAST_KEY) return;
        if (!currentUser) {
            window.location.reload();
        }
    });
}

onAuthStateChanged(auth, (user) => {
    currentUser = user || null;
    adGeneration++;
    authReadyResolve();
    window.dispatchEvent(new CustomEvent("kih-auth-changed", { detail: { user: currentUser } }));
});

/* ---------------- AUTH ---------------- */

function waitForAuthReady() {
    return authReady;
}

function getCurrentUser() {
    return currentUser;
}

function broadcastAuthChange() {
    try {
        localStorage.setItem(AUTH_BROADCAST_KEY, String(Date.now()));
    } catch (e) {
        console.warn("Couldn't broadcast auth change:", e.message);
    }
}

async function signIn() {
    const result = await signInWithPopup(auth, googleProvider);
    // Tell every other open iframe a sign-in just happened, so any of
    // them still showing a signed-out gate reload and pick it up
    // immediately instead of waiting on Firebase's own cross-tab timing.
    broadcastAuthChange();
    return result.user;
}

async function signOutUser() {
    await firebaseSignOut(auth);
    // Same idea in reverse — keeps other open iframes from staying
    // "signed in" looking after you actually sign out somewhere else.
    broadcastAuthChange();
}

    function onAuthChange(callback) {
        window.addEventListener("kih-auth-changed", (e) => callback(e.detail.user));
    }

    // Used by store.html to authenticate calls to the Vercel cancel-subscription
    // endpoint — proves to the backend who is making the request.
    async function getIdToken() {
        await waitForAuthReady();
        if (!currentUser) throw new Error("Not signed in.");
        return currentUser.getIdToken();
    }

    /* ---------------- DAILY QUESTS & TOKENS ----------------
       Balances only ever change on the server (api/tokens.js). Everything
       here either asks it to, or listens to what it wrote. That's what keeps
       every device in agreement: unlike the inbox's "seen" marker, there is
       no per-device copy of anything that matters, so there's nothing to
       drift. The few localStorage keys below only save network calls, and
       being wrong about them can never earn or lose a token. */
    // v2: quests carry what they pay, plus the week for the login calendar.
    const QUEST_CACHE_KEY = "kih_quest_today_v2";
    const QUEST_RETRY_KEY = "kih_quest_retry";
    const LOGIN_CLAIM_KEY = "kih_login_claim";
    const QUEST_RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;

    async function callTokensApi(action, payload = {}, { auth = true } = {}) {
        const headers = { "Content-Type": "application/json" };
        if (auth) headers.Authorization = "Bearer " + await getIdToken();
        const res = await fetch(BACKEND_BASE + "/api/tokens", {
            method: "POST",
            headers,
            body: JSON.stringify({ action, ...payload })
        });
        let data = null;
        try { data = await res.json(); } catch (e) { /* non-JSON error page */ }
        if (!res.ok) {
            const err = new Error((data && data.error) || `Request failed (${res.status})`);
            err.status = res.status;
            throw err;
        }
        return data;
    }

    function readCachedTodaysQuests() {
        try {
            const cached = JSON.parse(localStorage.getItem(QUEST_CACHE_KEY) || "null");
            if (cached && cached.resetAt > Date.now() && Array.isArray(cached.quests) && cached.rewards && Array.isArray(cached.week)) return cached;
        } catch (e) { /* storage blocked */ }
        return null;
    }

    // { dayKey, resetAt, quests, rewards, week }: rewards is { questId: tokens },
    // week is Monday..Sunday day keys. Cached until the next reset, so each device
    // asks the server once a day rather than on every page view.
    async function getTodaysQuests() {
        const cached = readCachedTodaysQuests();
        if (cached) return cached;
        const data = await callTokensApi("today", {}, { auth: false });
        const today = { dayKey: data.dayKey, resetAt: data.resetAt, quests: data.quests,
            rewards: data.rewards || {}, week: Array.isArray(data.week) ? data.week : [data.dayKey] };
        try { localStorage.setItem(QUEST_CACHE_KEY, JSON.stringify(today)); } catch (e) { /* storage blocked */ }
        return today;
    }

    function listenToMyWallet(callback) {
        if (!currentUser) { callback({ balance: 0 }); return () => {}; }
        return onSnapshot(doc(db, "tokenWallets", currentUser.uid), (snap) => {
            callback(snap.exists() ? snap.data() : { balance: 0 });
        }, (err) => {
            console.warn("Wallet listener failed:", err.message);
            callback({ balance: 0 });
        });
    }

    // Live quest progress, from any device:
    //   today:  { questId: "ready" | "claimed" } for `dayKey`
    //   logins: { dayKey: { status, reward, chest } } for this week's login
    //           calendar (`week` is Monday..Sunday day keys)
    //   ready:  every reward done but not yet claimed, from ANY day (they
    //           don't expire), as [{ id, questId, dayKey, reward, chest }]
    // Two small queries rather than one over all claims, which grow forever.
    // Docs from before the claim step have no status and were already paid.
    function listenToMyQuestProgress(dayKey, callback, week = [dayKey]) {
        if (!currentUser) { callback({ today: {}, logins: {}, ready: [] }); return () => {}; }
        const claims = collection(db, "tokenWallets", currentUser.uid, "claims");
        let today = null;
        let logins = null;
        let ready = null;
        const emit = () => { if (today && ready) callback({ today, logins: logins || {}, ready }); };
        const onFail = (err) => {
            console.warn("Quest progress listener failed:", err.message);
            today = today || {};
            ready = ready || [];
            emit();
        };
        // The whole week at once (a handful of docs a day): today's quests
        // plus every login, for the calendar.
        const unsubWeek = onSnapshot(query(claims, where("dayKey", "in", week.includes(dayKey) ? week : [dayKey, ...week])), (snap) => {
            today = {};
            logins = {};
            snap.forEach(d => {
                const c = d.data();
                const status = c.status === "ready" ? "ready" : "claimed";
                if (c.dayKey === dayKey) today[c.questId] = status;
                if (c.questId === "login") logins[c.dayKey] = { status, reward: c.reward || 1, chest: !!c.chest };
            });
            emit();
        }, onFail);
        const unsubReady = onSnapshot(query(claims, where("status", "==", "ready")), (snap) => {
            ready = [];
            snap.forEach(d => ready.push({ id: d.id, questId: d.data().questId, dayKey: d.data().dayKey, reward: d.data().reward || 1, chest: !!d.data().chest }));
            ready.sort((a, b) => a.dayKey.localeCompare(b.dayKey));
            emit();
        }, onFail);
        return () => { unsubWeek(); unsubReady(); };
    }

    // Ids of every admin gift this account has claimed, live from any device
    // (see claimGift in api/tokens.js — they're stored alongside quest claims).
    function listenToMyGiftClaims(callback) {
        if (!currentUser) { callback(new Set()); return () => {}; }
        const q = query(collection(db, "tokenWallets", currentUser.uid, "claims"), where("kind", "==", "gift"));
        return onSnapshot(q, (snap) => {
            const ids = new Set();
            snap.forEach(d => ids.add(d.data().giftId));
            callback(ids);
        }, (err) => {
            console.warn("Gift claims listener failed:", err.message);
            callback(new Set());
        });
    }

    // Claims a gift from the inbox. Returns { claimed, balance } or throws
    // with the reason (expired, not for this account, ...).
    async function claimTokenGift(giftId) {
        await waitForAuthReady();
        if (!currentUser) throw new Error("Sign in first.");
        return callTokensApi("claimGift", { giftId });
    }

    // admin.html's token tools. The server refuses anyone but the admin;
    // this check just saves a pointless round trip.
    async function adminTokens(action, payload = {}) {
        await waitForAuthReady();
        if (!currentUser || currentUser.uid !== ADMIN_UID) throw new Error("Not authorized.");
        return callTokensApi(action, payload);
    }

    // Collects ready rewards (ids from listenToMyQuestProgress). Returns
    // { claimed, balance }; ids already claimed elsewhere are just skipped.
    async function claimQuestRewards(claimIds) {
        await waitForAuthReady();
        if (!currentUser) throw new Error("Sign in first.");
        return callTokensApi("claim", { claimIds });
    }

    // Hands in a finished play of today's puzzle in Games. The server checks it
    // against the same puzzle and pays 1 token, once a day: { paid, already, balance }.
    async function submitDailyPuzzle(day, play) {
        await waitForAuthReady();
        if (!currentUser) throw new Error("Sign in first.");
        return callTokensApi("dailyPuzzle", { day, play });
    }

    // Games' ranked runs and weekly leaderboard (api/games.js). A ranked run
    // is played on the server one move at a time, so its answers never
    // reach this page.
    // Sent as plain text with the token in the body (not an Authorization
    // header): the browser then sends it at once, without first asking the
    // server for permission — one trip per move instead of two.
    async function callGamesApi(action, payload = {}) {
        await waitForAuthReady();
        const body = { action, ...payload };
        if (currentUser) body.idToken = await getIdToken();
        const res = await fetch(BACKEND_BASE + "/api/games", { method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: JSON.stringify(body) });
        let data = null;
        try { data = await res.json(); } catch (e) { /* non-JSON error page */ }
        if (!res.ok) {
            const err = new Error((data && data.error) || `Request failed (${res.status})`);
            err.status = res.status;
            throw err;
        }
        return data;
    }
    const gamesRunStart = (game) => callGamesApi("runStart", { game });
    const gamesRunAnswer = (runId, input) => callGamesApi("runAnswer", { runId, input });
    const gamesLeaderboard = () => callGamesApi("leaderboard");
    // Wakes the games server up while the page loads (errors don't matter).
    const gamesPing = () => callGamesApi("ping").catch(() => null);

    async function getMyTokenBalance() {
        await waitForAuthReady();
        if (!currentUser) return 0;
        try {
            const snap = await getDoc(doc(db, "tokenWallets", currentUser.uid));
            return snap.exists() ? (snap.data().balance || 0) : 0;
        } catch (e) {
            return 0;
        }
    }

    // Called right after an action that might complete a quest. Fire-and-
    // forget: a quest is a bonus, so it must never block or fail the action
    // itself. The server decides whether it counts. If the request never got
    // an answer at all, it's queued and retried, so a dropped connection
    // doesn't silently cost someone their token.
    // Quests this page already knows are done today ("uid|day|quest"), so
    // repeat triggers — every unit card opened, every slider move in Compare —
    // don't each ask the server again.
    const questsDoneHere = new Set();

    async function reportQuestProgress(questId, proofId = null) {
        try {
            await waitForAuthReady();
            if (!currentUser) return null;
            // Skip the round trip when it's definitely not one of today's quests.
            const cached = readCachedTodaysQuests();
            if (cached && !cached.quests.includes(questId)) return null;
            const doneKey = cached ? `${currentUser.uid}|${cached.dayKey}|${questId}` : null;
            if (doneKey && questsDoneHere.has(doneKey)) return null;
            const result = await callTokensApi("complete", { questId, proofId });
            if (doneKey && result && (result.completed || result.alreadyCompleted)) questsDoneHere.add(doneKey);
            return result;
        } catch (e) {
            // A 4xx is a definite "no" — retrying would just be refused forever.
            if (!e.status || e.status >= 500) queueQuestRetry(questId, proofId);
            else console.warn("Quest not counted:", e.message);
            return null;
        }
    }

    function queueQuestRetry(questId, proofId) {
        try {
            const cutoff = Date.now() - QUEST_RETRY_WINDOW_MS;
            const list = JSON.parse(localStorage.getItem(QUEST_RETRY_KEY) || "[]")
                .filter(r => r.at > cutoff && !(r.questId === questId && r.proofId === proofId));
            list.push({ questId, proofId, at: Date.now() });
            localStorage.setItem(QUEST_RETRY_KEY, JSON.stringify(list.slice(-20)));
        } catch (e) { /* storage blocked */ }
    }

    async function flushQuestRetries() {
        let list = [];
        try {
            list = JSON.parse(localStorage.getItem(QUEST_RETRY_KEY) || "[]");
            localStorage.removeItem(QUEST_RETRY_KEY);
        } catch (e) { /* storage blocked */ }
        const cutoff = Date.now() - QUEST_RETRY_WINDOW_MS;
        // Anything that fails again is re-queued by reportQuestProgress itself.
        for (const r of list) {
            if (r.at > cutoff) await reportQuestProgress(r.questId, r.proofId);
        }
    }

    let loginClaimedUntil = 0;
    let loginClaimInFlight = null;

    // Login counts when a signed-in person VISITS, not when they press Sign In:
    // Firebase keeps people signed in, so most returning players never press it.
    function claimDailyLogin() {
        if (loginClaimInFlight) return loginClaimInFlight;
        loginClaimInFlight = (async () => {
            await waitForAuthReady();
            if (!currentUser || Date.now() < loginClaimedUntil) return;
            try {
                const stored = JSON.parse(localStorage.getItem(LOGIN_CLAIM_KEY) || "null");
                if (stored && stored.uid === currentUser.uid && stored.resetAt > Date.now()) {
                    loginClaimedUntil = stored.resetAt;
                    return;
                }
            } catch (e) { /* storage blocked */ }
            const result = await reportQuestProgress("login");
            if (result && result.ok && (result.completed || result.alreadyCompleted)) {
                loginClaimedUntil = result.resetAt;
                try {
                    localStorage.setItem(LOGIN_CLAIM_KEY, JSON.stringify({ uid: currentUser.uid, resetAt: result.resetAt }));
                } catch (e) { /* storage blocked */ }
            }
        })().finally(() => { loginClaimInFlight = null; });
        return loginClaimInFlight;
    }

    // Started once, by the top-level page only — appState.js also runs inside
    // every iframe, and each claiming independently would multiply the calls.
    let questTrackingStarted = false;
    function startDailyQuestTracking() {
        if (questTrackingStarted) return;
        questTrackingStarted = true;
        const run = () => {
            loginClaimedUntil = 0; // a different account may have signed in
            claimDailyLogin().catch(() => {});
            flushQuestRetries().catch(() => {});
        };
        waitForAuthReady().then(run);
        onAuthChange(run);
        // Phones freeze background tabs, so a timer can't be trusted to fire
        // overnight — re-check whenever the tab comes back into view instead.
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") claimDailyLogin().catch(() => {});
        });
        // And for a tab left open in the foreground across the reset.
        const scheduleNextReset = async () => {
            try {
                const today = await getTodaysQuests();
                const wait = Math.min(Math.max(5000, today.resetAt - Date.now() + 5000), 6 * 60 * 60 * 1000);
                setTimeout(() => { claimDailyLogin().catch(() => {}); scheduleNextReset(); }, wait);
            } catch (e) {
                setTimeout(scheduleNextReset, 10 * 60 * 1000);
            }
        };
        scheduleNextReset();
    }

    async function stakeTokensOnSecretGiveaway(giveawayId, amount) {
        await waitForAuthReady();
        if (!currentUser) throw new Error("Sign in first.");
        return callTokensApi("stake", { giveawayId, amount });
    }

    // Changes your stake to exactly `amount` (0 removes it); the difference
    // goes back to, or comes out of, your wallet.
    async function setSecretGiveawayStake(giveawayId, amount) {
        await waitForAuthReady();
        if (!currentUser) throw new Error("Sign in first.");
        return callTokensApi("setStake", { giveawayId, amount });
    }

    // Giveaways staked on before the highest-stake figures were tracked don't
    // have them yet; this asks the server to work them out once.
    async function refreshSecretGiveawayMaxStake(giveawayId) {
        await waitForAuthReady();
        if (!currentUser) return null;
        return callTokensApi("maxStake", { giveawayId });
    }

    /* ---------------- PROFILE ---------------- */

    function defaultProfile() {
        return {
            name: "",
            email: "",
            avatar: "images/BOMBER.jpg",
            usernameKey: "",
            vipExpiresAt: 0,
            noAdsExpiresAt: 0,
            vipSubscriptionId: null,
            noAdsSubscriptionId: null,
            // --- new in Stage 3 ---
            lastClanPostAt: 0,
            lastClanPostData: null, // { clanName, server, minTrophies, description, tags } — for the Autofill button
            banned: false,
            banUntil: 0,
            banReason: "",
            bannedAt: 0,
            // --- new: bio + presence ---
            bio: "",
            server: "", // "", "ios", "android", or "both"
            lastActiveAt: 0,
            favoriteTroop: "",
            favoriteHero: "",
            highestTrophies: 0,
            currentClan: "",
            currentLevel: 0,
            currentPower: 0,
            acceptedTermsVersion: null,
            acceptedTermsAt: 0

        };
    }

    function getLocalProfile() {
        try {
            const raw = localStorage.getItem(KEYS.localProfile);
            if (!raw) return defaultProfile();
            return { ...defaultProfile(), ...JSON.parse(raw) };
        } catch (e) {
            return defaultProfile();
        }
    }

    function setLocalProfile(patch) {
        const current = getLocalProfile();
        const updated = { ...current, ...patch };
        localStorage.setItem(KEYS.localProfile, JSON.stringify(updated));
        return updated;
    }

    async function getProfile() {
        await waitForAuthReady();
        if (!currentUser) {
            return getLocalProfile();
        }
        const ref = doc(db, "users", currentUser.uid);
    const snap = await getDoc(ref);
    
    if (!snap.exists()) {
        // Don't trust a single "not found" — re-check straight from the
        // server (bypassing any local cache) before we conclude this user
        // genuinely has no profile and overwrite with defaults. This is the
        // difference between "brand new user" and "a flaky read wiping a
        // real profile."
        console.warn("[KIH] getProfile(): no doc found for uid", currentUser.uid, "— re-checking against server before creating a fresh profile.");
        const { getDocFromServer } = await import("https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js");
        let serverSnap;
        try {
            serverSnap = await getDocFromServer(ref);
        } catch (e) {
            console.error("[KIH] Server re-check failed — aborting fresh-profile creation to avoid data loss:", e.message);
            throw e; // bail out loudly instead of silently wiping the profile
        }

        if (serverSnap.exists()) {
            console.warn("[KIH] Server re-check found an existing profile after all — using it instead of creating a fresh one.");
            const data = serverSnap.data();
            return { ...defaultProfile(), ...data };
        }

                console.warn("[KIH] No profile found on the server for uid", currentUser.uid, "— returning defaults WITHOUT writing to Firestore. A real profile doc, if one exists, is never touched by a mere read; it will only be created/overwritten when the user explicitly saves via saveProfile().");
        const local = getLocalProfile();
        const fresh = {
            ...defaultProfile(),
            bio: local.bio || "",
            server: local.server || "",
            favoriteTroop: local.favoriteTroop || "",
            favoriteHero: local.favoriteHero || "",
            highestTrophies: local.highestTrophies || 0,
            currentClan: local.currentClan || "",
            currentLevel: local.currentLevel || 0,
            currentPower: local.currentPower || 0,
            name: local.name || currentUser.displayName || "",
            email: currentUser.email ? currentUser.email.toLowerCase() : "",
            avatar: local.avatar || currentUser.photoURL || defaultProfile().avatar
        };
        // NOTE: intentionally NOT calling setDoc/mirrorPublicProfile here.
        // This is a READ function — it must never have the side effect of
        // writing/overwriting Firestore. If this "not found" determination
        // is ever wrong (network blip, auth timing race, etc.), the worst
        // case is now a blank-looking profile for one session — never a
        // permanently destroyed one. Firestore only gets written to when
        // the user actually saves (see saveProfile() -> setProfile()).
        return fresh;
    }
        const data = snap.data();
        if (!data.email && currentUser.email) {
            const email = currentUser.email.toLowerCase();
            try {
                await updateDoc(ref, { email });
                data.email = email;
            } catch (e) {
                console.warn("Couldn't backfill email:", e.message);
            }
        }
        return { ...defaultProfile(), ...data };
    }

    // NOTE: this can still update name/avatar freely, but Firestore rules
    // will silently reject any attempt to change vipExpiresAt,
    // noAdsExpiresAt, vipSubscriptionId, noAdsSubscriptionId, banned,
    // banUntil, or banReason here — those are only ever written by the
    // Vercel webhook (VIP fields) or admin.html (ban fields).
    async function mirrorPublicProfile(profile) {
        if (!currentUser) return;
        try {
            const publicData = {
                name: profile.name || "",
                nameLower: normalizeNameKey(profile.name || ""),
                avatar: profile.avatar || "",
                bio: profile.bio || "",
                server: profile.server || "",
                lastActiveAt: profile.lastActiveAt || Date.now(),
                favoriteTroop: profile.favoriteTroop || "",
                favoriteHero: profile.favoriteHero || "",
                highestTrophies: profile.highestTrophies || 0,
                currentClan: profile.currentClan || "",
                currentPower: profile.currentPower || 0
            };
            // Only include currentLevel once it's actually been set to a
            // real value (1–10000) — omitting it entirely for new profiles
            // keeps it valid against the Firestore rule, which requires
            // 1–10000 whenever the field is present at all.
            if (profile.currentLevel && profile.currentLevel >= 1) {
                publicData.currentLevel = profile.currentLevel;
            }
            await setDoc(doc(db, "publicProfiles", currentUser.uid), publicData);
        } catch (e) {
            console.warn("Couldn't mirror public profile:", e.message);
        }
    }

    async function setProfile(patch) {
        await waitForAuthReady();
        if (!currentUser) {
            return setLocalProfile(patch);
        }
        const ref = doc(db, "users", currentUser.uid);
        const current = await getProfile();
        const updated = { ...current, ...patch };
        await setDoc(ref, updated);
        await mirrorPublicProfile(updated);
        return updated;
    }

    async function getPublicProfile(uid) {
        try {
            const snap = await getDoc(doc(db, "publicProfiles", uid));
            return snap.exists() ? snap.data() : null;
        } catch (e) {
            return null;
        }
    }

    function isVipActive(profile) {
        return !!profile.vipExpiresAt && profile.vipExpiresAt > getSimulatedNow().getTime();
    }

    function isNoAdsActive(profile) {
        return isVipActive(profile) ||
            (!!profile.noAdsExpiresAt && profile.noAdsExpiresAt > getSimulatedNow().getTime());
    }

    // Call this once per page (after waitForAuthReady()) to decide whether
    // ads should be shown to the current visitor. Signed-out visitors always
    // see ads (we can't know their subscription status without an account).
    async function shouldShowAds() {
        await waitForAuthReady();
        if (!currentUser) return true; // not signed in = no way to know they're a subscriber, show ads
        const profile = await getProfile();
        return !isNoAdsActive(profile);
    }
// Live VIP/noAds status for the current page — updates automatically the
// moment vipExpiresAt/noAdsExpiresAt change (admin revoke/grant, webhook
// renewal, cancellation), with no need for the user to reload the page.
// Call once (after waitForAuthReady()); returns an unsubscribe function.
function listenToMyProfile(callback) {
    if (!currentUser) { callback(null); return () => {}; }
    return onSnapshot(
        doc(db, "users", currentUser.uid),
        (snap) => {
            const data = snap.exists() ? snap.data() : {};
            callback({ ...defaultProfile(), ...data });
        },
        (err) => {
            console.warn("Profile listener error:", err.message);
        }
    );
}
    function escapeGateHtml(str) {
        return String(str).replace(/[&<>"']/g, s => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[s]));
    }

    // Shown instead of a plain alert() whenever a timed-out user tries to
    // post/message. Shows the reason, when it lifts, and an appeal link.
    function showRestrictedNotice(reason, until) {
        const untilStr = until ? new Date(until).toLocaleString() : null;
        const overlay = document.createElement("div");
        overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;";
        overlay.innerHTML = `
            <div style="background:#1a1a2e;border:1px solid #aa7a1e;border-radius:12px;padding:24px;max-width:360px;text-align:center;color:white;">
                <h3 style="margin-top:0;">⏱️ You're restricted</h3>
                <p class="promo-sub">Your account is currently restricted from posting/messaging${untilStr ? " until <strong>" + untilStr + "</strong>" : ""}.</p>
                <p class="promo-sub"><strong>Reason:</strong> ${escapeGateHtml(reason || "Not specified")}</p>
                <div style="margin-top:28px; display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
                    <a href="mailto:keazyea@gmail.com?subject=Timeout%20Appeal" class="btn-primary" style="padding:14px 28px; text-decoration:none;">If you feel this is unfair, click here to appeal</a>
                    <button id="closeRestrictedNotice" style="background:#2a2a4a;color:white;border:none;border-radius:8px;padding:14px 28px;cursor:pointer;">Close</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        overlay.querySelector("#closeRestrictedNotice").onclick = () => overlay.remove();
    }
    // Real wall-clock check (bans/cooldowns aren't affected by the
    // giveaway's debug week-offset the way VIP/noAds intentionally are).
    function isBannedNow(profile) {
        if (!profile || !profile.banned) return false;
        if (!profile.banUntil) return true; // banUntil 0 == indefinite ban
        return profile.banUntil > Date.now();
    }

    /* ======================================================
       NEW IN STAGE 3 — UNIQUE NAMES
       ====================================================== */

    function normalizeNameKey(name) {
        return name.trim().toLowerCase();
    }

    // Call this BEFORE setProfile() whenever the user changes their name.
    // Throws a friendly error if the name is taken.
    async function claimUsername(newName) {
        await waitForAuthReady();
        if (!currentUser) throw new Error("You must sign in with Google first.");

        const trimmed = newName.trim();
        if (!trimmed) throw new Error("Please enter a name.");
        if (trimmed.length > 24) throw new Error("Name must be 24 characters or fewer.");

        const newKey = normalizeNameKey(trimmed);
        const profile = await getProfile();
        const oldKey = profile.usernameKey || (profile.name ? normalizeNameKey(profile.name) : "");

        if (newKey !== oldKey) {
            const newRef = doc(db, "usernames", newKey);
            try {
                await setDoc(newRef, { uid: currentUser.uid, name: trimmed, updatedAt: Date.now() });
            } catch (e) {
                throw new Error("Someone has already picked this name, please choose a different one.");
            }

            // Release the old reservation so it becomes free for others.
            if (oldKey) {
                try {
                    const oldRef = doc(db, "usernames", oldKey);
                    const oldSnap = await getDoc(oldRef);
                    if (oldSnap.exists() && oldSnap.data().uid === currentUser.uid) {
                        await deleteDoc(oldRef);
                    }
                } catch (e) {
                    console.warn("Couldn't release old username:", e.message);
                }
            }

            // Immutable log entry for admin.html — this is what lets you see
            // "who changed their name to what" before deciding to ban someone.
            try {
                await addDoc(collection(db, "users", currentUser.uid, "nameChangeLog"), {
                    fromName: profile.name || "",
                    toName: trimmed,
                    changedAt: Date.now()
                });
            } catch (e) {
                console.warn("Couldn't write name change log:", e.message);
            }
        }

        return { name: trimmed, usernameKey: newKey };
    }

    async function findUserByName(name) {
    const key = normalizeNameKey(name);
    if (!key) return null;
    const snap = await getDoc(doc(db, "usernames", key));
    if (snap.exists()) return snap.data(); // { uid, name, updatedAt }

    // Fallback for accounts that exist but never saved a profile (so no
    // usernames/{key} reservation was ever created) — admin only, since
    // this does an exact-match scan over the users collection.
    await waitForAuthReady();
    if (!currentUser || currentUser.uid !== ADMIN_UID) return null;
    const trimmed = name.trim();
    if (!trimmed) return null;
    const q = query(collection(db, "users"), where("name", "==", trimmed), limit(1));
    const qsnap = await getDocs(q);
    if (qsnap.empty) return null;
    const d = qsnap.docs[0];
    return { uid: d.id, name: d.data().name };
}

    // Email is tied to the person's actual Google account and can't be
    // changed the way an in-game name can — more reliable for tracking down
    // a repeat offender who keeps renaming themselves.
    async function findUserByEmail(email) {
        await waitForAuthReady();
        if (!currentUser || currentUser.uid !== ADMIN_UID) throw new Error("Not authorized.");
        const trimmed = (email || "").trim().toLowerCase();
        if (!trimmed) return null;
        const q = query(collection(db, "users"), where("email", "==", trimmed), limit(1));
        const snap = await getDocs(q);
        if (snap.empty) return null;
        const d = snap.docs[0];
        return { uid: d.id, ...d.data() };
    }

    // Fetch a user's own profile doc by uid — used by admin.html so a
    // reporter or reported user's name in the Reports queue can be clicked
    // straight through to their profile/moderation actions, without needing
    // to already know their in-game name.
    async function getUserProfileForAdmin(uid) {
        await waitForAuthReady();
        if (!currentUser || currentUser.uid !== ADMIN_UID) throw new Error("Not authorized.");
        if (!uid) throw new Error("No uid provided.");
        const snap = await getDoc(doc(db, "users", uid));
        return snap.exists() ? { uid, ...snap.data() } : null;
    }

    // ONE-TIME TOOL: for profiles that existed before unique-name enforcement
    // was added, there's no usernames/{key} reservation on file yet — this
    // walks every users/{uid} doc and creates the missing reservation.
    // Safe to run more than once; already-reserved names are just skipped.
    async function backfillUsernameReservations() {
        await waitForAuthReady();
        if (!currentUser || currentUser.uid !== ADMIN_UID) throw new Error("Not authorized.");

        const snap = await getDocs(collection(db, "users"));
        let created = 0;
        let skipped = 0;
        const conflicts = [];

        for (const d of snap.docs) {
            const uid = d.id;
            const data = d.data();
            if (!data.name || !data.name.trim()) { skipped++; continue; }

            const key = normalizeNameKey(data.name);
            const keyRef = doc(db, "usernames", key);
            const keySnap = await getDoc(keyRef);

            if (keySnap.exists()) {
                if (keySnap.data().uid !== uid) {
                    conflicts.push({ uid, name: data.name, ownedBy: keySnap.data().uid });
                }
                skipped++;
                continue;
            }

            await setDoc(keyRef, { uid, name: data.name.trim(), updatedAt: Date.now() });
            try {
                await updateDoc(doc(db, "users", uid), { usernameKey: key });
            } catch (e) {
                console.warn("Couldn't stamp usernameKey for", uid, e.message);
            }
            created++;
        }

        return { created, skipped, conflicts };
    }
// ONE-TIME TOOL: publicProfiles created before nameLower existed have no
// normalized name for searchUsersByName's fallback to match against — this
// walks every publicProfiles/{uid} doc and fills in the missing field.
// Safe to run more than once.
async function backfillPublicProfileNameLower() {
    await waitForAuthReady();
    if (!currentUser || currentUser.uid !== ADMIN_UID) throw new Error("Not authorized.");

    const snap = await getDocs(collection(db, "publicProfiles"));
    let updated = 0;
    let skipped = 0;

    for (const d of snap.docs) {
        const data = d.data();
        if (data.nameLower) { skipped++; continue; }
        try {
            await updateDoc(doc(db, "publicProfiles", d.id), { nameLower: normalizeNameKey(data.name || "") });
            updated++;
        } catch (e) {
            console.warn("Couldn't backfill nameLower for", d.id, e.message);
        }
    }

    return { updated, skipped };
}

// ONE-TIME TOOL: fixes avatar paths saved with the wrong filename casing
// (e.g. "images/demonTank.jpg" when the real file is "images/DEMONTANK.jpg").
// Add more { wrong, correct } pairs here as you find more mismatches.
async function backfillAvatarCasing() {
    await waitForAuthReady();
    if (!currentUser || currentUser.uid !== ADMIN_UID) throw new Error("Not authorized.");

    const CASING_FIXES = [
        { wrong: "images/demonTank.jpg", correct: "images/DEMONTANK.jpg" }
        // { wrong: "images/OLDNAME.jpg", correct: "images/NewName.jpg" },
    ];

    let updated = 0;
    let skipped = 0;

    for (const collectionName of ["users", "publicProfiles"]) {
        const snap = await getDocs(collection(db, collectionName));
        for (const d of snap.docs) {
            const data = d.data();
            const fix = CASING_FIXES.find(f => f.wrong === data.avatar);
            if (!fix) { skipped++; continue; }
            try {
                await updateDoc(doc(db, collectionName, d.id), { avatar: fix.correct });
                updated++;
            } catch (e) {
                console.warn(`Couldn't fix avatar casing for ${collectionName}/${d.id}:`, e.message);
            }
        }
    }

    return { updated, skipped };
}
    /* ======================================================
       NEW IN STAGE 3 — CLAN RECRUITMENT POSTS
       ====================================================== */

    /* ============================================================
   VIP-TIERED POSTING COOLDOWN — DISABLED 2026-07-31.
   Previously: VIP could post once every 24h, everyone else once
   every 7 days. VIP is paused site-wide right now (see store.html),
   so everyone gets the SAME cooldown: one clan post per day,
   resetting at 00:00 Singapore time — not a rolling time window.
   To bring the old VIP/normal split back, delete the daily-reset
   block below and uncomment these three lines + swap
   getClanPostCooldownRemaining() back to the ms-window version.
   ============================================================ */
// const NORMAL_POST_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
// const VIP_POST_COOLDOWN_MS = 24 * 60 * 60 * 1000;
// function getPostCooldownMs(profile) {
//     return isVipActive(profile) ? VIP_POST_COOLDOWN_MS : NORMAL_POST_COOLDOWN_MS;
// }

const CLAN_POST_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000; // posts auto-expire after ~1 month

// The daily reset is 00:00 Singapore time for EVERYONE — the same boundary
// the daily quests use (api/_lib.js) and that the Firestore rule enforces.
// This used to use each visitor's own local midnight while the rule still
// enforced a 7-day wait for non-VIPs, so the page would say "you can post"
// and the save would then fail with a permission error. If you change the
// offset, change it in all three places.
const DAILY_RESET_TZ_OFFSET_MS = 8 * 60 * 60 * 1000;
function dailyResetDayNumber(ms) {
    return Math.floor((ms + DAILY_RESET_TZ_OFFSET_MS) / 86400000);
}

// Returns 0 if the user can post right now, otherwise ms until the next reset.
async function getClanPostCooldownRemaining() {
    const profile = await getProfile();
    if (!profile.lastClanPostAt) return 0;
    const now = Date.now();
    if (dailyResetDayNumber(profile.lastClanPostAt) < dailyResetDayNumber(now)) return 0;
    const nextReset = (dailyResetDayNumber(now) + 1) * 86400000 - DAILY_RESET_TZ_OFFSET_MS;
    return Math.max(0, nextReset - now);
}

    async function uploadClanIcon(file) {
        await waitForAuthReady();
        if (!currentUser) throw new Error("You must sign in with Google first.");
        if (!file.type.startsWith("image/")) {
            throw new Error("File must be an image.");
        }
        if (file.size > 5 * 1024 * 1024) {
            throw new Error("Image must be under 5MB.");
        }
        const path = "clanIcons/" + currentUser.uid + "-" + Date.now() + "-" + file.name;
        const storageRef = ref(storage, path);
        await uploadBytes(storageRef, file);
        const iconUrl = await getDownloadURL(storageRef);
        return { iconUrl, iconPath: path };
    }

    // Best-effort cleanup — never throws, so a failed delete (e.g. file
    // already gone) never surfaces an alert to the user.
    async function deleteClanIconSafe(path) {
        if (!path) return;
        try {
            await deleteObject(ref(storage, path));
        } catch (e) {
            console.warn("Couldn't delete old clan icon:", e.message);
        }
    }

    async function postClanRecruitMessage(data) {
        await waitForAuthReady();
        if (!currentUser) throw new Error("You must sign in with Google first to post.");

        const clanName = (data.clanName || "").trim();
        const server = data.server || "";
        const minTrophies = parseInt(data.minTrophies, 10) || 0;
        const clanRank = (data.clanRank === null || data.clanRank === undefined || data.clanRank === "")
            ? null : Math.max(0, Math.min(20, parseInt(data.clanRank, 10) || 0));
        const country = (data.country || "").trim();
        const memberCount = (data.memberCount === null || data.memberCount === undefined || data.memberCount === "")
            ? null : Math.max(1, Math.min(50, parseInt(data.memberCount, 10) || 1));
        const description = (data.description || "").trim();
        const tags = Array.isArray(data.tags) ? data.tags : [];
        const iconUrl = data.iconUrl || null;
        const iconPath = data.iconPath || null;

        if (!clanName) throw new Error("Clan name is required.");
        if (!server) throw new Error("Please select a server.");
        if (description.length > 2000) throw new Error("Description must be 2000 characters or fewer.");
        const profile = await getProfile();
        if (isBannedNow(profile)) {
            showRestrictedNotice(profile.banReason, profile.banUntil);
            throw new Error("__RESTRICTED__");
        }
        if (!profile.name) throw new Error("Set an in-game name in your profile before posting.");

        const remaining = await getClanPostCooldownRemaining();
        if (remaining > 0) {
            const hours = Math.max(1, Math.ceil(remaining / (60 * 60 * 1000)));
            throw new Error(`You've already posted today — try again in about ${hours} hour(s) (resets daily at 00:00 Singapore time).`);
        }

        const postId = currentUser.uid;
        await setDoc(doc(db, "clanPosts", postId), {
            uid: currentUser.uid,
            name: profile.name,
            avatar: profile.avatar || "",
            clanName,
            server,
            minTrophies,
            clanRank,
            country,
            memberCount,
            description,
            tags,
            iconUrl,
            iconPath,
            createdAt: Date.now(),
            expiresAt: Timestamp.fromMillis(Date.now() + CLAN_POST_LIFETIME_MS)
        });

        await setProfile({
            lastClanPostAt: Date.now(),
            lastClanPostData: { clanName, server, minTrophies, clanRank, country, memberCount, description, tags }
        });
        reportQuestProgress("postClan", postId);
        return postId;
    }
    // Edits an existing clan post's content without touching the posting
    // cooldown (lastClanPostAt) — lets a user fix their post without
    // waiting for the cooldown to reset.
    async function updateClanPost(postId, data) {
        await waitForAuthReady();
        if (!currentUser) throw new Error("You must sign in with Google first.");
        if (postId !== currentUser.uid) throw new Error("You can only edit your own post.");

        const profile = await getProfile();
        if (isBannedNow(profile)) {
            showRestrictedNotice(profile.banReason, profile.banUntil);
            throw new Error("__RESTRICTED__");
        }

        const clanName = (data.clanName || "").trim();
        const server = data.server || "";
        const minTrophies = parseInt(data.minTrophies, 10) || 0;
        const clanRank = (data.clanRank === null || data.clanRank === undefined || data.clanRank === "")
            ? null : Math.max(0, Math.min(20, parseInt(data.clanRank, 10) || 0));
        const country = (data.country || "").trim();
        const memberCount = (data.memberCount === null || data.memberCount === undefined || data.memberCount === "")
            ? null : Math.max(1, Math.min(50, parseInt(data.memberCount, 10) || 1));
        const description = (data.description || "").trim();
        const tags = Array.isArray(data.tags) ? data.tags : [];

        if (!clanName) throw new Error("Clan name is required.");
        if (!server) throw new Error("Please select a server.");
        if (description.length > 2000) throw new Error("Description must be 2000 characters or fewer.");

        const ref = doc(db, "clanPosts", postId);
        const snap = await getDoc(ref);
        if (!snap.exists()) throw new Error("Post not found.");

        const patch = { clanName, server, minTrophies, clanRank, country, memberCount, description, tags };
        if (data.iconUrl) {
            patch.iconUrl = data.iconUrl;
            patch.iconPath = data.iconPath || null;
        } else if (data.clearIcon) {
            patch.iconUrl = null;
            patch.iconPath = null;
        }
        await updateDoc(ref, patch);

        await setProfile({ lastClanPostData: { clanName, server, minTrophies, clanRank, country, memberCount, description, tags } });
        return postId;
    }

    // Posts, comments and secret giveaways carry people's names, profile
    // pictures and (winners) account ids, so they're only for signed-in
    // players. The Firestore rules enforce it; these just don't ask when
    // nobody is signed in — they hand back an empty list instead.
    function signedOutFeed(callback) {
        try { callback([]); } catch (e) { /* the page's own problem */ }
        return () => { };
    }

    function listenToClanPosts(callback, maxCount = 100) {
        if (!currentUser) return signedOutFeed(callback);
        const q = query(collection(db, "clanPosts"), orderBy("createdAt", "desc"), limit(maxCount));
        return onSnapshot(q, (snap) => {
            const items = [];
            snap.forEach(d => items.push({ id: d.id, ...d.data() }));
            callback(items);
        });
    }


    async function deleteClanPost(postId) {
        await waitForAuthReady();
        if (!currentUser) throw new Error("Not signed in.");
        try {
            const snap = await getDoc(doc(db, "clanPosts", postId));
            const iconPath = snap.exists() ? snap.data().iconPath : null;
            if (iconPath) await deleteClanIconSafe(iconPath);
        } catch (e) {
            console.warn("Couldn't clean up clan icon:", e.message);
        }
        await deleteDoc(doc(db, "clanPosts", postId));
    }

    /* ======================================================
       FORMATION SHARING — Instagram-style feed under Social.
       Unlimited posts per user (unlike clanPosts' one-per-uid),
       up to 3 images + a description, comments with an optional
       image, and a "needs help" filter (commentCount === 0) so
       unanswered posts surface. Posts auto-expire after 30 days:
       listenToFormations() only ever queries non-expired posts,
       sweepExpiredFormations() best-effort deletes expired ones
       (+ their images + comment subcollection) whenever anyone
       loads the feed, and a Firestore TTL policy on `expiresAt`
       (set up separately in the Firebase console, not in code)
       is the backstop for posts nobody's client ever sweeps.
       ====================================================== */

    const FORMATION_POST_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

    // Kept in sync with the category <select> in social.html.
    const FORMATION_CATEGORIES = [
        { id: "arena", label: "Arena" },
        { id: "goldFarming", label: "Gold Farming" },
        { id: "dragonMelee", label: "Dragon Boss (Melee)" },
        { id: "dragonRanged", label: "Dragon Boss (Ranged)" },
        { id: "sandMelee", label: "Sand Boss (Melee)" },
        { id: "octopusMelee", label: "Octopus Boss (Melee)" },
        { id: "octopusRanged", label: "Octopus Boss (Ranged)" },
        { id: "spiderMelee", label: "Spider Boss (Melee)" },
        { id: "spiderRanged", label: "Spider Boss (Ranged)" },
        { id: "other", label: "Other" }
    ];
    function normalizeFormationCategory(cat) {
        return FORMATION_CATEGORIES.some(c => c.id === cat) ? cat : "other";
    }

    async function uploadFormationImage(file) {
        await waitForAuthReady();
        if (!currentUser) throw new Error("You must sign in with Google first.");
        if (!file.type.startsWith("image/")) {
            throw new Error("File must be an image.");
        }
        if (file.size > 5 * 1024 * 1024) {
            throw new Error("Image must be under 5MB.");
        }
        const path = "formationImages/" + currentUser.uid + "-" + Date.now() + "-" + file.name;
        const storageRef = ref(storage, path);
        // contentDisposition: "attachment" makes the browser download this
        // file on a plain navigation (e.g. the Download button in social.html)
        // instead of just opening it in a new tab — this only affects direct
        // navigations, not <img> loads, so it still displays normally
        // everywhere else in the feed/carousel.
        const safeName = (file.name || "formation.jpg").replace(/[^\w.\-]/g, "_");
        await uploadBytes(storageRef, file, {
            contentType: file.type,
            contentDisposition: `attachment; filename="${safeName}"`
        });
        const imageUrl = await getDownloadURL(storageRef);
        return { imageUrl, imagePath: path };
    }

    // Best-effort cleanup — never throws.
    async function deleteFormationImageSafe(path) {
        if (!path) return;
        try {
            await deleteObject(ref(storage, path));
        } catch (e) {
            console.warn("Couldn't delete formation image:", e.message);
        }
    }

    async function postFormation(data) {
        await waitForAuthReady();
        if (!currentUser) throw new Error("You must sign in with Google first to post.");

        const category = normalizeFormationCategory(data.category);
        const description = (data.description || "").trim();
        const imageUrls = Array.isArray(data.imageUrls) ? data.imageUrls.slice(0, 3) : [];
        const imagePaths = Array.isArray(data.imagePaths) ? data.imagePaths.slice(0, 3) : [];

        if (!imageUrls.length) throw new Error("Add at least one screenshot of your formation.");
        if (description.length > 5000) throw new Error("Description must be 5000 characters or fewer.");

        const profile = await getProfile();
        if (isBannedNow(profile)) {
            showRestrictedNotice(profile.banReason, profile.banUntil);
            throw new Error("__RESTRICTED__");
        }
        if (!profile.name) throw new Error("Set an in-game name in your profile before posting.");

        const docRef = await addDoc(collection(db, "formationPosts"), {
            uid: currentUser.uid,
            name: profile.name,
            avatar: profile.avatar || "",
            category,
            description,
            imageUrls,
            imagePaths,
            commentCount: 0,
            likeCount: 0,
            createdAt: Date.now(),
            expiresAt: Timestamp.fromMillis(Date.now() + FORMATION_POST_LIFETIME_MS)
        });
        reportQuestProgress("shareFormation", docRef.id);
        return docRef.id;
    }

    // Edits an existing formation post's category/description/images —
    // callers pass the FULL final imageUrls/imagePaths arrays (existing
    // images the user kept + any newly-uploaded ones); this does not
    // delete replaced/removed images itself, that's the caller's job
    // (via deleteFormationImageSafe) once the doc update succeeds.
    async function updateFormation(postId, data) {
        await waitForAuthReady();
        if (!currentUser) throw new Error("You must sign in with Google first.");

        const profile = await getProfile();
        if (isBannedNow(profile)) {
            showRestrictedNotice(profile.banReason, profile.banUntil);
            throw new Error("__RESTRICTED__");
        }

        const category = normalizeFormationCategory(data.category);
        const description = (data.description || "").trim();
        const imageUrls = Array.isArray(data.imageUrls) ? data.imageUrls.slice(0, 3) : [];
        const imagePaths = Array.isArray(data.imagePaths) ? data.imagePaths.slice(0, 3) : [];

        if (!imageUrls.length) throw new Error("Add at least one screenshot of your formation.");
        if (description.length > 5000) throw new Error("Description must be 5000 characters or fewer.");

        const postRef = doc(db, "formationPosts", postId);
        const snap = await getDoc(postRef);
        if (!snap.exists()) throw new Error("Post not found.");
        if (snap.data().uid !== currentUser.uid) throw new Error("You can only edit your own post.");

        await updateDoc(postRef, { category, description, imageUrls, imagePaths });
        return postId;
    }

    // Only ever returns non-expired posts, ordered newest-first. Ordering by
    // expiresAt (instead of createdAt) lets this stay a single-field query —
    // every post shares the same lifetime, so expiresAt order == createdAt
    // order, and Firestore requires the first orderBy to match a range-
    // filtered field.
    function listenToFormations(callback, maxCount = 200) {
        if (!currentUser) return signedOutFeed(callback);
        const q = query(
            collection(db, "formationPosts"),
            where("expiresAt", ">", Timestamp.now()),
            orderBy("expiresAt", "desc"),
            limit(maxCount)
        );
        return onSnapshot(q, (snap) => {
            const items = [];
            snap.forEach(d => items.push({ id: d.id, ...d.data() }));
            callback(items);
        });
    }

    // Deletes a formation post's images, its comment subcollection (+ THEIR
    // images — Firestore doesn't cascade-delete subcollections on its own),
    // and finally the post doc itself.
    async function deleteFormationPostCascade(postId, imagePaths) {
        const deletions = (imagePaths || []).map(p => deleteFormationImageSafe(p));
        try {
            const commentsSnap = await getDocs(collection(db, "formationPosts", postId, "comments"));
            commentsSnap.forEach(c => {
                const cd = c.data();
                (cd.imagePaths || []).forEach(p => deletions.push(deleteFormationImageSafe(p)));
                deletions.push(deleteDoc(doc(db, "formationPosts", postId, "comments", c.id)));
            });
        } catch (e) {
            console.warn("Couldn't clean up formation comments:", e.message);
        }
        deletions.push(deleteDoc(doc(db, "formationPosts", postId)));
        await Promise.all(deletions);
    }

    async function deleteFormation(postId) {
        await waitForAuthReady();
        if (!currentUser) throw new Error("Not signed in.");
        let imagePaths = [];
        try {
            const snap = await getDoc(doc(db, "formationPosts", postId));
            if (snap.exists()) imagePaths = snap.data().imagePaths || [];
        } catch (e) {
            console.warn("Couldn't read formation post before delete:", e.message);
        }
        await deleteFormationPostCascade(postId, imagePaths);
    }

    // Best-effort: deletes a small batch of already-expired posts whenever
    // called (see the section comment above for the full cleanup story).
    async function sweepExpiredFormations() {
        if (!currentUser) return;
        try {
            const q = query(collection(db, "formationPosts"), where("expiresAt", "<=", Timestamp.now()), limit(10));
            const snap = await getDocs(q);
            await Promise.all(snap.docs.map(d => deleteFormationPostCascade(d.id, d.data().imagePaths || [])));
        } catch (e) {
            console.warn("Couldn't sweep expired formation posts:", e.message);
        }
    }

    async function addFormationComment(postId, data) {
        await waitForAuthReady();
        if (!currentUser) throw new Error("You must sign in with Google first to comment.");
        const text = (data.text || "").trim();
        const imageUrls = Array.isArray(data.imageUrls) ? data.imageUrls.slice(0, 3) : [];
        const imagePaths = Array.isArray(data.imagePaths) ? data.imagePaths.slice(0, 3) : [];
        // A reply just points back at the comment/reply it's under — same
        // flat collection either way, rendered as a tree client-side.
        const parentId = data.parentId || null;
        if (!text && !imageUrls.length) throw new Error("Write something or attach a picture.");
        if (text.length > 2000) throw new Error("Comment must be 2000 characters or fewer.");

        const profile = await getProfile();
        if (isBannedNow(profile)) {
            showRestrictedNotice(profile.banReason, profile.banUntil);
            throw new Error("__RESTRICTED__");
        }
        if (!profile.name) throw new Error("Set an in-game name in your profile before commenting.");

        const docRef = await addDoc(collection(db, "formationPosts", postId, "comments"), {
            uid: currentUser.uid,
            name: profile.name,
            avatar: profile.avatar || "",
            text,
            imageUrls,
            imagePaths,
            parentId,
            createdAt: Date.now()
        });
        await updateDoc(doc(db, "formationPosts", postId), { commentCount: increment(1) });
        reportQuestProgress("comment", "f/" + postId + "/" + docRef.id);

        // Notify whoever should know about this — best-effort, never lets a
        // notification failure block the comment/reply itself from landing.
        // A reply notifies the parent comment's author (whoever they are,
        // even if that's also the post owner); a top-level comment notifies
        // the post's own author. Never notify yourself.
        try {
            if (parentId) {
                const parentSnap = await getDoc(doc(db, "formationPosts", postId, "comments", parentId));
                if (parentSnap.exists()) {
                    const parentAuthorUid = parentSnap.data().uid;
                    if (parentAuthorUid && parentAuthorUid !== currentUser.uid) {
                        await addPersonalNotification(parentAuthorUid, {
                            type: "formationReply",
                            title: `💬 ${profile.name} replied to your comment`,
                            body: text ? text.slice(0, 100) : "Sent a photo.",
                            fromUid: currentUser.uid,
                            fromName: profile.name,
                            fromAvatar: profile.avatar || "",
                            postId
                        });
                    }
                }
            } else {
                const postSnap = await getDoc(doc(db, "formationPosts", postId));
                if (postSnap.exists()) {
                    const postAuthorUid = postSnap.data().uid;
                    if (postAuthorUid && postAuthorUid !== currentUser.uid) {
                        await addPersonalNotification(postAuthorUid, {
                            type: "formationComment",
                            title: `💬 ${profile.name} commented on your formation post`,
                            body: text ? text.slice(0, 100) : "Sent a photo.",
                            fromUid: currentUser.uid,
                            fromName: profile.name,
                            fromAvatar: profile.avatar || "",
                            postId
                        });
                    }
                }
            }
        } catch (e) {
            console.warn("Couldn't send comment notification:", e.message);
        }

        return docRef.id;
    }

    // Edits an existing comment's text/images — caller passes the FULL final
    // imageUrls/imagePaths (existing images kept + any newly-uploaded ones);
    // doesn't touch commentCount and doesn't delete replaced images itself
    // (that's the caller's job via deleteFormationImageSafe, same pattern
    // as updateFormation).
    async function updateFormationComment(postId, commentId, data) {
        await waitForAuthReady();
        if (!currentUser) throw new Error("You must sign in with Google first.");

        const profile = await getProfile();
        if (isBannedNow(profile)) {
            showRestrictedNotice(profile.banReason, profile.banUntil);
            throw new Error("__RESTRICTED__");
        }

        const text = (data.text || "").trim();
        const imageUrls = Array.isArray(data.imageUrls) ? data.imageUrls.slice(0, 3) : [];
        const imagePaths = Array.isArray(data.imagePaths) ? data.imagePaths.slice(0, 3) : [];
        if (!text && !imageUrls.length) throw new Error("Write something or attach a picture.");
        if (text.length > 2000) throw new Error("Comment must be 2000 characters or fewer.");

        const commentRef = doc(db, "formationPosts", postId, "comments", commentId);
        const snap = await getDoc(commentRef);
        if (!snap.exists()) throw new Error("Comment not found.");
        if (snap.data().uid !== currentUser.uid) throw new Error("You can only edit your own comment.");

        await updateDoc(commentRef, { text, imageUrls, imagePaths });
        return commentId;
    }

    function listenToFormationComments(postId, callback) {
        if (!currentUser) return signedOutFeed(callback);
        const q = query(collection(db, "formationPosts", postId, "comments"), orderBy("createdAt", "asc"));
        return onSnapshot(q, (snap) => {
            const items = [];
            snap.forEach(d => items.push({ id: d.id, ...d.data() }));
            callback(items);
        });
    }

    async function deleteFormationComment(postId, commentId) {
        await waitForAuthReady();
        if (!currentUser) throw new Error("Not signed in.");
        const snap = await getDoc(doc(db, "formationPosts", postId, "comments", commentId));
        if (!snap.exists()) return;
        const data = snap.data();
        await Promise.all((data.imagePaths || []).map(p => deleteFormationImageSafe(p)));
        await deleteDoc(doc(db, "formationPosts", postId, "comments", commentId));
        await updateDoc(doc(db, "formationPosts", postId), { commentCount: increment(-1) });
    }

    // Toggles the current user's like on a formation post — one doc per
    // (post, uid) keyed by uid, so "did I like this" is a single getDoc
    // and double-liking is impossible by construction. Returns the new
    // liked state (true = now liked).
    //
    // Runs as a transaction so the like-doc write and the likeCount bump
    // either both land or neither does — previously these were two
    // separate calls, and if the second one failed (as it did under the
    // old, buggy rules) the like doc was left behind with no matching
    // count change, so the next toggle "corrected" a count that was never
    // actually incremented and went negative.
    async function toggleFormationLike(postId) {
        await waitForAuthReady();
        if (!currentUser) throw new Error("You must sign in with Google first to like a post.");
        const profile = await getProfile();
        if (isBannedNow(profile)) {
            showRestrictedNotice(profile.banReason, profile.banUntil);
            throw new Error("__RESTRICTED__");
        }

        const likeRef = doc(db, "formationPosts", postId, "likes", currentUser.uid);
        const postRef = doc(db, "formationPosts", postId);
        const uid = currentUser.uid;

        const liked = await runTransaction(db, async (tx) => {
            const likeSnap = await tx.get(likeRef);
            if (likeSnap.exists()) {
                tx.delete(likeRef);
                tx.update(postRef, { likeCount: increment(-1) });
                return false;
            }
            tx.set(likeRef, { uid, createdAt: Date.now() });
            tx.update(postRef, { likeCount: increment(1) });
            return true;
        });
        if (liked) reportQuestProgress("likeOrVote", "f/" + postId);
        return liked;
    }

    // Double-tap/double-click "like" always ends in the liked state (never
    // toggles it off) — matches the Instagram convention this was modeled
    // on. A no-op if already liked.
    async function likeFormation(postId) {
        await waitForAuthReady();
        if (!currentUser) throw new Error("You must sign in with Google first to like a post.");
        const likeRef = doc(db, "formationPosts", postId, "likes", currentUser.uid);
        const likeSnap = await getDoc(likeRef);
        if (likeSnap.exists()) return false; // already liked — nothing changed
        return await toggleFormationLike(postId);
    }

    async function hasLikedFormation(postId) {
        await waitForAuthReady();
        if (!currentUser) return false;
        const snap = await getDoc(doc(db, "formationPosts", postId, "likes", currentUser.uid));
        return snap.exists();
    }

    /* ======================================================
       TIER LISTS — drag-and-drop hero/troop rankings.
       Same Instagram-style social pattern as formation sharing
       (unlimited posts/user, threaded comments w/ up to 3 images
       each), but no user-uploaded photos on the post itself —
       just unit keys per tier — and voting is upvote/downvote
       instead of a single like. No expiry: a tier list is just
       short string keys, tiny compared to formation photos, so
       these are kept indefinitely rather than auto-expiring.
       ====================================================== */

    const TIER_KEYS = ["S", "A", "B", "C", "D", "E", "F"];
    const TIER_LIST_UNIT_TYPES = ["hero", "troop", "both"];

    function normalizeTierListTiers(rawTiers) {
        const tiers = {};
        TIER_KEYS.forEach(k => {
            tiers[k] = Array.isArray(rawTiers && rawTiers[k]) ? rawTiers[k].slice(0, 200) : [];
        });
        return tiers;
    }

    async function postTierList(data) {
        await waitForAuthReady();
        if (!currentUser) throw new Error("You must sign in with Google first to post.");

        const title = (data.title || "").trim();
        const description = (data.description || "").trim();
        const unitType = TIER_LIST_UNIT_TYPES.includes(data.unitType) ? data.unitType : "both";
        const tiers = normalizeTierListTiers(data.tiers);

        if (!title) throw new Error("Give your tier list a title.");
        if (title.length > 100) throw new Error("Title must be 100 characters or fewer.");
        if (description.length > 2000) throw new Error("Description must be 2000 characters or fewer.");
        const totalPlaced = TIER_KEYS.reduce((sum, k) => sum + tiers[k].length, 0);
        if (!totalPlaced) throw new Error("Place at least one hero or troop in a tier.");

        const profile = await getProfile();
        if (isBannedNow(profile)) {
            showRestrictedNotice(profile.banReason, profile.banUntil);
            throw new Error("__RESTRICTED__");
        }
        if (!profile.name) throw new Error("Set an in-game name in your profile before posting.");

        const docRef = await addDoc(collection(db, "tierLists"), {
            uid: currentUser.uid,
            name: profile.name,
            avatar: profile.avatar || "",
            title,
            description,
            unitType,
            tiers,
            commentCount: 0,
            upvotes: 0,
            downvotes: 0,
            createdAt: Date.now()
        });
        reportQuestProgress("shareTierList", docRef.id);
        return docRef.id;
    }

    async function updateTierList(tierListId, data) {
        await waitForAuthReady();
        if (!currentUser) throw new Error("You must sign in with Google first.");
        const profile = await getProfile();
        if (isBannedNow(profile)) {
            showRestrictedNotice(profile.banReason, profile.banUntil);
            throw new Error("__RESTRICTED__");
        }

        const title = (data.title || "").trim();
        const description = (data.description || "").trim();
        const unitType = TIER_LIST_UNIT_TYPES.includes(data.unitType) ? data.unitType : "both";
        const tiers = normalizeTierListTiers(data.tiers);

        if (!title) throw new Error("Give your tier list a title.");
        if (title.length > 100) throw new Error("Title must be 100 characters or fewer.");
        if (description.length > 2000) throw new Error("Description must be 2000 characters or fewer.");
        const totalPlaced = TIER_KEYS.reduce((sum, k) => sum + tiers[k].length, 0);
        if (!totalPlaced) throw new Error("Place at least one hero or troop in a tier.");

        const ref = doc(db, "tierLists", tierListId);
        const snap = await getDoc(ref);
        if (!snap.exists()) throw new Error("Tier list not found.");
        if (snap.data().uid !== currentUser.uid) throw new Error("You can only edit your own tier list.");

        await updateDoc(ref, { title, description, unitType, tiers });
        return tierListId;
    }

    function listenToTierLists(callback, maxCount = 200) {
        if (!currentUser) return signedOutFeed(callback);
        const q = query(collection(db, "tierLists"), orderBy("createdAt", "desc"), limit(maxCount));
        return onSnapshot(q, (snap) => {
            const items = [];
            snap.forEach(d => items.push({ id: d.id, ...d.data() }));
            callback(items);
        });
    }

    async function deleteTierListCascade(tierListId) {
        const deletions = [];
        try {
            const commentsSnap = await getDocs(collection(db, "tierLists", tierListId, "comments"));
            commentsSnap.forEach(c => {
                const cd = c.data();
                (cd.imagePaths || []).forEach(p => deletions.push(deleteFormationImageSafe(p)));
                deletions.push(deleteDoc(doc(db, "tierLists", tierListId, "comments", c.id)));
            });
        } catch (e) {
            console.warn("Couldn't clean up tier list comments:", e.message);
        }
        try {
            const votesSnap = await getDocs(collection(db, "tierLists", tierListId, "votes"));
            votesSnap.forEach(v => deletions.push(deleteDoc(doc(db, "tierLists", tierListId, "votes", v.id))));
        } catch (e) {
            console.warn("Couldn't clean up tier list votes:", e.message);
        }
        deletions.push(deleteDoc(doc(db, "tierLists", tierListId)));
        await Promise.all(deletions);
    }

    async function deleteTierList(tierListId) {
        await waitForAuthReady();
        if (!currentUser) throw new Error("Not signed in.");
        await deleteTierListCascade(tierListId);
    }

    // Reddit-style toggle: voting the same direction again removes your
    // vote; voting the opposite direction switches it. Transactional so
    // the vote doc and the upvotes/downvotes counters can never drift
    // apart the way formation likes briefly could before that was fixed.
    async function voteOnTierList(tierListId, direction) {
        await waitForAuthReady();
        if (!currentUser) throw new Error("You must sign in with Google first to vote.");
        const profile = await getProfile();
        if (isBannedNow(profile)) {
            showRestrictedNotice(profile.banReason, profile.banUntil);
            throw new Error("__RESTRICTED__");
        }

        const voteRef = doc(db, "tierLists", tierListId, "votes", currentUser.uid);
        const listRef = doc(db, "tierLists", tierListId);
        const uid = currentUser.uid;

        const result = await runTransaction(db, async (tx) => {
            const voteSnap = await tx.get(voteRef);
            const prev = voteSnap.exists() ? voteSnap.data().value : 0;
            const next = (prev === direction) ? 0 : direction;

            if (next === 0) {
                tx.delete(voteRef);
            } else {
                tx.set(voteRef, { uid, value: next, createdAt: Date.now() });
            }
            const deltaUp = (next === 1 ? 1 : 0) - (prev === 1 ? 1 : 0);
            const deltaDown = (next === -1 ? 1 : 0) - (prev === -1 ? 1 : 0);
            const patch = {};
            if (deltaUp !== 0) patch.upvotes = increment(deltaUp);
            if (deltaDown !== 0) patch.downvotes = increment(deltaDown);
            if (Object.keys(patch).length) tx.update(listRef, patch);
            return next;
        });
        if (result !== 0) reportQuestProgress("likeOrVote", "t/" + tierListId);
        return result;
    }

    async function getMyTierListVote(tierListId) {
        await waitForAuthReady();
        if (!currentUser) return 0;
        const snap = await getDoc(doc(db, "tierLists", tierListId, "votes", currentUser.uid));
        return snap.exists() ? snap.data().value : 0;
    }

    async function addTierListComment(tierListId, data) {
        await waitForAuthReady();
        if (!currentUser) throw new Error("You must sign in with Google first to comment.");
        const text = (data.text || "").trim();
        const imageUrls = Array.isArray(data.imageUrls) ? data.imageUrls.slice(0, 3) : [];
        const imagePaths = Array.isArray(data.imagePaths) ? data.imagePaths.slice(0, 3) : [];
        const parentId = data.parentId || null;
        if (!text && !imageUrls.length) throw new Error("Write something or attach a picture.");
        if (text.length > 2000) throw new Error("Comment must be 2000 characters or fewer.");

        const profile = await getProfile();
        if (isBannedNow(profile)) {
            showRestrictedNotice(profile.banReason, profile.banUntil);
            throw new Error("__RESTRICTED__");
        }
        if (!profile.name) throw new Error("Set an in-game name in your profile before commenting.");

        const docRef = await addDoc(collection(db, "tierLists", tierListId, "comments"), {
            uid: currentUser.uid,
            name: profile.name,
            avatar: profile.avatar || "",
            text,
            imageUrls,
            imagePaths,
            parentId,
            createdAt: Date.now()
        });
        await updateDoc(doc(db, "tierLists", tierListId), { commentCount: increment(1) });
        reportQuestProgress("comment", "t/" + tierListId + "/" + docRef.id);

        try {
            if (parentId) {
                const parentSnap = await getDoc(doc(db, "tierLists", tierListId, "comments", parentId));
                if (parentSnap.exists()) {
                    const parentAuthorUid = parentSnap.data().uid;
                    if (parentAuthorUid && parentAuthorUid !== currentUser.uid) {
                        await addPersonalNotification(parentAuthorUid, {
                            type: "tierListReply",
                            title: `💬 ${profile.name} replied to your comment`,
                            body: text ? text.slice(0, 100) : "Sent a photo.",
                            fromUid: currentUser.uid,
                            fromName: profile.name,
                            fromAvatar: profile.avatar || "",
                            tierListId
                        });
                    }
                }
            } else {
                const listSnap = await getDoc(doc(db, "tierLists", tierListId));
                if (listSnap.exists()) {
                    const ownerUid = listSnap.data().uid;
                    if (ownerUid && ownerUid !== currentUser.uid) {
                        await addPersonalNotification(ownerUid, {
                            type: "tierListComment",
                            title: `💬 ${profile.name} commented on your tier list`,
                            body: text ? text.slice(0, 100) : "Sent a photo.",
                            fromUid: currentUser.uid,
                            fromName: profile.name,
                            fromAvatar: profile.avatar || "",
                            tierListId
                        });
                    }
                }
            }
        } catch (e) {
            console.warn("Couldn't send tier list comment notification:", e.message);
        }

        return docRef.id;
    }

    async function updateTierListComment(tierListId, commentId, data) {
        await waitForAuthReady();
        if (!currentUser) throw new Error("You must sign in with Google first.");
        const profile = await getProfile();
        if (isBannedNow(profile)) {
            showRestrictedNotice(profile.banReason, profile.banUntil);
            throw new Error("__RESTRICTED__");
        }

        const text = (data.text || "").trim();
        const imageUrls = Array.isArray(data.imageUrls) ? data.imageUrls.slice(0, 3) : [];
        const imagePaths = Array.isArray(data.imagePaths) ? data.imagePaths.slice(0, 3) : [];
        if (!text && !imageUrls.length) throw new Error("Write something or attach a picture.");
        if (text.length > 2000) throw new Error("Comment must be 2000 characters or fewer.");

        const ref = doc(db, "tierLists", tierListId, "comments", commentId);
        const snap = await getDoc(ref);
        if (!snap.exists()) throw new Error("Comment not found.");
        if (snap.data().uid !== currentUser.uid) throw new Error("You can only edit your own comment.");

        await updateDoc(ref, { text, imageUrls, imagePaths });
        return commentId;
    }

    function listenToTierListComments(tierListId, callback) {
        if (!currentUser) return signedOutFeed(callback);
        const q = query(collection(db, "tierLists", tierListId, "comments"), orderBy("createdAt", "asc"));
        return onSnapshot(q, (snap) => {
            const items = [];
            snap.forEach(d => items.push({ id: d.id, ...d.data() }));
            callback(items);
        });
    }

    async function deleteTierListComment(tierListId, commentId) {
        await waitForAuthReady();
        if (!currentUser) throw new Error("Not signed in.");
        const snap = await getDoc(doc(db, "tierLists", tierListId, "comments", commentId));
        if (!snap.exists()) return;
        const data = snap.data();
        await Promise.all((data.imagePaths || []).map(p => deleteFormationImageSafe(p)));
        await deleteDoc(doc(db, "tierLists", tierListId, "comments", commentId));
        await updateDoc(doc(db, "tierLists", tierListId), { commentCount: increment(-1) });
    }

    /* ======================================================
       NEW IN STAGE 3 — FRIEND REQUESTS
       (An accepted request IS the friendship — no separate collection.)
       ====================================================== */

    function friendshipId(a, b) {
        return a < b ? `${a}_${b}` : `${b}_${a}`;
    }

    async function sendFriendRequest(toUid, toName) {
        await waitForAuthReady();
        if (!currentUser) throw new Error("You must sign in with Google first.");
        if (toUid === currentUser.uid) throw new Error("You can't friend yourself.");

        const profile = await getProfile();
        if (isBannedNow(profile)) {
            showRestrictedNotice(profile.banReason, profile.banUntil);
            throw new Error("__RESTRICTED__");
        }
        const id = friendshipId(currentUser.uid, toUid);
        const ref = doc(db, "friendRequests", id);
        const existing = await getDoc(ref);
        if (existing.exists()) {
            const status = existing.data().status;
            if (status === "accepted") throw new Error("You're already friends.");
            if (status === "pending") throw new Error("A request is already pending.");
        }

        await setDoc(ref, {
            fromUid: currentUser.uid,
            fromName: profile.name || "Commander",
            fromAvatar: profile.avatar || "",
            toUid: toUid,
            toName: toName,
            status: "pending",
            createdAt: Date.now()
        });
        return id;
    }
    async function unfriend(otherUid) {
        await waitForAuthReady();
        if (!currentUser) throw new Error("Not signed in.");
        const id = friendshipId(currentUser.uid, otherUid);
        await deleteDoc(doc(db, "friendRequests", id));

        // Clear any leftover unread badge from a DM thread with this person.
        // We don't delete the thread (chat history stays if they re-friend
        // later) — just zero out MY unread count so a stale "1" doesn't
        // keep showing on Social forever for someone no longer in my list.
        try {
            const threadId = friendshipId(currentUser.uid, otherUid);
            await updateDoc(doc(db, "dmThreads", threadId), {
                [`unreadCount.${currentUser.uid}`]: 0
            });
        } catch (e) {
            console.warn("Couldn't clear unread count after unfriending:", e.message);
        }
    }
    // Accept/decline happen exactly once per request, however many times
    // Accept is tapped on a slow connection, and from however many pages or
    // devices. Three layers:
    //  1. repeat calls for the same request on this page share one attempt;
    //  2. the status change is a transaction that only acts on "pending" —
    //     every later attempt sees "accepted" and does nothing;
    //  3. the sender's inbox message has a fixed id per request, so even a
    //     second one getting through would be refused (the rules only let
    //     the sender's side create it, never overwrite it).
    // Only the attempt that actually flipped pending -> accepted notifies.
    const friendResponsesInFlight = new Map();

    function respondToFriendRequest(reqId, accept) {
        if (friendResponsesInFlight.has(reqId)) return friendResponsesInFlight.get(reqId);
        const attempt = answerFriendRequest(reqId, accept)
            .finally(() => friendResponsesInFlight.delete(reqId));
        friendResponsesInFlight.set(reqId, attempt);
        return attempt;
    }

    async function answerFriendRequest(reqId, accept) {
        await waitForAuthReady();
        if (!currentUser) throw new Error("Not signed in.");
        const ref = doc(db, "friendRequests", reqId);
        // Read before the transaction: transactions may retry, and the
        // profile isn't part of what has to be consistent.
        const profile = accept ? await getProfile() : null;

        const result = await runTransaction(db, async (tx) => {
            const snap = await tx.get(ref);
            if (!snap.exists()) throw new Error("This friend request no longer exists.");
            const data = snap.data();
            if (data.status !== "pending") return { changed: false, data };
            tx.update(ref, accept
                ? { status: "accepted", toAvatar: profile.avatar || "", toName: profile.name || "Commander" }
                : { status: "declined" });
            return { changed: true, data };
        });

        // Tell the sender, in the background: the friendship already exists,
        // so the tap shouldn't wait on a second write over a slow connection.
        if (accept && result.changed && result.data.fromUid) {
            notifyFriendAccepted(reqId, result.data, profile)
                .catch(e => console.warn("Couldn't notify friend request sender:", e.message));
        }
        return { changed: result.changed, status: result.changed ? (accept ? "accepted" : "declined") : result.data.status };
    }

    // One message per request: the id includes when the request was sent, so
    // a fresh request after unfriending gets its own message again.
    async function notifyFriendAccepted(reqId, reqData, profile) {
        const notifId = `friendAccepted_${reqId}_${reqData.createdAt || 0}`;
        await setDoc(doc(db, "users", reqData.fromUid, "personalNotifications", notifId), {
            type: "friendAccepted",
            title: `🎉 ${profile.name || "Commander"} accepted your friend request!`,
            body: "You're now friends — tap below to start chatting.",
            fromUid: currentUser.uid,
            fromName: profile.name || "Commander",
            fromAvatar: profile.avatar || "",
            createdAt: Date.now(),
            read: false
        });
    }

    /* ---- Personal (per-user) notifications ----
       Unlike the shared `notifications` collection (promo/tips, visible to
       everyone), these live under the recipient's own user doc, so only they
       can see them. */
    async function addPersonalNotification(toUid, data) {
        await addDoc(collection(db, "users", toUid, "personalNotifications"), {
            ...data,
            createdAt: Date.now(),
            read: false
        });
    }

    function listenToPersonalNotifications(callback, maxCount = 50) {
        if (!currentUser) return () => { };
        const q = query(
            collection(db, "users", currentUser.uid, "personalNotifications"),
            orderBy("createdAt", "desc"),
            limit(maxCount)
        );
        return onSnapshot(q, (snap) => {
            const items = [];
            snap.forEach(d => items.push({ id: d.id, ...d.data() }));
            callback(items);
        });
    }

    async function markPersonalNotificationRead(notifId) {
        await waitForAuthReady();
        if (!currentUser) return;
        try {
            await updateDoc(doc(db, "users", currentUser.uid, "personalNotifications", notifId), { read: true });
        } catch (e) {
            console.warn("Couldn't mark notification read:", e.message);
        }
    }

    // Live incoming pending requests (people who want to friend ME).
    function listenToIncomingFriendRequests(callback) {
        const q = query(
            collection(db, "friendRequests"),
            where("toUid", "==", currentUser.uid),
            where("status", "==", "pending")
        );
        return onSnapshot(q, (snap) => {
            const items = [];
            snap.forEach(d => items.push({ id: d.id, ...d.data() }));
            callback(items);
        });
    }

    // Live accepted friendships involving ME (either direction).
    function listenToFriends(callback) {
        const qFrom = query(
            collection(db, "friendRequests"),
            where("fromUid", "==", currentUser.uid),
            where("status", "==", "accepted")
        );
        const qTo = query(
            collection(db, "friendRequests"),
            where("toUid", "==", currentUser.uid),
            where("status", "==", "accepted")
        );
        let fromItems = [];
        let toItems = [];
        async function emit() {
            const merged = [
                ...fromItems.map(r => ({ uid: r.toUid, name: r.toName })),
                ...toItems.map(r => ({ uid: r.fromUid, name: r.fromName }))
            ];
            const enriched = await Promise.all(merged.map(async (f) => {
                const pub = await getPublicProfile(f.uid);
                return pub
                    ? {
                        uid: f.uid, name: pub.name || f.name, avatar: pub.avatar || "", lastActiveAt: pub.lastActiveAt || 0,
                        bio: pub.bio || "", favoriteTroop: pub.favoriteTroop || "", favoriteHero: pub.favoriteHero || "",
                        highestTrophies: pub.highestTrophies || 0, currentClan: pub.currentClan || "",
                        currentLevel: pub.currentLevel || 0, currentPower: pub.currentPower || 0
                    }
                    : { ...f, avatar: "", lastActiveAt: 0 };
            }));
            callback(enriched);
        }
        const unsub1 = onSnapshot(qFrom, (snap) => {
            fromItems = []; snap.forEach(d => fromItems.push(d.data())); emit();
        });
        const unsub2 = onSnapshot(qTo, (snap) => {
            toItems = []; snap.forEach(d => toItems.push(d.data())); emit();
        });
        return () => { unsub1(); unsub2(); };
    }

    /* ======================================================
       NEW — BLOCKING
       ====================================================== */

    function blockDocId(blockerUid, blockedUid) {
        return blockerUid + "_" + blockedUid;
    }

    async function blockUser(otherUid) {
        await waitForAuthReady();
        if (!currentUser) throw new Error("Not signed in.");
        await setDoc(doc(db, "blocks", blockDocId(currentUser.uid, otherUid)), {
            blockerUid: currentUser.uid,
            blockedUid: otherUid,
            createdAt: Date.now()
        });
    }

    async function unblockUser(otherUid) {
        await waitForAuthReady();
        if (!currentUser) throw new Error("Not signed in.");
        await deleteDoc(doc(db, "blocks", blockDocId(currentUser.uid, otherUid)));
    }

    // Does the OTHER person have ME blocked? (used to stop me messaging them)
    async function amIBlockedBy(otherUid) {
        await waitForAuthReady();
        if (!currentUser) return false;
        const snap = await getDoc(doc(db, "blocks", blockDocId(otherUid, currentUser.uid)));
        return snap.exists();
    }

    // Have I blocked them? (used to render the Block/Unblock button label)
    async function haveIBlocked(otherUid) {
        await waitForAuthReady();
        if (!currentUser) return false;
        const snap = await getDoc(doc(db, "blocks", blockDocId(currentUser.uid, otherUid)));
        return snap.exists();
    }
    /* ---------------- PRESENCE (site-wide) ---------------- */

    async function touchLastActive() {
        await waitForAuthReady();
        if (!currentUser) return;
        const now = Date.now();
        try {
            await updateDoc(doc(db, "users", currentUser.uid), { lastActiveAt: now });
            await updateDoc(doc(db, "publicProfiles", currentUser.uid), { lastActiveAt: now });
        } catch (e) {
            console.warn("Couldn't update lastActiveAt:", e.message);
        }
    }

    // Real-activity heartbeat: any click/keypress/scroll or coming back to
    // a hidden tab counts as "active", but we never write more than once
    // per ACTIVITY_TOUCH_MIN_INTERVAL_MS so a busy user doesn't hammer
    // Firestore. This runs on every page that imports appState.js, so
    // presence is tracked site-wide, not just on social.html.
    const ACTIVITY_TOUCH_MIN_INTERVAL_MS = 60 * 1000;
    let lastActivityTouchAt = 0;
    let presenceListenersAttached = false;

    function touchLastActiveThrottled() {
        if (!currentUser) return;
        const now = Date.now();
        if (now - lastActivityTouchAt < ACTIVITY_TOUCH_MIN_INTERVAL_MS) return;
        lastActivityTouchAt = now;
        touchLastActive();
    }

    function startPresenceHeartbeat() {
        if (presenceListenersAttached) return;
        presenceListenersAttached = true;

        ["click", "keydown", "scroll"].forEach(evt => {
            window.addEventListener(evt, touchLastActiveThrottled, { passive: true });
        });
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") touchLastActiveThrottled();
        });
    }

    // Start listening immediately; touchLastActiveThrottled() itself is a
    // no-op while signed out, and fires an initial stamp as soon as the
    // user is known (page load, tab focus, or first interaction).
    startPresenceHeartbeat();
    waitForAuthReady().then(() => {
        if (currentUser) touchLastActiveThrottled();
    });
    onAuthStateChanged(auth, () => {
        if (currentUser) touchLastActiveThrottled();
    });
    // Live presence for a set of friend uids — re-fires whenever ANY of their
    // publicProfiles docs change, so the green dot updates in real time
    // instead of only at page load / friendship changes.
    function listenToPublicProfilesPresence(uids, callback) {
        if (!uids.length) { callback({}); return () => { }; }
        const chunks = [];
        for (let i = 0; i < uids.length; i += 10) chunks.push(uids.slice(i, i + 10));

        let combined = {};
        const unsubs = chunks.map(chunk => {
            const q = query(collection(db, "publicProfiles"), where(documentId(), "in", chunk));
            return onSnapshot(q, (snap) => {
                snap.forEach(d => { combined[d.id] = d.data().lastActiveAt || 0; });
                callback({ ...combined });
            });
        });
        return () => unsubs.forEach(u => u());
    }
    /* ---------------- FRIEND SEARCH ---------------- */

    // Prefix match only (Firestore has no substring search) — matches names
    // that START WITH what's typed, case-insensitive.
   async function searchUsersByName(searchText, maxCount = 20) {
    await waitForAuthReady();
    if (!currentUser) throw new Error("You must sign in with Google first.");
    const prefix = normalizeNameKey(searchText);
    if (!prefix) return [];

    const usernamesQ = query(
        collection(db, "usernames"),
        where(documentId(), ">=", prefix),
        where(documentId(), "<=", prefix + "\uf8ff"),
        limit(maxCount)
    );
    // Fallback/supplement: publicProfiles gets written for EVERY signed-in
    // user the first time getProfile() runs (unlike usernames, which only
    // gets a reservation once they save their Profile page) — so this
    // catches accounts that exist but never touched their profile.
    const publicProfilesQ = query(
        collection(db, "publicProfiles"),
        where("nameLower", ">=", prefix),
        where("nameLower", "<=", prefix + "\uf8ff"),
        limit(maxCount)
    );

    const [usernamesSnap, publicProfilesSnap] = await Promise.all([
        getDocs(usernamesQ),
        getDocs(publicProfilesQ)
    ]);

    const found = new Map(); // uid -> { uid, name }
    usernamesSnap.forEach(d => {
        const data = d.data();
        if (data.uid !== currentUser.uid) found.set(data.uid, { uid: data.uid, name: data.name });
    });
    publicProfilesSnap.forEach(d => {
        if (d.id !== currentUser.uid && !found.has(d.id)) {
            found.set(d.id, { uid: d.id, name: d.data().name });
        }
    });

    const results = [...found.values()].slice(0, maxCount);
    return Promise.all(results.map(async (r) => {
        const pub = await getPublicProfile(r.uid);
        return {
            uid: r.uid,
            name: pub?.name || r.name,
            avatar: pub?.avatar || "",
            bio: pub?.bio || "",
            lastActiveAt: pub?.lastActiveAt || 0,
            favoriteTroop: pub?.favoriteTroop || "",
            favoriteHero: pub?.favoriteHero || "",
            highestTrophies: pub?.highestTrophies || 0,
            currentClan: pub?.currentClan || "",
            currentLevel: pub?.currentLevel || 0,
            currentPower: pub?.currentPower || 0
        };
    }));
}
    /* ---------------- SUGGESTED FRIENDS ---------------- */

    async function getMyRelatedUids() {
        await waitForAuthReady();
        if (!currentUser) return new Set();
        const qFrom = query(collection(db, "friendRequests"), where("fromUid", "==", currentUser.uid));
        const qTo = query(collection(db, "friendRequests"), where("toUid", "==", currentUser.uid));
        const [fromSnap, toSnap] = await Promise.all([getDocs(qFrom), getDocs(qTo)]);
        const uids = new Set();
        fromSnap.forEach(d => { if (d.data().status !== "declined") uids.add(d.data().toUid); });
        toSnap.forEach(d => { if (d.data().status !== "declined") uids.add(d.data().fromUid); });
        return uids;
    }

    async function getSuggestedFriends(maxCount = 10) {
        await waitForAuthReady();
        if (!currentUser) return [];
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const q = query(collection(db, "publicProfiles"), orderBy("lastActiveAt", "desc"), limit(50));
        const snap = await getDocs(q);
        const related = await getMyRelatedUids();
        const results = [];
        snap.forEach(d => {
            if (d.id === currentUser.uid || related.has(d.id)) return;
            const data = d.data();
            if (!data.lastActiveAt || data.lastActiveAt < sevenDaysAgo) return;
            results.push({
                uid: d.id, name: data.name || "Commander", avatar: data.avatar || "", lastActiveAt: data.lastActiveAt,
                bio: data.bio || "", favoriteTroop: data.favoriteTroop || "", favoriteHero: data.favoriteHero || "",
                highestTrophies: data.highestTrophies || 0, currentClan: data.currentClan || "",
                currentLevel: data.currentLevel || 0, currentPower: data.currentPower || 0
            });
        });
        return results.slice(0, maxCount);
    }
    /* ======================================================
       NEW IN STAGE 3 — DIRECT MESSAGES (friends only)
       ====================================================== */



    async function getOrCreateDmThread(otherUid, otherName) {
        await waitForAuthReady();
        if (!currentUser) throw new Error("You must sign in with Google first.");
        const threadId = friendshipId(currentUser.uid, otherUid);
        const ref = doc(db, "dmThreads", threadId);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
            const profile = await getProfile();
            await setDoc(ref, {
                members: [currentUser.uid, otherUid],
                memberNames: {
                    [currentUser.uid]: profile.name || "Commander",
                    [otherUid]: otherName
                },
                lastMessageAt: Date.now(),
                lastMessageSenderUid: null,
                lastMessageText: "",
                // Per-user "last read" timestamps — used to compute unread
                // badges. Starts at "now" for me since I'm opening it.
                lastRead: { [currentUser.uid]: Date.now(), [otherUid]: 0 },
                // Per-user unread message COUNT (not just a bool) — so the
                // Friends tab can show "4" like a normal messaging app.
                unreadCount: { [currentUser.uid]: 0, [otherUid]: 0 }
            });
        }
        return threadId;
    }

    async function sendDmMessage(threadId, text, replyTo) {
        await waitForAuthReady();
        if (!currentUser) throw new Error("Not signed in.");
        const trimmed = (text || "").trim();
        if (!trimmed) throw new Error("Message cannot be empty.");
        if (trimmed.length > 2000) throw new Error("Message is too long.");

        const profile = await getProfile();
        if (isBannedNow(profile)) {
            showRestrictedNotice(profile.banReason, profile.banUntil);
            throw new Error("__RESTRICTED__");
        }

        const threadSnap = await getDoc(doc(db, "dmThreads", threadId));
        let otherUid = null;
        if (threadSnap.exists()) {
            otherUid = threadSnap.data().members.find(m => m !== currentUser.uid);
            if (otherUid && await amIBlockedBy(otherUid)) {
                throw new Error("You can't message this user.");
            }
            if (otherUid && await haveIBlocked(otherUid)) {
                throw new Error("You have blocked this user. Unblock them before sending messages.");
            }
        }

        const msgRef = await addDoc(collection(db, "dmThreads", threadId, "messages"), {
            senderUid: currentUser.uid,
            text: trimmed,
            createdAt: Date.now(),
            // Optional reply reference — { id, senderUid, text } of the
            // message being replied to. Stored as a short snapshot rather
            // than a live pointer, so it still renders correctly even if
            // the original message is later edited or deleted.
            ...(replyTo ? {
                replyToId: replyTo.id || null,
                replyToText: (replyTo.text || "").slice(0, 300),
                replyToSenderUid: replyTo.senderUid || null
            } : {})
        });

        const patch = {
            lastMessageAt: Date.now(),
            lastMessageSenderUid: currentUser.uid,
            lastMessageText: trimmed,
            [`lastRead.${currentUser.uid}`]: Date.now(), // sending counts as having read up to now
            [`unreadCount.${currentUser.uid}`]: 0
        };
        if (otherUid) {
            patch[`unreadCount.${otherUid}`] = increment(1);
        }
        // The message itself is the proof, so report it whether or not the
        // thread-preview update below succeeds.
        reportQuestProgress("sendMessage", threadId + "/" + msgRef.id);
        await updateDoc(doc(db, "dmThreads", threadId), patch);
    }
// Lets a user edit the text of their own already-sent message. Also
    // keeps the thread's lastMessageText preview in sync if the edited
    // message happens to be the most recent one in the thread.
    async function editDmMessage(threadId, messageId, newText) {
        await waitForAuthReady();
        if (!currentUser) throw new Error("Not signed in.");
        const trimmed = (newText || "").trim();
        if (!trimmed) throw new Error("Message cannot be empty.");
        if (trimmed.length > 2000) throw new Error("Message is too long.");

        const profile = await getProfile();
        if (isBannedNow(profile)) {
            showRestrictedNotice(profile.banReason, profile.banUntil);
            throw new Error("__RESTRICTED__");
        }

        const msgRef = doc(db, "dmThreads", threadId, "messages", messageId);
        const msgSnap = await getDoc(msgRef);
        if (!msgSnap.exists()) throw new Error("Message not found.");
        if (msgSnap.data().senderUid !== currentUser.uid) {
            throw new Error("You can only edit your own messages.");
        }

        await updateDoc(msgRef, { text: trimmed, editedAt: Date.now() });

        // Best-effort: if this was the latest message in the thread, update
        // the thread preview text too so the Friends tab stays accurate.
        try {
            const latestQ = query(
                collection(db, "dmThreads", threadId, "messages"),
                orderBy("createdAt", "desc"),
                limit(1)
            );
            const latestSnap = await getDocs(latestQ);
            if (!latestSnap.empty && latestSnap.docs[0].id === messageId) {
                await updateDoc(doc(db, "dmThreads", threadId), { lastMessageText: trimmed });
            }
        } catch (e) {
            console.warn("Couldn't sync thread preview after edit:", e.message);
        }
    }
    // Call when the user opens/views a thread — clears the unread badge for
    // just that thread (and therefore recalculates the overall count).
    async function markDmThreadRead(threadId) {
        await waitForAuthReady();
        if (!currentUser) return;
        try {
            await updateDoc(doc(db, "dmThreads", threadId), {
                [`lastRead.${currentUser.uid}`]: Date.now(),
                [`unreadCount.${currentUser.uid}`]: 0
            });
        } catch (e) {
            console.warn("Couldn't mark thread read:", e.message);
        }
    }

    // Counts CONVERSATIONS with unread messages, not total unread messages —
    // e.g. one friend sending 4 messages still shows "1" here (matches how
    // normal messaging apps badge their conversation list).
    // Only counts threads whose other member is a CURRENT friend — a stray
    // thread with someone you unfriended (or never actually friended, e.g.
    // an old admin test chat) can otherwise sit with unreadCount > 0 forever
    // with no visible row in the Friends tab to click and clear it.
    function listenToUnreadDmCount(callback) {
        if (!currentUser) { callback(0); return () => { }; }
        let threadsList = [];
        let friendUids = new Set();

        function emit() {
            const uid = currentUser.uid;
            const count = threadsList.filter(t => {
                if (!((t.unreadCount && t.unreadCount[uid]) > 0)) return false;
                const otherUid = (t.members || []).find(m => m !== uid);
                return otherUid && friendUids.has(otherUid);
            }).length;
            callback(count);
        }

        const unsub1 = listenToMyDmThreads((threads) => { threadsList = threads; emit(); });
        const unsub2 = listenToFriends((friends) => { friendUids = new Set(friends.map(f => f.uid)); emit(); });
        return () => { unsub1(); unsub2(); };
    }

    // Friends list enriched with DM metadata (last message, timestamp, this
    // friend's own unread count) — sorted most-recent-conversation-first,
    // like a normal messaging app's chat list.
    function listenToFriendsWithDmMeta(callback) {
        let friendsList = [];
        let threadsList = [];
        let presenceMap = {};
        let unsubPresence = null;

        function emit() {
            if (!currentUser) return;
            const uid = currentUser.uid;
            const threadByOtherUid = {};
            threadsList.forEach(t => {
                const otherUid = (t.members || []).find(m => m !== uid);
                if (otherUid) threadByOtherUid[otherUid] = t;
            });
            const enriched = friendsList.map(f => {
                const t = threadByOtherUid[f.uid];
                return {
                    ...f,
                    lastActiveAt: presenceMap[f.uid] ?? f.lastActiveAt ?? 0, // live value wins
                    lastMessageAt: t?.lastMessageAt || 0,
                    lastMessageText: t?.lastMessageText || "",
                    lastMessageSenderUid: t?.lastMessageSenderUid || null,
                    unreadCount: (t?.unreadCount && t.unreadCount[uid]) || 0
                };
            });
            enriched.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
            callback(enriched);
        }

        const unsub1 = listenToFriends((list) => {
            friendsList = list;
            // Re-subscribe to live presence whenever the friend set changes.
            if (unsubPresence) { unsubPresence(); unsubPresence = null; }
            unsubPresence = listenToPublicProfilesPresence(list.map(f => f.uid), (map) => {
                presenceMap = map;
                emit();
            });
            emit();
        });
        const unsub2 = listenToMyDmThreads((threads) => { threadsList = threads; emit(); });
        return () => {
            unsub1(); unsub2();
            if (unsubPresence) unsubPresence();
        };
    }

    function listenToDmMessages(threadId, callback, maxCount = 200) {
        const q = query(
            collection(db, "dmThreads", threadId, "messages"),
            orderBy("createdAt", "asc"),
            limit(maxCount)
        );
        return onSnapshot(q, (snap) => {
            const items = [];
            snap.forEach(d => items.push({ id: d.id, ...d.data() }));
            callback(items);
        });
    }

    function listenToMyDmThreads(callback) {
        const q = query(
            collection(db, "dmThreads"),
            where("members", "array-contains", currentUser.uid),
            orderBy("lastMessageAt", "desc")
        );
        return onSnapshot(q, (snap) => {
            const items = [];
            snap.forEach(d => items.push({ id: d.id, ...d.data() }));
            callback(items);
        });
    }

    // Keeps the thread doc alive so the DM modal's
    // live listener just picks up the now-empty messages collection instead
    // of kicking the user out of the chat.
    async function deleteDmMessagesOnly(threadId) {
    await waitForAuthReady();
    if (!currentUser) throw new Error("Not signed in.");
    const messagesSnap = await getDocs(collection(db, "dmThreads", threadId, "messages"));
    const deletions = [];
    messagesSnap.forEach(d => deletions.push(deleteDoc(doc(db, "dmThreads", threadId, "messages", d.id))));
    await Promise.all(deletions);

    const threadSnap = await getDoc(doc(db, "dmThreads", threadId));
    const members = threadSnap.exists() ? (threadSnap.data().members || []) : [currentUser.uid];

    const patch = {
        lastMessageAt: Date.now(),
        lastMessageSenderUid: null,
        lastMessageText: "",
        [`lastRead.${currentUser.uid}`]: Date.now(),
    };
    // Deleting the messages clears the thread for BOTH participants, so
    // both unread counts must reset to 0 — otherwise the other person can
    // be left with a stale "1" badge pointing at a chat with nothing in it.
    members.forEach(uid => {
        patch[`unreadCount.${uid}`] = 0;
    });

    await updateDoc(doc(db, "dmThreads", threadId), patch);
}

    /* ======================================================
       NEW IN STAGE 3 — REPORTS
       ====================================================== */

    async function uploadReportEvidence(file) {
        await waitForAuthReady();
        if (!currentUser) throw new Error("You must sign in with Google first.");
        if (!file.type.startsWith("image/")) {
            throw new Error("Evidence file must be an image.");
        }
        if (file.size > 5 * 1024 * 1024) {
            throw new Error("Image must be under 5MB.");
        }
        const path = "reportEvidence/" + currentUser.uid + "-" + Date.now() + "-" + file.name;
        const storageRef = ref(storage, path);
        await uploadBytes(storageRef, file);
        const evidenceUrl = await getDownloadURL(storageRef);
        return { evidenceUrl, evidencePath: path };
    }

    async function submitReport(type, targetUid, targetName, contentId, contentText, evidenceUrls, evidencePaths) {
        await waitForAuthReady();
        if (!currentUser) throw new Error("You must sign in with Google first to report something.");
        const profile = await getProfile();
        await addDoc(collection(db, "reports"), {
            reporterUid: currentUser.uid,
            reporterName: profile.name || "Commander",
            targetUid: targetUid || null,
            targetName: targetName || "",
            type: type, // "post" or "message"
            contentId: contentId || null,
            contentText: (contentText || "").slice(0, 2000),
            evidenceUrls: Array.isArray(evidenceUrls) ? evidenceUrls.slice(0, 5) : [],
            // Storage paths (not just download URLs) so closeReport() can
            // actually delete the underlying files once acted on.
            evidencePaths: Array.isArray(evidencePaths) ? evidencePaths.slice(0, 5) : [],
            createdAt: Date.now(),
            status: "open"
        });
    }

    /* ======================================================
       NEW IN STAGE 3 — ADMIN: bans + name history
       ====================================================== */

    async function getNameHistory(uid) {
        await waitForAuthReady();
        if (!currentUser || currentUser.uid !== ADMIN_UID) throw new Error("Not authorized.");
        const q = query(collection(db, "users", uid, "nameChangeLog"), orderBy("changedAt", "desc"));
        const snap = await getDocs(q);
        const items = [];
        snap.forEach(d => items.push({ id: d.id, ...d.data() }));
        return items;
    }

    async function getReports(maxCount = 100) {
        await waitForAuthReady();
        if (!currentUser || currentUser.uid !== ADMIN_UID) throw new Error("Not authorized.");
        const q = query(collection(db, "reports"), orderBy("createdAt", "desc"), limit(maxCount));
        const snap = await getDocs(q);
        const items = [];
        snap.forEach(d => items.push({ id: d.id, ...d.data() }));
        return items;
    }


    async function closeReport(reportId) {
        await waitForAuthReady();
        if (!currentUser || currentUser.uid !== ADMIN_UID) throw new Error("Not authorized.");
        // Whether it's dismissed, timed out, or banned — the report is being
        // closed either way, so clean up its evidence images now instead of
        // leaving them in Storage forever.
        try {
            const snap = await getDoc(doc(db, "reports", reportId));
            const paths = snap.exists() ? (snap.data().evidencePaths || []) : [];
            await Promise.all(paths.map(p =>
                deleteObject(ref(storage, p)).catch(e => console.warn("Couldn't delete evidence image:", e.message))
            ));
        } catch (e) {
            console.warn("Couldn't clean up report evidence:", e.message);
        }
        await updateDoc(doc(db, "reports", reportId), { status: "closed" });
    }

    // durationMs: null/0 = indefinite ban. Pass e.g. 24*60*60*1000 for a 24hr timeout.
    async function banUser(uid, durationMs, reason) {
        await waitForAuthReady();
        if (!currentUser || currentUser.uid !== ADMIN_UID) throw new Error("Not authorized.");
        const ref = doc(db, "users", uid);
        const snap = await getDoc(ref);
        const current = snap.exists() ? snap.data() : defaultProfile();
        await setDoc(ref, {
            ...defaultProfile(),
            ...current,
            banned: true,
            banUntil: durationMs ? Date.now() + durationMs : 0,
            banReason: reason || "",
            bannedAt: Date.now()
        });

        // Banning also ends any live PayPal subscriptions (VIP and the
        // legacy No Ads plan) — a banned user shouldn't keep being billed
        // for perks tied to an account that's locked out.
        for (const plan of ["vip", "noAds"]) {
            try {
                await adminCancelSubscription(uid, plan);
            } catch (e) {
                console.warn(`Couldn't auto-cancel ${plan} subscription after ban:`, e.message);
            }
        }
    }

    async function unbanUser(uid) {
        await waitForAuthReady();
        if (!currentUser || currentUser.uid !== ADMIN_UID) throw new Error("Not authorized.");
        const ref = doc(db, "users", uid);
        const snap = await getDoc(ref);
        const current = snap.exists() ? snap.data() : defaultProfile();
        await setDoc(ref, { ...defaultProfile(), ...current, banned: false, banUntil: 0, banReason: "", bannedAt: 0 });
    }
// Admin-only manual VIP grant — this is the safe alternative to hand-
    // editing Firestore. Stacks on top of any time the user already has
    // left (same rule the PayPal webhook uses), so granting VIP to someone
    // mid-subscription adds days rather than shortening/resetting them.
    // Does NOT touch vipSubscriptionId — this is independent of PayPal, so
    // the Store page will still correctly show "Subscribe" (no live sub)
    // even while a manual grant is active.
    async function adminGrantVip(uid, durationDays) {
        await waitForAuthReady();
        if (!currentUser || currentUser.uid !== ADMIN_UID) throw new Error("Not authorized.");
        if (!uid) throw new Error("No uid provided.");
        const days = parseFloat(durationDays);
        if (isNaN(days) || days <= 0) throw new Error("Enter a positive number of days.");

        const ref = doc(db, "users", uid);
        const snap = await getDoc(ref);
        const current = snap.exists() ? snap.data() : defaultProfile();
        const currentExpiresAt = current.vipExpiresAt || 0;
        const baseTime = currentExpiresAt > Date.now() ? currentExpiresAt : Date.now();
        const newExpiresAt = baseTime + days * 24 * 60 * 60 * 1000;

        await setDoc(ref, { ...defaultProfile(), ...current, vipExpiresAt: newExpiresAt }, { merge: true });

        try {
            await addPersonalNotification(uid, {
                type: "adminGrant",
                title: "👑 You're now a Super Supporter!",
                body: `An admin made you a Super Supporter for ${days} day(s). Enjoy!`
            });
        } catch (e) {
            console.warn("Couldn't send VIP grant notification:", e.message);
        }

        return newExpiresAt;
    }
// Admin-only: cancels a user's live PayPal subscription on their behalf.
    // Used by adminRevokeVip() and banUser() so someone who's had VIP pulled
    // or been banned doesn't keep getting billed for a perk they no longer
    // have, with no way to notice or cancel it themselves on-site.
    // Best-effort — callers should not let a failure here block the
    // revoke/ban itself (e.g. no subscription existed for that plan).
    async function adminCancelSubscription(uid, plan) {
        await waitForAuthReady();
        if (!currentUser || currentUser.uid !== ADMIN_UID) throw new Error("Not authorized.");
        const idToken = await getIdToken();
        const res = await fetch(BACKEND_BASE + "/api/cancel-subscription", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": "Bearer " + idToken },
            body: JSON.stringify({ plan, targetUid: uid })
        });
        if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new Error(`Cancel request failed (${res.status}): ${text}`);
        }
    }
    // Zeroes out VIP immediately — for undoing a mistaken grant, or pulling
    // VIP from someone regardless of what a live PayPal subscription thinks.
    // Does not touch vipSubscriptionId — if they have a real live sub, the
    // webhook's next payment cycle will just re-grant time as normal, so
    // this is meant for correcting manual grants, not fighting real subs.
    async function adminRevokeVip(uid) {
        await waitForAuthReady();
        if (!currentUser || currentUser.uid !== ADMIN_UID) throw new Error("Not authorized.");
        if (!uid) throw new Error("No uid provided.");
        await setDoc(doc(db, "users", uid), { vipExpiresAt: 0 }, { merge: true });

        // Revoking VIP also ends any live PayPal subscription — otherwise
        // they keep being billed for a perk they no longer have.
        try {
            await adminCancelSubscription(uid, "vip");
        } catch (e) {
            console.warn("Couldn't auto-cancel VIP subscription after revoke:", e.message);
        }
    }
    // Every currently banned/timed-out user, for admin.html's Active
    // Timeouts / Banned Users lists. expiresAt is a future timestamp for a
    // timeout, or null for a permanent (indefinite) ban.
    async function getBannedUsers() {
        await waitForAuthReady();
        if (!currentUser || currentUser.uid !== ADMIN_UID) throw new Error("Not authorized.");
        const q = query(collection(db, "users"), where("banned", "==", true));
        const snap = await getDocs(q);
        const now = Date.now();
        const items = [];
        snap.forEach(d => {
            const data = d.data();
            // Skip timeouts that have already expired but haven't been
            // explicitly unbanned yet.
            if (data.banUntil && data.banUntil <= now) return;
            items.push({
                uid: d.id,
                name: data.name || "",
                reason: data.banReason || "",
                bannedAt: data.bannedAt || null,
                expiresAt: data.banUntil || null
            });
        });
        return items;
    }

   

   
   
/* ---------------- BAN GATE (live, runs on every page) ---------------- */

    // Only home.html renders the persistent banner (it's the page that owns
    // the shared nav/chrome). Every other page still runs this same listener
    // so it can disable/enable [data-requires-not-banned] controls live, but
    // it skips injecting its own banner — otherwise a page like social.html
    // shows its own copy stacked underneath home's, duplicating the message.
    function isHomeShellPage() {
        return /(^|\/)home\.html$/.test(window.location.pathname)
            || window.location.pathname === "/"
            || window.location.pathname.endsWith("/index.html");
    }

    const BAN_BANNER_ID = "kihBanBanner";
    let unsubMyBanGate = null;

    // Buttons that already run their own isBannedNow() check (Post Your
    // Clan, Send) must stay CLICKABLE even while restricted — their own
    // code shows a proper showRestrictedNotice() popup explaining why.
    // Disabling them here would kill that popup entirely, since a disabled
    // element's onclick never fires — you'd just get a dead greyed-out
    // button with zero feedback. Plain text inputs have no click handler
    // to preserve, so those are still safe to fully disable.
    function setRestrictedState(el, restricted, untilStr) {
        if (el.tagName === "BUTTON") {
            el.classList.toggle("kih-restricted-btn", restricted);
            el.title = restricted ? "You're timed out until " + untilStr : "";
        } else {
            el.disabled = restricted;
            el.title = restricted ? "You're timed out until " + untilStr : "";
        }
    }

    function clearBanUi() {
        // If we previously wiped the whole page for a permanent ban, the
        // simplest reliable fix is a hard reload — every button's event
        // listener, every open modal, every live Firestore listener that
        // page attached would otherwise need to be manually re-wired if we
        // just swapped the HTML back in. A reload guarantees a clean,
        // fully working page instead of a half-restored one.
        if (document.body.dataset.kihBanLocked) {
            window.location.reload();
            return;
        }

        const banner = document.getElementById(BAN_BANNER_ID);
        if (banner) banner.remove();
        document.querySelectorAll("[data-requires-not-banned]").forEach(el => {
            setRestrictedState(el, false);
        });
    }

    function applyTimeoutBanner(profile) {
        const untilStr = new Date(profile.banUntil).toLocaleString();
        document.querySelectorAll("[data-requires-not-banned]").forEach(el => {
            setRestrictedState(el, true, untilStr);
        });

        if (!isHomeShellPage()) return;

        let banner = document.getElementById(BAN_BANNER_ID);
        if (!banner) {
            banner = document.createElement("div");
            banner.id = BAN_BANNER_ID;
            banner.style.cssText = "background:#aa7a1e;color:white;padding:12px 16px;border-radius:8px;margin:12px;text-align:center;flex-shrink:0;";
            // Insert INSIDE .home-shell (as the first child), not into body —
            // same reasoning as applyMaintenanceBanner: .home-shell is a
            // fixed-height flex column that already fills the viewport with
            // overflow:hidden on <body>. Prepending to body instead pushes
            // .home-shell's own content (Tips, About, etc.) past the
            // viewport and clips it at the bottom with no way to scroll to
            // the rest, since body's overflow is hidden.
            const shell = document.querySelector(".home-shell");
            if (shell) {
                shell.prepend(banner);
            } else {
                document.body.prepend(banner);
            }
        }
        banner.innerHTML = `⏱️ You're temporarily restricted from posting/messaging until <strong>${untilStr}</strong>.
            ${profile.banReason ? "Reason: " + escapeGateHtml(profile.banReason) + ". " : ""}
            If you feel this is unfair, <a href="mailto:keazyea@gmail.com?subject=Timeout%20Appeal" style="color:white;text-decoration:underline;">click here to appeal</a>.`;
    }

    function applyPermanentLockout(profile) {
        if (document.body.dataset.kihBanLocked) return;
        document.body.dataset.kihBanLocked = "1";
        document.body.innerHTML = `
            <div style="max-width:500px;margin:60px auto;text-align:center;padding:0 20px;">
                <h2>🚫 You have been banned</h2>
                <p class="promo-sub">${profile.banReason ? escapeGateHtml(profile.banReason) : "Your account has been permanently banned from Keazyea's Intelligence Hub."}</p>
                <a href="mailto:keazyea@gmail.com?subject=Ban%20Appeal" class="btn-primary"
                   style="display:inline-block;margin-top:20px;padding:14px 32px;text-decoration:none;">
                   If you feel this is unfair, click here to appeal
                </a>
            </div>`;
    }

    function startBanGateListener() {
        if (unsubMyBanGate) { unsubMyBanGate(); unsubMyBanGate = null; }
        if (!currentUser) { clearBanUi(); return; }

        unsubMyBanGate = onSnapshot(
            doc(db, "users", currentUser.uid),
            (snap) => {
                if (!snap.exists()) { clearBanUi(); return; }
                const profile = { ...defaultProfile(), ...snap.data() };
                if (!isBannedNow(profile)) { clearBanUi(); return; }
                if (!profile.banUntil) { applyPermanentLockout(profile); return; }
                applyTimeoutBanner(profile);
            },
            (err) => {
                // If the listener ever errors out (permission rules, network
                // blip, etc.) it stops firing for good — so fail SAFE and
                // clear any lockout rather than risk leaving controls stuck
                // disabled forever with no way to recover.
                console.warn("Ban gate listener error:", err.message);
                clearBanUi();
            }
        );
    }

    waitForAuthReady().then(startBanGateListener);
    onAuthChange(() => startBanGateListener());

                                        /* ---------------- MAINTENANCE MODE ---------------- */

    const MAINTENANCE_BANNER_ID = "kihMaintenanceBanner";
    let unsubMaintenance = null;

    function applyMaintenanceBanner(data) {
        // Only the shared home shell renders the banner — pages loaded
        // inside its iframes (promo.html, social.html, etc.) don't need
        // their own copy stacked underneath.
        if (!isHomeShellPage()) return;
        let banner = document.getElementById(MAINTENANCE_BANNER_ID);
        if (!data || !data.active) {
            if (banner) banner.remove();
            return;
        }
        if (!banner) {
            banner = document.createElement("div");
            banner.id = MAINTENANCE_BANNER_ID;
            banner.style.cssText = "background:#4169e1;color:white;padding:12px 16px;border-radius:8px;margin:12px;text-align:center;flex-shrink:0;";
            // Insert INSIDE .home-shell (as the first child), not into body —
            // .home-shell is a fixed-height flex column that already fills
            // the viewport with overflow:hidden on <body>. Prepending to
            // body instead of the shell pushes .home-shell's own content
            // past the viewport and gets clipped at the bottom. Inserting
            // here lets the banner become a normal flex item that the rest
            // of the shell shrinks around instead of overflowing past it.
            const shell = document.querySelector(".home-shell");
            if (shell) {
                shell.prepend(banner);
            } else {
                // Fallback for any page without a .home-shell wrapper.
                document.body.prepend(banner);
            }
        }
        banner.textContent = "🛠️ " + (data.message || "Server maintenance is in progress — some features may not work right now.");
    }

    function startMaintenanceListener() {
        if (unsubMaintenance) return; // only need one global listener per page
        unsubMaintenance = onSnapshot(
            doc(db, "config", "maintenance"),
            (snap) => {
                applyMaintenanceBanner(snap.exists() ? snap.data() : null);
            },
            (err) => {
                console.warn("Maintenance listener error:", err.message);
            }
        );
    }

    // Public read — any page can check current status without waiting for
    // the live listener (e.g. to decide whether to warn before a write).
    async function getMaintenanceStatus() {
        try {
            const snap = await getDoc(doc(db, "config", "maintenance"));
            return snap.exists() ? snap.data() : { active: false, message: "" };
        } catch (e) {
            return { active: false, message: "" };
        }
    }

    // Admin-only toggle.
    async function setMaintenanceMode(active, message) {
        await waitForAuthReady();
        if (!currentUser || currentUser.uid !== ADMIN_UID) throw new Error("Not authorized.");
        await setDoc(doc(db, "config", "maintenance"), {
            active: !!active,
            message: (message || "").trim(),
            updatedAt: Date.now(),
            updatedBy: currentUser.uid
        });
    }

    // Starts immediately on every page that imports appState.js — read is
    // public, doesn't need auth, so no need to wait for waitForAuthReady().
    startMaintenanceListener();
    /* ---------------- INBOX (still local per-device) ---------------- */

    function getInbox() {
        try {
            const raw = localStorage.getItem(KEYS.inbox);
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            return [];
        }
    }

    function addInboxMessage(title, body) {
        const inbox = getInbox();
        inbox.unshift({
            id: Date.now() + "-" + Math.random().toString(36).slice(2, 7),
            title: title,
            body: body,
            time: new Date().toLocaleString(),
            read: false
        });
        localStorage.setItem(KEYS.inbox, JSON.stringify(inbox));
        return inbox;
    }

    function markAllRead() {
        const inbox = getInbox().map(m => ({ ...m, read: true }));
        localStorage.setItem(KEYS.inbox, JSON.stringify(inbox));
        return inbox;
    }

    function unreadCount() {
        return getInbox().filter(m => !m.read).length;
    }

    /* ---------------- GIVEAWAY (unchanged) ---------------- */

    function getDebugWeekOffset() {
        const raw = localStorage.getItem("kih_debug_week_offset");
        const n = parseInt(raw, 10);
        return isNaN(n) ? 0 : n;
    }

    function getSimulatedNow() {
        const now = new Date();
        now.setDate(now.getDate() + getDebugWeekOffset() * 7);
        return now;
    }

    function getNextSunday() {
        const now = getSimulatedNow();
        const next = new Date(now);
        const daysUntilSunday = (7 - now.getDay()) % 7;
        next.setDate(now.getDate() + daysUntilSunday);
        next.setHours(0, 0, 0, 0);
        return next;
    }

    function getWeekId() {
        const d = getNextSunday();
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        return `${yyyy}-${mm}-${dd}`;
    }

    // Returns the last `count` Sunday weekIds BEFORE the current one, most
    // recent first — used to scan backward for weeks that never got drawn.
    function getPastWeekIds(count) {
        const ids = [];
        const current = getNextSunday();
        for (let i = 1; i <= count; i++) {
            const d = new Date(current);
            d.setDate(d.getDate() - 7 * i);
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, "0");
            const dd = String(d.getDate()).padStart(2, "0");
            ids.push(`${yyyy}-${mm}-${dd}`);
        }
        return ids;
    }

    function isGiveawayOpen() {
        const now = getSimulatedNow();
        return now.getDay() !== 0;
    }

    function entryDocId(uid, weekId) {
        return `${uid}_${weekId}`;
    }

    async function hasJoinedGiveaway(weekId) {
        await waitForAuthReady();
        if (!currentUser) return false;
        const ref = doc(db, "giveawayEntries", entryDocId(currentUser.uid, weekId));
        const snap = await getDoc(ref);
        return snap.exists();
    }

    async function getMyGiveawayEntry(weekId) {
        await waitForAuthReady();
        if (!currentUser) return null;
        const ref = doc(db, "giveawayEntries", entryDocId(currentUser.uid, weekId));
        const snap = await getDoc(ref);
        return snap.exists() ? snap.data() : null;
    }

    async function joinGiveaway(device) {
        await waitForAuthReady();
        if (!currentUser) throw new Error("Must be signed in to join the giveaway.");
        if (!isGiveawayOpen()) throw new Error("Entries are closed today — check back Monday for next week's giveaway.");
        const weekId = getWeekId();
        const id = entryDocId(currentUser.uid, weekId);
        const ref = doc(db, "giveawayEntries", id);
        const publicRef = doc(db, "giveawayEntriesPublic", id);
        const existing = await getDoc(ref);

        const profile = await getProfile();
        const name = profile.name || currentUser.displayName || "Commander";

        const entry = {
            uid: currentUser.uid,
            name: name,
            email: currentUser.email,
            device: device,
            weekId: weekId,
            joinedAt: existing.exists() ? existing.data().joinedAt : Date.now()
        };

        await setDoc(ref, entry);
        await setDoc(publicRef, { name: name, weekId: weekId });
        reportQuestProgress("enterWeekly", weekId);
        return entry;
    }

    async function getGiveawayEntries(weekId) {
        const q = query(collection(db, "giveawayEntries"), where("weekId", "==", weekId));
        const snap = await getDocs(q);
        const entries = [];
        snap.forEach(d => entries.push(d.data()));
        return entries;
    }
    async function getPublicGiveawayEntries(weekId) {
        const q = query(collection(db, "giveawayEntriesPublic"), where("weekId", "==", weekId));
        const snap = await getDocs(q);
        const entries = [];
        snap.forEach(d => entries.push(d.data()));
        return entries;
    }
    async function getWeekWinner(weekId) {
        const ref = doc(db, "giveawayWeeks", weekId);
        const snap = await getDoc(ref);
        return snap.exists() ? snap.data() : null;
    }
// Public history of past draws — no prize codes included (those stay
// private in giveawayPrizes/{uid}), just who won what week and on what
// device. Safe to show to anyone.
async function getGiveawayHistory(maxCount = 20) {
    const q = query(collection(db, "giveawayWeeks"), orderBy("drawnAt", "desc"), limit(maxCount));
    const snap = await getDocs(q);
    const items = [];
    snap.forEach(d => items.push({ weekId: d.id, ...d.data() }));
    return items;
}
    function isAdmin() {
        return !!currentUser && currentUser.uid === ADMIN_UID;
    }

    async function pickWeeklyWinner() {
        await waitForAuthReady();
        if (!currentUser || currentUser.uid !== ADMIN_UID) {
            throw new Error("Not authorized.");
        }

        const weekId = getWeekId();

        const already = await getWeekWinner(weekId);
        if (already) {
            throw new Error("A winner has already been drawn for " + weekId + ": " + already.winnerName);
        }

        const entries = await getGiveawayEntries(weekId);
        if (entries.length === 0) {
            throw new Error("No entries found for " + weekId + ".");
        }

        const winner = entries[Math.floor(Math.random() * entries.length)];
        return { weekId, entryCount: entries.length, winner };
    }

    /* A prize can be several promo codes. Codes arrive as an array or as text
       (one per line, or comma-separated) and are stored both ways: `prizes`
       (the list, so each gets its own Copy button) and `prize` (all of them
       joined, for anything that only knows about a single code). */
    function cleanPromoCodes(input) {
        // Each box may itself hold "A, B" or one code per line.
        const raw = (Array.isArray(input) ? input : [input])
            .flatMap(v => String(v == null ? "" : v).split(/[\n,]+/));
        // Kept exactly as entered (only blanks dropped): the same code twice
        // means two boxes, each with its own Copy.
        return raw.map(c => String(c || "").trim()).filter(Boolean);
    }
    function promoCodesText(codes) {
        return codes.length === 1 ? `"${codes[0]}"` : codes.map((c, i) => `${i + 1}. "${c}"`).join("\n");
    }

    async function finalizeGiveawayPrize(weekId, winner, prizeCode) {
    await waitForAuthReady();
    if (!currentUser || currentUser.uid !== ADMIN_UID) {
        throw new Error("Not authorized.");
    }
    const codes = cleanPromoCodes(prizeCode);
    if (!codes.length) {
        throw new Error("Prize code cannot be empty.");
    }
    const prizeText = codes.join(", ");

    const already = await getWeekWinner(weekId);
    if (already) {
        throw new Error("A winner has already been finalized for " + weekId + ".");
    }

    const weekRef = doc(db, "giveawayWeeks", weekId);
    await setDoc(weekRef, {
        winnerUid: winner.uid,
        winnerName: winner.name,
        device: winner.device,
        drawnAt: Date.now()
    });

    const prizeRef = doc(db, "giveawayPrizes", winner.uid);
    await setDoc(prizeRef, {
        weekId: weekId,
        prize: prizeText,
        prizes: codes,
        device: winner.device,
        // winnerName and drawnAt were missing here for a long time (the
        // auto-pick path recorded them, this one didn't), which is why the
        // admin list showed "Unknown" with nothing to sort by. Older records
        // are repaired on read in getAllGiveawayPrizes() from giveawayWeeks.
        winnerName: winner.name,
        drawnAt: Date.now()
    });

    // NEW: land the win in their inbox immediately — doesn't depend on
    // them ever opening the wheel that week.
    try {
        await addPersonalNotification(winner.uid, {
            type: "giveawayWin",
            title: "🎁 You won the Weekly Giveaway!",
            body: codes.length === 1
                ? `Congrats — you won "${codes[0]}" playing on ${winner.device === "ios" ? "iOS" : "Android"}. Redeem it in-game.`
                : `Congrats — you won ${codes.length} promo codes playing on ${winner.device === "ios" ? "iOS" : "Android"}:\n${promoCodesText(codes)}\nRedeem each one in-game.`,
            weekId: weekId,
            prize: prizeText,
            prizes: codes,
            device: winner.device
        });
    } catch (e) {
        console.warn("Couldn't send giveaway win notification:", e.message);
    }

    return true;
}

// Scans the past few weeks for ones that had entries but were never drawn —
// e.g. a Sunday you forgot to pick a winner on. Doesn't touch anything,
// just reports what's missing.
async function getMissedGiveawayWeeks(maxWeeksBack = 12) {
    await waitForAuthReady();
    if (!currentUser || currentUser.uid !== ADMIN_UID) throw new Error("Not authorized.");

    const weekIds = getPastWeekIds(maxWeeksBack);
    const missed = [];
    for (const weekId of weekIds) {
        const winner = await getWeekWinner(weekId);
        if (winner) continue;
        const entries = await getGiveawayEntries(weekId);
        if (entries.length > 0) missed.push({ weekId, entryCount: entries.length });
    }
    return missed;
}

// Randomly picks a winner for every missed week found above. The winner is
// notified RIGHT AWAY that they won — but with no prize code yet, since
// there isn't one to give. It's marked "pending" so admin.html can surface
// it under Pending Prizes and you can send the actual code whenever you're
// next free, without needing to remember who won or dig through entries.
async function autoPickMissedWinners() {
    await waitForAuthReady();
    if (!currentUser || currentUser.uid !== ADMIN_UID) throw new Error("Not authorized.");

    const missed = await getMissedGiveawayWeeks();
    const results = [];

    for (const { weekId } of missed) {
        // Guard against a race if a winner was drawn between the scan above
        // and now (e.g. two admin tabs open).
        const already = await getWeekWinner(weekId);
        if (already) continue;

        const entries = await getGiveawayEntries(weekId);
        if (!entries.length) continue;

        const winner = entries[Math.floor(Math.random() * entries.length)];

        await setDoc(doc(db, "giveawayWeeks", weekId), {
            winnerUid: winner.uid,
            winnerName: winner.name,
            device: winner.device,
            drawnAt: Date.now()
        });

        // NOTE: giveawayPrizes is keyed by uid alone (one doc per user,
        // always the latest) — same limitation as finalizeGiveawayPrize.
        // If this same person somehow has ANOTHER pending prize from an
        // earlier week that hasn't been sent yet, this overwrites it.
        await setDoc(doc(db, "giveawayPrizes", winner.uid), {
            weekId,
            prize: null,
            pendingPrize: true,
            device: winner.device,
            winnerName: winner.name,
            drawnAt: Date.now()
        });

        try {
            await addPersonalNotification(winner.uid, {
                type: "giveawayWin",
                title: "🎉 You won the Weekly Giveaway!",
                body: "Congrats — you were picked as this week's winner! Your prize code is still being finalized — we'll send it to you here shortly.",
                weekId,
                prize: null,
                pendingPrize: true,
                device: winner.device
            });
        } catch (e) {
            console.warn("Couldn't send pending-win notification:", e.message);
        }

        results.push({ weekId, winnerUid: winner.uid, winnerName: winner.name });
    }

    return results;
}

// Every user currently owed a prize code — for admin.html's Pending Prizes
// list. Click into one whenever you're free and send the actual code.
async function getPendingPrizes() {
    await waitForAuthReady();
    if (!currentUser || currentUser.uid !== ADMIN_UID) throw new Error("Not authorized.");
    const q = query(collection(db, "giveawayPrizes"), where("pendingPrize", "==", true));
    const snap = await getDocs(q);
    const items = [];
    snap.forEach(d => items.push({ uid: d.id, ...d.data() }));
    return items;
}

// Finally sends the real code to someone who was already told they won.
// Updates their ORIGINAL "you won" notification in place instead of adding
// a second one — otherwise the inbox ends up with a stale "code is on its
// way" card sitting forever alongside the real code, which is confusing.
async function sendPendingPrize(uid, weekId, code) {
    await waitForAuthReady();
    if (!currentUser || currentUser.uid !== ADMIN_UID) throw new Error("Not authorized.");
    const codes = cleanPromoCodes(code);
    if (!codes.length) throw new Error("Prize code cannot be empty.");
    const trimmed = codes.join(", ");
    const readyBody = codes.length === 1
        ? `Here's your promo code: "${codes[0]}". Redeem it in-game.`
        : `Here are your ${codes.length} promo codes:\n${promoCodesText(codes)}\nRedeem each one in-game.`;

    const ref = doc(db, "giveawayPrizes", uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error("No pending prize found for this user.");
    const data = snap.data();
    if (data.weekId !== weekId) throw new Error("Week mismatch — this prize may have already been updated.");

    await updateDoc(ref, { prize: trimmed, prizes: codes, pendingPrize: false });

    try {
        const q = query(
            collection(db, "users", uid, "personalNotifications"),
            where("type", "==", "giveawayWin"),
            where("weekId", "==", weekId),
            where("pendingPrize", "==", true),
            limit(1)
        );
        const notifSnap = await getDocs(q);

        if (!notifSnap.empty) {
            // Found the original "you won" notification — update it in
            // place so there's still just ONE card in their inbox, now
            // showing the real code instead of "code is on its way."
            // Also reset read:false and bump createdAt so it resurfaces as
            // a fresh unread item at the top of their inbox — otherwise a
            // user who already saw/dismissed the "coming soon" card would
            // have no way of noticing it silently updated behind the scenes.
            await updateDoc(doc(db, "users", uid, "personalNotifications", notifSnap.docs[0].id), {
                title: "🎁 Your Weekly Giveaway code is ready!",
                body: readyBody,
                prize: trimmed,
                prizes: codes,
                pendingPrize: false,
                read: false,
                createdAt: Date.now()
            });
        } else {
            // Fallback — original notification wasn't found for some
            // reason (e.g. manually deleted), send a fresh one instead
            // of failing silently.
            await addPersonalNotification(uid, {
                type: "giveawayWin",
                title: "🎁 Your Weekly Giveaway code is ready!",
                body: readyBody,
                weekId,
                prize: trimmed,
                prizes: codes,
                device: data.device || null
            });
        }
    } catch (e) {
        console.warn("Couldn't update prize-ready notification:", e.message);
    }

    return true;
}

// Admin-only: send a free-form message straight to a specific user's inbox.
// Useful for correcting a mistake (e.g. sent the wrong promo code) without
// waiting for the weekly giveaway flow.
async function sendAdminMessage(uid, title, body) {
    await waitForAuthReady();
    if (!currentUser || currentUser.uid !== ADMIN_UID) throw new Error("Not authorized.");
    if (!uid) throw new Error("No user selected.");
    const trimmedTitle = (title || "").trim();
    const trimmedBody = (body || "").trim();
    if (!trimmedTitle) throw new Error("Title cannot be empty.");
    if (!trimmedBody) throw new Error("Message cannot be empty.");

    await addPersonalNotification(uid, {
        type: "adminMessage",
        title: trimmedTitle,
        body: trimmedBody
    });
}
    async function updatePromoCode(codeId, newCode) {
        await waitForAuthReady();
        if (!currentUser || currentUser.uid !== ADMIN_UID) {
            throw new Error("Not authorized.");
        }
        const trimmed = (newCode || "").trim();
        if (!trimmed) throw new Error("Code cannot be empty.");
        await updateDoc(doc(db, "promoCodes", codeId), { code: trimmed });
        return codeId;
    }

    async function deletePromoCode(codeId) {
        await waitForAuthReady();
        if (!currentUser || currentUser.uid !== ADMIN_UID) {
            throw new Error("Not authorized.");
        }
        await deleteDoc(doc(db, "promoCodes", codeId));
        await deleteNotificationsBySource(codeId);
    }

    async function deleteTip(tipId) {
        await waitForAuthReady();
        if (!currentUser || currentUser.uid !== ADMIN_UID) {
            throw new Error("Not authorized.");
        }
        const tipRef = doc(db, "tips", tipId);
        const tipSnap = await getDoc(tipRef);
        if (tipSnap.exists()) {
            const data = tipSnap.data();
            const paths = Array.isArray(data.imagePaths) ? data.imagePaths : (data.imagePath ? [data.imagePath] : []);
            await Promise.all(paths.map(p =>
                deleteObject(ref(storage, p)).catch(e => console.warn("Couldn't delete tip image from Storage:", e.message))
            ));
        }
        await deleteDoc(tipRef);
        await deleteNotificationsBySource(tipId);
    }
    /* ---------------- PROMO CODES (admin-posted, from phone or PC) ---------------- */

    async function addAnnouncement(title, body) {
        await waitForAuthReady();
        if (!currentUser || currentUser.uid !== ADMIN_UID) {
            throw new Error("Not authorized.");
        }
        const trimmedTitle = (title || "").trim();
        const trimmedBody = (body || "").trim();
        if (!trimmedTitle) throw new Error("Title cannot be empty.");
        if (!trimmedBody) throw new Error("Message cannot be empty.");
        return addNotification("announcement", trimmedTitle, trimmedBody, null);
    }

    async function getAnnouncements(maxCount = 20) {
        await waitForAuthReady();
        if (!currentUser || currentUser.uid !== ADMIN_UID) {
            throw new Error("Not authorized.");
        }
        const q = query(
            collection(db, "notifications"),
            where("type", "==", "announcement"),
            orderBy("createdAt", "desc"),
            limit(maxCount)
        );
        const snap = await getDocs(q);
        const items = [];
        snap.forEach(d => items.push({ id: d.id, ...d.data() }));
        return items;
    }

    async function updateAnnouncement(notifId, title, body) {
        await waitForAuthReady();
        if (!currentUser || currentUser.uid !== ADMIN_UID) {
            throw new Error("Not authorized.");
        }
        const trimmedTitle = (title || "").trim();
        const trimmedBody = (body || "").trim();
        if (!trimmedTitle) throw new Error("Title cannot be empty.");
        if (!trimmedBody) throw new Error("Message cannot be empty.");
        await updateDoc(doc(db, "notifications", notifId), { title: trimmedTitle, body: trimmedBody });
        return notifId;
    }

    async function deleteAnnouncement(notifId) {
        await waitForAuthReady();
        if (!currentUser || currentUser.uid !== ADMIN_UID) {
            throw new Error("Not authorized.");
        }
        await deleteDoc(doc(db, "notifications", notifId));
    }

    async function addPromoCode(code) {
        await waitForAuthReady();
        if (!currentUser || currentUser.uid !== ADMIN_UID) {
            throw new Error("Not authorized.");
        }
        if (!code || !code.trim()) {
            throw new Error("Code cannot be empty.");
        }
        const ref = collection(db, "promoCodes");
        const docRef = await addDoc(ref, {
            code: code.trim(),
            createdAt: Date.now()
        });
        await addNotification("promo", "🎁 New Promo Code!", "A new code just dropped: " + code.trim(), docRef.id);
        return docRef.id;
    }

    async function getPromoCodes(maxCount = 20) {
        const q = query(collection(db, "promoCodes"), orderBy("createdAt", "desc"), limit(maxCount));
        const snap = await getDocs(q);
        const codes = [];
        snap.forEach(d => codes.push({ id: d.id, ...d.data() }));
        return codes;
    }
    /* ---------------- NOTIFICATIONS (shared inbox, admin-triggered) ---------------- */

    async function addNotification(type, title, body, sourceId) {
        const ref = collection(db, "notifications");
        const docRef = await addDoc(ref, {
            type: type,        // "promo" or "tip"
            title: title,
            body: body,
            sourceId: sourceId || null,
            createdAt: Date.now()
        });
        return docRef.id;
    }
    function listenToNotifications(callback, maxCount = 50) {
        const q = query(collection(db, "notifications"), orderBy("createdAt", "desc"), limit(maxCount));
        return onSnapshot(q, (snap) => {
            const items = [];
            snap.forEach(d => items.push({ id: d.id, ...d.data() }));
            callback(items);
        });
    }

    async function deleteNotificationsBySource(sourceId) {
        const q = query(collection(db, "notifications"), where("sourceId", "==", sourceId));
        const snap = await getDocs(q);
        const deletions = [];
        snap.forEach(d => deletions.push(deleteDoc(doc(db, "notifications", d.id))));
        await Promise.all(deletions);
    }
    /* ---------------- TIPS (admin-posted, from phone or PC) ---------------- */

    async function uploadTipImage(file) {
        await waitForAuthReady();
        if (!currentUser || currentUser.uid !== ADMIN_UID) {
            throw new Error("Not authorized.");
        }
        if (!file.type.startsWith("image/")) {
            throw new Error("File must be an image.");
        }
        if (file.size > 5 * 1024 * 1024) {
            throw new Error("Image must be under 5MB.");
        }
        const path = "tipImages/" + Date.now() + "-" + file.name;
        const storageRef = ref(storage, path);
        await uploadBytes(storageRef, file);
        const imageUrl = await getDownloadURL(storageRef);
        return { imageUrl, imagePath: path };
    }

    // A picture for a giveaway prize (admin's "+" in the prize builder). Kept
    // with the tip pictures, a folder the Storage rules already let admin
    // upload to; the name says what it's for.
    async function uploadPrizeImage(file) {
        await waitForAuthReady();
        if (!currentUser || currentUser.uid !== ADMIN_UID) throw new Error("Not authorized.");
        if (!file || !String(file.type).startsWith("image/")) throw new Error("That isn't a picture.");
        if (file.size > 5 * 1024 * 1024) throw new Error("Pictures must be under 5MB.");
        const safeName = String(file.name || "prize.jpg").replace(/[^\w.\-]/g, "_").slice(-60);
        const path = "tipImages/prize-" + Date.now() + "-" + safeName;
        const storageRef = ref(storage, path);
        await uploadBytes(storageRef, file, { contentType: file.type });
        return { imageUrl: await getDownloadURL(storageRef), imagePath: path };
    }

    // Fixed category set for tips — kept in sync with the filter dropdown
    // on tips.html and the tag <select> on admin.html. Anything else
    // (missing, old data, bad input) falls back to "others".
    const TIP_TAGS = ["hero", "troop", "bosses", "packs", "formation", "others"];
    function normalizeTipTag(tag) {
        return TIP_TAGS.includes(tag) ? tag : "others";
    }

    async function addTip(title, body, imageUrls, imagePaths, tag) {
        await waitForAuthReady();
        if (!currentUser || currentUser.uid !== ADMIN_UID) {
            throw new Error("Not authorized.");
        }
        if (!title || !title.trim()) {
            throw new Error("Title cannot be empty.");
        }
        if (!body || !body.trim()) {
            throw new Error("Body cannot be empty.");
        }
        const urls = Array.isArray(imageUrls) ? imageUrls : (imageUrls ? [imageUrls] : []);
        const paths = Array.isArray(imagePaths) ? imagePaths : (imagePaths ? [imagePaths] : []);
        const ref2 = collection(db, "tips");
        const docRef = await addDoc(ref2, {
            title: title.trim(),
            body: body.trim(),
            tag: normalizeTipTag(tag),
            // Keep imageUrl/imagePath as the FIRST image for backward
            // compatibility with any page still reading the old single-image
            // fields; imageUrls/imagePaths carries the full set.
            imageUrl: urls[0] || null,
            imagePath: paths[0] || null,
            imageUrls: urls,
            imagePaths: paths,
            createdAt: Date.now()
        });
        await addNotification("tip", "💡 New Tip: " + title.trim(), body.trim().slice(0, 100), docRef.id);
        return docRef.id;
    }
    async function updateTip(tipId, title, body, imageUrls, imagePaths, tag) {
        await waitForAuthReady();
        if (!currentUser || currentUser.uid !== ADMIN_UID) {
            throw new Error("Not authorized.");
        }
        if (!title || !title.trim()) {
            throw new Error("Title cannot be empty.");
        }
        if (!body || !body.trim()) {
            throw new Error("Body cannot be empty.");
        }
        const tipRef = doc(db, "tips", tipId);
        const patch = {
            title: title.trim(),
            body: body.trim(),
            tag: normalizeTipTag(tag)
        };
        // Only touch image fields if new images were actually provided —
        // otherwise leave the existing images untouched.
        const urls = Array.isArray(imageUrls) ? imageUrls : (imageUrls ? [imageUrls] : []);
        const paths = Array.isArray(imagePaths) ? imagePaths : (imagePaths ? [imagePaths] : []);
        if (urls.length) {
            patch.imageUrl = urls[0];
            patch.imagePath = paths[0] || null;
            patch.imageUrls = urls;
            patch.imagePaths = paths;
        }
        await updateDoc(tipRef, patch);
        return tipId;
    }
    async function getTip(tipId) {
        const snap = await getDoc(doc(db, "tips", tipId));
        return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    }
    async function getTips(maxCount) {
        const q = maxCount
            ? query(collection(db, "tips"), orderBy("createdAt", "desc"), limit(maxCount))
            : query(collection(db, "tips"), orderBy("createdAt", "desc"));
        const snap = await getDocs(q);
        const tips = [];
        snap.forEach(d => tips.push({ id: d.id, ...d.data() }));
        return tips;
    }
    // Fetches one page of tips (latest first) instead of the whole
    // collection — pass the previous page's `lastDoc` as `afterDoc` to get
    // the next page. Requests one extra doc beyond pageSize so callers can
    // tell whether another page exists without a separate count query.
    async function getTipsPage(pageSize, afterDoc) {
        const constraints = [orderBy("createdAt", "desc")];
        if (afterDoc) constraints.push(startAfter(afterDoc));
        constraints.push(limit(pageSize + 1));
        const q = query(collection(db, "tips"), ...constraints);
        const snap = await getDocs(q);
        const docs = snap.docs;
        const hasMore = docs.length > pageSize;
        const pageDocs = hasMore ? docs.slice(0, pageSize) : docs;
        const tips = pageDocs.map(d => ({ id: d.id, ...d.data() }));
        const lastDoc = pageDocs.length ? pageDocs[pageDocs.length - 1] : null;
        return { tips, lastDoc, hasMore };
    }
    async function getMyPrize(weekId) {
        await waitForAuthReady();
        if (!currentUser) return null;
        const ref = doc(db, "giveawayPrizes", currentUser.uid);
        const snap = await getDoc(ref);
        if (!snap.exists()) return null;
        const data = snap.data();
        return data.weekId === weekId ? data : null;
    }

    /* ======================================================
       SECRET GIVEAWAYS — admin-created, one-off, optionally password-gated,
       with independent iOS/Android winner slots (unlike the automatic
       weekly cycle above). The password (when required) never lives on the
       publicly-readable document — it's in a `private/secret` subdoc only
       admin can read directly. An entrant's guess is validated server-side
       by a rule comparing it against that private doc, so the correct
       password is never exposed by simply reading the giveaway. Likewise
       the reward description lives in `private/config`, readable only once
       you've actually entered — so nobody can see what's up for grabs
       without committing an entry first. Each winner's redemption code is
       written to its own `prizeCodes/{uid}` doc, readable only by
       that winner, so winners can never see each other's codes.
       ====================================================== */

    /* Spells out who can actually enter, so an Android player doesn't tap
       into an iOS-only giveaway (or vice versa) only to be turned away at
       the entry screen. Used in the broadcast notification and on the
       giveaway card itself. */
    function secretGiveawayEligibilityText(iosWinnerCount, androidWinnerCount, allWinnerCount) {
        if ((allWinnerCount || 0) > 0) return "🌍 Open to everyone — 🍎 iOS and 🤖 Android players are in one draw.";
        const ios = (iosWinnerCount || 0) > 0;
        const android = (androidWinnerCount || 0) > 0;
        if (ios && android) return "Open to 🍎 iOS and 🤖 Android players.";
        if (ios) return "🍎 iOS only — Android players can't enter this one.";
        if (android) return "🤖 Android only — iOS players can't enter this one.";
        return "No winner slots are open on this one.";
    }

    /* "Everyone" giveaways (allWinnerCount > 0) put iOS and Android players in
       one pool with one set of winners. Each entry still records its own
       device, so admin can see who's on what. Split giveaways keep separate
       iOS and Android pools. A "draw group" is the pool an entry is drawn in:
       "all" for an everyone giveaway, otherwise the entry's platform. */
    function isEveryoneSecretGiveaway(g) {
        return !!g && (g.allWinnerCount || 0) > 0;
    }
    function secretGiveawaySlotsFor(g, platform) {
        if (!g) return 0;
        if (isEveryoneSecretGiveaway(g)) return g.allWinnerCount;
        return (platform === "ios" ? g.iosWinnerCount : g.androidWinnerCount) || 0;
    }
    function secretDrawGroup(g, platform) {
        return isEveryoneSecretGiveaway(g) ? "all" : platform;
    }
    // Older winners have no `pool`; they were always drawn by platform.
    function secretWinnerGroup(w) {
        return w.pool || w.platform;
    }

    // A prize built in admin from parts (prize.js: { items, note } — gold,
    // diamonds, tokens, a unit, anything custom). Kept small and plain: only
    // known kinds, at most 8 items, no more than a few KB.
    const PRIZE_KINDS = ["tokens", "gold", "diamonds", "unit", "custom"];
    function checkPrizeParts(prize) {
        if (!prize) return null;
        const items = Array.isArray(prize.items) ? prize.items : [];
        if (!items.length || items.length > 8 || !items.every(i => i && PRIZE_KINDS.includes(i.kind))) throw new Error("Add at least one reward to the prize (8 at most).");
        const clean = { items: items.map(i => ({ ...i })), note: String(prize.note || "").slice(0, 200) };
        if (JSON.stringify(clean).length > 4000) throw new Error("That prize is too big — shorten the labels or picture links.");
        return clean;
    }
    const prizeTokens = (prize) => (prize && Array.isArray(prize.items) ? prize.items : [])
        .filter(i => i && i.kind === "tokens" && Number.isInteger(i.amount) && i.amount > 0).reduce((sum, i) => sum + i.amount, 0);
    // Tokens are paid by the server; everything else is delivered with a code.
    const prizeNeedsCode = (prize) => !prize || !Array.isArray(prize.items) || prize.items.some(i => i && i.kind !== "tokens");

    // The weekly giveaway's prize, as shown on the promo page — public (the
    // config collection is readable by anyone), set by admin. Until it's set
    // (or if it can't be read) it's the usual 500K gold + 500 diamonds.
    // Display only: the winner is still sent their codes the usual way.
    const DEFAULT_WEEKLY_PRIZE = { items: [{ kind: "gold", amount: 500000 }, { kind: "diamonds", amount: 500 }], note: "" };
    async function getWeeklyPrize() {
        try {
            const snap = await getDoc(doc(db, "config", "weeklyPrize"));
            const p = snap.exists() ? snap.data().prize : null;
            return p && Array.isArray(p.items) && p.items.length ? p : DEFAULT_WEEKLY_PRIZE;
        } catch (e) {
            return DEFAULT_WEEKLY_PRIZE;
        }
    }
    async function setWeeklyPrize(prize) {
        await waitForAuthReady();
        if (!currentUser || currentUser.uid !== ADMIN_UID) throw new Error("Not authorized.");
        await setDoc(doc(db, "config", "weeklyPrize"), { prize: checkPrizeParts(prize), updatedAt: Date.now() });
    }

    async function createSecretGiveaway({ title, prizeDescription, prize, requiresPassword, password, durationHours, deleteAfterDays, iosWinnerCount, androidWinnerCount, allWinnerCount }) {
        await waitForAuthReady();
        if (!currentUser || currentUser.uid !== ADMIN_UID) throw new Error("Not authorized.");

        const cleanTitle = (title || "").trim();
        const cleanPrize = (prizeDescription || "").trim();
        const prizeParts = checkPrizeParts(prize);
        const needsPassword = !!requiresPassword;
        const cleanPassword = (password || "").trim();
        const hours = parseFloat(durationHours);
        const deleteDays = parseFloat(deleteAfterDays) || 30;
        const allCount = Math.max(0, parseInt(allWinnerCount, 10) || 0);
        // An everyone giveaway has only the shared pool, never per-device slots.
        const iosCount = allCount > 0 ? 0 : Math.max(0, parseInt(iosWinnerCount, 10) || 0);
        const androidCount = allCount > 0 ? 0 : Math.max(0, parseInt(androidWinnerCount, 10) || 0);

        if (!cleanTitle) throw new Error("Give the giveaway a title.");
        if (!cleanPrize) throw new Error("Describe the prize.");
        if (needsPassword && !cleanPassword) throw new Error("Set a password, or turn off the password requirement.");
        if (!hours || hours <= 0) throw new Error("Duration must be a positive number of hours.");
        if (iosCount + androidCount + allCount <= 0) throw new Error("Set at least one winner slot.");

        const now = Date.now();
        const giveawayData = {
            title: cleanTitle,
            createdBy: currentUser.uid,
            createdAt: now,
            expiresAt: now + hours * 60 * 60 * 1000,
            deleteAt: now + deleteDays * 24 * 60 * 60 * 1000,
            requiresPassword: needsPassword,
            iosWinnerCount: iosCount,
            androidWinnerCount: androidCount,
            entryCount: 0,
            // Split per device so the card can show "8 Android · 2 iOS"
            // instead of a single combined number that tells an iOS player
            // nothing about how crowded their own side of the draw is.
            iosEntryCount: 0,
            androidEntryCount: 0,
            winners: []
        };
        // Only written when used, so split giveaways don't need the newer rules.
        if (allCount > 0) giveawayData.allWinnerCount = allCount;
        const docRef = await addDoc(collection(db, "secretGiveaways"), giveawayData);
        // The text stays too: it's what older pages (and anywhere that only
        // takes text) show.
        await setDoc(doc(db, "secretGiveaways", docRef.id, "private", "config"), {
            prizeDescription: cleanPrize,
            ...(prizeParts ? { prize: prizeParts } : {})
        });
        if (needsPassword) {
            await setDoc(doc(db, "secretGiveaways", docRef.id, "private", "secret"), {
                password: cleanPassword
            });
        }
        // Only open giveaways get announced. Broadcasting a password-protected
        // one to everybody would defeat the point of it being gated — those
        // stay for whoever you hand the password to.
        if (!needsPassword) {
            try {
                await addNotification(
                    "secretGiveawayNew",
                    "🔒 New Secret Giveaway!",
                    `${cleanTitle}\n\n${secretGiveawayEligibilityText(iosCount, androidCount, allCount)}\n🔓 No password needed — tap below to enter.`,
                    docRef.id
                );
            } catch (e) {
                // The giveaway itself already exists and is live; failing to
                // announce it shouldn't surface as "creation failed".
                console.warn("Couldn't announce secret giveaway:", e.message);
            }
        }
        return docRef.id;
    }

    async function deleteSecretGiveaway(giveawayId) {
        await waitForAuthReady();
        if (!currentUser || currentUser.uid !== ADMIN_UID) throw new Error("Not authorized.");
        // Entries are the only record of who staked what, so every stake on a
        // platform that hasn't been drawn yet is refunded FIRST. If that fails,
        // deletion stops — going ahead would destroy those tokens for good.
        // Only asked when something is actually staked, so deleting ordinary
        // giveaways never depends on the tokens API being reachable.
        const staked = await getDocs(query(collection(db, "secretGiveaways", giveawayId, "entries"), where("tokens", ">", 0)));
        if (!staked.empty) {
            await callTokensApi("refundGiveaway", { giveawayId });
        }
        try {
            const entriesSnap = await getDocs(collection(db, "secretGiveaways", giveawayId, "entries"));
            await Promise.all(entriesSnap.docs.map(d => deleteDoc(d.ref)));
        } catch (e) {
            console.warn("Couldn't clean up secret giveaway entries:", e.message);
        }
        try {
            const publicSnap = await getDocs(collection(db, "secretGiveaways", giveawayId, "publicEntries"));
            await Promise.all(publicSnap.docs.map(d => deleteDoc(d.ref)));
        } catch (e) {
            console.warn("Couldn't clean up secret giveaway public entries:", e.message);
        }
        try {
            const codesSnap = await getDocs(collection(db, "secretGiveaways", giveawayId, "prizeCodes"));
            await Promise.all(codesSnap.docs.map(d => deleteDoc(d.ref)));
        } catch (e) {
            console.warn("Couldn't clean up secret giveaway prize codes:", e.message);
        }
        try {
            await deleteDoc(doc(db, "secretGiveaways", giveawayId, "private", "config"));
        } catch (e) {
            console.warn("Couldn't clean up secret giveaway config:", e.message);
        }
        try {
            await deleteDoc(doc(db, "secretGiveaways", giveawayId, "private", "secret"));
        } catch (e) {
            console.warn("Couldn't clean up secret giveaway secret:", e.message);
        }
        await deleteDoc(doc(db, "secretGiveaways", giveawayId));
    }

    function listenToSecretGiveaways(callback, maxCount = 50, onError) {
        if (!currentUser) return signedOutFeed(callback);
        const q = query(collection(db, "secretGiveaways"), orderBy("createdAt", "desc"), limit(maxCount));
        return onSnapshot(q, (snap) => {
            const items = [];
            snap.forEach(d => items.push({ id: d.id, ...d.data() }));
            callback(items);
        }, (err) => {
            console.warn("Secret giveaways listener failed:", err.message);
            if (onError) onError(err);
        });
    }

    async function getSecretGiveaway(giveawayId) {
        await waitForAuthReady();
        if (!currentUser) return null;
        const snap = await getDoc(doc(db, "secretGiveaways", giveawayId));
        return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    }

    // Admin-only lookup so the creator can recover a password they forgot —
    // the rule on this subdoc only allows admin's own authenticated uid to
    // read it, so nobody else's client can pull it regardless of what this
    // function does.
    async function getSecretGiveawayPassword(giveawayId) {
        await waitForAuthReady();
        if (!currentUser || currentUser.uid !== ADMIN_UID) throw new Error("Not authorized.");
        const snap = await getDoc(doc(db, "secretGiveaways", giveawayId, "private", "secret"));
        return snap.exists() ? (snap.data().password || null) : null;
    }

    async function hasEnteredSecretGiveaway(giveawayId) {
        await waitForAuthReady();
        if (!currentUser) return false;
        const snap = await getDoc(doc(db, "secretGiveaways", giveawayId, "entries", currentUser.uid));
        return snap.exists();
    }

    async function getMySecretGiveawayEntry(giveawayId) {
        await waitForAuthReady();
        if (!currentUser) return null;
        const snap = await getDoc(doc(db, "secretGiveaways", giveawayId, "entries", currentUser.uid));
        return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    }

    // Lets someone who fat-fingered their platform fix it, same idea as the
    // weekly giveaway's "Switch Device" — only the `platform` field can
    // change (enforced by the rule), and only while entries are still open.
    async function switchSecretGiveawayPlatform(giveawayId, platform) {
        await waitForAuthReady();
        if (!currentUser) throw new Error("You must sign in with Google first.");
        if (platform !== "ios" && platform !== "android") throw new Error("Pick a platform (iOS or Android).");
        const giveawaySnap = await getDoc(doc(db, "secretGiveaways", giveawayId));
        if (!giveawaySnap.exists()) throw new Error("This giveaway no longer exists.");
        if (!(secretGiveawaySlotsFor(giveawaySnap.data(), platform) > 0)) {
            throw new Error(`This giveaway doesn't have any ${platform === "ios" ? "iOS" : "Android"} winner slots.`);
        }
        const entryRef = doc(db, "secretGiveaways", giveawayId, "entries", currentUser.uid);
        // Captured before the update, so the count can be moved off whichever
        // side they were on — without this the split drifts upward every time
        // somebody changes their device.
        let previousPlatform = null;
        let stakedTokens = 0;
        try {
            const entrySnap = await getDoc(entryRef);
            if (entrySnap.exists()) {
                previousPlatform = entrySnap.data().platform || null;
                stakedTokens = entrySnap.data().tokens || 0;
            }
        } catch (e) {
            console.warn("Couldn't read the previous platform:", e.message);
        }
        await updateDoc(entryRef, { platform });
        await updateDoc(doc(db, "secretGiveaways", giveawayId, "publicEntries", currentUser.uid), { platform });
        if (previousPlatform && previousPlatform !== platform) {
            try {
                await updateDoc(doc(db, "secretGiveaways", giveawayId), {
                    [previousPlatform === "ios" ? "iosEntryCount" : "androidEntryCount"]: increment(-1),
                    [platform === "ios" ? "iosEntryCount" : "androidEntryCount"]: increment(1)
                });
            } catch (e) {
                console.warn("Couldn't move the per-device entry count:", e.message);
            }
            // The stake follows the entry to its new side. Only the shown
            // per-platform average depends on this — the draw reads each
            // entry's own platform and tokens directly — so a failure here is
            // logged, not thrown, and the next stake or unstake repairs it.
            if (stakedTokens > 0) {
                callTokensApi("reconcile", { giveawayId })
                    .catch(e => console.warn("Couldn't move the stake to the new platform:", e.message));
            }
        }
    }

    // Lets someone remove their own entry — used when switching the
    // page-wide device choice to a platform this particular giveaway
    // doesn't offer at all, since there's nothing to migrate the entry to.
    async function leaveSecretGiveaway(giveawayId) {
        await waitForAuthReady();
        if (!currentUser) throw new Error("You must sign in with Google first.");
        // Read which side they were on before the entry disappears, otherwise
        // there's no way to know which per-device counter to bring down.
        let leavingPlatform = null;
        let stakedTokens = 0;
        try {
            const entrySnap = await getDoc(doc(db, "secretGiveaways", giveawayId, "entries", currentUser.uid));
            if (entrySnap.exists()) {
                leavingPlatform = entrySnap.data().platform || null;
                stakedTokens = entrySnap.data().tokens || 0;
            }
        } catch (e) {
            console.warn("Couldn't read entry platform before leaving:", e.message);
        }
        // Refund any stake through the server BEFORE the entry is touched. The
        // rules won't let a staked entry be deleted directly, so this is the
        // only way out of a staked giveaway — which is what guarantees the
        // refund can't be skipped. If the refund is refused (e.g. this side has
        // already been drawn, so the tokens are spent), leaving stops here.
        if (stakedTokens > 0) {
            await callTokensApi("unstake", { giveawayId });
        }
        // Decrement first — if this write is rejected (e.g. a stale set of
        // rules that doesn't yet allow the -1 branch), nothing else has
        // changed yet, so the entry stays fully intact instead of ending up
        // half-deleted with a stale counter that later causes a duplicate
        // entryCount bump if the user re-enters.
        await updateDoc(doc(db, "secretGiveaways", giveawayId), { entryCount: increment(-1) });
        if (leavingPlatform === "ios" || leavingPlatform === "android") {
            try {
                await updateDoc(doc(db, "secretGiveaways", giveawayId), {
                    [leavingPlatform === "ios" ? "iosEntryCount" : "androidEntryCount"]: increment(-1)
                });
            } catch (e) {
                console.warn("Couldn't lower the per-device entry count:", e.message);
            }
        }
        await deleteDoc(doc(db, "secretGiveaways", giveawayId, "entries", currentUser.uid));
        try {
            await deleteDoc(doc(db, "secretGiveaways", giveawayId, "publicEntries", currentUser.uid));
        } catch (e) {
            console.warn("Couldn't clean up public entry:", e.message);
        }
    }

    // Reveals the reward description once you've entered — gated server-side
    // by a rule that only allows reading this doc if an entries/{you} doc
    // exists (or you're admin), so the prize stays hidden from anyone who
    // hasn't actually committed to an entry.
    // The same, with the prize's parts when it was built from them:
    // { description, prize } (prize null for an older, text-only one).
    async function getSecretGiveawayPrizeInfo(giveawayId) {
        await waitForAuthReady();
        if (!currentUser) return null;
        try {
            const snap = await getDoc(doc(db, "secretGiveaways", giveawayId, "private", "config"));
            if (!snap.exists()) return null;
            const d = snap.data();
            return { description: d.prizeDescription || null, prize: d.prize || null };
        } catch (e) {
            return null;
        }
    }
    async function getSecretGiveawayRewardDescription(giveawayId) {
        await waitForAuthReady();
        if (!currentUser) return null;
        try {
            const snap = await getDoc(doc(db, "secretGiveaways", giveawayId, "private", "config"));
            return snap.exists() ? (snap.data().prizeDescription || null) : null;
        } catch (e) {
            return null;
        }
    }

    // The write only succeeds if `password` matches what's stored in the
    // giveaway's private secret doc (when required) — enforced by a
    // Firestore rule, not by this function, so a modified client can't
    // bypass the check.
    async function enterSecretGiveaway(giveawayId, platform, password) {
        await waitForAuthReady();
        if (!currentUser) throw new Error("You must sign in with Google first to enter.");
        if (platform !== "ios" && platform !== "android") throw new Error("Pick a platform (iOS or Android) to enter.");
        const profile = await getProfile();
        if (isBannedNow(profile)) {
            showRestrictedNotice(profile.banReason, profile.banUntil);
            throw new Error("__RESTRICTED__");
        }
        if (!profile.name) throw new Error("Set an in-game name in your profile before entering.");

        const giveawaySnap = await getDoc(doc(db, "secretGiveaways", giveawayId));
        if (!giveawaySnap.exists()) throw new Error("This giveaway no longer exists.");
        if (giveawaySnap.data().expiresAt <= Date.now()) throw new Error("This giveaway has ended.");
        if (!(secretGiveawaySlotsFor(giveawaySnap.data(), platform) > 0)) {
            throw new Error(`This giveaway doesn't have any ${platform === "ios" ? "iOS" : "Android"} winner slots.`);
        }

        const entryData = {
            uid: currentUser.uid,
            name: profile.name,
            avatar: profile.avatar || "",
            platform,
            enteredAt: Date.now()
        };
        if (giveawaySnap.data().requiresPassword) {
            entryData.password = (password || "").trim();
        }
        try {
            await setDoc(doc(db, "secretGiveaways", giveawayId, "entries", currentUser.uid), entryData);
        } catch (e) {
            // A rejected write here almost always means a wrong password —
            // Firestore doesn't say which condition failed, so that's the
            // one client-facing message that makes sense by default.
            throw new Error("Incorrect password, or this giveaway has ended.");
        }
        // A separate, publicly-readable copy with no password — this is what
        // lets the reveal animation cycle through real participant names
        // instead of filler placeholders. Its create rule requires the
        // private entries doc above to already exist for this uid, so it
        // can't be written on its own to fake an entry.
        await setDoc(doc(db, "secretGiveaways", giveawayId, "publicEntries", currentUser.uid), {
            uid: currentUser.uid,
            name: profile.name,
            platform
        });
        await updateDoc(doc(db, "secretGiveaways", giveawayId), { entryCount: increment(1) });
        // Separate write on purpose: if the deployed rules don't yet allow
        // these two fields, the entry above still stands and only the
        // per-device split is stale, rather than the whole entry failing.
        try {
            await updateDoc(doc(db, "secretGiveaways", giveawayId), {
                [platform === "ios" ? "iosEntryCount" : "androidEntryCount"]: increment(1)
            });
        } catch (e) {
            console.warn("Couldn't bump the per-device entry count:", e.message);
        }
    }

    // Anyone signed in can see who's competing — no password or identity
    // details beyond name/platform, unlike the private `entries` collection.
    async function getPublicSecretGiveawayEntries(giveawayId, platform = null) {
        await waitForAuthReady();
        if (!currentUser) return [];
        const snap = await getDocs(collection(db, "secretGiveaways", giveawayId, "publicEntries"));
        const items = [];
        snap.forEach(d => items.push({ id: d.id, ...d.data() }));
        return platform ? items.filter(e => e.platform === platform) : items;
    }

    async function getSecretGiveawayEntries(giveawayId, platform = null) {
        await waitForAuthReady();
        if (!currentUser || currentUser.uid !== ADMIN_UID) throw new Error("Not authorized.");
        const snap = await getDocs(collection(db, "secretGiveaways", giveawayId, "entries"));
        const items = [];
        snap.forEach(d => items.push({ id: d.id, ...d.data() }));
        return platform ? items.filter(e => e.platform === platform) : items;
    }

    // Randomly picks a winner from current entries for one draw group ("ios",
    // "android", or "all" for an everyone giveaway), excluding anyone who has
    // already won this giveaway on any platform — mirrors pickWeeklyWinner()'s
    // "pick now, persist later" shape so admin can review before committing.
    // Nothing is written yet.
    async function pickSecretGiveawayWinner(giveawayId, group) {
        await waitForAuthReady();
        if (!currentUser || currentUser.uid !== ADMIN_UID) throw new Error("Not authorized.");
        const giveawaySnap = await getDoc(doc(db, "secretGiveaways", giveawayId));
        if (!giveawaySnap.exists()) throw new Error("Giveaway not found.");
        const alreadyWon = new Set((giveawaySnap.data().winners || []).map(w => w.uid));

        const entries = await getSecretGiveawayEntries(giveawayId, group === "all" ? null : group);
        const pool = entries.filter(e => !alreadyWon.has(e.uid));
        if (!pool.length) throw new Error(`No remaining ${group === "all" ? "" : group + " "}entries to pick from.`);
        // Each entry's chance is 1 + the tokens staked on it, so everyone keeps
        // a free base chance and every token adds exactly one more.
        const weightOf = (e) => 1 + Math.max(0, Math.floor(Number(e.tokens) || 0));
        const totalWeight = pool.reduce((sum, e) => sum + weightOf(e), 0);
        let ticket = secureRandom() * totalWeight;
        let winner = pool[pool.length - 1];
        for (const e of pool) {
            ticket -= weightOf(e);
            if (ticket < 0) { winner = e; break; }
        }
        return { giveawayId, group, platform: winner.platform, entryCount: pool.length, winner, totalWeight, winnerWeight: weightOf(winner) };
    }

    // Uniform in [0, 1). Uses the browser's cryptographic source rather than
    // Math.random, since this decides who wins something people staked on.
    function secureRandom() {
        const c = globalThis.crypto;
        if (c && typeof c.getRandomValues === "function") {
            return c.getRandomValues(new Uint32Array(1))[0] / 4294967296;
        }
        return Math.random();
    }

    // Two writes (recording the winner, saving their code) can't be a single
    // atomic transaction here — the winners-array update and the prizeCodes
    // write live under different rule branches. So this is deliberately
    // idempotent instead: the code write happens FIRST, and the winners
    // array is only appended to if that person isn't already recorded on
    // it. That way, if the code write fails partway (e.g. a rules mismatch)
    // nothing else has changed and a straight retry fixes it. It also means
    // this same function doubles as "resend/fix a code" for someone already
    // marked as a winner, without hitting an "already won" dead end.
    async function finalizeSecretGiveawayPrize(giveawayId, winnerUid, winnerName, platform, prizeCode) {
        await waitForAuthReady();
        if (!currentUser || currentUser.uid !== ADMIN_UID) throw new Error("Not authorized.");
        const cfgSnap = await getDoc(doc(db, "secretGiveaways", giveawayId, "private", "config"));
        const prize = cfgSnap.exists() ? (cfgSnap.data().prize || null) : null;
        const tokens = prizeTokens(prize);
        const codes = cleanPromoCodes(prizeCode);
        if (!codes.length && prizeNeedsCode(prize)) throw new Error("Enter the prize code to send.");
        const code = codes.join(", ");

        const giveawayRef = doc(db, "secretGiveaways", giveawayId);
        const snap = await getDoc(giveawayRef);
        if (!snap.exists()) throw new Error("Giveaway not found.");
        const data = snap.data();
        const winners = data.winners || [];
        const alreadyRecorded = winners.some(w => w.uid === winnerUid);
        // `platform` is the winner's own device; which pool they were drawn
        // from depends on the giveaway (everyone giveaways share one).
        const group = secretDrawGroup(data, platform);
        if (!alreadyRecorded) {
            const slotCount = secretGiveawaySlotsFor(data, platform);
            const wonSoFar = winners.filter(w => secretWinnerGroup(w) === group).length;
            if (wonSoFar >= slotCount) throw new Error(`All ${group === "all" ? "" : platform + " "}winner slots are already filled.`);
        }

        if (codes.length) {
            await setDoc(doc(db, "secretGiveaways", giveawayId, "prizeCodes", winnerUid), {
                code,
                codes,
                platform,
                wonAt: Date.now()
            });
        }
        if (!alreadyRecorded) {
            await updateDoc(giveawayRef, {
                winners: arrayUnion({ uid: winnerUid, name: winnerName, platform, pool: group, wonAt: Date.now() })
            });
        }
        // The prize's tokens go straight into their wallet (the server checks
        // they're a recorded winner, and never pays the same win twice).
        if (tokens > 0) await callTokensApi("adminPaySecretPrize", { giveawayId, winnerUid });
        // The code is stored ON the notification, not just in prizeCodes.
        // deleteSecretGiveaway() wipes the prizeCodes subcollection, and
        // giveaways also auto-delete after their deleteAfterDays window — so a
        // winner whose only copy lived there lost it the moment the giveaway
        // went away. This subcollection is readable solely by that winner (or
        // admin), so it's no less private than prizeCodes was.
        const tokenLine = tokens > 0 ? `🪙 ${tokens} tokens have been added to your wallet.` : "";
        const codeLine = !codes.length ? ""
            : codes.length === 1 ? `Here's your prize code: "${code}". Tap to view and copy it.`
            : `Here are your ${codes.length} prize codes:\n${promoCodesText(codes)}\nTap to view and copy them.`;
        const winNotif = {
            type: "secretGiveawayWin",
            title: `🔒🎉 You won "${data.title}"!`,
            body: [tokenLine, codeLine].filter(Boolean).join("\n"),
            giveawayId,
            prize: code,
            prizes: codes,
            // what the prize was, so the inbox can show it (not just text)
            ...(prize ? { prizeItems: prize.items, prizeNote: prize.note || "", prizeTokens: tokens } : {})
        };
        try {
            // A resend must UPDATE the existing card rather than add a second
            // one — otherwise the winner ends up with two "you won" cards
            // showing different codes and no way to tell which is valid.
            const existing = await getDocs(query(
                collection(db, "users", winnerUid, "personalNotifications"),
                where("type", "==", "secretGiveawayWin"),
                where("giveawayId", "==", giveawayId),
                limit(1)
            ));
            if (!existing.empty) {
                await updateDoc(doc(db, "users", winnerUid, "personalNotifications", existing.docs[0].id), {
                    ...winNotif,
                    // Resurface it as unread, so a corrected code is actually
                    // noticed instead of silently changing a card they'd read.
                    read: false,
                    createdAt: Date.now()
                });
            } else {
                await addPersonalNotification(winnerUid, winNotif);
            }
        } catch (e) {
            console.warn("Couldn't update the win notification, sending a new one:", e.message);
            await addPersonalNotification(winnerUid, winNotif);
        }
    }

    // Admin view of what was actually sent to each winner of a giveaway.
    // Returns { [winnerUid]: code } so the admin panel can show the code
    // beside each name — otherwise there's no way to tell what someone was
    // given, or whether a resend would be sending the same code twice.
    // The per-winner read rule already allows admin, so no rules change.
    async function getSecretGiveawayPrizeCodes(giveawayId) {
        await waitForAuthReady();
        if (!currentUser || currentUser.uid !== ADMIN_UID) throw new Error("Not authorized.");
        const snap = await getDocs(collection(db, "secretGiveaways", giveawayId, "prizeCodes"));
        const byUid = {};
        snap.forEach(d => { byUid[d.id] = d.data().code || null; });
        return byUid;
    }

    // Every weekly prize ever recorded, newest first — pending AND already
    // sent. getPendingPrizes() deliberately only returns the unsent ones, so
    // this is what the admin panel needs to show past winners and the code
    // each of them got.
    async function getAllGiveawayPrizes() {
        await waitForAuthReady();
        if (!currentUser || currentUser.uid !== ADMIN_UID) throw new Error("Not authorized.");
        const snap = await getDocs(collection(db, "giveawayPrizes"));
        const items = [];
        snap.forEach(d => items.push({ uid: d.id, ...d.data() }));

        // Prizes written before winnerName/drawnAt were recorded here still have
        // both values over in giveawayWeeks, which has always stored them. One
        // extra collection read repairs the whole history on the fly, so no
        // migration is needed. The uid check matters because giveawayPrizes is
        // keyed by uid alone — if someone won twice, only their latest prize doc
        // survives, and it must not inherit a different week's winner name.
        const needsRepair = items.some(p => !p.winnerName || !p.drawnAt);
        if (needsRepair) {
            try {
                const weeksSnap = await getDocs(collection(db, "giveawayWeeks"));
                const weeks = {};
                weeksSnap.forEach(d => { weeks[d.id] = d.data(); });
                items.forEach(p => {
                    const w = weeks[p.weekId];
                    if (!w) return;
                    if (!p.winnerName && w.winnerUid === p.uid) p.winnerName = w.winnerName || null;
                    if (!p.drawnAt && w.drawnAt) p.drawnAt = w.drawnAt;
                });
            } catch (e) {
                console.warn("Couldn't backfill winner names from giveawayWeeks:", e.message);
            }
        }

        // Newest first. weekId is the tiebreaker so records with no date at all
        // still land in a sensible order instead of shuffling between loads.
        items.sort((a, b) =>
            (b.drawnAt || 0) - (a.drawnAt || 0)
            || String(b.weekId || "").localeCompare(String(a.weekId || ""))
        );
        return items;
    }

    async function getSecretGiveawayPrize(giveawayId) {
        await waitForAuthReady();
        if (!currentUser) return null;
        // The rule only lets admin or the actual winner read this doc —
        // anyone else's read is rejected, so this resolves to null instead
        // of throwing rather than making every caller handle that error.
        // Returns the list of codes (older prizes have just one, in `code`).
        try {
            const snap = await getDoc(doc(db, "secretGiveaways", giveawayId, "prizeCodes", currentUser.uid));
            if (!snap.exists()) return null;
            const d = snap.data();
            const codes = Array.isArray(d.codes) && d.codes.length ? d.codes : (d.code ? [d.code] : []);
            return codes.length ? codes : null;
        } catch (e) {
            return null;
        }
    }

    // Admin-only: sends one or more promo codes straight to a player's inbox,
    // each with its own Copy button. Every send is also logged in promoSends
    // (admin-only) so there's a record of who was sent what.
    async function sendPromoCodes(uid, codesInput, { title, message, name } = {}) {
        await waitForAuthReady();
        if (!currentUser || currentUser.uid !== ADMIN_UID) throw new Error("Not authorized.");
        if (!uid) throw new Error("Pick a player first.");
        const codes = cleanPromoCodes(codesInput);
        if (!codes.length) throw new Error("Type in at least one promo code.");
        const cleanTitle = (title || "").trim() || (codes.length === 1 ? "🎁 You've got a promo code!" : `🎁 You've got ${codes.length} promo codes!`);
        const note = (message || "").trim();
        const body = (note ? note + "\n\n" : "") + (codes.length === 1
            ? `Your promo code: "${codes[0]}". Tap to view and copy it, then redeem it in-game.`
            : `Your ${codes.length} promo codes:\n${promoCodesText(codes)}\nTap to view and copy them, then redeem each one in-game.`);
        await addPersonalNotification(uid, {
            type: "promoCodes",
            title: cleanTitle,
            body,
            prize: codes.join(", "),
            prizes: codes
        });
        try {
            await addDoc(collection(db, "promoSends"), {
                uid, name: name || "", codes, title: cleanTitle, note, sentAt: Date.now(), sentBy: currentUser.uid
            });
        } catch (e) {
            // The codes were delivered; only the record failed (e.g. rules not updated yet).
            console.warn("Sent, but couldn't log the promo send:", e.message);
        }
        return codes;
    }

    async function listPromoSends(maxCount = 20) {
        await waitForAuthReady();
        if (!currentUser || currentUser.uid !== ADMIN_UID) throw new Error("Not authorized.");
        const snap = await getDocs(query(collection(db, "promoSends"), orderBy("sentAt", "desc"), limit(maxCount)));
        const items = [];
        snap.forEach(d => items.push({ id: d.id, ...d.data() }));
        return items;
    }

    /* ---------------- NEWS (admin-posted; body is stored/rendered as raw
       HTML so you can format it and embed <img> tags — safe here because
       Firestore rules restrict writes to the admin uid only, so nobody
       else can ever inject content into this field). ---------------- */

    async function uploadNewsImage(file) {
        await waitForAuthReady();
        if (!currentUser || currentUser.uid !== ADMIN_UID) {
            throw new Error("Not authorized.");
        }
        if (!file.type.startsWith("image/")) {
            throw new Error("File must be an image.");
        }
        if (file.size > 5 * 1024 * 1024) {
            throw new Error("Image must be under 5MB.");
        }
        const path = "newsImages/" + Date.now() + "-" + file.name;
        const storageRef = ref(storage, path);
        await uploadBytes(storageRef, file);
        const imageUrl = await getDownloadURL(storageRef);
        return { imageUrl, imagePath: path };
    }

    async function addNews(title, bodyHtml, type) {
    await waitForAuthReady();
    if (!currentUser || currentUser.uid !== ADMIN_UID) {
        throw new Error("Not authorized.");
    }
    if (!title || !title.trim()) throw new Error("Title cannot be empty.");
    if (!bodyHtml || !bodyHtml.trim()) throw new Error("Body cannot be empty.");
    const docRef = await addDoc(collection(db, "news"), {
        title: title.trim(),
        bodyHtml: bodyHtml.trim(),
        type: type || "general",
        createdAt: Date.now()
    });
    return docRef.id;
}

async function updateNews(newsId, title, bodyHtml, type) {
    await waitForAuthReady();
    if (!currentUser || currentUser.uid !== ADMIN_UID) {
        throw new Error("Not authorized.");
    }
    if (!title || !title.trim()) throw new Error("Title cannot be empty.");
    if (!bodyHtml || !bodyHtml.trim()) throw new Error("Body cannot be empty.");
    await updateDoc(doc(db, "news", newsId), { title: title.trim(), bodyHtml: bodyHtml.trim(), type: type || "general" });
    return newsId;
}
    async function deleteNews(newsId) {
        await waitForAuthReady();
        if (!currentUser || currentUser.uid !== ADMIN_UID) {
            throw new Error("Not authorized.");
        }
        await deleteDoc(doc(db, "news", newsId));
    }

    async function getNewsItem(newsId) {
        const snap = await getDoc(doc(db, "news", newsId));
        return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    }

    async function getNews(maxCount = 50) {
        const q = query(collection(db, "news"), orderBy("createdAt", "desc"), limit(maxCount));
        const snap = await getDocs(q);
        const items = [];
        snap.forEach(d => items.push({ id: d.id, ...d.data() }));
        return items;
    }

    // Live feed — used by home.html so the news icon updates without a
    // page reload as soon as you post something in admin.html.
    function listenToNews(callback, maxCount = 50) {
        const q = query(collection(db, "news"), orderBy("createdAt", "desc"), limit(maxCount));
        return onSnapshot(q, (snap) => {
            const items = [];
            snap.forEach(d => items.push({ id: d.id, ...d.data() }));
            callback(items);
        });
    }

/* ---------------- SHARED ADSTERRA HELPERS ----------------
   Centralized version of what used to live locally inside index.html.
   Every page includes divs with these exact fixed IDs:
   adSlot728x90, adSlot320x50, adSlot300x250, adSlotNative — plus a
   .adsterra-slot CSS class (display:none by default, .show-me to reveal)
   — and just calls AppState.loadAdsterraAdsIfAllowed() once auth is ready
   and again on every auth change. No other page-specific setup needed. */

let adsterraSocialBarLoaded = false;
let adsterraSocialBarScriptEl = null;
let adsterraSocialBarObserver = null;
let adsterraSocialBarBodyChildren = null; // snapshot of body's direct children BEFORE the bar loads

let adsterraPopunderLoaded = false;
let adsterraPopunderScriptEl = null;
const POPUNDER_ENABLED = false; // flip to true to re-enable the popunder ad

function injectAdsterraSlot(containerId, htmlContent) {
    const container = document.getElementById(containerId);
    if (!container) return;
    // Adsterra's scripts rely on document.write internally — innerHTML
    // alone won't execute embedded <script> tags, so each one is
    // recreated manually to actually run.
    container.innerHTML = htmlContent;
    container.querySelectorAll("script").forEach(oldScript => {
        const newScript = document.createElement("script");
        [...oldScript.attributes].forEach(attr => newScript.setAttribute(attr.name, attr.value));
        newScript.text = oldScript.text;
        oldScript.parentNode.replaceChild(newScript, oldScript);
    });
}

function injectAdsterraBannerIframe(containerId, key, width, height) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const iframe = document.createElement("iframe");
    iframe.style.cssText = `width:${width}px; max-width:100%; height:${height}px; border:none; overflow:hidden; display:block;`;
    iframe.scrolling = "no";
    iframe.srcdoc = `<!DOCTYPE html><html><body style="margin:0;padding:0;">
        <script>atOptions = {'key':'${key}','format':'iframe','height':${height},'width':${width},'params':{}};<\/script>
        <script src="https://www.highperformanceformat.com/${key}/invoke.js"><\/script>
        </body></html>`;
    container.innerHTML = "";
    container.appendChild(iframe);
}

// Removes everything loadAdsterraAdsIfAllowed() ever injected — banners,
// native, popunder, AND the Social Bar (which injects itself directly into
// <body>, so we track new top-level nodes it adds and remove them explicitly).
function hideAllAdsterraAds() {
    // banners + native
    ["adSlot728x90", "adSlot320x50", "adSlot300x250", "adSlotNative"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = "";
    });
    document.querySelectorAll(".adsterra-slot").forEach(el => el.classList.remove("show-me"));

    // social bar — remove the script tag itself...
    if (adsterraSocialBarScriptEl && adsterraSocialBarScriptEl.parentNode) {
        adsterraSocialBarScriptEl.parentNode.removeChild(adsterraSocialBarScriptEl);
    }
    adsterraSocialBarScriptEl = null;

    // ...and any floating widget elements it added directly to <body>.
    if (adsterraSocialBarBodyChildren) {
        const before = adsterraSocialBarBodyChildren;
        Array.from(document.body.children).forEach(node => {
            if (!before.has(node)) node.remove();
        });
    }
    if (adsterraSocialBarObserver) {
        adsterraSocialBarObserver.disconnect();
        adsterraSocialBarObserver = null;
    }
    adsterraSocialBarLoaded = false; // allow it to reload later if the user signs out again

    // popunder
    if (adsterraPopunderScriptEl && adsterraPopunderScriptEl.parentNode) {
        adsterraPopunderScriptEl.parentNode.removeChild(adsterraPopunderScriptEl);
    }
    adsterraPopunderScriptEl = null;
    adsterraPopunderLoaded = false;
}

async function loadAdsterraAdsIfAllowed() {
    // ---- ADS DISABLED ----
    // Adsterra CPMs were effectively $0 (6000 impressions ≈ $0.01), so all
    // ad-serving is commented out site-wide. Every page still calls this
    // function (via AppState.loadAdsterraAdsIfAllowed()) but it's now a
    // no-op — nothing breaks, ads just never load. Uncomment the block
    // below to bring Adsterra back later.
    return;

    /*
    const myGeneration = adGeneration;
    const shouldShow = await shouldShowAds();
    if (myGeneration !== adGeneration) return; // stale — a newer auth change has since superseded this check

    if (!shouldShow) {
        // If the popunder (or social bar) already executed once, it may have
        // armed a click/tap listener directly on the page that lives on
        // independently of the <script> tag — removing the tag via
        // hideAllAdsterraAds() does NOT unregister that listener. The only
        // way to guarantee a newly-VIP user never sees a stray popunder is a
        // full reload, which wipes all JS state and starts clean knowing
        // they're VIP from the very first paint.
        const hadArmedAds = adsterraPopunderLoaded || adsterraSocialBarLoaded;
        hideAllAdsterraAds();
        if (hadArmedAds) {
            window.location.reload();
            return;
        }
        return;
    }

    injectAdsterraBannerIframe("adSlot728x90", "c02e32dd0c0dfb9dbd1cf836031e1471", 728, 90);
    injectAdsterraBannerIframe("adSlot320x50", "1a13d2820b1d0ab72678a82cc1afed71", 320, 50);
    injectAdsterraBannerIframe("adSlot300x250", "970e4e741b46aa292eb4fdf1cadd1b59", 300, 250);

    injectAdsterraSlot("adSlotNative", `
        <script async="async" data-cfasync="false" src="https://pl30540489.effectivecpmnetwork.com/ae4d5bd6f1b544b5d1778ee33ba910a9/invoke.js"><\/script>
        <div id="container-ae4d5bd6f1b544b5d1778ee33ba910a9"></div>
    `);

    if (!adsterraSocialBarLoaded) {
        adsterraSocialBarLoaded = true;
        adsterraSocialBarBodyChildren = new Set(document.body.children);
        adsterraSocialBarScriptEl = document.createElement("script");
        adsterraSocialBarScriptEl.src = "https://pl30540490.effectivecpmnetwork.com/0d/11/ae/0d11ae3b80eee08c395da0d0d0375b83.js";
        document.body.appendChild(adsterraSocialBarScriptEl);
    }

    if (!POPUNDER_ENABLED) {
        console.log("[KIH ads] popunder skipped: disabled via POPUNDER_ENABLED flag");
    } else {
        const POPUNDER_MIN_INTERVAL_MS = 60 * 1000; // 1 minute
        const lastPopunderAt = parseInt(localStorage.getItem("kih_last_popunder_at") || "0", 10);
        const now = Date.now();

        if (!adsterraPopunderLoaded && (now - lastPopunderAt) >= POPUNDER_MIN_INTERVAL_MS) {
            adsterraPopunderLoaded = true;
            localStorage.setItem("kih_last_popunder_at", String(now));
            adsterraPopunderScriptEl = document.createElement("script");
            adsterraPopunderScriptEl.src = "https://pl30553113.effectivecpmnetwork.com/cc/72/0f/cc720f28e916390a79e4dc545a9f04f7.js";
            document.body.appendChild(adsterraPopunderScriptEl);
            console.log("[KIH ads] popunder injected at", new Date(now).toLocaleTimeString());
        } else if (!shouldShow) {
            console.log("[KIH ads] popunder skipped: ads disabled for this user (VIP/noAds active)");
        } else if (adsterraPopunderLoaded) {
            console.log("[KIH ads] popunder skipped: already loaded this page view");
        } else {
            console.log("[KIH ads] popunder skipped: cooldown active, retry in", Math.ceil((POPUNDER_MIN_INTERVAL_MS - (now - lastPopunderAt)) / 1000), "s");
        }
    }

    document.querySelectorAll(".adsterra-slot").forEach(el => el.classList.add("show-me"));
    */
}
// Rate-limited single-slot ad refresh — called from page-specific code on
// search/select/slider interactions (e.g. troopsandheroes.html's
// updateTroopsCard()). Unlike loadAdsterraAdsIfAllowed(), this only ever
// touches ONE container id and won't reload more than once per
// AD_REFRESH_MIN_INTERVAL_MS for that slot, so rapid typing/slider drags
// don't spam a fresh ad request on every keystroke.
const AD_REFRESH_MIN_INTERVAL_MS = 60 * 1000; // 1 minute per slot
const lastAdRefreshAt = {}; // containerId -> timestamp of last actual reload

async function maybeRefreshAd(containerId) {
    // ---- ADS DISABLED ---- (see loadAdsterraAdsIfAllowed above)
    return;

    /*
    const container = document.getElementById(containerId);
    if (!container) return;

    // Snapshot the generation before the async Firestore read. If a newer
    // auth change happens while shouldShowAds() is still in flight (e.g.
    // rapid sign-in/sign-out, or overlapping calls from the 25s interval
    // and onAuthChange firing close together), this call's result is now
    // stale — apply it anyway and you can undo a more recent, correct
    // show/hide with an outdated one.
    const myGeneration = adGeneration;
    const shouldShow = await shouldShowAds();
    if (myGeneration !== adGeneration) return;

    if (!shouldShow) {
        container.innerHTML = "";
        container.style.display = "none";
        return;
    }

    const now = Date.now();
    if (lastAdRefreshAt[containerId] && now - lastAdRefreshAt[containerId] < AD_REFRESH_MIN_INTERVAL_MS) {
        container.style.display = "flex";
        return;
    }
    lastAdRefreshAt[containerId] = now;

    injectAdsterraBannerIframe(containerId, "970e4e741b46aa292eb4fdf1cadd1b59", 300, 250);
    container.style.display = "flex";
    */
}

    return {
        // auth
        signIn, signOut: signOutUser, getCurrentUser, onAuthChange, waitForAuthReady, getIdToken,
        getTodaysQuests, listenToMyWallet, listenToMyQuestProgress, claimQuestRewards, submitDailyPuzzle, gamesRunStart, gamesRunAnswer, gamesLeaderboard, gamesPing, getMyTokenBalance,
        listenToMyGiftClaims, claimTokenGift, adminTokens,
        reportQuestProgress, startDailyQuestTracking, stakeTokensOnSecretGiveaway, setSecretGiveawayStake, refreshSecretGiveawayMaxStake,
        // profile
        getProfile, setProfile, isVipActive, isNoAdsActive, isBannedNow, shouldShowAds, listenToMyProfile,
        // unique names
        claimUsername, findUserByName, findUserByEmail, getUserProfileForAdmin, backfillUsernameReservations,
        backfillPublicProfileNameLower, backfillAvatarCasing,
        // inbox
        getInbox, addInboxMessage, markAllRead, unreadCount,
        // giveaway
        getWeekId, hasJoinedGiveaway, getMyGiveawayEntry, joinGiveaway, getGiveawayEntries,
        getPublicGiveawayEntries, getWeekWinner, getGiveawayHistory, getSimulatedNow, isGiveawayOpen,
        // admin
        isAdmin, pickWeeklyWinner, finalizeGiveawayPrize, getMyPrize,
        getMissedGiveawayWeeks, autoPickMissedWinners, getPendingPrizes, sendPendingPrize,
        getAllGiveawayPrizes, getSecretGiveawayPrizeCodes,
        // secret giveaways (admin-created, optionally password-gated, multi-winner)
        createSecretGiveaway, getSecretGiveawayPrizeInfo, getWeeklyPrize, setWeeklyPrize, uploadPrizeImage, deleteSecretGiveaway, listenToSecretGiveaways, getSecretGiveaway,
        getSecretGiveawayPassword, hasEnteredSecretGiveaway, getMySecretGiveawayEntry, switchSecretGiveawayPlatform,
        leaveSecretGiveaway, enterSecretGiveaway, getSecretGiveawayEntries, getPublicSecretGiveawayEntries,
        secretGiveawayEligibilityText, isEveryoneSecretGiveaway, secretGiveawaySlotsFor, secretDrawGroup, secretWinnerGroup,
        pickSecretGiveawayWinner, finalizeSecretGiveawayPrize, getSecretGiveawayPrize, getSecretGiveawayRewardDescription,
        // promo codes
        addPromoCode, getPromoCodes, updatePromoCode, deletePromoCode,
        // tips
        addTip, getTips, getTipsPage, getTip, uploadTipImage, deleteTip, updateTip, TIP_TAGS,
        // news
        addNews, getNews, getNewsItem, updateNews, deleteNews, uploadNewsImage, listenToNews,
        // notifications
        addNotification, deleteNotificationsBySource, listenToNotifications,
        addAnnouncement, getAnnouncements, updateAnnouncement, deleteAnnouncement,
        // clan recruitment posts
        postClanRecruitMessage, updateClanPost, listenToClanPosts, deleteClanPost, getClanPostCooldownRemaining,
        // getPostCooldownMs, NORMAL_POST_COOLDOWN_MS, VIP_POST_COOLDOWN_MS — commented out with the VIP
        // cooldown split above. CLAN_POST_LIFETIME_MS is unrelated to VIP, so it stays exported.
        CLAN_POST_LIFETIME_MS, uploadClanIcon, deleteClanIconSafe,
        // formation sharing
        postFormation, updateFormation, listenToFormations, deleteFormation, sweepExpiredFormations,
        addFormationComment, updateFormationComment, listenToFormationComments, deleteFormationComment,
        toggleFormationLike, likeFormation, hasLikedFormation,
        // tier lists
        TIER_KEYS, postTierList, updateTierList, listenToTierLists, deleteTierList,
        voteOnTierList, getMyTierListVote,
        addTierListComment, updateTierListComment, listenToTierListComments, deleteTierListComment,
        uploadFormationImage, deleteFormationImageSafe, FORMATION_CATEGORIES, FORMATION_POST_LIFETIME_MS,
        // friends
        sendFriendRequest, respondToFriendRequest, listenToIncomingFriendRequests, listenToFriends,
        listenToFriendsWithDmMeta, listenToPublicProfilesPresence,
        unfriend, friendshipId, getPublicProfile,
        searchUsersByName, getSuggestedFriends, touchLastActive,
        // personal notifications (NEW)
        addPersonalNotification, listenToPersonalNotifications, markPersonalNotificationRead, sendAdminMessage, sendPromoCodes, listPromoSends, cleanPromoCodes,
        // DMs
        getOrCreateDmThread, sendDmMessage, editDmMessage, listenToDmMessages, listenToMyDmThreads, deleteDmMessagesOnly,
        markDmThreadRead, listenToUnreadDmCount,
        // blocking
        blockUser, unblockUser, amIBlockedBy, haveIBlocked,
        // reports
        submitReport, uploadReportEvidence,
        // admin: bans + history
        getNameHistory, getReports, closeReport, banUser, unbanUser, getBannedUsers,
        adminGrantVip, adminRevokeVip,
        // ban gate
        showRestrictedNotice,
        // ads
        loadAdsterraAdsIfAllowed, hideAllAdsterraAds, maybeRefreshAd,
        // maintenance mode (new)
        getMaintenanceStatus, setMaintenanceMode,
        _firebase: { app, auth, db }

    };
})();

window.AppState = AppState;
