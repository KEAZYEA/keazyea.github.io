/* 🧍 Characters (character-core.js + api/progress.js saveOutfit): a guy or a
   girl in their own skin, dressed head to toe from drops — hair, hat, eyes,
   glasses, mouth, neck, top, bottom, shoes, held — one per slot, with a free
   starter set so nobody is faceless. Every item is wearable somewhere that
   makes sense, worn things are drawn (not stuck-on emoji), outfits are
   always cleaned, and the figure is drawn safely. The server part runs on an
   in-memory database. Run:  npm test */
const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { state, memoryFirestore, call } = require("./api-harness");
const P = require("../progress-core.js");
const C = require("../character-core.js");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const ALL = [...P.ITEMS.map(i => i.id), ...P.STYLES.map(s => s.id)];

describe("head to toe", () => {
    test("a background, then head to toe, then a pet; hat, glasses, neck, held and pet can be empty", () => {
        assert.deepEqual(C.SLOT_IDS, ["bg", "hair", "hat", "eyes", "glasses", "mouth", "neck", "top", "bottom", "shoes", "held", "pet"]);
        assert.deepEqual(C.OPTIONAL, ["hat", "glasses", "neck", "held", "pet"]);
    });
    test("backgrounds: a free one, and the profile backgrounds you own", () => {
        assert.deepEqual(C.forSlot("bg", ALL), ["st_bg", "g_stars", "g_sakura", "g_capy", "g_galaxy", "hg_haunted"]);
        for (const s of P.STYLES.filter(s => s.type === "background")) assert.equal(C.wearOf(s.id).slot, "bg", s.id);
    });
    test("animals: the Black Cat and the Baby Dragon are pets, drawn at your feet", () => {
        assert.deepEqual(C.forSlot("pet", ALL).sort(), ["dragon", "h_cat", "hs_bunny", "pt_fox", "pt_owl", "pt_phoenix"]);
        assert.equal(P.ITEM_BY_ID.dragon.name, "Baby Dragon");
        assert.equal(P.ITEM_BY_ID.h_cat.name, "Black Cat");
        const s = C.svg({ wear: { pet: "h_cat" } });
        assert.ok(s.includes('fill="#2e2a3a"') && s.includes('fill="#ffd54a"') && !s.includes("🐈"), "drawn (dark fur, yellow eyes), not the emoji");
    });
    test("pets are on your right (as you look), facing you: the dragon and phoenix fly by your head (the dragon spits fireballs up into the sky), the owl perches on your other shoulder (clear of a sword or staff) looking at you, cat and fox sit by your right foot", () => {
        const pet = (id) => C.svg({ wear: { pet: id } }, { only: "pet" });
        const spot = (id) => { const m = pet(id).match(/<g transform="translate\((-?[\d.]+) (-?[\d.]+)\)/); return m && [+m[1], +m[2]]; };
        for (const id of ["dragon", "pt_phoenix"]) { const [x, y] = spot(id); assert.ok(x > 140 && y < 80, `${id} flies up by the head on the right (${x}, ${y})`); }
        // both face left — toward you — so the head (the eye) is left of the body
        assert.match(pet("dragon"), /<ellipse cx="4" cy="5" rx="13"[^]*<ellipse cx="-11" cy="-8" rx="2\.4"/, "the dragon's head is on its left, toward you");
        assert.match(pet("dragon"), /<circle cx="-29" cy="-1" r="5\.5" fill="#ff7a2f"\/><circle cx="-29" cy="-1" r="3" fill="#ffe066"\/>/, "a fireball at the dragon's mouth");
        assert.match(pet("dragon"), /rotate\(25\)/, "head tilted up, so its fire goes up into the sky (not at you)");
        assert.match(C.svg({ wear: { pet: "dragon" } }, { animate: true }), /@keyframes kcFire\{0%[^@]*100%\{transform:translate\(-18px,-30px\)/, "the fireball flies upward");
        assert.match(pet("pt_owl"), /<g transform="translate\(4 -128\) scale\(1\.2\)">/, "the owl is up on your shoulder — the one away from your sword, staff or broom");
        assert.match(pet("pt_owl"), /<ellipse cx="31\.2" cy="192"[^]*<ellipse cx="40\.2" cy="192"/, "its eyes turned toward you (pupils to its left side's right)");
        for (const id of ["h_cat", "pt_fox"]) assert.match(pet(id), /^<svg[^>]*><g transform="matrix\(-1 0 0 1 206 0\)">/, `${id} sits by your right foot`);
        // their pictures in the Wardrobe are cropped to where they are
        const vb = (id) => C.thumb(id, 60).match(/viewBox="([^"]+)"/)[1];
        assert.deepEqual(["dragon", "pt_phoenix", "pt_owl", "h_cat", "pt_fox"].map(vb), ["116 14 84 84", "122 22 90 90", "16 79 58 58", "134 156 64 64", "134 156 64 64"]);
    });
    test("tall held things (staff, sword, torch, pinwheel, quill) lean out from the fist, so their tops clear your face", () => {
        // the face: the ellipse at (100, 80), 46 × 44, and the ear at (145, 88), r 8.
        // Points on each thing's top (in its own drawing, with a radius) must stay off it.
        const tops = { hd_staff: [[0, -76, 8]], blade: [[0, -74, 3], [0, -60, 4], [0, -46, 4], [0, -32, 4]], torch: [[0, -52, 11]], a_pass: [[0, -44, 14]], quill: [[-3, -62, 6], [-2, -44, 9]] };
        const off = (x, y, r) => Math.min(((x - 100) / (46 + r)) ** 2 + ((y - 80) / (44 + r)) ** 2, Math.hypot(x - 145, y - 88) / (8 + r));
        for (const [id, pts] of Object.entries(tops)) {
            const m = C.svg({ wear: { held: id } }).match(/<g transform="translate\(138\.5 163\.5\) rotate\((\d+)\)">/);
            assert.ok(m, `${id} leans`);
            const a = m[1] * Math.PI / 180;
            for (const [px, py, r] of pts) {
                const x = 138.5 + px * Math.cos(a) - py * Math.sin(a), y = 163.5 + px * Math.sin(a) + py * Math.cos(a);
                assert.ok(off(x, y, r) > 1.05, `${id}: (${x.toFixed(1)}, ${y.toFixed(1)}) ±${r} is clear of the face`);
            }
        }
        assert.match(C.svg({ wear: { held: "hd_staff" } }, { animate: true }), /<g transform="translate\(138\.5 163\.5\) rotate\(20\)"><circle cx="0" cy="-76" r="16"/, "the staff's glow leans with it");
        assert.match(C.svg({ wear: { held: "blade" } }, { animate: true }), /<g transform="translate\(138\.5 163\.5\) rotate\(17\)"><path d="M0,-12 L0,-74" stroke="#7fc4ff"/, "so does the sword's");
    });
    test("🏹 the bow: held by its middle, string toward you, the arrow pointing away from you (head beyond the bow)", () => {
        const b = C.svg({ wear: { held: "hd_bow" } }, { only: "held" });
        assert.match(b, /<path d="M-14,-46 C10,-32 10,32 -14,46"/, "the bow bends out away from you, its middle at your fist");
        assert.match(b, /<path d="M-14,-46 L-14,46" stroke="#f4efe6"/, "the string on your side");
        assert.match(b, /<path d="M33,0 l-8,-4\.5 0,9 z"/, "the arrowhead points out, past the bow");
        assert.match(b, /M-15,0 l-4,-5/, "the feathers at the string");
    });
    test("animations only on the big pictures (asked for), never in small cards; off for reduced motion", () => {
        const o = { wear: { pet: "dragon", hat: "ht_halo", held: "blade" } };
        const big = C.svg(o, { animate: true });
        assert.match(big, /<style>[^<]*@keyframes kcFire[^<]*@media \(prefers-reduced-motion: reduce\)\{\[class\*="kc-a-"\]\{animation:none!important\}\}<\/style>/);
        assert.match(big, /class="kc-a-wing"/, "the dragon's wings flap");
        assert.match(big, /class="kc-a-fire" style="animation-delay:0\.8s"/, "fireballs fly out one after another");
        const small = C.svg(o, { size: 48 });
        assert.ok(!small.includes("kc-a-") && !small.includes("<style>"), "a small card is still");
        assert.ok(!C.svg(o).includes("kc-a-"), "drawing an animated one doesn't leave the next one animated");
        // ids in a picture ("kc" + a count) never look like an animation, however many are drawn
        for (let i = 0; i < 400; i++) assert.ok(!C.svg(o, { size: 30 }).includes("kc-a-"), "picture " + i);
        assert.ok(!C.svg(C.cleanOutfit({}, []), { animate: true }).includes('class="kc-a-'), "the free starter set has nothing to animate");
    });
    test("every epic and legendary thing is extra-detailed and comes alive (sparkles, glows, flames, flapping wings)", () => {
        const fancy = [...P.ITEMS, ...P.STYLES].filter(i => ["epic", "legendary"].includes(i.rarity) && C.wearOf(i.id));
        assert.ok(fancy.length >= 25, fancy.length);
        for (const it of fancy) {
            const w = C.wearOf(it.id), s = C.svg({ wear: { [w.slot]: it.id } }, { animate: true });
            assert.match(s, /class="kc-a-/, `${it.id} (${it.name}, ${it.rarity}) has something moving`);
        }
        for (const id of ["dragon", "pt_phoenix", "pt_owl", "h_cat", "pt_fox"]) assert.match(C.svg({ wear: { pet: id } }, { animate: true }), /class="kc-a-/, id);
    });
    test("every item is wearable, and the 3 Halloween pictures are outfits", () => {
        for (const it of P.ITEMS) assert.ok(C.wearOf(it.id), `${it.id} (${it.name})`);
        for (const s of P.STYLES.filter(s => s.type === "avatar")) assert.ok(C.wearOf(s.id), s.id);
        assert.deepEqual([C.wearOf("ha_warlock").slot, C.wearOf("ha_knight").slot, C.wearOf("ha_witch").slot], ["top", "top", "hat"]);
        for (const id of C.WEARABLE) assert.ok(C.thingOf(id), `WEAR.${id} is real`);
        assert.equal(C.wearOf("constructor"), null);
    });
    test("things are worn where they make sense (the re-skins)", () => {
        const where = { spyglass: ["glasses", "Monocle"], ledger: ["glasses", "Reading Glasses"], dice: ["glasses", "Gambler's Shades"], a_joystick: ["glasses", "Gamer Visor"],
            mark: ["eyes", "Hunter's Gaze"], star: ["eyes", "Starry Eyes"], heart: ["mouth", "Heart Lips"], h_candy: ["mouth", "Lollipop"],
            raffle: ["hat", "Showman's Top Hat"], clover: ["hat", "Clover Hairpin"], feather: ["hat", "Phoenix Plume Hat"], dragon: ["pet", "Baby Dragon"], h_cat: ["pet", "Black Cat"],
            medal: ["neck", "Champion's Medal"], key: ["neck", "Key Pendant"], jackpot: ["neck", "Jackpot Medallion"],
            crate: ["top", "Trader's Apron"], crest: ["top", "Champion's Cape"], candle: ["held", "Candle Lantern"],
            crown: ["hat", "Royal Crown"], boots: ["shoes", "Swift Boots"], muddy: ["shoes", "Muddy Boots"], amulet: ["neck", "Gem Amulet"], blade: ["held", "Storm Blade"] };
        for (const [id, [slot, name]] of Object.entries(where)) {
            assert.equal(C.wearOf(id).slot, slot, id);
            assert.equal(P.ITEM_BY_ID[id].name, name, id);
        }
    });
    test("re-skinned items keep their rarity and perks (owners lose nothing)", () => {
        const kept = { spyglass: ["uncommon", "blurHints"], mark: ["rare", "secretChance"], crate: ["common", "dupBonus"], jackpot: ["legendary", "weeklyTickets"], dragon: ["legendary", "questMult"] };
        for (const [id, [rarity, kind]] of Object.entries(kept)) {
            assert.equal(P.ITEM_BY_ID[id].rarity, rarity, id);
            assert.ok(P.ITEM_BY_ID[id].perks.some(p => p.kind === kind), id);
        }
    });
    test("new drops: hair, eyes and mouths; shirts and pants — all in the chest, with a perk", () => {
        const fresh = ["hr_crop", "hr_waves", "hr_spiky", "hr_twin", "ey_sleepy", "ey_fierce", "mo_grin", "mo_fangs", "sh_jerkin", "sh_tabard", "sh_robe", "sh_plate", "sh_dragon", "pa_linen", "pa_leather", "pa_chain", "pa_shadow"];
        for (const id of fresh) {
            const it = P.ITEM_BY_ID[id];
            assert.ok(it && it.chest && it.perks.length, id);
        }
        assert.deepEqual(C.forSlot("hair", ALL), ["st_hair", "hr_crop", "hr_waves", "hr_spiky", "hr_twin", "hr_silver", "hr_flame", "cs_hair"]); // + the 👘 Celestial Set's
    });
    test("every item is worth something: a perk on each (the free starter set is the only thing without)", () => {
        for (const it of P.ITEMS) assert.ok(it.perks.length > 0, it.id);
        const more = ["nk_scarf", "sw_sandals", "gl_aviator", "mo_stache", "sh_hoodie", "pt_fox", "ht_wizard", "hr_silver", "ey_ice", "nk_fang", "hd_bow", "pt_owl", "ht_viking", "hr_flame", "hd_staff", "ht_halo", "ey_dragon", "sh_royal", "sw_wings", "pt_phoenix"];
        for (const id of more) assert.ok(P.ITEM_BY_ID[id] && P.ITEM_BY_ID[id].chest && C.wearOf(id), id);
        // the rarer, the stronger: a legendary's perks add up to more than a common's
        const weight = (it) => it.perks.length * 10 + it.perks.reduce((t, x) => t + x.value, 0);
        assert.ok(weight(P.ITEM_BY_ID.pt_phoenix) > weight(P.ITEM_BY_ID.nk_scarf));
    });
});

describe("the starter set and the body", () => {
    test("everyone has the starter background, hair, eyes, mouth, top, bottom and shoes (no perks, not in the chest)", () => {
        assert.deepEqual(Object.keys(C.STARTER).sort(), ["st_bg", "st_bottom", "st_eyes", "st_hair", "st_mouth", "st_shoes", "st_top"]);
        for (const id of Object.keys(C.STARTER)) { assert.ok(C.isStarter(id)); assert.equal(P.BY_ID[id], undefined, id + " isn't a chest item"); }
        assert.deepEqual(C.cleanOutfit(null, []), { base: { body: "guy", skin: 1 }, wear: C.DEFAULT_WEAR });
        assert.deepEqual(C.forSlot("hat", []), [], "no starter hat");
        assert.deepEqual(C.forSlot("eyes", []), ["st_eyes"]);
    });
    test("only guy/girl and skin are yours to set — everything else is a drop", () => {
        assert.deepEqual(Object.keys(C.BASE), ["body", "skin"]);
        assert.deepEqual(C.BASE.body, ["guy", "girl"]);
        const o = C.cleanOutfit({ base: { body: "girl", skin: 4, hair: "long", eyes: "x" } }, []);
        assert.deepEqual(o.base, { body: "girl", skin: 4 });
        assert.equal(C.cleanOutfit({ base: { body: "robot", skin: "1" } }, []).base.body, "guy");
        assert.equal(C.cleanOutfit({ base: { skin: 99 } }, []).base.skin, 1);
    });
});

describe("an outfit is always cleaned", () => {
    test("only what you own, each in its own slot", () => {
        const o = C.cleanOutfit({ wear: { hat: "crown", neck: "boots", held: "blade", glasses: "dice" } }, ["crown", "boots", "dice"]);
        assert.equal(o.wear.hat, "crown");
        assert.equal(o.wear.glasses, "dice");
        assert.equal(o.wear.neck, undefined, "boots aren't a necklace");
        assert.equal(o.wear.held, undefined, "the blade isn't yours");
    });
    test("a slot that always shows something falls back to the starter piece", () => {
        const o = C.cleanOutfit({ wear: { eyes: "star", top: "", bottom: "pa_chain" } }, []);
        assert.equal(o.wear.eyes, "st_eyes", "not yours → starter");
        assert.equal(o.wear.top, "st_top");
        assert.equal(o.wear.bottom, "st_bottom");
        assert.equal(o.wear.hat, undefined);
    });
    test("every slot at once", () => {
        const o = C.cleanOutfit({ wear: { bg: "g_galaxy", hair: "hr_spiky", hat: "crown", eyes: "mark", glasses: "dice", mouth: "mo_grin", neck: "amulet", top: "sh_plate", bottom: "pa_chain", shoes: "boots", held: "blade", pet: "dragon" } }, ALL);
        assert.equal(Object.keys(o.wear).length, 12);
        assert.ok(Object.values(o.wear).every(id => !C.isStarter(id)));
    });
    test("odd input doesn't break it", () => {
        for (const bad of [undefined, 5, "x", [], { wear: "hat" }, { wear: { hat: 5 } }, { base: null }, { wear: { __proto__: { hat: "crown" } } }])
            assert.deepEqual(C.cleanOutfit(bad, ALL).wear, C.DEFAULT_WEAR);
    });
});

describe("the drawing", () => {
    const draw = (wear, base) => C.svg({ base: base || {}, wear });
    test("an SVG; head & shoulders for small places", () => {
        assert.match(C.svg(C.cleanOutfit({}, []), { size: 120 }), /^<svg [^>]*viewBox="0 0 200 240" width="120" height="144"/);
        assert.match(C.svg(C.cleanOutfit({}, []), { size: 32, bust: true }), /viewBox="40 14 120 120" width="32" height="32"/);
    });
    test("a guy and a girl look different (the girl's starter bottom is a skirt)", () => {
        assert.notEqual(draw({}, { body: "guy" }), draw({}, { body: "girl" }));
        assert.ok(draw({}, { body: "girl" }).includes("#3d3a5a"));
    });
    test("everything is drawn — nothing is a stuck-on emoji, held things included", () => {
        for (const id of C.WEARABLE) {
            const w = C.wearOf(id), it = C.thingOf(id);
            const s = draw({ [w.slot]: id });
            assert.match(s, /<svg/, id);
            assert.ok(!s.includes(">" + it.icon + "<"), `${id} is drawn, not ${it.icon}`);
            assert.ok(w.look, id + " has a drawing");
        }
        assert.notEqual(draw({ hat: "crown" }), draw({ hat: "cap" }));
        assert.notEqual(draw({ glasses: "dice" }), draw({ glasses: "ledger" }));
    });
    test("shoes face you: the two feet are mirror images, side by side", () => {
        const s = draw({ shoes: "boots" });
        assert.ok(s.includes("M75,207") && s.includes("M99,207"), "left foot at 88, right at 112, same shape");
        assert.ok(!/>👢<|>🥾<|>👟</.test(s), "not the sideways emoji");
    });
    test("the lollipop the right way round: the sweet in your mouth, the stick poking out", () => {
        const s = draw({ mouth: "h_candy" });
        assert.ok(s.includes('<circle cx="101" cy="105" r="7.5" fill="#ff6fa8"'), "the sweet at the mouth");
        assert.ok(s.includes('M104,108 L126,121'), "the stick out to the side");
    });
    test("every thing's picture is how it really looks worn (no emoji)", () => {
        for (const id of C.WEARABLE) {
            const t = C.thumb(id, 48), it = C.thingOf(id);
            assert.match(t, /^<svg [^>]*width="48" height="48"/, id);
            assert.ok(!t.includes(">" + it.icon + "<"), id + " is drawn");
        }
        assert.ok(C.thumb("jackpot", 48).includes(">7<"), "the Jackpot Medallion shows its 7 coin");
        assert.equal(P.ITEM_BY_ID.jackpot.icon, "🪙");
        assert.ok(C.thumb("candle", 48).includes("#ffe7a1") && /viewBox="[\d.-]+ 148/.test(C.thumb("candle", 48)), "the lantern framed where it hangs");
        assert.equal(C.thumb("nope", 48), "");
    });
    test("hats and hair: a hat that covers the head hides the hair above its brim (spikes go under a cap); accessories don't; a halo floats above the tallest hair", () => {
        const covering = ["cap", "crown", "raffle", "ha_witch", "ht_wizard", "ht_viking", "feather"], leaveHair = ["clover", "a_laurel", "ht_halo"];
        for (const hat of covering) for (const hair of C.forSlot("hair", ALL)) {
            const s = draw({ hat, hair });
            assert.match(s, /<clipPath id="kc[0-9a-z]+-h"><rect x="-20" y="\d+"/, `${hat} + ${hair}: the hair is clipped`);
            assert.ok(s.indexOf('clip-path="url(#') < s.indexOf("C53,44") || !s.includes("C53,44"), hat);
        }
        for (const hat of leaveHair) assert.ok(!/-h"><rect/.test(draw({ hat, hair: "hr_spiky" })), hat + " leaves the hair alone");
        // the cap's brim is lower than the crown's band: more hair hidden under a cap
        const brim = (hat) => Number(draw({ hat, hair: "hr_spiky" }).match(/-h"><rect x="-20" y="(\d+)"/)[1]);
        assert.ok(brim("cap") > brim("crown"));
        const haloY = (hair) => Number(draw({ hat: "ht_halo", hair }).match(/stroke="#ffd54a" stroke-width="4.5"/) && draw({ hat: "ht_halo", hair }).match(/<ellipse cx="100" cy="(-?[\d.]+)" rx="30" ry="8" fill="none" stroke="#ffd54a"/)[1]);
        assert.ok(haloY("hr_flame") < 10 && haloY("st_hair") === 22, "the halo rises above flame hair");
        assert.ok(!draw({ hat: "h_king", hair: "hr_waves" }).includes("#d9a441"), "no hair under the pumpkin");
    });
    test("the pumpkin replaces the whole head", () => {
        assert.ok(!draw({ hat: "h_king" }).includes('rx="46" ry="44"'), "no face under the pumpkin");
    });
    test("real hands: open when empty; a fist drawn over what you hold", () => {
        const empty = draw({}), holding = draw({ held: "trophy" });
        assert.ok(!empty.includes('class="kc-fist"') && (empty.match(/class="kc-hand"/g) || []).length === 2, "two open hands when empty");
        assert.ok(holding.indexOf('<g transform="translate(138.5 163.5)">') < holding.indexOf('class="kc-fist"'), "the trophy is drawn at the fist, the fist over it");
        for (const id of C.forSlot("held", ALL)) assert.ok(draw({ held: id }).includes('class="kc-fist"'), id + " is gripped");
    });
    test("nothing from outside gets into the picture: unknown things are skipped, the title is escaped", () => {
        const s = C.svg({ wear: { hat: "<img src=x onerror=alert(1)>" }, base: { body: "\"><script>" } }, { title: `<b>"Bob"</b>` });
        assert.ok(!/<img|<script|<b>/i.test(s));
        assert.match(s, /<title>&lt;b&gt;&quot;Bob&quot;&lt;\/b&gt;<\/title>/);
    });
});

describe("looks: 3 saved outfits, one worn", () => {
    test("3 free, then 1,000 / 2,000 / 4,000 ✨, up to 6; each look cleaned", () => {
        assert.equal(C.LOOKS_FREE, 3);
        assert.deepEqual([3, 4, 5].map(C.lookPrice), [1000, 2000, 4000]);
        assert.equal(C.lookPrice(6), null);
        const looks = C.cleanLooks([{ wear: { hat: "crown" } }, "junk"], ["crown"], 3);
        assert.equal(looks.length, 3);
        assert.equal(looks[0].wear.hat, "crown");
        assert.deepEqual(looks[1], C.cleanOutfit({}, []));
    });
    test("🎲 random: only things you own, a real body, a face always", () => {
        const owned = ["crown", "boots", "hr_twin", "pt_fox", "dice"];
        let seed = 1; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        const seen = new Set();
        for (let i = 0; i < 200; i++) {
            const o = C.randomOutfit(owned, r);
            assert.deepEqual(o, C.cleanOutfit(o, owned), "already clean");
            for (const id of Object.values(o.wear)) assert.ok(C.isStarter(id) || owned.includes(id), id);
            ["hair", "eyes", "mouth", "top", "bottom", "shoes", "bg"].forEach(sl => assert.ok(o.wear[sl], sl));
            seen.add(o.base.body); Object.values(o.wear).forEach(id => seen.add(id));
        }
        ["guy", "girl", "crown", "boots", "hr_twin", "pt_fox", "dice"].forEach(x => assert.ok(seen.has(x), x + " comes up"));
    });
});

describe("on the server (api/progress.js)", () => {
    let db;
    const act = (body, token = "player-token") => call("progress.js", { token, body });
    beforeEach(() => {
        db = memoryFirestore();
        db._data.set("users/player1", { name: "Ezra" });
        db._data.set("inventories/player1", { items: { crown: { at: 1 }, boots: { at: 1 }, amulet: { at: 1 }, blade: { at: 1 }, hr_twin: { at: 1 }, ha_warlock: { at: 1 } }, stardust: 12000 });
        db._data.set("tokenWallets/player1", { balance: 1200 });
        state.db = db;
    });
    test("saveOutfit keeps your body and what you own, on your public card", async () => {
        const r = await act({ action: "saveOutfit", outfit: { base: { body: "girl", skin: 2, hair: "long" }, wear: { hair: "hr_twin", hat: "crown", shoes: "boots", neck: "amulet", held: "blade", top: "ha_warlock", glasses: "dice" } } });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.deepEqual(r.body.outfit.base, { body: "girl", skin: 2 });
        assert.deepEqual(r.body.outfit.wear, { bg: "st_bg", hair: "hr_twin", hat: "crown", eyes: "st_eyes", mouth: "st_mouth", neck: "amulet", top: "ha_warlock", bottom: "st_bottom", shoes: "boots", held: "blade" }, "the shades aren't yours");
        assert.deepEqual(db._data.get("playerCards/player1").outfit, r.body.outfit);
    });
    test("nothing to buy: there are no slots", async () => {
        assert.equal((await act({ action: "buySlot" })).status, 400);
        assert.equal(db._data.get("tokenWallets/player1").balance, 1200);
    });
    test("buyItem: a chest item outright, for ✨ (Mage Robe, rare: 2,000), logged (as ✨, not tokens)", async () => {
        // lined up with money: $10 = 1,000 🪙 = 10,000 ✨ = a Legendary; never under a chest draw
        assert.deepEqual(P.BUY_PRICES, { common: 500, uncommon: 1000, rare: 2000, epic: 4000, legendary: 10000 });
        assert.ok(P.BUY_PRICES.common >= P.CHEST.price);
        assert.equal(P.BUY_PRICES.legendary, 1000 * P.STARDUST.perToken, "the $10 pack");
        const r = await act({ action: "buyItem", id: "sh_robe" });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.price, 2000);
        assert.equal(db._data.get("inventories/player1").stardust, 10000);
        assert.equal(db._data.get("tokenWallets/player1").balance, 1200, "tokens untouched");
        assert.ok("sh_robe" in db._data.get("inventories/player1").items);
        assert.ok(db._data.get("inventories/player1").perks.blurHints >= 1, "its perk counts at once");
        const [log] = db._docs("chestOpens");
        assert.equal(log.kind, "buy"); assert.equal(log.price, 2000); assert.equal(log.currency, "stardust");
    });
    test("buyItem: not twice, not without the tokens, not achievement or event things", async () => {
        assert.match((await act({ action: "buyItem", id: "crown" })).body.error, /already have/);
        db._data.set("inventories/player1", { ...db._data.get("inventories/player1"), stardust: 3000 });
        assert.match((await act({ action: "buyItem", id: "sh_dragon" })).body.error, /costs 10,000 ✨ — you have 3,000/);
        for (const id of ["a_laurel", "hg_haunted", "ha_witch", "st_hair", "b_supporter", "constructor", ""]) {
            const r = await act({ action: "buyItem", id });
            assert.equal(r.status, 400, id);
        }
        assert.equal(db._data.get("inventories/player1").stardust, 3000, "nothing spent");
        assert.equal(db._docs("chestOpens").length, 0);
    });
    test("looks: dress Look 2 without wearing it; then wear it; others see all your looks", async () => {
        let r = await act({ action: "saveOutfit", look: 1, outfit: { base: { body: "girl" }, wear: { hat: "crown" } } });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        let card = db._data.get("playerCards/player1");
        assert.equal(card.equipped, 0);
        assert.equal(card.outfits.length, 3);
        assert.equal(card.outfits[1].wear.hat, "crown");
        assert.equal(card.outfit.wear.hat, undefined, "you still wear Look 1");
        r = await act({ action: "equipLook", look: 1 });
        assert.equal(r.status, 200);
        card = db._data.get("playerCards/player1");
        assert.equal(card.equipped, 1);
        assert.equal(card.outfit.wear.hat, "crown", "now everyone sees Look 2");
        r = await act({ action: "saveOutfit", look: 2, equip: true, outfit: { wear: { shoes: "boots" } } });
        assert.equal(db._data.get("playerCards/player1").equipped, 2);
        for (const look of [3, -1, "1", 1.5]) assert.equal((await act({ action: "equipLook", look })).status, 400, String(look));
        assert.equal((await act({ action: "saveOutfit", look: 5, outfit: {} })).status, 400);
    });
    test("another look: 1,000 ✨ for the 4th; then it can be dressed", async () => {
        const r = await act({ action: "buyLookSlot" });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.lookSlots, 4);
        assert.equal(db._data.get("inventories/player1").stardust, 11000);
        assert.equal(db._docs("chestOpens")[0].kind, "look");
        assert.equal((await act({ action: "saveOutfit", look: 3, outfit: {} })).status, 200);
        db._data.set("inventories/player1", { ...db._data.get("inventories/player1"), stardust: 10 });
        assert.match((await act({ action: "buyLookSlot" })).body.error, /costs 2,000 ✨/);
    });
    test("signed out → 401", async () => {
        assert.equal((await act({ action: "saveOutfit", outfit: {} }, null)).status, 401);
    });
});

describe("in the app", () => {
    const index = read("index.html");
    test("Profile's 🧍 Character tab: guy/girl and skin only; things you don't have greyed out with 👁 Preview", () => {
        assert.match(index, /id="page-character"[\s\S]{0,900}switchCharTab\('wardrobe'\)">👕 Wardrobe[\s\S]{0,200}switchCharTab\('style'\)">✨ Style[\s\S]{0,200}switchCharTab\('bonuses'\)">💪 Bonuses/);
        assert.match(index, /id="page-achievements"[\s\S]{0,900}id="pfAchBody"/);
        assert.match(index, /onclick="goToPage\('character'\)">\s*<span class="home-menu-icon">🧍<\/span>/, "a Character tile on Home");
        assert.match(index, /onclick="goToPage\('achievements'\)" [^>]*>\s*<span class="home-menu-icon">🏅<\/span>/, "an Achievements tile on Home");
        assert.doesNotMatch(index, /data-tab="items"/, "no Items tab (items are worn; Bonuses adds them up)");
        assert.match(index, /<div class="avatar-picker-row" style="display:none;">/, "no picture picker");
        assert.match(index, /const CH_BODY = \[\["body", "Body", "part"\], \["skin", "Skin", "color"\]\];/);
        assert.match(index, /data-ch-preview="\$\{slot\}"[^\n]*\$\{on \? "✓ Trying on" : "👁 Preview"\}/);
        assert.match(index, /CC\.OPTIONAL\.includes\(slot\) \? `<button[^`]*Nothing/);
        assert.match(index, /data-ch-buy="\$\{id\}"[^>]*>\$\{PC\.dealPrice\(id, sgtDay\(\)\) \? `🛍️ ✨ \$\{PC\.dealPrice\(id, sgtDay\(\)\)[^`]*` : `✨ \$\{PC\.buyPrice\(id\)\.toLocaleString\("en-US"\)\}`\}<\/button>/, "just the price in ✨ (today's deal: 🛍️), no Buy");
        assert.match(index, /data-ch-heartshop="\$\{id\}"[^>]*>💗 \$\{PC\.heartPrice\(id\)\}<\/button>/, "💗 600, nothing more");
        assert.equal((index.match(/CC\.thumb\(id, 56, o\.base\.body\)/g) || []).length, 2, "the cards show the drawn picture — for your body (a boy's cut of the long hairs)");
        assert.match(index, /<div class="it-icon">\$\{CC\.itemPic\(it\.id, 46\) \|\| it\.icon\}<\/div>/, "Bonuses: the thing itself");
        assert.match(index, /\.ch-item\.locked \.ch-prev-btn \{ margin-top: auto; \}/, "the buttons line up at the bottom");
        assert.doesNotMatch(index, /chUnlockBtn|buyCharacterSlot/);
        for (const f of ["index.html", "social.html", "games.html"]) {
            const page = read(f);
            assert.ok(page.indexOf('<script src="progress-core.js"></script>') < page.indexOf('<script src="character-core.js"></script>'), f + ": after progress-core.js");
        }
    });
    test("shown on profiles (Home and Social) and on the Games leaderboard", () => {
        assert.match(index, /id="viewProfileCharHome"/);
        assert.match(index, /CC\.svg\(card\.outfit \|\| CC\.cleanOutfit\(\{\}, \[\]\), \{ size: 150/, "everyone: the starter look until they dress up");
        assert.match(read("social.html"), /CharacterCore\.svg\(card\.outfit \|\| CharacterCore\.cleanOutfit\(\{\}, \[\]\), \{ size: 150/);
        assert.match(read("games.html"), /CharacterCore\.svg\(r\.outfit \|\| CharacterCore\.cleanOutfit\(\{\}, \[\]\), \{ size: 48 \}\)/, "full body on the leaderboard");
        assert.match(index, /function applyTopbarChar\(card\)/, "your character top-left");
        assert.match(read("api/games.js"), /looks\.outfit = card\.exists && card\.data\(\)\.outfit/);
    });
    test("Social: a dressed-up player's character replaces their picture in posts, comments, chat and an opened post; a new outfit redraws", () => {
        const social = read("social.html");
        assert.match(social, /const bordered = \(uid, html\) => \{ html = charOr\(uid, html\);/);
        assert.match(social, /function charCard\(uid, cls\)[\s\S]{0,700}CharacterCore\.pic\(o, \{ size: 64 \}\)/); // (as a picture: ⚡ below)
        assert.match(social, /function avatarHtml\(url, name, sizeClass, uid\) \{\s*if \(uid && window\.CharacterCore\) return charCard/, "friends, requests, search and DMs too");
        assert.equal((social.match(/avatarHtml\([^)]*, (r\.fromUid|f\.uid|r\.uid|s\.uid|uid)\)/g) || []).length >= 5, true);
        assert.match(social, /const looksKey = \(card\) => JSON\.stringify\(\[\(card \|\| \{\}\)\.style \|\| null, \(card \|\| \{\}\)\.outfit \|\| null\]\)/);
        assert.match(social, /function styleDetailPoster[\s\S]{0,1200}prefix \+ "Char"/);
    });
    test("looks: a row of your looks, ✅ Wear, 🎲 Random, ＋ another; profiles show someone's other looks", () => {
        assert.match(index, /class="ch-look\$\{i === li \? " on" : ""\}/);
        assert.match(index, /data-ch-equip="\$\{li\}">✅ Wear \$\{escText\(nm\(li\)\)\}/, "✅ Wear <its name>");
        assert.match(index, /data-ch-random="1">🎲 Random/);
        assert.match(index, /charDraft = CC\.randomOutfit\(progressStatus\.items \|\| \[\]\)/);
        assert.match(index, /AppState\.saveOutfit\(want, charDraftLook, equip === true\)/);
        for (const f of ["index.html", "social.html"]) {
            assert.match(read(f), /function allLooksHtml\(card, svg(, title)?\)/, f + ": all their looks");
            assert.match(read(f), /function wireLooks\(row, bigEl, card\)/, f + ": tap one to see it big");
            assert.doesNotMatch(read(f), /otherLooksHtml/, f);
        }
        assert.match(read("social.html"), /showProfileModal\(profile, isFriendUid\(uid\)\);/, "tapping someone opens their profile straight away");
    });
    test("page headers show their icon in colour; badge names are never black on black (badges sit in buttons)", () => {
        assert.match(index, /<div class="pg-hero pg-hero-ach"><span class="pg-hero-ico">🏅<\/span><div><h1>Achievements<\/h1>/);
        assert.match(index, /<div class="pg-hero pg-hero-char"><span class="pg-hero-ico">🧍<\/span><div><h1>Character<\/h1>/);
        assert.doesNotMatch(index, /<h1>🏅 Achievements<\/h1>|<h1>🧍 Character<\/h1>/, "no emoji inside the gradient title (it turned into a flat blob)");
        assert.match(index, /\.pf-badge, \.ach-pin \{ color: var\(--kih-text\); \}/);
    });
    test("the big pictures move (the Wardrobe, your profile card, someone's profile); lists and chat stay still", () => {
        assert.match(index, /\{ size: 190, title: "Your character", animate: true \}/);
        assert.match(index, /CC\.svg\(out, \{ size: 120, animate: true \}\)/);
        assert.match(index, /\{ size: 150, title: "Their character", animate: true \}/);
        assert.match(read("social.html"), /\{ size: 150, title: "Their character", animate: true \}/);
        assert.doesNotMatch(read("social.html"), /size: 64, animate/);
        assert.doesNotMatch(read("games.html"), /animate: true/);
    });
    test("the Store says the apron's new name", () => {
        assert.match(read("store.html"), /Your Trader's Apron adds/);
    });
});

describe("things on their own; trying on many; 3 looks; the Wardrobe from the Store", () => {
    const index = read("index.html"), store = read("store.html"), td = read("thing-details.js");
    const inside = (s) => s.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
    test("itemPic: every wearable thing drawn alone — no head, no body, no hand, no shadow", () => {
        const skin = C.BASE.skin[C.DEFAULT_BASE.skin];
        for (const id of C.WEARABLE) {
            const w = C.wearOf(id), s = C.itemPic(id, 48);
            assert.match(s, /^<svg[^>]*class="kih-char kih-thumb"[^>]*width="48" height="48"/, id);
            if (w.slot === "pet" || w.slot === "bg") continue; // already just the pet / the scene
            assert.ok(inside(s).length > 40, id + ": something's drawn");
            assert.doesNotMatch(s, /rx="46" ry="44"/, id + ": no face");
            assert.doesNotMatch(s, /cy="219"/, id + ": no shadow");
            if (w.slot !== "eyes") assert.ok(!s.includes(`fill="${skin}"`), id + ": no skin (no head, no hand)");
            assert.doesNotMatch(s, /viewBox="0 0 200 240"/, id + ": framed close round it");
        }
        assert.match(C.itemPic("ht_halo"), /viewBox="62 -22.5 76 76"/, "a halo: just the halo, nothing under it");
        assert.match(C.itemPic("sh_dragon"), /r="9" fill="#ffb02e" opacity="0.45"/, "a legendary keeps its glow");
        assert.equal(C.itemPic("nope"), "");
        assert.ok(C.thumb("ht_halo").includes('rx="46" ry="44"'), "(the Wardrobe's pictures still show it worn, on a head)");
    });
    test("Bonuses show the thing itself; Style shows your character in each border and on each background", () => {
        assert.match(index, /<div class="it-icon">\$\{CC\.itemPic\(it\.id, 46\) \|\| it\.icon\}<\/div>/);
        assert.match(index, /if \(s\.type === "border"\) return PC\.withBorder\(`<span class="kc-card st-char">\$\{CC\.svg\(charWorn\(\), \{ size: 36 \}\)\}<\/span>`/);
        assert.match(index, /if \(s\.type === "background"\) return `<span class="st-bg [^`]*<span class="st-bg-char">\$\{CC\.svg\(charWorn\(\)/);
        assert.doesNotMatch(index, /class="st-av" src=/, "no old profile picture in the previews");
    });
    test("everyone has 3 free looks — even when the server doesn't send them", () => {
        assert.equal(C.cleanLooks(undefined, [], undefined).length, 3);
        assert.equal(C.cleanLooks([{ wear: { hat: "crown" } }], ["crown"], 0)[0].wear.hat, "crown");
        assert.match(index, /CC\.cleanLooks\(progressStatus\.looks \|\| \[progressStatus\.outfit\], progressStatus\.items \|\| \[\], progressStatus\.lookSlots\)/);
        assert.match(index, /const st = progressStatus, n = charLooks\(\)\.length;/);
        assert.match(index, /progressStatus\.lookSlots = r\.lookSlots;/, "a bought look keeps its place");
    });
    test("👁 Preview: try on as many things as you like, one per slot", () => {
        assert.match(index, /let charPreview = \{\};/);
        assert.match(index, /wear: \{ \.\.\.o\.wear, \.\.\.charPreview \}/);
        assert.match(index, /if \(charPreview\[slot\] === id\) delete charPreview\[slot\]; else charPreview\[slot\] = id;/);
        assert.match(index, /data-ch-unpreview="\$\{sl\}"/);
        assert.match(index, /if \(t\.dataset\.chUnpreview\) \{ delete charPreview\[t\.dataset\.chUnpreview\]; renderCharacter\(\); return; \}/);
        assert.doesNotMatch(index, /charPreview\.id|charPreview\.slot|charPreview = null/);
    });
    test("Store: pictures of what you'd wear; after a draw, 🧍 Wear it opens the Wardrobe wearing it", () => {
        const at = (s) => store.indexOf(`<script src="${s}"></script>`);
        assert.ok(at("progress-core.js") < at("character-core.js") && at("character-core.js") < at("thing-details.js"));
        assert.match(store, /const thingPic = \(x, size\) => \(CCh && CCh\.wearOf\(x\.id\) && CCh\.itemPic\(x\.id, size\)\) \|\| x\.icon;/);
        for (const s of ["thingPic(x, 24)", "thingPic(e, 60)", "thingPic(e, 40)", "thingPic(x, 38)"]) assert.ok(store.includes(s), s);
        assert.equal((store.match(/<div class="cr-item-icon">\$\{thingPic\(e, 76\)\}<\/div>/g) || []).length, 3, "the chest's, the event's and a Heart Spin's result");
        assert.equal((store.match(/<\/div><\/div>\$\{wearBtnHtml\(x\.id\)\}`;/g) || []).length, 2);
        assert.match(store, /window\.top\.openWardrobeAt\(id, true\)/);
        assert.match(store, /ThingDetails\.onWear = \(id\) => goWear\(id\);/);
        assert.doesNotMatch(store, /Profile → 🎨 Style|Choose Avatar/, "says where things are now");
        assert.match(index, /window\.openWardrobeAt = function \(id, wear\) \{[\s\S]{0,600}charCat = w\.slot; charFocus = id; charFocusSeen = false; charWearNext = wear \? ids : null;/);
        assert.match(index, /if \(charWearNext\) \{ const id = charWearNext; charWearNext = null; charPutOn\(id\); \}/);
    });
    test("the details popup: the thing's picture, a border round your character, 🧍 Wear it", () => {
        assert.match(td, /const icon = wearable \? CC\.itemPic\(id, 76\)/);
        assert.match(td, /PC\.withBorder\(CC && ctx && ctx\.outfit \? `<span class="kc-card td-char">\$\{CC\.svg\(ctx\.outfit/);
        assert.match(td, /onclick="ThingDetails\.wear\('\$\{esc\(id\)\}'\)">\$\{wearable \? "🧍 Wear it" : "🎨 Use it"\}/);
        assert.match(index, /ThingDetails\.onWear = \(id\) => window\.openWardrobeAt\(id, true\);/);
        assert.match(index, /outfit: charWorn\(\) \} : null;/);
    });
});

describe("💗 hearts on the server (api/progress.js)", () => {
    let db;
    const act = (body, token = "player-token") => call("progress.js", { token, body });
    const today = () => require("../api/_lib.js").dayKeyFor(Date.now());
    const inv = (u) => db._data.get("inventories/" + u) || {};
    beforeEach(() => {
        db = memoryFirestore();
        db._data.set("publicProfiles/player1", { name: "Ezra" });
        db._data.set("publicProfiles/player2", { name: "Mia" });
        db._data.set("publicProfiles/player3", { name: "Stranger" });
        db._data.set("friendRequests/player1_player2", { fromUid: "player1", toUid: "player2", status: "accepted" });
        db._data.set("friendRequests/player1_player3", { fromUid: "player1", toUid: "player3", status: "pending" });
        db._data.set("inventories/player1", { items: { crown: { at: 1 } } });
        db._data.set("tokenWallets/player1", { balance: 100 });
        state.db = db;
    });
    test("the rules: 5 a day (10 with Super Supporter); a spin is 50; the Heart Shop is dear; hearts are its things' thing", () => {
        assert.deepEqual(P.HEARTS, { perDay: 5, vipPerDay: 10, spinCost: 50, dayBonus: 3 });
        assert.deepEqual([P.heartsPerDay(false), P.heartsPerDay(true)], [5, 10]);
        assert.equal(P.HEART_SPIN.reduce((n, s) => n + s.weight, 0), 100);
        assert.deepEqual(P.HEART_SHOP.map(i => [i.id, i.heart]), [["hs_band", 150], ["hs_shades", 150], ["hs_locket", 300], ["hs_letter", 300], ["hs_sweater", 600]]);
        assert.deepEqual(P.HEART_SPIN_ONLY.map(i => i.id), ["hs_rose", "hs_bunny"]);
        for (const i of [...P.HEART_SHOP, ...P.HEART_SPIN_ONLY]) {
            assert.ok(C.wearOf(i.id) && C.itemPic(i.id), i.id + " is drawn");
            assert.ok(!i.chest && P.buyPrice(i.id) === null, i.id + ": not in the chest, not for tokens");
            assert.ok(i.perks.some(p => /^heart(Get|Send)Chance$/.test(p.kind)), i.id + " gives a chance of extra hearts");
        }
        assert.ok(P.ITEM_BY_ID.heart.perks.some(p => p.kind === "heartGetChance"), "Heart Lips (chest) too");
        assert.equal(P.heartChance(P.perksOf(["hs_sweater", "hs_bunny", "heart"]), "heartGetChance"), 0.45);
        assert.equal(P.heartChance({ heartGetChance: 300 }, "heartGetChance"), 1, "never over 100%");
        assert.equal(P.heartPrice("crown"), null);
        assert.deepEqual(P.ACHIEVEMENT_REWARDS.heartSpins, ["b_heartbeat"]);
        assert.equal(P.ACHIEVEMENT_BY_ID.likesGiven.name, "Heart Giver");
        assert.equal(P.ACHIEVEMENT_BY_ID.likesReceived.name, "Beloved");
    });
    test("a spin: always something (✨ mostly); an item only if you don't have it; nothing left → 500 ✨", () => {
        const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };
        assert.equal(P.rollHeartSpin([], seq(0)).stardust, 100);
        assert.equal(P.rollHeartSpin([], seq(0.6)).hearts, 20);
        assert.equal(P.rollHeartSpin([], seq(0.8)).draws, 1);
        assert.equal(P.rollHeartSpin([], seq(0.95, 0.99)).id, "hs_bunny");
        assert.deepEqual(P.rollHeartSpin(["hs_rose", "hs_bunny"], seq(0.95)), { key: "exclusive", kind: "stardust", tokens: 0, stardust: 500, hearts: 0, draws: 0, id: null });
        const it = P.rollHeartSpin([], seq(0.85, 0));
        assert.ok(P.ITEM_BY_ID[it.id].chest && ["common", "uncommon", "rare"].includes(P.ITEM_BY_ID[it.id].rarity));
    });
    test("sendHeart: it's your friend's (waiting for them to collect) — not yours; not twice a day", async () => {
        const r = await act({ action: "sendHeart", toUid: "player2" });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.deepEqual([r.body.hearts, r.body.bonus, r.body.heartsLeft, r.body.heartsPerDay, r.body.heartsToday], [0, 0, 4, 5, ["player2"]]);
        assert.deepEqual([inv("player1").hearts, inv("player1").heartsSent], [0, 1], "you get nothing for sending");
        assert.equal(inv("player2").hearts, undefined, "theirs to collect, not added yet");
        assert.equal(db._data.get("playerCards/player2").heartsGot, 1, "counts on their profile");
        const gift = db._data.get(`heartGifts/player2_${today()}_player1`);
        assert.deepEqual([gift.to, gift.from, gift.fromName, gift.collected], ["player2", "player1", "Ezra", false]);
        assert.match((await act({ action: "sendHeart", toUid: "player2" })).body.error, /already/);
        assert.equal(db._docs("heartGifts").length, 1);
    });
    test("collectHearts: your friends' hearts, then you send one back", async () => {
        await act({ action: "sendHeart", toUid: "player2" });
        let s = await act({ action: "heartStatus" }, "player2-token");
        assert.deepEqual(s.body.waiting.map(w => [w.from, w.fromName]), [["player1", "Ezra"]]);
        const r = await act({ action: "collectHearts", fromUid: "player1" }, "player2-token");
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.deepEqual([r.body.got, r.body.hearts, r.body.collected], [1, 1, ["player1"]]);
        assert.equal(inv("player2").hearts, 1);
        assert.equal(db._data.get(`heartGifts/player2_${today()}_player1`).collected, true);
        assert.match((await act({ action: "collectHearts" }, "player2-token")).body.error, /No hearts waiting/, "not twice");
        s = await act({ action: "heartStatus" }, "player2-token");
        assert.equal(s.body.waiting.length, 0);
        // sending one back
        assert.equal((await act({ action: "sendHeart", toUid: "player1" }, "player2-token")).status, 200);
        assert.equal((await act({ action: "collectHearts" })).body.got, 1);
        assert.equal(inv("player1").hearts, 1);
    });
    test("heart luck: heartGetChance can make one collected heart two; heartSendChance can give the sender one", async () => {
        db._data.set("inventories/player2", { items: {}, perks: { heartGetChance: 100 } });
        db._data.set("inventories/player1", { items: {}, perks: { heartSendChance: 100 } });
        const s = await act({ action: "sendHeart", toUid: "player2" });
        assert.deepEqual([s.body.bonus, s.body.hearts, inv("player1").hearts], [1, 1, 1], "100%: the sender got one");
        const c = await act({ action: "collectHearts" }, "player2-token");
        assert.deepEqual([c.body.got, c.body.bonus, inv("player2").hearts], [2, 1, 2], "100%: two for one");
    });
    test("sendHeart: only friends; not yourself; 5 a day — 10 for a Super Supporter", async () => {
        assert.match((await act({ action: "sendHeart", toUid: "player3" })).body.error, /friends/, "a pending request isn't a friend");
        assert.match((await act({ action: "sendHeart", toUid: "nobody" })).body.error, /friends/);
        assert.equal((await act({ action: "sendHeart", toUid: "player1" })).status, 400);
        assert.equal((await act({ action: "sendHeart", toUid: "" })).status, 400);
        db._data.set(`heartDays/player1_${today()}`, { to: Array.from({ length: 5 }, (_, i) => "f" + i) });
        assert.match((await act({ action: "sendHeart", toUid: "player2" })).body.error, /all 5 .*Super Supporters send 10/);
        db._data.set("users/player1", { vipExpiresAt: Date.now() + 86400000 });
        const r = await act({ action: "sendHeart", toUid: "player2" });
        assert.equal(r.status, 200, "a Super Supporter has 10");
        assert.deepEqual([r.body.heartsPerDay, r.body.heartsLeft], [10, 4]);
    });
    test("send all of the day's hearts: +3 💗 for you (once — 5 sends, or 10 for a Super Supporter)", async () => {
        db._data.set(`heartDays/player1_${today()}`, { to: ["f1", "f2", "f3"] });
        let r = await act({ action: "sendHeart", toUid: "player2" });
        assert.deepEqual([r.body.dayBonus, r.body.hearts], [0, 0], "the 4th: nothing yet");
        db._data.set("friendRequests/player1_player4", { status: "accepted" });
        r = await act({ action: "sendHeart", toUid: "player4" });
        assert.deepEqual([r.body.dayBonus, r.body.hearts, r.body.heartsLeft, inv("player1").hearts], [3, 3, 0, 3], "the 5th: +3");
        // a Super Supporter: the bonus comes with the 10th, not the 5th
        db._data.set("users/player1", { vipExpiresAt: Date.now() + 86400000 });
        db._data.set(`heartDays/player1_${today()}`, { to: ["f1", "f2", "f3", "f4"] });
        db._data.set("inventories/player1", { items: {} });
        db._data.delete(`heartGifts/player2_${today()}_player1`);
        r = await act({ action: "sendHeart", toUid: "player2" });
        assert.deepEqual([r.body.dayBonus, r.body.heartsLeft], [0, 5], "VIP: the 5th isn't the last");
    });
    test("heartStatus: your hearts, today's sends and limit, what's waiting, and whether someone's your friend", async () => {
        await act({ action: "sendHeart", toUid: "player2" });
        let r = await act({ action: "heartStatus", uid: "player2" });
        assert.deepEqual([r.body.hearts, r.body.heartsToday, r.body.heartsLeft, r.body.heartsPerDay, r.body.friend, r.body.waiting], [0, ["player2"], 4, 5, true, []]);
        r = await act({ action: "heartStatus", uid: "player3" });
        assert.equal(r.body.friend, false);
    });
    test("heartSpin: costs 50 💗; what it gives lands (tokens logged as gifted, items with their perks)", async () => {
        assert.match((await act({ action: "heartSpin" })).body.error, /costs 50/);
        db._data.set("inventories/player1", { items: { crown: { at: 1 } }, hearts: 5000 });
        let hearts = 5000, tokens = 100, draws = 0, stardust = 0;
        for (let i = 0; i < 60; i++) {
            const r = await act({ action: "heartSpin" });
            assert.equal(r.status, 200, JSON.stringify(r.body));
            const p = r.body.prize;
            hearts += p.hearts - 50; tokens += p.tokens; draws += p.draws; stardust += p.stardust;
            assert.equal(r.body.hearts, hearts);
            if (p.id) assert.ok(p.id in inv("player1").items, "the item's yours");
        }
        assert.equal(inv("player1").hearts, hearts);
        assert.equal(inv("player1").heartSpins, 60);
        assert.equal(inv("player1").freeDraws || 0, draws);
        assert.equal(db._data.get("tokenWallets/player1").balance, tokens);
        assert.equal(inv("player1").stardust || 0, stardust, "✨ from the spin");
        assert.equal(db._docs("chestOpens").filter(x => x.kind === "heartSpin").length, 60);
    });
    test("buyHeartItem: a Heart Shop thing for hearts; not twice; not chest things; not without the hearts", async () => {
        assert.match((await act({ action: "buyHeartItem", id: "hs_band" })).body.error, /150 💗 — you have 0/);
        db._data.set("inventories/player1", { items: {}, hearts: 200 });
        const r = await act({ action: "buyHeartItem", id: "hs_band" });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(inv("player1").hearts, 50);
        assert.ok("hs_band" in inv("player1").items);
        assert.equal(inv("player1").perks.heartGetChance, 10, "its heart luck counts at once");
        assert.match((await act({ action: "buyHeartItem", id: "hs_band" })).body.error, /already/);
        for (const id of ["crown", "hs_rose", "hs_bunny", "constructor", ""]) assert.equal((await act({ action: "buyHeartItem", id })).status, 400, id);
        assert.equal(inv("player1").hearts, 50);
    });
    test("renameLook: your looks' names, cleaned, on your public card", async () => {
        let r = await act({ action: "renameLook", look: 1, name: "  Battle   <b>Gear</b> and much more " });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.name, "Battle bGear/b a");
        assert.deepEqual(db._data.get("playerCards/player1").lookNames, ["", "Battle bGear/b a", ""]);
        await act({ action: "renameLook", look: 1, name: "" });
        assert.deepEqual(db._data.get("playerCards/player1").lookNames, ["", "", ""], "an empty name puts back Look 2");
        for (const look of [3, -1, "1"]) assert.equal((await act({ action: "renameLook", look, name: "x" })).status, 400, String(look));
        assert.equal((await act({ action: "renameLook", look: 0, name: { a: 1 } })).status, 400);
        assert.equal(C.lookName(["", "Party"], 1), "Party");
        assert.equal(C.lookName([], 2), "Look 3");
    });
});

describe("in the app: hearts, named looks, friends' name effects, popups", () => {
    const index = read("index.html"), social = read("social.html"), store = read("store.html"), td = read("thing-details.js");
    test("Social: when players' cards arrive, every list on screen repaints (the 🧍 pictures asking first no longer leave names plain)", () => {
        assert.match(social, /if \(changed\) new Set\(\[redraw, \.\.\.liveRedraws\.values\(\)\]\)\.forEach/);
        assert.doesNotMatch(social, /if \(changed && redraw\) redraw\(\);/);
        assert.match(social, /<div class="friend-row-name" style="[^"]*"><span class="\$\{nameFx\(f\.uid\)\}">/, "friends list: their name effect");
        assert.match(social, /ensureCards\(list\.map\(f => f\.uid\), \(\) => renderFriends\(friends\), "friends"\)/);
        assert.match(social, /querySelectorAll\("\[data-fx-uid\]"\)/, "search results, suggestions, requests: repainted in place");
    });
    test("💗 replaces 👍 on profiles (Home and Social); a 💗 for each friend in the friends list", () => {
        for (const [f, page] of [["index.html", index], ["social.html", social]]) {
            assert.match(page, /async function fillHeartButton\(uid, btn, card\)/, f);
            assert.match(page, /fillHeartButton\(uid, likeBtn, card\);/, f);
            assert.doesNotMatch(page, /setProfileLike|haveILikedProfile\(uid\)/, f + ": no more 👍");
            assert.match(page, /Math\.max\(0, card\.heartsGot \|\| 0\) \+ Math\.max\(0, card\.likeCount \|\| 0\)/, f + ": old likes count too");
        }
        assert.match(social, /class="friend-heart\$\{myHearts\.heartsToday\.includes\(f\.uid\) \? " sent" : ""\}" onclick="event\.stopPropagation\(\); quickHeart\('\$\{f\.uid\}', this\)"/);
        assert.doesNotMatch(index, /heartBackButtonHtml/, "hearts wait in Social, not as inbox notes");
        assert.match(index, /const hearts = st \? \(st\.heartsGot != null \? st\.heartsGot : st\.likeCount\) : 0;[\s\S]{0,200}ProfileCard\.heartsText\(hearts\)/, "your profile: 💗 hearts");
    });
    test("Social → Friends → 💗 Hearts: what you have, sends left today, hearts waiting — Collect (one or all) and 💗 Send back", () => {
        assert.match(social, /<div id="heartsPanel" class="hearts-panel" style="display:none;"><\/div>\s*<div id="friendsSection">/);
        assert.match(social, /onclick="collectHeart\('\$\{escapeHtml\(w\.from\)\}', this\)">Collect<\/button>/);
        assert.match(social, /onclick="sendHeartBack\('\$\{escapeHtml\(w\.from\)\}', this\)"/);
        assert.match(social, /onclick="collectHeart\(null, this\)">💗 Collect all \$\{waiting\.length\}<\/button>/);
        assert.match(social, /const r = await AppState\.collectHearts\(from \|\| undefined\);/);
        assert.match(social, /if \(tab === "friends"\) \{ loadSuggestedFriends\(\); loadMyHearts\(\); \}/, "fresh each time you open Friends");
        assert.match(social, /<b>\$\{h\.heartsLeft\}<\/b> of \$\{h\.heartsPerDay\} left today/);
        assert.match(social, /<div class="hp-send">\$\{pals\.map\(p => \{/, "💗 Send hearts: a card for each friend");
        assert.match(social, /\(sentMe\.has\(b\.uid\) - sentMe\.has\(a\.uid\)\)/, "…whoever sent you one first");
        assert.match(social, /id="heartWaitBadge"/, "a 💗 count on the Friends tab");
    });
    test("tap someone's picture anywhere in Social: their profile (before whatever the row does)", () => {
        assert.match(social, /const pic = e\.target instanceof Element && e\.target\.closest\("\[data-char-uid\]"\);[\s\S]{0,300}onPosterClick\(pic\.dataset\.charUid, ""\);\s*\}, true\);/);
        assert.match(social, /return `<span class="\$\{cls\} kc-av" data-char-uid="\$\{escapeHtml\(uid\)\}" /, "every picture there is a character with data-char-uid");
    });
    test("profiles show all of someone's looks (3 at least), named; tap one to see it big", () => {
        for (const page of [index, social]) {
            assert.match(page, /Array\.from\(\{ length: Math\.max\(CC\.LOOKS_FREE, list\.length\) \}, \(_, i\) => list\[i\] \|\| CC\.cleanOutfit\(\{\}, \[\]\)\)/);
            assert.match(page, /CC\.lookName\(card\.lookNames, i\)/);
            assert.match(page, /wireLooks\(row, (charEl|av), card\);/);
        }
    });
    test("✏️ name a look in the Wardrobe; its name shows everywhere you see the look", () => {
        assert.match(index, /data-ch-rename="\$\{li\}" aria-label="Name this look">✏️ Name<\/button>/);
        assert.match(index, /<input type="text" id="chLookName" maxlength="\$\{CC\.LOOK_NAME_MAX\}"/);
        assert.match(index, /const r = await AppState\.renameLook\(i, name\);/);
        assert.match(index, /<small>\$\{escText\(nm\(i\)\)\}\$\{i === eq \? " ✓" : ""\}<\/small>/);
    });
    test("popups: nothing behind one can be tapped; the phone's Back closes it (not the page)", () => {
        assert.match(index, /body\.kih-child-popup \.home-topbar \{ pointer-events: none;/);
        assert.match(index, /window\.addEventListener\("popstate", \(e\) => \{\s*\/\/ A popup open: Back closes it, and stays here\.\s*if \(window\.closePopupFromHistory && window\.closePopupFromHistory\(\)\) return;/);
        assert.match(index, /popupStep\(\(\) => window\.closeViewProfileModalHome\(true\)\);/);
        assert.match(index, /window\.closeViewProfileModalHome = function \(fromBack\) \{[\s\S]{0,160}if \(fromBack !== true\) leavePopupStep\(\);/);
        assert.match(social, /const showing = \(\) => \[\.\.\.document\.querySelectorAll\("\.modal-overlay\.open"\)\]\.some\(el => el\.id !== "dmModalOverlay" && el\.getClientRects\(\)\.length > 0/, "only a popup you can see counts — and a chat isn't one");
        assert.match(social, /if \(a\) a\.kihChildPopup\(now, window\);/);
        assert.doesNotMatch(social, /kihCloseTopPopup/, "Social's own Back steps close its popups — the app adds none (two sets of steps fought)");
        assert.match(index, /return !!fe && fe\.isConnected && fe\.offsetParent !== null;/, "locked only while that section is on screen");
        assert.match(index, /new MutationObserver\(\(\) => \{ refreshChildPopupLock\(\); setTimeout\(refreshChildPopupLock, 400\); \}\)\.observe\(wrap/, "…rechecked whenever the page changes");
        assert.match(social, /window\.resetSocialView = function \(\) \{[\s\S]{0,1500}closeFriendProfileModal\(\);\s*closeViewProfileModal\(\);\s*closeChatRules\(\);/, "leaving Social closes someone's profile too");
    });
    test("Store: the 💗 Heart Shop (a spin, things to buy, spin-only treasures), linked from the Wardrobe and the guide", () => {
        assert.match(store, /<h2 class="store-section" id="hearts"><span>💗<\/span> Heart Shop<\/h2>/);
        for (const s of ["function renderHeartShop()", "window.spinHearts = async function", "window.buyHeartThing = async function", "r = await AppState.heartSpin();", "const r = await AppState.buyHeartItem(id);"]) assert.ok(store.includes(s), s);
        assert.match(store, /\{ "#chest": "chest", "#event": "event", "#hearts": "hearts", "#deals": "deals", "#sets": "sets" \}\[location\.hash\]/);
        assert.match(index, /data-ch-heartshop="\$\{id\}"[^>]*>💗 \$\{PC\.heartPrice\(id\)\}<\/button>/);
        assert.match(index, /if \(t\.dataset\.chHeartshop\) \{ window\.openStoreAt\("hearts"\); return; \}/);
        assert.match(td, /if \(x\.heart\) return `💗 Heart Shop \(in the Store\) — \$\{x\.heart\} 💗`;/);
        assert.ok(require("../help-guide.js").STORE_AT.includes("hearts"));
        assert.match(read("fx-styles.css"), /\.fx-border-heartbeat \{/, "the Heart Spinner's Mythic border is styled");
    });
});

describe("✨ Stardust (api/progress.js)", () => {
    let db;
    const act = (body, token = "player-token") => call("progress.js", { token, body });
    const L = require("../api/_lib.js");
    const inv = () => db._data.get("inventories/player1") || {};
    beforeEach(() => {
        db = memoryFirestore();
        db._data.set("inventories/player1", { items: { crown: { at: 1 } }, stardust: 0 });
        db._data.set("tokenWallets/player1", { balance: 100 });
        state.db = db;
    });
    test("the rules: 1 🪙 = 10 ✨; the chest is 500 ✨ (×10 4,500); duplicates pay ✨; perks in ✨", () => {
        assert.deepEqual(P.STARDUST, { perToken: 10, dealCount: 4, dealOff: 30, tierBonus: 100 });
        assert.deepEqual([P.CHEST.price, P.CHEST.price10], [500, 4500]);
        assert.deepEqual(P.RARITY_ORDER.map(r => P.RARITIES[r].refund), [100, 150, 250, 350, 500]);
        assert.equal(P.chestPrice(1, { chestDiscount: 5 }), 450);
        assert.equal(P.refundFor("crown", { dupBonus: 5 }), 400);
        assert.match(P.perkText({ kind: "dupBonus", value: 5 }), /50 ✨/);
    });
    test("Daily Deals: 4 things to wear, 30% off, the same for everyone that day; at most one Legendary", () => {
        for (const day of ["2026-11-14", "2026-11-15", "2026-12-01", "2027-03-09"]) {
            const d = P.dailyDeals(day);
            assert.equal(d.length, 4, day);
            assert.deepEqual(d, P.dailyDeals(day), "the same all day");
            d.forEach(x => { assert.ok(P.ITEM_BY_ID[x.id].chest && C.wearOf(x.id)); assert.equal(x.price, Math.round(x.was * 0.7 / 10) * 10); });
            assert.ok(d.filter(x => P.ITEM_BY_ID[x.id].rarity === "legendary").length <= 1);
        }
        assert.notDeepEqual(P.dailyDeals("2026-11-14"), P.dailyDeals("2026-11-16"), "a new day, new deals");
    });
    test("convertTokens: 🪙 → ✨ (10 each), logged as tokens spent; never back; not more than you have", async () => {
        const r = await act({ action: "convertTokens", tokens: 30 });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.deepEqual([r.body.stardustGot, r.body.balance, r.body.stardust], [300, 70, 300]);
        assert.equal(db._data.get("tokenWallets/player1").balance, 70);
        const [log] = db._docs("chestOpens");
        assert.deepEqual([log.kind, log.price, log.currency, log.stardustGot], ["convert", 30, "tokens", 300]);
        assert.match((await act({ action: "convertTokens", tokens: 71 })).body.error, /You have 70/);
        for (const n of [0, -5, 1.5, "10", 1e9]) assert.equal((await act({ action: "convertTokens", tokens: n })).status, 400, String(n));
        assert.equal((await act({ action: "convertStardust", stardust: 100 })).status, 400, "there's no way back");
    });
    test("the daily login's week: 2 🪙 Mon/Wed/Fri, ✨ Tue (50) / Thu (100) / Sat (50), Sunday's chest", () => {
        const days = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"]; // Mon..Sun
        assert.deepEqual(days.map(P.loginGift), [{ tokens: 2 }, { stardust: 50 }, { tokens: 2 }, { stardust: 100 }, { tokens: 2 }, { stardust: 50 }, { chest: "uncommon" }]);
        const tokensAWeek = P.LOGIN_WEEK.reduce((n, g) => n + (g.tokens || 0), 0);
        assert.equal(tokensAWeek, 6, "the same 🪙 as before (6 × 1) before Sunday's coins — giveaways aren't watered down");
    });
    test("collectDaily is gone: the free ✨ comes with the login now", async () => {
        assert.equal((await act({ action: "collectDaily" })).status, 400);
        assert.doesNotMatch(read("store.html"), /id="daily"|collectDailyGift|Free today/);
    });
    test("the chest costs ✨ and pays duplicates back in ✨; tokens untouched", async () => {
        assert.match((await act({ action: "openChest", count: 1 })).body.error, /costs 500 ✨ — you have 0/);
        db._data.set("inventories/player1", { items: {}, stardust: 5000 });
        const r = await act({ action: "openChest", count: 10 });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(inv().stardust, 5000 - 4500 + r.body.refund);
        assert.equal(db._data.get("tokenWallets/player1").balance, 100, "tokens untouched");
        assert.equal(db._docs("chestOpens")[0].currency, "stardust");
    });
    test("a Daily Deal: bought at its price; not a deal any more → refused", async () => {
        const day = L.dayKeyFor(Date.now());
        const [deal] = P.dailyDeals(day);
        db._data.set("inventories/player1", { items: {}, stardust: deal.price });
        const r = await act({ action: "buyItem", id: deal.id, deal: true });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.deepEqual([r.body.price, r.body.deal, inv().stardust], [deal.price, true, 0]);
        const notDeal = P.ITEMS.find(i => i.chest && P.buyPrice(i.id) && !P.dailyDeals(day).some(d => d.id === i.id));
        assert.match((await act({ action: "buyItem", id: notDeal.id, deal: true })).body.error, /isn't one of today's Daily Deals/);
    });
    test("the admin's token check counts 🪙 only: ✨ draws don't count, 🪙 → ✨ does", async () => {
        const tokens = read("api/tokens.js");
        assert.match(tokens, /const tokenOpens = opens\.filter\(o => \(o\.currency \|\| "tokens"\) === "tokens"\);/);
        assert.match(tokens, /const chestPaid = sum\(tokenOpens, o => o\.price\);/);
    });
});

describe("✨ Stardust in the app (the Store, the Wardrobe)", () => {
    const store = read("store.html"), index = read("index.html");
    test("the Store's order: Daily Deals (+ 🪙 → ✨) → Heart Shop → the chest → monthly plans → token packs", () => {
        const at = (s) => { const i = store.indexOf(s); assert.ok(i > 0, s); return i; };
        const order = ['id="deals"', 'id="sdConvert"', 'id="hearts"', 'id="chest"', "</span> Monthly plans</h2>", "</span> Token packs"].map(at);
        assert.deepEqual(order, order.slice().sort((a, b) => a - b));
    });
    test("Daily Deals; the converter says one way only", () => {
        assert.match(store, /PC\.dailyDeals\(day\)\.map\(d => \{/);
        assert.match(store, /const r = await AppState\.buyItem\(id, true\);/, "a deal is bought as a deal");
        assert.match(store, /<b>One way only<\/b> — Stardust can't be turned back into tokens\./);
        assert.doesNotMatch(store, /convertStardust|stardust → 🪙|✨ → 🪙/, "nothing turns ✨ into 🪙");
    });
    test("short of ✨ (the chest, a deal, the Wardrobe, a look): it offers 🪙 → ✨ first", () => {
        assert.match(store, /if \(!free && !\(await haveStardust\(price\)\)\) return;/);
        assert.match(store, /if \(!\(await haveStardust\(d\.price\)\)\)/);
        assert.match(index, /if \(!\(await haveStardust\(price, `\$\{deal \? "🛍️ Today's deal: " : ""\}\$\{it\.name\}`\)\)\) return;/);
        assert.match(index, /if \(!\(await haveStardust\(price, `Another look/);
        for (const page of [store, index]) assert.match(page, /AppState\.convertTokens\(/);
    });
});

describe("🗓️ the daily login pays 🪙, ✨ or Sunday's chest (api/tokens.js)", () => {
    let db, realNow;
    const act = (body) => call("tokens.js", { token: "player-token", body });
    const at = (y, m, d) => { Date.now = () => Date.UTC(y, m - 1, d, 4); }; // noon in Singapore
    const inv = () => db._data.get("inventories/player1") || {};
    const wallet = () => (db._data.get("tokenWallets/player1") || {}).balance || 0;
    beforeEach(() => {
        db = memoryFirestore();
        db._data.set("tokenWallets/player1", { balance: 0 });
        db._data.set("inventories/player1", { items: {}, stardust: 0 });
        state.db = db;
        realNow = Date.now;
    });
    const login = async (day) => {
        const c = await act({ action: "complete", questId: "login" });
        assert.equal(c.status, 200, JSON.stringify(c.body));
        assert.ok(c.body.completed, JSON.stringify(c.body));
        const r = await act({ action: "claim", claimIds: [`${day}_login`] });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        return r.body;
    };
    test("Monday: 2 🪙; Tuesday: 50 ✨ and no 🪙; Thursday: 100 ✨", async () => {
        try {
            at(2026, 11, 16); let r = await login("2026-11-16");
            assert.deepEqual([r.claimed, r.stardust, wallet(), inv().stardust], [2, 0, 2, 0]);
            at(2026, 11, 17); r = await login("2026-11-17");
            assert.deepEqual([r.claimed, r.stardust, r.stardustBalance, wallet(), inv().stardust], [0, 50, 50, 2, 50]);
            assert.equal(db._data.get("tokenWallets/player1/claims/2026-11-17_login").stardust, 50);
            at(2026, 11, 19); r = await login("2026-11-19");
            assert.deepEqual([r.stardust, inv().stardust], [100, 150]);
        } finally { Date.now = realNow; }
    });
    test("the Ration Pack's +🪙 still comes every day — ✨ days too", async () => {
        db._data.set("inventories/player1", { items: { gloves: { at: 1 } }, perks: { loginBonus: 1 }, stardust: 0 });
        try {
            at(2026, 11, 17); const r = await login("2026-11-17");
            assert.deepEqual([r.claimed, r.stardust], [1, 50]);
        } finally { Date.now = realNow; }
    });
    test("Sunday: its coins (a full week: 3–5) and a chest of Uncommon or better, in one claim; never twice", async () => {
        try {
            for (const d of [9, 10, 11, 12, 13, 14]) db._data.set(`tokenWallets/player1/claims/2026-11-${String(d).padStart(2, "0")}_login`, { questId: "login", dayKey: `2026-11-${String(d).padStart(2, "0")}`, status: "claimed", reward: 1 });
            at(2026, 11, 15); const r = await login("2026-11-15");
            assert.ok(r.claimed >= 3 && r.claimed <= 5, "a full streak's coins: " + r.claimed);
            assert.equal(r.chests.length, 1);
            const c = r.chests[0], it = P.BY_ID[c.id];
            assert.ok(it.chest && P.RARITY_ORDER.indexOf(it.rarity) >= 1, "Uncommon or better: " + it.rarity);
            assert.ok(c.id in inv().items, "it's yours");
            assert.ok(inv().perks && typeof inv().perks === "object", "its bonus counts at once");
            const again = await act({ action: "claim", claimIds: ["2026-11-15_login"] });
            assert.equal(again.body.claimed, 0); assert.equal((again.body.chests || []).length, 0, "not twice");
        } finally { Date.now = realNow; }
    });
    test("Sunday after a missed day: 1 🪙 — and the chest all the same", async () => {
        try {
            at(2026, 11, 15); const r = await login("2026-11-15");
            assert.equal(r.claimed, 1);
            assert.equal(r.chests.length, 1);
        } finally { Date.now = realNow; }
    });
    test("a doc can't be talked up: ✨ at most 1,000; chests only Uncommon and up", async () => {
        db._data.set("tokenWallets/player1/claims/2026-11-10_login", { questId: "login", dayKey: "2026-11-10", status: "ready", reward: 0, stardust: 99999, itemChest: "mythic" });
        const r = await act({ action: "claim", claimIds: ["2026-11-10_login"] });
        assert.deepEqual([r.body.stardust, (r.body.chests || []).length], [1000, 0]);
    });
});

describe("the daily login on the page (appState.js, index.html)", () => {
    const app = read("appState.js"), index = read("index.html");
    test("a ✨ day's login (0 🪙) isn't read as 1 🪙; its ✨ and Sunday's 🧰 come along", () => {
        assert.match(app, /logins\[c\.dayKey\] = \{ status, reward: typeof c\.reward === "number" \? c\.reward : 1, chest: !!c\.chest, stardust: c\.stardust \|\| 0, itemChest: c\.itemChest \|\| null \}/);
        assert.match(app, /reward: typeof d\.data\(\)\.reward === "number" \? d\.data\(\)\.reward : 1, chest: !!d\.data\(\)\.chest, stardust: d\.data\(\)\.stardust \|\| 0, itemChest: d\.data\(\)\.itemChest \|\| null/);
        assert.doesNotMatch(app, /reward: c\.reward \|\| 1|reward: d\.data\(\)\.reward \|\| 1/);
    });
    test("the calendar shows each day's gift; Claim says ✨; Sunday's 🧰 is shown after its coins", () => {
        assert.match(index, /const g = PC\.loginGift\(k\);/);
        assert.match(index, /await showLoginChestItems\(result\.chests\); \/\/ …and Sunday's 🧰/);
        assert.doesNotMatch(index, /"🪙<small>\+1<\/small>"/, "no more \"+1 🪙\" every day");
    });
});

describe("👘 outfit sets and the ✨ / 💗 bonus items", () => {
    let db, realNow;
    const act = (body) => call("progress.js", { token: "player-token", body });
    const tok = (body) => call("tokens.js", { token: "player-token", body });
    const inv = () => db._data.get("inventories/player1") || {};
    const set = P.SET_BY_ID.celestial;
    beforeEach(() => {
        db = memoryFirestore();
        db._data.set("publicProfiles/player1", { name: "Ezra" });
        db._data.set("publicProfiles/player2", { name: "Mia" });
        db._data.set("friendRequests/player1_player2", { fromUid: "player1", toUid: "player2", status: "accepted" });
        db._data.set("inventories/player1", { items: {}, stardust: 0 });
        db._data.set("tokenWallets/player1", { balance: 0 });
        state.db = db;
        realNow = Date.now;
    });
    test("the Celestial Set: 7 pieces, head to toe, one per slot — each drawn, each with a bonus; only in the set", () => {
        assert.deepEqual([set.pieces.length, set.worth, set.price, P.SET_OFF], [7, 16000, 9600, 40]);
        assert.ok(set.price <= 1000 * P.STARDUST.perToken, "the $10 token pack (1,000 🪙) buys it");
        // it adds up: 6 Rare + 1 Epic at their buy prices, 40% off — never more than the pieces, never under a deal's price for them
        assert.equal(set.worth, set.pieces.reduce((n, p) => n + P.BUY_PRICES[P.ITEM_BY_ID[p].rarity], 0));
        assert.ok(set.price < set.worth && set.price >= set.worth * (100 - P.STARDUST.dealOff - 20) / 100);
        // per piece, a set is cheaper than buying even one Rare on its own
        assert.ok(set.price / set.pieces.length < P.BUY_PRICES.rare);
        const slots = set.pieces.map(p => C.wearOf(p).slot);
        assert.deepEqual(slots, ["hair", "eyes", "mouth", "neck", "top", "bottom", "shoes"]);
        for (const p of set.pieces) {
            const it = P.ITEM_BY_ID[p];
            assert.ok(it.perks.length && C.itemPic(p) && C.thumb(p), p + ": drawn, with a bonus");
            assert.ok(!it.chest && P.buyPrice(p) === null && !P.heartPrice(p) && !it.heartSpin, p + ": not in the chest, not bought alone");
            assert.equal(P.setOf(p), set);
        }
        assert.equal(P.setOf("crown"), null);
        assert.ok(!P.chestPool("2026-11-15").some(x => x.set), "no set piece in the chest");
        for (let d = 1; d <= 28; d++) assert.ok(!P.dailyDeals(`2026-11-${String(d).padStart(2, "0")}`).some(x => P.setOf(x.id)), "nor a Daily Deal");
        const perks = P.perksOf(set.pieces);
        assert.deepEqual([perks.loginStardust, perks.spinStardust, perks.heartSends, perks.heartGetChance, perks.heartSendChance], [30, 40, 1, 5, 5]);
    });
    test("the new bonuses: +✨ a login, +✨ a Heart Spin, +💗 sends a day (capped); two new chest items carry them", () => {
        assert.equal(P.perkText({ kind: "loginStardust", value: 10 }), "+10 ✨ with every daily login");
        assert.equal(P.perkText({ kind: "spinStardust", value: 20 }), "+20 ✨ with every Heart Spin");
        assert.equal(P.perkText({ kind: "heartSends", value: 1 }), "+1 heart you can send a day");
        assert.deepEqual([P.heartsPerDay(false, { heartSends: 2 }), P.heartsPerDay(true, { heartSends: 1 }), P.heartsPerDay(false, { heartSends: 99 }), P.heartsPerDay(false)], [7, 11, 10, 5]);
        assert.deepEqual([P.perkStardust({ loginStardust: 30 }, "loginStardust"), P.perkStardust({ spinStardust: 5000 }, "spinStardust"), P.perkStardust(null, "spinStardust")], [30, 200, 0]);
        const pouch = P.ITEM_BY_ID.hd_starpouch, beanie = P.ITEM_BY_ID.ht_beanie;
        assert.ok(pouch.chest && beanie.chest && C.wearOf("hd_starpouch").slot === "held" && C.wearOf("ht_beanie").slot === "hat");
        assert.ok(pouch.perks.some(p => p.kind === "loginStardust") && beanie.perks.some(p => p.kind === "heartSends"));
    });
    test("buySet: every piece at once for 9,600 ✨, logged; not without the ✨; not twice; only real sets", async () => {
        assert.match((await act({ action: "buySet", id: "celestial" })).body.error, /costs 9,600 ✨ — you have 0/);
        assert.equal((await act({ action: "buySet", id: "nope" })).status, 400);
        assert.equal((await act({ action: "buySet", id: "__proto__" })).status, 400);
        db._data.set("inventories/player1", { items: { crown: { at: 1 } }, stardust: 10100 });
        const r = await act({ action: "buySet", id: "celestial" });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.deepEqual([r.body.stardust, inv().stardust, r.body.price], [500, 500, 9600]);
        for (const p of set.pieces) assert.ok(p in inv().items, p + " is yours");
        assert.ok("crown" in inv().items, "what you had stays");
        assert.equal(inv().perks.loginStardust, 30, "their bonuses count at once");
        const log = db._docs("chestOpens").find(x => x.kind === "set");
        assert.deepEqual([log.price, log.currency, log.results.length], [9600, "stardust", 7]);
        db._data.set("inventories/player1", { ...inv(), stardust: 99999 });
        assert.match((await act({ action: "buySet", id: "celestial" })).body.error, /already have the whole set/);
        assert.equal(inv().stardust, 99999, "nothing taken");
    });
    test("💗 heartSends: one more heart a day to send (sendHeart, heartStatus, status)", async () => {
        db._data.set("inventories/player1", { items: { ht_beanie: { at: 1 } }, perks: P.perksOf(["ht_beanie"]) });
        const today = require("../api/_lib.js").dayKeyFor(Date.now());
        db._data.set(`heartDays/player1_${today}`, { to: ["f1", "f2", "f3", "f4", "f5"] });
        const r = await act({ action: "sendHeart", toUid: "player2" });
        assert.equal(r.status, 200, "a 6th heart with the Heart Beanie: " + JSON.stringify(r.body));
        assert.deepEqual([r.body.heartsPerDay, r.body.heartsLeft, r.body.dayBonus], [6, 0, 3]);
        assert.equal((await act({ action: "heartStatus" })).body.heartsPerDay, 6);
        assert.ok(read("api/progress.js").includes("heartsPerDay: P.heartsPerDay(vip, perks), heartsLeft: Math.max(0, P.heartsPerDay(vip, perks) - heartsToday.length),"), "status too");
    });
    test("✨ spinStardust: every Heart Spin pays its ✨ on top", async () => {
        db._data.set("inventories/player1", { items: { cs_eyes: { at: 1 }, cs_bottom: { at: 1 } }, hearts: 500, stardust: 0 });
        let want = 0;
        for (let i = 0; i < 5; i++) {
            const r = await act({ action: "heartSpin" });
            assert.equal(r.status, 200, JSON.stringify(r.body));
            assert.equal(r.body.spinBonus, 40);
            want += r.body.prize.stardust + 40;
            assert.equal(r.body.stardust, want);
        }
        assert.equal(inv().stardust, want);
    });
    test("✨ loginStardust: every day's login — 🪙 days too", async () => {
        db._data.set("inventories/player1", { items: { hd_starpouch: { at: 1 } }, perks: P.perksOf(["hd_starpouch"]), stardust: 0 });
        const login = async (day) => {
            await tok({ action: "complete", questId: "login" });
            return (await tok({ action: "claim", claimIds: [`${day}_login`] })).body;
        };
        try {
            Date.now = () => Date.UTC(2026, 10, 16, 4); let r = await login("2026-11-16"); // Monday: 2 🪙
            assert.deepEqual([r.claimed, r.stardust, inv().stardust], [2, 10, 10]);
            Date.now = () => Date.UTC(2026, 10, 17, 4); r = await login("2026-11-17"); // Tuesday: 50 ✨
            assert.deepEqual([r.claimed, r.stardust, inv().stardust], [0, 60, 70]);
        } finally { Date.now = realNow; }
    });
});

describe("👘 outfit sets in the app (the Store, the Wardrobe, the guide)", () => {
    const store = read("store.html"), index = read("index.html"), app = read("appState.js");
    test("the Store: 👘 Outfit Sets after Daily Deals (+ 🪙 → ✨), before the Heart Shop; bought with ✨, two taps", () => {
        const at = (s) => { const i = store.indexOf(s); assert.ok(i > 0, s); return i; };
        const order = ['id="deals"', 'id="sdConvert"', 'id="sets"', 'id="hearts"', 'id="chest"'].map(at);
        assert.deepEqual(order, order.slice().sort((a, b) => a - b));
        assert.match(store, /const r = await AppState\.buySet\(id\);/);
        assert.match(store, /if \(!\(await haveStardust\(set\.price\)\)\)/, "short of ✨: 🪙 → ✨ first");
        assert.match(app, /async function buySet\(id\) \{\s+return callProgressApi\("buySet", \{ id \}\);/);
    });
    test("🧍 Wear the set: the Wardrobe puts every piece on at once", () => {
        assert.match(store, /window\.top\.openWardrobeAt\(set\.pieces, true\)/);
        assert.match(index, /ids\.forEach\(x => \{ wear\[CC\.wearOf\(x\)\.slot\] = x; \}\);/);
    });
    test("the Wardrobe: a set piece you don't have says 👘 Set and opens the Store at the set", () => {
        assert.match(index, /PC\.setOf\(id\) \? `<button type="button" class="ch-buy-btn" data-ch-set=/);
        assert.match(index, /if \(t\.dataset\.chSet\) \{ window\.openStoreAt\("sets"\); return; \}/);
    });
});

describe("👦 a boy's cut of every long hair (girls keep them long)", () => {
    const LONG = { hr_waves: "M50,86 C46,40", hr_twin: "M50,92 C34,96", hr_silver: "M110,40 C138,40", cs_hair: "M50,86 C46,40" };
    const draw = (id, body) => C.svg({ base: { body, skin: 1 }, wear: { hair: id } }, { size: 100 });
    test("Long Waves, Twin Tails, Silver Ponytail and Nebula Hair: long on a girl, a short cut on a boy", () => {
        for (const [id, longBack] of Object.entries(LONG)) {
            assert.ok(draw(id, "girl").includes(longBack), id + ": a girl's is long");
            assert.ok(!draw(id, "guy").includes(longBack), id + ": a boy's isn't");
            assert.ok(C.itemPic(id, 48, "girl").includes(longBack) && !C.itemPic(id, 48, "guy").includes(longBack), id + ": its picture for each");
            assert.ok(C.thumb(id, 48, "girl").includes(longBack) && !C.thumb(id, 48, "guy").includes(longBack), id + ": its Wardrobe tile for each");
        }
        // still theirs: the twin ties, the silver tie, the nebula stars
        assert.ok(draw("hr_twin", "guy").includes('fill="#ffd166"') && draw("hr_silver", "guy").includes('fill="#7b4fd9"') && draw("cs_hair", "guy").includes('fill="#ffe27a"'));
        assert.equal(C.itemPic("hr_waves", 48), C.itemPic("hr_waves", 48, "guy"), "no body: drawn as before (the default)");
        assert.equal(C.itemPic("hr_waves", 48, "nonsense"), C.itemPic("hr_waves", 48));
    });
    test("the 👘 set card shows it on a Boy and a Girl", () => {
        const store = read("store.html");
        assert.match(store, /\[\["guy", "Boy"\], \["girl", "Girl"\]\]\.map\(\(\[b, label\]\) => `<span class="set-fig" data-body="\$\{b\}">\$\{CCh\.svg\(setOutfit\(set, b\)/);
        assert.match(store, /<s>\$\{fmtN\(set\.worth\)\} ✨<\/s> bought one by one · <b>−\$\{PC\.SET_OFF\}% as a set<\/b>/);
    });
});

describe("⚡ Social stays quick: players' characters as pictures", () => {
    const social = read("social.html");
    test("CharacterCore.pic: one <img> of exactly the same drawing, never animated, the same text each time", () => {
        const o = { base: { body: "girl", skin: 2 }, wear: { hat: "crown", top: "cs_top" } };
        const p = C.pic(o, { size: 64, animate: true });
        const m = p.match(/^<img class="kih-char-pic" src="data:image\/svg\+xml;charset=utf-8,([^"]+)" width="64" height="77" alt="" decoding="async" draggable="false">$/);
        assert.ok(m, p.slice(0, 120));
        const drawn = decodeURIComponent(m[1]), ids = (s) => s.replace(/kc[0-9a-z]+-/g, "kcN-"); // (each drawing numbers its own ids)
        assert.equal(ids(drawn), ids(C.svg(o, { size: 64 })), "the very same drawing");
        assert.ok(!/kc-a-/.test(drawn), "not animated in a list");
        assert.equal(C.pic(o, { size: 64 }), p, "made once, reused");
        assert.equal(C.picUrl(o, { size: 64 }), C.picUrl(JSON.parse(JSON.stringify(o)), { size: 64 }));
        assert.ok(!/"/.test(m[1]), "nothing can break out of src");
    });
    test("Social's lists (chat, friends, posts, hearts) show pictures; the live character only in an opened profile", () => {
        assert.match(social, /data-char-uid="\$\{escapeHtml\(uid\)\}" data-k="[^"]*">\$\{CharacterCore\.pic\(o, \{ size: 64 \}\)\}<\/span>`;/);
        assert.match(social, /if \(o && el\.dataset\.k !== k\) \{ el\.innerHTML = CharacterCore\.pic\(o, \{ size: 64 \}\); el\.dataset\.k = k; \}/);
        assert.doesNotMatch(social, /CharacterCore\.svg\([^)]*\{ size: 64 \}\)/, "no list draws the character into the page");
        assert.match(social, /av\.innerHTML = CharacterCore\.svg\(card\.outfit \|\| CharacterCore\.cleanOutfit\(\{\}, \[\]\), \{ size: 150, title: "Their character", animate: true \}\);/, "an opened profile: live and animated");
        assert.match(social, /\.kc-av svg, \.kc-av img \{ display: block; width: 100%; height: 100%; \}/);
    });
    test("the popup lock watches the popups, not every change on the page", () => {
        assert.doesNotMatch(social, /new MutationObserver\(check\)\.observe\(document\.body/);
        assert.match(social, /document\.querySelectorAll\("\.modal-overlay"\)\.forEach\(el => watch\.observe\(el, \{ attributes: true, attributeFilter: \["class", "style"\] \}\)\);/);
    });
});

describe("🪙 token packs: $1 / $2 / $3 / $5 / $10 (buy tokens, then turn them into ✨ if you like)", () => {
    const L = require("../api/_lib.js");
    test("the server's packs: bigger is better value; $10 = 1,000 🪙 = 10,000 ✨, enough for the 👘 set", () => {
        assert.deepEqual(L.TOKEN_PACKS, {
            small: { tokens: 70, cents: 100 }, medium: { tokens: 150, cents: 200 }, large: { tokens: 240, cents: 300 },
            big: { tokens: 450, cents: 500 }, mega: { tokens: 1000, cents: 1000 }
        });
        const perDollar = Object.values(L.TOKEN_PACKS).map(p => p.tokens / p.cents);
        assert.ok(perDollar.every((v, i) => !i || v > perDollar[i - 1]), "each bigger pack gives more per dollar");
        assert.ok(L.TOKEN_PACKS.mega.tokens * P.STARDUST.perToken >= P.SET_BY_ID.celestial.price);
        // the PayPal side: what's paid has to match the pack, to the cent
        assert.equal(L.packPrice(L.getPack("mega")), "10.00");
        assert.ok(L.amountMatchesPack({ currency_code: "USD", value: "5.00" }, L.getPack("big")));
        assert.ok(!L.amountMatchesPack({ currency_code: "USD", value: "4.99" }, L.getPack("big")));
        assert.deepEqual(L.parsePackCustomId(L.packCustomId("mega", "u1")), { packId: "mega", uid: "u1" });
        assert.equal(L.getPack("constructor"), null);
    });
    test("short of ✨ and 🪙 (the Store, the Wardrobe): it says where tokens come from — and that free ✨ is the daily login", () => {
        for (const f of ["store.html", "index.html"]) {
            const s = read(f);
            assert.match(s, /Your daily login gives free ✨ every day \(📅 Daily Quests\)/, f);
            assert.match(s, /🪙 Token packs[^`]*\(\$10 → 1,000 🪙 = 10,000 ✨\)/, f);
            assert.doesNotMatch(s, /free ✨ every day in the Store/, f);
        }
    });
    test("the Store's tiles say exactly what the server charges and gives", () => {
        const store = read("store.html");
        const page = eval("(" + store.match(/const TOKEN_PACKS = (\{[\s\S]*?\});/)[1] + ")");
        assert.deepEqual(Object.keys(page), Object.keys(L.TOKEN_PACKS));
        for (const [id, p] of Object.entries(L.TOKEN_PACKS)) {
            assert.deepEqual(page[id], { tokens: p.tokens, price: p.cents / 100 }, id);
            const tile = store.match(new RegExp(`data-pack="${id}"[^>]*>([\\s\\S]*?)</button>`))[1];
            assert.match(tile, new RegExp(`<span class="pack-tokens">${p.tokens.toLocaleString("en-US")}</span>[\\s\\S]*<span class="pack-price">\\$${p.cents / 100}</span>`), id + "'s tile");
        }
        assert.match(store, /data-pack="mega"[^>]*>\s*<span class="pack-ribbon">Best value<\/span>/);
        assert.equal((store.match(/<span class="pack-ribbon">/g) || []).length, 1, "one Best value");
    });
});

describe("👀 one profile card everywhere (profile-card.js): your Profile page, Home's and Social's popups", () => {
    const PCard = require("../profile-card.js");
    test("game stats: numbers three to a row, clan and server two to a row; only what's filled in", () => {
        const html = PCard.facts({ highestTrophies: 5120, currentLevel: 312, currentPower: 6700000, currentClan: " Dragon Warriors ", server: "android" });
        const facts = [...html.matchAll(/<div class="pf-fact( wide)?" title="[^"]*"><b>([^<]*)<\/b><small>([^<]*)<\/small><\/div>/g)].map(m => [!!m[1], m[2], m[3]]);
        assert.deepEqual(facts, [[false, "5,120", "🏆 Trophies"], [false, "Lv 312", "⭐ Level"], [false, "6.7M", "⚡ Power"], [true, "Dragon Warriors", "🛡️ Clan"], [true, "Android", "📱 Server"]]);
        assert.equal(PCard.facts({}), "", "nothing filled in: no boxes");
        assert.equal(PCard.facts({ highestTrophies: -5, currentLevel: "abc", server: "toString", currentClan: "   " }), "", "nonsense shows nothing");
        assert.equal(PCard.itemsText(1), "🎒 1 item"); assert.equal(PCard.itemsText(11), "🎒 11 items"); assert.equal(PCard.heartsText(1200), "💗 1,200 hearts");
    });
    test("what other players typed is shown, never run", () => {
        const html = PCard.facts({ currentClan: `<img src=x onerror="alert(1)">&"'` });
        assert.ok(!/<img/.test(html) && !/onerror="/.test(html), html);
        assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;&amp;&quot;&#39;/);
        // the bio goes in as text, everywhere
        const index = read("index.html"), social = read("social.html");
        assert.match(index, /bio\.textContent = String\(profile\.bio \|\| ""\)\.trim\(\);/);
        assert.match(index, /document\.getElementById\("viewProfileBioHome"\)\.textContent = String\(profile\.bio \|\| ""\)\.trim\(\);/);
        assert.match(social, /document\.getElementById\("friendProfileBio"\)\.textContent = String\(profile\.bio \|\| ""\)\.trim\(\);/);
    });
    test("all three draw the card with it, in the same order", () => {
        const index = read("index.html"), social = read("social.html");
        for (const [f, s] of [["index.html", index], ["social.html", social]]) assert.match(s, /<script src="profile-card\.js"><\/script>/, f);
        assert.match(index, /facts\.innerHTML = ProfileCard\.facts\(profile\);/);
        assert.match(index, /document\.getElementById\("viewProfileFactsHome"\)\.innerHTML = ProfileCard\.facts\(profile\);/);
        assert.match(social, /document\.getElementById\("friendProfileFacts"\)\.innerHTML = ProfileCard\.facts\(profile\);/);
        const order = (s, ids) => ids.map(id => s.indexOf(id)).every((v, i, a) => v > 0 && (!i || v > a[i - 1]));
        assert.ok(order(index, ['id="pfHeroAvatarWrap"', 'id="pfHeroLooks"', 'id="pfHeroName"', 'id="pfHeroStats"', 'id="pfHeroBadges"', 'id="pfHeroBio"', 'id="pfHeroFacts"']), "your page");
        assert.ok(order(index, ['id="viewProfileCharHome"', 'id="viewProfileLooksHome"', 'id="viewProfileNameHome"', 'id="viewProfileLikeHome"', 'id="viewProfileBadgesHome"', 'id="viewProfileBioHome"', 'id="viewProfileFactsHome"']), "Home's popup");
        assert.ok(order(social, ['id="friendProfileAvatar"', 'id="friendProfileLooks"', 'id="friendProfileName"', 'id="friendProfileLikeBtn"', 'id="friendProfileBadges"', 'id="friendProfileBio"', 'id="friendProfileFacts"']), "Social's popup");
    });
});

describe("🎁 a gift of something you already have pays ✨, like a chest duplicate — never 🪙", () => {
    let db;
    const inv = () => db._data.get("inventories/player1") || {};
    const wallet = () => (db._data.get("tokenWallets/player1") || {}).balance || 0;
    beforeEach(() => {
        db = memoryFirestore();
        db._data.set("users/player1", { name: "Ezra" });
        db._data.set("inventories/player1", { items: { crown: { at: 1 } }, stardust: 100 });
        db._data.set("tokenWallets/player1", { balance: 7 });
        state.db = db;
    });
    test("an admin's gift: the crown again → its ✨ refund; tokens untouched; logged", async () => {
        const refund = P.refundFor("crown", P.perksOf(["crown"]));
        const r = await call("tokens.js", { token: "admin-token", body: { action: "adminGrantItems", uid: "player1", itemIds: ["crown", "cap"], reason: "test" } });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.deepEqual([r.body.dupTokens, r.body.dupStardust, inv().stardust, wallet()], [0, refund, 100 + refund, 7]);
        assert.ok("cap" in inv().items);
        const log = db._docs("tokenAdjustments").find(x => x.mode === "grant");
        assert.deepEqual([log.amount, log.dupStardust], [0, refund]);
    });
    test("an inbox gift with an item you have: ✨ for it, and only the gift's own tokens", async () => {
        const refund = P.refundFor("crown", P.perksOf(["crown"]));
        db._data.set("tokenGifts/g1", { target: "player1", amount: 5, itemIds: ["crown"], expiresAt: Date.now() + 86400000, createdAt: Date.now() - 1000 });
        const r = await call("tokens.js", { token: "player-token", body: { action: "claimGift", giftId: "g1" } });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.deepEqual([r.body.claimed, r.body.dupStardust, wallet(), inv().stardust], [5, refund, 12, 100 + refund]);
    });
    test("every place that gives items uses it: inbox gifts, Secret Giveaway prizes, polls, admin", () => {
        const tokens = read("api/tokens.js"), polls = read("api/polls.js");
        assert.match(tokens, /if \(dupStardust > 0\) update\.stardust = Math\.max\(0, inv\.stardust \|\| 0\) \+ dupStardust;/);
        assert.match(tokens, /return \{ added, dups, dupTokens: 0, dupStardust \};/);
        assert.equal((tokens.match(/grantToInventory\(tx, db, /g) || []).length, 4, "the function + inbox gifts, Secret Giveaway prizes, admin");
        assert.match(polls, /grantToInventory\(tx, db, uid, invSnap/);
        assert.match(read("index.html"), /result\.dupStardust \? `\+\$\{result\.dupStardust\} ✨ for what you already had`/);
    });
});
