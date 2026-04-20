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
// Game.BUILDING_ENTRANCES and Game.MAX_LEVEL are set by game.js — accessed inside function bodies at runtime

// ── UI state ─────────────────────────────────────────
const ui = {
    dialogue:     null,
    sign:         null,
    loading:      false,
    questLog:     false,
    paused:       false,
    inventory:    false,
    dialogueError: null,
};
window.ui = ui;

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
function showSign(text, questComplete) {
    if(questComplete&&gs.flags[questComplete.given]&&!gs.flags[questComplete.complete]){
        gs.flags[questComplete.complete]=true;
        const q=QUESTS.find(q=>q.flag_complete===questComplete.complete);
        if(q) setTimeout(()=>showNotification(`Quest Complete: ${q.title}`,'quest'),800);
        updateQuestUI();
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
    dlgText.textContent = 'Thinking\u2026';
    dlgText.classList.add('dlg-loading');
    document.getElementById('dlg-player-msg').textContent = '';
    _dlgSetInputEnabled(false);
    box.classList.remove('hidden');

    const slowTimer = setTimeout(() => {
        if (ui.loading) dlgText.textContent = 'Still connecting\u2026';
    }, DIALOGUE_SLOW_MS);

    try {
        const data  = await callInteract(npc, '', npc.history);
        npc.history = data.history;
        ui.dialogue = npc;
        showDialogueData(data);
        _dlgFocus();
    } catch (err) {
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
        const data  = await callInteract(npc, text, npc.history);
        npc.history = data.history;
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
        if (data.ended) { closeDialogue(); return; }
        showDialogueData(data);
        _dlgFocus();
    } catch (err) {
        _showDialogueError(_categorizeError(err), npc);
    } finally {
        clearTimeout(slowTimer);
        setLoading(false);
    }
}

async function callInteract(npc, playerText, history) {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), DIALOGUE_TIMEOUT_MS);
    try {
        const res = await fetch('/interact', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({npc:{name:npc.name,role:npc.role,id:npc.id},playerText,history,flags:gs.flags}),
            signal: ctrl.signal
        });
        if (!res.ok) {
            let body = `${res.status} ${res.statusText}`;
            try { body = (await res.text()) || body; } catch (_) {}
            const err = new Error(body);
            err.category = res.status >= 500 ? 'server' : 'client';
            throw err;
        }
        try {
            return await res.json();
        } catch (_) {
            const err = new Error('Malformed response from server');
            err.category = 'parse';
            throw err;
        }
    } finally {
        clearTimeout(timer);
    }
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
    const el=document.getElementById('dlg-text');
    el.textContent=data.dialogue;
    el.classList.remove('dlg-loading');
    _dlgSetInputEnabled(true);
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

function closeDialogue() {
    const errNpc     = ui.dialogueError?.npc;
    ui.dialogue      = null;
    setLoading(false);
    ui.dialogueError = null;
    document.getElementById('dialogue-box').classList.add('hidden');
    document.getElementById('dlg-player-msg').textContent = '';
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
//  NOTIFICATIONS
// ═══════════════════════════════════════════════════════
function showNotification(msg,type='info') {
    const el=document.createElement('div');
    el.className=`notif notif-${type}`;el.textContent=msg;
    document.getElementById('notifications').appendChild(el);
    requestAnimationFrame(()=>el.classList.add('notif-show'));
    setTimeout(()=>el.classList.remove('notif-show'),2800);
    setTimeout(()=>el.remove(),3300);
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
    ui.dialogueError = null;
    _selectedItem = null;
    _lastHint = null;
    _lastHpVal = -1; _lastHpMax = -1;
    _pauseEl().classList.add('hidden');
    document.getElementById('dialogue-box').classList.add('hidden');
    document.getElementById('sign-box').classList.add('hidden');
    document.getElementById('quest-log').classList.add('hidden');
    document.getElementById('inventory-screen').classList.add('hidden');
    document.getElementById('defeat-overlay').classList.add('hidden');
}

// ── Public API ───────────────────────────────────────
window.resetUIState        = resetUIState;
window.updateHPUI          = updateHPUI;
window.updateHintBar       = updateHintBar;
window.showNotification    = showNotification;
window.showDefeatOverlay   = showDefeatOverlay;
window.hideDefeatOverlay   = hideDefeatOverlay;
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
window.updateInventoryUI   = updateInventoryUI;
window.useSelectedItem     = useSelectedItem;
window.showSign            = showSign;
window.closeSign           = closeSign;
window.openPause           = openPause;
window.closePause          = closePause;
window.toggleFullscreen    = toggleFullscreen;
window.updateFullscreenLabel = updateFullscreenLabel;

})();
