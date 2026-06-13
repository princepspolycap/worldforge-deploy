// Story Mode: a 3Blue1Brown-style narrated walkthrough of a Foundry-driven
// venture build. The World Designer decomposes a pitch into a quest graph, then
// the Worker Factory executes each chapter on its Foundry deployment. Each
// artifact (org chart, integration map, OKRs, financial plan) is animated into
// a dynamic Mermaid / SVG diagram, narrated beat by beat, validated at a gate,
// and folded into a company graph that grows as the venture comes alive.

import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
import { T, ROLE_COLOR, mermaidThemeVariables } from "./tokens.js";

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
const DEFAULT_COMPANY = "Microsoft Planetary Computer";
const DEFAULT_URL = "https://planetarycomputer.microsoft.com/";
const DEFAULT_PITCH = "Microsoft Planetary Computer is the real-world company vehicle for this run: a Microsoft environmental intelligence platform that turns Earth observation, climate, land, water, and biodiversity data into actionable products for sustainability teams, under human approval gates.";
let currentVoice = NARRATOR_VOICE;

let typeToken = 0;
let lastSpeech = Promise.resolve(); // completion of the previous narrated line
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

function clamp(n, min = 0, max = 100) {
    return Math.max(min, Math.min(max, Math.round(Number(n) || 0)));
}

function renderResources() {
    const host = $("resources");
    if (!host) return;
    host.innerHTML = Object.entries(RESOURCE_SPEC).map(([key, spec]) => {
        const val = clamp(state.resources[key]);
        return `<div class="meter" title="${spec.label}: ${val}/100">`
            + `<div class="meter-top"><span>${spec.label}</span><b>${val}</b></div>`
            + `<div class="meter-track"><span class="meter-fill" style="width:${val}%;background:${spec.color}"></span></div>`
            + `</div>`;
    }).join("");
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
        { key: "narrator", role: "narrator", name: "World Designer", title: "maps the dungeon", status: "waiting" },
    ];
}

function setParty(activeKey, line, activeName) {
    const host = $("party");
    if (!host) return;
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
        return `<div class="party-agent${active ? " active" : ""}${done ? " done" : ""}">`
            + `<img class="party-face" src="/game/assets/generated/${portrait}.png" alt="" onerror="this.style.display='none'" />`
            + `<div class="party-name">${esc(m.name)}</div>`
            + `<div class="party-role">${esc(ROLE_NAME[m.role] || m.role || "agent")}</div>`
            + `<div class="party-line">${esc(statusLine).slice(0, 88)}</div>`
            + `</div>`;
    }).join("");
}

