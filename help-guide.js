/* help-guide.js — 🧭 the KIH Guide: "where is my profile?" → an answer, and
   a button that takes you there (or points at the button on Home).

   No AI service: every answer is written here, from the app's own wording,
   so it's instant, free, works signed out and can't make things up. A
   question is matched to a topic by its words — typos and other ways of
   saying it included ("pfp", "chnage my name") — and when nothing fits, the
   guide says so and offers topics instead of guessing.

   Shared by the page (window.HelpGuide, which also draws the guide) and the
   tests (require). A topic's `go` is data, not code: the page turns it into
   a move (goToPage, a tab inside a section, a button) — tests/help-guide.test.js
   checks every one points at something that exists. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.HelpGuide = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    /* ---------------- topics ----------------
       k: words and phrases that point to it (the more of them a question has,
          the better the match; a phrase counts more than a word; a word
          ending in "!" is a name that can only mean this topic, and counts more)
       a: the answer (written here, so it may hold a little HTML)
       go: where "Take me there" goes — { page, tab } / { page: "store", at } /
           { call } / { click }; none = an answer only. Social's World Chat
           opens on the chat, or on 📜 Lore with lore: true
       show: what "Show me" points at on Home (a selector) */
    const TOPICS = [
        // ----- you -----
        { id: "profile", broad: true, title: "🏅 Your profile", k: ["profile", "my profile", "my account", "account page", "my card", "my stats", "me page"],
            a: "Your profile is the <b>🏅 Profile</b> button on Home — or tap <b>your picture</b> at the top left. It has your card, achievements, items and styles, and where you edit your details.",
            go: { page: "profile", tab: "edit" }, show: ".home-menu-btn[onclick=\"goToPage('profile')\"]" },
        { id: "editProfile", title: "✏️ Change your name or picture", k: ["change name", "edit name", "rename", "username", "name", "nickname", "change picture", "avatar", "pfp", "profile picture", "photo", "bio", "edit profile", "trophies", "power", "clan name", "level", "server", "game stats", "change clan", "my clan name", "update profile"],
            a: "Open <b>Profile → ✏️ Profile</b>. Change your in-game name, picture, bio, server, level, trophies, power and clan there, then tap <b>Save profile</b>.",
            go: { page: "profile", tab: "edit" } },
        { id: "achievements", title: "🏅 Achievements & badges", k: ["achievement", "achievements", "badge", "badges", "trophy case", "milestone", "rewards for playing"],
            a: "<b>Profile → 🏅 Achievements</b> shows what you've unlocked and what's next. Badges you've earned can be shown on your card.",
            go: { page: "profile", tab: "ach" } },
        { id: "items", title: "🎒 Your items", k: ["item", "items", "bag", "backpack", "inventory", "bonus", "bonuses", "perk", "perks"],
            a: "<b>Profile → 🎒 Items</b> lists the items you've got and the bonuses they give you — they're always on and add up.",
            go: { page: "profile", tab: "items" } },
        { id: "style", title: "🎨 Styles (borders, name effects, chat bubbles)", k: ["style", "styles", "border", "avatar border", "frame", "name effect", "name colour", "name color", "glow", "name glow", "glowing name", "make name glow", "chat bubble", "bubble", "background", "profile background", "emote", "emotes", "cosmetic", "cosmetics"],
            a: "<b>Profile → 🎨 Style</b>: pick your avatar border, name effect, chat bubble and profile background. Everyone sees them — on your profile, posts, chat and the Games leaderboard. Faded ones aren't yours yet; tap ⓘ to see how to get them.",
            go: { page: "profile", tab: "style" } },

        // ----- tokens, quests, store -----
        { id: "quests", title: "⚔️ Daily quests", k: ["quest", "quests", "daily quest", "daily quests", "mission", "missions", "task", "tasks", "daily login", "login reward", "check in", "streak", "sunday chest", "claim"],
            a: "Daily quests are the <b>📅 calendar icon</b> at the top of Home. Log in every day for <b>1 🪙</b>; quests are worth <b>4 🪙</b> a day — finish one, then tap <b>Claim</b>. Logging in Monday–Saturday unlocks Sunday's chest.",
            go: { page: "quests" }, show: ".icon-btn[title='Daily Quests']" },
        { id: "earnTokens", title: "🪙 How to earn tokens", k: ["token", "tokens", "coin", "coins", "earn tokens", "get tokens", "free tokens", "earn", "how to earn", "more tokens", "money"],
            a: "Free ways to earn 🪙: log in every day (<b>1 🪙</b>, plus Sunday's chest), do the <b>daily quests</b> (<b>4 🪙</b> a day), and finish <b>🎲 Today's Puzzle</b> in Games (<b>1 🪙</b>). The weekly Games leaderboard pays the top 5 too. You can also buy token packs in the Store.",
            go: { page: "quests" }, show: ".icon-btn[title='Daily Quests']" },
        { id: "store", title: "🛒 Store (token packs & supporter plans)", k: ["store", "shop", "buy", "purchase", "pay", "paypal", "token pack", "token packs", "buy tokens", "supporter", "subscription", "subscribe", "monthly plan", "vip", "premium", "no ads", "remove ads", "turn off ads", "ads", "donate"],
            a: "The <b>🛒 Store</b> has token packs and monthly Supporter plans (80 or 180 🪙 a month). Tap <b>+</b> next to your tokens on Home to get there too.",
            go: { page: "store" }, show: ".home-menu-btn[onclick=\"goToPage('store')\"]" },
        { id: "chest", title: "🧰 Adventurer's Chest", k: ["chest", "adventurer chest", "adventurers chest", "loot", "loot box", "open chest", "random item", "seasonal"],
            a: "The <b>🧰 Adventurer's Chest</b> is in the Store — open it for a random item or style.",
            go: { page: "store", at: "chest" } },
        { id: "event", title: "🎉 Events", k: ["event", "events", "limited time", "halloween", "christmas", "festival"],
            a: "When there's an event on, it has its own part in the <b>🛒 Store</b>.",
            go: { page: "store", at: "event" } },

        // ----- promo -----
        { id: "codes", title: "🎁 Promo codes", k: ["promo", "promo code", "promo codes", "code", "codes", "redeem", "gift code", "coupon", "voucher", "new codes", "latest codes"],
            a: "The newest Kingdom Clash codes are in <b>🎁 Promo Codes → Latest Codes</b>.",
            go: { page: "promo", tab: "codes" }, show: ".home-menu-btn[onclick=\"openPromoTab('codes')\"]" },
        { id: "weeklyGiveaway", title: "🎡 Weekly giveaway", k: ["giveaway", "weekly giveaway", "wheel", "spin", "spin the wheel", "win", "winner", "prize", "raffle", "lucky draw", "draw"],
            a: "<b>Promo Codes → Weekly Giveaway</b>: free to enter, with a new winner every Sunday.",
            go: { page: "promo", tab: "vip" } },
        { id: "secretGiveaway", title: "🎁 Secret giveaways", k: ["secret giveaway", "secret giveaways", "secret", "extra chances", "drop tokens", "enter tokens"],
            a: "<b>Promo Codes → 🎁 Secret Giveaways</b>: free to enter, and every token you drop in is one more chance on top of your free one. Tokens are used up when the winners are drawn, win or lose — they come back if you take them out before.",
            go: { page: "promo", tab: "secret" } },

        // ----- games -----
        { id: "games", broad: true, title: "🎮 Games", k: ["game", "games", "play", "minigame", "mini game", "fun", "bored"],
            a: "<b>🎮 Games</b> on Home: Today's Puzzle, Unitle, Higher or Lower, Trivia, Hangman, Blur and Memory — with a weekly leaderboard.",
            go: { page: "games", tab: "today" }, show: ".home-menu-btn[onclick=\"goToPage('games')\"]" },
        { id: "puzzle", title: "🎲 Today's Puzzle", k: ["today puzzle", "todays puzzle", "daily puzzle", "puzzle", "roulette", "daily game"],
            a: "<b>Games → 🎲 Today's Puzzle</b>: one game a day, the same for everyone. Finish it for <b>+1 🪙</b>, however you score — and that game counts double on the leaderboard that day.",
            go: { page: "games", tab: "today" } },
        { id: "leaderboard", title: "🏆 Games leaderboard", k: ["leaderboard", "ranks", "rank", "ranking", "top players", "weekly prize", "prizes", "high score", "record", "points"],
            a: "<b>Games → 🏆 Ranks</b>. Your best run this week in each game counts (up to 20 points, double on its puzzle day). The week ends Sunday midnight (Singapore time); the top 5 win <b>30 / 20 / 15 / 10 / 10 🪙</b>.",
            go: { page: "games", tab: "ranks" } },
        { id: "memory", title: "🃏 Memory", k: ["memory", "memory game", "card", "cards", "matching", "match cards", "flip", "pairs"], a: "<b>Games → 🃏 Memory</b>: flip two cards at a time and find every pair before the clock runs out. Each level adds 4 more cards and more time.", go: { page: "games", tab: "memory" } },
        { id: "unitle", title: "🎯 Unitle", k: ["unitle", "wordle", "mystery unit", "guess the unit"], a: "<b>Games → 🎯 Unitle</b>: find the mystery troop or hero — each guess shows what matches.", go: { page: "games", tab: "unitle" } },
        { id: "hilo", title: "⬆️ Higher or Lower", k: ["higher or lower", "hilo", "hi lo", "higher lower", "which has more"], a: "<b>Games → ⬆️ Hi-Lo</b>: pick which unit has more of a stat — keep going until you miss.", go: { page: "games", tab: "hilo" } },
        { id: "trivia", title: "🧠 Trivia", k: ["trivia", "quiz", "questions", "test my knowledge"], a: "<b>Games → 🧠 Trivia</b>: questions about troops and heroes — how many can you get in a row?", go: { page: "games", tab: "trivia" } },
        { id: "hangman", title: "🪢 Hangman", k: ["hangman", "letters", "guess letters", "spell"], a: "<b>Games → 🪢 Hangman</b>: guess a unit's name a letter at a time — 6 misses and you're out.", go: { page: "games", tab: "guess" } },
        { id: "blur", title: "🔍 Blur", k: ["blur", "blurry", "blur game", "zoom", "close up", "guess the picture"], a: "<b>Games → 🔍 Blur</b>: name the troop or hero from a blurry close-up.", go: { page: "games", tab: "blur" } },

        // ----- social -----
        { id: "social", broad: true, title: "👥 Social", k: ["social", "community", "people", "players", "chat"],
            a: "<b>👥 Social</b> on Home: World Chat, Friends and messages, Clan recruitment, Formations and Tier lists.",
            go: { page: "social" }, show: ".home-menu-btn[onclick=\"goToPage('social')\"]" },
        { id: "worldChat", title: "🌍 World Chat", k: ["world chat", "global chat", "public chat", "chat with everyone", "chatroom", "chat room", "world", "talk", "talk to players", "talk to people", "delete message", "delete my message", "translate", "reply", "react"],
            a: "<b>Social → 🌍 World Chat</b> — one chat for everyone. Tap a message for Reply, React, Copy, Translate or Report — and Delete on your own messages.",
            go: { page: "social", tab: "world" } },
        { id: "lore", title: "📜 Lore & fan fiction", k: ["lore!", "fan fiction!", "fanfiction!", "fanfic!", "fan fic!", "lore theory", "lore theories", "theory", "theories", "story", "stories", "write a story", "my story", "backstory", "write"],
            a: "<b>Social → 🌍 World Chat → 📜 Lore</b> — fan fiction and lore theories. Tap <b>✍️ Write</b> for a title, your story (up to 20,000 characters) and a cover picture if you like. Tap a story to read it, ❤️ like it and comment.",
            go: { page: "social", tab: "world", lore: true } },
        { id: "music", title: "🎵 Music & sound", k: ["music!", "sound", "sounds", "sound effects", "song", "background music", "mute", "unmute", "volume", "too loud", "turn off music", "turn off the music", "stop the music", "quiet", "noise", "ding", "buzz"],
            a: "Tap <b>🎵</b> at the top of Home (or any page): turn the <b>music</b> or the <b>🔔 game sounds</b> off, or slide the <b>volume</b>. It's also in <b>⚙️ Settings</b>. Your choices are remembered.",
            go: { page: "settings" }, show: "#musicBtnHome" },
        { id: "friends", title: "💬 Friends & messages", k: ["friends", "friend list", "my friends", "message", "messages", "dm", "dms", "private message", "inbox chat", "direct message", "talk to friend"],
            a: "<b>Social → Friends</b>: your friends and your private chats with them, plus suggested friends.",
            go: { page: "social", tab: "friends" } },
        { id: "addFriend", title: "➕ Add a friend", k: ["add friend", "add friends", "friend request", "send friend request", "follow", "make friends", "find player", "search player"],
            a: "Tap someone's <b>picture or name</b> — in World Chat, a post or Suggested Friends — then <b>➕ Add Friend</b>. Requests sent to you are under the <b>👥 icon</b> at the top of Home.",
            go: { page: "social", tab: "friends" }, show: "#friendReqBtnHome" },
        { id: "friendRequests", title: "👥 Friend requests", k: ["friend requests", "requests", "pending", "accept friend", "who added me", "accept"],
            a: "Friend requests sent to you are under the <b>👥 icon</b> at the top of Home — accept or decline them there.",
            go: { click: "#friendReqBtnHome" }, show: "#friendReqBtnHome" },
        { id: "clan", title: "🏰 Clan recruitment", k: ["clan", "clans", "recruit", "recruitment", "join clan", "find clan", "guild", "team up"],
            a: "<b>Social → Clan</b>: clan recruitment posts — post yours or find one to join.",
            go: { page: "social", tab: "clan" } },
        { id: "formation", title: "⚔️ Formations", k: ["formation", "formations", "lineup", "line up", "setup", "build", "deck", "team setup", "share lineup", "share formation", "post formation"],
            a: "<b>Social → Formation</b>: players share their formations — browse them or post your own.",
            go: { page: "social", tab: "formation" } },
        { id: "tierList", title: "📊 Tier lists", k: ["tier list", "tier lists", "tierlist", "tier", "best units", "best unit", "best hero", "best troop", "best", "strongest", "meta", "ranking units"],
            a: "<b>Social → Tier List</b>: tier lists made by players — rank the units yourself or see others'.",
            go: { page: "social", tab: "tierlist" } },
        { id: "reportPlayer", title: "🚩 Report a player or message", k: ["report player", "report message", "report someone", "report user", "abuse", "harass", "harassment", "spam", "spamming", "spammer", "scam", "scammer", "rude", "block", "toxic"],
            a: "In World Chat, tap the message → <b>🚩 Report</b>. Posts have a 🚩 Report link, and in a private chat it's in the chat's menu. You can add screenshots.",
            go: { page: "social", tab: "world" } },

        // ----- info -----
        { id: "troops", title: "⚔️ Troops & Heroes", k: ["troops", "troop", "heroes", "hero", "units", "unit", "stats", "unit stats", "compare", "comparison", "damage", "hp", "abilities", "ability", "talent", "talents", "upgrade"],
            a: "<b>⚔️ Troops & Heroes</b> on Home: every unit's stats, abilities and talents — search one, or compare units side by side.",
            go: { page: "troops" }, show: ".home-menu-btn[onclick=\"goToPage('troops')\"]" },
        { id: "bosses", title: "🐉 Boss calculator", k: ["boss", "bosses", "boss calculator", "boss level", "boss stats", "boss abilities", "boss damage", "glorious hunt", "hunt",
                "balthazar!", "ashira!", "dagon!", "kalidor!", "goltharax!", "shai khold", "khold!", "fire dragon", "spider queen", "kraken!", "ancient kraken", "ice snake", "gold keeper", "lord of the dunes", "dragon boss", "spiders"],
            a: "<b>Troops & Heroes → 🐉 Bosses</b>: pick a boss, set its level, and see the game's own numbers — every attack's damage, its spiders and guardians, and the damage it takes to reach that level.",
            go: { page: "troops", tab: "bosses" } },
        { id: "tips", title: "💡 Tips & strategy", k: ["tips", "tip", "guide", "strategy", "team comp", "team comps", "comps", "how to win", "advice", "beginner", "event strategy"],
            a: "<b>💡 Tips</b> on Home: team comps, talents and event strategy.",
            go: { page: "tips" }, show: ".home-menu-btn[onclick=\"openTipsFresh()\"]" },
        { id: "inbox", title: "📬 Inbox", k: ["inbox", "mail", "mailbox", "notification", "notifications", "gift", "gifts", "reply to my report", "messages from admin"],
            a: "Your <b>📬 Inbox</b> is the mailbox icon at the top of Home: notifications, gifts, prizes and replies to your bug reports.",
            go: { page: "inbox" }, show: ".icon-btn[title='Inbox']" },
        { id: "news", title: "📰 News & rumours", k: ["news", "rumour", "rumours", "rumor", "rumors", "app update", "new update", "latest update", "announcement", "announcements", "patch", "poll", "polls", "whats new"],
            a: "<b>📰 News & Rumours</b> is the newspaper icon at the top of Home: the latest news, rumours and polls.",
            go: { click: "#newsBtnHome" }, show: "#newsBtnHome" },
        { id: "settings", title: "⚙️ Settings", k: ["settings", "setting", "options", "preferences", "config", "gear"],
            a: "<b>⚙️ Settings</b> is the gear at the top right of Home: your Google account, bug reports, and the privacy policy and terms.",
            go: { page: "settings" }, show: ".icon-btn[title='Settings']" },
        { id: "signIn", title: "🔑 Sign in / sign out", k: ["sign in", "signin", "log in", "login", "sign up", "signup", "register", "sign out", "signout", "log out", "logout", "google", "google account", "save progress", "create account"],
            a: "<b>⚙️ Settings → Google Account</b>: sign in with Google to save your progress and earn tokens (or sign out there).",
            go: { page: "settings" }, show: ".icon-btn[title='Settings']" },
        { id: "bug", title: "🐞 Report a bug", k: ["bug", "bugs", "report bug", "report a bug", "broken", "not working", "doesnt work", "glitch", "error", "crash", "problem", "issue", "feedback", "suggestion", "disappeared", "missing", "lost", "wrong", "tokens disappeared", "missing tokens", "lost tokens", "didnt get"],
            a: "Tap <b>🐞 Found a bug? Report it</b> on Home (also in Settings). Say what went wrong and add up to 5 screenshots — the reply comes to your Inbox.",
            go: { call: "openBugReport" }, show: "#bugHomeBtn" },
        { id: "privacy", title: "🔒 Privacy & terms", k: ["privacy", "privacy policy", "terms", "terms of service", "data", "my data", "rules", "tos"],
            a: "The <b>Privacy Policy</b> and <b>Terms of Service</b> are in <b>⚙️ Settings</b>.",
            go: { page: "settings" } },
        { id: "about", title: "👋 About the creator", k: ["about", "creator", "who made", "who made this", "developer", "dev", "owner", "contact", "email", "discord", "youtube", "keazyea", "join clan of creator"],
            a: "<b>About the Creator</b> is at the bottom of Home: who made the app, how to get in touch (email, Discord, YouTube) and the creator's clan.",
            go: { page: "about" }, show: ".about-creator-link" },
        { id: "share", title: "📣 Share the app", k: ["share", "invite", "invite friends", "send link", "tell friends", "link"],
            a: "Tap <b>📣 Share KIH with friends</b> on Home to copy or send a link.",
            go: { call: "openShareSite" }, show: ".share-site-btn" },
        { id: "home", title: "🏠 Home", k: ["home", "home page", "main page", "main menu", "menu", "start", "go back", "back"],
            a: "The <b>🏠 Home</b> button at the top left of any page brings you back here.",
            go: { page: "home" } },

        // ----- small talk -----
        { id: "hello", title: "👋 Hi", k: ["hi", "hello", "hey", "yo", "good morning", "good evening", "sup"], small: true,
            a: "Hi! 👋 Ask me where anything is — like <i>\"where are my achievements?\"</i> or <i>\"how do I earn tokens?\"</i>" },
        { id: "thanks", title: "🙏 Thanks", k: ["thanks", "thank you", "thx", "ty", "great", "nice", "cool", "ok", "okay"], small: true,
            a: "Anytime! Ask me something else whenever you like. 🙂" },
        { id: "help", title: "🧭 What can you do?", k: ["help", "what can you do", "how does this work", "what is this", "what is this app", "guide me", "how to use"], small: true,
            a: "I can find anything in the app for you. Ask things like <i>\"where is World Chat?\"</i>, <i>\"how do I change my name?\"</i> or <i>\"where are the promo codes?\"</i> — then tap <b>▶ Take me there</b>. To ask me again from any page, tap <b>🧭</b> at the top." }
    ];

    // Asked often — shown as chips when the guide opens and after "I'm not sure".
    const STARTERS = ["profile", "earnTokens", "codes", "worldChat", "games", "bug"];

    /* ---------------- matching ---------------- */
    // Words that say nothing about WHERE ("where is the … button").
    const STOP = new Set("a an the is are am was be to of in on at for and or my me i im you your it its this that these those where wheres how do does did can could would should will what whats which who why when there here go get got see find show take open want need please pls plz page section screen button tab app thing place".split(" "));
    const norm = (s) => String(s || "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
    // crude stemming, the same for a question and a keyword: plurals first
    // ("trophies", "matches", "updates", "rankings"), then "-ing"
    function stem(w) {
        if (w.length > 4 && w.endsWith("ies")) w = w.slice(0, -3) + "y";
        else if (w.length > 4 && /(ch|sh|x|ss|z)es$/.test(w)) w = w.slice(0, -2);
        else if (w.length > 3 && w.endsWith("s") && !/(ss|us)$/.test(w)) w = w.slice(0, -1);
        if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
        return w;
    }
    function close(a, b) { // one letter off (typo), for longer words only
        if (a === b) return true;
        if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false;
        let i = 0, j = 0, edits = 0;
        while (i < a.length && j < b.length) {
            if (a[i] === b[j]) { i++; j++; continue; }
            if (++edits > 1) return false;
            if (a.length > b.length) i++;
            else if (b.length > a.length) j++;
            else if (a[i + 1] === b[j] && a[i] === b[j + 1]) { i += 2; j += 2; } // swapped letters
            else { i++; j++; }
        }
        return edits + (a.length - i) + (b.length - j) <= 1;
    }
    const words = (s) => norm(s).split(" ").filter(Boolean);
    // Prepared once: each keyword's words, stemmed — and without the little
    // words, so "add a friend" matches "add friend". A keyword that is ONLY
    // little words ("what can you do") is matched whole instead.
    // (A keyword that comes out the same as another of the topic's counts once.)
    const PREPARED = TOPICS.map(t => {
        const seen = new Set(), keys = [];
        for (const k0 of t.k) {
            const strong = k0.endsWith("!"), k = strong ? k0.slice(0, -1) : k0;
            const all = words(k).map(stem), main = all.filter(w => !STOP.has(w));
            const key = main.length ? { words: main } : { words: all, whole: true };
            if (strong) key.strong = true;
            const sig = (key.whole ? "=" : "") + key.words.join(" ");
            if (!seen.has(sig)) { seen.add(sig); keys.push(key); }
        }
        return { t, keys };
    });
    const has = (text, ws) => text.includes(" " + ws.join(" ") + " ");

    // How well a question fits each topic: [{ id, score }] best first. A
    // phrase scores more than a word; a word one typo off scores a little
    // less. On a tie, a specific topic beats a broad one ("blur game": Blur).
    function scores(question) {
        const all = words(question).map(stem);
        const meaningful = all.filter(w => !STOP.has(w));
        const allText = " " + all.join(" ") + " ", text = " " + meaningful.join(" ") + " ";
        return PREPARED.map(({ t, keys }) => {
            let score = 0;
            for (const kw of keys) {
                if (kw.whole) { if (has(allText, kw.words)) score += 2 * kw.words.length + 1; }
                else if (kw.words.length > 1) { if (has(text, kw.words)) score += 2 * kw.words.length + 1; }
                else if (meaningful.includes(kw.words[0])) score += kw.strong ? 3 : 2;
                else if (meaningful.some(w => close(w, kw.words[0]))) score += kw.strong ? 2.5 : 1.5;
            }
            // small talk only wins when the whole question is small talk
            if (t.small && meaningful.length > 3) score = Math.min(score, 1);
            return { id: t.id, score, broad: !!t.broad };
        }).filter(s => s.score > 0).sort((a, b) => b.score - a.score || a.broad - b.broad).map(({ id, score }) => ({ id, score }));
    }
    const MIN_SCORE = 1.5; // one keyword, even with a typo
    // { topic, also } — topic: the answer (null: not sure), also: other close fits
    function ask(question) {
        const ranked = scores(question);
        const best = ranked[0];
        if (!best || best.score < MIN_SCORE) return { topic: null, also: ranked.slice(0, 3).map(r => byId(r.id)) };
        const also = ranked.slice(1).filter(r => r.score >= MIN_SCORE && r.score >= best.score - 1).slice(0, 2).map(r => byId(r.id));
        return { topic: byId(best.id), also };
    }
    const byId = (id) => TOPICS.find(t => t.id === id) || null;

    /* ---------------- where "Take me there" can go ----------------
       (checked by the tests against index.html and the sections) */
    const PAGES = ["home", "troops", "promo", "tips", "games", "social", "store", "quests", "about", "settings", "profile", "inbox"];
    const TABS = {
        profile: ["edit", "ach", "items", "style"],
        social: ["world", "friends", "clan", "formation", "tierlist"],
        games: ["today", "ranks", "trivia", "guess", "unitle", "hilo", "blur", "memory"],
        promo: ["codes", "vip", "secret"],
        troops: ["bosses"]
    };
    const STORE_AT = ["chest", "event"];
    const CALLS = ["openBugReport", "openShareSite"];

    return { TOPICS, STARTERS, PAGES, TABS, STORE_AT, CALLS, ask, scores, norm, stem, close, byId };
});

