// Layout coordinator: the stage-layer state machine + the footer-aware lower band.
//
// This is the single owner of two coupled concerns, extracted from story.js so
// the screen grammar lives in one small, testable module:
//
//   1. Which immersive overlay layer owns the stage (spotlight, inspector,
//      stand-up, reasoning theater, dilemma, announcement bridge).
//   2. How tall the footer-driven lower band is, published as CSS variables the
//      world canvas, party hand, and narration caption all read from.
//
// Nothing here renders content. It only toggles body classes and measures /
// sets shared CSS variables, so every consumer resolves the same value and the
// layers never fight each other as overlays open and the footer resizes.
//
// Public API (imported by story.js and any future per-mode module):
//   setStageLayer(name, on)       - turn an overlay layer on/off (the switchboard)
//   stageLayerActive(name)        - query who currently owns the stage
//   syncFooterAwareLayout()       - re-measure the footer and republish band vars
//   queueFooterAwareLayoutSync()  - rAF-debounced sync
//   ensureFooterLayoutObserver()  - watch footer/hand/caption and auto-resync
//   wireFooterCardCollapse()      - wire the collapsible footer cards (persisted)

const $ = (id) => document.getElementById(id);

let layoutSyncRaf = 0;
let footerLayoutObserver = null;

// --- Stage layer coordinator -------------------------------------------------
// Single source of truth for the immersive overlay layers that can take over the
// stage: the speaker spotlight, the agent / worker inspector, the agent
// stand-up, the reasoning theater, and the dilemma gate. Components never poke
// the body classes directly - they call setStageLayer(name, on) so every layer
// knows what else is on stage, and the footer + scene react coherently instead
// of each toggle fighting the others. Each layer keeps its own body class as the
// CSS hook; this owns when they turn on/off and derives the shared footer state.
const STAGE_LAYERS = new Set();
// Layers that own the stage and would collide with the footer's playable hand +
// command input, so those controls step back (the worker mini + economy clock
// stay - they are identity and live pressure, not controls). The stand-up has
// its own CEO input, the inspector is a focused read, and the dilemma is a modal
// decision - in all of these the footer hand is unusable or overlapping.
const FOOTER_QUIETING_LAYERS = new Set(["standup-active", "inspecting-agent", "inspecting-worker", "dilemma", "diagnostics", "theater", "announce-bridge"]);

export function setStageLayer(name, on) {
    if (!name) return;
    if (on) STAGE_LAYERS.add(name); else STAGE_LAYERS.delete(name);
    document.body.classList.toggle(name, !!on);
    const quiet = [...FOOTER_QUIETING_LAYERS].some((layer) => STAGE_LAYERS.has(layer));
    document.body.classList.toggle("footer-quiet", quiet);
    // The footer's playable cluster just changed height; re-derive the stage
    // reserve so the world canvas + hand never fight the captions.
    queueFooterAwareLayoutSync();
}

export function stageLayerActive(name) {
    return STAGE_LAYERS.has(name);
}

