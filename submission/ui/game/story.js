// Story Mode: a 3Blue1Brown-style narrated walkthrough of a Foundry-driven
// venture build. The World Designer decomposes a pitch into a quest graph, then
// the Worker Factory executes each chapter on its Foundry deployment. Each
// artifact (org chart, integration map, OKRs, financial plan) is animated into
// a dynamic Mermaid / SVG diagram, narrated beat by beat, validated at a gate,
// and folded into a company graph that grows as the venture comes alive.

// Mermaid: vendored UMD bundle (ui/vendor/mermaid.min.js, pinned 11.12.2, MIT)
// loaded by story.html before this module - so diagrams work offline after a
// fresh git clone. Falls back to the CDN ESM build only if the vendor file is
// missing, and to text-only beats if both are unavailable.
let mermaid = window.mermaid || null;
if (!mermaid) {
    try {
        ({ default: mermaid } = await import("https://cdn.jsdelivr.net/npm/mermaid@11.12.2/dist/mermaid.esm.min.mjs"));
    } catch (e) {
        console.warn("Mermaid unavailable - diagrams disabled, narration continues.", e);
    }
}

if (mermaid) mermaid.initialize({
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
    if (!mermaid) {
        host.innerHTML = `<div style="color:#586079;font-family:monospace;font-size:12px">diagram renderer unavailable (offline) - the narration carries the beat</div>`;
        return;
    }
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
    idx: 0,
    phase: "title", // title | designed | running | done
    live: false,
};

function setWorker(role, deployLabel, stateText, thinking, displayName) {
    // Switch the narration voice to this worker's so each character sounds
    // distinct. Unknown roles keep the narrator voice.
    currentVoice = VOICE_BY_ROLE[role] || NARRATOR_VOICE;
    $("worker-name").textContent = displayName || ROLE_NAME[role] || role;
    // MAI-generated portrait for this role (tools/generate_art.py). Hidden if
    // the PNG is missing so the geometric baseline still works offline.
    const img = $("worker-portrait");
    if (img) {
        img.hidden = true;
        img.onload = () => { img.hidden = false; };
        img.onerror = () => { img.hidden = true; };
        img.src = `/game/assets/generated/${role}.png`;
    }
    const orb = document.querySelector(".role-orb");
    if (orb) orb.style.color = ROLE_COLOR[role] || "#94a3b8";
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
// the educational per-role rationale. Each worker gets the MAI portrait of the
// archetype closest to its lifecycle stage (hidden when the PNG is absent).
const STAGE_AVATAR = {
    discovery: "strategist", positioning: "strategist", mvp: "designer",
    gtm: "marketer", retention: "ops", ops: "ops",
};
function avatarFor(role) {
    if (role.kind === "human") return null; // the operator is the player
    const stage = (role.lifecycle_stage || "").toLowerCase();
    return STAGE_AVATAR[stage] || "ops";
}
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
        const av = avatarFor(r);
        const avatar = av
            ? `<img class="org-avatar" src="/game/assets/generated/${av}.png" alt="" onerror="this.style.display='none'">`
            : "";
        html += `<div class="org-role">${avatar}<span class="org-orb" style="background:${c}"></span>`
            + `<b>${esc(r.title)}</b><span class="org-kind">${esc(kindLabel)}</span>`
            + `<div class="org-why">${esc(r.why || r.mandate)}</div></div>`;
    });
    host.innerHTML = html;
}

