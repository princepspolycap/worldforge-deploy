// Story Mode: a 3Blue1Brown-style narrated walkthrough of a Foundry-driven
// venture build. The World Designer decomposes a pitch into a quest graph, then
// the Worker Factory executes each chapter on its Foundry deployment. Each
// artifact (org chart, integration map, OKRs, financial plan) is animated into
// a dynamic Mermaid / SVG diagram, narrated beat by beat, validated at a gate,
// and folded into a company graph that grows as the venture comes alive.

import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";

mermaid.initialize({
    startOnLoad: false,
    theme: "base",
    securityLevel: "loose",
    htmlLabels: false,
    fontFamily: "Inter, sans-serif",
    themeVariables: {
        background: "transparent",
        primaryColor: "#16233f",
        primaryBorderColor: "#3a4a72",
        primaryTextColor: "#eaf0ff",
        lineColor: "#4a5f8f",
        secondaryColor: "#16203a",
        tertiaryColor: "#0e1626",
        fontSize: "16px",
    },
    flowchart: { curve: "basis", padding: 22, nodeSpacing: 52, rankSpacing: 66, useMaxWidth: false, htmlLabels: false },
});

const A = window.DungeonAudio || {};
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ROLE_COLOR = {
    strategist: "#5b8cff",
    designer: "#c084fc",
    marketer: "#f59e0b",
    ops: "#2dd4bf",
    narrator: "#94a3b8",
    orgdesigner: "#c084fc",
};
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
const NARRATOR_VOICE = "onyx";
let currentVoice = NARRATOR_VOICE;

let typeToken = 0;
async function narrate(text, speed = 18) {
    const el = $("narration-text");
    const myToken = ++typeToken;
    // Speak the beat aloud in the active worker's voice (real Azure neural TTS,
    // browser TTS fallback). This also fills the air during slow live Foundry
    // calls, so latency reads as "the agent is thinking" rather than dead time.
    if (A.speak) { try { A.speak(text, { voice: currentVoice }); } catch (e) { /* narration optional */ } }
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
        host.innerHTML = `<div style="color:#fb7185;font-family:monospace;font-size:12px">diagram error: ${e.message}</div>`;
        return;
    }
    const wrap = document.createElement("div");
    wrap.className = "draw fade-scene";
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

function setSceneHead(beat, title) {
    $("scene-beat").textContent = beat;
    $("scene-title").textContent = title;
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
        bars += `<rect x="${x}" y="${H - pad}" width="${bw - 12}" height="0" rx="4" fill="${isBE ? "#34d399" : "#f59e0b"}">
            <animate attributeName="height" from="0" to="${h}" dur="0.8s" begin="${i * 0.12}s" fill="freeze" calcMode="spline" keySplines="0.2 0.7 0.2 1"/>
            <animate attributeName="y" from="${H - pad}" to="${y}" dur="0.8s" begin="${i * 0.12}s" fill="freeze" calcMode="spline" keySplines="0.2 0.7 0.2 1"/>
        </rect>`;
        bars += `<text x="${x + (bw - 12) / 2}" y="${H - pad + 18}" fill="#9aa6c0" font-size="11" font-family="JetBrains Mono, monospace" text-anchor="middle">M${i + 1}</text>`;
        bars += `<text x="${x + (bw - 12) / 2}" y="${y - 8}" fill="#e8ecf6" font-size="11" font-family="JetBrains Mono, monospace" text-anchor="middle" opacity="0">$${(v / 1000).toFixed(1)}k<animate attributeName="opacity" from="0" to="1" dur="0.4s" begin="${i * 0.12 + 0.6}s" fill="freeze"/></text>`;
    });
    const burn = fin.burn_usd_per_month || fin.burn;
    const burnY = burn ? H - pad - ((H - pad * 2) * burn) / max : null;
    let burnLine = "";
    if (burnY != null) {
        burnLine = `<line x1="${pad}" y1="${burnY}" x2="${W - pad}" y2="${burnY}" stroke="#fb7185" stroke-width="1.5" stroke-dasharray="5 5" opacity="0"><animate attributeName="opacity" from="0" to="0.8" dur="0.5s" begin="1s" fill="freeze"/></line>
        <text x="${W - pad}" y="${burnY - 6}" fill="#fb7185" font-size="10" font-family="JetBrains Mono, monospace" text-anchor="end" opacity="0">burn $${(burn / 1000).toFixed(1)}k/mo<animate attributeName="opacity" from="0" to="1" dur="0.5s" begin="1.1s" fill="freeze"/></text>`;
    }
    return `<svg viewBox="0 0 ${W} ${H}" style="max-width:620px;width:100%">
        <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="#1d2740" stroke-width="1"/>
        <text x="${pad}" y="${pad - 14}" fill="#9aa6c0" font-size="12" font-family="Fraunces, serif">MRR ramp - months 1 to ${vals.length}</text>
        ${bars}${burnLine}
    </svg>`;
}

