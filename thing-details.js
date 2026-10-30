/* thing-details.js — tap any item or style to see what it is.
   Anything with data-thing="<id>" (an id from progress-core.js) opens a
   popup: rarity and type, what it does (perks) or a live preview (looks),
   where it comes from, and whether it's yours. Used by the Store and the
   Profile pages; needs progress-core.js (and fx-styles.css for previews).

   A page tells it what you own:  ThingDetails.context = () => ({ items, perks })
   Or opens one itself:            showThing(id) / closeThing()
   A ×10 card (.cr-card) that hasn't turned over yet stays a surprise. */
(function () {
    const PC = window.ProgressCore;
    if (!PC || window.ThingDetails) return;
    const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const sgtDay = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

    const css = `
        [data-thing] { cursor: pointer; }
        .td-overlay { position: fixed; inset: 0; z-index: 10000; display: none; align-items: center; justify-content: center; padding: 16px; background: rgba(5, 5, 20, 0.78); }
        .td-overlay.open { display: flex; animation: tdFade 0.2s ease; }
        @keyframes tdFade { from { opacity: 0; } }
        @keyframes tdPop { from { transform: scale(0.88); opacity: 0; } }
        .td-box { position: relative; width: 100%; max-width: 340px; max-height: calc(100vh - 32px); overflow-y: auto; box-sizing: border-box; padding: 20px 16px 16px; border-radius: 18px; text-align: center; color: #fff;
            border: 2px solid var(--rc); background: radial-gradient(circle at 50% 0%, color-mix(in srgb, var(--rc) 30%, transparent), #17172e 70%); box-shadow: 0 0 30px color-mix(in srgb, var(--rc) 40%, transparent); animation: tdPop 0.3s cubic-bezier(.2, 1.5, .4, 1); }
        .td-x { position: absolute; top: 8px; right: 8px; width: 34px; height: 34px; border-radius: 50%; border: 1px solid rgba(255, 255, 255, 0.25); background: rgba(0, 0, 0, 0.35); color: #fff; font-size: 1rem; cursor: pointer; }
        .td-icon { font-size: 3rem; line-height: 1.1; }
        .td-kind { margin-top: 6px; font-size: 0.74rem; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; color: #c8c0e8; }
        .td-name { margin-top: 4px; font-size: 1.3rem; font-weight: 900; }
        .td-what { margin-top: 12px; padding: 10px 12px; border-radius: 12px; background: rgba(0, 0, 0, 0.3); text-align: left; font-size: 0.86rem; color: #e8e0ff; line-height: 1.45; }
        .td-what ul { margin: 4px 0 0; padding-left: 18px; }
        .td-what b { color: #7ddc92; }
        .td-prev { display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 12px; min-height: 60px; }
        .td-prev img { width: 52px; height: 52px; border-radius: 50%; display: block; object-fit: cover; }
        .td-prev .td-pname { font-weight: 900; font-size: 1.15rem; }
        .td-prev .td-bubble { padding: 9px 13px; border-radius: 14px; background: #2a2a4a; color: #fff; font-size: 0.9rem; }
        .td-prev .td-bg { width: 100%; height: 86px; border-radius: 12px; display: flex; align-items: flex-start; padding: 10px; box-sizing: border-box; font-weight: 800; font-size: 0.8rem; background: #22223a; }
        .td-prev .td-emojis { font-size: 1.5rem; letter-spacing: 3px; line-height: 1.5; }
        .td-meta { margin-top: 12px; font-size: 0.8rem; color: #c8c0e8; line-height: 1.5; }
        .td-own { display: inline-block; margin-top: 12px; padding: 4px 12px; border-radius: 999px; font-size: 0.8rem; font-weight: 800; background: #22c55e; color: #052e14; }
        .td-own.no { background: rgba(255, 255, 255, 0.1); color: #d8d0f0; }`;

    // Where it comes from.
    function source(x) {
        const ev = x.event && PC.EVENTS[x.event];
        if (ev) return `${ev.icon} ${esc(ev.name)} (${esc(ev.label)}) — limited, a treat at the door`;
        if (x.vip) return "👑 Comes with Super Supporter";
        if (x.chest) {
            if (x.season && !PC.inSeason(x, sgtDay())) return "🧰 Adventurer's Chest — seasonal, not in it right now";
            const rate = PC.dropRates(sgtDay())[x.id];
            return `🧰 Adventurer's Chest — ${rate ? rate.toFixed(rate < 1 ? 2 : 1) : 0}% per draw`;
        }
        const a = Object.keys(PC.ACHIEVEMENT_REWARDS).find(k => PC.ACHIEVEMENT_REWARDS[k].includes(x.id));
        return a ? `🏅 Mythic tier of the ${esc(PC.ACHIEVEMENT_BY_ID[a].name)} achievement` : "";
    }

    function html(id, ctx) {
        const x = PC.BY_ID[id];
        const rr = PC.RARITIES[x.rarity];
        const st = PC.STYLE_BY_ID[id];
        let kind, what, prev = "";
        if (!st) {
            kind = "Perk item";
            what = `<div>What it does — <b>always on</b> once it's yours, and it adds up with your other items:</div><ul>${x.perks.map(p => `<li>${esc(PC.perkText(p))}</li>`).join("")}</ul>`;
        } else {
            kind = PC.STYLE_TYPES[st.type];
            if (st.type === "emotes") {
                what = `<div>Adds these to your 😊 emoji panel, and the first four as <b>reactions</b> on comments and chat.</div>`;
                prev = `<div class="td-emojis">${PC.EMOTE_PACKS[st.pack].join(" ")}</div>`;
            } else {
                const where = st.type === "border" ? " around your picture" : st.type === "name" ? " on your name" : st.type === "bubble" ? " on your chat messages" : " behind your profile";
                what = `<div>A look — <b>looks only</b>, no bonus. Pick it in Profile → 🎨 Style and everyone sees it${where}.</div>`;
                if (st.type === "border") prev = PC.withBorder(`<img src="images/KIH.jpg" alt="">`, { border: id });
                else if (st.type === "name") prev = `<span class="td-pname ${PC.styleClass({ name: id }, "name")}">Your Name</span>`;
                else if (st.type === "bubble") prev = `<div class="td-bubble dm-msg ${PC.styleClass({ bubble: id }, "bubble")}">gg wp! 🎉</div>`;
                else prev = `<div class="td-bg ${PC.styleClass({ background: id }, "background")}">Your profile</div>`;
            }
        }
        const items = (ctx && ctx.items) || [];
        const owned = items.includes(id) || (x.vip && ctx && ctx.vip);
        const dup = x.chest ? `<br>Already yours when you draw it? You get <b style="color:#ffd75e">${PC.refundFor(id, (ctx && ctx.perks) || {})} 🪙</b> back instead.` : "";
        return `<button type="button" class="td-x" onclick="closeThing()" aria-label="Close">✕</button>
            <div class="td-icon">${x.icon}</div>
            <div class="td-kind">${esc(rr.label)} · ${esc(kind)}${x.event ? " · limited" : ""}</div>
            <div class="td-name">${esc(x.name)}</div>
            ${prev ? `<div class="td-prev">${prev}</div>` : ""}
            <div class="td-what">${what}</div>
            <div class="td-meta">${source(x)}${dup}</div>
            ${ctx ? `<div class="td-own${owned ? "" : " no"}">${owned ? "✓ Yours" : "Not yours yet"}</div>` : ""}`;
    }

    let overlay = null;
    function ensure() {
        if (overlay) return overlay;
        const style = document.createElement("style");
        style.textContent = css;
        document.head.appendChild(style);
        overlay = document.getElementById("thingOverlay");
        if (!overlay) {
            overlay = document.createElement("div");
            overlay.className = "td-overlay";
            overlay.id = "thingOverlay";
            overlay.innerHTML = `<div class="td-box" id="thingBox" role="dialog" aria-label="Item details"></div>`;
            document.body.appendChild(overlay);
        }
        overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
        return overlay;
    }
    function show(id) {
        if (!PC.BY_ID[id]) return;
        const o = ensure();
        let ctx = null;
        try { ctx = typeof api.context === "function" ? api.context() : null; } catch (e) { ctx = null; }
        const box = o.querySelector(".td-box");
        box.style.setProperty("--rc", PC.RARITIES[PC.BY_ID[id].rarity].color);
        box.innerHTML = html(id, ctx);
        box.scrollTop = 0;
        o.classList.add("open");
    }
    function close() { if (overlay) overlay.classList.remove("open"); }

    // Taps: in the capture phase, so a [data-thing] inside something
    // clickable (a Style option that equips it) only opens the details.
    document.addEventListener("click", (e) => {
        const el = e.target instanceof Element && e.target.closest("[data-thing]");
        if (!el) return;
        if (el.classList.contains("cr-card") && !el.classList.contains("flip")) return;
        e.stopPropagation();
        e.preventDefault();
        show(el.dataset.thing);
    }, true);
    // Esc closes the details first (not whatever is behind them).
    window.addEventListener("keydown", (e) => {
        if (e.key !== "Escape" || !overlay || !overlay.classList.contains("open")) return;
        e.stopPropagation();
        close();
    }, true);

    const api = { show, close, html, context: null };
    window.ThingDetails = api;
    window.showThing = show;
    window.closeThing = close;
})();
