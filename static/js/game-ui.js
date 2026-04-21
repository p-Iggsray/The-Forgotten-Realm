// ═══════════════════════════════════════════════════════
//  GAME-UI  —  Pass 7 extraction
//  Owns: ui state, dialogue, inventory, quest log, hint
//        bar, notifications, signs, defeat overlay, pause
// ═══════════════════════════════════════════════════════
(function () {

// ── Dependency shims (game-constants.js + world.js run first) ──
const player            = Game.player;
const gs                = Game.gs;
const QUESTS            = Game.QUESTS;
const QUEST_GIVER_FLAGS = Game.QUEST_GIVER_FLAGS;
const TILE              = Game.TILE;
const CLASS_STATS        = Game.CLASS_STATS;
// Game.GIVEABLE_ITEMS accessed inside function bodies at runtime (set by game-constants.js)
// Game.BUILDING_ENTRANCES and Game.MAX_LEVEL are set by game.js — accessed inside function bodies at runtime

// ── UI state ─────────────────────────────────────────
const ui = {
    dialogue:      null,
    sign:          null,
    loading:       false,
    questLog:      false,
    paused:        false,
    inventory:     false,
    dialogueError: null,
    codex:           false,
    codexHintPulsed: false,
};
window.ui = ui;

let _pendingClose = false;
let _activeController = null;
let _lastLoreKey  = null;
let _lastLoreTime = 0;
let _codexSelIdx  = 0;

const DARKNESS_TINT                 = 'rgba(20, 0, 30, 0.15)';
const DARKNESS_AMBIENT_REDUCTION    = 0.05;
const SEAL_WEAKENING_ENEMY_HP_BONUS = 0.10;
const DEBUG_WORLD_EVENTS            = window.location.hostname === 'localhost';

// ── Internal write path (enforces invariants) ────────
function setLoading(bool) { ui.loading = bool; }
function setPaused(bool)  { ui.paused  = bool; }

// ═══════════════════════════════════════════════════════
//  HP HUD
// ═══════════════════════════════════════════════════════
let _lastHpVal = -1, _lastHpMax = -1;

function updateHPUI() {
    if (gs.hp === _lastHpVal && gs.maxHp === _lastHpMax) return;
    _lastHpVal = gs.hp; _lastHpMax = gs.maxHp;
    const fill = document.getElementById('hp-fill');
    const text = document.getElementById('hp-text');
    if (fill) {
        const pct = Math.max(0, gs.hp / gs.maxHp);
        fill.style.width = `${pct * 100}%`;
        const bar = document.getElementById('hp-bar');
        if (pct > 0.60) {
            fill.style.background = 'linear-gradient(to right, #208820, #40c040)';
            if (bar) bar.classList.remove('hp-critical');
        } else if (pct > 0.30) {
            fill.style.background = 'linear-gradient(to right, #c07010, #e0a020)';
            if (bar) bar.classList.remove('hp-critical');
        } else {
            fill.style.background = 'linear-gradient(to right, #c02020, #e04040)';
            if (bar) bar.classList.add('hp-critical');
        }
    }
    if (text) text.textContent = `${Math.ceil(gs.hp)}/${gs.maxHp}`;
}

// ═══════════════════════════════════════════════════════
//  HINT BAR
// ═══════════════════════════════════════════════════════
let _lastHint = null;
let _hintBarEl = null;
let _hintWriteCount = 0;
let _hintWriteCounterTs = 0;

function updateHintBar() {
    const adj=[{dx:0,dy:-1},{dx:0,dy:1},{dx:-1,dy:0},{dx:1,dy:0}];
    let hint='';
    const currentMap = Game.currentMap;
    for (const d of adj) {
        const tx=player.x+d.dx, ty=player.y+d.dy;
        if (tx<0||tx>=currentMap.w||ty<0||ty>=currentMap.h) continue;
        const tile=currentMap.tiles[ty][tx];
        if (tile===TILE.SIGN)    { hint='Press E to read'; break; }
        if (tile===TILE.DOOR) {
            const entrances = Game.BUILDING_ENTRANCES?.[currentMap.id];
            if (entrances?.[`${tx},${ty}`]) { hint='Walk into door to enter'; break; }
        }
        if (tile===TILE.STAIRS) {
            const noWeapon = !gs.inventory.some(i => i.questComplete === 'quest_weapon_complete');
            hint = noWeapon
                ? '⚠ No weapon equipped — the mines are dangerous! (Press E to descend anyway)'
                : 'Press E to descend into the Cursed Mines';
            break;
        }
        if (tile===TILE.STAIRSUP){ hint=currentMap.returnMap?'Press E to exit':'Press E to ascend'; break; }
        const npc=currentMap.npcs.find(n=>n.x===tx&&n.y===ty);
        if (npc) { hint=`Press E to talk to ${npc.name}`; break; }
    }
    if (hint !== _lastHint) {
        _lastHint = hint;
        if (!_hintBarEl) _hintBarEl = document.getElementById('hint-bar');
        _hintBarEl.textContent = hint;
        if (window.location.hostname === 'localhost') {
            _hintWriteCount++;
            const now = performance.now();
            if (now - _hintWriteCounterTs >= 1000) {
                console.log(`[hint-bar] ${_hintWriteCount} DOM write(s) in last second`);
                _hintWriteCount = 0;
                _hintWriteCounterTs = now;
            }
        }
    }
}

// ═══════════════════════════════════════════════════════
//  SIGN
// ═══════════════════════════════════════════════════════
function onQuestComplete(q) {
    if (!q) return;
    updateQuestUI();
    setTimeout(() => showNotification(`Quest Complete: ${q.title}`, 'quest'), 600);
    if (typeof fireNarration === 'function') {
        fireNarration('quest_complete', { quest_name: q.title, npc_name: q.giverName });
    }
}

function showSign(text, questComplete) {
    if(questComplete&&gs.flags[questComplete.given]&&!gs.flags[questComplete.complete]){
        gs.flags[questComplete.complete]=true;
        onQuestComplete(QUESTS.find(q=>q.flag_complete===questComplete.complete));
    }
    ui.sign=true;
    document.getElementById('sign-text').textContent=text;
    document.getElementById('sign-box').classList.remove('hidden');
}
function closeSign(){ui.sign=false;document.getElementById('sign-box').classList.add('hidden');}

// ═══════════════════════════════════════════════════════
//  DIALOGUE
// ═══════════════════════════════════════════════════════
const DIALOGUE_TIMEOUT_MS = 15_000;
const DIALOGUE_SLOW_MS    = 3_000;

const DIALOGUE_ERROR_MSGS = {
    timeout: 'Connection timed out \u2014 the server took too long to respond.',
    network: 'Network error \u2014 check your connection and try again.',
    server:  'Server error \u2014 the AI service may be temporarily unavailable.',
    client:  'Request error \u2014 try reloading the page.',
    parse:   'The server returned an unreadable response. Please try again.',
    unknown: 'Something went wrong. Please try again.'
};

async function startDialogue(npc) {
    setLoading(true);
    const box     = document.getElementById('dialogue-box');
    const dlgText = document.getElementById('dlg-text');
    document.getElementById('dlg-name').textContent     = npc.name;
    document.getElementById('dlg-portrait').textContent = npc.portrait;
    const _rep  = gs.reputation?.[npc.id] ?? 0;
    const _dots = '\u25CF'.repeat(_rep) + '\u25CB'.repeat(3 - _rep);
    document.getElementById('dlg-rapport').textContent  = _rep > 0 ? _dots : '';
    dlgText.textContent = 'Thinking\u2026';
    dlgText.classList.add('dlg-loading');
    document.getElementById('dlg-player-msg').textContent = '';
    _dlgSetInputEnabled(false);
    box.classList.remove('hidden');

    const slowTimer = setTimeout(() => {
        if (ui.loading) dlgText.textContent = 'Still connecting\u2026';
    }, DIALOGUE_SLOW_MS);

    try {
        let _firstChunk = true;
        const data = await callInteract(npc, '', (chunk, fullText, isDone, payload) => {
            const dlgText = document.getElementById('dlg-text');
            if (isDone) { dlgText.classList.remove('streaming'); return; }
            if (_firstChunk) {
                _firstChunk = false;
                ui.dialogue = npc;
                clearTimeout(slowTimer);
                dlgText.classList.remove('dlg-loading');
                dlgText.classList.add('streaming');
                dlgText.textContent = '';
            }
            dlgText.textContent = fullText;
        });
        if (!gs.sessionId && data.session_id) gs.sessionId = data.session_id;
        if (!ui.dialogue) ui.dialogue = npc;
        showDialogueData(data);
        _dlgFocus();
    } catch (err) {
        if (err.name === 'AbortError') return;
        _showDialogueError(_categorizeError(err), npc);
    } finally {
        clearTimeout(slowTimer);
        setLoading(false);
    }
}

async function sendDialogueMessage() {
    if (ui.loading || !ui.dialogue) return;
    const inp  = document.getElementById('dlg-input');
    const text = inp.value.trim();
    if (!text) return;
    inp.value = '';
    document.getElementById('dlg-options').innerHTML = '';
    const npc   = ui.dialogue;
    setLoading(true);
    document.getElementById('dlg-player-msg').textContent = `You: \u201c${text}\u201d`;
    const dlgText = document.getElementById('dlg-text');
    dlgText.textContent = 'Thinking\u2026';
    dlgText.classList.add('dlg-loading');
    _dlgSetInputEnabled(false);

    const slowTimer = setTimeout(() => {
        if (ui.loading) dlgText.textContent = 'Still connecting\u2026';
    }, DIALOGUE_SLOW_MS);

    try {
        let _firstChunk = true;
        const data = await callInteract(npc, text, (chunk, fullText, isDone, payload) => {
            const dlgText = document.getElementById('dlg-text');
            if (isDone) { dlgText.classList.remove('streaming'); return; }
            if (_firstChunk) {
                _firstChunk = false;
                clearTimeout(slowTimer);
                dlgText.classList.remove('dlg-loading');
                dlgText.classList.add('streaming');
                dlgText.textContent = '';
            }
            dlgText.textContent = fullText;
        });
        setLoading(false);
        if (data.quest_given) {
            const flag = QUEST_GIVER_FLAGS[npc.id];
            if (flag && !gs.flags[flag]) {
                gs.flags[flag] = true;
                const q = QUESTS.find(q => q.flag_given === flag);
                if (q) showNotification(`New Quest: ${q.title}`, 'quest');
                updateQuestUI();
            }
        }
        if (data.ended) {
            _pendingClose = true;
            _applySignalTokens(data, npc);
            showDialogueData({ ...data, options: [] });
            _renderOptions(['Goodbye.']);
            document.querySelector('#dlg-options .dlg-option-btn')?.addEventListener('click', () => {
                _pendingClose = false;
                closeDialogue();
            }, { once: true });
            return;
        }
        _applySignalTokens(data, npc);
        showDialogueData(data);
        _dlgFocus();
    } catch (err) {
        _showDialogueError(_categorizeError(err), npc);
    } finally {
        clearTimeout(slowTimer);
        setLoading(false);
    }
}

function handleWorldEvent(key) {
    if (!Array.isArray(gs.activeWorldEvents)) gs.activeWorldEvents = [];
    if (gs.activeWorldEvents.includes(key)) return;

    if (DEBUG_WORLD_EVENTS) {
        console.group('[WORLD EVENT]');
        console.log('key:', key, '| time:', Date.now(), '| map:', Game.currentMap?.id);
        console.groupEnd();
    }

    const handlers = {
        darkness_spreads: () => {
            gs.flags.world_darkness_active = true;
            AMBIENT_LINES.guide = [
                "Have you noticed the air near the mines? It's different.",
                "I keep thinking about what the Elder said. About waiting too long.",
                "The light looks the same. It just — doesn't feel the same.",
            ];
            if (typeof fireNarration === 'function') {
                fireNarration('world_event', { world_event: 'darkness_spreads', map_name: Game.currentMap?.name });
            }
        },
        seal_weakening: () => {
            gs.flags.world_seal_weakening = true;
            Game._sealPulseEnd = (Game.timeMs || 0) + 2000;
            const enemies = Game.MAPS?.dungeon_1?.enemies;
            if (Array.isArray(enemies)) {
                enemies.forEach(e => {
                    if (e.alive) {
                        e.hp = Math.round(e.hp * (1 + SEAL_WEAKENING_ENEMY_HP_BONUS));
                        e._sealBoosted = true;
                    }
                });
            }
            if (typeof fireNarration === 'function') {
                fireNarration('world_event', { world_event: 'seal_weakening', map_name: Game.currentMap?.name });
            }
        },
        village_alert: () => {
            gs.flags.world_village_alert = true;
            const _ns = Game.MAPS?.village?.signs?.find(s => s.x === 8 && s.y === 8);
            if (_ns) _ns.text = "NOTICE — BY ORDER OF ELDER MAREN\n\nDo not approach the south road after dark.\nThe mines are sealed until further notice.\nReport any strange sounds to the Elder immediately.\n\n— posted in haste";
            AMBIENT_LINES.blacksmith = [...AMBIENT_LINES.blacksmith, "It's getting worse."];
            AMBIENT_LINES.elder      = [...AMBIENT_LINES.elder,      "We have stayed too long pretending this was ordinary."];
            AMBIENT_LINES.traveler   = [...AMBIENT_LINES.traveler,   "The warning I expected. It has arrived."];
            Game._torchDimEnd = (Game.timeMs || 0) + 1500;
        },
        elder_desperate: () => {
            gs.flags.world_elder_desperate = true;
            AMBIENT_LINES.elder = [...AMBIENT_LINES.elder, "Every day we wait, it costs us something."];
        },
    };

    const h = handlers[key];
    if (h) {
        gs.activeWorldEvents.push(key);
        h();
    } else {
        console.warn(`[WorldEvent] Unknown event key: "${key}" — ignoring`);
    }
}

function _applySignalTokens(data, npc) {
    if (data.give_item) {
        const item = Game.GIVEABLE_ITEMS?.[data.give_item];
        if (item) {
            gs.inventory.push({ ...item });
            showNotification(`Received: ${item.name}`, 'item');
        }
    }
    if (data.unlock_area) {
        if (!gs.unlockedAreas.includes(data.unlock_area)) {
            gs.unlockedAreas.push(data.unlock_area);
            showNotification(`Area revealed: ${data.unlock_area.replace(/_/g, ' ')}`, 'info');
        }
    }
    if (data.world_event) {
        handleWorldEvent(data.world_event);
    }
    if (data.reveal_lore) {
        if (!gs.knownLore.includes(data.reveal_lore)) {
            const isFirst = gs.knownLore.length === 0;
            gs.knownLore.push(data.reveal_lore);
            _lastLoreKey  = data.reveal_lore;
            _lastLoreTime = Date.now();
            const _loreEntry = window.LORE_ENTRIES?.[data.reveal_lore];
            const _loreTitle = _loreEntry ? _loreEntry.title : data.reveal_lore.replace(/_/g, ' ');
            showNotification(`New lore discovered: ${_loreTitle}`, 'lore');
            _updateCodexHint();
            if (isFirst && !gs.codexTutorialShown) {
                gs.codexTutorialShown = true;
                setTimeout(() => showNotification('New entry added to your Codex — press L to read', 'info', 4000), 3300);
            }
        }
    }
    if (data.reputation_change) {
        const { npc_id, delta } = data.reputation_change;
        const cur = gs.reputation[npc_id] ?? 0;
        gs.reputation[npc_id] = Math.max(0, Math.min(3, cur + delta));
    }
}

async function callInteract(npc, playerText, onChunk = null) {
    const ctrl  = new AbortController();
    _activeController = ctrl;
    const timer = setTimeout(() => ctrl.abort(), DIALOGUE_TIMEOUT_MS);
    try {
        const res = await fetch('/interact', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                npc: {name:npc.name, role:npc.role, id:npc.id},
                playerText,
                session_id: gs.sessionId || null,
                flags: {
                    ...gs.flags,
                    charClass:       gs.charClass,
                    charName:        gs.charName,
                    knownLore:       gs.knownLore,
                    unlockedAreas:   gs.unlockedAreas,
                    reputation:      gs.reputation,
                    npcMoods:        gs.npcMoods || {},
                    activeWorldEvents: Array.from(gs.activeWorldEvents || []),
                    currentMap:      Game.currentMap?.id,
                    questsActive:    QUESTS.filter(q => gs.flags[q.flag_given] && !gs.flags[q.flag_complete]).map(q => q.id),
                    questsCompleted: QUESTS.filter(q => gs.flags[q.flag_complete]).map(q => q.id),
                },
            }),
            signal: ctrl.signal
        });
        if (!res.ok) {
            let body = `${res.status} ${res.statusText}`;
            try { body = (await res.text()) || body; } catch (_) {}
            const err = new Error(body);
            err.category = res.status >= 500 ? 'server' : 'client';
            throw err;
        }
        if (onChunk && res.body?.getReader) return await _readStream(res, onChunk);
        try {
            return await res.json();
        } catch (_) {
            const err = new Error('Malformed response from server');
            err.category = 'parse';
            throw err;
        }
    } finally {
        clearTimeout(timer);
        _activeController = null;
    }
}

