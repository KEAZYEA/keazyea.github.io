/* prize.js — how a giveaway's prize looks: one card per reward (gold,
   diamonds, tokens, a hero or troop, or anything custom with its own
   picture), with the amounts counting up when it's revealed. Shared by
   promo.html (the prize you see once you've entered), admin.html (the live
   preview while building a giveaway) and index.html (the inbox win card).

   A prize is { items: [...], note }. Each item has a `kind`:
     tokens   { amount }            site tokens — paid into the winner's wallet automatically
     gold     { amount }
     diamonds { amount }
     unit     { unitKey, name }     a hero or troop, shown with its picture
     custom   { label, amount?, image? }
   Older giveaways only have a text description; render() takes that too. */
(function () {
    "use strict";
    const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const fmt = (n) => Number(n).toLocaleString("en-US");
    // 1,000,000 → "1M", 500,000 → "500K", 1,250 → "1,250"
    function short(n) {
        n = Number(n) || 0;
        if (n >= 1e6) return (Math.round(n / 1e5) / 10).toString().replace(/\.0$/, "") + "M";
        if (n >= 1e4) return (Math.round(n / 100) / 10).toString().replace(/\.0$/, "") + "K";
        return fmt(n);
    }

    /* ---------- icons (drawn, so no image files are needed) ---------- */
    let uid = 0;
    function goldIcon() {
        const g = "pzg" + (++uid);
        const coin = (cx, cy, r) => `<ellipse cx="${cx}" cy="${cy + 3}" rx="${r}" ry="${r * 0.42}" fill="#a8740f"/><ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r * 0.42}" fill="url(#${g})" stroke="#fff3b0" stroke-width="1.2"/>`;
        return `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff2a8"/><stop offset=".5" stop-color="#ffc62e"/><stop offset="1" stop-color="#d9930d"/></linearGradient></defs>
            ${coin(24, 46, 17)}${coin(40, 42, 17)}${coin(30, 34, 17)}${coin(34, 25, 17)}
            <circle cx="34" cy="20" r="10" fill="url(#${g})" stroke="#fff3b0" stroke-width="1.5"/><text x="34" y="24.5" text-anchor="middle" font-size="12" font-weight="900" fill="#9a6408">G</text></svg>`;
    }
    function gemIcon() {
        const g = "pzd" + (++uid);
        return `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c8f4ff"/><stop offset=".45" stop-color="#3fc8ff"/><stop offset="1" stop-color="#1565c0"/></linearGradient></defs>
            <polygon points="14,24 24,12 40,12 50,24 32,54" fill="url(#${g})" stroke="#e8fbff" stroke-width="1.5" stroke-linejoin="round"/>
            <polygon points="14,24 50,24 32,54" fill="#1e88e5" opacity=".45"/>
            <polyline points="24,12 28,24 32,12 36,24 40,12" fill="none" stroke="#e8fbff" stroke-width="1.2" stroke-linejoin="round"/>
            <polyline points="14,24 32,54 50,24" fill="none" stroke="#e8fbff" stroke-width="1" opacity=".7"/>
            <line x1="28" y1="24" x2="32" y2="54" stroke="#e8fbff" stroke-width="1" opacity=".6"/><line x1="36" y1="24" x2="32" y2="54" stroke="#e8fbff" stroke-width="1" opacity=".6"/></svg>`;
    }
    function tokenIcon() {
        const g = "pzt" + (++uid);
        return `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><radialGradient id="${g}" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff6c2"/><stop offset=".55" stop-color="#ffc400"/><stop offset="1" stop-color="#c77700"/></radialGradient></defs>
            <circle cx="32" cy="32" r="24" fill="url(#${g})" stroke="#fff3b0" stroke-width="2"/><circle cx="32" cy="32" r="17" fill="none" stroke="#a86400" stroke-width="2" opacity=".55"/>
            <text x="32" y="39.5" text-anchor="middle" font-size="21" font-weight="900" fill="#8a5200">K</text></svg>`;
    }

    const KINDS = {
        tokens: { label: "Tokens", sub: "Straight to your wallet", tint: "255, 196, 0" },
        gold: { label: "Gold", sub: "", tint: "255, 198, 46" },
        diamonds: { label: "Diamonds", sub: "", tint: "63, 200, 255" },
        unit: { label: "", sub: "", tint: "179, 136, 255" },
        custom: { label: "", sub: "", tint: "255, 107, 157" }
    };

    // Only the fields each kind can have, in range — anything else is dropped.
    function cleanItem(it) {
        if (!it || !KINDS[it.kind]) return null;
        const amount = Math.floor(Number(it.amount));
        const hasAmount = Number.isFinite(amount) && amount > 0 && amount <= 1e12;
        if (it.kind === "tokens" || it.kind === "gold" || it.kind === "diamonds") return hasAmount ? { kind: it.kind, amount } : null;
        if (it.kind === "unit") {
            const key = String(it.unitKey || "").trim();
            return /^[A-Za-z0-9_]{1,40}$/.test(key) ? { kind: "unit", unitKey: key, name: String(it.name || key).slice(0, 60) } : null;
        }
        const label = String(it.label || "").trim().slice(0, 60);
        if (!label) return null;
        const image = String(it.image || "").trim();
        const out = { kind: "custom", label };
        if (hasAmount) out.amount = amount;
        if (/^(https:\/\/|images\/)[^\s"'<>]{1,500}$/i.test(image)) out.image = image;
        return out;
    }
    function clean(prize) {
        const items = (prize && Array.isArray(prize.items) ? prize.items : []).map(cleanItem).filter(Boolean).slice(0, 8);
        const note = String((prize && prize.note) || "").trim().slice(0, 200);
        return { items, note };
    }
    function itemText(it) {
        if (it.kind === "tokens") return `${fmt(it.amount)} Tokens`;
        if (it.kind === "gold") return `${short(it.amount)} Gold`;
        if (it.kind === "diamonds") return `${fmt(it.amount)} Diamonds`;
        if (it.kind === "unit") return it.name;
        return it.amount ? `${short(it.amount)} ${it.label}` : it.label;
    }
    // "1M Gold + 1,000 Diamonds + 50 Tokens" — for places that only take text.
    function summary(prize) {
        const p = clean(prize);
        return p.items.map(itemText).join(" + ") + (p.note ? (p.items.length ? " — " : "") + p.note : "");
    }
    const tokensOf = (prize) => clean(prize).items.filter(i => i.kind === "tokens").reduce((s, i) => s + i.amount, 0);
    // Does anything need a code from the admin (everything but tokens does)?
    const needsCode = (prize) => clean(prize).items.some(i => i.kind !== "tokens");

    function tile(it) {
        const k = KINDS[it.kind];
        let icon, big = "", label = k.label, sub = k.sub;
        if (it.kind === "gold") icon = goldIcon();
        else if (it.kind === "diamonds") icon = gemIcon();
        else if (it.kind === "tokens") icon = tokenIcon();
        else if (it.kind === "unit") {
            icon = `<img class="pz-portrait" src="images/${esc(it.unitKey.toUpperCase())}.jpg" alt="" loading="lazy" decoding="async">`;
            label = it.name; sub = "Unit";
        } else {
            icon = it.image ? `<img class="pz-portrait" src="${esc(it.image)}" alt="" loading="lazy" decoding="async">` : `<span class="pz-emoji">🎁</span>`;
            label = it.label;
        }
        if (it.amount) big = `<b class="pz-num" data-to="${it.amount}">${short(it.amount)}</b>`;
        return `<div class="pz-tile pz-${it.kind}" style="--pz:${k.tint}">
            <div class="pz-icon">${icon}</div>
            ${big}<span class="pz-label">${esc(label)}</span>${sub ? `<small>${esc(sub)}</small>` : ""}
        </div>`;
    }

    // The prize as cards. `prize` can be { items, note } or, for an older
    // giveaway, just its text description.
    function render(prize, opts = {}) {
        injectCss();
        if (typeof prize === "string" || !prize || !Array.isArray(prize.items)) {
            const text = typeof prize === "string" ? prize : (prize && prize.description) || "";
            return `<div class="pz pz-text${opts.compact ? " compact" : ""}"><span class="pz-emoji">🎁</span><b>${esc(text || "…")}</b></div>`;
        }
        const p = clean(prize);
        if (!p.items.length) return p.note ? `<div class="pz pz-text"><span class="pz-emoji">🎁</span><b>${esc(p.note)}</b></div>` : "";
        return `<div class="pz${p.items.length === 1 ? " one" : ""}${opts.compact ? " compact" : ""}">
            <div class="pz-grid">${p.items.map(tile).join("")}</div>
            ${p.note ? `<p class="pz-note">${esc(p.note)}</p>` : ""}
        </div>`;
    }

    // The reveal: cards pop in one after another, numbers count up from 0,
    // a shine runs across each card once. Only transforms and opacity move.
    function play(root) {
        if (!root) return;
        const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        root.querySelectorAll(".pz-tile").forEach((t, i) => {
            t.style.animationDelay = (i * 0.14) + "s";
            t.classList.remove("pz-in"); void t.offsetWidth; t.classList.add("pz-in");
        });
        if (reduce) return;
        root.querySelectorAll(".pz-num").forEach((el, i) => {
            const to = Number(el.dataset.to) || 0;
            const start = performance.now() + 220 + i * 140, dur = 1100;
            el.textContent = short(0);
            let done = false;
            (function step(now) {
                if (done) return;
                const f = Math.min(1, Math.max(0, (now - start) / dur));
                const eased = 1 - Math.pow(1 - f, 3);
                el.textContent = short(Math.round(to * eased));
                if (f < 1) requestAnimationFrame(step);
            })(performance.now());
            // Frames pause in a background tab: the final number lands regardless.
            setTimeout(() => { done = true; el.textContent = short(to); }, 220 + i * 140 + dur + 80);
        });
    }

    let cssDone = false;
    function injectCss() {
        if (cssDone || typeof document === "undefined") return;
        cssDone = true;
        const st = document.createElement("style");
        st.textContent = `
.pz { width: 100%; box-sizing: border-box; }
.pz *, .pz-text { box-sizing: border-box; }
.pz-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.pz.one .pz-grid { grid-template-columns: minmax(0, 1fr); }
/* an odd one out at the end takes the whole row */
.pz-grid > .pz-tile:last-child:nth-child(odd):not(:only-child) { grid-column: 1 / -1; }
.pz-tile { position: relative; overflow: hidden; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 2px;
    padding: 12px 8px 10px; border-radius: 14px; border: 1px solid rgba(var(--pz), 0.55);
    background: radial-gradient(circle at 50% 0%, rgba(var(--pz), 0.32), transparent 70%), linear-gradient(180deg, rgba(var(--pz), 0.12), rgba(255, 255, 255, 0.02)); }
.pz.one .pz-tile { flex-direction: row; text-align: left; gap: 14px; padding: 12px 14px; }
.pz.one .pz-tile .pz-icon { margin: 0; }
.pz.one .pz-tile > b, .pz.one .pz-tile > span, .pz.one .pz-tile > small { display: block; }
.pz-icon { width: 58px; height: 58px; margin: 0 auto 2px; flex-shrink: 0; display: grid; place-items: center; filter: drop-shadow(0 0 10px rgba(var(--pz), 0.55)); }
.pz-icon svg { width: 100%; height: 100%; }
.pz-portrait { width: 58px; height: 58px; border-radius: 12px; object-fit: cover; object-position: top; border: 2px solid rgba(var(--pz), 0.9); }
.pz-emoji { font-size: 2.2rem; line-height: 1; }
.pz-num { font-size: 1.55rem; font-weight: 900; line-height: 1.05; color: #fff; text-shadow: 0 0 12px rgba(var(--pz), 0.8); font-variant-numeric: tabular-nums; }
.pz-label { font-weight: 800; font-size: 0.92rem; color: rgb(var(--pz)); overflow-wrap: anywhere; }
.pz-tile small { font-size: 0.72rem; color: #b8b8d0; }
.pz-note { margin: 8px 0 0; font-size: 0.85rem; color: #d0d0e4; text-align: center; }
.pz-text { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 12px; background: rgba(255, 196, 0, 0.08); border: 1px solid rgba(255, 196, 0, 0.35); }
.pz-text b { font-size: 1rem; }
.pz.compact .pz-icon, .pz.compact .pz-portrait { width: 40px; height: 40px; }
.pz.compact .pz-num { font-size: 1.15rem; }
.pz-tile.pz-in { animation: pzPop 0.55s cubic-bezier(.2, 1.5, .4, 1) both; }
.pz-tile.pz-in::after { content: ""; position: absolute; top: 0; bottom: 0; left: 0; width: 50%; pointer-events: none;
    background: linear-gradient(105deg, transparent, rgba(255, 255, 255, 0.35), transparent); transform: translateX(-130%);
    animation: pzShine 0.9s ease 0.35s both; animation-delay: inherit; }
.pz-tile.pz-in .pz-icon { animation: pzBounce 0.7s ease both; animation-delay: inherit; }
@keyframes pzPop { from { opacity: 0; transform: scale(0.6) translateY(10px); } }
@keyframes pzShine { to { transform: translateX(260%); } }
@keyframes pzBounce { 0% { transform: scale(0.4) rotate(-12deg); } 60% { transform: scale(1.15) rotate(4deg); } 100% { transform: none; } }
@media (prefers-reduced-motion: reduce) { .pz-tile.pz-in, .pz-tile.pz-in::after, .pz-tile.pz-in .pz-icon { animation: none; } }`;
        document.head.appendChild(st);
    }

    window.KIHPrize = { render, play, summary, clean, tokensOf, needsCode, short, KINDS };
})();
