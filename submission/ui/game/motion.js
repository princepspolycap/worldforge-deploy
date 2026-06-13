// Reusable open/close motion: height-scaling expand/collapse driven by Motion
// One (motion.dev, MIT). Imported from CDN the same way story.js imports
// mermaid, so a fresh fork needs no build step. If Motion fails to load (offline
// fork), every helper degrades to an instant show/hide - the UI still works.
//
// Single source of truth for "reveal/hide a block with a height slide", used by
// the creator-card business box and any future collapsible panel. Call:
//   import { expand, collapse, toggleCollapsible } from "./motion.js";
//   toggleCollapsible(panelEl, shouldOpen);

let animate = null;
try {
    ({ animate } = await import("https://cdn.jsdelivr.net/npm/motion@11/+esm"));
} catch (_) {
    animate = null; // offline / blocked - helpers fall back to instant toggles.
}

const EASE = [0.2, 0.7, 0.2, 1];
const DURATION = 0.32;

function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Reveal `el` (must start hidden via the `hidden` attribute) with a height +
// opacity slide from 0 to its natural height, then release height to `auto` so
// the layout stays responsive. Returns a Promise that resolves when done.
async function expand(el) {
    if (!el) return;
    el.hidden = false;
    el.setAttribute("aria-hidden", "false");
    if (!animate || prefersReducedMotion()) return;

    const target = el.scrollHeight;
    el.style.overflow = "hidden";
    const controls = animate(
        el,
        { height: [0, target], opacity: [0, 1] },
        { duration: DURATION, easing: EASE }
    );
    try { await controls.finished; } catch (_) { /* interrupted */ }
    // Release the fixed height so the panel can grow with its content.
    el.style.height = "";
    el.style.overflow = "";
}

// Collapse `el` from its current height to 0, then set the `hidden` attribute so
// it leaves the layout cleanly. Returns a Promise that resolves when hidden.
async function collapse(el) {
    if (!el) return;
    if (!animate || prefersReducedMotion()) {
        el.hidden = true;
        el.setAttribute("aria-hidden", "true");
        return;
    }
    const from = el.scrollHeight;
    el.style.overflow = "hidden";
    const controls = animate(
        el,
        { height: [from, 0], opacity: [1, 0] },
        { duration: DURATION, easing: EASE }
    );
    try { await controls.finished; } catch (_) { /* interrupted */ }
    el.hidden = true;
    el.setAttribute("aria-hidden", "true");
    el.style.height = "";
    el.style.overflow = "";
    el.style.opacity = "";
}

// Open or close `el` based on `shouldOpen`. The one entry point callers use.
function toggleCollapsible(el, shouldOpen) {
    return shouldOpen ? expand(el) : collapse(el);
}

export { expand, collapse, toggleCollapsible };