async function _readStream(res, onChunk) {
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', accumulated = '', skipFlag = false;

    const skipHandler = () => {
        skipFlag = true;
        const el = document.getElementById('dlg-text');
        if (el && accumulated) { el.classList.remove('streaming'); el.textContent = accumulated; }
    };
    document.addEventListener('keydown', skipHandler, { once: true, capture: true });

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split('\n\n');
            buffer = parts.pop();
            for (const part of parts) {
                if (!part.startsWith('data: ')) continue;
                let payload;
                try { payload = JSON.parse(part.slice(6)); } catch { continue; }
                if (payload.chunk !== undefined) {
                    accumulated += payload.chunk;
                    if (!skipFlag) onChunk(payload.chunk, accumulated, false, null);
                } else if (payload.done) {
                    document.removeEventListener('keydown', skipHandler, { capture: true });
                    onChunk(null, accumulated, true, payload);
                    return payload;
                }
            }
        }
    } finally {
        document.removeEventListener('keydown', skipHandler, { capture: true });
    }
    return null;
}

function _categorizeError(err) {
    if (err.name === 'AbortError') return 'timeout';
    if (err.category)              return err.category;
    if (err instanceof TypeError)  return 'network';
    return 'unknown';
}

function _showDialogueError(type, npc) {
    ui.dialogueError = { type, npc };
    const dlgText = document.getElementById('dlg-text');
    dlgText.textContent = DIALOGUE_ERROR_MSGS[type] ?? DIALOGUE_ERROR_MSGS.unknown;
    dlgText.classList.remove('dlg-loading');
}

