// Synthesized game audio for "Gamifying World Improvement".
//
// Pure Web Audio API: every sound is generated from oscillators at runtime, so
// there are zero audio files, zero licensing risk, and it runs offline after a
// fresh git clone. Cues are bound to the streamed reasoning phases (thinking
// pulse during the live Foundry call, a tick per validator check, a chime on a
// passing score) so the audio narrates the agent's reasoning rather than just
// decorating the UI.
//
// Browser autoplay policy: the AudioContext can only start after a user
// gesture, so we lazily create/resume it on the first interaction.

(function () {
    "use strict";

    // ============================================================
    // AUDIO CONTROL CENTER - the single place to tune all game sound.
    // Change values HERE; no other file needs editing.
    //
    //  - masterVolume : overall loudness (0..1).
    //  - cues         : short UI/game sounds (clicks, seals, ticks, chimes).
    //  - music        : an OPTIONAL looping background track. OFF by default so
    //                   the committed game ships file-free, offline-safe, and
    //                   with no background drone. To use a Suno-made cinematic
    //                   harp theme (Ori-style), drop the file at `src` (local
    //                   only / gitignored) and set enabled:true. If the file is
    //                   missing it silently does nothing - never breaks a fork.
    // ============================================================
    const AUDIO = {
        masterVolume: 0.5,
        cues: true,
        music: {
            enabled: false,
            src: "/game/assets/local/audio/theme.mp3",
            volume: 0.32,
            loop: true,
        },
    };

    let ctx = null;
    let masterGain = null;
    let muted = false;
    let musicEl = null; // optional <audio> background track, if configured

    // --- Narration (Text-to-Speech) -------------------------------------
    // Uses the browser SpeechSynthesis API: no audio files, no API keys, no
    // network - so narration works offline after a fresh git clone and cannot
    // fail on stage. Voice selection prefers a natural local English voice.
    const TTS = window.speechSynthesis || null;
    let narrationOn = true;
    let chosenVoice = null;
    let voicesReady = false;

    // Server-side Azure neural TTS (gpt-4o-mini-tts). Preferred when available;
    // we probe /api/tts/status once and fall back to the browser voice if the
    // server cannot synthesize (offline fork, error, or unconfigured).
    let serverTTS = false;
    let serverTTSProbed = false;
    let serverTTSPromise = null; // in-flight probe - speak() awaits this
    let serverAudio = null;       // current HTMLAudioElement playing narration
    let serverAudioToken = 0;     // cancels stale fetches/playbacks
    let speechSettle = null;      // resolves the current speak()'s done-promise

    function probeServerTTS() {
        if (serverTTSProbed) return serverTTSPromise || Promise.resolve(serverTTS);
        serverTTSProbed = true;
        serverTTSPromise = fetch("/api/tts/status")
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { serverTTS = !!(d && d.available); return serverTTS; })
            .catch(() => { serverTTS = false; return false; });
        return serverTTSPromise;
    }
    // Probe immediately at load (a plain fetch needs no user gesture) so the
    // very first narrated line already uses the neural voice instead of
    // racing into the robotic browser fallback.
    probeServerTTS();

    function pickVoice() {
        if (!TTS) return null;
        const voices = TTS.getVoices() || [];
        if (!voices.length) return null;
        voicesReady = true;
        // Prefer known high-quality natural English voices, in order.
        const preferred = [
            "Google UK English Male", "Google US English", "Microsoft Guy Online",
            "Microsoft Aria Online", "Samantha", "Daniel", "Karen", "Alex",
        ];
        for (const name of preferred) {
            const v = voices.find((x) => x.name === name);
            if (v) return v;
        }
        // Otherwise the first local en-* voice, then any en-* voice.
        return voices.find((v) => /^en[-_]/i.test(v.lang) && v.localService)
            || voices.find((v) => /^en[-_]/i.test(v.lang))
            || voices[0];
    }

    if (TTS) {
        chosenVoice = pickVoice();
        // Voices often load asynchronously; refine the pick when they arrive.
        TTS.addEventListener && TTS.addEventListener("voiceschanged", () => {
            chosenVoice = pickVoice();
        });
    }

    function stripMarkup(text) {
        return String(text || "")
            .replace(/<[^>]*>/g, " ")     // drop any HTML tags (intro accents)
            .replace(/&[a-z]+;/gi, " ")   // drop entities like &rarr;
            .replace(/\s+/g, " ")
            .trim();
    }

    function ensureContext() {
        if (ctx) {
            if (ctx.state === "suspended") ctx.resume();
            return ctx;
        }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        masterGain = ctx.createGain();
        masterGain.gain.value = muted ? 0 : AUDIO.masterVolume;
        masterGain.connect(ctx.destination);
        return ctx;
    }

    // Play a single tone. freq Hz, dur seconds, type waveform, gain 0-1.
    function tone(freq, dur, type, gain, when) {
        if (!AUDIO.cues) return;
        const c = ensureContext();
        if (!c) return;
        const start = when ?? c.currentTime;
        const osc = c.createOscillator();
        const g = c.createGain();
        osc.type = type || "sine";
        osc.frequency.setValueAtTime(freq, start);
        // Soft attack + exponential release to avoid clicks.
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain ?? 0.2), start + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
        osc.connect(g);
        g.connect(masterGain);
        osc.start(start);
        osc.stop(start + dur + 0.02);
    }

    function arpeggio(freqs, step, type, gain) {
        const c = ensureContext();
        if (!c) return;
        freqs.forEach((f, i) => tone(f, step * 1.6, type || "triangle", gain ?? 0.18, c.currentTime + i * step));
    }

    const CampaignAudio = {
        // Called from a user gesture (e.g. launch click) to unlock audio.
        unlock() {
            ensureContext();
            probeServerTTS();
        },

        isMuted() {
            return muted;
        },

        isUnlocked() {
            return !!(ctx && ctx.state === "running");
        },

        setMuted(value) {
            muted = !!value;
            if (masterGain && ctx) {
                masterGain.gain.setTargetAtTime(muted ? 0 : AUDIO.masterVolume, ctx.currentTime, 0.02);
            }
            if (musicEl) musicEl.muted = muted;
            if (muted) this.stopSpeaking();
            return muted;
        },

        toggleMute() {
            return this.setMuted(!muted);
        },

        // --- Narration -------------------------------------------------
        // True if narration can happen at all (server OR browser).
        canSpeak() { return !!TTS || serverTTS; },

        // Speak a line of narration. Plays a pre-baked take (opts.baked, a
        // URL to a curated mp3) when one ships with the repo; otherwise
        // prefers real Azure neural TTS via the server (/api/tts); falls back
        // to the browser voice if the server is unavailable or errors.
        // Cancels any in-flight speech so beats never overlap. Markup is
        // stripped so HTML accents are not read aloud.
        // Returns a promise that resolves when THIS line finishes playing
        // (ended, error, or cancellation) so callers can pace beats on the
        // voice instead of cutting it mid-sentence.
        speak(text, opts) {
            if (muted || !narrationOn) return Promise.resolve();
            const clean = stripMarkup(text);
            if (!clean) return Promise.resolve();

            this.stopSpeaking();
            const myToken = ++serverAudioToken;
            let settle;
            const done = new Promise((resolve) => { settle = resolve; });
            speechSettle = settle;
            const userOnEnd = opts && opts.onend;
            const o = Object.assign({}, opts, {
                onend: () => { settle(); if (typeof userOnEnd === "function") userOnEnd(); },
            });

            // Curated takes ship as files - instant, deterministic, directed.
            if (o.baked) {
                this._speakBaked(clean, myToken, o);
                return done;
            }

            // Wait for the availability probe (already in flight since load;
            // resolves in milliseconds) so the very first line gets the neural
            // voice. Only fall back to the browser voice when the server is
            // genuinely unavailable - never just because of a race.
            probeServerTTS().then((available) => {
                if (myToken !== serverAudioToken || muted || !narrationOn) return;
                if (available) this._speakServer(clean, myToken, o);
                else this._speakBrowser(clean, o);
            });
            return done;
        },

        // Play a curated narration file; degrade to live TTS if it is missing
        // (fresh fork before baking) or fails to decode/play.
        _speakBaked(clean, myToken, opts) {
            const fallBack = () => {
                if (myToken !== serverAudioToken || muted || !narrationOn) return;
                probeServerTTS().then((available) => {
                    if (myToken !== serverAudioToken || muted || !narrationOn) return;
                    if (available) this._speakServer(clean, myToken, opts);
                    else this._speakBrowser(clean, opts);
                });
            };
            fetch(opts.baked)
                .then((r) => {
                    if (!r.ok) throw new Error("baked " + r.status);
                    const type = r.headers.get("content-type") || "";
                    if (!/audio|octet-stream|mpeg/.test(type)) throw new Error("baked type " + type);
                    return r.blob();
                })
                .then((blob) => {
                    if (myToken !== serverAudioToken || muted || !narrationOn) return;
                    this._playBlob(blob, myToken, opts);
                })
                .catch(fallBack);
        },

        // Shared playback for narration blobs (baked files and server TTS).
        _playBlob(blob, myToken, opts) {
            const url = URL.createObjectURL(blob);
            const a = new Audio(url);
            a.volume = (opts && opts.volume) || 1.0;
            a.onended = a.onerror = () => URL.revokeObjectURL(url);
            if (opts && typeof opts.onend === "function") {
                a.addEventListener("ended", opts.onend);
                a.addEventListener("error", opts.onend);
            }
            serverAudio = a;
            // If playback is blocked (no user gesture yet), stay silent
            // rather than degrading to the robotic browser voice - the
            // film paces itself on the dwell fallback instead.
            a.play().catch(() => {
                if (opts && typeof opts.onend === "function") opts.onend();
            });
        },

        // Fetch MP3 from the server and play it; fall back to browser on error.
        _speakServer(clean, myToken, opts) {
            fetch("/api/tts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    text: clean,
                    voice: (opts && opts.voice) || null,
                    instructions: (opts && opts.instructions) || null,
                }),
            })
                .then((r) => { if (!r.ok) throw new Error("tts " + r.status); return r.blob(); })
                .then((blob) => {
                    if (myToken !== serverAudioToken || muted || !narrationOn) return;
                    this._playBlob(blob, myToken, opts);
                })
                .catch(() => { if (myToken === serverAudioToken) this._speakBrowser(clean, opts); });
        },

        // Browser SpeechSynthesis voice (offline-safe fallback).
        _speakBrowser(clean, opts) {
            if (!TTS) {
                if (opts && typeof opts.onend === "function") opts.onend();
                return;
            }
            try { TTS.cancel(); } catch (e) { /* ignore */ }
            const u = new SpeechSynthesisUtterance(clean);
            if (chosenVoice) u.voice = chosenVoice;
            u.rate = (opts && opts.rate) || 0.98;
            u.pitch = (opts && opts.pitch) || 1.0;
            u.volume = (opts && opts.volume) || 1.0;
            if (opts && typeof opts.onend === "function") {
                u.onend = opts.onend;
                u.onerror = opts.onend;
                // Watchdog: some engines accept an utterance but never speak
                // (no voices, OS-muted assistive audio). If speech has not
                // STARTED within 1.2s, report done so pacing never stalls on
                // silence - under intro.js's 1.5s "never really played"
                // threshold, so the film keeps its reading-pace fallback.
                const watchdog = setTimeout(() => { try { opts.onend(); } catch (_) {} }, 1200);
                u.onstart = () => clearTimeout(watchdog);
            }
            try { TTS.speak(u); } catch (e) { /* narration optional */ }
        },

        stopSpeaking() {
            // Settle the in-flight speak() promise (cancellation counts as
            // done) so no caller can deadlock waiting on a cancelled line.
            if (speechSettle) { const s = speechSettle; speechSettle = null; s(); }
            serverAudioToken++;
            if (serverAudio) {
                try { serverAudio.pause(); } catch (e) { /* ignore */ }
                serverAudio = null;
            }
            if (!TTS) return;
            try { TTS.cancel(); } catch (e) { /* ignore */ }
        },

        setNarration(on) {
            narrationOn = !!on;
            if (!narrationOn) this.stopSpeaking();
            return narrationOn;
        },

        narrationEnabled() { return narrationOn && (!!TTS || serverTTS); },

        // Reasoning indicator. Deliberately SILENT: a sustained low hum gave
        // listeners a headache, so there is no background drone. The visual
        // "thinking" cues (pulse dot, ticks per validator check) carry it
        // instead. Kept as no-ops so existing callers stay valid.
        thinkingStart() { /* intentionally silent - no background hum */ },
        thinkingStop() { /* intentionally silent - no background hum */ },

        // Short tick when a deterministic validator check lands.
        tick(passed) {
            tone(passed === false ? 320 : 880, 0.07, "square", 0.10);
        },

        // Rising chime when the artifact passes scoring.
        chime() {
            arpeggio([660, 880, 1175], 0.08, "triangle", 0.16);
        },

        // Success cue on artifact approval.
        approve() {
            arpeggio([523, 659, 784], 0.07, "triangle", 0.18);
        },

        // Bright fanfare when the founder levels up.
        levelUp() {
            arpeggio([523, 659, 784, 1046], 0.09, "sawtooth", 0.16);
        },

        // Soft descending buzz on rejection.
        reject() {
            tone(220, 0.16, "sawtooth", 0.16);
            tone(165, 0.22, "sawtooth", 0.14, (ctx ? ctx.currentTime : 0) + 0.1);
        },

        // Triumphant run when the whole quest line completes.
        complete() {
            arpeggio([523, 659, 784, 1046, 1318], 0.11, "triangle", 0.18);
        },

        // --- UI cues (intro / first step) ------------------------------
        // Soft high shimmer when the eye lands on the primary button.
        uiHover() {
            tone(1320, 0.05, "sine", 0.05);
            tone(1760, 0.06, "sine", 0.035, (ctx ? ctx.currentTime : 0) + 0.02);
        },

        // Warm confirming swell the moment the journey begins (Begin press).
        uiPress() {
            arpeggio([392, 523, 659, 784], 0.075, "triangle", 0.16);
            tone(196, 0.4, "sine", 0.12);
        },

        // --- Deck / roguelike cues -------------------------------------
        // These frame the game as a roguelike deckbuilder (see docs/ui_revamp).
        // Soft riffle as a worker-card is dealt onto the stage (a character
        // joining the party / the org drafting a worker).
        cardDraw() {
            arpeggio([523, 698, 880], 0.045, "triangle", 0.10);
            tone(1320, 0.05, "sine", 0.04, (ctx ? ctx.currentTime : 0) + 0.13);
        },

        // Tiny soft tick when the pointer lands on a character card.
        cardHover() {
            tone(1046, 0.045, "sine", 0.045);
        },

        // Warm resonant press - the gold seal landing on an approved artifact
        // at a verification gate (richer + heavier than the light chime).
        seal() {
            tone(330, 0.5, "sine", 0.14);
            arpeggio([523, 659, 880], 0.09, "triangle", 0.17);
        },

        // A quiet two-note marker when the conversation turns to a new speaker
        // (the infinite-conversation handoff between characters).
        turnCue() {
            tone(587, 0.06, "sine", 0.06);
            tone(784, 0.08, "sine", 0.05, (ctx ? ctx.currentTime : 0) + 0.05);
        },

        // --- Background music (single control: AUDIO.music) ------------
        // Background music. Driven entirely by the AUDIO.music control center
        // at the top of this file. OFF by default - the committed game ships
        // file-free with NO background drone (the old synth pad caused a hum).
        // When AUDIO.music.enabled is true and the file at AUDIO.music.src
        // exists (a local-only Suno harp theme, etc.), it loops softly; a
        // missing file or a blocked autoplay just stays silent - never breaks.
        // `ambientStart`/`ambientStop` keep their old names so existing callers
        // (intro hand-off, run start) still work as music start/stop.
        ambientStart() {
            if (!AUDIO.music.enabled || muted) return;
            if (musicEl) { try { musicEl.play().catch(() => {}); } catch (e) { /* ok */ } return; }
            try {
                const a = new Audio(AUDIO.music.src);
                a.loop = !!AUDIO.music.loop;
                a.volume = AUDIO.music.volume;
                a.muted = muted;
                a.addEventListener("error", () => { musicEl = null; }); // missing file: stay silent
                musicEl = a;
                a.play().catch(() => { /* autoplay blocked: stays silent until next gesture */ });
            } catch (e) { musicEl = null; }
        },

        ambientStop() {
            if (!musicEl) return;
            try { musicEl.pause(); musicEl.currentTime = 0; } catch (e) { /* ok */ }
        },
    };

    window.CampaignAudio = CampaignAudio;
    window.DungeonAudio = CampaignAudio;
})();
