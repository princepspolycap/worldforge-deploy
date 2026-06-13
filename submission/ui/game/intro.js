// Intro / lore overlay: the game introduces itself before the first pitch.
//
// This is deliberately additive and fully skippable. It never touches the main
// story flow in story.js - it only paints a fixed overlay on top, then removes
// it. The presenter can opt into the old cinematic lore with ?intro=1, click /
// press space to move faster, or skip entirely (Esc or the Skip button). The
// default path now starts at founder creation so the experience is a game first,
// not a film.
//
// The lore here carries the reasoning behind the build - why Foundry, why a
// human stays at the root, why it is a game - so the presenter does not have to
// narrate those decisions out loud. The game explains itself.
(function () {
    "use strict";

    const A = window.DungeonAudio || {};
    const overlay = document.getElementById("intro-overlay");
    if (!overlay) return;

    // Reveal the "first step" screen underneath: restart its staggered
    // entrance animation and float the ambient pad up under it. Used both when
    // the film hands off and when the player lands straight on it (?intro=0).
    function revealFirstStep() {
        const fs = document.querySelector(".first-step");
        if (fs) {
            fs.classList.remove("enter");
            void fs.offsetWidth; // reflow so the animation can replay
            fs.classList.add("enter");
        }
        if (A.ambientStart && !(A.isMuted && A.isMuted())) {
            try { A.ambientStart(); } catch (e) { /* music optional */ }
        }
    }

    // The lore film is the default opening. Practice escape hatch: append
    // ?intro=0 to the URL to bypass it and land straight on the first step.
    if (new URLSearchParams(location.search).get("intro") === "0") {
        overlay.style.display = "none";
        revealFirstStep();
        return;
    }

    const cardEl = document.getElementById("intro-card");
    const hintEl = document.getElementById("intro-hint");
    const skipBtn = document.getElementById("intro-skip");

    const DWELL = 6800;      // fallback hold (ms) when narration is unavailable
    const DWELL_MAX = 34000;  // safety cap while a narration line is speaking
                              // (must clear the longest baked take: sahara ~28s)
    const VOICED_MAX = 95000; // safety cap for the voiced film (the assembled
                              // intro runs ~75s; if `ended` never fires, advance
                              // at 95s instead of letting it hang in silence)

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
    const NARRATOR_STYLE = "A master storyteller speaking softly to one person by firelight, inviting them into an adventure. Low, warm, breathy chest voice. Slow conversational pace with long natural pauses at every dash and period. Lean into key words with rising wonder, then drop to near-whisper on the final line. Imperfect, human, alive - slight breaths audible. Absolutely never monotone, never robotic, never an announcer or commercial read.";
    const loadedImgs = {}; // filename -> true once preloaded OK
    const failedImgs = {}; // filename -> true once loading failed
    const loadedVids = {}; // scene base name -> object URL of a playable clip
    const voicedVids = {}; // scene name -> true when the clip carries narration
    const probing = {};    // scene name -> true while the clip fetch is in flight
    const playBlocked = {}; // scene name -> true when unmuted playback was
                            // refused (autoplay policy) - degrade to baked take
    let pendingBg = null;  // scene requested before its image finished loading

    // A voiced clip whose UNMUTED play() the browser refuses (autoplay policy
    // edge: activation expired, webview flags, OS overrides) must never strand
    // the scene in silence - the baked narration was already stopped in its
    // favor. Mark the scene and re-present it on the baked-mp3 path: muted
    // motion + spoken take, the exact pre-voiced experience.
    function notifyVoicedBlocked(name) {
        if (playBlocked[name]) return;
        playBlocked[name] = true;
        if (!done && started && index >= 0 && cards[index] && cards[index].img === name) {
            render(index);
        }
    }

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
            im.onerror = () => {
                failedImgs[name] = true;
                if (pendingBg && pendingBg.name === name) {
                    const p = pendingBg;
                    pendingBg = null;
                    setBackdrop(p.name, p.dim);
                }
                if (!done && started && index >= 0 && cards[index]
                    && (cards[index].img === name || cards[index].fallbackImg === name)) {
                    render(index);
                }
            };
            im.src = IMG_BASE + name;
            // Probe for motion clips alongside the still. `<scene>.voiced.mp4`
            // (Gemini Omni / Veo 3.1 with native narration) wins over the
            // silent `<scene>.mp4`; either is fetched whole so playback never
            // buffers mid-scene. A 404 just means this scene stays a still.
            // While the probe is in flight the scene HOLDS (no baked dwell
            // timer) so a slow fetch can never cut a clip short.
            const base = name.replace(/\.png$/, "");
            probing[name] = true;
            fetch(VID_BASE + base + ".voiced.mp4")
                .then((r) => (r.ok ? r.blob() : null))
                .then((blob) => {
                    if (blob && /video/.test(blob.type || "video/mp4")) {
                        loadedVids[name] = URL.createObjectURL(blob);
                        voicedVids[name] = true;
                        // If this scene is already on screen (it raced ahead
                        // of the fetch and started its baked take), re-present
                        // it: render() swaps in the clip, enters film-mode and
                        // hands pacing to the clip's own voice (stopSpeaking
                        // kills the baked take so the voices never overlap).
                        if (!done && started && index >= 0 && cards[index] && cards[index].img === name) {
                            render(index);
                        }
                        return null;
                    }
                    return fetch(VID_BASE + base + ".mp4").then((r) => (r.ok ? r.blob() : null));
                })
                .then((blob) => {
                    if (!blob || !/video/.test(blob.type || "video/mp4") || loadedVids[name]) return;
                    loadedVids[name] = URL.createObjectURL(blob);
                    // Upgrade the scene live if it is currently showing.
                    if (!done && index >= 0 && cards[index] && cards[index].img === name) {
                        setBackdrop(name, bgFront ? bgFront.classList.contains("dimmed") : false);
                    }
                })
                .catch(() => { /* stills-only is a fine baseline */ })
                .finally(() => {
                    probing[name] = false;
                    if (!done && started && index >= 0 && cards[index]
                        && (cards[index].img === name || cards[index].fallbackImg === name)) {
                        render(index);
                    }
                });
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
        if (!clip && !loadedImgs[name] && !failedImgs[name]) { pendingBg = { name: name, dim: dim }; return; }
        pendingBg = null;
        const incoming = bgFront === bgA ? bgB : bgA;
        const outgoing = bgFront;
        const vid = layerVideo(incoming);
        KB.forEach((k) => incoming.classList.remove(k));
        if (clip) {
            // Motion clip: the video supplies the life; no Ken Burns on top.
            // Voiced clips (Omni/Veo native narration) also supply the VOICE:
            // unmuted, no loop - the film speaks for itself and the card
            // advances when the clip ends (wired in render()). A scene whose
            // unmuted playback was refused (playBlocked) keeps the motion but
            // muted + looped; the baked take carries the voice instead.
            const voiced = !!voicedVids[name] && !playBlocked[name];
            vid.muted = !voiced;
            vid.loop = !voiced;
            if (voiced) vid.removeAttribute("muted"); else vid.setAttribute("muted", "");
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
                    if (voiced) {
                        // Unmuted playback refused. One quick retry (load may
                        // have been warming up), then degrade the scene to the
                        // baked-narration path rather than hang in silence.
                        setTimeout(() => {
                            vid.play().catch(() => notifyVoicedBlocked(name));
                        }, 300);
                        return;
                    }
                    // Muted clip: load was still warming up - retry on data.
                    vid.addEventListener("loadeddata", () => {
                        vid.play().catch(() => { /* poster still shows */ });
                    }, { once: true });
                });
            }
        } else {
            vid.style.display = "none";
            try { vid.pause(); } catch (e) { /* ok */ }
            incoming.style.backgroundImage = loadedImgs[name] ? "url('" + IMG_BASE + name + "')" : "";
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

    // The intro is now ONE assembled film (Omni/Veo, ~75s, native narration and
    // score) that plays full-bleed and then hands directly to the founding
    // screen. It ships as `lore/video/film.voiced.mp4` (local-only) with
    // `lore/film.png` as the poster/fallback. A single card drives it: when the
    // voiced clip is present the existing video machinery plays it unmuted in
    // film-mode and advances on `ended`; if the clip is missing (fresh fork),
    // the card falls back to the poster + a spoken line so the demo still opens.
    const cards = [
        {
            kicker: "Gamifying World Improvement",
            h2: "Welcome to your hero's journey.",
            sub: "Automate basic needs. Terraform the Sahara. Your workforce builds it with you.",
            vo: "Welcome to your hero's journey. Your quest: automate basic needs, while terraforming the Sahara Desert. At your disposal, a league of reasoning agents - your digital workers. The journey is ambitious. Your workers have your back.",
            img: "film.png",
            fallbackImg: "title.png",
        },
    ];

    preloadLoreArt([...new Set(cards.flatMap((c) => [c.img, c.fallbackImg]).filter(Boolean))]);

    // (Missions now live on the founding screen itself - story.js renders the
    // mission cards inside the title card, so the film's last scene fades
    // directly onto the one founding screen. No duplicate choice card.)

    let index = -1;
    let timer = null;
    let done = false;
    let started = false; // the film rolls only after one gesture (audio unlock)

    function sceneAsset(card) {
        if (!card) return null;
        if (card.img && !loadedVids[card.img] && failedImgs[card.img] && card.fallbackImg) {
            return card.fallbackImg;
        }
        return card.img || card.fallbackImg || null;
    }

    function render(n) {
        const c = cards[n];
        const asset = sceneAsset(c);
        setBackdrop(asset, false);
        // One-film rule: when the scene's clip carries its own narration, the
        // picture and the voice ARE the storytelling - the overlay drops to a
        // lower-third kicker and the scrim thins (CSS .film-mode). Scenes
        // without a voiced clip keep the full card + baked narration.
        const voiced = !!(asset && voicedVids[asset]) && !playBlocked[asset];
        overlay.classList.toggle("film-mode", voiced);
        cardEl.innerHTML =
            '<div class="intro-anim">' +
            '<div class="kicker">' + c.kicker + "</div>" +
            "<h2>" + c.h2 + "</h2>" +
            (c.sub ? "<p>" + c.sub + "</p>" : "") +
            "</div>";
        if (A.tick) { try { A.tick(true); } catch (e) { /* audio optional */ } }
        if (voiced) {
            // Omni/Veo voiced clip: the film carries its own narration - no
            // baked take. The clip's `ended` event advances the card.
            wireVoicedAdvance();
        } else if (asset && probing[asset]) {
            // The clip probe is still in flight - HOLD rather than starting
            // the baked take with its short dwell timer (which would cut a
            // 10s clip at ~7s). When the probe settles, render(index) re-runs
            // and takes the right branch. DWELL_MAX is the only failsafe.
            const my = ++advanceToken;
            clearTimeout(timer);
            timer = setTimeout(() => { if (my === advanceToken && !done) next(); }, DWELL_MAX);
        } else {
            speakThenAdvance(c.vo || (c.h2 + " " + (c.sub || "")),
                asset ? NARR_BASE + asset.replace(/\.png$/, ".mp3") : null);
        }
        hintEl.textContent = "space / click to advance - esc to skip";
    }

    // The voice-over paces the film: a card holds while its line is spoken and
    // advances a beat after it ends. If narration is off (muted, no TTS), fall
    // back to a fixed dwell. A token guards against a stale onend firing after
    // the player has already advanced by hand.
    let advanceToken = 0;

    // Drive card advance from a voiced clip's own playback: bump the token
    // (invalidating any baked-narration timer), stop a baked take that may have
    // started during the race before the clip finished loading, then advance a
    // beat after the clip ends - with a hard cap so a stalled clip never
    // freezes the film.
    function wireVoicedAdvance() {
        const my = ++advanceToken;
        clearTimeout(timer);
        if (A.stopSpeaking) { try { A.stopSpeaking(); } catch (e) { /* narration optional */ } }
        timer = setTimeout(() => { if (my === advanceToken && !done) next(); }, VOICED_MAX);
        const vid = bgFront && bgFront.querySelector("video");
        if (vid) {
            vid.addEventListener("ended", () => {
                if (my !== advanceToken || done) return;
                clearTimeout(timer);
                timer = setTimeout(() => { if (my === advanceToken && !done) next(); }, 700);
            }, { once: true });
            vid.addEventListener("error", () => {
                if (my !== advanceToken || done) return;
                const c = cards[index];
                const asset = sceneAsset(c);
                if (asset) notifyVoicedBlocked(asset);
            }, { once: true });
        }
    }

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

    function setField(id, val) {
        const el = document.getElementById(id);
        if (!el) return;
        el.value = val;
        el.dispatchEvent(new Event("input", { bubbles: true }));
    }

    function show(n) {
        if (done) return;
        index = Math.max(0, Math.min(cards.length - 1, n));
        render(index);
    }

    function next() {
        if (index < cards.length - 1) show(index + 1);
        else dismiss(false, "pitch");
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
        // Hand off to the "first step" screen: trigger its entrance and start
        // the ambient pad as the film overlay fades away.
        if (focusTarget !== "begin") revealFirstStep();
        const finish = () => {
            overlay.style.display = "none";
            if (!focusTarget) return; // the game is already running underneath
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
        if (!started) {
            // Any forward key is the start gesture - it unlocks audio and
            // rolls the film from scene 1 (it must not skip ahead).
            if (e.key === " " || e.key === "Enter" || e.key === "ArrowRight") { e.preventDefault(); startFilm(); }
            return;
        }
        if (e.key === " " || e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); next(); }
        else if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
    }

    overlay.addEventListener("click", (e) => {
        if (e.target === skipBtn) return;
        if (!started) { startFilm(); return; }
        next();
    });
    if (skipBtn) skipBtn.addEventListener("click", (e) => { e.stopPropagation(); dismiss(false, "pitch"); });
    document.addEventListener("keydown", onKey);

    // Browsers gate audio autoplay until a gesture; unlock on first pointer.
    overlay.addEventListener("pointerdown", () => {
        if (A.unlock) { try { A.unlock(); } catch (e) { /* audio optional */ } }
    }, { once: true });

    // Browsers refuse unmuted playback until the player gestures, so the film
    // always opens behind one explicit "Begin" press - the press-start of the
    // game. We deliberately ALWAYS show this gate (even when the page already
    // saw a gesture, e.g. an in-page reload mid-demo): the click that dismisses
    // the gate is the fresh user activation that lets the film play UNMUTED.
    // Auto-starting without that press is what made the film silently skip.
    function startFilm() {
        if (started || done) return;
        started = true;
        overlay.classList.remove("gate");
        if (A.unlock) { try { A.unlock(); } catch (e) { /* audio optional */ } }
        show(0);
    }

    overlay.classList.add("gate");
    setBackdrop(cards[0].img, true); // dimmed first frame as the poster
    cardEl.innerHTML =
        '<div class="intro-anim">' +
        '<div class="kicker">A world-improvement campaign</div>' +
        "<h2>Gamifying World Improvement</h2>" +
        "<p>A hero's journey where you automate basic needs.</p>" +
        '<span class="intro-begin">&#9654;&ensp;Begin</span>' +
        "</div>";
    hintEl.innerHTML =
        '<span class="ih-credit">Microsoft Agents League &middot; Battle 2 &middot; Reasoning Agents</span>' +
        '<span class="ih-sep">&middot;</span>' +
        '<span class="ih-hint">sound on &middot; esc to skip</span>';
})();