function showDialogueData(data) {
    const el = document.getElementById('dlg-text');
    el.textContent = data.dialogue;
    el.classList.remove('dlg-loading');
    _renderOptions(data.options || []);
    _dlgSetInputEnabled(true);
}

function _renderOptions(options) {
    const container = document.getElementById('dlg-options');
    container.innerHTML = '';
    if (!options.length) return;
    options.forEach((text, i) => {
        const btn = document.createElement('button');
        btn.className = 'dlg-option-btn';
        btn.textContent = text;
        btn.style.animationDelay = `${i * 50}ms`;
        btn.addEventListener('click', () => _selectOption(text));
        container.appendChild(btn);
    });
}

function _selectOption(text) {
    const inp = document.getElementById('dlg-input');
    inp.value = text;
    document.getElementById('dlg-options').innerHTML = '';
    sendDialogueMessage();
}

function _dlgSetInputEnabled(on) {
    const inp=document.getElementById('dlg-input');
    const btn=document.getElementById('dlg-send');
    if(inp) inp.disabled=!on;
    if(btn) btn.disabled=!on;
}

function _dlgFocus() {
    setTimeout(()=>document.getElementById('dlg-input')?.focus(),50);
}

function closeDialogue(force = false) {
    if (_pendingClose && !force) return;
    _pendingClose = false;
    if (_activeController) { _activeController.abort(); _activeController = null; }
    const errNpc     = ui.dialogueError?.npc;
    ui.dialogue      = null;
    setLoading(false);
    ui.dialogueError = null;
    document.getElementById('dialogue-box').classList.add('hidden');
    document.getElementById('dlg-player-msg').textContent = '';
    document.getElementById('dlg-options').innerHTML = '';
    const inp = document.getElementById('dlg-input');
    if (inp) { inp.value = ''; inp.disabled = false; }
    if (errNpc) showNotification(`Try approaching ${errNpc.name} again.`, 'info');
}

