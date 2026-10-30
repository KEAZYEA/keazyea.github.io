/* progress-core.js — achievements, badges, items, styles and chests, shared
   by the pages (as window.ProgressCore) and the server (api/progress.js,
   api/games.js, api/tokens.js, via require). The server is the only one that
   pays tokens or hands out items; the pages use this file to show the same.

   ACHIEVEMENTS: six tiers each. Reaching a tier's target makes it ready to
   claim; claiming pays its tokens and upgrades its badge (Bronze → Mythic).
   Gold (tier 3) also gives a free Perk Chest draw, and Mythic (tier 6) an
   exclusive reward that no chest has (ACHIEVEMENT_REWARDS).

   ITEMS have perks. Each is owned once — a duplicate pays tokens back by
   rarity instead. Every perk counts while you own it (nothing to equip), and
   perks of the same kind add up.

   STYLES are looks only: avatar borders, name effects and chat bubbles (you
   show one of each at a time) and emote packs (all yours are on at once).

   To release something new, add it with a new id. Never reuse or rename an
   id: inventories store ids. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.ProgressCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    /* ---------------- badges ---------------- */
    const TIERS = [
        { name: "Bronze", color: "#cd7f32" },
        { name: "Silver", color: "#c0c8d8" },
        { name: "Gold", color: "#ffd24a" },
        { name: "Platinum", color: "#7fe0d0" },
        { name: "Diamond", color: "#7cc4ff" },
        { name: "Mythic", color: "#ff6bd6" }
    ];
    const TIER_REWARDS = [1, 2, 3, 5, 8, 12]; // tokens for tiers 1..6
    const FREE_DRAW_TIER = 3;                  // Gold: a free Perk Chest draw
    const MAX_BADGES = 3;                      // +1 with the Badge Pin

    /* ---------------- achievements ---------------- */
    const ACHIEVEMENTS = [
        { id: "posts", stat: "posts", icon: "📝", name: "Content Creator", desc: "Share formations, tier lists and clan posts", targets: [1, 5, 10, 25, 50, 100] },
        { id: "comments", stat: "comments", icon: "💬", name: "Helping Hand", desc: "Comment on other players' posts (one per post counts)", targets: [1, 10, 25, 50, 75, 100] },
        { id: "visits", stat: "visits", icon: "👀", name: "Explorer", desc: "Visit other players' profiles", targets: [1, 10, 25, 50, 75, 100] },
        { id: "likesGiven", stat: "likesGiven", icon: "👍", name: "Friendly", desc: "Like other players' profiles", targets: [1, 10, 25, 50, 75, 100] },
        { id: "likesReceived", stat: "likesReceived", icon: "⭐", name: "Popular", desc: "Get likes on your profile", targets: [1, 10, 25, 50, 75, 100] },
        { id: "gamePoints", stat: "gamePoints", icon: "🎮", name: "Gamer", desc: "Score points in Games (ranked runs)", targets: [50, 100, 250, 500, 750, 1000] },
        { id: "champion", stat: "lbTop5", icon: "🏆", name: "Champion", desc: "Finish top 5 on the weekly Games leaderboard", targets: [1, 2, 3, 5, 10, 25] },
        { id: "puzzles", stat: "puzzles", icon: "🧩", name: "Puzzle Solver", desc: "Finish Today's Puzzle in Games", targets: [1, 7, 14, 30, 60, 100] },
        { id: "logins", stat: "logins", icon: "📅", name: "Loyal Commander", desc: "Claim your daily login", targets: [1, 7, 14, 30, 60, 100] },
        { id: "weekly", stat: "weekly", icon: "🎡", name: "Weekly Regular", desc: "Enter the weekly giveaway", targets: [1, 2, 4, 8, 12, 25] },
        { id: "secret", stat: "secret", icon: "🎁", name: "Treasure Hunter", desc: "Enter Secret Giveaways", targets: [1, 5, 10, 25, 50, 100] },
        { id: "supporter", stat: "purchases", icon: "🛒", name: "Supporter", desc: "Buy a token pack or a monthly plan payment", targets: [1, 2, 3, 5, 10, 25] },
        { id: "collector", stat: "items", icon: "🎒", name: "Collector", desc: "Collect different items and styles from chests", targets: [1, 5, 10, 25, 40, 60] }
    ];
    const ACHIEVEMENT_BY_ID = Object.fromEntries(ACHIEVEMENTS.map(a => [a.id, a]));

    function tiersReached(ach, value) {
        const v = Math.max(0, Number(value) || 0);
        return ach.targets.filter(t => v >= t).length;
    }
    // Tokens for claiming tiers from+1..to.
    function rewardBetween(from, to) {
        let sum = 0;
        for (let i = Math.max(0, from); i < Math.min(to, TIER_REWARDS.length); i++) sum += TIER_REWARDS[i];
        return sum;
    }
    function achievementStates(stats, claimed) {
        return ACHIEVEMENTS.map(a => {
            const value = Math.max(0, Math.floor(Number((stats || {})[a.stat]) || 0));
            const reached = tiersReached(a, value);
            const done = Math.min(reached, Math.max(0, Math.floor(Number((claimed || {})[a.id]) || 0)));
            const next = a.targets[done] ?? null;
            return { id: a.id, value, reached, claimed: done, ready: reached - done, readyTokens: rewardBetween(done, reached), next };
        });
    }

    /* ---------------- rarities ---------------- */
    const RARITIES = {
        common: { label: "Common", color: "#b8c0d0", weight: 55, refund: 10 },
        uncommon: { label: "Uncommon", color: "#5fd38a", weight: 27, refund: 15 },
        rare: { label: "Rare", color: "#5aa8ff", weight: 12, refund: 25 },
        epic: { label: "Epic", color: "#b46bff", weight: 5, refund: 35 },
        legendary: { label: "Legendary", color: "#ffb02e", weight: 1, refund: 50 }
    };
    const RARITY_ORDER = ["common", "uncommon", "rare", "epic", "legendary"];

    /* ---------------- perks ----------------
       kind            what it does                                    where it's applied
       gameFlat        +N on your weekly Games total                   api/games.js
       gameBest        +N% of your strongest game's points             api/games.js
       gameMult        +N% of your whole weekly Games total            api/games.js
       doubleBoost     +N% on points from ⭐ doubled runs               api/games.js
       gameTime        +N seconds per question in ranked runs          games-core.js runNew
       lives           +N extra lives per ranked run                   games-core.js runStep
       blurHints       +N free hints per Blur run                      games-core.js runNew
       gameTen         +N 🪙 the first time a day a ranked run hits 10 api/games.js
       prizeMult       +N% on your weekly Games prize                  api/games.js finalizeWeek
       loginBonus      +N 🪙 on your daily login                        api/tokens.js
       sundayBonus     +N 🪙 in the Sunday chest                        api/tokens.js
       puzzleBonus     +N 🪙 for Today's Puzzle                         api/tokens.js
       questMult       +N% on the day's quest tokens, rounded up, paid
                       once all the day's quests are claimed           api/tokens.js
       secretChance    +N chances in every Secret Giveaway (tokens on)  appState draw
       stakeMult       tokens you add count +N%                         appState draw
       weeklyTickets   +N tickets in the weekly giveaway                appState draw
       chestDiscount   chests cost N 🪙 less per draw                    api/progress.js
       dupBonus        +N 🪙 back on a duplicate                         api/progress.js
       badgeSlots      +N badges shown on your profile                  api/progress.js
       questFlat       +N 🪙 once all of a day's quests are claimed      api/tokens.js
       tierBonus       +N 🪙 for every achievement tier you claim         api/progress.js
       weeklyFreeDraw  +N free chest draws every week (Mon, SGT)         api/progress.js */
    const PERK_KINDS = ["gameFlat", "gameBest", "gameMult", "doubleBoost", "gameTime", "lives", "blurHints", "gameTen", "prizeMult",
        "loginBonus", "sundayBonus", "puzzleBonus", "questMult", "secretChance", "stakeMult", "weeklyTickets", "chestDiscount", "dupBonus", "badgeSlots",
        "questFlat", "tierBonus", "weeklyFreeDraw"];
    const x = (v) => `×${(1 + v / 100).toFixed(2).replace(/0$/, "")}`;
    const PERK_TEXT = {
        gameFlat: (v) => `+${v} weekly Games score`,
        gameBest: (v) => `+${v}% on your best game`,
        gameMult: (v) => `${x(v)} weekly Games score`,
        doubleBoost: (v) => `⭐ double game ×${(2 * (1 + v / 100)).toFixed(1)}`,
        gameTime: (v) => `+${v}s per Games question`,
        lives: (v) => `+${v} extra li${v === 1 ? "fe" : "ves"} per Games run`,
        blurHints: (v) => `+${v} Blur hint${v === 1 ? "" : "s"} per run`,
        gameTen: (v) => `+${v} 🪙 a day for a 10+ Games run`,
        prizeMult: (v) => `${x(v)} weekly Games prize (top 5)`,
        loginBonus: (v) => `+${v} 🪙 daily login`,
        sundayBonus: (v) => `+${v} 🪙 Sunday chest`,
        puzzleBonus: (v) => `+${v} 🪙 Today's Puzzle`,
        questMult: (v) => `${x(v)} daily quest tokens`,
        secretChance: (v) => `+${v} Secret Giveaway chance${v === 1 ? "" : "s"}`,
        stakeMult: (v) => `Secret Giveaway tokens count ${x(v)}`,
        weeklyTickets: (v) => `+${v} weekly giveaway ticket${v === 1 ? "" : "s"}`,
        chestDiscount: (v) => `chests ${v} 🪙 cheaper`,
        dupBonus: (v) => `+${v} 🪙 on duplicates`,
        badgeSlots: (v) => `+${v} badge slot${v === 1 ? "" : "s"}`,
        questFlat: (v) => `+${v} 🪙 for finishing all of a day's quests`,
        tierBonus: (v) => `+${v} 🪙 per achievement tier you claim`,
        weeklyFreeDraw: (v) => `${v} free chest draw${v === 1 ? "" : "s"} every week`
    };
    const perkText = (perk) => (PERK_TEXT[perk.kind] ? PERK_TEXT[perk.kind](perk.value) : "");

    /* ---------------- items (perks) ----------------
       chest: true → in the Perk Chest. Achievement items come only from a
       Mythic tier. "gloves" was Leather Gloves at launch; it's the Ration
       Pack now (its owners keep it). */
    const ITEMS = [
        // common
        { id: "cap", icon: "🧢", name: "Recruit's Cap", rarity: "common", chest: true, perks: [{ kind: "gameFlat", value: 1 }] },
        { id: "gloves", icon: "🍞", name: "Ration Pack", rarity: "common", chest: true, perks: [{ kind: "loginBonus", value: 1 }] },
        { id: "candle", icon: "🕯️", name: "Candle", rarity: "common", chest: true, perks: [{ kind: "puzzleBonus", value: 1 }] },
        { id: "compass", icon: "🧭", name: "Compass", rarity: "common", chest: true, perks: [{ kind: "gameTime", value: 1 }] },
        { id: "clover", icon: "🍀", name: "Four-Leaf Clover", rarity: "common", chest: true, perks: [{ kind: "secretChance", value: 1 }] },
        { id: "quill", icon: "✒️", name: "Quill", rarity: "common", chest: true, perks: [{ kind: "questMult", value: 5 }] },
        { id: "crate", icon: "📦", name: "Spare Crate", rarity: "common", chest: true, perks: [{ kind: "dupBonus", value: 5 }] },
        { id: "muddy", icon: "🥾", name: "Muddy Boots", rarity: "common", chest: true, perks: [{ kind: "gameTen", value: 1 }] },
        { id: "juice", icon: "🧃", name: "Juice Box", rarity: "common", chest: true, perks: [{ kind: "sundayBonus", value: 1 }] },
        { id: "raffle", icon: "🎫", name: "Raffle Stub", rarity: "rare", chest: true, perks: [{ kind: "weeklyTickets", value: 1 }] },
        // uncommon
        { id: "boots", icon: "👢", name: "Swift Boots", rarity: "uncommon", chest: true, perks: [{ kind: "gameFlat", value: 3 }] },
        { id: "ticket", icon: "🎟️", name: "Golden Ticket", rarity: "epic", chest: true, perks: [{ kind: "weeklyTickets", value: 2 }] },
        { id: "ledger", icon: "🧾", name: "Quest Ledger", rarity: "uncommon", chest: true, perks: [{ kind: "questFlat", value: 2 }] },
        { id: "beads", icon: "📿", name: "Lucky Beads", rarity: "uncommon", chest: true, perks: [{ kind: "stakeMult", value: 10 }] },
        { id: "torch", icon: "🔥", name: "Torch", rarity: "uncommon", chest: true, perks: [{ kind: "sundayBonus", value: 2 }] },
        { id: "hourglass", icon: "⏱️", name: "Hourglass", rarity: "uncommon", chest: true, perks: [{ kind: "gameTime", value: 2 }] },
        { id: "heart", icon: "❤️", name: "Spare Heart", rarity: "uncommon", chest: true, perks: [{ kind: "lives", value: 1 }] },
        { id: "spyglass", icon: "🔭", name: "Spyglass", rarity: "uncommon", chest: true, perks: [{ kind: "blurHints", value: 1 }] },
        // rare
        { id: "crest", icon: "🛡️", name: "Champion's Crest", rarity: "rare", chest: true, perks: [{ kind: "gameBest", value: 10 }] },
        { id: "pouch", icon: "💰", name: "Coin Pouch", rarity: "rare", chest: true, perks: [{ kind: "questMult", value: 10 }] },
        { id: "mark", icon: "🎯", name: "Hunter's Mark", rarity: "rare", chest: true, perks: [{ kind: "secretChance", value: 2 }] },
        { id: "key", icon: "🗝️", name: "Chest Key", rarity: "rare", chest: true, perks: [{ kind: "chestDiscount", value: 5 }] },
        { id: "pin", icon: "📌", name: "Badge Pin", rarity: "rare", chest: true, perks: [{ kind: "badgeSlots", value: 1 }] },
        { id: "dice", icon: "🎲", name: "Loaded Dice", rarity: "rare", chest: true, perks: [{ kind: "doubleBoost", value: 10 }] },
        { id: "medal", icon: "🏅", name: "Medal Polish", rarity: "rare", chest: true, perks: [{ kind: "tierBonus", value: 1 }] },
        // epic
        { id: "crown", icon: "👑", name: "Royal Crown", rarity: "epic", chest: true, perks: [{ kind: "gameMult", value: 10 }] },
        { id: "amulet", icon: "💎", name: "Gem Amulet", rarity: "epic", chest: true, perks: [{ kind: "questMult", value: 20 }] },
        { id: "trophy", icon: "🏆", name: "Victor's Trophy", rarity: "epic", chest: true, perks: [{ kind: "prizeMult", value: 25 }] },
        { id: "feather", icon: "🪶", name: "Phoenix Feather", rarity: "epic", chest: true, perks: [{ kind: "lives", value: 1 }, { kind: "gameTime", value: 2 }] },
        { id: "scroll", icon: "📜", name: "Weekly Scroll", rarity: "epic", chest: true, perks: [{ kind: "weeklyFreeDraw", value: 1 }] },
        // legendary
        { id: "dragon", icon: "🐉", name: "Dragon Heart", rarity: "legendary", chest: true, perks: [{ kind: "questMult", value: 30 }] },
        { id: "blade", icon: "⚡", name: "Storm Blade", rarity: "legendary", chest: true, perks: [{ kind: "gameMult", value: 20 }, { kind: "gameFlat", value: 5 }] },
        { id: "star", icon: "🌟", name: "Star of Fortune", rarity: "legendary", chest: true, perks: [{ kind: "secretChance", value: 3 }, { kind: "stakeMult", value: 20 }] },
        { id: "jackpot", icon: "🎰", name: "Jackpot Charm", rarity: "legendary", chest: true, perks: [{ kind: "weeklyTickets", value: 3 }, { kind: "secretChance", value: 2 }] },
        // achievement rewards (Mythic only)
        { id: "a_joystick", icon: "🕹️", name: "Gamer's Joystick", rarity: "epic", perks: [{ kind: "gameTime", value: 1 }, { kind: "blurHints", value: 1 }] },
        { id: "a_laurel", icon: "🌿", name: "Champion's Laurel", rarity: "legendary", perks: [{ kind: "gameMult", value: 5 }] },
        { id: "a_pass", icon: "🎡", name: "Regular's Pass", rarity: "epic", perks: [{ kind: "weeklyTickets", value: 1 }, { kind: "loginBonus", value: 1 }] },
        { id: "a_charm", icon: "🧿", name: "Hunter's Charm", rarity: "epic", perks: [{ kind: "secretChance", value: 1 }, { kind: "stakeMult", value: 5 }] },
        // 🎃 Halloween 2026 (Trick or Treat, 31 Oct only) — limited
        { id: "h_candy", icon: "🍬", name: "Candy Bag", rarity: "common", event: "halloween2026", perks: [{ kind: "loginBonus", value: 1 }] },
        { id: "h_broom", icon: "🧹", name: "Witch's Broom", rarity: "uncommon", event: "halloween2026", perks: [{ kind: "gameTime", value: 2 }] },
        { id: "h_cat", icon: "🐈‍⬛", name: "Black Cat", rarity: "rare", event: "halloween2026", perks: [{ kind: "secretChance", value: 1 }, { kind: "puzzleBonus", value: 1 }] },
        { id: "h_king", icon: "🎃", name: "Pumpkin King", rarity: "legendary", event: "halloween2026", perks: [{ kind: "weeklyTickets", value: 1 }, { kind: "secretChance", value: 1 }] }
    ];

    /* ---------------- styles (looks only) ----------------
       type: border | name | bubble | background | emotes. css: the class
       suffix the pages style (fx-border-<css>, fx-name-<css>, fx-bubble-<css>,
       fx-bg-<css>). season (optional, none right now): only in the chest
       between those dates (month-day, Singapore time). */
    const EMOTE_PACKS = {
        party: ["🎉", "🥳", "🍾", "🎊", "🎈", "🪅", "🎂", "🍰"],
        food: ["🍕", "🍔", "🍟", "🍩", "🍣", "🍜", "🧋", "🍓"],
        animals: ["🐶", "🦊", "🐼", "🐸", "🦁", "🐧", "🦄", "🐙"],
        cats: ["😺", "😹", "😻", "🙀", "😼", "😿", "😽", "🐱"],
        battle: ["⚔️", "🛡️", "🏹", "💥", "🗡️", "🏰", "🐉", "🪓"],
        spooky: ["🎃", "👻", "💀", "🦇", "🕷️", "🧛", "🕸️", "🧟"],
        winter: ["❄️", "⛄", "🎄", "🦌", "🧣", "☃️", "🌨️", "🎁"],
        hearts: ["💞", "💖", "💘", "💝", "💗", "💓", "💕", "💟"],
        treats: ["🍬", "🍭", "🧙", "🔮", "🍫", "🧹", "🪦", "🌕"]
    };
    const STYLES = [
        // borders
        { id: "b_bronze", type: "border", css: "bronze", icon: "🟤", name: "Bronze Ring", rarity: "common", chest: true },
        { id: "b_silver", type: "border", css: "silver", icon: "⚪", name: "Silver Ring", rarity: "common", chest: true },
        { id: "b_emerald", type: "border", css: "emerald", icon: "🟢", name: "Emerald Vine", rarity: "uncommon", chest: true },
        { id: "b_sapphire", type: "border", css: "sapphire", icon: "🔵", name: "Sapphire Glow", rarity: "uncommon", chest: true },
        { id: "b_amethyst", type: "border", css: "amethyst", anim: "pulse", icon: "🟣", name: "Amethyst Pulse", rarity: "rare", chest: true },
        { id: "b_inferno", type: "border", css: "inferno", anim: "spin", icon: "🌋", name: "Inferno", rarity: "epic", chest: true },
        { id: "b_rainbow", type: "border", css: "rainbow", anim: "spin", icon: "🌈", name: "Rainbow", rarity: "legendary", chest: true },
        { id: "b_supporter", type: "border", css: "supporter", anim: "spin", icon: "👑", name: "Supporter Gold", rarity: "legendary", vip: true },
        { id: "b_scribe", type: "border", css: "scribe", icon: "🖋️", name: "Scribe", rarity: "legendary" },
        { id: "b_wanderer", type: "border", css: "wanderer", icon: "🧭", name: "Wanderer", rarity: "legendary" },
        { id: "b_arcade", type: "border", css: "arcade", anim: "spin", icon: "🕹️", name: "Arcade", rarity: "legendary" },
        { id: "b_laurel", type: "border", css: "laurel", icon: "🌿", name: "Laurel", rarity: "legendary" },
        { id: "b_flame", type: "border", css: "flame", anim: "spin", icon: "🔥", name: "Loyal Flame", rarity: "legendary" },
        { id: "b_patron", type: "border", css: "patron", anim: "spin", icon: "💠", name: "Patron", rarity: "legendary" },
        { id: "b_aura", type: "border", css: "aura", anim: "pulse", icon: "✨", name: "Collector's Aura", rarity: "legendary" },
        // name effects
        { id: "n_gold", type: "name", css: "gold", icon: "🥇", name: "Gold Name", rarity: "uncommon", chest: true },
        { id: "n_ice", type: "name", css: "ice", icon: "🧊", name: "Ice Name", rarity: "uncommon", chest: true },
        { id: "n_toxic", type: "name", css: "toxic", icon: "☢️", name: "Toxic Glow", rarity: "rare", chest: true },
        { id: "n_fire", type: "name", css: "fire", icon: "🔥", name: "Fire Name", rarity: "epic", chest: true },
        { id: "n_rainbow", type: "name", css: "rainbow", icon: "🌈", name: "Rainbow Shimmer", rarity: "legendary", chest: true },
        { id: "n_helper", type: "name", css: "helper", icon: "💬", name: "Helper Glow", rarity: "legendary" },
        { id: "n_star", type: "name", css: "star", icon: "⭐", name: "Star Name", rarity: "legendary" },
        { id: "n_puzzle", type: "name", css: "puzzle", icon: "🧩", name: "Puzzle Master", rarity: "legendary" },
        // chat bubbles
        { id: "c_ocean", type: "bubble", css: "ocean", icon: "🌊", name: "Ocean Bubble", rarity: "common", chest: true },
        { id: "c_rose", type: "bubble", css: "rose", icon: "🌹", name: "Rose Bubble", rarity: "common", chest: true },
        { id: "c_forest", type: "bubble", css: "forest", icon: "🌲", name: "Forest Bubble", rarity: "common", chest: true },
        { id: "c_midnight", type: "bubble", css: "midnight", icon: "🌙", name: "Midnight Bubble", rarity: "uncommon", chest: true },
        { id: "c_gold", type: "bubble", css: "gold", icon: "✨", name: "Gold Bubble", rarity: "rare", chest: true },
        { id: "c_cloud", type: "bubble", css: "cloud", icon: "☁️", name: "Cloud Bubble", rarity: "common", chest: true },
        { id: "c_capy", type: "bubble", css: "capy", icon: "🦫", name: "Capybara Bubble", rarity: "uncommon", chest: true },
        // profile backgrounds (your card, and your profile as others see it)
        { id: "g_stars", type: "background", css: "stars", icon: "🌌", name: "Starry Night", rarity: "common", chest: true },
        { id: "g_sakura", type: "background", css: "sakura", icon: "🌸", name: "Sakura", rarity: "uncommon", chest: true },
        { id: "g_capy", type: "background", css: "capy", icon: "♨️", name: "Capybara Spa", rarity: "rare", chest: true },
        { id: "g_galaxy", type: "background", css: "galaxy", icon: "🪐", name: "Galaxy", rarity: "epic", chest: true },
        // emote packs
        { id: "e_party", type: "emotes", pack: "party", icon: "🎉", name: "Party Pack", rarity: "common", chest: true },
        { id: "e_food", type: "emotes", pack: "food", icon: "🍕", name: "Food Pack", rarity: "common", chest: true },
        { id: "e_animals", type: "emotes", pack: "animals", icon: "🐶", name: "Animal Pack", rarity: "common", chest: true },
        { id: "e_cats", type: "emotes", pack: "cats", icon: "😺", name: "Cat Pack", rarity: "uncommon", chest: true },
        { id: "e_battle", type: "emotes", pack: "battle", icon: "⚔️", name: "Battle Pack", rarity: "uncommon", chest: true },
        { id: "e_spooky", type: "emotes", pack: "spooky", icon: "🎃", name: "Spooky Pack", rarity: "rare", chest: true },
        { id: "e_winter", type: "emotes", pack: "winter", icon: "❄️", name: "Winter Pack", rarity: "rare", chest: true },
        { id: "e_hearts", type: "emotes", pack: "hearts", icon: "💞", name: "Hearts Pack", rarity: "legendary" },
        // 🎃 Halloween 2026 (Trick or Treat, 31 Oct only) — limited
        { id: "hb_pumpkin", type: "border", css: "pumpkin", anim: "spin", icon: "🎃", name: "Jack-o'-Lantern", rarity: "epic", event: "halloween2026" },
        { id: "hb_ghost", type: "border", css: "ghost", anim: "pulse", icon: "👻", name: "Ghost Glow", rarity: "rare", event: "halloween2026" },
        { id: "hn_ghost", type: "name", css: "ghost", icon: "👻", name: "Ghostly", rarity: "rare", event: "halloween2026" },
        { id: "hn_pumpkin", type: "name", css: "pumpkin", icon: "🧡", name: "Pumpkin Spice", rarity: "epic", event: "halloween2026" },
        { id: "hc_web", type: "bubble", css: "web", icon: "🕸️", name: "Cobweb Bubble", rarity: "common", event: "halloween2026" },
        { id: "hc_pumpkin", type: "bubble", css: "pumpkin", icon: "🎃", name: "Pumpkin Bubble", rarity: "uncommon", event: "halloween2026" },
        { id: "hg_haunted", type: "background", css: "haunted", icon: "🌕", name: "Haunted Night", rarity: "rare", event: "halloween2026" },
        { id: "he_treats", type: "emotes", pack: "treats", icon: "🍭", name: "Trick-or-Treat Pack", rarity: "uncommon", event: "halloween2026" },
        // Halloween profile pictures: everyone who logs in on the day gets one
        // of the three free (at random); the others cost `price` 🪙 each.
        // Not treats at the door. img: the picture (pick it in Profile → Edit).
        { id: "ha_warlock", type: "avatar", img: "images/halloween/ha_warlock.jpg", icon: "🧙‍♂️", name: "Void Warlock", rarity: "epic", event: "halloween2026", price: 15 },
        { id: "ha_knight", type: "avatar", img: "images/halloween/ha_knight.jpg", icon: "💀", name: "Grave Knight", rarity: "epic", event: "halloween2026", price: 15 },
        { id: "ha_witch", type: "avatar", img: "images/halloween/ha_witch.jpg", icon: "🧙‍♀️", name: "Bone Witch", rarity: "epic", event: "halloween2026", price: 15 }
    ];
    const STYLE_TYPES = { border: "Avatar border", name: "Name effect", bubble: "Chat bubble", background: "Profile background", emotes: "Emote pack", avatar: "Profile picture" };

    const ALL = [...ITEMS.map(i => ({ ...i, kind: "item" })), ...STYLES.map(s => ({ ...s, kind: "style" }))];
    const BY_ID = Object.fromEntries(ALL.map(x => [x.id, x]));
    const ITEM_BY_ID = Object.fromEntries(ITEMS.map(i => [i.id, i]));
    const STYLE_BY_ID = Object.fromEntries(STYLES.map(s => [s.id, s]));

    // Mythic rewards: what each achievement's 6th tier gives.
    const ACHIEVEMENT_REWARDS = {
        posts: ["b_scribe"], comments: ["n_helper"], visits: ["b_wanderer"], likesGiven: ["e_hearts"], likesReceived: ["n_star"],
        gamePoints: ["b_arcade", "a_joystick"], champion: ["b_laurel", "a_laurel"], puzzles: ["n_puzzle"], logins: ["b_flame"],
        weekly: ["a_pass"], secret: ["a_charm"], supporter: ["b_patron"], collector: ["b_aura"]
    };

    // Reactions: the six everyone has, plus the first four of each emote pack.
    const BASE_REACTIONS = ["❤️", "😂", "😮", "😢", "👍", "🔥"];
    const packReactions = (pack) => (EMOTE_PACKS[pack] || []).slice(0, 4);
    const ALL_REACTIONS = [...BASE_REACTIONS, ...Object.keys(EMOTE_PACKS).flatMap(packReactions)];
    // The reactions and extra typing emojis an owned set of ids unlocks.
    function emotesOf(ids) {
        const packs = (ids || []).map(id => STYLE_BY_ID[id]).filter(s => s && s.type === "emotes").map(s => s.pack);
        return {
            reactions: [...BASE_REACTIONS, ...packs.flatMap(packReactions)],
            emojis: packs.flatMap(p => EMOTE_PACKS[p])
        };
    }

    /* ---------------- the chest ----------------
       One chest holds both: perk items and styles. Each rarity's chance is
       split evenly between everything in it. A duplicate (anything you already
       own) is turned into tokens by its rarity (RARITIES[...].refund). */
    const CHEST = { id: "chest", icon: "🧰", name: "Adventurer's Chest", price: 50, price10: 450,
        desc: "Perk items (bonuses that are always on) and styles (borders, name effects, chat bubbles, emote packs)." };
    // Is a seasonal style in the chest on this day ("YYYY-MM-DD")?
    function inSeason(s, dayKey) {
        if (!s.season) return true;
        const md = String(dayKey || "").slice(5);
        const [from, to] = s.season;
        return from <= to ? md >= from && md <= to : md >= from || md <= to;
    }
    function chestPool(dayKey) {
        return [...ITEMS.filter(i => i.chest), ...STYLES.filter(st => st.chest && inSeason(st, dayKey))];
    }
    // Each entry's chance per draw, in percent.
    function dropRates(dayKey) {
        const pool = chestPool(dayKey);
        const count = {};
        pool.forEach(x => { count[x.rarity] = (count[x.rarity] || 0) + 1; });
        const total = Object.keys(count).reduce((t, r) => t + RARITIES[r].weight, 0);
        return Object.fromEntries(pool.map(x => [x.id, total ? RARITIES[x.rarity].weight / total / count[x.rarity] * 100 : 0]));
    }
    // One draw; `rand` in [0, 1). minRarity limits it to that rarity and up
    // (the 10-draw's guaranteed Rare), keeping their relative odds.
    function rollChest(rand, dayKey, minRarity) {
        const rates = dropRates(dayKey);
        const floor = minRarity ? RARITY_ORDER.indexOf(minRarity) : 0;
        const pool = chestPool(dayKey).filter(x => RARITY_ORDER.indexOf(x.rarity) >= floor);
        const total = pool.reduce((t, x) => t + rates[x.id], 0);
        let t = rand * total;
        for (const x of pool) { t -= rates[x.id]; if (t < 0) return x.id; }
        return pool[pool.length - 1].id;
    }
    /* Guarantees: at least one Epic-or-better every PITY.epic draws, and a
       Legendary every PITY.legendary draws. Each counter is "draws since you
       last got one", kept on your inventory, and a Legendary resets both. A
       10-draw also always has at least one Rare or better. */
    const PITY = { epic: 30, legendary: 100 };
    const rank = (id) => RARITY_ORDER.indexOf(BY_ID[id].rarity);
    // count draws: rolls[] (and `rescue`) are numbers in [0, 1); pity is
    // { epic, legendary } so far. Returns the ids and the counters after.
    function drawChest(count, rolls, rescue, pity, dayKey) {
        let e = Math.max(0, Math.floor(Number((pity || {}).epic) || 0));
        let l = Math.max(0, Math.floor(Number((pity || {}).legendary) || 0));
        const ids = [];
        for (let i = 0; i < count; i++) {
            const floor = l + 1 >= PITY.legendary ? "legendary" : e + 1 >= PITY.epic ? "epic" : null;
            let id = rollChest(rolls[i], dayKey, floor);
            if (count === 10 && i === count - 1 && !ids.some(x => rank(x) >= 2) && rank(id) < 2) id = rollChest(rescue, dayKey, "rare");
            ids.push(id);
            if (rank(id) >= 4) { e = 0; l = 0; }
            else if (rank(id) >= 3) { e = 0; l++; }
            else { e++; l++; }
        }
        return { ids, pity: { epic: e, legendary: l } };
    }
    // Draws left until each guarantee (1 = the very next draw).
    const pityLeft = (pity) => ({
        epic: PITY.epic - Math.max(0, Math.floor(Number((pity || {}).epic) || 0)),
        legendary: PITY.legendary - Math.max(0, Math.floor(Number((pity || {}).legendary) || 0))
    });

    // What a draw costs you (the Chest Key makes each draw cheaper).
    function chestPrice(count, perks) {
        const off = Math.max(0, Math.floor(Number((perks || {}).chestDiscount) || 0)) * count;
        return Math.max(0, (count === 10 ? CHEST.price10 : CHEST.price) - off);
    }
    const refundFor = (id, perks) => RARITIES[BY_ID[id].rarity].refund + Math.max(0, Math.floor(Number((perks || {}).dupBonus) || 0));

    /* ---------------- events ----------------
       A limited chest that's only open for a while (Singapore days, both
       ends included). Trick or Treat: each knock is a treat (treatChance %)
       or a trick (nothing). A treat is always one of the event's things you
       don't have yet — picked by rarity weight among the ones you're
       missing, so rarer ones tend to come later — and at least every `pity`
       knocks is a treat. Once you have them all you can't knock any more
       (in a ×10 that finishes the set, the treats after it are `candy`
       tokens). Your first knock of the event is free. Event things are never in the
       Adventurer's Chest; whoever gets one keeps it. */
    const EVENTS = {
        halloween2026: { id: "halloween2026", name: "Trick or Treat", icon: "🎃", label: "Halloween 2026", from: "2026-10-31", to: "2026-10-31",
            price: 10, price10: 90, treatChance: 30, pity: 10, candy: 5,
            // the profile pictures (login gift + shop); false switches them off
            picturesOn: true,
            // 🎃 Spooky Gifts: everyone has one to send to another player
            spookyGifts: true }
    };
    /* A Spooky Gift's reward, rolled when it's opened (weights out of 100).
       knock: a free knock at Trick or Treat — +10 🪙 instead once the event is
       over; treat: one of the event's treats you don't have — +10 🪙 if you
       have them all. */
    const SPOOKY_REWARDS = [
        { kind: "tokens", amount: 5, weight: 40 },
        { kind: "tokens", amount: 10, weight: 25 },
        { kind: "draw", weight: 15 },
        { kind: "knock", weight: 15 },
        { kind: "treat", weight: 5 }
    ];
    function rollSpooky(r) {
        const total = SPOOKY_REWARDS.reduce((t, x) => t + x.weight, 0);
        let t = r * total;
        for (const x of SPOOKY_REWARDS) { t -= x.weight; if (t < 0) return x; }
        return SPOOKY_REWARDS[SPOOKY_REWARDS.length - 1];
    }
    // One of the event's treats you don't have, picked by rarity weight (null: you have them all).
    function pickMissingTreat(evId, owned, r) {
        const have = new Set(owned || []);
        const missing = ALL.filter(x => x.event === evId && x.type !== "avatar" && !have.has(x.id));
        if (!missing.length) return null;
        const total = missing.reduce((t, x) => t + RARITIES[x.rarity].weight, 0);
        let t = r * total;
        for (const x of missing) { t -= RARITIES[x.rarity].weight; if (t < 0) return x.id; }
        return missing[missing.length - 1].id;
    }
    const TRICKS = ["👻 Boo! Nothing this time.", "🕸️ Just cobwebs…", "🦇 A bat flew out — and that's all.", "🧟 The door slammed shut!",
        "💀 The skeleton kept the candy.", "🧙 The witch cackled. Trick!"];
    // the treats at the door (profile pictures are given / bought instead)
    const eventThings = (evId) => ALL.filter(x => x.event === evId && x.type !== "avatar");
    const eventAvatars = (evId) => (EVENTS[evId] && EVENTS[evId].picturesOn === false) ? [] : STYLES.filter(s => s.event === evId && s.type === "avatar");
    const activeEvent = (dayKey) => Object.values(EVENTS).find(e => dayKey >= e.from && dayKey <= e.to) || null;
    const eventPrice = (ev, count) => (count === 10 ? ev.price10 : ev.price);
    // count knocks. rolls[i] = [r1, r2], numbers in [0, 1): r1 decides treat
    // or trick, r2 which treat (or which trick message). owned: the ids you
    // have; pity: tricks in a row so far. Returns the results and the count after.
    function knock(ev, count, rolls, owned, pity) {
        const have = new Set(owned || []);
        let streak = Math.max(0, Math.floor(Number(pity) || 0));
        const results = [];
        for (let i = 0; i < count; i++) {
            const [r1, r2] = rolls[i];
            if (streak + 1 < ev.pity && r1 * 100 >= ev.treatChance) {
                streak++;
                results.push({ trick: true, msg: Math.min(TRICKS.length - 1, Math.floor(r2 * TRICKS.length)) });
                continue;
            }
            streak = 0;
            const missing = eventThings(ev.id).filter(x => !have.has(x.id));
            if (!missing.length) { results.push({ candy: ev.candy }); continue; }
            const total = missing.reduce((t, x) => t + RARITIES[x.rarity].weight, 0);
            let t = r2 * total, pick = missing[missing.length - 1];
            for (const x of missing) { t -= RARITIES[x.rarity].weight; if (t < 0) { pick = x; break; } }
            have.add(pick.id);
            results.push({ id: pick.id });
        }
        return { results, pity: streak };
    }

    /* ---------------- perk maths ---------------- */
    function perksOf(ids) {
        const out = Object.fromEntries(PERK_KINDS.map(k => [k, 0]));
        (ids || []).forEach(id => {
            const it = ITEM_BY_ID[id];
            if (it) it.perks.forEach(p => { if (p.kind in out) out[p.kind] += p.value; });
        });
        return out;
    }
    // Points items add to a weekly Games row: flat, % of the best game, % of
    // the doubled runs, % of the whole total. Nothing until you've scored this
    // week, so items alone never put anyone on the board.
    function gamePerkBonus(perks, pts, dbl) {
        const p = perks || {};
        const vals = Object.values(pts || {}).map(v => Math.max(0, Math.floor(Number(v) || 0)));
        const base = vals.reduce((a, b) => a + b, 0);
        if (!(base > 0)) return 0;
        const n = (k) => Math.max(0, Number(p[k]) || 0);
        const best = Math.max(0, ...vals);
        const doubled = Object.entries(pts || {}).filter(([g]) => dbl && dbl[g]).reduce((s, [, v]) => s + Math.max(0, Math.floor(Number(v) || 0)), 0);
        return Math.floor(n("gameFlat")) + Math.round(best * n("gameBest") / 100) + Math.round(doubled * n("doubleBoost") / 100) + Math.round(base * n("gameMult") / 100);
    }
    // What a ranked run gets from items.
    function runPerks(perks) {
        const p = perks || {};
        const n = (k, max) => Math.min(max, Math.max(0, Math.floor(Number(p[k]) || 0)));
        return { extraMs: n("gameTime", 10) * 1000, lives: n("lives", 5), blurHints: n("blurHints", 5) };
    }
    // The day's item bonus on quest tokens: rounded UP, so ×1.05 on 5 tokens is +1.
    function questBonus(perks, earned) {
        const m = Math.max(0, Number((perks || {}).questMult) || 0);
        const e = Math.max(0, Math.floor(Number(earned) || 0));
        return m > 0 && e > 0 ? Math.ceil(e * m / 100) : 0;
    }
    // A Secret Giveaway entry's chances: 1 + staked tokens (×stakeMult) + item chances.
    function secretWeight(tokens, perks) {
        const p = perks || {};
        const t = Math.max(0, Math.floor(Number(tokens) || 0));
        return 1 + t * (1 + Math.max(0, Number(p.stakeMult) || 0) / 100) + Math.max(0, Math.floor(Number(p.secretChance) || 0));
    }
    const badgeLimit = (perks) => MAX_BADGES + Math.min(3, Math.max(0, Math.floor(Number((perks || {}).badgeSlots) || 0)));
    // Every perk an owned set adds up to, as lines of text (for the pages).
    const perkLines = (perks) => PERK_KINDS.filter(k => (perks || {})[k] > 0).map(k => ({ kind: k, value: perks[k], text: PERK_TEXT[k](perks[k]) }));

    // One shown badge ({a, t}) as HTML. Only fixed text goes in.
    function badgeHtml(b) {
        const a = b && ACHIEVEMENT_BY_ID[b.a];
        const t = b ? Math.floor(Number(b.t)) : 0;
        if (!a || !(t >= 1)) return "";
        const tier = TIERS[Math.min(TIERS.length, t) - 1];
        return `<span class="pf-badge" style="--tc:${tier.color}" title="${a.name} · ${tier.name}"><span class="pf-badge-ico">${a.icon}</span><span class="pf-badge-name">${a.name}</span><span class="pf-badge-tier">${tier.name}</span></span>`;
    }
    // An avatar (HTML) inside its owner's border, if they show one.
    function withBorder(avatarHtml, style) {
        const s = style && STYLE_BY_ID[style.border];
        if (!s || s.type !== "border") return avatarHtml;
        return `<span class="fx-av fx-border-${s.css}${s.anim ? " fx-" + s.anim : ""}">${avatarHtml}</span>`;
    }
    // The CSS class for someone's shown style of a type ("" if none).
    // (fx-styles.css names backgrounds fx-bg-<css>, not fx-background-<css>)
    const CLASS_PREFIX = { background: "bg" };
    function styleClass(style, type) {
        const s = style && STYLE_BY_ID[style[type]];
        return s && s.type === type && s.css ? `fx-${CLASS_PREFIX[type] || type}-${s.css}` : "";
    }

    return {
        TIERS, TIER_REWARDS, FREE_DRAW_TIER, MAX_BADGES, ACHIEVEMENTS, ACHIEVEMENT_BY_ID, tiersReached, rewardBetween, achievementStates,
        RARITIES, RARITY_ORDER, PERK_KINDS, perkText, perkLines, ITEMS, ITEM_BY_ID, STYLES, STYLE_BY_ID, STYLE_TYPES, BY_ID,
        EMOTE_PACKS, BASE_REACTIONS, ALL_REACTIONS, emotesOf, ACHIEVEMENT_REWARDS,
        CHEST, PITY, inSeason, chestPool, dropRates, rollChest, drawChest, pityLeft, chestPrice, refundFor,
        EVENTS, TRICKS, eventThings, eventAvatars, activeEvent, eventPrice, knock, SPOOKY_REWARDS, rollSpooky, pickMissingTreat,
        perksOf, gamePerkBonus, runPerks, questBonus, secretWeight, badgeLimit, badgeHtml, styleClass, withBorder
    };
});
