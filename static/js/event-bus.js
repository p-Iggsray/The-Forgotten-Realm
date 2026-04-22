// event-bus.js — Synchronous publish-subscribe event bus for engine-level state changes.
// Vocabulary: battle:start, battle:end, transition:start, transition:end,
//             ui:loading:start, ui:loading:end, ui:paused:start, ui:paused:end,
//             ui:dialogue:open, ui:dialogue:close, player:damaged, player:levelup, quest:complete
const eventBus = (() => {
    const _listeners = new Map();

    function on(eventName, callback) {
        if (!_listeners.has(eventName)) _listeners.set(eventName, new Set());
        _listeners.get(eventName).add(callback);
        return () => off(eventName, callback);
    }

    function off(eventName, callback) {
        _listeners.get(eventName)?.delete(callback);
    }

    function emit(eventName, payload = {}) {
        if (window.DEBUG_EVENT_BUS) {
            console.group(`[EventBus] ${eventName}`);
            console.log('payload:', payload);
            console.log('listeners:', _listeners.get(eventName)?.size ?? 0);
            console.groupEnd();
        }
        _listeners.get(eventName)?.forEach(cb => {
            try { cb(payload); }
            catch (e) { console.error(`[EventBus] Error in "${eventName}" handler:`, e); }
        });
    }

    function once(eventName, callback) {
        const unsub = on(eventName, payload => { unsub(); callback(payload); });
        return unsub;
    }

    return { on, off, emit, once };
})();
window.eventBus = eventBus;