function setWorker(role, deployLabel, stateText, thinking, displayName) {
    // Switch the narration voice to this worker's so each character sounds
    // distinct. Unknown roles keep the narrator voice.
    currentVoice = VOICE_BY_ROLE[role] || NARRATOR_VOICE;
    $("worker-name").textContent = displayName || ROLE_NAME[role] || role;
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
    $("worker-deploy").textContent = deployLabel || "";
    $("worker-state").innerHTML = thinking
        ? `<span class="pulse"></span> ${stateText}`
        : stateText;
    setParty(role, stateText, displayName);
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
    if (Array.isArray(org.notes) && org.notes.length) {
        html += `<div class="org-model"><b style="color:var(--gold-soft);font-style:normal">Latest consequence:</b> ${esc(org.notes[org.notes.length - 1])}</div>`;
    }
    org.roles.forEach((r) => {
        const c = r.kind === "human" ? "var(--strategist)" : r.kind === "hybrid" ? "var(--designer)" : "var(--ops)";
        const kindLabel = r.kind === "digital_worker" ? "digital" : r.kind;
        html += `<div class="org-role"><span class="org-orb" style="background:${c}"></span>`
            + `<b>${esc(r.title)}</b><span class="org-kind">${esc(kindLabel)}</span>`
            + `<div class="org-why">${esc(r.why || r.mandate)}</div></div>`;
    });
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
    state.company = ($("in-company") && $("in-company").value.trim()) || DEFAULT_COMPANY;
    state.pitch = ($("in-pitch") && $("in-pitch").value.trim()) || "";
    state.url = ($("in-url") && $("in-url").value || "").trim();
    if (!state.pitch && !state.url) {
        state.pitch = DEFAULT_PITCH;
        state.url = DEFAULT_URL;
    }
    if (!state.pitch && !state.url) { $("hint").textContent = "Enter a pitch or a company URL first"; return; }
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

    // Clear the founding form off the stage immediately - the form is the
    // door, not the room. From here the scene belongs to the narration and
    // the artifacts (this is what kept the title page and the game looking
    // like the same screen).
    $("diagram").innerHTML = `<div class="founding fade-scene">`
        + `<div class="kicker">The ascension begins</div>`
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
        lens("reasoning", `two-hop chain: scrape -> Company Analyst inferred "${String(profile.company_summary || "").slice(0, 60)}"`);
        lens("reliability", profile.scraped
            ? "scrape was SSRF-guarded; analyst output normalized before it touched the org"
            : "homepage unreachable - degraded to a domain default instead of failing");
        refreshLearned(); // the mapped company profile just landed in agent memory
        await narrate(`Read ${profile.host}. The Analyst's verdict: ${profile.company_summary} Saved to agent memory.`);
    }

    if (A.thinkingStop) A.thinkingStop();
    if (A.chime) A.chime();

    setOrgPanel(org);
    setWorker("orgdesigner", "STRATEGIST_MODEL (Foundry)", `Org chartered: ${org.headcount} seats`, false);
    setSceneHead("Beat 1", "The org this company needs",
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
    if (res.state && res.state.org) state.org = res.state.org;
    setResourcesFromEconomics(res.state && res.state.economics, state.org);
    state.idx = 0;
    state.phase = "designed";
    setHud(res.state);

    buildProgress(state.chapters.length);
    setWorker("narrator", "NARRATOR_MODEL (Foundry)", `Produced ${state.chapters.length} chapters`, false);

    await revealSelfOrganization();
    await revealVentureGraph();

    $("next").disabled = false;
    $("auto").disabled = false;
    $("hint").textContent = "Press Next to run the first chapter";
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

async function renderAgentStandup(standup) {
    const turns = standup && Array.isArray(standup.turns) ? standup.turns : [];
    if (!turns.length) return;
    const trigger = standup.trigger || {};
    setSceneHead("Agent stand-up", "The party reacts to your call",
        `group chat orchestration - ${esc(trigger.rule_id || "decision")}`);
    const members = turns.map((turn, i) => {
        const role = turn.role || "narrator";
        const portrait = ROLE_PORTRAIT[role] || "narrator";
        const handoff = turn.handoff_to ? `<div class="standup-handoff">handoff: ${esc(turn.handoff_to)}</div>` : "";
        return `<div class="council-member standup-member" style="animation-delay:${i * 90}ms">`
            + `<div class="council-top"><img class="council-face" src="/game/assets/generated/${portrait}.png" alt="" onerror="this.style.display='none'" />`
            + `<div><div class="council-name">${esc(turn.speaker || ROLE_NAME[role] || role)}</div><div class="council-role">${esc(ROLE_NAME[role] || role)}</div></div></div>`
            + standupToolMarkup(turn)
            + `<div class="council-says">&ldquo;${esc(turn.message || "")}&rdquo;</div>`
            + handoff
            + `</div>`;
    }).join("");
    $("diagram").innerHTML = `<div class="council fade-scene">${members}</div>`;
    setParty(turns[0].worker_id || turns[0].role, "reacting to the CEO decision", turns[0].speaker);
    const line = standup.next_brief_delta || trigger.summary || "The next worker brief now carries the choice.";
    lens("reasoning", `Agent group chat: ${turns.length} turns reacted to ${trigger.rule_id || "the CEO decision"}`);
    await narrate(`Stand-up. ${line}`);
    await sleep(600);
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
    $("next").disabled = true;
    $("auto").disabled = true;
    markProgress(state.idx);

    setSceneHead(`Chapter ${state.idx + 1}`, ch.title,
        `\u2692 artifact + diagram by ${ownerName} (agent JSON \u2192 Mermaid)`);
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
    $("hint").textContent = "Your call, CEO - 1 / 2, or chart your own path";
    const cd = $("dilemma-countdown");
    if (cd) { cd.hidden = true; cd.textContent = ""; }
    let promptSpeech = Promise.resolve();
    if (A.speak) { try { promptSpeech = A.speak(dilemma.prompt, { voice: NARRATOR_VOICE }) || Promise.resolve(); } catch (_) {} }

    // Wire the free-text path BEFORE parking on the promise - statements after
    // the await only run once the dilemma is already decided, which left the
    // Commit button dead during a live gate. (decide is hoisted, so this works.)
    $("dilemma-own-btn").onclick = () => { $("dilemma-own-wrap").hidden = false; $("dilemma-own-input").focus(); };
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
                const standup = await api("/api/world/standup", { chapter_id: chapter.id });
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
$("next").addEventListener("click", runNextChapter);
$("auto").addEventListener("click", autoPlay);
$("reset").addEventListener("click", resetStory);

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