function renderSvg(svgString) {
    const host = $("diagram");
    const wrap = document.createElement("div");
    wrap.className = "fade-scene";
    wrap.style.width = "100%";
    wrap.style.display = "flex";
    wrap.style.justifyContent = "center";
    wrap.innerHTML = svgString;
    host.innerHTML = "";
    host.appendChild(wrap);
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
        const color = ROLE_COLOR[c.role] || "#5b8cff";
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
};

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

function setWorker(role, deployLabel, stateText, thinking, displayName) {
    // Switch the narration voice to this worker's so each character sounds
    // distinct. Unknown roles keep the narrator voice.
    currentVoice = VOICE_BY_ROLE[role] || NARRATOR_VOICE;
    $("worker-name").textContent = displayName || ROLE_NAME[role] || role;
    const orb = document.querySelector(".role-orb");
    if (orb) orb.style.color = ROLE_COLOR[role] || "#94a3b8";
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
    $("worker-deploy").textContent = deployLabel || "";
    $("worker-state").innerHTML = thinking
        ? `<span class="pulse"></span> ${stateText}`
        : stateText;
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
    if (!tokens && !preview) { el.hidden = true; el.innerHTML = ""; return; }
    let html = `<div class="rz-head">&#9670; Reasoning`;
    if (tokens) html += ` <span class="rz-tokens">${tokens} thinking tokens</span>`;
    html += `</div>`;
    if (preview) html += `<div class="rz-text">&ldquo;${esc(preview)}&hellip;&rdquo;</div>`;
    el.innerHTML = html;
    el.hidden = false;
}

function setMemory(hits) {
    const host = $("memory");
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

// Escape LLM-supplied text before injecting into the rail as HTML.
function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
}

