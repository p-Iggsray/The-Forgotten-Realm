// audio.js — Audio subsystem lifecycle module
// Owns: audioCtx, masterGain, _sources, _processors, melodyTimer, _musicOn
// Invariant: stopMusic() always clears all node references in a finally block.
// External code accesses audio through the `audio` object — never touches nodes directly.
const audio = (() => {
    let audioCtx = null, masterGain = null, melodyTimer = null, _musicOn = true;
    let _sources = [], _processors = [];
    let _melodyWet = null, _melodyDry = null;

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

    function startMusic() {
        if (masterGain) return;
        if (!audioCtx || audioCtx.state === 'closed') {
            audioCtx = new (window.AudioContext || window['webkitAudioContext'])();
        } else if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
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

    return { startMusic, stopMusic, setVolume, suspend, resume, toggle, isOn };
})();