// ═══════════════════════════════════════════════════════
//  QUEST LOG
// ═══════════════════════════════════════════════════════
function toggleQuestLog(){ui.questLog?closeQuestLog():openQuestLog();}

function openQuestLog() {
    if(ui.dialogue||ui.sign)return;
    ui.questLog=true;
    updateQuestUI();
    document.getElementById('quest-log').classList.remove('hidden');
}
function closeQuestLog(){ui.questLog=false;document.getElementById('quest-log').classList.add('hidden');}

// ═══════════════════════════════════════════════════════
//  CODEX
// ═══════════════════════════════════════════════════════

function openCodex() {
    if (ui.dialogue || ui.sign || ui.loading || window.battleSystem?.isActive()) return;
    if (ui.codex) { closeCodex(); return; }
    closeQuestLog(); closeInventory();
    ui.codex = true;

    const known = gs.knownLore || [];
    if (known.length === 0) {
        _codexSelIdx = 0;
    } else if (_lastLoreKey && (Date.now() - _lastLoreTime) < 30_000) {
        const idx = known.indexOf(_lastLoreKey);
        _codexSelIdx = idx >= 0 ? idx : 0;
    } else {
        _codexSelIdx = Math.min(_codexSelIdx, Math.max(0, known.length - 1));
    }

    document.getElementById('codex-screen').classList.remove('hidden');
    _drawCodexCanvas();
    _renderCodex();
}

