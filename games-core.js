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

    /* ---------------- Endless runs (free play + weekly leaderboard) ----------------
       A run goes on until you miss. Trivia and Higher or Lower score 1 per
       right answer; Unitle and Guess the Unit go unit after unit, scoring
       more for fewer guesses. The same rules run in two places: in the page
       for guests and friends' challenges (unranked), and on the server for
       signed-in players, where answers never reach the browser and the score
       counts toward the weekly leaderboard (api/games.js). Everything about a
       run follows from its seed and its step, so both agree exactly. */
    const RUN_LIMIT_MS = { trivia: 20000, hilo: 15000, unitle: 180000, guess: 60000 };
    // Each new question's clock starts this long after the answer comes back,
    // so the moment spent looking at what you got right isn't counted.
    const RUN_PAUSE_MS = 2000;
    // The server allows this much on top, for the trip there and back.
    const RUN_GRACE_MS = 3000;
    const RUN_TRIVIA_KINDS = TRIVIA_KINDS.filter(k => k !== "whoIsThis"); // its picture is its answer
    const runRng = (game, seed, step) => seededRandom(hashString(`run:${game}:${seed}:${step}`));
    const unitlePoints = (guesses) => Math.max(1, UNITLE_TRIES + 1 - guesses);           // 1 guess → 6 … 6 guesses → 1
    const guessPoints = (guesses) => Math.max(1, 4 - guesses); // 3 / 2 / 1
    // Guess the Unit: hints are shared by the whole run — once they're used
    // up they're gone (still at most MAX_HINTS on any one unit).
    const RUN_GUESS_HINTS = 5;
    const hintsLeftOf = (run) => (Number.isInteger(run.hintsLeft) ? run.hintsLeft : RUN_GUESS_HINTS);

    function runTriviaQuestion(units, seed, step) {
        const rand = runRng("trivia", seed, step);
        for (const k of shuffle(rand, RUN_TRIVIA_KINDS)) { const q = triviaQuestion(units, rand, k); if (q) return q; }
        return triviaQuestion(units, rand, "rarity");
    }
    const runHiloRound = (units, seed, step) => hiloRound(units, runRng("hilo", seed, step));
    const runUnitleTarget = (units, seed, step) => unitleTarget(units, runRng("unitle", seed, step));
    const runGuessPuzzle = (units, seed, step) => guessPuzzle(units, runRng("guess", seed, step));

    function runNew(game, seed, now) {
        if (!GAMES.includes(game)) throw new Error("Unknown game.");
        const run = { game, seed, step: 0, score: 0, over: false, guesses: [], hints: 0, deadline: now + RUN_LIMIT_MS[game] };
        if (game === "guess") run.hintsLeft = RUN_GUESS_HINTS;
        return run;
    }

    // What the player sees now — never the answer. (Guess the Unit's `img`
    // names the unit, so the server swaps it for a cropped picture.)
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
        const p = runGuessPuzzle(units, seed, step);
        const t = unitByKey(units, p.target);
        return {
            mask: nameMask(t.name, run.hints >= 3),
            hints: [1, 2, 3].slice(0, run.hints).map(n => guessHint(t, n)),
            hintsLeft: hintsLeftOf(run),
            wrong: run.guesses.slice(),
            picture: { ...guessView(run.guesses.length, run.hints, false), focus: p.focus },
            img: t.img
        };
    }

    // One move. input: trivia { answer: option index }, hilo { pick: unit
    // key }, unitle { guess: unit key }, guess { guess: unit key } or
    // { hint: true }; null (or arriving after the deadline + grace) means time
    // ran out. Returns the next state and what happened; throws on a move
    // that isn't allowed (a guess that isn't a unit, the same guess twice).
    function runStep(units, run, input, now, grace = 0) {
        if (run.over) throw new Error("This run has ended.");
        const r = { ...run, guesses: run.guesses.slice() };
        const late = now > run.deadline + grace;
        const unitInfo = (key) => { const u = unitByKey(units, key); return { key, name: u.name, img: u.img }; };
        const nextUnit = (points) => {
            r.score += points; r.step++; r.guesses = []; r.hints = 0;
            r.deadline = now + RUN_PAUSE_MS + RUN_LIMIT_MS[r.game];
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
            r.score++; r.step++;
            r.deadline = now + RUN_PAUSE_MS + RUN_LIMIT_MS[r.game];
            return { run: r, feedback: { ...fb, points: 1 } };
        }

        const target = r.game === "unitle" ? runUnitleTarget(units, r.seed, r.step) : runGuessPuzzle(units, r.seed, r.step).target;
        if (late || !input) return finish({ failed: true, answer: unitInfo(target) });
        if (r.game === "guess" && input.hint) {
            const left = hintsLeftOf(r);
            if (r.hints < MAX_HINTS && left > 0) { r.hints++; r.hintsLeft = left - 1; }
            return { run: r, feedback: { hint: true } };
        }
        validGuess(input.guess);
        if (input.guess === target) {
            const tries = r.guesses.length + 1;
            const points = r.game === "unitle" ? unitlePoints(tries) : guessPoints(tries);
            const solvedIn = [...r.guesses, input.guess];
            nextUnit(points);
            return { run: r, feedback: { solved: true, points, tries, answer: unitInfo(target), guesses: solvedIn } };
        }
        r.guesses.push(input.guess);
        const max = r.game === "unitle" ? UNITLE_TRIES : MAX_GUESSES;
        if (r.guesses.length >= max) return finish({ failed: true, answer: unitInfo(target), lastGuess: input.guess });
        return { run: r, feedback: { wrong: true, guess: unitInfo(input.guess) } };
    }

    // Where Guess the Unit's frame looks, in the picture's own pixels: the
    // same view the page gets with CSS (a 230px square showing the top of the
    // picture, scaled by `zoom` around `focus`), so a server-made crop
    // matches what a guest sees exactly.
    function guessCrop(imgW, imgH, focus, zoom) {
        const FRAME = 230, BOX_H = FRAME * 1.25;
        const s = Math.max(FRAME / imgW, BOX_H / imgH);
        const offX = (FRAME - imgW * s) / 2;
        const ox = focus[0] / 100 * FRAME, oy = focus[1] / 100 * BOX_H;
        const x0 = ox - ox / zoom, x1 = ox + (FRAME - ox) / zoom;
        const y0 = oy - oy / zoom, y1 = oy + (FRAME - oy) / zoom;
        return { x: (x0 - offX) / s, y: y0 / s, w: (x1 - x0) / s, h: (y1 - y0) / s, scale: s };
    }

    return {
        RUN_LIMIT_MS, RUN_PAUSE_MS, RUN_GRACE_MS, RUN_TRIVIA_KINDS, RUN_GUESS_HINTS, unitlePoints, guessPoints,
        runNew, runView, runStep, runTriviaQuestion, runHiloRound, runUnitleTarget, runGuessPuzzle, guessCrop,
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
