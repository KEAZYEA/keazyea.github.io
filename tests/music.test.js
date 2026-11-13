// 🎵 music.js: both tunes stay in key and in time, the sound effects are
// sound, every game makes them, and the settings can't go wrong.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const M = require("../music.js");

const ROOT = path.join(__dirname, "..");
const INDEX = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const GAMES = fs.readFileSync(path.join(ROOT, "games.html"), "utf8");
const all = (song) => {
    const ev = [];
    for (let bar = 0; bar < M.BARS; bar++) for (let step = 0; step < M.STEPS; step++) M.eventsAt(bar, step, song).forEach(e => ev.push({ ...e, bar, step }));
    return ev;
};
const notesOf = (e) => e.notes || (e.note != null ? [e.note] : []);

test("two tunes: calm (72 a minute, ~53 s) and the Games one (108, ~36 s)", () => {
    assert.deepEqual(Object.keys(M.SONGS).sort(), ["games", "main"]);
    assert.equal(M.SONGS.main.BPM, 72);
    assert.equal(M.SONGS.games.BPM, 108);
    assert.ok(Math.abs(M.loopSeconds(M.SONGS.main) - 53.33) < 0.01);
    assert.ok(Math.abs(M.loopSeconds(M.SONGS.games) - 35.56) < 0.01);
    assert.equal(M.LOOP_SECONDS, M.loopSeconds(M.SONGS.main));
});

for (const song of Object.values(M.SONGS)) {
    test(`${song.id}: every note is in its key`, () => {
        const scale = new Set(song.scale);
        for (const e of all(song)) {
            for (const n of notesOf(e)) {
                assert.ok(Number.isInteger(n) && n >= 30 && n <= 96, `${e.kind} ${n}`);
                assert.ok(scale.has(n % 12), `${e.kind} note ${n} in bar ${e.bar + 1}`);
                const only = song.sharpOn[n % 12];
                if (only) assert.equal(song.chords[e.bar % song.chords.length].name, only, `${n} outside the ${only} chord (bar ${e.bar + 1})`);
            }
        }
    });
    test(`${song.id}: the melody comes in for bars 9–16 only, a full bar each`, () => {
        const lead = all(song).filter(e => e.kind === song.lead && e.bar >= 0);
        assert.ok(lead.length > 20);
        assert.ok(lead.every(e => e.bar >= 8), "no melody in bars 1–8");
        const barSec = M.STEPS * M.stepSecOf(song);
        lead.forEach(e => assert.ok(e.step * M.stepSecOf(song) + e.len <= barSec + 1e-9, `runs past bar ${e.bar + 1}`));
        song.melody.forEach((bar, i) => assert.equal(bar.reduce((s, [, , len]) => s + len, 0), 8, `melody bar ${i + 9} is a full bar`));
    });
    test(`${song.id}: every bar starts with bass and a beat, and it loops`, () => {
        for (let bar = 0; bar < M.BARS; bar++) {
            const kinds = M.eventsAt(bar, 0, song).map(e => e.kind);
            assert.ok(kinds.includes("bass"), `bar ${bar + 1} bass`);
            assert.ok(kinds.includes("drum") || kinds.includes("kick"), `bar ${bar + 1} beat`);
        }
        assert.deepEqual(M.eventsAt(16, 0, song), M.eventsAt(0, 0, song));
        assert.deepEqual(M.eventsAt(-1, 3, song), M.eventsAt(15, 3, song));
    });
}
test("the main tune is the default", () => assert.deepEqual(M.eventsAt(3, 4), M.eventsAt(3, 4, M.SONGS.main)));

test("note to pitch", () => {
    assert.equal(M.freq(69), 440);
    assert.ok(Math.abs(M.freq(57) - 220) < 1e-9);
});