function closeCodex() {
    ui.codex = false;
    document.getElementById('codex-screen').classList.add('hidden');
}

function _renderCodex() {
    const known  = gs.knownLore || [];
    const list   = document.getElementById('codex-list');
    const title  = document.getElementById('codex-entry-title');
    const body   = document.getElementById('codex-entry-body');
    const source = document.getElementById('codex-entry-source');
    const empty  = document.getElementById('codex-empty');

    list.innerHTML = '';

    if (known.length === 0) {
        empty.classList.remove('hidden');
        title.textContent  = '';
        body.textContent   = '';
        source.textContent = '';
        return;
    }
    empty.classList.add('hidden');

    known.forEach((key, i) => {
        const entry = window.LORE_ENTRIES?.[key];
        if (!entry) return;
        const btn = document.createElement('button');
        btn.className   = 'codex-list-btn' + (i === _codexSelIdx ? ' selected' : '');
        btn.textContent = entry.title;
        btn.addEventListener('click', () => { _codexSelIdx = i; _renderCodex(); });
        list.appendChild(btn);
    });

    const sel = window.LORE_ENTRIES?.[known[_codexSelIdx]];
    if (sel) {
        title.textContent  = sel.title;
        body.textContent   = sel.body;
        source.textContent = `\u2014 As told by ${sel.source}`;
    }
}

