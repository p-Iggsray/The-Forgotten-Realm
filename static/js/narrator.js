'use strict';

// narrator.js — DM narrator voice
// Owns: narration queue, display lifecycle, fireNarration() API
// All narration is fire-and-forget: callers never await the result.
(function () {

const NARRATOR_QUEUE_MAX       = 5;
const NARRATION_CHARS_PER_SEC  = 12;    // ~144 wpm — comfortable with world distraction
const NARRATION_MIN_HOLD_MS    = 3500;
const NARRATION_MAX_HOLD_MS    = 8000;
const NARRATION_PADDING_MS     = 800;
const NARRATION_FADE_IN_MS     = 400;   // must match CSS transition
const NARRATION_FADE_OUT_MS    = 700;   // must match CSS transition
const NARRATION_BATTLE_HOLD_MS = 2500;  // flat hold for rapid battle narrations
const NARRATION_DISMISS_MS     = 200;   // fast fade when player clicks bar

const _queue = [];
let   _active          = false;
let   _barEl           = null;
let   _dismissTimeout  = null;
let   _cleanupTimeout  = null;
let   _activeSpan      = null;

function getNarrationDuration(text) {
    const readMs = (text.length / NARRATION_CHARS_PER_SEC) * 1000;
    return Math.max(NARRATION_MIN_HOLD_MS,
                    Math.min(NARRATION_MAX_HOLD_MS, readMs + NARRATION_PADDING_MS));
}

function _getBar() {
    if (!_barEl) {
        _barEl = document.getElementById('narrator-bar');
        if (_barEl) _barEl.addEventListener('click', e => {
            if (!_active || !_activeSpan) return;
            e.stopPropagation();
            _dismiss();
        });
    }
    return _barEl;
}

function _isSuppressed() {
    return !!(window.ui && window.ui.dialogue);
}

function queueNarration(text, type = 'default') {
    if (!text) return;
    if (_queue.length >= NARRATOR_QUEUE_MAX) return;
    const holdDuration = (type === 'battle_result')
        ? NARRATION_BATTLE_HOLD_MS
        : getNarrationDuration(text);
    _queue.push({ text, type, holdDuration });
    if (!_active) _processQueue();
}

function _processQueue() {
    if (_active || _queue.length === 0) return;
    if (_isSuppressed()) {
        setTimeout(_processQueue, 500);
        return;
    }
    _active = true;
    _displayNarration(_queue.shift());
}

function _displayNarration(entry) {
    const { text, holdDuration } = entry;
    const bar = _getBar();
    if (!bar) { _active = false; return; }
    bar.innerHTML = '';
    const span = document.createElement('span');
    span.className   = 'narrator-text';
    span.textContent = text;
    bar.appendChild(span);
    _activeSpan = span;

    // Slide in (two rAF to guarantee transition fires after paint)
    requestAnimationFrame(() => {
        requestAnimationFrame(() => span.classList.add('narrator-visible'));
    });

    _dismissTimeout = setTimeout(() => {
        _activeSpan = null;
        span.classList.remove('narrator-visible');
        span.classList.add('narrator-fade-out');
        _cleanupTimeout = setTimeout(() => {
            if (bar.contains(span)) bar.removeChild(span);
            _active = false;
            _processQueue();
        }, NARRATION_FADE_OUT_MS + 20);
    }, holdDuration + NARRATION_FADE_IN_MS);
}

function _dismiss() {
    if (!_activeSpan) return;
    clearTimeout(_dismissTimeout);
    clearTimeout(_cleanupTimeout);
    const span = _activeSpan;
    _activeSpan = null;
    const bar = _getBar();
    span.classList.remove('narrator-visible');
    span.classList.add('narrator-fade-dismiss');
    _cleanupTimeout = setTimeout(() => {
        if (bar && bar.contains(span)) bar.removeChild(span);
        _active = false;
        _processQueue();
    }, NARRATION_DISMISS_MS + 20);
}

async function fireNarration(eventType, context) {
    try {
        const res = await fetch('/narrate', {
            method:  'POST',
            headers: {'Content-Type': 'application/json'},
            body:    JSON.stringify({event_type: eventType, context}),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.narration) queueNarration(data.narration, eventType);
    } catch (_) {
        // Narration failure is always silent
    }
}

window.fireNarration  = fireNarration;
window.queueNarration = queueNarration;

})();
