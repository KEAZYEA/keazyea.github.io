/* music.js — 🎵 the app's background music and 🔔 the games' sound effects,
   played live by the browser (Web Audio) from the notes written below, so
   there's no audio file to download and nothing anyone else owns.

   Two tunes (SONGS), each 16 bars and then round again:
   • main  — calm fantasy, A minor, 72 a minute (~53 s): harp, strings and
     bass with a soft war drum; a flute melody joins for bars 9–16.
   • games — bouncy, C major, 108 a minute (~36 s): marimba-style plucks,
     a walking bass, kick, snare and shaker; the melody in bars 9–16.
   The Games page plays "games"; everywhere else plays "main".

   Sound effects (SFX): right, wrong, tick (a letter found), match (a
   Memory pair), win and lose — games.html calls KihMusic.sfx(name).

   Players control it from 🎵 (top bar on Home and every page, and ⚙️
   Settings): music on/off, sound effects on/off and one volume slider,
   remembered on this device (kih_music). Both are on by default at a low
   volume. Browsers only allow sound after a tap, so it starts on your
   first tap. Music stops while the app is in the background, and while a
   video is playing in Social.

   Shared by the page (window.KihMusic) and the tests (require): the songs
   and the prefs are plain data and functions; the sound is browser-only. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.KihMusic = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    const STEPS = 16; // 16th notes in a bar
    const BARS = 16;  // every tune loops after 16 bars (its chords twice)

    /* ---------------- 🏰 main: calm fantasy (A minor) ---------------- */
    const MAIN = {
        id: "main", BPM: 72,
        // A natural minor, plus G# (the E chord's leading note)
        scale: [9, 11, 0, 2, 4, 5, 7, 8], sharpOn: { 8: "E" },
        // one chord a bar: its bass note and the three notes the strings hold
        // (MIDI numbers: 57 = A3, 60 = C4 …)
        chords: [
            { name: "Am", bass: 45, pad: [57, 60, 64] },
            { name: "F", bass: 41, pad: [57, 60, 65] },
            { name: "C", bass: 48, pad: [55, 60, 64] },
            { name: "G", bass: 43, pad: [55, 59, 62] },
            { name: "Am", bass: 45, pad: [57, 60, 64] },
            { name: "F", bass: 41, pad: [57, 60, 65] },
            { name: "Dm", bass: 38, pad: [57, 62, 65] },
            { name: "E", bass: 40, pad: [56, 59, 64] }
        ],
        // the flute, bars 9–16: [note, start, length] in 8th notes within the bar
        melody: [
            [[76, 0, 3], [74, 3, 1], [72, 4, 2], [69, 6, 2]],
            [[72, 0, 2], [74, 2, 2], [72, 4, 4]],
            [[67, 0, 3], [69, 3, 1], [72, 4, 2], [76, 6, 2]],
            [[74, 0, 6], [71, 6, 2]],
            [[76, 0, 3], [79, 3, 1], [76, 4, 2], [74, 6, 2]],
            [[72, 0, 2], [74, 2, 2], [77, 4, 4]],
            [[76, 0, 2], [74, 2, 2], [72, 4, 2], [74, 6, 2]],
            [[71, 0, 4], [68, 4, 4]]
        ],
        lead: "flute",
        // what plays on each 16th (besides the melody)
        pattern(bar, step, chord, second, stepSec) {
            const out = [];
            if (step === 0) {
                out.push({ kind: "pad", notes: chord.pad, len: STEPS * stepSec, vel: 1 });
                out.push({ kind: "bass", note: chord.bass, len: 8 * stepSec, vel: 1 });
                out.push({ kind: "drum", vel: second ? 1 : 0.6 });
            }
            if (step === 8) {
                out.push({ kind: "bass", note: chord.bass, len: 8 * stepSec, vel: 0.6 });
                if (second) out.push({ kind: "drum", vel: 0.55 });
            }
            if (second && step === 14 && bar % 2 === 1) out.push({ kind: "drum", vel: 0.4 });
            if (step % 2 === 0) { // the harp walks up and down the chord
                const tones = [...chord.pad, chord.pad[0] + 12, chord.pad[1] + 12];
                out.push({ kind: "harp", note: tones[[0, 1, 2, 3, 4, 3, 2, 1][step / 2]], vel: step === 0 ? 1 : 0.75 });
            }
            if (step === 4 || step === 12) out.push({ kind: "shaker", vel: second ? 1 : 0.6 });
            if (second && step % 4 === 2) out.push({ kind: "shaker", vel: 0.35 });
            return out;
        }
    };

    /* ---------------- 🎮 games: bouncy (C major) ---------------- */
    const GAMES = {
        id: "games", BPM: 108,
        scale: [0, 2, 4, 5, 7, 9, 11], sharpOn: {},
        chords: [
            { name: "C", bass: 36, pad: [60, 64, 67] },
            { name: "G", bass: 43, pad: [59, 62, 67] },
            { name: "Am", bass: 45, pad: [60, 64, 69] },
            { name: "F", bass: 41, pad: [60, 65, 69] },
            { name: "C", bass: 36, pad: [60, 64, 67] },
            { name: "G", bass: 43, pad: [59, 62, 67] },
            { name: "F", bass: 41, pad: [60, 65, 69] },
            { name: "G", bass: 43, pad: [59, 62, 67] }
        ],
        melody: [
            [[72, 0, 1], [76, 1, 1], [79, 2, 2], [76, 4, 1], [72, 5, 1], [74, 6, 2]],
            [[71, 0, 2], [74, 2, 2], [79, 4, 3], [77, 7, 1]],
            [[76, 0, 1], [72, 1, 1], [69, 2, 2], [72, 4, 2], [76, 6, 2]],
            [[77, 0, 3], [76, 3, 1], [74, 4, 4]],
            [[72, 0, 1], [76, 1, 1], [79, 2, 2], [84, 4, 2], [79, 6, 2]],
            [[83, 0, 2], [81, 2, 1], [79, 3, 1], [74, 4, 4]],
            [[77, 0, 2], [81, 2, 2], [79, 4, 1], [77, 5, 1], [76, 6, 2]],
            [[74, 0, 2], [71, 2, 2], [67, 4, 4]]
        ],
        lead: "bell",
        pattern(bar, step, chord, second, stepSec) {
            const out = [];
            // a bouncing bass: root, then the octave, on the 8ths
            if (step % 4 === 0) out.push({ kind: "bass", note: chord.bass + (step % 8 === 4 ? 12 : 0), len: 3 * stepSec, vel: step === 0 ? 1 : 0.7 });
            if (step === 10) out.push({ kind: "bass", note: chord.bass + 7, len: 2 * stepSec, vel: 0.55 });
            // chords plucked on the off-beats, like a ukulele
            if (step === 2 || step === 6 || step === 10 || step === 14) out.push({ kind: "pluck", notes: chord.pad, vel: step === 6 || step === 14 ? 0.8 : 0.6 });
            if (step === 0 && second) out.push({ kind: "pad", notes: chord.pad, len: STEPS * stepSec, vel: 0.45 });
            // the beat
            if (step === 0 || step === 8 || (second && step === 11)) out.push({ kind: "kick", vel: step === 11 ? 0.6 : 1 });
            if (step === 4 || step === 12) out.push({ kind: "snare", vel: second ? 1 : 0.7 });
            if (step % 2 === 0) out.push({ kind: "shaker", vel: step % 4 === 2 ? 0.9 : 0.45 });
            return out;
        }
    };
    const SONGS = { main: MAIN, games: GAMES };

    const stepSecOf = (song) => 60 / song.BPM / 4;
    const loopSeconds = (song) => BARS * STEPS * stepSecOf(song);
    const freq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

    // Everything that starts on one 16th note of a tune's loop. Lengths in seconds.
    function eventsAt(bar, step, song) {
        song = song || MAIN;
        bar = ((bar % BARS) + BARS) % BARS;
        const n = song.chords.length, chord = song.chords[bar % n], second = bar >= n, stepSec = stepSecOf(song);
        const out = song.pattern(bar, step, chord, second, stepSec);
        if (second && step % 2 === 0) {
            song.melody[bar - n].forEach(([note, start, len]) => {
                if (start * 2 === step) out.push({ kind: song.lead, note, len: len * 2 * stepSec, vel: 1 });
            });
        }
        return out;
    }

    /* ---------------- 🔔 sound effects: [note, start (s), length (s)] ---------------- */
    const SFX = {
        right: { voice: "bell", notes: [[84, 0, 0.12], [88, 0.09, 0.35]], vol: 0.9 },   // ding-ding (C6 E6)
        tick: { voice: "bell", notes: [[91, 0, 0.18]], vol: 0.55 },                      // a bright blip (G6)
        match: { voice: "bell", notes: [[79, 0, 0.1], [84, 0.07, 0.1], [88, 0.14, 0.3]], vol: 0.75 }, // a little sparkle
        wrong: { voice: "buzz", notes: [[52, 0, 0.14], [47, 0.13, 0.3]], vol: 0.8 },      // a low bwomp
        win: { voice: "bell", notes: [[72, 0, 0.14], [76, 0.12, 0.14], [79, 0.24, 0.14], [84, 0.36, 0.7], [88, 0.36, 0.7]], vol: 1 }, // fanfare
        lose: { voice: "sad", notes: [[67, 0, 0.26], [64, 0.25, 0.26], [60, 0.5, 0.6]], vol: 0.9 } // three falling notes
    };

    /* ---------------- your settings ---------------- */
    const PREFS_KEY = "kih_music";
    const DEFAULTS = { on: true, vol: 35, sfx: true }; // vol: 0–100
    function cleanPrefs(p) {
        const v = p && p.vol != null && p.vol !== "" ? Number(p.vol) : NaN; // (Number(null) would be 0: silent)
        return {
            on: p && typeof p.on === "boolean" ? p.on : DEFAULTS.on,
            vol: Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : DEFAULTS.vol,
            sfx: p && typeof p.sfx === "boolean" ? p.sfx : DEFAULTS.sfx
        };
    }
    // the slider feels even to the ear (loudness isn't linear)
    const gainFor = (vol) => Math.pow(Math.max(0, Math.min(100, vol)) / 100, 2) * 0.9;

    const core = { STEPS, BARS, SONGS, SFX, stepSecOf, loopSeconds, freq, eventsAt, PREFS_KEY, DEFAULTS, cleanPrefs, gainFor,
        // (the main tune's numbers, as before)
        BPM: MAIN.BPM, CHORDS: MAIN.chords, MELODY: MAIN.melody, LOOP_SECONDS: loopSeconds(MAIN) };
    if (typeof window === "undefined" || typeof document === "undefined") return core;

    /* ---------------- the sound (browser) ---------------- */
    let prefs = (() => { try { return cleanPrefs(JSON.parse(localStorage.getItem(PREFS_KEY) || "{}")); } catch (e) { return { ...DEFAULTS }; } })();
    const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { } };
    let ctx = null, master = null, fxOut = null, analyser = null, dry = null, wet = null, noise = null;
    let timer = 0, nextTime = 0, bar = 0, step = 0, unlocked = false, mediaPlaying = 0, sfxUntil = 0;
    let song = MAIN;
    const stats = { scheduled: 0, sfx: 0, lastSfx: "" };

    function build() {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        ctx = new AC();
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -18; comp.ratio.value = 3;
        analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        comp.connect(analyser); analyser.connect(ctx.destination);
        master = ctx.createGain(); master.gain.value = 0; master.connect(comp);   // the music
        fxOut = ctx.createGain(); fxOut.gain.value = 0; fxOut.connect(comp);     // the sound effects
        // a little hall: a made-up echo that fades over ~2.5 s
        const verb = ctx.createConvolver();
        const len = Math.floor(ctx.sampleRate * 2.6), imp = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let c = 0; c < 2; c++) {
            const d = imp.getChannelData(c);
            for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
        }
        verb.buffer = imp;
        dry = ctx.createGain(); dry.gain.value = 0.8; dry.connect(master);
        wet = ctx.createGain(); wet.gain.value = 0.35; wet.connect(verb); verb.connect(master);
        noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
        const nd = noise.getChannelData(0);
        for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
        return true;
    }
    function out(node, reverb, dest) {
        if (dest) { node.connect(dest); return; }
        node.connect(dry);
        if (reverb) { const s = ctx.createGain(); s.gain.value = reverb; node.connect(s); s.connect(wet); }
    }
    function env(g, t, peak, attack, hold, release) {
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(peak, t + attack);
        g.gain.setValueAtTime(peak, t + attack + hold);
        g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
        return t + attack + hold + release + 0.05;
    }
    function osc(type, f, t, stop, dest, detune) {
        const o = ctx.createOscillator();
        o.type = type; o.frequency.value = f;
        if (detune) o.detune.value = detune;
        o.connect(dest); o.start(t); o.stop(stop);
        return o;
    }
    function noiseHit(t, type, f, peak, release, dest, reverb) {
        const s = ctx.createBufferSource(), flt = ctx.createBiquadFilter(), g = ctx.createGain();
        s.buffer = noise; flt.type = type; flt.frequency.value = f;
        s.connect(flt); flt.connect(g); out(g, reverb, dest);
        const end = env(g, t, peak, 0.003, 0, release);
        s.start(t); s.stop(end);
    }
    // e: the note; t: when; dest: where to (the sound effects' own output), else the music's
    const VOICES = {
        pad(e, t) { // soft strings: detuned saws, filtered
            const g = ctx.createGain(), lp = ctx.createBiquadFilter();
            lp.type = "lowpass"; lp.frequency.value = 1000; lp.Q.value = 0.5;
            g.connect(lp); out(lp, 1);
            const end = env(g, t, 0.045 * e.vel, 0.9, Math.max(0, e.len - 1.4), 1.6);
            e.notes.forEach(n => { osc("sawtooth", freq(n), t, end, g, -7); osc("sawtooth", freq(n), t, end, g, 7); });
        },
        bass(e, t) {
            const g = ctx.createGain(), lp = ctx.createBiquadFilter();
            lp.type = "lowpass"; lp.frequency.value = 420;
            g.connect(lp); out(lp, 0.2);
            const end = env(g, t, 0.22 * e.vel, 0.02, e.len * 0.5, e.len * 0.6);
            osc("sine", freq(e.note), t, end, g); osc("triangle", freq(e.note + 12), t, end, g);
        },
        harp(e, t) { // a plucked string: quick start, long fade
            const g = ctx.createGain();
            out(g, 0.9);
            const end = env(g, t, 0.07 * e.vel, 0.004, 0, 1.4);
            osc("triangle", freq(e.note), t, end, g);
            const h = ctx.createGain(); h.gain.value = 0.25; h.connect(g);
            osc("sine", freq(e.note + 12), t, end, h);
        },
        pluck(e, t) { // a short strum of the chord (games)
            const g = ctx.createGain(), lp = ctx.createBiquadFilter();
            lp.type = "lowpass"; lp.frequency.value = 2200;
            g.connect(lp); out(lp, 0.4);
            const end = env(g, t, 0.035 * e.vel, 0.003, 0, 0.22);
            e.notes.forEach((n, i) => osc("square", freq(n), t + i * 0.012, end, g));
        },
        flute(e, t) { // a breathy sine with a gentle vibrato once the note settles
            const g = ctx.createGain();
            out(g, 0.8);
            const end = env(g, t, 0.075 * e.vel, 0.09, Math.max(0, e.len - 0.3), 0.35);
            const o = osc("sine", freq(e.note), t, end, g);
            const lfo = ctx.createOscillator(), depth = ctx.createGain();
            lfo.frequency.value = 5; depth.gain.setValueAtTime(0, t); depth.gain.linearRampToValueAtTime(freq(e.note) * 0.004, t + 0.35);
            lfo.connect(depth); depth.connect(o.frequency); lfo.start(t); lfo.stop(end);
            const air = ctx.createGain(); air.gain.value = 0.12; air.connect(g);
            osc("triangle", freq(e.note), t, end, air);
        },
        bell(e, t, dest) { // marimba / chime: a sine with a bright overtone that fades fast
            const g = ctx.createGain();
            out(g, dest ? 0 : 0.5, dest);
            const peak = (dest ? 0.22 : 0.085) * e.vel;
            const end = env(g, t, peak, 0.004, Math.max(0, e.len * 0.3), Math.max(0.25, e.len));
            osc("sine", freq(e.note), t, end, g);
            const h = ctx.createGain(); h.gain.setValueAtTime(0.35, t); h.gain.exponentialRampToValueAtTime(0.01, t + 0.15); h.connect(g);
            osc("sine", freq(e.note) * 4, t, end, h);
        },
        buzz(e, t, dest) { // a soft "nope": a filtered square
            const g = ctx.createGain(), lp = ctx.createBiquadFilter();
            lp.type = "lowpass"; lp.frequency.value = 700;
            g.connect(lp); out(lp, 0, dest);
            const end = env(g, t, 0.16 * e.vel, 0.01, e.len * 0.6, e.len * 0.5);
            osc("square", freq(e.note), t, end, g); osc("square", freq(e.note), t, end, g, 12);
        },
        sad(e, t, dest) { // a mellow falling note
            const g = ctx.createGain();
            out(g, 0, dest);
            const end = env(g, t, 0.2 * e.vel, 0.02, e.len * 0.5, e.len * 0.7);
            osc("triangle", freq(e.note), t, end, g);
            const o = osc("sine", freq(e.note - 12), t, end, g);
            o.frequency.setValueAtTime(freq(e.note - 12), t + e.len * 0.5);
            o.frequency.linearRampToValueAtTime(freq(e.note - 12) * 0.97, t + e.len);
        },
        drum(e, t) { // a low war drum: a thump that drops in pitch
            const g = ctx.createGain();
            out(g, 0.25);
            const o = ctx.createOscillator();
            o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.32);
            o.connect(g);
            const end = env(g, t, 0.5 * e.vel, 0.006, 0.02, 0.5);
            o.start(t); o.stop(end);
        },
        kick(e, t) { // a tighter thump (games)
            const g = ctx.createGain();
            out(g, 0.1);
            const o = ctx.createOscillator();
            o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.12);
            o.connect(g);
            const end = env(g, t, 0.45 * e.vel, 0.003, 0.01, 0.22);
            o.start(t); o.stop(end);
        },
        snare(e, t) { noiseHit(t, "bandpass", 1800, 0.12 * e.vel, 0.14, null, 0.3); },
        shaker(e, t) { noiseHit(t, "highpass", 6000, 0.05 * e.vel, 0.07, null, 0.3); }
    };

    function tick() {
        if (!ctx) return;
        const stepSec = stepSecOf(song);
        while (nextTime < ctx.currentTime + 0.25) {
            eventsAt(bar, step, song).forEach(e => { VOICES[e.kind](e, nextTime); stats.scheduled++; });
            nextTime += stepSec;
            if (++step >= STEPS) { step = 0; bar = (bar + 1) % BARS; }
        }
    }
    const shouldPlay = () => prefs.on && prefs.vol > 0 && unlocked && !document.hidden && mediaPlaying === 0;
    // play or stop to match: on/off, volume, a tap yet, app in front, no video playing
    function sync() {
        const want = shouldPlay();
        if (want) {
            if (!ctx && !build()) return;
            if (ctx.state !== "running") ctx.resume().catch(() => { });
            if (!timer) { nextTime = ctx.currentTime + 0.1; timer = setInterval(tick, 50); tick(); }
            master.gain.cancelScheduledValues(ctx.currentTime);
            master.gain.setTargetAtTime(gainFor(prefs.vol), ctx.currentTime, 0.4); // fades in
        } else if (ctx) {
            master.gain.cancelScheduledValues(ctx.currentTime);
            master.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
            if (timer) { clearInterval(timer); timer = 0; }
            suspendSoon();
        }
        paint();
    }
    // nothing to hear (no music, no sound effect still ringing): let the phone rest
    function suspendSoon() {
        const c = ctx;
        setTimeout(() => { if (c && !shouldPlay() && Date.now() >= sfxUntil && c.state === "running") c.suspend().catch(() => { }); }, 450);
    }
    // the Games page has its own tune: it fades over when you go there and back
    function setSong(id) {
        const next = SONGS[id] || MAIN;
        if (next === song) return;
        song = next; bar = 0; step = 0;
        if (ctx && timer) {
            const now = ctx.currentTime;
            master.gain.cancelScheduledValues(now);
            master.gain.setValueAtTime(master.gain.value, now);
            master.gain.linearRampToValueAtTime(0.0001, now + 0.25);
            master.gain.setTargetAtTime(gainFor(prefs.vol), now + 0.35, 0.3);
            nextTime = now + 0.3;
        }
        paint();
    }
    // 🔔 a sound effect (games.html calls this): right, wrong, tick, match, win, lose
    function sfx(name) {
        const fx = SFX[name];
        if (!fx || !prefs.sfx || prefs.vol === 0) return false;
        unlocked = true; // it's always from a tap
        if (!ctx && !build()) return false;
        if (ctx.state !== "running") ctx.resume().catch(() => { });
        const t = ctx.currentTime + 0.02;
        fxOut.gain.cancelScheduledValues(t);
        fxOut.gain.setValueAtTime(Math.max(0.15, gainFor(prefs.vol) * 1.3) * fx.vol, t); // effects a touch above the music
        let last = 0;
        fx.notes.forEach(([note, at, len]) => { VOICES[fx.voice]({ note, len, vel: 1 }, t + at, fxOut); last = Math.max(last, at + len); });
        sfxUntil = Date.now() + (last + 1.2) * 1000;
        stats.sfx++; stats.lastSfx = name;
        if (!shouldPlay()) setTimeout(suspendSoon, (last + 1.3) * 1000); // no music on: rest once it has rung out
        return true;
    }
    // Browsers allow sound only after a tap: the first one anywhere starts it.
    function unlock() {
        if (unlocked && ctx) return;
        unlocked = true;
        sync();
    }
    ["pointerdown", "keydown", "touchend"].forEach(t => document.addEventListener(t, unlock, true));
    document.addEventListener("visibilitychange", sync);

    // The sections are pages of their own (iframes): a tap in one counts as a
    // tap here too, and a video playing in one (Social's chat videos) makes
    // the music wait for it.
    const playing = new Set();
    function watchFrame(frame) {
        const hook = () => {
            let doc = null;
            try { doc = frame.contentDocument; } catch (e) { return; }
            if (!doc || doc.__kihMusic) return;
            doc.__kihMusic = true;
            ["pointerdown", "keydown", "touchend"].forEach(t => doc.addEventListener(t, unlock, true));
            const on = (e) => { if (e.target && e.target.tagName === "VIDEO" && !e.target.muted) { playing.add(e.target); mediaPlaying = playing.size; sync(); } };
            const off = (e) => { if (playing.delete(e.target)) { mediaPlaying = playing.size; sync(); } };
            doc.addEventListener("play", on, true);
            ["pause", "ended", "emptied"].forEach(t => doc.addEventListener(t, off, true));
        };
        frame.addEventListener("load", hook);
        hook();
    }
    // which tune: the Games page's, or the main one
    function pickSong() {
        const games = document.getElementById("page-games"), landing = document.getElementById("homeLanding");
        const onGames = !!games && games.classList.contains("active") && !(landing && !landing.classList.contains("hidden"));
        setSong(onGames ? "games" : "main");
    }

    /* ---------------- 🎵 the controls ---------------- */
    function paint() {
        const audible = prefs.on && prefs.vol > 0;
        document.querySelectorAll("[data-music-btn]").forEach(b => {
            b.textContent = audible ? "🎵" : "🔇";
            b.setAttribute("aria-label", audible ? "Music: on — tap for volume" : "Music: off — tap to turn on");
            b.title = audible ? "Music" : "Music (off)";
        });
        const flip = (sel, on) => document.querySelectorAll(sel).forEach(b => {
            b.textContent = on ? "On" : "Off";
            b.setAttribute("aria-pressed", String(on));
            b.classList.toggle("off", !on);
        });
        flip("[data-music-toggle]", prefs.on);
        flip("[data-sfx-toggle]", prefs.sfx);
        document.querySelectorAll("[data-music-vol]").forEach(r => {
            if (Number(r.value) !== prefs.vol) r.value = String(prefs.vol);
            r.disabled = !prefs.on && !prefs.sfx;
        });
        document.querySelectorAll("[data-music-vol-text]").forEach(s => { s.textContent = prefs.vol + "%"; });
    }
    function setOn(on) {
        prefs.on = !!on;
        if (prefs.on && prefs.vol === 0) prefs.vol = DEFAULTS.vol; // on at 0% would sound off
        savePrefs(); unlock(); sync();
    }
    function setSfx(on) {
        prefs.sfx = !!on;
        if (prefs.sfx && prefs.vol === 0) prefs.vol = DEFAULTS.vol;
        savePrefs(); paint();
        if (prefs.sfx) sfx("tick"); // so you hear what you turned on
    }
    function setVolume(vol) {
        prefs = cleanPrefs({ ...prefs, vol });
        savePrefs(); sync();
    }
    // the little panel under 🎵
    function pop() { return document.getElementById("musicPop"); }
    function openPop(btn) {
        const p = pop();
        if (!p) return;
        if (p.classList.contains("open") && p._for === btn) { closePop(); return; }
        p._for = btn;
        p.classList.add("open");
        const r = btn.getBoundingClientRect(), w = p.offsetWidth;
        p.style.top = Math.round(r.bottom + 6) + "px";
        p.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2))) + "px";
        paint();
    }
    function closePop() { const p = pop(); if (p) p.classList.remove("open"); }
    function wire() {
        document.addEventListener("click", (e) => {
            const b = e.target.closest("[data-music-btn]");
            if (b) { e.stopPropagation(); openPop(b); return; }
            // a menu item (☰ → 🎵 Music & sounds): the panel opens under the button it names
            const mo = e.target.closest("[data-music-open]");
            if (mo) { const at = document.querySelector(mo.dataset.musicOpen); if (at) openPop(at); return; }
            if (e.target.closest("[data-music-toggle]")) { setOn(!prefs.on); return; }
            if (e.target.closest("[data-sfx-toggle]")) { setSfx(!prefs.sfx); return; }
            if (pop() && pop().classList.contains("open") && !e.target.closest("#musicPop")) closePop();
        });
        document.addEventListener("input", (e) => { if (e.target.matches && e.target.matches("[data-music-vol]")) setVolume(e.target.value); });
        document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePop(); });
        window.addEventListener("resize", closePop);
        window.addEventListener("blur", closePop); // a tap inside a section (its own page) closes it too
        document.querySelectorAll("iframe").forEach(watchFrame);
        new MutationObserver((list) => list.forEach(m => m.addedNodes.forEach(n => {
            if (n.tagName === "IFRAME") watchFrame(n);
            else if (n.querySelectorAll) n.querySelectorAll("iframe").forEach(watchFrame);
        }))).observe(document.body, { childList: true, subtree: true });
        // the page shown changes: the tune may too
        const watch = new MutationObserver(pickSong);
        ["page-games", "homeLanding"].forEach(id => { const el = document.getElementById(id); if (el) watch.observe(el, { attributes: true, attributeFilter: ["class"] }); });
        pickSong();
        paint();
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire); else wire();

    // for the tests: how loud it is right now (0 = silent) — the average, or the loudest sample
    function level(peak) {
        if (!analyser || !ctx || ctx.state !== "running") return 0;
        const d = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(d);
        let s = 0, m = 0;
        for (const x of d) { s += x * x; m = Math.max(m, Math.abs(x)); }
        return peak ? m : Math.sqrt(s / d.length);
    }
    return Object.assign(core, {
        prefs: () => ({ ...prefs }), setOn, setSfx, setVolume, sfx, unlock, openPop, closePop, level, stats,
        state: () => ({ ctx: ctx ? ctx.state : "none", playing: !!timer, unlocked, mediaPlaying, bar, step, song: song.id })
    });
});
