/* progress-core.js — achievements, badges, items and chests, shared by the
   pages (as window.ProgressCore) and the server (api/progress.js and
   api/games.js, via require). The server is the only one that pays tokens or
   hands out items; the pages use this file to show the same numbers.

   ACHIEVEMENTS: each has six tiers. Reaching a tier's target makes it ready
   to claim; claiming pays its tokens and upgrades that achievement's badge
   (Bronze → Mythic). Players pick up to three badges to show on their profile.

   ITEMS: come out of chests. Each item can be owned once — a duplicate pays
   some tokens back instead. Every item's perk counts while you own it
   (there's nothing to equip), and perks of the same kind add up.
   To release a new item, add it to ITEMS with the next free id. Never
   reuse or rename an id: inventories store ids. */
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
    // Tokens for tiers 1..6 of every achievement.
    const TIER_REWARDS = [1, 2, 3, 5, 8, 12];
    const MAX_BADGES = 3;

    /* ---------------- achievements ----------------
       `stat` names the number the server counts for it (see api/progress.js).
       Targets are sized to how fast each can grow: a weekly thing tops out at
       25, a per-run thing at 1000. */
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
        { id: "collector", stat: "items", icon: "🎒", name: "Collector", desc: "Collect different items from chests", targets: [1, 2, 3, 4, 5, 6] }
    ];
    const ACHIEVEMENT_BY_ID = Object.fromEntries(ACHIEVEMENTS.map(a => [a.id, a]));

    // How many tiers `value` reaches (0..6).
    function tiersReached(ach, value) {
        const v = Math.max(0, Number(value) || 0);
        return ach.targets.filter(t => v >= t).length;
    }
    // Tokens for claiming tiers from+1..to (1-based tier numbers).
    function rewardBetween(from, to) {
        let sum = 0;
        for (let i = Math.max(0, from); i < Math.min(to, TIER_REWARDS.length); i++) sum += TIER_REWARDS[i];
        return sum;
    }
    // Every achievement's state from the counted stats and the tiers claimed.
    function achievementStates(stats, claimed) {
        return ACHIEVEMENTS.map(a => {
            const value = Math.max(0, Math.floor(Number((stats || {})[a.stat]) || 0));
            const reached = tiersReached(a, value);
            const done = Math.min(reached, Math.max(0, Math.floor(Number((claimed || {})[a.id]) || 0)));
            const next = a.targets[done] ?? null; // next target to claim or work towards
            return { id: a.id, value, reached, claimed: done, ready: reached - done, readyTokens: rewardBetween(done, reached), next };
        });
    }

    /* ---------------- items ---------------- */
    const RARITIES = {
        common: { label: "Common", color: "#b8c0d0", weight: 65 },
        uncommon: { label: "Uncommon", color: "#5fd38a", weight: 28 },
        rare: { label: "Rare", color: "#5aa8ff", weight: 7 },
        epic: { label: "Epic", color: "#b46bff", weight: 0 },
        legendary: { label: "Legendary", color: "#ffb02e", weight: 0 }
    };
    // perk kinds: gameFlat (+N on your weekly Games total), gameBest (+N%
    // of your strongest game's points), secretChance (+N chances in every
    // Secret Giveaway you enter that allows tokens).
    const ITEMS = [
        { id: "cap", icon: "🧢", name: "Recruit's Cap", rarity: "common", perk: { kind: "gameFlat", value: 1 } },
        { id: "gloves", icon: "🧤", name: "Leather Gloves", rarity: "common", perk: { kind: "gameFlat", value: 1 } },
        { id: "clover", icon: "🍀", name: "Four-Leaf Clover", rarity: "common", perk: { kind: "secretChance", value: 1 } },
        { id: "boots", icon: "👢", name: "Swift Boots", rarity: "uncommon", perk: { kind: "gameFlat", value: 2 } },
        { id: "beads", icon: "📿", name: "Lucky Beads", rarity: "uncommon", perk: { kind: "secretChance", value: 1 } },
        { id: "crest", icon: "🛡️", name: "Champion's Crest", rarity: "rare", perk: { kind: "gameBest", value: 10 } }
    ];
    const ITEM_BY_ID = Object.fromEntries(ITEMS.map(i => [i.id, i]));

    const CHEST = { id: "adventurer", icon: "🧰", name: "Adventurer's Chest", price: 25, duplicateRefund: 10 };

    function perkText(perk) {
        if (perk.kind === "gameFlat") return `+${perk.value} to your weekly Games score`;
        if (perk.kind === "gameBest") return `+${perk.value}% on your strongest game's points`;
        if (perk.kind === "secretChance") return `+${perk.value} chance${perk.value === 1 ? "" : "s"} in every Secret Giveaway`;
        return "";
    }
    // All of an owned set's perks added up: { gameFlat, gameBest, secretChance }.
    function perksOf(itemIds) {
        const out = { gameFlat: 0, gameBest: 0, secretChance: 0 };
        (itemIds || []).forEach(id => {
            const it = ITEM_BY_ID[id];
            if (it && it.perk.kind in out) out[it.perk.kind] += it.perk.value;
        });
        return out;
    }
    // The points items add to a weekly Games row: the flat bonus, plus the
    // percentage of the best game's points (rounded). Nothing until you've
    // scored this week, so an item alone never puts you on the board.
    function gamePerkBonus(perks, pts) {
        const best = Math.max(0, ...Object.values(pts || {}).map(v => Math.floor(Number(v) || 0)));
        if (!(best > 0)) return 0;
        const p = perks || {};
        return Math.max(0, Math.floor(Number(p.gameFlat) || 0)) + Math.round(best * Math.max(0, Number(p.gameBest) || 0) / 100);
    }
    // Each released item's chance per chest, in percent, for the page to show.
    function dropRates() {
        const byRarity = {};
        ITEMS.forEach(i => { byRarity[i.rarity] = (byRarity[i.rarity] || 0) + 1; });
        const total = Object.keys(byRarity).reduce((s, r) => s + RARITIES[r].weight, 0);
        return Object.fromEntries(ITEMS.map(i => [i.id, total ? RARITIES[i.rarity].weight / total / byRarity[i.rarity] * 100 : 0]));
    }
    // One chest roll. `rand` is a number in [0, 1).
    function rollItem(rand) {
        const rates = dropRates();
        let t = rand * 100;
        for (const it of ITEMS) {
            t -= rates[it.id];
            if (t < 0) return it.id;
        }
        return ITEMS[ITEMS.length - 1].id;
    }

    // One shown badge ({a: achievement id, t: tier 1–6}) as HTML, for the
    // pages (each styles .pf-badge). Only fixed text goes in, nothing typed by
    // a player.
    function badgeHtml(b) {
        const a = b && ACHIEVEMENT_BY_ID[b.a];
        const t = b ? Math.floor(Number(b.t)) : 0;
        if (!a || !(t >= 1)) return "";
        const tier = TIERS[Math.min(TIERS.length, t) - 1];
        return `<span class="pf-badge" style="--tc:${tier.color}" title="${a.name} · ${tier.name}"><span class="pf-badge-ico">${a.icon}</span><span class="pf-badge-name">${a.name}</span><span class="pf-badge-tier">${tier.name}</span></span>`;
    }

    return {
        TIERS, TIER_REWARDS, MAX_BADGES, ACHIEVEMENTS, ACHIEVEMENT_BY_ID, tiersReached, rewardBetween, achievementStates, badgeHtml,
        RARITIES, ITEMS, ITEM_BY_ID, CHEST, perkText, perksOf, gamePerkBonus, dropRates, rollItem
    };
});
