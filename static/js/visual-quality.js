'use strict';
// ═══════════════════════════════════════════════════════════════════
//  visual-quality.js  ─  The Forgotten Realm
//
//  Four systems that maximise tile visual quality:
//
//  1. Ambient occlusion   walls/trees cast soft shadow gradients onto
//                         adjacent floor, grass, path, water tiles.
//                         Baked into bgCanvas — zero per-frame cost.
//
//  2. Autotile blending   bilateral dither at ALL terrain borders:
//                         PATH↔GRASS, WATER↔GRASS, WATER↔PATH.
//                         The existing grass-side strips (in drawTile)
//                         are kept; this adds the matching other side.
//                         Also baked into bgCanvas.
//
//  3. Grass sway          3-step wind animation on grass tiles within
//                         a player-radius. Sway frames pre-rendered
//                         from the existing _tc cache; only frames 1-2
//                         draw (frame 0 = static baked tile, no overdraw).
//
//  4. Post-processing     (a) Warm amber screen overlay — pushes all
//                             midtones toward a late-afternoon RPG tone.
//                         (b) Full-scene vignette — intensity varies by
//                             map type (outdoor/interior/dungeon).
//                         (c) Outdoor torch glow — screen-blend radial
//                             light around torches on non-dark maps.
//
//  Integration (4 surgical edits to game.js — see that file):
//    rebuildBgCanvas()   → VQ.bakeAO(bgCtx, stx, sty, etx, ety)
//    drawAnimatedTiles() → VQ.drawSwayPass()
//    render()            → VQ.renderColorGrade()
//                          VQ.renderOutdoorTorchGlow()
//    resizeCanvas()      → VQ.invalidate()
//
//  Depends on game.js globals: PALETTE, TILE, TS, cW, cH, cam,
//    timeMs, currentMap, ctx, bgCtx, _tc, dither2, player
// ═══════════════════════════════════════════════════════════════════

