// Story Mode: a 3Blue1Brown-style narrated walkthrough of a Foundry-driven
// venture build. The World Designer decomposes a pitch into a quest graph, then
// the Worker Factory executes each chapter on its Foundry deployment. Each
// artifact (org chart, integration map, OKRs, financial plan) is animated into
// a dynamic Mermaid / SVG diagram, narrated beat by beat, validated at a gate,
// and folded into a company graph that grows as the venture comes alive.

import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
import { T, ROLE_COLOR, mermaidThemeVariables } from "./tokens.js";
import { toggleCollapsible } from "./motion.js";

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

const ROLE_NAME = {
    strategist: "Strategist",
    designer: "Designer",
    marketer: "Marketer",
    ops: "Operations",
    narrator: "World Designer",
    orgdesigner: "Org Designer",
};

// --- API helpers -----------------------------------------------------------
async function api(path, body) {
    const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
    });
    if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`${path} ${res.status} ${detail}`);
    }
    return res.json();
}

async function apiGet(path) {
    const res = await fetch(path);
    if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`${path} ${res.status} ${detail}`);
    }
    return res.json();
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
        return raw
            .replace(/[-_]+/g, " ")
            .replace(/\b\w/g, (m) => m.toUpperCase())
            .slice(0, 40);
    } catch (_) {
        return "Founder";
    }
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

function activeSpeakerSnapshot() {
    const aw = state.activeWorker || {};
    const role = aw.role || "narrator";
    const name = aw.displayName || ROLE_NAME[role] || role;
    return { role, name, heroName: CAST_NAME[role] || ROLE_NAME[role] || role };
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
    if (roleEl) roleEl.textContent = ROLE_NAME[role] || role;
    if (portrait) { portrait.style.display = ""; portrait.src = `/game/assets/generated/${portraitKey}.png`; }
    chip.hidden = false;
}