test("sound effects: right, wrong, tick, match, win, lose — short, and win/right go up, wrong/lose go down", () => {
    assert.deepEqual(Object.keys(M.SFX).sort(), ["lose", "match", "right", "tick", "win", "wrong"]);
    for (const [name, fx] of Object.entries(M.SFX)) {
        const end = Math.max(...fx.notes.map(([, at, len]) => at + len));
        assert.ok(end <= 1.2, `${name} lasts ${end}s`);
        assert.ok(fx.vol > 0 && fx.vol <= 1, name);
    }
    const first = (n) => M.SFX[n].notes[0][0], last = (n) => M.SFX[n].notes[M.SFX[n].notes.length - 1][0];
    assert.ok(last("win") > first("win") && last("right") > first("right"), "happy ones rise");
    assert.ok(last("wrong") < first("wrong") && last("lose") < first("lose"), "sad ones fall");
});

test("settings: music and sounds on, 35% to start; bad saved values can't break it", () => {
    assert.deepEqual(M.cleanPrefs({}), { on: true, vol: 35, sfx: true });
    assert.deepEqual(M.cleanPrefs(null), { on: true, vol: 35, sfx: true });
    assert.deepEqual(M.cleanPrefs({ on: false, vol: 250, sfx: false }), { on: false, vol: 100, sfx: false });
    assert.deepEqual(M.cleanPrefs({ on: "yes", vol: -5, sfx: 1 }), { on: true, vol: 0, sfx: true });
    assert.deepEqual(M.cleanPrefs({ vol: "abc" }), { on: true, vol: 35, sfx: true });
    assert.deepEqual(M.cleanPrefs({ on: true, vol: 60 }), { on: true, vol: 60, sfx: true }, "older saved settings (no sfx yet) keep the sounds on");
    assert.equal(M.gainFor(0), 0);
    assert.ok(M.gainFor(100) <= 1 && M.gainFor(50) < M.gainFor(100) / 2, "the slider is gentle at the low end");
});

test("the page has the 🎵 buttons, the panel (music, sounds, volume) and the Settings rows", () => {
    assert.match(INDEX, /<script src="music\.js"><\/script>/);
    assert.match(INDEX, /id="musicBtnHome" data-music-btn/);
    assert.match(INDEX, /id="musicBtnPage" data-music-btn/);
    assert.match(INDEX, /id="musicPop"[\s\S]*?data-music-toggle[\s\S]*?data-music-vol[\s\S]*?data-sfx-toggle/);
    assert.match(INDEX, /🎵 Music<\/div>[\s\S]{0,400}data-music-vol[\s\S]{0,200}data-music-toggle/);
    assert.match(INDEX, /🔔 Game sounds<\/div>[\s\S]{0,300}data-sfx-toggle/);
    assert.match(INDEX, /id="page-games"/, "the Games page music.js watches for its tune");
});

test("every game makes its sounds", () => {
    const body = (name) => {
        const i = GAMES.indexOf(`function ${name}(`);
        assert.ok(i >= 0, name);
        return GAMES.slice(i, GAMES.indexOf("\n        }\n", i));
    };
    const want = {
        answerTrivia: ["wrong", "right", "win"], guessLetter: ["win", "lose", "tick", "wrong"], submitBlur: ["win", "lose", "wrong"],
        makeUnitleGuess: ["win", "lose", "wrong"], pickHilo: ["lose", "win", "right"], memTapDaily: ["win", "match", "wrong"],
        memSettle: ["match", "wrong"], runSound: ["win", "lose", "wrong", "right", "tick"]
    };
    for (const [fn, sounds] of Object.entries(want)) {
        const b = body(fn);
        sounds.forEach(s => assert.ok(b.includes(`"${s}"`), `${fn} plays "${s}"`));
    }
    assert.match(body("applyRunResp"), /sfx\(runSound\(ui, resp, fb\)\)/, "ranked runs play them too");
    assert.match(GAMES, /window\.parent\.KihMusic/, "through the app's music.js");
    Object.keys(M.SFX).forEach(s => assert.ok(GAMES.includes(`"${s}"`), `${s} is used`));
});
