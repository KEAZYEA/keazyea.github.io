/* character-core.js — 🧍 your character: a big-headed figure you dress from
   head to toe with what you've collected. Shared by the pages
   (window.CharacterCore), the server (api/progress.js) and the tests.

   - Yours to pick, free: guy or girl, and skin. Everything else comes from
     drops: hair, eyes, mouth, glasses, hat, neck, top, bottom, shoes and
     what you hold. Everyone starts with a plain STARTER set (hair, eyes,
     mouth, top, bottom, shoes) so nobody is faceless; drops replace it.
   - One thing per slot. Hair, eyes, mouth, top, bottom and shoes are always
     filled (the starter one if nothing else); hat, glasses, neck and held
     can be empty.
   - Wearing is looks only: an item's perks count whether you wear it or not.
   - Drawn in code (an SVG): every worn thing is drawn to fit; only small
     things you hold are emoji. No picture files.

   To make a new item wearable, add it to WEAR with its slot and how it's
   drawn (`look`). Never rename an id: outfits store ids. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory(require("./progress-core.js"));
    else root.CharacterCore = factory(root.ProgressCore);
})(typeof self !== "undefined" ? self : this, function (P) {
    "use strict";

    /* ---------------- slots, head to toe ---------------- */
    const SLOTS = [
        { id: "bg", icon: "🖼️", name: "Background" },
        { id: "hair", icon: "💇", name: "Hair" },
        { id: "hat", icon: "🎩", name: "Hat" },
        { id: "eyes", icon: "👀", name: "Eyes" },
        { id: "glasses", icon: "👓", name: "Glasses" },
        { id: "mouth", icon: "👄", name: "Mouth" },
        { id: "neck", icon: "📿", name: "Neck" },
        { id: "top", icon: "👕", name: "Top" },
        { id: "bottom", icon: "👖", name: "Bottom" },
        { id: "shoes", icon: "👟", name: "Shoes" },
        { id: "held", icon: "✋", name: "Held" },
        { id: "pet", icon: "🐾", name: "Pet" }
    ];
    const SLOT_IDS = SLOTS.map(s => s.id);
    const OPTIONAL = ["hat", "glasses", "neck", "held", "pet"]; // the rest always show something

    /* ---------------- the free starter set ---------------- */
    const STARTER = {
        st_bg: { slot: "bg", icon: "🏞️", name: "Meadow" },
        st_hair: { slot: "hair", icon: "💇", name: "Starter Hair" },
        st_eyes: { slot: "eyes", icon: "👀", name: "Starter Eyes" },
        st_mouth: { slot: "mouth", icon: "🙂", name: "Starter Smile" },
        st_top: { slot: "top", icon: "👕", name: "Starter Tee" },
        st_bottom: { slot: "bottom", icon: "👖", name: "Starter Bottoms" },
        st_shoes: { slot: "shoes", icon: "👟", name: "Starter Shoes" }
    };
    const STARTER_FOR = Object.fromEntries(Object.entries(STARTER).map(([id, s]) => [s.slot, id]));

    /* ---------------- what each item looks like worn ---------------- */
    const WEAR = {
        // backgrounds: the free one, and the profile backgrounds you own
        st_bg: { slot: "bg", look: "meadow" }, g_stars: { slot: "bg", look: "stars" }, g_sakura: { slot: "bg", look: "sakura" },
        g_capy: { slot: "bg", look: "spa" }, g_galaxy: { slot: "bg", look: "galaxy" }, hg_haunted: { slot: "bg", look: "haunted" },
        // hair
        st_hair: { slot: "hair", look: "starter" }, hr_crop: { slot: "hair", look: "crop" }, hr_waves: { slot: "hair", look: "waves" },
        hr_spiky: { slot: "hair", look: "spiky" }, hr_twin: { slot: "hair", look: "twin" },
        // hats
        cap: { slot: "hat", look: "cap" }, crown: { slot: "hat", look: "crown" }, raffle: { slot: "hat", look: "tophat" }, clover: { slot: "hat", look: "hairpin" },
        a_laurel: { slot: "hat", look: "laurel" }, feather: { slot: "hat", look: "plume" },
        h_king: { slot: "hat", look: "pumpkin" }, ha_witch: { slot: "hat", look: "witch" },
        // eyes
        st_eyes: { slot: "eyes", look: "starter" }, mark: { slot: "eyes", look: "hunter" }, star: { slot: "eyes", look: "starry" },
        ey_sleepy: { slot: "eyes", look: "sleepy" }, ey_fierce: { slot: "eyes", look: "fierce" },
        // glasses
        spyglass: { slot: "glasses", look: "monocle" }, ledger: { slot: "glasses", look: "reading" }, dice: { slot: "glasses", look: "shades" }, a_joystick: { slot: "glasses", look: "visor" },
        // mouth
        st_mouth: { slot: "mouth", look: "starter" }, heart: { slot: "mouth", look: "heart" }, h_candy: { slot: "mouth", look: "lollipop" },
        mo_grin: { slot: "mouth", look: "grin" }, mo_fangs: { slot: "mouth", look: "fangs" },
        // neck
        amulet: { slot: "neck", look: "gem" }, beads: { slot: "neck", look: "beads" }, a_charm: { slot: "neck", look: "nazar" }, pin: { slot: "neck", look: "pin" },
        medal: { slot: "neck", look: "medal" }, key: { slot: "neck", look: "key" }, jackpot: { slot: "neck", look: "coin" },
        // tops
        st_top: { slot: "top", look: "tee" }, sh_jerkin: { slot: "top", look: "jerkin" }, sh_tabard: { slot: "top", look: "tabard" }, sh_robe: { slot: "top", look: "robe" },
        sh_plate: { slot: "top", look: "plate" }, sh_dragon: { slot: "top", look: "dragon" }, crate: { slot: "top", look: "apron" }, crest: { slot: "top", look: "cape" },
        ha_warlock: { slot: "top", look: "warlock" }, ha_knight: { slot: "top", look: "knight" },
        // bottoms
        st_bottom: { slot: "bottom", look: "starter" }, pa_linen: { slot: "bottom", look: "linen" }, pa_leather: { slot: "bottom", look: "breeches" },
        pa_chain: { slot: "bottom", look: "chain" }, pa_shadow: { slot: "bottom", look: "shadow" },
        // shoes
        st_shoes: { slot: "shoes", look: "sneakers" }, muddy: { slot: "shoes", look: "muddy" }, boots: { slot: "shoes", look: "swift" },
        // held (small things as emoji in your hand; a few drawn)
        gloves: { slot: "held", look: "bread" }, candle: { slot: "held", look: "lantern" }, compass: { slot: "held", look: "compass" }, quill: { slot: "held", look: "quill" },
        juice: { slot: "held", look: "juice" }, ticket: { slot: "held", look: "ticket" }, torch: { slot: "held", look: "torch" }, hourglass: { slot: "held", look: "hourglass" },
        pouch: { slot: "held", look: "pouch" }, trophy: { slot: "held", look: "trophy" }, scroll: { slot: "held", look: "scroll" }, blade: { slot: "held", look: "sword" },
        a_pass: { slot: "held", look: "pinwheel" }, h_broom: { slot: "held", look: "broom" },
        // pets, at your feet
        dragon: { slot: "pet", look: "dragon" }, h_cat: { slot: "pet", look: "cat" },
        // ✨ new drops
        ht_wizard: { slot: "hat", look: "wizard" }, ht_viking: { slot: "hat", look: "viking" }, ht_halo: { slot: "hat", look: "halo" },
        hr_silver: { slot: "hair", look: "silver" }, hr_flame: { slot: "hair", look: "flame" },
        ey_ice: { slot: "eyes", look: "ice" }, ey_dragon: { slot: "eyes", look: "dragon" },
        gl_aviator: { slot: "glasses", look: "aviator" }, mo_stache: { slot: "mouth", look: "stache" },
        nk_scarf: { slot: "neck", look: "scarf" }, nk_fang: { slot: "neck", look: "fang" },
        sh_hoodie: { slot: "top", look: "hoodie" }, sh_royal: { slot: "top", look: "royal" },
        sw_sandals: { slot: "shoes", look: "sandals" }, sw_wings: { slot: "shoes", look: "wings" },
        hd_staff: { slot: "held", look: "staff" }, hd_bow: { slot: "held", look: "bow" },
        pt_fox: { slot: "pet", look: "fox" }, pt_owl: { slot: "pet", look: "owl" }, pt_phoenix: { slot: "pet", look: "phoenix" },
        // 💗 the Heart Shop
        hs_band: { slot: "hat", look: "heartband" }, hs_shades: { slot: "glasses", look: "heartshades" }, hs_locket: { slot: "neck", look: "locket" },
        hs_letter: { slot: "held", look: "letter" }, hs_sweater: { slot: "top", look: "sweater" }, hs_rose: { slot: "held", look: "rose" }, hs_bunny: { slot: "pet", look: "bunny" },
        // 🌌 the Celestial Set (one set, bought together in the Store)
        cs_hair: { slot: "hair", look: "nebula" }, cs_eyes: { slot: "eyes", look: "starlit" }, cs_mouth: { slot: "mouth", look: "moon" },
        cs_neck: { slot: "neck", look: "comet" }, cs_top: { slot: "top", look: "stargazer" }, cs_bottom: { slot: "bottom", look: "nebula" }, cs_shoes: { slot: "shoes", look: "moonboots" },
        // ✨ / 💗 helpers from the chest
        hd_starpouch: { slot: "held", look: "starpouch" }, ht_beanie: { slot: "hat", look: "beanie" }, hd_cupid: { slot: "held", look: "cupidbow" }
    };
    // an object's own value (never one from its prototype)
    const own = (o, k) => (o && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
    const wearOf = (id) => own(WEAR, id) || null;
    // an item (or style, or starter piece) by id: { id, icon, name, rarity, … }
    const thingOf = (id) => {
        const st = own(STARTER, id);
        if (st) return { id, icon: st.icon, name: st.name, rarity: "common", starter: true };
        const x = P && P.BY_ID && own(P.BY_ID, id);
        return x ? x : null;
    };
    const isStarter = (id) => !!own(STARTER, id);
    // the things (of `ids`, plus the starter ones) that go in a slot
    const forSlot = (slot, ids) => {
        const list = (ids || []).filter(id => { const w = wearOf(id); return w && w.slot === slot && thingOf(id) && !isStarter(id); });
        return STARTER_FOR[slot] ? [STARTER_FOR[slot], ...list] : list;
    };
    const WEARABLE = Object.keys(WEAR);

    /* ---------------- your body (free) ---------------- */
    const BASE = {
        body: ["guy", "girl"],
        skin: ["#fbe0cc", "#f2c6a5", "#d9a07a", "#b97c54", "#8a5636", "#5e3824"]
    };
    const DEFAULT_BASE = { body: "guy", skin: 1 };
    const DEFAULT_WEAR = { ...STARTER_FOR };

    // An outfit made safe: a real body; only things you own (the starter set
    // is everyone's), one in each slot; the slots that always show
    // something get the starter piece if empty. owned: your item ids.
    function cleanOutfit(o, owned) {
        const src = o && typeof o === "object" ? o : {};
        const b = own(src, "base") && typeof src.base === "object" ? src.base : {};
        const body = own(b, "body"), skin = own(b, "skin");
        const base = {
            body: BASE.body.includes(body) ? body : DEFAULT_BASE.body,
            skin: Number.isInteger(skin) && skin >= 0 && skin < BASE.skin.length ? skin : DEFAULT_BASE.skin
        };
        const have = new Set([...(owned || []), ...Object.keys(STARTER)]);
        const w = own(src, "wear") && typeof src.wear === "object" ? src.wear : {};
        const wear = {};
        for (const slot of SLOT_IDS) {
            const id = own(w, slot);
            const spec = typeof id === "string" && have.has(id) ? wearOf(id) : null;
            if (spec && spec.slot === slot && thingOf(id)) wear[slot] = id;
            else if (STARTER_FOR[slot]) wear[slot] = STARTER_FOR[slot];
        }
        return { base, wear };
    }

    /* ---------------- looks: your saved outfits ----------------
       Everyone has LOOKS_FREE looks to dress up (more for tokens); one is
       worn — the one everyone sees. */
    const LOOKS_FREE = 3;
    const LOOK_PRICES = [1000, 2000, 4000]; // ✨ Stardust: your 4th, 5th, 6th look
    const LOOKS_MAX = LOOKS_FREE + LOOK_PRICES.length;
    const looksOf = (have) => Math.min(LOOKS_MAX, Math.max(LOOKS_FREE, Math.floor(Number(have) || LOOKS_FREE)));
    const lookPrice = (have) => { const n = looksOf(have); return n >= LOOKS_MAX ? null : LOOK_PRICES[n - LOOKS_FREE]; };
    // Your looks made safe: `slots` of them (the starter look where one's missing).
    function cleanLooks(list, owned, slots) {
        const src = Array.isArray(list) ? list : [];
        return Array.from({ length: looksOf(slots) }, (_, i) => cleanOutfit(src[i], owned));
    }
    // ✏️ A look's name: yours to pick (shown on your profile), short and
    // plain — no tags, no invisible characters, spaces tidied. "" means the
    // default ("Look 2").
    const LOOK_NAME_MAX = 16;
    // control characters, zero-width and direction marks, line separators, < and >
    const NAME_JUNK = new RegExp("[" + [[0, 31], [127, 159], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff]]
        .map(([a, b]) => String.fromCharCode(a) + "-" + String.fromCharCode(b)).join("") + "<>]", "g");
    function cleanLookName(s) {
        const plain = String(s == null ? "" : s).normalize("NFC").split(/[ ]+|[\t\n\r\f\v]+/).join(" ").replace(NAME_JUNK, "").trim();
        return Array.from(plain).slice(0, LOOK_NAME_MAX).join("").trim();
    }
    const lookName = (names, i) => (Array.isArray(names) && cleanLookName(names[i])) || `Look ${i + 1}`;
    // 🎲 A random look from what you own: a body, a skin, and something for each
    // slot (sometimes nothing in a slot that can be empty). r: () => [0, 1).
    function randomOutfit(owned, r) {
        const rnd = typeof r === "function" ? r : Math.random;
        const pick = (arr) => arr[Math.min(arr.length - 1, Math.floor(rnd() * arr.length))];
        const wear = {};
        for (const slot of SLOT_IDS) {
            const choices = forSlot(slot, owned);
            if (OPTIONAL.includes(slot)) { if (choices.length && rnd() < 0.7) wear[slot] = pick(choices); }
            else if (choices.length) wear[slot] = pick(choices);
        }
        return cleanOutfit({ base: { body: pick(BASE.body), skin: Math.floor(rnd() * BASE.skin.length) }, wear }, owned);
    }

    /* ---------------- drawing ----------------
       A 200 × 240 figure, front on, a big head on a small body: thick
       outlines, flat colours. */
    const L = "#2a1d3a";
    const EMOJI_FONT = "'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif";
    // soft, thin outlines: shapes are told apart by colour and shading, not heavy black lines
    const ol = (w) => `stroke="${L}" stroke-opacity=".32" stroke-width="${num((w || 3) * 0.55)}" stroke-linejoin="round" stroke-linecap="round"`;
    const num = (v) => Math.round(v * 10) / 10;
    function emoji(ch, x, y, size, rot) {
        const t = rot ? ` transform="rotate(${num(rot)} ${num(x)} ${num(y)})"` : "";
        return `<text x="${num(x)}" y="${num(y)}" font-size="${num(size)}" text-anchor="middle" dominant-baseline="central" font-family="${EMOJI_FONT}"${t}>${ch}</text>`;
    }
    function shade(hex, f) { // darker (f < 1) or lighter (f > 1)
        const n = parseInt(hex.slice(1), 16);
        const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.max(0, Math.min(255, Math.round(f < 1 ? v * f : v + (255 - v) * (f - 1)))));
        return "#" + c.map(v => v.toString(16).padStart(2, "0")).join("");
    }
    const path = (d, fill, w) => `<path d="${d}" fill="${fill}" ${ol(w)}/>`;
    // ❤ a heart (point down) round x, y; s: about half its width
    const heartD = (x, y, s) => `M${num(x)},${num(y + s * 0.9)} C${num(x - s * 1.25)},${num(y + s * 0.05)} ${num(x - s * 0.95)},${num(y - s * 0.95)} ${num(x)},${num(y - s * 0.4)} C${num(x + s * 0.95)},${num(y - s * 0.95)} ${num(x + s * 1.25)},${num(y + s * 0.05)} ${num(x)},${num(y + s * 0.9)} Z`;

    // the body's outline
    const BODY = {
        guy: { torso: "M70,120 Q100,112 130,120 L134,170 Q100,176 66,170 Z", long: "M70,120 Q100,112 130,120 L138,200 Q100,206 62,200 Z" },
        girl: { torso: "M75,120 Q100,114 125,120 L122,146 Q130,160 133,170 Q100,176 67,170 Q70,160 78,146 Z", long: "M75,120 Q100,114 125,120 L122,146 Q134,170 140,200 Q100,206 60,200 Q66,170 78,146 Z" }
    };
    const ARM_L = "M71,123 Q57,130 56,160 L69,162 Q71,141 78,132 Z", ARM_R = "M129,123 Q143,130 144,160 L131,162 Q129,141 122,132 Z";
    const LEG_L = "M80,168 L98,168 L97,202 L81,202 Z", LEG_R = "M102,168 L120,168 L119,202 L103,202 Z";

    /* -- hair: [behind the head, over the head] -- */
    function hairSvg(look, girl) {
        const H = {
            starter: girl
                ? ["#4a2e22", "M52,84 C48,40 76,30 100,30 C124,30 152,40 148,84 L152,134 Q140,140 132,130 L68,130 Q60,140 48,134 Z",
                    "M55,86 C53,44 76,33 100,33 C124,33 147,44 145,86 C141,64 129,55 116,57 C108,66 92,66 84,57 C70,59 59,70 55,86 Z"]
                : ["#3b2a20", null, "M55,82 C53,44 76,33 100,33 C124,33 147,44 145,82 C140,63 127,55 113,57 C104,63 88,61 80,56 C68,60 59,68 55,82 Z"],
            crop: ["#7a4a26", null, "M55,82 L53,62 L62,64 L59,47 L72,53 L76,36 L89,47 L97,30 L105,45 L117,33 L121,49 L133,41 L133,57 L144,55 L145,82 C137,64 123,57 100,58 C79,58 63,66 55,82 Z"],
            waves: ["#d9a441", "M50,86 C46,40 76,28 100,28 C124,28 154,40 150,86 L156,140 Q148,150 140,142 Q134,152 124,144 L76,144 Q66,152 60,142 Q52,150 44,140 Z",
                "M55,90 C52,44 76,32 100,32 C124,32 148,44 145,90 C141,62 126,52 104,56 C96,64 78,70 66,66 C61,72 57,80 55,90 Z"],
            spiky: ["#c0392b", null, "M55,84 L46,62 L60,64 L52,40 L70,50 L70,26 L86,42 L98,14 L108,40 L124,24 L126,48 L144,40 L138,62 L152,64 L145,84 C138,64 122,56 100,58 C79,58 62,66 55,84 Z"],
            twin: ["#e86fa6", "M50,92 C34,96 30,128 40,150 C48,138 54,120 58,104 Z M150,92 C166,96 170,128 160,150 C152,138 146,120 142,104 Z",
                "M55,86 C53,44 76,33 100,33 C124,33 147,44 145,86 C141,64 129,55 116,57 C108,66 92,66 84,57 C70,59 59,70 55,86 Z"]
        };
        H.silver = ["#d5dae4", "M110,40 C138,40 150,70 142,118 Q134,108 132,92 C132,70 126,52 112,46 Z",
            "M55,84 C53,44 76,33 100,33 C124,33 147,44 145,84 C141,62 128,52 108,54 C98,60 84,62 74,58 C64,64 58,72 55,84 Z"];
        H.nebula = ["#4b3a9c", "M50,86 C46,40 76,28 100,28 C124,28 154,40 150,86 L156,140 Q148,150 140,142 Q134,152 124,144 L76,144 Q66,152 60,142 Q52,150 44,140 Z",
            "M55,90 C52,44 76,32 100,32 C124,32 148,44 145,90 C141,62 126,52 104,56 C96,64 78,70 66,66 C61,72 57,80 55,90 Z"];
        H.flame = ["#e8542a", null, "M55,84 L48,60 L62,66 L56,38 L74,52 L76,22 L90,44 L100,10 L110,44 L124,22 L126,52 L144,38 L138,66 L152,60 L145,84 C138,64 122,56 100,58 C79,58 62,66 55,84 Z"];
        // 👦 a boy's cut of the long styles (girls keep them long), like the starter's
        if (!girl) {
            H.waves = [H.waves[0], "M52,84 C48,42 76,30 100,30 C124,30 152,42 148,84 L150,104 Q142,110 136,102 L64,102 Q58,110 50,104 Z",
                "M55,86 C52,44 76,32 100,32 C124,32 148,44 145,86 C142,70 136,60 126,58 C120,64 112,64 106,58 C98,64 88,64 82,58 C72,60 60,70 55,86 Z"];
            H.twin = [H.twin[0], null, "M55,82 C53,44 76,33 100,33 C124,33 147,44 145,82 C140,63 127,55 113,57 C104,63 88,61 80,56 C68,60 59,68 55,82 Z M74,30 a10,10 0 1,0 20,0 a10,10 0 1,0 -20,0 Z M106,30 a10,10 0 1,0 20,0 a10,10 0 1,0 -20,0 Z"];
            H.silver = [H.silver[0], "M134,56 C152,58 160,78 152,100 Q146,92 142,80 Z",
                "M55,84 C53,44 76,33 100,33 C124,33 147,44 145,84 C142,64 132,54 116,54 C104,60 86,62 72,58 C63,64 58,72 55,84 Z"];
            H.nebula = [H.nebula[0], null, "M54,86 C51,42 76,30 100,30 C124,30 149,42 146,86 C143,64 130,54 112,54 C104,62 86,64 70,60 C62,66 57,74 54,86 Z"];
        }
        const [c, back, front] = H[look] || H.starter;
        const flameTips = look === "flame" ? `<path${A("kc-a-flick")} d="M62,66 L58,46 L72,56 L76,32 L88,48 L100,22 L110,48 L122,32 L124,56 L140,46 L136,66 C126,58 112,54 100,56 C86,55 72,58 62,66 Z" fill="#ffc23a"/>` : "";
        const silverTie = look === "silver" ? `<circle cx="${girl ? 116 : 140}" cy="${girl ? 44 : 60}" r="5" fill="#7b4fd9" ${ol(2)}/>` : "";
        const nebulaStars = look === "nebula" ? `<path d="M118,48 C126,52 132,62 134,74" fill="none" stroke="#8fd8ff" stroke-width="3" stroke-linecap="round" opacity=".7"/>`
            + [[70, 52, 4], [128, 40, 3], [60, 72, 2.6]].map(([x, y, r]) => `<path d="M${x},${y - r * 1.6} L${x + r * 0.4},${y - r * 0.4} L${x + r * 1.6},${y} L${x + r * 0.4},${y + r * 0.4} L${x},${y + r * 1.6} L${x - r * 0.4},${y + r * 0.4} L${x - r * 1.6},${y} L${x - r * 0.4},${y - r * 0.4} Z" fill="#ffe27a"/>`).join("") : "";
        const ties = look !== "twin" ? "" : girl ? `<circle cx="54" cy="96" r="5" fill="#ffd166" ${ol(2)}/><circle cx="146" cy="96" r="5" fill="#ffd166" ${ol(2)}/>`
            : `<circle cx="88" cy="38" r="4" fill="#ffd166" ${ol(2)}/><circle cx="112" cy="38" r="4" fill="#ffd166" ${ol(2)}/>`;
        return [back ? path(back, shade(c, 0.85)) : "", path(front, c) + `<path d="M74,44 Q86,38 98,40" fill="none" stroke="${shade(c, 1.45)}" stroke-width="3" stroke-linecap="round" opacity=".55"/>` + flameTips + silverTie + ties + nebulaStars];
    }

    /* -- eyes: almond-shaped, a coloured iris with highlights, a heavy upper
       lid; girls get lashes at the outer corner -- */
    function eyesSvg(look, girl, skin) {
        const one = (x, s, o) => {
            // s: -1 the left eye, 1 the right (as you look); outer corner at x + 11s
            const X = (v) => x + s * v;
            const iris = o.iris || "#6b4423";
            const lidTop = o.lid || 0; // how far the lid comes down (sleepy)
            const almond = `M${X(-11)},89 Q${x},${77 + o.squint} ${X(11)},88 Q${x},${96 - o.squint * 0.4} ${X(-11)},89 Z`;
            let e = `<path d="${almond}" fill="#fff" stroke="${L}" stroke-width="1.6"/>`;
            e += o.star
                ? `<path d="M${x},${80.5} l2.4,5.2 5.6,.6 -4.2,3.8 1.2,5.6 -5,-2.9 -5,2.9 1.2,-5.6 -4.2,-3.8 5.6,-.6 z" fill="${iris}" stroke="${shade(iris, 0.6)}" stroke-width="1"/>`
                : `<circle cx="${X(-0.5)}" cy="87.6" r="5.8" fill="${iris}"/><circle cx="${X(-0.5)}" cy="87.6" r="5.8" fill="none" stroke="${shade(iris, 0.55)}" stroke-width="1.2"/>${o.slit ? `<ellipse cx="${X(-0.5)}" cy="87.6" rx="1.3" ry="5" fill="#140d1c"/>` : `<circle cx="${X(-0.5)}" cy="87.6" r="2.7" fill="#140d1c"/>`}`
                    + `<circle cx="${X(-0.5) + 2.2}" cy="85" r="1.9" fill="#fff"/><circle cx="${X(-0.5) - 1.8}" cy="90.2" r=".9" fill="#fff" opacity=".85"/>`;
            if (lidTop) e += `<path d="M${X(-12)},88 Q${x},${74} ${X(12)},87 L${X(12)},${80 + lidTop} Q${x},${78 + lidTop} ${X(-12)},${81 + lidTop} Z" fill="${skin}"/>`;
            // the upper lid line, thickest at the outer corner
            e += `<path d="M${X(-11.5)},${88 + (lidTop ? lidTop - 7 : 0)} Q${x},${(lidTop ? 79 + lidTop - 4 : 76.5) + o.squint} ${X(11.5)},${87 + (lidTop ? lidTop - 7 : 0)}" fill="none" stroke="${L}" stroke-width="3.2" stroke-linecap="round"/>`;
            if (girl) e += `<path d="M${X(11)},${86 + (lidTop ? lidTop - 7 : 0)} l${s * 4},-3.5 M${X(10)},${83.5 + (lidTop ? lidTop - 7 : 0)} l${s * 2.6},-4" stroke="${L}" stroke-width="2" stroke-linecap="round"/>`;
            // the brow: inner end lower when fierce
            const inner = o.brow || 0;
            e += `<path d="M${X(-10)},${72 + inner} Q${X(0)},${68 - inner * 0.3} ${X(11)},${71 - inner * 0.5}" fill="none" stroke="${L}" stroke-width="3" stroke-linecap="round"/>`;
            return e;
        };
        const kinds = {
            starter: { iris: "#6b4423", squint: 0 },
            ice: { iris: "#7fd8ff", squint: 0 },
            dragon: { iris: "#f2b705", squint: 2, brow: 3, slit: true },
            hunter: { iris: "#c0392b", squint: 3, brow: 3 },
            starry: { iris: "#ffcf3f", squint: 0, star: true },
            sleepy: { iris: "#5b6b8a", squint: 0, lid: 8 },
            fierce: { iris: "#5b3d8f", squint: 2.5, brow: 5 },
            starlit: { iris: "#3aa8ff", squint: 0 }
        };
        const k = kinds[look] || kinds.starter;
        let out = one(82, -1, k) + one(118, 1, k);
        if (look === "hunter") out += `<path d="M130,79 l1.6,-5 M130,79 l5,-1.6" stroke="#ff5a5a" stroke-width="1.8" stroke-linecap="round"/>`;
        if (look === "ice") out += `<path d="M70,80 l2,-3 2,3 -2,3 z M128,78 l2,-3 2,3 -2,3 z" fill="#dff6ff"/>`;
        if (look === "starlit") out += [[84.5, 85.5], [120.5, 85.5]].map(([x, y]) => `<path d="M${x},${y - 2.6} L${x + 0.7},${y - 0.7} L${x + 2.6},${y} L${x + 0.7},${y + 0.7} L${x},${y + 2.6} L${x - 0.7},${y + 0.7} L${x - 2.6},${y} L${x - 0.7},${y - 0.7} Z" fill="#fff"/>`).join("")
            + `<path d="M66,80 l1.6,-3 1.6,3 -1.6,3 z M133,78 l1.6,-3 1.6,3 -1.6,3 z" fill="#ffe27a"/>`;
        if (look === "sleepy") out += `<text x="140" y="68" font-size="12" font-weight="bold" fill="#9db4ff" font-family="sans-serif">z</text>`;
        return out;
    }

    /* -- glasses -- */
    function glassesSvg(look) {
        if (look === "monocle") return `<circle cx="118" cy="88" r="12.5" fill="#cfe9ff" fill-opacity=".25" stroke="#d4a017" stroke-width="3"/><path d="M129,96 Q137,112 129,126" fill="none" stroke="#d4a017" stroke-width="1.6" stroke-dasharray="2 2"/>`;
        if (look === "reading") return `<circle cx="82" cy="88" r="12.5" fill="#e8f4ff" fill-opacity=".2" stroke="#6b4423" stroke-width="3"/><circle cx="118" cy="88" r="12.5" fill="#e8f4ff" fill-opacity=".2" stroke="#6b4423" stroke-width="3"/><path d="M94.5,87 Q100,83 105.5,87 M69.5,86 L57,82 M130.5,86 L143,82" fill="none" stroke="#6b4423" stroke-width="3" stroke-linecap="round"/>`;
        if (look === "shades") return `<path d="M67,80 L97,80 L95,96 Q82,101 69,96 Z M103,80 L133,80 L131,96 Q118,101 105,96 Z" fill="#14121c" ${ol(2.4)}/><path d="M97,83 L103,83 M67,81 L56,79 M133,81 L144,79" stroke="${L}" stroke-width="3" stroke-linecap="round"/><path d="M73,85 L80,85 M109,85 L116,85" stroke="#fff" stroke-width="2" opacity=".55" stroke-linecap="round"/>`;
        if (look === "aviator") return `<path d="M66,82 Q82,79 96,82 Q97,94 88,98 Q72,100 68,92 Z M104,82 Q118,79 134,82 Q132,92 112,98 Q103,94 104,82 Z" fill="#3a2f22" fill-opacity=".85" stroke="#d4a017" stroke-width="2.4"/>`
            + `<path d="M96,83 Q100,80 104,83 M66,83 L56,80 M134,83 L144,80" fill="none" stroke="#d4a017" stroke-width="2.4" stroke-linecap="round"/><path d="M72,86 L80,85 M110,86 L118,85" stroke="#fff" stroke-width="2" opacity=".5" stroke-linecap="round"/>`;
        if (look === "heartshades") return [82, 118].map(x => `<path d="${heartD(x, 88, 13)}" fill="#ff4f8b" fill-opacity=".85" stroke="#c2185b" stroke-width="2.6" stroke-linejoin="round"/><path d="M${x - 8},84 Q${x - 6},80 ${x - 2},81" stroke="#fff" stroke-width="2" fill="none" opacity=".6" stroke-linecap="round"/>`).join("")
            + `<path d="M95,85 Q100,81 105,85 M68,84 L56,80 M132,84 L144,80" fill="none" stroke="#c2185b" stroke-width="2.6" stroke-linecap="round"/>`;
        if (look === "visor") return `<path d="M58,79 Q100,71 142,79 L140,97 Q100,105 60,97 Z" fill="#35d4ff" fill-opacity=".8" ${ol(2.6)}/><path d="M68,84 Q100,78 132,84" fill="none" stroke="#fff" stroke-width="2" opacity=".7" stroke-linecap="round"/><circle cx="66" cy="88" r="2.5" fill="#ff3df2"/>`;
        return "";
    }

    function mouthSvg(look, girl) {
        const lip = girl ? "#c2465a" : L;
        if (look === "heart") return `<path d="M100,110 C92,104 90,99 95,98 C98,97 100,100 100,101 C100,100 102,97 105,98 C110,99 108,104 100,110 Z" fill="#e0245e" ${ol(2)}/>`;
        // a lollipop: the sweet in your mouth, the stick poking out
        if (look === "lollipop") return `<path d="M104,108 L126,121" stroke="#f4f4f4" stroke-width="3.4" stroke-linecap="round"/><path d="M104,108 L126,121" stroke="${L}" stroke-opacity=".25" stroke-width="1" stroke-linecap="round"/>`
            + `<circle cx="101" cy="105" r="7.5" fill="#ff6fa8" ${ol(2.2)}/><path d="M101,105 m-3.5,0 a3.5,3.5 0 1,1 3.5,3.5 a2.2,2.2 0 1,1 -2.2,-2.2" fill="none" stroke="#fff" stroke-width="1.5"/>`
            + `<path d="M93,103 Q95,111 101,113 Q107,111 109,103" fill="none" stroke="${lip}" stroke-width="2.2" stroke-linecap="round"/><ellipse cx="121" cy="98" rx="6" ry="4" fill="#000" opacity=".06"/>`;
        if (look === "stache") return `<path d="M100,99 C94,96 86,96 82,102 C79,106 82,109 85,107 C88,103 94,104 100,103 C106,104 112,103 115,107 C118,109 121,106 118,102 C114,96 106,96 100,99 Z" fill="#5a3a22" ${ol(1.8)}/>`
            + `<path d="M95,108 Q100,111 105,108" fill="none" stroke="${lip}" stroke-width="2.2" stroke-linecap="round"/>`;
        if (look === "grin") return `<path d="M88,101 Q100,103 112,101 Q110,114 100,115 Q90,114 88,101 Z" fill="#7a1f2b" ${ol(2.4)}/><path d="M90,102 Q100,104 110,102 L109,106 Q100,107 91,106 Z" fill="#fff"/>`;
        if (look === "moon") return `<ellipse cx="78" cy="101" rx="7" ry="4" fill="#ff8fb8" opacity=".45"/><ellipse cx="122" cy="101" rx="7" ry="4" fill="#ff8fb8" opacity=".45"/>`
            + `<path d="M92,103 Q100,111 108,103" fill="none" stroke="${lip}" stroke-width="2.8" stroke-linecap="round"/><path d="M106,99 a3,3 0 1,0 3,-3 a2.2,2.2 0 1,1 -3,3" fill="#ffe27a"/>`;
        if (look === "fangs") return `<path d="M91,103 Q100,109 109,103" fill="none" stroke="${lip}" stroke-width="2.6" stroke-linecap="round"/><path d="M94,104.5 L95.5,109 L97,105.5 Z M103,105.5 L104.5,109 L106,104.5 Z" fill="#fff" stroke="${L}" stroke-width="1"/>`;
        return `<path d="M93,104 Q100,109 107,104" fill="none" stroke="${lip}" stroke-width="2.8" stroke-linecap="round"/>`;
    }

    /* -- hats -- */
    // top: how high the hair reaches (a halo floats above it)
    function hatSvg(look, top) {
        top = top || 33;
        if (look === "cap") return path("M58,68 C58,30 142,30 142,68 Z", "#5b7d3a") + `<path d="M56,68 Q100,58 144,68 Q100,82 56,68 Z" fill="#46622c" ${ol()}/><circle cx="100" cy="35" r="3.5" fill="#46622c" ${ol(2)}/><path d="M100,36 L100,66" stroke="${L}" stroke-width="1.6" opacity=".4"/><circle cx="100" cy="54" r="5" fill="#ffd54a" ${ol(2)}/>`;
        if (look === "crown") return path("M64,56 L68,28 L84,42 L100,20 L116,42 L132,28 L136,56 Q100,62 64,56 Z", "#f2c94c") + `<path d="M66,50 Q100,56 134,50" fill="none" stroke="#b8860b" stroke-width="2.5"/><circle cx="100" cy="44" r="4.5" fill="#e0245e" ${ol(1.8)}/><circle cx="80" cy="47" r="3.2" fill="#3a86ff" ${ol(1.6)}/><circle cx="120" cy="47" r="3.2" fill="#3a86ff" ${ol(1.6)}/>`;
        if (look === "tophat") return `<ellipse cx="100" cy="54" rx="46" ry="9" fill="#1d1a22" ${ol()}/>` + path("M72,54 L76,10 Q100,4 124,10 L128,54 Q100,60 72,54 Z", "#26222e") + `<path d="M74,44 Q100,50 126,44 L126,36 Q100,42 74,36 Z" fill="#b5172f" ${ol(2)}/><path d="M112,30 L126,26 L130,38 L116,42 Z" fill="#ffd54a" ${ol(1.8)}/>`;
        if (look === "hairpin") return `<path d="M126,64 L118,72" stroke="#2f7a2f" stroke-width="3" stroke-linecap="round"/>${[[126, 52], [136, 58], [128, 64], [118, 58]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5.5" fill="#3fbf5f" ${ol(2)}/>`).join("")}<circle cx="127" cy="58" r="2.4" fill="#ffd54a"/>`;
        if (look === "laurel") return [-1, 1].map(s => `<path d="M${100 + s * 4},38 Q${100 + s * 44},40 ${100 + s * 46},80" fill="none" stroke="#3d7a2a" stroke-width="3"/>` + [[16, 37], [28, 42], [38, 52], [44, 64]].map(([dx, y]) => `<ellipse cx="${100 + s * dx}" cy="${y}" rx="7" ry="3.6" transform="rotate(${s * (20 + dx)} ${100 + s * dx} ${y})" fill="#5fae3f" ${ol(1.6)}/>`).join("")).join("") + `<circle cx="100" cy="38" r="3.5" fill="#ffd54a" ${ol(1.6)}/>`;
        if (look === "plume") return `<g${A("kc-a-sway")}><path d="M118,44 C130,24 146,10 162,6 C150,18 142,32 128,46 Z" fill="#ff7a2f" ${ol(2.4)}/><path d="M124,40 C134,28 146,18 156,12" fill="none" stroke="#ffd54a" stroke-width="2"/></g>` + `<ellipse cx="100" cy="56" rx="54" ry="10" fill="#7a1f3d" ${ol()}/>` + path("M68,56 C68,26 132,26 132,56 Z", "#8e2547") + `<path d="M70,50 Q100,56 130,50" fill="none" stroke="#ffd54a" stroke-width="3"/>`;
        if (look === "horns") return [-1, 1].map(s => path(`M${100 + s * 30},50 C${100 + s * 44},40 ${100 + s * 46},22 ${100 + s * 38},10 C${100 + s * 36},26 ${100 + s * 30},36 ${100 + s * 20},44 Z`, "#8c1d1d") + `<path d="M${100 + s * 38},10 C${100 + s * 40},16 ${100 + s * 40},20 ${100 + s * 38},24" fill="none" stroke="#f2d0a4" stroke-width="3" stroke-linecap="round"/>`).join("");
        if (look === "cathood") return path("M46,94 C42,42 72,26 100,26 C128,26 158,42 154,94 C152,114 142,126 132,130 L132,92 C130,64 117,54 100,54 C83,54 70,64 68,92 L68,130 C58,126 48,114 46,94 Z", "#2a2533")
            + [-1, 1].map(s => path(`M${100 + s * 38},44 L${100 + s * 42},10 L${100 + s * 20},32 Z`, "#2a2533") + `<path d="M${100 + s * 36},38 L${100 + s * 39},18 L${100 + s * 26},32 Z" fill="#ff9ab8"/>`).join("");
        if (look === "witch") return `<ellipse cx="100" cy="54" rx="56" ry="10" fill="#241c30" ${ol()}/>` + path("M70,54 C80,34 92,14 112,2 C110,16 120,30 130,54 Q100,60 70,54 Z", "#2e2340")
            + `<path d="M72,46 Q100,52 128,46 L127,40 Q100,46 73,40 Z" fill="#7b4fd9" ${ol(1.8)}/>` + `<path d="M92,42 l10,0 M90,40 a2,2 0 1,0 0,4 M104,40 a2,2 0 1,1 0,4" stroke="#f4efe6" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
        if (look === "wizard") return `<ellipse cx="100" cy="54" rx="56" ry="10" fill="#22357a" ${ol()}/>` + path("M70,54 C76,36 90,16 118,-2 C114,14 122,32 130,54 Q100,60 70,54 Z", "#2d47a3")
            + `<path d="M72,47 Q100,53 128,47 L127,41 Q100,47 73,41 Z" fill="#ffd54a" ${ol(1.8)}/>`
            + `<path d="M98,26 l2,4 4.5,.6 -3.3,3 .9,4.4 -4.1,-2.2 -4.1,2.2 .9,-4.4 -3.3,-3 4.5,-.6 z M114,12 l1.2,2.5 2.7,.4 -2,1.8 .5,2.7 -2.4,-1.3 -2.4,1.3 .5,-2.7 -2,-1.8 2.7,-.4 z" fill="#ffd54a"/>`
            + `<circle cx="84" cy="34" r="2" fill="#bcd2ff"/>`;
        if (look === "viking") return path("M58,66 C58,30 142,30 142,66 Z", "#9aa3ad") + `<path d="M56,66 Q100,58 144,66 L144,72 Q100,64 56,72 Z" fill="#7a5a32" ${ol(2)}/>`
            + [70, 86, 100, 114, 130].map(x => `<circle cx="${x}" cy="${x === 100 ? 64 : 66}" r="1.8" fill="#d4a017"/>`).join("") + `<path d="M100,32 L100,64" stroke="#7d8691" stroke-width="3"/>`
            + [-1, 1].map(s => path(`M${100 + s * 40},52 C${100 + s * 56},48 ${100 + s * 62},30 ${100 + s * 58},16 C${100 + s * 54},28 ${100 + s * 48},38 ${100 + s * 38},42 Z`, "#efe3c8")).join("")
            + `<path d="M74,44 Q86,36 98,36" fill="none" stroke="#fff" stroke-width="2.4" opacity=".55" stroke-linecap="round"/>`;
        // 💕 a headband with two hearts bobbing on springs
        if (look === "heartband") return `<path d="M57,66 C60,34 140,34 143,66" fill="none" stroke="${L}" stroke-opacity=".35" stroke-width="7.5" stroke-linecap="round"/><path d="M57,66 C60,34 140,34 143,66" fill="none" stroke="#ff6fa8" stroke-width="5" stroke-linecap="round"/>`
            + [[-1, 0], [1, 0.5]].map(([s, d]) => `<g${A("kc-a-sway")}${ANIM && d ? ` style="animation-delay:${d}s"` : ""}><path d="M${100 + s * 18},42 q${s * -4},-5 0,-8 q${s * 4},-3 0,-8 q${s * -4},-3 0,-8" fill="none" stroke="#c0c4cc" stroke-width="1.8"/>`
                + path(heartD(100 + s * 18, 12, 8), "#ff3d7f", 2) + `<circle cx="${100 + s * 18 - 3}" cy="9" r="1.8" fill="#fff" opacity=".8"/></g>`).join("");
        // 💗 a knitted beanie with a heart and a pompom
        if (look === "beanie") return path("M58,68 C58,24 142,24 142,68 Z", "#ff7aa8") + `<path d="M56,66 Q100,58 144,66 L144,74 Q100,66 56,74 Z" fill="#e0457f" ${ol(2)}/>`
            + `<path d="M70,62 L70,40 M85,60 L85,32 M100,60 L100,30 M115,60 L115,32 M130,62 L130,40" stroke="#e0457f" stroke-width="1.6" opacity=".6"/>`
            + path(heartD(100, 48, 7), "#fff1f6", 1.6) + `<circle cx="100" cy="24" r="8" fill="#fff1f6" ${ol(2)}/>`;
        if (look === "halo") { const y = Math.min(22, top - 10); return `<ellipse cx="100" cy="${y}" rx="30" ry="8" fill="none" stroke="#fff6b0" stroke-width="9" opacity=".35"/><ellipse cx="100" cy="${y}" rx="30" ry="8" fill="none" stroke="#ffd54a" stroke-width="4.5"/><ellipse cx="100" cy="${y - 1}" rx="30" ry="8" fill="none" stroke="#fff6c9" stroke-width="1.4"/>`; }
        return "";
    }
    // the pumpkin replaces the whole head
    const PUMPKIN = `<ellipse cx="100" cy="80" rx="52" ry="46" fill="#ef7a26" ${ol()}/><path d="M78,40 Q66,80 78,122 M100,34 L100,126 M122,40 Q134,80 122,122" fill="none" stroke="#c85a12" stroke-width="3"/>`
        + `<path d="M96,36 Q94,24 102,18" fill="none" stroke="#3d7a2a" stroke-width="6" stroke-linecap="round"/><path d="M70,74 L84,60 L92,78 Z M108,78 L116,60 L130,74 Z" fill="#3a1d05"/>`
        + `<path d="M70,96 L78,104 L86,96 L94,106 L100,98 L106,106 L114,96 L122,104 L130,96 Q120,118 100,118 Q80,118 70,96 Z" fill="#3a1d05"/><path d="M74,70 L84,63 L88,74 Z M112,74 L116,63 L126,70 Z" fill="#ffcf40" opacity=".55"/>`;

    /* -- neck -- */
    function neckSvg(look) {
        const chain = (c) => `<path d="M84,121 Q100,140 116,121" fill="none" stroke="${c}" stroke-width="2.2"/>`;
        if (look === "gem") return chain("#d4a017") + `<path d="M100,129 L107,137 L100,147 L93,137 Z" fill="#3a86ff" ${ol(2)}/><path d="M97,134 L100,131 L103,134" stroke="#fff" stroke-width="1.4" fill="none" opacity=".8"/>`;
        if (look === "beads") return [[82, 122], [86, 129], [92, 134], [100, 136], [108, 134], [114, 129], [118, 122]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.6" fill="#a0522d" ${ol(1.6)}/>`).join("");
        if (look === "nazar") return chain("#c0c0c0") + `<circle cx="100" cy="138" r="7.5" fill="#1f5fbf" ${ol(2)}/><circle cx="100" cy="138" r="4.6" fill="#fff"/><circle cx="100" cy="138" r="2.6" fill="#7ec8ff"/><circle cx="100" cy="138" r="1.2" fill="${L}"/>`;
        // a red push-pin (📌) stuck in the top, on your left
        if (look === "pin") return `<path d="M86,143 L80,151" stroke="#9aa0a8" stroke-width="2" stroke-linecap="round"/>`
            + `<path d="M83,138 L91,146 L88,148 L81,141 Z" fill="#b5172f" ${ol(1.6)}/><circle cx="89" cy="136" r="6" fill="#e0245e" ${ol(1.8)}/><circle cx="87.5" cy="134.5" r="1.8" fill="#fff" opacity=".75"/>`;
        if (look === "medal") return `<path d="M90,120 L100,136 L110,120" fill="none" stroke="#c0392b" stroke-width="5"/><path d="M95,120 L100,130 L105,120" fill="none" stroke="#2f5fb3" stroke-width="3"/><circle cx="100" cy="142" r="8" fill="#f2c94c" ${ol(2.2)}/><path d="M100,137 l1.6,3.4 3.6,.4 -2.7,2.4 .8,3.6 -3.3,-1.9 -3.3,1.9 .8,-3.6 -2.7,-2.4 3.6,-.4 z" fill="#b8860b"/>`;
        if (look === "key") return chain("#d4a017") + `<circle cx="100" cy="134" r="5" fill="none" stroke="#d4a017" stroke-width="3"/><path d="M100,139 L100,152 M100,146 L105,146 M100,150 L104,150" stroke="#d4a017" stroke-width="3" stroke-linecap="round"/>`;
        if (look === "scarf") return path("M74,118 Q100,132 126,118 L128,126 Q100,142 72,126 Z", "#c0392b", 2.2) + path("M108,128 L116,128 L118,156 L108,156 Z", "#c0392b", 2)
            + `<path d="M80,122 L80,129 M90,126 L90,133 M100,128 L100,135 M110,126 L110,133 M120,122 L120,129 M108,140 L118,140 M108,148 L118,148" stroke="#8e1f17" stroke-width="1.6"/><path d="M108,156 L108,160 M111,156 L111,160 M114,156 L114,160 M117,156 L117,160" stroke="#c0392b" stroke-width="1.6"/>`;
        if (look === "fang") return `<path d="M84,121 Q100,138 116,121" fill="none" stroke="#6b4423" stroke-width="2"/>` + [-12, 12].map(dx => `<circle cx="${100 + dx * 0.9}" cy="${131 - Math.abs(dx) * 0.3}" r="2.2" fill="#c0392b" ${ol(1)}/>`).join("")
            + path("M95,133 Q100,131 105,133 Q103,146 100,152 Q97,146 95,133 Z", "#f4efe2", 2) + `<path d="M98,136 Q99,144 100,148" fill="none" stroke="#d8cfb8" stroke-width="1.4"/>`;
        if (look === "locket") return chain("#d4a017") + path(heartD(100, 139, 9), "#e0245e", 2.2) + `<path d="${heartD(100, 139, 5.5)}" fill="none" stroke="#ffd54a" stroke-width="1.4"/><circle cx="96.5" cy="136" r="1.6" fill="#fff" opacity=".8"/>`;
        if (look === "comet") return chain("#c9d3e6") + `<path d="M100,139 C90,136 82,128 78,120" fill="none" stroke="#8fd8ff" stroke-width="4" stroke-linecap="round" opacity=".55"/><path d="M100,139 C93,137 88,132 85,126" fill="none" stroke="#e6f6ff" stroke-width="2" stroke-linecap="round" opacity=".8"/>`
            + `<circle cx="100" cy="139" r="6.5" fill="#3aa8ff" ${ol(2)}/><circle cx="98" cy="137" r="2" fill="#fff" opacity=".85"/>`;
        if (look === "coin") return chain("#d4a017") + `<circle cx="100" cy="139" r="9" fill="#f2c94c" ${ol(2.2)}/><text x="100" y="139.5" font-size="11" font-weight="900" text-anchor="middle" dominant-baseline="central" fill="#c0392b" font-family="sans-serif">7</text>`;
        return "";
    }

    /* -- tops: [behind the body, the top itself] -- */
    function topSvg(look, girl) {
        const B = BODY[girl ? "girl" : "guy"];
        const sleeves = (c) => path(ARM_L, c) + path(ARM_R, c);
        const belt = (c) => `<path d="M${girl ? 70 : 67},160 Q100,166 ${girl ? 130 : 133},160" fill="none" stroke="${c}" stroke-width="5"/>`;
        const T = {
            tee: () => { const c = girl ? "#8e5bd9" : "#3d6db5"; return ["", sleeves(shade(c, 0.85)) + path(B.torso, c) + `<path d="M90,119 Q100,128 110,119" fill="none" stroke="${shade(c, 0.6)}" stroke-width="3"/>`]; },
            jerkin: () => ["", sleeves("#5a3a22") + path(B.torso, "#6b4a2f") + `<path d="M91,119 L100,168 L109,119 Z" fill="#e3d3ad" ${ol(2)}/><path d="M91,119 L84,138 L97,146 Z M109,119 L116,138 L103,146 Z" fill="#4a2f1c" ${ol(2)}/>` + belt("#2e1d10") + `<rect x="96" y="156" width="8" height="8" rx="1.5" fill="#d4a017" ${ol(1.6)}/>`],
            tabard: () => ["", sleeves("#9aa3ad") + path(B.torso, "#a8b0ba") + `<path d="M84,120 L116,120 L114,186 L100,194 L86,186 Z" fill="#2f5fb3" ${ol(2.4)}/>` + belt("#5a3a22") + path("M93,134 L107,134 L107,146 Q100,154 93,146 Z", "#f2c94c", 2) + `<path d="M100,137 L100,148 M96,141 L104,141" stroke="#b5172f" stroke-width="2.4"/>`],
            robe: () => ["", path(ARM_L.replace("56,160", "52,164"), "#2e2058") + path(ARM_R.replace("144,160", "148,164"), "#2e2058") + path(B.long, "#3b2a6b") + `<path d="M100,118 L100,203" stroke="#d4a017" stroke-width="3"/><path d="M90,119 L100,134 L110,119" fill="none" stroke="#d4a017" stroke-width="3"/>` + belt("#d4a017")],
            plate: () => ["", sleeves("#7d8896") + path(B.torso, "#9aa6b4") + `<path d="M78,128 Q100,122 122,128 L119,152 Q100,158 81,152 Z" fill="#b8c2ce" ${ol(2.2)}/><path d="M100,124 L100,156" stroke="#5a6574" stroke-width="2"/><path d="M84,132 Q92,129 96,132" stroke="#fff" stroke-width="2" fill="none" opacity=".6"/>` + belt("#4a5563")
                + `<ellipse cx="72" cy="126" rx="12" ry="8" fill="#b8c2ce" ${ol(2.2)}/><ellipse cx="128" cy="126" rx="12" ry="8" fill="#b8c2ce" ${ol(2.2)}/>`],
            dragon: () => ["", sleeves("#7a1f1f") + path(B.torso, "#a8322d") + `<g fill="none" stroke="#5c1414" stroke-width="1.6">${[130, 139, 148].map(y => [80, 90, 100, 110].map(x => `<path d="M${x},${y} q5,5 10,0"/>`).join("")).join("")}</g>` + belt("#3b0d0d")
                + `<path d="M60,128 L70,116 L84,124 L74,134 Z M140,128 L130,116 L116,124 L126,134 Z" fill="#c0392b" ${ol(2.2)}/><circle cx="100" cy="128" r="5" fill="#ffb02e" ${ol(1.8)}/>`],
            apron: () => ["", sleeves("#c9a87a") + path(B.torso, "#d8bb8e") + path(`M84,128 L116,128 L118,${girl ? 186 : 182} Q100,${girl ? 190 : 186} 82,${girl ? 186 : 182} Z`, "#f1ead8", 2.4) + `<path d="M84,128 L76,120 M116,128 L124,120" stroke="#8a6b3d" stroke-width="3"/><rect x="92" y="150" width="16" height="11" rx="2" fill="#e2d6b9" ${ol(1.8)}/>`],
            cape: () => [path("M66,122 L134,122 L148,198 Q100,206 52,198 Z", "#9b1c2e"), sleeves("#7a2e2e") + path(B.torso, "#c9c4b8") + `<path d="M86,121 L100,150 L114,121" fill="none" stroke="#9b1c2e" stroke-width="3"/>` + belt("#5a3a22") + `<circle cx="74" cy="124" r="5" fill="#f2c94c" ${ol(2)}/><circle cx="126" cy="124" r="5" fill="#f2c94c" ${ol(2)}/>`],
            warlock: () => [path("M58,120 L142,120 L150,204 Q100,212 50,204 Z", "#1d1530"), path(ARM_L.replace("56,160", "52,164"), "#2a1d45") + path(ARM_R.replace("144,160", "148,164"), "#2a1d45") + path(B.long, "#3a2468") + `<path d="M100,120 L100,203" stroke="#9b6bff" stroke-width="2.4"/>`
                + `<path d="M84,140 l4,-6 4,6 -4,6 z M108,160 l4,-6 4,6 -4,6 z M88,180 l4,-6 4,6 -4,6 z" fill="#c9a6ff" opacity=".9"/>` + belt("#9b6bff")],
            knight: () => ["", sleeves("#3a3f47") + path(B.torso, "#4a505a") + `<path d="M80,128 Q100,122 120,128 L117,152 Q100,158 83,152 Z" fill="#5c636e" ${ol(2.2)}/><circle cx="100" cy="139" r="7" fill="#e8e2d6" ${ol(1.8)}/><circle cx="97.5" cy="138" r="1.6" fill="${L}"/><circle cx="102.5" cy="138" r="1.6" fill="${L}"/><path d="M98,143 L102,143" stroke="${L}" stroke-width="1.4"/>`
                + belt("#2a2d33") + `<path d="M58,128 L70,114 L84,124 L72,136 Z M142,128 L130,114 L116,124 L128,136 Z" fill="#3a3f47" ${ol(2.2)}/>`]
        };
        // 🧶 a pink knit with a big heart, ribbed cuffs and hem
        T.sweater = () => ["", sleeves("#e86fa6") + path(B.torso, "#ff8fbf")
            + `<path d="M58,154 L70,156 M56,150 L69,152 M130,156 L142,154 M131,152 L144,150" stroke="#c94f88" stroke-width="2"/>`
            + `<path d="M${girl ? 69 : 67},164 Q100,170 ${girl ? 131 : 133},164" fill="none" stroke="#c94f88" stroke-width="5"/><path d="M${girl ? 69 : 67},164 Q100,170 ${girl ? 131 : 133},164" fill="none" stroke="#ffb3d4" stroke-width="1.4" stroke-dasharray="2 3"/>`
            + `<path d="M88,119 Q100,129 112,119" fill="none" stroke="#c94f88" stroke-width="4"/>`
            + path(heartD(100, 155, 10), "#e0245e", 2.2) + `<path d="M94,151 Q96,147.5 99,148.5" stroke="#fff" stroke-width="2" fill="none" opacity=".55" stroke-linecap="round"/>`
            + `<g fill="none" stroke="#ffb3d4" stroke-width="1.2" opacity=".7">${[132, 152].map(y => `<path d="M76,${y} l3,3 3,-3 M118,${y} l3,3 3,-3"/>`).join("")}</g>`];
        // 🌌 the Stargazer Coat: a midnight-blue jacket, gold trim, stars
        T.stargazer = () => ["", sleeves("#1b2658") + path(B.torso, "#22306b")
            + `<path d="M100,120 L100,${girl ? 165 : 167}" stroke="#ffd54a" stroke-width="2.4"/><path d="M88,119 L100,138 L112,119" fill="none" stroke="#ffd54a" stroke-width="3"/>`
            + `<path d="M56,156 L69,158 M131,158 L144,156" stroke="#ffd54a" stroke-width="2.4"/>`
            + [[82, 140, 3], [118, 134, 2.4], [86, 158, 2.4], [116, 152, 3]].map(([x, y, r]) => `<path d="M${x},${y - r * 1.6} L${x + r * 0.4},${y - r * 0.4} L${x + r * 1.6},${y} L${x + r * 0.4},${y + r * 0.4} L${x},${y + r * 1.6} L${x - r * 0.4},${y + r * 0.4} L${x - r * 1.6},${y} L${x - r * 0.4},${y - r * 0.4} Z" fill="#ffe27a"/>`).join("")
            + `<path d="M${girl ? 69 : 67},164 Q100,170 ${girl ? 131 : 133},164" fill="none" stroke="#ffd54a" stroke-width="3"/>`];
        T.hoodie = () => [path("M74,116 Q100,104 126,116 Q120,128 100,128 Q80,128 74,116 Z", "#7d8796"), sleeves("#8e98a6") + path(B.torso, "#9ba5b3")
            + `<path d="M88,120 L87,138 M112,120 L113,138" stroke="#f4f4f4" stroke-width="2" stroke-linecap="round"/><circle cx="87" cy="139" r="1.8" fill="#f4f4f4"/><circle cx="113" cy="139" r="1.8" fill="#f4f4f4"/>`
            + path(`M82,150 L118,150 L120,${girl ? 166 : 168} L80,${girl ? 166 : 168} Z`, "#8792a1", 1.8) + `<path d="M100,150 L100,168" stroke="#6f7987" stroke-width="1.4"/>`];
        T.royal = () => [path("M62,120 L138,120 L148,204 Q100,212 52,204 Z", "#8e1f2f"), path(ARM_L.replace("56,160", "52,164"), "#a3253a") + path(ARM_R.replace("144,160", "148,164"), "#a3253a") + path(B.long, "#b02a40")
            + `<path d="M100,124 L100,203" stroke="#ffd54a" stroke-width="3"/>` + belt("#ffd54a")
            + path("M70,118 Q100,132 130,118 L132,128 Q100,144 68,128 Z", "#f7f3ea", 2) + [78, 90, 100, 110, 122].map((x, i) => `<path d="M${x},${125 + (i % 2) * 3} l1.4,3 -1.4,1.6 -1.4,-1.6 z" fill="#2a1d3a"/>`).join("")
            + `<circle cx="100" cy="150" r="4" fill="#3a86ff" ${ol(1.6)}/>`];
        return (T[look] || T.tee)();
    }

    /* -- bottoms -- */
    function bottomSvg(look, girl, skin) {
        const legs = (c) => path(LEG_L, c) + path(LEG_R, c) + `<path d="${LEG_R}" fill="#000" opacity=".12"/>`;
        if (look === "starter" && girl) return legs(skin) + path("M72,166 L128,166 L137,192 Q100,198 63,192 Z", "#3d3a5a") + `<path d="M82,170 L78,192 M100,168 L100,195 M118,170 L122,192" stroke="#2a2840" stroke-width="2"/>`;
        if (look === "linen") return legs("#cbb994") + `<path d="M89,172 L89,200 M111,172 L111,200" stroke="#8a7a58" stroke-width="1.6"/><path d="M80,166 L120,166" stroke="#8a7a58" stroke-width="4"/>`;
        if (look === "breeches") return legs("#5a3a22") + `<path d="M81,186 L97,186 M103,186 L119,186" stroke="#2e1d10" stroke-width="5"/>`;
        if (look === "chain") return legs("#7d8691") + `<g fill="none" stroke="#5a6370" stroke-width="1.3">${[174, 182, 190].map(y => [82, 90, 104, 112].map(x => `<path d="M${x},${y} q3,4 6,0"/>`).join("")).join("")}</g>`;
        if (look === "nebula") return legs("#3a2a6b") + [[86, 176], [112, 184], [90, 194], [114, 196]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.4" fill="#ffe27a"/>`).join("") + `<path d="M81,170 L97,170 M103,170 L119,170" stroke="#8fd8ff" stroke-width="2.4" opacity=".7"/>`;
        if (look === "shadow") return legs("#1d1a2b") + path("M81,182 L97,182 L97,201 L81,201 Z", "#6b4bd9", 2) + path("M103,182 L119,182 L119,201 L103,201 Z", "#6b4bd9", 2) + `<path d="M84,188 L94,188 M106,188 L116,188" stroke="#c9b6ff" stroke-width="1.6"/>`;
        return legs("#34495e") + `<path d="M89,172 L89,200 M111,172 L111,200" stroke="#2a3a4c" stroke-width="1.6"/>`;
    }

    /* -- shoes: front on, toes towards you -- */
    function shoesSvg(look) {
        const foot = (x, c, toe) => path(`M${x - 13},207 Q${x - 13},197 ${x - 8},197 L${x + 8},197 Q${x + 13},197 ${x + 13},207 L${x + 13},212 Q${x},217 ${x - 13},212 Z`, c, 2.6)
            + `<path d="M${x - 12},211 Q${x},215 ${x + 12},211" fill="none" stroke="${toe}" stroke-width="3"/>`;
        const shaft = (x, c) => path(`M${x - 10},184 L${x + 10},184 L${x + 11},201 L${x - 11},201 Z`, c, 2.6);
        if (look === "muddy") return [88, 112].map(x => shaft(x, "#6b4423") + foot(x, "#5a3a22", "#2e1d10") + `<circle cx="${x - 5}" cy="${206}" r="2.6" fill="#3d2a14"/><circle cx="${x + 5}" cy="${191}" r="2" fill="#3d2a14"/>`).join("");
        if (look === "sandals") return [88, 112].map(x => path(`M${x - 12},208 Q${x - 12},199 ${x - 7},199 L${x + 7},199 Q${x + 12},199 ${x + 12},208 L${x + 12},212 Q${x},216 ${x - 12},212 Z`, "#e8b98a", 2.2)
            + `<path d="M${x - 12},210 Q${x},214.5 ${x + 12},210 L${x + 12},213 Q${x},217.5 ${x - 12},213 Z" fill="#7a4a26"/><path d="M${x - 9},201 L${x + 9},206 M${x + 9},201 L${x - 9},206" stroke="#7a4a26" stroke-width="2.6" stroke-linecap="round"/>`).join("");
        if (look === "wings") return [88, 112].map((x, i) => path(`M${x - 10},184 L${x + 10},184 L${x + 11},201 L${x - 11},201 Z`, "#f2c94c", 2.4)
            + path(`M${x - 13},207 Q${x - 13},197 ${x - 8},197 L${x + 8},197 Q${x + 13},197 ${x + 13},207 L${x + 13},212 Q${x},217 ${x - 13},212 Z`, "#e0b23a", 2.4)
            + `<g${A(i ? "kc-a-flapR" : "kc-a-flapL")}>` + path(i ? `M${x + 10},190 C${x + 20},182 ${x + 28},180 ${x + 30},186 C${x + 26},186 ${x + 24},190 ${x + 26},194 C${x + 20},194 ${x + 14},196 ${x + 10},196 Z` : `M${x - 10},190 C${x - 20},182 ${x - 28},180 ${x - 30},186 C${x - 26},186 ${x - 24},190 ${x - 26},194 C${x - 20},194 ${x - 14},196 ${x - 10},196 Z`, "#fff", 1.6) + "</g>").join("");
        if (look === "moonboots") return [88, 112].map(x => shaft(x, "#c9d3e6") + foot(x, "#e6edf7", "#3aa8ff") + `<path d="M${x - 9},190 L${x + 9},190" stroke="#3aa8ff" stroke-width="2.4"/><circle cx="${x}" cy="${197}" r="2" fill="#ffe27a"/>`).join("");
        if (look === "swift") return [88, 112].map((x, i) => shaft(x, "#2f5fb3") + foot(x, "#3a74d4", "#1d3f7a") + `<path d="M${x + (i ? 9 : -9)},188 l${i ? 8 : -8},-4 l${i ? -2 : 2},5 l${i ? 6 : -6},-1 l${i ? -6 : 6},5 Z" fill="#fff" ${ol(1.4)}/>`).join("");
        return [88, 112].map(x => foot(x, "#f2f2f2", "#9aa0a8") + `<path d="M${x - 5},200 L${x + 5},200" stroke="#9aa0a8" stroke-width="2"/>`).join("");
    }

    /* -- backgrounds: a scene behind you (flat shapes, no gradients — many
       characters share a page) -- */
    function bgSvg(look) {
        const box = (c) => `<rect x="0" y="0" width="200" height="240" fill="${c}"/>`;
        const hill = (y, c, bend) => `<path d="M0,${y} Q${60 + bend},${y - 22} 110,${y - 6} Q160,${y + 8} 200,${y - 14} L200,240 L0,240 Z" fill="${c}"/>`;
        const pines = (y, c, xs, h) => xs.map(x => `<path d="M${x},${y - h} L${x + h * 0.32},${y - h * 0.45} L${x + h * 0.2},${y - h * 0.45} L${x + h * 0.42},${y} L${x - h * 0.42},${y} L${x - h * 0.2},${y - h * 0.45} L${x - h * 0.32},${y - h * 0.45} Z" fill="${c}"/>`).join("");
        const cloud = (x, y, k) => `<g fill="#fff" opacity=".95"><ellipse cx="${x}" cy="${y}" rx="${16 * k}" ry="${7 * k}"/><circle cx="${x - 7 * k}" cy="${y - 4 * k}" r="${7 * k}"/><circle cx="${x + 5 * k}" cy="${y - 6 * k}" r="${9 * k}"/></g>`;
        const dots = (pts, c, r) => pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>`).join("");
        if (look === "stars") return box("#14214a") + dots([[18, 22], [52, 46], [170, 18], [146, 58], [30, 100], [184, 92], [92, 14], [120, 34], [12, 70]], "#fff", 1.4)
            + `<circle cx="160" cy="40" r="13" fill="#f4e7b0"/>` + pines(196, "#0e1834", [14, 40, 166, 190], 50) + hill(204, "#1b2c5a", 10) + hill(222, "#24386b", -20);
        if (look === "sakura") return box("#ffe3ee") + cloud(150, 40, 1) + hill(196, "#f7c0d3", 0) + hill(218, "#f2a9c3", -24)
            + `<path d="M-4,90 Q30,70 52,40 M22,72 Q34,56 30,34" fill="none" stroke="#7a4a2e" stroke-width="7" stroke-linecap="round"/>`
            + dots([[48, 34], [30, 28], [58, 48], [18, 60], [40, 60], [10, 44], [30, 46]], "#ff9ec4", 9) + dots([[150, 100], [174, 140], [128, 164], [176, 80]], "#ff9ec4", 3);
        if (look === "spa") return box("#bfe7e2") + cloud(46, 34, 0.9) + `<path d="M150,0 L150,150 M166,0 L166,140 M182,0 L182,150" stroke="#7fbf6a" stroke-width="5"/>`
            + `<path d="M0,176 Q100,164 200,176 L200,240 L0,240 Z" fill="#62c1c6"/><path d="M14,196 Q58,188 100,196 Q142,204 186,196" fill="none" stroke="#e8fbff" stroke-width="2.4" opacity=".7"/>`
            + [40, 100, 160].map(x => `<path d="M${x},166 q-8,-12 0,-24 q8,-12 0,-24" fill="none" stroke="#fff" stroke-width="3" opacity=".6" stroke-linecap="round"/>`).join("")
            + `<ellipse cx="14" cy="182" rx="18" ry="11" fill="#8f96a3"/><ellipse cx="190" cy="184" rx="16" ry="10" fill="#7f8693"/>`;
        if (look === "galaxy") return box("#1a0f33") + `<ellipse cx="100" cy="80" rx="94" ry="30" fill="#5a2a8a" opacity=".55" transform="rotate(-18 100 80)"/><ellipse cx="100" cy="80" rx="70" ry="16" fill="#b46bff" opacity=".35" transform="rotate(-18 100 80)"/>`
            + `<circle cx="164" cy="44" r="14" fill="#ff9f43"/><ellipse cx="164" cy="44" rx="24" ry="5" fill="none" stroke="#ffd54a" stroke-width="2.4" transform="rotate(-20 164 44)"/>`
            + dots([[20, 30], [40, 150], [180, 130], [70, 20], [130, 160], [12, 200]], "#fff", 1.4) + hill(214, "#2a1a4a", 0);
        if (look === "haunted") return box("#2a2145") + `<circle cx="150" cy="50" r="26" fill="#f4e7b0"/><circle cx="160" cy="44" r="5" fill="#e3d494"/>`
            + `<path d="M18,240 L24,150 L12,120 M24,150 L38,118 M24,172 L8,152" fill="none" stroke="#120e22" stroke-width="6" stroke-linecap="round"/>`
            + [[44, 40], [76, 60]].map(([x, y]) => `<path d="M${x},${y} q6,-6 10,0 q4,-6 10,0 q-10,4 -20,0 z" fill="#120e22"/>`).join("")
            + hill(206, "#1d1832", 0) + `<path d="M160,206 L160,190 Q168,182 176,190 L176,206 Z M60,214 L60,202 Q66,196 72,202 L72,214 Z" fill="#4a4560"/>`;
        // the free one: a sunny meadow
        return box("#7fd0f5") + cloud(40, 40, 1) + cloud(160, 28, 0.8) + pines(186, "#2f7d4a", [12, 34, 166, 188], 46) + pines(196, "#3a9157", [46, 152], 36)
            + hill(196, "#8fd16a", 20) + hill(218, "#73bd52", -30);
    }
    /* -- pets: sitting at your feet, on the left — two-tone shading, a
       light rim so they show on dark backgrounds -- */
    function petSvg(look) {
        const rim = (c) => `stroke="${c}" stroke-width="2" stroke-linejoin="round"`;
        const eye = (x, y, c) => `<ellipse cx="${x}" cy="${y}" rx="2.6" ry="3.3" fill="${c || "#1a1424"}"/><circle cx="${x + 0.9}" cy="${y - 1.1}" r="1" fill="#fff"/>`;
        // 🐈‍⬛ at your feet, tail swishing
        if (look === "cat") return `<g transform="matrix(-1 0 0 1 206 0)"><g${A("kc-a-tail")}><path d="M44,214 C62,214 66,198 58,188 C56,184 52,186 54,190 C58,198 52,206 44,206" fill="#2e2a3a" ${rim("#b9acdf")}/></g>`
            + `<path d="M20,216 C18,198 24,188 34,188 C44,188 50,198 48,216 Z" fill="#2e2a3a" ${rim("#b9acdf")}/><path d="M28,206 Q34,200 40,206 L38,216 L30,216 Z" fill="#454055"/>`
            + `<path d="M22,182 L23,166 L31,175 Q34,174 37,175 L45,166 L46,182 C46,192 22,192 22,182 Z" fill="#2e2a3a" ${rim("#b9acdf")}/>`
            + `<path d="M25,178 L25.6,170 L29.5,175 Z M43,178 L42.4,170 L38.5,175 Z" fill="#ff9ab8"/>` + `<ellipse cx="29" cy="181" rx="3" ry="3.8" fill="#ffd54a"/><ellipse cx="39" cy="181" rx="3" ry="3.8" fill="#ffd54a"/><ellipse cx="29" cy="181" rx=".9" ry="3" fill="#1a1424"/><ellipse cx="39" cy="181" rx=".9" ry="3" fill="#1a1424"/>`
            + `<path d="M32.6,185.6 L35.4,185.6 L34,187.2 Z" fill="#ff9ab8"/><path d="M34,187.2 Q32,189.5 30.5,188.5 M34,187.2 Q36,189.5 37.5,188.5" fill="none" stroke="#b9acdf" stroke-width=".9"/>`
            + `<path d="M22,185 L14,183 M22,187 L14,188 M46,185 L54,183 M46,187 L54,188" stroke="#b9acdf" stroke-width=".8"/></g>`;
        // 🦊 at your feet, bushy tail wagging
        if (look === "fox") return `<g transform="matrix(-1 0 0 1 206 0)"><g${A("kc-a-tail")}><path d="M44,214 C66,218 70,196 58,186 C62,198 56,206 44,206 Z" fill="#e8742a" ${rim("#8a3a10")}/><path d="M56,190 C62,196 62,204 58,208 C60,200 58,194 56,190 Z" fill="#fff6ea"/></g>`
            + `<path d="M20,216 C18,198 24,190 34,190 C44,190 50,198 48,216 Z" fill="#e8742a" ${rim("#8a3a10")}/><path d="M27,216 Q26,200 34,196 Q42,200 41,216 Z" fill="#fff6ea"/>`
            + `<path d="M20,172 L24,160 L30,170 L38,170 L44,160 L48,172 C50,182 40,192 34,192 C28,192 18,182 20,172 Z" fill="#e8742a" ${rim("#8a3a10")}/>`
            + `<path d="M22,176 C26,186 30,190 34,191 C38,190 42,186 46,176 C42,182 38,184 34,184 C30,184 26,182 22,176 Z" fill="#fff6ea"/><path d="M23.5,166 L25,163 L28,169 Z M44.5,166 L43,163 L40,169 Z" fill="#3a1d05"/>`
            + eye(29, 177) + eye(39, 177) + `<ellipse cx="34" cy="184.5" rx="2.2" ry="1.6" fill="#1a1424"/></g>`;
        // 🦉 perched on your other shoulder (clear of what you hold), eyes turned to you, bobbing
        if (look === "owl") return `<g${A("kc-a-bob")}><g transform="translate(4 -128) scale(1.2)">`
            + `<path d="M24,214 C20,198 24,186 34,186 C44,186 48,198 44,214 Z" fill="#8a5a33" ${rim("#4a2e14")}/><path d="M28,212 Q27,200 34,195 Q41,200 40,212 Z" fill="#d9b48a"/>`
            + `<path d="M24,190 L20,178 L29,185 M44,190 L48,178 L39,185" fill="#8a5a33" ${rim("#4a2e14")}/><path d="M22,200 C18,208 21,214 26,215 C25,208 25,203 25,198 Z M46,200 C50,208 47,214 42,215 C43,208 43,203 43,198 Z" fill="#6b4423"/>`
            + `<circle cx="29.5" cy="192" r="5" fill="#fff6e0" ${rim("#4a2e14")}/><circle cx="38.5" cy="192" r="5" fill="#fff6e0" ${rim("#4a2e14")}/>` + eye(31.2, 192, "#2a1d3a") + eye(40.2, 192, "#2a1d3a")
            + `<path d="M32.5,195 L35.5,195 L34,199 Z" fill="#f2a93b"/><path d="M28,215 l-2,3 M31,215 l0,3 M37,215 l0,3 M40,215 l2,3" stroke="#f2a93b" stroke-width="1.6" stroke-linecap="round"/></g></g>`;
        // 🐉 flying beside your head, wings flapping, shooting fireballs
        if (look === "dragon") {
            const fire = (d) => `<g${A("kc-a-fire")}${ANIM ? ` style="animation-delay:${d}s"` : ""}><circle cx="-27" cy="-1" r="5.5" fill="#ff7a2f"/><circle cx="-27" cy="-1" r="3" fill="#ffe066"/></g>`;
            return `<g${A("kc-a-bob")}><g transform="translate(160 54) rotate(25) scale(.9)">`
                + `<g${A("kc-a-wing")}><path d="M4,-4 C-2,-28 16,-34 26,-22 C18,-20 16,-14 12,-8 Z" fill="#c0392b" ${rim("#5c1414")}/></g>`
                + `<path d="M14,8 C24,12 30,22 26,30 L32,30 L26,36 L22,30 C26,24 20,16 10,12" fill="#e05a3a" ${rim("#5c1414")}/>`
                + `<ellipse cx="4" cy="5" rx="13" ry="10" fill="#e05a3a" ${rim("#5c1414")}/><ellipse cx="1" cy="9" rx="7" ry="5" fill="#ffc78a"/>`
                + `<path d="M-2,14 l-2,5 M6,14 l1,5" stroke="#5c1414" stroke-width="2.4" stroke-linecap="round"/>`
                + `<circle cx="-10" cy="-6" r="9" fill="#e05a3a" ${rim("#5c1414")}/><ellipse cx="-18" cy="-3" rx="6.5" ry="4.5" fill="#ef7a52" ${rim("#5c1414")}/>`
                + `<path d="M-8,-14 L-6,-24 L-2,-14 Z M-14,-13 L-16,-22 L-10,-14 Z" fill="#f2d0a4" ${rim("#5c1414")}/>`
                + `<ellipse cx="-11" cy="-8" rx="2.4" ry="3" fill="#1a1424"/><circle cx="-10.2" cy="-9" r=".9" fill="#fff"/><circle cx="-22" cy="-4" r=".9" fill="#5c1414"/>`
                + `<g${A("kc-a-wing")}><path d="M8,-2 C6,-30 26,-36 34,-20 C26,-18 22,-10 16,-4 Z" fill="#f2924a" ${rim("#5c1414")}/><path d="M12,-6 C14,-20 22,-26 28,-20" fill="none" stroke="#c0392b" stroke-width="1.4"/></g>`
                + (ANIM ? fire(0) + fire(0.8) : `<circle cx="-29" cy="-1" r="5.5" fill="#ff7a2f"/><circle cx="-29" cy="-1" r="3" fill="#ffe066"/>`)
                + `</g></g>`;
        }
        // 🐰 sitting by your other foot (facing you), hopping, a heart rising
        if (look === "bunny") return `<g${A("kc-a-bob")}>`
            + `<circle cx="22" cy="207" r="5" fill="#fff" ${rim("#b8a9c9")}/><ellipse cx="34" cy="206" rx="14" ry="11" fill="#fff" ${rim("#b8a9c9")}/>`
            + `<ellipse cx="44" cy="214" rx="6" ry="3" fill="#fff" ${rim("#b8a9c9")}/>`
            + `<path d="M37,180 C31,170 31,156 35,152 C40,154 41,168 41,178 Z M44,179 C44,168 48,156 53,156 C55,162 52,174 48,181 Z" fill="#fff" ${rim("#b8a9c9")}/>`
            + `<path d="M37,176 C34,168 34,160 36,157 C38,161 39,168 39,175 Z M46,177 C47,169 49,162 51,160 C51,165 50,172 47,178 Z" fill="#ffb3cf"/>`
            + `<circle cx="44" cy="188" r="10" fill="#fff" ${rim("#b8a9c9")}/>` + eye(47.5, 186.5, "#2a1d3a")
            + `<path d="M52.5,189.5 l2,-1.2 0,2.4 z" fill="#ff8fb8"/><ellipse cx="45" cy="192" rx="2.6" ry="1.6" fill="#ffc7da"/>`
            + `<path d="M53,191 L59,190 M53,192.5 L59,193" stroke="#b8a9c9" stroke-width=".8"/>`
            + `<g${A("kc-a-rise")}>` + path(heartD(58, 172, 4.5), "#ff3d7f", 1.4) + `</g></g>`;
        // 🔥🐦 flying beside your head, flames flickering
        if (look === "phoenix") return `<g${A("kc-a-bob")}><g transform="translate(164 58)">`
            + `<g${A("kc-a-flick")}><path d="M6,8 C20,16 34,30 30,44 C26,34 18,30 12,30 C20,38 20,48 14,54 C12,42 6,34 0,30 Z" fill="#ff7a2f" ${rim("#a3300f")}/><path d="M8,14 C18,22 24,32 22,40 C18,32 12,28 6,26 Z" fill="#ffd54a"/></g>`
            + `<g${A("kc-a-wing")}><path d="M2,-2 C-4,-30 14,-38 26,-26 C18,-22 14,-14 10,-6 Z" fill="#e8542a" ${rim("#a3300f")}/></g>`
            + `<ellipse cx="2" cy="6" rx="12" ry="9" fill="#e8542a" ${rim("#a3300f")}/><ellipse cx="0" cy="9" rx="6.5" ry="4.5" fill="#ffb02e"/>`
            + `<circle cx="-10" cy="-6" r="8.5" fill="#e8542a" ${rim("#a3300f")}/><path d="M-18,-6 L-26,-4 L-18,-2 Z" fill="#ffd54a" ${rim("#a3300f")}/>`
            + `<g${A("kc-a-flick")}><path d="M-12,-14 C-14,-24 -8,-30 -4,-32 C-6,-24 -2,-20 -4,-14 Z M-6,-13 C-4,-22 2,-24 4,-26 C2,-20 2,-16 0,-12 Z" fill="#ffd54a" ${rim("#a3300f")}/></g>`
            + `<ellipse cx="-11" cy="-7" rx="2.2" ry="2.8" fill="#1a1424"/><circle cx="-10.3" cy="-8" r=".8" fill="#fff"/>`
            + `<g${A("kc-a-wing")}><path d="M6,-2 C6,-32 26,-38 32,-22 C24,-20 20,-12 14,-4 Z" fill="#ff9f43" ${rim("#a3300f")}/></g>`
            + [[-2, 24, 0], [10, 34, 0.6], [20, 22, 1.2]].map(([x, y, d]) => `<circle cx="${x}" cy="${y}" r="1.8" fill="#ffd54a"${A("kc-a-rise")}${ANIM ? ` style="animation-delay:${d}s"` : ""}/>`).join("")
            + `</g></g>`;
        return "";
    }

    /* -- hands: an open one, or a fist holding something (drawn over it) -- */
    function handSvg(cx, skin, holding, mirror) {
        const x = (v) => mirror ? 200 - v : v; // drawn for the right hand (cx 138.5), mirrored for the left
        const crease = shade(skin, 0.62), dark = `fill="#000" opacity=".1"`;
        if (holding) return `<g class="kc-fist">`
            // the fingers, curled round what's held (knuckles on top)
            + `<path d="M${x(130)},158 Q${x(129.5)},153 ${x(133.5)},153 Q${x(136)},151.5 ${x(138.5)},153 Q${x(141)},151.5 ${x(143.5)},153 Q${x(148)},153 ${x(147.5)},158 L${x(147)},169 Q${x(146.5)},174.5 ${x(141)},174.5 L${x(135)},174.5 Q${x(130)},174.5 ${x(130)},169 Z" fill="${skin}" ${ol(2.2)}/>`
            + `<path d="M${x(143.5)},153 Q${x(148)},153 ${x(147.5)},158 L${x(147)},169 Q${x(146.5)},174.5 ${x(141)},174.5 Z" ${dark}/>`
            + `<path d="M${x(132)},161 Q${x(138.5)},162.6 ${x(146)},161 M${x(132)},165.5 Q${x(138.5)},167.1 ${x(146)},165.5 M${x(132)},170 Q${x(138.5)},171.4 ${x(146)},170" fill="none" stroke="${crease}" stroke-width="1.3" stroke-linecap="round"/>`
            // the thumb, wrapped over the front
            + `<path d="M${x(129)},161 Q${x(128.5)},154.5 ${x(134.5)},154.5 Q${x(141.5)},154.5 ${x(142.5)},157.5 Q${x(140.5)},160 ${x(136)},159.6 Q${x(132)},159.6 ${x(130.5)},163 Z" fill="${shade(skin, 1.05)}" ${ol(1.8)}/></g>`;
        // open, relaxed: the palm, fingers, and the thumb on the inside
        return `<g class="kc-hand"><path d="M${x(131)},154 Q${x(138.5)},150 ${x(146)},154 L${x(147)},166 Q${x(147)},173 ${x(142.5)},173.5 L${x(134.5)},173.5 Q${x(130)},173 ${x(130)},166 Z" fill="${skin}" ${ol(2.2)}/>`
            + `<path d="M${x(143)},154 Q${x(146)},154 ${x(147)},158 L${x(147)},166 Q${x(147)},173 ${x(142.5)},173.5 Z" ${dark}/>`
            + `<path d="M${x(135)},166 L${x(135)},172.5 M${x(138.8)},166.5 L${x(138.8)},173 M${x(142.6)},166 L${x(142.6)},172.5" stroke="${crease}" stroke-width="1.3" stroke-linecap="round"/>`
            + `<path d="M${x(131)},157 Q${x(126.5)},161 ${x(129)},166.5 Q${x(131)},167 ${x(131.5)},164" fill="${skin}" ${ol(1.8)}/></g>`;
    }

    /* -- held, in your right hand (on the right as you look) -- */
    /* Each held thing drawn around the grip (0,0) — the middle of the right
       fist — and the fist is drawn over it, so fingers wrap what's held:
       gripped (a shaft through the fist), hanging (by a handle or cord from
       the fist), or held by its middle, stem or bottom. */
    const HELD = {
        sword: () => path("M-2.6,-9 L2.6,-9 L2.6,11 L-2.6,11 Z", "#6b4423", 1.8) + `<circle cx="0" cy="13.5" r="3.4" fill="#d4a017" ${ol(1.8)}/>`
            + path("M-4.2,-12 L-4.2,-64 L0,-74 L4.2,-64 L4.2,-12 Z", "#dbe7f3", 2.2) + `<path d="M0,-15 L0,-64" stroke="#9fb3c8" stroke-width="1.6"/><path d="M-1.6,-26 l3,6 -3,1.4 3,7" fill="none" stroke="#3a86ff" stroke-width="1.6"/>`
            + path("M-13,-13 L13,-13 L12,-8 L-12,-8 Z", "#d4a017", 2),
        torch: () => path("M-3.2,26 L3.2,26 L3.2,-30 L-3.2,-30 Z", "#7a4a26", 1.8) + `<path d="M-3,18 L3,15 M-3,-16 L3,-19" stroke="#4a2e14" stroke-width="1.6"/>`
            + path("M-7.5,-30 L7.5,-30 L5.5,-39 L-5.5,-39 Z", "#5a5f6a", 1.8)
            + path("M0,-66 C11,-56 11,-45 0,-38 C-11,-45 -11,-56 0,-66 Z", "#ff7a2f", 1.8) + `<path d="M0,-56 C5,-50 5,-44 0,-41 C-5,-44 -5,-50 0,-56 Z" fill="#ffd54a"/>`,
        broom: () => `<path d="M-20,54 L14,-62" stroke="${L}" stroke-width="7.5" stroke-linecap="round"/><path d="M-20,54 L14,-62" stroke="#8a5a2b" stroke-width="4.5" stroke-linecap="round"/>`
            + path("M-32,50 L-10,58 L-16,76 Q-32,76 -40,64 Z", "#d9b44a", 2) + `<path d="M-30,58 L-34,70 M-24,60 L-26,74 M-18,62 L-20,75" stroke="#a0782a" stroke-width="1.4"/>`,
        pinwheel: () => `<path d="M0,22 L0,-40" stroke="${L}" stroke-width="5" stroke-linecap="round"/><path d="M0,22 L0,-40" stroke="#8a5a2b" stroke-width="2.6" stroke-linecap="round"/>`
            + `<g${A("kc-a-spin")}>` + ["#e0245e", "#3a86ff", "#ffd54a", "#3fbf5f"].map((c, i) => `<path d="M0,-44 l14,-4 -4,10 z" fill="${c}" ${ol(1.6)} transform="rotate(${i * 90} 0 -44)"/>`).join("") + `</g><circle cx="0" cy="-44" r="2.6" fill="#fff" ${ol(1.4)}/>`,
        quill: () => path("M0,-24 C-11,-34 -11,-54 -3,-68 C-1,-52 1,-38 0,-24 Z", "#eef3ff", 1.8) + path("M0,-24 C9,-36 10,-52 4,-64 C2,-48 0,-38 0,-24 Z", "#c9d8f0", 1.8)
            + `<path d="M0,-24 L-1,-64" stroke="#8fa3c4" stroke-width="1.2"/>` + path("M-1.6,10 L1.6,10 L2,-26 L-2,-26 Z", "#f4f1ea", 1.6) + path("M-1.6,10 L0,18 L1.6,10 Z", "#2a1d3a", 1.2),
        lantern: () => `<path d="M-7,1 Q0,-11 7,1" fill="none" stroke="#3a3f47" stroke-width="2.6"/>` + path("M-7,6 L7,6 L9.5,11 L-9.5,11 Z", "#3a3f47", 1.8)
            + path("M-8.5,11 L8.5,11 L8.5,31 L-8.5,31 Z", "#ffe7a1", 1.8) + `<circle cx="0" cy="21" r="7" fill="#fff4c9" opacity=".8"/><rect x="-2" y="20" width="4" height="9" fill="#fff" stroke="${L}" stroke-width="1"/><path d="M0,14 Q2.5,17 0,20 Q-2.5,17 0,14 Z" fill="#ff9f43"/>`
            + `<path d="M-3,11 L-3,31 M3,11 L3,31" stroke="#3a3f47" stroke-width="1.4"/>` + path("M-9.5,31 L9.5,31 L8,36 L-8,36 Z", "#3a3f47", 1.8),
        pouch: () => `<path d="M0,4 L0,13" stroke="#5a3a22" stroke-width="2"/>` + path("M-10,15 Q-15,33 0,35 Q15,33 10,15 Q0,10 -10,15 Z", "#8a5a2b", 2)
            + `<path d="M-9,16 Q0,20 9,16" fill="none" stroke="#d4a017" stroke-width="2.4"/><circle cx="-3" cy="13" r="3" fill="#f2c94c" ${ol(1.2)}/><circle cx="3.5" cy="12" r="3" fill="#f2c94c" ${ol(1.2)}/><text x="0" y="27" font-size="9" font-weight="900" text-anchor="middle" fill="#f2c94c" font-family="sans-serif">$</text>`,
        compass: () => `<path d="M0,4 L0,11" stroke="#d4a017" stroke-width="2" stroke-dasharray="2 1.5"/><circle cx="0" cy="12" r="2.2" fill="none" stroke="#d4a017" stroke-width="1.6"/>`
            + `<circle cx="0" cy="24" r="10.5" fill="#d4a017" ${ol(2)}/><circle cx="0" cy="24" r="8" fill="#fff8e6"/><path d="M0,17 L2.2,24 L-2.2,24 Z" fill="#e0245e"/><path d="M0,31 L2.2,24 L-2.2,24 Z" fill="#2f5fb3"/><circle cx="0" cy="24" r="1.3" fill="${L}"/>`,
        hourglass: () => path("M-11,-25 L11,-25 L11,-20 L-11,-20 Z", "#8a5a2b", 1.8) + path("M-11,20 L11,20 L11,25 L-11,25 Z", "#8a5a2b", 1.8)
            + `<path d="M-9,-20 L-9,20 M9,-20 L9,20" stroke="#6b4423" stroke-width="2.4"/>`
            + `<path d="M-7,-20 Q-7,-6 0,0 Q7,-6 7,-20 Z M-7,20 Q-7,6 0,0 Q7,6 7,20 Z" fill="#dff4ff" stroke="${L}" stroke-width="1.4" opacity=".95"/>`
            + `<path d="M-4.5,-13 Q0,-6 4.5,-13 Z" fill="#e8c26a"/><path d="M-6,20 Q0,11 6,20 Z" fill="#e8c26a"/><path d="M0,0 L0,14" stroke="#e8c26a" stroke-width="1"/>`,
        trophy: () => `<path d="M-12,-27 Q-21,-26 -15,-15 M12,-27 Q21,-26 15,-15" fill="none" stroke="#d4a017" stroke-width="3"/>`
            + path("M-12,-31 L12,-31 Q12,-13 0,-9 Q-12,-13 -12,-31 Z", "#f2c94c", 2) + `<path d="M-8,-28 Q-8,-17 -2,-13" fill="none" stroke="#fff" stroke-width="1.6" opacity=".6"/>`
            + path("M-2.2,-9 L2.2,-9 L2.2,9 L-2.2,9 Z", "#d4a017", 1.4) + path("M-9,9 L9,9 L10.5,16 L-10.5,16 Z", "#6b4423", 1.8),
        scroll: () => path("M-5.5,-24 L5.5,-24 L5.5,24 L-5.5,24 Z", "#f3e6c4", 1.8) + `<path d="M-2,-22 L-2,22" stroke="#d8c59a" stroke-width="2"/>`
            + `<ellipse cx="0" cy="-25.5" rx="7.5" ry="3" fill="#8a5a2b" ${ol(1.6)}/><ellipse cx="0" cy="25.5" rx="7.5" ry="3" fill="#8a5a2b" ${ol(1.6)}/><path d="M-5.5,14 L5.5,14" stroke="#c0392b" stroke-width="2.4"/>`,
        ticket: () => `<g transform="rotate(14)">` + path("M-7,-36 L7,-36 L7,-4 L-7,-4 Z", "#ffd54a", 1.8)
            + `<path d="M-7,-13 L7,-13" stroke="#b8860b" stroke-width="1.2" stroke-dasharray="2 1.5"/><path d="M-4,-31 L4,-31 M-4,-27 L4,-27 M-4,-23 L2,-23" stroke="#b8860b" stroke-width="1.4"/><circle cx="0" cy="-17" r="2" fill="#e0245e"/></g>`,
        juice: () => path("M-9,-30 L9,-30 L9,7 L-9,7 Z", "#6fc36b", 1.8) + path("M-9,-30 L-4,-34 L13,-34 L9,-30 Z", "#8fd88a", 1.4) + path("M9,-30 L13,-34 L13,3 L9,7 Z", "#4f9a4c", 1.4)
            + `<rect x="-6" y="-24" width="12" height="11" rx="2" fill="#fff" stroke="${L}" stroke-width="1"/><circle cx="0" cy="-18.5" r="3.4" fill="#ff9f43"/><path d="M5,-32 L5,-42 L10,-46" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><path d="M5,-32 L5,-42 L10,-46" fill="none" stroke="${L}" stroke-width=".8" stroke-linecap="round" opacity=".5"/>`,
        staff: () => `<path d="M0,40 L0,-62" stroke="${L}" stroke-opacity=".4" stroke-width="7" stroke-linecap="round"/><path d="M0,40 L0,-62" stroke="#7a4a26" stroke-width="5" stroke-linecap="round"/>`
            + `<path d="M0,-62 C-10,-66 -12,-78 -4,-84 M0,-62 C10,-66 12,-78 4,-84" fill="none" stroke="#7a4a26" stroke-width="3.4" stroke-linecap="round"/>`
            + `<circle cx="0" cy="-76" r="12" fill="#b46bff" opacity=".3"/><circle cx="0" cy="-76" r="7.5" fill="#c99bff" ${ol(1.8)}/><circle cx="-2.5" cy="-79" r="2.4" fill="#fff" opacity=".85"/>`,
        bow: () => `<path d="M-14,-46 C10,-32 10,32 -14,46" fill="none" stroke="#7a4a26" stroke-width="5" stroke-linecap="round"/><path d="M-14,-46 C10,-32 10,32 -14,46" fill="none" stroke="#c49a6c" stroke-width="1.6" stroke-linecap="round"/>`
            + `<path d="M-14,-46 L-14,46" stroke="#f4efe6" stroke-width="1.3"/><path d="M-16,0 L26,0" stroke="#8a5a2b" stroke-width="2.4"/><path d="M33,0 l-8,-4.5 0,9 z" fill="#9aa3ad" ${ol(1.2)}/><path d="M-15,0 l-4,-5 M-15,0 l-4,5 M-10,0 l-4,-5 M-10,0 l-4,5" stroke="#e0245e" stroke-width="2" stroke-linecap="round"/>`,
        // 💘 Cupid's Bow: a pink bow, a gold arrow with a heart for its tip
        cupidbow: () => `<path d="M-12,-38 C9,-25 9,25 -12,38" fill="none" stroke="#c2185b" stroke-width="5" stroke-linecap="round"/><path d="M-12,-38 C9,-25 9,25 -12,38" fill="none" stroke="#ff8fbf" stroke-width="1.8" stroke-linecap="round"/>`
            + `<path d="M-12,-38 L-12,38" stroke="#fff3f8" stroke-width="1.2"/><path d="M-15,0 L21,0" stroke="#e8b923" stroke-width="2.4"/>` + path(heartD(27, -4, 6), "#ff4f8b", 1.4)
            + `<path d="M-14,0 l-4,-5 M-14,0 l-4,5 M-9,0 l-4,-5 M-9,0 l-4,5" stroke="#ffb3d4" stroke-width="2" stroke-linecap="round"/>`,
        // 💌 a love letter, held by its corner, sealed with a heart
        letter: () => `<g transform="rotate(-12)">` + path("M-14,-26 L14,-26 L14,-4 L-14,-4 Z", "#fff6ea", 1.8) + `<path d="M-14,-26 L0,-14 L14,-26" fill="none" stroke="#d8c59a" stroke-width="1.6"/>`
            + `<path d="M-14,-4 L-3,-15 M14,-4 L3,-15" stroke="#e6d8b8" stroke-width="1.2"/>` + path(heartD(0, -14, 5), "#e0245e", 1.6) + `</g>`,
        // 🌹 a red rose, stem through the fist
        rose: () => `<path d="M0,16 C2,0 -2,-20 0,-36" fill="none" stroke="#2f7a2f" stroke-width="3.2" stroke-linecap="round"/>`
            + `<path d="M0,-12 C8,-18 14,-14 15,-10 C8,-8 4,-9 0,-12 Z M0,-22 C-8,-28 -14,-24 -14,-20 C-8,-18 -4,-19 0,-22 Z" fill="#3fbf5f" ${ol(1.4)}/>`
            + path("M-9,-40 C-12,-50 -6,-58 0,-56 C6,-58 12,-50 9,-40 C6,-34 -6,-34 -9,-40 Z", "#d81b4a", 1.8)
            + `<path d="M-4,-46 C-4,-52 4,-52 4,-47 C4,-43 -1,-42 -1,-46 M-7,-41 C-3,-38 3,-38 7,-41" fill="none" stroke="#8e0e2e" stroke-width="1.3" stroke-linecap="round"/>`
            + `<path d="M-2,-36 L-5,-33 M2,-36 L5,-33" stroke="#2f7a2f" stroke-width="2" stroke-linecap="round"/>`,
        // ✨ a little pouch of stardust, sparkling out of the top
        starpouch: () => `<path d="M0,4 L0,13" stroke="#5b3fa8" stroke-width="2"/>` + path("M-10,15 Q-15,33 0,35 Q15,33 10,15 Q0,10 -10,15 Z", "#6b4bd9", 2)
            + `<path d="M-9,16 Q0,20 9,16" fill="none" stroke="#ffd54a" stroke-width="2.4"/>`
            + `<path d="M0,22 l1.4,3.2 3.4,.4 -2.6,2.2 .8,3.4 -3,-1.8 -3,1.8 .8,-3.4 -2.6,-2.2 3.4,-.4 z" fill="#ffe27a"/>`
            + `<g${A("kc-a-rise")}><circle cx="-4" cy="8" r="1.6" fill="#ffe27a"/><circle cx="5" cy="6" r="1.2" fill="#8fd8ff"/></g>`,
        bread: () => `<g transform="rotate(-24)">` + `<ellipse cx="0" cy="-12" rx="7.5" ry="30" fill="#d9a05b" ${ol(2)}/><path d="M-4,-34 L3,-30 M-4,-22 L3,-18 M-4,-10 L3,-6 M-4,2 L3,6" stroke="#a8692e" stroke-width="2" stroke-linecap="round"/><path d="M-3,-36 Q-5,-14 -3,10" fill="none" stroke="#f0c98a" stroke-width="2" opacity=".7"/></g>`
    };
    // tall things lean out from the fist, away from your face (as you'd hold them)
    const TILT = { sword: 17, staff: 20, torch: 12, pinwheel: 12, quill: 14, rose: 12 };
    const gripAt = (look) => `translate(138.5 163.5)${TILT[look] ? ` rotate(${TILT[look]})` : ""}`;
    function heldSvg(id) {
        const w = wearOf(id);
        const draw = HELD[w.look];
        return draw ? `<g transform="${gripAt(w.look)}">${draw()}</g>` : "";
    }

    /* The figure as an SVG string. outfit: as cleanOutfit returns (cleaned
       again here without an owner check — pass a cleaned one). opts.size:
       its width in px; opts.title: alt text; opts.bust: just the head and
       shoulders (square — for small places: leaderboards, chat). */
    // where each covering hat's brim sits: hair above it is hidden
    const HAT_COVER = { cap: 64, tophat: 52, wizard: 50, witch: 50, viking: 62, plume: 52, crown: 44, beanie: 66 };
    // how high each hair reaches
    const HAIR_TOP = { starter: 33, crop: 30, waves: 28, spiky: 14, twin: 33, silver: 33, flame: 10, nebula: 28 };
    let drawn = 0;
    // Animations: only on the big pictures (opts.animate) — small cards in
    // lists stay still. A(cls) is the class while drawing an animated one.
    let ANIM = false;
    const A = (cls) => (ANIM ? ` class="${cls}"` : "");
    const ANIM_CSS = ".kc-a-tw{animation:kcTw 1.8s ease-in-out infinite;transform-box:fill-box;transform-origin:center}"
        + ".kc-a-pulse{animation:kcPulse 1.8s ease-in-out infinite}.kc-a-bob{animation:kcBob 2.4s ease-in-out infinite}"
        + ".kc-a-flapL{animation:kcFlapL .42s ease-in-out infinite alternate;transform-box:fill-box;transform-origin:100% 100%}"
        + ".kc-a-flapR{animation:kcFlapR .42s ease-in-out infinite alternate;transform-box:fill-box;transform-origin:0% 100%}"
        + ".kc-a-wing{animation:kcWing .36s ease-in-out infinite alternate;transform-box:fill-box;transform-origin:70% 100%}"
        + ".kc-a-flick{animation:kcFlick .28s ease-in-out infinite alternate;transform-box:fill-box;transform-origin:50% 100%}"
        + ".kc-a-sway{animation:kcSway 2.4s ease-in-out infinite;transform-box:fill-box;transform-origin:0% 100%}"
        + ".kc-a-spin{animation:kcSpin 1.6s linear infinite;transform-box:fill-box;transform-origin:center}"
        + ".kc-a-tail{animation:kcTail 1.4s ease-in-out infinite;transform-box:fill-box;transform-origin:0% 100%}"
        + ".kc-a-fire{animation:kcFire 1.6s ease-in infinite}.kc-a-rise{animation:kcRise 2.2s ease-out infinite}.kc-a-scan{animation:kcScan 1.5s linear infinite}"
        + "@keyframes kcTw{0%,100%{opacity:.15;transform:scale(.3) rotate(0)}50%{opacity:1;transform:scale(1) rotate(45deg)}}"
        + "@keyframes kcPulse{50%{opacity:.3}}@keyframes kcBob{50%{transform:translateY(-4px)}}"
        + "@keyframes kcFlapL{to{transform:rotate(18deg) scaleY(.7)}}@keyframes kcFlapR{to{transform:rotate(-18deg) scaleY(.7)}}"
        + "@keyframes kcWing{to{transform:scaleY(.5)}}@keyframes kcFlick{to{transform:scaleY(.8) scaleX(1.06)}}"
        + "@keyframes kcSway{50%{transform:rotate(-9deg)}}@keyframes kcSpin{to{transform:rotate(360deg)}}@keyframes kcTail{50%{transform:rotate(-16deg)}}"
        + "@keyframes kcFire{0%{transform:translate(0,0) scale(.5);opacity:0}12%{opacity:1}100%{transform:translate(-18px,-30px) scale(1.3);opacity:0}}"
        + "@keyframes kcRise{0%{transform:translateY(0);opacity:0}25%{opacity:1}100%{transform:translateY(-26px);opacity:0}}"
        + "@keyframes kcScan{0%{transform:translateY(-7px);opacity:0}25%{opacity:.9}100%{transform:translateY(9px);opacity:0}}"
        + "@media (prefers-reduced-motion: reduce){[class*=\"kc-a-\"]{animation:none!important}}";
    // a four-point sparkle (twinkles when animated); d: its delay
    const spark = (x, y, r, d, c) => `<path d="M${x},${y - r} L${x + r * 0.28},${y - r * 0.28} L${x + r},${y} L${x + r * 0.28},${y + r * 0.28} L${x},${y + r} L${x - r * 0.28},${y + r * 0.28} L${x - r},${y} L${x - r * 0.28},${y - r * 0.28} Z" fill="${c || "#fff6c9"}"${A("kc-a-tw")}${ANIM && d ? ` style="animation-delay:${d}s"` : ""}/>`;
    const glow = (x, y, r, c, o) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" opacity="${o || 0.35}"${A("kc-a-pulse")}/>`;
    // ✨ extra detail on epic and legendary things (on top of the figure)
    const FX = {
        laurel: () => spark(62, 50, 5, 0) + spark(138, 50, 5, 0.6) + spark(100, 34, 4, 1.1),
        pumpkin: () => `<path d="M70,74 L84,60 L92,78 Z M108,78 L116,60 L130,74 Z M70,96 L78,104 L86,96 L94,106 L100,98 L106,106 L114,96 L122,104 L130,96 Q120,118 100,118 Q80,118 70,96 Z" fill="#ffcf40" opacity=".5"${A("kc-a-pulse")}/>`,
        starry: () => glow(82, 88, 11, "#ffe066", 0.25) + glow(118, 88, 11, "#ffe066", 0.25) + spark(66, 76, 4, 0) + spark(134, 78, 4, 0.7) + spark(128, 100, 3, 1.3),
        coin: () => spark(105, 134, 4, 0) + `<circle cx="100" cy="139" r="11" fill="none" stroke="#ffe066" stroke-width="2" opacity=".5"${A("kc-a-pulse")}/>`,
        dragon: () => glow(100, 128, 9, "#ffb02e", 0.45) + [[80, 150, 0], [118, 146, 0.7], [96, 160, 1.4]].map(([x, y, d]) => `<circle cx="${x}" cy="${y}" r="1.8" fill="#ffb02e"${A("kc-a-rise")}${ANIM ? ` style="animation-delay:${d}s"` : ""}/>`).join(""),
        sword: () => `<g transform="${gripAt("sword")}"><path d="M0,-12 L0,-74" stroke="#7fc4ff" stroke-width="12" stroke-linecap="round" opacity=".22"${A("kc-a-pulse")}/>`
            + `<path d="M-6,-40 l5,-6 -3,-2 5,-7 M6,-58 l-4,5 3,2 -4,6" fill="none" stroke="#bfe3ff" stroke-width="1.6"${A("kc-a-pulse")}/></g>` + spark(170, 90, 4, 0.4, "#dff3ff"),
        halo: () => spark(70, 16, 4, 0) + spark(130, 14, 4, 0.8) + spark(100, 4, 3, 1.4),
        dragonEyes: () => glow(82, 88, 9, "#ff8a1f", 0.35) + glow(118, 88, 9, "#ff8a1f", 0.35),
        royal: () => [[86, 168], [114, 168], [86, 188], [114, 188]].map(([x, y]) => `<path d="M${x},${y - 5} l3,5 -3,5 -3,-5 z" fill="#ffd54a" opacity=".9"/>`).join("") + spark(100, 150, 4, 0.3) + spark(76, 132, 3, 1.1),
        phoenix: () => "",
        galaxy: () => spark(30, 40, 3, 0) + spark(150, 110, 3, 0.6) + spark(60, 150, 2.5, 1.2) + spark(176, 70, 3, 0.9),
        crown: () => spark(100, 30, 4, 0) + spark(80, 40, 3, 0.7) + spark(120, 40, 3, 1.3),
        witch: () => spark(118, 18, 3.5, 0, "#d9c4ff") + `<path d="M72,46 Q100,52 128,46 L127,40 Q100,46 73,40 Z" fill="#b98cff" opacity=".45"${A("kc-a-pulse")}/>`,
        visor: () => `<g${A("kc-a-scan")}><path d="M62,88 L138,88" stroke="#fff" stroke-width="2.4" opacity=".85"/></g>`,
        gem: () => spark(106, 132, 3.5, 0.2),
        nazar: () => glow(100, 138, 10, "#7ec8ff", 0.35),
        plate: () => `<path d="M84,132 Q92,128 100,131" stroke="#fff" stroke-width="3" fill="none" opacity=".75"${A("kc-a-pulse")}/>` + spark(120, 128, 3, 0.5),
        warlock: () => `<path d="M84,140 l4,-6 4,6 -4,6 z M108,160 l4,-6 4,6 -4,6 z M88,180 l4,-6 4,6 -4,6 z" fill="#e8d6ff"${A("kc-a-pulse")}/>` + glow(100, 165, 26, "#9b6bff", 0.12),
        knight: () => `<circle cx="97.5" cy="138" r="1.8" fill="#ff3b3b"${A("kc-a-pulse")}/><circle cx="102.5" cy="138" r="1.8" fill="#ff3b3b"${A("kc-a-pulse")}/>`,
        shadow: () => `<path d="M81,182 L97,182 L97,201 L81,201 Z M103,182 L119,182 L119,201 L103,201 Z" fill="#b48cff" opacity=".35"${A("kc-a-pulse")}/>`,
        ticket: () => spark(156, 128, 3.5, 0.3),
        trophy: () => spark(146, 128, 4, 0) + spark(130, 138, 3, 0.8),
        scroll: () => glow(138.5, 163.5, 16, "#ffe9a8", 0.18),
        viking: () => spark(54, 22, 3.5, 0) + spark(146, 22, 3.5, 0.7),
        stargazer: () => spark(82, 140, 3.6, 0) + spark(116, 152, 3.6, 0.7) + spark(100, 112, 3, 1.3, "#dff3ff"),
        sweater: () => [[78, 138, 0], [124, 150, 0.7], [110, 128, 1.4]].map(([x, y, d]) => `<path d="${heartD(x, y, 3)}" fill="#ff3d7f"${A("kc-a-rise")}${ANIM ? ` style="animation-delay:${d}s"` : ""}/>`).join(""),
        staff: () => `<g transform="${gripAt("staff")}">${glow(0, -76, 16, "#c99bff", 0.3)}${spark(-12, -90, 3, 0, "#f3e8ff")}${spark(13, -70, 3, 0.6, "#f3e8ff")}${spark(2, -98, 2.5, 1.1, "#f3e8ff")}</g>`
    };
    // which look each worn thing's ✨ comes from (by slot, its look)
    const FX_FOR = { hat: { laurel: "laurel", pumpkin: "pumpkin", halo: "halo", crown: "crown", witch: "witch", viking: "viking" },
        eyes: { starry: "starry", dragon: "dragonEyes" }, glasses: { visor: "visor" }, neck: { coin: "coin", gem: "gem", nazar: "nazar" },
        top: { dragon: "dragon", royal: "royal", plate: "plate", warlock: "warlock", knight: "knight", sweater: "sweater", stargazer: "stargazer" }, bottom: { shadow: "shadow" },
        held: { sword: "sword", ticket: "ticket", trophy: "trophy", scroll: "scroll", staff: "staff" }, bg: { galaxy: "galaxy" } };
    function svg(outfit, opts) {
        const o = opts || {};
        const src = outfit && typeof outfit === "object" ? outfit : {};
        const base = cleanOutfit({ base: own(src, "base") }, []).base;
        const w0 = own(src, "wear") && typeof src.wear === "object" ? src.wear : {};
        const wear = {};
        SLOT_IDS.forEach(s => {
            const id = own(w0, s), spec = wearOf(id);
            if (spec && spec.slot === s && thingOf(id)) wear[s] = id;
            else if (STARTER_FOR[s]) wear[s] = STARTER_FOR[s];
        });
        const look = (s) => wear[s] ? wearOf(wear[s]).look : null;
        const U = "kc" + (++drawn).toString(36) + "-"; // ids in this picture (many share a page)
        ANIM = !!o.animate;
        const girl = base.body === "girl", skin = BASE.skin[base.skin];
        const pumpkin = look("hat") === "pumpkin", hood = look("hat") === "cathood";
        const [hairBack, hairFront] = hairSvg(look("hair"), girl);
        const [topBack, topFront] = topSvg(look("top"), girl);
        // a thumbnail can ask for just one layer: the thing itself, no body
        // (a hat with no head, a shirt with no one in it); o.fx adds its ✨
        if (o.only) {
            ANIM = !!o.animate;
            const sl = o.only, lk = look(sl);
            const ONE = {
                bg: () => bgSvg(lk), pet: () => petSvg(lk), held: () => (wear.held ? heldSvg(wear.held) : ""),
                hair: () => hairBack + hairFront,
                hat: () => (!wear.hat ? "" : pumpkin ? PUMPKIN : hatSvg(lk, HAIR_TOP.starter)),
                eyes: () => eyesSvg(lk, girl, skin), glasses: () => (wear.glasses ? glassesSvg(lk) : ""),
                mouth: () => mouthSvg(lk, girl), neck: () => (wear.neck ? neckSvg(lk) : ""),
                top: () => topBack + topFront, bottom: () => bottomSvg(lk, girl, skin), shoes: () => shoesSvg(lk)
            };
            let one = own(ONE, sl) ? ONE[sl]() : "";
            const f = o.fx && one && FX_FOR[sl] && FX_FOR[sl][lk];
            if (f) one += FX[f]();
            const sz = Math.max(16, Math.min(600, Math.floor(Number(o.size) || 120)));
            return `<svg xmlns="http://www.w3.org/2000/svg" class="kih-char kih-thumb" viewBox="${o.box || "0 0 200 240"}" width="${sz}" height="${sz}" preserveAspectRatio="xMidYMid ${o.only === "bg" ? "slice" : "meet"}" aria-hidden="true">${one}</svg>`;
        }
        const p = [o.noBg ? "" : bgSvg(look("bg")), `<ellipse cx="100" cy="219" rx="38" ry="5" fill="#000" opacity=".22"/>`];
        // A hat that covers the top of the head hides the hair above its brim
        // (spikes go under a cap); a crown sits on the hair, so nothing pokes
        // above it. The rest (a hairpin, a laurel, a halo) leave hair alone.
        const cover = HAT_COVER[look("hat")];
        const hairClip = cover != null ? `<clipPath id="${U}h"><rect x="-20" y="${cover}" width="240" height="260"/></clipPath>` : "";
        const clipped = (svgPart) => cover != null && svgPart ? `<g clip-path="url(#${U}h)">${svgPart}</g>` : svgPart;
        p.push(hairClip);
        if (!pumpkin && !hood) p.push(clipped(hairBack));
        p.push(topBack);
        p.push(bottomSvg(look("bottom"), girl, skin));
        p.push(shoesSvg(look("shoes")));
        p.push(topFront);
        // the top's shaded side (clipped to its shape)
        const long = ["robe", "warlock", "royal"].includes(look("top")), B = BODY[girl ? "girl" : "guy"];
        p.push(`<clipPath id="${U}t"><path d="${long ? B.long : B.torso}"/></clipPath><rect x="104" y="100" width="50" height="110" fill="#000" opacity=".13" clip-path="url(#${U}t)"/>`);
        p.push(handSvg(62, skin, false, true));
        if (wear.neck) p.push(neckSvg(look("neck")));
        if (pumpkin) p.push(PUMPKIN);
        else {
            p.push(`<circle cx="55" cy="88" r="8" fill="${skin}" ${ol(2.6)}/><circle cx="145" cy="88" r="8" fill="${skin}" ${ol(2.6)}/>`,
                `<ellipse cx="100" cy="80" rx="46" ry="44" fill="${skin}" ${ol()}/>`,
                // a cel-shaded side
                `<path d="M118,40 C136,48 146,62 146,80 C146,104 128,122 100,124 C120,112 132,96 131,78 C130,62 125,50 118,40 Z" fill="${shade(skin, 0.86)}"/>`,
                `<path d="M98,96 Q100,98 102,96" fill="none" stroke="${shade(skin, 0.6)}" stroke-width="2" stroke-linecap="round"/>`,
                eyesSvg(look("eyes"), girl, skin), mouthSvg(look("mouth"), girl));
            if (!hood) p.push(clipped(hairFront));
            if (wear.glasses) p.push(glassesSvg(look("glasses")));
            if (wear.hat) p.push(hatSvg(look("hat"), HAIR_TOP[look("hair")]));
        }
        if (wear.held) p.push(heldSvg(wear.held));
        p.push(handSvg(138, skin, !!wear.held, false)); // over what it holds
        // ✨ epic and legendary things: glows, sparkles
        SLOT_IDS.forEach(sl => { const f = FX_FOR[sl] && FX_FOR[sl][look(sl)]; if (f && !(pumpkin && ["eyes", "glasses"].includes(sl))) p.push(FX[f]()); });
        if (wear.pet) p.push(petSvg(look("pet")));
        if (ANIM) p.unshift(`<style>${ANIM_CSS}</style>`);
        const size = Math.max(16, Math.min(600, Math.floor(Number(o.size) || 120)));
        const title = o.title ? `<title>${String(o.title).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))}</title>` : "";
        const box = o.box || (o.bust ? "40 14 120 120" : "0 0 200 240"), h = o.box || o.bust ? size : Math.round(size * 1.2);
        return `<svg xmlns="http://www.w3.org/2000/svg" class="kih-char${o.bust ? " kih-char-bust" : ""}" viewBox="${box}" width="${size}" height="${h}" role="img"${o.title ? "" : ` aria-hidden="true"`}>${title}${p.join("")}</svg>`;
    }

    /* A thing's picture, as it really looks worn: its part of a plain figure
       (a hat on a head, shoes on feet…), or just the thing (something held,
       a pet, a background). Square, `size` px. */
    const THUMB_BOX = { hair: "46 18 108 108", hat: "36 -8 128 128", eyes: "62 58 76 76", glasses: "54 48 92 92", mouth: "76 82 48 48", neck: "66 104 68 68",
        top: "28 98 144 144", bottom: "48 148 104 104", shoes: "58 172 84 84", held: "96 76 92 92", pet: "-4 148 80 80", bg: "0 0 200 240" };
    // where each pet is: the dragon and phoenix fly by your head on your right
    // (as you look), facing you; the cat and fox sit by your right foot; the
    // owl perches on your other shoulder, clear of what you hold
    const PET_BOX = { dragon: "116 14 84 84", phoenix: "122 22 90 90", owl: "16 79 58 58", cat: "134 156 64 64", fox: "134 156 64 64", bunny: "3 148 73 73" };
    // each held thing's middle and size, around the grip: [x, y, size]
    const HELD_BOX = { sword: [9, -28, 100], torch: [5, -20, 96], broom: [-13, 7, 146], pinwheel: [5, -19, 88], quill: [5, -25, 92], lantern: [0, 12, 54],
        pouch: [0, 20, 44], starpouch: [0, 18, 46], compass: [0, 20, 42], hourglass: [0, 0, 56], trophy: [0, -7, 52], scroll: [0, 0, 64], ticket: [4, -18, 46], juice: [2, -19, 58],
        bread: [-2, -13, 70], staff: [13, -24, 134], bow: [7, 0, 100], cupidbow: [7, 0, 92], letter: [-3, -15, 44], rose: [5, -20, 85] };
    // each thing drawn alone (no body): a square around it, by slot and look
    // (measured from the drawings; a new look needs its box here)
    const ITEM_BOX = {
        hair: { starter: "50.9 8.4 98.2 98.2", crop: "49 6 100 100", waves: "36.2 24 127.6 127.6", spiky: "42 -8 114 114", twin: "30.5 22 138.9 138.9", silver: "50.9 26.4 98.2 98.2", flame: "44 -9 112 112", nebula: "36.2 24 127.6 127.6" },
        hat: { cap: "52 5.3 96 96", crown: "60 -0.5 80 80", tophat: "50 -15 100 100", hairpin: "108.5 40.8 37 37", laurel: "45.7 0.7 108.6 108.6", plume: "42 -26 124 124", pumpkin: "42 14 116 116", witch: "40 -27 120 120", wizard: "40 -29 120 120", viking: "36.8 -19.2 126.4 126.4", halo: "62 -22.5 76 76", heartband: "53 -10.4 94 94", beanie: "52 -3 96 96" },
        eyes: { starter: "66.5 48.1 67 67", hunter: "66.5 44.9 72.5 72.5", starry: "58 44.4 84 84", sleepy: "66 32.1 85.2 85.2", fierce: "66.5 47.3 67 67", ice: "66 46.6 70 70", dragon: "66.5 49.5 67 67", starlit: "62 42.5 78.2 78.2" },
        glasses: { monocle: "90 71.5 58.5 58.5", reading: "53 41 94 94", shades: "52 40.8 96 96", visor: "54 42 92 92", aviator: "52 41.2 96 96", heartshades: "52 41.8 96 96" },
        mouth: { starter: "89 94.3 22 22", heart: "88.3 92.2 23.5 23.5", lollipop: "89 86.5 42 42", grin: "84 92 32 32", fangs: "87 93 26 26", stache: "76.8 80 46.5 46.5", moon: "67 68.5 66 66" },
        neck: { gem: "80 114 40 40", beads: "74.4 103.4 51.2 51.2", nazar: "80 114.5 40 40", pin: "73 126 29 29", medal: "81 116 38 38", key: "80 116.5 40 40", coin: "80 115.5 40 40", scarf: "68 107 64 64", fang: "80 116.5 40 40", locket: "80 114.1 40 40", comet: "74 109.8 46 46" },
        top: { tee: "52 96.5 96 96", jerkin: "52 96.5 96 96", tabard: "52 107 96 96", robe: "48 107.5 104 104", plate: "52 96.5 96 96", dragon: "52 96.5 96 96", apron: "52 102 96 96", cape: "48 107 104 104", warlock: "46 108 108 108", knight: "52 95.5 96 96", hoodie: "52 93.5 96 96", royal: "48 110 104 104", sweater: "52 96.5 96 96", stargazer: "52 96.5 96 96" },
        bottom: { starter: "76 161 48 48", linen: "76 160 48 48", breeches: "76 161 48 48", chain: "76 161 48 48", shadow: "76 161 48 48", nebula: "76 161 48 48" },
        shoes: { sneakers: "71 176.8 58 58", muddy: "71 170.3 58 58", swift: "63 162.3 74 74", sandals: "72 179.1 56 56", wings: "54 152.5 92 92", moonboots: "71 170.3 58 58" },
        held: { bread: "99.2 118.1 68.9 68.9", lantern: "114 154.5 49 49", compass: "119.3 163.5 38.5 38.5", quill: "96.4 91.4 95.4 95.4", juice: "110 113.5 61 61", ticket: "123.7 120.5 44.8 44.8", torch: "91.9 93.2 101.4 101.4", hourglass: "109.5 134.5 58 58", pouch: "119 163.5 39 39", trophy: "106.7 120 63.5 63.5", scroll: "106 131 65 65", sword: "94.8 82 105.5 105.5", pinwheel: "96.2 99.9 92.1 92.1", broom: "52.5 97.5 146 146", staff: "75.9 59.6 149.6 149.6", bow: "95.5 113.5 100 100", letter: "115.4 128.8 40 40", rose: "100.8 101.5 84.8 84.8", starpouch: "119 160 42 42", cupidbow: "103.5 121.5 84 84" }
    };
    // An item on its own, as you'd see it in a shop: just the thing (a hat
    // with no head under it), with its ✨. Square, `size` px.
    /* 🖼 A character as a picture: an <img> of the very same drawing. One
       element instead of hundreds, so a long list of players (Social's chat,
       friends, posts) stays smooth; each look is made once and reused. Never
       animated — a profile draws the live one (svg) when it's opened. */
    const PIC_MEMO = new Map();
    function picUrl(outfit, opts) {
        const o = { ...(opts || {}) };
        delete o.animate;
        const k = JSON.stringify([outfit || null, o]);
        let u = PIC_MEMO.get(k);
        if (u === undefined) {
            u = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg(outfit, o));
            if (PIC_MEMO.size >= 500) PIC_MEMO.delete(PIC_MEMO.keys().next().value);
            PIC_MEMO.set(k, u);
        }
        return u;
    }
    function pic(outfit, opts) {
        const size = Math.max(8, Math.floor(Number(opts && opts.size) || 48));
        return `<img class="kih-char-pic" src="${picUrl(outfit, opts)}" width="${size}" height="${Math.round(size * 1.2)}" alt="" decoding="async" draggable="false">`;
    }
    // `body` ("guy"/"girl", optional): drawn for that body — the long hairs have a boy's cut.
    const baseFor = (body) => (body === "girl" || body === "guy" ? { ...DEFAULT_BASE, body } : DEFAULT_BASE);
    function itemPic(id, size, body) {
        const w = wearOf(id);
        if (!w || !thingOf(id)) return "";
        if (w.slot === "pet" || w.slot === "bg") return thumb(id, size);
        const boxes = own(ITEM_BOX, w.slot), box = (boxes && own(boxes, w.look)) || THUMB_BOX[w.slot];
        return svg({ base: baseFor(body), wear: { [w.slot]: id } }, { size: size || 48, box, only: w.slot, fx: true });
    }
    function thumb(id, size, body) {
        const w = wearOf(id);
        if (!w || !thingOf(id)) return "";
        const only = ["held", "pet", "bg"].includes(w.slot) ? w.slot : null;
        let box = (w.slot === "pet" && PET_BOX[w.look]) || THUMB_BOX[w.slot];
        const hb = w.slot === "held" && HELD_BOX[w.look];
        if (hb) box = `${num(138.5 + hb[0] - hb[2] / 2)} ${num(163.5 + hb[1] - hb[2] / 2)} ${hb[2]} ${hb[2]}`;
        return svg({ base: baseFor(body), wear: { [w.slot]: id } }, { size: size || 48, box, only, noBg: true });
    }

    return { SLOTS, SLOT_IDS, OPTIONAL, STARTER, WEAR, WEARABLE, wearOf, thingOf, isStarter, forSlot, BASE, DEFAULT_BASE, DEFAULT_WEAR, cleanOutfit, svg, pic, picUrl, thumb, itemPic, LOOKS_FREE, LOOK_PRICES, LOOKS_MAX, looksOf, lookPrice, cleanLooks, randomOutfit, LOOK_NAME_MAX, cleanLookName, lookName };
});
