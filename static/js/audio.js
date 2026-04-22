// audio.js — Audio subsystem lifecycle module
// Owns: audioCtx, masterGain, _sources, _processors, melodyTimer, _musicOn
// Invariant: stopMusic() always clears all node references in a finally block.
// External code accesses audio through the `audio` object — never touches nodes directly.
const audio = (() => {
    let audioCtx = null, masterGain = null, melodyTimer = null, _musicOn = true;
    let _sources = [], _processors = [];
    let _melodyWet = null, _melodyDry = null;
    let menuMusicBus = null, menuSfxBus = null;
    let _menuMusicNodes = [], _menuMusicTimerHandle = null;

    // AUDIT: possibly dead — no-op stubs for future battle music; remove if battle music is not planned — confirm before deleting
    eventBus.on('battle:start', () => { /* future: battle music intensify */ });
    eventBus.on('battle:end',   () => { /* future: resume ambient */ });

    const MUSIC_FADE_MS = 40;
    const SCALE_VILLAGE = [110,123.47,130.81,146.83,164.81,174.61,196,220,246.94,261.63,293.66,329.63,349.23,392,440];
    const SCALE_DUNGEON = [110,116.54,130.81,138.59,164.81,174.61,185,220,233.08,261.63,277.18,329.63,349.23,370,440];

    function _startDrone(f, out) {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = 'sine'; o.frequency.value = f; g.gain.value = 0.055;
        o.connect(g); g.connect(out); o.start();
        _sources.push(o); _processors.push(g);
    }

    function _startWind(out) {
        const len = audioCtx.sampleRate * 3, buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        const src = audioCtx.createBufferSource(); src.buffer = buf; src.loop = true;
        const flt = audioCtx.createBiquadFilter(); flt.type = 'bandpass'; flt.frequency.value = 400; flt.Q.value = 0.5;
        const wg = audioCtx.createGain(); wg.gain.value = 0.04;
        const lfo = audioCtx.createOscillator(), lfog = audioCtx.createGain();
        lfo.frequency.value = 0.06; lfog.gain.value = 0.03;
        lfo.connect(lfog); lfog.connect(wg.gain); lfo.start();
        src.connect(flt); flt.connect(wg); wg.connect(out); src.start();
        _sources.push(src, lfo); _processors.push(flt, wg, lfog);
    }

    function _playNote(freq, wet, dry) {
        const now = audioCtx.currentTime, o = audioCtx.createOscillator(), e = audioCtx.createGain();
        o.type = 'sine'; o.frequency.value = freq;
        e.gain.setValueAtTime(0, now);
        e.gain.linearRampToValueAtTime(0.18, now + 0.05);
        e.gain.exponentialRampToValueAtTime(0.001, now + 4.5);
        o.connect(e); e.connect(wet); e.connect(dry);
        o.start(now); o.stop(now + 4.6);
    }

    function _stopMelody() {
        clearInterval(melodyTimer);
        melodyTimer = null;
    }

    function _scheduleMelody(wet, dry) {
        _stopMelody();
        _melodyWet = wet; _melodyDry = dry;
        if (window.location.hostname === 'localhost') {
            console.assert(melodyTimer === null, 'scheduleMelody: re-entry guard failed');
        }
        const scale = window.currentMap?.dark ? SCALE_DUNGEON : SCALE_VILLAGE;
        [scale[0], scale[2], scale[4]].forEach(f => _playNote(f, wet, dry));
        melodyTimer = setInterval(() => {
            if (!audioCtx || audioCtx.state === 'closed') return;
            const sc = window.currentMap?.dark ? SCALE_DUNGEON : SCALE_VILLAGE;
            const n = Math.random() < 0.25 ? 2 : 1;
            for (let i = 0; i < n; i++) _playNote(sc[Math.floor(Math.random() * sc.length)], wet, dry);
        }, 2800 + Math.random() * 2000);
    }

    // Creates audioCtx + menu gain buses without starting game music.
    // Idempotent — safe to call multiple times. Must be called from a user gesture.
    function init() {
        if (audioCtx && audioCtx.state !== 'closed') {
            if (audioCtx.state === 'suspended') audioCtx.resume();
            return;
        }
        audioCtx = new (window.AudioContext || window['webkitAudioContext'])();
        menuMusicBus = audioCtx.createGain();
        menuMusicBus.gain.value = ((window.gameVolumePct ?? 50) / 100) * 0.4;
        menuMusicBus.connect(audioCtx.destination);
        menuSfxBus = audioCtx.createGain();
        menuSfxBus.gain.value = ((window.gameSfxVolumePct ?? 70) / 100) * 0.5;
        menuSfxBus.connect(audioCtx.destination);
    }

    function startMusic() {
        if (masterGain) return;
        init();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        masterGain = audioCtx.createGain();
        masterGain.gain.value = ((window.gameVolumePct ?? 50) / 100) * 0.25;
        const delay = audioCtx.createDelay(3); delay.delayTime.value = 0.45;
        const fb = audioCtx.createGain(); fb.gain.value = 0.42;
        const lpf = audioCtx.createBiquadFilter(); lpf.type = 'lowpass'; lpf.frequency.value = 1800;
        delay.connect(lpf); lpf.connect(fb); fb.connect(delay);
        delay.connect(masterGain); masterGain.connect(audioCtx.destination);
        _processors.push(masterGain, delay, fb, lpf);
        _startWind(masterGain); _startDrone(55, masterGain);
        _scheduleMelody(delay, masterGain);
    }

    function stopMusic() {
        _stopMelody();
        if (!audioCtx || (!masterGain && _sources.length === 0)) return;
        const now = audioCtx.currentTime;
        const fadeS = MUSIC_FADE_MS / 1000;
        try {
            if (masterGain) {
                masterGain.gain.cancelScheduledValues(now);
                masterGain.gain.setValueAtTime(masterGain.gain.value, now);
                masterGain.gain.linearRampToValueAtTime(0, now + fadeS);
            }
            _sources.forEach(src => {
                try { src.stop(now + fadeS); } catch (e) {
                    if (!(e instanceof DOMException && e.name === 'InvalidStateError')) console.error('[audio] stop() error', e);
                }
                try { src.disconnect(); } catch (_) {}
            });
            _processors.forEach(n => { try { n.disconnect(); } catch (_) {} });
        } finally {
            _sources = []; _processors = []; masterGain = null;
        }
    }

    // Sets gain from a 0-100 percentage; no-op if audio not started.
    function setVolume(pct) {
        if (!masterGain) return;
        masterGain.gain.value = (pct / 100) * 0.25;
    }

    // Suspends audioCtx and stops melody scheduling (called on pause).
    function suspend() {
        if (audioCtx && audioCtx.state === 'running') audioCtx.suspend();
        _stopMelody();
    }

    // Resumes audioCtx and reschedules melody (called on unpause).
    function resume() {
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        if (masterGain && _melodyWet && _musicOn) _scheduleMelody(_melodyWet, _melodyDry);
    }

    // Toggles music on/off; returns the new on-state.
    function toggle() {
        _musicOn = !_musicOn;
        _musicOn ? startMusic() : stopMusic();
        return _musicOn;
    }

    function isOn() { return _musicOn; }

    function startMenuMusic() {
        if (_menuMusicNodes.length) return;
        if (!audioCtx || audioCtx.state !== 'running') return;
        const bus = menuMusicBus;

        [41, 55].forEach(f => {
            const o = audioCtx.createOscillator(), g = audioCtx.createGain();
            o.type = 'sine'; o.frequency.value = f; g.gain.value = 0.045;
            o.connect(g); g.connect(bus); o.start();
            _menuMusicNodes.push(o, g);
        });

        const rev = audioCtx.createDelay(2); rev.delayTime.value = 1.2;
        const revFb = audioCtx.createGain(); revFb.gain.value = 0.32;
        const revLpf = audioCtx.createBiquadFilter(); revLpf.type = 'lowpass'; revLpf.frequency.value = 1100;
        rev.connect(revLpf); revLpf.connect(revFb); revFb.connect(rev); rev.connect(bus);
        _menuMusicNodes.push(rev, revFb, revLpf);

        [880, 1320].forEach(f => {
            const o = audioCtx.createOscillator(), g = audioCtx.createGain();
            const lfo = audioCtx.createOscillator(), lfog = audioCtx.createGain();
            o.type = 'sine'; o.frequency.value = f; g.gain.value = 0.006;
            lfo.frequency.value = 0.04 + Math.random() * 0.02; lfog.gain.value = 0.004;
            lfo.connect(lfog); lfog.connect(g.gain);
            o.connect(g); g.connect(rev); g.connect(bus);
            lfo.start(); o.start();
            _menuMusicNodes.push(o, g, lfo, lfog);
        });

        const menuScale = [110, 130.81, 146.83, 164.81, 196];
        const _playMenuNote = (freq) => {
            if (!audioCtx || audioCtx.state === 'closed') return;
            const t = audioCtx.currentTime;
            const o = audioCtx.createOscillator(), e = audioCtx.createGain();
            o.type = 'triangle'; o.frequency.value = freq;
            e.gain.setValueAtTime(0, t);
            e.gain.linearRampToValueAtTime(0.14, t + 0.08);
            e.gain.exponentialRampToValueAtTime(0.001, t + 6.0);
            o.connect(e); e.connect(rev); e.connect(bus);
            o.start(t); o.stop(t + 6.1);
        };
        _playMenuNote(menuScale[0]); _playMenuNote(menuScale[2]);
        _menuMusicTimerHandle = setInterval(() => {
            if (!audioCtx || audioCtx.state === 'closed') return;
            const f = menuScale[Math.floor(Math.random() * menuScale.length)];
            _playMenuNote(f);
            if (Math.random() < 0.35) _playMenuNote(menuScale[Math.floor(Math.random() * menuScale.length)]);
        }, 5000 + Math.random() * 5000);
    }

    function stopMenuMusic(fadeMs = 800) {
        if (_menuMusicTimerHandle) { clearInterval(_menuMusicTimerHandle); _menuMusicTimerHandle = null; }
        if (!menuMusicBus || !audioCtx || _menuMusicNodes.length === 0) return;
        const now = audioCtx.currentTime;
        const fadeS = fadeMs / 1000;
        menuMusicBus.gain.setValueAtTime(menuMusicBus.gain.value, now);
        menuMusicBus.gain.linearRampToValueAtTime(0, now + fadeS);
        const nodes = _menuMusicNodes.splice(0);
        setTimeout(() => {
            nodes.forEach(n => { try { if (n.stop) n.stop(); } catch(_){} try { n.disconnect(); } catch(_){} });
            if (menuMusicBus) menuMusicBus.gain.value = ((window.gameVolumePct ?? 50) / 100) * 0.4;
        }, fadeMs + 50);
    }

    function playMenuHover() {
        if (!audioCtx || audioCtx.state !== 'running') return;
        const now = audioCtx.currentTime;
        const o = audioCtx.createOscillator(), e = audioCtx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(420, now);
        o.frequency.linearRampToValueAtTime(640, now + 0.07);
        e.gain.setValueAtTime(0.18, now); e.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
        o.connect(e); e.connect(menuSfxBus); o.start(now); o.stop(now + 0.12);
    }

    function playMenuSelect() {
        if (!audioCtx || audioCtx.state !== 'running') return;
        const now = audioCtx.currentTime;
        const o1 = audioCtx.createOscillator(), e1 = audioCtx.createGain();
        o1.type = 'sine'; o1.frequency.setValueAtTime(200, now); o1.frequency.exponentialRampToValueAtTime(80, now + 0.12);
        e1.gain.setValueAtTime(0.3, now); e1.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
        o1.connect(e1); e1.connect(menuSfxBus); o1.start(now); o1.stop(now + 0.15);
        const o2 = audioCtx.createOscillator(), e2 = audioCtx.createGain();
        o2.type = 'square'; o2.frequency.value = 1400;
        e2.gain.setValueAtTime(0.08, now); e2.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
        o2.connect(e2); e2.connect(menuSfxBus); o2.start(now); o2.stop(now + 0.05);
    }

    function playMenuBack() {
        if (!audioCtx || audioCtx.state !== 'running') return;
        const now = audioCtx.currentTime;
        const o = audioCtx.createOscillator(), e = audioCtx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(580, now);
        o.frequency.linearRampToValueAtTime(360, now + 0.09);
        e.gain.setValueAtTime(0.15, now); e.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        o.connect(e); e.connect(menuSfxBus); o.start(now); o.stop(now + 0.14);
    }

    function playMenuClassSelect(cls) {
        if (!audioCtx || audioCtx.state !== 'running') return;
        const freqs = { Warrior: [164.81, 220], Rogue: [185, 246.94], Wizard: [196, 261.63], Cleric: [174.61, 233.08] };
        const pair = freqs[cls] || [164.81, 220];
        const now = audioCtx.currentTime;
        pair.forEach((f, i) => {
            const o = audioCtx.createOscillator(), e = audioCtx.createGain();
            o.type = 'triangle'; o.frequency.value = f;
            e.gain.setValueAtTime(0, now + i * 0.04);
            e.gain.linearRampToValueAtTime(0.12, now + i * 0.04 + 0.03);
            e.gain.exponentialRampToValueAtTime(0.001, now + i * 0.04 + 0.6);
            o.connect(e); e.connect(menuSfxBus); o.start(now + i * 0.04); o.stop(now + i * 0.04 + 0.65);
        });
    }

    function playMenuStartTransition() {
        if (!audioCtx || audioCtx.state !== 'running') return;
        const now = audioCtx.currentTime;
        const o = audioCtx.createOscillator(), e = audioCtx.createGain();
        o.type = 'sine'; o.frequency.setValueAtTime(80, now); o.frequency.linearRampToValueAtTime(30, now + 0.6);
        e.gain.setValueAtTime(0.25, now); e.gain.linearRampToValueAtTime(0, now + 0.6);
        o.connect(e); e.connect(menuSfxBus); o.start(now); o.stop(now + 0.65);
    }

    function playMenuSliderTick() {
        if (!audioCtx || audioCtx.state !== 'running') return;
        const now = audioCtx.currentTime;
        const o = audioCtx.createOscillator(), e = audioCtx.createGain();
        o.type = 'sine'; o.frequency.value = 880;
        e.gain.setValueAtTime(0.06, now); e.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
        o.connect(e); e.connect(menuSfxBus); o.start(now); o.stop(now + 0.07);
    }

    function setMenuMusicVolume(pct) {
        if (menuMusicBus) menuMusicBus.gain.value = (pct / 100) * 0.4;
    }

    function setMenuSfxVolume(pct) {
        if (menuSfxBus) menuSfxBus.gain.value = (pct / 100) * 0.5;
    }

    return { startMusic, stopMusic, setVolume, suspend, resume, toggle, isOn,
             init, startMenuMusic, stopMenuMusic,
             playMenuHover, playMenuSelect, playMenuBack,
             playMenuClassSelect, playMenuStartTransition, playMenuSliderTick,
             setMenuMusicVolume, setMenuSfxVolume };
})();
