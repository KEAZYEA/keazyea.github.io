/* warband-core.js — ⚔️ Warband: buy troops and heroes each round, merge three
   of a kind into a stronger one, and outlast 7 bots. The rules, shared by the
   page (window.WarbandCore), the server (api/games.js plays every fight, so
   a result can't be made up) and the tests — no drawing here.

   - A match: you and 7 bots, 100 ❤️ each. Each round everyone plans (buy,
     sell, refresh the shop, level up, place units), then fights one other
     player. Losing costs ❤️ (more later on, and more for every enemy left
     standing); at 0 you're out. The last one standing is 1st.
   - Units (catalog) are the site's own 75 troops and heroes (games-core.js
     buildUnits): their rarity is their cost (1–5 🪙 gold, the match's own
     money), their faction and attack type their team bonuses (TRAITS), and
     their shape — tanky or hard-hitting — comes from their real stats. Each
     uses its own ability (by name: Meteor Strike, Snowball, Healing Veil…)
     on a countdown (ABILITIES — what it does comes from what the ability is),
     and a hero with a talent has it too (TALENTS: a lasting bonus).
   - Who you'll fight is known at the start of the round (st.pairs — the bots
     have planned already), so you can see their formation and set yours.
   - Gold: ECON (a round's pay, interest on what you save, streaks); XP buys
     levels, your level is how many units you can field and which costs the
     shop shows (ODDS). The shop draws from one shared pool (POOL).
   - Three of the same unit at the same ★ merge into one ★ higher (★3 at most).
   - fight(): a deterministic fight on an 8 × 7 board, in ticks of 0.1 s, with
     only + − × ÷ and rounding, so the browser and the server always agree.
     It can record what happens (moves, hits, abilities, heals, stuns…) for
     the page to play back.
   - A match is about 10 rounds: you start at level 3 with 💰 10, and a loss
     costs more each round (lossDamage).
   - The bots (botPlan) play by the same rules; their skill (0–1) comes from
     your rank: low ones buy at random, high ones save, chase pairs and a
     faction, level on time and place tanks in front.
   - planAction() is every move you can make while planning; endRound() runs
     the bots, the fights, the ❤️ and the next round. The server replays your
     moves with the same functions, then plays the round itself. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.WarbandCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    /* ---------------- random, from a seed (the same everywhere) ---------------- */
    function hashString(s) {
        let h = 2166136261 >>> 0;
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
        return h >>> 0;
    }
    function rng(seed) {
        let a = (typeof seed === "string" ? hashString(seed) : seed >>> 0) || 1;
        return function () {
            a = (a + 0x6D2B79F5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    const pick = (r, list) => list[Math.floor(r() * list.length)];
    function shuffle(r, list) { const a = list.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

    /* ---------------- the rules' numbers ---------------- */
    const VERSION = 2; // a saved match from before this is ended, not carried on
    const PLAYERS = 8, START_HP = 100, BENCH = 9, SHOP = 5, MAX_LEVEL = 9, MAX_ROUNDS = 30, START_LEVEL = 3, START_GOLD = 10;
    const COLS = 7, ROWS = 4; // your half of the board (the fight's board is 8 × 7)
    const COST = { common: 1, rare: 2, epic: 3, legendary: 4, mythic: 5 };
    const POOL = { 1: 29, 2: 22, 3: 18, 4: 12, 5: 10 }; // copies of each unit, shared by all 8
    // the shop's chance of each cost (1–5), in %, by your level
    const ODDS = {
        1: [100, 0, 0, 0, 0], 2: [100, 0, 0, 0, 0], 3: [75, 25, 0, 0, 0], 4: [55, 30, 15, 0, 0], 5: [45, 33, 20, 2, 0],
        6: [30, 40, 25, 5, 0], 7: [19, 30, 35, 15, 1], 8: [18, 25, 32, 22, 3], 9: [10, 20, 25, 35, 10]
    };
    const XP_TO_NEXT = { 1: 2, 2: 2, 3: 4, 4: 8, 5: 14, 6: 22, 7: 32, 8: 44 };
    const ECON = { base: 6, interestPer: 10, interestMax: 5, reroll: 2, xpCost: 4, xpBuy: 4, xpPerRound: 4, streak: [[5, 3], [4, 2], [2, 1]] };
    const STAR_MULT = { 1: 1, 2: 1.8, 3: 3.24 };
    // ❤️ a loss costs: 2 + the round, plus 2 for each ★ of the enemy units still standing (about 10 rounds a match)
    const lossDamage = (round, survivorStars) => 2 + round + 2 * survivorStars;

    /* ---------------- team bonuses ---------------- */
    // counted by different units on the board (two Archers count once)
    const TRAITS = {
        Human: { icon: "🛡️", name: "Human", of: "faction", steps: [2, 4, 6], desc: (v) => `Humans: +${v} defense`, vals: [20, 45, 80] },
        Undead: { icon: "💀", name: "Undead", of: "faction", steps: [2, 4, 6], desc: (v) => `Undead heal ${v}% of the damage they deal`, vals: [15, 30, 50] },
        Mage: { icon: "🔮", name: "Mage", of: "faction", steps: [2, 4, 6], desc: (v) => `Mages' abilities hit ${v}% harder, and their first comes sooner`, vals: [30, 60, 100] },
        Demon: { icon: "😈", name: "Demon", of: "faction", steps: [1, 2, 3], desc: (v) => `Demons: +${v}% attack`, vals: [20, 45, 90] },
        Elevate: { icon: "🌟", name: "Elevate", of: "faction", steps: [1, 2, 3], desc: (v) => `Elevate: +${v}% HP`, vals: [20, 45, 90] },
        Melee: { icon: "⚔️", name: "Vanguard", of: "attack", steps: [2, 4, 6], desc: (v) => `Melee units: +${v}% HP`, vals: [15, 30, 55] },
        Ranged: { icon: "🏹", name: "Marksmen", of: "attack", steps: [2, 4, 6], desc: (v) => `Ranged units attack ${v}% faster`, vals: [15, 30, 55] }
    };
    // which tier of each bonus a board has: { Human: { n: 3, tier: 1, val: 20 } }
    function traitsOf(units) {
        const seen = {}, out = {};
        units.forEach(u => {
            if (!u) return;
            [u.faction, u.attack].forEach(t => { if (TRAITS[t]) (seen[t] = seen[t] || new Set()).add(u.key); });
        });
        Object.keys(seen).forEach(t => {
            const n = seen[t].size, steps = TRAITS[t].steps;
            let tier = 0; steps.forEach((s, i) => { if (n >= s) tier = i + 1; });
            out[t] = { n, tier, val: tier ? TRAITS[t].vals[tier - 1] : 0, next: steps.find(s => s > n) || null };
        });
        return out;
    }

    /* ---------------- the units ---------------- */
    // From games-core.js buildUnits: { key, name, rarity, faction, attack, levels, splash, abilityList, talent, talentStats, img }.
    // Each gets its cost from its rarity and its stats from its cost, shaped
    // by how tanky it really is (its own HP against its attack, among all 75).
    const BASE_HP = { 1: 560, 2: 700, 3: 860, 4: 1020, 5: 1220 }, BASE_ATK = { 1: 52, 2: 62, 3: 76, 4: 92, 5: 112 };
    // what an ability does, in a fight (x = the unit's attack)
    const ABILITIES = {
        blast: { icon: "☄️", desc: "hits every enemy around its target for 2× attack" },
        strike: { icon: "💥", desc: "hits its target for 3.5× attack" },
        stun: { icon: "💫", desc: "hits enemies around its target for 1.5× attack and stuns them for 2 s" },
        fear: { icon: "😱", desc: "scares the enemies near it: they can't attack for 2.5 s" },
        heal: { icon: "💚", desc: "heals itself and the allies near it by 25% of their HP" },
        shield: { icon: "🛡️", desc: "shields itself and the allies near it (20% of their HP) for 4 s" },
        rally: { icon: "📯", desc: "it and the allies near it attack 50% faster for 4 s" },
        summon: { icon: "👻", desc: "calls up a helper to fight beside it" },
        leap: { icon: "🌀", desc: "leaps onto the enemy farthest back and hits it for 2.5× attack" },
        volley: { icon: "🏹", desc: "hits its target for 2× attack and two other enemies for 1×" },
        guard: { icon: "🛡️", desc: "shields itself (35% of its HP) for 4 s" }
    };
    // what its first ability is, from its name and numbers (Meteor Strike: a blast; Snowball: a stun…)
    function abilityKind(a) {
        const t = ((a.title || "") + " " + (a.key || "")).toLowerCase(), n = a.nums || {};
        if (/summon|army|plague rat|tombstone|skeleton shot/.test(t)) return "summon";
        if (n.stun || /mind control|dream|snowball/.test(t)) return "stun";
        if (n.fear || /fear|nightmare/.test(t)) return "fear";
        if (n.heal || /heal|meds|veil|blessing/.test(t)) return "heal";
        if (/shield|guard|spirit form|immutab/.test(t)) return "shield";
        if (/song|courage|rage|fierce|furious|ale|vengeance/.test(t)) return "rally";
        if (/teleport|passage|charge|flight|jump|hop|cavalry/.test(t)) return "leap";
        if (n.dmg && n.radius) return "blast";
        if (n.dmg) return "strike";
        return null;
    }
    // a hero's talent: a bonus it always has
    const TALENTS = {
        atk: (v) => `+${v}% attack`, hp: (v) => `+${v}% HP`, thorns: (v) => `sends back ${v}% of the damage it takes`, dodge: (v) => `dodges ${v}% of attacks`, def: (v) => `+${v} defense`
    };
    function talentOf(u) {
        if (!u.talent) return null;
        const label = ((u.talentStats || [])[0] || {}).label || "";
        const kind = /return/i.test(label) ? "thorns" : /evasion|missing/i.test(label) ? "dodge" : /hp|health/i.test(label) ? "hp" : /decreased|delayed/i.test(label) ? "def" : "atk";
        const val = { atk: 15, hp: 15, thorns: 20, dodge: 15, def: 15 }[kind];
        return { name: u.talent, kind, val };
    }
    const cdOf = (a) => { const c = a && a.nums && a.nums.cd; const first = Array.isArray(c) && c.length ? Number(c[0][1]) : 0; return first > 0 ? Math.max(3, Math.min(7, Math.round(first * 0.4))) : 5; };
    function catalog(units) {
        const list = (units || []).filter(u => u && COST[u.rarity] && u.levels && u.levels.length && (u.faction in TRAITS));
        const ratio = (u) => { const l = u.levels[u.levels.length - 1]; return (l.hp * (l.count || 1)) / Math.max(1, l.atk * (l.count || 1)); };
        const order = list.slice().sort((a, b) => ratio(a) - ratio(b) || (a.key < b.key ? -1 : 1));
        const shapeOf = {};
        order.forEach((u, i) => { shapeOf[u.key] = order.length > 1 ? i / (order.length - 1) : 0.5; });
        const out = {};
        list.slice().sort((a, b) => (a.key < b.key ? -1 : 1)).forEach(u => {
            const cost = COST[u.rarity], s = shapeOf[u.key], ranged = u.attack === "Ranged";
            const last = u.levels[u.levels.length - 1];
            const tank = s >= 0.66, hitter = s < 0.33;
            // its own ability if it has one (named, on its own countdown); if not, one that fits it
            const own = (u.abilityList || []).map(a => ({ a, kind: abilityKind(a) })).find(x => x.kind);
            const kind = own ? own.kind : tank ? "guard" : ranged ? "volley" : hitter ? "strike" : "blast";
            const name = own ? own.a.title : { guard: "Shield Up", volley: "Volley", strike: "Power Strike", blast: "Cleave" }[kind];
            out[u.key] = {
                key: u.key, name: u.name, type: u.type, img: u.img || null, rarity: u.rarity, cost,
                faction: u.faction, attack: ranged ? "Ranged" : "Melee",
                hp: Math.round(BASE_HP[cost] * (0.75 + 0.5 * s) * (ranged ? 0.85 : 1)),
                atk: Math.round(BASE_ATK[cost] * (1.25 - 0.5 * s) * (ranged ? 0.9 : 1)),
                def: Math.round(15 + 30 * s),
                range: ranged ? 3 : 1,
                aspd: ranged ? 0.75 : 0.8, // attacks a second
                splash: !!(last && last.splash),
                ability: { name, kind, cd: own ? cdOf(own.a) : 5, own: !!own },
                talent: talentOf(u)
            };
        });
        return out;
    }
    const sellValue = (cat, unit) => { const c = cat[unit.k].cost; return unit.s === 1 ? c : c * Math.pow(3, unit.s - 1) - 1; };
    const copiesOf = (s) => Math.pow(3, s - 1);

    /* ---------------- a match ---------------- */
    const BOT_NAMES = ["Sir Pellam", "Grimvar", "Lady Wren", "Old Haskel", "Morrow", "Talia Fen", "Brother Osk", "Kestrel", "Duskmere", "Ivo the Bold", "Rook", "Sable", "Captain Bryn", "Mother Ash"];
    // a new match: you (0) and 7 bots, whose skill is around `skill` (0–1)
    function newMatch(cat, seed, opts) {
        opts = opts || {};
        const r = rng("wb:" + seed);
        const pool = {};
        Object.values(cat).forEach(u => { pool[u.key] = POOL[u.cost]; });
        const names = shuffle(r, BOT_NAMES);
        const skill = Math.max(0, Math.min(1, Number(opts.skill) || 0));
        const styles = ["Human", "Undead", "Mage", "Human", "Undead", "Mage", "Melee", "Ranged"];
        const players = [];
        for (let i = 0; i < PLAYERS; i++) {
            players.push({
                id: i, name: i === 0 ? String(opts.name || "You").slice(0, 40) : names[i - 1],
                bot: i === 0 ? null : { skill: Math.max(0, Math.min(1, skill + (r() - 0.5) * 0.3)), style: pick(r, styles) },
                hp: START_HP, gold: 0, level: START_LEVEL, xp: 0, streak: 0, board: [], bench: Array(BENCH).fill(null), shop: [], rolls: 0, locked: false,
                alive: true, place: null, last: null
            });
        }
        const st = { v: VERSION, seed: String(seed), round: 0, rk: "", pool, players, pairs: [], over: false, log: [] };
        startRound(cat, st, opts.roundKey);
        return st;
    }
    // the shop: SHOP units, each cost by your level's ODDS, each unit by its copies left
    function rollShop(cat, st, pid, salt) {
        const p = st.players[pid], r = rng(`shop:${st.rk}:${pid}:${salt}`);
        const byCost = {};
        Object.values(cat).forEach(u => { if (st.pool[u.key] > 0) (byCost[u.cost] = byCost[u.cost] || []).push(u.key); });
        const odds = ODDS[p.level];
        const out = [];
        for (let i = 0; i < SHOP; i++) {
            let roll = r() * 100, cost = 1;
            for (let c = 0; c < 5; c++) { if (roll < odds[c]) { cost = c + 1; break; } roll -= odds[c]; }
            while (cost > 1 && !(byCost[cost] || []).length) cost--;
            const keys = byCost[cost] || [];
            if (!keys.length) { out.push(null); continue; }
            const total = keys.reduce((t, k) => t + st.pool[k], 0);
            let w = r() * total, chosen = keys[keys.length - 1];
            for (const k of keys) { if (w < st.pool[k]) { chosen = k; break; } w -= st.pool[k]; }
            out.push(chosen);
        }
        return out;
    }
    const interest = (gold) => Math.min(ECON.interestMax, Math.floor(Math.max(0, gold) / ECON.interestPer));
    const streakGold = (streak) => { const n = Math.abs(streak); const s = ECON.streak.find(([at]) => n >= at); return s ? s[1] : 0; };
    function addXp(p, n) {
        p.xp += n;
        while (p.level < MAX_LEVEL && p.xp >= XP_TO_NEXT[p.level]) { p.xp -= XP_TO_NEXT[p.level]; p.level++; }
        if (p.level >= MAX_LEVEL) p.xp = 0;
    }
    /* a new round: pay, XP, a fresh shop. The shop comes from the round's key
       (st.rk): the server makes it from a secret (roundKey(round)) and the
       page gets only this round's — enough for its refreshes, never the next
       round's shops. (The match's seed, which plays the bots, the pairs and
       the fights, stays on the server: forPlayer leaves it out.) */
    function startRound(cat, st, roundKey) {
        st.round++;
        st.rk = roundKey ? String(roundKey(st.round)) : `${st.seed}:${st.round}`;
        st.players.forEach(p => {
            if (!p.alive) return;
            const pay = st.round === 1 ? START_GOLD : ECON.base + interest(p.gold) + streakGold(p.streak);
            p.gold += pay;
            if (st.round > 1) addXp(p, ECON.xpPerRound);
            p.rolls = 0;
            // 🔒 a locked shop stays as it is (what's been bought from it stays empty) until it's unlocked
            if (!(p.locked && st.round > 1 && p.shop.length)) p.shop = rollShop(cat, st, p.id, 0);
        });
        // the bots plan now, and the pairs are made — so you can see who you'll fight, and their board
        st.players.forEach(p => { if (p.alive && p.bot) botPlan(cat, st, p.id); });
        st.pairs = makePairs(st);
    }
    // this round's fights: [a, b, ghost] — not the same as last round when it can be helped; one left over fights a copy of someone
    function makePairs(st) {
        const live = st.players.filter(p => p.alive);
        const r = rng(`pair:${st.seed}:${st.round}`);
        const order = shuffle(r, live.map(p => p.id));
        const pairs = [];
        while (order.length >= 2) {
            const a = order.shift();
            let j = order.findIndex(b => st.players[a].last == null || st.players[a].last.vs !== b);
            if (j < 0) j = 0;
            pairs.push([a, order.splice(j, 1)[0], false]);
        }
        if (order.length) { const a = order[0], ghost = pick(r, live.filter(p => p.id !== a)).id; pairs.push([a, ghost, true]); }
        return pairs;
    }
    // who a player fights this round: { vs, ghost, side } (side 0: they're "a")
    function opponentOf(st, pid) {
        const p = (st.pairs || []).find(x => x[0] === pid || x[1] === pid);
        if (!p) return null;
        return p[0] === pid ? { vs: p[1], ghost: p[2], side: 0 } : { vs: p[0], ghost: false, side: 1, copied: p[2] };
    }

    /* ---------------- planning: every move you can make ---------------- */
    const onBoard = (p, x, y) => p.board.find(u => u.x === x && u.y === y) || null;
    const inHalf = (x, y) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < COLS && y >= 0 && y < ROWS;
    // three of a kind at the same ★ (board and bench) → one a ★ higher, where the first one was
    function mergeAll(p) {
        let merged = [];
        for (let guard = 0; guard < 6; guard++) {
            const groups = {};
            p.board.forEach((u, i) => { (groups[u.k + "|" + u.s] = groups[u.k + "|" + u.s] || []).push({ where: "board", i, u }); });
            p.bench.forEach((u, i) => { if (u) (groups[u.k + "|" + u.s] = groups[u.k + "|" + u.s] || []).push({ where: "bench", i, u }); });
            const g = Object.values(groups).find(list => list.length >= 3 && list[0].u.s < 3);
            if (!g) break;
            const three = g.slice(0, 3), keep = three.find(x => x.where === "board") || three[0], up = { k: keep.u.k, s: keep.u.s + 1 };
            // take the other two away (bench slots emptied, board units removed), then upgrade the kept one
            const drop = three.filter(x => x !== keep);
            drop.filter(x => x.where === "bench").forEach(x => { p.bench[x.i] = null; });
            const boardDrop = new Set(drop.filter(x => x.where === "board").map(x => x.u));
            if (keep.where === "board") { keep.u.s = up.s; } else { p.bench[keep.i] = up; }
            p.board = p.board.filter(u => !boardDrop.has(u));
            merged.push(up);
        }
        return merged;
    }
    const units = (p) => [...p.board, ...p.bench.filter(Boolean)];
    // one planning move; throws if it isn't allowed. a: { t: "buy", i } | { t: "sell", from, i } |
    // { t: "reroll" } | { t: "xp" } | { t: "lock" } (🔒 / 🔓 the shop) | { t: "move", from, i, to, x, y, slot }
    function planAction(cat, st, pid, a) {
        if (st.over) throw new Error("The match is over.");
        const p = st.players[pid];
        if (!p || !p.alive) throw new Error("You're out of this match.");
        if (!a || typeof a !== "object") throw new Error("What do you want to do?");
        if (a.t === "buy") {
            const i = a.i, key = Number.isInteger(i) ? p.shop[i] : null;
            if (!key) throw new Error("Nothing to buy there.");
            const u = cat[key];
            if (p.gold < u.cost) throw new Error("Not enough gold.");
            if (!(st.pool[key] > 0)) throw new Error("None of those left.");
            let slot = p.bench.indexOf(null);
            // a full bench can still take one that makes three
            if (slot < 0) {
                const same = units(p).filter(x => x.k === key && x.s === 1).length;
                if (same < 2) throw new Error("Your bench is full.");
                slot = -1;
            }
            p.gold -= u.cost; st.pool[key]--; p.shop[i] = null;
            if (slot >= 0) p.bench[slot] = { k: key, s: 1 };
            else { // merge straight away, with the two you have
                const two = [...p.board.map((x, j) => ({ where: "board", j, x })), ...p.bench.map((x, j) => ({ where: "bench", j, x }))].filter(o => o.x && o.x.k === key && o.x.s === 1).slice(0, 2);
                const keep = two.find(o => o.where === "board") || two[0];
                two.filter(o => o !== keep).forEach(o => { if (o.where === "bench") p.bench[o.j] = null; else p.board = p.board.filter(x => x !== o.x); });
                keep.x.s = 2;
            }
            return { merged: mergeAll(p) };
        }
        if (a.t === "sell") {
            const list = a.from === "board" ? p.board : a.from === "bench" ? p.bench : null;
            const u = list && Number.isInteger(a.i) ? list[a.i] : null;
            if (!u) throw new Error("Nothing to sell there.");
            p.gold += sellValue(cat, u);
            st.pool[u.k] += copiesOf(u.s);
            if (a.from === "board") p.board.splice(a.i, 1); else p.bench[a.i] = null;
            return {};
        }
        if (a.t === "lock") { p.locked = !p.locked; return { locked: p.locked }; } // 🔒 keep this shop for the next round (or 🔓 not)
        if (a.t === "reroll") {
            if (p.gold < ECON.reroll) throw new Error("Not enough gold.");
            p.gold -= ECON.reroll; p.rolls++;
            p.shop = rollShop(cat, st, pid, p.rolls);
            return {};
        }
        if (a.t === "xp") {
            if (p.level >= MAX_LEVEL) throw new Error("You're at the top level.");
            if (p.gold < ECON.xpCost) throw new Error("Not enough gold.");
            p.gold -= ECON.xpCost; addXp(p, ECON.xpBuy);
            return {};
        }
        if (a.t === "move") {
            const fromBench = a.from === "bench", list = fromBench ? p.bench : a.from === "board" ? p.board : null;
            const u = list && Number.isInteger(a.i) ? list[a.i] : null;
            if (!u) throw new Error("Nothing there to move.");
            if (a.to === "board") {
                if (!inHalf(a.x, a.y)) throw new Error("That's not your side of the board.");
                const there = onBoard(p, a.x, a.y);
                if (fromBench) {
                    if (there) { p.bench[a.i] = { k: there.k, s: there.s }; there.k = u.k; there.s = u.s; return {}; } // swap
                    if (p.board.length >= p.level) throw new Error(`You can field ${p.level} unit${p.level === 1 ? "" : "s"} — level up for more.`);
                    p.bench[a.i] = null; p.board.push({ k: u.k, s: u.s, x: a.x, y: a.y });
                    return {};
                }
                if (there && there !== u) { there.x = u.x; there.y = u.y; }
                u.x = a.x; u.y = a.y;
                return {};
            }
            if (a.to === "bench") {
                const slot = a.slot;
                if (!Number.isInteger(slot) || slot < 0 || slot >= BENCH) throw new Error("No such bench slot.");
                if (fromBench) { const t = p.bench[slot]; p.bench[slot] = u; p.bench[a.i] = t; return {}; }
                const t = p.bench[slot];
                if (t) { p.board[a.i] = { k: t.k, s: t.s, x: u.x, y: u.y }; } else p.board.splice(a.i, 1);
                p.bench[slot] = { k: u.k, s: u.s };
                return {};
            }
            throw new Error("Move it where?");
        }
        throw new Error("Unknown move.");
    }

    /* ---------------- the fight ---------------- */
    // the fight's board: 8 rows × 7. Side 0 (a) on rows 4–7 (your row 0 = row 4,
    // the front), side 1 (b) on rows 3–0, mirrored, facing you.
    const FIGHT_ROWS = 8, TICKS = 10, MAX_TICKS = 400, MOVE_TICKS = 4;
    const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    function fighters(cat, board, side, traits) {
        return board.map(u => {
            const c = cat[u.k], m = STAR_MULT[u.s] || 1, ab = c.ability, tal = c.talent;
            let hp = c.hp * m, atk = c.atk * m, def = c.def, aspd = c.aspd, spell = 1, steal = 0, first = 0.25; // (its first comes early: a quarter of its countdown)
            const t = (name) => (traits[name] && traits[name].tier ? traits[name].val : 0);
            if (c.faction === "Human") def += t("Human");
            if (c.faction === "Undead") steal = t("Undead");
            if (c.faction === "Mage" && t("Mage")) { spell += t("Mage") / 100; first = 0.1; }
            if (c.faction === "Demon") atk *= 1 + t("Demon") / 100;
            if (c.faction === "Elevate") hp *= 1 + t("Elevate") / 100;
            if (c.attack === "Melee") hp *= 1 + t("Melee") / 100;
            if (c.attack === "Ranged") aspd *= 1 + t("Ranged") / 100;
            if (tal && tal.kind === "atk") atk *= 1 + tal.val / 100;
            if (tal && tal.kind === "hp") hp *= 1 + tal.val / 100;
            if (tal && tal.kind === "def") def += tal.val;
            hp = Math.round(hp); atk = Math.round(atk);
            const x = side === 0 ? u.x : COLS - 1 - u.x, y = side === 0 ? 4 + u.y : 3 - u.y;
            const cdMax = ab.cd * TICKS;
            return { k: u.k, s: u.s, side, x, y, hp, max: hp, atk, def, range: c.range, cd: Math.max(3, Math.round(TICKS / aspd)), next: Math.round(TICKS / aspd / 2),
                ab: ab.kind, abName: ab.name, cdMax, cdLeft: Math.round(cdMax * first), spell, steal, splash: c.splash,
                thorns: tal && tal.kind === "thorns" ? tal.val : 0, dodge: tal && tal.kind === "dodge" ? tal.val : 0, talent: tal ? tal.name : null,
                shield: 0, shieldT: 0, moveT: 0, stunT: 0, fearT: 0, rallyT: 0, summon: false };
        });
    }
    // a vs b (boards of { k, s, x, y }): { winner: 0 | 1 | null (time ran out), survivors: [stars of a's, b's], ticks, events? }
    // events (recorded): [t, "move", id, x, y, leap?] · [t, "hit", from, to, dmg, hpLeft, "a" attack | "s" ability | "r" thorns] ·
    // [t, "miss", from, to] · [t, "die", id] · [t, "skill", id, kind, targetId] · [t, "heal", id, amount, hp] ·
    // [t, "shield", id, amount] · [t, "stun", id, untilTick] · [t, "fear", id, untilTick] · [t, "rally", id, untilTick] ·
    // [t, "summon", id, k, x, y, hp, side, fromId]
    function fight(cat, boardA, boardB, seed, record) {
        const ta = traitsOf(boardA.map(u => cat[u.k])), tb = traitsOf(boardB.map(u => cat[u.k]));
        const all = [...fighters(cat, boardA, 0, ta), ...fighters(cat, boardB, 1, tb)];
        all.forEach((f, i) => { f.id = i; });
        const start = record ? all.map(f => ({ id: f.id, k: f.k, s: f.s, side: f.side, x: f.x, y: f.y, hp: f.max, ab: f.ab, abName: f.abName, cdMax: f.cdMax, cdLeft: f.cdLeft, talent: f.talent })) : null;
        const r = rng("fight:" + seed);
        const ev = record ? [] : null;
        const alive = (side) => all.filter(f => f.hp > 0 && f.side === side);
        const free = (x, y) => x >= 0 && x < COLS && y >= 0 && y < FIGHT_ROWS && !all.some(g => g.hp > 0 && g.x === x && g.y === y);
        const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]];
        let t = 0;
        const hit = (from, to, raw, how) => {
            if (to.hp <= 0) return;
            if (how === "a" && to.dodge && r() * 100 < to.dodge) { if (ev) ev.push([t, "miss", from.id, to.id]); return; }
            let dmg = Math.max(1, Math.round(how === "s" ? raw : raw * 100 / (100 + to.def)));
            if (to.shield > 0) { const sh = Math.min(to.shield, dmg); to.shield -= sh; dmg -= sh; }
            to.hp -= dmg;
            if (from.steal && how !== "r") from.hp = Math.min(from.max, from.hp + Math.round(dmg * from.steal / 100));
            if (ev) ev.push([t, "hit", from.id, to.id, dmg, to.hp > 0 ? to.hp : 0, how]);
            if (to.hp <= 0) { if (ev) ev.push([t, "die", to.id]); return; }
            if (to.thorns && how === "a" && from.hp > 0) hit(to, from, Math.round(dmg * to.thorns / 100), "r");
        };
        const near = (f, list, d) => list.filter(g => g.hp > 0 && cheb(f, g) <= d);
        // its ability: what it does
        const cast = (f, target, foes, friends) => {
            const p = f.atk * f.spell;
            if (ev) ev.push([t, "skill", f.id, f.ab, target ? target.id : null]);
            if (f.ab === "blast") near(target, foes, 1).forEach(g => hit(f, g, p * 2, "s"));
            else if (f.ab === "strike") hit(f, target, p * 3.5, "s");
            else if (f.ab === "stun") near(target, foes, 1).forEach(g => { hit(f, g, p * 1.5, "s"); if (g.hp > 0) { g.stunT = t + 20; if (ev) ev.push([t, "stun", g.id, g.stunT]); } });
            else if (f.ab === "fear") near(f, foes, 2).forEach(g => { g.fearT = t + 25; if (ev) ev.push([t, "fear", g.id, g.fearT]); });
            else if (f.ab === "heal") near(f, friends, 2).forEach(g => { const h = Math.min(g.max - g.hp, Math.round(g.max * 0.25 * f.spell)); g.hp += h; if (ev) ev.push([t, "heal", g.id, h, g.hp]); });
            else if (f.ab === "shield" || f.ab === "guard") (f.ab === "guard" ? [f] : near(f, friends, 2)).forEach(g => { g.shield = Math.round(g.max * (f.ab === "guard" ? 0.35 : 0.2) * f.spell); g.shieldT = 40; if (ev) ev.push([t, "shield", g.id, g.shield]); });
            else if (f.ab === "rally") near(f, friends, 2).forEach(g => { g.rallyT = t + 40; if (ev) ev.push([t, "rally", g.id, g.rallyT]); });
            else if (f.ab === "summon") {
                const spot = DIRS.map(([dx, dy]) => [f.x + dx, f.y + dy]).find(([x, y]) => free(x, y));
                if (spot) {
                    const h = Math.round(f.max * 0.35 * f.spell);
                    const m = { k: f.k, s: 0, side: f.side, x: spot[0], y: spot[1], hp: h, max: h, atk: Math.round(f.atk * 0.45), def: 10, range: 1, cd: 12, next: 6,
                        ab: "strike", abName: "", cdMax: 99999, cdLeft: 99999, spell: 1, steal: 0, splash: false, thorns: 0, dodge: 0, talent: null,
                        shield: 0, shieldT: 0, moveT: 0, stunT: 0, fearT: 0, rallyT: 0, summon: true, id: all.length };
                    all.push(m);
                    if (ev) ev.push([t, "summon", m.id, m.k, m.x, m.y, m.hp, m.side, f.id]);
                }
            }
            else if (f.ab === "leap") {
                const back = foes.slice().sort((a, b) => cheb(f, b) - cheb(f, a) || a.id - b.id)[0];
                const spot = back && DIRS.map(([dx, dy]) => [back.x + dx, back.y + dy]).find(([x, y]) => free(x, y));
                if (spot) { f.x = spot[0]; f.y = spot[1]; if (ev) ev.push([t, "move", f.id, f.x, f.y, 1]); }
                if (back) hit(f, back, p * 2.5, "s");
            }
            else { // volley
                hit(f, target, p * 2, "s");
                shuffle(r, foes.filter(g => g !== target && g.hp > 0)).slice(0, 2).forEach(g => hit(f, g, p, "s"));
            }
        };
        for (; t < MAX_TICKS; t++) {
            if (!alive(0).length || !alive(1).length) break;
            const order = all.filter(f => f.hp > 0);
            for (const f of order) {
                if (f.hp <= 0) continue;
                if (f.shieldT > 0 && --f.shieldT === 0) f.shield = 0;
                if (f.stunT > t) continue; // stunned: nothing (its countdown waits too)
                const foes = alive(1 - f.side);
                if (!foes.length) break;
                // its target: the nearest (then the lowest id)
                let target = foes[0], best = cheb(f, foes[0]);
                for (const g of foes) { const d = cheb(f, g); if (d < best) { best = d; target = g; } }
                // ⏱ its ability's countdown
                if (--f.cdLeft <= 0) { f.cdLeft = f.cdMax; cast(f, target, foes, alive(f.side)); continue; }
                if (f.fearT > t) continue; // scared: it won't attack
                if (best <= f.range) {
                    if (--f.next > 0) continue;
                    f.next = f.rallyT > t ? Math.max(2, Math.round(f.cd / 1.5)) : f.cd;
                    hit(f, target, f.atk, "a");
                    if (f.splash) foes.filter(g => g !== target && g.hp > 0 && cheb(target, g) <= 1).forEach(g => hit(f, g, f.atk * 0.5, "a"));
                    continue;
                }
                // out of reach: a step towards it (to a free square that's closer)
                if (f.moveT > 0) { f.moveT--; continue; }
                let step = null, sd = best;
                for (const [dx, dy] of DIRS) {
                    const nx = f.x + dx, ny = f.y + dy;
                    if (!free(nx, ny)) continue;
                    const d = Math.max(Math.abs(nx - target.x), Math.abs(ny - target.y));
                    if (d < sd) { sd = d; step = [nx, ny]; }
                }
                if (step) { f.x = step[0]; f.y = step[1]; f.moveT = MOVE_TICKS; if (ev) ev.push([t, "move", f.id, f.x, f.y]); }
            }
        }
        const a = alive(0), b = alive(1);
        const winner = a.length && !b.length ? 0 : b.length && !a.length ? 1 : null;
        const out = { winner, ticks: t, survivors: [a.reduce((s, f) => s + f.s, 0), b.reduce((s, f) => s + f.s, 0)] };
        if (ev) { out.events = ev; out.start = start; }
        return out;
    }
    // where the units stand when a fight starts, with their stats (you at the bottom)
    const fightStart = (cat, boardA, boardB) => [...fighters(cat, boardA, 0, traitsOf(boardA.map(u => cat[u.k]))), ...fighters(cat, boardB, 1, traitsOf(boardB.map(u => cat[u.k])))];

    /* ---------------- the bots ---------------- */
    const unitValue = (cat, u) => cat[u.k].cost * copiesOf(u.s);
    function botPlan(cat, st, pid) {
        const p = st.players[pid], b = p.bot, r = rng(`bot:${st.seed}:${st.round}:${pid}`);
        const skill = b.skill, noise = () => (r() - 0.5) * 6 * (1 - skill);
        const tryDo = (a) => { try { planAction(cat, st, pid, a); return true; } catch (e) { return false; } };
        // how much it keeps for interest (a good bot saves up to 50 from round 5)
        const reserve = () => (skill >= 0.5 && st.round >= 3 && st.round <= 6 ? Math.min(20, 10 * Math.floor(skill * 2.5)) : 0); // (a short match: a little interest, early)
        // level on time (a good bot), or now and then (a poor one)
        const wantLevel = Math.min(MAX_LEVEL, START_LEVEL + Math.floor(st.round / (skill >= 0.5 ? 2 : 3)));
        for (let guard = 0; guard < 8 && p.level < wantLevel && p.gold >= ECON.xpCost + (p.hp > 40 ? reserve() / 2 : 0); guard++) if (!tryDo({ t: "xp" })) break;
        for (let roll = 0; roll < 4; roll++) {
            const have = {};
            units(p).forEach(u => { have[u.k] = (have[u.k] || 0) + copiesOf(u.s); });
            const ranked = p.shop.map((k, i) => ({ k, i })).filter(o => o.k).map(o => {
                const c = cat[o.k];
                const score = (have[o.k] ? 4 : 0) + (c.faction === b.style || c.attack === b.style ? 2.5 * skill + 0.5 : 0) + c.cost * 0.4 + noise();
                return { ...o, score };
            }).sort((x, y) => y.score - x.score);
            for (const o of ranked) {
                const c = cat[o.k];
                if (o.score < 1.5 && units(p).length >= p.level + 2) continue;
                if (p.gold - c.cost < (have[o.k] ? 0 : reserve())) continue;
                if (p.bench.indexOf(null) < 0 && !have[o.k]) { // make room: sell the least useful thing on the bench
                    const worst = p.bench.map((u, i) => ({ u, i })).filter(x => x.u && !(have[x.u.k] >= 2)).sort((x, y) => unitValue(cat, x.u) - unitValue(cat, y.u))[0];
                    if (!worst) continue;
                    tryDo({ t: "sell", from: "bench", i: worst.i });
                }
                tryDo({ t: "buy", i: o.i });
            }
            // a good bot with gold to spare looks again
            if (!(skill >= 0.6 && p.gold >= reserve() + ECON.reroll + 4 && (st.round >= 8 || p.hp < 50))) break;
            if (!tryDo({ t: "reroll" })) break;
        }
        // field the best it has: the strongest units, tanks in front, ranged at the back
        const pool = units(p).map(u => ({ k: u.k, s: u.s }));
        const style = (u) => (cat[u.k].faction === b.style || cat[u.k].attack === b.style ? 1 : 0);
        // (its strongest — its own faction a little ahead; a poor bot muddles the order)
        pool.sort((x, y) => (unitValue(cat, y) * (1 + 0.15 * style(y)) + (r() - 0.5) * 4 * (1 - skill)) - (unitValue(cat, x) * (1 + 0.15 * style(x))));
        const field = pool.slice(0, p.level), rest = pool.slice(p.level);
        const used = new Set();
        const spot = (u, i) => {
            const c = cat[u.k];
            const rows = skill < 0.25 ? [Math.floor(r() * ROWS)] : c.attack === "Ranged" ? [3, 2, 1, 0] : c.skill === "guard" ? [0, 1, 2, 3] : [0, 1, 2, 3];
            const cols = [3, 2, 4, 1, 5, 0, 6];
            for (const y of rows) for (const x of (skill < 0.25 ? shuffle(r, cols) : cols)) { if (!used.has(x + "," + y)) { used.add(x + "," + y); return { x, y }; } }
            for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (!used.has(x + "," + y)) { used.add(x + "," + y); return { x, y }; }
            return null;
        };
        p.board = field.map((u, i) => ({ ...u, ...spot(u, i) }));
        p.bench = Array(BENCH).fill(null);
        rest.slice(0, BENCH).forEach((u, i) => { p.bench[i] = u; });
        rest.slice(BENCH).forEach(u => { p.gold += sellValue(cat, u); st.pool[u.k] += copiesOf(u.s); });
    }

    /* ---------------- the end of a round ---------------- */
    // everyone still in fights who they were paired with, ❤️ is lost, the out are placed, the next round starts (the bots plan for it)
    function endRound(cat, st, roundKey) {
        if (st.over) throw new Error("The match is over.");
        const live = st.players.filter(p => p.alive);
        const pairs = st.pairs && st.pairs.length ? st.pairs : makePairs(st); // (made when the round started)
        const results = [];
        const before = {};
        live.forEach(p => { before[p.id] = p.hp; });
        pairs.forEach(([a, b, ghost], n) => {
            const A = st.players[a], B = st.players[b];
            const seed = `${st.rk}:f${n}`; // (from the round's key, never the match's seed: the page replays it)
            const res = fight(cat, A.board, B.board, seed);
            const loseA = res.winner !== 0, loseB = res.winner !== 1 && !ghost;
            const dmgA = loseA ? lossDamage(st.round, res.survivors[1]) : 0, dmgB = loseB ? lossDamage(st.round, res.survivors[0]) : 0;
            A.hp -= dmgA; if (!ghost) B.hp -= dmgB;
            const mark = (P, won, vs, dmg) => { P.streak = won ? Math.max(1, P.streak + 1) : Math.min(-1, P.streak - 1); P.last = { vs, won, dmg }; };
            mark(A, res.winner === 0, b, dmgA);
            if (!ghost) mark(B, res.winner === 1, a, dmgB);
            results.push({ a, b, ghost, seed, winner: res.winner, dmg: [dmgA, ghost ? 0 : dmgB], boards: [A.board.map(u => ({ ...u })), B.board.map(u => ({ ...u }))] });
        });
        // who's out: worst first (the most below 0, then the least ❤️ before)
        const out = live.filter(p => p.hp <= 0).sort((x, y) => x.hp - y.hp || before[x.id] - before[y.id] || y.id - x.id);
        let placeNext = live.length;
        out.forEach(p => {
            p.alive = false; p.place = placeNext--;
            units(p).forEach(u => { st.pool[u.k] += copiesOf(u.s); });
            p.board = []; p.bench = Array(BENCH).fill(null); p.shop = [];
        });
        const still = st.players.filter(p => p.alive);
        st.log.push({ round: st.round, results: results.map(x => ({ a: x.a, b: x.b, ghost: x.ghost, winner: x.winner, dmg: x.dmg })) });
        if (st.log.length > 40) st.log.shift();
        const me = st.players[0];
        if (still.length <= 1 || !me.alive || st.round >= MAX_ROUNDS) {
            // the last one standing is 1st; at the round limit, the most ❤️
            still.sort((x, y) => y.hp - x.hp || x.id - y.id).forEach((p, i) => { p.place = i + 1; });
            st.over = true;
            return { results, over: true, place: me.place };
        }
        startRound(cat, st, roundKey);
        return { results, over: false };
    }

    // what anyone can see of a player (the page shows everyone's ❤️ and boards)
    const summary = (st) => st.players.map(p => ({ id: p.id, name: p.name, hp: p.hp, level: p.level, alive: p.alive, place: p.place, bot: !!p.bot, streak: p.streak }));
    // the match as the page gets it: everything but its seed
    function forPlayer(st) {
        const out = JSON.parse(JSON.stringify(st));
        delete out.seed;
        return out;
    }

    return {
        hashString, rng, VERSION, PLAYERS, START_HP, START_LEVEL, START_GOLD, BENCH, SHOP, MAX_LEVEL, MAX_ROUNDS, COLS, ROWS, COST, POOL, ODDS, XP_TO_NEXT, ECON, STAR_MULT,
        TRAITS, ABILITIES, TALENTS, abilityKind, talentOf, traitsOf, catalog, sellValue, copiesOf, lossDamage, interest, streakGold, makePairs, opponentOf,
        newMatch, rollShop, startRound, planAction, mergeAll, units, fight, fightStart, botPlan, endRound, summary, forPlayer, MAX_TICKS, TICKS
    };
});
