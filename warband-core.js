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
     their shape — tanky or hard-hitting — comes from their real stats.
   - Gold: ECON (a round's pay, interest on what you save, streaks); XP buys
     levels, your level is how many units you can field and which costs the
     shop shows (ODDS). The shop draws from one shared pool (POOL).
   - Three of the same unit at the same ★ merge into one ★ higher (★3 at most).
   - fight(): a deterministic fight on an 8 × 7 board, in ticks of 0.1 s, with
     only + − × ÷ and rounding, so the browser and the server always agree.
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
    const PLAYERS = 8, START_HP = 100, BENCH = 9, SHOP = 5, MAX_LEVEL = 9, MAX_ROUNDS = 60;
    const COLS = 7, ROWS = 4; // your half of the board (the fight's board is 8 × 7)
    const COST = { common: 1, rare: 2, epic: 3, legendary: 4, mythic: 5 };
    const POOL = { 1: 29, 2: 22, 3: 18, 4: 12, 5: 10 }; // copies of each unit, shared by all 8
    // the shop's chance of each cost (1–5), in %, by your level
    const ODDS = {
        1: [100, 0, 0, 0, 0], 2: [100, 0, 0, 0, 0], 3: [75, 25, 0, 0, 0], 4: [55, 30, 15, 0, 0], 5: [45, 33, 20, 2, 0],
        6: [30, 40, 25, 5, 0], 7: [19, 30, 35, 15, 1], 8: [18, 25, 32, 22, 3], 9: [10, 20, 25, 35, 10]
    };
    const XP_TO_NEXT = { 1: 2, 2: 2, 3: 6, 4: 10, 5: 20, 6: 36, 7: 56, 8: 80 };
    const ECON = { base: 5, interestPer: 10, interestMax: 5, reroll: 2, xpCost: 4, xpBuy: 4, xpPerRound: 2, streak: [[5, 3], [4, 2], [2, 1]] };
    const STAR_MULT = { 1: 1, 2: 1.8, 3: 3.24 };
    // ❤️ a loss costs: 1 + 1 every 4 rounds, plus each enemy unit still standing (its ★)
    const lossDamage = (round, survivorStars) => 1 + Math.floor(round / 4) + survivorStars;

    /* ---------------- team bonuses ---------------- */
    // counted by different units on the board (two Archers count once)
    const TRAITS = {
        Human: { icon: "🛡️", name: "Human", of: "faction", steps: [2, 4, 6], desc: (v) => `Humans: +${v} defense`, vals: [20, 45, 80] },
        Undead: { icon: "💀", name: "Undead", of: "faction", steps: [2, 4, 6], desc: (v) => `Undead heal ${v}% of the damage they deal`, vals: [15, 30, 50] },
        Mage: { icon: "🔮", name: "Mage", of: "faction", steps: [2, 4, 6], desc: (v) => `Mages' skills hit ${v}% harder, and start with more mana`, vals: [30, 60, 100] },
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
    // From games-core.js buildUnits: { key, name, rarity, faction, attack, levels, splash, abilities, img }.
    // Each gets its cost from its rarity and its stats from its cost, shaped
    // by how tanky it really is (its own HP against its attack, among all 75).
    const BASE_HP = { 1: 560, 2: 700, 3: 860, 4: 1020, 5: 1220 }, BASE_ATK = { 1: 52, 2: 62, 3: 76, 4: 92, 5: 112 };
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
            out[u.key] = {
                key: u.key, name: u.name, type: u.type, img: u.img || null, rarity: u.rarity, cost,
                faction: u.faction, attack: ranged ? "Ranged" : "Melee",
                hp: Math.round(BASE_HP[cost] * (0.75 + 0.5 * s) * (ranged ? 0.85 : 1)),
                atk: Math.round(BASE_ATK[cost] * (1.25 - 0.5 * s) * (ranged ? 0.9 : 1)),
                def: Math.round(15 + 30 * s),
                range: ranged ? 3 : 1,
                aspd: ranged ? 0.75 : 0.8, // attacks a second
                splash: !!(last && last.splash),
                // its skill, when its mana's full: a tank shields itself, a hitter strikes hard, a ranged unit volleys
                skill: tank ? "guard" : ranged ? "volley" : hitter ? "strike" : "cleave",
                skillName: (u.abilities && u.abilities[0]) || null,
                mana: tank ? 80 : 100
            };
        });
        return out;
    }
    const SKILLS = {
        guard: { icon: "🛡️", desc: "shields itself (30% of its HP) for a while" },
        strike: { icon: "💥", desc: "strikes for 3× its attack" },
        cleave: { icon: "🌀", desc: "hits everything next to it for 2× its attack" },
        volley: { icon: "🏹", desc: "hits its target for 2× and two others for 1×" }
    };
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
                hp: START_HP, gold: 0, level: 1, xp: 0, streak: 0, board: [], bench: Array(BENCH).fill(null), shop: [], rolls: 0,
                alive: true, place: null, last: null
            });
        }
        const st = { v: 1, seed: String(seed), round: 0, rk: "", pool, players, over: false, log: [] };
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
            const pay = st.round === 1 ? ECON.base : ECON.base + interest(p.gold) + streakGold(p.streak);
            p.gold += pay;
            if (st.round > 1) addXp(p, ECON.xpPerRound);
            p.rolls = 0;
            p.shop = rollShop(cat, st, p.id, 0);
        });
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
    // { t: "reroll" } | { t: "xp" } | { t: "move", from, i, to, x, y, slot }
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
    const FIGHT_ROWS = 8, TICKS = 10, MAX_TICKS = 450, MOVE_TICKS = 4;
    const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    function fighters(cat, board, side, traits) {
        return board.map(u => {
            const c = cat[u.k], m = STAR_MULT[u.s] || 1;
            let hp = c.hp * m, atk = c.atk * m, def = c.def, aspd = c.aspd, mana0 = 0, spell = 1, steal = 0;
            const t = (name) => (traits[name] && traits[name].tier ? traits[name].val : 0);
            if (c.faction === "Human") def += t("Human");
            if (c.faction === "Undead") steal = t("Undead");
            if (c.faction === "Mage" && t("Mage")) { spell += t("Mage") / 100; mana0 = 30; }
            if (c.faction === "Demon") atk *= 1 + t("Demon") / 100;
            if (c.faction === "Elevate") hp *= 1 + t("Elevate") / 100;
            if (c.attack === "Melee") hp *= 1 + t("Melee") / 100;
            if (c.attack === "Ranged") aspd *= 1 + t("Ranged") / 100;
            hp = Math.round(hp); atk = Math.round(atk);
            const x = side === 0 ? u.x : COLS - 1 - u.x, y = side === 0 ? 4 + u.y : 3 - u.y;
            return { k: u.k, s: u.s, side, x, y, hp, max: hp, atk, def, range: c.range, cd: Math.max(3, Math.round(TICKS / aspd)), next: Math.round(TICKS / aspd / 2),
                mana: mana0, manaMax: c.mana, skill: c.skill, spell, steal, splash: c.splash, shield: 0, shieldT: 0, moveT: 0 };
        });
    }
    // a vs b (boards of { k, s, x, y }): { winner: 0 | 1 | null (time ran out), survivors: [stars of a's, b's], ticks, events? }
    function fight(cat, boardA, boardB, seed, record) {
        const ta = traitsOf(boardA.map(u => cat[u.k])), tb = traitsOf(boardB.map(u => cat[u.k]));
        const all = [...fighters(cat, boardA, 0, ta), ...fighters(cat, boardB, 1, tb)];
        all.forEach((f, i) => { f.id = i; });
        const r = rng("fight:" + seed);
        const ev = record ? [] : null;
        const alive = (side) => all.filter(f => f.hp > 0 && f.side === side);
        const hit = (from, to, raw, magic, t) => {
            let dmg = Math.max(1, Math.round(magic ? raw : raw * 100 / (100 + to.def)));
            if (to.shield > 0) { const s = Math.min(to.shield, dmg); to.shield -= s; dmg -= s; }
            to.hp -= dmg;
            to.mana = Math.min(to.manaMax, to.mana + 4);
            if (from.steal) from.hp = Math.min(from.max, from.hp + Math.round(dmg * from.steal / 100));
            if (ev) ev.push([t, "hit", from.id, to.id, dmg, to.hp > 0 ? to.hp : 0]);
            if (to.hp <= 0 && ev) ev.push([t, "die", to.id]);
        };
        let t = 0;
        for (; t < MAX_TICKS; t++) {
            if (!alive(0).length || !alive(1).length) break;
            const order = all.filter(f => f.hp > 0);
            for (const f of order) {
                if (f.hp <= 0) continue;
                if (f.shieldT > 0 && --f.shieldT === 0) f.shield = 0;
                const foes = alive(1 - f.side);
                if (!foes.length) break;
                // its target: the nearest (then the lowest id)
                let target = foes[0], best = cheb(f, foes[0]);
                for (const g of foes) { const d = cheb(f, g); if (d < best) { best = d; target = g; } }
                if (best <= f.range) {
                    if (--f.next > 0) continue;
                    f.next = f.cd;
                    if (f.mana >= f.manaMax) { // its skill
                        f.mana = 0;
                        if (ev) ev.push([t, "skill", f.id, f.skill]);
                        if (f.skill === "guard") { f.shield = Math.round(f.max * 0.3 * f.spell); f.shieldT = 40; }
                        else if (f.skill === "strike") hit(f, target, f.atk * 3 * f.spell, true, t);
                        else if (f.skill === "cleave") foes.filter(g => cheb(f, g) <= 1).forEach(g => hit(f, g, f.atk * 2 * f.spell, true, t));
                        else { // volley
                            hit(f, target, f.atk * 2 * f.spell, true, t);
                            shuffle(r, foes.filter(g => g !== target && g.hp > 0)).slice(0, 2).forEach(g => hit(f, g, f.atk * f.spell, true, t));
                        }
                        continue;
                    }
                    f.mana = Math.min(f.manaMax, f.mana + 10);
                    hit(f, target, f.atk, false, t);
                    if (f.splash) foes.filter(g => g !== target && g.hp > 0 && cheb(target, g) <= 1).forEach(g => hit(f, g, f.atk * 0.5, false, t));
                    continue;
                }
                // out of reach: a step towards it (to a free square that's closer)
                if (f.moveT > 0) { f.moveT--; continue; }
                let step = null, sd = best;
                for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
                    const nx = f.x + dx, ny = f.y + dy;
                    if (nx < 0 || nx >= COLS || ny < 0 || ny >= FIGHT_ROWS) continue;
                    if (all.some(g => g.hp > 0 && g.x === nx && g.y === ny)) continue;
                    const d = Math.max(Math.abs(nx - target.x), Math.abs(ny - target.y));
                    if (d < sd) { sd = d; step = [nx, ny]; }
                }
                if (step) { f.x = step[0]; f.y = step[1]; f.moveT = MOVE_TICKS; if (ev) ev.push([t, "move", f.id, f.x, f.y]); }
            }
        }
        const a = alive(0), b = alive(1);
        const winner = a.length && !b.length ? 0 : b.length && !a.length ? 1 : null;
        const out = { winner, ticks: t, survivors: [a.reduce((s, f) => s + f.s, 0), b.reduce((s, f) => s + f.s, 0)] };
        if (ev) { out.events = ev; out.start = all.map(f => ({ id: f.id, k: f.k, s: f.s, side: f.side, x: f.x, y: f.y, hp: f.max })); }
        return out;
    }
    // where your units stand in a fight you're in, as the page draws it (you at the bottom)
    const fightStart = (cat, boardA, boardB) => [...fighters(cat, boardA, 0, traitsOf(boardA.map(u => cat[u.k]))), ...fighters(cat, boardB, 1, traitsOf(boardB.map(u => cat[u.k])))];

    /* ---------------- the bots ---------------- */
    const unitValue = (cat, u) => cat[u.k].cost * copiesOf(u.s);
    function botPlan(cat, st, pid) {
        const p = st.players[pid], b = p.bot, r = rng(`bot:${st.seed}:${st.round}:${pid}`);
        const skill = b.skill, noise = () => (r() - 0.5) * 6 * (1 - skill);
        const tryDo = (a) => { try { planAction(cat, st, pid, a); return true; } catch (e) { return false; } };
        // how much it keeps for interest (a good bot saves up to 50 from round 5)
        const reserve = () => (skill >= 0.4 && st.round >= 5 ? Math.min(50, 10 * Math.floor(skill * 5)) : 0);
        // level on time (a good bot), or now and then (a poor one)
        const wantLevel = Math.min(MAX_LEVEL, 2 + Math.floor(st.round / (skill >= 0.5 ? 3 : 4)));
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
        pool.sort((x, y) => (unitValue(cat, y) + style(y) * skill * 3 + (r() - 0.5) * 4 * (1 - skill)) - (unitValue(cat, x) + style(x) * skill * 3));
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
    // the bots plan, everyone still in fights someone, ❤️ is lost, the out are placed, the next round starts
    function endRound(cat, st, roundKey) {
        if (st.over) throw new Error("The match is over.");
        st.players.forEach(p => { if (p.alive && p.bot) botPlan(cat, st, p.id); });
        const live = st.players.filter(p => p.alive);
        const r = rng(`pair:${st.seed}:${st.round}`);
        // pairs — not the same as last round when it can be helped; one left over fights a copy of someone
        let order = shuffle(r, live.map(p => p.id));
        const pairs = [];
        while (order.length >= 2) {
            const a = order.shift();
            let j = order.findIndex(b => st.players[a].last == null || st.players[a].last.vs !== b);
            if (j < 0) j = 0;
            pairs.push([a, order.splice(j, 1)[0], false]);
        }
        if (order.length) { const a = order[0], ghost = pick(r, live.filter(p => p.id !== a)).id; pairs.push([a, ghost, true]); }
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
        hashString, rng, PLAYERS, START_HP, BENCH, SHOP, MAX_LEVEL, MAX_ROUNDS, COLS, ROWS, COST, POOL, ODDS, XP_TO_NEXT, ECON, STAR_MULT,
        TRAITS, SKILLS, traitsOf, catalog, sellValue, copiesOf, lossDamage, interest, streakGold,
        newMatch, rollShop, startRound, planAction, mergeAll, units, fight, fightStart, botPlan, endRound, summary, forPlayer, MAX_TICKS, TICKS
    };
});
