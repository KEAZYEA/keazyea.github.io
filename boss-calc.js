/* boss-calc.js — 🐉 the Bosses tab of Troops & Heroes.

   Every Glorious Hunt boss at the level you choose (1–300), with the game's
   own numbers: each attack's damage, hits, area and cooldown, how many
   spiders Ashira summons and their stats, how many units Dagon swallows,
   Shai-Khold's Ice Guardians, the damage the "resistance" passives take
   off, and how much damage it takes to push the boss to that level.

   Where the numbers come from:
   - data/bosses.json — the bosses' rows from the game files (levels 1–300),
     kept by tools/build-boss-data.js (the big game files have them taken out
     to keep Troops & Heroes fast: tools/strip-boss-data.js);
   - troopsLevel.json — Ashira's spiders, which are ordinary troop rows;
   - localization.json + en.json — names and descriptions (the ⓘ);
   - unitParameterModifierNested.json — Chitin Carapace's reflect and
     Quicksand's miss / slow.
   Pictures: images/<img>.jpg (Goltharax shares Balthazar's — the same dragon).

   Shared by the page (window.BossCalc, which also draws the tab) and the tests. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.BossCalc = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    // name/desc: localization keys (or { text } for one the game doesn't name);
    // data: the ability in data/bosses.json; show: how its numbers read.
    const basic = (data) => ({ kind: "attack", name: { text: "Basic attack" }, desc: { text: "Its normal attack, used between abilities." }, data, show: "multi" });
    // icon: the skill's picture, images/<icon>.jpg — named after the game's own
    // icon (resource.json "BossAbilitiesIcons/…"); one not added yet just isn't shown.
    const act = (n, d, data, show, icon, extra) => ({ kind: "attack", name: n, desc: d, data, show, icon, ...(extra || {}) });
    const pas = (n, d, data, show, icon, extra) => ({ kind: "passive", name: n, desc: d, data, show, icon, ...(extra || {}) });
    const dragon = (id, descPrefix, sameAs) => [
        basic(`${id}_defaultAoe`),
        act("boss_dragon_ability1_name", `${descPrefix}ability1_description`, `${id}_piercingFire`, "hit", "BOSSDRAGON_PIERCINGFIRE", sameAs),
        act("boss_dragon_ability2_name", `${descPrefix}ability2_description`, `${id}_pull`, "pull", "BOSSDRAGON_PULL", sameAs),
        act("boss_dragon_ability3_name", `${descPrefix}ability3_description`, `${id}_earthShakeAoe`, "multi", "BOSSDRAGON_EARTHQUAKE", sameAs),
        pas("boss_dragon_passive_ability1_name", `${descPrefix}passive_ability1_description`, `${id}_passive_melee`, "resist", "BOSSDRAGON_PASSIVE_MELEE", sameAs),
        pas("boss_dragon_passive_ability2_name", `${descPrefix}passive_ability2_description`, `${id}_passive_range`, "resist", "BOSSDRAGON_PASSIVE_RANGE", sameAs)];
    const BOSSES = [
        { id: "dragon", icon: "🐉", img: "BOSSDRAGON", name: "boss_dragon_name", title: "boss_dragon_name_description", levelUp: "bossDragonNew1_DmgLvlUp",
            abilities: dragon("bossDragon", "boss_dragon_") },
        { id: "spiderQueen", icon: "🕷️", img: "BOSSSPIDERQUEEN", name: "boss_spiderQueen_name", title: "boss_spiderQueen_name_description", levelUp: "bossSpiderQueenNew1_DmgLvlUp", abilities: [
            basic("bossSpiderQueen_defaultAoe"),
            act("boss_spiderQueen_ability1_name", "boss_spiderQueen_ability1_description", "bossSpiderQueen_summon_spiderBang", "summon", "BOSSSPIDERQUEEN_SUMMON_SPIDERBANG", { spider: "spiderBang" }),
            act("boss_spiderQueen_ability2_name", "boss_spiderQueen_ability2_description", "bossSpiderQueen_summon_spiderMelee", "summon", "BOSSSPIDERQUEEN_SUMMON_SPIDERMELEE", { spider: "spiderMelee" }),
            act("boss_spiderQueen_ability3_name", "boss_spiderQueen_ability3_description", "bossSpiderQueen_poisonPuddles", "acid", "BOSSSPIDERQUEEN_POISONPUDDLES"),
            pas("boss_spiderQueen_passive_ability1_name", "boss_spiderQueen_passive_ability1_description", "bossSpiderQueen_passive_melee", "resist", "BOSSSPIDERQUEEN_PASSIVE_MELEE"),
            pas("boss_spiderQueen_passive_ability2_name", "boss_spiderQueen_passive_ability2_description", "bossSpiderQueen_passive_range", "resist", "BOSSSPIDERQUEEN_PASSIVE_RANGE"),
            pas("boss_spiderQueen_passive_ability3_name", "boss_spiderQueen_passive_ability3_description", null, "reflect", "BOSSSPIDERQUEEN_REFLECT_AURA", { modifier: "reflect_aura_1" })] },
        { id: "kraken", icon: "🐙", img: "BOSSKRAKEN", name: "boss_kraken_name", title: "boss_kraken_name_description", levelUp: "bossKrakenNew1_DmgLvlUp", abilities: [
            basic("bossKraken_defaultAoe"),
            act("boss_kraken_ability1_name", "boss_kraken_ability1_description", "bossKraken_tentacleStrikesAoe", "multi", "BOSSKRAKEN_TENTACLESTRIKESAOE"),
            act("boss_kraken_ability2_name", "boss_kraken_ability2_description", "bossKraken_tentacle", "grab", "BOSSKRAKEN_TENTACLE", { cannon: "bossKraken_krakenCannon" }),
            act("boss_kraken_ability3_name", "boss_kraken_ability3_description", "bossKraken_tentacleThrow", "multi", "BOSSKRAKEN_TENTACLETHROW"),
            pas("boss_kraken_passive_ability1_name", "boss_kraken_passive_ability1_description", "bossKraken_ability_passive_melee", "resist", "BOSSKRAKEN_PASSIVE_MELEE"),
            pas("boss_kraken_passive_ability2_name", "boss_kraken_passive_ability2_description", "bossKraken_ability_passive_range", "resist", "BOSSKRAKEN_PASSIVE_RANGE")] },
        { id: "sand", icon: "🏜️", img: "BOSSSAND", name: "boss_sand_name", title: "boss_sand_name_description", levelUp: "bossSand_DmgLvlUp", abilities: [
            basic("bossSand_defaultAoe"),
            act("bossSand_ability1_name", "bossSand_ability1_description", "bossSand_ulta1", "areas", "BOSSSAND_SAND_AREAS", { debuffs: ["bossSand_debuff_1", "bossSand_debuff_2"] }),
            act("bossSand_ability2_name", "bossSand_ability2_description", "bossSand_ulta2", "throw", "BOSSSAND_HAMMER"),
            act("bossSand_ability3_name", "bossSand_ability3_description", "bossSand_ulta3", "multi", "BOSSSAND_SPEAR"),
            pas("bossSand_passive_range_name", "bossSand_passive_range_description", "bossSand_ability_passive_range", "resist", "BOSSSAND_PASSIVE_RANGE")] },
        // Goltharax: Balthazar in gold — the same dragon (and picture). The game gives only
        // his abilities' descriptions, so the names are Balthazar's (marked as such).
        { id: "gold", icon: "👑", img: "BOSSDRAGON", name: "boss_dragon_gold_name", title: "boss_gold_name_description", levelUp: "bossDragonGold1_DmgLvlUp",
            abilities: dragon("bossDragonGold", "boss_dragon_gold_", { sameAs: "dragon" }).map((a, i) => (i === 0 ? { ...a, sameAs: undefined } : a)) },
        { id: "iceSnake", icon: "❄️", img: "BOSSICESNAKE", name: "boss_IceSnake_name", title: "boss_IceSnake_name_description", levelUp: "bossIceSnake_DmgLvlUp", abilities: [
            act("boss_IceSnake_ability1_name", "boss_IceSnake_ability1_description", "bossIceSnake_defaultAoe", "needles", "BOSSICESNAKE_ICEARROWS"),
            act("boss_IceSnake_ability2_name", "boss_IceSnake_ability2_description", null, "guardians", "BOSSICESNAKE_SUMMON", { unit: "bossIceSnakeSummon", unitAttack: "bossIceSnakeSummon_lightning" }),
            pas("bossSand_passive_range_name", "bossSand_passive_range_description", null, "text", "BOSSSAND_PASSIVE_RANGE")] }
    ];
    const MAX_LEVEL = 300;

    const rowsOf = (d) => (Array.isArray(d) ? d : d && typeof d === "object" ? Object.values(d) : []);
    // A localization key's English text (or { text } as is), always plain text:
    // the game's colour tags (<color=#323549>…</color>) are taken out until
    // none are left, then any stray < or >.
    function text(data, key) {
        if (key && typeof key === "object") return String(key.text || "");
        const loc = data.localization || {}, en = data.en || {};
        const entry = loc[key] || rowsOf(loc).find(r => r && r.key === key);
        const raw = entry ? en[entry.value] : null;
        if (typeof raw !== "string") return "";
        let t = raw, before;
        do { before = t; t = t.replace(/<[^<>]*>/g, ""); } while (t !== before);
        return t.replace(/[<>]/g, "").trim();
    }
    const clampLevel = (lv) => Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(lv) || 1)));
    // An ability's numbers at a level: its fixed ones plus the level's.
    function at(data, abilityId, level) {
        const a = data.bosses && data.bosses.abilities && data.bosses.abilities[abilityId];
        if (!a) return null;
        const out = { ...a.fixed };
        for (const [k, arr] of Object.entries(a.perLevel || {})) {
            const i = Math.min(clampLevel(level), arr.length) - 1;
            if (arr[i] != null) out[k] = arr[i];
        }
        return out;
    }
    function unitAt(data, unitId, level) {
        const u = data.bosses && data.bosses.units && data.bosses.units[unitId];
        if (!u) return null;
        const out = { ...u.fixed };
        for (const [k, arr] of Object.entries(u.perLevel || {})) out[k] = arr[Math.min(clampLevel(level), arr.length) - 1];
        return out;
    }
    // A spider (an ordinary troop row) at a level.
    function spiderAt(data, troopId, level) {
        const rows = rowsOf(data.troopsLevel).filter(r => r.troopId === troopId);
        const row = rows.find(r => r.level === clampLevel(level)) || rows.sort((a, b) => b.level - a.level)[0];
        if (!row) return null;
        const out = { level: row.level, hp: row.health, attack: row.attack, defense: row.defense, aspd: row.aspd };
        if (troopId === "spiderBang") {
            const blast = rowsOf(data.abilityAoeDamageSuicide).find(r => r.key === `spiderBang_bang_${row.level}`);
            if (blast) { out.blast = blast.attack; out.blastRadius = blast.aoeRadius; }
        }
        return out;
    }
    function modifier(data, modifierKey) {
        const row = rowsOf(data.modifiers).find(r => r.modifierKey === modifierKey);
        return row ? { value: row.value, type: row.type, caption: row.caption ? text(data, row.caption) : "" } : null;
    }
    // Total damage that takes the boss up to a level (its health bar, level by level).
    function levelUpAt(data, tableId, level) {
        const t = data.bosses && data.bosses.levelUp && data.bosses.levelUp[tableId];
        if (!t || !t.length) return null;
        const lv = clampLevel(level);
        return { total: t[lv - 1], next: lv < t.length ? t[lv] - t[lv - 1] : null };
    }

    const n = (v) => Number(v);
    const pct = (v) => `${Math.round(v * 1000) / 10}%`;
    const secs = (v) => `${Math.round(v * 100) / 100}s`;
    // One ability at a level → rows: { label, value (a number, or text), icon, unit }
    function rowsFor(data, a, level) {
        const d = a.data ? at(data, a.data, level) : null;
        const rows = [], R = (label, value, icon, unit) => { if (value != null && value !== "" && !(typeof value === "number" && isNaN(value))) rows.push({ label, value, icon: icon || null, unit: unit || "" }); };
        const cd = () => d && d.cooldown != null && R("Cooldown", secs(d.cooldown), "ATTACKCOOLDOWN");
        switch (a.show) {
            case "multi":
                if (!d) break;
                if ((d.hits || 1) > 1) { R("Damage per hit", n(d.hitAttack), "ATTACK"); R("Hits", n(d.hits), "COUNT"); R("Total damage", n(d.hitAttack) * n(d.hits), "ATTACK"); }
                else R("Damage", n(d.hitAttack), "ATTACK");
                if (d.hitRadius) R("Area radius", n(d.hitRadius), "AOERADIUS");
                cd(); break;
            case "hit":
                if (!d) break;
                R("Damage", n(d.attack), "ATTACK"); R("Area radius", n(d.aoeRadius), "AOERADIUS"); cd(); break;
            case "pull":
                if (!d) break;
                R("Damage", n(d.attack), "ATTACK"); R("Area radius", n(d.aoeRadius), "AOERADIUS"); R("Pulls units in for", secs(d.pullDuration)); cd(); break;
            case "acid":
                if (!d) break;
                R("Acid balls", n(d.numShots), "COUNT"); R("Damage per ball", n(d.attack), "ATTACK");
                R("Acid pool damage (per second)", n(d.poisonDamage), "ATTACK"); R("Acid pool lasts", secs(n(d.poisonCount) * n(d.poisonInterval || 1)));
                R("Area radius", n(d.aoeRadius), "AOERADIUS"); cd(); break;
            case "summon":
                if (!d) break;
                R("Spiders summoned", n(d.numSummons), "SUMMON"); cd(); break;
            case "grab":
                if (!d) break;
                R("Units swallowed (at most)", n(d.maxEnemies), "COUNT"); R("Grab radius", n(d.aoeRadius), "AOERADIUS"); cd();
                if (a.cannon) { const c = at(data, a.cannon, level); if (c) { R("Your ship's cannon: damage", n(c.attack), "ATTACK"); R("Your cannon reloads in", secs(c.cooldown)); } }
                break;
            case "areas":
                if (!d) break;
                R("Quicksand areas", n(d.numAoe), "COUNT"); R("Damage per second in one", n(d.aoeAttack), "ATTACK"); R("Each lasts", secs(d.aoeDuration));
                R("Area radius", n(d.aoeRadius), "AOERADIUS");
                (a.debuffs || []).map(k => modifier(data, k)).filter(Boolean).forEach(m => {
                    if (m.type === "missSum") R("Attacks that miss", pct(m.value), "EVASION");
                    else if (m.type === "speedMultiplier") R(m.caption || "Movement speed", pct(m.value), "MOVESPEED");
                });
                cd(); break;
            case "throw":
                if (!d) break;
                R("Damage", n(d.aoeAttack), "ATTACK"); R("Area radius", n(d.aoeRadius), "AOERADIUS"); R("Stun", secs(d.stunTime)); R("Knocks units back", n(d.throwDistance)); cd(); break;
            case "needles":
                if (!d) break;
                R("Needles", n(d.hits), "COUNT"); R("Damage per needle", n(d.hitAttack), "ATTACK");
                if (d.blockExplosionAttack) R("Shard burst when blocked", n(d.blockExplosionAttack), "ATTACK");
                cd(); break;
            case "guardians": {
                const u = a.unit ? unitAt(data, a.unit, level) : null, l = a.unitAttack ? at(data, a.unitAttack, level) : null;
                if (u) { R("Guardian health", n(u.health), "HEALTH"); R("Guardian defense", n(u.defense), "DEFENSE"); }
                if (l) { R("Guardian damage (per strike)", n(l.attack), "ATTACK"); R("Hits up to (enemies)", n(l.maxNumEnemies), "COUNT"); R("Strikes every", secs(l.aspd)); }
                break;
            }
            case "resist":
                if (!d) break;
                if (d.meleeDamageMultiplier < 1) R("Damage taken from melee", `−${pct(1 - d.meleeDamageMultiplier)}`, "ATTACKTYPE");
                if (d.rangeDamageMultiplier < 1) R("Damage taken from ranged", `−${pct(1 - d.rangeDamageMultiplier)}`, "ATTACKTYPE");
                break;
            case "reflect": {
                const m = a.modifier ? modifier(data, a.modifier) : null;
                if (m) R("Basic attack damage reflected", pct(m.value));
                break;
            }
            default: break;
        }
        return rows;
    }

    // Everything about one boss at a level: what the page shows.
    function bossAt(data, bossId, level) {
        const b = BOSSES.find(x => x.id === bossId);
        if (!b) return null;
        const lv = clampLevel(level);
        const reflect = b.abilities.find(a => a.show === "reflect");
        const reflectPct = reflect && reflect.modifier ? modifier(data, reflect.modifier) : null;
        return {
            id: b.id, icon: b.icon, img: b.img, level: lv, name: text(data, b.name), title: text(data, b.title),
            levelUp: levelUpAt(data, b.levelUp, lv),
            abilities: b.abilities.map(a => {
                let desc = text(data, a.desc);
                if (reflectPct) desc = desc.replace("{0}", String(Math.round(reflectPct.value * 1000) / 10));
                const out = { kind: a.kind, name: text(data, a.name), desc, icon: a.icon || null, rows: rowsFor(data, a, lv),
                    sameAs: a.sameAs ? text(data, BOSSES.find(x => x.id === a.sameAs).name) : null };
                if (a.spider) out.spider = { troopId: a.spider, ...spiderAt(data, a.spider, lv) };
                return out;
            })
        };
    }

    return { BOSSES, MAX_LEVEL, rowsOf, text, at, unitAt, spiderAt, modifier, levelUpAt, rowsFor, bossAt, clampLevel };
});

/* ================================================================
   The Bosses tab (browser only), laid out like Troops & Heroes: a sticky
   bar (search, the level slider and a box to type the level, "Back to all
   Bosses"), a gallery, and a boss's page with rows and ⓘ descriptions.
   BossCalc.mount({ loadJSON, record }) — record() tells the page a view
   changed (its Back button); BossCalc.show(id|null) moves without that.
   ================================================================ */