function _drawCodexCanvas() {
    const canvas = document.getElementById('codex-canvas');
    if (!canvas) return;
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#c8a96e';
    ctx.fillRect(0, 0, W, H);

    const imageData = ctx.getImageData(0, 0, W, H);
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
        const n = (Math.random() - 0.5) * 28;
        d[i]   = Math.min(255, Math.max(0, d[i]   + n));
        d[i+1] = Math.min(255, Math.max(0, d[i+1] + n));
        d[i+2] = Math.min(255, Math.max(0, d[i+2] + n));
    }
    ctx.putImageData(imageData, 0, 0);

    const SEG = 20;
    ctx.strokeStyle = 'rgba(90,55,18,0.55)';
    ctx.lineWidth   = 2.5;
    ctx.beginPath();
    for (let x = 0; x <= W; x += SEG) { const y = (Math.random()-0.5)*4; x===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y); }
    ctx.stroke();
    ctx.beginPath();
    for (let x = 0; x <= W; x += SEG) { const y = H+(Math.random()-0.5)*4; x===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y); }
    ctx.stroke();
    ctx.beginPath();
    for (let y = 0; y <= H; y += SEG) { const x = (Math.random()-0.5)*4; y===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y); }
    ctx.stroke();
    ctx.beginPath();
    for (let y = 0; y <= H; y += SEG) { const x = W+(Math.random()-0.5)*4; y===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y); }
    ctx.stroke();

    const vg = ctx.createRadialGradient(W/2, H/2, H*0.3, W/2, H/2, H*0.85);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(60,30,5,0.18)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
}

function updateQuestUI() {
    const list=document.getElementById('quest-list');
    list.innerHTML='';
    let active=0;
    for(const q of QUESTS){
        const given=gs.flags[q.flag_given],done=gs.flags[q.flag_complete];
        if(!given)continue;
        active+=done?0:1;
        const el=document.createElement('div');
        el.className='quest-entry'+(done?' quest-done':'');
        el.innerHTML=`<div class="quest-title">${done?'✓ ':'▸ '}${q.title}</div>
                      <div class="quest-giver">From: ${q.giverName}</div>
                      <div class="quest-obj">${done?'<em>Completed.</em>':q.objective}</div>`;
        list.appendChild(el);
    }
    if(!list.children.length){
        list.innerHTML='<p class="quest-empty">No quests yet. Talk to the villagers.</p>';
    }
    const btn=document.getElementById('quest-btn');
    if(btn) btn.textContent=`📜 Quests${active>0?` (${active})`:''}`;
}

// ═══════════════════════════════════════════════════════
//  INVENTORY
// ═══════════════════════════════════════════════════════
let _selectedItem = null;

const CLASS_ICONS = { Warrior:'⚔️', Rogue:'🗡️', Wizard:'🪄', Cleric:'🔱' };

function updateInventoryUI() {
    if (ui.inventory) renderInventoryScreen();
}

function toggleInventory() {
    if (ui.inventory) closeInventory();
    else openInventory();
}

function openInventory() {
    if (battleSystem.isActive() || transition.active || ui.dialogue || ui.sign || ui.paused) return;
    ui.inventory = true;
    closeQuestLog();
    _selectedItem = null;
    renderInventoryScreen();
    document.getElementById('inventory-screen').classList.remove('hidden');
}

function closeInventory() {
    ui.inventory = false;
    _selectedItem = null;
    document.getElementById('inventory-screen').classList.add('hidden');
}

