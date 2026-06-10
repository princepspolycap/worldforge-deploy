// Intro / lore overlay: the game introduces itself before the first pitch.
//
// This is deliberately additive and fully skippable. It never touches the main
// story flow in story.js - it only paints a fixed overlay on top, then removes
// it. The presenter can let it auto-play, click / press space to move faster,
// or skip entirely (Esc or the Skip button). During practice, append ?intro=0
// to the URL to bypass it on reload.
//
// The lore here carries the reasoning behind the build - why Foundry, why a
// human stays at the root, why it is a game - so the presenter does not have to
// narrate those decisions out loud. The game explains itself.
(function () {
    "use strict";

    const A = window.DungeonAudio || {};
    const overlay = document.getElementById("intro-overlay");
    if (!overlay) return;

    // Practice escape hatch: ?intro=0 dismisses immediately on load.
    if (new URLSearchParams(location.search).get("intro") === "0") {
        overlay.style.display = "none";
        return;
    }

    const cardEl = document.getElementById("intro-card");
    const dotsEl = document.getElementById("intro-dots");
    const hintEl = document.getElementById("intro-hint");
    const skipBtn = document.getElementById("intro-skip");

    const DWELL = 6800;      // fallback hold (ms) when narration is unavailable
    const DWELL_MAX = 24000;  // safety cap while a narration line is speaking

    // Cinematic backdrops. Stills are generated with the Foundry MAI image
    // deployment (tools/generate_art.py --keyart) and ship committed. If a
    // matching Veo-generated motion clip exists next to a still (same name,
    // .mp4, local-only / gitignored), the scene plays the clip instead - a
    // progressive enhancement. Two stacked layers crossfade between scenes;
    // stills get a slow Ken Burns drift, clips bring their own motion. A
    // missing file (fresh fork) can never break the flow - the card simply
    // plays over the gradient base.
    const IMG_BASE = "/game/assets/generated/lore/";
    const VID_BASE = IMG_BASE + "video/";
    // Pre-baked narration takes (tools/generate_narration.py) - the curated,
    // cinematic reads of each lore line. audio.js plays these first and only
    // falls back to live TTS (then the browser voice) when a file is missing,
    // so a fresh fork still narrates and the demo never sounds robotic.
    const NARR_BASE = IMG_BASE + "narration/";
    // Delivery direction shared by the baked takes and the live TTS fallback.
    const NARRATOR_STYLE = "Warm cinematic film narrator. Intimate, unhurried, grounded awe - an invitation into a story. Natural pauses between sentences, soft dynamics. Never monotone, never robotic, never an announcer.";
    const loadedImgs = {}; // filename -> true once preloaded OK
    const loadedVids = {}; // scene base name -> object URL of a playable clip
    let pendingBg = null;  // scene requested before its image finished loading

    function preloadLoreArt(names) {
        names.forEach((name) => {
            if (!name) return;
            const im = new Image();
            im.onload = () => {
                loadedImgs[name] = true;
                if (pendingBg && pendingBg.name === name) {
                    const p = pendingBg;
                    pendingBg = null;
                    setBackdrop(p.name, p.dim);
                }
            };
            im.src = IMG_BASE + name;
            // Probe for a motion clip alongside the still. Fetch the whole
            // file so playback starts instantly and never buffers mid-scene;
            // a 404 just means this scene stays a still.
            const base = name.replace(/\.png$/, "");
            fetch(VID_BASE + base + ".mp4")
                .then((r) => (r.ok ? r.blob() : null))
                .then((blob) => {
                    if (!blob || !/video/.test(blob.type || "video/mp4")) return;
                    loadedVids[name] = URL.createObjectURL(blob);
                    // Upgrade the scene live if it is currently showing.
                    if (!done && index >= 0 && cards[index] && cards[index].img === name) {
                        setBackdrop(name, bgFront ? bgFront.classList.contains("dimmed") : false);
                    }
                })
                .catch(() => { /* stills-only is a fine baseline */ });
        });
    }

    const bgA = document.getElementById("intro-bg-a");
    const bgB = document.getElementById("intro-bg-b");
    const KB = ["kb-in", "kb-out", "kb-deep"];
    let bgFront = null; // whichever layer currently shows a scene
    let kbTurn = 0;

    function layerVideo(layer) {
        let v = layer.querySelector("video");
        if (!v) {
            v = document.createElement("video");
            v.muted = true; v.loop = true; v.playsInline = true;
            v.setAttribute("muted", ""); v.setAttribute("playsinline", "");
            layer.appendChild(v);
        }
        return v;
    }

    function setBackdrop(name, dim) {
        if (!bgA || !bgB) return;
        if (!name) { // fade back to the gradient base
            [bgA, bgB].forEach((l) => {
                l.classList.remove("on");
                const v = l.querySelector("video");
                if (v) { try { v.pause(); } catch (e) { /* ok */ } }
            });
            bgFront = null;
            pendingBg = null;
            return;
        }
        const clip = loadedVids[name];
        if (!clip && !loadedImgs[name]) { pendingBg = { name: name, dim: dim }; return; }
        pendingBg = null;
        const incoming = bgFront === bgA ? bgB : bgA;
        const outgoing = bgFront;
        const vid = layerVideo(incoming);
        KB.forEach((k) => incoming.classList.remove(k));
        if (clip) {
            // Motion clip: the video supplies the life; no Ken Burns on top.
            incoming.style.backgroundImage = loadedImgs[name]
                ? "url('" + IMG_BASE + name + "')" : ""; // poster behind the clip
            if (vid.src !== clip) {
                vid.src = clip; // fresh load starts at 0 - do not touch currentTime
            } else {
                try { vid.currentTime = 0; } catch (e) { /* ok */ }
            }
            vid.style.display = "";
            const p = vid.play();
            if (p && p.catch) {
                p.catch(() => {
                    // Load was still warming up - retry once it has data.
                    vid.addEventListener("loadeddata", () => {
                        vid.play().catch(() => { /* poster still shows */ });
                    }, { once: true });
                });
            }
        } else {
            vid.style.display = "none";
            try { vid.pause(); } catch (e) { /* ok */ }
            incoming.style.backgroundImage = "url('" + IMG_BASE + name + "')";
            void incoming.offsetWidth; // restart the Ken Burns animation
            incoming.classList.add(KB[kbTurn++ % KB.length]);
        }
        incoming.classList.toggle("dimmed", !!dim);
        incoming.classList.add("on");
        if (outgoing && outgoing !== incoming) {
            outgoing.classList.remove("on");
            const ov = outgoing.querySelector("video");
            if (ov) setTimeout(() => { try { ov.pause(); } catch (e) { /* ok */ } }, 1200);
        }
        bgFront = incoming;
    }

    // The intro is a short film, not a slide deck. Each card is a scene: a
    // full-bleed Veo/MAI backdrop, an intertitle (kicker + one line on
    // screen), and a voice-over written for the ear that advances the card
    // when it finishes speaking. The arc is an invitation into the story -
    // the hero's journey (chart your path) -> too big to command -> the vow
    // of basic needs -> the agency of digital workers -> fair pay -> Foundry
    // reasoning -> the human seal -> the title lands ("your company is the
    // dungeon") -> the choice screen, where the player answers back.
    const cards = [
        {
            kicker: "Microsoft Agents League - Battle 2 - Reasoning Agents",
            h2: "Welcome to your hero's journey.",
            sub: "Chart your path: terraform the Sahara. Automate basic needs.",
            vo: "Welcome to your hero's journey. You are to chart a path within a world that terraforms the Sahara desert and automates basic needs. To achieve this, you have at your disposal reasoning agents, competing in the Agents League - agents who collaborate within a web of social contracts, between a multitude of organizations and institutions. The journey is ambitious. And it is taken care of. What it needs - is you.",
            img: "sahara.png",
        },
        {
            kicker: "The catch",
            h2: "Too big to command.",
            sub: "No one can order a desert green.",
            vo: "But no one can command a desert green, or hire a billion hands. Most of us suffer the side effects of our chaotically complex social contract systems - overdue for an update. A vision this size is never commanded into existence. It is aligned.",
            img: "premise.png",
        },
        {
            kicker: "The vow",
            h2: "Align a billion people.",
            sub: "No belly hungry. No head unroofed. No back unclad. No soul enslaved.",
            vo: "Here is the vow that aligns them: no belly goes hungry. No head goes without a roof. No back is unclad. And no soul is enslaved to survival. Automate the basics - food, water, energy, shelter - and a billion humans, and their AI, finally pull the same way.",
            img: "needs.png",
        },
        {
            kicker: "The mechanism",
            h2: "An agency of digital workers.",
            sub: "Bind your skill to a worker that executes.",
            vo: "The mechanism is an agency of digital workers. Bind your real skill to a worker that executes, and your experience becomes a business that runs while you sleep.",
            img: "workforce.png",
        },
        {
            kicker: "The flywheel",
            h2: "Everyone gets paid. Fairly.",
            sub: "Real, consented work - not scraping.",
            vo: "And everyone gets paid - fairly. The platform learns from real, consented work, paid evenly - not scraped. Even a superintelligence needs the grassroots.",
            img: "flywheel.png",
        },
        {
            kicker: "How it thinks",
            h2: "Reasoning runs on Foundry.",
            sub: "IQ memory - code interpreter - orchestration.",
            vo: "Every agent that reasons here runs on Microsoft Foundry. Memory it can cite. A code interpreter for checks it cannot fake. And orchestration that turns lone agents into a team.",
            img: "foundry.png",
        },
        {
            kicker: "The law of this world",
            h2: "A human holds the seal.",
            sub: "Nothing counts until you approve it.",
            vo: "And the deepest law of this world: nothing counts until a human presses the seal. Every artifact stops at this gate, and waits, for you.",
            img: "gate.png",
        },
        {
            kicker: "The game",
            h2: "Your company is the dungeon.",
            sub: "Clear it room by room. The path is yours.",
            vo: "This is how you enter the story. Found a company on one front of the mission, take the CEO's chair, and clear it room by room with your workforce. Your company is the dungeon.",
            img: "title.png",
        },
        { kind: "choice" },
    ];

    preloadLoreArt(cards.map((c) => c.img).filter(Boolean));

    // The two missions the player can pick - early playable placeholders. Each
    // pre-fills the existing pitch screen, so the same org -> world -> gate loop
    // runs underneath. A third "own brief" path keeps the live Poly default.
    const MISSIONS = {
        needs: {
            company: "The Commons Project",
            pitch: "An agency of digital workers that automates the production and distribution of basic needs - food, water, energy, and shelter logistics - so a community can meet essential demand with a small human crew and an aligned AI workforce.",
        },
        terraform: {
            company: "Sahara Forge",
            pitch: "An agency of digital workers that plans and coordinates terraforming the Sahara - water routing, solar microgrids, soil regeneration, and new-city logistics - turning uninhabitable desert into livable cities.",
        },
    };

    let index = -1;
    let timer = null;
    let done = false;

    cards.forEach(() => {
        const d = document.createElement("span");
        d.className = "d";
        dotsEl.appendChild(d);
    });

    function paintDots() {
        Array.prototype.forEach.call(dotsEl.children, (d, n) => {
            d.classList.toggle("on", n <= index);
        });
    }

    function render(n) {
        const c = cards[n];
        if (c.kind === "choice") { renderChoice(); return; }
        setBackdrop(c.img || null, false);
        cardEl.innerHTML =
            '<div class="intro-anim">' +
            '<div class="kicker">' + c.kicker + "</div>" +
            "<h2>" + c.h2 + "</h2>" +
            (c.sub ? "<p>" + c.sub + "</p>" : "") +
            "</div>";
        if (A.tick) { try { A.tick(true); } catch (e) { /* audio optional */ } }
        speakThenAdvance(c.vo || (c.h2 + " " + (c.sub || "")),
            c.img ? NARR_BASE + c.img.replace(/\.png$/, ".mp3") : null);
        hintEl.textContent = "space / click to advance - esc to skip";
    }

    // The voice-over paces the film: a card holds while its line is spoken and
    // advances a beat after it ends. If narration is off (muted, no TTS), fall
    // back to a fixed dwell. A token guards against a stale onend firing after
    // the player has already advanced by hand.
    let advanceToken = 0;

    function speakThenAdvance(vo, baked) {
        const my = ++advanceToken;
        clearTimeout(timer);
        const narrated = !!(A.speak && A.narrationEnabled && A.narrationEnabled()
            && !(A.isMuted && A.isMuted()));
        if (narrated) {
            const t0 = Date.now();
            timer = setTimeout(() => { if (my === advanceToken && !done) next(); }, DWELL_MAX);
            try {
                A.speak(vo, {
                    voice: "onyx",
                    baked: baked || null,
                    instructions: NARRATOR_STYLE,
                    onend: () => {
                        if (my !== advanceToken || done) return;
                        clearTimeout(timer);
                        // If "narration" died in under 1.5s it never really
                        // played (autoplay block, error) - keep the film at
                        // reading pace instead of racing through the cards.
                        const held = Date.now() - t0;
                        const wait = held < 1500 ? Math.max(DWELL - held, 2200) : 900;
                        timer = setTimeout(() => { if (my === advanceToken && !done) next(); }, wait);
                    },
                });
            } catch (e) { /* narration optional */ }
        } else {
            if (A.speak) { try { A.speak(vo, { voice: "onyx", baked: baked || null, instructions: NARRATOR_STYLE }); } catch (e) { /* optional */ } }
            timer = setTimeout(() => { if (my === advanceToken && !done) next(); }, DWELL);
        }
    }

    function renderChoice() {
        advanceToken++; // the choice screen holds for input - no auto-advance
        clearTimeout(timer);
        setBackdrop("sahara.png", true);
        cardEl.innerHTML =
            '<div class="intro-anim">' +
            '<div class="kicker">Character creation</div>' +
            "<h2>What do you bring?</h2>" +
            "<p>Your real skill is your starting gear. Then pick the front your agents build toward - or bring your own.</p>" +
            '<div class="intro-skill">' +
            "<label>What you bring (optional)</label>" +
            '<input id="intro-skill-input" placeholder="what you are good at - design, sales, logistics, code..." />' +
            "</div>" +
            '<div class="intro-choices">' +
            '<button class="intro-choice a" data-mission="needs">' +
            '<span class="ic-tag">Mission A - press 1</span>' +
            '<span class="ic-title">Automate basic needs</span>' +
            '<span class="ic-sub">Food, water, energy, shelter - produced and distributed by an aligned human and AI workforce.</span>' +
            "</button>" +
            '<button class="intro-choice b" data-mission="terraform">' +
            '<span class="ic-tag">Mission B - press 2</span>' +
            '<span class="ic-title">Terraform the Sahara</span>' +
            '<span class="ic-sub">Water routing, solar microgrids, soil regeneration, new-city logistics - desert into cities.</span>' +
            "</button>" +
            "</div>" +
            '<div class="intro-freeform">or <button id="intro-freeform" class="linklike">start from your own brief</button></div>' +
            "</div>";
        if (A.tick) { try { A.tick(true); } catch (e) { /* audio optional */ } }
        if (A.speak) { try { A.speak("Now - tell us what you bring. Your skill is your starting gear. Then choose your front, founder: press one to automate basic needs, press two to terraform the Sahara, or bring a brief of your own. The dungeon takes all comers.", { voice: "onyx", baked: NARR_BASE + "choice.mp3", instructions: NARRATOR_STYLE }); } catch (e) { /* narration optional */ } }
        hintEl.textContent = "press 1 or 2 to choose - esc to skip";

        Array.prototype.forEach.call(cardEl.querySelectorAll(".intro-choice"), (b) => {
            b.addEventListener("click", (e) => { e.stopPropagation(); pickMission(b.dataset.mission); });
        });
        const ff = document.getElementById("intro-freeform");
        if (ff) ff.addEventListener("click", (e) => { e.stopPropagation(); startFreeform(); });
        const skill = document.getElementById("intro-skill-input");
        if (skill) skill.addEventListener("click", (e) => e.stopPropagation());
    }

    function setField(id, val) {
        const el = document.getElementById(id);
        if (!el) return;
        el.value = val;
        el.dispatchEvent(new Event("input", { bubbles: true }));
    }

    // A mission pre-fills the existing pitch screen and reveals it. The player
    // (or presenter) reviews the brief, then clicks Begin - no auto-start, so
    // the run stays under human control even on stage.
    function pickMission(key) {
        const m = MISSIONS[key];
        if (!m) return;
        const skillEl = document.getElementById("intro-skill-input");
        const skill = (skillEl && skillEl.value || "").trim();
        setField("in-company", m.company);
        setField("in-pitch", m.pitch + (skill ? " The founding operator's edge: " + skill + "." : ""));
        setField("in-url", "");
        dismiss(false, "begin");
    }

    // Keep whatever default is already on the pitch screen (the live Poly meta).
    function startFreeform() { dismiss(false, "pitch"); }

    function show(n) {
        if (done) return;
        index = Math.max(0, Math.min(cards.length - 1, n));
        render(index);
        paintDots();
    }

    function isChoice() { return cards[index] && cards[index].kind === "choice"; }

    function next() {
        if (index < cards.length - 1) show(index + 1);
        else if (!isChoice()) dismiss(false, "pitch");
    }
    function prev() { if (index > 0) show(index - 1); }

    function dismiss(instant, focusTarget) {
        if (done) return;
        done = true;
        advanceToken++;
        clearTimeout(timer);
        if (A.stopSpeaking) { try { A.stopSpeaking(); } catch (e) { /* narration optional */ } }
        document.removeEventListener("keydown", onKey);
        overlay.classList.add("hide");
        overlay.setAttribute("aria-hidden", "true");
        const finish = () => {
            overlay.style.display = "none";
            const id = focusTarget === "begin" ? "begin" : "in-pitch";
            const el = document.getElementById(id);
            if (el) { try { el.focus(); } catch (e) { /* focus optional */ } }
        };
        if (instant) finish(); else setTimeout(finish, 650);
        if (A.chime) { try { A.chime(); } catch (e) { /* audio optional */ } }
    }

    function onKey(e) {
        if (done) return;
        if (e.key === "Escape") { e.preventDefault(); dismiss(false, "pitch"); return; }
        if (isChoice()) {
            // Let the player type freely in the skill field.
            const typing = document.activeElement && document.activeElement.id === "intro-skill-input";
            if (typing) return;
            const k = e.key.toLowerCase();
            if (k === "1" || k === "a") { e.preventDefault(); pickMission("needs"); }
            else if (k === "2" || k === "b") { e.preventDefault(); pickMission("terraform"); }
            else if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
            return;
        }
        if (e.key === " " || e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); next(); }
        else if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
    }

    overlay.addEventListener("click", (e) => {
        if (e.target === skipBtn) return;
        if (isChoice()) return; // on the choice card, only the buttons act
        next();
    });
    if (skipBtn) skipBtn.addEventListener("click", (e) => { e.stopPropagation(); dismiss(false, "pitch"); });
    document.addEventListener("keydown", onKey);

    // Browsers gate audio autoplay until a gesture; unlock on first pointer.
    overlay.addEventListener("pointerdown", () => {
        if (A.unlock) { try { A.unlock(); } catch (e) { /* audio optional */ } }
    }, { once: true });

    show(0);
})();