(function () {
    if (typeof window === "undefined" || typeof document === "undefined" || !window.BossCalc) return;
    const B = window.BossCalc;
    const $ = (id) => document.getElementById(id);
    const fmt = (v) => (typeof v === "number" ? Math.round(v).toLocaleString("en-US") : String(v));
    const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const KEY = "kih_boss_calc";
    const st = { boss: null, level: 1, open: {} };
    try { st.level = B.clampLevel(JSON.parse(localStorage.getItem(KEY) || "{}").level); } catch (e) { }
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ level: st.level })); } catch (e) { } };
    let data = null, loading = null, opts = {};

    // The boss's picture, or its emoji when there's no picture (yet).
    const emojiPic = (icon) => "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="14" fill="#2a2a4a"/><text x="50" y="68" font-size="56" text-anchor="middle">${icon}</text></svg>`);
    function pic(img, boss, thumb) {
        img.alt = "";
        img.decoding = "async";
        const tries = [...(thumb ? [`images/thumbs/${boss.img}.jpg`] : []), `images/${boss.img}.jpg`, emojiPic(boss.icon)];
        let i = 0;
        img.onerror = () => { if (++i < tries.length) img.src = tries[i]; else img.onerror = null; };
        img.src = tries[0];
        return img;
    }
    const record = () => { if (typeof opts.record === "function") opts.record(); };

    /* ---------------- the sticky bar ---------------- */
    function wireBar() {
        const slider = $("bossSlider"), box = $("bcLevel"), search = $("bossSearch");
        slider.max = box.max = String(B.MAX_LEVEL);
        const setLevel = (v, from) => {
            st.level = B.clampLevel(v);
            if (from !== "box") box.value = String(st.level);
            slider.value = String(st.level);
            save();
            drawCard();
        };
        slider.addEventListener("input", () => setLevel(slider.value, "slider"));
        box.addEventListener("input", () => { if (box.value !== "") setLevel(box.value, "box"); });
        box.addEventListener("change", () => setLevel(box.value));
        search.addEventListener("input", () => { if (st.boss) { st.boss = null; drawAll(); record(); } else drawGallery(); });
        $("bossSearchClear").onclick = () => { search.value = ""; drawGallery(); };
        box.value = slider.value = String(st.level);
    }

    /* ---------------- the gallery ---------------- */
    function drawGallery() {
        const res = $("bossResults");
        res.innerHTML = "";
        if (st.boss || !data) return;
        const q = $("bossSearch").value.trim().toLowerCase();
        const label = document.createElement("div");
        label.className = "gallery-section-label";
        label.textContent = "Bosses";
        res.appendChild(label);
        const row = document.createElement("div");
        row.className = "unit-gallery";
        B.BOSSES.forEach(b => {
            const name = B.text(data, b.name), title = B.text(data, b.title);
            if (q && !(name + " " + title).toLowerCase().includes(q)) return;
            const item = document.createElement("div");
            item.className = "gallery-item mythic";
            item.dataset.boss = b.id;
            const span = document.createElement("span");
            span.textContent = name;
            item.append(pic(document.createElement("img"), b, true), span);
            item.addEventListener("click", () => select(b.id));
            row.appendChild(item);
        });
        if (!row.children.length) { const none = document.createElement("p"); none.className = "bc-none"; none.textContent = "No boss by that name."; res.appendChild(none); return; }
        res.appendChild(row);
    }

    /* ---------------- a boss's page ---------------- */
    const statRow = (r) => `<tr><td><span class="stat-name"><span>${esc(r.label)}</span>${r.icon ? `<img src="images/thumbs/${esc(r.icon)}.jpg" class="stat-icon" alt="" onerror="this.style.display='none'">` : ""}</span></td><td>${esc(fmt(r.value))}</td></tr>`;
    function abilityHtml(a, id) {
        const open = !!st.open[id];
        // the skill's picture above its name, like a troop's ability (removed if it isn't in images/ yet)
        const pic = a.icon ? `<img class="bc-skill-img" src="images/${esc(a.icon)}.jpg" alt="" onerror="this.remove()">` : "";
        let html = `<tr class="bc-ability" data-ability="${esc(id)}"><td colspan="2" class="bc-ab-name">${pic}<div>${esc(a.name || "Ability")}${a.sameAs ? ` <small class="bc-same">(as ${esc(a.sameAs)}'s)</small>` : ""} <button type="button" class="info-btn" data-desc="${esc(id)}" aria-label="What it does">i</button></div></td></tr>
            <tr class="desc-row" data-desc-row="${esc(id)}"${open ? "" : ` style="display:none;"`}><td colspan="2" class="desc-text">${esc(a.desc)}</td></tr>`;
        a.rows.forEach(r => { html += statRow(r); });
        if (a.spider && a.spider.level) {
            const s = a.spider;
            html += `<tr><td colspan="2" class="bc-sub" data-spider="${esc(s.troopId)}">${s.troopId === "spiderBang" ? "💥 Each explosive spider" : "🕷️ Each battle spider"} · Lvl ${esc(s.level)}</td></tr>`;
            if (s.troopId === "spiderBang") html += statRow({ label: "Blast damage", value: s.blast, icon: "ATTACK" }) + statRow({ label: "Blast radius", value: s.blastRadius, icon: "AOERADIUS" });
            else html += statRow({ label: "Attack", value: s.attack, icon: "ATTACK" }) + statRow({ label: "Attack speed", value: s.aspd, icon: "ASPD" });
            html += statRow({ label: "Health", value: s.hp, icon: "HEALTH" }) + statRow({ label: "Defense", value: s.defense, icon: "DEFENSE" });
        }
        return html;
    }
    function drawCard() {
        const card = $("bossCard");
        if (!st.boss || !data) { card.innerHTML = ""; return; }
        const r = B.bossAt(data, st.boss, st.level);
        let html = `<div class="bc-pic"></div>
            <h3>${esc(r.name)} (Lvl ${esc(r.level)})</h3>
            <div class="bc-pills"><span class="bc-pill">${esc(r.title)}</span><span class="bc-pill boss">Boss</span></div>
            <p class="bc-note">Every number is the game's own, at this level. Tap <b>i</b> for what an ability does.</p>
            <table>`;
        if (r.levelUp) {
            html += `<tr><td colspan="2" class="section-header">❤️ Health bar</td></tr>`;
            html += statRow({ label: "Damage dealt to reach this level", value: r.levelUp.total, icon: "HEALTH" });
            if (r.levelUp.next != null) html += statRow({ label: "Damage to its next level", value: r.levelUp.next, icon: "HEALTH" });
        }
        ["attack", "passive"].forEach(kind => {
            const list = r.abilities.map((a, i) => ({ a, id: `${r.id}-${i}` })).filter(x => x.a.kind === kind);
            if (!list.length) return;
            html += `<tr><td colspan="2" class="section-header">${kind === "attack" ? "⚔️ Attacks & Abilities" : "🛡️ Passive Abilities"}</td></tr>`;
            list.forEach(x => { html += abilityHtml(x.a, x.id); });
        });
        html += "</table>";
        card.innerHTML = html;
        card.querySelector(".bc-pic").appendChild(pic(Object.assign(document.createElement("img"), { className: "troop-img bc-img" }), B.BOSSES.find(b => b.id === st.boss), false));
    }
    function drawBack() {
        const slot = $("bossBackBtnSlot");
        slot.innerHTML = st.boss ? `<button type="button" class="troops-back-btn" id="bossBackBtn" style="font-size:15px; padding:6px 18px; background:white; color:#000; border:2px solid gray; font-weight:bold; border-radius:6px; cursor:pointer;">← Back to all Bosses</button>` : "";
        const b = $("bossBackBtn");
        if (b) b.onclick = () => { show(null); record(); };
    }
    function drawAll() { drawBack(); drawGallery(); drawCard(); }

    function wireCard() {
        $("bossCard").addEventListener("click", (e) => {
            const info = e.target.closest("[data-desc]");
            if (!info) return;
            const id = info.dataset.desc, row = $("bossCard").querySelector(`[data-desc-row="${CSS.escape(id)}"]`);
            st.open[id] = !st.open[id];
            if (row) row.style.display = st.open[id] ? "" : "none";
        });
    }

    function select(id) { show(id); record(); window.scrollTo(0, 0); }
    // Move to a boss (or the gallery: null) without a new Back step.
    function show(id) {
        st.boss = B.BOSSES.some(b => b.id === id) ? id : null;
        st.open = {};
        if (data) drawAll();
    }
    B.show = show;
    B.current = () => st.boss;

    let wired = false;
    B.mount = function (options) {
        opts = options || {};
        if (!wired) { wired = true; wireBar(); wireCard(); }
        if (data) { drawAll(); return Promise.resolve(); }
        if (!loading) {
            $("bossResults").innerHTML = "<p class=\"bc-none\">Loading the bosses…</p>";
            loading = Promise.all(["data/bosses.json", "localization.json", "en.json", "troopsLevel.json", "abilityAoeDamageSuicide.json", "unitParameterModifierNested.json"].map(f => opts.loadJSON(f)))
                .then(([bosses, localization, en, troopsLevel, abilityAoeDamageSuicide, modifiers]) => {
                    data = { bosses, localization, en, troopsLevel, abilityAoeDamageSuicide, modifiers };
                    drawAll();
                })
                .catch(() => { loading = null; $("bossResults").innerHTML = "<p class=\"bc-none\">Couldn't load the boss data — check your connection and open this tab again.</p>"; });
        }
        return loading;
    };
})();