const VQ = (() => {
    'use strict';

    // ─── config ──────────────────────────────────────────────────────
    const C = {
        // Ambient occlusion
        aoNAlpha:  0.40,   // shadow alpha from north wall/tree
        aoWAlpha:  0.22,   // shadow alpha from west wall/tree (softer)
        aoNDepth:  0.44,   // shadow height as fraction of TS (north)
        aoWDepth:  0.30,   // shadow width  as fraction of TS (west)
        aoCrnr:    0.18,   // corner fill radius as fraction of TS

        // Terrain blend strip
        blendW:    0.14,   // dither strip width as fraction of TS

        // Grass sway
        swayFps:    3,     // animation steps per second
        swayRadius: 7,     // tile radius around player to animate

        // Color grade
        warmAlpha:  0.055, // warm screen overlay opacity
        vigOutdoor: 0.40,  // vignette max-alpha outdoors
        vigInterior:0.54,  // vignette max-alpha in buildings
        vigDungeon: 0.70,  // vignette max-alpha in dark dungeons

        // Outdoor torch
        torchRadius: 4.8,  // torch glow radius in tile widths
        torchAlpha:  0.13, // peak glow alpha (screen blend)

        // Grass sway frame compositing
        swayDarkAlpha:  0.22,  // shadow strip opacity (leaning blades, dark edge)
        swayLightAlpha: 0.15,  // bright strip opacity (leaning blades, lit face)
        swayPhaseScale: 0.001, // timeMs → phase multiplier for per-tile wind offset
    };

    // ─── cached torch disc for outdoor glow ─────────────────────────
    let _vqTorchDisc = null, _vqDiscTS = 0;
    function _ensureVqDisc() {
        if (_vqDiscTS === TS) return;
        _vqDiscTS = TS;
        const rad = Math.ceil(TS * C.torchRadius);
        const d = rad * 2;
        _vqTorchDisc = document.createElement('canvas');
        _vqTorchDisc.width = _vqTorchDisc.height = d;
        const dc = _vqTorchDisc.getContext('2d');
        const g = dc.createRadialGradient(rad,rad,0,rad,rad,rad);
        g.addColorStop(0,    'rgba(255,165,45,1)');
        g.addColorStop(0.25, 'rgba(230,100,15,0.57)');
        g.addColorStop(0.55, 'rgba(180,55,0,0.25)');
        g.addColorStop(0.85, 'rgba(120,30,0,0.08)');
        g.addColorStop(1,    'rgba(0,0,0,0)');
        dc.fillStyle = g; dc.beginPath(); dc.arc(rad,rad,rad,0,Math.PI*2); dc.fill();
    }

    // ─── tile sets (lazily initialised after game.js defines TILE) ──
    let _AO_CAST, _AO_RECV;
    function _sets() {
        if (_AO_CAST) return;
        _AO_CAST = new Set([TILE.BUILDING_WALL, TILE.TREE]);
        _AO_RECV = new Set([
            TILE.BUILDING_FLOOR, TILE.GRASS, TILE.DIRT_PATH, TILE.STONE_PATH, TILE.WATER,
            TILE.DOOR, TILE.SIGN, TILE.STAIRS, TILE.STAIRSUP,
        ]);
    }

    // Pre-rendered AO strips — built once per TS, blitted per tile during bakeAO.
    // Eliminates ~300+ createLinearGradient calls per bgCanvas rebuild.
    let _aoNStrip = null, _aoWStrip = null, _aoCornerStrip = null, _aoStripTS = 0;
    function _ensureAOStrips(ts) {
        if (_aoStripTS === ts) return;
        _aoStripTS = ts;

        const sh = Math.floor(ts * C.aoNDepth);
        _aoNStrip = document.createElement('canvas');
        _aoNStrip.width = ts + 1; _aoNStrip.height = sh;
        const nc = _aoNStrip.getContext('2d');
        nc.imageSmoothingEnabled = false;
        const ng = nc.createLinearGradient(0, 0, 0, sh);
        ng.addColorStop(0,    `rgba(0,2,10,${C.aoNAlpha})`);
        ng.addColorStop(0.45, `rgba(0,2,10,${C.aoNAlpha * 0.30})`);
        ng.addColorStop(1,    'rgba(0,2,10,0)');
        nc.fillStyle = ng;
        nc.fillRect(0, 0, ts + 1, sh);

        const sw = Math.floor(ts * C.aoWDepth);
        _aoWStrip = document.createElement('canvas');
        _aoWStrip.width = sw; _aoWStrip.height = ts + 1;
        const wc = _aoWStrip.getContext('2d');
        wc.imageSmoothingEnabled = false;
        const wg = wc.createLinearGradient(0, 0, sw, 0);
        wg.addColorStop(0,    `rgba(0,2,10,${C.aoWAlpha})`);
        wg.addColorStop(0.45, `rgba(0,2,10,${C.aoWAlpha * 0.25})`);
        wg.addColorStop(1,    'rgba(0,2,10,0)');
        wc.fillStyle = wg;
        wc.fillRect(0, 0, sw, ts + 1);

        const cr = Math.floor(ts * C.aoCrnr);
        _aoCornerStrip = document.createElement('canvas');
        _aoCornerStrip.width = _aoCornerStrip.height = cr;
        const cc = _aoCornerStrip.getContext('2d');
        cc.imageSmoothingEnabled = false;
        const cg = cc.createRadialGradient(0, 0, 0, 0, 0, cr);
        cg.addColorStop(0, `rgba(0,2,10,${C.aoNAlpha * 0.55})`);
        cg.addColorStop(1, 'rgba(0,2,10,0)');
        cc.fillStyle = cg;
        cc.fillRect(0, 0, cr, cr);
    }

    // ═══════════════════════════════════════════════════════════════
    //  1 + 2 — AMBIENT OCCLUSION + AUTOTILE BLENDING
    //  Baked into bgCtx once per bgDirty rebuild. No per-frame cost.
    // ═══════════════════════════════════════════════════════════════

    // Called at the end of rebuildBgCanvas(), while ctx is still redirected.
    // bgc  = bgCtx (passed explicitly — cleaner than relying on the ctx redirect)
    // stx…ety = the same visible tile range used by rebuildBgCanvas
    // bakeOffX / bakeOffY: pixel offset added to every draw coordinate so that AO
    // gradients align correctly when bgCanvas is larger than the viewport (Fix 3).
    // Callers that do not use a buffered canvas pass no arguments (defaults to 0).
    function bakeAO(bgc, stx, sty, etx, ety, bakeOffX = 0, bakeOffY = 0) {
        _sets();
        _ensureAOStrips(TS);
        const P  = PALETTE;
        const T  = TS;
        const bw = Math.max(4, Math.floor(T * C.blendW));

        for (let ty = sty; ty <= ety; ty++) {
            for (let tx = stx; tx <= etx; tx++) {
                const tile = currentMap.tiles[ty]?.[tx];
                if (tile === undefined) continue;

                const px = Math.floor(tx * T - cam.x) + bakeOffX;
                const py = Math.floor(ty * T - cam.y) + bakeOffY;

                // ── Ambient occlusion ─────────────────────────────────
                if (_AO_RECV.has(tile)) {
                    const tN  = currentMap.tiles[ty - 1]?.[tx];
                    const tW  = currentMap.tiles[ty]?.[tx - 1];
                    const tNW = currentMap.tiles[ty - 1]?.[tx - 1];

                    // North wall/tree → shadow falling south (blit pre-rendered strip)
                    if (_AO_CAST.has(tN)) bgc.drawImage(_aoNStrip, px, py);

                    // West wall/tree → shadow falling east (blit pre-rendered strip)
                    if (_AO_CAST.has(tW)) bgc.drawImage(_aoWStrip, px, py);

                    // NW corner — fills the gap when neither N nor W alone casts
                    if (_AO_CAST.has(tNW) && !_AO_CAST.has(tN) && !_AO_CAST.has(tW))
                        bgc.drawImage(_aoCornerStrip, px, py);
                }

                // ── Autotile blending — PATH side ─────────────────────
                // The existing code already blends FROM the GRASS side.
                // Here we add the matching blend from PATH facing GRASS/TREE,
                // plus diagonal corner fills to remove bare notch artifacts.
                if (tile === TILE.DIRT_PATH || tile === TILE.STONE_PATH) {
                    const dirs = [
                        [tx, ty - 1, 0],  // N edge of this tile
                        [tx, ty + 1, 1],  // S edge
                        [tx - 1, ty, 2],  // W edge
                        [tx + 1, ty, 3],  // E edge
                    ];
                    for (const [ntx, nty, dir] of dirs) {
                        const nt = currentMap.tiles[nty]?.[ntx];
                        if (nt !== TILE.GRASS && nt !== TILE.TREE) continue;
                        if (dir === 0) dither2(bgc, px, py,          T,  bw, P.M_SAND, P.M_FOREST, 1);
                        if (dir === 1) dither2(bgc, px, py + T - bw, T,  bw, P.M_SAND, P.M_FOREST, 0);
                        if (dir === 2) dither2(bgc, px, py,          bw, T,  P.M_SAND, P.M_FOREST, 1);
                        if (dir === 3) dither2(bgc, px + T - bw, py, bw, T,  P.M_SAND, P.M_FOREST, 0);
                    }
                    // Diagonal corner fills — prevent hard-cut notches at convex corners
                    // where two cardinal blend strips would leave a bare pixel gap.
                    const pathDiags = [
                        [tx+1,ty-1, tx,  ty-1, tx+1,ty,   T-bw, 0    ], // NE
                        [tx+1,ty+1, tx,  ty+1, tx+1,ty,   T-bw, T-bw ], // SE
                        [tx-1,ty+1, tx,  ty+1, tx-1,ty,   0,    T-bw ], // SW
                        [tx-1,ty-1, tx,  ty-1, tx-1,ty,   0,    0    ], // NW
                    ];
                    for (const [dnx,dny,a1x,a1y,a2x,a2y,cpx,cpy] of pathDiags) {
                        const dt  = currentMap.tiles[dny]?.[dnx];
                        if (dt !== TILE.GRASS && dt !== TILE.TREE) continue;
                        const a1t = currentMap.tiles[a1y]?.[a1x];
                        const a2t = currentMap.tiles[a2y]?.[a2x];
                        // Only fill if neither adjacent cardinal is already blended
                        if ((a1t===TILE.GRASS||a1t===TILE.TREE)||(a2t===TILE.GRASS||a2t===TILE.TREE)) continue;
                        dither2(bgc, px+cpx, py+cpy, bw, bw, P.M_SAND, P.M_FOREST, 1);
                    }
                }

                // ── Autotile blending — WATER side ────────────────────
                // Water already has live lily pads. Edge blending is new.
                if (tile === TILE.WATER) {
                    const dirs = [
                        [tx, ty - 1, 0], [tx, ty + 1, 1],
                        [tx - 1, ty, 2], [tx + 1, ty, 3],
                    ];
                    for (const [ntx, nty, dir] of dirs) {
                        const nt = currentMap.tiles[nty]?.[ntx];
                        if (nt !== TILE.GRASS && nt !== TILE.TREE && nt !== TILE.DIRT_PATH && nt !== TILE.STONE_PATH) continue;
                        const edgeCol = (nt === TILE.DIRT_PATH || nt === TILE.STONE_PATH) ? P.M_CLAY : P.M_FOREST;
                        if (dir === 0) dither2(bgc, px, py,          T,  bw, P.M_TEAL, edgeCol, 1);
                        if (dir === 1) dither2(bgc, px, py + T - bw, T,  bw, P.M_TEAL, edgeCol, 0);
                        if (dir === 2) dither2(bgc, px, py,          bw, T,  P.M_TEAL, edgeCol, 1);
                        if (dir === 3) dither2(bgc, px + T - bw, py, bw, T,  P.M_TEAL, edgeCol, 0);
                    }
                }
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  3 — GRASS SWAY ANIMATION
    //  Pre-renders 3 sway variants per grass type from the existing
    //  _tc cache. Only frames 1 and 2 are ever blitted — frame 0 is
    //  identical to the baked bgCanvas, so it contributes nothing.
    //
    //  Wind effect: a narrow shadow strip on the upstream side and
    //  a narrow bright strip on the downstream side of the top 52%
    //  of the tile, suggesting blade tips leaning in the wind.
    // ═══════════════════════════════════════════════════════════════

    let _swayFrames      = null;  // [variant 0-7][step 0-2] → HTMLCanvasElement
    let _swayTS          = 0;     // TS at last build
    let _swayStep        = 0;     // current animation step (0=neutral,1=right,2=left)
    let _swayTimer       = 0;     // ms accumulator
    let _swayLast        = 0;     // timeMs at last sway draw
    let _swayBuiltWithAtlas = false; // true only when sway frames were baked from atlas sprites

    // Color grade gradient cache — createRadialGradient is non-trivial;
    // caching it per (cW×cH×mapType) avoids rebuilding it every frame.
    let _cgGrd = null, _cgGrdW = 0, _cgGrdH = 0, _cgGrdKey = '';

    function _buildSway(ts) {
        const P   = PALETTE;
        const sw  = Math.max(3, Math.floor(ts * 0.08));  // strip width
        const sh  = Math.floor(ts * 0.52);               // strip height (top portion)

        // Determine whether the atlas renderer is ready to supply grass sprites.
        // If not ready we skip building entirely — drawSwayPass() will retry next frame.
        const atlasReady = (typeof spriteRenderer !== 'undefined') && spriteRenderer.isReady();
        if (!atlasReady) {
            _swayFrames         = null;
            _swayBuiltWithAtlas = false;
            _swayTS             = ts;
            return;
        }

        // Ensure TileRenderer has all 8 grass variants cached at this ts before
        // building sway frames — warmRow is a no-op if already warm.
        tileRenderer.warmRow('GRASS', ts);

        // Verify at least variant 0 is actually in the cache before proceeding.
        // If warmRow failed for any reason, abort and retry next frame.
        const testBase = spriteRenderer._getCachedVariant('GRASS', 0, ts);
        if (!testBase) {
            _swayFrames         = null;
            _swayBuiltWithAtlas = false;
            _swayTS             = ts;
            return;
        }

        _swayFrames = [];
        for (let v = 0; v < 8; v++) {
            const frames = [];
            // Fetch the exact canvas bgCanvas used for this variant — same object.
            const base = spriteRenderer._getCachedVariant('GRASS', v, ts);
            for (let step = 0; step < 3; step++) {
                const c   = document.createElement('canvas');
                c.width   = c.height = ts;
                const ctx2 = c.getContext('2d');
                ctx2.imageSmoothingEnabled = false;

                // Base must be the TileRenderer canvas so sway frames are
                // pixel-identical to what bgCanvas baked — prevents flicker.
                if (base) ctx2.drawImage(base, 0, 0, ts, ts);

                if (step !== 0) {
                    // step 1 = leaning right  → shadow on left,  light on right
                    // step 2 = leaning left   → shadow on right, light on left
                    const shadowX = step === 1 ? 0       : ts - sw;
                    const lightX  = step === 1 ? ts - sw : 0;

                    // Shadow strip (dark edge of leaning blades)
                    ctx2.globalAlpha = C.swayDarkAlpha;
                    ctx2.fillStyle   = P.D_GREEN;
                    ctx2.fillRect(shadowX, 0, sw, sh);

                    // Bright strip (lit face of leaning blades)
                    ctx2.globalAlpha = C.swayLightAlpha;
                    ctx2.fillStyle   = P.L_LEAF;
                    ctx2.fillRect(lightX, 0, sw, Math.floor(sh * 0.70));

                    ctx2.globalAlpha = 1;
                }
                frames.push(c);
            }
            _swayFrames.push(frames);
        }
        _swayTS             = ts;
        _swayBuiltWithAtlas = true;
    }

    // Advance sway frame. Called once per drawSwayPass() invocation.
    function _advanceSway() {
        const now   = timeMs;
        const delta = Math.min(now - _swayLast, 200); // cap at 200ms (tab wake)
        _swayLast   = now;
        _swayTimer += delta;
        const interval = 1000 / C.swayFps;
        if (_swayTimer >= interval) {
            _swayTimer -= interval;
            _swayStep   = (_swayStep + 1) % 3;
        }
    }

    // Draw the sway overlay for grass tiles within swayRadius of the player.
    // Called at the end of drawAnimatedTiles() each frame.
    function drawSwayPass() {
        if (!currentMap || currentMap.dark) return;

        // Rebuild if TS changed, first run, or atlas became ready after last bake.
        // _buildSway() returns early (null frames) when atlas is not yet ready.
        const atlasNowReady = (typeof spriteRenderer !== 'undefined') && spriteRenderer.isReady();
        if (!_swayFrames || _swayTS !== TS || (!_swayBuiltWithAtlas && atlasNowReady)) {
            _buildSway(TS);
        }

        // Do not draw procedural grass over atlas tiles — wait for atlas-baked frames.
        if (!_swayBuiltWithAtlas) return;

        const frames = _swayFrames;
        const rad    = C.swayRadius;

        // Only iterate the viewport — same bounds as drawAnimatedTiles
        const stx = Math.max(0,               Math.floor(cam.x / TS));
        const sty = Math.max(0,               Math.floor(cam.y / TS));
        const etx = Math.min(currentMap.w - 1, Math.ceil((cam.x + cW) / TS));
        const ety = Math.min(currentMap.h - 1, Math.ceil((cam.y + cH) / TS));

        // Per-tile wind phase offset — tiles don't all sway in unison
        const tBase = timeMs * C.swayPhaseScale * C.swayFps;

        for (let ty = sty; ty <= ety; ty++) {
            // Quick range rejection — skip rows far from player
            if (Math.abs(ty - player.y) > rad) continue;
            for (let tx = stx; tx <= etx; tx++) {
                if (Math.abs(tx - player.x) > rad) continue;
                const tile = currentMap.tiles[ty][tx];
                if (tile !== TILE.GRASS) continue;

                // Per-tile phase offset — creates a ripple effect across the field
                const phase      = ((tx * 3 + ty * 5) & 7) / 8; // 0..0.875
                const localStep  = Math.floor((tBase + phase * 3) % 3);
                if (localStep === 0) continue; // no overdraw for neutral frame

                const v   = currentMap.variantMap
                    ? currentMap.variantMap[ty * currentMap.w + tx] & 7
                    : (tx * 7 + ty * 13) & 7;
                const spx = Math.round(tx * TS - cam.x);
                const spy = Math.round(ty * TS - cam.y);
                ctx.drawImage(frames[v][localStep], spx, spy, TS, TS);
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  4a — COLOR GRADE + VIGNETTE
    //  Runs after renderVignette() in render(). Replaces the interior-
    //  only vignette with a full-scene version and adds a warm overlay.
    //
    //  Two compositing steps, both done with save/restore:
    //    screen  — warm amber overlay at very low alpha.
    //              Screen only brightens; darks stay dark but get a
    //              warm glow. Midtones get a light amber push. Mimics
    //              the Stardew Valley "golden hour" ambient tone.
    //    normal  — radial vignette gradient, intensity varies by map.
    // ═══════════════════════════════════════════════════════════════

    function renderColorGrade() {
        if (!currentMap) return;

        const isDark     = currentMap.dark;
        const isInterior = !isDark && !!currentMap.returnMap;

        ctx.save();

        // ── Warm amber screen overlay ──────────────────────────────
        // Very subtle — α=0.04 shifts neutral greys ~4-8 points warmer.
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = isDark ? 0.022 : C.warmAlpha;
        ctx.fillStyle   = '#ffaa28'; // warm golden amber (richer than pure orange)
        ctx.fillRect(0, 0, cW, cH);

        // ── Vignette ───────────────────────────────────────────────
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;

        const vigAlpha = isDark ? C.vigDungeon : isInterior ? C.vigInterior : C.vigOutdoor;
        const innerR   = Math.min(cW, cH) * (isDark ? 0.18 : isInterior ? 0.26 : 0.40);
        const outerR   = Math.min(cW, cH) * (isDark ? 0.62 : isInterior ? 0.70 : 0.92);

        // Rebuild gradient only when canvas size or map type changes.
        // createRadialGradient + addColorStop costs ~0.1ms per frame when called
        // every frame — caching drops this to a single object lookup.
        const cgKey = `${isDark ? 'd' : isInterior ? 'i' : 'o'}`;
        if (!_cgGrd || _cgGrdW !== cW || _cgGrdH !== cH || _cgGrdKey !== cgKey) {
            _cgGrd = ctx.createRadialGradient(cW * 0.5, cH * 0.5, innerR,
                                               cW * 0.5, cH * 0.5, outerR);
            // Slightly warm-tinted black — avoids the "cold TV scanline" look
            // of pure black vignettes.
            _cgGrd.addColorStop(0, 'rgba(0,0,0,0)');
            _cgGrd.addColorStop(1, `rgba(6,2,0,${vigAlpha})`);
            _cgGrdW = cW; _cgGrdH = cH; _cgGrdKey = cgKey;
        }
        ctx.fillStyle = _cgGrd;
        ctx.fillRect(0, 0, cW, cH);

        ctx.restore();
    }

    // ═══════════════════════════════════════════════════════════════
    //  4b — OUTDOOR TORCH GLOW
    //  renderLighting() in game.js handles the full darkness + light
    //  pass for dark maps. This function adds only the warm screen-
    //  blend torch halo to outdoor / interior maps where the scene
    //  is already fully lit — it's purely cosmetic warmth, not a
    //  visibility system.
    // ═══════════════════════════════════════════════════════════════

    function renderOutdoorTorchGlow() {
        if (!currentMap || currentMap.dark) return; // dark maps: renderLighting handles it

        const stx = Math.max(0,               Math.floor(cam.x / TS) - 2);
        const sty = Math.max(0,               Math.floor(cam.y / TS) - 2);
        const etx = Math.min(currentMap.w - 1, Math.ceil((cam.x + cW) / TS) + 2);
        const ety = Math.min(currentMap.h - 1, Math.ceil((cam.y + cH) / TS) + 2);

        // Quick early-exit — scan for at least one torch in view
        let found = false;
        outer: for (let ty = sty; ty <= ety; ty++) {
            for (let tx = stx; tx <= etx; tx++) {
                if (currentMap.tiles[ty]?.[tx] === TILE.TORCH) { found = true; break outer; }
            }
        }
        if (!found) return;

        const t = timeMs * 0.001;
        _ensureVqDisc();
        const dr = _vqTorchDisc.width >> 1;
        ctx.save();
        ctx.globalCompositeOperation = 'screen';

        for (let ty = sty; ty <= ety; ty++) {
            for (let tx = stx; tx <= etx; tx++) {
                if (currentMap.tiles[ty]?.[tx] !== TILE.TORCH) continue;
                const lx = Math.round(tx * TS - cam.x + TS * 0.5);
                const ly = Math.round(ty * TS - cam.y + TS * 0.5);
                // Flicker via globalAlpha — disc pre-rendered at peak alpha=1
                const fl = C.torchAlpha + 0.028 * Math.sin(t * 10.5 + tx * 2.7 + ty * 1.3);
                ctx.globalAlpha = fl * 2.8;
                ctx.drawImage(_vqTorchDisc, lx - dr, ly - dr);
            }
        }
        ctx.globalAlpha = 1;
        ctx.restore();
    }

    // ─── invalidate — call on resize or TS change ─────────────────
    function invalidate() {
        _swayFrames         = null;
        _swayTS             = 0;
        _swayStep           = 0;
        _swayTimer          = 0;
        _swayBuiltWithAtlas = false;
        _cgGrd              = null;
        _vqDiscTS           = 0;
        _aoStripTS          = 0;   // rebuild AO strips at new TS
    }

    // ─── public API ───────────────────────────────────────────────
    return {
        bakeAO,
        advanceSway: _advanceSway,
        drawSwayPass,
        renderColorGrade,
        renderOutdoorTorchGlow,
        invalidate,
    };

})();