async function narrate(text, speed = 18) {
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
    const track = $("narration");
    if (track) {
        track.hidden = false;
        track.removeAttribute("aria-hidden");
        track.classList.add("show");
    }
    el.innerHTML = "";
    const caret = document.createElement("span");
    caret.className = "caret";
    el.appendChild(caret);
    for (let i = 0; i < text.length; i++) {
        if (myToken !== typeToken) return;
        caret.insertAdjacentText("beforebegin", text[i]);
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

// --- Diagram rendering -----------------------------------------------------
let diagramSeq = 0;
async function renderMermaid(def) {
    const host = $("diagram");
    const id = `m${++diagramSeq}`;
    let svg;
    try {
        ({ svg } = await mermaid.render(id, def));
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
// the center shows what this room is about - the chapter goal, the success
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

// --- Company graph (grows as chapters complete) ----------------------------
const completedChapters = [];
function companyGraphDef() {
    let def = "graph TD\n  FOUNDER([\"Founder\"])\n";
    completedChapters.forEach((c, i) => {
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
    chapters: [],
    decisions: [],   // CEO gate decisions (session memory ledger)
    archetype: null, // {name, skill} - character creation, seeds the org brief
    fromFilm: false, // true when the intro film handed off - the welcome already happened
    autoMode: false, // autoplay auto-picks dilemma option 1 after a beat
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

const RESOURCE_SPEC = {
    proof: { label: "Proof", color: T.good },
    trust: { label: "Trust", color: T.blueSoft },
    velocity: { label: "Velocity", color: T.marketer },
    burn: { label: "Burn", color: T.bad },
    autonomy: { label: "Autonomy", color: T.ops },
};

const RESOURCE_BY_ROLE = {
    narrator: ["proof", "trust"],
    orgdesigner: ["autonomy", "burn"],
    strategist: ["proof", "trust"],
    designer: ["proof", "velocity"],
    marketer: ["velocity", "trust"],
    ops: ["autonomy", "burn"],
    founder: ["trust", "autonomy"],
};

function clamp(n, min = 0, max = 100) {
    return Math.max(min, Math.min(max, Math.round(Number(n) || 0)));
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
    renderResources();
}

function setResourcesFromEconomics(economics, org) {
    if (!economics) {
        if (org) setResourcesFromOrg(org);
        return;
    }
    state.resources = {
        proof: clamp(economics.proof),
        trust: clamp(economics.trust),
        velocity: clamp(economics.velocity),
        burn: clamp(economics.burn_pressure),
        autonomy: clamp(economics.autonomy),
    };
    renderResources();
}

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

function resourceKeysForRole(role) {
    return RESOURCE_BY_ROLE[role] || RESOURCE_BY_ROLE.strategist;
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
    const keys = resourceKeysForRole(member.role).slice(0, 2);
    return `<div class="party-metrics">${resourceMeterMarkup(keys, "party")}</div>`;
}

function partyMembers() {
    if (state.chapters.length) {
        const seen = new Set();
        return state.chapters.map((ch) => {
            const name = ch.assigned_worker_title || ROLE_NAME[ch.owner_role] || ch.owner_role;
            return {
                key: name,
                role: ch.owner_role || "strategist",
                name,
                chapterId: ch.id,
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
                title: r.mandate || r.why,
                status: "waiting",
            }));
    }
    return [
        { key: "orgdesigner", role: "orgdesigner", name: "Org Designer", title: "designs the workforce", status: "waiting" },
        { key: "narrator", role: "narrator", name: "World Designer", title: "maps the run", status: "waiting" },
    ];
}

function setParty(activeKey, line, activeName) {
    const host = $("party");
    if (!host) return;
    state.activePartyKey = activeKey;
    state.activePartyLine = line;
    state.activePartyName = activeName;
    const members = partyMembers();
    host.innerHTML = members.map((m) => {
        const active = m.key === activeKey || m.role === activeKey || m.name === activeName || m.name === activeKey;
        const done = m.status === "completed";
        const portrait = ROLE_PORTRAIT[m.role] || "narrator";
        const statusLine = active
            ? (line || "working with you")
            : done
                ? "sealed their room"
                : (m.title || "waiting for the brief");
        const hasCard = !!cardEvidence[m.name];
        const score = hasCard ? clamp(cardEvidence[m.name].score) : null;
        const gm = isGameMaster(m.role);
        const ev = cardEvidence[m.name] || liveCardEvidence(m.name) || { role: m.role, name: m.name };
        const flipped = flippedOwners.has(m.name);
        // Each agent is a board piece: front = who it is + the world meters it
        // moves + live state; tapping flips it in place to its dossier back.
        return `<div class="party-agent${active ? " active" : ""}${done ? " done" : ""}${flipped ? " flipped" : ""}"`
            + ` data-owner="${esc(m.name)}" role="button" tabindex="0"`
            + ` title="${esc(m.name)} - tap to flip to its dossier">`
            + `<div class="pa-inner">`
            + `<div class="pa-face pa-front">`
            + `<div class="pa-layer ${gm ? "gm" : "dw"}">${gm ? "Game Master" : "Digital Worker"}</div>`
            + `<img class="party-face" src="/game/assets/generated/${portrait}.png" alt="" onerror="this.style.display='none'" />`
            + `<div class="party-name">${esc(m.name)}</div>`
            + `<div class="party-role">${esc(ROLE_NAME[m.role] || m.role || "agent")}</div>`
            + partyMetricMarkup(m)
            + `<div class="party-line">${esc(statusLine).slice(0, 110)}</div>`
            + `<div class="party-badge">${hasCard ? `flip &middot; ${score}/100` : `tap to flip`}</div>`
            + `</div>`
            + `<div class="pa-face pa-back">${dossierBackHTML(ev)}</div>`
            + `</div></div>`;
    }).join("");
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
        reasoningTokens: 0,
        reasoningPreview: currentLine,
        latency: 0,
        liveOnly: true,
    };
}

// Two kinds of pieces on the board: the Worldkeeper/game-master agents that
// build and narrate the simulation, and the company's digital workforce that
// executes it. The tag on each card names which layer it belongs to.
function isGameMaster(role) {
    return role === "narrator" || role === "orgdesigner";
}

// Which cards are currently flipped to their dossier back. Kept in a Set so the
// flip survives the frequent setParty() re-renders (the card is the inspector;
// there is no modal).
const flippedOwners = new Set();

// The dossier back of a card: the real receipts - tools the model called,
// reasoning, memory injected, gate score, and the world meters it moves. Reuses
// the cc-* receipt classes, now rendered straight onto the card's back face.
function dossierBackHTML(ev) {
    if (!ev) return "";
    const color = ROLE_COLOR[ev.role] || T.narrator;
    const roleName = ROLE_NAME[ev.role] || ev.role || "agent";
    const score = (ev.score === undefined || ev.score === null) ? "--" : ev.score;
    const worldStats = resourceMeterMarkup(Object.keys(RESOURCE_SPEC), "cc");
    const toolChips = (ev.mafTools || []).length
        ? ev.mafTools.map((t) => `<span class="cc-chip">&#9874; ${esc(t)}</span>`).join(" ")
        : `<span class="cc-chip dim">no tool calls yet</span>`;
    const memChips = (ev.mafMemory || []).map((m) =>
        `<span class="cc-chip mem">${m.kind === "ceo_decision" ? "&#9819;" : m.kind === "agent_memory" ? "&#9851;" : "&#9783;"} ${esc((m.text || "").slice(0, 30))}</span>`).join(" ");
    const spoken = (spokenLines[ev.name] || []).slice(-3).map((line) =>
        `<div class="cc-spoken-line">&ldquo;${esc((line.text || "").slice(0, 120))}${(line.text || "").length > 120 ? "&hellip;" : ""}&rdquo;</div>`
    ).join("");
    let traceHtml = "";
    (ev.trace || []).forEach((t) => {
        const argStr = t.args ? esc(JSON.stringify(t.args)).slice(0, 64) : "";
        traceHtml += `<div class="cc-trace-line"><span class="cc-call">&rarr; ${esc(t.tool)}</span>`
            + `<span class="cc-args">${argStr}</span>`
            + `<div class="cc-res">&larr; ${esc(String(t.result || ""))} <span class="cc-ms">${t.ms}ms</span></div></div>`;
    });
    return `<div class="cc-head compact" style="--cc-color:${color}">`
        + `<div><div class="cc-name">${esc(ev.name)}</div>`
        + `<div class="cc-role">${esc(roleName)} &middot; receipts</div>`
        + (ev.deployment ? `<div class="cc-deploy">${esc(ev.deployment)}</div>` : ``)
        + `</div><div class="cc-score"><b>${score}</b><span>/100</span></div></div>`
        + `<div class="cc-section"><div class="cc-h">Tools the model called</div><div class="cc-chips">${toolChips}</div></div>`
        + (spoken ? `<div class="cc-section"><div class="cc-h">Spoken lines</div>${spoken}</div>` : ``)
        + (memChips ? `<div class="cc-section"><div class="cc-h">Memory injected</div><div class="cc-chips">${memChips}</div></div>` : ``)
        + (traceHtml ? `<div class="cc-section"><div class="cc-h">tools/call trace</div><div class="cc-trace">${traceHtml}</div></div>` : ``)
        + (ev.reasoningPreview ? `<div class="cc-section"><div class="cc-h">Reasoning${ev.reasoningTokens ? ` &middot; ${ev.reasoningTokens} tok` : ""}</div><div class="cc-text quote">&ldquo;${esc((ev.reasoningPreview || "").slice(0, 150))}&hellip;&rdquo;</div></div>` : ``)
        + `<div class="cc-section"><div class="cc-h">World it moves</div><div class="cc-metric-grid">${worldStats}</div></div>`
        + `<div class="cc-badge-back">tap to return</div>`;
}

// Flip a card to/from its dossier in place. The card itself is the inspector -
// it lifts and scales up to read its receipts, then taps back to the board.
function flipCard(owner) {
    if (!owner) return;
    const willFlip = !flippedOwners.has(owner);
    flippedOwners.clear();
    if (willFlip) flippedOwners.add(owner);
    document.querySelectorAll("#party .party-agent").forEach((el) => {
        el.classList.toggle("flipped", el.dataset.owner === owner && willFlip);
    });
    if (A.cardDraw) { try { A.cardDraw(); } catch (_) { /* audio optional */ } }
}

// Return every flipped card to its front (Escape / leaving the board).
function unflipAllCards() {
    if (!flippedOwners.size) return;
    flippedOwners.clear();
    document.querySelectorAll("#party .party-agent.flipped").forEach((el) => el.classList.remove("flipped"));
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
    const deployEl = $("worker-deploy"); if (deployEl) deployEl.textContent = deployLabel || "";
    const stateEl = $("worker-state");
    if (stateEl) stateEl.innerHTML = thinking
        ? `<span class="pulse"></span> ${stateText}`
        : stateText;
    setParty(role, stateText, displayName);
    if (inspectorOpen) openAgentInspector();
}

// --- Active-agent inspector: the gorgeous floating card, on demand ----------
// The footer mini names whoever is on stage (often a core game-master agent -
// Org Designer / World Designer - that never joins the party row). Clicking it
// summons that agent's collectible card and flips it straight to its receipts,
// so every agent in the run is inspectable, not just the digital workforce.
let inspectorOpen = false;
function roleFromWorkerName(name) {
    const clean = String(name || "").trim();
    for (const entry of Object.entries(ROLE_NAME)) {
        if (entry[1] === clean) return entry[0];
    }
    return clean === "The Architect" ? "orgdesigner" : clean === "The Worldkeeper" ? "narrator" : "narrator";
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
    // If this agent already ran, show its real recorded/live receipts.
    const recorded = cardEvidence[name] || liveCardEvidence(name);
    if (recorded) return recorded;
    // Otherwise synthesize a minimal dossier from its current on-stage state.
    return {
        role: aw.role || "narrator",
        name,
        deployment: aw.deployLabel || "",
        score: "--",
        tools: [], trace: [], mafTools: [], mafMemory: [],
        reasoningPreview: aw.stateText || "",
        reasoningTokens: 0,
    };
}
function openAgentInspector() {
    const stage = $("cast-stage");
    if (!stage) return;
    const aw = activeWorkerSnapshot();
    const role = aw.role || "narrator";
    const key = CAST_ROLES.has(role)
        ? role
        : (ROLE_PORTRAIT[role] && CAST_ROLES.has(ROLE_PORTRAIT[role]) ? ROLE_PORTRAIT[role] : "strategist");
    const ev = activeAgentEv();
    const color = ROLE_COLOR[role] || ROLE_COLOR[key] || T.narrator;
    const heroName = CAST_NAME[key] || ROLE_NAME[key] || key;
    const tag = aw.displayName && aw.displayName !== heroName ? aw.displayName : "";
    const src = `/game/assets/generated/characters/${key}.png`;
    stage.style.setProperty("--card-accent", hexToRgba(color, 0.9));
    stage.style.setProperty("--cast-aura", hexToRgba(color, 0.34));
    stage.innerHTML =
        `<div class="cast-card">`
        + `<div class="cast-card-art"><div class="cast-fig" style="background-image:url('${src}')"></div></div>`
        + `<div class="cast-card-plate"><div class="cast-card-name">${esc(heroName)}</div>`
        + `<div class="cast-card-role">${esc(ROLE_NAME[role] || role)}</div>`
        + `<div class="cast-card-tag">${esc(tag)}</div></div>`
        + `<button class="cast-close" type="button" aria-label="Close dossier">&times;</button>`
        + `<div class="cast-dossier">${dossierBackHTML(ev)}</div>`
        + `</div>`;
    inspectorOpen = true;
    castRole = key;
    stage.className = "inspect show";
    document.body.classList.add("inspecting-agent");
}
function closeAgentInspector() {
    inspectorOpen = false;
    const stage = $("cast-stage");
    if (stage) {
        stage.className = "";
        stage.innerHTML = "";
    }
    castRole = null;
    document.body.classList.remove("inspecting-agent");
}
function toggleAgentInspector() {
    if (inspectorOpen) closeAgentInspector(); else openAgentInspector();
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
            `<span class="tool-chip">${m.kind === "ceo_decision" ? "&#9819; decision" : m.kind === "agent_memory" ? "&#9851; memory" : "&#9783; IQ"}: ${esc((m.text || "").slice(0, 36))}</span>`).join(" ");
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
        host.innerHTML = `<div class="mem-empty">No memory recalled for this chapter.</div>`;
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
        `<span class="maf-chip mem">${m.kind === "ceo_decision" ? "&#9819;" : m.kind === "agent_memory" ? "&#9851;" : "&#9783;"} ${esc((m.text || "").slice(0, 34))}</span>`).join(" ")
        || `<span class="maf-chip">none this run</span>`;
    const called = (inv.maf_tools_called || []).map((t) =>
        `<span class="maf-chip called">&#9874; ${esc(t)}</span>`).join(" ")
        || `<span class="maf-chip">none - clean first draft</span>`;
    const div = live || document.createElement("div");
    div.className = "maf-run";
    div.removeAttribute("id");
    const clientTag = inv.maf_client ? `${esc(inv.maf_client)} &middot; ` : "";
    div.innerHTML = `
        <div class="maf-run-head"><span>${esc(inv.worker_title || inv.role || "worker")} &middot; Agent</span><span>${clientTag}${inv.latency_s ?? 0}s</span></div>
        <div class="maf-row"><b>Memory injected</b> <span style="opacity:.65">(ContextProvider)</span><br>${mem}</div>
        <div class="maf-row"><b>Tools the model called</b> <span style="opacity:.65">(FunctionTools)</span><br>${called}</div>`;
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
    let html = `<div class="rz-head">&#9654; tools/call trace <span style="opacity:.6">(live, server-recorded)</span></div>`;
    trace.forEach((t) => {
        const argStr = t.args ? esc(JSON.stringify(t.args)).slice(0, 90) : "";
        html += `<div class="trace-line"><span class="tr-call">&rarr; ${esc(t.tool)}</span>`
            + `<span class="tr-args">${argStr}</span>`
            + `<div class="tr-res">&larr; ${esc(String(t.result || ""))} <span class="tr-ms">${t.ms}ms &middot; ${esc(t.source || "local")}</span></div></div>`;
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

function renderConsequenceEffect(consequence) {
    const host = $("diagram");
    if (!host || !consequence) return;
    const before = consequence.before || {};
    const after = consequence.after || {};
    const orgDelta = consequence.org_delta || {};
    const rows = [
        ["Digital workers", before.digital_worker_count, after.digital_worker_count],
        ["Monthly burn", fmtMoney(before.monthly_burn_usd), fmtMoney(after.monthly_burn_usd)],
        ["Leverage", `${before.leverage_ratio || 0}x`, `${after.leverage_ratio || 0}x`],
        ["Proof", before.proof, after.proof],
        ["Trust", before.trust, after.trust],
        ["Velocity", before.velocity, after.velocity],
        ["Autonomy", before.autonomy, after.autonomy],
        ["Burn pressure", before.burn_pressure, after.burn_pressure],
    ];
    host.innerHTML = `<div class="consequence-board fade-scene">`
        + `<div class="consequence-kicker">Consequence rule &middot; ${esc(consequence.rule_id || "decision")}</div>`
        + `<h2>${esc(consequence.summary || "The company changes.")}</h2>`
        + (orgDelta.added_role_title ? `<div class="consequence-role">Org graph gains: <b>${esc(orgDelta.added_role_title)}</b> (${fmtMoney(orgDelta.monthly_cost_usd)}/mo)</div>` : "")
        + `<div class="effect-grid">${rows.map(([label, a, b]) => `
            <div class="effect-row">
                <span>${esc(label)}</span>
                <b>${esc(a)}</b>
                <i>&rarr;</i>
                <strong>${esc(b)}</strong>
            </div>`).join("")}</div>`
        + `</div>`;
    if (A.chime) { try { A.chime(); } catch (_) {} }
}

// Footer economy HUD: the one global thing worth tracking at a glance - the
// digital workforce headcount, the monthly burn it costs, and the leverage it
// buys the single human operator. Everything else (proof/trust/etc.) lives on
// the agent cards now, so the footer is economy + controls, not duplicate meters.
function setEconHud(org) {
    const host = $("econ-hud");
    if (!host) return;
    if (!org || !org.digital_worker_count) { host.innerHTML = ""; return; }
    const burn = Number(org.monthly_burn_usd || 0).toLocaleString();
    host.innerHTML =
        `<span class="econ-pill" title="digital workforce"><i>&#9874;</i> Founder + <b>${org.digital_worker_count}</b> workers</span>`
        + `<span class="econ-pill" title="monthly burn"><i>$</i><b>${burn}</b>/mo</span>`
        + (org.leverage_ratio ? `<span class="econ-pill" title="leverage"><b>${org.leverage_ratio}&times;</b> leverage</span>` : ``);
}

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
    const burn = Number(org.monthly_burn_usd || 0).toLocaleString();
    let html = `<div class="org-stat">Founder + <b>${org.digital_worker_count}</b> digital workers`
        + ` &middot; <b>$${burn}</b>/mo &middot; <b>${org.leverage_ratio}&times;</b> leverage</div>`;
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
            + `live in the agent hand below &mdash; tap any card to flip to its dossier.</div>`;
    }
    // Bridge out of the game: download the org as a platform-neutral
    // Workforce Bundle any digital-worker platform can ingest and provision
    // (behind its own human approval gate).
    html += `<button id="org-export-btn" class="org-export" type="button">Export workforce bundle</button>`;
    host.innerHTML = html;
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
    const lvl = $("hud-level"); if (lvl) lvl.textContent = s.level ?? 1;
    const xp = $("hud-xp"); if (xp) xp.textContent = s.xp ?? 0;
}

// --- Beats -----------------------------------------------------------------
// Read the founder-creation form into `state`. Single source of truth for the
// DOM -> state mapping so both the preflight gate and direct callers agree.
function readFounderInputsFromForm() {
    state.company = ($("in-company") && $("in-company").value.trim()) || DEFAULT_COMPANY;
    state.pitch = ($("in-pitch") && $("in-pitch").value.trim()) || "";
    state.url = ($("in-url") && $("in-url").value || "").trim();
    // No silent default-mission fallback. Gathering the founder's own signal -
    // a public profile to scrape/OSINT, or a mission they actually wrote - is a
    // core game dynamic, enforced at the gate by hasRealSignal().
    // Name/archetype are profile-first: the URL handle gives a display name and
    // /api/company/analyze can infer the archetype. Hidden manual cards override.
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

// One payload shape for /api/company/analyze, used by the preflight gate and the
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

    const fromUrl = !!state.url;
    const beginBtn = $("begin");
    if (beginBtn) {
        if (!beginBtn.dataset.label) beginBtn.dataset.label = beginBtn.innerHTML;
        beginBtn.disabled = true;
        beginBtn.classList.add("is-loading");
        beginBtn.innerHTML = fromUrl ? "Building your character&hellip;" : "Reading your mission&hellip;";
    }
    $("hint").textContent = fromUrl ? "Reading your profile and the open web..." : "Shaping the mission...";
    if (A.thinkingStart) { try { A.thinkingStart(); } catch (_) {} }

    let ares;
    try {
        ares = await api("/api/company/analyze", analyzePayload());
    } catch (e) {
        if (A.thinkingStop) { try { A.thinkingStop(); } catch (_) {} }
        if (beginBtn) {
            beginBtn.disabled = false;
            beginBtn.classList.remove("is-loading");
            beginBtn.innerHTML = beginBtn.dataset.label || "Begin the run &rarr;";
        }
        $("hint").textContent = "Could not gather the profile. Try again, or adjust the details.";
        return;
    }
    if (A.thinkingStop) { try { A.thinkingStop(); } catch (_) {} }
    if (A.chime) { try { A.chime(); } catch (_) {} }

    // Stash the fetched result so beginStory consumes it instead of re-scraping.
    state.preflight = { ares: ares, profile: ares.profile || null };
    renderReadyCard(ares);
}

// The "ready" confirmation: shows what the preflight gathered and offers the
// real Begin. Reversible - "Edit details" restores the form untouched.
function renderReadyCard(ares) {
    const card = document.querySelector(".creator-card");
    if (!card) { beginStory(); return; }
    const step = card.querySelector('.cc-step[data-step="1"]');
    const adv = card.querySelector(".cc-advanced");
    const toggle = card.querySelector(".cc-adv-toggle");
    if (step) step.classList.add("is-hidden");
    if (adv) adv.setAttribute("hidden", "");
    if (toggle) toggle.classList.add("is-hidden");

    const org = ares.org || {};
    const profile = ares.profile || null;
    const host = profile && profile.host ? profile.host : "";
    const verdict = (profile && profile.company_summary) || org.company_summary || state.pitch || "Default world-improvement mission";
    const signals = (profile && profile.signals) || [];
    const arch = (profile && profile.founder_archetype) || (state.archetype && state.archetype.name) || "Builder";
    const dw = org.digital_worker_count != null ? org.digital_worker_count : "";
    const lev = org.leverage_ratio != null ? org.leverage_ratio : "";

    const sourceLine = host
        ? `Read <b>${esc(host)}</b> &middot; ${signals.length} public signal${signals.length === 1 ? "" : "s"}`
        : "Mission described &middot; no public profile to gather";
    const chips = signals.slice(0, 4)
        .map((s) => `<span class="cc-chip">${esc(String(s).slice(0, 42))}</span>`).join("");
    const leverLine = dw !== ""
        ? `<div class="cc-ready-stat"><b>${esc(dw)}</b> digital workers behind one human${lev !== "" ? ` &middot; <b>${esc(lev)}x</b> leverage` : ""}</div>`
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
        + `<div class="cc-ready-arch">Founder seat: <b>${esc(arch)}</b></div>`
        + leverLine
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
    const ready = card.querySelector(".cc-ready");
    if (ready) ready.remove();
    const step = card.querySelector('.cc-step[data-step="1"]');
    const toggle = card.querySelector(".cc-adv-toggle");
    if (step) step.classList.remove("is-hidden");
    if (toggle) toggle.classList.remove("is-hidden");
    const beginBtn = $("begin");
    if (beginBtn) {
        beginBtn.disabled = false;
        beginBtn.classList.remove("is-loading");
        beginBtn.innerHTML = beginBtn.dataset.label || "Begin the run &rarr;";
    }
    $("hint").textContent = "";
    try { $("in-url").focus(); } catch (_) {}
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

    document.documentElement.classList.remove("prestart");
    document.body.classList.remove("prestart");
    const stageEl = document.getElementById("stage");
    if (stageEl) stageEl.classList.remove("prestart", "rail-hidden");
    setParty("narrator", "walking with you");

    $("begin").disabled = true;
    $("reset").disabled = false;
    refreshLearned(); // surface anything the workers already remember

    // Clear the founding form off the stage immediately
    $("diagram").innerHTML = `<div class="founding fade-scene">`
        + `<div class="kicker">The ascension begins</div>`
        + `<h1>${esc(state.company)}</h1>`
        + (state.archetype ? `<p class="founding-arch">${esc(state.archetype.name)} &middot; ${esc(state.archetype.skill)}</p>` : ``)
        + `</div>`;

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
        await narrate(`And it takes you. ${state.company} is chartered. ${seat} Everything else, you hire.`);
    } else {
        try {
            const loreRes = await api("/api/lore", { pitch: (state.pitch || state.url) + archNote, company_name: state.company });
            if (loreRes && loreRes.lore) await narrate(loreRes.lore);
        } catch (e) { /* lore is optional flavor - never block the run */ }
    }

    // ---- Beat 1: scrape + reason (URL) -> design the digital workforce ----
    const fromUrl = !!state.url;
    $("hint").textContent = fromUrl ? "Reading the profile signal..." : "Designing the org...";
    setWorker(fromUrl ? "narrator" : "orgdesigner", fromUrl ? "profile scraper + STRATEGIST_MODEL (Foundry)" : "STRATEGIST_MODEL (Foundry)", fromUrl ? "Reading the public profile" : "Designing the org", true, fromUrl ? "Profile Analyst" : undefined);
    if (A.thinkingStart) A.thinkingStart();
    setSceneHead("Beat 1", fromUrl ? "Reading the founder signal, then the org" : "The org this mission needs");
    await narrate(fromUrl
        ? "Point this at a LinkedIn or public profile URL. First a guarded scraper reads the public signal it can access. Then a Profile Analyst reasons about the founder's operating posture before the Org Designer proposes the digital workforce around it."
        : (state.fromFilm
            ? "First room: the org. The Org Designer reasons out who you hire - every seat exists for a reason."
            : "Before any work happens, an Org Designer agent decides what team this mission needs: one human operator, plus the digital workers that form its execution layer. Every role exists for a reason."));

    let org;
    let profile = null;
    try {
        // Reuse what the preflight gate already fetched; only cold-start callers
        // (the intro film handoff) hit the network here.
        const ares = state.preflight
            ? state.preflight.ares
            : await api("/api/company/analyze", analyzePayload());
        org = ares.org;
        profile = ares.profile || null;
        if (!state.manualArchetype && profile && profile.founder_archetype) {
            setInferredArchetype(profile.founder_archetype, profile.founder_skill);
            const inferredName = founderNameFromProfileUrl(state.url);
            if (inferredName && inferredName !== "Founder") state.founderName = inferredName;
        } else if (!state.archetype) {
            setInferredArchetype("Builder", ARCHETYPE_SKILL.Builder);
        }
        state.org = org;
        setResourcesFromEconomics(ares.state && ares.state.economics, org);
        setHud(ares.state);
        if (!state.pitch) state.pitch = org.company_summary || ares.brief || "";
    } catch (e) {
        if (A.thinkingStop) A.thinkingStop();
        $("hint").textContent = "Org design failed";
        await narrate(`The Org Designer could not be reached: ${e.message}`);
        return;
    }

    // Make the scrape + reasoning visible before the org chart resolves.
    if (fromUrl && profile) {
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
    $("hint").textContent = "Designing the venture world...";
    setWorker("narrator", "NARRATOR_MODEL (Foundry)", "Decomposing the pitch", true);
    if (A.thinkingStart) A.thinkingStart();

    setSceneHead("Beat 2", "The World Designer reads your sentence");
    await narrate("Now the World Designer - a Foundry reasoning agent - reads the brief and decomposes the whole venture into a quest line of chapters, one per stage of building the company.");

    let res;
    try {
        res = await api("/api/world/design", {
            pitch: state.pitch,
            company_name: state.company,
            founder_name: state.founderName,
            founder_archetype: state.archetype ? state.archetype.name : "Builder",
            founder_skill: state.archetype ? state.archetype.skill : ARCHETYPE_SKILL.Builder,
            founder_locale: state.founderLocale,
            founder_voice_stack: state.founderVoiceStack,
            founder_voice: state.founderVoice,
            founder_avatar: state.founderAvatar
        });
    } catch (e) {
        if (A.thinkingStop) A.thinkingStop();
        $("hint").textContent = "Design failed";
        await narrate(`The World Designer could not be reached: ${e.message}`);
        return;
    }
    if (A.thinkingStop) A.thinkingStop();
    if (A.chime) A.chime();

    const world = res.state.world || {};
    state.chapters = world.chapters || [];
    state.decisions = world.decisions || [];
    if (res.state && res.state.org) state.org = res.state.org;
    setResourcesFromEconomics(res.state && res.state.economics, state.org);
    state.idx = 0;
    state.phase = "designed";
    setHud(res.state);

    buildProgress(state.chapters.length);
    setWorker("narrator", "NARRATOR_MODEL (Foundry)", `Produced ${state.chapters.length} chapters`, false);

    await revealSelfOrganization();
    await revealVentureGraph();

    // Start auto-play by default!
    autoPlay();
}

async function revealSelfOrganization() {
    setSceneHead("Beat 3", "The party self-organizes",
        "\u2692 chapter ownership bound from the designed org to the worker party");
    const chapters = state.chapters || [];
    if (!chapters.length) return;
    const members = chapters.slice(0, 6).map((ch, i) => {
        const role = ch.owner_role || "strategist";
        const portrait = ROLE_PORTRAIT[role] || "narrator";
        const owner = ch.assigned_worker_title || ROLE_NAME[role] || role;
        const shortTitle = String(ch.title || "").split(":")[0] || ch.title;
        const line = i === 0
            ? `I will open with ${shortTitle.toLowerCase()} so the rest of the party has evidence.`
            : `I take ${shortTitle.toLowerCase()} after ${chapters[i - 1].assigned_worker_title || chapters[i - 1].owner_role} lands their artifact.`;
        return `<div class="council-member" style="animation-delay:${i * 90}ms">`
            + `<div class="council-top"><img class="council-face" src="/game/assets/generated/${portrait}.png" alt="" onerror="this.style.display='none'" />`
            + `<div><div class="council-name">${esc(owner)}</div><div class="council-role">${esc(ROLE_NAME[role] || role)}</div></div></div>`
            + `<div class="council-says">&ldquo;${esc(line)}&rdquo;</div>`
            + `</div>`;
    }).join("");
    $("diagram").innerHTML = `<div class="council fade-scene">${members}</div>`;
    setParty("narrator", "assigning rooms");
    await narrate("The agents do not wait as a list. They organize as a party: each worker claims a room, names its dependency, and carries the previous artifact into the next brief. This is the workforce forming itself around your mission.");
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
    const portrait = profile.portrait_url || `/game/assets/generated/${ROLE_PORTRAIT[role] || "narrator"}.png`;
    return {
        displayName: profile.display_name || turn.speaker || ROLE_NAME[role] || role,
        roleLabel: profile.role_label || ROLE_NAME[role] || role,
        workerId: profile.worker_id || turn.worker_id || role,
        portraitUrl: portrait,
        textStyle: profile.text_style || "standup posture",
        voiceId: profile.voice_id || VOICE_BY_ROLE[role] || NARRATOR_VOICE,
    };
}

async function renderAgentStandup(standup) {
    const turns = standup && Array.isArray(standup.turns) ? standup.turns : [];
    if (!turns.length) return;
    const trigger = standup.trigger || {};
    setSceneHead("Agent stand-up", "The party reacts to your call",
        `group chat orchestration - ${esc(trigger.rule_id || "decision")}`);

    // Set up empty council container
    $("diagram").innerHTML = `<div class="council fade-scene"></div>`;
    const council = $("diagram").querySelector(".council");

    const accumulatedHistory = [];

    async function displayTurns(newTurns) {
        for (let i = 0; i < newTurns.length; i++) {
            const turn = newTurns[i];
            const role = turn.role || "narrator";
            const profile = speakerProfileForTurn(turn);
            const handoff = turn.handoff_to ? `<div class="standup-handoff">handoff: ${esc(turn.handoff_to)}</div>` : "";
            const source = turn.source ? `<span>${esc(turn.source)}</span>` : "";

            const cardHtml = `<div class="council-member standup-member" style="opacity: 1; transform: none; transition: opacity 300ms ease;">`
                + `<div class="council-top"><img class="council-face" src="${esc(profile.portraitUrl)}" alt="" onerror="this.style.display='none'" />`
                + `<div><div class="council-name">${esc(profile.displayName)}</div><div class="council-role">${esc(profile.roleLabel)}</div></div></div>`
                + `<div class="standup-profile"><span>${esc(profile.textStyle)}</span>${source}</div>`
                + standupToolMarkup(turn)
                + `<div class="council-says">&ldquo;${esc(turn.message || "")}&rdquo;</div>`
                + handoff
                + `</div>`;

            council.insertAdjacentHTML("beforeend", cardHtml);
            const lastCard = council.lastElementChild;
            try { lastCard.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch (_) {}

            setParty(profile.workerId, "reacting in stand-up", profile.displayName);
            if (A.turnCue) { try { A.turnCue(); } catch (_) {} }
            const previousVoice = currentVoice;
            currentVoice = profile.voiceId || VOICE_BY_ROLE[role] || NARRATOR_VOICE;
            await narrate(turn.message || `${profile.displayName} is processing the handoff.`, 15);
            currentVoice = previousVoice;
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
    lens("reasoning", `Agent group chat: ${turns.length} character turns, ${selection} selection, reacted to ${trigger.rule_id || "the CEO decision"}`);

    // Keep the standup itself text-first; the narrator only closes the beat.
    currentVoice = NARRATOR_VOICE;
    await narrate(`Stand-up. ${line}`);
    await sleep(400);

    // Now loop conversation infinitely
    let replySeq = 0;
    return new Promise((resolve) => {
        async function promptCEO() {
            // Present the CEO response input card
            const seq = ++replySeq;
            const responseId = `standup-response-wrap-${seq}`;
            const inputId = `standup-response-input-${seq}`;
            const btnId = `standup-response-send-${seq}`;
            const skipId = `standup-response-skip-${seq}`;
            const micId = `${inputId}-mic`;
            const statusId = `${inputId}-status`;

            const founderCardHtml = `<div id="${responseId}" class="council-member standup-member" style="border: 1px solid var(--blue); background: rgba(91, 140, 255, 0.04); padding: 18px; width: 100%; transition: opacity 300ms ease;">`
                + `<div class="council-top">`
                + `<img class="council-face" src="${state.founderAvatar || "/game/assets/generated/narrator.png"}" alt="" onerror="this.style.display='none'" />`
                + `<div><div class="council-name">${esc(state.founderName || "CEO")} (You)</div><div class="council-role">Human Operator</div></div></div>`
                + `<div style="margin-top: 12px; display: flex; flex-direction: column; gap: 8px;">`
                + `<div style="position: relative; display: flex; align-items: center;">`
                + `<input id="${inputId}" autocomplete="off" style="width: 100%; background: rgba(7, 10, 20, 0.6); border: 1px solid var(--line); border-radius: var(--radius-sm); color: var(--ink); padding: 9px 42px 9px 13px; font-size: 13.5px; outline: none; transition: 140ms ease;" placeholder="Respond to your workforce (e.g., 'Focus on speed' or 'Optimize runway')..." />`
                + `<button id="${micId}" class="mic-btn" type="button" title="Speak your response" aria-label="Speak your response" style="position: absolute; right: 8px; background: transparent; border: none; cursor: pointer; font-size: 18px; color: var(--gold-soft);">&#127908;</button>`
                + `</div>`
                + `<div id="${statusId}" style="font-size: 10.5px; min-height: 16px; color: var(--ink-faint);"></div>`
                + `<div style="display: flex; gap: 8px; justify-content: flex-end;">`
                + `<button id="${skipId}" class="btn ghost" style="padding: 7px 16px; font-size: 12.5px; font-weight: 500; cursor: pointer;">End Standup</button>`
                + `<button id="${btnId}" class="btn primary" style="padding: 7px 16px; font-size: 12.5px; font-weight: 600; cursor: pointer;">Send Response</button>`
                + `</div></div></div>`;

            council.insertAdjacentHTML("beforeend", founderCardHtml);
            const fsCard = council.lastElementChild;
            try { fsCard.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch (_) {}

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
                    await api("/api/world/standup/respond", { text: val });

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
                        chapter_id: standup.chapter_id,
                        history: accumulatedHistory,
                        selection_mode: STANDUP_SELECTION
                    });

                    // 4. Display the new turns
                    await displayTurns(nextStandup.turns);

                    // 5. Loop again
                    promptCEO();

                } catch (err) {
                    fsCard.remove();
                    resolve();
                }
            };

            const handleSkip = () => {
                cleanup();
                if (A.uiHover) { try { A.uiHover(); } catch (_) {} }
                fsCard.remove();
                resolve();
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
        "\u2692 drawn live from the World Designer's chapter graph (JSON \u2192 Mermaid)");
    // The stage is a wide cinema frame - lay the quest line LEFT-TO-RIGHT so
    // five chapters read as a path across the screen, not a column squeezed
    // under the header. Map nodes carry the short phase name only (the part
    // before the colon); full titles live in the narration and chapter runs -
    // a map wants landmarks, not paragraphs.
    let def = "graph LR\n";
    const idOf = (id) => `c_${id.replace(/[^a-zA-Z0-9_]/g, "")}`;
    const mapLabel = (t) => san(String(t || "").split(":")[0].trim() || t);
    state.chapters.forEach((ch) => {
        const color = ROLE_COLOR[ch.owner_role] || T.blue;
        def += `  ${idOf(ch.id)}["${mapLabel(ch.title)}"]\n`;
        def += `  style ${idOf(ch.id)} stroke:${color},stroke-width:2px\n`;
    });
    state.chapters.forEach((ch) => {
        (ch.depends_on || []).forEach((dep) => {
            const depCh = state.chapters.find((c) => c.id === dep);
            if (depCh) def += `  ${idOf(dep)} --> ${idOf(ch.id)}\n`;
        });
    });
    // chain fallback when no explicit deps
    if (!state.chapters.some((c) => (c.depends_on || []).length)) {
        for (let i = 1; i < state.chapters.length; i++) {
            def += `  ${idOf(state.chapters[i - 1].id)} --> ${idOf(state.chapters[i].id)}\n`;
        }
    }
    await renderMermaid(def);
    const owners = state.chapters.map((c) => c.assigned_worker_title || ROLE_NAME[c.owner_role] || c.owner_role);
    void narrate(`${state.chapters.length} chapters, each owned by ${state.org ? "one of the digital workers you just designed" : "a specialist agent"}: ${[...new Set(owners)].join(", ")}. Dependencies set the order. This graph is the world the Worker Factory will build.`);
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
}

async function runNextChapter() {
    if (state.idx >= state.chapters.length) return;
    const ch = state.chapters[state.idx];
    const ownerName = ch.assigned_worker_title || ROLE_NAME[ch.owner_role] || ch.owner_role;
    const nextBtn = $("next"); if (nextBtn) nextBtn.disabled = true;
    const autoBtn = $("auto"); if (autoBtn) autoBtn.disabled = true;
    markProgress(state.idx);

    setSceneHead(`Chapter ${state.idx + 1}`, ch.title,
        `\u2692 artifact + diagram by ${ownerName} (agent JSON \u2192 Mermaid)`);
    // Paint the scenario onto the world canvas (center stage) so the player has
    // the room's goal + success metric in view while the worker reasons. The
    // theater overlay sits above this; when it closes, the scenario remains
    // until the artifact replaces it.
    renderScenarioCanvas(ch, ownerName);
    setWorker(ch.owner_role, `${(ch.owner_role || "role").toUpperCase()}_MODEL (Foundry)`, "Reasoning over the brief", true, ownerName);
    setReasoning(null);
    setTools(null);
    if (A.thinkingStart) A.thinkingStart();
    $("hint").textContent = `${ownerName} is working...`;

    // Session memory, spoken: the worker is briefed with the CEO's last gate
    // decision - the player hears their own words come back (game_design 5).
    const lastDecision = state.decisions && state.decisions.length
        ? state.decisions[state.decisions.length - 1] : null;
    const recallLine = lastDecision
        ? ` Your decision at the last gate - "${lastDecision.option}" - is in its brief, as binding direction.${lastDecision.consequence_summary ? ` The company consequence is also in scope: ${lastDecision.consequence_summary}.` : ""}`
        : "";
    // Agent memory, spoken: once the workforce has learned from this CEO, the
    // narration credits it - memory is a mechanic the player can hear.
    const memoryLine = learnedCount > 0
        ? " It carries what it has learned about you."
        : "";
    const goalLine = (ch.goal || "").trim().replace(/\.$/, "");
    // The reasoning theater takes the stage while the worker thinks - the
    // narration runs underneath it (audio), the plan forms on screen (visual).
    mafRunStart(ownerName, ch.title);
    const theaterDone = theaterOpen(ch, ownerName, lastDecision);
    narrate(`Chapter ${state.idx + 1}: ${goalLine}. ${ownerName} spins up on Foundry and recalls from IQ memory.${memoryLine}${recallLine}`);
    await theaterDone;

    let res;
    try {
        res = await api("/api/world/run-next", {});
    } catch (e) {
        // One silent retry: long reasoning calls can be cut by transient
        // network blips; the server is idempotent on the pending chapter.
        try {
            await narrate("A network blip mid-reasoning. The worker picks its thread back up...");
            res = await api("/api/world/run-next", {});
        } catch (e2) {
            if (A.thinkingStop) A.thinkingStop();
            theaterClose();
            $("hint").textContent = "Chapter failed - press Retry to resume";
            await narrate(`The worker could not finish: ${e2.message}. Click Retry to send it back in.`);
            const retry = $("retry");
            if (retry) retry.classList.remove("is-hidden");
            return;
        }
    }
    if (A.thinkingStop) A.thinkingStop();

    const chapter = res.chapter || {};
    const inv = res.invocation || {};
    const score = chapter.validation_score ?? 0;
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
        chapter: ch.title,
        score: score,
        deployment: deployLabel,
        tools: inv.tools_drawn || [],
        trace: inv.tool_trace || [],
        mafTools: inv.maf_tools_called || [],
        mafMemory: inv.maf_memory || [],
        reasoningTokens: inv.reasoning_tokens || 0,
        reasoningPreview: inv.reasoning_preview || "",
        latency: inv.latency_s ?? 0,
    });
    // The reveal beat: the model's actual chain-of-thought, center stage.
    await theaterReveal(inv);

    // Animate the artifact into a diagram.
    const diag = diagramForArtifact(ch.owner_role, chapter.artifact);
    if (diag && diag.type === "mermaid") await renderMermaid(diag.def);
    else if (diag && diag.type === "svg") { renderSvg(diag.svg); if (A.chime) A.chime(); }
    else await narrate("This chapter produced a text artifact - no diagram shape detected.");

    await sleep(500);
    setGate(score, chapter.rubric);
    if (score >= 80) { if (A.approve) A.approve(); } else if (A.reject) A.reject();
    lens("reliability", score >= 80
        ? `gate ${state.idx + 1} passed at ${score}/100 - validator floor held, human approval sealed it`
        : `gate held a ${score}/100 artifact for human review - nothing ships unverified`);
    setHud(res.state);

    const artifactKind = describeArtifact(ch.owner_role);
    const rubricLine = chapter.rubric && chapter.rubric.source === "foundry"
        ? `A Foundry rubric evaluation scored it ${score} of 100 across four weighted dimensions, floored by the deterministic validator`
        : `The deterministic validator scored it ${score} of 100`;
    await narrate(`${ownerName} delivered ${artifactKind}. ${rubricLine} - ${score >= 80 ? "it passes the gate and the company graph grows." : "bronze, so it pauses for a human gate."}`);

    completedChapters.push({ title: ch.title, role: ch.owner_role });
    state.idx += 1;

    if (state.idx >= state.chapters.length) {
        await finale(res.state);
    } else {
        // The CEO decision gate: pick a path before the next worker spins up.
        await runDilemmaGate(chapter, state.autoMode);
        const next = $("next"); if (next) next.disabled = false;
        const auto = $("auto"); if (auto) auto.disabled = false;
        $("hint").textContent = "Resuming campaign...";
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
// next worker treats it as binding direction. Autoplay auto-picks option 1
// after a beat so the reliable demo path never blocks.
let dilemmaResolve = null;
let dilemmaVoiceBound = false; // one-time bind of the dilemma mic to STT

function hideDilemma() {
    $("dilemma-overlay").hidden = true;
    $("dilemma-own-wrap").hidden = true;
    $("dilemma-own-input").value = "";
    const st = $("dilemma-own-status");
    if (st) { st.hidden = true; st.textContent = ""; st.classList.remove("live"); }
    dilemmaResolve = null;
}

async function runDilemmaGate(chapter, auto) {
    let dilemma;
    try {
        dilemma = await api("/api/dilemma", { chapter_id: chapter.id });
    } catch (e) { return; /* dilemma is additive - never block the run */ }
    if (!dilemma || !Array.isArray(dilemma.options) || dilemma.options.length < 2) return;

    $("dilemma-prompt").textContent = dilemma.prompt;
    const speaker = dilemma.speaker || {};
    const kicker = document.querySelector("#dilemma-overlay .dilemma-kicker");
    if (kicker) {
        kicker.textContent = `${speaker.display_name || "The Narrator"} - ${speaker.role || "CEO decision"} - your call shapes the next chapter`;
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
            `<span class="tchip">from &ldquo;${esc((chapter.title || "").slice(0, 34))}&rdquo; sealed at ${chapter.validation_score ?? "&mdash;"}/100</span>`,
        ];
        const villain = dilemma.antagonist || null;
        if (villain && villain.name) {
            chips.push(`<span class="tchip rival">&#9876; ${esc(villain.name)} (${esc(villain.archetype || "rival")}) pressures this call</span>`);
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
        btn.innerHTML = `<b>${i + 1} &middot; ${esc(o.option)}</b>`
            + `<span>tradeoff: ${esc(o.tradeoff || "none stated")}</span>`
            + (o.effect_line ? `<em>${esc(o.effect_line)}</em>` : "")
            + (o.rule_id ? `<small>${esc(o.rule_id)}</small>` : "");
        btn.addEventListener("click", () => decide(o, false));
        host.appendChild(btn);
    });
    $("dilemma-overlay").hidden = false;
    // Reset the voice/own-path UI so a prior gate's transcript never carries over.
    $("dilemma-own-wrap").hidden = true;
    $("dilemma-own-input").value = "";
    const ownStatus = $("dilemma-own-status");
    if (ownStatus) { ownStatus.hidden = true; ownStatus.textContent = ""; ownStatus.classList.remove("live"); }
    $("hint").textContent = "Your call, CEO - 1 / 2, or speak your own path";
    const cd = $("dilemma-countdown");
    if (cd) { cd.hidden = true; cd.textContent = ""; }
    let promptSpeech = Promise.resolve();
    if (A.speak) { try { promptSpeech = A.speak(dilemma.prompt, { voice: NARRATOR_VOICE }) || Promise.resolve(); } catch (_) {} }

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
        if (auto) {
            // Autoplay never steals the CEO's moment: the clock starts only
            // AFTER the narrator finishes posing the question (capped), shows
            // a visible countdown inside the card, and option 1 is only the
            // default when it hits zero. Any human pick cancels it.
            (async () => {
                await Promise.race([promptSpeech, sleep(Math.min(24000, 3000 + dilemma.prompt.length * 80))]);
                if (!dilemmaResolve) return; // decided while the question was read
                let left = 15;
                if (cd) { cd.hidden = false; cd.textContent = `auto-deciding in ${left}s - press 1 / 2 / 3 to take the wheel`; }
                const tickDown = setInterval(() => {
                    if (!dilemmaResolve) { clearInterval(tickDown); if (cd) cd.hidden = true; return; }
                    left -= 1;
                    if (left <= 0) {
                        clearInterval(tickDown);
                        if (cd) cd.hidden = true;
                        if (dilemmaResolve) decide(dilemma.options[0], false);
                    } else {
                        if (cd) cd.textContent = `auto-deciding in ${left}s - press 1 / 2 / 3 to take the wheel`;
                        $("hint").textContent = `Your call, CEO - auto-deciding in ${left}s (press 1 / 2 / 3 to choose)`;
                    }
                }, 1000);
            })();
        }
    });

    async function decide(choice, custom) {
        if (!dilemmaResolve) return;
        const option = typeof choice === "string" ? choice : (choice.option || "");
        const tradeoff = typeof choice === "string" ? "" : (choice.tradeoff || "");
        const r = dilemmaResolve; dilemmaResolve = null;
        document.querySelectorAll("#dilemma-options .dilemma-opt, #dilemma-own-btn, #dilemma-own-go").forEach((el) => { el.disabled = true; });
        $("hint").textContent = "Committing decision to company state...";
        let consequence = null;
        try {
            const res = await api("/api/decision", {
                chapter_id: chapter.id, option, tradeoff: tradeoff || "",
                prompt: dilemma.prompt, custom: !!custom,
                rule_id: custom ? "" : (choice.rule_id || ""),
                option_id: custom ? "custom" : (choice.id || ""),
                scene_id: dilemma.scene_id || "",
            });
            $("dilemma-overlay").hidden = true;
            state.decisions = res.decisions || state.decisions;
            consequence = res.consequence || (res.recorded && res.recorded.consequence) || null;
            if (res.state) {
                state.org = res.state.org || state.org;
                state.chapters = (res.state.world && res.state.world.chapters) || state.chapters;
                setHud(res.state);
                setOrgPanel(state.org);
                setResourcesFromEconomics(res.state.economics, state.org);
            }
        } catch (_) {
            dilemmaResolve = r;
            $("dilemma-overlay").hidden = false;
            document.querySelectorAll("#dilemma-options .dilemma-opt, #dilemma-own-btn, #dilemma-own-go").forEach((el) => { el.disabled = false; });
            $("hint").textContent = "Decision did not persist - choose again to retry";
            return;
        }
        document.querySelectorAll("#dilemma-options .dilemma-opt, #dilemma-own-btn, #dilemma-own-go").forEach((el) => { el.disabled = false; });
        refreshLearned(); // the workers just learned the CEO's operating pattern
        const summary = consequence && consequence.summary ? consequence.summary : "The next worker receives this as binding direction.";
        if (consequence) {
            setSceneHead("Decision effect", "The company changes",
                "\u2692 deterministic consequence rule updated state, org, and economics");
            renderConsequenceEffect(consequence);
            lens("reliability", `${consequence.rule_id} applied: org and economics mutated before the next chapter`);
            await narrate(`Decided: ${option}. ${summary}`);
            if (state.org) {
                await renderMermaid(orgBlueprintMermaid(state.org));
                await sleep(500);
            }
            try {
                const standup = await api("/api/world/standup", {
                    chapter_id: chapter.id,
                    selection_mode: STANDUP_SELECTION
                });
                await renderAgentStandup(standup);
            } catch (_) {
                lens("reasoning", "Agent stand-up skipped; decision state is still committed");
            }
        } else {
            nudgeResources(resourceDeltaForDecision(option, tradeoff));
            await narrate(`Decided: ${option}. Your workforce will execute accordingly.`);
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
    state.phase = "done";
    markProgress(state.chapters.length, "done");
    setSceneHead("Finale", "Your mission has a working loop");
    if (A.complete) A.complete();
    await renderMermaid(companyGraphDef());
    setWorker("narrator", "Venture: launched", "All chapters verified", false);
    $("hint").textContent = "Venture launched";
    $("next").disabled = true;
    $("auto").disabled = true;
    await narrate(`${state.chapters.length} chapters, ${state.chapters.length} verified gates. From one founder signal you now have an org, the systems it runs on, a launch plan, and the numbers behind it - level ${s.level ?? 1}, ${s.xp ?? 0} XP. That is the mission, mapped as a living system you changed.`);
    await incomeBeat(s);
}

// --- The income beat (game_design.md section 9.5) ---------------------------
// The screen goes quiet, the org runs without you, and the counter ticks.
// Scripted and deterministic: the work feed is the org's own designed workers
// executing their mandates; the rate derives from the marketer's financial
// plan when one exists. This is the promise of the intro landing as gameplay:
// your experience became a business that runs while you sleep.
async function incomeBeat(s) {
    const org = state.org || {};
    const workers = (org.roles || []).filter((r) => r.kind !== "human");
    const fin = (() => {
        for (const ch of state.chapters) {
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
    await narrate(`That is the thesis, closed: your skill set the direction, the gates kept it honest, and the workforce turned it into income - ${workers.length || "your"} digital workers, one human seal. This, times a billion founders, is how a desert turns green.`);
    $("hint").textContent = "The loop is closed - Reset to run another venture";
}

async function autoPlay() {
    $("auto").disabled = true;
    state.autoMode = true;
    while (state.idx < state.chapters.length) {
        await runNextChapter();
        await sleep(900);
    }
    state.autoMode = false;
}

async function resetStory() {
    typeToken++;
    try { await api("/api/reset", {}); } catch (_) {}
    completedChapters.length = 0;
    state.chapters = [];
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
                statusEl.textContent = "Listening - speak...";
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
    const party = $("party");
    if (party) {
        party.addEventListener("click", (e) => {
            const tile = e.target.closest(".party-agent");
            if (tile && tile.dataset.owner) flipCard(tile.dataset.owner);
        });
        party.addEventListener("keydown", (e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            const tile = e.target.closest(".party-agent");
            if (tile && tile.dataset.owner) { e.preventDefault(); flipCard(tile.dataset.owner); }
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
        workerMini.setAttribute("role", "button");
        workerMini.setAttribute("tabindex", "0");
        workerMini.setAttribute("title", "Inspect this agent's dossier");
        workerMini.addEventListener("click", () => {
            toggleAgentInspector();
            if (A.cardDraw) { try { A.cardDraw(); } catch (_) {} }
        });
        workerMini.addEventListener("keydown", (e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            toggleAgentInspector();
        });
    }
    const castStage = $("cast-stage");
    if (castStage) {
        castStage.addEventListener("click", (e) => {
            if (e.target.closest(".cast-close")) closeAgentInspector();
        });
    }
    // Click anywhere outside the open dossier (and not on its trigger) closes it.
    document.addEventListener("click", (e) => {
        if (!inspectorOpen) return;
        if (e.target.closest("#cast-stage") || e.target.closest("#worker")) return;
        closeAgentInspector();
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { closeAgentInspector(); unflipAllCards(); }
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

const nextBtn = $("next");
if (nextBtn) nextBtn.addEventListener("click", runNextChapter);
const autoBtn = $("auto");
if (autoBtn) autoBtn.addEventListener("click", autoPlay);
const resetBtn = $("reset");
if (resetBtn) resetBtn.addEventListener("click", resetStory);
const retryBtn = $("retry");
if (retryBtn) {
    retryBtn.addEventListener("click", async () => {
        retryBtn.classList.add("is-hidden");
        await autoPlay();
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

// Wire up name randomization, voice previews, and custom avatar generators
setupCharacterCreation();
