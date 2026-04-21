// input.js — Input subsystem module
// Owns: KEYS (held keys), JUST_PRESSED (keys pressed this frame), _NAV_KEYS (nav set)
// Public API: input.isHeld(key), input.wasJustPressed(key), input.clearFrame()
// Event listeners live here; game-logic callbacks are referenced as window globals
// and are safe to call at event time (after game.js has fully loaded).
const input = (() => {
    const KEYS         = new Set();
    const JUST_PRESSED = new Set();
    // Module-level Set — avoids allocating a new array on every keydown event
    // and O(1) .has() vs O(n) .includes() scan.
    const _NAV_KEYS = new Set(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' ']);

    document.addEventListener('keydown', e => {
        if (document.activeElement?.tagName === 'INPUT') return;
        if (_NAV_KEYS.has(e.key)) e.preventDefault();
        if (!KEYS.has(e.key)) JUST_PRESSED.add(e.key);
        KEYS.add(e.key);
        if (window.transition?.active) { e.preventDefault(); return; }
        if (window.battleSystem?.isActive()) { e.preventDefault(); window.battleSystem.handleInput(e.key); return; }
        if (e.key === 'Escape') {
            if (window.ui?.paused)    { window.closePause(); return; }
            if (window.ui?.codex)     { window.closeCodex(); return; }
            if (window.ui?.inventory) { window.closeInventory(); return; }
            if (window.ui?.dialogue || window.ui?.sign || window.ui?.questLog) {
                window.closeDialogue(true); window.closeSign(); window.closeQuestLog(); return;
            }
            window.openPause(); return;
        }
        if (window.ui?.dialogue) { e.preventDefault(); return; }
        if (e.key === 'Tab') { e.preventDefault(); window.toggleInventory(); return; }
        if (e.key === 'l' || e.key === 'L') { e.preventDefault(); window.openCodex?.(); return; }
        if (e.key === 'e' || e.key === 'E') { e.preventDefault(); window.handleInteract(); }
        if (e.key === 'q' || e.key === 'Q') { e.preventDefault(); window.toggleQuestLog(); }
    });

    document.addEventListener('keyup', e => KEYS.delete(e.key));

    document.addEventListener('keydown', e => {
        if (e.target?.id === 'dlg-input' && e.key === 'Enter') {
            e.preventDefault();
            window.sendDialogueMessage();
        }
    });

    function isHeld(key)          { return KEYS.has(key); }
    function wasJustPressed(key)  { return JUST_PRESSED.has(key); }
    function clearFrame()         { JUST_PRESSED.clear(); }

    return { isHeld, wasJustPressed, clearFrame };
})();
