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
    getDocs,
    onSnapshot,
    Timestamp,
    documentId,
    increment
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
const db = getFirestore(app);
const storage = getStorage(app);
const googleProvider = new GoogleAuthProvider();

const ADMIN_UID = "Ts92RY0ipMYDRJa2s5toQfDYxtp1"; // your uid — only this account can use admin.html

const AppState = (function () {
    const KEYS = {
        inbox: "kih_inbox",
        localProfile: "kih_local_profile"
    };

    let currentUser = null;
    let authReadyResolve;
    const authReady = new Promise(resolve => { authReadyResolve = resolve; });

    onAuthStateChanged(auth, (user) => {
        currentUser = user || null;
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

    async function signIn() {
        const result = await signInWithPopup(auth, googleProvider);
        return result.user;
    }

    async function signOutUser() {
        await firebaseSignOut(auth);
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
            banned: false,
            banUntil: 0,
            banReason: "",
            bannedAt: 0,
            // --- new: bio + presence ---
            bio: "",
            lastActiveAt: 0,
            favoriteTroop: "",
            favoriteHero: "",
            highestTrophies: 0,
            currentClan: "",
            currentLevel: 0,
            currentPower: 0

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
            const fresh = {
                ...defaultProfile(),
                name: currentUser.displayName || "",
                email: currentUser.email ? currentUser.email.toLowerCase() : "",
                avatar: currentUser.photoURL || defaultProfile().avatar
            };
            await setDoc(ref, fresh);
            await mirrorPublicProfile(fresh);
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
                avatar: profile.avatar || "",
                bio: profile.bio || "",
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

    // Returns null if not currently banned/timed-out, otherwise the ban info.
    async function getBanStatus() {
        const profile = await getProfile();
        if (!isBannedNow(profile)) return null;
        return {
            permanent: !profile.banUntil,
            until: profile.banUntil || null,
            reason: profile.banReason || ""
        };
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

    // Call this once per page, after waitForAuthReady(). Pass the id of your
    // page's main content container and your contact email for appeals.
    // Returns { permanent } — if permanent is true, the caller should stop
    // initializing the rest of the page (the container has already been
    // replaced with the "banned" screen).
    async function applyBanGate({ appRootId = "app", mailto = "you@example.com" } = {}) {
        await waitForAuthReady();
        if (!currentUser) return { permanent: false };

        const status = await getBanStatus();
        if (!status) return { permanent: false };

        const root = document.getElementById(appRootId) || document.body;

        if (status.permanent) {
            root.innerHTML = `
            <div style="max-width:500px;margin:60px auto;text-align:center;padding:0 20px;">
                <h2>🚫 You have been banned</h2>
                <p class="promo-sub">${status.reason ? escapeGateHtml(status.reason) : "Your account has been permanently banned from Keazyea's Intelligence Hub."}</p>
                <a href="mailto:${mailto}?subject=Ban%20Appeal" class="btn-primary"
                   style="display:inline-block;margin-top:20px;padding:14px 32px;text-decoration:none;">
                   I think this is unfair — Email an appeal
                </a>
            </div>`;
            return { permanent: true };
        }

        // Timeout: page loads normally, just disable messaging/posting controls
        // and show a banner. Any element with data-requires-not-banned gets disabled.
        const untilStr = new Date(status.until).toLocaleString();
        document.querySelectorAll("[data-requires-not-banned]").forEach(el => {
            el.disabled = true;
            el.title = "You're timed out until " + untilStr;
        });

        const banner = document.createElement("div");
        banner.style.cssText = "background:#aa7a1e;color:white;padding:12px 16px;border-radius:8px;margin-bottom:16px;text-align:center;";
        banner.innerHTML = `⏱️ You're temporarily restricted from posting/messaging until <strong>${untilStr}</strong>.
            ${status.reason ? "Reason: " + escapeGateHtml(status.reason) + ". " : ""}
            If you feel this is unfair, <a href="mailto:keazyea@gmail.com?subject=Timeout%20Appeal" style="color:white;text-decoration:underline;">click here to appeal</a>.`;
        root.prepend(banner);

        return { permanent: false };
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

    /* ======================================================
       NEW IN STAGE 3 — CLAN RECRUITMENT POSTS
       ====================================================== */

    const NORMAL_POST_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
    const VIP_POST_COOLDOWN_MS = 24 * 60 * 60 * 1000;
    const CLAN_POST_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000; // posts auto-expire after ~1 month

    function getPostCooldownMs(profile) {
        return isVipActive(profile) ? VIP_POST_COOLDOWN_MS : NORMAL_POST_COOLDOWN_MS;
    }

    // Returns 0 if the user can post right now, otherwise ms remaining.
    async function getClanPostCooldownRemaining() {
        const profile = await getProfile();
        if (!profile.lastClanPostAt) return 0;
        const remaining = profile.lastClanPostAt + getPostCooldownMs(profile) - Date.now();
        return remaining > 0 ? remaining : 0;
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
        const description = (data.description || "").trim();
        const tags = Array.isArray(data.tags) ? data.tags : [];
        const iconUrl = data.iconUrl || null;
        const iconPath = data.iconPath || null;

        if (!clanName) throw new Error("Clan name is required.");
        if (!server) throw new Error("Please select a server.");
        if (description.length > 500) throw new Error("Description must be 500 characters or fewer.");
        const profile = await getProfile();
        if (isBannedNow(profile)) {
            showRestrictedNotice(profile.banReason, profile.banUntil);
            throw new Error("__RESTRICTED__");
        }
        if (!profile.name) throw new Error("Set an in-game name in your profile before posting.");

        const remaining = await getClanPostCooldownRemaining();
        if (remaining > 0) {
            const days = Math.ceil(remaining / (24 * 60 * 60 * 1000));
            throw new Error(`You can post again in about ${days} day(s).`);
        }

        // One post per user: docId is the poster's own uid, so reposting
        // overwrites their previous clan post instead of leaving old copies
        // sitting in the feed.
        const postId = currentUser.uid;
        await setDoc(doc(db, "clanPosts", postId), {
            uid: currentUser.uid,
            name: profile.name,
            avatar: profile.avatar || "",
            clanName,
            server,
            minTrophies,
            description,
            tags,
            iconUrl,
            iconPath,
            createdAt: Date.now(),
            // A Firestore TTL policy (set up in the console, not in rules)
            // watches this field and auto-deletes the doc once it's past.
            expiresAt: Timestamp.fromMillis(Date.now() + CLAN_POST_LIFETIME_MS)
        });

        await setProfile({ lastClanPostAt: Date.now() });
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
        const description = (data.description || "").trim();
        const tags = Array.isArray(data.tags) ? data.tags : [];

        if (!clanName) throw new Error("Clan name is required.");
        if (!server) throw new Error("Please select a server.");
        if (description.length > 500) throw new Error("Description must be 500 characters or fewer.");

        const ref = doc(db, "clanPosts", postId);
        const snap = await getDoc(ref);
        if (!snap.exists()) throw new Error("Post not found.");

        const patch = { clanName, server, minTrophies, description, tags };
        if (data.iconUrl) {
            patch.iconUrl = data.iconUrl;
            patch.iconPath = data.iconPath || null;
        }
        await updateDoc(ref, patch);
        return postId;
    }

    function listenToClanPosts(callback, maxCount = 100) {
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
    async function respondToFriendRequest(reqId, accept) {
        await waitForAuthReady();
        if (!currentUser) throw new Error("Not signed in.");
        const ref = doc(db, "friendRequests", reqId);
        if (accept) {
            const reqSnap = await getDoc(ref);
            const reqData = reqSnap.exists() ? reqSnap.data() : null;
            const profile = await getProfile();
            await updateDoc(ref, {
                status: "accepted",
                toAvatar: profile.avatar || "",
                toName: profile.name || "Commander"
            });

            // Notify the original sender so they see it in their own inbox,
            // even if they're not on the Social page right now.
            if (reqData && reqData.fromUid) {
                try {
                    await addPersonalNotification(reqData.fromUid, {
                        type: "friendAccepted",
                        title: `🎉 ${profile.name || "Commander"} accepted your friend request!`,
                        body: "You're now friends — tap below to start chatting.",
                        fromUid: currentUser.uid,
                        fromName: profile.name || "Commander",
                        fromAvatar: profile.avatar || ""
                    });
                } catch (e) {
                    console.warn("Couldn't notify friend request sender:", e.message);
                }
            }
        } else {
            await updateDoc(ref, { status: "declined" });
        }
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

    // Live requests I SENT that have just become accepted — used to notify
    // the sender so they can jump straight into a chat.
    function listenToAcceptedSentRequests(callback) {
        const q = query(
            collection(db, "friendRequests"),
            where("fromUid", "==", currentUser.uid),
            where("status", "==", "accepted")
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
        const q = query(
            collection(db, "usernames"),
            where(documentId(), ">=", prefix),
            where(documentId(), "<=", prefix + "\uf8ff"),
            limit(maxCount)
        );
        const snap = await getDocs(q);
        const results = [];
        snap.forEach(d => {
            if (d.data().uid !== currentUser.uid) results.push(d.data());
        });
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
                throw new Error("__BLOCKED_BY_ME__");
            }
        }

        await addDoc(collection(db, "dmThreads", threadId, "messages"), {
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

    async function deleteDmThread(threadId) {
        await waitForAuthReady();
        if (!currentUser) throw new Error("Not signed in.");
        const messagesSnap = await getDocs(collection(db, "dmThreads", threadId, "messages"));
        const deletions = [];
        messagesSnap.forEach(d => deletions.push(deleteDoc(doc(db, "dmThreads", threadId, "messages", d.id))));
        await Promise.all(deletions);
        await deleteDoc(doc(db, "dmThreads", threadId));
    }

    // Like deleteDmThread, but keeps the thread doc alive so the DM modal's
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
    }

    async function unbanUser(uid) {
        await waitForAuthReady();
        if (!currentUser || currentUser.uid !== ADMIN_UID) throw new Error("Not authorized.");
        const ref = doc(db, "users", uid);
        const snap = await getDoc(ref);
        const current = snap.exists() ? snap.data() : defaultProfile();
        await setDoc(ref, { ...defaultProfile(), ...current, banned: false, banUntil: 0, banReason: "", bannedAt: 0 });
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
            banner.style.cssText = "background:#aa7a1e;color:white;padding:12px 16px;border-radius:8px;margin:12px;text-align:center;";
            document.body.prepend(banner);
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

    async function finalizeGiveawayPrize(weekId, winner, prizeCode) {
    await waitForAuthReady();
    if (!currentUser || currentUser.uid !== ADMIN_UID) {
        throw new Error("Not authorized.");
    }
    if (!prizeCode || !prizeCode.trim()) {
        throw new Error("Prize code cannot be empty.");
    }

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
        prize: prizeCode.trim(),
        device: winner.device
    });

    // NEW: land the win in their inbox immediately — doesn't depend on
    // them ever opening the wheel that week.
    try {
        await addPersonalNotification(winner.uid, {
            type: "giveawayWin",
            title: "🎁 You won the VIP Giveaway!",
            body: `Congrats — you won "${prizeCode.trim()}" playing on ${winner.device === "ios" ? "iOS" : "Android"}. Redeem it in-game.`,
            weekId: weekId,
            prize: prizeCode.trim(),
            device: winner.device
        });
    } catch (e) {
        console.warn("Couldn't send giveaway win notification:", e.message);
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
    async function getNotifications(maxCount = 50) {
        const q = query(collection(db, "notifications"), orderBy("createdAt", "desc"), limit(maxCount));
        const snap = await getDocs(q);
        const items = [];
        snap.forEach(d => items.push({ id: d.id, ...d.data() }));
        return items;
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

    async function addTip(title, body, imageUrls, imagePaths) {
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
    async function updateTip(tipId, title, body, imageUrls, imagePaths) {
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
            body: body.trim()
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
    async function getMyPrize(weekId) {
        await waitForAuthReady();
        if (!currentUser) return null;
        const ref = doc(db, "giveawayPrizes", currentUser.uid);
        const snap = await getDoc(ref);
        if (!snap.exists()) return null;
        const data = snap.data();
        return data.weekId === weekId ? data : null;
    }

    return {
        // auth
        signIn, signOut: signOutUser, getCurrentUser, onAuthChange, waitForAuthReady, getIdToken,
        // profile
        getProfile, setProfile, isVipActive, isNoAdsActive, isBannedNow, shouldShowAds,
        // unique names
        claimUsername, findUserByName, findUserByEmail, getUserProfileForAdmin, backfillUsernameReservations,
        // inbox
        getInbox, addInboxMessage, markAllRead, unreadCount,
        // giveaway
        getWeekId, hasJoinedGiveaway, getMyGiveawayEntry, joinGiveaway, getGiveawayEntries,
        getPublicGiveawayEntries, getWeekWinner, getGiveawayHistory, getSimulatedNow, isGiveawayOpen,
        // admin
        // promo codes
        addPromoCode, getPromoCodes, deletePromoCode,
        // tips
        addTip, getTips, getTip, uploadTipImage, deleteTip, updateTip,
        // notifications
        addNotification, getNotifications, deleteNotificationsBySource, listenToNotifications,
        isAdmin, pickWeeklyWinner, finalizeGiveawayPrize, getMyPrize,
        // clan recruitment posts
        postClanRecruitMessage, updateClanPost, listenToClanPosts, deleteClanPost, getClanPostCooldownRemaining,
        getPostCooldownMs, NORMAL_POST_COOLDOWN_MS, VIP_POST_COOLDOWN_MS, CLAN_POST_LIFETIME_MS, uploadClanIcon, deleteClanIconSafe,
        // friends
        sendFriendRequest, respondToFriendRequest, listenToIncomingFriendRequests, listenToFriends,
        listenToFriendsWithDmMeta, listenToPublicProfilesPresence,
        listenToAcceptedSentRequests, unfriend, friendshipId, getPublicProfile,
        searchUsersByName, getSuggestedFriends, touchLastActive,
        // personal notifications (NEW)
        addPersonalNotification, listenToPersonalNotifications, markPersonalNotificationRead, sendAdminMessage,
        // DMs
        getOrCreateDmThread, sendDmMessage, editDmMessage, listenToDmMessages, listenToMyDmThreads, deleteDmThread, deleteDmMessagesOnly,
        markDmThreadRead, listenToUnreadDmCount,
        // blocking
        blockUser, unblockUser, amIBlockedBy, haveIBlocked,
        // reports
        submitReport, uploadReportEvidence,
        // admin: bans + history
        getNameHistory, getReports, closeReport, banUser, unbanUser, getBannedUsers,
        // ban gate (new)
        getBanStatus, applyBanGate, showRestrictedNotice,
        _firebase: { app, auth, db }

    };
})();

window.AppState = AppState;
