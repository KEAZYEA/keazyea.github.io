/* 🧭 The KIH Guide (help-guide.js): questions people actually ask land on
   the right answer (typos and other wordings included), nonsense gets "not
   sure" instead of a guess, and every "Take me there" / "Show me" points at
   something that really exists in the app.
   Run:  npm test */
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const H = require("../help-guide.js");
const G = require("../games-core.js");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const INDEX = read("index.html");

describe("the topics", () => {
    test("each has an id, a title, words to match and an answer; ids are unique", () => {
        const ids = new Set();
        for (const t of H.TOPICS) {
            assert.ok(t.id && t.title && Array.isArray(t.k) && t.k.length && t.a, JSON.stringify(t));
            assert.ok(!ids.has(t.id), "duplicate id " + t.id);
            ids.add(t.id);
            assert.ok(!/<script|on\w+=|javascript:/i.test(t.a), `${t.id}: answers are text with a little formatting only`);
        }
        H.STARTERS.forEach(id => assert.ok(H.byId(id), "starter " + id));
    });
    test("every 'Take me there' goes somewhere that exists", () => {
        for (const t of H.TOPICS) {
            const to = t.go;
            if (!to) { assert.ok(t.small, `${t.id} has nowhere to go`); continue; }
            if (to.call) {
                assert.ok(H.CALLS.includes(to.call), `${t.id}: ${to.call}`);
                assert.match(INDEX, new RegExp(`(window\\.${to.call}\\s*=|function ${to.call}\\s*\\()`), `${t.id}: index.html defines ${to.call}`);
            } else if (to.click) {
                assert.match(to.click, /^#[A-Za-z]+$/);
                assert.ok(INDEX.includes(`id="${to.click.slice(1)}"`), `${t.id}: ${to.click} is on the page`);
            } else {
                assert.ok(H.PAGES.includes(to.page), `${t.id}: page ${to.page}`);
                if (to.page !== "home") assert.ok(INDEX.includes(`id="page-${to.page}"`), `${t.id}: index.html has page-${to.page}`);
                if (to.tab) assert.ok((H.TABS[to.page] || []).includes(to.tab), `${t.id}: ${to.page} tab ${to.tab}`);
                if (to.at) assert.ok(to.page === "store" && H.STORE_AT.includes(to.at), `${t.id}: store at ${to.at}`);
            }
        }
    });
    test("the tabs it can open are the sections' real tabs", () => {
        H.TABS.profile.forEach(t => assert.ok(INDEX.includes(`switchProfileTab('${t}')`), "profile tab " + t));
        const social = read("social.html");
        H.TABS.social.forEach(t => assert.ok(social.includes(`switchSocialTab('${t}')`), "social tab " + t));
        assert.match(social, /const SOCIAL_TAB_KEY = "kih_social_tab"/, "the key help-guide.js sets so Social opens on the tab");
        assert.deepEqual([...H.TABS.games].sort(), [...G.GAMES, "today", "ranks"].sort());
        const games = read("games.html");
        assert.match(games, /params\.get\("game"\)/, "games.html?game= opens a tab");
        const promo = read("promo.html");
        H.TABS.promo.forEach(t => assert.ok(promo.includes(`switchPromoTab('${t}')`), "promo tab " + t));
        const troops = read("troopsandheroes.html");
        H.TABS.troops.forEach(t => assert.ok(troops.includes(`switchTab('${t}')`) && troops.includes(`get("tab") === "${t}"`), "troops tab " + t));
        const store = read("store.html");
        H.STORE_AT.forEach(a => assert.ok(store.includes(`id="${a}"`) && store.includes(`"#${a}"`), "store part " + a));
        ["goToPage", "goHome", "openPromoTab", "setSectionFrameUrl", "switchProfileTab"].forEach(fn =>
            assert.match(INDEX, new RegExp(`(function ${fn}\\s*\\(|window\\.${fn}\\s*=\\s*function)`), `index.html has ${fn}()`));
    });
    test("every 'Show me' points at a button that's on Home", () => {
        for (const t of H.TOPICS) {
            if (!t.show) continue;
            const sel = t.show;
            let found;
            if (/^#\w+$/.test(sel)) found = INDEX.includes(`id="${sel.slice(1)}"`);
            else if (/^\.[\w-]+$/.test(sel)) found = new RegExp(`class="[^"]*\\b${sel.slice(1)}\\b`).test(INDEX);
            else {
                const m = /^\.([\w-]+)\[(\w+)=['"](.+)['"]\]$/.exec(sel);
                assert.ok(m, `${t.id}: selector ${sel}`);
                const [, cls, attr, val] = m;
                found = new RegExp(`class="${cls}"[^>]*${attr}="${val.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`).test(INDEX);
            }
            assert.ok(found, `${t.id}: ${sel} is on Home`);
        }
    });
});

describe("questions people ask", () => {
    const Q = {
        profile: ["where is my profile", "profile", "how do i see my profile?", "where's my account"],
        editProfile: ["how do i change my name", "change my pfp", "where can I edit my bio", "update my trophies", "chnage my name", "how to rename myself", "change avatar", "change my clan"],
        achievements: ["where are my achievements", "acheivements", "badges"],
        items: ["where are my items", "my backpack"],
        style: ["how do i change my avatar border", "name effects", "chat bubble colour", "how do i make my name glow"],
        quests: ["daily quests", "where do I claim my login reward", "missions"],
        earnTokens: ["how do i earn tokens", "how to get coins", "free tokens?"],
        store: ["buy tokens", "where is the shop", "how do I subscribe", "remove ads", "how do i turn off ads"],
        chest: ["open a chest", "adventurer's chest"],
        event: ["is there an event", "halloween event"],
        codes: ["promo codes", "where are the codes", "redeem code"],
        weeklyGiveaway: ["spin the wheel", "weekly giveaway"],
        secretGiveaway: ["secret giveaway"],
        games: ["games", "i want to play a game"],
        puzzle: ["today's puzzle", "daily puzzle"],
        leaderboard: ["leaderboard", "weekly prizes", "rankings"],
        memory: ["memory game", "card matching game"],
        unitle: ["unitle"], hilo: ["higher or lower"], trivia: ["trivia quiz"], hangman: ["hangman"], blur: ["blur game"],
        social: ["social", "where is the community"],
        worldChat: ["world chat", "where is global chat", "chat with everyone", "can i talk to other players", "how to delete my message"],
        lore: ["lore", "where can i write fan fiction", "fanfic", "post my lore theory", "i want to write a story", "where are the stories"],
        friends: ["my friends", "where are my messages", "dm a friend"],
        addFriend: ["how do i add a friend", "add friends"],
        friendRequests: ["friend requests", "who added me", "accept friend requests"],
        clan: ["clan recruitment", "find a clan"],
        formation: ["formations", "share my lineup"],
        tierList: ["tier list", "best units", "who is the best hero"],
        reportPlayer: ["report a player", "someone is spamming", "how do i block someone"],
        troops: ["unit stats", "compare heroes", "where can i see troop stats"],
        bosses: ["boss calculator", "where are the bosses", "balthazar abilities", "how strong is the kraken at level 50", "ashira spiders", "glorious hunt boss"],
        tips: ["team comps", "strategy tips"],
        inbox: ["inbox", "where are my notifications", "did i get a gift"],
        news: ["news", "polls"],
        settings: ["settings"],
        signIn: ["how do i log in", "sign out", "login with google"],
        bug: ["report a bug", "something is broken", "the app is not working", "my tokens disappeared"],
        privacy: ["privacy policy"],
        about: ["who made this app", "contact the creator", "discord"],
        share: ["share the app", "invite friends"],
        home: ["go home", "main menu"],
        hello: ["hi", "hello there"], thanks: ["thanks!"], help: ["help", "what can you do"]
    };
    for (const [id, qs] of Object.entries(Q)) {
        for (const q of qs) {
            test(`"${q}" → ${id}`, () => {
                const r = H.ask(q);
                assert.equal(r.topic && r.topic.id, id, `got ${r.topic && r.topic.id} (${JSON.stringify(H.scores(q).slice(0, 3))})`);
            });
        }
    }
    test("every topic is reachable by at least one question above (or is small talk)", () => {
        const covered = new Set(Object.keys(Q));
        H.TOPICS.forEach(t => assert.ok(covered.has(t.id), "no question tests " + t.id));
    });
    test("nonsense gets 'not sure' — never a guess", () => {
        for (const q of ["asdfgh", "what's the weather in paris", "qwerty uiop", "where is it", "", "???", "banana"]) {
            assert.equal(H.ask(q).topic, null, q);
        }
    });
    test("a typo one letter off still matches; two off doesn't", () => {
        assert.ok(H.close("acheivement", "achievement"));
        assert.ok(H.close("chnage", "change"));
        assert.ok(H.close("leaderbord", "leaderboard"));
        assert.ok(!H.close("chat", "cat"), "short words must match exactly");
        assert.ok(!H.close("profle", "pro"), "length");
        assert.ok(!H.close("abcdefg", "abxdeyg"));
    });
    test("small talk inside a real question doesn't hide the answer", () => {
        assert.equal(H.ask("hi where are my achievements please").topic.id, "achievements");
        assert.equal(H.ask("thanks, now how do i earn tokens").topic.id, "earnTokens");
    });
});
