'use strict';

// battle.js — Battle subsystem module
// Owns: battle state object (active, phase, enemy, timers, cursor, results)
// Invariant: start() throws if already active; endBattle() is idempotent via active flag.
// All canvas ops use _ctx set at the start of each render() call.
const battleSystem = (() => {
    const Game = window.Game;

    let _ctx = null;
    let _W = 0, _H = 0, _t = 0;

    const battle = {
        active: false, enemy: null, phase: 'player_menu', timer: 0,
        menuCursor: 0, itemCursor: 0, cursorPos: 0.1, cursorDir: 1,
        hitResult: '', hitDmg: 0, playerDmgTaken: 0, message: '',
        shakeTimer: 0, enemyHitType: 'normal',
    };

    function isActive() { return battle.active; }

    function getPlayerAtk() {
        return Game.CLASS_STATS[Game.gs.charClass]?.atk ?? 15;
    }

    function calculateEnemyDamage(attackerType, defenderClass) {
        const atk = Game.ENEMY_DEFS[attackerType].atk;
        const def = Game.CLASS_STATS[defenderClass]?.def ?? 0;
        if (Math.random() < Game.ENEMY_MISS_CHANCE) {
            return { amount: 0, type: 'miss', mitigatedBy: 0 };
        }
        const isCrit = Math.random() < Game.ENEMY_CRIT_CHANCE;
        const base   = Math.max(Math.ceil(atk * Game.ENEMY_DMG_FLOOR), atk - def);
        const scaled = isCrit ? base * Game.ENEMY_CRIT_MULT : base;
        const variance = 1 + (Math.random() * 2 - 1) * Game.ENEMY_DMG_VARIANCE;
        const amount = Math.max(1, Math.round(scaled * variance));
        return { amount, type: isCrit ? 'crit' : 'normal', mitigatedBy: Math.max(0, atk - base) };
    }

    function hasWeapon() {
        return Game.gs.inventory.some(i => i.questComplete === 'quest_weapon_complete');
    }

    function start(enemy) {
        if (battle.active) throw new Error('battleSystem.start() called while battle already active');
        battle.active        = true;
        battle.enemy         = enemy;
        battle.phase         = 'player_menu';
        battle.timer         = 0;
        battle.menuCursor    = 0;
        battle.itemCursor    = 0;
        battle.cursorPos     = 0.1;
        battle.cursorDir     = 1;
        battle.hitResult     = '';
        battle.hitDmg        = 0;
        battle.playerDmgTaken = 0;
        battle.enemyHitType  = 'normal';
        battle.shakeTimer    = 0;
        battle.message       = `A wild ${enemy.name} appeared!`;
        window.showNotification(`A ${enemy.name} appears!`, 'danger');
    }

    function handleInput(key) {
        if (!battle.active) return false;

        if (battle.phase === 'player_menu') {
            const MENU = ['FIGHT', 'ITEM', 'FLEE'];
            if (key === 'ArrowUp'   || key === 'w' || key === 'W') { battle.menuCursor = (battle.menuCursor + MENU.length - 1) % MENU.length; return true; }
            if (key === 'ArrowDown' || key === 's' || key === 'S') { battle.menuCursor = (battle.menuCursor + 1) % MENU.length; return true; }
            if (key === ' ' || key === 'Enter' || key === 'e' || key === 'E') {
                if (battle.menuCursor === 0) {
                    if (!hasWeapon()) {
                        battle.phase = 'no_weapon';
                        battle.timer = 1600;
                        battle.message = "You have no weapon! You can't fight!";
                    } else {
                        battle.phase = 'player_timing';
                        battle.cursorPos = 0.1;
                        battle.cursorDir = 1;
                        battle.message = 'Strike at the right moment!';
                    }
                } else if (battle.menuCursor === 1) {
                    if (Game.gs.inventory.length === 0) {
                        battle.message = "Your pack is empty!";
                    } else {
                        battle.phase = 'player_item';
                        battle.itemCursor = 0;
                        battle.message = 'Choose an item.';
                    }
                } else {
                    battle.phase = 'flee_attempt';
                    battle.timer = 900;
                    battle.message = 'Getting away\u2026';
                }
                return true;
            }
            return true;
        }

        if (battle.phase === 'player_item') {
            const items = Game.gs.inventory;
            if (key === 'ArrowUp'   || key === 'w' || key === 'W') { battle.itemCursor = Math.max(0, battle.itemCursor - 1); return true; }
            if (key === 'ArrowDown' || key === 's' || key === 'S') { battle.itemCursor = Math.min(items.length - 1, battle.itemCursor + 1); return true; }
            if (key === 'Escape' || key === 'Backspace') {
                battle.phase = 'player_menu';
                battle.message = `A wild ${battle.enemy.name} appeared!`;
                return true;
            }
            if (key === ' ' || key === 'Enter' || key === 'e' || key === 'E') {
                const item = items[battle.itemCursor];
                if (!item) return true;
                if (item.questComplete === 'quest_weapon_complete') {
                    battle.message = `${item.name} is already equipped!`;
                    battle.phase = 'player_item_msg';
                    battle.timer = 1100;
                } else if (item.healAmt) {
                    const healed = Math.min(item.healAmt, Game.gs.maxHp - Game.gs.hp);
                    Game.gs.hp = Math.min(Game.gs.maxHp, Game.gs.hp + item.healAmt);
                    Game.gs.inventory.splice(battle.itemCursor, 1);
                    battle.itemCursor = Math.min(battle.itemCursor, Game.gs.inventory.length - 1);
                    window.updateHPUI();
                    battle.message = `Used ${item.name}! Restored ${healed} HP.`;
                    battle.phase = 'player_item_use';
                    battle.timer = 1400;
                } else {
                    battle.message = `${item.name} can't be used in battle.`;
                    battle.phase = 'player_item_msg';
                    battle.timer = 1100;
                }
                return true;
            }
            return true;
        }

        if (battle.phase === 'player_timing') {
            if (key === ' ') { resolvePlayerAttack(); return true; }
            return true;
        }

        return true;
    }

    function resolvePlayerAttack() {
        if (!battle.active || battle.phase !== 'player_timing') return;
        const p = battle.cursorPos;
        let mult = 0, result = 'MISS!';
        if      (p >= 0.44 && p <= 0.56) { mult = 1.6; result = 'CRITICAL!'; }
        else if ((p >= 0.32 && p < 0.44) || (p > 0.56 && p <= 0.68)) { mult = 1.0; result = 'HIT!'; }
        else if ((p >= 0.15 && p < 0.32) || (p > 0.68 && p <= 0.85)) { mult = 0.5; result = 'WEAK!'; }

        battle.hitDmg    = Math.round(getPlayerAtk() * mult);
        battle.hitResult = result;
        battle.phase     = 'player_result';
        battle.timer     = 1050;
        battle.message   = result === 'MISS!'     ? 'Your attack missed!'  :
                           result === 'WEAK!'     ? 'A glancing blow...'   :
                           result === 'HIT!'      ? 'A solid hit!'         : 'CRITICAL HIT!';
    }

    function update(dt) {
        if (!battle.active) return;
        const en = battle.enemy;
        if (battle.shakeTimer > 0) battle.shakeTimer = Math.max(0, battle.shakeTimer - dt);

        if (battle.phase === 'player_timing') {
            const speed = en.type === 'shade' ? 1.45 : 0.88;
            battle.cursorPos += battle.cursorDir * speed * (dt / 1000);
            if (battle.cursorPos >= 1) { battle.cursorPos = 1; battle.cursorDir = -1; }
            if (battle.cursorPos <= 0) { battle.cursorPos = 0; battle.cursorDir =  1; }

        } else if (battle.phase === 'player_result') {
            battle.timer -= dt;
            if (battle.timer <= 0) {
                en.hp -= battle.hitDmg;
                if (battle.hitDmg > 0) en.hurtTimer = 200;
                if (en.hp <= 0) {
                    en.hp = 0; en.alive = false;
                    battle.phase = 'victory'; battle.timer = 2200;
                    battle.message = `${en.name} was defeated!`;
                } else {
                    battle.phase = 'enemy_turn'; battle.timer = 1100;
                    battle.message = `${en.name}'s turn\u2026`;
                }
            }

        } else if (battle.phase === 'no_weapon') {
            battle.timer -= dt;
            if (battle.timer <= 0) {
                battle.phase = 'enemy_turn'; battle.timer = 1100;
                battle.message = `${en.name}'s turn\u2026`;
            }

        } else if (battle.phase === 'player_item_use') {
            battle.timer -= dt;
            if (battle.timer <= 0) {
                battle.phase = 'enemy_turn'; battle.timer = 1100;
                battle.message = `${en.name}'s turn\u2026`;
            }

        } else if (battle.phase === 'player_item_msg') {
            battle.timer -= dt;
            if (battle.timer <= 0) {
                battle.phase = 'player_item';
                battle.message = 'Choose an item.';
            }

        } else if (battle.phase === 'flee_attempt') {
            battle.timer -= dt;
            if (battle.timer <= 0) {
                const chance = en.type === 'shade' ? 0.55 : 0.82;
                if (Math.random() < chance) {
                    battle.message = 'Got away safely!';
                    battle.phase = 'flee_success'; battle.timer = 1200;
                } else {
                    battle.message = `Can't escape from ${en.name}!`;
                    battle.phase = 'enemy_turn'; battle.timer = 1100;
                }
            }

        } else if (battle.phase === 'flee_success') {
            battle.timer -= dt;
            if (battle.timer <= 0) endBattle('flee');

        } else if (battle.phase === 'enemy_turn') {
            battle.timer -= dt;
            if (battle.timer <= 0) {
                const dmg = calculateEnemyDamage(en.type, Game.gs.charClass);
                battle.playerDmgTaken = dmg.amount;
                battle.enemyHitType   = dmg.type;
                Game.gs.hp = Math.max(0, Game.gs.hp - dmg.amount);
                window.updateHPUI();
                if (dmg.type !== 'miss') battle.shakeTimer = 500;
                battle.phase = 'enemy_result'; battle.timer = 1100;
                battle.message = dmg.type === 'miss' ? `${en.name}'s attack missed!` :
                                 dmg.type === 'crit' ? `${en.name} lands a critical hit for ${dmg.amount} damage!` :
                                                       `${en.name} attacked for ${dmg.amount} damage!`;
            }

        } else if (battle.phase === 'enemy_result') {
            battle.timer -= dt;
            if (battle.timer <= 0) {
                if (Game.gs.hp <= 0) {
                    battle.phase = 'defeat'; battle.timer = 2400;
                    battle.message = 'You were defeated\u2026';
                } else {
                    battle.phase = 'player_menu';
                    battle.message = `What will ${Game.gs.charName} do?`;
                }
            }

        } else if (battle.phase === 'victory') {
            battle.timer -= dt;
            if (battle.timer <= 0) endBattle('victory');

        } else if (battle.phase === 'defeat') {
            battle.timer -= dt;
            if (battle.timer <= 0) endBattle('defeat');
        }
    }

    function endBattle(outcome) {
        if (Game.transition.active) return;
        battle.active = false;
        if (outcome === 'victory') {
            const xp = Game.ENEMY_DEFS[battle.enemy.type].xp;
            window.grantXP(xp);
            window.showNotification(`${battle.enemy.name} defeated! (+${xp} XP)`, 'quest');
        } else if (outcome === 'defeat') {
            Game.gs.hp = Math.max(1, Math.floor(Game.gs.maxHp * 0.2));
            window.updateHPUI();
            Game.transition.active = true;
            window.showDefeatOverlay();
            Game.transition.timerId = setTimeout(() => {
                try {
                    window.changeMap('village', 22, 32);
                } finally {
                    window.hideDefeatOverlay();
                    Game.transition.active = false;
                    Game.transition.timerId = null;
                }
            }, Game.DEFEAT_TRANSITION_MS);
        }
        // 'flee' just closes battle — no penalty, no XP
    }

    // ── Rendering ───────────────────────────────────────────
    // ctx passed per-frame; W, H, t read from Game.* (set by resizeCanvas / game loop).
    function render(ctx) {
        if (!battle.active) return;
        _ctx = ctx; _W = Game.cW; _H = Game.cH; _t = Game.timeMs / 1000;
        const en = battle.enemy;

        const shakeAmt = battle.shakeTimer > 0 ? Math.sin(battle.shakeTimer * 0.08) * 5 : 0;

        // Background
        ctx.fillStyle = '#080308'; ctx.fillRect(0, 0, W, H);
        const wallH = H * 0.52;
        ctx.fillStyle = '#120a10'; ctx.fillRect(0, 0, W, wallH);
        ctx.fillStyle = '#1e1018'; ctx.fillRect(0, wallH, W, H - wallH);
        ctx.fillStyle = '#2a1622'; ctx.fillRect(0, wallH, W, 3);
        ctx.fillStyle = '#0e080c';
        for (let i = 0; i < 7; i++) {
            const sx2 = W * 0.08 + i * W * 0.13;
            const sh  = H * (0.06 + (i % 3) * 0.04);
            ctx.beginPath(); ctx.moveTo(sx2 - W*.022, 0); ctx.lineTo(sx2 + W*.022, 0); ctx.lineTo(sx2, sh); ctx.closePath(); ctx.fill();
        }
        ctx.strokeStyle = '#3a1a30'; ctx.lineWidth = 1;
        for (let y2 = wallH + 10; y2 < H; y2 += 20) {
            ctx.beginPath(); ctx.moveTo(0, y2); ctx.lineTo(W, y2); ctx.stroke();
        }

        // Enemy HP card (top-left)
        const emaxhp = Game.ENEMY_DEFS[en.type].hp;
        drawBattleCard(W * 0.04, H * 0.04, W * 0.38, 56, en.name, `Lv ${en.type === 'lurker' ? 8 : 3}`, en.hp, emaxhp, false);

        // Enemy sprite (top-right)
        const ESZ = Math.min(W * 0.28, H * 0.40);
        const ESX = W * 0.56, ESY = H * 0.03;
        if (en.alive || battle.phase === 'victory') {
            ctx.save();
            if (battle.phase === 'player_result' && battle.hitDmg > 0) {
                const frac = 1 - battle.timer / 1050;
                const flashAlpha = frac < 0.3 ? frac / 0.3 : frac < 0.6 ? 1 : (1 - frac) / 0.4;
                ctx.globalAlpha = Math.max(0.3, 1 - flashAlpha * 0.5);
            }
            drawBattleSprite(ESX, ESY, ESZ, en.type);
            ctx.restore();
        }

        // Player HP card + sprite (bottom-left, with shake)
        const playerShakeX = shakeAmt;
        ctx.save(); ctx.translate(playerShakeX, 0);
        drawBattleCard(W * 0.04, wallH + H * 0.04, W * 0.40, 56, Game.gs.charName, `Lv ${Game.gs.level}`, Game.gs.hp, Game.gs.maxHp, true);
        const PSZ = Math.min(W * 0.18, H * 0.28);
        const PSX = W * 0.12, PSY = wallH - PSZ * 1.0;
        drawBattlePlayerSprite(PSX, PSY, PSZ);
        ctx.restore();

        // Bottom UI layout
        const uiTop = wallH + H * 0.01;
        const uiH   = H - uiTop;
        const msgW  = W * 0.48, menuW = W * 0.44;
        const msgX  = W * 0.04, menuX = W * 0.52;
        const boxH  = uiH * 0.86;
        const boxY  = uiTop + uiH * 0.08;

        // Full-width box for victory/defeat
        if (battle.phase === 'victory' || battle.phase === 'defeat') {
            drawDialogueBox(W * 0.04, boxY, W * 0.92, boxH);
            ctx.font = `bold ${Math.floor(H * 0.09)}px 'Cinzel', serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            if (battle.phase === 'victory') {
                ctx.fillStyle = '#ffd040'; ctx.shadowColor = '#ffa000'; ctx.shadowBlur = 24;
                ctx.fillText('VICTORY!', W / 2, boxY + boxH * 0.38);
                ctx.shadowBlur = 0; ctx.font = `${Math.floor(H * 0.042)}px sans-serif`;
                ctx.fillStyle = '#c8e890';
                ctx.fillText(`${en.name} was defeated!`, W / 2, boxY + boxH * 0.62);
                ctx.font = `${Math.floor(H * 0.036)}px sans-serif`; ctx.fillStyle = '#c8922a';
                ctx.fillText(`+${Game.ENEMY_DEFS[en.type].xp} XP`, W / 2, boxY + boxH * 0.80);
            } else {
                ctx.fillStyle = '#ff3030'; ctx.shadowColor = '#ff0000'; ctx.shadowBlur = 24;
                ctx.fillText('DEFEATED', W / 2, boxY + boxH * 0.38);
                ctx.shadowBlur = 0; ctx.font = `${Math.floor(H * 0.038)}px sans-serif`;
                ctx.fillStyle = '#c0a0b0';
                ctx.fillText('Returning to Eldoria\u2026', W / 2, boxY + boxH * 0.68);
            }
            ctx.shadowBlur = 0; ctx.textBaseline = 'alphabetic';
            return;
        }

        // Left: message box
        drawDialogueBox(msgX, boxY, msgW, boxH);
        ctx.font = `${Math.floor(H * 0.038)}px 'IM Fell English', serif`;
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillStyle = '#e8d8c0';
        wrapTextInBox(battle.message, msgX + 18, boxY + 16, msgW - 36, Math.floor(H * 0.038), Math.floor(H * 0.046));

        // Damage pop-up on enemy
        if (battle.phase === 'player_result' && battle.hitDmg > 0) {
            const colors = { 'CRITICAL!':'#ffd040', 'HIT!':'#90ff90', 'WEAK!':'#ff9040', 'MISS!':'#909090' };
            const col = colors[battle.hitResult] || '#fff';
            const pop = 1 - battle.timer / 1050;
            const py = ESY + ESZ * 0.3 - pop * H * 0.12;
            ctx.save(); ctx.globalAlpha = Math.min(1, (1 - pop) * 3);
            ctx.font = `bold ${Math.floor(H * 0.065)}px 'Cinzel', serif`;
            ctx.textAlign = 'center'; ctx.fillStyle = col;
            ctx.shadowColor = col; ctx.shadowBlur = 18;
            ctx.fillText(battle.hitDmg > 0 ? `-${battle.hitDmg}` : 'MISS', ESX + ESZ / 2, py);
            ctx.shadowBlur = 0; ctx.restore();
        }

        // Damage pop-up on player
        if (battle.phase === 'enemy_result') {
            const pop  = 1 - battle.timer / 1100;
            const py   = PSY + PSZ * 0.1 - pop * H * 0.10;
            const miss = battle.enemyHitType === 'miss';
            const crit = battle.enemyHitType === 'crit';
            ctx.save(); ctx.globalAlpha = Math.min(1, (1 - pop) * 3);
            ctx.font        = `bold ${Math.floor(H * 0.060)}px 'Cinzel', serif`;
            ctx.textAlign   = 'center';
            ctx.fillStyle   = miss ? '#909090' : crit ? '#ffd040' : '#ff5050';
            ctx.shadowColor = miss ? '#606060' : crit ? '#ffa000' : '#ff0000';
            ctx.shadowBlur  = 16;
            ctx.fillText(miss ? 'MISS' : `-${battle.playerDmgTaken}`, PSX + PSZ / 2 + playerShakeX, py);
            if (crit) {
                ctx.font = `bold ${Math.floor(H * 0.034)}px 'Cinzel', serif`;
                ctx.fillText('CRIT!', PSX + PSZ / 2 + playerShakeX, py - H * 0.055);
            }
            ctx.shadowBlur = 0; ctx.restore();
        }

        // Right: action menu / timing bar / waiting
        drawDialogueBox(menuX, boxY, menuW, boxH);
        if (battle.phase === 'player_menu') {
            drawBattleMenu(menuX, boxY, menuW, boxH);
        } else if (battle.phase === 'player_item') {
            drawBattleItemMenu(menuX, boxY, menuW, boxH);
        } else if (battle.phase === 'player_timing') {
            drawTimingBarInBox(menuX, boxY, menuW, boxH, en);
        } else {
            ctx.font = `${Math.floor(H * 0.042)}px sans-serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillStyle = '#6a5040';
            const dots = '.'.repeat(1 + Math.floor((_t * 2) % 3));
            ctx.fillText(dots, menuX + menuW / 2, boxY + boxH / 2);
        }

        ctx.shadowBlur = 0; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    }

    // ── Private draw helpers ────────────────────────────────

    function drawDialogueBox(x, y, w, h) {
        _ctx.fillStyle = 'rgba(10,6,2,0.96)';
        _ctx.strokeStyle = '#5a3820'; _ctx.lineWidth = 2;
        _ctx.beginPath(); _ctx.roundRect(x, y, w, h, 6); _ctx.fill(); _ctx.stroke();
    }

    function wrapTextInBox(text, x, y, maxW, fontSize, lineH) {
        const words = text.split(' ');
        let line = '', cy = y;
        for (const word of words) {
            const test = line ? line + ' ' + word : word;
            if (_ctx.measureText(test).width > maxW && line) {
                _ctx.fillText(line, x, cy);
                line = word; cy += lineH;
            } else { line = test; }
        }
        if (line) _ctx.fillText(line, x, cy);
    }

    function drawBattleCard(x, y, w, h, name, lvlText, hp, maxHp, showXp) {
        const P = Game.PALETTE;
        _ctx.fillStyle = 'rgba(10,6,2,0.90)';
        _ctx.strokeStyle = '#4a2818'; _ctx.lineWidth = 1.5;
        _ctx.beginPath(); _ctx.roundRect(x, y, w, h, 5); _ctx.fill(); _ctx.stroke();

        const pad = 10, bh = 8;
        _ctx.font = `bold ${Math.floor(h * 0.30)}px 'Cinzel', serif`;
        _ctx.textAlign = 'left'; _ctx.textBaseline = 'top';
        _ctx.fillStyle = '#d4b896'; _ctx.fillText(name, x + pad, y + pad);
        _ctx.font = `${Math.floor(h * 0.22)}px sans-serif`;
        _ctx.fillStyle = '#7a5a38'; _ctx.fillText(lvlText, x + w - pad - _ctx.measureText(lvlText).width, y + pad);

        const barY = y + h * 0.55, barX = x + pad, barW = w - pad * 2;
        _ctx.fillStyle = P.HP_BG; _ctx.fillRect(barX, barY, barW, bh);
        const pct = Math.max(0, hp / maxHp);
        _ctx.fillStyle = pct > 0.5 ? P.HP_FULL : pct > 0.25 ? P.HP_MID : P.HP_LOW;
        _ctx.fillRect(barX, barY, barW * pct, bh);
        _ctx.strokeStyle = '#3a1a10'; _ctx.lineWidth = 1; _ctx.strokeRect(barX, barY, barW, bh);

        _ctx.font = `${Math.floor(h * 0.20)}px sans-serif`;
        _ctx.textAlign = 'right'; _ctx.fillStyle = '#8a6050';
        _ctx.fillText(`${Math.ceil(hp)}/${maxHp}`, x + w - pad, barY + bh + 3);

        if (showXp) {
            const xpBarY = barY + bh + 14;
            _ctx.fillStyle = '#0a0a10'; _ctx.fillRect(barX, xpBarY, barW, 5);
            _ctx.fillStyle = P.XP_FILL; _ctx.fillRect(barX, xpBarY, barW * window.xpProgressPct(), 5);
            _ctx.strokeStyle = '#1a1a30'; _ctx.lineWidth = 1; _ctx.strokeRect(barX, xpBarY, barW, 5);
            _ctx.font = `${Math.floor(h * 0.17)}px sans-serif`;
            _ctx.textAlign = 'right'; _ctx.fillStyle = '#4060a0';
            _ctx.fillText(Game.gs.level < Game.MAX_LEVEL ? `XP: ${window.xpToNext()} to Lv${Game.gs.level + 1}` : 'MAX', x + w - pad, xpBarY + 6);
        }
        _ctx.textBaseline = 'alphabetic'; _ctx.textAlign = 'left';
    }

    function drawBattleMenu(x, y, w, h) {
        const MENU = [
            { label:'\u2694  FIGHT', sub:'Timing minigame', color:'#c8922a', warn: !hasWeapon() },
            { label:'\uD83C\uDF92  ITEM',  sub:`${Game.gs.inventory.length} item${Game.gs.inventory.length !== 1 ? 's' : ''}`, color:'#5090d0' },
            { label:'\uD83D\uDCA8  FLEE',  sub:'Try to escape',  color:'#40a060' },
        ];
        const rowH = h / MENU.length;
        MENU.forEach((opt, i) => {
            const ry = y + i * rowH;
            const selected = battle.menuCursor === i;
            if (selected) {
                _ctx.fillStyle = 'rgba(200,146,42,0.10)';
                _ctx.beginPath(); _ctx.roundRect(x + 4, ry + 4, w - 8, rowH - 8, 4); _ctx.fill();
                _ctx.strokeStyle = '#c8922a'; _ctx.lineWidth = 1.5;
                _ctx.beginPath(); _ctx.roundRect(x + 4, ry + 4, w - 8, rowH - 8, 4); _ctx.stroke();
            }
            const midY = ry + rowH / 2;
            _ctx.font = `bold ${Math.floor(rowH * 0.42)}px sans-serif`;
            _ctx.textAlign = 'left'; _ctx.textBaseline = 'middle';
            _ctx.fillStyle = selected ? '#c8922a' : 'transparent';
            _ctx.fillText('\u25B6', x + 14, midY);
            _ctx.fillStyle = opt.warn ? '#806040' : (selected ? '#e8c890' : opt.color);
            _ctx.font = `bold ${Math.floor(rowH * 0.42)}px 'Cinzel', serif`;
            _ctx.fillText(opt.label, x + 34, midY - rowH * 0.08);
            _ctx.font = `${Math.floor(rowH * 0.28)}px sans-serif`;
            _ctx.fillStyle = opt.warn ? '#a04020' : (selected ? '#8a7050' : '#4a3a28');
            _ctx.fillText(opt.warn ? '\u26A0 No weapon equipped' : opt.sub, x + 34, midY + rowH * 0.22);
            if (i < MENU.length - 1) {
                _ctx.strokeStyle = '#2a1808'; _ctx.lineWidth = 1;
                _ctx.beginPath(); _ctx.moveTo(x + 12, ry + rowH); _ctx.lineTo(x + w - 12, ry + rowH); _ctx.stroke();
            }
        });
        _ctx.textBaseline = 'alphabetic';
    }

    function drawBattleItemMenu(x, y, w, h) {
        const items = Game.gs.inventory;
        if (items.length === 0) {
            _ctx.font = `italic ${Math.floor(h * 0.14)}px 'IM Fell English', serif`;
            _ctx.textAlign = 'center'; _ctx.textBaseline = 'middle';
            _ctx.fillStyle = '#7a5a40';
            _ctx.fillText('Pack is empty.', x + w / 2, y + h / 2);
            _ctx.textBaseline = 'alphabetic'; return;
        }
        const rowH = Math.min(h / Math.max(items.length, 1), h / 4);
        const pad = 12;
        items.forEach((item, i) => {
            const ry = y + i * rowH;
            const sel = battle.itemCursor === i;
            if (sel) {
                _ctx.fillStyle = 'rgba(80,144,208,0.12)';
                _ctx.beginPath(); _ctx.roundRect(x + 4, ry + 3, w - 8, rowH - 6, 4); _ctx.fill();
                _ctx.strokeStyle = '#5090d0'; _ctx.lineWidth = 1.5;
                _ctx.beginPath(); _ctx.roundRect(x + 4, ry + 3, w - 8, rowH - 6, 4); _ctx.stroke();
            }
            const midY = ry + rowH / 2;
            _ctx.font = `${Math.floor(rowH * 0.48)}px sans-serif`;
            _ctx.textAlign = 'left'; _ctx.textBaseline = 'middle';
            _ctx.fillStyle = sel ? '#e8c890' : '#8a6840';
            _ctx.fillText(sel ? '\u25B6' : ' ', x + pad, midY);
            _ctx.fillText(item.icon || '\u25C6', x + pad + 20, midY);
            _ctx.font = `${Math.floor(rowH * 0.36)}px 'Cinzel', serif`;
            _ctx.fillStyle = item.questComplete ? '#c8922a' : (sel ? '#d4b896' : '#7a5a38');
            _ctx.fillText(item.name, x + pad + 44, midY - rowH * 0.06);
            _ctx.font = `${Math.floor(rowH * 0.26)}px sans-serif`;
            _ctx.fillStyle = '#4a3828';
            const subText = item.healAmt ? `Restores ${item.healAmt} HP` : item.questComplete ? 'Equipped' : 'No battle use';
            _ctx.fillText(subText, x + pad + 44, midY + rowH * 0.24);
        });
        _ctx.font = `${Math.floor(h * 0.09)}px sans-serif`;
        _ctx.textAlign = 'center'; _ctx.textBaseline = 'bottom';
        _ctx.fillStyle = '#3a2818';
        _ctx.fillText('[Esc] Back', x + w / 2, y + h - 6);
        _ctx.textBaseline = 'alphabetic';
    }

    function drawTimingBarInBox(x, y, w, h, en) {
        const pad = 16, bh = Math.floor(h * 0.18);
        const barY = y + h * 0.46, barX = x + pad, barW = w - pad * 2;

        const zones = [
            {from:0,    to:0.15, col:'#3a0e06'},
            {from:0.15, to:0.32, col:'#7a3206'},
            {from:0.32, to:0.44, col:'#7a7408'},
            {from:0.44, to:0.56, col:'#0a7820'},
            {from:0.56, to:0.68, col:'#7a7408'},
            {from:0.68, to:0.85, col:'#7a3206'},
            {from:0.85, to:1.0,  col:'#3a0e06'},
        ];
        for (const z of zones) {
            _ctx.fillStyle = z.col;
            _ctx.fillRect(barX + barW * z.from, barY, barW * (z.to - z.from), bh);
        }
        _ctx.font = `bold ${Math.floor(bh * 0.40)}px sans-serif`;
        _ctx.textAlign = 'center'; _ctx.textBaseline = 'middle';
        _ctx.fillStyle = 'rgba(255,255,255,0.55)';
        _ctx.fillText('CRIT', barX + barW * 0.50, barY + bh / 2);
        _ctx.fillStyle = 'rgba(255,255,255,0.30)';
        _ctx.fillText('HIT', barX + barW * 0.38, barY + bh / 2);
        _ctx.fillText('HIT', barX + barW * 0.62, barY + bh / 2);
        _ctx.strokeStyle = '#6a4030'; _ctx.lineWidth = 1.5; _ctx.strokeRect(barX, barY, barW, bh);

        const cx2 = barX + barW * battle.cursorPos;
        _ctx.fillStyle = '#ffffff';
        _ctx.beginPath(); _ctx.moveTo(cx2, barY - 7); _ctx.lineTo(cx2 - 6, barY - 15); _ctx.lineTo(cx2 + 6, barY - 15); _ctx.closePath(); _ctx.fill();
        _ctx.fillRect(cx2 - 3, barY, 6, bh);
        _ctx.shadowColor = '#ffffff'; _ctx.shadowBlur = 10;
        _ctx.beginPath(); _ctx.arc(cx2, barY + bh / 2, 4, 0, Math.PI * 2); _ctx.fill();
        _ctx.shadowBlur = 0;

        _ctx.font = `bold ${Math.floor(h * 0.13)}px 'Cinzel', serif`;
        _ctx.textAlign = 'center'; _ctx.textBaseline = 'top';
        _ctx.fillStyle = '#c8922a';
        _ctx.fillText('STRIKE!', x + w / 2, y + h * 0.10);
        _ctx.font = `${Math.floor(h * 0.09)}px sans-serif`;
        _ctx.fillStyle = '#6a5040';
        _ctx.fillText('Press SPACE at the right moment', x + w / 2, y + h * 0.25);

        const speedLabel = en.type === 'shade' ? '\u26A1 Fast' : '\uD83D\uDC22 Slow';
        _ctx.font = `${Math.floor(h * 0.09)}px sans-serif`;
        _ctx.fillStyle = en.type === 'shade' ? '#c85050' : '#508050';
        _ctx.fillText(speedLabel, x + w / 2, y + h * 0.80);
        _ctx.textBaseline = 'alphabetic';
    }

    function drawBattleSprite(sx, sy, sz, type) {
        const cx = sx + sz / 2, cy = sy + sz * 0.5;
        _ctx.save();
        if (type === 'shade') {
            const fl = Math.sin(_t * 2.4) * sz * 0.04;
            _ctx.fillStyle = '#0a021a';
            _ctx.beginPath(); _ctx.arc(cx, cy + fl, sz * .42, 0, Math.PI*2); _ctx.fill();
            _ctx.fillStyle = '#150535';
            _ctx.beginPath(); _ctx.arc(cx - sz*.18, cy - sz*.12 + fl, sz*.36, 0, Math.PI*2); _ctx.fill();
            _ctx.beginPath(); _ctx.arc(cx + sz*.18, cy + sz*.04 + fl, sz*.34, 0, Math.PI*2); _ctx.fill();
            _ctx.fillStyle = '#220a50';
            _ctx.beginPath(); _ctx.arc(cx, cy - sz*.06 + fl, sz*.30, 0, Math.PI*2); _ctx.fill();
            _ctx.fillStyle = '#0d0220';
            for (let i = 0; i < 4; i++) {
                const tx2 = cx + (i - 1.5) * sz * .18;
                const th = sz * (0.18 + Math.sin(_t * 1.8 + i) * 0.06);
                _ctx.beginPath(); _ctx.ellipse(tx2, cy + sz*.3 + th/2, sz*.045, th/2, 0, 0, Math.PI*2); _ctx.fill();
            }
            _ctx.shadowColor = '#ff0010'; _ctx.shadowBlur = sz * .12;
            _ctx.fillStyle = '#ff1020';
            _ctx.beginPath(); _ctx.arc(cx - sz*.10, cy - sz*.06 + fl, sz*.07, 0, Math.PI*2); _ctx.fill();
            _ctx.beginPath(); _ctx.arc(cx + sz*.10, cy - sz*.06 + fl, sz*.07, 0, Math.PI*2); _ctx.fill();
            _ctx.fillStyle = '#ff9090'; _ctx.shadowBlur = 0;
            _ctx.beginPath(); _ctx.arc(cx - sz*.10, cy - sz*.06 + fl, sz*.025, 0, Math.PI*2); _ctx.fill();
            _ctx.beginPath(); _ctx.arc(cx + sz*.10, cy - sz*.06 + fl, sz*.025, 0, Math.PI*2); _ctx.fill();
        } else {
            _ctx.fillStyle = 'rgba(0,0,0,0.5)';
            _ctx.beginPath(); _ctx.ellipse(cx, cy + sz*.50, sz*.50, sz*.10, 0, 0, Math.PI*2); _ctx.fill();
            _ctx.fillStyle = '#1e0e08';
            _ctx.beginPath(); _ctx.ellipse(cx, cy, sz*.45, sz*.40, 0, 0, Math.PI*2); _ctx.fill();
            _ctx.fillStyle = '#4a2818';
            _ctx.beginPath(); _ctx.ellipse(cx, cy - sz*.03, sz*.40, sz*.35, 0, 0, Math.PI*2); _ctx.fill();
            const plates = [
                {ox:-0.22, oy:-0.18, w:.22, h:.17},
                {ox: 0.05, oy:-0.26, w:.26, h:.15},
                {ox: 0.18, oy:-0.06, w:.20, h:.18},
                {ox:-0.10, oy: 0.08, w:.24, h:.16},
                {ox: 0.10, oy: 0.15, w:.18, h:.14},
            ];
            for (const pl of plates) {
                _ctx.fillStyle = '#6a3c20';
                _ctx.beginPath(); _ctx.ellipse(cx + pl.ox*sz, cy + pl.oy*sz, pl.w*sz, pl.h*sz, 0, 0, Math.PI*2); _ctx.fill();
                _ctx.fillStyle = '#8a5030';
                _ctx.beginPath(); _ctx.ellipse(cx + pl.ox*sz - sz*.01, cy + pl.oy*sz - sz*.015, pl.w*sz*.65, pl.h*sz*.55, 0, 0, Math.PI*2); _ctx.fill();
            }
            _ctx.shadowColor = '#ff8010'; _ctx.shadowBlur = sz * .10;
            _ctx.fillStyle = '#ff8010';
            const eyeY = cy - sz * .07;
            for (let i = -1; i <= 1; i++) {
                _ctx.beginPath(); _ctx.arc(cx + i*sz*.18, eyeY, sz*.065, 0, Math.PI*2); _ctx.fill();
            }
            _ctx.fillStyle = '#ffdd80'; _ctx.shadowBlur = 0;
            for (let i = -1; i <= 1; i++) {
                _ctx.beginPath(); _ctx.arc(cx + i*sz*.18, eyeY, sz*.022, 0, Math.PI*2); _ctx.fill();
            }
            _ctx.fillStyle = '#2a1208';
            for (let i = -1; i <= 1; i++) {
                _ctx.beginPath();
                _ctx.moveTo(cx + i*sz*.20 - sz*.05, cy + sz*.30);
                _ctx.lineTo(cx + i*sz*.20, cy + sz*.48);
                _ctx.lineTo(cx + i*sz*.20 + sz*.05, cy + sz*.30);
                _ctx.fill();
            }
        }
        _ctx.restore();
    }

    function drawBattlePlayerSprite(sx, sy, sz) {
        const cx = sx + sz / 2, cy = sy + sz / 2;
        const col   = Game.CLASS_COLORS[Game.gs.charClass] || Game.CLASS_COLORS.Warrior;
        const cloak = Game.CLASS_CLOAK[Game.gs.charClass]  || '#4a2810';
        _ctx.save();
        _ctx.fillStyle = 'rgba(0,0,0,0.4)';
        _ctx.beginPath(); _ctx.ellipse(cx, cy + sz*.40, sz*.30, sz*.07, 0, 0, Math.PI*2); _ctx.fill();
        _ctx.fillStyle = cloak;
        _ctx.beginPath(); _ctx.arc(cx, cy + sz*.05, sz*.38, 0, Math.PI*2); _ctx.fill();
        _ctx.fillStyle = col;
        _ctx.beginPath(); _ctx.arc(cx, cy, sz*.32, 0, Math.PI*2); _ctx.fill();
        _ctx.strokeStyle = 'rgba(0,0,0,0.4)'; _ctx.lineWidth = 2; _ctx.stroke();
        _ctx.fillStyle = '#e8cfa0';
        _ctx.beginPath(); _ctx.arc(cx, cy - sz*.28, sz*.17, 0, Math.PI*2); _ctx.fill();
        _ctx.strokeStyle = 'rgba(0,0,0,0.25)'; _ctx.lineWidth = 1; _ctx.stroke();
        _ctx.fillStyle = cloak;
        _ctx.beginPath(); _ctx.arc(cx, cy - sz*.32, sz*.16, Math.PI, Math.PI*2); _ctx.fill();
        const hasWep = Game.gs.inventory.some(i => i.questComplete === 'quest_weapon_complete');
        if (hasWep) {
            _ctx.fillStyle = '#a0a8d0'; _ctx.strokeStyle = '#606080'; _ctx.lineWidth = 2;
            _ctx.save(); _ctx.translate(cx + sz*.25, cy - sz*.12); _ctx.rotate(-0.3);
            _ctx.fillRect(-sz*.04, -sz*.30, sz*.07, sz*.42);
            _ctx.fillStyle = '#6a3010'; _ctx.fillRect(-sz*.06, sz*.05, sz*.11, sz*.08);
            _ctx.restore();
        }
        _ctx.restore();
    }

    return { start, handleInput, update, render, isActive };
})();

window.battleSystem = battleSystem;
