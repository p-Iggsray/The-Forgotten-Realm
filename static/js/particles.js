'use strict';

// particles.js — Particle subsystem module
// Owns: PARTICLES array, _partTimer, _partCount, MOTE_COUNT, _motes
// Public API: spawn(type,x,y), update(dt,currentMap,player,TS),
//             render(ctx,cam), renderMotes(ctx)
// ui.loading/paused guard lives at the call site — this module has no ui dependency.
const particleSystem = (() => {
    const Game = window.Game;

    const PARTICLES = [];
    let   _partTimer = 0;
    const _partCount = { firefly:0, dust:0, spark:0, leaf:0 };

    const MOTE_COUNT = 20;
    const _motes = Array.from({ length: MOTE_COUNT }, () => ({
        x: Math.random(),
        y: Math.random(),
        vy: 0.10 + Math.random() * 0.14,
        vx: (Math.random() - 0.5) * 0.06,
        size: Math.random() < 0.5 ? 1 : 1.5,
        phase: Math.random() * Math.PI * 2,
        init: false,
    }));

    function spawn(type, x, y) {
        const r = Math.random;
        const P = Game.PALETTE;
        const p = { type, x, y, life:0 };
        if      (type === 'firefly') Object.assign(p, { vx:(r()-.5)*.28, vy:(r()-.5)*.28, maxLife:5000+r()*5000, size:1.5+r()*1.5, phase:r()*Math.PI*2 });
        else if (type === 'dust')   Object.assign(p, { vx:(r()-.5)*.07, vy:-.03-r()*.04, maxLife:3000+r()*2000, size:1+r()*.8 });
        else if (type === 'spark')  Object.assign(p, { vx:(r()-.5)*2.2, vy:-1.4-r()*2, maxLife:350+r()*500, size:1.5+r(), color:r()<.5?P.A_ORANGE:P.A_YELLOW });
        else if (type === 'leaf')   Object.assign(p, { vx:.15+r()*.35, vy:.08+r()*.18, maxLife:6000+r()*4000, size:2+r(), color:r()<.5?P.S_DARK:P.M_CLAY, angle:r()*Math.PI*2, spin:(r()-.5)*.05 });
        PARTICLES.push(p);
        if (_partCount[type] !== undefined) _partCount[type]++;
    }

    function update(dt, currentMap, player, TS) {
        _partTimer += dt;
        if (_partTimer > 280) { _partTimer = 0; _spawnAmbient(currentMap, player, TS); }
        for (let i = PARTICLES.length - 1; i >= 0; i--) {
            const p = PARTICLES[i];
            p.life += dt;
            if (p.life >= p.maxLife) {
                if (_partCount[p.type] !== undefined) _partCount[p.type]--;
                PARTICLES.splice(i, 1); continue;
            }
            p.x += p.vx; p.y += p.vy;
            if (p.type === 'firefly') {
                p.vx += (Math.random() - .5) * .024; p.vy += (Math.random() - .5) * .024;
                p.vx = Math.max(-.38, Math.min(.38, p.vx));
                p.vy = Math.max(-.38, Math.min(.38, p.vy));
            } else if (p.type === 'spark') {
                p.vy += .09;
            } else if (p.type === 'leaf') {
                p.vx += Math.sin(p.life * .002) * .012; p.vy += .005; p.angle += p.spin;
            }
        }
    }

    function _spawnAmbient(currentMap, player, TS) {
        if (!currentMap) return;
        const TILE = Game.TILE;
        const maxR = 13;
        if (!currentMap.dark && !currentMap.returnMap) {
            if (_partCount.firefly < 7) {
                const tx = Math.floor(player.x + (Math.random() - .5) * maxR * 2);
                const ty = Math.floor(player.y + (Math.random() - .5) * maxR * 2);
                const t  = currentMap.tiles[ty]?.[tx];
                if (t === TILE.GRASS || t === TILE.TREE)
                    spawn('firefly', (tx + Math.random()) * TS, (ty + Math.random()) * TS - TS * .3);
            }
            if (_partCount.leaf < 4) {
                const tx = Math.floor(player.x + (Math.random() - .5) * maxR * 2);
                const ty = Math.floor(player.y + (Math.random() - .5) * maxR * 2);
                if (currentMap.tiles[ty]?.[tx] === TILE.TREE)
                    spawn('leaf', (tx + Math.random()) * TS, (ty + Math.random()) * TS);
            }
        } else {
            if (_partCount.dust < 14)
                spawn('dust',
                    (player.x + (Math.random() - .5) * maxR) * TS,
                    (player.y + (Math.random() - .5) * maxR) * TS);
        }
        if (currentMap.id === 'int_blacksmith') {
            if (_partCount.spark < 12)
                spawn('spark', 11 * TS + TS * .5, 1 * TS + TS * .25);
        }
    }

    function render(ctx, cam) {
        const cW = Game.cW, cH = Game.cH;
        ctx.save();

        // Pass 1: fireflies
        ctx.shadowColor = '#80ff80'; ctx.shadowBlur = 10; ctx.fillStyle = '#c0ffc0';
        for (const p of PARTICLES) {
            if (p.type !== 'firefly') continue;
            const sx = p.x - cam.x, sy = p.y - cam.y;
            if (sx < -30 || sx > cW + 30 || sy < -30 || sy > cH + 30) continue;
            const pct = p.life / p.maxLife;
            ctx.globalAlpha = Math.sin(pct * Math.PI) * (.5 + .4 * Math.sin(p.life * .008 + p.phase));
            ctx.beginPath(); ctx.arc(Math.floor(sx), Math.floor(sy), p.size, 0, Math.PI * 2); ctx.fill();
        }

        // Pass 2: dust + leaves
        ctx.shadowBlur = 0;
        for (const p of PARTICLES) {
            if (p.type !== 'dust' && p.type !== 'leaf') continue;
            const sx = p.x - cam.x, sy = p.y - cam.y;
            if (sx < -30 || sx > cW + 30 || sy < -30 || sy > cH + 30) continue;
            const pct = p.life / p.maxLife;
            if (p.type === 'dust') {
                ctx.globalAlpha = Math.sin(pct * Math.PI) * .22;
                ctx.fillStyle   = '#806050';
                ctx.fillRect(Math.floor(sx), Math.floor(sy), Math.ceil(p.size), Math.ceil(p.size));
            } else {
                ctx.globalAlpha = Math.sin(pct * Math.PI) * .75;
                ctx.fillStyle   = p.color;
                ctx.save(); ctx.translate(Math.floor(sx), Math.floor(sy)); ctx.rotate(p.angle);
                ctx.fillRect(-p.size, -p.size * .5, p.size * 2, p.size); ctx.restore();
            }
        }

        // Pass 3: sparks
        ctx.shadowBlur = 5;
        for (const p of PARTICLES) {
            if (p.type !== 'spark') continue;
            const sx = p.x - cam.x, sy = p.y - cam.y;
            if (sx < -30 || sx > cW + 30 || sy < -30 || sy > cH + 30) continue;
            const pct = p.life / p.maxLife;
            ctx.globalAlpha = (1 - pct) * .9;
            ctx.shadowColor = p.color; ctx.fillStyle = p.color;
            ctx.fillRect(Math.floor(sx), Math.floor(sy), Math.ceil(p.size), Math.ceil(p.size));
        }

        ctx.shadowBlur = 0; ctx.globalAlpha = 1;
        ctx.restore();
    }

    function renderMotes(ctx) {
        const cW = Game.cW, cH = Game.cH, timeMs = Game.timeMs;
        ctx.save();
        for (const m of _motes) {
            if (!m.init) { m.x = Math.random() * cW; m.y = Math.random() * cH; m.init = true; }
            m.x += m.vx;
            m.y -= m.vy;
            if (m.y < -4)     { m.y = cH + 2; m.x = Math.random() * cW; }
            if (m.x < -4)     m.x = cW + 2;
            if (m.x > cW + 4) m.x = -2;
            const a = 0.18 + 0.10 * Math.sin(timeMs * 0.003 + m.phase);
            ctx.globalAlpha = a;
            ctx.fillStyle = '#e8e0d0';
            ctx.beginPath(); ctx.arc(Math.round(m.x), Math.round(m.y), m.size, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.restore();
    }

    return { spawn, update, render, renderMotes };
})();

window.particleSystem = particleSystem;
