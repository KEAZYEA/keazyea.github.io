/* dungeon-core.js — 🏰 The Keep: an open-world adventure you play as your own
   character. The rules, shared by the page (window.DungeonCore), the server
   and the tests — no drawing here.

   - What you wear is your loadout (STATS_BY_SLOT): boots = speed, a top = HP,
     a bottom = defense, a hat = crit, a necklace = luck (more drops), hair and
     glasses = mana; the rarer, the more (TIER), up to the CAPS. What you hold
     is your weapon (weaponFor) — stronger weapons cost mana to use; out of
     mana, you fall back on your sling. Your pet fights beside you.
   - 📜 Stories (STORY): Story 1, "The Missing Warden" — from the city of
     Hearthmoor, four roads (REGIONS) open one after another (roadOpen): the
     🌾 south, 🕸️ west, 🏜️ east and ❄️ north. Each is an open land
     (regionMap) — three zones, tougher further out; monsters roaming in packs;
     things to gather — with a boss in its lair at the far end. Each boss
     leaves a clue to the next road; the last leads to the Warden.
   - Enemies and bosses come from the game's own troops and bosses; so do the
     weapons you can find (FIND_WEAPONS).
   - Loot (LOOT): 🔶 shards (the Keep's own money), mana, potions, ✨, 💗 and
     sometimes 🪙 — big ones from a boss.
   - 🎒 The Keep's own things (ITEMS): materials each monster drops, potions,
     and gear made by ⚗️ fusion (RECIPES: A + B → C, a chance; a failure
     loses both; a pair with no recipe makes 🪨 slag) — worn in the Keep's gear
     slots (GEAR_SLOTS) on top of your outfit (gearStats). They live in the
     bag (BAG: slots, stacks — bagAdd, bagTake), and sell (sellPrice). Things
     bought in the Store are worn, never fused or sold. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory(require("./progress-core.js"), require("./character-core.js"));
    else root.DungeonCore = factory(root.ProgressCore, root.CharacterCore);
})(typeof self !== "undefined" ? self : this, function (P, C) {
    "use strict";

    /* ---------------- randomness you can replay ---------------- */
    function hashString(s) {
        let h = 0x811c9dc5;
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
        return h >>> 0;
    }
    function rng(seed) {
        let s = typeof seed === "number" ? seed >>> 0 : hashString(String(seed));
        return function () {
            s = (s + 0x6D2B79F5) | 0;
            let t = Math.imul(s ^ (s >>> 15), 1 | s);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    const pick = (r, arr) => arr[Math.min(arr.length - 1, Math.floor(r() * arr.length))];
    const between = (r, a, b) => a + Math.floor(r() * (b - a + 1));
    function shuffle(r, arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
        return a;
    }

    /* ---------------- your gear → your stats ---------------- */
    const TIER = { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5 };
    const BASE = { hp: 60, mana: 100, def: 0, speed: 70, crit: 5, luck: 0, dmg: 0 };
    // what each slot adds per tier of rarity (a starter piece adds nothing)
    const STATS_BY_SLOT = {
        shoes: { speed: 5 }, top: { hp: 10 }, bottom: { def: 4 }, hat: { crit: 3 }, glasses: { crit: 2, mana: 5 },
        neck: { luck: 6 }, eyes: { crit: 1, dmg: 2 }, mouth: { luck: 2 }, hair: { mana: 10 }, held: { dmg: 6 }
    };
    const CAPS = { def: 45, speed: 115, crit: 40, luck: 60, dmg: 60, mana: 220 }; // def / crit / luck / dmg in %
    const STAT_INFO = {
        hp: { icon: "❤️", name: "HP" }, mana: { icon: "🔷", name: "Mana" }, def: { icon: "🛡️", name: "Defense", unit: "%" }, speed: { icon: "👟", name: "Speed" },
        crit: { icon: "🎯", name: "Crit", unit: "%" }, luck: { icon: "🍀", name: "Luck", unit: "%" }, dmg: { icon: "⚔️", name: "Damage", unit: "%" }
    };
    const tierOf = (id) => { if (!id || (C && C.isStarter && C.isStarter(id))) return 0; const x = P && P.BY_ID && P.BY_ID[id]; return x ? TIER[x.rarity] || 1 : 0; };

    /* ---------------- weapons ----------------
       kind: shot (a bolt) · slash (an arc in front) · thrust (a long narrow
       stab) · orb (homes in) · lob (lands where they are, then bursts) ·
       flame (a short cone, very fast) · spin (a thrown axe that pierces).
       mana: what each attack costs — holding ⚔️ empties a full bar in about
       8–12 s; only the sling (what you fall back on) is free. */
    const WEAPONS = {
        sling: { name: "Recruit's Sling", icon: "🪨", kind: "shot", dmg: 5, rate: 3, speed: 210, range: 150, mana: 0, color: "#c9b48a" },
        sword: { name: "Sword", icon: "🗡️", kind: "slash", dmg: 11, rate: 2.2, reach: 28, arc: 120, mana: 2, color: "#dbe7f3" },
        staff: { name: "Arcane Staff", icon: "🪄", kind: "orb", dmg: 10, rate: 1.7, speed: 150, range: 170, mana: 8, color: "#c99bff" },
        bow: { name: "Bow", icon: "🏹", kind: "shot", dmg: 8, rate: 2.2, speed: 270, range: 210, mana: 4, color: "#e8d3a6", pierce: 1 },
        torch: { name: "Torch", icon: "🔥", kind: "flame", dmg: 3, rate: 9, reach: 34, arc: 50, mana: 1, color: "#ff8a2f" },
        // 🎒 found in the Keep — the game's troops' own weapons (for that run)
        lance: { name: "Lancer's Lance", icon: "🔱", kind: "thrust", dmg: 16, rate: 1.6, reach: 44, arc: 26, mana: 5, color: "#e0e6ee", find: true },
        axes: { name: "Axe-Thrower's Axes", icon: "🪓", kind: "spin", dmg: 12, rate: 1.5, speed: 190, range: 160, mana: 7, color: "#b9c2cc", pierce: 2, find: true },
        bombs: { name: "Bomber's Bombs", icon: "💣", kind: "lob", dmg: 20, rate: 0.9, range: 150, blast: 30, mana: 14, color: "#3a3a46", find: true },
        longbow: { name: "Archer's Longbow", icon: "🏹", kind: "shot", dmg: 13, rate: 1.6, speed: 330, range: 260, mana: 7, color: "#f2d38a", pierce: 2, find: true },
        skulls: { name: "Necromancer's Skull Staff", icon: "💀", kind: "orb", dmg: 11, rate: 2.2, speed: 140, range: 180, mana: 6, color: "#9effb0", find: true },
        rocket: { name: "Pyrotechnician's Rockets", icon: "🎆", kind: "lob", dmg: 15, rate: 1.4, range: 180, blast: 24, mana: 9, color: "#ff5a5a", find: true }
    };
    const FIND_WEAPONS = Object.keys(WEAPONS).filter(k => WEAPONS[k].find);
    // what you hold → which weapon it fights as (looks from character-core.js WEAR)
    const HELD_WEAPON = { sword: "sword", broom: "sword", pinwheel: "sword", bread: "sword", staff: "staff", quill: "staff", scroll: "staff", lantern: "staff",
        bow: "bow", cupidbow: "bow", torch: "torch" };
    function weaponFor(heldId) {
        const w = heldId && C && C.wearOf ? C.wearOf(heldId) : null;
        return (w && HELD_WEAPON[w.look]) || "sling";
    }
    // Your stats in the Keep, from the outfit you wear (as character-core.js cleans it).
    function statsOf(outfit) {
        const wear = (outfit && outfit.wear) || {};
        const s = { ...BASE };
        Object.keys(STATS_BY_SLOT).forEach(slot => {
            const t = tierOf(wear[slot]);
            if (!t) return;
            Object.entries(STATS_BY_SLOT[slot]).forEach(([k, v]) => { s[k] += v * t; });
        });
        Object.keys(CAPS).forEach(k => { s[k] = Math.min(CAPS[k], s[k]); });
        const petTier = tierOf(wear.pet);
        return { ...s, weapon: weaponFor(wear.held), weaponTier: tierOf(wear.held), pet: wear.pet || null, petDmg: petTier ? 2 + petTier * 2 : 0 };
    }

    /* ---------------- who you fight ----------------
       ai: chase · ranged (keeps away and shoots) · kamikaze (rushes, bursts) ·
       leap (jumps onto you) · guard (a shield in front). An elite (a hunt's
       quarry) is one of these, bigger and much tougher (ELITE). */
    const ENEMIES = {
        imp: { name: "Imp", hp: 10, speed: 82, r: 6, ai: "chase", touch: 6, gold: [1, 2], color: "#e0453a" },
        boneWarrior: { name: "Bone Warrior", hp: 24, speed: 44, r: 7, ai: "chase", touch: 10, gold: [1, 3], color: "#e8e2d0" },
        spearthrower: { name: "Bone Spearthrower", hp: 16, speed: 34, r: 7, ai: "ranged", shot: { dmg: 8, speed: 140, every: 1.9 }, gold: [2, 3], color: "#d8d0b8" },
        axeThrower: { name: "Axe Thrower", hp: 20, speed: 36, r: 7, ai: "ranged", shot: { dmg: 9, speed: 120, every: 2.2, spin: true }, gold: [2, 3], color: "#8a5a2b" },
        spider: { name: "Explosive Spider", hp: 8, speed: 95, r: 5, ai: "kamikaze", boom: { dmg: 16, r: 26 }, gold: [1, 2], color: "#2a2433" },
        ironGuard: { name: "Iron Guard", hp: 46, speed: 30, r: 9, ai: "guard", touch: 12, gold: [3, 5], color: "#8d97a8" },
        toad: { name: "Giant Toad", hp: 34, speed: 0, r: 9, ai: "leap", leap: { dmg: 14, r: 22, every: 2.4 }, gold: [3, 4], color: "#5f8f3a" },
        // the bosses' own (they summon them)
        spiderling: { name: "Spiderling", hp: 6, speed: 90, r: 4, ai: "chase", touch: 5, gold: [0, 1], color: "#3a2a4a" },
        iceGuardian: { name: "Ice Guardian", hp: 30, speed: 0, r: 8, ai: "ranged", shot: { dmg: 8, speed: 160, every: 1.6, bolt: true }, gold: [1, 2], color: "#8fd8ff" }
    };
    const ELITE = { hp: 4, size: 1.4, dmg: 1.5, drops: 4 };
    // crates and barrels in the buildings: break them for loot
    const PROPS = { crate: { name: "Crate", hp: 6, r: 6 }, barrel: { name: "Barrel", hp: 8, r: 6 } };
    // the boss's floor theme, and their attacks (the page plays them)
    const BOSSES = {
        ashira: { name: "Ashira, the Spider Queen", icon: "🕷️", hp: 620, r: 18, speed: 26, theme: "swamp", attacks: ["webVolley", "summonSpiders", "poisonPuddles", "reflectAura"], color: "#4a2a6a" },
        shaiKhold: { name: "Shai-Khold, the Ice Snake", icon: "❄️", hp: 660, r: 18, speed: 30, theme: "ice", attacks: ["iceNeedles", "summonGuardians", "frostRing"], color: "#5ab8e8" },
        kalidor: { name: "Kalidor of the Sands", icon: "🏜️", hp: 700, r: 19, speed: 24, theme: "desert", attacks: ["sandTraps", "hammerThrow", "spearLines"], color: "#c8963a" },
        rattlebones: { name: "Captain Rattlebones", icon: "💀", hp: 520, r: 17, speed: 30, theme: "outskirts", attacks: ["boneVolley", "summonBones", "charge"], color: "#e8e2d0" }
    };
    const BOSS_ORDER = ["rattlebones", "ashira", "kalidor", "shaiKhold"]; // (the story's order)
    const THEMES = {
        outskirts: { floor: "#4a5a36", floor2: "#435232", wall: "#2a2218", wallTop: "#7a6448", name: "The Fallen Outskirts" },
        keep: { floor: "#3a3550", floor2: "#342f49", wall: "#1d1a2b", wallTop: "#544c74", name: "The Keep" },
        swamp: { floor: "#2f3d2c", floor2: "#2a3727", wall: "#151d14", wallTop: "#4a6140", name: "The Webbed Marsh" },
        ice: { floor: "#3a4f66", floor2: "#34485e", wall: "#18222f", wallTop: "#7fa6c8", name: "The Frozen Halls" },
        desert: { floor: "#6b5634", floor2: "#634f2f", wall: "#2e2414", wallTop: "#a3854f", name: "The Sunken Sands" }
    };

    const GRID = 4; // (the world's grid: 4 × 4 cells of tiles — one open map fills it)

    /* ---------------- loot ----------------
       What dies (or breaks) drops something; luck (your necklace…) makes it
       more. Gold is for this run (the merchant); ✨ / 💗 / 🪙 are yours. */
    const LOOT = {
        enemy: { stardust: { chance: 0.06, amount: [3, 6] }, mana: { chance: 0.4, amount: [5, 10] }, potion: 0.04, manaPotion: 0.03, heart: 0.02, token: 0.004, weapon: 0.012, recipe: 0.025 },
        prop: { gold: [1, 3], potion: 0.18, manaPotion: 0.22, mana: 0.4, recipe: 0.05 },
        boss: { gold: [30, 45], stardust: [120, 200], tokens: [2, 5], hearts: [5, 10], gearChance: 0.15 },
        chest: { gold: [10, 18], stardust: [10, 20] },
        potionHeal: 0.35, manaPotion: 0.5, // of your max HP / mana
        manaRegen: 0.8, manaRegenDelay: 1.5, // a second — only once you've stopped attacking for manaRegenDelay s
        merchant: { potion: 15, manaPotion: 12, weapon: 40 }
    };
    function rollDrop(type, r, luck) {
        const e = ENEMIES[type];
        const L = LOOT.enemy, mult = 1 + Math.max(0, luck || 0) / 100;
        const out = [];
        const coins = between(r, e.gold[0], e.gold[1]) + (r() < (mult - 1) ? 1 : 0);
        for (let i = 0; i < coins; i++) out.push({ kind: "gold", amount: 1 });
        if (r() < L.mana.chance) out.push({ kind: "mana", amount: between(r, L.mana.amount[0], L.mana.amount[1]) });
        if (r() < L.stardust.chance * mult) out.push({ kind: "stardust", amount: between(r, L.stardust.amount[0], L.stardust.amount[1]) });
        if (r() < L.potion * mult) out.push({ kind: "potion" });
        if (r() < L.manaPotion * mult) out.push({ kind: "manaPotion" });
        if (r() < L.heart * mult) out.push({ kind: "heart", amount: 1 });
        if (r() < L.token * mult) out.push({ kind: "token", amount: 1 }); // a big one!
        if (r() < L.weapon * mult) out.push({ kind: "weapon", weapon: pick(r, FIND_WEAPONS) });
        if (r() < L.recipe * mult) out.push({ kind: "recipe" }); // 📜 teaches a fusion
        return out;
    }
    function rollProp(r, luck) {
        const L = LOOT.prop, mult = 1 + Math.max(0, luck || 0) / 100, out = [];
        for (let i = 0, n = between(r, L.gold[0], L.gold[1]); i < n; i++) out.push({ kind: "gold", amount: 1 });
        if (r() < L.potion * mult) out.push({ kind: "potion" });
        if (r() < L.manaPotion * mult) out.push({ kind: "manaPotion" });
        if (r() < L.mana) out.push({ kind: "mana", amount: 8 });
        if (r() < L.recipe * mult) out.push({ kind: "recipe" });
        return out;
    }
    function rollBoss(r, luck) {
        const B = LOOT.boss, mult = 1 + Math.max(0, luck || 0) / 100;
        const out = [{ kind: "gold", amount: between(r, B.gold[0], B.gold[1]) }, { kind: "stardust", amount: Math.round(between(r, B.stardust[0], B.stardust[1]) * mult) },
            { kind: "token", amount: between(r, B.tokens[0], B.tokens[1]) }, { kind: "heart", amount: between(r, B.hearts[0], B.hearts[1]) }];
        if (r() < B.gearChance * mult) out.push({ kind: "gear" }); // a chest draw — something to wear, for keeps
        out.push({ kind: "recipe" }); // 📜 a boss always has one
        return out;
    }

    /* ================= 🎒 the Keep's things · ⚗️ fusion · 🌲 the Wilds ================= */
    // kind: mat (fuse it) · potion (carried — drinks itself when you need it) · gear (worn in a gear slot) · bag (makes the bag bigger)
    // 🪙 the first time you have each of these: paid by the server (api/progress.js keepFinds), once per thing per account
    const FIND_TOKENS = 1;
    const ITEMS = {
        // materials: each monster has its own; the Wilds grow the rest
        bone: { kind: "mat", icon: "🦴", name: "Bone", rarity: "common", from: "Bone warriors and spearthrowers" },
        fang: { kind: "mat", icon: "🦷", name: "Imp fang", rarity: "common", from: "Imps" },
        silk: { kind: "mat", icon: "🕸️", name: "Spider silk", rarity: "common", from: "Spiders and spiderlings" },
        herb: { kind: "mat", icon: "🌿", name: "Healing herb", rarity: "common", from: "The Farmlands and the Spider Woods" },
        shroom: { kind: "mat", icon: "🍄", name: "Glow mushroom", rarity: "common", from: "The Spider Woods" },
        axehead: { kind: "mat", icon: "🪓", name: "Axe head", rarity: "uncommon", from: "Axe throwers" },
        iron: { kind: "mat", icon: "⛓️", name: "Iron scrap", rarity: "uncommon", from: "Iron guards" },
        slime: { kind: "mat", icon: "🫧", name: "Toad slime", rarity: "uncommon", from: "Giant toads" },
        ore: { kind: "mat", icon: "🪨", name: "Ore", rarity: "uncommon", from: "The raiders' camp, the Sunken Dunes, the Frost Peaks" },
        frost: { kind: "mat", icon: "❄️", name: "Frost crystal", rarity: "rare", from: "Ice guardians; the Frost Peaks" },
        ember: { kind: "mat", icon: "🔥", name: "Ember", rarity: "rare", from: "Imps, now and then" },
        queenSilk: { kind: "mat", icon: "👑", name: "Queen's silk", rarity: "epic", from: "Ashira, the Spider Queen" },
        sandCore: { kind: "mat", icon: "⏳", name: "Sand core", rarity: "epic", from: "Kalidor of the Sands" },
        frostHeart: { kind: "mat", icon: "💠", name: "Frost heart", rarity: "epic", from: "Shai-Khold" },
        captainJaw: { kind: "mat", icon: "☠️", name: "Rattlebones' jaw", rarity: "epic", from: "Captain Rattlebones" },
        slag: { kind: "mat", icon: "🪨", name: "Slag", rarity: "common", from: "A fusion of two things that don't go together", junk: true },
        // materials you make in the furnace (for the better things)
        ironIngot: { kind: "mat", icon: "🔩", name: "Iron ingot", rarity: "rare", from: "The furnace: iron scrap + iron scrap" },
        silkThread: { kind: "mat", icon: "🧵", name: "Silk thread", rarity: "uncommon", from: "The furnace: spider silk + a healing herb" },
        emberCore: { kind: "mat", icon: "🌋", name: "Ember core", rarity: "rare", from: "The furnace: ember + ember" },
        glacierGlass: { kind: "mat", icon: "🧊", name: "Glacier glass", rarity: "epic", from: "The furnace: frost crystal + frost crystal" },
        toxicGel: { kind: "mat", icon: "☣️", name: "Toxic gel", rarity: "uncommon", from: "The furnace: toad slime + a glow mushroom" },
        // potions: carried; they drink themselves when you need them
        hpPot: { kind: "potion", color: "#ff4f6a", name: "Health potion", rarity: "common", heal: 0.35, desc: "Heals 35% — drinks itself when your HP drops below 30%." },
        mpPot: { kind: "potion", color: "#3a8bff", name: "Mana potion", rarity: "common", mana: 0.5, desc: "Refills half your mana — drinks itself when you run out." },
        bigHp: { kind: "potion", color: "#d6246e", name: "Greater health potion", rarity: "rare", heal: 0.7, desc: "Heals 70% — drinks itself when your HP drops below 30%." },
        bigMp: { kind: "potion", color: "#1f5fd6", name: "Greater mana potion", rarity: "rare", mana: 1, desc: "Fills your mana — drinks itself when you run out." },
        twinPot: { kind: "potion", color: "#a35cff", name: "Twin potion", rarity: "uncommon", heal: 0.35, mana: 0.5, desc: "Heals 35% and refills half your mana — drinks itself when you're low on either." },
        greaterTwin: { kind: "potion", color: "#7a2fe0", name: "Greater twin potion", rarity: "rare", heal: 0.7, mana: 1, desc: "Heals 70% and fills your mana — drinks itself when you're low on either." },
        lifeElixir: { kind: "potion", color: "#ffb02e", name: "Elixir of life", rarity: "epic", heal: 1, desc: "Heals you to full — drinks itself when your HP drops below 30%." },
        // gear: weapons (your weapon — and more damage), armour, charms
        boneClub: { kind: "gear", slot: "weapon", icon: "🦴", name: "Bone Club", rarity: "common", weapon: "sword", add: { dmg: 8 } },
        fangDagger: { kind: "gear", slot: "weapon", icon: "🗡️", name: "Imp-fang Dagger", rarity: "uncommon", weapon: "sword", add: { dmg: 10, crit: 4 } },
        silkBow: { kind: "gear", slot: "weapon", icon: "🏹", name: "Silk Bow", rarity: "uncommon", weapon: "bow", add: { dmg: 10 } },
        balancedAxes: { kind: "gear", slot: "weapon", icon: "🪓", name: "Balanced Axes", rarity: "rare", weapon: "axes", add: { dmg: 14 } },
        ironMace: { kind: "gear", slot: "weapon", icon: "🔨", name: "Iron Mace", rarity: "rare", weapon: "sword", add: { dmg: 20 } },
        emberStaff: { kind: "gear", slot: "weapon", icon: "🪄", name: "Ember Staff", rarity: "rare", weapon: "staff", add: { dmg: 16 } },
        frostBow: { kind: "gear", slot: "weapon", icon: "🏹", name: "Frostbow", rarity: "epic", weapon: "longbow", add: { dmg: 20, crit: 5 } },
        queenBow: { kind: "gear", slot: "weapon", icon: "🏹", name: "Spider Queen's Bow", rarity: "legendary", weapon: "longbow", add: { dmg: 30, crit: 8, luck: 10 } },
        duneBreaker: { kind: "gear", slot: "weapon", icon: "🔱", name: "Dune Breaker", rarity: "legendary", weapon: "lance", add: { dmg: 30, def: 8 } },
        frostScepter: { kind: "gear", slot: "weapon", icon: "💀", name: "Frost Scepter", rarity: "legendary", weapon: "skulls", add: { dmg: 28, mana: 40 } },
        boneReaver: { kind: "gear", slot: "weapon", icon: "🗡️", name: "Bone Reaver", rarity: "legendary", weapon: "sword", add: { dmg: 28, crit: 6 } },
        skullStaff: { kind: "gear", slot: "weapon", icon: "💀", name: "Bone Skull Staff", rarity: "rare", weapon: "skulls", add: { dmg: 15, mana: 15 } },
        venomBow: { kind: "gear", slot: "weapon", icon: "🏹", name: "Venom Bow", rarity: "rare", weapon: "bow", add: { dmg: 14, crit: 4 } },
        ironSword: { kind: "gear", slot: "weapon", icon: "🗡️", name: "Iron Sword", rarity: "rare", weapon: "sword", add: { dmg: 16, crit: 3 } },
        ironLance: { kind: "gear", slot: "weapon", icon: "🔱", name: "Iron Lance", rarity: "rare", weapon: "lance", add: { dmg: 18, def: 3 } },
        emberBrand: { kind: "gear", slot: "weapon", icon: "🔥", name: "Ember Brand", rarity: "rare", weapon: "torch", add: { dmg: 15 } },
        toadBombs: { kind: "gear", slot: "weapon", icon: "💣", name: "Toad Bombs", rarity: "rare", weapon: "bombs", add: { dmg: 16 } },
        steelMace: { kind: "gear", slot: "weapon", icon: "🔨", name: "Steel Mace", rarity: "epic", weapon: "sword", add: { dmg: 26 } },
        huntersAxes: { kind: "gear", slot: "weapon", icon: "🪓", name: "Hunter's Axes", rarity: "epic", weapon: "axes", add: { dmg: 22, crit: 4 } },
        rocketPack: { kind: "gear", slot: "weapon", icon: "🚀", name: "Rocket Pack", rarity: "epic", weapon: "rocket", add: { dmg: 22 } },
        glacierStaff: { kind: "gear", slot: "weapon", icon: "🪄", name: "Glacier Staff", rarity: "epic", weapon: "staff", add: { dmg: 22, mana: 20 } },
        captainsCutlass: { kind: "gear", slot: "weapon", icon: "⚔️", name: "Captain's Cutlass", rarity: "legendary", weapon: "sword", add: { dmg: 30, luck: 8 } },
        webweaverStaff: { kind: "gear", slot: "weapon", icon: "🪄", name: "Webweaver Staff", rarity: "legendary", weapon: "staff", add: { dmg: 28, mana: 30, crit: 5 } },
        sandstormRockets: { kind: "gear", slot: "weapon", icon: "🚀", name: "Sandstorm Rockets", rarity: "legendary", weapon: "rocket", add: { dmg: 32 } },
        wintersBite: { kind: "gear", slot: "weapon", icon: "🪓", name: "Winter's Bite", rarity: "legendary", weapon: "axes", add: { dmg: 30, crit: 6 } },
        bonePlate: { kind: "gear", slot: "armour", icon: "🦺", name: "Bone Plate", rarity: "common", add: { def: 6 } },
        silkCloak: { kind: "gear", slot: "armour", icon: "🧥", name: "Silk Cloak", rarity: "uncommon", add: { def: 4, speed: 6 } },
        chainShirt: { kind: "gear", slot: "armour", icon: "🎽", name: "Chain Shirt", rarity: "uncommon", add: { def: 8, hp: 15 } },
        ironPlate: { kind: "gear", slot: "armour", icon: "🛡️", name: "Iron Plate", rarity: "rare", add: { def: 12 } },
        knightMail: { kind: "gear", slot: "armour", icon: "🛡️", name: "Knight's Mail", rarity: "epic", add: { def: 18, hp: 30 } },
        threadVest: { kind: "gear", slot: "armour", icon: "🦺", name: "Thread Vest", rarity: "uncommon", add: { def: 5, speed: 4 } },
        emberMail: { kind: "gear", slot: "armour", icon: "🧯", name: "Ember Mail", rarity: "rare", add: { def: 10, dmg: 4 } },
        frostGuard: { kind: "gear", slot: "armour", icon: "🛡️", name: "Frost Guard", rarity: "epic", add: { def: 16, mana: 20 } },
        raiderCoat: { kind: "gear", slot: "armour", icon: "🧥", name: "Raider King's Coat", rarity: "legendary", add: { def: 22, hp: 40 } },
        queenRobe: { kind: "gear", slot: "armour", icon: "👘", name: "Queen's Silk Robe", rarity: "legendary", add: { def: 14, speed: 12, luck: 8 } },
        fangCharm: { kind: "gear", slot: "charm", icon: "🦷", name: "Lucky Fang", rarity: "uncommon", add: { luck: 10 } },
        toadAmulet: { kind: "gear", slot: "charm", icon: "🧿", name: "Toad Amulet", rarity: "uncommon", add: { hp: 20 } },
        emberCharm: { kind: "gear", slot: "charm", icon: "📿", name: "Ember Charm", rarity: "rare", add: { dmg: 6 } },
        frostRing: { kind: "gear", slot: "charm", icon: "💍", name: "Frost Ring", rarity: "rare", add: { mana: 30 } },
        phoenixCharm: { kind: "gear", slot: "charm", icon: "🪶", name: "Phoenix Charm", rarity: "epic", add: { dmg: 10, luck: 10, crit: 5 } },
        herbPouch: { kind: "gear", slot: "charm", icon: "🌱", name: "Herb Pouch", rarity: "uncommon", add: { hp: 15 } },
        venomCharm: { kind: "gear", slot: "charm", icon: "🐍", name: "Venom Charm", rarity: "rare", add: { crit: 6 } },
        ironBand: { kind: "gear", slot: "charm", icon: "⭕", name: "Iron Band", rarity: "rare", add: { def: 5, hp: 10 } },
        sunAmulet: { kind: "gear", slot: "charm", icon: "☀️", name: "Sun Amulet", rarity: "epic", add: { dmg: 8, hp: 20 } },
        starCharm: { kind: "gear", slot: "charm", icon: "🌟", name: "Star of Hearthmoor", rarity: "legendary", add: { luck: 15, crit: 8, dmg: 8 } },
        // a bigger bag
        satchel: { kind: "bag", icon: "👜", name: "Sturdy Satchel", rarity: "rare", slots: 5, desc: "+5 bag slots — used the moment it's made." },
        threadPouch: { kind: "bag", icon: "👝", name: "Thread Pouch", rarity: "uncommon", slots: 3, desc: "+3 bag slots — used the moment it's made." },
        explorerPack: { kind: "bag", icon: "🎒", name: "Explorer's Pack", rarity: "epic", slots: 10, desc: "+10 bag slots — used the moment it's made." }
    };
    const GEAR_SLOTS = [{ id: "weapon", icon: "⚔️", name: "Weapon" }, { id: "armour", icon: "🛡️", name: "Armour" }, { id: "charm", icon: "💍", name: "Charm" }];
    // 🔥 A + B → C (either way round), and the chance it works. A failure loses the materials and potions; gear drops a level (Lv 1 gear breaks)
    const RECIPES = [
        ["herb", "herb", "hpPot", 0.95], ["shroom", "herb", "mpPot", 0.95], ["hpPot", "slime", "bigHp", 0.7],
        ["hpPot", "mpPot", "twinPot", 0.85], ["hpPot", "hpPot", "bigHp", 0.6], ["mpPot", "mpPot", "bigMp", 0.6], ["fangDagger", "captainJaw", "boneReaver", 0.25],
        ["bone", "bone", "boneClub", 0.85], ["fang", "bone", "fangDagger", 0.75], ["silk", "bone", "silkBow", 0.75],
        ["axehead", "iron", "balancedAxes", 0.6], ["boneClub", "iron", "ironMace", 0.6], ["ember", "shroom", "emberStaff", 0.55],
        ["silkBow", "frost", "frostBow", 0.45], ["frostBow", "queenSilk", "queenBow", 0.25], ["ironMace", "sandCore", "duneBreaker", 0.25], ["emberStaff", "frostHeart", "frostScepter", 0.25],
        ["bone", "iron", "bonePlate", 0.8], ["silk", "silk", "silkCloak", 0.8], ["iron", "silk", "chainShirt", 0.7],
        ["iron", "ore", "ironPlate", 0.6], ["ironPlate", "chainShirt", "knightMail", 0.4],
        ["fang", "shroom", "fangCharm", 0.75], ["slime", "herb", "toadAmulet", 0.75], ["ember", "ore", "emberCharm", 0.6],
        ["frost", "ore", "frostRing", 0.55], ["emberCharm", "fangCharm", "phoenixCharm", 0.35],
        ["silk", "slime", "satchel", 0.6], ["satchel", "queenSilk", "explorerPack", 0.5],
        // made materials
        ["iron", "iron", "ironIngot", 0.8], ["silk", "herb", "silkThread", 0.85], ["ember", "ember", "emberCore", 0.6], ["frost", "frost", "glacierGlass", 0.5], ["slime", "shroom", "toxicGel", 0.8],
        // potions
        ["twinPot", "twinPot", "greaterTwin", 0.6], ["bigHp", "frost", "lifeElixir", 0.45],
        // weapons
        ["bone", "shroom", "skullStaff", 0.6], ["silkBow", "toxicGel", "venomBow", 0.55], ["ironIngot", "bone", "ironSword", 0.7], ["ironIngot", "ore", "ironLance", 0.6],
        ["ember", "boneClub", "emberBrand", 0.6], ["slime", "ember", "toadBombs", 0.55], ["ironMace", "ironIngot", "steelMace", 0.45], ["balancedAxes", "ironIngot", "huntersAxes", 0.45],
        ["emberCore", "ironIngot", "rocketPack", 0.4], ["emberStaff", "glacierGlass", "glacierStaff", 0.4],
        ["ironSword", "captainJaw", "captainsCutlass", 0.25], ["glacierStaff", "queenSilk", "webweaverStaff", 0.25], ["rocketPack", "sandCore", "sandstormRockets", 0.25], ["huntersAxes", "frostHeart", "wintersBite", 0.25],
        // armour
        ["silkThread", "bone", "threadVest", 0.8], ["chainShirt", "ember", "emberMail", 0.55], ["ironPlate", "glacierGlass", "frostGuard", 0.45], ["knightMail", "captainJaw", "raiderCoat", 0.25], ["silkCloak", "queenSilk", "queenRobe", 0.3],
        // charms
        ["herb", "silkThread", "herbPouch", 0.85], ["toxicGel", "fang", "venomCharm", 0.6], ["ironIngot", "silkThread", "ironBand", 0.65], ["emberCore", "toadAmulet", "sunAmulet", 0.45], ["phoenixCharm", "frostHeart", "starCharm", 0.25],
        // bags
        ["silkThread", "silkThread", "threadPouch", 0.8]
    ];
    const recipeFor = (a, b) => RECIPES.find(r => (r[0] === a && r[1] === b) || (r[0] === b && r[1] === a)) || null;
    /* ⬆️ gear levels: a piece of the Keep's gear grows with use — XP from what
       you beat while wearing it; rarer gear goes higher; each level adds 6% to
       its stats. Levelled gear fuses with a better chance (+2% a level past 1),
       a failure only knocks a level off it (Lv 1 gear breaks), and what the
       furnace makes starts at half the best level that went in. */
    const LEVELS = { cap: { common: 5, uncommon: 8, rare: 12, epic: 16, legendary: 20 }, per: 0.06, xp: { enemy: 4, elite: 25, boss: 120 }, fuseBonus: 0.02, maxChance: 0.95 };
    const isGear = (id) => Object.prototype.hasOwnProperty.call(ITEMS, id) && ITEMS[id].kind === "gear";
    const levelCap = (id) => (isGear(id) ? LEVELS.cap[ITEMS[id].rarity] || 5 : 1);
    const xpToNext = (lv) => 20 * lv;
    // a piece of gear, worn or carried: { id, lv, xp } (an old save's plain id → Lv 1)
    function gearEntry(x) {
        const id = typeof x === "string" ? x : x && x.id;
        if (!isGear(id)) return null;
        const cap = levelCap(id), lv = Math.max(1, Math.min(cap, Math.floor(Number(x && x.lv) || 1)));
        const xp = lv >= cap ? 0 : Math.max(0, Math.min(xpToNext(lv) - 1, Math.floor(Number(x && x.xp) || 0)));
        return { id, lv, xp };
    }
    // what a piece adds at its level
    const gearAdd = (id, lv) => { const k = 1 + LEVELS.per * (Math.max(1, Math.min(levelCap(id), lv || 1)) - 1); return Object.fromEntries(Object.entries((ITEMS[id] && ITEMS[id].add) || {}).map(([s, v]) => [s, Math.round(v * k)])); };
    /* ⭐ you level up too: the same XP as your gear (what you beat), 30 × your
       level to the next one, up to Lv 30. Each level past 1: +3 ❤️ HP, +2 🔷
       mana, +1% ⚔️ damage; +1% 🛡️ defense every 2 levels, +1% 🎯 crit every 3
       (the caps still hold). */
    const HERO = { cap: 30, per: { hp: 3, mana: 2, dmg: 1 }, every: { def: 2, crit: 3 } };
    const heroNext = (lv) => 30 * lv;
    function heroEntry(x) {
        const lv = Math.max(1, Math.min(HERO.cap, Math.floor(Number(x && x.lv) || 1)));
        const xp = lv >= HERO.cap ? 0 : Math.max(0, Math.min(heroNext(lv) - 1, Math.floor(Number(x && x.xp) || 0)));
        return { lv, xp };
    }
    // what your level adds
    function heroAdd(lv) {
        const n = Math.max(1, Math.min(HERO.cap, Math.floor(Number(lv) || 1))) - 1, out = {};
        Object.entries(HERO.per).forEach(([k, v]) => { out[k] = v * n; });
        Object.entries(HERO.every).forEach(([k, v]) => { out[k] = Math.floor(n / v); });
        return out;
    }
    function heroStats(st, lv) {
        const out = { ...st };
        Object.entries(heroAdd(lv)).forEach(([k, v]) => { out[k] = (out[k] || 0) + v; });
        Object.keys(CAPS).forEach(k => { out[k] = Math.min(CAPS[k], out[k]); });
        return out;
    }
    // XP for you: how many levels you went up (it stops at Lv 30)
    function heroXp(e, n) {
        let ups = 0;
        if (e.lv >= HERO.cap) { e.xp = 0; return 0; }
        e.xp += Math.max(0, Math.floor(n || 0));
        while (e.lv < HERO.cap && e.xp >= heroNext(e.lv)) { e.xp -= heroNext(e.lv); e.lv++; ups++; }
        if (e.lv >= HERO.cap) e.xp = 0;
        return ups;
    }
    // XP into a piece of gear: how many levels it went up (it stops at its cap)
    function addXp(e, n) {
        const cap = levelCap(e.id); let ups = 0;
        if (e.lv >= cap) { e.xp = 0; return 0; }
        e.xp += Math.max(0, Math.floor(n || 0));
        while (e.lv < cap && e.xp >= xpToNext(e.lv)) { e.xp -= xpToNext(e.lv); e.lv++; ups++; }
        if (e.lv >= cap) e.xp = 0;
        return ups;
    }
    // the chance, with levelled gear going in (never past 95%, never below the recipe's own)
    const levelBonus = (...lvs) => LEVELS.fuseBonus * lvs.reduce((a, lv) => a + Math.max(0, (lv || 1) - 1), 0);
    const fuseChance = (rec, bonus) => Math.min(LEVELS.maxChance, Math.max(rec[3], rec[3] + (bonus || 0)));
    // fuse two things: { ok, out } — or { ok: false } (it fizzled) — or, two that don't go together, 🪨 slag ({ junk: true })
    function fuse(a, b, r, bonus) {
        const rec = recipeFor(a, b);
        if (!rec) return { ok: true, out: "slag", junk: true };
        const chance = fuseChance(rec, bonus);
        return r() < chance ? { ok: true, out: rec[2], chance } : { ok: false, chance };
    }
    // what's left of a thing after a failed fusion (or slag): gear a level down — Lv 1 gear breaks; anything else is gone
    const afterFail = (e) => (e && isGear(e.id) && e.lv > 1 ? { id: e.id, lv: e.lv - 1, xp: 0 } : null);
    // what the furnace makes starts at half the best level that went in
    const startLevel = (out, lvs) => Math.max(1, Math.min(levelCap(out), Math.ceil(Math.max(1, ...(lvs || [])) / 2)));
    // 📜 a recipe found: one you don't know yet (the commoner ones more often) — or null, you know them all
    function recipeToLearn(known, r) {
        const W = { common: 5, uncommon: 4, rare: 3, epic: 2, legendary: 1 };
        const outs = [...new Set(RECIPES.map(x => x[2]))].filter(id => !(known && known[id]));
        if (!outs.length) return null;
        let t = r() * outs.reduce((a, id) => a + W[ITEMS[id].rarity], 0);
        for (const id of outs) { t -= W[ITEMS[id].rarity]; if (t < 0) return id; }
        return outs[outs.length - 1];
    }
    // what each monster drops (on top of shards); a boss always leaves its own
    const MAT_DROPS = {
        imp: [["fang", 0.35], ["ember", 0.04]], boneWarrior: [["bone", 0.4]], spearthrower: [["bone", 0.4]], axeThrower: [["axehead", 0.3]],
        spider: [["silk", 0.35]], spiderling: [["silk", 0.2]], ironGuard: [["iron", 0.4]], toad: [["slime", 0.4]], iceGuardian: [["frost", 0.3]],
        ashira: [["queenSilk", 1]], kalidor: [["sandCore", 1]], shaiKhold: [["frostHeart", 1]], rattlebones: [["captainJaw", 1]]
    };
    function rollMats(type, r, luck) {
        const mult = 1 + Math.max(0, luck || 0) / 100;
        return (MAT_DROPS[type] || []).filter(([, p]) => r() < Math.min(1, p * mult)).map(([id]) => id);
    }
    // 🎒 the bag: `slots` (20 to start; a satchel adds more); the same material or potion stacks up to 10 a slot
    const BAG = { start: 20, stack: 10, max: 50 };
    const stackOf = (id) => (ITEMS[id] && (ITEMS[id].kind === "mat" || ITEMS[id].kind === "potion") ? BAG.stack : 1);
    function cleanBag(b) {
        const slots = Math.max(BAG.start, Math.min(BAG.max, Math.floor(Number(b && b.slots) || BAG.start)));
        const items = (Array.isArray(b && b.items) ? b.items : []).filter(x => x && Object.prototype.hasOwnProperty.call(ITEMS, x.id) && x.n >= 1)
            .map(x => (isGear(x.id) ? { n: 1, ...gearEntry(x) } : { id: x.id, n: Math.min(stackOf(x.id), Math.floor(x.n)) })).slice(0, slots);
        return { slots, items };
    }
    const bagCount = (b, id) => b.items.filter(x => x.id === id).reduce((a, x) => a + x.n, 0);
    // as many as fit (topping up stacks first): how many went in. Gear goes in one a slot, at its level (`lv`: { lv, xp })
    function bagAdd(b, id, n, lv) {
        let left = Math.max(0, Math.floor(n == null ? 1 : n));
        const cap = stackOf(id);
        for (const x of b.items) if (left && cap > 1 && x.id === id && x.n < cap) { const k = Math.min(cap - x.n, left); x.n += k; left -= k; }
        while (left && b.items.length < b.slots) { const k = Math.min(cap, left); b.items.push(isGear(id) ? { n: 1, ...gearEntry({ id, ...(lv || {}) }) } : { id, n: k }); left -= k; }
        return (n == null ? 1 : n) - left;
    }
    // everything of one kind from one bag to another (the chest), as much as fits — gear keeps its level. How many moved.
    function bagMoveAll(from, to, id) {
        if (stackOf(id) > 1) { const went = bagAdd(to, id, bagCount(from, id)); if (went) bagTake(from, id, went); return went; }
        let went = 0;
        for (let i = 0; i < from.items.length;) { const x = from.items[i]; if (x.id === id && to.items.length < to.slots) { to.items.push(x); from.items.splice(i, 1); went++; } else i++; }
        return went;
    }
    // take n out (all or nothing)
    function bagTake(b, id, n) {
        let left = Math.max(1, Math.floor(n == null ? 1 : n));
        if (bagCount(b, id) < left) return false;
        for (let i = b.items.length - 1; i >= 0 && left; i--) { const x = b.items[i]; if (x.id !== id) continue; const k = Math.min(x.n, left); x.n -= k; left -= k; if (!x.n) b.items.splice(i, 1); }
        return true;
    }
    // 🔶 what the shop pays for one (the Store's things are never sold here)
    const SELL = { mat: { common: 2, uncommon: 5, rare: 12, epic: 30, legendary: 60 }, potion: { common: 8, uncommon: 14, rare: 20, epic: 30, legendary: 40 },
        gear: { common: 12, uncommon: 25, rare: 50, epic: 110, legendary: 260 }, bag: { common: 20, uncommon: 30, rare: 40, epic: 60, legendary: 80 } };
    const sellPrice = (id, lv) => { const it = Object.prototype.hasOwnProperty.call(ITEMS, id) ? ITEMS[id] : null; if (!it) return 0; if (it.junk) return 1; const base = SELL[it.kind][it.rarity] || 1;
        return it.kind === "gear" ? Math.round(base * (1 + 0.25 * (Math.max(1, Math.min(levelCap(id), lv || 1)) - 1))) : base; };
    const bagFull = (b, id) => b.items.length >= b.slots && !b.items.some(x => x.id === id && x.n < stackOf(id));
    // your stats with the Keep's gear on (a gear weapon is your weapon)
    function gearStats(st, gear) {
        const out = { ...st };
        GEAR_SLOTS.forEach(g => {
            const e = gearEntry(gear && gear[g.id]), it = e && ITEMS[e.id];
            if (!it || it.slot !== g.id) return;
            Object.entries(gearAdd(e.id, e.lv)).forEach(([k, v]) => { out[k] = (out[k] || 0) + v; });
            if (it.weapon) { out.weapon = it.weapon; out.weaponTier = 0; }
        });
        Object.keys(CAPS).forEach(k => { out[k] = Math.min(CAPS[k], out[k]); });
        return out;
    }
    /* 🗺️ the roads out of Hearthmoor — each an open land (WILDS.pw × WILDS.ph px
       inside its walls): three zones (the gate's at the bottom; tougher further
       up), monsters in packs (an elite in the far zone), things to gather,
       crates and barrels, and the road's boss in its lair at the top. */
    const WILDS = { w: 71, h: 53, pw: 68 * 16, ph: 50 * 16 };
    const ROADS = ["south", "west", "east", "north"];
    const BANDS = [[0.62, 1], [0.3, 0.62], [0, 0.3]]; // (by the gate · the middle · the far end)
    const REGIONS = {
        south: { name: "The Farmlands", icon: "🌾", dir: "South", boss: "rattlebones", mult: 1, foes: "Bone raiders and imps",
            zones: [{ name: "🌾 The wheat fields", pool: ["imp", "boneWarrior"], node: "herb", colors: ["#8a9a3c", "#829236"] },
                { name: "🍎 The old orchard", pool: ["boneWarrior", "spearthrower", "imp"], node: "herb", colors: ["#5c8f40", "#56883b"] },
                { name: "⛺ The raiders' camp", pool: ["boneWarrior", "spearthrower", "axeThrower"], node: "ore", colors: ["#7f7350", "#796d4b"] }],
            obstacles: { tree: 12, rock: 6, pond: 1, wall: 4 } },
        west: { name: "The Spider Woods", icon: "🕸️", dir: "West", boss: "ashira", mult: 1.5, foes: "Spiders, axe throwers and toads",
            zones: [{ name: "🌲 The woods' edge", pool: ["spider", "spiderling", "imp"], node: "shroom", colors: ["#3f7a3a", "#3a7336"] },
                { name: "🕸️ The webbed hollow", pool: ["spider", "axeThrower", "spiderling"], node: "shroom", colors: ["#2f5a2c", "#2b5428"] },
                { name: "🕷️ The nest", pool: ["spider", "toad", "axeThrower"], node: "herb", colors: ["#2b3f2a", "#283a27"] }],
            obstacles: { tree: 34, rock: 4, pond: 2, wall: 0 } },
        east: { name: "The Sunken Dunes", icon: "🏜️", dir: "East", boss: "kalidor", mult: 2, foes: "Axe throwers, iron guards and toads",
            zones: [{ name: "🏜️ The dunes", pool: ["axeThrower", "spearthrower", "toad"], node: "ore", colors: ["#c2a266", "#ba9b60"] },
                { name: "🌵 The cactus flats", pool: ["ironGuard", "toad", "axeThrower"], node: "ore", colors: ["#b08d55", "#a88650"] },
                { name: "🏛️ The sunken ruins", pool: ["ironGuard", "spearthrower", "boneWarrior"], node: "ore", colors: ["#8a7552", "#836f4e"] }],
            obstacles: { tree: 8, rock: 14, pond: 1, wall: 8 } },
        north: { name: "The Frost Peaks", icon: "❄️", dir: "North", boss: "shaiKhold", mult: 2.6, foes: "Ice guardians and iron guards",
            zones: [{ name: "🌲 The pine slopes", pool: ["iceGuardian", "ironGuard", "spearthrower"], node: "frost", colors: ["#a9bfcf", "#a2b8c8"] },
                { name: "🏔️ The ice fields", pool: ["iceGuardian", "ironGuard", "toad"], node: "frost", colors: ["#c9dbe8", "#c2d4e1"] },
                { name: "🧊 The Frost King's hall", pool: ["iceGuardian", "ironGuard"], node: "ore", colors: ["#8fa8c4", "#88a1bd"] }],
            obstacles: { tree: 16, rock: 12, pond: 2, wall: 4 } }
    };
    const zoneAt = (road, y) => { const i = BANDS.findIndex(([a, b]) => y / WILDS.ph >= a && y / WILDS.ph <= b); return REGIONS[road].zones[i < 0 ? 0 : i]; };
    function regionMap(road) {
        const R = REGIONS[road]; if (!R) return null;
        const r = rng("kih-keep:road:" + road), W = WILDS.pw, H = WILDS.ph;
        const gate = { x: W / 2, y: H - 20 }, camp = { x: W / 2 + 70, y: H - 70 }, lair = { x: W / 2, y: 120, r: 130 };
        const obstacles = [], nodes = [], packs = [], props = [];
        const clearOf = (x, y, rad) => Math.hypot(x - gate.x, y - gate.y) > 110 && Math.hypot(x - camp.x, y - camp.y) > 60 && Math.hypot(x - lair.x, y - lair.y) > lair.r + rad &&
            obstacles.every(o => Math.hypot(x - o.x, y - o.y) > rad + (o.r || Math.max(o.w, o.h) / 2) + 26) && nodes.every(n => Math.hypot(x - n.x, y - n.y) > rad + 30) && props.every(o => Math.hypot(x - o.x, y - o.y) > rad + 24);
        const place = (band, rad) => { for (let i = 0; i < 60; i++) { const x = 40 + r() * (W - 80), y = BANDS[band][0] * H + 30 + r() * ((BANDS[band][1] - BANDS[band][0]) * H - 60); if (clearOf(x, y, rad)) return { x, y }; } return null; };
        const add = (n, mk) => { for (let i = 0; i < n; i++) { const o = mk(i % 3); if (o) obstacles.push(o); } };
        const O = R.obstacles;
        add(O.pond, () => { const p = place(1, 46); return p && { kind: "pond", ...p, w: 80 + Math.floor(r() * 20), h: 44 }; });
        add(O.wall, (b) => { const p = place(2 - (b % 2), 40); return p && { kind: "wall", ...p, w: r() < 0.5 ? 80 : 14, h: r() < 0.5 ? 14 : 70 }; });
        add(O.tree, (b) => { const p = place(b, 10); return p && { kind: "tree", ...p, r: 7 }; });
        add(O.rock, (b) => { const p = place(b, 10); return p && { kind: "rock", ...p, r: 9 }; });
        [[0, 7], [1, 6], [2, 5]].forEach(([band, n]) => { for (let i = 0; i < n; i++) { const p = place(band, 8); if (p) nodes.push({ kind: R.zones[band].node, ...p }); } });
        [[0, 3], [1, 3], [2, 3]].forEach(([band, n]) => { for (let i = 0; i < n; i++) { const p = place(band, 8); if (p) props.push({ kind: r() < 0.5 ? "crate" : "barrel", ...p }); } }); // (📦 crates and barrels to break)
        [[0, 4], [1, 5], [2, 4]].forEach(([band, n]) => {
            for (let i = 0; i < n; i++) { let p = null; for (let t = 0; t < 6 && (!p || Math.hypot(p.x - gate.x, p.y - gate.y) < 200); t++) p = place(band, 30); if (p && Math.hypot(p.x - gate.x, p.y - gate.y) < 200) p = null;
                if (p) packs.push({ zone: band, ...p, types: Array.from({ length: between(r, 2, 3) }, () => pick(r, R.zones[band].pool)), mult: R.mult * (1 + band * 0.2) }); }
        });
        const elite = place(2, 30) || { x: W / 2 + 200, y: H * 0.2 };
        packs.push({ zone: 2, ...elite, types: [pick(r, R.zones[2].pool)], elite: true, mult: R.mult * 1.4 });
        return { road, gate, camp, lair, obstacles, nodes, props, packs };
    }
    /* 📜 the stories. Story 1, "The Missing Warden": the roads open one after
       another (roadOpen); each boss leaves a clue (STORY[0].beats[road].after);
       the last road ends it. Lines: [icon, who, what they say]. */
    const STORY = [{
        id: 1, title: "The Missing Warden", city: "Hearthmoor", roads: ROADS,
        intro: [["👴", "Elder Bram", "Thank the stars you've come. Our Warden — Elda, who kept Hearthmoor safe — vanished the night the four roads fell."],
            ["👴", "Elder Bram", "Monsters hold every road out of the city now. Folk say the bone raiders on the south road took her cloak. Start there."],
            ["👴", "Elder Bram", "The house by the square is yours — its furnace fuses what you find, and the chest keeps what your bag can't. Go carefully."]],
        beats: {
            south: { goal: "🌾 Take the south road — Captain Rattlebones holds the Farmlands",
                after: [["🧥", "Elda's cloak", "Torn, but it's hers. A map is stitched into the lining — a path into the Spider Woods, west of the city."]] },
            west: { goal: "🕸️ Follow the map into the Spider Woods (the west road) — Ashira's nest",
                after: [["✉️", "A letter in the web", "\"If anyone finds this — I followed the raiders' master east, into the dunes. — E.\""]] },
            east: { goal: "🏜️ Head east to the Sunken Dunes — Kalidor",
                after: [["🏜️", "Kalidor", "\"Too late, little hero… the Frost King took her north, up to the peaks.\""], ["🎖️", "Elda's badge", "Her Warden's badge — still warm. The north road is open."]] },
            north: { goal: "❄️ Climb the Frost Peaks (the north road) — find Elda",
                after: [["🧊", "", "The ice around Shai-Khold's throne cracks — and someone steps out of it."], ["🛡️", "Warden Elda", "You came all this way… for me? Thank you. Let's go home."], ["👴", "Elder Bram", "Elda's home! Hearthmoor won't forget what you did."]] }
        },
        end: [["⛵", "Story 2 — coming soon", "A ship has sailed in from Saltmere, by the sea. Its captain says there are houses for sale there — and a mystery in the harbour…"]]
    }];
    // a road's open once the one before it's cleared (the first, from the start)
    const roadOpen = (cleared, road) => { const i = ROADS.indexOf(road); return i === 0 || (i > 0 && !!(cleared && cleared[ROADS[i - 1]])); };
    const nextRoad = (cleared) => ROADS.find(r => !(cleared && cleared[r])) || null;
    // is (x, y) inside something solid? (for the tests: every spot can be reached)
    const blockedAt = (map, x, y, pad) => x < 4 || y < 4 || x > WILDS.pw - 4 || y > WILDS.ph - 4 || map.obstacles.some(o => o.r ? Math.hypot(x - o.x, y - o.y) < o.r + (pad || 0) : Math.abs(x - o.x) < o.w / 2 + (pad || 0) && Math.abs(y - o.y) < o.h / 2 + (pad || 0));

    return {
        ITEMS, FIND_TOKENS, GEAR_SLOTS, RECIPES, recipeFor, fuse, MAT_DROPS, rollMats, BAG, stackOf, cleanBag, bagCount, bagAdd, bagTake, bagFull, bagMoveAll, gearStats,
        LEVELS, isGear, levelCap, xpToNext, gearEntry, gearAdd, addXp, HERO, heroNext, heroEntry, heroAdd, heroStats, heroXp, levelBonus, fuseChance, afterFail, startLevel, recipeToLearn,
        WILDS, ROADS, BANDS, REGIONS, zoneAt, regionMap, blockedAt, STORY, roadOpen, nextRoad, SELL, sellPrice,
        hashString, rng, TIER, BASE, STATS_BY_SLOT, CAPS, STAT_INFO, tierOf, WEAPONS, FIND_WEAPONS, HELD_WEAPON, weaponFor, statsOf,
        ENEMIES, ELITE, PROPS, BOSSES, BOSS_ORDER, THEMES, GRID, LOOT, rollDrop, rollProp, rollBoss
    };
});
