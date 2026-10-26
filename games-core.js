/* games-core.js — the rules and puzzle generator for Games, shared by the
   page (games.html, as window.GamesCore) and the server (api/tokens.js, via
   require). Both build the same units from the same game data files, and a
   day's puzzle comes from a seed made of the date, so the server can check
   a play against exactly the puzzle the player was shown before paying
   today's token. Free play uses Math.random instead of a seed. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.GamesCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    const RARITIES = ["common", "rare", "epic", "legendary", "mythic"];
    const GAMES = ["trivia", "guess", "unitle", "hilo", "blur"];
    // "guess" is Hangman (it was Guess the Unit; the id stays so saved scores,
    // challenge links and the leaderboard keep working). "blur" is the zoomed,
    // blurred picture game that used to be Guess the Unit.
    const GAME_TITLES = { trivia: "Trivia", guess: "Hangman", unitle: "Unitle", hilo: "Higher or Lower", blur: "Blur" };
    const GAME_ICONS = { trivia: "🧠", guess: "🪢", unitle: "🎯", hilo: "⬆️", blur: "🔍" };

    /* ---------------- randomness ---------------- */
    function hashString(s) {
        let h = 0x811c9dc5;
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
        return h >>> 0;
    }
    function seededRandom(seed) {
        return function () {
            seed = (seed + 0x6D2B79F5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    const dayRng = (game, day) => seededRandom(hashString(`kih-daily:${game}:${day}`));
    const pick = (rand, arr) => arr[Math.floor(rand() * arr.length)];
    function shuffle(rand, arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
        return a;
    }
    const sample = (rand, arr, n) => shuffle(rand, arr).slice(0, n);

    // Which game is today's puzzle — the same for everyone. Days go in blocks
    // that each play every game once in a shuffled order. If a block would
    // start with the game that ended the block before, its first two swap;
    // only those two ever move, so a block's last game is fixed and the check
    // never chains. Until DAILY_FIVE_FROM the blocks were the first four games
    // (so days already played keep their game); from then on Blur is in too.
    const DAILY_FOUR = ["trivia", "guess", "unitle", "hilo"];
    const DAILY_FIVE_FROM = "2026-10-21";
    const dayNumber = (day) => Math.floor(Date.parse(day + "T00:00:00Z") / 864e5);
    function inBlocks(list, salt, m, before) {
        const block = Math.floor(m / list.length);
        const order = (b) => shuffle(seededRandom(hashString(salt + b)), list);
        const o = order(block);
        const prev = block > 0 ? order(block - 1)[list.length - 1] : before;
        if (o[0] === prev) [o[0], o[1]] = [o[1], o[0]];
        return o[m % list.length];
    }
    // From DAILY_WEEKS_FROM (a Monday) every Monday–Sunday week has all five:
    // Monday to Friday are the five in a shuffled order, and Saturday and
    // Sunday two more of them — so a week of Today's Puzzles is a week of
    // every game's double-points day. Never the same game two days running.
    const DAILY_WEEKS_FROM = "2026-11-02";
    function dailyWeekOrder(w, prevDay) {
        const o = shuffle(seededRandom(hashString("kih-daily-week:" + w)), GAMES);
        if (o[0] === prevDay) [o[0], o[1]] = [o[1], o[0]];
        const r = seededRandom(hashString("kih-daily-weekend:" + w));
        const sat = pick(r, GAMES.filter(g => g !== o[4]));
        const sun = pick(r, GAMES.filter(g => g !== sat));
        return [...o, sat, sun];
    }
    function dailyGameFor(day) {
        const n = dayNumber(day), from = dayNumber(DAILY_FIVE_FROM), weeks = dayNumber(DAILY_WEEKS_FROM);
        if (n < from) return inBlocks(DAILY_FOUR, "kih-daily-game:", n);
        const lastFour = inBlocks(DAILY_FOUR, "kih-daily-game:", from - 1);
        if (n < weeks) return inBlocks(GAMES, "kih-daily-game5:", n - from, lastFour);
        const w = Math.floor((n - weeks) / 7);
        // the Sunday before (one step back: a Sunday never looks further)
        const prevSunday = w === 0 ? inBlocks(GAMES, "kih-daily-game5:", weeks - 1 - from, lastFour) : dailyWeekOrder(w - 1, null)[6];
        return dailyWeekOrder(w, prevSunday)[(n - weeks) % 7];
    }

    /* ---------------- units ---------------- */
    const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
    const fmt = (n) => Number(n).toLocaleString("en-US");

    // The ability data files (abilityAoeDamage.json, ...) that hold the
    // numbers of abilities shown in the game — damage, stun, cooldown and
    // so on, one row per ability level ("hunter_AoECone_7").
    const ABILITY_FILES = ["abilityAoeAttackReduction", "abilityAoeDamage", "abilityAoeDamageSuicide", "abilityAoeExtraGold", "abilityAoeFearEffect",
        "abilityAoeHeal", "abilityAoeMeteoriteSummon", "abilityAuraBlessing", "abilityAuraDefence", "abilityCharge", "abilityDarknessSummon", "abilityFear",
        "abilityFireGolem", "abilityHealOverTime", "abilityInitialModifier", "abilityMetamorph", "abilityMindControl", "abilityModifierAura", "abilityPet",
        "abilityPiercingMove", "abilityPiercingShip", "abilityPiercingSummonProjectile", "abilityPoisonFearAoe", "abilityPowerJump", "abilityPullClaws",
        "abilityRage", "abilityRangeDemonAoe", "abilityRebirth", "abilityRebirthLimited", "abilityRoots", "abilityShieldDash", "abilityShieldLimitBuff",
        "abilitySleep", "abilitySnowball", "abilitySpirit", "abilitySpiritDruid", "abilityStormCloud", "abilitySummon", "abilitySummonProjectile",
        "abilitySunrise", "abilityTeleport", "abilityToadJump", "abilityTornado", "abilityTriangularAoe", "abilityVortex", "abilityWaterPuddles",
        "abilityWhirlwind"].map(f => f + ".json");
    // The numbers trivia asks about. Each ability uses the first of `fields`
    // it has (its files name the same thing differently); zero means "none".
    const ABILITY_NUMBERS = [
        { id: "dmg", fields: ["attack", "aoeAttack", "bigMeteorAttack", "deathAoeAttack", "explosionAttack", "lightningAttack", "flameDamage", "poisonDamage", "dashAttack", "damage"], q: (a) => `How much <b>damage</b> does ${a} deal` },
        { id: "stun", fields: ["stunTime", "explosionStunTime"], unit: "s", q: (a) => `How long does ${a} <b>stun</b> enemies for` },
        { id: "cd", fields: ["cooldown"], unit: "s", q: (a) => `What is the <b>cooldown</b> of ${a}` },
        { id: "radius", fields: ["aoeRadius", "auraRadius", "fearRadius", "explosionRadius", "lightningAoeRadius", "flameAoeRadius", "radius"], q: (a) => `How big is the <b>area</b> (radius) of ${a}` },
        { id: "heal", fields: ["healAmount"], q: (a) => `How much does ${a} <b>heal</b>` },
        { id: "fear", fields: ["fearDuration"], unit: "s", q: (a) => `How long does ${a} make enemies <b>flee in fear</b>` },
        { id: "dur", fields: ["duration", "buffDuration", "effectDuration", "auraDuration", "debuffDuration", "vortexDuration"], unit: "s", q: (a) => `How long does ${a} <b>last</b>` },
        { id: "max", fields: ["maxEnemies", "aoeMaxTargets", "maxNumEnemies"], q: (a) => `How many enemies can ${a} <b>hit at most</b>` }
    ];
    // One ability's numbers: { id: [[level, value], ...] } for each it has.
    function abilityNumbers(rows) {
        const levelOfRow = (r) => { const m = /_(\d+)$/.exec(r.key || ""); return m ? Number(m[1]) : 0; };
        const out = {};
        ABILITY_NUMBERS.forEach(spec => {
            for (const f of spec.fields) {
                const seen = new Set(), vals = [];
                rows.forEach(r => { const L = levelOfRow(r); if (typeof r[f] === "number" && !seen.has(L)) { seen.add(L); vals.push([L, r[f]]); } });
                if (!vals.length) continue;
                if (vals.every(v => v[1] > 0)) out[spec.id] = vals.sort((a, b) => a[0] - b[0]);
                break;
            }
        });
        return out;
    }
    // A talent's number as the game shows it ("+25%"), from how it's stored.
    function talentPercent(value, format) {
        const v = format === "percent" ? value * 100 : format === "minusOnePercent" ? (value - 1) * 100 : format === "minusPercent" ? -value * 100 : null;
        return v == null || !isFinite(v) ? null : Math.round(v * 10) / 10;
    }
    const tidy = (s) => (s ? String(s).replace(/\s+/g, " ").trim() : null);

    // Every troop and hero shown on the site, from the raw game data files.
    // The rest are optional: talents (heroTalent.json) with talentLevels
    // (heroTalentLevel.json) and paramMods (unitParameterModifierNested.json)
    // add each hero's talent and its numbers; abilityInfo (abilityInfo.json)
    // with abilityData ({ "abilityAoeDamage.json": ..., } — ABILITY_FILES)
    // add units' named abilities and theirs.
    function buildUnits({ troops, troopLevels, heroes, heroLevels, loc, en, talents, talentLevels, paramMods, abilityInfo, abilityData }) {
        const text = (k) => { const l = loc[k]; return l ? en[l.value] : null; };
        const byUnit = {};
        Object.values(troopLevels).forEach(l => { (byUnit["t:" + l.troopId] = byUnit["t:" + l.troopId] || []).push(l); });
        Object.values(heroLevels).forEach(l => { (byUnit["h:" + l.heroId] = byUnit["h:" + l.heroId] || []).push(l); });
        const build = (meta, type, prefix) => Object.keys(meta).map(key => {
            const m = meta[key];
            const rows = (byUnit[prefix + key] || []).slice().sort((a, b) => a.level - b.level);
            if (m.isDisplayed === false || !rows.length || /^boss/i.test(key)) return null;
            const levels = rows.map(r => ({ level: r.level, hp: r.health, atk: r.attack, count: r.count || 1, def: r.defense || 0, speed: r.moveSpeed || 0, power: r.power || 0, splash: r.aoeRadius > 0 }));
            const first = levels[0], last = levels[levels.length - 1];
            return {
                key, type,
                name: text(m.name) || key,
                rarity: m.rarityId,
                faction: m.factionId,
                attack: m.attackType === "Range" ? "Ranged" : "Melee",
                levels,
                hp1: first.hp, atk1: first.atk, hpMax: last.hp, atkMax: last.atk, maxLevel: last.level,
                def1: first.def, defMax: last.def, speed: last.speed, pwr1: first.power, pwrMax: last.power, splash: last.splash,
                desc: m.description ? text(m.description) : null,
                img: `images/${key.toUpperCase()}.jpg`
            };
        }).filter(Boolean);
        const all = [...build(troops, "troop", "t:"), ...build(heroes, "hero", "h:")].filter(u => u.name && u.rarity && u.faction);
        const modsByKey = {};
        if (paramMods) Object.values(paramMods).forEach(m => { (modsByKey[m.key] = modsByKey[m.key] || []).push(m); });
        if (talents) Object.values(talents).forEach(t => {
            const u = all.find(x => x.type === "hero" && x.key === t.heroId), name = text(t.title_Localized);
            if (!u || !name) return;
            u.talent = name;
            u.talentDesc = tidy(text(t.description_Localized));
            // what the talent gives at each talent level, per effect it has
            const effects = {};
            Object.values(talentLevels || {}).filter(l => l.heroTalentId === t.key).sort((a, b) => a.level - b.level).forEach(l => {
                (modsByKey[l.abilityId] || []).forEach(m => {
                    const label = tidy(text(m.caption)), v = talentPercent(m.value, m.format);
                    if (!label || v == null) return;
                    (effects[m.type] = effects[m.type] || { label: label.replace(/\s*\(%\)$/, ""), values: [] }).values.push([l.level, v]);
                });
            });
            u.talentStats = Object.values(effects).filter(e => e.values.length >= 4);
        });
        if (abilityInfo) {
            const rowsById = {};
            Object.values(abilityData || {}).forEach(file => (Array.isArray(file) ? file : Object.values(file || {})).forEach(r => {
                if (r && r.abilityInfoId) (rowsById[r.abilityInfoId] = rowsById[r.abilityInfoId] || []).push(r);
            }));
            // an ability's key starts with its unit's key ("assasin_teleport");
            // the longest matching key wins ("darkKnight" over "dark")
            const byLength = all.slice().sort((a, b) => b.key.length - a.key.length);
            Object.values(abilityInfo).forEach(a => {
                if (a.showInLobbyUi === false) return;
                const name = text(a.title_Localized);
                const u = name && byLength.find(x => a.key.toLowerCase().startsWith(x.key.toLowerCase() + "_"));
                if (!u || (u.abilities = u.abilities || []).includes(name)) return;
                u.abilities.push(name);
                (u.abilityList = u.abilityList || []).push({ key: a.key, title: name, desc: tidy(text(a.desctiption_Localized)), nums: abilityNumbers(rowsById[a.key] || []) });
            });
        }
        return all;
    }
    // The data files buildUnits takes, by argument — one list for the page
    // (which fetches them) and the server (which requires them), so both
    // always build exactly the same units and questions.
    const DATA_FILES = {
        troops: "troops.json", troopLevels: "troopsLevel.json", heroes: "hero.json", heroLevels: "heroLevel.json",
        loc: "localization.json", en: "en.json", talents: "heroTalent.json", talentLevels: "heroTalentLevel.json",
        paramMods: "unitParameterModifierNested.json", abilityInfo: "abilityInfo.json"
    };
    const ALL_DATA_FILES = [...Object.values(DATA_FILES), ...ABILITY_FILES];
    // read(fileName) → that file's parsed JSON.
    function unitsFromFiles(read) {
        const args = Object.fromEntries(Object.entries(DATA_FILES).map(([arg, f]) => [arg, read(f)]));
        args.abilityData = Object.fromEntries(ABILITY_FILES.map(f => [f, read(f)]));
        return buildUnits(args);
    }
    const unitByKey = (units, key) => units.find(u => u.key === key) || null;
    const levelOf = (u, level) => u.levels.find(l => l.level === level) || null;

    /* ---------------- typed names ---------------- */
    const normName = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

    // Names a player might reasonably type for a unit: the full name, the
    // part before a comma ("Atreya"), the part before "the" ("Bumi"), and a
    // troop without its plural "s" ("Bomber"). Only names that point to one
    // unit count, so "Catapult" means Catapult, never Cursed Catapult.
    function nameAliases(units) {
        const counts = new Map();
        const per = units.map(u => {
            const n = u.name;
            const set = new Set([normName(n)]);
            const beforeComma = n.split(",")[0];
            set.add(normName(beforeComma));
            const the = beforeComma.split(/\s+the\s+/i)[0];
            set.add(normName(the));
            if (u.type === "troop") [...set].forEach(a => { if (a.endsWith("s") && a.length > 4) set.add(a.slice(0, -1)); });
            const list = [...set].filter(a => a.length >= 3);
            list.forEach(a => counts.set(a, (counts.get(a) || 0) + 1));
            return [u.key, list];
        });
        const map = new Map();
        per.forEach(([key, list]) => list.forEach(a => {
            // The exact full name always wins; a shared short form is dropped.
            if (counts.get(a) === 1 || units.find(u => u.key === key && normName(u.name) === a)) map.set(a, key);
        }));
        return map;
    }
    function resolveName(units, text, aliases) {
        const key = (aliases || nameAliases(units)).get(normName(text));
        return key ? unitByKey(units, key) : null;
    }

    // The name as blanks: letters hidden, spaces and punctuation shown. With
    // `reveal`, some letters show (the first of each word and every third).
    function nameMask(name, reveal) {
        let letterIndex = 0;
        return [...name].map((ch, i) => {
            if (ch === " ") return { gap: true };
            if (!/[A-Za-z0-9]/.test(ch)) return { punct: ch };
            const wordStart = i === 0 || name[i - 1] === " ";
            const show = reveal && (wordStart || letterIndex % 3 === 0);
            letterIndex++;
            return { letter: show ? ch.toUpperCase() : "" };
        });
    }

    /* ---------------- Trivia ---------------- */
    const TRIVIA_COUNT = 5;
    // No "what rarity is it?" — every picture's background colour gives it
    // away — and no squad sizes (summons like the Huntress's beast make the
    // count misleading). Ability numbers come up twice as often: there are
    // the most of them.
    const TRIVIA_KINDS = ["faction", "attack", "whoIsThis", "mostHpAt", "mostAtkAt", "mostPowerAt", "hpAtLevel", "atkAtLevel", "defAtLevel", "powerAtLevel",
        "quote", "isHero", "splash", "talentWho", "talentOf", "talentDesc", "talentValue", "abilityWho", "abilityDesc", "abilityNum", "abilityNum",
        "fastest", "mostDefense", "defAtMax"];
    const STAT_WORDS = { hp: "HP", atk: "attack", def: "defense", power: "power" };

    function mc(rand, kind, q, correct, wrongs, extra = {}) {
        const options = shuffle(rand, [correct, ...wrongs]);
        return { kind, q, options, answer: options.indexOf(correct), ...extra };
    }
    // Would a description give its answer away? Any word of the name (or
    // its plural-less stem, "bomber" for "Bombers") appearing in the text.
    function quoteNamesUnit(u) {
        const text = (u.desc || "").toLowerCase();
        const stems = u.name.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4).map(w => w.replace(/(es|s)$/, ""));
        return text.includes(u.key.toLowerCase()) || stems.some(st => st.length >= 3 && text.includes(st));
    }

    const numText = (x) => (Number.isInteger(x) ? fmt(x) : String(Math.round(x * 100) / 100));
    const lowerFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
    // A description with the unit's and the answer's own words blanked out
    // ("The ___ turns into a real whirlwind of steel"), so it doesn't say
    // what it's describing.
    function redactNames(text, names) {
        const words = [...new Set(names.flatMap(n => String(n).toLowerCase().split(/[^a-z]+/)).filter(w => w.length >= 4).map(w => w.replace(/(es|s)$/, "")))];
        return words.reduce((t, w) => t.replace(new RegExp("\\b" + w + "[a-z]*", "gi"), "___"), text);
    }

    function triviaQuestion(units, rand, kind) {
        const troops = units.filter(u => u.type === "troop");
        const heroes = units.filter(u => u.type === "hero");
        const factions = [...new Set(units.map(u => u.faction))];
        const level = () => 1 + Math.floor(rand() * 10);
        switch (kind) {
            case "faction": {
                const u = pick(rand, units);
                return mc(rand, kind, `Which faction is <b>${esc(u.name)}</b> in?`, u.faction, sample(rand, factions.filter(f => f !== u.faction), 3), { img: u.img });
            }
            case "attack": {
                const u = pick(rand, units);
                return { kind, q: `Does <b>${esc(u.name)}</b> fight melee or ranged?`, options: ["Melee", "Ranged"], answer: u.attack === "Melee" ? 0 : 1, img: u.img };
            }
            case "whoIsThis": {
                const u = pick(rand, units);
                const others = sample(rand, units.filter(x => x.type === u.type && x.key !== u.key), 3);
                // The picture IS the question, so the options have none.
                return mc(rand, kind, `Who is this?`, u.name, others.map(x => x.name), { img: u.img, unitOptions: true, hideOptionImages: true });
            }
            case "mostHpAt":
            case "mostAtkAt":
            case "mostPowerAt": {
                const stat = { mostHpAt: "hp", mostAtkAt: "atk", mostPowerAt: "power" }[kind];
                const L = level();
                const pool = pick(rand, [troops, heroes]).filter(u => levelOf(u, L));
                for (let tries = 0; tries < 40; tries++) {
                    const four = sample(rand, pool, 4);
                    const vals = four.map(u => levelOf(u, L)[stat]);
                    if (new Set(vals).size !== 4) continue;
                    const best = four[vals.indexOf(Math.max(...vals))];
                    const q = mc(rand, kind, `Which of these has the most <b>${STAT_WORDS[stat]}</b> at <b>level ${L}</b>?`, best.name, four.filter(u => u !== best).map(u => u.name), { unitOptions: true });
                    q.reveal = q.options.map(n => fmt(levelOf(units.find(u => u.name === n), L)[stat]));
                    return q;
                }
                return null;
            }
            case "hpAtLevel":
            case "atkAtLevel":
            case "defAtLevel":
            case "powerAtLevel": {
                const stat = { hpAtLevel: "hp", atkAtLevel: "atk", defAtLevel: "def", powerAtLevel: "power" }[kind];
                const u = pick(rand, units);
                const L = level();
                const right = levelOf(u, L);
                if (!right) return null;
                const others = [...new Set(u.levels.map(l => l[stat]).filter(v => v !== right[stat]))];
                if (others.length < 3) return null;
                return mc(rand, kind, `How much <b>${STAT_WORDS[stat]}</b> does <b>${esc(u.name)}</b> have at <b>level ${L}</b>?`,
                    fmt(right[stat]), sample(rand, others, 3).map(fmt), { img: u.img });
            }
            case "splash": {
                const u = pick(rand, units);
                return { kind, q: `Does <b>${esc(u.name)}</b>'s normal attack hit <b>one enemy</b> or <b>an area</b>?`, options: ["One enemy", "An area"], answer: u.splash ? 1 : 0, img: u.img };
            }
            case "quote": {
                const withQuote = troops.filter(u => u.desc && u.desc.length > 8 && !quoteNamesUnit(u));
                if (withQuote.length < 4) return null;
                const u = pick(rand, withQuote);
                return mc(rand, kind, `Which troop's description is this?<br><i>"${esc(u.desc)}"</i>`, u.name, sample(rand, troops.filter(x => x.key !== u.key), 3).map(x => x.name), { unitOptions: true });
            }
            case "talentWho": {
                const withTalent = heroes.filter(h => h.talent);
                if (withTalent.length < 4) return null;
                const h = pick(rand, withTalent);
                return mc(rand, kind, `Which hero has the talent <b>${esc(h.talent)}</b>?`, h.name, sample(rand, withTalent.filter(x => x.key !== h.key), 3).map(x => x.name), { unitOptions: true });
            }
            case "talentOf": {
                const withTalent = heroes.filter(h => h.talent);
                const h = pick(rand, withTalent);
                const others = [...new Set(withTalent.filter(x => x.talent !== (h && h.talent)).map(x => x.talent))];
                if (!h || others.length < 3) return null;
                return mc(rand, kind, `What is <b>${esc(h.name)}</b>'s talent?`, h.talent, sample(rand, others, 3), { img: h.img });
            }
            case "talentDesc": {
                const withDesc = heroes.filter(h => h.talent && h.talentDesc && h.talentDesc.length > 15);
                const names = [...new Set(heroes.filter(h => h.talent).map(h => h.talent))];
                if (!withDesc.length || names.length < 4) return null;
                const h = pick(rand, withDesc);
                return mc(rand, kind, `Which <b>talent</b> is this?<br><i>"${esc(redactNames(h.talentDesc, [h.name, h.talent]))}"</i>`, h.talent, sample(rand, names.filter(n => n !== h.talent), 3));
            }
            case "talentValue": {
                const list = [];
                heroes.forEach(h => (h.talentStats || []).forEach(st => list.push({ h, st })));
                if (!list.length) return null;
                const { h, st } = pick(rand, list);
                const distinct = [...new Set(st.values.map(v => v[1]))];
                if (distinct.length < 4) return null;
                const [L, v] = pick(rand, st.values);
                const pct = (x) => `${numText(x)}%`;
                return mc(rand, kind, `<b>${esc(h.talent)}</b> is ${esc(h.name)}'s talent. At <b>talent level ${L}</b>, what is its <b>${esc(lowerFirst(st.label))}</b>?`,
                    pct(v), sample(rand, distinct.filter(x => x !== v), 3).map(pct), { img: h.img });
            }
            case "abilityDesc": {
                const all = [];
                units.forEach(u => (u.abilityList || []).forEach(a => { if (a.desc && a.desc.length > 15) all.push({ u, a }); }));
                const titles = [...new Set(units.flatMap(u => u.abilities || []))];
                if (!all.length || titles.length < 4) return null;
                const { u, a } = pick(rand, all);
                return mc(rand, kind, `Which <b>ability</b> is this?<br><i>"${esc(redactNames(a.desc, [u.name, a.title]))}"</i>`, a.title, sample(rand, titles.filter(t => t !== a.title), 3));
            }
            case "abilityNum": {
                const list = [];
                units.forEach(u => (u.abilityList || []).forEach(a => Object.keys(a.nums).forEach(id => list.push({ u, a, id }))));
                for (let tries = 0; tries < 30 && list.length; tries++) {
                    const it = pick(rand, list), spec = ABILITY_NUMBERS.find(x => x.id === it.id), vals = it.a.nums[it.id];
                    const distinct = [...new Set(vals.map(v => v[1]))];
                    let L = null, right, pool;
                    if (distinct.length >= 4) {
                        // it changes with level: ask about one level, the others are the wrong answers
                        [L, right] = pick(rand, vals);
                        pool = distinct.filter(x => x !== right);
                    } else if (distinct.length === 1) {
                        // the same at every level: the wrong answers are other abilities'
                        right = distinct[0];
                        pool = [...new Set(list.filter(o => o.id === it.id && o.a !== it.a).map(o => o.a.nums[o.id][o.a.nums[o.id].length - 1][1]))].filter(x => x !== right);
                    } else continue;
                    if (pool.length < 3) continue;
                    const show = (x) => numText(x) + (spec.unit || "");
                    const name = `<b>${esc(it.a.title)}</b> (${esc(it.u.name)})`;
                    return mc(rand, kind, `${spec.q(name)}${L ? ` at <b>level ${L}</b>` : ""}?`, show(right), sample(rand, pool, 3).map(show), { img: it.u.img });
                }
                return null;
            }
            case "abilityWho": {
                // abilities only one unit has
                const owners = {};
                units.forEach(u => (u.abilities || []).forEach(a => { (owners[a] = owners[a] || []).push(u); }));
                const unique = Object.keys(owners).filter(a => owners[a].length === 1);
                if (!unique.length) return null;
                const title = pick(rand, unique), u = owners[title][0];
                const pool = units.filter(x => x.type === u.type && x.key !== u.key);
                if (pool.length < 3) return null;
                return mc(rand, kind, `Which ${u.type} has the ability <b>${esc(title)}</b>?`, u.name, sample(rand, pool, 3).map(x => x.name), { unitOptions: true });
            }
            case "fastest":
            case "mostDefense": {
                const stat = kind === "fastest" ? "speed" : "defMax";
                const pool = pick(rand, [troops, heroes]).filter(u => u[stat] > 0);
                for (let tries = 0; tries < 40; tries++) {
                    const four = sample(rand, pool, 4);
                    if (four.length < 4) return null;
                    const vals = four.map(u => u[stat]), top = Math.max(...vals);
                    if (vals.filter(v => v === top).length !== 1) continue; // one clear answer
                    const best = four[vals.indexOf(top)];
                    const q = mc(rand, kind, kind === "fastest" ? `Which of these <b>moves the fastest</b>?` : `Which of these has the most <b>defense</b> at max level?`,
                        best.name, four.filter(u => u !== best).map(u => u.name), { unitOptions: true });
                    q.reveal = q.options.map(n => fmt(units.find(u => u.name === n)[stat]));
                    return q;
                }
                return null;
            }
            case "defAtMax": {
                const u = pick(rand, units.filter(x => x.defMax > 0));
                const others = [...new Set(units.filter(x => x.type === (u && u.type)).map(x => x.defMax).filter(v => v > 0 && v !== (u && u.defMax)))];
                if (!u || others.length < 3) return null;
                return mc(rand, kind, `How much <b>defense</b> does <b>${esc(u.name)}</b> have at max level?`, fmt(u.defMax), sample(rand, others, 3).map(fmt), { img: u.img });
            }
            case "isHero": {
                const h = pick(rand, heroes);
                return mc(rand, kind, `Which of these is a <b>hero</b> (not a troop)?`, h.name, sample(rand, troops, 3).map(x => x.name), { unitOptions: true });
            }
        }
        return null;
    }
    function triviaSet(units, rand) {
        const qs = [];
        for (const k of shuffle(rand, TRIVIA_KINDS)) {
            if (qs.length === TRIVIA_COUNT) break;
            const q = triviaQuestion(units, rand, k);
            if (q) qs.push(q);
        }
        return qs;
    }

    /* ---------------- Hangman ----------------
       Guess a unit's name one letter at a time. Each wrong letter adds a
       piece to the drawing; six and it's over. A clue says what kind of
       unit it is. */
    const HANG_MAX_WRONG = 6;
    const HANG_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const hangTarget = (units, rand) => pick(rand, units).key;
    const nameLetters = (name) => new Set([...String(name).toUpperCase()].filter(c => HANG_LETTERS.includes(c)));
    // Where a name stands after these letters: the wrong ones, solved, lost.
    function hangState(name, letters) {
        const need = nameLetters(name);
        const wrong = letters.filter(l => !need.has(l));
        const solved = [...need].every(l => letters.includes(l));
        return { wrong, solved, lost: !solved && wrong.length >= HANG_MAX_WRONG };
    }
    // The name with the guessed letters filled in (spaces and punctuation shown).
    function hangMask(name, letters) {
        return [...name].map(ch => {
            if (ch === " ") return { gap: true };
            const up = ch.toUpperCase();
            if (!HANG_LETTERS.includes(up)) return { punct: ch };
            return { letter: letters.includes(up) ? up : "" };
        });
    }
    const hangClue = (u) => `${cap(u.type)} · ${u.faction} · fights ${u.attack.toLowerCase()}`;
    const validLetter = (c) => typeof c === "string" && c.length === 1 && HANG_LETTERS.includes(c);

    /* ---------------- Blur ----------------
       Who's in the picture? It starts zoomed in and blurred; each wrong
       guess zooms out and clears it a little. Type the name: 3 guesses, up
       to 3 hints. */
    const BLUR_GUESSES = 3;
    const BLUR_HINTS = 3;
    // Zoom and blur per wrong guess so far (the last is the full reveal).
    const BLUR_ZOOM = [5, 3.5, 2.3, 1];
    const BLUR_AMOUNT = [2.5, 1.6, 0.8, 0];
    function blurPuzzle(units, rand) {
        const target = pick(rand, units);
        // Zoom point: anywhere across, the upper part down (the bottom of
        // each picture — where many show the unit's name — is cropped off).
        const focus = [20 + Math.floor(rand() * 61), 15 + Math.floor(rand() * 41)];
        return { target: target.key, focus };
    }
    // How the picture looks: each wrong guess moves one stage along
    // BLUR_ZOOM/BLUR_AMOUNT, the first hint half a stage more. The full
    // picture (the last stage) only shows once the game is over.
    function blurView(wrong, hints, done) {
        if (done) return { zoom: BLUR_ZOOM[BLUR_ZOOM.length - 1], blur: 0 };
        const pos = Math.min(wrong + (hints >= 1 ? 0.5 : 0), BLUR_ZOOM.length - 1.5);
        const i = Math.floor(pos), f = pos - i;
        const at = (arr) => Math.round((arr[i] + (arr[i + 1] - arr[i]) * f) * 100) / 100;
        return { zoom: at(BLUR_ZOOM), blur: at(BLUR_AMOUNT) };
    }
    // Hint 1 is the clearer picture; 2 is what kind of unit; 3 fills in letters.
    function blurHint(u, n) {
        if (n === 1) return `The picture zooms out a little and gets clearer.`;
        if (n === 2) return `It's ${/^[aeiou]/i.test(u.rarity) ? "an" : "a"} <b>${cap(u.rarity)}</b> ${u.type} · <b>${esc(u.faction)}</b> · fights <b>${u.attack.toLowerCase()}</b>.`;
        return `Some letters are filled in above.`;
    }
    // Where the frame looks, in the picture's own pixels: the same view the
    // page gets with CSS (a 230px square showing the top of the picture,
    // scaled by `zoom` around `focus`), so a server-made crop matches what a
    // guest sees exactly.
    function blurCrop(imgW, imgH, focus, zoom) {
        const FRAME = 230, BOX_H = FRAME * 1.25;
        const s = Math.max(FRAME / imgW, BOX_H / imgH);
        const offX = (FRAME - imgW * s) / 2;
        const ox = focus[0] / 100 * FRAME, oy = focus[1] / 100 * BOX_H;
        const x0 = ox - ox / zoom, x1 = ox + (FRAME - ox) / zoom;
        const y0 = oy - oy / zoom, y1 = oy + (FRAME - oy) / zoom;
        return { x: (x0 - offX) / s, y: y0 / s, w: (x1 - x0) / s, h: (y1 - y0) / s, scale: s };
    }

    /* ---------------- Unitle ---------------- */
    const UNITLE_TRIES = 6;
    const unitleTarget = (units, rand) => pick(rand, units).key;
    function shortNum(n) {
        if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
        if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "k";
        return String(n);
    }
    // One guess against the target: [result, label, arrow] per column, where
    // result is "hit", "miss" or "near" (wrong, and the arrow points towards
    // the answer). Rarities are short so they fit a phone-width column.
    const RARITY_SHORT = { common: "Com", rare: "Rare", epic: "Epic", legendary: "Leg", mythic: "Myth" };
    function unitleCells(guess, target) {
        const eq = (a, b) => (a === b ? "hit" : "miss");
        const toward = (g, t) => (g === t ? "" : t > g ? "⬆️" : "⬇️");
        const rg = RARITIES.indexOf(guess.rarity), rt = RARITIES.indexOf(target.rarity);
        const near = (g, t) => (g === t ? "hit" : "near");
        return [
            [eq(guess.type, target.type), cap(guess.type), ""],
            [near(rg, rt), RARITY_SHORT[guess.rarity] || cap(guess.rarity), toward(rg, rt)],
            [eq(guess.faction, target.faction), guess.faction, ""],
            [eq(guess.attack, target.attack), guess.attack, ""],
            [near(guess.hpMax, target.hpMax), shortNum(guess.hpMax), toward(guess.hpMax, target.hpMax)],
            [near(guess.atkMax, target.atkMax), shortNum(guess.atkMax), toward(guess.atkMax, target.atkMax)]
        ];
    }

    /* ---------------- Higher or Lower ---------------- */
    const HILO_STATS = [
        { key: "hp1", label: "HP at level 1" }, { key: "atk1", label: "attack at level 1" },
        { key: "hpMax", label: "HP at max level" }, { key: "atkMax", label: "attack at max level" },
        { key: "def1", label: "defense at level 1" }, { key: "defMax", label: "defense at max level" },
        { key: "pwr1", label: "power at level 1" }, { key: "pwrMax", label: "power at max level" },
        { key: "speed", label: "move speed" }
    ];
    const HILO_DAILY_ROUNDS = 10;
    function hiloRound(units, rand) {
        for (let tries = 0; tries < 500; tries++) {
            const stat = pick(rand, HILO_STATS);
            const type = rand() < 0.5 ? "troop" : "hero";
            const [a, b] = sample(rand, units.filter(u => u.type === type), 2);
            if (a && b && a[stat.key] !== b[stat.key]) return { a: a.key, b: b.key, stat: stat.key };
        }
        const [a, b] = units.filter((u, i, all) => all.findIndex(x => x.hpMax === u.hpMax) === i);
        return { a: a.key, b: b.key, stat: "hpMax" };
    }
    function hiloRounds(units, rand, n) {
        const out = [];
        while (out.length < n) out.push(hiloRound(units, rand));
        return out;
    }
    function hiloWinner(units, r) {
        const A = unitByKey(units, r.a), B = unitByKey(units, r.b);
        return A[r.stat] > B[r.stat] ? r.a : r.b;
    }

    /* ---------------- today's puzzle ---------------- */
    // The whole puzzle for a day, answers included.
    function dailyPuzzle(units, day) {
        const game = dailyGameFor(day);
        const rand = dayRng(game, day);
        if (game === "trivia") return { game, questions: triviaSet(units, rand) };
        if (game === "guess") return { game, target: hangTarget(units, rand) };
        if (game === "unitle") return { game, target: unitleTarget(units, rand) };
        if (game === "blur") return { game, ...blurPuzzle(units, rand) };
        return { game, rounds: hiloRounds(units, rand, HILO_DAILY_ROUNDS) };
    }

    // Where a play of a day's puzzle stands: { game, finished, score, won,
    // total }, or null if `play` isn't a possible play of that puzzle at all
    // (an answer that doesn't exist, a guess after the right one, a pick
    // after a miss...). The page uses it to show progress; the server pays
    // the day's token only for a play that's possible AND finished.
    //   trivia { answers: [option index] }    guess { letters: ["A", ...] }
    //   unitle { guesses: [unit key] }         hilo  { picks: [unit key] }
    //   blur { guesses: [unit key], hints }
    function dailyResult(units, day, play) {
        const p = dailyPuzzle(units, day);
        const game = p.game;
        play = play && typeof play === "object" ? play : {};
        const isInt = (x) => Number.isInteger(x) && x >= 0;
        // Unit guesses: real units, no repeats, the answer only as the last.
        const guessList = (list, max, target) => Array.isArray(list) && list.length <= max
            && list.every(k => typeof k === "string" && unitByKey(units, k)) && new Set(list).size === list.length
            && list.every((k, i) => k !== target || i === list.length - 1);
        if (game === "trivia") {
            const a = play.answers;
            if (!Array.isArray(a) || a.length > p.questions.length || !a.every((x, i) => isInt(x) && x < p.questions[i].options.length)) return null;
            const score = a.filter((x, i) => x === p.questions[i].answer).length;
            return { game, finished: a.length === p.questions.length, score, total: p.questions.length };
        }
        if (game === "guess") {
            const L = play.letters, name = unitByKey(units, p.target).name;
            if (!Array.isArray(L) || L.length > HANG_LETTERS.length || !L.every(validLetter) || new Set(L).size !== L.length) return null;
            // nothing after the word is solved or the drawing is finished
            for (let i = 0; i < L.length; i++) { const st = hangState(name, L.slice(0, i)); if (st.solved || st.lost) return null; }
            const st = hangState(name, L);
            return { game, finished: st.solved || st.lost, won: st.solved, score: st.solved ? st.wrong.length : 0, wrong: st.wrong.length, total: HANG_MAX_WRONG };
        }
        if (game === "unitle" || game === "blur") {
            const max = game === "blur" ? BLUR_GUESSES : UNITLE_TRIES;
            const g = play.guesses;
            if (!guessList(g, max, p.target)) return null;
            if (game === "blur" && !(play.hints === undefined || (isInt(play.hints) && play.hints <= BLUR_HINTS))) return null;
            const won = g.includes(p.target);
            return { game, finished: won || g.length === max, won, score: won ? g.length : 0, total: max };
        }
        const picks = play.picks;
        if (!Array.isArray(picks) || picks.length > p.rounds.length) return null;
        let score = 0;
        for (let i = 0; i < picks.length; i++) {
            const r = p.rounds[i];
            if (picks[i] !== r.a && picks[i] !== r.b) return null;
            if (picks[i] === hiloWinner(units, r)) score++;
            else if (i !== picks.length - 1) return null; // a miss ends the run
        }
        return { game, finished: score < picks.length || picks.length === p.rounds.length, score, total: p.rounds.length };
    }

    /* ---------------- Endless runs (free play + weekly leaderboard) ----------------
       A run goes on until you miss. Trivia and Higher or Lower score 1 per
       right answer; Unitle and Guess the Unit go unit after unit, scoring
       more for fewer guesses. The same rules run in two places: in the page
       for guests and friends' challenges (unranked), and on the server for
       signed-in players, where answers never reach the browser and the score
       counts toward the weekly leaderboard (api/games.js). Everything about a
       run follows from its seed and its step, so both agree exactly. */
    const RUN_LIMIT_MS = { trivia: 20000, hilo: 15000, unitle: 180000, guess: 90000, blur: 60000 };
    // Each new question's clock starts this long after the answer comes back,
    // so the moment spent looking at what you got right isn't counted.
    const RUN_PAUSE_MS = 2000;
    // The server allows this much on top, for the trip there and back.
    const RUN_GRACE_MS = 3000;
    const RUN_TRIVIA_KINDS = TRIVIA_KINDS.filter(k => k !== "whoIsThis"); // its picture is its answer
    const runRng = (game, seed, step) => seededRandom(hashString(`run:${game}:${seed}:${step}`));
    const unitlePoints = (guesses) => Math.max(1, UNITLE_TRIES + 1 - guesses);           // 1 guess → 6 … 6 guesses → 1
    const hangPoints = (wrong) => Math.max(1, HANG_MAX_WRONG - wrong);                     // no misses → 6 … 5 misses → 1
    const blurPoints = (guesses) => Math.max(1, BLUR_GUESSES + 1 - guesses);              // 3 / 2 / 1
    // Blur: hints are shared by the whole run — once they're used up they're
    // gone (still at most BLUR_HINTS on any one unit).
    const RUN_BLUR_HINTS = 5;
    const hintsLeftOf = (run) => (Number.isInteger(run.hintsLeft) ? run.hintsLeft : RUN_BLUR_HINTS);

    /* Weekly leaderboard: every game is worth the same, so no one game is
       the way to the top. A run's score IS its points: a run stops when it
       reaches LB_CAP, and what it shows is what counts (no converting).
       ⭐ Each day, the game that's Today's Puzzle counts double: a run
       started that day in that game is worth twice its score. A game's
       place on the board is its best run this week, doubled or not — so up
       to LB_CAP × 2, and LB_MAX for the week (every game comes up as the
       puzzle at least once a week). */
    const LB_CAP = 20;
    const LB_GAME_MAX = LB_CAP * 2;
    const LB_MAX = LB_GAME_MAX * GAMES.length;
    const lbPoints = (game, raw) => Math.min(LB_CAP, Math.max(0, Math.floor(Number(raw) || 0)));
    const BONUS_FROM = "2026-10-26";
    // Today's ⭐ double-points game: the day's puzzle game (none before it started).
    const bonusGameFor = (day) => (typeof day === "string" && day >= BONUS_FROM ? dailyGameFor(day) : null);
    // What one run adds to its game on the board.
    const lbRunPoints = (game, raw, bonus) => lbPoints(game, raw) * (bonus ? 2 : 1);
    // A week's board points per game, from what's saved: `pts` (each game's
    // best run, doubled or not), or for a row from before that, its best scores.
    const lbPts = (row) => Object.fromEntries(GAMES.map(g => [g, row && row.pts
        ? Math.min(LB_GAME_MAX, Math.max(0, Math.floor(Number(row.pts[g]) || 0)))
        : lbPoints(g, ((row && row.best) || {})[g])]));
    const lbTotal = (row) => { const p = lbPts(row); return GAMES.reduce((sum, g) => sum + p[g], 0); };

    function runTriviaQuestion(units, seed, step) {
        const rand = runRng("trivia", seed, step);
        for (const k of shuffle(rand, RUN_TRIVIA_KINDS)) { const q = triviaQuestion(units, rand, k); if (q) return q; }
        return triviaQuestion(units, rand, "faction");
    }
    const runHiloRound = (units, seed, step) => hiloRound(units, runRng("hilo", seed, step));
    const runUnitleTarget = (units, seed, step) => unitleTarget(units, runRng("unitle", seed, step));
    const runHangTarget = (units, seed, step) => hangTarget(units, runRng("guess", seed, step));
    const runBlurPuzzle = (units, seed, step) => blurPuzzle(units, runRng("blur", seed, step));

    function runNew(game, seed, now) {
        if (!GAMES.includes(game)) throw new Error("Unknown game.");
        const run = { game, seed, step: 0, score: 0, over: false, guesses: [], letters: [], deadline: now + RUN_LIMIT_MS[game] };
        if (game === "blur") { run.hints = 0; run.hintsLeft = RUN_BLUR_HINTS; }
        return run;
    }

    // What the player sees now — never the answer. (Blur's `img` names the
    // unit, so the server swaps it for a cropped, blurred picture.)
    function runView(units, run) {
        const { game, seed, step } = run;
        if (game === "trivia") {
            const q = runTriviaQuestion(units, seed, step);
            return { q: q.q, options: q.options, img: q.img || null, unitOptions: !!q.unitOptions };
        }
        if (game === "hilo") return runHiloRound(units, seed, step);
        if (game === "unitle") {
            const t = unitByKey(units, runUnitleTarget(units, seed, step));
            return { guesses: run.guesses.map(k => ({ key: k, cells: unitleCells(unitByKey(units, k), t) })) };
        }
        if (game === "blur") {
            const p = runBlurPuzzle(units, seed, step);
            const t = unitByKey(units, p.target);
            return {
                mask: nameMask(t.name, run.hints >= 3),
                hints: [1, 2, 3].slice(0, run.hints).map(n => blurHint(t, n)),
                hintsLeft: hintsLeftOf(run),
                wrong: run.guesses.slice(),
                picture: { ...blurView(run.guesses.length, run.hints, false), focus: p.focus },
                img: t.img
            };
        }
        const t = unitByKey(units, runHangTarget(units, seed, step));
        const letters = run.letters || [];
        return { mask: hangMask(t.name, letters), letters: letters.slice(), wrong: hangState(t.name, letters).wrong, maxWrong: HANG_MAX_WRONG, clue: hangClue(t) };
    }

    // One move. input: trivia { answer: option index }, hilo { pick: unit
    // key }, unitle { guess: unit key }, guess (Hangman) { letter: "A".."Z" },
    // blur { guess: unit key } or { hint: true };
    // null (or arriving after the deadline + grace) means time
    // ran out. Returns the next state and what happened; throws on a move
    // that isn't allowed (a guess that isn't a unit, the same guess twice).
    function runStep(units, run, input, now, grace = 0) {
        if (run.over) throw new Error("This run has ended.");
        const r = { ...run, guesses: run.guesses.slice(), letters: (run.letters || []).slice() };
        const late = now > run.deadline + grace;
        const unitInfo = (key) => { const u = unitByKey(units, key); return { key, name: u.name, img: u.img }; };
        // A run tops out at LB_CAP: the unit that gets there scores only what's
        // left, and the run ends there — a perfect run.
        const nextUnit = (points) => {
            const got = Math.max(0, Math.min(points, LB_CAP - r.score)); // (a run from before the cap may already be past it)
            r.score += got; r.step++; r.guesses = []; r.letters = [];
            if (r.game === "blur") r.hints = 0;
            r.deadline = now + RUN_PAUSE_MS + RUN_LIMIT_MS[r.game];
            if (r.score >= LB_CAP) r.over = true;
            return got;
        };
        const finish = (fb) => { r.over = true; return { run: r, feedback: { ...fb, timedOut: late || input == null } }; };
        const validGuess = (key) => {
            if (typeof key !== "string" || !unitByKey(units, key)) throw new Error("That's not a troop or hero.");
            if (r.guesses.includes(key)) throw new Error("You already guessed that one.");
        };

        if (r.game === "trivia" || r.game === "hilo") {
            let right, fb;
            if (r.game === "trivia") {
                const q = runTriviaQuestion(units, r.seed, r.step);
                const picked = input && Number.isInteger(input.answer) ? input.answer : null;
                right = !late && picked === q.answer;
                fb = { correct: right, answer: q.answer, picked, reveal: q.reveal || null };
            } else {
                const rd = runHiloRound(units, r.seed, r.step);
                const picked = input && (input.pick === rd.a || input.pick === rd.b) ? input.pick : null;
                const winner = hiloWinner(units, rd);
                right = !late && picked === winner;
                fb = { correct: right, winner, picked, values: { [rd.a]: unitByKey(units, rd.a)[rd.stat], [rd.b]: unitByKey(units, rd.b)[rd.stat] } };
            }
            if (!right) return finish(fb);
            nextUnit(1);
            return { run: r, feedback: { ...fb, points: 1, ...(r.over ? { maxed: true } : {}) } };
        }

        if (r.game === "guess") {
            const target = runHangTarget(units, r.seed, r.step), name = unitByKey(units, target).name;
            if (late || !input) return finish({ failed: true, answer: unitInfo(target) });
            const letter = typeof input.letter === "string" ? input.letter.toUpperCase() : null;
            if (!validLetter(letter)) throw new Error("Pick a letter.");
            if (r.letters.includes(letter)) throw new Error("You already tried that letter.");
            r.letters.push(letter);
            const st = hangState(name, r.letters);
            const hit = nameLetters(name).has(letter);
            if (st.solved) {
                const misses = st.wrong.length;
                const points = nextUnit(hangPoints(misses));
                return { run: r, feedback: { solved: true, points, misses, letter, hit, answer: unitInfo(target), ...(r.over ? { maxed: true } : {}) } };
            }
            if (st.lost) return finish({ failed: true, letter, hit, answer: unitInfo(target), mask: hangMask(name, nameLetters(name) ? [...nameLetters(name)] : []) });
            return { run: r, feedback: { letter, hit } };
        }
        const target = r.game === "blur" ? runBlurPuzzle(units, r.seed, r.step).target : runUnitleTarget(units, r.seed, r.step);
        if (late || !input) return finish({ failed: true, answer: unitInfo(target) });
        if (r.game === "blur" && input.hint) {
            const left = hintsLeftOf(r);
            if (r.hints < BLUR_HINTS && left > 0) { r.hints++; r.hintsLeft = left - 1; }
            return { run: r, feedback: { hint: true } };
        }
        validGuess(input.guess);
        if (input.guess === target) {
            const tries = r.guesses.length + 1;
            const solvedIn = [...r.guesses, input.guess];
            const points = nextUnit(r.game === "blur" ? blurPoints(tries) : unitlePoints(tries));
            return { run: r, feedback: { solved: true, points, tries, answer: unitInfo(target), guesses: solvedIn, ...(r.over ? { maxed: true } : {}) } };
        }
        r.guesses.push(input.guess);
        if (r.guesses.length >= (r.game === "blur" ? BLUR_GUESSES : UNITLE_TRIES)) return finish({ failed: true, answer: unitInfo(target), lastGuess: input.guess });
        return { run: r, feedback: { wrong: true, guess: unitInfo(input.guess) } };
    }


    return {
        RUN_LIMIT_MS, RUN_PAUSE_MS, RUN_GRACE_MS, RUN_TRIVIA_KINDS, RUN_BLUR_HINTS, unitlePoints, hangPoints, blurPoints,
        LB_CAP, LB_GAME_MAX, LB_MAX, lbPoints, lbRunPoints, lbPts, lbTotal, bonusGameFor, BONUS_FROM, DAILY_WEEKS_FROM,
        runNew, runView, runStep, runTriviaQuestion, runHiloRound, runUnitleTarget, runHangTarget, runBlurPuzzle,
        RARITIES, GAMES, GAME_TITLES, GAME_ICONS, DAILY_FIVE_FROM,
        hashString, seededRandom, dayRng, pick, shuffle, sample, dailyGameFor,
        esc, cap, fmt, buildUnits, unitByKey, levelOf, normName, nameAliases, resolveName, nameMask,
        ABILITY_FILES, ABILITY_NUMBERS, DATA_FILES, ALL_DATA_FILES, unitsFromFiles, redactNames,
        BLUR_GUESSES, BLUR_HINTS, BLUR_ZOOM, BLUR_AMOUNT, blurPuzzle, blurView, blurHint, blurCrop,
        TRIVIA_COUNT, TRIVIA_KINDS, triviaQuestion, triviaSet, quoteNamesUnit,
        HANG_MAX_WRONG, HANG_LETTERS, hangTarget, hangState, hangMask, hangClue, nameLetters,
        UNITLE_TRIES, unitleTarget, unitleCells, shortNum,
        HILO_STATS, HILO_DAILY_ROUNDS, hiloRound, hiloRounds, hiloWinner,
        dailyPuzzle, dailyResult
    };
});
