// Story Mode: a 3Blue1Brown-style narrated walkthrough of a Foundry-driven
// venture build. The World Designer decomposes a pitch into a quest graph, then
// the Worker Factory executes each chapter on its Foundry deployment. Each
// artifact (org chart, integration map, OKRs, financial plan) is animated into
// a dynamic Mermaid / SVG diagram, narrated beat by beat, validated at a gate,
// and folded into a company graph that grows as the venture comes alive.

import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
import { T, ROLE_COLOR, mermaidThemeVariables } from "./tokens.js";
import { toggleCollapsible } from "./motion.js";
import { scramble, idleGlitch, loopScramble, prefersReduced } from "./anim.js";
import { runPreflightConsole, classifyProfileUrl } from "./preflight.js?v=4";
import { renderPartyHand } from "./party.js?v=1";
import {
    setStageLayer,
    stageLayerActive,
    queueFooterAwareLayoutSync,
    ensureFooterLayoutObserver,
    wireFooterCardCollapse,
} from "./layout.js?v=1";

mermaid.initialize({
    startOnLoad: false,
    theme: "base",
    securityLevel: "loose",
    htmlLabels: false,
    fontFamily: T.fontBody,
    themeVariables: mermaidThemeVariables(),
    flowchart: { curve: "basis", padding: 22, nodeSpacing: 52, rankSpacing: 66, useMaxWidth: false, htmlLabels: false },
});

const A = window.DungeonAudio || {};
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DIAG_MAX_ENTRIES = 180;
const diagnostics = {
    frontend: [],
};

function diagLog(level, source, message, payload = null) {
    diagnostics.frontend.unshift({
        ts: Date.now(),
        level: String(level || "info"),
        source: String(source || "ui"),
        message: String(message || ""),
        payload,
    });
    if (diagnostics.frontend.length > DIAG_MAX_ENTRIES) diagnostics.frontend.length = DIAG_MAX_ENTRIES;
}

function diagLogError(source, err, message = "") {
    const detail = err && err.message ? err.message : String(err || "unknown error");
    diagLog("error", source, message ? `${message}: ${detail}` : detail);
}

function newClientTraceId(prefix = "trace") {
    const cryptoApi = globalThis.crypto;
    const rand = (cryptoApi && cryptoApi.randomUUID)
        ? cryptoApi.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10);
    return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

function responseTraceId(body, payload) {
    return (body && body.client_trace_id)
        || (payload && payload.client_trace_id)
        || (payload && payload.command_trace && payload.command_trace.client_trace_id)
        || "";
}

// Sanitize antagonist-generated text: strip internal knowledge-base filenames
// that leak from simulation templates, and replace harmful/inappropriate
// language with neutral game-design equivalents. Apply wherever rival
// descriptions, escalation pressure, and tooltip text are rendered.
const _ANTAG_CLEAN = [
    [/\bfascist[- ]style\b/gi, "exclusivity-based"],
    [/\bworld_generation_playbook\.md\b/gi, "the growth playbook"],
    [/\borg_design_playbook\.md\b/gi, "the org playbook"],
    [/\bgtm_finance_playbook\.md\b/gi, "the finance playbook"],
    [/\b[\w_]+_playbook\.md\b/gi, "the playbook"],
    [/\bfrom\s+[\w_]+\.(md|yaml|json|txt)\b/gi, "from the playbook"],
    [/\b[\w_]+\.md\b/gi, "the playbook"],
];
function sanitizeAntagonistDesc(text) {
    if (!text) return text;
    return _ANTAG_CLEAN.reduce((t, [pat, rep]) => String(t).replace(pat, rep), text);
}

const ROLE_NAME = {
    strategist: "Strategist",
    designer: "Designer",
    marketer: "Marketer",
    ops: "Operations",
    narrator: "World Designer",
    orgdesigner: "Org Designer",
    rival: "Rival",
    antagonist: "Rival",
    villain: "Rival",
};

// --- API helpers -----------------------------------------------------------
async function api(path, body) {
    const started = Date.now();
    try {
        const res = await fetch(path, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body || {}),
        });
        if (!res.ok) {
            const detail = await res.text().catch(() => "");
            diagLog("warn", "api", `POST ${path} -> ${res.status}`, detail ? { detail: detail.slice(0, 280) } : null);
            throw new Error(`${path} ${res.status} ${detail}`);
        }
        const payload = await res.json();
        const trace = responseTraceId(body, payload);
        const diagPayload = { ms: Date.now() - started };
        if (trace) diagPayload.client_trace_id = trace;
        if (body && body.stage_id) diagPayload.stage_id = body.stage_id;
        if (body && (body.text || body.command_text)) diagPayload.text_preview = String(body.text || body.command_text).slice(0, 90);
        if (payload && payload.player_move && payload.player_move.id) diagPayload.player_move_id = payload.player_move.id;
        if (payload && payload.stage && payload.stage.id) diagPayload.stage_id = payload.stage.id;
        if (payload && Array.isArray(payload.adapted_stage_ids)) diagPayload.adapted_stage_count = payload.adapted_stage_ids.length;
        diagLog("info", "api", `POST ${path} ok`, diagPayload);
        return payload;
    } catch (e) {
        diagLogError("api", e, `POST ${path} failed`);
        throw e;
    }
}

async function apiGet(path) {
    const started = Date.now();
    try {
        const res = await fetch(path);
        if (!res.ok) {
            const detail = await res.text().catch(() => "");
            diagLog("warn", "api", `GET ${path} -> ${res.status}`, detail ? { detail: detail.slice(0, 280) } : null);
            throw new Error(`${path} ${res.status} ${detail}`);
        }
        diagLog("info", "api", `GET ${path} ok`, { ms: Date.now() - started });
        return res.json();
    } catch (e) {
        diagLogError("api", e, `GET ${path} failed`);
        throw e;
    }
}

// --- Narration typewriter --------------------------------------------------
// Multi-voice cast: each agent speaks with a distinct Azure neural voice so the
// party feels like different characters, not one narrator. Voices are real
// gpt-4o-mini-tts (2025-12-15) voices verified on the deployment. Falls back to
// the narrator voice for unknown roles.
const VOICE_BY_ROLE = {
    narrator: "onyx",       // the Narrator / World Designer - deep, epic guide
    orgdesigner: "sage",    // the Org Designer - wise, measured
    strategist: "ballad",   // Soren - thoughtful
    designer: "coral",      // Dahlia - bright, creative
    marketer: "verse",      // Maddox - energetic
    ops: "alloy",           // Operations - steady
};
const VOICE_PROFILES = [
    { id: "onyx", label: "Onyx", locale: "en-US", stack: "core_openai", tone: "Deep, warm narrator" },
    { id: "alloy", label: "Alloy", locale: "en-US", stack: "core_openai", tone: "Crisp professional" },
    { id: "echo", label: "Echo", locale: "en-US", stack: "core_openai", tone: "Soft, reflective" },
    { id: "fable", label: "Fable", locale: "en-US", stack: "core_openai", tone: "Expressive storyteller" },
    { id: "nova", label: "Nova", locale: "en-US", stack: "core_openai", tone: "Bright, clean" },
    { id: "shimmer", label: "Shimmer", locale: "en-US", stack: "core_openai", tone: "Clear, detailed" },
];
const NARRATOR_VOICE = "onyx";
const DEFAULT_COMPANY = "World Improvement Mission";
const ARCHETYPE_SKILL = {
    Builder: "building product: shipping software, prototypes, systems",
    Seller: "selling: closing deals, partnerships, growth conversations",
    Designer: "design: brand, product experience, storytelling",
    Operator: "operations: process, logistics, keeping the machine running",
};
const STANDUP_SELECTION = new URLSearchParams(location.search).get("standup") === "random"
    ? "random"
    : "round_robin";
let currentVoice = NARRATOR_VOICE;

function getVoiceProfile(voiceId) {
    return VOICE_PROFILES.find((profile) => profile.id === voiceId)
        || { id: voiceId || NARRATOR_VOICE, locale: "en-US", stack: "core_openai", tone: "Core voice" };
}

function selectedFounderVoiceProfile() {
    const voiceId = ($("in-founder-voice") && $("in-founder-voice").value) || "onyx";
    return getVoiceProfile(voiceId);
}

function founderNameFromProfileUrl(url) {
    try {
        const parsed = new URL(url);
        const parts = parsed.pathname.split("/").filter(Boolean);
        const inIdx = parts.indexOf("in");
        const raw = inIdx >= 0 ? parts[inIdx + 1] : parts[0];
        if (!raw) return "Founder";
        // Drop the id tail LinkedIn appends (e.g. "jordan-rivera-9f8e" ->
        // "Jordan Rivera"): real name tokens never contain digits. Mirrors the
        // server's _humanize_handle so client and backend agree on the name.
        const tokens = raw.replace(/[-_]+/g, " ").split(" ").filter(Boolean);
        const nameTokens = tokens.filter((t) => !/\d/.test(t));
        const clean = (nameTokens.length ? nameTokens : tokens).join(" ");
        return clean
            .replace(/\b\w/g, (m) => m.toUpperCase())
            .slice(0, 40);
    } catch (_) {
        return "Founder";
    }
}

// Derive the world/quest title from the SCRAPED FOUNDER, never a generic
// placeholder. The run is that founder's character, so the title must speak the
// person we analyzed: their venture brand if the profile names one (e.g.
// "Founder @ Poly186" -> "Poly186"), else "<Name>'s Venture", else the default.
// Single source of truth so the ready card, scene head, and run agree.
function ventureNameFromProfile(profile, founderName) {
    const summary = (profile && profile.company_summary) || "";
    const brand = summary.match(/(?:@\s*|founder\s+(?:of|at)\s+)([A-Z][A-Za-z0-9.&'-]{1,28})/i);
    if (brand && brand[1]) return brand[1].trim();
    const name = (founderName && founderName !== "Founder") ? founderName.trim() : "";
    if (name) return `${name}'s Venture`;
    return DEFAULT_COMPANY;
}

// Scrub a digit-bearing id tail out of an already-built display name (e.g. a
// legacy saved slot named "Jordan Rivera 9f8e's Venture" -> "Jordan Rivera's
// Venture"). New runs never produce these (founderNameFromProfileUrl now drops
// digit tokens), but old slots persisted before the fix should still read clean.
function cleanRunDisplayName(name) {
    const raw = String(name || "").trim();
    if (!raw) return raw;
    const out = raw.replace(/\b[a-z]*\d[a-z\d]*\b/gi, "").replace(/\s+/g, " ").replace(/\s+(['’])/g, "$1").trim();
    return out || raw;
}

function cleanProfileSummaryForPlayer(summary) {
    const raw = String(summary || "").trim();
    if (!raw) return "";
    // Keep the identity signal, drop backend-process narration.
    return raw
        .replace(/\.?\s*Public profile pieced together from open-web findings\.?/ig, "")
        .replace(/\s{2,}/g, " ")
        .trim();
}

function setInferredArchetype(name, skill) {
    const cleanName = ARCHETYPE_SKILL[name] ? name : "Builder";
    const cleanSkill = skill || ARCHETYPE_SKILL[cleanName] || ARCHETYPE_SKILL.Builder;
    state.archetype = { name: cleanName, skill: cleanSkill };
    document.querySelectorAll("#arch-row .arch-card").forEach((c) => {
        c.classList.toggle("sel", c.dataset.arch === cleanName);
    });
}

let typeToken = 0;
let lastSpeech = Promise.resolve(); // completion of the previous narrated line
const spokenLines = {};
let liveCaptionPinned = false;

function activeSpeakerSnapshot() {
    const aw = state.activeWorker || {};
    const role = aw.role || "narrator";
    const defaultRoleName = ROLE_NAME[role] || role;
    const customLabel = (aw.displayName || "").trim();
    const hasCustomLabel = !!customLabel && customLabel !== defaultRoleName;
    const name = customLabel || defaultRoleName;
    const heroName = hasCustomLabel ? customLabel : (CAST_NAME[role] || defaultRoleName);
    const roleLabel = hasCustomLabel ? customLabel : defaultRoleName;
    return { role, name, heroName, roleLabel };
}

function rememberSpokenLine(text) {
    const speaker = activeSpeakerSnapshot();
    const key = speaker.name || speaker.heroName || speaker.role;
    if (!key || !text) return;
    spokenLines[key] = (spokenLines[key] || []).concat({ text, ts: Date.now(), role: speaker.role }).slice(-4);
}

// The speaker card: who is speaking this line. Pulls the active agent's role
// color, in-world name, and portrait so every line reads as coming from a card,
// not from a permanent subtitle slab.
function setNarrationSpeaker() {
    const line = $("narration-line");
    const chip = $("narration-speaker");
    const nameEl = $("narration-speaker-name");
    const roleEl = $("narration-speaker-role");
    const portrait = $("narration-portrait");
    if (!line || !chip) return;
    const speaker = activeSpeakerSnapshot();
    const role = speaker.role || "narrator";
    const color = ROLE_COLOR[role] || T.narrator;
    const portraitKey = ROLE_PORTRAIT[role] || "narrator";
    document.documentElement.style.setProperty("--spk", color);
    const alphaColor = color.startsWith("#") ? color + "26" : color;
    document.documentElement.style.setProperty("--spk-alpha", alphaColor);
    if (nameEl) nameEl.textContent = speaker.heroName;
    if (roleEl) roleEl.textContent = speaker.roleLabel || ROLE_NAME[role] || role;
    if (portrait) { portrait.style.display = ""; portrait.src = `/game/assets/generated/${portraitKey}.png`; }
    chip.hidden = false;
    setSceneStatus({ speaking: speaker.heroName || speaker.name || ROLE_NAME[role] || role });
}

function pinLiveAgentCaption(text) {
    const track = $("narration");
    const textEl = $("narration-text");
    if (!track || !textEl) return;
    setNarrationSpeaker();
    textEl.textContent = text || "";
    track.hidden = false;
    track.removeAttribute("aria-hidden");
    track.classList.add("show");
    track.classList.add("live");
    liveCaptionPinned = true;
    queueFooterAwareLayoutSync();
}

function clearLiveAgentCaption() {
    const track = $("narration");
    if (!track) return;
    track.classList.remove("live");
    liveCaptionPinned = false;
}

async function narrate(text, speed = 18, opts = {}) {
    const el = $("narration-text");
    const myToken = ++typeToken;
    // Let the previous line's voice finish its sentence before this beat cuts
    // in (capped so a hung element can never stall the loop). Player-driven
    // speech (dilemma picks) bypasses narrate and still interrupts instantly.
    if (A.speak) { await Promise.race([lastSpeech, sleep(9000)]); }
    if (myToken !== typeToken) return; // a newer beat superseded us while waiting
    // Speak the beat aloud in the active worker's voice (real Azure neural TTS,
    // browser TTS fallback). This also fills the air during slow live Foundry
    // calls, so latency reads as "the agent is thinking" rather than dead time.
    let speechP = Promise.resolve();
    if (A.speak) { try { speechP = A.speak(text, { voice: currentVoice }) || Promise.resolve(); } catch (e) { /* narration optional */ } }
    lastSpeech = speechP;
    // The live transcription lives in exactly one place: the temporary speaker
    // card above the hand. The card disappears after the line finishes, while
    // the text is retained on the agent's dossier.
    setNarrationSpeaker();
    clearLiveAgentCaption();
    // If a core game-master agent is talking - or any agent the caller flags as
    // the featured speaker (the group-chat stand-up does this) - pop its
    // character onto the stage with a live speech bubble (and any image this
    // beat carries). Plain worker chapters keep the reasoning theater instead.
    // When opts.into is given, the caption is typed straight into that element
    // (the transcript message card) - the single home for the line, so no
    // floating spotlight or center bar duplicates it.
    const into = opts.into || null;
    const spk = activeSpeakerSnapshot();
    const spotlight = !into && (opts.spotlight || SPOTLIGHT_ROLES.has(spk.role));
    if (spotlight) showSpeakerSpotlight(spk.role, spk.heroName, opts);
    else if (!into && opts.image) showSpeakerSpotlight(spk.role, spk.heroName, opts);
    // Single home for the live caption: when a spotlight card is up, the line
    // lives INSIDE that card, so the center narration bar stays hidden (showing
    // it too was the duplicate caption stacking over the worker rail). Worker
    // chapters have no spotlight, so the center bar is their caption.
    const track = $("narration");
    if (track) {
        if (spotlight || into) {
            track.classList.remove("show");
            track.hidden = true;
            track.setAttribute("aria-hidden", "true");
        } else {
            track.hidden = false;
            track.removeAttribute("aria-hidden");
            track.classList.add("show");
        }
        queueFooterAwareLayoutSync();
    }
    const target = into || el;
    target.innerHTML = "";
    const caret = document.createElement("span");
    caret.className = "caret";
    target.appendChild(caret);
    for (let i = 0; i < text.length; i++) {
        if (myToken !== typeToken) return;
        caret.insertAdjacentText("beforebegin", text[i]);
        if (spotlight) setSpeakerSpotlightLine(text.slice(0, i + 1));
        if (into && typeof opts.onType === "function") opts.onType();
        const ch = text[i];
        const d = ch === "." || ch === "," ? speed * 6 : speed;
        await sleep(d);
    }
    await sleep(450);
    if (myToken === typeToken && caret.parentNode) caret.remove();
    if (myToken === typeToken) {
        rememberSpokenLine(text);
        await sleep(900);
        const track = $("narration");
        if (track) {
            track.classList.remove("show");
            queueFooterAwareLayoutSync();
            setTimeout(() => {
                if (myToken === typeToken && !track.classList.contains("show")) {
                    const textEl = $("narration-text");
                    if (textEl) textEl.innerHTML = "";
                    const nameEl = $("narration-speaker-name");
                    const roleEl = $("narration-speaker-role");
                    if (nameEl) nameEl.textContent = "";
                    if (roleEl) roleEl.textContent = "";
                    track.hidden = true;
                    track.setAttribute("aria-hidden", "true");
                    queueFooterAwareLayoutSync();
                }
            }, 240);
        }
    }
    // Hold the beat until the voice finishes the line - the typewriter runs
    // ~3x faster than speech, and cutting the narrator mid-sentence was the
    // top playtest complaint. Capped, and abandoned if a newer beat starts.
    if (myToken === typeToken) {
        await Promise.race([speechP, sleep(Math.min(20000, 2500 + text.length * 75))]);
    }
}

async function announceAs(role, text, opts = {}) {
    const previousWorker = state.activeWorker ? Object.assign({}, state.activeWorker) : null;
    const previousVoice = currentVoice;
    state.activeWorker = {
        role,
        deployLabel: opts.deployLabel || "",
        stateText: "announcing",
        displayName: opts.displayName,
    };
    currentVoice = opts.voice || VOICE_BY_ROLE[role] || NARRATOR_VOICE;
    try {
        await narrate(text, opts.speed || 18, Object.assign({}, opts, { spotlight: true }));
    } finally {
        hideSpeakerSpotlight();
        state.activeWorker = previousWorker;
        currentVoice = previousVoice;
    }
}

function announceWorldState(text, role = "narrator", opts = {}) {
    return announceAs(role, text, opts);
}

function announceRival(text, rivalName) {
    return announceAs("rival", sanitizeAntagonistDesc(text), {
        displayName: rivalName || "The rival",
        voice: "echo",
        speed: 16,
    });
}

// --- Diagram rendering -----------------------------------------------------
let diagramSeq = 0;
// Single source of truth for compiling a Mermaid definition into an SVG string.
// Every diagram in the app - the world canvas, gate receipts, and inline
// transcript media - flows through here, so there is exactly one render path.
async function mermaidToSvg(def) {
    const id = `m${++diagramSeq}`;
    const { svg } = await mermaid.render(id, def);
    return svg;
}
async function renderMermaid(def) {
    const host = $("diagram");
    let svg;
    try {
        svg = await mermaidToSvg(def);
    } catch (e) {
        host.innerHTML = `<div style="color:${T.bad};font-family:${T.fontMono};font-size:12px">diagram error: ${e.message}</div>`;
        return;
    }
    const wrap = document.createElement("div");
    wrap.className = "draw fade-scene world-canvas";
    wrap.style.width = "100%";
    wrap.style.display = "flex";
    wrap.style.justifyContent = "center";
    wrap.innerHTML = svg;
    host.innerHTML = "";
    host.appendChild(wrap);
    // Stagger the entrance of nodes + edges so the graph "draws itself".
    const items = wrap.querySelectorAll(".node, .cluster, .edgePath, .flowchart-link, .edgeLabel");
    items.forEach((el, i) => {
        el.style.animationDelay = `${i * 75}ms`;
    });
    // tick per node revealed (Foundry-reasoning audio cue)
    const ticks = Math.min(items.length, 8);
    for (let i = 0; i < ticks; i++) {
        setTimeout(() => A.tick && A.tick(true), 220 + i * 75);
    }
}
// Render a Mermaid diagram inline into an arbitrary element (transcript media,
// inspector receipts) - reuses the one compile path, never touches #diagram.
async function renderMermaidInto(el, def) {
    if (!el) return false;
    try {
        el.innerHTML = await mermaidToSvg(def);
        return true;
    } catch (e) {
        el.innerHTML = `<div class="media-err">diagram unavailable</div>`;
        return false;
    }
}

function setSceneHead(beat, title, prov) {
    $("scene-beat").textContent = beat;
    $("scene-title").textContent = title;
    // Provenance chip: names WHO produced what is on stage and HOW, so the
    // audience never wonders whether a diagram is canned or agent-made.
    const p = $("scene-prov");
    if (p) {
        if (prov) { p.textContent = prov; p.hidden = false; }
        else { p.hidden = true; }
    }
    $("scene-head").classList.add("show");
}

// --- Artifact extractors (robust against varied live JSON shapes) ----------
function findKey(obj, names, depth = 0) {
    if (!obj || typeof obj !== "object" || depth > 5) return null;
    for (const n of names) {
        if (obj[n] != null) return obj[n];
    }
    for (const v of Object.values(obj)) {
        if (v && typeof v === "object") {
            const found = findKey(v, names, depth + 1);
            if (found != null) return found;
        }
    }
    return null;
}

function san(s) {
    return String(s).replace(/"/g, "'").replace(/[\[\]{}|<>]/g, "").slice(0, 42);
}

// org_chart can be {manager: [reports]}, [{role, reports}], or a layered
// {layer_1: [...], layer_2: {pod: [members]}} shape from the live strategist.
function orgChartMermaid(artifact) {
    const org = findKey(artifact, ["org_chart", "orgChart", "organization", "team_structure"]);
    if (!org) return null;
    const edges = [];
    const nodes = new Set();
    const addEdge = (a, b) => { if (a && b) { edges.push([a, b]); nodes.add(a); nodes.add(b); } };

    const looksLayered = org && typeof org === "object" && !Array.isArray(org) &&
        Object.keys(org).some((k) => /^layer[_ ]?\d/i.test(k));

    if (looksLayered) {
        // Ordered layers: connect each layer's roots to the next layer's groups.
        const layerKeys = Object.keys(org).filter((k) => /^layer[_ ]?\d/i.test(k)).sort();
        let prevRoots = [];
        layerKeys.forEach((lk) => {
            const layer = org[lk];
            const thisRoots = [];
            if (Array.isArray(layer)) {
                layer.forEach((m) => { const name = typeof m === "string" ? m : (m.role || m.name); if (name) { nodes.add(name); thisRoots.push(name); } });
            } else if (layer && typeof layer === "object") {
                // pods: { product_pod: [members] }
                Object.entries(layer).forEach(([pod, members]) => {
                    const podLabel = pod.replace(/_/g, " ");
                    nodes.add(podLabel);
                    thisRoots.push(podLabel);
                    (Array.isArray(members) ? members : []).forEach((m) => addEdge(podLabel, typeof m === "string" ? m : (m.role || m.name)));
                });
            }
            // wire previous layer roots to this layer's roots
            if (prevRoots.length) prevRoots.forEach((p) => thisRoots.forEach((t) => addEdge(p, t)));
            prevRoots = thisRoots.length ? thisRoots : prevRoots;
        });
    } else if (Array.isArray(org)) {
        org.forEach((row) => {
            const mgr = row.role || row.title || row.name || row.manager;
            const reports = row.reports || row.reportees || row.children || [];
            (Array.isArray(reports) ? reports : []).forEach((r) => addEdge(mgr, typeof r === "string" ? r : r.role || r.title || r.name));
            if (mgr && (!reports || reports.length === 0)) nodes.add(mgr);
        });
    } else if (typeof org === "object") {
        Object.entries(org).forEach(([mgr, reports]) => {
            if (typeof reports === "number" || typeof reports === "string") { nodes.add(mgr); return; }
            if (Array.isArray(reports)) reports.forEach((r) => addEdge(mgr, typeof r === "string" ? r : (r.role || r.title || r.name || "Role")));
            else if (reports && typeof reports === "object") Object.entries(reports).forEach(([sub, mem]) => {
                addEdge(mgr, sub.replace(/_/g, " "));
                (Array.isArray(mem) ? mem : []).forEach((m) => addEdge(sub.replace(/_/g, " "), typeof m === "string" ? m : (m.role || m.name)));
            });
            else nodes.add(mgr);
        });
    }
    if (nodes.size === 0) return null;
    const idOf = new Map();
    let n = 0;
    const nid = (label) => {
        if (!idOf.has(label)) idOf.set(label, `o${n++}`);
        return idOf.get(label);
    };
    let def = "graph TD\n";
    nodes.forEach((label) => { def += `  ${nid(label)}["${san(label)}"]\n`; });
    edges.forEach(([a, b]) => { def += `  ${nid(a)} --> ${nid(b)}\n`; });
    return def;
}

function integrationMermaid(artifact) {
    const integ = findKey(artifact, ["integrations", "integration_map", "systems", "architecture"]);
    if (!integ) return null;
    const edges = [];
    const nodes = new Set();
    if (Array.isArray(integ)) {
        integ.forEach((i) => {
            const name = typeof i === "string" ? i : (i.name || i.system || i.service);
            if (name) nodes.add(name);
            const conns = (typeof i === "object" && (i.connects_to || i.connections)) || [];
            (Array.isArray(conns) ? conns : []).forEach((c) => edges.push([name, typeof c === "string" ? c : c.name]));
        });
    } else if (typeof integ === "object") {
        Object.entries(integ).forEach(([sys, conns]) => {
            const sysLabel = sys.replace(/_/g, " ");
            nodes.add(sysLabel);
            if (Array.isArray(conns)) conns.forEach((c) => { const cl = typeof c === "string" ? c : (c.name || c.service || "node"); edges.push([sysLabel, cl]); nodes.add(cl); });
            else if (conns && typeof conns === "object") Object.entries(conns).forEach(([sub, mem]) => {
                const subLabel = sub.replace(/_/g, " ");
                edges.push([sysLabel, subLabel]); nodes.add(subLabel);
                (Array.isArray(mem) ? mem : []).forEach((m) => { const ml = typeof m === "string" ? m : (m.name || "node"); edges.push([subLabel, ml]); nodes.add(ml); });
            });
        });
    }
    if (nodes.size === 0) return null;
    const idOf = new Map();
    let n = 0;
    const nid = (l) => { if (!idOf.has(l)) idOf.set(l, `s${n++}`); return idOf.get(l); };
    let def = "graph TD\n";
    nodes.forEach((l) => { def += `  ${nid(l)}(["${san(l)}"])\n`; });
    edges.forEach(([a, b]) => { def += `  ${nid(a)} --- ${nid(b)}\n`; });
    return def;
}

function okrMermaid(artifact) {
    const okrs = findKey(artifact, ["okrs_q1", "okrs", "objectives"]);
    if (!Array.isArray(okrs) || okrs.length === 0) return null;
    let def = "graph TD\n  ROOT([\"Q1 OKRs\"])\n";
    okrs.slice(0, 3).forEach((o, i) => {
        const obj = o.objective || o.title || `Objective ${i + 1}`;
        def += `  ROOT --> O${i}["${san(obj)}"]\n`;
        const krs = o.key_results || o.keyResults || o.krs || [];
        (Array.isArray(krs) ? krs : []).slice(0, 3).forEach((kr, j) => {
            const t = typeof kr === "string" ? kr : (kr.text || kr.result || JSON.stringify(kr));
            def += `  O${i} --> K${i}_${j}("${san(t)}")\n`;
        });
    });
    return def;
}

// Financial plan -> animated SVG bar chart (Chart.js-free, zero deps)
function financialSvg(artifact) {
    const fin = findKey(artifact, ["financial_plan", "financials", "finance"]);
    const ramp = fin && findKey(fin, ["target_mrr_usd_m1_to_m6", "mrr", "mrr_ramp", "monthly_mrr"]);
    if (!Array.isArray(ramp) || ramp.length === 0) return null;
    const vals = ramp.map((v) => (typeof v === "number" ? v : parseFloat(v) || 0));
    const max = Math.max(...vals, 1);
    const W = 560, H = 300, pad = 44, bw = (W - pad * 2) / vals.length;
    const breakeven = fin.breakeven_month || fin.breakevenMonth;
    let bars = "";
    vals.forEach((v, i) => {
        const h = ((H - pad * 2) * v) / max;
        const x = pad + i * bw + 6;
        const y = H - pad - h;
        const isBE = breakeven && i === breakeven - 1;
        bars += `<rect x="${x}" y="${H - pad}" width="${bw - 12}" height="0" rx="4" fill="${isBE ? T.good : T.marketer}">
            <animate attributeName="height" from="0" to="${h}" dur="0.8s" begin="${i * 0.12}s" fill="freeze" calcMode="spline" keySplines="0.2 0.7 0.2 1"/>
            <animate attributeName="y" from="${H - pad}" to="${y}" dur="0.8s" begin="${i * 0.12}s" fill="freeze" calcMode="spline" keySplines="0.2 0.7 0.2 1"/>
        </rect>`;
        bars += `<text x="${x + (bw - 12) / 2}" y="${H - pad + 18}" fill="${T.inkDim}" font-size="11" font-family="${T.fontMono}" text-anchor="middle">M${i + 1}</text>`;
        bars += `<text x="${x + (bw - 12) / 2}" y="${y - 8}" fill="${T.ink}" font-size="11" font-family="${T.fontMono}" text-anchor="middle" opacity="0">$${(v / 1000).toFixed(1)}k<animate attributeName="opacity" from="0" to="1" dur="0.4s" begin="${i * 0.12 + 0.6}s" fill="freeze"/></text>`;
    });
    const burn = fin.burn_usd_per_month || fin.burn;
    const burnY = burn ? H - pad - ((H - pad * 2) * burn) / max : null;
    let burnLine = "";
    if (burnY != null) {
        burnLine = `<line x1="${pad}" y1="${burnY}" x2="${W - pad}" y2="${burnY}" stroke="${T.bad}" stroke-width="1.5" stroke-dasharray="5 5" opacity="0"><animate attributeName="opacity" from="0" to="0.8" dur="0.5s" begin="1s" fill="freeze"/></line>
        <text x="${W - pad}" y="${burnY - 6}" fill="${T.bad}" font-size="10" font-family="${T.fontMono}" text-anchor="end" opacity="0">burn $${(burn / 1000).toFixed(1)}k/mo<animate attributeName="opacity" from="0" to="1" dur="0.5s" begin="1.1s" fill="freeze"/></text>`;
    }
    return `<svg viewBox="0 0 ${W} ${H}" style="max-width:620px;width:100%">
        <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="${T.line}" stroke-width="1"/>
        <text x="${pad}" y="${pad - 14}" fill="${T.inkDim}" font-size="12" font-family="${T.fontDisplay}">MRR ramp - months 1 to ${vals.length}</text>
        ${bars}${burnLine}
    </svg>`;
}

function renderSvg(svgString) {
    const host = $("diagram");
    const wrap = document.createElement("div");
    wrap.className = "fade-scene world-canvas";
    wrap.style.width = "100%";
    wrap.style.display = "flex";
    wrap.style.justifyContent = "center";
    wrap.innerHTML = svgString;
    host.innerHTML = "";
    host.appendChild(wrap);
}

// The world canvas as a SCENARIO surface: before a worker's artifact renders,
// the center shows what this stage is about - the chapter goal, the success
// metric the agent is aiming for, and who owns it. This is the "show the player
// information about the scenario" beat - the middle is a stage, not a blank gap.
function renderScenarioCanvas(ch, ownerName) {
    const host = $("diagram");
    if (!host || !ch) return;
    const role = ch.owner_role || "narrator";
    const color = ROLE_COLOR[role] || T.narrator;
    const portrait = ROLE_PORTRAIT[role] || "narrator";
    const goal = esc(ch.goal || ch.title || "");
    const metric = esc(ch.success_metric || "");
    const tools = Array.isArray(ch.suggested_tools) ? ch.suggested_tools.slice(0, 5) : [];
    const toolChips = tools.length
        ? tools.map((t) => `<span class="sc-tool">${esc(t)}</span>`).join("")
        : "";
    host.innerHTML = `<div class="world-canvas scenario-canvas fade-scene" style="--sc-color:${color}">`
        + `<div class="scenario-card">`
        + `<div class="scenario-top">`
        + `<img class="scenario-face" src="/game/assets/generated/${portrait}.png" alt="" onerror="this.style.display='none'" />`
        + `<div><div class="scenario-kicker">Chapter ${state.idx + 1} &middot; ${esc(ROLE_NAME[role] || role)}</div>`
        + `<div class="scenario-owner">${esc(ownerName || ROLE_NAME[role] || role)}</div></div></div>`
        + `<div class="scenario-title">${esc(ch.title || "")}</div>`
        + (goal ? `<div class="scenario-row"><span class="sc-h">Goal</span><span class="sc-v">${goal}</span></div>` : "")
        + (metric ? `<div class="scenario-row"><span class="sc-h">Success metric</span><span class="sc-v">${metric}</span></div>` : "")
        + (toolChips ? `<div class="scenario-row"><span class="sc-h">Toolbox</span><span class="sc-tools">${toolChips}</span></div>` : "")
        + `<div class="scenario-foot">The worker is reasoning on Microsoft Foundry &mdash; its artifact lands here.</div>`
        + `</div></div>`;
}

// Pick the best diagram for a chapter's artifact + role.
function diagramForArtifact(role, artifact) {
    if (!artifact) return null;
    const tries = {
        strategist: [() => orgChartMermaid(artifact), () => okrMermaid(artifact)],
        designer: [() => integrationMermaid(artifact)],
        marketer: [() => ({ svg: financialSvg(artifact) }), () => gtmMermaid(artifact)],
        ops: [() => ({ svg: financialSvg(artifact) }), () => retentionMermaid(artifact)],
    };
    const order = tries[role] || [() => orgChartMermaid(artifact), () => integrationMermaid(artifact), () => ({ svg: financialSvg(artifact) })];
    for (const fn of order) {
        const out = fn();
        if (!out) continue;
        if (typeof out === "string") return { type: "mermaid", def: out };
        if (out.svg) return { type: "svg", svg: out.svg };
    }
    // last resort: any diagram
    const any = orgChartMermaid(artifact) || integrationMermaid(artifact) || okrMermaid(artifact);
    if (any) return { type: "mermaid", def: any };
    const fsvg = financialSvg(artifact);
    if (fsvg) return { type: "svg", svg: fsvg };
    return null;
}

function gtmMermaid(artifact) {
    const ch = findKey(artifact, ["gtm_channels", "channels", "gtm"]);
    if (!Array.isArray(ch) || ch.length === 0) return null;
    let def = "graph TD\n  G([\"Go-To-Market\"])\n";
    ch.slice(0, 5).forEach((c, i) => {
        const name = typeof c === "string" ? c : (c.channel || c.name || `Channel ${i + 1}`);
        const cac = typeof c === "object" ? (c.expected_cac_usd || c.cac) : null;
        const label = cac ? `${name} - CAC $${cac}` : name;
        def += `  G --> C${i}["${san(label)}"]\n`;
    });
    return def;
}

function retentionMermaid(artifact) {
    const loops = findKey(artifact, ["retention_loops", "loops"]);
    if (!Array.isArray(loops) || loops.length === 0) return null;
    let def = "graph TD\n  R([\"Retention\"])\n";
    loops.slice(0, 5).forEach((l, i) => { def += `  R --> L${i}["${san(typeof l === "string" ? l : (l.name || l.loop))}"]\n`; });
    return def;
}

// --- Company graph (grows as stages complete) ----------------------------
const completedStages = [];
function companyGraphDef() {
    let def = "graph TD\n  FOUNDER([\"Founder\"])\n";
    completedStages.forEach((c, i) => {
        const color = ROLE_COLOR[c.role] || T.blue;
        def += `  FOUNDER --> CH${i}["${san(c.title)}"]\n`;
        def += `  style CH${i} stroke:${color},stroke-width:2px\n`;
    });
    return def;
}

// =========================================================================
// Story controller
// =========================================================================
const state = {
    company: "",
    pitch: "",
    url: "",
    org: null,
    economics: null,
    game: null,      // authoritative card-building roguelike state from backend
    latestServerState: null,
    stages: [],
    decisions: [],   // CEO gate decisions (session memory ledger)
    playerCommands: [], // free-form CEO moves issued from the persistent footer input
    archetype: null, // {name, skill} - character creation, seeds the org brief
    fromFilm: false, // true when the intro film handed off - the welcome already happened
    idx: 0,
    phase: "title", // title | designed | running | done
    live: false,
    resources: {
        proof: 18,
        trust: 35,
        velocity: 42,
        burn: 12,
        autonomy: 8,
    },
};

function syncLatestState(s) {
    if (!s) return;
    state.latestServerState = s;
    if (s.org) state.org = s.org;
    if (s.economics) state.economics = s.economics;
    if (s.game) state.game = s.game;
    if (s.antagonist) state.antagonist = s.antagonist;
    if (s.world) {
        state.stages = Array.isArray(s.world.stages) ? s.world.stages : state.stages;
        state.decisions = Array.isArray(s.world.decisions) ? s.world.decisions : state.decisions;
    }
    syncCompanyContext(s);
}

const sceneStatus = {
    actor: "World Designer",
    speaking: "The Worldkeeper",
    source: "live session",
};

function cleanDeployLabel(label) {
    return /simulation/i.test(String(label || "")) ? "" : String(label || "");
}

function chapterProgressLabel() {
    const total = Array.isArray(state.stages) ? state.stages.length : 0;
    if (!total) return "1/1";
    const current = Math.min(total, Math.max(1, (Number(state.idx) || 0) + 1));
    return `${current}/${total}`;
}

function moneyCompact(value) {
    const n = Number(value) || 0;
    let sign = "";
    if (n > 0) sign = "+";
    else if (n < 0) sign = "-";
    const abs = Math.abs(n);
    let compact = String(abs);
    if (abs >= 1000) {
        const digits = abs >= 10000 ? 0 : 1;
        compact = `${(abs / 1000).toFixed(digits).replace(/\.0$/, "")}k`;
    }
    return `${sign}$${compact}`;
}

function runPulse(actionText = "") {
    const total = Array.isArray(state.stages) ? state.stages.length : 0;
    if (!total) return escText(actionText || "Enter a pitch to begin");

    const econ = state.economics || {};
    const game = state.game || {};
    const current = Math.min(total, Math.max(1, (Number(state.idx) || 0) + 1));
    const net = Number(econ.net_profit_usd || 0);
    const runwayDays = Number(econ.runway_days || 0);
    const threat = Number((game.antagonist_arc || {}).threat_level || 0);
    const completed = (state.stages || []).filter((s) => String(s.status || "").toLowerCase() === "completed").length;
    const rawRunStatus = String(game.run_status || "active").toLowerCase();
    const runStatus = rawRunStatus === "victory" && completed < total ? "active" : rawRunStatus;
    let label = "Stable";
    let tone = "stable";

    if (runStatus === "victory") {
        label = "Winning";
        tone = "good";
    } else if (runStatus === "defeat") {
        label = "Defeat risk hit";
        tone = "bad";
    } else if (threat >= 80) {
        label = "Rival closing in";
        tone = "bad";
    } else if (runwayDays > 0 && runwayDays <= 10) {
        label = "Cash at risk";
        tone = "bad";
    } else if (net < 0 || clamp(econ.burn_pressure) >= 65 || threat >= 55) {
        label = "At risk";
        tone = "warn";
    } else if (net > 0 && clamp(econ.proof) >= 30) {
        label = "Winning";
        tone = "good";
    }

    const runwayText = runwayDays > 0 && runwayDays < 999 ? ` · ${Math.round(runwayDays)}d runway` : "";
    const action = actionText ? `<span class="run-next">${escText(actionText)}</span>` : "";
    return `<span class="run-pulse"><span class="run-stage">Stage ${current}/${total}</span>`
        + `<span class="run-state ${tone}">${label} ${moneyCompact(net)}/mo${runwayText}</span>${action}</span>`;
}

function setActionHint(actionText = "") {
    const host = $("hint");
    if (!host) return;
    host.innerHTML = runPulse(actionText);
}

function setSceneStatus(patch) {
    if (patch && typeof patch === "object") Object.assign(sceneStatus, patch);
    const host = $("scene-status");
    if (!host) return;
    const progressEl = $("scene-progress");
    const actorEl = $("scene-actor");
    const speakingEl = $("scene-speaking");
    const sourceEl = $("scene-source");
    if (progressEl) progressEl.textContent = chapterProgressLabel();
    if (actorEl) actorEl.textContent = sceneStatus.actor || "World Designer";
    if (speakingEl) speakingEl.textContent = sceneStatus.speaking || sceneStatus.actor || "The Worldkeeper";
    if (sourceEl) sourceEl.textContent = sceneStatus.source || "live session";
    host.classList.add("show");
}

const RESOURCE_SPEC = {
    proof: { label: "Proof", color: T.good },
    trust: { label: "Trust", color: T.blueSoft },
    velocity: { label: "Velocity", color: T.marketer },
    burn: { label: "Burn", color: T.bad },
    autonomy: { label: "Autonomy", color: T.ops },
};

function clamp(n, min = 0, max = 100) {
    return Math.max(min, Math.min(max, Math.round(Number(n) || 0)));
}

function escText(s) {
    return String(s ?? "").replace(/[&<>"']/g, (ch) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
    }[ch]));
}

function fmtSigned(n) {
    const v = Number(n || 0);
    return `${v > 0 ? "+" : ""}${v}`;
}

function estimatedInvocationCost(inv) {
    const econ = state.economics || {};
    const org = state.org || {};
    const inPrice = Number(econ.worker_price_in_per_m || org.worker_price_in_per_m || 0);
    const outPrice = Number(econ.worker_price_out_per_m || org.worker_price_out_per_m || 0);
    const tokensIn = Number(inv && (inv.tokens_in ?? inv.tokensIn) || 0);
    const tokensOut = Number(inv && (inv.tokens_out ?? inv.tokensOut) || 0);
    const reasoning = Number(inv && (inv.reasoning_tokens ?? inv.reasoningTokens) || 0);
    if (!inPrice && !outPrice) return "";
    const usd = (tokensIn / 1_000_000) * inPrice + ((tokensOut + reasoning) / 1_000_000) * outPrice;
    if (!usd) return "$0.0000";
    return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

function invocationTokenLine(inv) {
    const tokensIn = Number(inv && (inv.tokens_in ?? inv.tokensIn) || 0);
    const tokensOut = Number(inv && (inv.tokens_out ?? inv.tokensOut) || 0);
    const reasoning = Number(inv && (inv.reasoning_tokens ?? inv.reasoningTokens) || 0);
    const parts = [];
    if (tokensIn) parts.push(`${tokensIn.toLocaleString()} in`);
    if (tokensOut) parts.push(`${tokensOut.toLocaleString()} out`);
    if (reasoning) parts.push(`${reasoning.toLocaleString()} thinking`);
    return parts.join(" / ") || "not reported";
}

let actionReceiptTimer = 0;
function showActionReceipt(title, chips = [], detail = "", tone = "good") {
    const host = $("player-command-status");
    if (!host) return;
    if (actionReceiptTimer) clearTimeout(actionReceiptTimer);
    const cls = ["cmd-status", "action-receipt", tone].filter(Boolean).join(" ");
    const chipHtml = chips.slice(0, 7).map((chip) => `<span>${escText(chip)}</span>`).join("");
    host.className = cls;
    host.innerHTML = `<b>${escText(title)}</b>${chipHtml ? `<div>${chipHtml}</div>` : ""}${detail ? `<em>${escText(detail)}</em>` : ""}`;
    actionReceiptTimer = setTimeout(() => {
        if (host.classList.contains("action-receipt")) {
            host.className = "cmd-status";
            host.innerHTML = "";
        }
    }, 9000);
}

const RECEIPT_LABELS = {
    proof: "proof",
    trust: "trust",
    velocity: "velocity",
    burn_pressure: "burn pressure",
    autonomy: "autonomy",
    runway_months: "runway",
};

function moveReceiptChips(move) {
    const effects = (move && move.effects_applied) || {};
    const chips = [];
    Object.entries(effects.economics_delta || {}).forEach(([key, val]) => {
        const label = RECEIPT_LABELS[key] || key.replace(/_/g, " ");
        chips.push(`${label} ${val.before}->${val.after} (${fmtSigned(val.delta)})`);
    });
    const threat = effects.antagonist_threat;
    if (threat && threat.before !== undefined && threat.after !== undefined) {
        chips.push(`rival ${threat.before}->${threat.after} (${fmtSigned(Number(threat.after) - Number(threat.before))})`);
    }
    const market = effects.market || {};
    if (market.market_share_before !== undefined && market.market_share_after !== undefined) {
        chips.push(`market ${Number(market.market_share_before).toFixed(1)}%->${Number(market.market_share_after).toFixed(1)}%`);
    }
    if (market.paying_customers !== undefined) {
        const gained = Number(market.customers_gained || 0);
        chips.push(`customers ${market.paying_customers}${gained ? ` (${fmtSigned(gained)})` : ""}`);
    }
    if (market.monthly_revenue_usd !== undefined) chips.push(`rev ${moneyCompact(Number(market.monthly_revenue_usd || 0))}/mo`);
    if (market.deal_cash_usd) chips.push(`cash ${moneyCompact(Number(market.deal_cash_usd || 0))}`);
    const party = effects.party;
    if (party && party.before && party.after) {
        const name = party.after.title || "worker";
        if (party.before.fatigue !== party.after.fatigue) chips.push(`${name} fatigue ${party.before.fatigue}->${party.after.fatigue}`);
        if (party.before.morale !== party.after.morale) chips.push(`${name} morale ${party.before.morale}->${party.after.morale}`);
    }
    if (Array.isArray(effects.drawn) && effects.drawn.length) chips.push(`drew ${effects.drawn.length}`);
    if (Array.isArray(effects.next_drawn) && effects.next_drawn.length) chips.push(`new hand ${effects.next_drawn.length}`);
    if (effects.destination) chips.push(`to ${effects.destination}`);
    return chips;
}

function completedStageCount() {
    return (state.stages || []).filter((stage) => String(stage.status || "").toLowerCase() === "completed").length;
}

function roleTitleForNeed(org, keys, fallback, run = null) {
    const roles = (org && Array.isArray(org.roles)) ? org.roles : [];
    const found = roles.find((role) => {
        const hay = `${role.title || ""} ${role.deployment_hint || ""} ${role.lifecycle_stage || ""} ${(role.kpis || []).join(" ")}`.toLowerCase();
        return keys.some((key) => hay.includes(key));
    });
    if (found && found.title) return found.title;
    const stages = ((run && run.world && Array.isArray(run.world.stages)) ? run.world.stages : state.stages) || [];
    const stage = stages.find((item) => {
        const hay = `${item.assigned_worker_title || ""}`.toLowerCase();
        return keys.some((key) => hay.includes(key));
    });
    return (stage && (stage.assigned_worker_title || ROLE_NAME[stage.owner_role])) || fallback;
}

function ventureModelData(run = null) {
    const snap = run || state.latestServerState || {};
    const sections = snap.venture_model && snap.venture_model.sections;
    if (sections) {
        const section = (key) => sections[key] || {};
        return {
            company: section("company").value || snap.name || state.company || "Company",
            offer: section("offer").value || "Product/service not defined",
            customer: section("customer").value || "Target customer not defined",
            model: section("business_model").value || "Business model pending",
            revenueShort: section("revenue_model").value || "Not priced yet",
            revenueDetail: section("revenue_model").detail || section("revenue_model").value || "No revenue model yet.",
            builder: section("build_owner").value || "No product owner",
            growth: section("sell_owner").value || "No revenue owner",
            ops: section("ops_owner").value || "No delivery owner",
            antagonist: section("rival").value || "The rival",
            sources: {
                company: section("company").source,
                offer: section("offer").source,
                customer: section("customer").source,
                model: section("business_model").source,
                revenue: section("revenue_model").source,
                build: section("build_owner").source,
                sell: section("sell_owner").source,
                ops: section("ops_owner").source,
                rival: section("rival").source,
            },
            meanings: {
                company: section("company").meaning,
                offer: section("offer").meaning,
                customer: section("customer").meaning,
                model: section("business_model").meaning,
                revenue: section("revenue_model").meaning,
                build: section("build_owner").meaning,
                sell: section("sell_owner").meaning,
                ops: section("ops_owner").meaning,
                rival: section("rival").meaning,
            },
            statuses: {
                build: section("build_owner").status,
                sell: section("sell_owner").status,
                ops: section("ops_owner").status,
            },
        };
    }
    const profile = snap.founder_profile || (state.preflight && state.preflight.ares && state.preflight.ares.profile) || {};
    const org = snap.org || state.org || {};
    const antagonist = (snap.antagonist && snap.antagonist.name) || ((snap.game || state.game || {}).antagonist_arc || {}).antagonist_name || "The rival";
    const offer = profile.what_they_sell || profile.company_summary || org.company_summary || state.pitch || "the product/service is not defined yet";
    const customer = profile.target_customer || (snap.antagonist && snap.antagonist.target_customer_overlap) || "the target customer is not defined yet";
    const model = profile.business_model || org.operating_model || "business model pending";
    const builder = roleTitleForNeed(org, ["builder", "designer", "engineer", "product", "mvp", "search"], "No product owner", snap);
    const growth = roleTitleForNeed(org, ["growth", "sales", "gtm", "closer", "marketer"], "No revenue owner", snap);
    const ops = roleTitleForNeed(org, ["ops", "operation", "retention", "support", "success", "take"], "No delivery owner", snap);
    // Revenue model, made concrete from live economics: how money actually comes
    // in (price per customer) and what that adds up to right now. This is the
    // "how do we make money" answer the HUD numbers were missing context for.
    const econ = snap.economics || state.economics || {};
    const arpu = Number(econ.arpu_usd || 0);
    const rev = Number(econ.monthly_revenue_usd || 0);
    const customers = Number(econ.paying_customers || 0);
    const revenueShort = arpu > 0 ? `$${arpu.toLocaleString()}/customer \u00b7 mo` : "Not priced yet";
    const revenueDetail = arpu > 0
        ? `Recurring: $${arpu.toLocaleString()}/customer/mo \u00d7 ${customers.toLocaleString()} paying = $${rev.toLocaleString()}/mo today. Win more customers by shipping verified stages.`
        : "Recurring per-customer pricing; nothing sold yet, so revenue is $0/mo until a stage ships and a customer is won.";
    return { company: snap.name || state.company || "Company", offer, customer, model, revenueShort, revenueDetail, builder, growth, ops, antagonist };
}

// One source of truth for what each company-context section MEANS, so the
// footer dashboard and the canvas venture model teach the same definitions
// (business model vs revenue model, who builds vs who sells, etc.).
const COMPANY_CONTEXT_META = {
    company: "The venture you are building this run - every move ladders up to this one company.",
    offer: "Offer - the product or service the company actually sells.",
    customer: "Customer - the specific people or orgs the offer is sold to.",
    model: "Business model - how the company is structured to create, deliver, and defend value.",
    revenue: "Revenue model - how money actually comes in: price per customer x paying customers = monthly revenue.",
    build: "Build - the worker accountable for making the product/service exist.",
    sell: "Sell - the worker who owns market share and revenue.",
    ops: "Ops - the worker who runs delivery and keeps customers.",
    rival: "Rival - the antagonist market logic pressuring the run; counter it with proof, trust, shipping, and counterplay cards.",
};

const COMPANY_CONTEXT_SOURCE = {
    company: "Source: World Designer / saved run state.",
    offer: "Source: Founder Analyst profile fields, then Org Designer summary fallback.",
    customer: "Source: Founder Analyst target customer, with antagonist overlap as fallback.",
    model: "Source: Founder Analyst business_model, then Org Designer operating model fallback.",
    revenue: "Source: live economics: ARPU, paying customers, and monthly revenue.",
    build: "Source: current org + World Designer stage ownership. If missing, the workforce has no product owner right now.",
    sell: "Source: current org + World Designer stage ownership. If missing, no worker owns revenue right now.",
    ops: "Source: current org + World Designer stage ownership. This owner runs delivery and retention.",
    rival: "Source: Antagonist Generator + current antagonist arc.",
};

function companyContextTip(label, meaning, value, detail, source) {
    return `${label}\nWhat: ${meaning}\nValue: ${detail || value}\n${source}`;
}

function ventureModelHTML(run = null) {
    const vm = ventureModelData(run);
    const M = COMPANY_CONTEXT_META;
    const S = COMPANY_CONTEXT_SOURCE;
    // Honor server-supplied per-key meanings/sources when present, exactly like
    // the footer's syncCompanyContext, so both surfaces teach the same definitions.
    const meaning = (key) => (vm.meanings && vm.meanings[key]) || M[key];
    const source = (key) => (vm.sources && vm.sources[key]) || S[key];
    const cell = (cls, label, key, value, detail) => {
        const tip = escText(companyContextTip(label, meaning(key), value, detail, source(key)));
        return `<div${cls ? ` class="${cls}"` : ""} data-move-tip="${tip}" tabindex="0" role="button" aria-label="${tip}"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;
    };
    return `<div class="venture-model" aria-label="Venture model">`
        + cell("", "Offer", "offer", vm.offer)
        + cell("", "Customer", "customer", vm.customer)
        + cell("", "Business model", "model", vm.model)
        + cell("", "Revenue model", "revenue", vm.revenueShort, vm.revenueDetail)
        + cell("", "Build", "build", vm.builder)
        + cell("", "Sell", "sell", vm.growth)
        + cell("", "Operate", "ops", vm.ops)
        + cell("rival", "Rival", "rival", vm.antagonist)
        + `</div>`;
}

// The run-resume splash: instead of repeating the venture-model tiles (the
// footer's company-context strip already shows those), show the actual run
// progress - each Story Circle stage, what is shipped, and which stage is next.
// This is the one place the resumed player sees the shape of their run.
function resumeStageGrid(stages) {
    const list = Array.isArray(stages) ? stages : [];
    if (!list.length) return "";
    const firstIncomplete = list.findIndex((s) => String(s.status || "").toLowerCase() !== "completed");
    return `<div class="resume-stages" aria-label="Run progress">`
        + list.map((s, i) => {
            const status = String(s.status || "").toLowerCase();
            const done = status === "completed";
            const isNext = i === firstIncomplete;
            const title = String(s.title || `Stage ${i + 1}`);
            const split = title.split(/:\s*/);
            const beat = split.length > 1 ? split[0] : `Stage ${i + 1}`;
            const name = split.length > 1 ? split.slice(1).join(": ") : title;
            const cls = ["resume-stage", done ? "rs-done" : "", isNext ? "rs-next" : ""].filter(Boolean).join(" ");
            const mark = done ? `<span class="rs-status">\u2713</span>`
                : (isNext ? `<span class="rs-status rs-cur">\u25b6</span>` : `<span class="rs-status" style="color:var(--ink-faint)">\u00b7</span>`);
            return `<div class="${cls}"><span class="rs-beat">${esc(beat)}</span>`
                + `<span class="rs-title">${esc(name)}</span>${mark}</div>`;
        }).join("")
        + `</div>`;
}

function syncCompanyContext(run = null) {
    const host = $("company-context");
    if (!host) return;
    const hasWorld = Array.isArray(state.stages) && state.stages.length > 0;
    if (!hasWorld && !state.company && !(run && run.name)) {
        host.hidden = true;
        host.innerHTML = "";
        return;
    }
    const vm = ventureModelData(run);
    const M = COMPANY_CONTEXT_META;
    const S = COMPANY_CONTEXT_SOURCE;
    const gap = (value, key) => ((vm.statuses && vm.statuses[key] === "gap") || /^No\s/i.test(String(value || ""))) ? " gap" : "";
    const meaning = (key, fallback) => (vm.meanings && vm.meanings[key]) || fallback;
    const source = (key) => (vm.sources && vm.sources[key]) || S[key];
    // One tile grammar: label + value + a tooltip that teaches the concept AND
    // shows the full (untruncated) value. Owners flag gaps; rival reads red.
    const tile = (cls, key, label, value, meaningText, detail) => {
        const tip = companyContextTip(label, meaningText, value, detail, source(key));
        return `<div class="ccx-tile${cls ? " " + cls : ""}" data-move-tip="${escText(tip)}" tabindex="0" role="button" aria-label="${escText(tip)}"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;
    };
    host.hidden = false;
    host.innerHTML = tile("lead", "company", "Company", vm.company, meaning("company", M.company))
        + tile("", "offer", "Offer", vm.offer, meaning("offer", M.offer))
        + tile("", "customer", "Customer", vm.customer, meaning("customer", M.customer))
        + tile("", "model", "Business model", vm.model, meaning("model", M.model))
        + tile("", "revenue", "Revenue model", vm.revenueShort, meaning("revenue", M.revenue), vm.revenueDetail)
        + tile("owner" + gap(vm.builder, "build"), "build", "Build", vm.builder, meaning("build", M.build))
        + tile("owner" + gap(vm.growth, "sell"), "sell", "Sell", vm.growth, meaning("sell", M.sell))
        + tile("owner" + gap(vm.ops, "ops"), "ops", "Ops", vm.ops, meaning("ops", M.ops))
        + tile("rival", "rival", "Rival", vm.antagonist, meaning("rival", M.rival));
    bindMoveTooltips(host);
}

function renderResources() {
    const host = $("resources");
    if (host) {
        host.innerHTML = Object.entries(RESOURCE_SPEC).map(([key, spec]) => {
            const val = clamp(state.resources[key]);
            return `<div class="meter" title="${spec.label}: ${val}/100">`
                + `<div class="meter-top"><span>${spec.label}</span><b>${val}</b></div>`
                + `<div class="meter-track"><span class="meter-fill" style="width:${val}%;background:${spec.color}"></span></div>`
                + `</div>`;
        }).join("");
    }
    if ($("party")) setParty(state.activePartyKey, state.activePartyLine, state.activePartyName);
}

function nudgeResources(delta) {
    Object.entries(delta || {}).forEach(([k, v]) => {
        if (k in state.resources) state.resources[k] = clamp(state.resources[k] + v);
    });
    renderResources();
}

function setResourcesFromOrg(org) {
    const workerCount = Number(org && org.digital_worker_count) || 0;
    const burn = Number(org && org.monthly_burn_usd) || 0;
    state.resources = {
        proof: 24,
        trust: 38,
        velocity: clamp(38 + workerCount * 5),
        burn: clamp(10 + burn / 95),
        autonomy: clamp(14 + workerCount * 10),
    };
    state.economics = {
        proof: state.resources.proof,
        trust: state.resources.trust,
        velocity: state.resources.velocity,
        burn_pressure: state.resources.burn,
        autonomy: state.resources.autonomy,
        monthly_burn_usd: burn,
        runway_months: Math.max(3, 10 - Math.round(burn / 2500)),
        digital_worker_count: workerCount,
        leverage_ratio: org ? org.leverage_ratio : 0,
        monthly_revenue_usd: 0,
        net_profit_usd: -burn,
        points: 25000,
    };
    renderResources();
}

function setResourcesFromEconomics(economics, org) {
    if (!economics) {
        if (org) setResourcesFromOrg(org);
        return;
    }
    state.economics = economics;
    state.resources = {
        proof: clamp(economics.proof),
        trust: clamp(economics.trust),
        velocity: clamp(economics.velocity),
        burn: clamp(economics.burn_pressure),
        autonomy: clamp(economics.autonomy),
    };
    renderResources();
    // Single seam: every economics update (card play, reward, decision, tick)
    // also refreshes the footer econ HUD so Treasury/Market/Rev/threat pills
    // never lag behind the numbers the player just changed.
    setEconHud(org || state.org);
}

function cardEffectLine(card) {
    const effects = card && card.effects ? card.effects : {};
    const parts = [];
    const econ = effects.economics_delta || {};
    Object.entries(econ).forEach(([key, value]) => {
        const signed = Number(value) > 0 ? `+${value}` : `${value}`;
        parts.push(`${signed} ${key.replace(/_/g, " ")}`);
    });
    if (effects.antagonist_threat_delta) {
        const v = Number(effects.antagonist_threat_delta);
        parts.push(`${v > 0 ? "+" : ""}${v} threat`);
    }
    if (effects.market_share_delta) {
        const v = Number(effects.market_share_delta);
        parts.push(`${v > 0 ? "+" : ""}${v}% customers`);
    }
    if (effects.draw) parts.push(`draw ${effects.draw}`);
    if (effects.party && effects.party.fatigue) parts.push(`fatigue +${effects.party.fatigue}`);
    return parts.join(" / ") || card.description || card.kind || "card";
}

// Card design: one place that maps a card's kind to its accent color/label, its
// raw effects to color-coded consequence chips, and its source to a provenance
// line. The hand and the reward draft both read from these - one grammar.
const CARD_KIND_META = {
    proof:       { label: "proof",   accent: "#34d399", soft: "rgba(52,211,153,0.12)" },
    worker:      { label: "worker",  accent: "#2dd4bf", soft: "rgba(45,212,191,0.12)" },
    counterplay: { label: "counter", accent: "#fb7185", soft: "rgba(251,113,133,0.12)" },
    tactic:      { label: "tactic",  accent: "#5b8cff", soft: "rgba(91,140,255,0.12)" },
    resource:    { label: "resource", accent: "#f4c95d", soft: "rgba(244,201,93,0.12)" },
};
function cardKindMeta(kind) {
    return CARD_KIND_META[kind] || { label: kind || "card", accent: "#94a3b8", soft: "rgba(148,163,184,0.12)" };
}

const CARD_TERM_MEANING = {
    proof: "Proof is evidence your venture can work.",
    trust: "Trust is public confidence and buyer belief.",
    velocity: "Velocity is how fast the team can ship the next stage.",
    burn_pressure: "Burn pressure is operational strain; lower is better.",
    autonomy: "Autonomy is how much freedom the founder keeps.",
    threat: "Threat is the rival's pressure; at 100 the run is lost.",
    market: "Customers grow revenue through market share.",
    draw: "Draw adds more card options this turn.",
    fatigue: "Fatigue makes the workforce harder to push later.",
};

function cardTermLine(card) {
    const effects = card && card.effects ? card.effects : {};
    const terms = new Set();
    Object.keys(effects.economics_delta || {}).forEach((key) => terms.add(key));
    if (effects.antagonist_threat_delta) terms.add("threat");
    if (effects.market_share_delta) terms.add("market");
    if (effects.draw) terms.add("draw");
    if (effects.party && effects.party.fatigue) terms.add("fatigue");
    return Array.from(terms).slice(0, 3).map((term) => CARD_TERM_MEANING[term]).filter(Boolean).join(" ");
}

function cardUseCase(card) {
    const effects = card && card.effects ? card.effects : {};
    const econ = effects.economics_delta || {};
    if (Number(effects.antagonist_threat_delta || 0) < 0) return "the rival's threat is climbing or you need to protect the run before the next stage.";
    if (Number(effects.market_share_delta || 0) > 0) return "you want customers and revenue now, especially before burn or threat gets louder.";
    if (Number(econ.proof || 0) > 0 && Number(econ.trust || 0) > 0) return "the next gate needs both evidence and confidence from the market.";
    if (Number(econ.velocity || 0) > 0) return "you need tempo this turn and can afford the listed cost or fatigue.";
    if (Number(econ.autonomy || 0) > 0) return "you want the digital workforce to carry more of the operating load.";
    if (Number(econ.burn_pressure || 0) < 0) return "strain is creeping up and you want the company to run cleaner.";
    if (effects.draw) return "you need more options before committing to a larger play.";
    return "its listed meters are the ones you most need to move right now.";
}

function cardMoveTooltip(card, opts = {}) {
    if (!card) return "";
    const cost = Number(card.cost || 0);
    const lines = [card.name || "Move"];
    if (opts.lockReason) lines.push(`Locked: ${opts.lockReason}`);
    lines.push(`Result: ${cardEffectLine(card)}${card.upgraded ? " / upgraded" : ""}${card.exhausts ? " / exhausts" : ""}.`);
    if (card.description) lines.push(`Move: ${card.description}`);
    const terms = cardTermLine(card);
    if (terms) lines.push(`Means: ${terms}`);
    lines.push(`Use when: ${cardUseCase(card)}`);
    lines.push(`Cost: ${cost} energy. Source: ${cardSourceLine(card)}.`);
    return lines.join("\n");
}

let moveTooltipEl = null;

function ensureMoveTooltip() {
    if (moveTooltipEl) return moveTooltipEl;
    moveTooltipEl = document.createElement("div");
    moveTooltipEl.id = "move-tooltip";
    moveTooltipEl.className = "move-tooltip";
    moveTooltipEl.setAttribute("role", "tooltip");
    moveTooltipEl.hidden = true;
    document.body.appendChild(moveTooltipEl);
    document.addEventListener("pointerdown", (event) => {
        if (!event.target.closest("[data-move-tip]")) hideMoveTooltip();
    });
    window.addEventListener("resize", () => hideMoveTooltip());
    return moveTooltipEl;
}

function positionMoveTooltip(anchor, tooltip) {
    const rect = anchor.getBoundingClientRect();
    const tipRect = tooltip.getBoundingClientRect();
    const margin = 12;
    let left = rect.left + (rect.width / 2) - (tipRect.width / 2);
    left = Math.max(margin, Math.min(left, window.innerWidth - tipRect.width - margin));
    let top = rect.top - tipRect.height - 10;
    if (top < margin) top = Math.min(window.innerHeight - tipRect.height - margin, rect.bottom + 10);
    tooltip.style.left = `${Math.max(margin, left)}px`;
    tooltip.style.top = `${Math.max(margin, top)}px`;
}

function showMoveTooltip(anchor) {
    if (!anchor || !anchor.dataset.moveTip) return;
    const tooltip = ensureMoveTooltip();
    const lines = anchor.dataset.moveTip.split("\n").filter(Boolean);
    tooltip.innerHTML = lines.map((line, index) => index === 0
        ? `<b>${escText(line)}</b>`
        : `<span>${escText(line)}</span>`).join("");
    tooltip.hidden = false;
    anchor.setAttribute("aria-describedby", "move-tooltip");
    requestAnimationFrame(() => positionMoveTooltip(anchor, tooltip));
}

function hideMoveTooltip(anchor) {
    if (anchor && typeof anchor.removeAttribute === "function") anchor.removeAttribute("aria-describedby");
    if (moveTooltipEl) moveTooltipEl.hidden = true;
}

function bindMoveTooltips(host) {
    if (!host || host.dataset.moveTooltipsBound) return;
    host.dataset.moveTooltipsBound = "1";
    host.addEventListener("pointerover", (event) => {
        const anchor = event.target.closest("[data-move-tip]");
        if (anchor && host.contains(anchor)) showMoveTooltip(anchor);
    });
    host.addEventListener("pointerout", (event) => {
        const anchor = event.target.closest("[data-move-tip]");
        if (!anchor) return;
        requestAnimationFrame(() => {
            const focused = document.activeElement === anchor || anchor.contains(document.activeElement);
            if (!anchor.matches(":hover") && !focused) hideMoveTooltip(anchor);
        });
    });
    host.addEventListener("focusin", (event) => showMoveTooltip(event.target.closest("[data-move-tip]")));
    host.addEventListener("focusout", (event) => {
        const anchor = event.target.closest("[data-move-tip]");
        if (!anchor) return;
        requestAnimationFrame(() => {
            if (!anchor.matches(":hover") && document.activeElement !== anchor) hideMoveTooltip(anchor);
        });
    });
    host.addEventListener("click", (event) => {
        if (!event.target.closest("[data-move-help]")) return;
        event.preventDefault();
        event.stopPropagation();
        showMoveTooltip(event.target.closest("[data-move-tip]"));
    }, true);
}

// Meters where "up" helps the company; burn_pressure is the inverse (down good).
const CARD_GOOD_UP = new Set(["proof", "trust", "velocity", "autonomy", "market"]);
function cardEffectChips(card) {
    const effects = card && card.effects ? card.effects : {};
    const econ = effects.economics_delta || {};
    const chips = [];
    Object.entries(econ).forEach(([key, value]) => {
        const v = Number(value);
        const signed = v > 0 ? `+${v}` : `${v}`;
        let cls = "util";
        if (key === "burn_pressure") cls = v <= 0 ? "gain" : "cost";
        else if (CARD_GOOD_UP.has(key)) cls = v >= 0 ? "gain" : "cost";
        chips.push(`<span class="gc-chip ${cls}">${signed} ${escText(key.replace(/_/g, " "))}</span>`);
    });
    if (effects.antagonist_threat_delta) {
        const v = Number(effects.antagonist_threat_delta);
        chips.push(`<span class="gc-chip ${v < 0 ? "threat-down" : "threat-up"}">${v > 0 ? "+" : ""}${v} threat</span>`);
    }
    if (effects.market_share_delta) {
        const v = Number(effects.market_share_delta);
        chips.push(`<span class="gc-chip ${v >= 0 ? "gain" : "cost"}">${v > 0 ? "+" : ""}${v}% customers</span>`);
    }
    if (effects.draw) chips.push(`<span class="gc-chip util">draw ${Number(effects.draw)}</span>`);
    if (effects.party && effects.party.fatigue) chips.push(`<span class="gc-chip cost">fatigue +${Number(effects.party.fatigue)}</span>`);
    if (!chips.length) chips.push(`<span class="gc-chip">${escText(card.description || card.kind || "card")}</span>`);
    return chips.join("");
}

// Provenance: name the agent/seam a card came from so the deck reads as the
// product of the run - reward cards say which worker forged them, starters say
// they came with the founder. Closes the dynamics<->reasoning loop on the face.
function workerTitleById(id) {
    if (!id) return "";
    const roles = (state.org && state.org.roles) || [];
    const r = roles.find((x) => x.id === id);
    return r ? r.title : "";
}
function cardSourceLine(card) {
    const src = card && card.source;
    if (src === "stage_reward") {
        const who = workerTitleById(card.owner_worker_id);
        return who ? `forged by ${who}` : "stage reward";
    }
    if (src === "choice_reward") return "from your decision";
    if (src === "founder") return "your signature move";
    return "starter deck";
}

let rewardResolve = null;

// The stage-layer coordinator (setStageLayer / stageLayerActive) and the
// footer-aware lower-band layout (syncFooterAwareLayout / queueFooterAwareLayoutSync
// / ensureFooterLayoutObserver) now live in ./layout.js, imported at the top.
// They are the single owner of the screen's lower band: keeping the world
// canvas, party hand, and narration caption from fighting each other as overlay
// layers open and the footer resizes.

function renderGameHand(game) {
    const host = $("card-hand");
    if (!host) return;
    if (!game || state.phase === "done" || state.phase === "arc-complete" || state.phase === "running" || String(game.run_status || "active").toLowerCase() !== "active") {
        host.hidden = true;
        host.innerHTML = "";
        host.classList.remove("reward-draft");
        queueFooterAwareLayoutSync();
        return;
    }
    const hand = Array.isArray(game.hand) ? game.hand : [];
    const pending = Array.isArray(game.pending_rewards) ? game.pending_rewards : [];
    host.hidden = false;
    host.classList.remove("reward-draft");
    const energy = Number(game.energy || 0);
    const maxEnergy = Number(game.max_energy ?? 0);
    const threat = Number((game.antagonist_arc || {}).threat_level || 0);
    const shippedStages = completedStageCount();
    const cardLockReason = (card) => {
        if (Number(((card && card.effects) || {}).market_share_delta || 0) && shippedStages <= 0) {
            return "Ship one stage first - there is no product or service to sell yet.";
        }
        const cost = Number((card && card.cost) || 0);
        return cost > energy ? `Needs ${cost} energy - you have ${energy}. End turn to refresh.` : "";
    };
    // Out of juice for this hand: every card costs more than we can pay. The
    // hand never dead-ends - End Turn refreshes it - so we surface that path
    // instead of leaving the player staring at greyed-out cards.
    const tapped = hand.length > 0 && !hand.some((c) => !cardLockReason(c));
    const statCls = ["hand-stat", tapped ? "tapped" : ""].filter(Boolean).join(" ");
    const stats = `<div class="${statCls}"><b>${energy}/${maxEnergy}</b> energy<span>deck ${game.deck ? game.deck.length : 0} &middot; discard ${game.discard ? game.discard.length : 0}</span>${tapped ? `<span class="hand-tapped">out of energy &middot; end turn to refresh</span>` : (pending.length ? `<span>draft ${pending.length} ready</span>` : "")}</div>`;
    const cards = hand.map((card) => {
        const cost = Number(card.cost || 0);
        const lockReason = cardLockReason(card);
        const affordable = !lockReason;
        const meta = cardKindMeta(card.kind);
        // Teach the antagonist loop: when the rival is closing in, the cards
        // that push threat back pulse so the player learns the counter.
        const counterHot = card.kind === "counterplay" && threat >= 45 && affordable;
        const cls = ["game-card-btn", counterHot ? "counter-hot" : ""].filter(Boolean).join(" ");
        const tip = cardMoveTooltip(card, { lockReason });
        return `<button class="${cls}" type="button" data-card-id="${escText(card.id)}" data-move-tip="${escText(tip)}" ${affordable ? "" : `aria-disabled="true"`} style="--gc-accent:${meta.accent};--gc-soft:${meta.soft}" title="${escText(tip)}">
            <span class="game-card-top"><span class="gc-kind">${escText(meta.label)}</span><span class="gc-cost-row"><span class="gc-help" data-move-help="1" aria-hidden="true">?</span><span class="game-card-cost">${cost}</span></span></span>
            <span class="game-card-name">${escText(card.name)}</span>
            <span class="gc-effects">${cardEffectChips(card)}</span>
            <span class="gc-source">${escText(cardSourceLine(card))}${card.upgraded ? " &middot; upgraded" : ""}</span>
        </button>`;
    }).join("");
    // End Turn is always available while there is a hand: refreshing refills
    // energy but lets the rival press, so it stays a real choice rather than a
    // free reset. This is the affordance that makes energy legible.
    const endTurnTip = "End turn\nResult: discard your hand, refill energy, and draw fresh cards.\nMeans: the rival presses while you regroup, so threat can rise.\nUse when: you are out of energy, your hand is weak, or you need a clean draw before the next stage.";
    const endTurn = hand.length
        ? `<button class="end-turn-btn${tapped ? " urgent" : ""}" type="button" data-end-turn="1" data-move-tip="${escText(endTurnTip)}" title="${escText(endTurnTip)}">
            <span class="et-label">End turn <span class="gc-help" data-move-help="1" aria-hidden="true">?</span></span>
            <span class="et-sub">refresh hand &middot; rival presses</span>
        </button>`
        : "";
    const draftTip = pending.length
        ? `Draft ready\nResult: choose one of ${pending.length} reward cards to add to your deck.\nMeans: reward cards are forged from the worker's real stage receipts.\nUse when: you want to bank this stage and shape future turns.`
        : "";
    const draft = pending.length
        ? `<button class="game-card-btn pending" type="button" data-open-reward="1" data-move-tip="${escText(draftTip)}" style="--gc-accent:#f4c95d;--gc-soft:rgba(244,201,93,0.12)" title="${escText(draftTip)}">
            <span class="game-card-top"><span class="gc-kind">reward</span><span class="gc-cost-row"><span class="gc-help" data-move-help="1" aria-hidden="true">?</span><span class="game-card-cost">${pending.length}</span></span></span>
            <span class="game-card-name">Draft ready</span>
            <span class="gc-effects"><span class="gc-chip util">choose 1 of ${pending.length}</span></span>
            <span class="gc-source">forged from this stage</span>
        </button>`
        : "";
    host.innerHTML = stats + cards + endTurn + draft;
    bindMoveTooltips(host);
    host.querySelectorAll("[data-card-id]").forEach((btn) => {
        btn.addEventListener("click", () => {
            if (btn.getAttribute("aria-disabled") === "true") {
                showMoveTooltip(btn);
                return;
            }
            playGameCard(btn.dataset.cardId);
        });
    });
    const endTurnBtn = host.querySelector("[data-end-turn]");
    if (endTurnBtn) endTurnBtn.addEventListener("click", () => endGameTurn());
    const draftBtn = host.querySelector("[data-open-reward]");
    if (draftBtn) draftBtn.addEventListener("click", () => renderRewardDraft(game, true));
    queueFooterAwareLayoutSync();
}

function renderRewardDraft(game, forceOpen = false) {
    const overlay = $("reward-overlay");
    const overlayHost = $("reward-options");
    const host = $("card-hand");
    if (!overlay || !host) return;
    const pending = game && Array.isArray(game.pending_rewards) ? game.pending_rewards : [];
    overlay.hidden = true;
    if (overlayHost) overlayHost.innerHTML = "";
    if (!pending.length || state.phase === "done" || state.phase === "arc-complete" || state.phase === "running" || String(game.run_status || "active").toLowerCase() !== "active") {
        host.hidden = true;
        host.classList.remove("reward-draft");
        return;
    }
    host.hidden = false;
    host.classList.add("reward-draft");
    host.innerHTML = pending.slice(0, 3).map((card, i) => `
        <button class="reward-pick" type="button" data-reward-card-id="${escText(card.id)}" data-move-tip="${escText(cardMoveTooltip(card))}" title="${escText(cardMoveTooltip(card))}">
            <b><span class="reward-title">${i + 1} &middot; ${escText(card.name)}</span><span class="gc-cost-row"><span class="gc-help" data-move-help="1" aria-hidden="true">?</span><span class="game-card-cost">${Number(card.cost || 0)}</span></span></b>
            <span>${escText(card.description || "")}</span>
            <em>${escText(cardEffectLine(card))}${card.upgraded ? " / upgraded" : ""}${card.exhausts ? " / exhausts" : ""}</em>
        </button>`).join("");
    bindMoveTooltips(host);
    host.querySelectorAll("[data-reward-card-id]").forEach((btn) => {
        btn.addEventListener("click", () => claimRewardCard(btn.dataset.rewardCardId));
    });
    if (forceOpen || !overlay.dataset.seenRewardIds || overlay.dataset.seenRewardIds !== pending.map((c) => c.id).join("|")) {
        overlay.dataset.seenRewardIds = pending.map((c) => c.id).join("|");
    }
    setActionHint("Next: choose a reward card to bank this stage.");
    updateCommandControls();
    setSceneStatus({ source: state.live ? "live foundry session" : "simulation session" });
}

function syncGameState(game) {
    if (!game) return;
    state.game = game;
    renderGameHand(game);
    renderRewardDraft(game);
    const hand = Array.isArray(game.hand) ? game.hand : [];
    const arc = game.antagonist_arc || {};
    const handLine = hand.length
        ? `hand: ${hand.map((c) => `${c.name}(${c.cost})`).join(", ")}`
        : "hand empty";
    lens("reasoning", `card turn ${game.turn_index || 0}: energy ${game.energy ?? 0}/${game.max_energy ?? 0}, ${handLine}`);
    if (arc.threat_level !== undefined) {
        lens("reliability", `antagonist ${arc.escalation_stage || "watching"}: threat ${arc.threat_level}/100`);
    }
    // The run-over beat: every game-state update flows through here, so this is
    // the single place that surfaces victory/defeat the moment the run decides.
    maybeShowRunOver(game);
}

// Render the run-over moment (victory or defeat) once, when the run leaves the
// active state. Idempotent: re-syncs while the overlay is up are no-ops.
function maybeShowRunOver(game) {
    const overlay = $("run-over-overlay");
    if (!overlay) return;
    const status = String((game && game.run_status) || "active").toLowerCase();
    const stages = Array.isArray(state.stages) ? state.stages : [];
    const done = stages.filter((s) => String(s.status || "").toLowerCase() === "completed").length;
    const invalidVictory = status === "victory" && (!stages.length || done < stages.length);
    if (invalidVictory) {
        overlay.hidden = true;
        overlay.classList.remove("show");
        overlay.setAttribute("aria-hidden", "true");
        overlay.dataset.shownFor = "";
        return;
    }
    if (status !== "victory" && status !== "defeat") {
        if (!overlay.hidden) { overlay.hidden = true; overlay.classList.remove("show"); overlay.setAttribute("aria-hidden", "true"); }
        overlay.dataset.shownFor = "";
        return;
    }
    // Defeat is urgent and can surface immediately. Victory should wait until
    // the finale/income beat has had the stage; otherwise the run-over overlay
    // can cover the live ending the moment the final /run-next response lands.
    if (status === "victory" && state.phase !== "done" && state.phase !== "arc-complete") {
        overlay.hidden = true;
        overlay.classList.remove("show");
        overlay.setAttribute("aria-hidden", "true");
        return;
    }
    // Guard against re-rendering the same outcome every poll/sync.
    if (overlay.dataset.shownFor === status && !overlay.hidden) return;
    overlay.dataset.shownFor = status;

    const econ = state.economics || {};
    const arc = game.antagonist_arc || {};
    const victory = status === "victory";

    const card = $("run-over-card");
    if (card) card.className = `run-over-card ${victory ? "victory" : "defeat"}`;
    const sigil = $("run-over-sigil"); if (sigil) sigil.textContent = victory ? "\u2728" : "\u2620\uFE0F";
    const kicker = $("run-over-kicker"); if (kicker) kicker.textContent = victory ? "The run is won" : "The run is over";
    const title = $("run-over-title");
    if (title) title.textContent = victory ? "Cooperative Equilibrium" : ((arc.antagonist_name || "The rival") + " prevailed");
    const reason = $("run-over-reason");
    if (reason) reason.textContent = (victory ? game.victory_reason : game.defeat_reason)
        || (victory ? "The venture launched and the workforce held the line." : "The company could not hold its position.");

    const treasury = Math.max(0, Math.round(Number(econ.points || 0)));
    const days = Math.round(Number(econ.days_elapsed || game.day_index || 0));
    const share = Number(econ.market_share || 0);
    const revMonth = Math.round(Number(econ.monthly_revenue_usd || 0));
    const stats = $("run-over-stats");
    if (stats) {
        stats.innerHTML = [
            ["Stages shipped", `${done}/${stages.length || 8}`],
            ["Market share", `${share.toFixed(1)}%`],
            ["Revenue", `$${revMonth.toLocaleString()}/mo`],
            ["Treasury", `$${treasury.toLocaleString()}`],
            ["Days survived", days.toLocaleString()],
            ["Rival threat", `${Math.round(Number(arc.threat_level || 0))}/100`],
        ].map(([k, v]) => `<div class="run-over-stat"><span>${esc(k)}</span><b>${esc(String(v))}</b></div>`).join("");
    }
    const btn = $("run-over-btn");
    if (btn) btn.textContent = victory ? "Begin a new run" : "Try again";
    overlay.hidden = false;
    overlay.classList.add("show");
    overlay.setAttribute("aria-hidden", "false");
}

async function playGameCard(cardId, targetId = "") {
    if (!cardId) return null;
    const stage = state.stages[state.idx] || {};
    try {
        const res = await api("/api/game/card/play", {
            card_id: cardId,
            target_id: targetId,
            stage_id: stage.id || "",
        });
        if (res.state) {
            setHud(res.state);
            setResourcesFromEconomics(res.state.economics, res.state.org || state.org);
            syncGameState(res.state.game);
        }
        const move = res.move || {};
        const chips = moveReceiptChips(move);
        const energy = Number(move.energy_spent || 0);
        if (energy) chips.unshift(`energy -${energy}`);
        showActionReceipt(move.summary || "Card played", chips, "Those changes are now in company state and saved to the run.");
        setActionHint(move.summary || "Card effects applied.");
        lens("reasoning", `played ${move.card_id || cardId}: ${move.summary || "card effects applied"}`);
        return res;
    } catch (e) {
        setActionHint("Card could not be played.");
        showActionReceipt("Card rejected", [e.message || String(e)], "No state changed.", "bad");
        lens("reliability", `card play rejected: ${e.message || e}`);
        return null;
    }
}

async function endGameTurn() {
    try {
        const stage = state.stages[state.idx] || {};
        const res = await api("/api/game/turn/end", { stage_id: stage.id || "" });
        if (res.state) {
            setHud(res.state);
            setResourcesFromEconomics(res.state.economics, res.state.org || state.org);
            syncGameState(res.state.game);
        }
        const move = res.move || {};
        const arc = (move.effects_applied || {}).antagonist_threat || {};
        const pressed = (arc.after !== undefined && arc.before !== undefined) ? arc.after - arc.before : 0;
        setActionHint("Fresh hand drawn - energy refilled.");
        showActionReceipt("Turn ended", moveReceiptChips(move), "Energy refilled, but the rival gets a small press while you regroup.", pressed > 0 ? "warn" : "good");
        lens("reasoning", `ended turn ${move.turn_index || ""}: hand refreshed, energy restored`);
        if (pressed > 0) lens("reliability", `rival pressed +${pressed} threat while you regrouped`);
        return res;
    } catch (e) {
        setActionHint("Could not end the turn.");
        showActionReceipt("End turn rejected", [e.message || String(e)], "No state changed.", "bad");
        lens("reliability", `end turn rejected: ${e.message || e}`);
        return null;
    }
}
window.endGameTurn = endGameTurn;

async function claimRewardCard(cardId) {
    if (!cardId) return null;
    document.querySelectorAll("[data-reward-card-id]").forEach((el) => { el.disabled = true; });
    try {
        const res = await api("/api/game/reward/claim", { card_id: cardId });
        if (res.state) {
            setHud(res.state);
            setResourcesFromEconomics(res.state.economics, res.state.org || state.org);
            syncGameState(res.state.game);
        }
        const overlay = $("reward-overlay");
        if (overlay && (!res.state || !res.state.game || !(res.state.game.pending_rewards || []).length)) {
            overlay.hidden = true;
        }
        const move = res.move || {};
        showActionReceipt(move.summary || "Reward drafted", moveReceiptChips(move), "It enters discard now and can be drawn on a later turn.");
        setActionHint(move.summary || "Reward added to your deck.");
        lens("reasoning", `drafted ${move.card_id || cardId}: ${move.summary || "reward added to discard"}`);
        if (rewardResolve) {
            const done = rewardResolve;
            rewardResolve = null;
            done(res);
        }
        return res;
    } catch (e) {
        document.querySelectorAll("[data-reward-card-id]").forEach((el) => { el.disabled = false; });
        setActionHint("Reward could not be drafted.");
        showActionReceipt("Reward rejected", [e.message || String(e)], "No state changed.", "bad");
        lens("reliability", `reward draft rejected: ${e.message || e}`);
        return null;
    }
}

async function runRewardDraftGate(game) {
    const pending = game && Array.isArray(game.pending_rewards) ? game.pending_rewards : [];
    const runStatus = String((game && game.run_status) || "active").toLowerCase();
    if (!pending.length || runStatus !== "active") return null;
    state.phase = "reward";
    updateCommandControls();
    renderRewardDraft(game, true);
    setActionHint("Next: choose one reward card for the run deck.");
    return new Promise((resolve) => {
        rewardResolve = resolve;
    });
}

window.playGameCard = playGameCard;
window.claimRewardCard = claimRewardCard;

function resourceDeltaForDecision(option, tradeoff) {
    const text = `${option || ""} ${tradeoff || ""}`.toLowerCase();
    const delta = { proof: 4 };
    if (/ship|70|fast|breadth|adoption|volume|automate support fully/.test(text)) {
        delta.velocity = (delta.velocity || 0) + 10;
        delta.autonomy = (delta.autonomy || 0) + 5;
        delta.trust = (delta.trust || 0) - 3;
    }
    if (/depth|niche|polish|95|runway|human in the loop|protect the promise/.test(text)) {
        delta.trust = (delta.trust || 0) + 9;
        delta.proof = (delta.proof || 0) + 4;
        delta.velocity = (delta.velocity || 0) - 4;
        delta.burn = (delta.burn || 0) + 5;
    }
    if (/rough|thin margins|higher burn|margin pressure/.test(text)) {
        delta.burn = (delta.burn || 0) + 5;
    }
    if (/deeper moat|real users|protect|willingness|proof/.test(text)) {
        delta.proof = (delta.proof || 0) + 5;
    }
    return delta;
}

function fmtMoney(n) {
    return `$${Number(n || 0).toLocaleString()}`;
}

// Character creation: the archetype the founder picks is their starting gear.
// It seeds the human lane of the org design (game_design.md section 9.3).
document.querySelectorAll("#arch-row .arch-card").forEach((card) => {
    card.addEventListener("click", () => {
        const wasSel = card.classList.contains("sel");
        document.querySelectorAll("#arch-row .arch-card").forEach((c) => c.classList.remove("sel"));
        if (!wasSel) {
            card.classList.add("sel");
            state.archetype = { name: card.dataset.arch, skill: card.dataset.skill };
        } else {
            state.archetype = null;
        }
    });
});

document.addEventListener("keydown", (e) => {
    if (state.phase !== "title") return;
    if (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
    const i = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3 }[e.code];
    if (i === undefined) return;
    const cards = document.querySelectorAll("#arch-row .arch-card");
    if (cards[i]) cards[i].click();
});

// Per-role MAI-generated portraits (assets/generated/<role>.png) and the
// Microsoft service each role's beat actually runs on - shown as a badge in
// the worker card so "we use Microsoft" is visible, not narrated.
const ROLE_PORTRAIT = {
    narrator: "narrator", orgdesigner: "orgdesigner", strategist: "strategist",
    designer: "designer", marketer: "marketer", ops: "ops",
    rival: "villain", antagonist: "villain", villain: "villain",
};
const ROLE_MS = {
    narrator: "Azure AI Foundry &middot; chat completions",
    orgdesigner: "Azure AI Foundry &middot; reasoning deployment",
    strategist: "Azure AI Foundry &middot; reasoning deployment",
    designer: "Azure AI Foundry &middot; creative deployment",
    marketer: "Azure AI Foundry &middot; fast-reasoning deployment",
    ops: "Azure AI Foundry &middot; fast-reasoning deployment",
};

function roleForStage(stage) {
    const s = String(stage || "").toLowerCase();
    if (/mvp|build|product|design/.test(s)) return "designer";
    if (/gtm|growth|market|sales/.test(s)) return "marketer";
    if (/retention|ops|support|finance/.test(s)) return "ops";
    return "strategist";
}

function resourceMeterMarkup(keys, cls) {
    return (keys || []).map((key) => {
        const spec = RESOURCE_SPEC[key];
        if (!spec) return "";
        const val = clamp(state.resources[key]);
        return `<div class="${cls}-metric" title="${spec.label}: ${val}/100">`
            + `<div class="${cls}-metric-top"><span>${esc(spec.label)}</span><b>${val}</b></div>`
            + `<div class="${cls}-metric-track"><span style="width:${val}%;background:${spec.color}"></span></div>`
            + `</div>`;
    }).join("");
}

function partyMetricMarkup(member) {
    // Game-master agents (Worldkeeper / Org Designer) don't ship gated work and
    // aren't on payroll - show their layer, not a fake quality bar.
    if (isGameMaster(member.role)) {
        return `<div class="party-econ gm"><span class="pe-role">Worldkeeper &middot; authors the run</span></div>`;
    }
    // Each digital worker shows ITS OWN numbers, never the shared company meters
    // (which were identical on every card): the gate score IT shipped, and the
    // cheap run cost vs the human salary IT replaces (the A+ leverage headline).
    const role = orgRoleForMember(member);
    const quality = workerQuality(member);
    const qVal = quality === null ? 0 : clamp(quality);
    const qLabel = quality === null ? "&mdash;" : String(qVal);
    const qBar = `<div class="party-metric" title="Quality: the highest gate score this worker has shipped${quality === null ? " (no stage shipped yet)" : ""}.">`
        + `<div class="party-metric-top"><span>Quality</span><b>${qLabel}</b></div>`
        + `<div class="party-metric-track"><span style="width:${qVal}%;background:${T.good}"></span></div>`
        + `</div>`;
    let econLine = "";
    if (role && role.kind !== "human") {
        const cost = Number(role.monthly_cost_usd) || 0;
        const human = Number(role.human_median_usd) || 0;
        const saves = Math.max(0, human - cost);
        econLine = `<div class="party-econ" title="This worker runs for ${fmtMoney(cost)}/mo and replaces a ${fmtMoney(human)}/mo human seat.">`
            + `<span class="pe-cost">${fmtMoney(cost)}/mo</span>`
            + (saves > 0 ? `<span class="pe-saves">saves ${fmtMoneyShort(saves)}</span>` : "")
            + `</div>`;
    }
    return `<div class="party-metrics single">${qBar}</div>${econLine}`;
}

// The designed org seat backing a party member (by bound id, then title). The
// seat carries the worker's real economics; null for game-master agents or a
// run with no chartered org yet.
function orgRoleForMember(member) {
    const roles = (state.org && Array.isArray(state.org.roles)) ? state.org.roles : [];
    if (!roles.length || !member) return null;
    return (member.workerId && roles.find((r) => r.id === member.workerId))
        || roles.find((r) => r.title === member.name)
        || null;
}

// The highest gate score this worker has actually shipped across the stages it
// owns (null until it ships one) - a real, per-worker quality signal.
function workerQuality(member) {
    if (!member) return null;
    const owned = (state.stages || []).filter((ch) =>
        (member.workerId && ch.assigned_worker_id === member.workerId)
        || ch.assigned_worker_title === member.name
        || (!ch.assigned_worker_title && (ROLE_NAME[ch.owner_role] || ch.owner_role) === member.name));
    const scored = owned.filter((ch) => ch.status === "completed" && Number.isFinite(Number(ch.validation_score)));
    return scored.length ? Math.max(...scored.map((ch) => Number(ch.validation_score))) : null;
}

// Compact money for the tight worker card: $15.4k / $980.
function fmtMoneyShort(n) {
    const v = Math.round(Number(n) || 0);
    return Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1).replace(/\.0$/, "")}k` : `$${v}`;
}

function partyMembers() {
    if (state.stages.length) {
        const seen = new Set();
        return state.stages.map((ch) => {
            const name = ch.assigned_worker_title || ROLE_NAME[ch.owner_role] || ch.owner_role;
            return {
                key: name,
                role: ch.owner_role || "strategist",
                name,
                workerId: ch.assigned_worker_id || "",
                stageId: ch.id,
                title: ch.title,
                status: ch.status,
            };
        }).filter((m) => {
            if (seen.has(m.key)) return false;
            seen.add(m.key);
            return true;
        }).slice(0, 6);
    }
    if (state.org && Array.isArray(state.org.roles)) {
        return state.org.roles
            .filter((r) => r.kind !== "human")
            .slice(0, 6)
            .map((r) => ({
                key: r.id || r.title,
                role: roleForStage(r.lifecycle_stage || r.deployment_hint || r.title),
                name: r.title,
                workerId: r.id || "",
                title: r.mandate || r.why,
                status: "waiting",
            }));
    }
    return [
        { key: "orgdesigner", role: "orgdesigner", name: "Org Designer", title: "designs the workforce", status: "waiting" },
        { key: "narrator", role: "narrator", name: "World Designer", title: "maps the run", status: "waiting" },
    ];
}

// Which party card is currently flipped to its dossier (by owner name), or
// null. Tracked at module scope so a re-render (every state tick) keeps the
// open card flipped instead of snapping it back to its front face.
let flippedOwner = null;

function setParty(activeKey, line, activeName) {
    const host = $("party");
    if (!host) return;
    state.activePartyKey = activeKey;
    state.activePartyLine = line;
    state.activePartyName = activeName;
    const members = partyMembers();
    host.innerHTML = renderPartyHand({
        members,
        activeKey,
        activeName,
        line,
        flippedOwner,
        cardEvidence,
        rolePortrait: ROLE_PORTRAIT,
        roleName: ROLE_NAME,
        isGameMaster,
        partyMetricMarkup,
        partyCardEvidence: partyCardEv,
        dossierBackHTML,
        clamp,
        esc,
    });
}

// --- Character cards: a face AND a presence -------------------------------
// Each on-stage party tile is a CARD. When a worker finishes a chapter we stash
// its REAL run evidence here (keyed by the worker's display name); clicking the
// card opens a dialog that re-presents that evidence - tool calls, reasoning,
// memory injected, score. Same receipts as the rail, in an in-world front door.
const cardEvidence = {};
function recordCardEvidence(name, role, ev) {
    if (!name) return;
    cardEvidence[name] = Object.assign({ role: role, name: name }, ev);
    // Refresh the party row so the just-finished card shows its "receipts"
    // affordance immediately (without disturbing the active highlight).
    setParty(state.activePartyKey, state.activePartyLine, state.activePartyName);
}

function workerStagesForMember(member, run = latestRunState()) {
    const stages = (run.world && Array.isArray(run.world.stages)) ? run.world.stages : (state.stages || []);
    if (!member) return [];
    return stages.filter((stage) =>
        (member.workerId && stage.assigned_worker_id === member.workerId)
        || stage.assigned_worker_title === member.name
        || (!stage.assigned_worker_title && (ROLE_NAME[stage.owner_role] || stage.owner_role) === member.name)
        || (!member.workerId && stage.owner_role === member.role));
}

function invocationsForMember(member, run = latestRunState()) {
    const invocations = (run.world && Array.isArray(run.world.invocations)) ? run.world.invocations : [];
    const ownedIds = new Set(workerStagesForMember(member, run).map((stage) => stage.id));
    return invocations.filter((inv) =>
        (member.workerId && inv.worker_id === member.workerId)
        || inv.worker_title === member.name
        || ownedIds.has(inv.stage_id)
        || (!member.workerId && inv.role === member.role));
}

function partyStateForMember(member, run = latestRunState()) {
    const party = run.game && Array.isArray(run.game.party) ? run.game.party : [];
    if (!member) return null;
    return party.find((p) =>
        (member.workerId && p.worker_id === member.workerId)
        || p.title === member.name
        || p.role === member.role) || null;
}

function workerSuggestionLines(member, run = latestRunState()) {
    const econ = run.economics || state.economics || {};
    const game = run.game || state.game || {};
    const current = (run.world && run.world.stages || state.stages || [])[state.idx] || null;
    const role = (member && member.role) || "strategist";
    const suggestions = [];
    const threat = Number((game.antagonist_arc || {}).threat_level || 0);
    const burn = Number(econ.burn_pressure || 0);
    const market = Number(econ.market_share || 0);
    if (role === "strategist") {
        suggestions.push(current ? `Narrow the next move around ${current.title || "the current stage"}.` : "Pick one beachhead before widening the run.");
        if (market <= 0) suggestions.push("Ask for one proof-backed customer segment before spending more energy.");
    } else if (role === "designer") {
        suggestions.push("Turn the next CEO move into a testable product artifact, not a broad theme.");
        if (burn >= 35) suggestions.push("Favor a lean build path that lowers burn pressure.");
    } else if (role === "marketer") {
        suggestions.push("Play or request a customer signal so revenue starts moving, not just proof.");
        if (market <= 0) suggestions.push("Name the first buyer and the channel that reaches them this turn.");
    } else if (role === "ops") {
        suggestions.push("Protect runway: choose the move that keeps the workforce operating cleanly.");
        if (threat >= 35) suggestions.push("Use counterplay before the rival gets room to escalate.");
    }
    if (threat >= 50) suggestions.unshift("The rival is loud. Push threat down before the next stage if you can.");
    return uniq(suggestions).slice(0, 4);
}

function workerEvidenceFromState(name) {
    const run = latestRunState();
    const member = partyMembers().find((m) => m.name === name || m.key === name);
    if (!member || isGameMaster(member.role)) return null;
    const invocations = invocationsForMember(member, run);
    const latestInv = invocations.slice(-1)[0] || null;
    const ownedStages = workerStagesForMember(member, run);
    const completed = ownedStages.filter((stage) => stage.status === "completed");
    const scored = completed.map((stage) => Number(stage.validation_score)).filter(Number.isFinite);
    const quality = scored.length ? Math.max(...scored) : null;
    const active = member.key === state.activePartyKey || member.role === state.activePartyKey
        || member.name === state.activePartyName || member.name === state.activePartyKey;
    const activeLine = active ? (state.activePartyLine || "working with you") : (member.title || "waiting for the brief");
    const ceoMessages = [];
    (state.playerCommands || []).slice(-3).forEach((cmd) => ceoMessages.push({ kind: "ceo_decision", text: cmd.text || "CEO move" }));
    (((run.world || {}).decisions) || []).slice(-3).forEach((decision) => {
        ceoMessages.push({ kind: "ceo_decision", text: `${decision.stage_title || decision.stage_id || "Gate"}: ${decision.option || decision.tradeoff || "decision"}` });
    });
    return {
        role: member.role || "strategist",
        name: member.name,
        roleLabel: ROLE_NAME[member.role] || member.role,
        score: quality === null ? "--" : quality,
        deployment: latestInv
            ? `${cleanDeployLabel(latestInv.deployment)}${latestInv.framework === "microsoft-agent-framework" ? " · Agent Framework" : ""}`.trim()
            : (active ? "active in the current world state" : "awaiting a completed run"),
        tools: latestInv ? (latestInv.tools_drawn || []) : [],
        trace: latestInv ? (latestInv.tool_trace || []) : [],
        mafTools: latestInv ? (latestInv.maf_tools_called || []) : [],
        mafMemory: [...(latestInv ? (latestInv.maf_memory || []) : []), ...ceoMessages].slice(-8),
        currentEvents: latestInv ? (latestInv.current_events || []) : [],
        status: latestInv ? (latestInv.status || "completed") : (active ? "running" : "idle"),
        tokens_in: latestInv ? (latestInv.tokens_in || 0) : 0,
        tokens_out: latestInv ? (latestInv.tokens_out || 0) : 0,
        reasoningTokens: latestInv ? (latestInv.reasoning_tokens || 0) : 0,
        reasoningPreview: latestInv ? (latestInv.reasoning_preview || activeLine) : activeLine,
        latency: latestInv ? (latestInv.latency_s || 0) : 0,
        workerStages: ownedStages,
        workerInvocations: invocations,
        workerPartyState: partyStateForMember(member, run),
        suggestions: workerSuggestionLines(member, run),
        liveOnly: !latestInv,
    };
}

function liveCardEvidence(name) {
    const member = partyMembers().find((m) => m.name === name || m.key === name);
    if (!member) return null;
    const active = member.key === state.activePartyKey || member.role === state.activePartyKey
        || member.name === state.activePartyName || member.name === state.activePartyKey;
    const currentLine = active ? (state.activePartyLine || "working with you") : (member.title || "waiting for the brief");
    return {
        role: member.role || "narrator",
        name: member.name,
        chapter: member.title || currentLine,
        score: "--",
        deployment: active ? "active in the current world state" : "awaiting a completed run",
        tools: [],
        trace: [],
        mafTools: [],
        mafMemory: [],
        currentEvents: [],
        status: active ? "running" : "idle",
        tokens_in: 0,
        tokens_out: 0,
        reasoningTokens: 0,
        reasoningPreview: currentLine,
        latency: 0,
        liveOnly: true,
    };
}

function latestRunState() {
    return state.latestServerState || {
        name: state.company,
        pitch: state.pitch,
        org: state.org,
        world: { stages: state.stages || [], decisions: state.decisions || [], invocations: [] },
        economics: state.economics,
        game: state.game,
        replay_log: [],
    };
}

function uniq(list) {
    return Array.from(new Set((list || []).filter(Boolean).map((x) => String(x).trim()).filter(Boolean)));
}

const GM_EVENT_TYPES = {
    narrator: new Set([
        "SESSION_START", "URL_SCRAPED", "WEB_SEARCHED", "PROFILE_ANALYZED",
        "ANTAGONIST_FORGED", "WORLD_GROUNDED", "WORLD_NAMED", "WORLD_DESIGNED",
        "WORLD_ADAPTED", "ORG_BOUND", "KNOWLEDGE_STRUCTURED", "DILEMMA_LIVE_ERROR",
    ]),
    orgdesigner: new Set([
        "ORG_CHARTERED", "ORG_BOUND", "ORG_EXPORTED", "WORKFORCE_HIRED",
        "WORKFORCE_CONTRACTED", "KNOWLEDGE_STRUCTURED",
    ]),
};
const GM_ACTORS = {
    narrator: new Set(["world_designer", "narrator", "profile_analyst", "scraper", "iq_sync", "antagonist", "system"]),
    orgdesigner: new Set(["org_designer", "iq_sync", "memory", "system", "founder"]),
};

function gmReplayEvents(role, run) {
    const log = Array.isArray(run.replay_log) ? run.replay_log : [];
    const types = GM_EVENT_TYPES[role] || GM_EVENT_TYPES.narrator;
    const actors = GM_ACTORS[role] || GM_ACTORS.narrator;
    return log.filter((event) => types.has(event.event_type) || actors.has(event.actor));
}

function gmToolsFor(role, run, events) {
    const names = [];
    const has = (type) => (events || []).some((event) => event.event_type === type);
    if (role === "orgdesigner") {
        if (run.founder_profile || run.pitch) names.push("design_org");
        if (run.org) names.push("initialize_economics_from_org");
        if (has("ORG_BOUND")) names.push("bind_world_to_org");
        if (has("ORG_EXPORTED")) names.push("org_to_workforce_bundle");
        if (has("WORKFORCE_HIRED")) names.push("hire_worker");
        if (has("WORKFORCE_CONTRACTED")) names.push("fire_or_contract_worker");
    } else {
        if (run.founder_profile && run.founder_profile.source === "url") names.push("scrape_profile");
        if (run.founder_profile) names.push("analyze_founder_profile");
        if (run.antagonist || has("ANTAGONIST_FORGED")) names.push("forge_antagonist");
        if (run.world) names.push("design_world_named");
        if (has("WORLD_ADAPTED")) names.push("adapt_remaining_stages");
        if (has("KNOWLEDGE_STRUCTURED")) names.push("refresh_session_knowledge");
    }
    return uniq(names);
}

function gmMemoryFor(role, run, events) {
    const memory = [];
    const profile = run.founder_profile || null;
    if (profile && role !== "orgdesigner") {
        memory.push({ kind: "user_profile", text: profile.company_summary || profile.brief || profile.source_ref || "Founder profile mapped" });
        (profile.signals || []).slice(0, 2).forEach((signal) => memory.push({ kind: "agent_memory", text: signal }));
    }
    const decisions = ((run.world && run.world.decisions) || state.decisions || []).slice(-3);
    decisions.forEach((decision) => {
        memory.push({ kind: "ceo_decision", text: `${decision.stage_title || decision.stage_id || "Gate"}: ${decision.option || decision.tradeoff || "decision recorded"}` });
    });
    (events || []).filter((event) => event.event_type === "MEMORY_WRITTEN").slice(-3).forEach((event) => {
        memory.push({ kind: "agent_memory", text: event.message || "Memory written" });
    });
    return memory.slice(0, 8);
}

function authoredStageRows(run) {
    const stages = (run.world && Array.isArray(run.world.stages)) ? run.world.stages : (state.stages || []);
    return stages.slice(0, 8).map((stage, index) => ({
        n: index + 1,
        title: stage.title || stage.id || `Stage ${index + 1}`,
        owner: stage.assigned_worker_title || ROLE_NAME[stage.owner_role] || stage.owner_role || "worker",
        status: stage.status || "not-started",
    }));
}

function gmReasoningLine(role, run, events, aw) {
    const world = run.world || {};
    const stages = Array.isArray(world.stages) ? world.stages.length : 0;
    const org = run.org || null;
    const profile = run.founder_profile || null;
    const last = (events || []).slice(-1)[0];
    if (role === "orgdesigner") {
        if (org) {
            return `Chartered ${org.digital_worker_count || 0} digital workers around the founder seat; monthly run cost ${fmtMoney(org.monthly_burn_usd || 0)}.`;
        }
        return aw.stateText || "Waiting to design the workforce.";
    }
    if (stages) {
        const source = profile && profile.source === "url" ? ` from ${profile.host || profile.source_ref || "profile"}` : " from the founder brief";
        return `Authored ${stages} Story Circle stages${source}; latest replay event: ${(last && last.event_type) || "world ready"}.`;
    }
    return aw.stateText || "Waiting for the founder signal.";
}

function gameMasterEvidence(aw) {
    const run = latestRunState();
    const role = aw.role || "narrator";
    const events = gmReplayEvents(role, run).slice(-10);
    const world = run.world || {};
    const invocations = Array.isArray(world.invocations) ? world.invocations : [];
    const stages = Array.isArray(world.stages) ? world.stages : [];
    const completed = stages.filter((stage) => stage.status === "completed").length;
    const arc = (run.game && run.game.antagonist_arc) || {};
    const displayName = aw.displayName || ROLE_NAME[role] || role;
    return {
        role,
        name: displayName,
        roleLabel: role === "orgdesigner" ? "Game Master - workforce author" : "Game Master - world author",
        deployment: cleanDeployLabel(aw.deployLabel) || (role === "orgdesigner" ? "Org Designer - Foundry reasoning" : "World Designer - Foundry reasoning"),
        score: "--",
        tools: gmToolsFor(role, run, events),
        trace: [],
        mafTools: [],
        mafMemory: gmMemoryFor(role, run, events),
        currentEvents: invocations.flatMap((inv) => inv.current_events || []).slice(-3),
        reasoningTokens: 0,
        reasoningPreview: gmReasoningLine(role, run, events, aw),
        authoredStages: role === "narrator" ? authoredStageRows(run) : [],
        replayEvents: events,
        gmSummary: {
            stages,
            completed,
            invocations: invocations.length,
            decisions: ((world.decisions || state.decisions || [])).length,
            threat: arc.threat_level,
            escalation: arc.escalation_stage,
        },
    };
}

// Two kinds of pieces on the board: the Worldkeeper/game-master agents that
// build and narrate the simulation, and the company's digital workforce that
// executes it. The tag on each card names which layer it belongs to.
function isGameMaster(role) {
    return role === "narrator" || role === "orgdesigner";
}

// One source of truth for which of the three agent classes a role belongs to,
// so every surface (party rail, speaking spotlight, stand-up transcript) frames
// it the same way. "gm" = the world masters that author the run (World Designer
// / Narrator, Org Designer) - they get the gold announcement treatment; "rival"
// = the antagonist pressuring the run (red); "dw" = a player digital worker.
function agentClassForRole(role) {
    if (isGameMaster(role)) return "gm";
    const r = String(role || "").toLowerCase();
    if (r === "antagonist" || r === "villain" || r === "rival") return "rival";
    return "dw";
}

// The dossier of a card: the real receipts - tools the model called,
// reasoning, memory injected, gate score, and the world meters it moves. Reuses
// the cc-* receipt classes; rendered into the inspector dialog.
function dossierBackHTML(ev) {
    if (!ev) return "";
    const isGm = !!ev.gmSummary;
    const color = ROLE_COLOR[ev.role] || T.narrator;
    const roleName = ev.roleLabel || ROLE_NAME[ev.role] || ev.role || "agent";
    const score = (ev.score === undefined || ev.score === null) ? "--" : ev.score;
    const worldStats = resourceMeterMarkup(Object.keys(RESOURCE_SPEC), "cc");
    const section = (title, body, opts = {}) => {
        if (!body) return "";
        const collapsible = opts.collapsible !== false;
        const detail = esc(opts.detail || title);
        const classes = ["cc-section", collapsible ? "is-collapsible" : "", opts.open ? "open" : ""].filter(Boolean).join(" ");
        if (!collapsible) return `<div class="${classes}"><div class="cc-h">${esc(title)}</div>${body}</div>`;
        return `<div class="${classes}" data-detail="${detail}">`
            + `<button class="cc-section-toggle" type="button" aria-expanded="${opts.open ? "true" : "false"}">`
            + `<span class="cc-h">${esc(title)}</span><span class="cc-more">details</span></button>`
            + `<div class="cc-section-body">${body}</div></div>`;
    };
    // Per-worker economics: the cheap run cost vs the human seat it replaces -
    // distinct per worker, sourced from its designed org seat (when chartered).
    const seat = (state.org && Array.isArray(state.org.roles))
        ? state.org.roles.find((r) => r.title === ev.name)
        : null;
    let econHtml = "";
    if (seat && seat.kind !== "human") {
        const cost = Number(seat.monthly_cost_usd) || 0;
        const human = Number(seat.human_median_usd) || 0;
        const saves = Math.max(0, human - cost);
        econHtml = `<div class="cc-econ-grid">`
            + `<div class="cc-econ"><span>Run cost</span><b>${fmtMoney(cost)}/mo</b></div>`
            + `<div class="cc-econ"><span>Replaces human</span><b>${fmtMoney(human)}/mo</b></div>`
            + `<div class="cc-econ gold"><span>Saves</span><b>${fmtMoney(saves)}/mo</b></div>`
            + (seat.runs_on_model ? `<div class="cc-econ"><span>Runs on</span><b>${esc(seat.runs_on_model)}</b></div>` : "")
            + `</div>`;
    }
    const toolNames = uniq([...(ev.mafTools || []), ...(ev.tools || [])]);
    const toolChips = toolNames.length
        ? toolNames.map((t) => `<span class="cc-chip">&#9874; ${esc(t)}</span>`).join(" ")
        : `<span class="cc-chip dim">no tool calls yet</span>`;
    const memChips = (ev.mafMemory || []).map((m) =>
        `<span class="cc-chip mem">${m.kind === "ceo_decision" ? "&#9819;" : m.kind === "agent_memory" ? "&#9851;" : m.kind === "current_event" ? "&#128240;" : "&#9783;"} ${esc((m.text || "").slice(0, 30))}</span>`).join(" ");
    const eventsHtml = (ev.currentEvents || []).slice(0, 3).map((e) => {
        const title = esc(String(e.title || "").slice(0, 90));
        const url = String(e.url || "");
        const head = url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${title}</a>` : title;
        return `<div class="cc-trace-line"><span class="cc-call">&#128240; ${head}</span></div>`;
    }).join("");
    const spoken = (spokenLines[ev.name] || []).slice(-3).map((line) =>
        `<div class="cc-spoken-line">&ldquo;${esc((line.text || "").slice(0, 120))}${(line.text || "").length > 120 ? "&hellip;" : ""}&rdquo;</div>`
    ).join("");
    const authoredHtml = (ev.authoredStages || []).slice(0, 8).map((stage) =>
        `<div class="cc-stage-row"><span>${stage.n}</span><b>${esc(stage.title).slice(0, 58)}</b><em>${esc(stage.owner)} · ${esc(stage.status)}</em></div>`
    ).join("");
    const workerStagesHtml = (ev.workerStages || []).slice(0, 8).map((stage, index) =>
        `<div class="cc-stage-row"><span>${index + 1}</span><b>${esc(stage.title || stage.id || "Stage").slice(0, 58)}</b><em>${esc(stage.status || "not-started")} · ${esc(stage.success_metric || stage.goal || "")}</em></div>`
    ).join("");
    const suggestionHtml = (ev.suggestions || []).map((line) =>
        `<button type="button" class="cc-suggestion" data-suggestion="${esc(line)}">${esc(line)}</button>`
    ).join("");
    const partyState = ev.workerPartyState;
    const wLevel = Number((partyState && partyState.level) || 1);
    const wXp = Number((partyState && partyState.xp) || 0);
    const wNext = 30 * wLevel; // mirrors WORKER_XP_PER_LEVEL * level on the server
    const workerStateHtml = partyState ? `<div class="cc-gm-grid worker-state-grid">`
        + `<div><span>Level</span><b>${wLevel}</b></div>`
        + `<div><span>XP</span><b>${wXp} / ${wNext}</b></div>`
        + `<div><span>Status</span><b>${esc(partyState.status || "ready")}</b></div>`
        + `<div><span>Morale</span><b>${Number(partyState.morale || 0)}</b></div>`
        + `<div><span>Fatigue</span><b>${Number(partyState.fatigue || 0)}</b></div>`
        + `<div><span>Trust</span><b>${Number(partyState.trust || 0)}</b></div>`
        + `</div>` : "";
    const replayHtml = (ev.replayEvents || []).slice(-5).reverse().map((event) =>
        `<div class="cc-replay-line"><span>${esc(event.event_type || "EVENT")}</span><b>${esc(event.actor || "system")}</b><em>${esc((event.message || "").slice(0, 110))}</em></div>`
    ).join("");
    const gm = ev.gmSummary || null;
    const gmHtml = gm ? `<div class="cc-gm-grid">`
        + `<div><span>Stages</span><b>${Number(gm.completed || 0)}/${(gm.stages || []).length || 0}</b></div>`
        + `<div><span>Worker turns</span><b>${Number(gm.invocations || 0)}</b></div>`
        + `<div><span>CEO memories</span><b>${Number(gm.decisions || 0)}</b></div>`
        + `<div><span>Rival</span><b>${gm.threat == null ? "--" : `${gm.threat}/100`}</b></div>`
        + `</div>` : "";
    const callCount = (ev.trace || []).length;
    const cost = estimatedInvocationCost(ev);
    const proofHtml = !isGm ? `<div class="cc-econ-grid evidence-grid">`
        + `<div class="cc-econ"><span>Status</span><b>${esc(ev.status || (callCount ? "completed" : "idle"))}</b></div>`
        + `<div class="cc-econ"><span>Model</span><b>${esc(cleanDeployLabel(ev.deployment) || "simulation")}</b></div>`
        + `<div class="cc-econ"><span>Tokens</span><b>${esc(invocationTokenLine(ev))}</b></div>`
        + `<div class="cc-econ ${cost ? "gold" : ""}"><span>Est. call cost</span><b>${esc(cost || "n/a")}</b></div>`
        + `<div class="cc-econ"><span>Latency</span><b>${Number(ev.latency || 0).toFixed(2)}s</b></div>`
        + `<div class="cc-econ ${callCount >= 2 ? "gold" : ""}"><span>Tool calls</span><b>${callCount}/2 shown</b></div>`
        + `</div>` : "";
    let traceHtml = "";
    (ev.trace || []).forEach((t, index) => {
        const argStr = t.args ? esc(JSON.stringify(t.args)).slice(0, 180) : "";
        traceHtml += `<div class="cc-trace-line"><span class="cc-call">call ${index + 1}: ${esc(t.tool)}</span>`
            + `<span class="cc-args">params ${argStr || "{}"}</span>`
            + `<div class="cc-res">result ${esc(String(t.result || "ok")).slice(0, 220)} <span class="cc-ms">${t.ms}ms &middot; ${esc(t.source || "local")}</span></div></div>`;
    });
    return `<div class="cc-head compact" style="--cc-color:${color}">`
        + `<div><div class="cc-name">${esc(ev.name)}</div>`
        + `<div class="cc-role">${esc(roleName)} &middot; receipts</div>`
        + (cleanDeployLabel(ev.deployment) ? `<div class="cc-deploy">${esc(cleanDeployLabel(ev.deployment))}</div>` : ``)
        + `</div><div class="cc-score"><b>${score}</b><span>/100</span></div></div>`
        + section("Scoring proof", proofHtml, { open: true, detail: "model / tokens / calls" })
        + section(isGm ? "Run authorship" : "This worker's economics", isGm ? gmHtml : econHtml, { open: true, detail: "model summary" })
        + section("Worker state", workerStateHtml, { open: true, detail: "morale/fatigue/status" })
        + section("Suggested CEO moves", suggestionHtml ? `<div class="cc-suggestions">${suggestionHtml}</div>` : "", { open: !isGm, detail: "suggestions from current state" })
        + section("Tools and actions", `<div class="cc-chips">${toolChips}</div>`, { open: true, detail: "tools/actions" })
        + section("World authored", authoredHtml ? `<div class="cc-stage-list">${authoredHtml}</div>` : "", { detail: "stage graph from state" })
        + section("Stages this worker owns", workerStagesHtml ? `<div class="cc-stage-list">${workerStagesHtml}</div>` : "", { detail: "worker-owned stages" })
        + section("Spoken lines", spoken, { detail: "recent spoken messages" })
        + section(isGm ? "IQ / memory restored" : "Memory injected", memChips ? `<div class="cc-chips">${memChips}</div>` : "", { detail: "memory / IQ context" })
        + section("Replay receipts", replayHtml ? `<div class="cc-replay">${replayHtml}</div>` : "", { detail: "state replay log" })
        + section("Live current events researched", eventsHtml ? `<div class="cc-trace">${eventsHtml}</div>` : "", { detail: "current events" })
        + section("tools/call trace", traceHtml ? `<div class="cc-trace">${traceHtml}</div>` : "", { detail: "tool trace" })
        + section(isGm ? "Authorship note" : `Reasoning${ev.reasoningTokens ? ` &middot; ${ev.reasoningTokens} tok` : ""}`,
            ev.reasoningPreview ? `<div class="cc-text quote">&ldquo;${esc((ev.reasoningPreview || "").slice(0, 150))}&hellip;&rdquo;</div>` : "",
            { detail: isGm ? "world author note" : "model reasoning excerpt" })
        + (isGm ? `` : section("Current company meters", `<div class="cc-metric-grid">${worldStats}</div>`, { collapsible: false }));
}

// The dossier source for a party card's back face. Reuses the same recorded
// receipts the modal uses (real run evidence, then the live fallback), so the
// flip and the footer-mini inspector share one source of truth.
function partyCardEv(m) {
    if (isGameMaster(m.role)) {
        return gameMasterEvidence({ role: m.role, displayName: m.name, deployLabel: "", stateText: m.title || "" });
    }
    const ev = cardEvidence[m.name] || workerEvidenceFromState(m.name) || liveCardEvidence(m.name);
    if (ev) {
        if (!ev.roleLabel) ev.roleLabel = ROLE_NAME[m.role] || m.role;
        return ev;
    }
    return {
        role: m.role || "narrator",
        name: m.name,
        roleLabel: ROLE_NAME[m.role] || m.role,
        score: "--",
        tools: [], trace: [], mafTools: [], mafMemory: [],
        status: "idle",
        tokens_in: 0,
        tokens_out: 0,
        reasoningPreview: m.title || "",
        reasoningTokens: 0,
        deployment: "awaiting a completed run",
    };
}

// Flip a party card to its dossier in place (toggle), and keep every other card
// front-side up. Toggling the class on the live element animates the 3D flip;
// flippedOwner persists the choice across setParty re-renders.
function setPartyFlip(owner) {
    flippedOwner = (flippedOwner === owner) ? null : owner;
    const host = $("party");
    if (!host) return;
    host.querySelectorAll(".party-agent").forEach((tile) => {
        const on = !!flippedOwner && tile.dataset.owner === flippedOwner;
        tile.classList.toggle("flipped", on);
        tile.setAttribute("aria-pressed", on ? "true" : "false");
    });
}
function clearPartyFlip() {
    if (!flippedOwner) return;
    flippedOwner = null;
    const host = $("party");
    if (!host) return;
    host.querySelectorAll(".party-agent.flipped").forEach((tile) => {
        tile.classList.remove("flipped");
        tile.setAttribute("aria-pressed", "false");
    });
}

function setWorker(role, deployLabel, stateText, thinking, displayName) {
    // Switch the narration voice to this worker's so each character sounds
    // distinct. Unknown roles keep the narrator voice.
    currentVoice = VOICE_BY_ROLE[role] || NARRATOR_VOICE;
    // Remember who is on stage so the footer mini can summon THIS agent's
    // gorgeous dossier card on demand - core game-master agents (Org Designer,
    // World Designer) are agents too, even though they never join the party row.
    state.activeWorker = { role, deployLabel, stateText, displayName };
    const nameEl = $("worker-name"); if (nameEl) nameEl.textContent = displayName || ROLE_NAME[role] || role;
    const orb = document.querySelector(".role-orb");
    if (orb) orb.style.color = ROLE_COLOR[role] || T.narrator;
    const portrait = $("worker-portrait");
    if (portrait) {
        portrait.style.display = "";
        portrait.src = `/game/assets/generated/${ROLE_PORTRAIT[role] || "narrator"}.png`;
    }
    const ms = $("worker-ms");
    if (ms) {
        const live = state.live && deployLabel && !/simulation/i.test(deployLabel);
        if (live && ROLE_MS[role]) {
            ms.innerHTML = `<span class="ms-logo"><i></i><i></i><i></i><i></i></span> Microsoft ${ROLE_MS[role]}`;
            ms.hidden = false;
        } else { ms.hidden = true; ms.innerHTML = ""; }
    }
    const deployEl = $("worker-deploy"); if (deployEl) deployEl.textContent = cleanDeployLabel(deployLabel);
    const stateEl = $("worker-state");
    if (stateEl) stateEl.innerHTML = thinking
        ? `<span class="pulse"></span> ${stateText}`
        : stateText;
    // Keep a plain-language, speaker-attributed caption on screen while an
    // agent is actively working so players can track who is doing what.
    if (thinking) {
        pinLiveAgentCaption(`${displayName || ROLE_NAME[role] || role}: ${stateText}`);
    } else if (liveCaptionPinned) {
        clearLiveAgentCaption();
    }
    setParty(role, stateText, displayName);
    setSceneStatus({
        actor: displayName || ROLE_NAME[role] || role,
        speaking: (activeSpeakerSnapshot().heroName || displayName || ROLE_NAME[role] || role),
        source: cleanDeployLabel(deployLabel) || sceneStatus.source,
    });
    // A worker stepping onto the stage clears the core-agent spotlight; the
    // reasoning theater takes over for worker chapters.
    if (!SPOTLIGHT_ROLES.has(role)) hideSpeakerSpotlight();
    const inspectorRole = gameMasterRoleFromOwner(inspectorOwner);
    if (inspectorOpen && inspectorRole && inspectorRole === role) openAgentInspector(inspectorOwner);
    if (workerInspectorOpen && workerInspectorMatchesUpdate(workerInspectorOwner, role, displayName)) openWorkerInspector(workerInspectorOwner);
}

// --- Active-agent inspector: the gorgeous floating card, on demand ----------
// The footer mini names whoever is on stage (often a core game-master agent -
// Org Designer / World Designer - that never joins the party row). Clicking it
// summons that agent's collectible card and flips it straight to its receipts,
// so every agent in the run is inspectable, not just the digital workforce.
let inspectorOpen = false;
let workerInspectorOpen = false;
let workerInspectorOwner = null;
// Which card the open dossier belongs to: null = the agent live on stage, or a
// party member's name when the player tapped a specific card. Kept so a stage
// advance re-renders the SAME card the player is reading, not a different one.
let inspectorOwner = null;
function gameMasterRoleFromOwner(name) {
    const clean = String(name || "").trim();
    const low = clean.toLowerCase().replace(/[\s-]+/g, "_");
    if (low === "narrator" || low === "world_designer" || clean === "The Worldkeeper" || clean === ROLE_NAME.narrator || clean === "World Designer") return "narrator";
    if (low === "orgdesigner" || low === "org_designer" || clean === "The Architect" || clean === ROLE_NAME.orgdesigner || clean === "Org Designer") return "orgdesigner";
    return "";
}
function roleFromWorkerName(name) {
    const clean = String(name || "").trim();
    const gmRole = gameMasterRoleFromOwner(clean);
    if (gmRole) return gmRole;
    for (const entry of Object.entries(ROLE_NAME)) {
        if (entry[1] === clean) return entry[0];
    }
    return clean === "The Architect" ? "orgdesigner" : clean === "The Worldkeeper" ? "narrator" : "narrator";
}
function isKnownGameMasterOwner(name) {
    return !!gameMasterRoleFromOwner(name);
}
function workerInspectorMatchesUpdate(owner, role, displayName) {
    const clean = String(owner || "").trim();
    if (!clean) return false;
    if (clean === displayName || clean === ROLE_NAME[role] || clean === role) return true;
    const member = partyMembers().find((x) => x.name === clean || x.key === clean);
    if (member && member.role === role) return true;
    const ev = workerEvidenceFromState(clean);
    return !!(ev && ev.role === role);
}
function activeWorkerSnapshot() {
    if (state.activeWorker && state.activeWorker.role) return state.activeWorker;
    const displayName = ($("worker-name") && $("worker-name").textContent.trim()) || ROLE_NAME.narrator;
    const deployLabel = ($("worker-deploy") && $("worker-deploy").textContent.trim()) || "";
    const stateText = ($("worker-state") && $("worker-state").textContent.trim()) || "";
    return { role: roleFromWorkerName(displayName), deployLabel, stateText, displayName };
}
function activeAgentEv() {
    const aw = activeWorkerSnapshot();
    const name = aw.displayName || ROLE_NAME[aw.role] || aw.role || "Agent";
    if (isGameMaster(aw.role)) return gameMasterEvidence(aw);
    // If this agent already ran, show its real recorded/live receipts.
    const recorded = cardEvidence[name] || liveCardEvidence(name);
    if (recorded) return recorded;
    // Otherwise synthesize a minimal dossier from its current on-stage state.
    return {
        role: aw.role || "narrator",
        name,
        roleLabel: aw.displayName || ROLE_NAME[aw.role] || aw.role || "Agent",
        deployment: aw.deployLabel || "",
        score: "--",
        tools: [], trace: [], mafTools: [], mafMemory: [], currentEvents: [],
        status: aw.stateText ? "running" : "idle",
        tokens_in: 0,
        tokens_out: 0,
        reasoningPreview: aw.stateText || "",
        reasoningTokens: 0,
    };
}
// Map any role (including dynamically-titled workers) onto one of the cast
// archetypes that has character art. Single source of truth for both the
// on-demand inspector and the speaking spotlight.
function castKeyForRole(role) {
    if (CAST_ROLES.has(role)) return role;
    const p = ROLE_PORTRAIT[role];
    if (p && CAST_ROLES.has(p)) return p;
    if (p === "villain") return "villain";
    return "strategist";
}

function castPortraitSrc(key) {
    return key === "villain"
        ? "/game/assets/generated/villain.png"
        : `/game/assets/generated/characters/${key}.png`;
}

function openAgentInspector(owner) {
    const stage = $("cast-stage");
    if (!stage) return;
    setStageLayer("spotlight-active", false);
    // Owner given = the player tapped a specific party card; otherwise inspect
    // whoever is live on stage (the footer mini's front door).
    let aw, ev;
    if (owner) {
        const m = partyMembers().find((x) => x.name === owner || x.key === owner);
        const ownerEvidence = cardEvidence[owner] || workerEvidenceFromState(owner) || liveCardEvidence(owner);
        const inferredRole = (m && m.role) || (ownerEvidence && ownerEvidence.role)
            || (isKnownGameMasterOwner(owner) ? roleFromWorkerName(owner) : "strategist");
        if (inferredRole && !isGameMaster(inferredRole)) {
            openWorkerInspector(owner);
            return;
        }
        let displayName = m ? m.name : owner;
        if (inferredRole === "narrator") displayName = ROLE_NAME.narrator;
        else if (inferredRole === "orgdesigner") displayName = ROLE_NAME.orgdesigner;
        aw = { role: inferredRole || "narrator", deployLabel: "", stateText: "", displayName: displayName };
        ev = ownerEvidence || activeAgentEv();
    } else {
        aw = activeWorkerSnapshot();
        if (aw && aw.role && !isGameMaster(aw.role)) {
            openWorkerInspector(aw.displayName || ROLE_NAME[aw.role] || aw.role);
            return;
        }
        ev = activeAgentEv();
    }
    inspectorOwner = owner || (aw && aw.role) || null;
    const role = aw.role || "narrator";
    const key = castKeyForRole(role);
    // Game-master agents get the special gold dossier; the digital workforce
    // gets a flatter role-colored variant so the two layers never look alike.
    const gm = isGameMaster(role);
    const color = ROLE_COLOR[role] || ROLE_COLOR[key] || T.narrator;
    // Two distinct identities. Game masters ARE the cast: full-body hero art +
    // their in-world name (Worldkeeper / Architect). A digital worker is its
    // own seat: it shows ITS title and a role-icon avatar (not a hero sprite),
    // so a worker never masquerades as a cast character.
    const heroName = gm ? (CAST_NAME[key] || ROLE_NAME[key] || key)
        : (aw.displayName || ROLE_NAME[role] || role);
    const tag = gm
        ? (aw.displayName && aw.displayName !== heroName ? aw.displayName : "")
        : (ROLE_NAME[role] || role);
    const artSrc = gm
        ? `/game/assets/generated/characters/${key}.png`
        : `/game/assets/generated/${ROLE_PORTRAIT[role] || key}.png`;
    stage.style.setProperty("--card-accent", hexToRgba(color, 0.9));
    stage.style.setProperty("--cast-aura", hexToRgba(color, 0.34));
    stage.innerHTML =
        `<div class="cast-card${gm ? " gm" : " worker"}">`
        + `<div class="cast-card-inner">`
        + `<div class="cast-face cast-front">`
        + `<div class="cast-card-art${gm ? "" : " icon"}"><div class="cast-fig" style="background-image:url('${artSrc}')"></div></div>`
        + `<div class="cast-card-plate"><div class="cast-card-name">${esc(heroName)}</div>`
        + `<div class="cast-card-role">${esc(ROLE_NAME[role] || role)}</div>`
        + `<div class="cast-card-tag">${esc(tag)}</div></div>`
        + `<button class="cast-close" type="button" aria-label="Close dossier">&times;</button>`
        + `<div class="cast-dossier" data-sheet="mid"><button class="cast-sheet-handle" type="button" aria-label="Resize receipts sheet"></button>${dossierBackHTML(ev)}</div>`
        + `</div>`
        + `<div class="cast-face cast-back"><button class="cast-close" type="button" aria-label="Close dossier">&times;</button>`
        + `<div class="cast-back-panel"><div class="cast-back-kicker">Deep receipts</div>${dossierBackHTML(ev)}</div></div>`
        + `</div>`
        + `</div>`;
    inspectorOpen = true;
    castRole = key;
    stage.className = "inspect show";
    setStageLayer("inspecting-agent", true);
    const cardEl = stage.querySelector(".cast-card");
    if (cardEl) bindInspectorCardFlip(cardEl);
}
function closeAgentInspector() {
    inspectorOpen = false;
    inspectorOwner = null;
    const stage = $("cast-stage");
    if (stage) {
        stage.className = "";
        stage.innerHTML = "";
    }
    castRole = null;
    setStageLayer("inspecting-agent", false);
}

function ensureWorkerInspectorStage() {
    let stage = $("worker-stage");
    if (stage) return stage;
    stage = document.createElement("div");
    stage.id = "worker-stage";
    stage.setAttribute("aria-hidden", "true");
    const scene = $("scene") || document.body;
    scene.appendChild(stage);
    bindInspectorInteractions(stage);
    return stage;
}

function openWorkerInspector(owner) {
    const stage = ensureWorkerInspectorStage();
    const ownerEvidence = cardEvidence[owner] || workerEvidenceFromState(owner) || liveCardEvidence(owner);
    const member = partyMembers().find((x) => x.name === owner || x.key === owner)
        || { role: (ownerEvidence && ownerEvidence.role) || "strategist", name: owner, key: owner };
    const role = member.role || "strategist";
    if (isGameMaster(role)) {
        openAgentInspector(member.name || owner);
        return;
    }
    const key = castKeyForRole(role);
    const ev = cardEvidence[member.name] || workerEvidenceFromState(member.name) || liveCardEvidence(member.name);
    const color = ROLE_COLOR[role] || ROLE_COLOR[key] || T.blue;
    const portrait = `/game/assets/generated/characters/${key}.png`;
    workerInspectorOwner = member.name || owner;
    workerInspectorOpen = true;
    closeAgentInspector();
    stage.style.setProperty("--card-accent", hexToRgba(color, 0.9));
    stage.style.setProperty("--cast-aura", hexToRgba(color, 0.34));
    stage.innerHTML =
        `<div class="cast-card worker">`
        + `<div class="cast-card-inner">`
        + `<div class="cast-face cast-front">`
        + `<div class="cast-card-art worker-art"><div class="cast-fig" style="background-image:url('${portrait}')"></div></div>`
        + `<div class="worker-card-label"><span>Digital Worker</span><b>${esc(member.name || owner)}</b><em>${esc(ROLE_NAME[role] || role)}</em></div>`
        + `<div class="worker-flip-zone" title="Double-click to flip to deep receipts"></div>`
        + `<button class="cast-close" type="button" aria-label="Close worker dossier">&times;</button>`
        + `<div class="cast-dossier" data-sheet="peek"><button class="cast-sheet-handle" type="button" aria-label="Resize receipts sheet"></button>${dossierBackHTML(ev)}</div>`
        + `</div>`
        + `<div class="cast-face cast-back"><button class="cast-close" type="button" aria-label="Close worker dossier">&times;</button>`
        + `<div class="cast-back-panel"><div class="cast-back-kicker">Worker deep receipts</div>${dossierBackHTML(ev)}</div></div>`
        + `</div>`
        + `</div>`;
    stage.className = "inspect show";
    setStageLayer("inspecting-worker", true);
    const cardEl = stage.querySelector(".cast-card");
    if (cardEl) bindInspectorCardFlip(cardEl);
}

function closeWorkerInspector() {
    workerInspectorOpen = false;
    workerInspectorOwner = null;
    const stage = $("worker-stage");
    if (stage) {
        stage.className = "";
        stage.innerHTML = "";
    }
    setStageLayer("inspecting-worker", false);
}
function toggleAgentInspector() {
    if (inspectorOpen) closeAgentInspector();
    else {
        const aw = activeWorkerSnapshot();
        if (aw && aw.role && !isGameMaster(aw.role)) openWorkerInspector(aw.displayName || ROLE_NAME[aw.role] || aw.role);
        else openAgentInspector();
    }
}

function cycleInspectorSheet(card) {
    const sheet = card && card.querySelector(".cast-dossier");
    if (!sheet) return;
    const order = ["peek", "mid", "full"];
    const current = sheet.dataset.sheet || "mid";
    sheet.dataset.sheet = order[(order.indexOf(current) + 1) % order.length] || "mid";
}

function setInspectorSheetFromPointer(card, clientY) {
    const sheet = card && card.querySelector(".cast-dossier");
    if (!card || !sheet) return;
    const rect = card.getBoundingClientRect();
    const ratio = (clientY - rect.top) / Math.max(1, rect.height);
    sheet.dataset.sheet = ratio < 0.42 ? "full" : ratio < 0.68 ? "mid" : "peek";
}

function toggleInspectorFlip(card) {
    if (!card) return;
    card.classList.toggle("flipped");
}

function inspectorFlipBlocked(target) {
    return !!(target.closest(".cast-close") || target.closest(".cc-section-toggle")
        || target.closest(".cc-suggestion") || target.closest(".cast-sheet-handle")
        || target.closest("a") || target.closest("button"));
}

function bindInspectorCardFlip(cardEl) {
    if (!cardEl || cardEl.dataset.flipBound) return;
    cardEl.dataset.flipBound = "1";
    cardEl.addEventListener("dblclick", (event) => {
        if (inspectorFlipBlocked(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        toggleInspectorFlip(cardEl);
        castTapStamp = 0;
    });
}

let castTapStamp = 0;
let castDragCard = null;
function bindInspectorInteractions(castStage) {
    if (!castStage || castStage.dataset.inspectorBound) return;
    castStage.dataset.inspectorBound = "1";
    castStage.addEventListener("click", (e) => {
        const sectionToggle = e.target.closest(".cc-section-toggle");
        if (sectionToggle) {
            e.preventDefault();
            e.stopPropagation();
            const section = sectionToggle.closest(".cc-section");
            const open = !section.classList.contains("open");
            section.classList.toggle("open", open);
            sectionToggle.setAttribute("aria-expanded", open ? "true" : "false");
            return;
        }
        const suggestion = e.target.closest(".cc-suggestion");
        if (suggestion) {
            e.preventDefault();
            e.stopPropagation();
            const input = $("player-command-input");
            if (input) {
                input.value = suggestion.dataset.suggestion || suggestion.textContent || "";
                input.focus();
            }
            setActionHint("Worker suggestion loaded - edit or send it as your next move.");
            return;
        }
        if (e.target.closest(".cast-close")) {
            if (castStage.id === "worker-stage") closeWorkerInspector();
            else closeAgentInspector();
            return;
        }
        const handle = e.target.closest(".cast-sheet-handle");
        if (handle) {
            e.preventDefault();
            e.stopPropagation();
            cycleInspectorSheet(e.target.closest(".cast-card"));
            castTapStamp = 0;
            return;
        }
        const card = e.target.closest(".cast-card");
        if (card && !inspectorFlipBlocked(e.target)) {
            const now = Date.now();
            if (now - castTapStamp < 340) {
                e.preventDefault();
                e.stopPropagation();
                toggleInspectorFlip(card);
                castTapStamp = 0;
            } else {
                castTapStamp = now;
            }
        }
    });
    castStage.addEventListener("pointerdown", (e) => {
        const card = e.target.closest(".cast-card");
        if (!card) return;
        const handle = e.target.closest(".cast-sheet-handle");
        if (handle) {
            castDragCard = card;
            handle.setPointerCapture?.(e.pointerId);
            return;
        }
    });
    castStage.addEventListener("pointermove", (e) => {
        if (!castDragCard) return;
        e.preventDefault();
        setInspectorSheetFromPointer(castDragCard, e.clientY);
    });
    const endDrag = () => { castDragCard = null; };
    castStage.addEventListener("pointerup", endDrag);
    castStage.addEventListener("pointercancel", endDrag);
}

// --- Speaker spotlight -----------------------------------------------------
// When a core game-master agent (World Designer / Org Designer) is talking, the
// character pops onto the stage with a live speech bubble and an optional image.
// Non-modal: it never blurs the stage or steals pointer focus, and it always
// yields to the on-demand inspector. Workers keep the reasoning theater instead.
const SPOTLIGHT_ROLES = new Set(["narrator", "orgdesigner"]);
let spotlightRole = null;
let spotlightName = null;

function showSpeakerSpotlight(role, displayName, opts = {}) {
    const stage = $("cast-stage");
    if (!stage || inspectorOpen) return;
    const key = castKeyForRole(role);
    // Same speaker already on stage: just refresh the optional image, keep the
    // card. Keyed on the display name too so a different group-chat persona
    // sharing a role (e.g. a dynamic NPC vs the Strategist) rebuilds the card.
    if (spotlightRole === role && spotlightName === (displayName || null) && stage.classList.contains("speaking")) {
        if (opts.image) setSpeakerSpotlightImage(opts.image, opts.caption);
        return;
    }
    const agentClass = agentClassForRole(role);
    const color = agentClass === "rival" ? T.bad : (ROLE_COLOR[role] || ROLE_COLOR[key] || T.narrator);
    const heroName = displayName || CAST_NAME[key] || ROLE_NAME[role] || role;
    const roleLabel = ROLE_NAME[role] || role;
    const src = castPortraitSrc(key);
    stage.style.setProperty("--card-accent", hexToRgba(color, 0.9));
    stage.style.setProperty("--cast-aura", hexToRgba(color, 0.34));
    const imgHtml = opts.image
        ? `<div class="cast-shot"><img src="${esc(opts.image)}" alt="${esc(opts.caption || "")}" onerror="this.closest('.cast-shot').style.display='none'" />`
          + (opts.caption ? `<span>${esc(opts.caption)}</span>` : "") + `</div>`
        : "";
    // Frame the card by agent class: the world masters (gm) get the gold
    // announcement treatment with a herald eyebrow, so a world-master speaking
    // reads as a deliberate announcement to the player, not a worker aside.
    // Workers / the rival (rare on this spotlight) keep the role-colored frame.
    // Game Master and rival announcements are a bridge layer: the announcer and
    // the active stage card compose together while the footer steps aside.
    // Worker reports keep the footer in place.
    const isBridgeAnnouncement = agentClass === "gm" || agentClass === "rival";
    setStageLayer("announce-bridge", isBridgeAnnouncement);
    let announce = "";
    let stageClass = "speaking show";
    let cardClass = "cast-card worker";

    if (agentClass === "gm") {
        announce = `<div class="cast-announce">&#9818; Announcement</div>`;
        stageClass = "speaking show gm-announce";
        cardClass = "cast-card";
    } else if (agentClass === "rival") {
        announce = `<div class="cast-announce">&#9876; Competitive Threat</div>`;
        stageClass = "speaking show rival-announce";
        cardClass = "cast-card worker rival";
    } else {
        announce = `<div class="cast-announce">&#9783; Digital Worker Report</div>`;
        stageClass = "speaking show worker-attention";
        cardClass = "cast-card worker";
    }

    stage.innerHTML =
        `<div class="${cardClass}">`
        + `<div class="cast-card-art"><div class="cast-fig" style="background-image:url('${src}')"></div></div>`
        + imgHtml
        + `<div class="cast-speech">${announce}<div class="cast-speech-name">${esc(heroName)}<span>${esc(roleLabel)}</span></div>`
        + `<div class="cast-speech-line" id="cast-speech-line"></div></div>`
        + `</div>`;
    stage.className = stageClass;
    // CSS uses this body class to resize the world canvas and remove the hidden
    // narration reserve. Always clear it in hideSpeakerSpotlight/openInspector.
    setStageLayer("spotlight-active", true);
    spotlightRole = role;
    spotlightName = displayName || null;
}

function setSpeakerSpotlightLine(text) {
    const el = $("cast-speech-line");
    if (el) el.textContent = text;
}

function setSpeakerSpotlightImage(src, caption) {
    const stage = $("cast-stage");
    if (!stage || !stage.classList.contains("speaking")) return;
    const card = stage.querySelector(".cast-card");
    if (!card) return;
    let shot = card.querySelector(".cast-shot");
    if (!shot) {
        shot = document.createElement("div");
        shot.className = "cast-shot";
        const art = card.querySelector(".cast-card-art");
        if (art && art.nextSibling) card.insertBefore(shot, art.nextSibling);
        else card.appendChild(shot);
    }
    shot.style.display = "";
    shot.innerHTML = `<img src="${esc(src)}" alt="${esc(caption || "")}" onerror="this.closest('.cast-shot').style.display='none'" />`
        + (caption ? `<span>${esc(caption)}</span>` : "");
}

function hideSpeakerSpotlight() {
    if (inspectorOpen) return; // the inspector owns the stage while open
    const stage = $("cast-stage");
    if (!stage || !spotlightRole) return;
    stage.className = "";
    stage.innerHTML = "";
    setStageLayer("spotlight-active", false);
    setStageLayer("announce-bridge", false); // glide the footer back
    spotlightRole = null;
    spotlightName = null;
}


// Character art assets used by the on-demand footer inspector. The old
// decorative always-on floating cast is intentionally disabled: the lower stage
// belongs to the hand + dialogue, and the footer is the explicit doorway to the
// full card.
const CAST_ROLES = new Set(["narrator", "orgdesigner", "strategist", "designer", "marketer", "ops", "founder"]);
// The cast's in-world character names (the deck's heroes). Dynamically-titled
// workers map onto one of these archetypes and inherit its name + art, while
// their generated job title rides along as the card's tagline.
const CAST_NAME = {
    narrator: "The Worldkeeper", orgdesigner: "The Architect", strategist: "Soren",
    designer: "Dahlia", marketer: "Maddox", ops: "The Steward", founder: "You",
};
let castRole = null;

// Small helper: a token hex (#rrggbb) -> rgba() string for inline glow colors.
function hexToRgba(hex, alpha) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || "").trim());
    if (!m) return `rgba(91,140,255,${alpha})`;
    return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${alpha})`;
}

// Show the model's visible "thinking": reasoning-token count and, when the
// deployment exposes it, a short chain-of-thought preview. This is the model
// reasoning over the player's public business brief - no secrets - and it is
// HTML-escaped before display. Hidden when there is nothing to show.
function setReasoning(inv) {
    const el = $("worker-reasoning");
    if (!el) return;
    const tokens = Number(inv && inv.reasoning_tokens) || 0;
    const preview = (inv && inv.reasoning_preview) || "";
    const isMaf = !!(inv && inv.framework === "microsoft-agent-framework");
    const hasMem = !!(inv && (inv.maf_memory || []).length);
    if (!tokens && !preview && !isMaf && !hasMem) { el.hidden = true; el.innerHTML = ""; return; }
    let html = `<div class="rz-head">&#9670; Reasoning`;
    if (tokens) html += ` <span class="rz-tokens">${tokens} thinking tokens</span>`;
    html += `</div>`;
    if (preview) html += `<div class="rz-text">&ldquo;${esc(preview)}&hellip;&rdquo;</div>`;
    // Teach the runtime: memory injected (ContextProvider on the MAF path,
    // briefed directly otherwise) and the FunctionTools the model called.
    if (isMaf || hasMem) {
        const mem = (inv.maf_memory || []).map((m) =>
            `<span class="tool-chip">${m.kind === "ceo_decision" ? "&#9819; decision" : m.kind === "agent_memory" ? "&#9851; memory" : m.kind === "current_event" ? "&#128240; live" : "&#9783; IQ"}: ${esc((m.text || "").slice(0, 36))}</span>`).join(" ");
        const called = (inv.maf_tools_called || []).map((t) =>
            `<span class="tool-chip">&#9874; ${esc(t)}</span>`).join(" ");
        if (isMaf) html += `<div class="rz-head" style="margin-top:8px">&#10038; Agent Framework run</div>`;
        if (mem) html += `<div class="rz-text">memory injected${isMaf ? " (ContextProvider)" : ""}: ${mem}</div>`;
        if (called) html += `<div class="rz-text">tools the model called: ${called}</div>`;
        if (isMaf && !mem && !called) html += `<div class="rz-text">agent ran on Microsoft Agent Framework</div>`;
    }
    el.innerHTML = html;
    el.hidden = false;
}

function setMemory(hits) {
    const host = $("memory");
    if (!host) return;
    if (!hits || hits.length === 0) {
        host.innerHTML = `<div class="mem-empty">No memory recalled for this stage.</div>`;
        return;
    }
    host.innerHTML = "";
    hits.forEach((h, i) => {
        const div = document.createElement("div");
        div.className = "mem-item";
        div.style.animationDelay = `${i * 140}ms`;
        const body = (h.content || "").replace(/\s+/g, " ").slice(0, 160);
        div.innerHTML = `<div class="mem-src">&#9670; ${h.source || "knowledge"}</div><div class="mem-body">${body}...</div>`;
        host.appendChild(div);
    });
}

// Under the Hood: accuracy / reasoning / reliability tracked live as the
// game plays. Each chapter, gate, and CEO decision feeds a row with REAL run
// evidence - the player (and any judge watching) can always answer "is it
// grounded, is it thinking, can I trust it?" by glancing at the rail.
const lensState = { accuracy: 0, reasoning: 0, reliability: 0 };
function lens(dim, evidence) {
    const row = $(`lens-${dim}`);
    if (!row || !(dim in lensState)) return;
    lensState[dim] += 1;
    row.classList.add("lit");
    row.querySelector(".lens-count").textContent = `\u00d7${lensState[dim]}`;
    if (evidence) row.querySelector(".lens-evidence").textContent = evidence;
    if (evidence) diagLog("info", `lens:${dim}`, evidence);
}

// Agent Memory panel: what the workers have LEARNED from this CEO (separate
// from IQ source knowledge). Reads /api/memory - Foundry Agent Service memory
// store when configured, the local ledger otherwise - and renders the three
// memory kinds. Best-effort: the panel must never block the run loop.
const LEARNED_KIND = {
    user_profile: { ico: "&#9818;", label: "profile" },
    procedural: { ico: "&#9851;", label: "pattern" },
    chat_summary: { ico: "&#9783;", label: "shipped" },
};
let learnedCount = 0; // how many memories the workers hold (drives narration)
async function refreshLearned() {
    const host = $("learned");
    if (!host) return;
    let snap;
    try {
        const res = await fetch("/api/memory");
        if (!res.ok) return;
        snap = await res.json();
    } catch (_) { return; }
    const groups = (snap && snap.memories) || {};
    const rows = [];
    ["procedural", "user_profile", "chat_summary"].forEach((kind) => {
        (groups[kind] || []).slice(-3).reverse().forEach((m) => rows.push({ kind, text: m.text || "" }));
    });
    learnedCount = rows.length;
    if (!rows.length) return; // keep the teaching placeholder until something lands
    host.innerHTML = `<div class="mem-item" style="animation:none;border-style:dashed"><div class="mem-src">&#9670; ${
        snap.store === "foundry-memory" ? "Foundry Agent Service memory" : "local memory ledger"}</div></div>`;
    rows.slice(0, 6).forEach((m, i) => {
        const k = LEARNED_KIND[m.kind] || LEARNED_KIND.procedural;
        const div = document.createElement("div");
        div.className = "mem-item";
        div.style.animationDelay = `${i * 110}ms`;
        div.innerHTML = `<div class="mem-src">${k.ico} ${k.label}</div><div class="mem-body">${esc(m.text.slice(0, 150))}</div>`;
        host.appendChild(div);
    });
}

function diagTime(ts) {
    try {
        return new Date(ts || Date.now()).toLocaleTimeString();
    } catch (_) {
        return "--:--:--";
    }
}

function diagRenderList(host, entries, emptyLabel) {
    if (!host) return;
    if (!entries.length) {
        host.innerHTML = `<li class="empty"><b>${escText(emptyLabel)}</b></li>`;
        return;
    }
    host.innerHTML = entries.map((entry) => {
        let payloadHtml = "";
        if (entry.payload) {
            try {
                const pretty = JSON.stringify(entry.payload, null, 2);
                payloadHtml = `<details class="diag-payload-wrap">`
                    + `<summary class="diag-payload-toggle">payload &middot; ${pretty.length} chars</summary>`
                    + `<pre class="diag-payload">${escText(pretty)}</pre>`
                    + `</details>`;
            } catch (_) {
                payloadHtml = `<details class="diag-payload-wrap">`
                    + `<summary class="diag-payload-toggle">payload</summary>`
                    + `<pre class="diag-payload">${escText(String(entry.payload).slice(0, 1200))}</pre>`
                    + `</details>`;
            }
        }
        return `<li><b>${escText(`[${diagTime(entry.ts)}] ${entry.message}`)}</b>${payloadHtml}</li>`;
    }).join("");
}

function backendReplayEntries(run) {
    const log = Array.isArray(run && run.replay_log) ? run.replay_log : [];
    return log.slice(-80).reverse().map((event) => ({
        ts: Date.parse(event.timestamp || "") || Date.now(),
        message: `${event.event_type || "EVENT"} · ${event.actor || "system"} · ${(event.message || "").slice(0, 160)}`,
        payload: event.payload || null,
    }));
}

function mafTraceEntries(run) {
    const invocations = (run && run.world && Array.isArray(run.world.invocations)) ? run.world.invocations : [];
    const out = [];
    invocations.slice(-30).reverse().forEach((inv) => {
        const toolNames = (inv.maf_tools_called || inv.tools_drawn || []).slice(0, 6);
        const trace = Array.isArray(inv.tool_trace) ? inv.tool_trace.slice(-3) : [];
        out.push({
            ts: Date.now(),
            message: `${inv.worker_title || inv.role || "worker"} · ${cleanDeployLabel(inv.deployment) || "simulation"} · ${inv.framework || "direct"}`,
            payload: {
                stage: inv.stage_id || "",
                status: inv.status || "completed",
                tools: toolNames,
                trace: trace.map((t) => ({ call: t.call, ms: t.duration_ms, source: t.source })),
            },
        });
    });
    return out;
}

function openDiagPanel(name) {
    document.querySelectorAll(".diag-tab").forEach((btn) => {
        const active = btn.dataset.panel === name;
        btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    ["frontend", "backend", "maf"].forEach((id) => {
        const el = $(`diag-${id}`);
        if (el) el.classList.toggle("active", id === name);
    });
}

async function refreshDiagnostics(forcePull = false) {
    const meta = $("diag-meta");
    if (meta) meta.textContent = "Refreshing...";
    let run = latestRunState();
    if (forcePull) {
        try {
            const [stateRes, modeRes] = await Promise.allSettled([apiGet("/api/state"), apiGet("/api/mode")]);
            if (stateRes.status === "fulfilled" && stateRes.value && stateRes.value.state) {
                syncLatestState(stateRes.value.state);
                run = latestRunState();
            }
            if (modeRes.status === "fulfilled" && modeRes.value) {
                state.live = !!modeRes.value.live;
            }
        } catch (e) {
            diagLogError("diagnostics", e, "Could not refresh backend snapshot");
        }
    }

    const frontend = diagnostics.frontend.slice(0, 100);
    const backend = backendReplayEntries(run).slice(0, 100);
    const maf = mafTraceEntries(run).slice(0, 80);

    diagRenderList($("diag-frontend"), frontend, "No frontend events yet");
    diagRenderList($("diag-backend"), backend, "No backend replay entries yet");
    diagRenderList($("diag-maf"), maf, "No MAF/tool traces yet");

    const cntF = $("diag-cnt-frontend"); if (cntF) cntF.textContent = String(frontend.length);
    const cntB = $("diag-cnt-backend"); if (cntB) cntB.textContent = String(backend.length);
    const cntM = $("diag-cnt-maf"); if (cntM) cntM.textContent = String(maf.length);

    if (meta) {
        const runtime = state.live ? "live foundry" : "simulation";
        meta.textContent = `runtime: ${runtime} \u00b7 updated ${new Date().toLocaleTimeString()}`;
    }
}

let _diagPollTimer = null;

function openDiagnostics() {
    const overlay = $("diagnostics-overlay");
    if (!overlay) return;
    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");
    setStageLayer("diagnostics", true);
    refreshDiagnostics(true);
    if (_diagPollTimer) clearInterval(_diagPollTimer);
    _diagPollTimer = setInterval(() => refreshDiagnostics(false), 4000);
}

function closeDiagnostics() {
    const overlay = $("diagnostics-overlay");
    if (!overlay) return;
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
    setStageLayer("diagnostics", false);
    if (_diagPollTimer) { clearInterval(_diagPollTimer); _diagPollTimer = null; }
}

function wireDiagnosticsCapture() {
    if (window.__CampaignStoryDiagnosticsWired) return;
    window.__CampaignStoryDiagnosticsWired = true;
    window.addEventListener("error", (event) => {
        diagLog("error", "window", event.message || "Unhandled error", {
            file: event.filename || "",
            line: event.lineno || 0,
            column: event.colno || 0,
        });
    });
    window.addEventListener("unhandledrejection", (event) => {
        const reason = event.reason && event.reason.message ? event.reason.message : String(event.reason || "promise rejection");
        diagLog("error", "promise", reason);
    });
    // Tab switching: delegated to the document so it works even after re-renders.
    document.addEventListener("click", (event) => {
        const tab = event.target.closest(".diag-tab[data-panel]");
        const overlay = $("diagnostics-overlay");
        if (tab && overlay && !overlay.hidden) openDiagPanel(tab.dataset.panel);
    });
}

// The Agent Framework panel: per-run evidence of what the framework did.
// While the worker thinks it shows what the ContextProvider is injecting
// (live state); when the run lands it shows the REAL memory entries and the
// FunctionTools the model itself chose to call. Runs accumulate, newest on
// top, so the audience can scroll the whole session's agent activity.
function mafRunStart(workerName, chapterTitle) {
    const host = $("maf-panel");
    if (!host) return;
    const empty = host.querySelector(".mem-empty");
    if (empty) empty.remove();
    const lastDecision = state.decisions && state.decisions.length
        ? state.decisions[state.decisions.length - 1] : null;
    const div = document.createElement("div");
    div.className = "maf-run";
    div.id = "maf-run-live";
    let mem = `<span class="maf-chip mem">&#9783; Foundry IQ recall</span>`;
    if (lastDecision) mem = `<span class="maf-chip mem">&#9819; ${esc(lastDecision.option.slice(0, 34))}&hellip;</span> ` + mem;
    div.innerHTML = `
        <div class="maf-run-head"><span>${esc(workerName)} &middot; Agent</span><span class="maf-live">&#9679; running</span></div>
        <div class="maf-row"><b>ContextProvider injecting</b><br>${mem}</div>
        <div class="maf-row"><b>FunctionTools offered</b><br><span class="maf-chip">role validators</span></div>`;
    host.prepend(div);
}

function mafRunLand(inv) {
    const host = $("maf-panel");
    if (!host) return;
    const live = document.getElementById("maf-run-live");
    const isMaf = !!(inv && inv.framework === "microsoft-agent-framework");
    const hasMem = !!(inv && (inv.maf_memory || []).length);
    if (!isMaf && !hasMem) { if (live) live.remove(); return; }
    const mem = (inv.maf_memory || []).map((m) =>
        `<span class="maf-chip mem">${m.kind === "ceo_decision" ? "&#9819;" : m.kind === "agent_memory" ? "&#9851;" : m.kind === "current_event" ? "&#128240;" : "&#9783;"} ${esc((m.text || "").slice(0, 34))}</span>`).join(" ")
        || `<span class="maf-chip">none this run</span>`;
    const called = (inv.maf_tools_called || []).map((t) =>
        `<span class="maf-chip called">&#9874; ${esc(t)}</span>`).join(" ")
        || `<span class="maf-chip">none - clean first draft</span>`;
    const trace = inv.tool_trace || [];
    const usage = invocationTokenLine(inv);
    const cost = estimatedInvocationCost(inv);
    const traceLine = trace.length
        ? `${trace.length} server-recorded call${trace.length === 1 ? "" : "s"}; open the worker card for params/results.`
        : "no server-recorded toolbox calls";
    const div = live || document.createElement("div");
    div.className = "maf-run";
    div.removeAttribute("id");
    const clientTag = inv.maf_client ? `${esc(inv.maf_client)} &middot; ` : "";
    div.innerHTML = `
        <div class="maf-run-head"><span>${esc(inv.worker_title || inv.role || "worker")} &middot; Agent</span><span>${clientTag}${inv.latency_s ?? 0}s</span></div>
        <div class="maf-row"><b>Model usage</b><br><span class="maf-chip">${esc(inv.deployment || "simulation")}</span> <span class="maf-chip">${esc(usage)}</span>${cost ? ` <span class="maf-chip called">${esc(cost)} est.</span>` : ""}</div>
        <div class="maf-row"><b>Memory injected</b> <span style="opacity:.65">(ContextProvider)</span><br>${mem}</div>
        <div class="maf-row"><b>Tools the model called</b> <span style="opacity:.65">(FunctionTools)</span><br>${called}</div>
        <div class="maf-row"><b>Tool call receipts</b><br><span class="maf-chip">${esc(traceLine)}</span></div>`;
    if (!live) host.prepend(div);
    while (host.querySelectorAll(".maf-run").length > 4) host.lastElementChild.remove();
}

// Diegetic toolbox: name the tools the worker drew, in the worker card,
// BEFORE the artifact renders (the ludonarrative rule - the player watches
// the worker reach into the shared toolbox, never hears it narrated).
function setTools(names) {
    const el = $("worker-tools");
    if (!el) return;
    if (!names || !names.length) { el.hidden = true; el.innerHTML = ""; return; }
    el.innerHTML = `<div class="rz-head">&#9874; Toolbox</div>`
        + names.map((n) => `<span class="tool-chip">${esc(n)}</span>`).join("");
    el.hidden = false;
}

// The tools/call trace: every REAL call the worker made through the toolbox
// this run - tool name, arguments, deterministic result, wall-clock latency.
// Rendered as a terminal log so the audience sees receipts, not claims.
function setToolTrace(trace) {
    const el = $("worker-trace");
    if (!el) return;
    if (!trace || !trace.length) { el.hidden = true; el.innerHTML = ""; return; }
    let html = `<div class="rz-head">&#9654; tools/call trace <span style="opacity:.6">(${trace.length} live server-recorded call${trace.length === 1 ? "" : "s"})</span></div>`;
    trace.forEach((t, index) => {
        const argStr = t.args ? esc(JSON.stringify(t.args)).slice(0, 180) : "{}";
        html += `<div class="trace-line"><span class="tr-call">call ${index + 1}: ${esc(t.tool)}</span>`
            + `<span class="tr-args"> params ${argStr}</span>`
            + `<div class="tr-res">result ${esc(String(t.result || "ok")).slice(0, 220)} <span class="tr-ms">${t.ms}ms &middot; ${esc(t.source || "local")}</span></div></div>`;
    });
    el.innerHTML = html;
    el.hidden = false;
}

// Escape LLM-supplied text before injecting into the rail as HTML.
function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
}

renderResources();
setParty("narrator", "waiting for your founding brief");
setSceneStatus({
    actor: "World Designer",
    speaking: "The Worldkeeper",
    source: "waiting for founder brief",
});

// Dynamic org blueprint -> Mermaid org chart. The human operator is the root;
// digital workers (the execution layer) hang beneath, colored by kind.
function orgBlueprintMermaid(org) {
    if (!org || !Array.isArray(org.roles) || org.roles.length === 0) {
        return 'graph TD\n  X["No org designed"]';
    }
    const nid = (id) => `n_${String(id).replace(/[^a-zA-Z0-9_]/g, "")}`;
    const kindColor = (k) => (k === "human" ? T.blue : k === "hybrid" ? T.designer : T.ops);
    let def = "graph TD\n";
    org.roles.forEach((r) => {
        const w = r.kind === "human" ? 3 : 2;
        def += `  ${nid(r.id)}["${san(r.title)}"]\n`;
        def += `  style ${nid(r.id)} stroke:${kindColor(r.kind)},stroke-width:${w}px\n`;
    });
    org.roles.forEach((r) => {
        if (r.reports_to) def += `  ${nid(r.reports_to)} --> ${nid(r.id)}\n`;
    });
    return def;
}

// The dilemma receipt: the core game mechanic made legible as ONE card.
// A CEO choice fires a deterministic chain - decision -> consequence (metrics,
// org, economics) -> procedural memory the workers learn -> the next worker's
// binding brief. The four steps render as a single connected receipt so the
// player sees cause and effect, not four disconnected updates. Built entirely
// from the /api/decision response (real state), never fabricated.
function renderDilemmaReceipt(receipt) {
    const host = $("diagram");
    const consequence = receipt && receipt.consequence;
    if (!host || !consequence) return;
    const before = consequence.before || {};
    const after = consequence.after || {};
    const orgDelta = consequence.org_delta || {};
    const option = receipt.option || consequence.summary || "your decision";
    const tradeoff = receipt.tradeoff || "";
    const memory = receipt.memory || null;
    const nextBrief = receipt.nextBrief || null;
    const principle = receipt.principle || null;

    // Only surface metric rows that actually moved - keeps the receipt compact
    // and makes the consequence of THIS choice unmistakable.
    const candidates = [
        ["Digital workers", before.digital_worker_count, after.digital_worker_count],
        ["Monthly burn", before.monthly_burn_usd, after.monthly_burn_usd, fmtMoney],
        ["Leverage", before.leverage_ratio, after.leverage_ratio, (v) => `${v || 0}x`],
        ["Proof", before.proof, after.proof],
        ["Trust", before.trust, after.trust],
        ["Velocity", before.velocity, after.velocity],
        ["Autonomy", before.autonomy, after.autonomy],
        ["Burn pressure", before.burn_pressure, after.burn_pressure],
    ];
    const changed = candidates.filter(([, a, b]) => a !== undefined && b !== undefined && String(a) !== String(b));
    const rows = (changed.length ? changed : candidates.slice(0, 4));
    const effectGrid = rows.map(([label, a, b, fmt]) => {
        const fa = fmt ? fmt(a) : a;
        const fb = fmt ? fmt(b) : b;
        const moved = String(a) !== String(b);
        return `<div class="effect-row${moved ? " moved" : ""}">
                <span>${esc(label)}</span>
                <b>${esc(fa)}</b>
                <i>&rarr;</i>
                <strong>${esc(fb)}</strong>
            </div>`;
    }).join("");

    const memOrigin = memory && memory.origin ? memory.origin : "local-memory";
    const memText = memory && memory.text
        ? memory.text
        : `The workforce remembers you chose "${String(option).slice(0, 80)}".`;

    const nextStep = nextBrief
        ? `<div class="receipt-step next">
                <div class="receipt-step-head"><span class="receipt-num">4</span> Next brief
                    ${nextBrief.adapted ? `<em class="receipt-adapted">world adapted${nextBrief.adapted_reason ? ` &middot; ${esc(nextBrief.adapted_reason)}` : ""}</em>` : ""}</div>
                <div class="receipt-next">
                    <b>${esc(nextBrief.title || "Next stage")}</b>
                    ${nextBrief.assigned_worker_title ? `<span>&#9851; <em>${esc(nextBrief.assigned_worker_title)}</em> executes this with your decision as binding direction</span>` : `<span>carries your decision as binding direction</span>`}
                </div>
            </div>`
        : `<div class="receipt-step next">
                <div class="receipt-step-head"><span class="receipt-num">4</span> Next brief</div>
                <div class="receipt-next"><span>This was the final gate - the decision colors the finale.</span></div>
            </div>`;

    host.innerHTML = `<div class="consequence-board fade-scene">`
        + `<div class="consequence-kicker">Decision receipt &middot; ${esc(consequence.rule_id || "decision")}</div>`
        + `<div class="receipt-chain">`
        // Step 1: the decision
        + `<div class="receipt-step decision">
                <div class="receipt-step-head"><span class="receipt-num">1</span> You decided</div>
                <div class="receipt-decision">&ldquo;${esc(option)}&rdquo;</div>
                ${tradeoff ? `<div class="receipt-tradeoff">tradeoff accepted: ${esc(tradeoff)}</div>` : ""}
                ${principle && principle.name ? `<div class="receipt-principle">&#128218; <b>${esc(principle.name)}</b> &mdash; ${esc(principle.insight || "")}</div>` : ""}
            </div>`
        + `<div class="receipt-arrow">&darr;</div>`
        // Step 2: the consequence
        + `<div class="receipt-step consequence">
                <div class="receipt-step-head"><span class="receipt-num">2</span> Consequence applied</div>
                <h2>${esc(consequence.summary || "The company changes.")}</h2>
                ${orgDelta.added_role_title ? `<div class="consequence-role">Org graph gains: <b>${esc(orgDelta.added_role_title)}</b> (${fmtMoney(orgDelta.monthly_cost_usd)}/mo)</div>` : ""}
                ${orgDelta.removed_role_title ? `<div class="consequence-role">Org graph retires: <b>${esc(orgDelta.removed_role_title)}</b></div>` : ""}
                <div class="effect-grid">${effectGrid}</div>
            </div>`
        + `<div class="receipt-arrow">&darr;</div>`
        // Step 3: the memory the workers learn
        + `<div class="receipt-step memory">
                <div class="receipt-step-head"><span class="receipt-num">3</span> Workers learned
                    <em class="receipt-origin">&#9851; ${esc(memOrigin)}</em></div>
                <div class="receipt-memory">${esc(memText)}</div>
            </div>`
        + `<div class="receipt-arrow">&darr;</div>`
        // Step 4: the next brief
        + nextStep
        + `</div></div>`;
    if (A.chime) { try { A.chime(); } catch (_) {} }
}

// Footer economy HUD: the real-time payroll clock. The player runs a company
// and pays the workforce its normal wages over time - 1 real minute is 1
// in-game day, so the treasury drains every day. This is the stake: keep the
// treasury above zero or the run is lost. Everything else (proof/trust/etc.)
// lives on the agent cards now, so the footer is the money + the clock.
function setEconHud(org) {
    const host = $("econ-hud");
    if (!host) return;
    const econ = state.economics || {};
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const treasury = num(econ.points ?? econ.treasury_started_usd ?? 10000);
    const burnMonth = num(econ.monthly_burn_usd ?? (org ? org.monthly_burn_usd : 0));
    const dailyBurn = num(econ.daily_burn_usd) || Math.round(burnMonth / 30);
    const revMonth = num(econ.monthly_revenue_usd);
    const dailyRev = Math.round(revMonth / 30);
    const dayN = Math.floor(num(econ.days_elapsed));
    const runwayDays = num(econ.runway_days);
    const treasuryClass = runwayDays <= 7 ? "bad" : (runwayDays <= 21 ? "warn" : "good");
    const runwayLabel = runwayDays >= 999 ? "profitable"
        : (runwayDays >= 365 ? `${Math.round(runwayDays / 30).toLocaleString()}mo runway`
        : `${runwayDays.toLocaleString()}d runway`);

    let html = `<span class="econ-pill ${treasuryClass}" title="Treasury - cash left to keep the company running. At zero, the run is over."><i>💰</i> Treasury: <b>$${treasury.toLocaleString()}</b></span>`
        + `<span class="econ-pill gold-glow" title="In-game day. 1 real minute = 1 day."><i>📅</i> Day <b>${dayN.toLocaleString()}</b></span>`
        + `<span class="econ-pill" title="Daily run cost - cheap model inference + tooling for the digital workforce, charged every in-game day"><i>📉</i> Burn: <b>-$${dailyBurn.toLocaleString()}</b>/day</span>`;
    if (dailyRev > 0) {
        html += `<span class="econ-pill good" title="Daily revenue booked"><i>📈</i> Rev: <b>+$${dailyRev.toLocaleString()}</b>/day</span>`;
    }
    html += `<span class="econ-pill ${treasuryClass}" title="Days of treasury left at the current net burn"><i>⏳</i> <b>${runwayLabel}</b></span>`;

    // Market share: the company's earned slice of its addressable market. This
    // is where revenue comes from - won by shipping verified work and good
    // strategy, contested by the rival. It is the "are we actually winning?"
    // number, distinct from the cash treasury.
    const share = num(econ.market_share);
    const customers = num(econ.paying_customers);
    const arpu = num(econ.arpu_usd);
    if (share > 0 || num(econ.addressable_market_usd) > 0) {
        const shareClass = share >= 15 ? "good" : (share >= 5 ? "" : "warn");
        const tamCustomers = arpu > 0 ? Math.round(num(econ.addressable_market_usd) / arpu) : 0;
        const marketTip = tamCustomers > 0
            ? `Share of your addressable market (~${tamCustomers.toLocaleString()} reachable customers). You hold ${share.toFixed(1)}% = ${customers.toLocaleString()} paying customers. Win it by shipping verified stages and smart strategy; the rival contests it.`
            : `Share of your addressable market. Revenue is a slice of the market this size. Win it by shipping verified stages and smart strategy; the rival contests it.`;
        html += `<span class="econ-pill ${shareClass}" title="${esc(marketTip)}"><i>🌐</i> Market: <b>${share.toFixed(1)}%</b></span>`;
    }
    // Paying customers: the concrete thing behind the revenue. No customers,
    // no money - so the player can always see WHO is paying and how that maps
    // to the dollars. Derived from share, so it moves only when share is won.
    if (customers > 0 || revMonth > 0) {
        const custClass = customers > 0 ? "good" : "warn";
        const custTip = arpu > 0
            ? `${customers.toLocaleString()} paying customers x $${arpu.toLocaleString()}/mo = $${revMonth.toLocaleString()}/mo revenue. Win more by growing market share - ship verified stages and play the Customer Signal card.`
            : `Paying customers behind your revenue.`;
        html += `<span class="econ-pill ${custClass}" title="${esc(custTip)}"><i>👥</i> <b>${customers.toLocaleString()}</b> customers</span>`;
    }

    if (org && org.digital_worker_count) {
        html += `<span class="econ-pill" title="digital workforce on payroll"><i>🛠️</i> <b>${org.digital_worker_count}</b> workers</span>`;
    }
    // The live threat: the rival gains ground over time. At 100 the run is lost -
    // play counterplay cards and complete stages to push it back down.
    const arc = (state.game && state.game.antagonist_arc) || {};
    const threat = num(arc.threat_level);
    if (threat > 0) {
        const ant = state.antagonist || ((state.latestServerState || {}).antagonist) || {};
        const rival = arc.antagonist_name || "Rival";
        const stage = arc.escalation_stage || "watching";
        const tClass = threat >= 60 ? "bad" : (threat >= 40 ? "warn" : "");
        const orgName = ant.organization_name || `${rival} counter-org`;
        const roleLine = Array.isArray(ant.organization_roles) && ant.organization_roles.length
            ? ` Rival team: ${ant.organization_roles.slice(0, 3).map((r) => r.title || r.pressure_lane || "agent").join(", ")}.`
            : "";
        const latestMove = Array.isArray(arc.moves) && arc.moves.length ? arc.moves[arc.moves.length - 1] : null;
        const latestRole = latestMove && (latestMove.rival_role_title || latestMove.rival_pressure_lane)
            ? ` Latest move owner: ${latestMove.rival_role_title || "rival operator"}${latestMove.rival_pressure_lane ? ` (${latestMove.rival_pressure_lane})` : ""}.`
            : "";
        const rivalTip = `${rival} is your antagonist. ${orgName}: ${sanitizeAntagonistDesc(ant.organization_model || "a rival organization countering your workforce.")} Motivation: ${sanitizeAntagonistDesc(ant.motivation || "capture the market before you can.")} Tactic: ${sanitizeAntagonistDesc(ant.signature_tactic || arc.current_pressure || "pressure your weak metric.")} Active operation: ${sanitizeAntagonistDesc(ant.active_operation || arc.current_pressure || "contest your market share.")}${roleLine}${latestRole} At 100/100 it wins the market and the run is lost. Push it back with counterplay cards, verified stages, and trusted revenue.`;
        html += `<span class="econ-pill ${tClass}" title="${esc(rivalTip)}">`
            + `<i>&#9876;</i> ${esc(rival)}: <b>${threat}</b>/100 &middot; ${esc(stage)}</span>`;
    }
    host.innerHTML = html;
    ensureEconClock();
}

// Real-time payroll clock: while a run is active, poll the server (the single
// source of truth for elapsed wall-clock -> in-game days -> wages charged) so
// the treasury visibly drains and a bankruptcy is surfaced even between moves.
let _econClockTimer = null;
function ensureEconClock() {
    if (_econClockTimer) return;
    _econClockTimer = setInterval(async () => {
        const game = state.game || {};
        if (!Array.isArray(state.stages) || !state.stages.length
            || String(game.run_status || "active").toLowerCase() !== "active") {
            return; // nothing running; keep the timer cheap and idle
        }
        let snap;
        try {
            const res = await fetch("/api/state");
            if (!res.ok) return;
            snap = (await res.json()).state;
        } catch (_) { return; }
        if (!snap) return;
        if (snap.economics) state.economics = snap.economics;
        if (snap.org) state.org = snap.org;
        if (snap.game) state.game = snap.game;
        setEconHud(state.org);
        reactToWorkforceContraction(snap.org);
        reactToRivalEscalation(snap.game);
        const status = String((snap.game || {}).run_status || "active").toLowerCase();
        if (status !== "active") {
            // The clock just decided the run (bankruptcy or the rival reaching
            // 100 between moves). Route through syncGameState so the run-over
            // moment surfaces exactly as it does after a played card.
            syncGameState(snap.game);
            const hint = $("hint");
            if (hint) hint.textContent = (snap.game && (snap.game.defeat_reason || snap.game.victory_reason)) || "The run is over.";
        }
    }, 4000);
}

// The world reacts when the workforce contracts. When the company can't sustain
// its burn, the real-time clock lays off its most expensive worker (burn falls,
// the org shrinks). Detect the drop in digital_worker_count between polls and
// surface it as a felt beat: refresh the workforce rail, narrate the layoff,
// and flash the burn pill so "you're losing people because you're not making
// money" lands as an event, not a silent number change.
let _lastWorkerCount = null;
function reactToWorkforceContraction(org) {
    if (!org) return;
    const count = Number(org.digital_worker_count || 0);
    setOrgPanel(org); // keep the workforce rail in lockstep with the clock
    if (_lastWorkerCount === null) { _lastWorkerCount = count; return; }
    if (count >= _lastWorkerCount) { _lastWorkerCount = count; return; }
    _lastWorkerCount = count;
    // A worker was just let go. Name it from the org note the backend appended.
    const notes = Array.isArray(org.notes) ? org.notes : [];
    const layoff = [...notes].reverse().find((n) => /laid off/i.test(n)) || "";
    const who = (layoff.match(/Laid off ([^:]+):/i) || [])[1] || "your most expensive worker";
    const burn = Number(org.monthly_burn_usd || 0);
    const beat = $("scene-beat");
    if (beat) beat.textContent = "Workforce contraction";
    const prov = $("scene-prov");
    if (prov) prov.textContent = "unprofitable - burn trimmed";
    const hint = $("hint");
    if (hint) hint.innerHTML = `<span class="run-pulse"><span class="run-state bad">\u26a0\ufe0f Laid off ${esc(who)} \u2014 you're spending faster than you earn.</span>`
        + `<span class="run-next">Ship a stage to win revenue, or burn keeps shrinking the team.</span></span>`;
    // Flash the burn pill (the one showing the daily run cost) so the eye lands
    // on the cost that just forced the cut.
    const pill = document.querySelector('#econ-hud .econ-pill[title*="run cost"]')
        || document.querySelector("#econ-hud .econ-pill");
    if (pill) { pill.classList.remove("pulse-flash"); void pill.offsetWidth; pill.classList.add("pulse-flash"); }
    try { lens("reliability", `Workforce contracted: ${who} laid off - burn now $${burn.toLocaleString()}/mo. Memory written so later briefs carry the pressure.`); } catch (_) {}
    try { if (A && A.chime) A.chime(); } catch (_) {}
}

// The world reacts when the rival escalates. The clock can push the antagonist
// into a higher stage between moves; when it does, the rival plays a visible
// move (arc.current_pressure). Surface that as a scene beat + action hint and
// flash the threat pill so the rising number lands as a felt event, not a
// silent tick. Fires once per stage transition.
let _lastEscalationStage = "";
function reactToRivalEscalation(game) {
    const arc = (game && game.antagonist_arc) || {};
    const stage = String(arc.escalation_stage || "watching");
    const order = ["watching", "probing", "contesting", "crisis", "endgame"];
    if (!_lastEscalationStage) { _lastEscalationStage = stage; return; }
    if (order.indexOf(stage) <= order.indexOf(_lastEscalationStage)) {
        _lastEscalationStage = stage;
        return;
    }
    _lastEscalationStage = stage;
    const rival = arc.antagonist_name || "The rival";
    const pressure = sanitizeAntagonistDesc(arc.current_pressure || `${rival} escalates to ${stage}.`);
    ensureVillainPortrait();
    // Scene-head beat: the world announces the rival's move.
    const beat = $("scene-beat");
    if (beat) beat.textContent = `${rival} \u2014 ${stage}`;
    const prov = $("scene-prov");
    if (prov) prov.textContent = "rival escalation";
    const hint = $("hint");
    if (hint) hint.innerHTML = `<span class="run-pulse"><span class="run-state bad">\u2694\ufe0f ${esc(pressure)}</span>`
        + `<span class="run-next">Answer with a counterplay card.</span></span>`;
    // Flash the threat pill so the eye goes to the rising number.
    const pill = document.querySelector("#econ-hud .econ-pill.bad, #econ-hud .econ-pill.warn");
    if (pill) { pill.classList.remove("pulse-flash"); void pill.offsetWidth; pill.classList.add("pulse-flash"); }
    // The game master draws the threat arc: a mermaid diagram of the rival's
    // escalation, current stage lit, so the move is shown, not just told.
    renderRivalArc(arc, rival);
    void announceRival(`${rival}: ${pressure}`, rival);
    try { if (A && A.chime) A.chime(); } catch (_) {}
}

// Render the antagonist escalation as a transient mermaid arc diagram - the
// five stages left to right, the current one lit, passed stages dimmed. Built
// through the single mermaid render path and auto-dismissed so it never fights
// the world canvas.
const _RIVAL_STAGES = ["watching", "probing", "contesting", "crisis", "endgame"];
let _rivalArcTimer = null;
let _villainPortraitPending = false;
// Ask the game master to render the villain's portrait once per run. The
// endpoint tries the image deployment, then a deterministic offline crest, so
// the villain always has a face. Cached on state so we never re-fetch.
async function ensureVillainPortrait() {
    if (state.villainPortrait || _villainPortraitPending) return;
    _villainPortraitPending = true;
    try {
        const res = await api("/api/world/villain-portrait", {});
        if (res && res.url) state.villainPortrait = res.url;
    } catch (_) { /* a missing face degrades gracefully */ }
    finally { _villainPortraitPending = false; }
}
async function renderRivalArc(arc, rival) {
    const stage = String((arc && arc.escalation_stage) || "watching");
    const here = Math.max(0, _RIVAL_STAGES.indexOf(stage));
    const threat = Number((arc && arc.threat_level) || 0);
    const nodes = _RIVAL_STAGES.map((s, i) => {
        const label = i === here ? `${s}<br/>${threat}/100` : s;
        return `  s${i}["${label}"]`;
    }).join("\n");
    const edges = _RIVAL_STAGES.slice(1).map((_, i) => `  s${i} --> s${i + 1}`).join("\n");
    const passed = _RIVAL_STAGES.map((_, i) => i < here ? `s${i}` : "").filter(Boolean).join(",");
    const future = _RIVAL_STAGES.map((_, i) => i > here ? `s${i}` : "").filter(Boolean).join(",");
    const def = `flowchart LR\n${nodes}\n${edges}\n`
        + `classDef now fill:#3a0d14,stroke:#fb7185,stroke-width:2px,color:#ffe;\n`
        + `classDef past fill:#1a1d27,stroke:#3a3f4d,color:#7a8190;\n`
        + `classDef soon fill:#10131c,stroke:#262b36,color:#5a6172;\n`
        + `class s${here} now;\n`
        + (passed ? `class ${passed} past;\n` : "")
        + (future ? `class ${future} soon;\n` : "");
    let svg;
    try { svg = await mermaidToSvg(def); } catch (_) { return; }
    let panel = $("rival-arc");
    if (!panel) {
        panel = document.createElement("div");
        panel.id = "rival-arc";
        panel.className = "rival-arc";
        (document.getElementById("scene") || document.body).appendChild(panel);
    }
    const face = state.villainPortrait
        ? `<img class="rival-arc-face" src="${esc(state.villainPortrait)}" alt="" onerror="this.style.display='none'" />`
        : "";
    panel.innerHTML = `<div class="rival-arc-head">${face}<span>\u2694\ufe0f ${esc(rival)} \u2014 ${esc(stage)}</span></div>`
        + `<div class="rival-arc-svg">${svg}</div>`;
    panel.classList.add("show");
    if (_rivalArcTimer) clearTimeout(_rivalArcTimer);
    _rivalArcTimer = setTimeout(() => panel.classList.remove("show"), 7000);
}

// The hire menu (seats + their real monthly cost) is loaded once from the
// backend, which owns the cost math. null = not yet fetched, [] = loading/empty.
let hireOptionsCache = null;

async function loadHireOptions() {
    try {
        const res = await fetch("/api/org/options");
        if (!res.ok) throw new Error(`options ${res.status}`);
        const data = await res.json();
        hireOptionsCache = Array.isArray(data.options) ? data.options : [];
    } catch (_) {
        hireOptionsCache = [];
    }
    return hireOptionsCache;
}

// After a workforce change, re-sync every dependent surface from the returned
// state in one place so the econ HUD, org rail, and card layer never drift.
function syncAfterWorkforceChange(st) {
    if (!st) return;
    setHud(st);
    setResourcesFromEconomics(st.economics, st.org || state.org);
    setOrgPanel(st.org);
    if (st.game) syncGameState(st.game);
}

async function hireWorker(roleKey, btn) {
    if (!roleKey) return null;
    if (btn) { btn.disabled = true; btn.style.opacity = "0.6"; }
    try {
        const res = await api("/api/org/hire", { role_key: roleKey });
        syncAfterWorkforceChange(res.state);
        const r = res.receipt || {};
        setActionHint(`Hired ${r.hired_title || "a worker"} - burn now $${Number(r.burn_after_usd || 0).toLocaleString()}/mo.`);
        lens("reasoning", `hired ${r.hired_title || roleKey}: burn $${Number(r.burn_before_usd || 0).toLocaleString()} -> $${Number(r.burn_after_usd || 0).toLocaleString()}/mo${r.share_gained ? `, +${r.share_gained}% market share` : ""}`);
        return res;
    } catch (e) {
        if (btn) { btn.disabled = false; btn.style.opacity = ""; }
        setActionHint("Could not hire that worker.");
        lens("reliability", `hire rejected: ${e.message || e}`);
        return null;
    }
}

async function fireWorker(roleId, btn) {
    if (!roleId) return null;
    if (btn) { btn.disabled = true; btn.style.opacity = "0.6"; }
    try {
        const res = await api("/api/org/fire", { role_id: roleId });
        syncAfterWorkforceChange(res.state);
        const r = res.receipt || {};
        setActionHint(`Laid off ${r.laid_off_title || "a worker"} - burn now $${Number(r.burn_after_usd || 0).toLocaleString()}/mo, runway ${r.runway_days || 0}d.`);
        lens("reliability", `laid off ${r.laid_off_title || roleId}: burn $${Number(r.burn_before_usd || 0).toLocaleString()} -> $${Number(r.burn_after_usd || 0).toLocaleString()}/mo, runway ${r.runway_days || 0}d`);
        return res;
    } catch (e) {
        if (btn) { btn.disabled = false; btn.style.opacity = ""; }
        setActionHint("Could not lay off that worker.");
        lens("reliability", `layoff rejected: ${e.message || e}`);
        return null;
    }
}
window.hireWorker = hireWorker;
window.fireWorker = fireWorker;

// Populate the persistent "Digital Workforce" rail: stats + operating model +
// the educational per-role rationale.
function setOrgPanel(org) {
    setEconHud(org);
    const host = $("org-panel");
    if (!host) return;
    if (!org || !Array.isArray(org.roles)) {
        host.innerHTML = `<div class="mem-empty">No org designed yet.</div>`;
        return;
    }
    const burn = Number(org.monthly_burn_usd || 0);
    const humanEq = Number(org.monthly_human_equivalent_usd || 0);
    const savings = Number(org.monthly_savings_usd != null ? org.monthly_savings_usd : Math.max(0, humanEq - burn));
    let html = `<div class="org-stat">Founder + <b>${org.digital_worker_count}</b> digital workers`
        + ` &middot; <b>$${burn.toLocaleString()}</b>/mo run cost &middot; <b>${org.leverage_ratio}&times;</b> leverage</div>`;
    if (humanEq > 0) {
        const gold = "color:var(--gold-soft);font-style:normal";
        html += `<div class="org-model">A human team for these seats would cost <b style="${gold}">$${humanEq.toLocaleString()}</b>/mo. Your digital workforce runs for <b>$${burn.toLocaleString()}</b>/mo &mdash; saving <b style="${gold}">$${savings.toLocaleString()}</b>/mo.</div>`;
    }
    if (org.operating_model) html += `<div class="org-model">${esc(org.operating_model)}</div>`;
    if (Array.isArray(org.notes) && org.notes.length) {
        html += `<div class="org-model"><b style="color:var(--gold-soft);font-style:normal">Latest consequence:</b> ${esc(org.notes[org.notes.length - 1])}</div>`;
    }
    // De-duplicated: the digital workers ARE the agent hand along the bottom,
    // so the rail only details the seats the hand does NOT show (the human /
    // hybrid operator) and collapses the digital workers into one line that
    // points at the hand. One roster, two non-overlapping views.
    const humanRoles = org.roles.filter((r) => r.kind === "human" || r.kind === "hybrid");
    const digitalRoles = org.roles.filter((r) => r.kind !== "human" && r.kind !== "hybrid");
    humanRoles.forEach((r) => {
        const c = r.kind === "human" ? "var(--strategist)" : "var(--designer)";
        html += `<div class="org-role"><span class="org-orb" style="background:${c}"></span>`
            + `<b>${esc(r.title)}</b><span class="org-kind">${esc(r.kind)}</span>`
            + `<div class="org-why">${esc(r.why || r.mandate)}</div></div>`;
    });
    if (digitalRoles.length) {
        html += `<div class="org-handnote">&#9874; <b>${digitalRoles.length}</b> digital worker${digitalRoles.length === 1 ? "" : "s"} `
            + `live in the agent hand below &mdash; click any card to inspect its dossier.</div>`;
    }
    // Workforce management: the CEO can grow the team (burn rises now, the seat
    // earns it back by winning customers) or trim it (burn falls, runway
    // extends). Both route through the org so the economy HUD moves the instant
    // the workforce changes - the live profit trade the founder asked for. This
    // is the economic-management view; the hand stays the card/dossier view.
    const minCore = 2; // mirrors MIN_DIGITAL_WORKERS; only gates the fire affordance
    html += `<div class="org-manage"><div class="org-manage-h">Manage workforce</div>`;
    if (Array.isArray(hireOptionsCache) && hireOptionsCache.length) {
        html += `<div class="org-hire-row">` + hireOptionsCache.map((o) =>
            `<button class="org-hire-btn" type="button" data-hire="${escText(o.key)}" title="${escText(o.why || "")}">`
            + `+ ${esc(o.title)} <b>$${Number(o.monthly_cost_usd || 0).toLocaleString()}</b>/mo`
            + `${o.wins_customers ? ` <span class="hire-cust">wins customers</span>` : ""}</button>`
        ).join("") + `</div>`;
    } else {
        html += `<div class="org-hire-row muted">Loading hire options&hellip;</div>`;
    }
    if (digitalRoles.length) {
        const canFire = digitalRoles.length > minCore;
        html += `<div class="org-fire-list">` + digitalRoles.map((r) => {
            const cost = Number(r.monthly_cost_usd || 0);
            return `<div class="org-fire-row"><span class="org-orb" style="background:var(--marketer)"></span>`
                + `<span class="org-fire-name">${esc(r.title)}</span>`
                + `<span class="org-fire-cost">$${cost.toLocaleString()}/mo</span>`
                + `<button class="org-fire-btn" type="button" data-fire="${escText(r.id)}" ${canFire ? "" : "disabled"} `
                + `title="${canFire ? "Lay off to cut burn and extend runway" : "Cannot cut below the core workforce"}">lay off</button></div>`;
        }).join("") + `</div>`;
    }
    html += `</div>`;
    // Bridge out of the game: download the org as a platform-neutral
    // Workforce Bundle any digital-worker platform can ingest and provision
    // (behind its own human approval gate).
    html += `<button id="org-export-btn" class="org-export" type="button">Export workforce bundle</button>`;
    host.innerHTML = html;
    host.querySelectorAll("[data-hire]").forEach((b) => b.addEventListener("click", () => hireWorker(b.dataset.hire, b)));
    host.querySelectorAll("[data-fire]").forEach((b) => b.addEventListener("click", () => fireWorker(b.dataset.fire, b)));
    // Lazily load the hire menu once, then re-render this panel so the buttons
    // appear. Guarded so it fetches a single time, not on every panel render.
    setOrgPanel._lastOrg = org;
    if (hireOptionsCache === null) {
        hireOptionsCache = [];
        loadHireOptions().then(() => { if (setOrgPanel._lastOrg) setOrgPanel(setOrgPanel._lastOrg); });
    }
    const exportBtn = $("org-export-btn");
    if (exportBtn) exportBtn.addEventListener("click", async () => {
        exportBtn.disabled = true;
        exportBtn.textContent = "Exporting...";
        try {
            const res = await fetch("/api/org/export");
            if (!res.ok) throw new Error(`export failed (${res.status})`);
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "workforce_bundle.json";
            a.click();
            URL.revokeObjectURL(url);
            exportBtn.textContent = "Bundle downloaded";
        } catch (err) {
            exportBtn.textContent = "Export failed - retry";
            exportBtn.disabled = false;
        }
    });
}

function setGate(score, rubric) {
    const scoreEl = $("score"); if (scoreEl) scoreEl.textContent = score;
    const fillEl = $("score-fill"); if (fillEl) fillEl.style.width = `${Math.min(100, score)}%`;
    const pass = score >= 80;
    const v = $("verdict");
    if (v) {
        v.className = `gate-verdict ${pass ? "pass" : "review"}`;
        v.textContent = pass ? "PASS - artifact verified, XP awarded" : "REVIEW - bronze, founder gate required";
    }

    // The diegetic rubric: the gate's score is the weighted sum of these
    // dimensions (Foundry rubric evaluation live, validator-derived offline),
    // floored by the deterministic validators.
    const host = $("rubric");
    if (!host) return;
    if (!rubric || !Array.isArray(rubric.dimensions)) { host.innerHTML = ""; return; }
    let html = "";
    rubric.dimensions.forEach((d) => {
        html += `<div class="rub-row" title="${esc(d.note || "")}">`
            + `<span class="rub-name">${esc(d.name)}</span>`
            + `<span class="rub-bar"><span class="rub-fill" style="width:${Math.min(100, d.score)}%"></span></span>`
            + `<span class="rub-num">${d.score}</span></div>`;
    });
    html += `<div class="rub-src">${rubric.source === "foundry"
        ? "Foundry rubric evaluation &middot; validator floor " + (rubric.floor ?? 0)
        : "Deterministic validator rubric (simulation)"}</div>`;
    host.innerHTML = html;
}

function buildProgress(n) {
    const host = $("progress");
    if (!host) return;
    host.innerHTML = "";
    for (let i = 0; i < n; i++) {
        const seg = document.createElement("div");
        seg.className = "seg";
        seg.dataset.i = i;
        host.appendChild(seg);
    }
}
function markProgress(idx, status) {
    document.querySelectorAll("#progress .seg").forEach((s) => {
        const i = Number(s.dataset.i);
        s.classList.toggle("done", i < idx);
        s.classList.toggle("active", i === idx && status !== "done");
    });
    if (status === "done") {
        document.querySelectorAll("#progress .seg").forEach((s) => s.classList.add("done"));
    }
}

function setHud(s) {
    if (!s) return;
    syncLatestState(s);
    const lvl = $("hud-level"); if (lvl) lvl.textContent = s.level ?? 1;
    const xp = $("hud-xp"); if (xp) xp.textContent = s.xp ?? 0;
    if (s.game) syncGameState(s.game);
}

// --- Beats -----------------------------------------------------------------
// Read the founder-creation form into `state`. Single source of truth for the
// DOM -> state mapping so both the preflight gate and direct callers agree.
function readFounderInputsFromForm() {
    state.company = ($("in-company") && $("in-company").value.trim()) || DEFAULT_COMPANY;
    // The onboarding has a single signal field. Route it by content: only a
    // real URL becomes state.url (which the server then scrapes/OSINTs). Free
    // prose ("Solar microgrids for rural clinics") is a mission pitch, not a
    // URL - sending it as a URL makes the server try to scrape a non-page and
    // degrade. So prose goes to state.pitch and skips parsing entirely.
    const rawSignal = ($("in-url") && $("in-url").value || "").trim();
    const typedPitch = ($("in-pitch") && $("in-pitch").value.trim()) || "";
    if (rawSignal && looksLikeUrlish(rawSignal)) {
        state.url = rawSignal;
        state.pitch = typedPitch;
    } else {
        state.url = "";
        state.pitch = rawSignal || typedPitch;
    }
    // No silent default-mission fallback. Gathering the founder's own signal -
    // a public profile to scrape/OSINT, or a mission they actually wrote - is a
    // core game dynamic, enforced at the gate by hasRealSignal().
    // Name/archetype are profile-first: the URL handle gives a display name and
    // /api/founder/analyze can infer the archetype. Hidden manual cards override.
    state.founderName = ($("in-founder-name") && $("in-founder-name").value.trim())
        || founderNameFromProfileUrl(state.url)
        || "Founder";
    const founderVoiceProfile = selectedFounderVoiceProfile();
    state.founderVoice = founderVoiceProfile.id || "onyx";
    state.founderLocale = founderVoiceProfile.locale || "en-US";
    state.founderVoiceStack = founderVoiceProfile.stack || "core_openai";
    state.founderAvatar = ($("img-founder-avatar") && $("img-founder-avatar").getAttribute("src")) || "/game/assets/generated/narrator.png";

    const selCard = document.querySelector("#arch-row .arch-card.sel");
    state.manualArchetype = !!selCard;
    state.archetype = selCard ? { name: selCard.dataset.arch, skill: selCard.dataset.skill } : null;

    // Wire customized settings into global voice/portrait maps
    VOICE_BY_ROLE["founder"] = state.founderVoice;
    ROLE_PORTRAIT["founder"] = "founder";
}

function looksLikeProfileUrl(value) {
    return /^https?:\/\//i.test((value || "").trim());
}

// Is this signal a URL we should scrape, or prose we should treat as a mission?
// A URL has no spaces and is either explicitly schemed (https://...) or a bare
// host with a dotted TLD (linkedin.com/in/jane, jane.dev). Anything with a
// space - a sentence describing a mission - is a pitch, never a URL.
function looksLikeUrlish(value) {
    const v = String(value || "").trim();
    if (!v || /\s/.test(v)) return false;
    if (/^https?:\/\//i.test(v)) return true;
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(v);
}

function founderSignalFromSavedState(savedState) {
    const profile = (savedState && savedState.founder_profile) || {};
    const source = String(profile.source || "").toLowerCase();
    const sourceRef = String(profile.source_ref || "").trim();
    const sourceKind = String(profile.source_kind || "").toLowerCase();
    if ((source === "url" || sourceKind.includes("profile") || looksLikeProfileUrl(sourceRef)) && sourceRef) {
        return { url: sourceRef, pitch: "" };
    }
    if (sourceRef) return { url: "", pitch: sourceRef };
    const pitch = String((savedState && savedState.pitch) || "").trim();
    return looksLikeProfileUrl(pitch) ? { url: pitch, pitch: "" } : { url: "", pitch };
}

function setInputValue(id, value, { overwrite = false } = {}) {
    const el = $(id);
    if (!el) return;
    const next = String(value || "");
    if (!overwrite && el.value.trim()) return;
    if (el.value === next) return;
    el.value = next;
    el.dispatchEvent(new Event("input", { bubbles: true }));
}

function hydrateFounderInputsFromSavedState(savedState, { overwrite = false } = {}) {
    if (!savedState) return;
    const signal = founderSignalFromSavedState(savedState);
    setInputValue("in-company", savedState.name || "", { overwrite });
    setInputValue("in-url", signal.url || "", { overwrite });
    setInputValue("in-pitch", signal.pitch || "", { overwrite });
}

function savedRunStages(savedState) {
    return (savedState && savedState.world && Array.isArray(savedState.world.stages))
        ? savedState.world.stages
        : [];
}

function hasDesignedRun(savedState) {
    return savedRunStages(savedState).length > 0;
}

function restoreSavedCompanySetup(savedState) {
    if (!savedState) return;
    syncLatestState(savedState);
    const signal = founderSignalFromSavedState(savedState);
    state.company = cleanRunDisplayName(savedState.name) || state.company || "";
    state.pitch = signal.pitch || savedState.pitch || state.pitch || "";
    state.url = signal.url || state.url || "";
    state.org = savedState.org || null;
    state.stages = [];
    state.decisions = [];
    state.idx = 0;
    state.phase = "title";
    hydrateFounderInputsFromSavedState(savedState, { overwrite: true });
    if ($("begin")) $("begin").disabled = !hasRealSignal();
    if ($("reset")) $("reset").disabled = false;
    const hint = $("hint");
    if (hint) hint.textContent = "Saved company loaded. Begin the run to design its world.";
    setActionHint("Saved company loaded. Begin the run to design its world.");
}

// The founder's archetype rides into every brief: their skill becomes the human
// lane of the org. Shared by the lore beat and the analyze payload.
function founderArchNote() {
    return state.archetype
        ? ` The founder is a ${state.archetype.name}: their own skill is ${state.archetype.skill}. Design the org so the human operator covers exactly that, and digital workers cover the rest.`
        : "";
}

// A run must be built on something real the founder actually gave us: a public
// profile to gather signals from, or a mission they described. Gathering the
// founder's own context is the core game dynamic, so we refuse to start on an
// empty form. Single source of truth for "do we have enough to begin", used by
// the gate and the scripted handoff.
function hasRealSignal() {
    return !!state.url || !!(state.pitch && state.pitch.trim());
}

const NEED_SIGNAL_HINT = "Drop your LinkedIn (or describe your mission) - your agents need something real to build your character from.";

// One payload shape for /api/founder/analyze, used by the preflight gate and the
// cold-start fallback so the prefetched result is byte-identical.
function analyzePayload() {
    return {
        pitch: state.pitch + founderArchNote(),
        url: state.url,
        company_name: state.company,
        founder_name: state.founderName,
        founder_archetype: state.archetype ? state.archetype.name : null,
        founder_skill: state.archetype ? state.archetype.skill : null,
        founder_locale: state.founderLocale,
        founder_voice_stack: state.founderVoiceStack,
        founder_voice: state.founderVoice,
        founder_avatar: state.founderAvatar
    };
}

// Browser-side reuse cache: players never log in, but the founder inputs are a
// stable key. Re-analyzing the same inputs is the most expensive hop in the run
// (live scrape + open-web OSINT + Foundry reasoning + org design), so within a
// tab we reuse the result instead of paying for it again. Survives the
// Edit-details <-> Begin loop and a reload (sessionStorage). Keyed only on the
// inputs that change the output, so editing the profile/mission busts it.
const ANALYZE_REUSE_TTL_MS = 60 * 60 * 1000;
let _analyzeReuse = null; // in-memory mirror of the sessionStorage entry
let _worldReuse = null; // active-page world design reuse; reset/game-over clears it

function analyzeSignature() {
    return JSON.stringify({
        url: (state.url || "").trim().toLowerCase().replace(/\/+$/, ""),
        pitch: (state.pitch || "").trim(),
        arch: state.archetype ? state.archetype.name : null,
    });
}

function analyzeReuseGet(sig) {
    let entry = _analyzeReuse;
    if (!entry) {
        try { entry = JSON.parse(sessionStorage.getItem("qf_analyze_reuse") || "null"); }
        catch (_) { entry = null; }
    }
    if (!entry || entry.sig !== sig) return null;
    if (Date.now() - (entry.ts || 0) > ANALYZE_REUSE_TTL_MS) return null;
    _analyzeReuse = entry;
    return entry.ares || null;
}

function analyzeReusePut(sig, ares) {
    _analyzeReuse = { sig: sig, ares: ares, ts: Date.now() };
    try { sessionStorage.setItem("qf_analyze_reuse", JSON.stringify(_analyzeReuse)); }
    catch (_) { /* private mode / quota: in-memory reuse still works */ }
}

function worldDesignSignature() {
    return JSON.stringify({
        analyze: analyzeSignature(),
        company: (state.company || "").trim(),
        founder: (state.founderName || "").trim(),
        voice: state.founderVoice || "onyx",
    });
}

function worldReuseGet(sig) {
    if (!_worldReuse || _worldReuse.sig !== sig) return null;
    if (!_worldReuse.res || !_worldReuse.res.state || !_worldReuse.res.state.world) return null;
    return _worldReuse.res;
}

function worldReusePut(sig, res) {
    _worldReuse = { sig: sig, res: res, ts: Date.now() };
}

function worldDesignPayload() {
    return {
        pitch: state.pitch,
        company_name: state.company,
        founder_name: state.founderName,
        founder_archetype: state.archetype ? state.archetype.name : "Builder",
        founder_skill: state.archetype ? state.archetype.skill : ARCHETYPE_SKILL.Builder,
        founder_locale: state.founderLocale,
        founder_voice_stack: state.founderVoiceStack,
        founder_voice: state.founderVoice,
        founder_avatar: state.founderAvatar
    };
}

function adoptAnalyzeResult(ares, { renderHud = true } = {}) {
    const org = (ares && ares.org) || (ares && ares.state && ares.state.org) || null;
    const profile = (ares && ares.profile) || (ares && ares.state && ares.state.founder_profile) || null;
    if (!state.manualArchetype && profile && profile.founder_archetype) {
        setInferredArchetype(profile.founder_archetype, profile.founder_skill);
        const inferredName = founderNameFromProfileUrl(state.url);
        if (inferredName && inferredName !== "Founder") state.founderName = inferredName;
    } else if (!state.archetype) {
        setInferredArchetype("Builder", ARCHETYPE_SKILL.Builder);
    }
    if (org) state.org = org;
    if (ares && ares.state) {
        syncLatestState(ares.state);
        if (renderHud) {
            setResourcesFromEconomics(ares.state.economics, org || state.org);
            setHud(ares.state);
        }
    } else if (renderHud && org) {
        setResourcesFromOrg(org);
    }
    if (!state.pitch && org) state.pitch = org.company_summary || ares.brief || "";
    if (!state.company || state.company === DEFAULT_COMPANY) {
        state.company = ventureNameFromProfile(profile, state.founderName);
    }
    return { org, profile };
}

function preparedWorldFromResult(res) {
    const world = res && res.state && res.state.world ? res.state.world : null;
    const stages = world && Array.isArray(world.stages) ? world.stages : [];
    return { world, stages, first: stages[0] || null };
}

function preparedWorldLine(worldRes) {
    const prepared = preparedWorldFromResult(worldRes);
    if (!prepared.stages.length) return "";
    const first = prepared.first || {};
    const owner = first.assigned_worker_title || ROLE_NAME[first.owner_role] || first.owner_role || "your first worker";
    const title = first.title || "opening move";
    return `<div class="cc-ready-world"><b>${prepared.stages.length}-stage world prepared</b>`
        + `<span>Opening room: ${esc(title)}${owner ? ` &middot; ${esc(owner)}` : ""}</span></div>`;
}

// Preflight gate: the first "Begin" press. We do not start the run until we have
// actually gone and fetched the information the form asked for - scrape the
// public profile, reason about it, and show the founder what we gathered. Only
// then does a second press (renderReadyCard's confirm) descend into the run.
async function gatherAndReady() {
    if (state.phase !== "title") return;
    if (A.unlock) A.unlock();
    if (A.uiPress) { try { A.uiPress(); } catch (_) { /* audio optional */ } }
    readFounderInputsFromForm();
    if (!hasRealSignal()) {
        $("hint").textContent = NEED_SIGNAL_HINT;
        try { $("in-url").focus(); } catch (_) {}
        return;
    }

    const beginBtn = $("begin");
    if (beginBtn) beginBtn.disabled = true;

    // Reuse: players don't log in, but their inputs are a stable key. Re-running
    // analyze is the most expensive hop (scrape + OSINT + Foundry reasoning + org
    // design), so if we already analyzed these exact inputs this session we reuse
    // the result - the console fast-forwards and no network/model call is made.
    const sig = analyzeSignature();
    const reused = analyzeReuseGet(sig);

    // Show, don't tell: mount the live preflight console where the step was, and
    // run the real analyze call concurrently. The console narrates the real
    // pipeline and resolves to the real numbers - no silent loading gap.
    const card = document.querySelector(".creator-card");
    const step = card && card.querySelector('.cc-step[data-step="1"]');
    const toggle = card && card.querySelector(".cc-adv-toggle");
    const advanced = card && card.querySelector(".cc-advanced");
    const mount = document.createElement("div");
    mount.className = "cc-preflight-mount";
    if (step) { step.classList.add("is-hidden"); step.parentNode.insertBefore(mount, step); }
    if (toggle) toggle.classList.add("is-hidden");
    if (advanced) advanced.setAttribute("hidden", "");
    $("hint").textContent = "";

    const consoleCtl = runPreflightConsole({ url: state.url, pitch: state.pitch, mount, cached: !!reused });
    const fetchP = reused ? Promise.resolve(reused) : api("/api/founder/analyze", analyzePayload());

    let ares;
    try {
        ares = await fetchP;
        if (!reused) analyzeReusePut(sig, ares);
        adoptAnalyzeResult(ares, { renderHud: false });
        const consoleDone = consoleCtl.complete(ares);
        const worldSig = worldDesignSignature();
        const cachedWorld = worldReuseGet(worldSig);
        const worldP = cachedWorld
            ? Promise.resolve(cachedWorld)
            : api("/api/world/design", worldDesignPayload()).then((res) => {
                worldReusePut(worldSig, res);
                return res;
            });
        await consoleDone;
        await consoleCtl.worldStart(cachedWorld ? "World map ready" : "World Designer mapping your venture");
        const worldRes = await worldP;
        if (worldRes && worldRes.state) syncLatestState(worldRes.state);
        await consoleCtl.worldComplete(worldRes, !!cachedWorld);
        state.preflight = { ares: ares, profile: ares.profile || null, worldRes: worldRes };
    } catch (e) {
        try { await consoleCtl.fail("Could not gather the profile"); } catch (_) {}
        await sleep(900);
        mount.remove();
        if (step) step.classList.remove("is-hidden");
        if (toggle) toggle.classList.remove("is-hidden");
        if (beginBtn) {
            beginBtn.disabled = false;
            beginBtn.classList.remove("is-loading");
            beginBtn.innerHTML = beginBtn.dataset.label || "Begin the run &rarr;";
        }
        $("hint").textContent = "Could not gather the profile. Try again, or adjust the details.";
        return;
    }
    if (A.chime) { try { A.chime(); } catch (_) {} }

    // Stash the fetched result so beginStory consumes it instead of re-scraping
    // or re-designing the world graph. The first Begin now establishes the run;
    // the second Begin presents what is already prepared.
    mount.remove();
    renderReadyCard(ares, { reused: !!reused, worldRes: state.preflight && state.preflight.worldRes });
}

// The "ready" confirmation: shows what the preflight gathered and offers the
// real Begin. Reversible - "Edit details" restores the form untouched.
function renderReadyCard(ares, opts) {
    const card = document.querySelector(".creator-card");
    if (!card) { beginStory(); return; }
    const reused = !!(opts && opts.reused);
    const step = card.querySelector('.cc-step[data-step="1"]');
    const adv = card.querySelector(".cc-advanced");
    const toggle = card.querySelector(".cc-adv-toggle");
    if (step) step.classList.add("is-hidden");
    if (adv) adv.setAttribute("hidden", "");
    if (toggle) toggle.classList.add("is-hidden");

    const preparedState = opts && opts.worldRes && opts.worldRes.state ? opts.worldRes.state : (ares.state || {});
    const org = preparedState.org || ares.org || {};
    const profile = ares.profile || null;
    const ant = preparedState.antagonist || ares.antagonist || null;
    const host = profile && profile.host ? profile.host : "";
    const signals = (profile && profile.signals) || [];
    const arch = (profile && profile.founder_archetype) || (state.archetype && state.archetype.name) || "Builder";
    const verdictRaw = (profile && profile.company_summary) || org.company_summary || state.pitch || "Default world-improvement mission";
    const verdict = cleanProfileSummaryForPlayer(verdictRaw) || `${state.founderName || "Founder"} enters as ${arch}.`;
    const dw = org.digital_worker_count != null ? org.digital_worker_count : "";
    const lev = org.leverage_ratio != null ? org.leverage_ratio : "";
    const founderName = state.founderName && state.founderName !== "Founder" ? state.founderName : "";

    const sourceLine = (host
        ? `Profile locked from <b>${esc(host)}</b> &middot; ${signals.length} public signal${signals.length === 1 ? "" : "s"}`
        : "Mission locked from your briefing")
        + (reused ? ` &middot; <span class="cc-reused">reused</span>` : "");
    const chips = signals.slice(0, 4)
        .map((s) => `<span class="cc-chip">${esc(String(s).slice(0, 42))}</span>`).join("");
    const idLine = founderName
        ? `<div class="cc-ready-arch">${esc(founderName)} &middot; <b>${esc(arch)}</b> seat</div>`
        : `<div class="cc-ready-arch">Founder seat: <b>${esc(arch)}</b></div>`;
    const leverLine = dw !== ""
        ? `<div class="cc-ready-stat"><b>${esc(dw)}</b> digital workers behind one human${lev !== "" ? ` &middot; <b>${esc(lev)}x</b> leverage` : ""}</div>`
        : "";
    const worldLine = preparedWorldLine(opts && opts.worldRes);
    const rivalLine = ant && ant.name
        ? `<div class="cc-ready-rival">Rival pressure: <b>${esc(ant.name)}</b>${ant.threat_type ? ` &middot; ${esc(ant.threat_type)}` : ""}</div>`
        : "";

    let ready = card.querySelector(".cc-ready");
    if (ready) ready.remove();
    ready = document.createElement("div");
    ready.className = "cc-ready cc-anim";
    ready.innerHTML =
        `<div class="kicker">Ready to begin</div>`
        + `<div class="cc-ready-source">${sourceLine}</div>`
        + `<p class="cc-ready-verdict">${esc(verdict)}</p>`
        + (chips ? `<div class="cc-chips">${chips}</div>` : "")
        + idLine
        + leverLine
        + worldLine
        + rivalLine
        + `<button id="confirm-begin" class="cta">Begin the run &rarr;</button>`
        + `<button id="edit-details" type="button" class="cc-back">&larr; Edit details</button>`;
    card.appendChild(ready);
    $("hint").textContent = host ? "Profile gathered. Press begin to descend." : "Ready. Press begin to descend.";

    const confirm = ready.querySelector("#confirm-begin");
    if (confirm) {
        confirm.addEventListener("click", () => beginStory());
        confirm.addEventListener("mouseenter", () => {
            if (A.uiHover && A.isUnlocked && A.isUnlocked()) { try { A.uiHover(); } catch (_) {} }
        });
        try { confirm.focus(); } catch (_) {}
    }
    const edit = ready.querySelector("#edit-details");
    if (edit) edit.addEventListener("click", restoreCreatorForm);
}

// Undo the preflight and put the founder back in front of the form.
function restoreCreatorForm() {
    state.preflight = null;
    const card = document.querySelector(".creator-card");
    if (!card) return;
    const step = card.querySelector('.cc-step[data-step="1"]');
    const toggle = card.querySelector(".cc-adv-toggle");
    const beginBtn = $("begin");

    // Bring the form back the same way it left: fade the ready card down, then
    // re-trigger the step's rise-in so the transition is animated both ways.
    const showForm = () => {
        if (step) {
            step.classList.remove("is-hidden", "cc-anim");
            void step.offsetWidth; // reflow so the animation replays
            step.classList.add("cc-anim");
        }
        if (toggle) toggle.classList.remove("is-hidden");
        if (beginBtn) {
            beginBtn.disabled = false;
            beginBtn.classList.remove("is-loading");
            beginBtn.innerHTML = beginBtn.dataset.label || "Begin the run &rarr;";
        }
        $("hint").textContent = "";
        try { $("in-url").focus(); } catch (_) {}
    };

    const ready = card.querySelector(".cc-ready");
    if (ready) {
        ready.classList.add("cc-leave");
        setTimeout(() => { ready.remove(); showForm(); }, 200);
    } else {
        showForm();
    }
}

// Leaving prestart is one transition, owned in one place. Both entry points -
// starting a fresh run (beginStory) and resuming a saved one
// (restoreRunFromState) - call this so the onboarding card is torn off the
// stage ATOMICALLY with the prestart flag. Without this, a path that flipped
// prestart off and then threw before swapping #diagram would leave character
// creation bleeding behind the live HUD/footer. Clearing #diagram here means the
// onboarding screen and the run view can never coexist, whatever runs after.
function enterRunView() {
    document.documentElement.classList.remove("prestart");
    document.body.classList.remove("prestart");
    const stageEl = document.getElementById("stage");
    if (stageEl) stageEl.classList.remove("prestart", "rail-hidden");
    // Tear the onboarding title card off the stage now. The caller fills
    // #diagram with the run view immediately after; this just guarantees no
    // stale character-creation card survives the transition.
    const diagram = document.getElementById("diagram");
    const titleCard = diagram && diagram.querySelector(".title-card.first-step");
    if (titleCard) titleCard.remove();
}

async function beginStory() {
    if (A.unlock) A.unlock();
    // The ambient pad belongs to the title moment - end it as the run begins,
    // and mark the press with a warm confirming swell.
    if (A.ambientStop) { try { A.ambientStop(); } catch (e) { /* audio optional */ } }
    if (A.uiPress) { try { A.uiPress(); } catch (e) { /* audio optional */ } }
    // The preflight gate already read the form and fetched the profile. Scripted
    // callers (the intro film handoff) come straight here with no preflight, so
    // fall back to reading the form ourselves in that case.
    if (!state.preflight) readFounderInputsFromForm();
    if (!hasRealSignal()) { $("hint").textContent = NEED_SIGNAL_HINT; return; }
    if (state.phase !== "title") return; // already descending
    state.phase = "founding";

    enterRunView();
    setParty("narrator", "walking with you");

    // enterRunView() tears the onboarding title card (and the #begin button it
    // contains) off the stage, so #begin may already be gone here - guard it.
    const beginBtn = $("begin");
    if (beginBtn) beginBtn.disabled = true;
    const resetBtn = $("reset");
    if (resetBtn) resetBtn.disabled = false;
    refreshLearned(); // surface anything the workers already remember

    // Clear the founding form off the stage immediately
    $("diagram").innerHTML = `<div class="founding fade-scene">`
        + `<div class="kicker">The ascension begins</div>`
        + `<h1>${esc(state.company)}</h1>`
        + (state.archetype ? `<p class="founding-arch">${esc(state.archetype.name)} &middot; ${esc(state.archetype.skill)}</p>` : ``)
        + `${ventureModelHTML()}`
        + `</div>`;
    bindMoveTooltips($("diagram"));

    // ---- Beat 0: the welcome ----
    // Two doors into the world, one thread of narration:
    //   from the film  -> the film WAS the welcome. Its last line is "the
    //                     world takes all comers" - so the game answers it
    //                     in one breath and descends. No second cosmology.
    //   cold start     -> a personalized, LLM-narrated welcome to THIS venture
    //                     (the player skipped the film, so the lore runs here).
    setSceneHead("Your quest", state.company || "A new venture");
    // The founder's archetype rides into the brief: their skill becomes the
    // human lane of the org, and the lore speaks it back to them.
    const archNote = founderArchNote();
    if (state.fromFilm) {
        const seat = state.archetype
            ? `Your ${state.archetype.skill.split(":")[0].trim()} is the human seat.`
            : "You take the human seat.";
        const runLabel = (state.company && state.company !== DEFAULT_COMPANY)
            ? state.company
            : (state.founderName && state.founderName !== "Founder"
                ? `${state.founderName}'s Venture`
                : "your venture");
        await narrate(`And it takes you. ${runLabel} is chartered. ${seat} Everything else, you hire.`);
    } else {
        try {
            const loreRes = await api("/api/lore", { pitch: (state.pitch || state.url) + archNote, company_name: state.company });
            if (loreRes && loreRes.lore) await narrate(loreRes.lore);
        } catch (e) { /* lore is optional flavor - never block the run */ }
    }

    // ---- Beat 1: scrape + reason (URL) -> design the digital workforce ----
    const fromUrl = !!state.url;
    const preflightDone = !!state.preflight;
    $("hint").textContent = preflightDone
        ? "Profile locked. Assembling the world..."
        : (fromUrl ? "Reading the profile signal..." : "Designing the org...");
    setWorker(
        fromUrl ? "narrator" : "orgdesigner",
        fromUrl ? "profile analyst + STRATEGIST_MODEL (Foundry)" : "STRATEGIST_MODEL (Foundry)",
        preflightDone ? "World prepared" : (fromUrl ? "Reading the public profile" : "Designing the org"),
        true,
        fromUrl ? "Profile Analyst" : undefined
    );
    if (A.thinkingStart) A.thinkingStart();
    setSceneHead("Beat 1", fromUrl ? "Reading the founder signal, then the org" : "The org this mission needs");
    await narrate(preflightDone
        ? "Your founder signal, worker party, rival pressure, and world map are already prepared. First, see the charter your agents built from it."
        : (fromUrl
            ? "Point this at a LinkedIn or public profile URL. First a guarded scraper reads the public signal it can access. Then a Profile Analyst reasons about the founder's operating posture before the Org Designer proposes the digital workforce around it."
            : (state.fromFilm
                ? "First beat: the org. The Org Designer reasons out who you hire - every seat exists for a reason."
                : "Before any work happens, an Org Designer agent decides what team this mission needs: one human operator, plus the digital workers that form its execution layer. Every role exists for a reason.")));

    let org;
    let profile = null;
    try {
        // Reuse what the preflight gate already fetched; only cold-start callers
        // (the intro film handoff) hit the network here.
        const ares = state.preflight
            ? state.preflight.ares
            : await api("/api/founder/analyze", analyzePayload());
        const adopted = adoptAnalyzeResult(ares);
        org = adopted.org;
        profile = adopted.profile;
        if (!org) throw new Error("Org Designer returned no org blueprint.");
        // Cold-start (intro film) path skips the preflight gate, so the world
        // title may still be the placeholder here - ground it in the scraped
        // founder and re-title the scene so the run speaks the real venture.
        if (!state.company || state.company === DEFAULT_COMPANY) {
            state.company = ventureNameFromProfile(profile, state.founderName);
            setSceneHead("Your quest", state.company);
        }
    } catch (e) {
        if (A.thinkingStop) A.thinkingStop();
        $("hint").textContent = "Org design failed";
        await narrate(`The Org Designer could not be reached: ${e.message}`);
        return;
    }

    // Make the scrape + reasoning visible before the org chart resolves.
    if (fromUrl && profile && !preflightDone) {
        setMemory((profile.signals || []).map((s) => ({ source: profile.host || "homepage", content: s })));
        setWorker("orgdesigner", "STRATEGIST_MODEL (Foundry)", "Designing the org", true);
        // Under the Hood: the URL path is a two-hop evidence chain - scrape
        // (grounding), analyst reasoning (thinking), guarded fallbacks (trust).
        const sigN = (profile.signals || []).length;
        if (profile.scraped) {
            lens("accuracy", `homepage read via ${profile.parser === "bs4" ? "BeautifulSoup DOM walk" : "stdlib parser"} - ${sigN} evidence signals extracted from ${profile.host}`);
        }
        lens("reasoning", `two-hop chain: scrape -> Profile Analyst inferred "${String(profile.company_summary || "").slice(0, 60)}"`);
        lens("reliability", profile.scraped
            ? "scrape was SSRF-guarded; analyst output normalized before it touched the org"
            : "homepage unreachable - degraded to a domain default instead of failing");
        refreshLearned(); // the mapped company profile just landed in agent memory
        const archetypeLine = profile.founder_archetype ? ` Inferred founder seat: ${profile.founder_archetype}.` : "";
        await narrate(`Read ${profile.host}. The Analyst's verdict: ${profile.company_summary}.${archetypeLine} Saved to agent memory.`);
    }

    if (A.thinkingStop) A.thinkingStop();
    if (A.chime) A.chime();

    setOrgPanel(org);
    setWorker("orgdesigner", "STRATEGIST_MODEL (Foundry)", `Org chartered: ${org.headcount} seats`, false);
    setSceneHead("Beat 1", "The org this mission needs",
        "\u2692 drawn live from the Org Designer's blueprint (agent JSON \u2192 Mermaid)");
    await renderMermaid(orgBlueprintMermaid(org));
    await narrate(`${org.company_summary} The operating model: ${org.operating_model} That is ${org.digital_worker_count} digital workers behind one human - ${org.leverage_ratio}x leverage.`);

    // ---- Beat 2: the World Designer decomposes the venture ----
    setActionHint("Designing the 8-stage venture world...");
    setWorker("narrator", "NARRATOR_MODEL (Foundry)", "Decomposing the pitch", true);
    if (A.thinkingStart) A.thinkingStart();

    setSceneHead("Beat 2", "The World Designer reads your sentence");
    await narrate("Now the World Designer - a Foundry reasoning agent - reads the brief and decomposes the whole venture into a quest line of chapters, one per stage of building the company.");

    let res;
    const worldSig = worldDesignSignature();
    try {
        // The normal onboarding path already designed and persisted the world
        // during preflight so the ready card can preview the real first room.
        // Cold-start/scripted paths still design here.
        res = state.preflight && state.preflight.worldRes
            ? state.preflight.worldRes
            : worldReuseGet(worldSig);
        if (!res) {
            res = await api("/api/world/design", worldDesignPayload());
            worldReusePut(worldSig, res);
        }
    } catch (e) {
        if (A.thinkingStop) A.thinkingStop();
        $("hint").textContent = "Design failed";
        await narrate(`The World Designer could not be reached: ${e.message}`);
        return;
    }
    if (A.thinkingStop) A.thinkingStop();
    if (A.chime) A.chime();

    const world = res.state.world || {};
    state.stages = world.stages || [];
    state.decisions = world.decisions || [];
    if (res.state && res.state.org) state.org = res.state.org;
    setResourcesFromEconomics(res.state && res.state.economics, state.org);
    state.idx = 0;
    state.phase = "designed";
    setHud(res.state);

    // Fallback: if the server's initialize_game_run didn't deal cards into the
    // response (can happen on cold-start or when prior state carried through),
    // start a fresh card turn now so the hand is never empty entering gameplay.
    if (!state.game || !Array.isArray(state.game.hand) || !state.game.hand.length) {
        try {
            const turnRes = await api("/api/game/turn/start", { stage_id: "" });
            if (turnRes && turnRes.state) {
                setHud(turnRes.state);
                setResourcesFromEconomics(turnRes.state.economics, state.org);
            }
        } catch (_) { /* cards are additive - never block the run */ }
    }

    buildProgress(state.stages.length);
    setWorker("narrator", "NARRATOR_MODEL (Foundry)", `Produced ${state.stages.length} stages`, false);

    await revealWorldDrop();
    state.phase = "ready";
    setActionHint("Next: send a move to advance the story.");
    updateCommandControls();
}

async function revealWorldDrop() {
    const first = state.stages[0] || {};
    setSceneHead(
        "World set",
        state.company,
        `${state.stages.length} stages loaded · first stage: ${first.title || "opening move"}`
    );
    // The center belongs to the world canvas - show the actual 8-stage Story
    // Circle the World Designer produced, not a second copy of the venture-model
    // tiles (the footer's company-context strip already owns those). The
    // .world-canvas class is also the occupancy signal that reveals the party.
    $("diagram").innerHTML = `<div class="world-canvas founding fade-scene">`
        + `<div class="kicker">World initialized</div>`
        + `<h1>${esc(state.company)}</h1>`
        + `<p>${esc(first.goal || "Your opening stage is ready. Choose your first move.")}</p>`
        + `${resumeStageGrid(state.stages)}`
        + `</div>`;
    bindMoveTooltips($("diagram"));
    await narrate(`The world is live. ${first.title ? `${first.title} is your opening stage.` : "Your opening stage is ready."} Make your move.`);
}

async function revealSelfOrganization() {
    setSceneHead("Beat 3", "The party self-organizes",
        "\u2692 stage ownership bound from the designed org to the worker party");
    const stages = state.stages || [];
    if (!stages.length) return;

    // Deduplicate: show each unique digital worker once - they own multiple stages
    // but only need to introduce themselves once in the council.
    const seen = new Set();
    const uniqueWorkers = [];
    stages.forEach((ch) => {
        const key = ch.assigned_worker_title || ch.owner_role;
        if (!seen.has(key)) { seen.add(key); uniqueWorkers.push(ch); }
    });

    // Each archetype speaks in its own voice about what it actually does,
    // not just who it depends on. This is their mission statement.
    const ROLE_VOICE = {
        strategist: (name) => `${name} here. I open the investigation - reading the market, naming the competitors, finding the gap this venture can own. Everything the party builds, I ground first.`,
        designer: (name) => `${name}. I turn the strategic signal into a real product spec: user stories, feature bets, the build plan that makes the idea tangible and testable.`,
        marketer: (name) => `I am ${name}. My chapter is the market - channel mix, pricing model, the message that makes a real person say yes. I hand the launch brief to whoever closes the loop.`,
        ops: (name) => `${name} here. I hold the run together - delivery quality, retention loops, the cost structure that keeps this venture alive past the first sprint.`,
    };

    const members = uniqueWorkers.slice(0, 6).map((ch, i) => {
        const role = ch.owner_role || "strategist";
        const portrait = ROLE_PORTRAIT[role] || "narrator";
        const owner = ch.assigned_worker_title || ROLE_NAME[role] || role;
        // Strip generic "Digital Worker" suffix to get a cleaner first-name for speech.
        const shortName = owner.replace(/ Digital Worker$/, "").split(" ").slice(-2).join(" ") || owner;
        const voiceFn = ROLE_VOICE[role] || ((name) => `${name} here. I carry my chapter so the next worker has grounded evidence to build on.`);
        const line = voiceFn(shortName);
        return `<div class="council-member" style="animation-delay:${i * 120}ms">`
            + `<div class="council-top"><img class="council-face" src="/game/assets/generated/${portrait}.png" alt="" onerror="this.style.display='none'">`
            + `<div><div class="council-name">${esc(owner)}</div><div class="council-role">${esc(ROLE_NAME[role] || role)}</div></div></div>`
            + `<div class="council-says">&ldquo;${esc(line)}&rdquo;</div>`
            + `</div>`;
    }).join("");
    $("diagram").innerHTML = `<div class="council fade-scene">${members}</div>`;
    setParty("narrator", "assembling the party");
    await narrate(`These are your workers. Not a list - a party with a formation. ${uniqueWorkers.length} agents, each one owning a chapter of the build. Listen to them claim their stage.`);
    await sleep(700);
}

function standupToolMarkup(turn) {
    const call = turn && turn.tool_call ? turn.tool_call : {};
    const tool = call.tool || "agent_turn";
    const status = call.status || "completed";
    return `<div class="standup-tool"><code>${esc(tool)}</code><span>${esc(status)}</span></div>`;
}

function speakerProfileForTurn(turn) {
    const role = turn.role || "narrator";
    const profile = turn.speaker_profile || {};
    let portrait = profile.portrait_url || `/game/assets/generated/${ROLE_PORTRAIT[role] || "narrator"}.png`;
    // The villain's face is whatever the game master actually rendered (png or
    // the offline svg crest), so its standup turn shows the real portrait.
    if (role === "antagonist" && state.villainPortrait) portrait = state.villainPortrait;
    return {
        displayName: profile.display_name || turn.speaker || ROLE_NAME[role] || role,
        roleLabel: profile.role_label || ROLE_NAME[role] || role,
        workerId: profile.worker_id || turn.worker_id || role,
        portraitUrl: portrait,
        textStyle: profile.text_style || "standup posture",
        voiceId: profile.voice_id || VOICE_BY_ROLE[role] || NARRATOR_VOICE,
    };
}

function standupSourceLabel(turn) {
    const source = String((turn && turn.source) || "").toLowerCase();
    const framework = String((turn && turn.framework) || "").toLowerCase();
    if (source === "maf" || source === "foundry" || framework.includes("microsoft-agent-framework")) {
        return "Foundry MAF";
    }
    if (source === "simulation" || framework.includes("deterministic")) {
        return "simulation fallback";
    }
    return source || "";
}

// Keep the transcript pinned to the newest line, but never yank the view away
// from a player who has scrolled up to re-read earlier turns.
function scrollLogToBottom(log) {
    if (!log) return;
    const slack = log.scrollHeight - log.scrollTop - log.clientHeight;
    if (slack < 90) log.scrollTop = log.scrollHeight;
}

// Attach a turn's rich media to its transcript card: an explicit image and/or a
// Mermaid diagram. A turn whose tool drew the org graph shows the live org
// blueprint, so the media capability is wired to real gameplay, not a stub.
async function attachTurnMedia(mediaEl, turn) {
    if (!mediaEl) return;
    let shown = false;
    if (turn && turn.image) {
        const cap = turn.image_caption
            ? `<span class="media-cap">${esc(turn.image_caption)}</span>` : "";
        mediaEl.insertAdjacentHTML("beforeend",
            `<div class="council-shot"><img src="${esc(turn.image)}" alt="${esc(turn.image_caption || "")}" `
            + `onerror="this.closest('.council-shot').remove()" />${cap}</div>`);
        shown = true;
    }
    let mer = turn && turn.mermaid;
    const tool = turn && turn.tool_call && turn.tool_call.tool;
    if (!mer && tool === "render_org_graph" && state.org) mer = orgBlueprintMermaid(state.org);
    if (mer) {
        const box = document.createElement("div");
        box.className = "council-diagram";
        mediaEl.appendChild(box);
        await renderMermaidInto(box, mer);
        shown = true;
    }
    if (shown) mediaEl.hidden = false;
}

async function renderAgentStandup(standup, opts = {}) {
    const allTurns = standup && Array.isArray(standup.turns) ? standup.turns : [];
    const isGameMasterStandup = standup && standup.tier === "game_master";
    const visibleTurns = (items) => isGameMasterStandup
        ? (items || [])
        : (items || []).filter((turn) => {
            const klass = agentClassForRole(turn.role || "");
            return klass !== "rival" && klass !== "gm";
        });
    const turns = visibleTurns(allTurns);
    if (!turns.length) return;
    const interactive = opts.interactive !== false;
    const trigger = standup.trigger || {};
    // The same transcript renderer serves two tiers: the Game Master council
    // (engine: World Designer + Antagonist + Org Designer ratifying the move)
    // and the worker standup (party reacting). The header names which one.
    if (isGameMasterStandup) {
        setSceneHead("Game Master council", "The world engine ratifies your move",
            `forward motion - ${esc(standup.forward_motion || trigger.summary || "world updated")}`);
    } else {
        const sourceLabel = standup.source === "foundry" ? "Foundry MAF" : "simulation fallback";
        setSceneHead("Agent stand-up", "The party reacts to your call",
            `${sourceLabel} - ${esc(trigger.rule_id || "decision")}`);
    }

    // Any prior speaker spotlight yields: the transcript itself is now the home
    // for who is speaking, so nothing floats a duplicate over it.
    hideSpeakerSpotlight();
    // The standup owns the stage: hide the redundant party roster (those same
    // workers are in the transcript) and give the transcript the freed height.
    // The coordinator also quiets the footer hand so it never overlaps the
    // transcript or the stand-up's own CEO input.
    setStageLayer("standup-active", true);
    // Scrollable conversation transcript - a vertical log you can scroll back
    // through (earlier turns + your own responses); each message can carry an
    // image or a Mermaid diagram.
    $("diagram").innerHTML = `<div class="council standup-log fade-scene"></div>`;
    const council = $("diagram").querySelector(".council");

    const accumulatedHistory = [];

    async function displayTurns(newTurns) {
        for (let i = 0; i < newTurns.length; i++) {
            const turn = newTurns[i];
            const role = turn.role || "narrator";
            const profile = speakerProfileForTurn(turn);
            const handoff = turn.handoff_to ? `<div class="standup-handoff">handoff: ${esc(turn.handoff_to)}</div>` : "";
            const sourceLabel = standupSourceLabel(turn);
            const source = sourceLabel ? `<span>${esc(sourceLabel)}</span>` : "";
            // Differentiate the three agent classes in the transcript: the world
            // masters announce (gold), the rival presses (red), the workers react
            // (role/teal) - so a glance separates authorship from reaction.
            const agentClass = agentClassForRole(role);
            const announce = agentClass === "gm"
                ? `<div class="standup-announce">&#9818; ${esc(profile.displayName)} announces</div>`
                : "";

            const cardHtml = `<div class="council-member standup-member agent-${agentClass}" style="transition: opacity 300ms ease;">`
                + `<div class="council-top"><img class="council-face" src="${esc(profile.portraitUrl)}" alt="" onerror="this.style.display='none'" />`
                + `<div><div class="council-name">${esc(profile.displayName)}</div><div class="council-role">${esc(profile.roleLabel)}</div></div></div>`
                + announce
                + `<div class="standup-profile"><span>${esc(profile.textStyle)}</span>${source}</div>`
                + standupToolMarkup(turn)
                + `<div class="council-says quote" aria-live="polite"></div>`
                + `<div class="council-media" hidden></div>`
                + handoff
                + `</div>`;

            council.insertAdjacentHTML("beforeend", cardHtml);
            const lastCard = council.lastElementChild;
            const saysEl = lastCard.querySelector(".council-says");
            const mediaEl = lastCard.querySelector(".council-media");
            scrollLogToBottom(council);

            setParty(profile.workerId, "reacting in stand-up", profile.displayName);
            // Feature THIS speaker in the footer mini; the line types straight
            // into this transcript card (no floating spotlight duplicate).
            state.activeWorker = { role, deployLabel: "", stateText: "reacting in stand-up", displayName: profile.displayName };
            if (A.turnCue) { try { A.turnCue(); } catch (_) {} }
            const previousVoice = currentVoice;
            currentVoice = profile.voiceId || VOICE_BY_ROLE[role] || NARRATOR_VOICE;
            await narrate(turn.message || `${profile.displayName} is processing the handoff.`, 15,
                { into: saysEl, onType: () => scrollLogToBottom(council) });
            currentVoice = previousVoice;
            // Rich media for this message: image and/or Mermaid diagram.
            await attachTurnMedia(mediaEl, turn);
            scrollLogToBottom(council);
            await sleep(220);

            accumulatedHistory.push({
                speaker: profile.displayName,
                role: turn.role,
                worker_id: profile.workerId,
                message: turn.message,
                speaker_profile: turn.speaker_profile || null
            });
        }
    }

    // First round of turns
    await displayTurns(turns);

    const line = standup.next_brief_delta || trigger.summary || "The next worker brief now carries the choice.";
    const selection = (standup.orchestration && standup.orchestration.selection) || STANDUP_SELECTION;
    const modeLabel = standup.source === "foundry" ? "Foundry MAF" : "simulation fallback";
    lens("reasoning", `Agent group chat: ${turns.length} workforce turns, ${selection} selection, ${modeLabel}, reacted to ${trigger.rule_id || "the CEO decision"}`);
    if (!isGameMasterStandup && allTurns.length !== turns.length) {
        lens("reliability", "Game Master and rival updates tracked outside the workforce stand-up; the team room only shows worker voices");
    }

    // Keep the standup itself text-first; the narrator only closes the beat.
    state.activeWorker = { role: "narrator", deployLabel: "", stateText: "", displayName: ROLE_NAME.narrator };
    currentVoice = NARRATOR_VOICE;
    await narrate(`Stand-up. ${line}`);
    await sleep(400);

    // The Game Master council is a one-shot ratification beat, not a chat: show
    // the transcript and the closing line, then hand off to the interactive
    // worker standup that follows. Only the worker standup opens the CEO reply
    // loop, so the two transcripts never compete for the same input.
    if (!interactive) return;

    // Now loop conversation infinitely
    let replySeq = 0;
    return new Promise((resolve) => {
        // Leaving the standup restores the normal stage layout (party roster back).
        const finish = () => { setStageLayer("standup-active", false); resolve(); };
        async function promptCEO() {
            // The floor is back with the CEO: clear the speaking spotlight so the
            // response card owns the stage.
            hideSpeakerSpotlight();
            // Present the CEO response input card
            const seq = ++replySeq;
            const responseId = `standup-response-wrap-${seq}`;
            const inputId = `standup-response-input-${seq}`;
            const btnId = `standup-response-send-${seq}`;
            const skipId = `standup-response-skip-${seq}`;
            const micId = `${inputId}-mic`;
            const statusId = `${inputId}-status`;

            const founderCardHtml = `<div id="${responseId}" class="council-member standup-ceo-turn" style="transition: opacity 300ms ease;">`
                + `<div class="council-top">`
                + `<img class="council-face" src="${state.founderAvatar || "/game/assets/generated/narrator.png"}" alt="" onerror="this.style.display='none'" />`
                + `<div><div class="council-name">${esc(state.founderName || "CEO")} (You) &middot; your turn</div><div class="council-role">Human Operator</div></div></div>`
                + `<div style="margin-top: 12px; display: flex; flex-direction: column; gap: 8px;">`
                + `<div class="standup-ceo-input-row">`
                + `<div class="standup-ceo-input-wrap">`
                + `<input id="${inputId}" autocomplete="off" placeholder="Respond to your workforce (e.g., 'Focus on speed' or 'Optimize runway')..." />`
                + `<button id="${micId}" class="mic-btn standup-ceo-mic" type="button" title="Speak your response" aria-label="Speak your response">&#127908;</button>`
                + `</div>`
                + `<button id="${skipId}" class="btn ghost" style="padding: 9px 16px; font-size: 12.5px; font-weight: 500; cursor: pointer; flex: 0 0 auto;">End Standup</button>`
                + `<button id="${btnId}" class="btn primary" style="padding: 9px 18px; font-size: 12.5px; font-weight: 600; cursor: pointer; flex: 0 0 auto;">Send Response</button>`
                + `</div>`
                + `<div id="${statusId}" style="font-size: 10.5px; min-height: 16px; color: var(--ink-faint);"></div>`
                + `</div></div>`;

            council.insertAdjacentHTML("beforeend", founderCardHtml);
            const fsCard = council.lastElementChild;
            scrollLogToBottom(council);

            const inputEl = $(inputId);
            const sendBtn = $(btnId);
            const skipBtn = $(skipId);
            const micBtn = $(micId);
            const statusEl = $(statusId);

            if (inputEl) inputEl.focus();

            // Bind mic button for CEO response
            const stopMic = bindSpeechRecognition(micBtn, inputEl, statusEl);

            const cleanup = () => {
                stopMic();
                sendBtn.removeEventListener("click", handleSend);
                skipBtn.removeEventListener("click", handleSkip);
            };

            const handleSend = async () => {
                const val = inputEl.value.trim();
                if (!val) return;

                cleanup();
                sendBtn.disabled = true;
                skipBtn.disabled = true;
                inputEl.disabled = true;
                if (statusEl) statusEl.textContent = "Sending response to worker memory...";
                if (A.uiPress) { try { A.uiPress(); } catch (_) {} }

                try {
                    // 1. Save response to procedural memory
                    const responseState = await api("/api/world/standup/respond", { text: val, stage_id: standup.stage_id || "" });
                    if (responseState.state) {
                        setHud(responseState.state);
                        setResourcesFromEconomics(responseState.state.economics, responseState.state.org || state.org);
                        if (responseState.state.org) setOrgPanel(responseState.state.org);
                    }
                    if ((responseState.adapted_stage_ids || []).length) {
                        lens("reasoning", `World Designer adapted ${responseState.adapted_stage_ids.length} pending stage(s) from your live stand-up response`);
                    }

                    // 2. Transform the input card into static message
                    fsCard.innerHTML = `<div class="council-top">`
                        + `<img class="council-face" src="${state.founderAvatar || "/game/assets/generated/narrator.png"}" alt="" onerror="this.style.display='none'" />`
                        + `<div><div class="council-name">${esc(state.founderName || "CEO")} (You)</div><div class="council-role">Human Operator</div></div></div>`
                        + `<div class="council-says" style="margin-top: 10px; font-style: italic; color: var(--ink-dim);">&ldquo;${esc(val)}&rdquo;</div>`
                        + `<div class="standup-handoff" style="color: var(--good-soft); margin-top: 8px;">response registered in memory ledger</div>`;

                    // Add user turn to history
                    const userTurn = {
                        speaker: state.founderName || "CEO",
                        role: "founder",
                        worker_id: "founder",
                        message: val,
                        speaker_profile: {
                            display_name: state.founderName || "CEO",
                            role: "founder",
                            role_label: "Human Operator",
                            worker_id: "founder",
                            portrait_url: state.founderAvatar || "/game/assets/generated/narrator.png",
                            text_style: "CEO direction",
                            voice_stack: state.founderVoiceStack || "core_openai",
                            voice_id: state.founderVoice || "onyx",
                            locale: state.founderLocale || "en-US"
                        }
                    };
                    accumulatedHistory.push(userTurn);

                    // Narrate confirmation
                    await narrate(`Registered. Asking the workforce to react...`);

                    // 3. Fetch next standup turns
                    const nextStandup = await api("/api/world/standup", {
                        stage_id: standup.stage_id,
                        history: accumulatedHistory,
                        selection_mode: STANDUP_SELECTION
                    });

                    // 4. Display the new turns
                    await displayTurns(visibleTurns(nextStandup.turns || []));

                    // 5. Loop again
                    promptCEO();

                } catch (err) {
                    fsCard.remove();
                    finish();
                }
            };

            const handleSkip = () => {
                cleanup();
                if (A.uiHover) { try { A.uiHover(); } catch (_) {} }
                fsCard.remove();
                finish();
            };

            sendBtn.addEventListener("click", handleSend);
            skipBtn.addEventListener("click", handleSkip);
            inputEl.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    handleSend();
                }
            });
        }

        promptCEO();
    });
}

async function revealVentureGraph() {
    setSceneHead("Beat 4", "The venture, decomposed",
        "\u2692 drawn live from the World Designer's stage graph (JSON \u2192 Mermaid)");
    // The stage is a wide cinema frame - lay the quest line LEFT-TO-RIGHT so
    // eight stages read as a path across the screen, not a column squeezed
    // under the header. Map nodes carry the short phase name only (the part
    // before the colon); full titles live in the narration and stage runs -
    // a map wants landmarks, not paragraphs.
    let def = "graph LR\n";
    const idOf = (id) => `c_${id.replace(/[^a-zA-Z0-9_]/g, "")}`;
    const mapLabel = (t) => san(String(t || "").split(":")[0].trim() || t);
    state.stages.forEach((ch) => {
        const color = ROLE_COLOR[ch.owner_role] || T.blue;
        def += `  ${idOf(ch.id)}["${mapLabel(ch.title)}"]\n`;
        def += `  style ${idOf(ch.id)} stroke:${color},stroke-width:2px\n`;
    });
    state.stages.forEach((ch) => {
        (ch.depends_on || []).forEach((dep) => {
            const depCh = state.stages.find((c) => c.id === dep);
            if (depCh) def += `  ${idOf(dep)} --> ${idOf(ch.id)}\n`;
        });
    });
    // chain fallback when no explicit deps
    if (!state.stages.some((c) => (c.depends_on || []).length)) {
        for (let i = 1; i < state.stages.length; i++) {
            def += `  ${idOf(state.stages[i - 1].id)} --> ${idOf(state.stages[i].id)}\n`;
        }
    }
    await renderMermaid(def);
    const owners = state.stages.map((c) => c.assigned_worker_title || ROLE_NAME[c.owner_role] || c.owner_role);
    void narrate(`${state.stages.length} stages, each owned by ${state.org ? "one of the digital workers you just designed" : "a specialist agent"}: ${[...new Set(owners)].join(", ")}. Dependencies set the order. This graph is the world the Worker Factory will build.`);
    markProgress(0);
}

// --- Reasoning theater -------------------------------------------------------
// The judged thing, made the centerpiece: while a worker reasons, its plan
// takes the whole stage. Every line is real - the chapter brief, the tools it
// draws from the Toolbox (fetched live from /api/toolbox), the IQ recall, the
// deployment - and when the model returns, its actual chain-of-thought preview
// and thinking-token count land as the final beat before the artifact.
let theaterToken = 0;

async function theaterStep(host, ico, k, v, live) {
    const div = document.createElement("div");
    div.className = "th-step" + (live ? " th-live" : "");
    div.innerHTML = `<span class="th-ico">${ico}</span><div><span class="th-k">${esc(k)}</span><div class="th-v">${v}</div></div>`;
    host.appendChild(div);
    if (A.tick) { try { A.tick(); } catch (_) {} }
    await sleep(620);
}

async function theaterOpen(ch, ownerName, lastDecision) {
    const t = ++theaterToken;
    const el = $("theater");
    el.innerHTML = `
        <div class="th-head"><span class="pulse"></span> Live reasoning &mdash; watch the plan form</div>
        <div class="th-worker">${esc(ownerName)}</div>
        <div class="th-deploy">${esc((ch.owner_role || "role").toUpperCase())}_MODEL &middot; Microsoft Foundry</div>
        <div class="th-steps"></div>`;
    el.hidden = false;
    setStageLayer("theater", true);
    const steps = el.querySelector(".th-steps");

    await theaterStep(steps, "&#9656;", "Brief received", esc(ch.goal || ch.title));
    if (lastDecision && t === theaterToken) {
        await theaterStep(steps, "&#9670;", "CEO direction in context",
            `Your last gate decision &mdash; &ldquo;${esc(lastDecision.option)}&rdquo; &mdash; is binding direction in this brief.`);
        if (lastDecision.consequence_summary && t === theaterToken) {
            const after = (lastDecision.consequence && lastDecision.consequence.after) || {};
            await theaterStep(steps, "&#9881;", "Changed company state",
                `${esc(lastDecision.consequence_summary)} ${after.monthly_burn_usd ? `Burn is now ${fmtMoney(after.monthly_burn_usd)}/mo with ${after.digital_worker_count || 0} digital workers.` : ""}`);
        }
    }
    // Real toolbox draw: ask the server which tools this archetype pulls.
    try {
        const r = await fetch(`/api/toolbox?role=${encodeURIComponent(ch.owner_role || "")}`).then((x) => x.json());
        if (t !== theaterToken) return;
        const chips = (r.role_tools || []).map((n) => `<span class="tool-chip">${esc(n)}</span>`).join(" ");
        const src = r.source === "foundry_toolbox" ? "Foundry Toolbox (MCP)" : "local toolbox (MCP shape)";
        if (chips) await theaterStep(steps, "&#9874;", `Drawing tools - ${src}`, chips);
    } catch (_) { /* toolbox display is additive */ }
    if (t !== theaterToken) return;
    await theaterStep(steps, "&#9783;", "Foundry IQ recall", `Querying the knowledge base for: <i>${esc((ch.success_metric || ch.goal || "").slice(0, 90))}</i>`);
    if (t !== theaterToken) return;
    await theaterStep(steps, "&#10022;", "Invoking deployment", "Reasoning over the brief on Microsoft Foundry &mdash; thinking tokens accumulating now...", true);
}

async function theaterReveal(inv) {
    const el = $("theater");
    if (el.hidden) return;
    const steps = el.querySelector(".th-steps");
    if (steps) {
        const tokens = Number(inv && inv.reasoning_tokens) || 0;
        const preview = (inv && inv.reasoning_preview) || "";
        const q = document.createElement("div");
        q.className = "th-quote";
        q.innerHTML = `<div class="th-k">&#9670; The model's own reasoning${tokens ? ` <span class="rz-tokens">${tokens} thinking tokens</span>` : ""}</div>`
            + `<div class="th-cot">${preview ? `&ldquo;${esc(preview)}&hellip;&rdquo;` : `Reasoning complete in ${inv && inv.latency_s != null ? inv.latency_s : "?"}s &mdash; artifact incoming.`}</div>`;
        steps.appendChild(q);
        if (A.chime) { try { A.chime(); } catch (_) {} }
        // Long enough to read on stage; short enough to keep the loop moving.
        await sleep(preview ? 5200 : 2200);
    }
    theaterClose();
}

function theaterClose() {
    theaterToken++;
    const el = $("theater");
    el.hidden = true;
    el.innerHTML = "";
    setStageLayer("theater", false);
}

async function runNextChapter(commandTrace = {}) {
    if (state.idx >= state.stages.length) return;
    const ch = state.stages[state.idx];
    const ownerName = ch.assigned_worker_title || ROLE_NAME[ch.owner_role] || ch.owner_role;
    state.phase = "running";
    updateCommandControls();
    const nextBtn = $("next"); if (nextBtn) nextBtn.disabled = true;
    markProgress(state.idx);

    setSceneHead(`Stage ${state.idx + 1}`, ch.title,
        `\u2692 artifact + diagram by ${ownerName} (agent JSON \u2192 Mermaid)`);
    // Paint the scenario onto the world canvas (center stage) so the player has
    // the stage goal + success metric in view while the worker reasons. The
    // theater overlay sits above this; when it closes, the scenario remains
    // until the artifact replaces it.
    renderScenarioCanvas(ch, ownerName);
    setWorker(ch.owner_role, `${(ch.owner_role || "role").toUpperCase()}_MODEL (Foundry)`, "Reasoning over the brief", true, ownerName);
    setReasoning(null);
    setTools(null);
    if (A.thinkingStart) A.thinkingStart();
    setActionHint(`Working: ${ownerName} is executing your move.`);

    // Session memory, spoken: the worker is briefed with the CEO's last gate
    // decision - the player hears their own words come back (game_design 5).
    const lastDecision = state.decisions && state.decisions.length
        ? state.decisions[state.decisions.length - 1] : null;
    const recallLine = lastDecision
        ? ` Your decision at the last gate - "${lastDecision.option}" - is in its brief, as binding direction.${lastDecision.consequence_summary ? ` The company consequence is also in scope: ${lastDecision.consequence_summary}.` : ""}`
        : "";
    const lastCommand = state.playerCommands && state.playerCommands.length
        ? state.playerCommands[state.playerCommands.length - 1]
        : null;
    const clientTraceId = commandTrace.clientTraceId || commandTrace.client_trace_id || (lastCommand && lastCommand.client_trace_id) || "";
    const commandText = commandTrace.commandText || commandTrace.command_text || (lastCommand && lastCommand.text) || "";
    const commandLine = lastCommand && lastCommand.text
        ? ` Your current CEO move - "${lastCommand.text}" - is riding with this worker.`
        : "";
    // Agent memory, spoken: once the workforce has learned from this CEO, the
    // narration credits it - memory is a mechanic the player can hear.
    const memoryLine = learnedCount > 0
        ? " It carries what it has learned about you."
        : "";
    const goalLine = (ch.goal || "").trim().replace(/\.$/, "");
    await announceWorldState(`Stage ${state.idx + 1}: ${goalLine}. ${ownerName} spins up on Foundry and recalls from IQ memory.${memoryLine}${recallLine}${commandLine}`);
    // The reasoning theater takes the stage while the worker thinks: the
    // announcement has cleared, and the plan forms on screen without a lower
    // dialogue slab reserving space above the party hand.
    mafRunStart(ownerName, ch.title);
    const theaterDone = theaterOpen(ch, ownerName, lastDecision);
    await theaterDone;

    let res;
    const runPayload = clientTraceId || commandText
        ? { client_trace_id: clientTraceId, command_text: commandText }
        : {};
    if (clientTraceId) {
        diagLog("info", "player-command", "Worker run requested for saved CEO move", {
            client_trace_id: clientTraceId,
            stage_id: ch.id || "",
            stage_title: ch.title || "",
            worker: ownerName,
        });
    }
    try {
        res = await api("/api/world/run-next", runPayload);
    } catch (e) {
        // One silent retry: long reasoning calls can be cut by transient
        // network blips; the server is idempotent on the pending stage.
        try {
            await narrate("A network blip mid-reasoning. The worker picks its thread back up...");
            res = await api("/api/world/run-next", runPayload);
        } catch (e2) {
            if (A.thinkingStop) A.thinkingStop();
            theaterClose();
            setActionHint("Chapter failed - press Retry to resume.");
            await narrate(`The worker could not finish: ${e2.message}. Click Retry to send it back in.`);
            const retry = $("retry");
            if (retry) retry.classList.remove("is-hidden");
            return;
        }
    }
    if (A.thinkingStop) A.thinkingStop();

    const stage = res.stage || {};
    const inv = res.invocation || {};
    const score = stage.validation_score ?? 0;
    if (res.command_trace && res.command_trace.client_trace_id) {
        diagLog("info", "player-command", "Worker run correlated to CEO move", {
            client_trace_id: res.command_trace.client_trace_id,
            stage_id: res.command_trace.stage_id || stage.id || "",
            worker: inv.worker_title || ownerName,
            memory_injected: Array.isArray(inv.maf_memory) ? inv.maf_memory.length : 0,
            tools_called: Array.isArray(inv.maf_tools_called) ? inv.maf_tools_called.length : 0,
            iq_hits: Array.isArray(inv.iq_sources) ? inv.iq_sources.length : 0,
            score,
        });
    }
    nudgeResources({ proof: Math.max(4, Math.round(score / 10)), trust: score >= 80 ? 5 : -8, autonomy: 3 });
    // Stash this run's evidence so the dilemma gate can show its provenance.
    state.lastInv = inv;
    state.lastMemory = res.memory || [];
    if (res.state && res.state.world) state.decisions = res.state.world.decisions || state.decisions;
    setMemory(res.memory);
    refreshLearned(); // agent memory grew during this run (chapter summary)
    // Feed the Judge's Lens with this run's real evidence.
    const iqN = (res.memory || []).length;
    if (iqN) lens("accuracy", `chapter grounded in ${iqN} cited IQ source${iqN > 1 ? "s" : ""} + validator-checked artifact`);
    const evN = (inv.current_events || []).length;
    if (evN) lens("accuracy", `worker pulled ${evN} live current-event${evN > 1 ? "s" : ""} from the web into its reasoning`);
    const memN = (inv.maf_memory || []).length;
    lens("reasoning", `${memN} memory item${memN === 1 ? "" : "s"} injected, multi-step run on ${inv.deployment || "simulation"}${inv.maf_tools_called && inv.maf_tools_called.length ? `, model called ${inv.maf_tools_called.length} tool(s)` : ""}`);
    const deployLabel = (inv.deployment || "simulation")
        + (inv.framework === "microsoft-agent-framework" ? " \u00b7 Agent Framework" : "");
    setWorker(ch.owner_role, deployLabel, `Done in ${inv.latency_s ?? 0}s`, false, inv.worker_title || ownerName);
    setTools(inv.tools_drawn);
    setToolTrace(inv.tool_trace);
    setReasoning(inv);
    mafRunLand(inv);
    // Stash this character's run evidence so its on-stage CARD is clickable -
    // the card opens a dialog with these real receipts (tool calls, reasoning,
    // memory, score). One store, read by both the rail and the card dialog.
    recordCardEvidence(inv.worker_title || ownerName, ch.owner_role, {
        stage: ch.title,
        score: score,
        deployment: deployLabel,
        tools: inv.tools_drawn || [],
        trace: inv.tool_trace || [],
        mafTools: inv.maf_tools_called || [],
        mafMemory: inv.maf_memory || [],
        currentEvents: inv.current_events || [],
        status: inv.status || "completed",
        tokens_in: inv.tokens_in || 0,
        tokens_out: inv.tokens_out || 0,
        reasoningTokens: inv.reasoning_tokens || 0,
        reasoningPreview: inv.reasoning_preview || "",
        latency: inv.latency_s ?? 0,
    });
    // The reveal beat: the model's actual chain-of-thought, center stage.
    await theaterReveal(inv);

    // Animate the artifact into a diagram.
    const diag = diagramForArtifact(ch.owner_role, stage.artifact);
    if (diag && diag.type === "mermaid") await renderMermaid(diag.def);
    else if (diag && diag.type === "svg") { renderSvg(diag.svg); if (A.chime) A.chime(); }
    else await narrate("This stage produced a text artifact - no diagram shape detected.");

    await sleep(500);
    setGate(score, stage.rubric);
    if (score >= 80) { if (A.approve) A.approve(); } else if (A.reject) A.reject();
    lens("reliability", score >= 80
        ? `gate ${state.idx + 1} passed at ${score}/100 - validator floor held, human approval sealed it`
        : `gate held a ${score}/100 artifact for human review - nothing ships unverified`);
    setHud(res.state);

    const artifactKind = describeArtifact(ch.owner_role);
    const rubricLine = stage.rubric && stage.rubric.source === "foundry"
        ? `A Foundry rubric evaluation scored it ${score} of 100 across four weighted dimensions, floored by the deterministic validator`
        : `The deterministic validator scored it ${score} of 100`;
    await narrate(`${ownerName} delivered ${artifactKind}. ${rubricLine} - ${score >= 80 ? "it passes the gate and the company graph grows." : "bronze, so it pauses for a human gate."}`);
    const isFinalStage = state.idx >= state.stages.length - 1;
    if (!isFinalStage) await runRewardDraftGate(state.game);

    completedStages.push({ title: ch.title, role: ch.owner_role });
    state.idx += 1;

    if (state.idx >= state.stages.length) {
        await finale(res.state);
    } else {
        // The CEO decision gate: pick a path before the next worker spins up.
        await runDilemmaGate(stage);
        state.phase = "ready";
        updateCommandControls();
        const next = $("next"); if (next) next.disabled = false;
        setActionHint("Next: send a move to brief the next worker.");
    }
}

function describeArtifact(role) {
    return {
        strategist: "a positioning brief, an org chart, and Q1 OKRs",
        designer: "a landing page spec and a systems integration map",
        marketer: "a GTM channel mix and a six-month financial plan",
        ops: "retention loops and a churn-controlled financial plan",
    }[role] || "a structured artifact";
}

// --- Dilemma gate (game_design.md section 5) -------------------------------
// After a chapter seals, the narrator poses a 2-option CEO tradeoff (live
// Foundry; canned offline). The pick is recorded via /api/decision and the
// next worker treats it as binding direction.
let dilemmaResolve = null;
let dilemmaVoiceBound = false; // one-time bind of the dilemma mic to STT

function hideDilemma() {
    $("dilemma-overlay").hidden = true;
    setStageLayer("dilemma", false);
    $("dilemma-own-wrap").hidden = true;
    $("dilemma-own-input").value = "";
    const st = $("dilemma-own-status");
    if (st) { st.hidden = true; st.textContent = ""; st.classList.remove("live"); }
    dilemmaResolve = null;
}

async function runDilemmaGate(stage) {
    let dilemma;
    try {
        dilemma = await api("/api/dilemma", { stage_id: stage.id });
    } catch (e) { return; /* dilemma is additive - never block the run */ }
    if (!dilemma || !Array.isArray(dilemma.options) || dilemma.options.length < 2) return;

    $("dilemma-prompt").textContent = dilemma.prompt;
    const speaker = dilemma.speaker || {};
    const kicker = document.querySelector("#dilemma-overlay .dilemma-kicker");
    if (kicker) {
        kicker.textContent = `${speaker.display_name || "The Narrator"} - your workforce proposes, you decide - your call shapes the next stage`;
    }
    // Provenance strip: the dilemma is written by the Narrator FROM the
    // artifact just sealed - show the reasoning trail, not a popup from nowhere.
    const trail = $("dilemma-trail");
    if (trail) {
        const inv = state.lastInv || {};
        const iqN = (state.lastMemory || []).length;
        const memN = (inv.maf_memory || []).length;
        const chips = [
            `<span class="tchip gold">&#9818; posed by The Narrator</span>`,
            `<span class="tchip">from &ldquo;${esc((stage.title || "").slice(0, 34))}&rdquo; sealed at ${stage.validation_score ?? "&mdash;"}/100</span>`,
        ];
        const villain = dilemma.antagonist || null;
        if (villain && villain.name) {
            chips.push(`<span class="tchip rival">&#9876; ${esc(villain.name)} (${esc(villain.archetype || "rival")}) pressures this call</span>`);
        }
        // What the worker brought back to the CEO (real research receipts).
        const report = dilemma.field_report || null;
        if (report && report.headline) {
            const icon = report.signal ? "&#128240;" : "&#9783;";
            chips.push(`<span class="tchip report">${icon} ${esc(report.worker || "your worker")} reports: ${esc(report.headline.slice(0, 70))}</span>`);
        }
        if (iqN) chips.push(`<span class="tchip">&#9783; ${iqN} IQ source${iqN > 1 ? "s" : ""}</span>`);
        if (memN) chips.push(`<span class="tchip">&#9851; ${memN} memory items in brief</span>`);
        chips.push(`<span class="tchip">decision #${(state.decisions || []).length + 1} of this run</span>`);
        trail.innerHTML = chips.join("");
    }
    const toolHost = $("dilemma-tools");
    if (toolHost) {
        const tools = Array.isArray(dilemma.tool_plan) ? dilemma.tool_plan.slice(0, 3) : [];
        toolHost.innerHTML = tools.map((t) => `
            <div class="dilemma-tool">
                <code>${esc(t.tool || "tool")}</code>
                <span>${esc(t.reason || "supports this decision")}</span>
            </div>`).join("");
    }
    const host = $("dilemma-options");
    host.innerHTML = "";
    dilemma.options.slice(0, 2).forEach((o, i) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "dilemma-opt";
        // The worker who would own this path - the choice is a worker proposal,
        // not a popup from nowhere. Show who is championing it.
        const by = o.proposed_by || null;
        const proposer = by && by.title
            ? `<span class="dilemma-by"><img src="${esc(by.portrait_url || "")}" alt="" onerror="this.style.display='none'"><em>${esc(by.title)}</em> proposes</span>`
            : "";
        btn.innerHTML = proposer
            + `<b>${i + 1} &middot; ${esc(o.option)}</b>`
            + `<span>tradeoff: ${esc(o.tradeoff || "none stated")}</span>`
            + (o.effect_line ? `<em>${esc(o.effect_line)}</em>` : "")
            + (o.principle && o.principle.name
                ? `<span class="dilemma-principle">&#128218; <b>${esc(o.principle.name)}</b> &mdash; ${esc(o.principle.insight || "")}</span>`
                : "")
            + (o.rule_id ? `<small>${esc(o.rule_id)}</small>` : "");
        btn.addEventListener("click", () => decide(o, false));
        host.appendChild(btn);
    });
    $("dilemma-overlay").hidden = false;
    setStageLayer("dilemma", true);
    // Reset the voice/own-path UI so a prior gate's transcript never carries over.
    $("dilemma-own-wrap").hidden = true;
    $("dilemma-own-input").value = "";
    const ownStatus = $("dilemma-own-status");
    if (ownStatus) { ownStatus.hidden = true; ownStatus.textContent = ""; ownStatus.classList.remove("live"); }
    setActionHint("Decision gate: choose 1 / 2, or speak your own path.");
    if (A.speak) { try { A.speak(dilemma.prompt, { voice: NARRATOR_VOICE }); } catch (_) {} }

    // Wire the free-text path BEFORE parking on the promise - statements after
    // the await only run once the dilemma is already decided, which left the
    // Commit button dead during a live gate. (decide is hoisted, so this works.)
    // Voice: the narrator already speaks the prompt aloud; the CEO speaks back
    // their call here. The mic reuses the same STT binder as the standup and
    // only transcribes into the input, so binding it once is safe even though
    // the Commit handler is re-pointed at the current gate's `decide` each time.
    if (!dilemmaVoiceBound) {
        const micBtn = $("dilemma-own-mic");
        const inputEl = $("dilemma-own-input");
        const statusEl = $("dilemma-own-status");
        if (micBtn && inputEl) {
            bindSpeechRecognition(micBtn, inputEl, statusEl);
            inputEl.addEventListener("keydown", (e) => {
                if (e.key === "Enter") { const v = inputEl.value.trim(); if (v) $("dilemma-own-go").click(); }
            });
        }
        dilemmaVoiceBound = true;
    }
    $("dilemma-own-btn").onclick = () => {
        $("dilemma-own-wrap").hidden = false;
        const st = $("dilemma-own-status"); if (st) st.hidden = false;
        $("dilemma-own-input").focus();
        // Open the live voice moment immediately. The first click prompts the
        // browser for microphone permission; if it's unsupported or denied the
        // mic hides itself / shows the reason and typing still works.
        const mic = $("dilemma-own-mic");
        if (mic && mic.style.display !== "none" && !mic.classList.contains("listening")) mic.click();
    };
    $("dilemma-own-go").onclick = () => {
        const v = $("dilemma-own-input").value.trim();
        if (v) decide(v, true);
    };

    const picked = await new Promise((resolve) => {
        dilemmaResolve = resolve;
    });

    async function decide(choice, custom) {
        if (!dilemmaResolve) return;
        const option = typeof choice === "string" ? choice : (choice.option || "");
        const tradeoff = typeof choice === "string" ? "" : (choice.tradeoff || "");
        const r = dilemmaResolve; dilemmaResolve = null;
        document.querySelectorAll("#dilemma-options .dilemma-opt, #dilemma-own-btn, #dilemma-own-go").forEach((el) => { el.disabled = true; });
        setActionHint("Committing decision to company state...");
        let consequence = null;
        let receiptMemory = null, receiptNext = null, receiptPrinciple = null;
        let councilPacket = null;
        try {
            const res = await api("/api/decision", {
                stage_id: stage.id, option, tradeoff: tradeoff || "",
                prompt: dilemma.prompt, custom: !!custom,
                rule_id: custom ? "" : (choice.rule_id || ""),
                option_id: custom ? "custom" : (choice.id || ""),
                scene_id: dilemma.scene_id || "",
            });
            $("dilemma-overlay").hidden = true;
            setStageLayer("dilemma", false);
            state.decisions = res.decisions || state.decisions;
            consequence = res.consequence || (res.recorded && res.recorded.consequence) || null;
            receiptMemory = res.memory || null;
            receiptNext = res.next_brief || null;
            receiptPrinciple = res.principle || (typeof choice === "object" ? choice.principle : null) || null;
            councilPacket = res.world_council || null;
            if (res.state) {
                state.org = res.state.org || state.org;
                state.stages = (res.state.world && res.state.world.stages) || state.stages;
                setHud(res.state);
                setOrgPanel(state.org);
                setResourcesFromEconomics(res.state.economics, state.org);
            }
        } catch (_) {
            dilemmaResolve = r;
            $("dilemma-overlay").hidden = false;
            setStageLayer("dilemma", true);
            document.querySelectorAll("#dilemma-options .dilemma-opt, #dilemma-own-btn, #dilemma-own-go").forEach((el) => { el.disabled = false; });
            setActionHint("Decision did not persist - choose again to retry.");
            return;
        }
        document.querySelectorAll("#dilemma-options .dilemma-opt, #dilemma-own-btn, #dilemma-own-go").forEach((el) => { el.disabled = false; });
        refreshLearned(); // the workers just learned the CEO's operating pattern
        const summary = consequence && consequence.summary ? consequence.summary : "The next worker receives this as binding direction.";
        if (consequence) {
            setSceneHead("Decision effect", "The company changes",
                "\u2692 deterministic consequence rule updated state, org, and economics");
            renderDilemmaReceipt({ option, tradeoff, consequence, memory: receiptMemory, nextBrief: receiptNext, principle: receiptPrinciple });
            lens("reliability", `${consequence.rule_id} applied: org and economics mutated before the next chapter`);
            await announceWorldState(`Decided: ${option}. ${summary}`, "orgdesigner");
            if (state.org) {
                await renderMermaid(orgBlueprintMermaid(state.org));
                await sleep(500);
            }
            // The Game Master council ratifies the move first (engine tier:
            // World Designer + Antagonist + Org Designer), then the worker
            // standup reacts (party tier). Both reuse the same transcript
            // renderer; the council packet ships with the decision response so
            // no extra round-trip is needed.
            if (councilPacket && Array.isArray(councilPacket.turns) && councilPacket.turns.length) {
                try {
                    await renderAgentStandup(councilPacket, { interactive: false });
                } catch (_) {
                    lens("reasoning", "Game Master council skipped; decision state is still committed");
                }
            }
            try {
                const standup = await api("/api/world/standup", {
                    stage_id: stage.id,
                    selection_mode: STANDUP_SELECTION
                });
                await renderAgentStandup(standup);
            } catch (_) {
                lens("reasoning", "Agent stand-up skipped; decision state is still committed");
            }
        } else {
            nudgeResources(resourceDeltaForDecision(option, tradeoff));
            await announceWorldState(`Decided: ${option}. Your workforce will execute accordingly.`, "orgdesigner");
        }
        lens("reasoning", `CEO decision recorded - next worker's brief carries "${String(option).slice(0, 50)}" and its company consequence`);
        r({ option, tradeoff, custom });
    }

    return picked;
}

document.addEventListener("keydown", (e) => {
    if ($("dilemma-overlay").hidden || !dilemmaResolve) return;
    if (document.activeElement === $("dilemma-own-input")) {
        if (e.code === "Enter") $("dilemma-own-go").click();
        return;
    }
    const opts = document.querySelectorAll("#dilemma-options .dilemma-opt");
    if (e.code === "Digit1" && opts[0]) opts[0].click();
    else if (e.code === "Digit2" && opts[1]) opts[1].click();
    else if (e.code === "Digit3") $("dilemma-own-btn").click();
});

async function finale(s) {
    state.phase = "arc-complete";
    updateCommandControls();
    markProgress(state.stages.length, "done");
    setSceneHead("Act I complete", "Your venture has a working loop");
    if (A.complete) A.complete();
    await renderMermaid(companyGraphDef());
    setWorker("narrator", "Venture loop: launched", "Act I verified", false);
    setActionHint("Act I complete. The company can keep operating; the larger mission is still ahead.");
    await narrate(`${state.stages.length} stages, ${state.stages.length} verified gates. From one founder signal you now have an org, the systems it runs on, a launch plan, and the numbers behind it - level ${s.level ?? 1}, ${s.xp ?? 0} XP. That is the first operating loop, not the final win condition.`);
    await incomeBeat(s);
    if (s && s.game) syncGameState(s.game);
}

// --- The income beat (game_design.md section 9.5) ---------------------------
// The screen goes quiet, the org runs without you, and the counter ticks.
// Scripted and deterministic: the work feed is the org's own designed workers
// executing their mandates; the rate derives from the marketer's financial
// plan when one exists. This is the promise of the intro landing as gameplay:
// your experience became a business that runs while you sleep.
async function incomeBeat(s) {
    hideSpeakerSpotlight();
    const org = state.org || {};
    const workers = (org.roles || []).filter((r) => r.kind !== "human");
    const fin = (() => {
        for (const ch of state.stages) {
            const f = ch.artifact && (ch.artifact.financial_plan || ch.artifact.financials);
            if (f && typeof f === "object") return f;
        }
        return null;
    })();
    const mrr = Number((fin && (fin.target_mrr_usd_m1_to_m6 || [])[0]) || 1800);
    const perTick = Math.max(4, Math.round(mrr / 120));

    setSceneHead("Epilogue", "The org runs while you sleep");
    const host = $("diagram");
    host.innerHTML = `
        <div class="income-beat fade-scene">
            <div class="income-num"><span id="income-counter">$0</span><span class="income-label">earned while you watched</span></div>
            <div id="income-feed" class="income-feed"></div>
        </div>`;
    await narrate("Now the part the story promised. Watch - no clicks, no prompts. The workforce runs.");

    const feed = $("income-feed");
    const counter = $("income-counter");
    const verbs = ["shipped", "sent", "qualified", "published", "resolved", "prepared"];
    const things = ["a campaign draft", "12 follow-ups", "a lead batch", "a product update post", "3 support threads", "tomorrow's brief"];
    let earned = 0;
    const ticks = Math.min(8, Math.max(5, workers.length + 2));
    for (let i = 0; i < ticks; i++) {
        const w = workers.length ? workers[i % workers.length] : { title: "Digital Worker" };
        const line = document.createElement("div");
        line.className = "income-line";
        line.innerHTML = `<span class="income-who">${esc(w.title)}</span> ${verbs[i % verbs.length]} ${things[i % things.length]} <span class="income-gate">sealed at the gate</span>`;
        feed.prepend(line);
        earned += perTick + Math.round(perTick * 0.4 * ((i * 37) % 10) / 10);
        counter.textContent = `$${earned.toLocaleString()}`;
        if (A.chime && i % 2 === 0) A.chime();
        await sleep(1300);
    }
    await narrate(`Act I is live: your skill set the direction, the gates kept it honest, and the workforce turned it into income - ${workers.length || "your"} digital workers, one human seal. The larger win is still ahead: scale this loop until it contributes to automating basic needs.`);
    setActionHint("Act I launched. Continue operating, counter the rival, or Reset to run another venture.");
}

function renderAgentGeneratedUI(schema) {
    const form = $("player-command");
    if (!form) return;
    let dynamicContainer = $("player-command-dynamic");
    if (dynamicContainer) {
        dynamicContainer.remove();
    }
    const defaultInput = $("player-command-input");
    const micBtn = $("player-command-mic");
    if (!schema) {
        if (defaultInput) defaultInput.style.display = "";
        if (micBtn) micBtn.style.display = "";
        return;
    }
    if (defaultInput) defaultInput.style.display = "none";
    if (micBtn) micBtn.style.display = "none";
    dynamicContainer = document.createElement("div");
    dynamicContainer.id = "player-command-dynamic";
    dynamicContainer.className = "dynamic-form-fields";
    dynamicContainer.style.display = "flex";
    dynamicContainer.style.flexDirection = "column";
    dynamicContainer.style.gap = "8px";
    dynamicContainer.style.flex = "1";
    dynamicContainer.style.minWidth = "0";
    const buildFields = (fields) => {
        fields.forEach(field => {
            const fieldWrapper = document.createElement("div");
            fieldWrapper.className = "dynamic-field-wrapper";
            fieldWrapper.style.display = "flex";
            fieldWrapper.style.flexDirection = "column";
            fieldWrapper.style.gap = "4px";
            if (field.label) {
                const label = document.createElement("label");
                label.textContent = field.label;
                label.style.fontFamily = "var(--font-mono)";
                label.style.fontSize = "10px";
                label.style.color = "var(--ink-dim)";
                fieldWrapper.appendChild(label);
            }
            let inputNode;
            if (field.type === "text") {
                inputNode = document.createElement("input");
                inputNode.type = "text";
                inputNode.id = `dynamic-${field.id}`;
                inputNode.name = field.id;
                inputNode.placeholder = field.placeholder || "";
                inputNode.value = field.value || "";
                inputNode.className = "dynamic-input";
            } else if (field.type === "range") {
                const rangeContainer = document.createElement("div");
                rangeContainer.style.display = "flex";
                rangeContainer.style.alignItems = "center";
                rangeContainer.style.gap = "8px";
                inputNode = document.createElement("input");
                inputNode.type = "range";
                inputNode.id = `dynamic-${field.id}`;
                inputNode.name = field.id;
                inputNode.min = field.min !== undefined ? field.min : 0;
                inputNode.max = field.max !== undefined ? field.max : 100;
                inputNode.value = field.value !== undefined ? field.value : 50;
                inputNode.style.flex = "1";
                const valueLabel = document.createElement("span");
                valueLabel.textContent = inputNode.value;
                valueLabel.style.fontFamily = "var(--font-mono)";
                valueLabel.style.fontSize = "11px";
                inputNode.addEventListener("input", () => {
                    valueLabel.textContent = inputNode.value;
                });
                rangeContainer.appendChild(inputNode);
                rangeContainer.appendChild(valueLabel);
                fieldWrapper.appendChild(rangeContainer);
            } else if (field.type === "select") {
                inputNode = document.createElement("select");
                inputNode.id = `dynamic-${field.id}`;
                inputNode.name = field.id;
                inputNode.className = "dynamic-select";
                (field.options || []).forEach(opt => {
                    const optNode = document.createElement("option");
                    const optVal = typeof opt === "string" ? opt : opt.value;
                    const optText = typeof opt === "string" ? opt : opt.label;
                    optNode.value = optVal;
                    optNode.textContent = optText;
                    if (optVal === field.value) optNode.selected = true;
                    inputNode.appendChild(optNode);
                });
            }
            if (inputNode) {
                inputNode.style.background = "var(--input-bg, rgba(5,8,16,0.6))";
                inputNode.style.border = "1px solid var(--line, rgba(255,255,255,0.08))";
                inputNode.style.borderRadius = "6px";
                inputNode.style.color = "var(--ink)";
                inputNode.style.padding = "6px 10px";
                inputNode.style.fontSize = "12px";
                inputNode.style.fontFamily = "var(--font-body)";
                if (field.type !== "range") {
                    fieldWrapper.appendChild(inputNode);
                }
            }
            dynamicContainer.appendChild(fieldWrapper);
        });
    };
    if (schema.type === "group" && Array.isArray(schema.fields)) {
        buildFields(schema.fields);
    } else if (Array.isArray(schema)) {
        buildFields(schema);
    }
    const sendBtn = $("player-command-send");
    if (sendBtn) {
        form.insertBefore(dynamicContainer, sendBtn);
    } else {
        form.appendChild(dynamicContainer);
    }
}

function collectDynamicCommandData() {
    const dynamicContainer = $("player-command-dynamic");
    if (!dynamicContainer) return null;
    const data = {};
    dynamicContainer.querySelectorAll("input, select, textarea").forEach((inp) => {
        if (!inp.name) return;
        data[inp.name] = inp.type === "range" ? Number(inp.value) : inp.value;
    });
    return data;
}

function dynamicCommandSummary(data) {
    const entries = Object.entries(data || {});
    if (!entries.length) return "";
    return entries.map(([k, v]) => `${k}: ${v}`).join(", ");
}

function updateCommandControls() {
    const form = $("player-command");
    const input = $("player-command-input");
    const send = $("player-command-send");
    if (!form || !input || !send) return;
    const hasWorld = Array.isArray(state.stages) && state.stages.length > 0;
    const hasPendingReward = !!(state.game && Array.isArray(state.game.pending_rewards) && state.game.pending_rewards.length);

    // Check if the current stage has an agent-generated form schema
    const stage = (state.stages && state.stages[state.idx]) || {};
    if (stage.form_schema) {
        renderAgentGeneratedUI(stage.form_schema);
    } else {
        renderAgentGeneratedUI(null);
    }

    const ready = state.phase === "ready" && hasWorld && !hasPendingReward && state.idx < state.stages.length;
    // The footer must be reachable the instant it is the player's turn. The
    // Game Master announcement slides the whole footer off-screen
    // (announce-bridge); a lingering announcement after the founding cinematic would
    // strand the command line. So the moment any playable footer state is live
    // - the command line, a pending reward draft, or the card hand - dismiss the
    // announcement so the footer glides back. The footer tracks the game loop.
    if (stageLayerActive("announce-bridge") && (ready || hasPendingReward)) {
        hideSpeakerSpotlight();
    }
    // The command line is the CEO's one verb: brief the next worker. Show it
    // only when that is actually the move. In every other loop beat - a worker
    // is reasoning, a reward draft is open, the run is loading or over - a
    // disabled input is dead weight that crowds the footer right over the real
    // choice (the reward cards, the theater). So it steps aside and the action
    // hint below carries the "why". This is the footer tracking the game loop
    // instead of always sitting in the way.
    form.hidden = !ready;
    input.disabled = !ready;
    send.disabled = !ready;
    input.placeholder = ready
        ? `Tell the workforce your move for stage ${state.idx + 1}...`
        : (hasPendingReward ? "Choose a reward card first - then brief the next worker..." : (state.phase === "running" ? "Worker is executing your last move..." : "Waiting for the world to finish loading..."));
    if (ready) {
        const owner = stage.assigned_worker_title || ROLE_NAME[stage.owner_role] || stage.owner_role || "worker";
        setActionHint(`Ready: Send Move briefs ${owner} for stage ${state.idx + 1}.`);
    } else if (hasPendingReward) {
        setActionHint("Choose a reward card before briefing the next worker.");
    }
    queueFooterAwareLayoutSync();
}

async function submitPlayerCommand(e) {
    if (e) e.preventDefault();
    const input = $("player-command-input");
    if (state.phase !== "ready" || state.idx >= state.stages.length) return;

    let text = "";
    let clientTraceId = "";
    const formData = collectDynamicCommandData();
    if (formData) {
        text = dynamicCommandSummary(formData);
    } else if (input) {
        text = input.value.trim();
        input.value = "";
    }

    if (text) {
        const stage = state.stages[state.idx] || {};
        const owner = stage.assigned_worker_title || ROLE_NAME[stage.owner_role] || stage.owner_role || "worker";
        clientTraceId = newClientTraceId("cmd");
        state.playerCommands.push({ stage_id: stage.id || "", text: text, form_data: formData || null, client_trace_id: clientTraceId, ts: Date.now() });
        setActionHint(`Move registered. Briefing ${owner}...`);
        diagLog("info", "player-command", "Send Move clicked", {
            client_trace_id: clientTraceId,
            stage_id: stage.id || "",
            stage_index: state.idx + 1,
            worker: owner,
            text_preview: text.slice(0, 90),
            source: formData ? "dynamic_form" : "player_command",
        });

        showActionReceipt("CEO move captured", [`stage ${state.idx + 1}`, owner, `trace ${clientTraceId.slice(-8)}`], `"${text}" is saved as worker memory and carried into the next stage brief.`, "good");
        try {
            const saved = await api("/api/world/standup/respond", {
                text: text,
                stage_id: stage.id || "",
                form_data: formData || {},
                source: formData ? "dynamic_form" : "player_command",
                client_trace_id: clientTraceId,
            });
            diagLog("info", "player-command", "CEO move persisted into memory, move log, and IQ sync cache", {
                client_trace_id: saved.client_trace_id || clientTraceId,
                player_move_id: saved.player_move && saved.player_move.id,
                adapted_stage_count: (saved.adapted_stage_ids || []).length,
                memory_origin: saved.player_move && saved.player_move.effects_applied && saved.player_move.effects_applied.memory_origin,
                knowledge_records: saved.state && Array.isArray(saved.state.knowledge_records) ? saved.state.knowledge_records.length : undefined,
            });
            if (saved.state) {
                setHud(saved.state);
                setResourcesFromEconomics(saved.state.economics, saved.state.org || state.org);
                if (saved.state.org) setOrgPanel(saved.state.org);
            }
            lens("reasoning", `CEO move recorded in memory before stage ${state.idx + 1}: "${text.slice(0, 54)}"`);
            if ((saved.adapted_stage_ids || []).length) {
                lens("reasoning", `World Designer bent ${saved.adapted_stage_ids.length} pending stage(s) to that CEO move`);
            }
            await refreshLearned();
        } catch (_) {
            lens("reliability", "CEO move stayed local because memory service was unavailable; stage still continues");
        }
    }
    await runNextChapter({ clientTraceId, commandText: text });
}

async function resetStory() {
    typeToken++;
    _worldReuse = null;
    try { await api("/api/reset", {}); } catch (_) {}
    completedStages.length = 0;
    state.stages = [];
    state.idx = 0;
    state.phase = "title";
    location.reload();
}

// --- Voice input (browser speech-to-text) ----------------------------------
// Reusable speech recognition binder
function bindSpeechRecognition(micBtn, inputEl, statusEl, onResultCallback) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { micBtn.style.display = "none"; return () => {}; }

    let rec = null;
    let listening = false;
    let baseText = "";

    function stop() {
        listening = false;
        micBtn.classList.remove("listening");
        try { rec && rec.stop(); } catch (e) { /* ignore */ }
    }

    micBtn.addEventListener("click", async () => {
        if (A.unlock) { try { A.unlock(); } catch (e) { /* audio optional */ } }
        if (listening) { stop(); if (statusEl) statusEl.textContent = ""; return; }

        // Proactively ask for mic permission so the browser shows its prompt and
        // we can give a clear message when access is blocked (common in embedded
        // webviews). Typing always remains the fallback.
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            try {
                const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
                probe.getTracks().forEach((t) => t.stop());
            } catch (err) {
                if (statusEl) {
                    statusEl.textContent = "Microphone blocked - allow mic access in your browser, or type instead.";
                    statusEl.classList.remove("live");
                }
                return;
            }
        }

        rec = new SR();
        rec.lang = "en-US";
        rec.interimResults = true;
        rec.continuous = true;
        baseText = (inputEl.value || "").trim();

        rec.onstart = () => {
            listening = true;
            micBtn.classList.add("listening");
            if (statusEl) {
                statusEl.innerHTML = `<span class="cc-mic-rec"></span>Listening`
                    + `<span class="cc-mic-eq"><span></span><span></span><span></span><span></span></span>`;
                statusEl.classList.add("live");
            }
        };
        rec.onerror = (e) => {
            if (statusEl) {
                statusEl.textContent = (e.error === "not-allowed" || e.error === "service-not-allowed")
                    ? "Microphone blocked - allow mic access, or type instead."
                    : "Mic error: " + (e.error || "unknown");
                statusEl.classList.remove("live");
            }
            stop();
        };
        rec.onend = () => {
            micBtn.classList.remove("listening");
            if (listening && statusEl) {
                statusEl.textContent = "Heard you.";
                statusEl.classList.remove("live");
            }
            listening = false;
        };
        rec.onresult = (event) => {
            let interim = "";
            let finalTxt = "";
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const t = event.results[i][0].transcript;
                if (event.results[i].isFinal) finalTxt += t;
                else interim += t;
            }
            const joined = [baseText, finalTxt].filter(Boolean).join(" ").trim();
            if (finalTxt) baseText = joined;
            inputEl.value = (joined + (interim ? " " + interim : "")).trim();
            if (onResultCallback) onResultCallback(inputEl.value);
        };

        try { rec.start(); } catch (e) { if (statusEl) statusEl.textContent = "Could not start mic"; }
    });

    return stop;
}

// Lets the founder speak their company idea instead of typing it. Uses the
// browser SpeechRecognition API (Chrome/Edge/Safari) - no API key, no network
// of our own. Degrades gracefully: if unsupported, the mic button is hidden and
// typing still works.
function setupVoiceInput() {
    const micBtn = $("mic");
    const statusEl = $("mic-status");
    const pitchEl = $("in-pitch");
    if (!micBtn || !pitchEl) return;

    bindSpeechRecognition(micBtn, pitchEl, statusEl, (value) => {
        // Speaking a fresh idea should clear any URL so the pitch wins.
        const urlEl = $("in-url");
        if (urlEl && value) urlEl.value = "";
    });
}

function populateFounderVoiceSelect(catalog) {
    const select = $("in-founder-voice");
    if (!select) return;

    const core = (catalog && Array.isArray(catalog.core_openai) && catalog.core_openai.length)
        ? catalog.core_openai
        : VOICE_PROFILES;
    VOICE_PROFILES.splice(0, VOICE_PROFILES.length, ...core.map((profile) => ({
        id: profile.id,
        label: profile.label || profile.id,
        locale: profile.locale || "en-US",
        stack: profile.stack || "core_openai",
        tone: profile.tone || "Core voice",
    })));

    select.innerHTML = "";
    const coreGroup = document.createElement("optgroup");
    coreGroup.label = "Core cast voices";
    VOICE_PROFILES.forEach((profile) => {
        const option = document.createElement("option");
        option.value = profile.id;
        option.textContent = `${profile.label} (${profile.tone})`;
        if (profile.id === "onyx") option.selected = true;
        coreGroup.appendChild(option);
    });
    select.appendChild(coreGroup);

    const planned = catalog && catalog.azure_speech && Array.isArray(catalog.azure_speech.planned_profiles)
        ? catalog.azure_speech.planned_profiles
        : [];
    if (planned.length) {
        const speechGroup = document.createElement("optgroup");
        speechGroup.label = "Azure Speech diversity pool - planned";
        planned.slice(0, 6).forEach((profile) => {
            const option = document.createElement("option");
            option.value = profile.id;
            option.disabled = true;
            option.textContent = `${profile.label} (${profile.locale}) - adapter next`;
            speechGroup.appendChild(option);
        });
        select.appendChild(speechGroup);
    }
}

async function hydrateFounderVoiceCatalog() {
    try {
        const catalog = await apiGet("/api/voices");
        populateFounderVoiceSelect(catalog);
    } catch (e) {
        populateFounderVoiceSelect(null);
    }
}

function setupCharacterCreation() {
    hydrateFounderVoiceCatalog();

    // One-step profile-first creation. The LinkedIn/public URL is the primary
    // signal; Enter starts the run. Archetype cards remain hidden as an
    // implementation fallback and can still be selected by scripted flows.
    const urlInput = $("in-url");
    if (urlInput) {
        try { urlInput.focus(); } catch (_) {}
        urlInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                gatherAndReady();
            }
        });
    }

    // Voice Preview
    const btnPreview = $("btn-preview-voice");
    if (btnPreview) {
        btnPreview.addEventListener("click", () => {
            const profile = selectedFounderVoiceProfile();
            const voiceVal = profile.id;
            const text = `This is ${profile.label || "my"} voice profile. Ready to guide the team.`;
            if (A.speak) {
                try {
                    A.speak(text, { voice: voiceVal });
                } catch (e) {
                    console.warn("Speech synthesis failed", e);
                }
            }
        });
    }

    // Avatar Generation
    const btnGen = $("btn-gen-avatar");
    if (btnGen) {
        btnGen.addEventListener("click", async () => {
            const nameVal = (($("in-founder-name") && $("in-founder-name").value.trim())
                || founderNameFromProfileUrl(($("in-url") && $("in-url").value) || "")
                || "Founder");
            const selCard = document.querySelector("#arch-row .arch-card.sel");
            const archVal = selCard ? selCard.dataset.arch : "Builder";

            const statusEl = $("avatar-status");
            const imgEl = $("img-founder-avatar");

            if (statusEl) {
                statusEl.textContent = "Generating custom portrait...";
                statusEl.style.color = "var(--gold-soft)";
            }
            btnGen.disabled = true;
            if (A.uiPress) { try { A.uiPress(); } catch (_) {} }

            try {
                const res = await api("/api/founder/generate-avatar", {
                    founder_name: nameVal,
                    founder_archetype: archVal
                });

                if (res && res.url) {
                    const cacheBuster = `?t=${Date.now()}`;
                    imgEl.src = res.url + cacheBuster;
                    state.founderAvatar = res.url;

                    if (statusEl) {
                        if (res.source === "azure") {
                            statusEl.textContent = "Generated via Azure DALL-E";
                            statusEl.style.color = "var(--good-soft)";
                        } else {
                            statusEl.textContent = "Generated via Dynamic Offline SVG";
                            statusEl.style.color = "var(--blue-soft)";
                        }
                    }
                }
            } catch (e) {
                console.error("Avatar generation failed", e);
                if (statusEl) {
                    statusEl.textContent = "Generation failed. Offline SVG fallback loaded.";
                    statusEl.style.color = "var(--bad)";
                }
                imgEl.src = "/game/assets/generated/narrator.png";
                state.founderAvatar = "/game/assets/generated/narrator.png";
            } finally {
                btnGen.disabled = false;
            }
        });
    }
}

// --- Wire up ---------------------------------------------------------------
$("begin").addEventListener("click", gatherAndReady);
$("begin").addEventListener("mouseenter", () => {
    if (A.uiHover && A.isUnlocked && A.isUnlocked() && !$("begin").disabled) {
        try { A.uiHover(); } catch (_) {}
    }
});

// Character cards ARE the inspector: tap a card to flip it in place to its
// dossier (tool calls, reasoning, memory, receipts); tap again or press Escape
// to return it to the board. No modal.
(function wireCharacterCards() {
    if (window.__CampaignStoryCharacterCardsWired) return;
    window.__CampaignStoryCharacterCardsWired = true;
    const party = $("party");
    if (party) {
        party.addEventListener("click", (e) => {
            const tile = e.target.closest(".party-agent");
            if (tile && tile.dataset.owner) {
                openAgentInspector(tile.dataset.owner);
                if (A.cardDraw) { try { A.cardDraw(); } catch (_) {} }
            }
        });
        party.addEventListener("keydown", (e) => {
            const tile = e.target.closest(".party-agent");
            if (!tile || !tile.dataset.owner) return;
            if (e.key === "Enter") { e.preventDefault(); openAgentInspector(tile.dataset.owner); }
            if (e.key === " ") { e.preventDefault(); setPartyFlip(tile.dataset.owner); }
        });
        party.addEventListener("mouseover", (e) => {
            if (!e.target.closest(".party-agent")) return;
            if (A.cardHover && A.isUnlocked && A.isUnlocked()) { try { A.cardHover(); } catch (_) {} }
        });
    }
    // The footer mini is the front door to the active agent's gorgeous card -
    // including the core game-master agents (Org Designer / World Designer) that
    // never sit in the party row. Click it to summon their dossier, click again
    // (or the close button / Escape / outside) to dismiss.
    const workerMini = $("worker");
    if (workerMini) {
        workerMini.setAttribute("title", "Inspect Game Master dossiers");
        workerMini.addEventListener("click", (e) => {
            const gm = e.target.closest("[data-gm-role]") || workerMini.querySelector('[data-gm-role="narrator"]');
            if (!gm) return;
            e.preventDefault();
            e.stopPropagation();
            const role = gm.dataset.gmRole || "narrator";
            const displayName = role === "orgdesigner" ? ROLE_NAME.orgdesigner : ROLE_NAME.narrator;
            state.activeWorker = { role, deployLabel: "", stateText: role === "orgdesigner" ? "Designing workforce" : "Authoring world", displayName };
            openAgentInspector(role);
            if (A.cardDraw) { try { A.cardDraw(); } catch (_) {} }
        });
        workerMini.addEventListener("keydown", (e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            const gm = e.target.closest("[data-gm-role]");
            if (gm) {
                const role = gm.dataset.gmRole || "narrator";
                const displayName = role === "orgdesigner" ? ROLE_NAME.orgdesigner : ROLE_NAME.narrator;
                state.activeWorker = { role, deployLabel: "", stateText: role === "orgdesigner" ? "Designing workforce" : "Authoring world", displayName };
                openAgentInspector(role);
            }
        });
    }
    const castStage = $("cast-stage");
    if (castStage) {
        bindInspectorInteractions(castStage);
    }
    // Click anywhere outside the open dossier (and not on its trigger) closes it.
    document.addEventListener("click", (e) => {
        // A click outside the hand rail returns any flipped card to its front.
        if (!e.target.closest("#party")) clearPartyFlip();
        if (inspectorOpen) {
            if (e.target.closest("#cast-stage") || e.target.closest("#worker") || e.target.closest("#party")) return;
            closeAgentInspector();
        }
        if (workerInspectorOpen) {
            if (e.target.closest("#worker-stage") || e.target.closest("#worker") || e.target.closest("#party")) return;
            closeWorkerInspector();
        }
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { closeDiagnostics(); closeAgentInspector(); closeWorkerInspector(); clearPartyFlip(); }
    });
})();

// The intro film hands off here: one continuous descent, no second form.
// `mission` = {company, pitch, archetype: {name, skill}|null}. The film picks
// the front + archetype; this fills the founding fields and starts the run
// while the overlay is still fading - the script IS the gameplay.
window.CampaignStory = window.DungeonStory = {
    start(mission) {
        if (state.phase !== "title") return;
        mission = mission || {};
        state.fromFilm = true; // the film was the welcome - the game continues it
        if (mission.company) $("in-company").value = mission.company;
        if (mission.pitch) $("in-pitch").value = mission.pitch;
        if (mission.pitch) $("in-url").value = "";
        if (mission.archetype) {
            state.archetype = mission.archetype;
            document.querySelectorAll("#arch-row .arch-card").forEach((c) => {
                c.classList.toggle("sel", c.dataset.arch === mission.archetype.name);
            });
        }
        beginStory();
    },
};

const commandForm = $("player-command");
if (commandForm) commandForm.addEventListener("submit", submitPlayerCommand);

// Collapsible footer cards (Game Masters + economy, command panel) live in
// ./layout.js; this wires their persisted collapse state + click handlers.
wireFooterCardCollapse();

// Voice path for the player's move card: speak instead of type. Reuses the same
// browser speech recognition the onboarding uses; typing stays the fallback.
(function wireCommandVoice() {
    const micBtn = $("player-command-mic");
    const inputEl = $("player-command-input");
    const statusEl = $("player-command-status");
    if (micBtn && inputEl) bindSpeechRecognition(micBtn, inputEl, statusEl);
})();
const resetBtn = $("reset");
if (resetBtn) resetBtn.addEventListener("click", resetStory);

const diagOpenBtn = $("diag-open");
const diagCloseBtn = $("diag-close");
const diagRefreshBtn = $("diag-refresh");
const diagOverlay = $("diagnostics-overlay");
if (diagOpenBtn) diagOpenBtn.addEventListener("click", openDiagnostics);
if (diagCloseBtn) diagCloseBtn.addEventListener("click", closeDiagnostics);
if (diagRefreshBtn) diagRefreshBtn.addEventListener("click", () => refreshDiagnostics(true));
if (diagOverlay) {
    diagOverlay.addEventListener("click", (event) => {
        if (event.target === diagOverlay) closeDiagnostics();
    });
}
wireDiagnosticsCapture();

// The run-over overlay's single action: begin a fresh run (same as Reset).
const runOverBtn = $("run-over-btn");
if (runOverBtn) runOverBtn.addEventListener("click", () => {
    const overlay = $("run-over-overlay");
    if (overlay) { overlay.hidden = true; overlay.classList.remove("show"); overlay.dataset.shownFor = ""; }
    resetStory();
});
const retryBtn = $("retry");
if (retryBtn) {
    retryBtn.addEventListener("click", async () => {
        retryBtn.classList.add("is-hidden");
        await runNextChapter();
    });
}
const advBtn = $("btn-cc-adv");
if (advBtn) {
    advBtn.addEventListener("click", () => {
        const ccHidden = document.querySelector(".cc-hidden");
        if (!ccHidden) return;
        const opening = ccHidden.hidden;
        advBtn.textContent = opening ? "Hide" : "No profile?";
        toggleCollapsible(ccHidden, opening);
        if (opening) { try { $("in-pitch").focus(); } catch (_) {} }
    });
}

// Ops rail toggle (button or R key): full-screen cinema vs full telemetry.
const railToggle = $("rail-toggle");
if (railToggle) {
    const stage = document.getElementById("stage");
    railToggle.addEventListener("click", () => stage.classList.toggle("rail-hidden"));
    document.addEventListener("keydown", (e) => {
        if (e.key.toLowerCase() !== "r") return;
        if (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
        stage.classList.toggle("rail-hidden");
    });
}

window.addEventListener("resize", queueFooterAwareLayoutSync);
ensureFooterLayoutObserver();
queueFooterAwareLayoutSync();

$("mute").addEventListener("click", () => {
    if (A.unlock) A.unlock();
    const muted = A.toggleMute ? A.toggleMute() : false;
    $("mute").style.opacity = muted ? 0.4 : 1;
});

// Detect live mode for the HUD chip.
fetch("/api/mode").then((r) => (r.ok ? r.json() : null)).then((d) => {
    if (d && d.live) {
        const modeDot = $("mode-dot");
        const modeLabel = $("mode-label");
        if (modeDot) modeDot.classList.add("live");
        if (modeLabel) modeLabel.textContent = "live foundry";
        state.live = true;
    }
}).catch(() => {});

// Enable speak-your-idea voice input on the pitch field (if the browser supports it).
setupVoiceInput();

// Make the character-creation text feel alive: scramble-decode the kicker on
// entrance, keep a subtle idle flicker, and let the CSS RGB-split shimmer ride
// on both the kicker and the headline. Degrades to static under reduced motion.
function setupAliveText() {
    const fs = document.querySelector(".first-step");
    if (!fs) return;
    const kicker = fs.querySelector(".creator-card .kicker");
    const h1 = fs.querySelector(".creator-card h1");
    let stopIdle = null;
    let played = false;

    function play() {
        if (played || prefersReduced()) {
            if (kicker) kicker.classList.add("glitch-alive");
            if (h1) h1.classList.add("glitch-alive");
            return;
        }
        played = true;
        if (h1) h1.classList.add("glitch-alive");
        if (kicker) {
            const text = kicker.textContent;
            scramble(kicker, text, { duration: 760 }).then(() => {
                kicker.classList.add("glitch-alive");
                if (stopIdle) stopIdle();
                stopIdle = idleGlitch(kicker, { minGap: 3200, maxGap: 7000 });
            });
        }
    }

    if (fs.classList.contains("enter")) play();
    // The intro film adds .enter when it hands off; replay the decode then.
    const obs = new MutationObserver(() => {
        if (fs.classList.contains("enter") && !played) play();
    });
    obs.observe(fs, { attributes: true, attributeFilter: ["class"] });
}
setupAliveText();

// Live source detection under the URL field: as the founder types, echo what
// kind of profile we resolved (LinkedIn, GitHub, personal site...) so they get
// feedback before they ever press Begin. No network - pure client-side classify.
function setupUrlEcho() {
    const input = $("in-url");
    if (!input) return;
    const field = input.closest(".cc-field") || input.parentNode;
    const echo = document.createElement("div");
    echo.className = "cc-source-echo";
    field.appendChild(echo);

    let last = "";
    let timer = null;
    let stopLoop = null;
    function render() {
        const val = input.value.trim();
        if (!val) {
            echo.textContent = ""; echo.classList.remove("hit"); last = "";
            if (stopLoop) { stopLoop(); stopLoop = null; }
            return;
        }
        const src = classifyProfileUrl(val);
        const label = src.host ? `${src.label} - ${src.host}` : src.label;
        if (label === last) return;
        last = label;
        echo.classList.add("hit");
        echo.innerHTML = `<span class="pip"></span><span class="cc-source-label"></span>`;
        const labelEl = echo.querySelector(".cc-source-label");
        const text = label + " detected";
        // Pop in once, then keep it alive with a resting re-decode loop.
        scramble(labelEl, text, { duration: 360 }).then(() => {
            if (stopLoop) stopLoop();
            stopLoop = loopScramble(labelEl, { text, period: 5200, duration: 420 });
        });
    }
    input.addEventListener("input", () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(render, 220);
    });
}
setupUrlEcho();

// Wire up name randomization, voice previews, and custom avatar generators
setupCharacterCreation();

// On page load: if there is a prior run on the server, offer to resume it.
// This runs in the background - never blocks form interaction.
async function bootFromSavedRun() {
    // Prefer the multi-run library: every designed run persists as its own slot,
    // so the player resumes a chosen company/product instead of one autosave.
    let slots = [], activeRunId = "";
    try {
        const res = await fetch("/api/slots");
        if (res.ok) {
            const data = await res.json();
            slots = Array.isArray(data.slots) ? data.slots : [];
            activeRunId = data.active_run_id || "";
        }
    } catch (_) { /* fall through to legacy single-run resume */ }

    if (slots.length) {
        renderSlotsLibrary(slots, activeRunId);
        return;
    }

    // Legacy fallback: a run created before slots existed still lives in
    // state.json with no run_id. Offer the single resume card for it.
    let snap;
    try {
        const res = await fetch("/api/state");
        if (!res.ok) return;
        snap = await res.json();
    } catch (_) { return; }

    const s = snap && snap.state;
    const stages = (s && s.world && s.world.stages) || [];
    const company = (s && s.name) || "";
    if (!stages.length || !company) return;
    hydrateFounderInputsFromSavedState(s);

    const completedCount = stages.filter((ch) => ch.status === "completed").length;
    const resumeCard = document.createElement("div");
    resumeCard.id = "resume-card";
    resumeCard.className = "resume-card";
    resumeCard.innerHTML =
        `<div class="resume-kicker">Previous run found</div>`
        + `<div class="resume-company">${esc(company)}</div>`
        + `<div class="resume-progress">${completedCount} of ${stages.length} stages complete</div>`
        + `<div class="resume-actions">`
        + `<button id="resume-btn" type="button" class="cta">Resume &rarr;</button>`
        + `<button id="resume-dismiss" type="button" class="cc-flip-btn small">Start fresh</button>`
        + `</div>`;

    const host = document.querySelector(".creator-card .cc-step[data-step='1']");
    if (host) host.prepend(resumeCard);

    const resumeBtn = document.getElementById("resume-btn");
    const dismissBtn = document.getElementById("resume-dismiss");
    if (resumeBtn) resumeBtn.addEventListener("click", () => { resumeCard.remove(); restoreRunFromState(s); });
    if (dismissBtn) dismissBtn.addEventListener("click", () => resumeCard.remove());
}

// The multi-run save-slot picker: a library of saved companies/products the
// player can resume or delete. Renders above the new-run form so a fresh
// company is always one click away (no slot is overwritten by starting new).
function renderSlotsLibrary(slots, activeRunId) {
    const host = document.querySelector(".creator-card .cc-step[data-step='1']");
    if (!host) return;
    document.getElementById("slots-card")?.remove();

    if (activeRunId) {
        apiGet("/api/state").then((snap) => {
            const activeState = snap && snap.state;
            if (activeState && activeState.run_id === activeRunId) hydrateFounderInputsFromSavedState(activeState);
        }).catch(() => { /* active slot metadata is enough for the picker */ });
    }

    const card = document.createElement("div");
    card.id = "slots-card";
    card.className = "slots-card";

    const statusLabel = (st) => st === "victory" ? "won" : st === "defeat" ? "lost" : "in progress";
    const rowHtml = (slot) => {
        const total = slot.stages_total || 0;
        const done = slot.stages_done || 0;
        const isActive = slot.run_id && slot.run_id === activeRunId;
        const threat = Math.round(slot.threat_level || 0);
        const sub = total
            ? `${done}/${total} stages &middot; ${statusLabel(slot.run_status)} &middot; rival ${threat}/100`
            : "setup saved";
        const actionLabel = total ? "Resume &rarr;" : "Continue setup";
        return `<div class="slot-row${isActive ? " active" : ""}" data-run="${esc(slot.run_id)}">
            <div class="slot-main">
                <div class="slot-name">${esc(cleanRunDisplayName(slot.name) || "Untitled run")}${isActive ? ` <em class="slot-active">active</em>` : ""}</div>
                <div class="slot-sub">${sub}</div>
            </div>
            <div class="slot-actions">
                <button type="button" class="cta small slot-resume" data-run="${esc(slot.run_id)}">${actionLabel}</button>
                <button type="button" class="cc-flip-btn small slot-delete" data-run="${esc(slot.run_id)}" title="Delete this saved run">&times;</button>
            </div>
        </div>`;
    };

    card.innerHTML =
        `<div class="slots-kicker">Saved companies &middot; ${slots.length}</div>`
        + `<div class="slots-list">${slots.map(rowHtml).join("")}</div>`
        + `<div class="slots-foot">Or start a new company below.</div>`;
    host.prepend(card);

    card.querySelectorAll(".slot-resume").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const runId = btn.getAttribute("data-run");
            const originalText = btn.textContent;
            btn.disabled = true; btn.textContent = "Loading...";
            try {
                const res = await api("/api/slots/load", { run_id: runId });
                const loadedState = res && res.state;
                if (!loadedState) throw new Error("Slot load returned no state.");
                if (hasDesignedRun(loadedState)) {
                    restoreRunFromState(loadedState);
                } else {
                    restoreSavedCompanySetup(loadedState);
                }
                card.remove();
            } catch (e) {
                diagLogError("resume", e, `Could not restore saved run ${runId || ""}`);
                btn.disabled = false; btn.textContent = originalText || "Resume \u2192";
                setActionHint("Could not load that run - check diagnostics for details.");
            }
        });
    });
    card.querySelectorAll(".slot-delete").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const runId = btn.getAttribute("data-run");
            const row = btn.closest(".slot-row");
            if (row && !row.classList.contains("confirm-del")) {
                row.classList.add("confirm-del");
                btn.textContent = "\u2713";
                btn.title = "Click again to confirm delete";
                setTimeout(() => { row.classList.remove("confirm-del"); btn.innerHTML = "&times;"; btn.title = "Delete this saved run"; }, 2600);
                return;
            }
            try {
                const res = await api("/api/slots/delete", { run_id: runId });
                if (res && Array.isArray(res.slots) && res.slots.length) {
                    renderSlotsLibrary(res.slots, activeRunId);
                } else {
                    card.remove();
                }
            } catch (_) {
                setActionHint("Could not delete that run - try again.");
            }
        });
    });
}

// Restore a saved server-state into the UI so the player can continue without
// re-running world design. Sets up the game layer, party, and stage progress.
function restoreRunFromState(s) {
    if (!s) return;
    syncLatestState(s);
    const stages = savedRunStages(s);
    if (!stages.length) {
        restoreSavedCompanySetup(s);
        return;
    }

    state.company = cleanRunDisplayName(s.name) || "";
    state.pitch = s.pitch || "";
    state.url = founderSignalFromSavedState(s).url || "";
    state.org = s.org || null;
    state.stages = stages;
    state.decisions = (s.world && s.world.decisions) || [];
    const firstIncomplete = stages.findIndex((ch) => ch.status !== "completed");
    state.idx = firstIncomplete >= 0 ? firstIncomplete : stages.length;
    state.phase = state.idx >= stages.length ? "done" : "ready";

    // Replay completed stages into the company graph.
    completedStages.length = 0;
    stages.filter((ch) => ch.status === "completed")
        .forEach((ch) => completedStages.push({ title: ch.title, role: ch.owner_role }));

    // Activate the game UI.
    enterRunView();

    // Pre-fill form so a later reset works correctly.
    hydrateFounderInputsFromSavedState(s, { overwrite: true });
    if ($("begin")) $("begin").disabled = true;
    if ($("reset")) $("reset").disabled = false;

    if (s.economics) setResourcesFromEconomics(s.economics, s.org);
    else if (s.org) setResourcesFromOrg(s.org);

    setHud(s);
    setOrgPanel(s.org);
    setEconHud(s.org);
    // Restore the card/roguelike layer too (hand, party, antagonist arc, run
    // status). This is also what surfaces the run-over moment when a saved run
    // was already decided - resume must not silently drop a finished game.
    if (s.economics) state.economics = s.economics;
    if (s.game) syncGameState(s.game);
    buildProgress(stages.length);
    markProgress(state.idx);
    setParty("narrator", "run resumed");
    setSceneStatus({
        actor: "World Designer",
        speaking: "The Worldkeeper",
        source: "restored from saved state",
    });
    refreshLearned();

    const done = completedStages.length;
    setSceneHead("Resumed", `${state.company} - Stage ${done + 1} of ${stages.length}`,
        "restored from saved state");

    $("diagram").innerHTML = `<div class="world-canvas fade-scene">`
        + `<div class="founding">`
        + `<div class="kicker">Run resumed</div>`
        + `<h1>${esc(state.company)}</h1>`
        + `<p>${done} of ${stages.length} stages complete &mdash; send a move to continue.</p>`
        + resumeStageGrid(stages)
        + `</div>`
        + `</div>`;
    bindMoveTooltips($("diagram"));

    const hasNext = state.phase !== "done";
    const next = $("next"); if (next) next.disabled = !hasNext;
    updateCommandControls();
    if (!hasNext) setActionHint("Run restored - venture launched.");
    queueFooterAwareLayoutSync();
}

(async function () { await bootFromSavedRun(); })().catch(() => {});