function renderInventoryScreen() {
    const stats = CLASS_STATS[gs.charClass] || CLASS_STATS.Warrior;
    const MAX_LEVEL = Game.MAX_LEVEL;

    document.getElementById('inv-char-portrait').textContent = CLASS_ICONS[gs.charClass] || '🧑';
    document.getElementById('inv-char-name').textContent = gs.charName;
    document.getElementById('inv-char-class').textContent = gs.charClass.toUpperCase();
    document.getElementById('inv-level-badge').textContent = `Lv ${gs.level}`;

    const hpPct = Math.max(0, gs.hp / gs.maxHp);
    document.getElementById('inv-hp-fill').style.width = `${hpPct * 100}%`;
    document.getElementById('inv-hp-val').textContent = `${Math.ceil(gs.hp)}/${gs.maxHp}`;

    const xpPct = gs.level >= MAX_LEVEL ? 1 : xpProgressPct();
    document.getElementById('inv-xp-fill').style.width = `${xpPct * 100}%`;
    const nextXP = gs.level >= MAX_LEVEL ? '—' : xpToNext() + ' XP';
    document.getElementById('inv-xp-val').textContent = gs.level >= MAX_LEVEL ? 'MAX' : `${gs.xp - xpForLevel(gs.level)} / ${xpForLevel(gs.level+1) - xpForLevel(gs.level)}`;

    const lvlBonus = gs.level - 1;
    document.getElementById('inv-atk-val').textContent = stats.atk + lvlBonus * 2;
    document.getElementById('inv-def-val').textContent = stats.def + lvlBonus;
    document.getElementById('inv-spd-val').textContent = stats.spd;
    document.getElementById('inv-next-val').textContent = gs.level >= MAX_LEVEL ? 'MAX LEVEL' : nextXP;

    const weapon = gs.inventory.find(i => i.questComplete === 'quest_weapon_complete');
    if (weapon) {
        document.getElementById('inv-equipped-icon').textContent = weapon.icon || '⚔️';
        document.getElementById('inv-equipped-name').textContent = weapon.name;
    } else {
        document.getElementById('inv-equipped-icon').textContent = '—';
        document.getElementById('inv-equipped-name').textContent = 'Nothing equipped';
    }

    const grid = document.getElementById('inv-grid');
    grid.innerHTML = '';

    const GRID_SIZE = 20;
    const emptyMsg = document.getElementById('inv-empty-msg');
    emptyMsg.style.display = gs.inventory.length === 0 ? 'block' : 'none';

    for (let i = 0; i < GRID_SIZE; i++) {
        const slot = document.createElement('div');
        const item = gs.inventory[i];
        if (item) {
            slot.className = 'inv-slot' + (_selectedItem === item ? ' selected' : '');
            slot.innerHTML = `<div class="slot-icon">${item.icon || '◆'}</div><div class="slot-name">${item.name}</div>`;
            if (item.questComplete) {
                const badge = document.createElement('div');
                badge.className = 'slot-quest-badge';
                badge.title = 'Quest Item';
                slot.appendChild(badge);
            }
            slot.addEventListener('click', () => selectItem(item));
        } else {
            slot.className = 'inv-slot empty-slot';
        }
        grid.appendChild(slot);
    }

    renderItemDetail();
}

function selectItem(item) {
    _selectedItem = _selectedItem === item ? null : item;
    renderInventoryScreen();
}

function renderItemDetail() {
    const detail = document.getElementById('inv-item-detail');
    if (!_selectedItem) { detail.classList.add('hidden'); return; }
    detail.classList.remove('hidden');
    document.getElementById('inv-detail-icon').textContent = _selectedItem.icon || '◆';
    document.getElementById('inv-detail-name').textContent = _selectedItem.name;
    document.getElementById('inv-detail-desc').textContent = _selectedItem.desc || 'A mysterious item.';
    const useBtn = document.getElementById('inv-use-btn');
    useBtn.textContent = _selectedItem.questComplete ? 'Equipped' : 'Examine';
    useBtn.disabled = false;
}

function useSelectedItem() {
    if (!_selectedItem) return;
    if (_selectedItem.questComplete) {
        showNotification(`${_selectedItem.name} — equipped.`, 'info');
    } else {
        showNotification(`${_selectedItem.name}: ${_selectedItem.desc || 'Nothing happens.'}`, 'info');
    }
}

// ═══════════════════════════════════════════════════════
//  DEFEAT OVERLAY
// ═══════════════════════════════════════════════════════
function showDefeatOverlay() {
    document.getElementById('defeat-overlay').classList.remove('hidden');
}
function hideDefeatOverlay() {
    document.getElementById('defeat-overlay').classList.add('hidden');
}

// ═══════════════════════════════════════════════════════
//  CODEX HINT
// ═══════════════════════════════════════════════════════
const CODEX_HINT_INACTIVE_ALPHA   = 0.4;  // matches CSS
const CODEX_HINT_PULSE_DURATION_MS = 600; // matches CSS

function _updateCodexHint() {
    const el = document.getElementById('hud-codex-hint');
    if (!el) return;
    if (gs.knownLore.length > 0) {
        el.classList.remove('hud-codex-inactive');
        if (!ui.codexHintPulsed) {
            ui.codexHintPulsed = true;
            el.classList.add('hud-codex-pulse');
            setTimeout(() => el.classList.remove('hud-codex-pulse'), CODEX_HINT_PULSE_DURATION_MS);
        }
    } else {
        el.classList.add('hud-codex-inactive');
    }
}

// ═══════════════════════════════════════════════════════
//  NOTIFICATIONS
// ═══════════════════════════════════════════════════════
function showNotification(msg, type = 'info', duration = 2800) {
    const el = document.createElement('div');
    el.className = `notif notif-${type}`; el.textContent = msg;
    document.getElementById('notifications').appendChild(el);
    requestAnimationFrame(() => el.classList.add('notif-show'));
    setTimeout(() => el.classList.remove('notif-show'), duration);
    setTimeout(() => el.remove(), duration + 500);
}