/* ================================================================
   The guide on the page (browser only): the 🧭 button on Home, the chat
   sheet, and the moves behind "Take me there" / "Show me".
   ================================================================ */
(function () {
    if (typeof window === "undefined" || typeof document === "undefined" || !window.HelpGuide) return;
    const G = window.HelpGuide;
    const $ = (id) => document.getElementById(id);

    // A function a section's page defines, once that page has loaded.
    function callInSection(page, fn, ...args) {
        const t0 = Date.now();
        (function tryIt() {
            const frame = document.querySelector(`#page-${page} iframe`);
            let w = null;
            try { w = frame && frame.contentWindow; } catch (e) { }
            if (w && typeof w[fn] === "function" && w.document && w.document.readyState !== "loading") { try { w[fn](...args); } catch (e) { } return; }
            if (Date.now() - t0 < 12000) setTimeout(tryIt, 150);
        })();
    }
    // "Take me there"
    function go(to) {
        if (!to) return;
        if (to.call) {
            const f = { openBugReport: () => window.openBugReport(), openShareSite: () => window.openShareSite() }[to.call];
            if (f) f();
            return;
        }
        if (to.click) { const el = document.querySelector(to.click); if (el) el.click(); return; }
        const page = to.page;
        if (page === "home") { window.goHome(); return; }
        if (page === "promo") { window.openPromoTab(to.tab || "codes"); return; }
        if (page === "store" && to.at) {
            const frame = document.querySelector("#page-store iframe");
            if (frame) window.setSectionFrameUrl(frame, "store.html#" + to.at);
            window.goToPage("store");
            return;
        }
        if (page === "social" && to.tab) {
            try { // a Social that hasn't loaded yet opens on it
                localStorage.setItem("kih_social_tab", to.tab);
                if (to.tab === "world") localStorage.setItem("kih_world_channel", to.lore ? "lore" : "general");
            } catch (e) { }
            Promise.resolve(window.goToPage("social")).then(() => {
                callInSection("social", "switchSocialTab", to.tab);
                if (to.tab === "world") callInSection("social", "setLoreOpen", !!to.lore); // World Chat: the chat, or 📜 Lore
            });
            return;
        }
        if (page === "games" && to.tab) {
            const frame = document.querySelector("#page-games iframe");
            let w = null;
            try { w = frame && frame.getAttribute("src") && frame.contentWindow; } catch (e) { }
            // Games already open: coming back to it sends it "gamesReturn" (back to
            // Today's Puzzle); a message sent after that one arrives after it.
            if (w && typeof w.switchTab === "function") {
                Promise.resolve(window.goToPage("games")).then(() => w.postMessage({ kih: "gamesOpen", tab: to.tab }, window.location.origin));
                return;
            }
            if (frame) window.setSectionFrameUrl(frame, "games.html?game=" + encodeURIComponent(to.tab));
            window.goToPage("games");
            return;
        }
        if (page === "troops" && to.tab) {
            const frame = document.querySelector("#page-troops iframe");
            let w = null;
            try { w = frame && frame.getAttribute("src") && frame.contentWindow; } catch (e) { }
            if (w && typeof w.switchTab === "function") { Promise.resolve(window.goToPage("troops")).then(() => w.switchTab(to.tab)); return; }
            if (frame) window.setSectionFrameUrl(frame, "troopsandheroes.html?tab=" + encodeURIComponent(to.tab));
            window.goToPage("troops");
            return;
        }
        Promise.resolve(window.goToPage(page)).then(() => {
            if (page === "profile" && to.tab && typeof window.switchProfileTab === "function") window.switchProfileTab(to.tab);
        });
    }
    // A button glows for a few seconds. Glowing it again restarts that —
    // the earlier glow's timer is cancelled, or it would cut the new one short.
    const glowTimers = new WeakMap();
    function glow(el) {
        clearTimeout(glowTimers.get(el));
        el.classList.remove("kih-guide-spot");
        void el.offsetWidth;
        el.classList.add("kih-guide-spot");
        glowTimers.set(el, setTimeout(() => el.classList.remove("kih-guide-spot"), 4200));
    }
    // "Show me": back to Home, the button glows for a few seconds
    function show(selector) {
        const finish = () => {
            const el = document.querySelector(selector);
            if (!el) return;
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            glow(el);
        };
        const onHome = $("homeLanding") && !$("homeLanding").classList.contains("hidden");
        if (onHome) finish(); else { Promise.resolve(window.goHome()).then(() => setTimeout(finish, 350)); }
    }

    /* After "Take me there": the 🧭 on the page's top bar glows — that's the way
       back to the guide (with the conversation still there). The first few
       times a bubble says so too. */
    const TIP_KEY = "kih_guide_tips_seen";
    let tipTimer = null, pointTimer = null;
    function pointBack() {
        clearTimeout(pointTimer);
        pointTimer = setTimeout(() => {
            const btn = $("guideTopBtn"), bar = $("pageTopbar");
            if (!btn || !bar || getComputedStyle(bar).display === "none" || (sheet && sheet.classList.contains("open"))) return;
            glow(btn);
            let seen = 0;
            try { seen = parseInt(localStorage.getItem(TIP_KEY) || "0", 10) || 0; localStorage.setItem(TIP_KEY, String(seen + 1)); } catch (e) { }
            if (seen >= 3) return;
            const r = btn.getBoundingClientRect();
            const old = $("kihGuideTip");
            if (old) old.remove();
            clearTimeout(tipTimer);
            const tip = el("div", "kih-guide-tip", "Tap 🧭 to ask me something else");
            tip.id = "kihGuideTip";
            document.body.appendChild(tip);
            const left = Math.max(8, Math.min(r.left + r.width / 2 - 24, window.innerWidth - tip.offsetWidth - 8));
            tip.style.left = left + "px";
            tip.style.top = (r.bottom + 10) + "px";
            tip.style.setProperty("--tip-x", Math.round(r.left + r.width / 2 - left - 6) + "px");
            tipTimer = setTimeout(() => tip.remove(), 4000);
        }, 700);
    }

    /* ---------------- the sheet ---------------- */
    function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
    let sheet = null, log = null, input = null;
    function build() {
        sheet = el("div", "kih-guide-overlay");
        sheet.id = "kihGuide";
        sheet.setAttribute("role", "dialog");
        sheet.setAttribute("aria-modal", "true");
        sheet.setAttribute("aria-label", "KIH Guide");
        sheet.innerHTML = `<div class="kih-guide-sheet">
            <div class="kih-guide-head"><span class="kih-guide-title">🧭 KIH Guide<small>Ask where anything is</small></span><button type="button" class="kih-guide-x" aria-label="Close">✕</button></div>
            <div class="kih-guide-log" id="kihGuideLog" aria-live="polite"></div>
            <form class="kih-guide-ask" id="kihGuideForm" autocomplete="off">
                <input type="text" id="kihGuideInput" maxlength="160" placeholder="e.g. where is my profile?" enterkeyhint="send" aria-label="Your question">
                <button type="submit" aria-label="Ask">➤</button>
            </form></div>`;
        document.body.appendChild(sheet);
        log = $("kihGuideLog");
        input = $("kihGuideInput");
        sheet.querySelector(".kih-guide-x").onclick = () => closeGuide();
        sheet.addEventListener("click", (e) => { if (e.target === sheet) closeGuide(); });
        $("kihGuideForm").addEventListener("submit", (e) => {
            e.preventDefault();
            const q = input.value.trim();
            if (!q) return;
            input.value = "";
            answer(q);
        });
        document.addEventListener("keydown", (e) => { if (e.key === "Escape" && sheet.classList.contains("open")) closeGuide(); });
        botSay(null, "Hi! I'm the KIH Guide. 🧭 Ask me where anything is, or tap one of these:", G.STARTERS.map(G.byId));
    }
    function scrollDown() { log.scrollTop = log.scrollHeight; }
    function youSay(text) { log.appendChild(el("div", "kg-msg kg-you", text)); scrollDown(); }
    // A reply: the topic's answer and its buttons, or a line of text; chips = topics to tap
    function botSay(topic, line, chips) {
        const m = el("div", "kg-msg kg-bot");
        if (topic) {
            const body = el("div", "kg-text");
            body.innerHTML = topic.a; // written in help-guide.js, never from what was typed
            m.appendChild(body);
            const acts = el("div", "kg-acts");
            if (topic.go) {
                const b = el("button", "kg-go", "▶ Take me there");
                b.type = "button";
                b.onclick = () => { closeGuide(true); go(topic.go); pointBack(); };
                acts.appendChild(b);
            }
            if (topic.show) {
                const b = el("button", "kg-show", "👆 Show me");
                b.type = "button";
                b.onclick = () => { closeGuide(true); show(topic.show); };
                acts.appendChild(b);
            }
            if (acts.childNodes.length) m.appendChild(acts);
        } else {
            m.appendChild(el("div", "kg-text", line));
        }
        if (chips && chips.length) {
            const row = el("div", "kg-chips");
            chips.filter(Boolean).forEach(t => {
                const c = el("button", "kg-chip", t.title);
                c.type = "button";
                c.onclick = () => { youSay(t.title); botSay(t); };
                row.appendChild(c);
            });
            m.appendChild(row);
        }
        log.appendChild(m);
        scrollDown();
    }
    function answer(q) {
        youSay(q);
        const r = G.ask(q);
        if (r.topic) {
            botSay(r.topic, null, r.also.length ? r.also : null);
            if (r.also.length) log.lastChild.querySelector(".kg-chips").insertAdjacentElement("beforebegin", el("div", "kg-or", "Or did you mean:"));
        } else {
            botSay(null, "Hmm, I'm not sure about that one. Try other words — or tap one of these:",
                (r.also.length ? r.also : []).concat(G.STARTERS.map(G.byId)).filter((t, i, a) => a.indexOf(t) === i).slice(0, 6));
        }
    }
    /* The phone's Back button closes the guide: opening it adds a step to the
       history. Closing it with ✕ takes that step back out. Closing it to go
       somewhere ("Take me there", "Show me") just unmarks the step instead —
       a history.back() lands a moment later and would undo the page that
       move opens (the same trap Social's popups had). */
    const isGuideStep = () => !!(history.state && history.state.kihGuide);
    function hide() {
        if (!sheet) return;
        sheet.classList.remove("open");
        document.body.classList.remove("kih-guide-on");
        if (input) input.blur();
    }
    function openGuide() {
        const tip = $("kihGuideTip");
        if (tip) tip.remove();
        if (!sheet) build();
        sheet.classList.add("open");
        document.body.classList.add("kih-guide-on");
        if (!isGuideStep()) history.pushState({ ...(history.state || {}), kihGuide: 1 }, "");
        setTimeout(() => { scrollDown(); if (window.matchMedia("(hover: hover)").matches) input.focus(); }, 60);
    }
    function closeGuide(toGoSomewhere) {
        if (!sheet || !sheet.classList.contains("open")) return;
        hide();
        if (!isGuideStep()) return;
        if (toGoSomewhere === true) { const st = { ...history.state }; delete st.kihGuide; history.replaceState(st, ""); }
        else history.back();
    }
    window.addEventListener("popstate", () => { if (sheet && sheet.classList.contains("open") && !isGuideStep()) hide(); });
    window.openHelpGuide = openGuide;
    window.closeHelpGuide = closeGuide;
})();
