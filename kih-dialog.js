/* kih-dialog.js — the app's own popups, in place of the browser's
   confirm() / alert() boxes ("keazyea.github.io says…"). Same look on every
   page; real buttons; nothing behind can be tapped; Back (and Escape) closes.

     await KihDialog.confirm({ icon, title, message, ok, cancel, tone, exchange, note, artHtml })  → true / false
     await KihDialog.alert({ icon, title, message, ok, code })                                       → (closed)
     await KihDialog.choose({ icon, title, message, note, buttons: [{ label, value, tone }] })        → a value, or null

   tone: "stardust" (✨ blue), "gold", "danger" (red), or the app's purple.
   exchange: { from: { icon: "🪙", amount: "960", label: "Tokens" }, to: { icon: "✨", amount: "9,600", label: "Stardust" } }
     — a conversion, drawn as two tiles.
   code: a code to copy (shown selectable, with a Copy button).
   artHtml: a picture (our own drawing, e.g. CharacterCore.itemPic) — never
   anything a player typed. Everything else is set as text. */
(function () {
    const CSS = `
.kd-overlay { position: fixed; inset: 0; z-index: 3000; display: flex; align-items: center; justify-content: center;
  padding: max(16px, env(safe-area-inset-top, 0px)) max(16px, env(safe-area-inset-right, 0px)) max(16px, env(safe-area-inset-bottom, 0px)) max(16px, env(safe-area-inset-left, 0px));
  background: rgba(6, 6, 18, 0.66); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); animation: kdFade 0.16s ease-out; }
.kd-box { width: min(360px, 100%); max-height: 100%; overflow-y: auto; box-sizing: border-box; padding: 22px 20px 18px; border-radius: 22px; text-align: center;
  background: linear-gradient(170deg, #26244f, #1a1936); border: 1px solid rgba(160, 150, 255, 0.28); box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55);
  color: var(--kih-text, #eceaff); font-family: inherit; animation: kdPop 0.2s cubic-bezier(.2, 1.3, .4, 1); }
.kd-icon { font-size: 2.2rem; line-height: 1; margin-bottom: 8px; }
.kd-art { display: flex; justify-content: center; margin-bottom: 8px; }
.kd-art svg { width: 72px; height: 72px; border-radius: 16px; background: rgba(255, 255, 255, 0.06); }
.kd-title { margin: 0 0 6px; font-size: 1.2rem; font-weight: 900; line-height: 1.25; }
.kd-msg { margin: 0; font-size: 0.95rem; line-height: 1.5; color: var(--kih-text-dim, #c4c0e6); white-space: pre-line; overflow-wrap: anywhere; }
.kd-ex { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 8px; margin: 16px 0 4px; }
.kd-side { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 12px 6px 10px; border-radius: 18px; min-width: 0; }
.kd-side.from { background: linear-gradient(160deg, rgba(255, 215, 94, 0.2), rgba(242, 169, 59, 0.05)); border: 1px solid rgba(255, 215, 94, 0.5); }
.kd-side.to { background: linear-gradient(160deg, rgba(185, 230, 255, 0.22), rgba(74, 168, 255, 0.08)); border: 1px solid rgba(143, 216, 255, 0.6); box-shadow: 0 0 22px rgba(74, 168, 255, 0.28); }
.kd-side .ico { font-size: 1.7rem; line-height: 1; }
.kd-side b { font-size: 1.3rem; font-weight: 900; line-height: 1.2; overflow-wrap: anywhere; }
.kd-side.from b { color: #ffe39a; } .kd-side.to b { color: #d9f2ff; }
.kd-side small { font-size: 0.66rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.75; }
.kd-arrow { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; font-weight: 900; color: #d9f2ff;
  background: rgba(143, 216, 255, 0.14); border: 1px solid rgba(143, 216, 255, 0.35); animation: kdNudge 1.4s ease-in-out infinite; }
@keyframes kdNudge { 50% { transform: translateX(3px); } }
.kd-note { margin: 12px 0 0; padding: 8px 10px; border-radius: 12px; font-size: 0.82rem; line-height: 1.45; color: var(--kih-text-dim, #c4c0e6); background: rgba(255, 255, 255, 0.05); white-space: pre-line; }
.kd-code { display: flex; gap: 8px; align-items: center; margin: 14px 0 0; }
.kd-code code { flex: 1; min-width: 0; padding: 10px 12px; border-radius: 12px; background: rgba(0, 0, 0, 0.35); border: 1px dashed rgba(255, 255, 255, 0.25);
  font: 800 1.05rem/1.3 ui-monospace, Consolas, monospace; letter-spacing: 0.04em; user-select: all; -webkit-user-select: all; overflow-wrap: anywhere; }
.kd-btns { display: flex; flex-direction: column; gap: 8px; margin-top: 18px; }
.kd-btn { width: 100%; padding: 13px 16px; border-radius: 14px; border: none; font: inherit; font-weight: 900; font-size: 1rem; cursor: pointer;
  background: linear-gradient(135deg, #8a7dff, #6c63ff); color: #fff; box-shadow: 0 4px 0 rgba(0, 0, 0, 0.25); transition: transform 0.08s; }
.kd-btn:active { transform: translateY(2px); box-shadow: 0 2px 0 rgba(0, 0, 0, 0.25); }
.kd-btn:focus-visible { outline: 3px solid rgba(255, 255, 255, 0.7); outline-offset: 2px; }
.kd-btn.stardust { position: relative; overflow: hidden; background: linear-gradient(135deg, #c9eeff, #6cbcff 55%, #4a8dff); color: #08223d; box-shadow: 0 4px 0 #2d6fc4, 0 8px 22px rgba(74, 168, 255, 0.35); }
.kd-btn.stardust::after { content: ""; position: absolute; inset: 0; background: linear-gradient(110deg, transparent 30%, rgba(255, 255, 255, 0.6) 50%, transparent 70%); transform: translateX(-100%); animation: kdShine 2.8s ease-in-out infinite; }
@keyframes kdShine { 60%, 100% { transform: translateX(100%); } }
.kd-btn.gold { background: linear-gradient(135deg, #ffd75e, #f2a93b); color: #2a1a05; }
.kd-btn.danger { background: linear-gradient(135deg, #ff6b6b, #d63a3a); color: #fff; }
.kd-btn.ghost { background: rgba(255, 255, 255, 0.07); color: var(--kih-text-dim, #c4c0e6); border: none; box-shadow: none; font-weight: 800; }
.kd-btn.ghost:active { transform: none; background: rgba(255, 255, 255, 0.12); }
.kd-btn.small { width: auto; padding: 10px 14px; font-size: 0.85rem; }
@keyframes kdFade { from { opacity: 0; } }
@keyframes kdPop { from { opacity: 0; transform: scale(0.92); } }
@media (prefers-reduced-motion: reduce) { .kd-overlay, .kd-box, .kd-arrow, .kd-btn.stardust::after { animation: none; } }`;

    let queue = Promise.resolve();
    const top = () => { try { return window.top; } catch (e) { return null; } };

    function ensureCss() {
        if (document.getElementById("kihDialogCss")) return;
        const s = document.createElement("style");
        s.id = "kihDialogCss";
        s.textContent = CSS;
        document.head.appendChild(s);
    }
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; };

    // One popup; resolves with the pressed button's value (cancel/Back/Escape: the `dismiss` value)
    function open(o, buttons, dismiss) {
        ensureCss();
        return new Promise((resolve) => {
            const before = document.activeElement;
            const overlay = el("div", "kd-overlay");
            overlay.setAttribute("role", "dialog");
            overlay.setAttribute("aria-modal", "true");
            const box = el("div", "kd-box");
            if (o.artHtml) { const a = el("div", "kd-art"); a.innerHTML = o.artHtml; box.appendChild(a); }
            else if (o.icon) box.appendChild(el("div", "kd-icon", o.icon));
            const title = el("h2", "kd-title", o.title || "");
            title.id = "kdTitle" + Date.now();
            overlay.setAttribute("aria-labelledby", title.id);
            box.appendChild(title);
            if (o.message) box.appendChild(el("p", "kd-msg", o.message));
            if (o.exchange) { // { from: { icon, amount, label }, to: { … } }
                const side = (cls, s) => { const d = el("div", "kd-side " + cls); d.append(el("span", "ico", s.icon), el("b", "", s.amount), el("small", "", s.label)); return d; };
                const ex = el("div", "kd-ex");
                ex.append(side("from", o.exchange.from), el("span", "kd-arrow", "➜"), side("to", o.exchange.to));
                box.appendChild(ex);
            }
            if (o.code) {
                const row = el("div", "kd-code"), code = el("code", "", o.code), copy = el("button", "kd-btn small ghost", "Copy");
                copy.type = "button";
                copy.onclick = () => {
                    const done = () => { copy.textContent = "Copied ✓"; };
                    try { navigator.clipboard.writeText(String(o.code)).then(done, () => selectCode()); } catch (e) { selectCode(); }
                };
                const selectCode = () => { const r = document.createRange(); r.selectNodeContents(code); const s = getSelection(); s.removeAllRanges(); s.addRange(r); copy.textContent = "Selected — copy it"; };
                row.append(code, copy);
                box.appendChild(row);
            }
            if (o.note) box.appendChild(el("p", "kd-note", o.note));
            const btns = el("div", "kd-btns");
            let finished = false, popped = false;
            const app = top(), framed = app && app !== window;
            const finish = (value, fromBack) => {
                if (finished) return;
                finished = true;
                document.removeEventListener("keydown", onKey, true);
                overlay.remove();
                try { if (framed && app.kihChildPopup) app.kihChildPopup(false, window); } catch (e) { }
                try { if (!fromBack && !popped && app && app.kihLeavePopupStep) app.kihLeavePopupStep(); } catch (e) { }
                try { if (before && before.focus) before.focus({ preventScroll: true }); } catch (e) { }
                resolve(value);
            };
            buttons.forEach((b) => {
                const btn = el("button", "kd-btn" + (b.tone ? " " + b.tone : ""), b.label);
                btn.type = "button";
                btn.dataset.kdValue = b.key || "";
                btn.onclick = () => finish(b.value);
                btns.appendChild(btn);
            });
            box.appendChild(btns);
            overlay.appendChild(box);
            // a tap on the dim background does nothing (it's a question — answer it)
            overlay.addEventListener("click", (e) => { if (e.target === overlay) btns.firstChild && btns.firstChild.focus(); });
            const onKey = (e) => {
                if (e.key === "Escape") { e.preventDefault(); finish(dismiss); }
                else if (e.key === "Enter" && document.activeElement && document.activeElement.classList.contains("kd-btn")) { e.preventDefault(); document.activeElement.click(); }
                else if (e.key === "Tab") { // focus stays in the popup
                    const f = [...box.querySelectorAll("button")];
                    if (!f.length) return;
                    const i = f.indexOf(document.activeElement);
                    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
                    else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
                }
            };
            document.addEventListener("keydown", onKey, true);
            document.body.appendChild(overlay);
            // the app's top bar can't be tapped while it's up (a section's frame), and Back closes it
            try { if (framed && app.kihChildPopup) app.kihChildPopup(true, window); } catch (e) { }
            try { if (app && app.kihPopupStep) app.kihPopupStep(() => { popped = true; finish(dismiss, true); }); } catch (e) { }
            const first = btns.firstChild;
            if (first) setTimeout(() => first.focus({ preventScroll: true }), 30);
        });
    }
    // one at a time: a second popup waits for the first to close
    function enqueue(fn) {
        const p = queue.then(fn, fn);
        queue = p.catch(() => { });
        return p;
    }

    function confirm(o) {
        return enqueue(() => open(o, [
            { label: o.ok || "OK", value: true, tone: o.tone, key: "ok" },
            { label: o.cancel || "Cancel", value: false, tone: "ghost", key: "cancel" }
        ], false));
    }
    function alert(o) {
        return enqueue(() => open(o, [{ label: o.ok || "OK", value: undefined, tone: o.tone, key: "ok" }], undefined));
    }
    function choose(o) {
        return enqueue(() => open(o, (o.buttons || []).map((b, i) => ({ label: b.label, value: b.value === undefined ? null : b.value, tone: b.tone || (i ? "ghost" : ""), key: b.key || "b" + i })), null));
    }
    window.KihDialog = { confirm, alert, choose };
})();
