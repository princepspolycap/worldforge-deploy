// Live preflight console: the "show, don't tell" character build. When the
// founder presses Begin, instead of a silent "Building your character..." button
// we play a staged console that mirrors the REAL pipeline behind
// /api/founder/analyze - locate the profile, read the page, cross-reference the
// open web, reason about the operating posture, mint the archetype, size the
// digital workforce - and resolve to the real numbers the analyze call returns.
//
// This module is presentation only: it makes ZERO network calls. The caller
// (gatherAndReady in story.js) kicks off the real fetch and the console
// concurrently, then hands the resolved `ares` to controller.complete(). Source
// of truth for the data shape: submission/agents/founder_analyst.py.

import { scramble, revealLines, prefersReduced } from "./anim.js";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Client-side source classifier - mirrors _source_kind in founder_analyst.py
// closely enough to narrate honestly while the real call runs. Single source of
// truth for the UI's "what did they give us" read.
function classifyProfileUrl(url) {
    const u = String(url || "").trim();
    if (!u) return { kind: "mission", host: "", label: "Mission described" };
    let host = "";
    try { host = new URL(u.includes("://") ? u : "https://" + u).hostname.replace(/^www\./, ""); }
    catch (_) { host = u.replace(/^https?:\/\//, "").split("/")[0]; }
    const h = host.toLowerCase();
    if (h.includes("linkedin.")) return { kind: "linkedin", host, label: "LinkedIn profile" };
    if (h.includes("github.")) return { kind: "github", host, label: "GitHub profile" };
    if (h.includes("twitter.") || h === "x.com") return { kind: "social", host, label: "Social profile" };
    if (h.includes("medium.") || h.includes("substack.")) return { kind: "writing", host, label: "Writing profile" };
    return { kind: "site", host, label: "Personal site" };
}

const STAGE_DEFS = [
    { tag: "Locating", key: "locate" },
    { tag: "Fetching", key: "fetch" },
    { tag: "Open web", key: "osint" },
    { tag: "Reasoning", key: "reason" },
    { tag: "Minting", key: "mint" },
    { tag: "Assembling", key: "assemble" },
    { tag: "Forging", key: "antagonist" },
];

// Build the console DOM inside `mount`, returning the stage row elements.
function buildConsole(mount, headline) {
    mount.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "cc-console";
    wrap.innerHTML = `<div class="kicker">${headline}</div><div class="cc-con-stages"></div>`;
    const stages = wrap.querySelector(".cc-con-stages");
    const rows = STAGE_DEFS.map((def) => {
        const row = document.createElement("div");
        row.className = "cc-con-stage";
        row.dataset.key = def.key;
        row.innerHTML =
            `<span class="cc-con-pip"></span>`
            + `<span class="cc-con-tag">${def.tag}</span>`
            + `<span class="cc-con-text"></span>`;
        stages.appendChild(row);
        return row;
    });
    mount.appendChild(wrap);
    return { wrap, rows };
}

function rowText(row) { return row.querySelector(".cc-con-text"); }

async function playStage(row, text, { hold, mono, ms } = {}) {
    row.classList.remove("done", "fault");
    row.classList.add("run");
    const el = rowText(row);
    if (mono) el.classList.add("mono");
    await scramble(el, text, { duration: ms != null ? ms : (prefersReduced() ? 0 : 520) });
    if (!hold) row.classList.replace("run", "done");
}

function lockStage(row, ok = true) {
    row.classList.remove("run");
    row.classList.add(ok ? "done" : "fault");
}

// runPreflightConsole({ url, pitch, mount }) -> controller
//   controller.complete(ares) : fast-forward to the real numbers, resolve.
//   controller.fail(message)  : show FAULT on the active stage, reject.
function runPreflightConsole({ url, pitch, mount, cached }) {
    const src = classifyProfileUrl(url);
    const fromUrl = src.kind !== "mission";
    const headline = (fromUrl ? "Building your character" : "Reading your mission")
        + (cached ? " - reused" : "");
    const { rows } = buildConsole(mount, headline);
    const byKey = (k) => rows.find((r) => r.dataset.key === k);

    let resolveDone, rejectDone;
    const done = new Promise((res, rej) => { resolveDone = res; rejectDone = rej; });
    let aresResolver = null; // set if complete() is called before stage 4
    let failed = false;

    // Cached reuse fast-forwards the whole console: nothing ran on the wire, so
    // the stages snap to the known result instead of pacing through it.
    const pace = (cached || prefersReduced()) ? 0 : 1;
    const stageMs = cached ? 90 : (prefersReduced() ? 0 : 520);

    (async () => {
        // Entrance: stages rise in staggered, then play top to bottom.
        await revealLines(rows, { stagger: 70 });

        // Each line names the agent doing the work, so the multi-agent pipeline
        // is legible: Scraper -> Web OSINT -> Profile Analyst -> Org Designer ->
        // Antagonist Forge. Mission path swaps the scrape pair for a Mission Analyst.
        // Stage 1: Locating
        await playStage(byKey("locate"), fromUrl
            ? `Scraper resolving ${src.label}${src.host ? " - " + src.host : ""}`
            : "Mission Analyst parsing what you described", { ms: stageMs });
        await sleep(220 * pace);

        // Stage 2: Fetching
        await playStage(byKey("fetch"), fromUrl
            ? "Scraper reading the public page (guarded)"
            : "Mission Analyst extracting the skill and who it helps", { ms: stageMs });
        await sleep(220 * pace);

        // Stage 3: Open web
        await playStage(byKey("osint"), fromUrl
            ? "Web OSINT cross-referencing the open web"
            : "Mission Analyst framing the world this improves", { ms: stageMs });
        await sleep(220 * pace);

        // Stage 4: Reasoning - hold on a breathing pip until the real data lands.
        await playStage(byKey("reason"),
            "Profile Analyst forming your operating posture", { hold: true, mono: true, ms: stageMs });

        // Wait for complete(ares). If it already arrived, use it.
        const ares = await new Promise((res) => {
            if (aresResolver === "ready") return res(window.__preflightAres);
            aresResolver = res;
        });
        if (failed) return;
        lockStage(byKey("reason"), true);
        await sleep(160 * pace);

        const profile = (ares && ares.profile) || {};
        const org = (ares && ares.org) || {};

        // Reveal the real signals as chips on the open-web stage.
        const signals = Array.isArray(profile.signals) ? profile.signals.slice(0, 4) : [];
        if (signals.length) {
            const osintRow = byKey("osint");
            const chipWrap = document.createElement("div");
            chipWrap.className = "cc-con-chips";
            signals.forEach((s) => {
                const c = document.createElement("span");
                c.className = "cc-con-chip";
                c.textContent = String(s).slice(0, 40);
                chipWrap.appendChild(c);
            });
            osintRow.appendChild(chipWrap);
            await revealLines(chipWrap.children, { stagger: 60, duration: 360 });
        }

        // Stage 5: Minting - lock to the real archetype.
        const arch = profile.founder_archetype || (org.founder_archetype) || "Builder";
        await playStage(byKey("mint"), `Profile Analyst casting your founder seat: ${arch}`, { mono: true, ms: stageMs });
        await sleep(200 * pace);

        // Stage 6: Assembling - the digital workforce numbers.
        const dw = org.digital_worker_count != null ? org.digital_worker_count : null;
        const lev = org.leverage_ratio != null ? org.leverage_ratio : null;
        const wkText = dw != null
            ? `Org Designer sizing your workforce: ${dw} workers${lev != null ? " - " + lev + "x leverage" : ""}`
            : "Org Designer sizing your digital workforce";
        await playStage(byKey("assemble"), wkText, { mono: true, ms: stageMs });
        await sleep(180 * pace);

        // Stage 7: Forging - the rival the story pits you against (real data).
        const ant = (ares && ares.antagonist) || {};
        const rival = ant.name || "a market rival";
        const threat = ant.threat_type ? ` - ${ant.threat_type} threat` : "";
        await playStage(byKey("antagonist"),
            `Antagonist Forge shaping your rival: ${rival}${threat}`, { mono: true, ms: stageMs });

        resolveDone(ares);
    })().catch((e) => { rejectDone(e); });

    return {
        done,
        complete(ares) {
            window.__preflightAres = ares;
            if (typeof aresResolver === "function") { const r = aresResolver; aresResolver = null; r(ares); }
            else { aresResolver = "ready"; }
            return done;
        },
        fail(message) {
            failed = true;
            // Mark the active (held) stage as a fault, or the first running one.
            const active = rows.find((r) => r.classList.contains("run")) || byKey("reason");
            if (active) {
                lockStage(active, false);
                const tag = active.querySelector(".cc-con-tag");
                if (tag) tag.textContent = "Fault";
                scramble(rowText(active), message || "Could not gather the profile", { duration: 360 });
            }
            rejectDone(new Error(message || "preflight failed"));
            return done.catch(() => {});
        },
    };
}

export { runPreflightConsole, classifyProfileUrl };
