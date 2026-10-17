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
    const GAMES = ["trivia", "guess", "unitle", "hilo"];
    const GAME_TITLES = { trivia: "Trivia", guess: "Guess the Unit", unitle: "Unitle", hilo: "Higher or Lower" };
    const GAME_ICONS = { trivia: "🧠", guess: "🔍", unitle: "🎯", hilo: "⬆️" };

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
    // of 4 that each play all four games in a shuffled order, so every game
    // comes up once every 4 days. If a block would start with the game that
    // ended the block before, its first two swap; only those two ever move,
    // so a block's last game is fixed and the check never chains.
    function dailyGameFor(day) {
        const n = Math.floor(Date.parse(day + "T00:00:00Z") / 864e5);
        const block = Math.floor(n / GAMES.length);
        const order = (b) => shuffle(seededRandom(hashString("kih-daily-game:" + b)), GAMES);
        const o = order(block);
        if (o[0] === order(block - 1)[GAMES.length - 1]) [o[0], o[1]] = [o[1], o[0]];
        return o[n % GAMES.length];
    }

    /* ---------------- units ---------------- */
    const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
    const fmt = (n) => Number(n).toLocaleString("en-US");

    // Every troop and hero shown on the site, from the raw game data files.
    function buildUnits({ troops, troopLevels, heroes, heroLevels, loc, en }) {
        const text = (k) => { const l = loc[k]; return l ? en[l.value] : null; };
        const byUnit = {};
        Object.values(troopLevels).forEach(l => { (byUnit["t:" + l.troopId] = byUnit["t:" + l.troopId] || []).push(l); });
        Object.values(heroLevels).forEach(l => { (byUnit["h:" + l.heroId] = byUnit["h:" + l.heroId] || []).push(l); });
        const build = (meta, type, prefix) => Object.keys(meta).map(key => {
            const m = meta[key];
            const rows = (byUnit[prefix + key] || []).slice().sort((a, b) => a.level - b.level);
            if (m.isDisplayed === false || !rows.length || /^boss/i.test(key)) return null;
            const levels = rows.map(r => ({ level: r.level, hp: r.health, atk: r.attack, count: r.count || 1 }));
            const first = levels[0], last = levels[levels.length - 1];
            return {
                key, type,
                name: text(m.name) || key,
                rarity: m.rarityId,
                faction: m.factionId,
                attack: m.attackType === "Range" ? "Ranged" : "Melee",
                levels,
                hp1: first.hp, atk1: first.atk, hpMax: last.hp, atkMax: last.atk, maxLevel: last.level,
                desc: m.description ? text(m.description) : null,
                img: `images/${key.toUpperCase()}.jpg`
            };
        }).filter(Boolean);
        return [...build(troops, "troop", "t:"), ...build(heroes, "hero", "h:")].filter(u => u.name && u.rarity && u.faction);
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
    const TRIVIA_KINDS = ["faction", "rarity", "attack", "whoIsThis", "mostHpAt", "mostAtkAt", "hpAtLevel", "atkAtLevel", "quote", "isHero", "squadAt"];

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
            case "rarity": {
                const u = pick(rand, units);
                return mc(rand, kind, `What rarity is <b>${esc(u.name)}</b>?`, cap(u.rarity), sample(rand, RARITIES.filter(r => r !== u.rarity), 3).map(cap), { img: u.img });
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
            case "mostAtkAt": {
                const stat = kind === "mostHpAt" ? "hp" : "atk";
                const L = level();
                const pool = pick(rand, [troops, heroes]).filter(u => levelOf(u, L));
                for (let tries = 0; tries < 40; tries++) {
                    const four = sample(rand, pool, 4);
                    const vals = four.map(u => levelOf(u, L)[stat]);
                    if (new Set(vals).size !== 4) continue;
                    const best = four[vals.indexOf(Math.max(...vals))];
                    const q = mc(rand, kind, `Which of these has the most <b>${stat === "hp" ? "HP" : "attack"}</b> at <b>level ${L}</b>?`, best.name, four.filter(u => u !== best).map(u => u.name), { unitOptions: true });
                    q.reveal = q.options.map(n => fmt(levelOf(units.find(u => u.name === n), L)[stat]));
                    return q;
                }
                return null;
            }
            case "hpAtLevel":
            case "atkAtLevel": {
                const stat = kind === "hpAtLevel" ? "hp" : "atk";
                const u = pick(rand, units);
                const L = level();
                const right = levelOf(u, L);
                if (!right) return null;
                const others = [...new Set(u.levels.map(l => l[stat]).filter(v => v !== right[stat]))];
                if (others.length < 3) return null;
                return mc(rand, kind, `How much <b>${stat === "hp" ? "HP" : "attack"}</b> does <b>${esc(u.name)}</b> have at <b>level ${L}</b>?`,
                    fmt(right[stat]), sample(rand, others, 3).map(fmt), { img: u.img });
            }
            case "squadAt": {
                const L = level();
                const withLevel = troops.filter(u => levelOf(u, L));
                // Any one level only has 2–3 squad sizes, so the wrong
                // answers come from every size there is (1, 2, 3, 5, 7, 9).
                const counts = [...new Set(troops.flatMap(u => u.levels.map(l => l.count)))];
                if (counts.length < 4 || !withLevel.length) return null;
                const u = pick(rand, withLevel);
                const c = levelOf(u, L).count;
                return mc(rand, kind, `How many units are in one <b>${esc(u.name)}</b> squad at <b>level ${L}</b>?`, String(c), sample(rand, counts.filter(x => x !== c), 3).map(String), { img: u.img });
            }
            case "quote": {
                const withQuote = troops.filter(u => u.desc && u.desc.length > 8 && !quoteNamesUnit(u));
                if (withQuote.length < 4) return null;
                const u = pick(rand, withQuote);
                return mc(rand, kind, `Which troop's description is this?<br><i>"${esc(u.desc)}"</i>`, u.name, sample(rand, troops.filter(x => x.key !== u.key), 3).map(x => x.name), { unitOptions: true });
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

    /* ---------------- Guess the Unit ---------------- */
    const MAX_GUESSES = 3;
    const MAX_HINTS = 3;
    // Zoom and blur per wrong guess so far (the last is the full reveal).
    const GUESS_ZOOM = [5, 3.5, 2.3, 1];
    const GUESS_BLUR = [2.5, 1.6, 0.8, 0];
    function guessPuzzle(units, rand) {
        const target = pick(rand, units);
        // Zoom point: anywhere across, the upper part down (the bottom of
        // each picture — where many show the unit's name — is cropped off).
        const focus = [20 + Math.floor(rand() * 61), 15 + Math.floor(rand() * 41)];
        return { target: target.key, focus };
    }
    // How the picture looks: each wrong guess moves one stage along
    // GUESS_ZOOM/GUESS_BLUR, the first hint half a stage more. The full
    // picture (the last stage) only shows once the game is over.
    function guessView(wrong, hints, done) {
        if (done) return { zoom: GUESS_ZOOM[GUESS_ZOOM.length - 1], blur: 0 };
        const pos = Math.min(wrong + (hints >= 1 ? 0.5 : 0), GUESS_ZOOM.length - 1.5);
        const i = Math.floor(pos), f = pos - i;
        const at = (arr) => Math.round((arr[i] + (arr[i + 1] - arr[i]) * f) * 100) / 100;
        return { zoom: at(GUESS_ZOOM), blur: at(GUESS_BLUR) };
    }
    // Hint 1 is the clearer picture; 2 is what kind of unit; 3 fills in letters.
    function guessHint(u, n) {
        if (n === 1) return `The picture zooms out a little and gets clearer.`;
        if (n === 2) return `It's a <b>${cap(u.rarity)}</b> ${u.type} · <b>${esc(u.faction)}</b> · fights <b>${u.attack.toLowerCase()}</b>.`;
        return `Some letters are filled in above.`;
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
        { key: "hpMax", label: "HP at max level" }, { key: "atkMax", label: "attack at max level" }
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
        if (game === "guess") return { game, ...guessPuzzle(units, rand) };
        if (game === "unitle") return { game, target: unitleTarget(units, rand) };
        return { game, rounds: hiloRounds(units, rand, HILO_DAILY_ROUNDS) };
    }

    // Where a play of a day's puzzle stands: { game, finished, score, won,
    // total }, or null if `play` isn't a possible play of that puzzle at all
    // (an answer that doesn't exist, a guess after the right one, a pick
    // after a miss...). The page uses it to show progress; the server pays
    // the day's token only for a play that's possible AND finished.
    //   trivia { answers: [option index] }    guess { guesses: [unit key], hints }
    //   unitle { guesses: [unit key] }         hilo  { picks: [unit key] }
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
        if (game === "guess" || game === "unitle") {
            const max = game === "guess" ? MAX_GUESSES : UNITLE_TRIES;
            const g = play.guesses;
            if (!guessList(g, max, p.target)) return null;
            if (game === "guess" && !(play.hints === undefined || (isInt(play.hints) && play.hints <= MAX_HINTS))) return null;
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

    return {
        RARITIES, GAMES, GAME_TITLES, GAME_ICONS,
        hashString, seededRandom, dayRng, pick, shuffle, sample, dailyGameFor,
        esc, cap, fmt, buildUnits, unitByKey, levelOf, normName, nameAliases, resolveName, nameMask,
        TRIVIA_COUNT, TRIVIA_KINDS, triviaQuestion, triviaSet, quoteNamesUnit,
        MAX_GUESSES, MAX_HINTS, GUESS_ZOOM, GUESS_BLUR, guessPuzzle, guessView, guessHint,
        UNITLE_TRIES, unitleTarget, unitleCells, shortNum,
        HILO_STATS, HILO_DAILY_ROUNDS, hiloRound, hiloRounds, hiloWinner,
        dailyPuzzle, dailyResult
    };
});
