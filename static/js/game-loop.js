// ═══════════════════════════════════════════════════════
//  GAME LOOP  —  extracted from game.js (Pass 8)
//
//  Public API: startLoop(), stopLoop(), isRunning()
//  Owns: timeMs, Game.timeMs, RAF lifecycle, fixed-timestep accumulator
//
//  FRAME CONTRACT (order is the integration contract — do not change without intent):
//    1. timeMs / Game.timeMs write   (frame-start, before all systems)
//    2. fixed-step update block      (movement, anim, camera, enemies, battle, particles)
//    3. input.clearFrame()           (once per frame, after fixed-step block)
//    4. spriteRenderer.advanceAnimations()
//    5. render()
// ═══════════════════════════════════════════════════════

let timeMs = Game.timeMs = 0;

let _isBattleActive = false, _isLoading = false;
eventBus.on('battle:start',     () => { _isBattleActive = true; });
eventBus.on('battle:end',       () => { _isBattleActive = false; });
eventBus.on('ui:loading:start', () => { _isLoading = true; });
eventBus.on('ui:loading:end',   () => { _isLoading = false; });

const FIXED_STEP = 1000 / 60;
let lastTs = 0, accumulator = 0;
let _loopRaf = 0;
let _loopRunning = false;

function stopLoop() {
    _loopRunning = false;
    cancelAnimationFrame(_loopRaf);
    _loopRaf = 0;
}

function startLoop() {
    stopLoop();
    lastTs = 0;
    accumulator = 0;
    _loopRunning = true;
    _loopRaf = requestAnimationFrame(loop);
}

function isRunning() { return _loopRunning; }

function loop(ts) {
    if (!_loopRunning) return;
    _perf.startFrame(ts);
    timeMs = Game.timeMs = ts;
    const rawDt = ts - lastTs;
    lastTs = ts;
    accumulator += Math.min(rawDt, 50);

    while (accumulator >= FIXED_STEP) {
        const dt = FIXED_STEP;
        updateMovement(dt);
        updatePlayerAnim(dt);
        updateCamera();
        updateEnemies(dt);
        updateNPCs(dt);
        updateAmbient(dt);
        updateDiscovery();
        battleSystem.update(dt);
        if (!_isBattleActive && !_isLoading && !ui.paused) particleSystem.update(dt, currentMap, player, TS);
        accumulator -= FIXED_STEP;
    }
    input.clearFrame();
    if (typeof spriteRenderer !== 'undefined') {
        spriteRenderer.advanceAnimations(Math.min(rawDt, 50));
    }
    render();
    _loopRaf = requestAnimationFrame(loop);
}