// Dynamic org blueprint -> Mermaid org chart. The human operator is the root;
// digital workers (the execution layer) hang beneath, colored by kind.
function orgBlueprintMermaid(org) {
    if (!org || !Array.isArray(org.roles) || org.roles.length === 0) {
        return 'graph TD\n  X["No org designed"]';
    }
    const nid = (id) => `n_${String(id).replace(/[^a-zA-Z0-9_]/g, "")}`;
    const kindColor = (k) => (k === "human" ? "#5b8cff" : k === "hybrid" ? "#c084fc" : "#2dd4bf");
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

// Populate the persistent "Digital Workforce" rail: stats + operating model +
// the educational per-role rationale.
function setOrgPanel(org) {
    const host = $("org-panel");
    if (!org || !Array.isArray(org.roles)) {
        host.innerHTML = `<div class="mem-empty">No org designed yet.</div>`;
        return;
    }
    const burn = Number(org.monthly_burn_usd || 0).toLocaleString();
    let html = `<div class="org-stat">Founder + <b>${org.digital_worker_count}</b> digital workers`
        + ` &middot; <b>$${burn}</b>/mo &middot; <b>${org.leverage_ratio}&times;</b> leverage</div>`;
    if (org.operating_model) html += `<div class="org-model">${esc(org.operating_model)}</div>`;
    org.roles.forEach((r) => {
        const c = r.kind === "human" ? "var(--strategist)" : r.kind === "hybrid" ? "var(--designer)" : "var(--ops)";
        const kindLabel = r.kind === "digital_worker" ? "digital" : r.kind;
        html += `<div class="org-role"><span class="org-orb" style="background:${c}"></span>`
            + `<b>${esc(r.title)}</b><span class="org-kind">${esc(kindLabel)}</span>`
            + `<div class="org-why">${esc(r.why || r.mandate)}</div></div>`;
    });
    host.innerHTML = html;
}

function setGate(score, rubric) {
    $("score").textContent = score;
    $("score-fill").style.width = `${Math.min(100, score)}%`;
    const pass = score >= 80;
    const v = $("verdict");
    v.className = `gate-verdict ${pass ? "pass" : "review"}`;
    v.textContent = pass ? "PASS - artifact verified, XP awarded" : "REVIEW - bronze, founder gate required";

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
    $("hud-level").textContent = s.level ?? 1;
    $("hud-xp").textContent = s.xp ?? 0;
}

// --- Beats -----------------------------------------------------------------
async function beginStory() {
    if (A.unlock) A.unlock();
    state.company = $("in-company").value.trim() || "QuestForge Ltd.";
    state.pitch = $("in-pitch").value.trim();
    state.url = ($("in-url").value || "").trim();
    if (!state.pitch && !state.url) { $("hint").textContent = "Enter a pitch or a company URL first"; return; }
    if (state.phase !== "title") return; // already descending
    state.phase = "founding";

    $("begin").disabled = true;
    $("reset").disabled = false;

    // Clear the founding form off the stage immediately - the form is the
    // door, not the room. From here the scene belongs to the narration and
    // the artifacts (this is what kept the title page and the game looking
    // like the same screen).
    $("diagram").innerHTML = `<div class="founding fade-scene">`
        + `<div class="kicker">The descent begins</div>`
        + `<h1>${esc(state.company)}</h1>`
        + (state.archetype ? `<p class="founding-arch">${esc(state.archetype.name)} &middot; ${esc(state.archetype.skill)}</p>` : ``)
        + `</div>`;

    // ---- Beat 0: the welcome ----
    // Two doors into the dungeon, one thread of narration:
    //   from the film  -> the film WAS the welcome. Its last line is "the
    //                     dungeon takes all comers" - so the game answers it
    //                     in one breath and descends. No second cosmology.
    //   cold start     -> a personalized, LLM-narrated welcome to THIS venture
    //                     (the player skipped the film, so the lore runs here).
    setSceneHead("Your quest", state.company || "A new venture");
    // The founder's archetype rides into the brief: their skill becomes the
    // human lane of the org, and the lore speaks it back to them.
    const archNote = state.archetype
        ? ` The founder is a ${state.archetype.name}: their own skill is ${state.archetype.skill}. Design the org so the human operator covers exactly that, and digital workers cover the rest.`
        : "";
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
    $("hint").textContent = fromUrl ? "Reading the company URL..." : "Designing the org...";
    setWorker(fromUrl ? "narrator" : "orgdesigner", fromUrl ? "scraper + STRATEGIST_MODEL (Foundry)" : "STRATEGIST_MODEL (Foundry)", fromUrl ? "Scraping the homepage" : "Designing the org", true, fromUrl ? "Company Analyst" : undefined);
    if (A.thinkingStart) A.thinkingStart();
    setSceneHead("Beat 1", fromUrl ? "Reading the company, then its org" : "The org this company needs");
    await narrate(fromUrl
        ? "Point this at any company URL. First a scraper reads the homepage - title, tagline, the sections it leads with. Then a Company Analyst agent reasons about what the business actually is, before the Org Designer proposes the team to run it."
        : (state.fromFilm
            ? "First room: the org. The Org Designer reasons out who you hire - every seat exists for a reason."
            : "Before any work happens, an Org Designer agent decides what team this company needs: one human operator, plus the digital workers that form its execution layer. Every role exists for a reason."));

    let org;
    let profile = null;
    try {
        const ares = await api("/api/company/analyze", { pitch: state.pitch + archNote, url: state.url, company_name: state.company });
        org = ares.org;
        profile = ares.profile || null;
        state.org = org;
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
        await narrate(`Scraped ${profile.host}${profile.scraped ? "" : " (unreachable - using a sensible default)"}. The Company Analyst reads it as: ${profile.company_summary} It sells ${profile.what_they_sell} to ${profile.target_customer}. Model: ${profile.business_model}.`);
    }

    if (A.thinkingStop) A.thinkingStop();
    if (A.chime) A.chime();

    setOrgPanel(org);
    setWorker("orgdesigner", "STRATEGIST_MODEL (Foundry)", `Org chartered: ${org.headcount} seats`, false);
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
        res = await api("/api/world/design", { pitch: state.pitch, company_name: state.company });
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
    state.idx = 0;
    state.phase = "designed";
    setHud(res.state);

    buildProgress(state.chapters.length);
    setWorker("narrator", "NARRATOR_MODEL (Foundry)", `Produced ${state.chapters.length} chapters`, false);

    await revealVentureGraph();

    $("next").disabled = false;
    $("auto").disabled = false;
    $("hint").textContent = "Press Next to run the first chapter";
}

async function revealVentureGraph() {
    setSceneHead("Beat 3", "The venture, decomposed");
    let def = "graph TD\n";
    const idOf = (id) => `c_${id.replace(/[^a-zA-Z0-9_]/g, "")}`;
    state.chapters.forEach((ch) => {
        const color = ROLE_COLOR[ch.owner_role] || "#5b8cff";
        def += `  ${idOf(ch.id)}["${san(ch.title)}"]\n`;
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
    await narrate(`${state.chapters.length} chapters, each owned by ${state.org ? "one of the digital workers you just designed" : "a specialist agent"}: ${[...new Set(owners)].join(", ")}. Dependencies set the order. This graph is the world the Worker Factory will build.`);
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
    $("next").disabled = true;
    $("auto").disabled = true;
    markProgress(state.idx);

    setSceneHead(`Chapter ${state.idx + 1}`, ch.title);
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
        ? ` Your decision at the last gate - "${lastDecision.option}" - is in its brief, as binding direction.`
        : "";
    const goalLine = (ch.goal || "").trim().replace(/\.$/, "");
    // The reasoning theater takes the stage while the worker thinks - the
    // narration runs underneath it (audio), the plan forms on screen (visual).
    const theaterDone = theaterOpen(ch, ownerName, lastDecision);
    narrate(`Chapter ${state.idx + 1}: ${goalLine}. ${ownerName}${ch.assigned_worker_title ? ", a digital worker the Org Designer created," : " agent"} spins up on its Foundry deployment and recalls relevant playbooks from Foundry IQ memory.${recallLine}`);
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
            $("hint").textContent = "Chapter failed - press Next to retry";
            await narrate(`The worker could not finish: ${e2.message}. Press Next to send it back in.`);
            $("next").disabled = false;
            return;
        }
    }
    if (A.thinkingStop) A.thinkingStop();

    const chapter = res.chapter || {};
    const inv = res.invocation || {};
    const score = chapter.validation_score ?? 0;
    if (res.state && res.state.world) state.decisions = res.state.world.decisions || state.decisions;
    setMemory(res.memory);
    setWorker(ch.owner_role, inv.deployment || "simulation", `Done in ${inv.latency_s ?? 0}s`, false, inv.worker_title || ownerName);
    setTools(inv.tools_drawn);
    setReasoning(inv);
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
        $("next").disabled = false;
        $("auto").disabled = false;
        $("hint").textContent = "Press Next for the following chapter";
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

function hideDilemma() {
    $("dilemma-overlay").hidden = true;
    $("dilemma-own-wrap").hidden = true;
    $("dilemma-own-input").value = "";
    dilemmaResolve = null;
}

async function runDilemmaGate(chapter, auto) {
    let dilemma;
    try {
        dilemma = await api("/api/dilemma", { chapter_id: chapter.id });
    } catch (e) { return; /* dilemma is additive - never block the run */ }
    if (!dilemma || !Array.isArray(dilemma.options) || dilemma.options.length < 2) return;

    $("dilemma-prompt").textContent = dilemma.prompt;
    const host = $("dilemma-options");
    host.innerHTML = "";
    dilemma.options.slice(0, 2).forEach((o, i) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "dilemma-opt";
        btn.innerHTML = `<b>${i + 1} &middot; ${esc(o.option)}</b><span>tradeoff: ${esc(o.tradeoff || "none stated")}</span>`;
        btn.addEventListener("click", () => decide(o.option, o.tradeoff, false));
        host.appendChild(btn);
    });
    $("dilemma-overlay").hidden = false;
    $("hint").textContent = "Your call, CEO - 1 / 2, or chart your own path";
    if (A.speak) { try { A.speak(dilemma.prompt, { voice: NARRATOR_VOICE }); } catch (_) {} }

    const picked = await new Promise((resolve) => {
        dilemmaResolve = resolve;
        if (auto) setTimeout(() => {
            if (dilemmaResolve) decide(dilemma.options[0].option, dilemma.options[0].tradeoff, false);
        }, 3500);
    });

    async function decide(option, tradeoff, custom) {
        if (!dilemmaResolve) return;
        const r = dilemmaResolve; dilemmaResolve = null;
        $("dilemma-overlay").hidden = true;
        try {
            const res = await api("/api/decision", {
                chapter_id: chapter.id, option, tradeoff: tradeoff || "",
                prompt: dilemma.prompt, custom: !!custom,
            });
            state.decisions = res.decisions || state.decisions;
        } catch (_) { /* decision recording is additive */ }
        await narrate(`Decided: ${option}. Your workforce will execute accordingly.`);
        r({ option, tradeoff, custom });
    }

    $("dilemma-own-btn").onclick = () => { $("dilemma-own-wrap").hidden = false; $("dilemma-own-input").focus(); };
    $("dilemma-own-go").onclick = () => {
        const v = $("dilemma-own-input").value.trim();
        if (v) decide(v, "", true);
    };
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
    setSceneHead("Finale", "Your company exists");
    if (A.complete) A.complete();
    await renderMermaid(companyGraphDef());
    setWorker("narrator", "Venture: launched", "All chapters verified", false);
    $("hint").textContent = "Venture launched";
    $("next").disabled = true;
    $("auto").disabled = true;
    await narrate(`${state.chapters.length} chapters, ${state.chapters.length} verified gates. From one sentence you now have an org, the systems it runs on, a launch plan, and the numbers behind it - level ${s.level ?? 1}, ${s.xp ?? 0} XP. That is your company, mapped as a dungeon you just cleared.`);
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
// Lets the founder speak their company idea instead of typing it. Uses the
// browser SpeechRecognition API (Chrome/Edge/Safari) - no API key, no network
// of our own. Degrades gracefully: if unsupported, the mic button is hidden and
// typing still works.
function setupVoiceInput() {
    const micBtn = $("mic");
    const statusEl = $("mic-status");
    const pitchEl = $("in-pitch");
    if (!micBtn || !pitchEl) return;

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { micBtn.style.display = "none"; return; }

    let rec = null;
    let listening = false;
    let baseText = "";

    function setStatus(msg, live) {
        if (!statusEl) return;
        statusEl.textContent = msg || "";
        statusEl.classList.toggle("live", !!live);
    }

    function stop() {
        listening = false;
        micBtn.classList.remove("listening");
        try { rec && rec.stop(); } catch (e) { /* ignore */ }
    }

    micBtn.addEventListener("click", () => {
        if (A.unlock) { try { A.unlock(); } catch (e) { /* audio optional */ } }
        if (listening) { stop(); setStatus("", false); return; }

        rec = new SR();
        rec.lang = "en-US";
        rec.interimResults = true;
        rec.continuous = true;
        // Start a fresh dictation but keep whatever the founder already typed.
        baseText = (pitchEl.value || "").trim();

        rec.onstart = () => {
            listening = true;
            micBtn.classList.add("listening");
            setStatus("Listening - speak your idea...", true);
        };
        rec.onerror = (e) => {
            setStatus("Mic error: " + (e.error || "unknown"), false);
            stop();
        };
        rec.onend = () => {
            micBtn.classList.remove("listening");
            if (listening) setStatus("Heard you. Edit, or press Begin.", false);
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
            pitchEl.value = (joined + (interim ? " " + interim : "")).trim();
            // Speaking a fresh idea should clear any URL so the pitch wins.
            const urlEl = $("in-url");
            if (urlEl && pitchEl.value) urlEl.value = "";
        };

        try { rec.start(); } catch (e) { setStatus("Could not start mic", false); }
    });
}

// --- Wire up ---------------------------------------------------------------
$("begin").addEventListener("click", beginStory);

// The intro film hands off here: one continuous descent, no second form.
// `mission` = {company, pitch, archetype: {name, skill}|null}. The film picks
// the front + archetype; this fills the founding fields and starts the run
// while the overlay is still fading - the script IS the gameplay.
window.DungeonStory = {
    start(mission) {
        if (state.phase !== "title") return;
        state.fromFilm = true; // the film was the welcome - the game continues it
        if (mission.company) $("in-company").value = mission.company;
        if (mission.pitch) $("in-pitch").value = mission.pitch;
        $("in-url").value = "";
        if (mission.archetype) {
            state.archetype = mission.archetype;
            document.querySelectorAll("#arch-row .arch-card").forEach((c) => {
                c.classList.toggle("sel", c.dataset.arch === mission.archetype.name);
            });
        }
        beginStory();
    },
};
$("next").addEventListener("click", runNextChapter);
$("auto").addEventListener("click", autoPlay);
$("reset").addEventListener("click", resetStory);
$("mute").addEventListener("click", () => {
    if (A.unlock) A.unlock();
    const muted = A.toggleMute ? A.toggleMute() : false;
    $("mute").style.opacity = muted ? 0.4 : 1;
});

// Detect live mode for the HUD chip.
fetch("/api/mode").then((r) => (r.ok ? r.json() : null)).then((d) => {
    if (d && d.live) {
        $("mode-dot").classList.add("live");
        $("mode-label").textContent = "live foundry";
        state.live = true;
    }
}).catch(() => {});

// Enable speak-your-idea voice input on the pitch field (if the browser supports it).
setupVoiceInput();