function setGate(score) {
    $("score").textContent = score;
    $("score-fill").style.width = `${Math.min(100, score)}%`;
    const pass = score >= 80;
    const v = $("verdict");
    v.className = `gate-verdict ${pass ? "pass" : "review"}`;
    v.textContent = pass ? "PASS - artifact verified, XP awarded" : "REVIEW - bronze, founder gate required";
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

    $("begin").disabled = true;
    $("reset").disabled = false;

    // ---- Beat 0: a personalized, LLM-narrated welcome to THIS venture ----
    // Adaptive lore: the narrator frames the player's specific idea as their
    // quest. Spoken aloud while it types, so the opening is bespoke to whatever
    // pitch / URL / voice the player brought.
    setSceneHead("Your quest", state.company || "A new venture");
    try {
        const loreRes = await api("/api/lore", { pitch: state.pitch || state.url, company_name: state.company });
        if (loreRes && loreRes.lore) await narrate(loreRes.lore);
    } catch (e) { /* lore is optional flavor - never block the run */ }

    // ---- Beat 1: scrape + reason (URL) -> design the digital workforce ----
    const fromUrl = !!state.url;
    $("hint").textContent = fromUrl ? "Reading the company URL..." : "Designing the org...";
    setWorker(fromUrl ? "narrator" : "orgdesigner", fromUrl ? "scraper + STRATEGIST_MODEL (Foundry)" : "STRATEGIST_MODEL (Foundry)", fromUrl ? "Scraping the homepage" : "Designing the org", true, fromUrl ? "Company Analyst" : undefined);
    if (A.thinkingStart) A.thinkingStart();
    setSceneHead("Beat 1", fromUrl ? "Reading the company, then its org" : "The org this company needs");
    await narrate(fromUrl
        ? "Point this at any company URL. First a scraper reads the homepage - title, tagline, the sections it leads with. Then a Company Analyst agent reasons about what the business actually is, before the Org Designer proposes the team to run it."
        : "Before any work happens, an Org Designer agent decides what team this company needs: one human operator, plus the digital workers that form its execution layer. Every role exists for a reason.");

    let org;
    let profile = null;
    try {
        const ares = await api("/api/company/analyze", { pitch: state.pitch, url: state.url, company_name: state.company });
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
    await narrate(`Five chapters, each owned by ${state.org ? "one of the digital workers you just designed" : "a specialist agent"}: ${owners.join(", ")}. Dependencies set the order. This graph is the world the Worker Factory will build.`);
    markProgress(0);
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
    if (A.thinkingStart) A.thinkingStart();
    $("hint").textContent = `${ownerName} is working...`;

    await narrate(`Chapter ${state.idx + 1}: ${ch.goal}. ${ownerName}${ch.assigned_worker_title ? ", a digital worker the Org Designer created," : " agent"} spins up on its Foundry deployment and recalls relevant playbooks from Foundry IQ memory.`);

    let res;
    try {
        res = await api("/api/world/run-next", {});
    } catch (e) {
        if (A.thinkingStop) A.thinkingStop();
        $("hint").textContent = "Chapter failed";
        await narrate(`Worker failed: ${e.message}`);
        $("next").disabled = false;
        return;
    }
    if (A.thinkingStop) A.thinkingStop();

    const chapter = res.chapter || {};
    const inv = res.invocation || {};
    const score = chapter.validation_score ?? 0;
    setMemory(res.memory);
    setWorker(ch.owner_role, inv.deployment || "simulation", `Done in ${inv.latency_s ?? 0}s`, false, inv.worker_title || ownerName);
    setReasoning(inv);

    // Animate the artifact into a diagram.
    const diag = diagramForArtifact(ch.owner_role, chapter.artifact);
    if (diag && diag.type === "mermaid") await renderMermaid(diag.def);
    else if (diag && diag.type === "svg") { renderSvg(diag.svg); if (A.chime) A.chime(); }
    else await narrate("This chapter produced a text artifact - no diagram shape detected.");

    await sleep(500);
    setGate(score);
    if (score >= 80) { if (A.approve) A.approve(); } else if (A.reject) A.reject();
    setHud(res.state);

    const artifactKind = describeArtifact(ch.owner_role);
    await narrate(`${ownerName} delivered ${artifactKind}. The deterministic validator scored it ${score} of 100 - ${score >= 80 ? "it passes the gate and the company graph grows." : "bronze, so it pauses for a human gate."}`);

    completedChapters.push({ title: ch.title, role: ch.owner_role });
    state.idx += 1;

    if (state.idx >= state.chapters.length) {
        await finale(res.state);
    } else {
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
    await narrate(`Five chapters, five verified gates. From one sentence you now have an org, the systems it runs on, a launch plan, and the numbers behind it - level ${s.level ?? 1}, ${s.xp ?? 0} XP. That is your company, mapped as a dungeon you just cleared.`);
}

async function autoPlay() {
    $("auto").disabled = true;
    while (state.idx < state.chapters.length) {
        await runNextChapter();
        await sleep(900);
    }
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
$("next").addEventListener("click", runNextChapter);
$("auto").addEventListener("click", autoPlay);
$("reset").addEventListener("click", resetStory);
$("mute").addEventListener("click", () => {
    if (A.unlock) A.unlock();
    const muted = A.toggleMute ? A.toggleMute() : false;
    $("mute").style.opacity = muted ? 0.4 : 1;
});
const musicBtn = $("music");
if (musicBtn) {
    musicBtn.addEventListener("click", () => {
        if (A.unlock) A.unlock();
        const on = A.toggleMusic ? A.toggleMusic() : false;
        musicBtn.style.opacity = on ? 1 : 0.4;
    });
}

// Browser autoplay policy: the score can only start after a user gesture, so
// the first pointer/key interaction anywhere (intro click, space, begin)
// unlocks audio and fades the ambient track in.
function startAudioOnce() {
    if (A.unlock) A.unlock();
    if (A.musicStart) A.musicStart();
    document.removeEventListener("pointerdown", startAudioOnce);
    document.removeEventListener("keydown", startAudioOnce);
}
document.addEventListener("pointerdown", startAudioOnce);
document.addEventListener("keydown", startAudioOnce);

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