// --- Footer-aware lower band -------------------------------------------------
// Measures the live footer once and republishes the lower-band inputs on :root
// so every consumer (including the sibling #narration) resolves the same value.
// CSS calc at :root owns the rest; this never computes the reserve in JS.
export function syncFooterAwareLayout() {
    const scene = $("scene");
    const footer = document.querySelector("footer");
    if (!scene || !footer) return;
    document.body.classList.toggle("compact-ui", window.innerWidth <= 1100);
    const footerHeight = Math.ceil(footer.getBoundingClientRect().height || 0);
    if (!footerHeight) return;
    // ONE measured input for the whole lower band. --hand-bottom drives the
    // party hand position; --footer-top is the actual footer top edge used by
    // inspectors and anything that must float *above* the footer. The party
    // cards intentionally dip PARTY_OVERLAP px behind the footer (footer
    // z-index 20 > party z-index 18 covers the overlap), creating the card-hand
    // "tucked in" look. Inspectors and the speaking card use --footer-top so
    // they stay above the footer even though --hand-bottom is now lower.
    const PARTY_OVERLAP = 70;
    const root = document.documentElement;
    root.style.setProperty("--hand-bottom", `${Math.max(footerHeight - PARTY_OVERLAP, 4)}px`);
    root.style.setProperty("--footer-top", `${footerHeight}px`);
    root.style.setProperty("--party-overlap", `${PARTY_OVERLAP}px`);
    // The narration caption above the hand grows with its line count, so feed
    // its real height in too; the reserve calc grows to clear a tall caption
    // instead of guessing a fixed budget (same single-source pattern).
    const narration = $("narration");
    const dialogueVisible = !!(narration && !narration.hidden && narration.classList.contains("show"));
    const dialogueH = dialogueVisible ? Math.ceil(narration.getBoundingClientRect().height || 0) : 0;
    root.style.setProperty("--dialogue-h", `${dialogueH}px`);
}

export function queueFooterAwareLayoutSync() {
    if (layoutSyncRaf) cancelAnimationFrame(layoutSyncRaf);
    layoutSyncRaf = requestAnimationFrame(() => {
        layoutSyncRaf = 0;
        syncFooterAwareLayout();
    });
}

export function ensureFooterLayoutObserver() {
    if (footerLayoutObserver || typeof ResizeObserver === "undefined") return;
    const footer = document.querySelector("footer");
    const hand = $("card-hand");
    if (!footer) return;
    footerLayoutObserver = new ResizeObserver(() => queueFooterAwareLayoutSync());
    footerLayoutObserver.observe(footer);
    if (hand) footerLayoutObserver.observe(hand);
    // The narration caption changes height as a line types in; observe it so
    // the reserve grows to clear it the moment it does.
    const narration = $("narration");
    if (narration) footerLayoutObserver.observe(narration);
}

// --- Collapsible footer cards ------------------------------------------------
// Each gameplay card (Game Masters + economy, and the command panel) can
// minimize to a slim handle to reclaim the world canvas. One generic helper
// drives every `[data-collapse-card]` button: it toggles `is-collapsed` on the
// target `.footer-card`, persists the choice, and re-syncs the lower band so the
// canvas reclaims the freed space without yanking the centered artifact.
const FOOTER_COLLAPSE_KEY = "qf_footer_collapsed";

function readCollapsedCards() {
    try { return new Set(JSON.parse(localStorage.getItem(FOOTER_COLLAPSE_KEY) || "[]")); }
    catch (_) { return new Set(); }
}

function applyFooterCardCollapsed(cardClass, collapsed) {
    const card = document.querySelector(`.footer-card.${cardClass}`);
    if (!card) return;
    card.classList.toggle("is-collapsed", !!collapsed);
    const toggle = card.querySelector(".fc-toggle");
    if (toggle) toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    queueFooterAwareLayoutSync();
}

function setFooterCardCollapsed(cardClass, collapsed) {
    const set = readCollapsedCards();
    if (collapsed) set.add(cardClass); else set.delete(cardClass);
    try { localStorage.setItem(FOOTER_COLLAPSE_KEY, JSON.stringify([...set])); } catch (_) {}
    applyFooterCardCollapsed(cardClass, collapsed);
}

export function wireFooterCardCollapse() {
    const collapsed = readCollapsedCards();
    ["footer-left", "footer-mid"].forEach((cardClass) => applyFooterCardCollapsed(cardClass, collapsed.has(cardClass)));
    document.querySelectorAll("[data-collapse-card]").forEach((btn) => {
        const cardClass = btn.getAttribute("data-collapse-card");
        btn.addEventListener("click", () => {
            const isCollapsed = document.querySelector(`.footer-card.${cardClass}`)?.classList.contains("is-collapsed");
            setFooterCardCollapsed(cardClass, !isCollapsed);
        });
    });
}