// ═══════════════════════════════════════════════════════
//  PAUSE MENU
// ═══════════════════════════════════════════════════════
const _pauseEl  = () => document.getElementById('pause-menu');
const _pauseVol = () => document.getElementById('pause-vol');

function openPause() {
    if (document.getElementById('game-screen').classList.contains('hidden')) return;
    setPaused(true);
    audio.suspend();
    const vol = window.gameVolumePct ?? 50;
    const slider = _pauseVol();
    slider.value = Math.min(100, Math.max(0, vol));
    _updateSliderFill(slider);
    _pauseEl().classList.remove('hidden');
}

function closePause() {
    setPaused(false);
    audio.resume();
    _pauseEl().classList.add('hidden');
}

function _updateSliderFill(slider) {
    slider.style.setProperty('--pct', slider.value + '%');
}

document.getElementById('pause-vol').addEventListener('input', function() {
    _updateSliderFill(this);
    if (typeof syncVolSliders === 'function') syncVolSliders(+this.value);
    else audio.setVolume(+this.value);
});

document.getElementById('pause-resume').addEventListener('click', closePause);

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
    } else {
        document.exitFullscreen().catch(() => {});
    }
}

function updateFullscreenLabel() {
    const inFS = !!document.fullscreenElement;
    const pauseBtn = document.getElementById('pause-fullscreen');
    if (pauseBtn) pauseBtn.textContent = inFS ? '✕ Exit Fullscreen' : '⛶ Fullscreen';
    if (typeof window['updateOptFullscreenLabel'] === 'function') window['updateOptFullscreenLabel']();
}

document.getElementById('pause-fullscreen').addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', updateFullscreenLabel);

document.addEventListener('keydown', e => {
    if (e.key === 'F11') { e.preventDefault(); toggleFullscreen(); }
}, true);

document.addEventListener('keydown', e => {
    if (!ui.codex) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        _codexSelIdx = Math.min(_codexSelIdx + 1, Math.max(0, (gs.knownLore?.length || 1) - 1));
        _renderCodex();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        _codexSelIdx = Math.max(_codexSelIdx - 1, 0);
        _renderCodex();
    } else if (e.key === 'Escape') {
        closeCodex();
    }
});

document.getElementById('pause-mainmenu').addEventListener('click', () => {
    closePause();
    document.getElementById('restart-btn').click();
});

// ═══════════════════════════════════════════════════════
//  RESET
// ═══════════════════════════════════════════════════════
function resetUIState() {
    ui.dialogue = null; ui.sign = null; ui.questLog = false;
    setLoading(false); setPaused(false); ui.inventory = false;
    ui.dialogueError = null; ui.codex = false;
    _selectedItem = null;
    _lastHint = null;
    _lastHpVal = -1; _lastHpMax = -1;
    _pauseEl().classList.add('hidden');
    document.getElementById('dialogue-box').classList.add('hidden');
    document.getElementById('sign-box').classList.add('hidden');
    document.getElementById('quest-log').classList.add('hidden');
    document.getElementById('inventory-screen').classList.add('hidden');
    document.getElementById('defeat-overlay').classList.add('hidden');
    document.getElementById('codex-screen').classList.add('hidden');
}

// ── Public API ───────────────────────────────────────
window.resetUIState        = resetUIState;
window.updateHPUI          = updateHPUI;
window.updateHintBar       = updateHintBar;
window.showNotification    = showNotification;
window.showDefeatOverlay   = showDefeatOverlay;
window.hideDefeatOverlay   = hideDefeatOverlay;
window.onQuestComplete     = onQuestComplete;
window.handleWorldEvent    = handleWorldEvent;
window.startDialogue       = startDialogue;
window.sendDialogueMessage = sendDialogueMessage;
window.closeDialogue       = closeDialogue;
window.openQuestLog        = openQuestLog;
window.closeQuestLog       = closeQuestLog;
window.toggleQuestLog      = toggleQuestLog;
window.updateQuestUI       = updateQuestUI;
window.openInventory       = openInventory;
window.closeInventory      = closeInventory;
window.toggleInventory     = toggleInventory;
window.openCodex           = openCodex;
window.closeCodex          = closeCodex;
window.updateInventoryUI   = updateInventoryUI;
window.useSelectedItem     = useSelectedItem;
window.showSign            = showSign;
window.closeSign           = closeSign;
window.openPause           = openPause;
window.closePause          = closePause;
window.toggleFullscreen    = toggleFullscreen;
window.updateFullscreenLabel = updateFullscreenLabel;

})();
