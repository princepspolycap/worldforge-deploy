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

    const DWELL = 6800; // ms a card holds before auto-advancing (room for narration)

    // The lore arc: premise -> the impossible vision -> the only way to get
    // there -> the mechanism (an agency of digital workers) -> the fair-data
    // flywheel -> how it reasons (Foundry) -> why you can trust it -> your turn.
    // The final card (kind: "choice") hands the player two missions to carve.
    const cards = [
        {
            kicker: "Microsoft Agents League - Battle 2 - Reasoning Agents",
            h2: "Your Company Is the Dungeon",
            p: "A reasoning RPG, built on Microsoft Foundry. Let it play - or press space to move faster.",
        },
        {
            kicker: "The premise",
            h2: "Every company is two companies.",
            p: "One is the handful of people who decide. The other is all the work that has to get done. For the first time, that second company can be made of <span class='accent'>agents</span>.",
        },
        {
            kicker: "Your seat",
            h2: "You are the CEO - and you want the impossible.",
            p: "Terraform the Sahara. Build new cities where there is only sand. It is too big to command into existence - so how could anyone actually do it?",
        },
        {
            kicker: "The only way",
            h2: "You cannot command a billion people. You align them.",
            p: "Automate the <span class='accent'>production and distribution of basic needs</span> - food, water, energy, shelter - and a billion humans, and their AI, finally have a reason to pull the same way.",
        },
        {
            kicker: "The mechanism",
            h2: "So you build an agency of digital workers.",
            p: "Every person with a skill <span class='accent'>binds it to a digital worker</span> that does the execution. Their experience becomes a business that runs while they sleep - income they earn, not income they wait for.",
        },
        {
            kicker: "The flywheel",
            h2: "And everyone gets paid - fairly.",
            p: "The platform learns from <span class='accent'>real people doing real work</span>, paid evenly - not scraped the way today's models were. Even a superintelligence still needs the grassroots: a million humans who know what it cannot.",
        },
        {
            kicker: "How it thinks",
            h2: "Every agent that reasons runs on Foundry.",
            p: "<span class='accent'>Foundry IQ</span> for memory, a <span class='accent'>code interpreter</span> for checks it cannot fake, and <span class='accent'>multi-agent orchestration</span> that turns them into a team.",
        },
        {
            kicker: "Why you can trust it",
            h2: "A human stays at the root of everything.",
            p: "No artifact counts until you approve it at a <span class='accent'>verification gate</span>. That one rule is the difference between a colleague and a slop machine.",
        },
        {
            kicker: "Your turn",
            h2: "The vision is the CEO's. The path is yours.",
            p: "You bring the skill and the judgment. Your <span class='accent'>agent workforce</span> brings the execution. Pick the front you want to carve - and make it yours.",
        },
        { kind: "choice" },
    ];

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
        cardEl.innerHTML =
            '<div class="intro-anim">' +
            '<div class="kicker">' + c.kicker + "</div>" +
            "<h2>" + c.h2 + "</h2>" +
            "<p>" + c.p + "</p>" +
            "</div>";
        if (A.tick) { try { A.tick(true); } catch (e) { /* audio optional */ } }
        if (A.speak) { try { A.speak(c.h2 + ". " + c.p, { voice: "onyx" }); } catch (e) { /* narration optional */ } }
        hintEl.textContent = "space / click to advance - esc to skip";
    }

    function renderChoice() {
        cardEl.innerHTML =
            '<div class="intro-anim">' +
            '<div class="kicker">Choose your front</div>' +
            "<h2>Where do you point the workforce?</h2>" +
            "<p>Two fronts, one workforce. Pick the mission your agents build toward - or bring your own.</p>" +
            '<div class="intro-skill">' +
            "<label>Your edge (optional)</label>" +
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
        if (A.speak) { try { A.speak("Where do you point the workforce? Two fronts, one workforce. Press one to automate basic needs, or two to terraform the Sahara.", { voice: "onyx" }); } catch (e) { /* narration optional */ } }
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
        clearTimeout(timer);
        if (index < cards.length - 1) {
            timer = setTimeout(() => show(index + 1), DWELL);
        }
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
