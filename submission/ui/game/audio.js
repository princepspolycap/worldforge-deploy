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

    // --- Generative music track ------------------------------------------
    // A slow ambient dungeon score synthesized at runtime: a four-chord minor
    // progression on detuned pads, a soft sub bass, and a sparse pentatonic
    // music-box melody. No audio files - it plays forever and never repeats
    // exactly. Runs on its own bus so narration can duck it.
    let musicOn = true;          // user preference (toggle in the HUD)
    let musicPlaying = false;    // scheduler state
    let musicGain = null;        // music bus -> masterGain
    let musicTimer = null;       // lookahead scheduler
    let musicStep = 0;           // current chord index
    let nextChordAt = 0;         // AudioContext time of next chord
    const MUSIC_LEVEL = 0.16;    // resting music level (duck target is lower)
    let duckedBy = 0;            // >0 while narration plays

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
    let serverAudio = null;       // current HTMLAudioElement playing narration
    let serverAudioToken = 0;     // cancels stale fetches/playbacks

    function probeServerTTS() {
        if (serverTTSProbed) return Promise.resolve(serverTTS);
        serverTTSProbed = true;
        return fetch("/api/tts/status")
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { serverTTS = !!(d && d.available); return serverTTS; })
            .catch(() => { serverTTS = false; return false; });
    }

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

    // --- Music engine ------------------------------------------------------
    // Chord progression in A natural minor: Am - F - C - G (i - VI - III - VII).
    // Frequencies are root/third/fifth in a low-mid register.
    const CHORDS = [
        [220.0, 261.63, 329.63],   // A minor
        [174.61, 220.0, 261.63],   // F major
        [130.81, 164.81, 196.0],   // C major
        [196.0, 246.94, 293.66],   // G major
    ];
    const BASS = [55.0, 43.65, 65.41, 49.0]; // A1, F1, C2, G1
    // A-minor pentatonic for the sparse melody line, one octave up.
    const PENTA = [440.0, 523.25, 587.33, 659.25, 783.99];
    const CHORD_SECONDS = 7.5;

    function ensureMusicBus() {
        const c = ensureContext();
        if (!c) return null;
        if (!musicGain) {
            musicGain = c.createGain();
            musicGain.gain.value = 0.0001;
            musicGain.connect(masterGain);
        }
        return c;
    }

    // One pad chord: detuned triangle pair per note through a gentle lowpass.
    function schedulePad(chord, when, dur) {
        const c = ctx;
        const lp = c.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 900;
        lp.Q.value = 0.4;
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, when);
        g.gain.linearRampToValueAtTime(0.16, when + dur * 0.35);
        g.gain.linearRampToValueAtTime(0.0001, when + dur + 0.4);
        lp.connect(g);
        g.connect(musicGain);
        chord.forEach((f) => {
            [-4, 4].forEach((cents) => {
                const o = c.createOscillator();
                o.type = "triangle";
                o.frequency.value = f;
                o.detune.value = cents;
                o.connect(lp);
                o.start(when);
                o.stop(when + dur + 0.6);
            });
        });
    }

    function scheduleBass(freq, when, dur) {
        const c = ctx;
        const o = c.createOscillator();
        o.type = "sine";
        o.frequency.value = freq;
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, when);
        g.gain.linearRampToValueAtTime(0.11, when + 0.6);
        g.gain.linearRampToValueAtTime(0.0001, when + dur);
        o.connect(g);
        g.connect(musicGain);
        o.start(when);
        o.stop(when + dur + 0.2);
    }

    // Sparse music-box notes: 0-2 per chord, random pentatonic picks.
    function scheduleMelody(when, dur) {
        const c = ctx;
        const count = Math.random() < 0.45 ? 0 : Math.random() < 0.75 ? 1 : 2;
        for (let i = 0; i < count; i++) {
            const f = PENTA[Math.floor(Math.random() * PENTA.length)];
            const t = when + 0.8 + Math.random() * (dur - 2.2);
            const o = c.createOscillator();
            o.type = "sine";
            o.frequency.value = f;
            const g = c.createGain();
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(0.055, t + 0.03);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
            o.connect(g);
            g.connect(musicGain);
            o.start(t);
            o.stop(t + 2.6);
        }
    }

    // Lookahead scheduler: keep ~2 chords queued ahead of the clock.
    function musicTick() {
        if (!musicPlaying || !ctx) return;
        while (nextChordAt < ctx.currentTime + CHORD_SECONDS * 2) {
            const chord = CHORDS[musicStep % CHORDS.length];
            schedulePad(chord, nextChordAt, CHORD_SECONDS);
            scheduleBass(BASS[musicStep % BASS.length], nextChordAt, CHORD_SECONDS);
            scheduleMelody(nextChordAt, CHORD_SECONDS);
            nextChordAt += CHORD_SECONDS;
            musicStep += 1;
        }
        musicTimer = setTimeout(musicTick, 1500);
    }

    function musicTargetLevel() {
        return duckedBy > 0 ? MUSIC_LEVEL * 0.35 : MUSIC_LEVEL;
    }

    function applyMusicLevel(ramp) {
        if (!ctx || !musicGain) return;
        const target = musicPlaying ? musicTargetLevel() : 0.0001;
        musicGain.gain.setTargetAtTime(target, ctx.currentTime, ramp ?? 0.4);
    }

    // Narration ducking: lower the score while a voice line plays.
    function duck(on) {
        duckedBy = Math.max(0, duckedBy + (on ? 1 : -1));
        applyMusicLevel(on ? 0.15 : 0.8);
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

        // --- Music -------------------------------------------------------
        // Start the ambient score (no-op if already playing or toggled off).
        musicStart() {
            if (!musicOn || musicPlaying) return;
            const c = ensureMusicBus();
            if (!c) return;
            musicPlaying = true;
            nextChordAt = Math.max(nextChordAt, c.currentTime + 0.1);
            applyMusicLevel(1.2);
            musicTick();
        },

        musicStop() {
            musicPlaying = false;
            if (musicTimer) { clearTimeout(musicTimer); musicTimer = null; }
            applyMusicLevel(0.5);
        },

        musicEnabled() { return musicOn; },

        toggleMusic() {
            musicOn = !musicOn;
            if (!musicOn) this.musicStop();
            else this.musicStart();
            return musicOn;
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
            duck(true);
            const myToken = ++serverAudioToken;
            const userOnEnd = opts && opts.onend;
            const wrapped = Object.assign({}, opts, {
                onend: () => {
                    duck(false);
                    if (typeof userOnEnd === "function") userOnEnd();
                },
            });

            // Try the server neural voice first (once probed). If the probe has
            // not run yet, kick it off and use the browser voice this time so
            // the first beat is never delayed.
            if (serverTTS) {
                this._speakServer(clean, myToken, wrapped);
            } else {
                this._speakBrowser(clean, wrapped);
                if (!serverTTSProbed) probeServerTTS();
            }
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
                    if (opts && typeof opts.onend === "function") a.addEventListener("ended", opts.onend);
                    serverAudio = a;
                    a.play().catch(() => this._speakBrowser(clean, opts));
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
            if (opts && typeof opts.onend === "function") u.onend = opts.onend;
            try { TTS.speak(u); } catch (e) { /* narration optional */ }
        },

        stopSpeaking() {
            serverAudioToken++;
            if (duckedBy > 0) { duckedBy = 0; applyMusicLevel(0.8); }
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
