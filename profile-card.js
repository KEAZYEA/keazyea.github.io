/* profile-card.js — a player's profile card, the same everywhere: your
   Profile page ("How others see you") and the popup when you open someone's
   profile (Home and Social). Each page puts in the character, looks, name
   and badges; these are the parts they share, and how they all look:

     ProfileCard.facts(profile)   their game stats: 🏆 trophies · ⭐ level ·
                                  ⚡ power (three to a row), 🛡️ clan · 📱 server
                                  (two to a row) — only what they've filled in
     ProfileCard.itemsText(n)     "🎒 11 items"
     ProfileCard.heartsText(n)    "💗 22 hearts"

   Markup (in this order): character, looks, .pf-hero-name, .pf-hero-stats
   (a 💗 pill — a button on someone else's — and a 🎒 pill), .pf-badges,
   .pf-hero-bio, .pf-hero-facts. A popup wraps them in .pf-card. */
(function () {
    const CSS = `
.pf-card { display: flex; flex-direction: column; align-items: center; gap: 9px; text-align: center; }
.pf-card .vp-char { margin: 0 auto; }
/* their border round the character (fx-styles.css draws it) */
.fx-av:has(> .vp-char) { border-radius: 18px; }
.fx-av:has(> .vp-char)::before { border-radius: 20px; }
.pf-hero-name { max-width: 100%; font-size: 1.45rem; font-weight: 900; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pf-card .pf-hero-name { font-size: 1.3rem; }
.pf-hero-stats { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 6px; }
.pf-stat { display: inline-flex; align-items: center; gap: 4px; padding: 4px 11px; border-radius: 999px; background: rgba(0, 0, 0, 0.28); border: 1px solid rgba(255, 255, 255, 0.08);
    font-size: 0.8rem; font-weight: 800; color: inherit; white-space: nowrap; }
.pf-stat[hidden] { display: none; }
.pf-hero-stats .pf-like-btn { margin: 0; padding: 4px 11px; font-size: 0.8rem; }
.pf-card .pf-badges, .pf-hero .pf-badges { justify-content: center; margin: 0; }
.pf-hero-bio { max-width: 36ch; font-size: 0.88rem; font-style: italic; line-height: 1.45; color: #d9d5f3; overflow-wrap: anywhere; }
.pf-hero-bio::before { content: "“"; } .pf-hero-bio::after { content: "”"; }
.pf-hero-bio:empty, .pf-hero-facts:empty { display: none; }
.pf-hero-facts { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 6px; width: 100%; margin-top: 2px; }
.pf-fact { grid-column: span 2; min-width: 0; padding: 8px 6px; border-radius: 12px; background: rgba(0, 0, 0, 0.24); }
.pf-fact.wide { grid-column: span 3; }
.pf-fact b { display: block; font-size: 0.92rem; font-weight: 900; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pf-fact.wide b { white-space: normal; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; line-height: 1.2; }
.pf-fact small { display: block; margin-top: 1px; font-size: 0.64rem; font-weight: 700; opacity: 0.7; }
@media (max-width: 360px) { .pf-fact b { font-size: 0.86rem; } }`;

    const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const n = (v) => Math.max(0, Math.floor(Number(v) || 0));
    const SERVER_NAMES = { ios: "iOS", android: "Android", both: "iOS & Android" };
    const compact = (v) => { try { return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v); } catch (e) { return v.toLocaleString("en-US"); } };

    function facts(profile) {
        const p = profile || {};
        return [
            ["🏆", n(p.highestTrophies) ? n(p.highestTrophies).toLocaleString("en-US") : "", "Trophies", false],
            ["⭐", n(p.currentLevel) ? "Lv " + n(p.currentLevel).toLocaleString("en-US") : "", "Level", false],
            ["⚡", n(p.currentPower) ? compact(n(p.currentPower)) : "", "Power", false],
            ["🛡️", String(p.currentClan || "").trim(), "Clan", true],
            ["📱", Object.prototype.hasOwnProperty.call(SERVER_NAMES, p.server) ? SERVER_NAMES[p.server] : "", "Server", true]
        ].filter(f => f[1]).map(([ico, v, label, wide]) =>
            `<div class="pf-fact${wide ? " wide" : ""}" title="${label}: ${esc(v)}"><b>${esc(v)}</b><small>${ico} ${label}</small></div>`).join("");
    }
    const plural = (k, word) => `${n(k).toLocaleString("en-US")} ${word}${n(k) === 1 ? "" : "s"}`;
    const itemsText = (k) => `🎒 ${plural(k, "item")}`;
    const heartsText = (k) => `💗 ${plural(k, "heart")}`;

    if (typeof document !== "undefined" && !document.getElementById("profileCardCss")) {
        const style = document.createElement("style");
        style.id = "profileCardCss";
        style.textContent = CSS;
        document.head.appendChild(style);
    }
    const api = { facts, itemsText, heartsText, SERVER_NAMES };
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    if (typeof window !== "undefined") window.ProfileCard = api;
})();
