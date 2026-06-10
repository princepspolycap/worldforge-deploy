// Synthesized game audio for "Your Company Is the Dungeon".
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

    let ctx = null;
    let masterGain = null;
    let muted = false;
    let thinkingNodes = null; // active "thinking" loop, if any

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
        masterGain.gain.value = muted ? 0 : 0.5;
        masterGain.connect(ctx.destination);
        return ctx;
    }

    // Play a single tone. freq Hz, dur seconds, type waveform, gain 0-1.
    function tone(freq, dur, type, gain, when) {
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

    const DungeonAudio = {
        // Called from a user gesture (e.g. launch click) to unlock audio.
        unlock() {
            ensureContext();
            probeServerTTS();
        },

        isMuted() {
            return muted;
        },

        setMuted(value) {
            muted = !!value;
            if (masterGain && ctx) {
                masterGain.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.02);
            }
            if (muted) this.stopSpeaking();
            return muted;
        },

        toggleMute() {
            return this.setMuted(!muted);
        },

        // --- Narration -------------------------------------------------
        // True if narration can happen at all (server OR browser).
        canSpeak() { return !!TTS || serverTTS; },

        // Speak a line of narration. Prefers real Azure neural TTS via the
        // server (/api/tts); falls back to the browser voice if the server is
        // unavailable or errors. Cancels any in-flight speech so beats never
        // overlap. Markup is stripped so HTML accents are not read aloud.
        speak(text, opts) {
            if (muted || !narrationOn) return null;
            const clean = stripMarkup(text);
            if (!clean) return null;

            this.stopSpeaking();
            const myToken = ++serverAudioToken;

            // Wait for the availability probe (already in flight since load;
            // resolves in milliseconds) so the very first line gets the neural
            // voice. Only fall back to the browser voice when the server is
            // genuinely unavailable - never just because of a race.
            probeServerTTS().then((available) => {
                if (myToken !== serverAudioToken || muted || !narrationOn) return;
                if (available) this._speakServer(clean, myToken, opts);
                else this._speakBrowser(clean, opts);
            });
            return null;
        },

        // Fetch MP3 from the server and play it; fall back to browser on error.
        _speakServer(clean, myToken, opts) {
            fetch("/api/tts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: clean, voice: (opts && opts.voice) || null }),
            })
                .then((r) => { if (!r.ok) throw new Error("tts " + r.status); return r.blob(); })
                .then((blob) => {
                    if (myToken !== serverAudioToken || muted || !narrationOn) return;
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
                })
                .catch(() => { if (myToken === serverAudioToken) this._speakBrowser(clean, opts); });
        },

        // Browser SpeechSynthesis voice (offline-safe fallback).
        _speakBrowser(clean, opts) {
            if (!TTS) return;
            try { TTS.cancel(); } catch (e) { /* ignore */ }
            const u = new SpeechSynthesisUtterance(clean);
            if (chosenVoice) u.voice = chosenVoice;
            u.rate = (opts && opts.rate) || 0.98;
            u.pitch = (opts && opts.pitch) || 1.0;
            u.volume = (opts && opts.volume) || 1.0;
            if (opts && typeof opts.onend === "function") { u.onend = opts.onend; u.onerror = opts.onend; }
            try { TTS.speak(u); } catch (e) { /* narration optional */ }
        },

        stopSpeaking() {
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

        // A low, slow pulse loop while an agent is reasoning (the live call).
        thinkingStart() {
            const c = ensureContext();
            if (!c || thinkingNodes) return;
            const osc = c.createOscillator();
            const lfo = c.createOscillator();
            const lfoGain = c.createGain();
            const g = c.createGain();
            osc.type = "sine";
            osc.frequency.value = 110; // low hum
            lfo.type = "sine";
            lfo.frequency.value = 2.2;  // pulse rate
            lfoGain.gain.value = 0.04;
            g.gain.value = 0.0001;
            lfo.connect(lfoGain);
            lfoGain.connect(g.gain);
            osc.connect(g);
            g.connect(masterGain);
            g.gain.setTargetAtTime(0.05, c.currentTime, 0.1);
            osc.start();
            lfo.start();
            thinkingNodes = { osc, lfo, g };
        },

        thinkingStop() {
            const c = ensureContext();
            if (!c || !thinkingNodes) return;
            const { osc, lfo, g } = thinkingNodes;
            thinkingNodes = null;
            g.gain.setTargetAtTime(0.0001, c.currentTime, 0.08);
            const stopAt = c.currentTime + 0.25;
            try { osc.stop(stopAt); lfo.stop(stopAt); } catch (_) {}
        },

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
    };

    window.DungeonAudio = DungeonAudio;
})();
