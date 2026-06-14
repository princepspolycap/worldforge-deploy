// Onboarding "alive" animation capability. A thin wrapper around anime.js v4
// (MIT, motion engine), loaded as CDN ESM the same way story.js loads mermaid
// and motion.js loads Motion One - no build step on a fresh fork. If the CDN is
// blocked (offline fork) or the user prefers reduced motion, every helper
// degrades to an instant, legible set - the UI still works.
//
// Single source of truth for "make text alive": scramble-decode, staggered
// reveals, breathing timelines. Do NOT leak anime.js objects to callers; expose
// only these functions. Add the one function a new component needs - not a
// kitchen sink.
//
//   import { scramble, revealLines, prefersReduced } from "./anim.js";

let anime = null;
try {
    anime = await import("https://cdn.jsdelivr.net/npm/animejs@4/+esm");
} catch (_) {
    anime = null; // offline / blocked - helpers fall back to instant set.
}

const SCRAMBLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&/<>*";

function prefersReduced() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

function randChar(chars) {
    return chars.charAt(Math.floor(Math.random() * chars.length));
}

// Cycle each glyph of `el` through random characters, then lock to `finalText`
// left-to-right. Returns a Promise that resolves when the text has settled.
// Reduced-motion / offline: set textContent instantly. `el` keeps a data-text
// mirror so CSS fallbacks (and idle glitch) can read the resolved string.
function scramble(el, finalText, opts) {
    const o = opts || {};
    const text = finalText != null ? String(finalText) : (el ? el.textContent : "");
    if (!el) return Promise.resolve();
    el.setAttribute("data-text", text);

    if (!anime || prefersReduced() || !text) {
        el.textContent = text;
        if (typeof o.onComplete === "function") o.onComplete();
        return Promise.resolve();
    }

    const chars = o.chars || SCRAMBLE_CHARS;
    const duration = o.duration || 900;
    const start = performance.now();
    const settleAt = (i) => (i + 1) / text.length; // fraction of duration when glyph i locks

    return new Promise((resolve) => {
        function frame(now) {
            const p = Math.min(1, (now - start) / duration);
            let out = "";
            for (let i = 0; i < text.length; i++) {
                const ch = text[i];
                if (ch === " ") { out += " "; continue; }
                out += p >= settleAt(i) ? ch : randChar(chars);
            }
            el.textContent = out;
            if (p < 1) {
                requestAnimationFrame(frame);
            } else {
                el.textContent = text;
                if (typeof o.onComplete === "function") o.onComplete();
                resolve();
            }
        }
        requestAnimationFrame(frame);
    });
}

// Staggered rise+fade entrance for a set of nodes (NodeList or array). Used for
// console step lines and signal chips. Offline / reduced-motion: nodes are just
// made visible.
function revealLines(nodes, opts) {
    const list = Array.prototype.slice.call(nodes || []);
    if (!list.length) return Promise.resolve();
    const o = opts || {};
    if (!anime || prefersReduced()) {
        list.forEach((n) => { n.style.opacity = "1"; n.style.transform = "none"; });
        return Promise.resolve();
    }
    const controls = anime.animate(list, {
        opacity: [0, 1],
        translateY: [12, 0],
        duration: o.duration || 520,
        delay: anime.stagger(o.stagger || 80),
        ease: "out(3)",
    });
    return controls.finished ? controls.finished.catch(() => {}) : Promise.resolve();
}

// Low-frequency single-glyph flicker so a settled line still feels alive. Returns
// a stop() function. No-op offline / reduced-motion.
function idleGlitch(el, opts) {
    if (!el || !anime || prefersReduced()) return () => {};
    const o = opts || {};
    const chars = o.chars || SCRAMBLE_CHARS;
    const minGap = o.minGap || 2600;
    const maxGap = o.maxGap || 6000;
    let timer = null;
    let alive = true;

    function flickerOnce() {
        const text = el.getAttribute("data-text") || el.textContent || "";
        if (!text) return schedule();
        const idx = Math.floor(Math.random() * text.length);
        if (text[idx] === " ") return schedule();
        const swapped = text.slice(0, idx) + randChar(chars) + text.slice(idx + 1);
        el.textContent = swapped;
        setTimeout(() => { if (alive) el.textContent = text; schedule(); }, 70);
    }
    function schedule() {
        if (!alive) return;
        timer = setTimeout(flickerOnce, minGap + Math.random() * (maxGap - minGap));
    }
    schedule();
    return function stop() { alive = false; if (timer) clearTimeout(timer); };
}

// Resting-state loop: periodically re-decode `el` to its text so a settled line
// keeps breathing (the "LinkedIn pop-in" effect, looped). Returns stop(). Under
// reduced motion / offline it just sets the text once and never loops.
function loopScramble(el, opts) {
    const o = opts || {};
    const text = o.text != null ? String(o.text) : (el ? (el.getAttribute("data-text") || el.textContent) : "");
    if (!el) return () => {};
    if (!anime || prefersReduced()) {
        el.textContent = text;
        el.setAttribute("data-text", text);
        return () => {};
    }
    const period = o.period || 4200;
    const duration = o.duration || 520;
    let timer = null;
    let alive = true;

    function tick() {
        if (!alive) return;
        scramble(el, text, { duration }).then(() => {
            if (alive) timer = setTimeout(tick, period);
        });
    }
    timer = setTimeout(tick, period);
    return function stop() { alive = false; if (timer) clearTimeout(timer); };
}

export { scramble, revealLines, idleGlitch, loopScramble, prefersReduced };
