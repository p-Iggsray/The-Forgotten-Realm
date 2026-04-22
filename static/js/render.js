// ===============================================================
//  RENDER SUBSYSTEM - extracted from game.js (Pass 6d)
//  Reads shared globals: canvas, cW, cH, TS, cam,
//  currentMap, player, gs, timeMs, PALETTE, TILE, etc.
// ===============================================================

// --- Moved variable declarations -----------------------------------------
let ctx    = Game.ctx = canvas.getContext('2d');
let bgCanvas = document.createElement('canvas');
let bgCtx    = bgCanvas.getContext('2d');
let bgDirty  = true;   // true -> must rebuild before next render
let _bgCamX  = -1, _bgCamY = -1; // last cam position baked into bgCanvas

// --- Event-driven cached state -------------------------------------------
let _isBattleActive = false, _isLoading = false;
eventBus.on('battle:start',     () => { _isBattleActive = true; });
eventBus.on('battle:end',       () => { _isBattleActive = false; });
eventBus.on('ui:loading:start', () => { _isLoading = true; });
eventBus.on('ui:loading:end',   () => { _isLoading = false; });

// --- Public API ----------------------------------------------------------
function markBgDirty()               { bgDirty = true; }
function invalidateLightCanvas()     { lightCanvas = null; }
function invalidateScanlinesCanvas() { _scanlinesCanvas = null; }
function invalidateCharCache()  { _charCache.clear(); }
function invalidateNPCCache()   { _npcCache.clear(); }
function invalidateEnemyCache() { _enemyCache.clear(); _enemyCacheTS = 0; }
function invalidateChestCache() { _chestCache.clear(); _chestCacheTS = 0; }

// DEV cache stats — hit/miss counters, inspectable via cacheStats()
// AUDIT: possibly dead — no production callers; intentionally callable from browser console — confirm before deleting
let _charCacheHits = 0, _charCacheMisses = 0;
let _enemyCacheHits = 0, _enemyCacheMisses = 0;
function cacheStats() {
    return { charHits: _charCacheHits, charMisses: _charCacheMisses,
             enemyHits: _enemyCacheHits, enemyMisses: _enemyCacheMisses,
             charSize: _charCache.size, enemySize: _enemyCache.size,
             chestSize: _chestCache.size, tileSize: Object.keys(_tc).length };
}
function resetCacheStats() { _charCacheHits = _charCacheMisses = _enemyCacheHits = _enemyCacheMisses = 0; }
function refreshCtx(c) {
    const dpr = window.devicePixelRatio || 1;
    ctx = Game.ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = false;
}

// Pixel-art draw for a single decoration at canvas position (px, py).
// All geometry is derived from TS so it scales with the tile size.
function _drawDecoration(ctx, px, py, type, variant, TS) {
    const P = PALETTE;
    const u  = Math.max(1, Math.round(TS / 16));
    const ix = Math.round(px), iy = Math.round(py);

    if (type === 'stump') {
        const ox = ix + Math.round(TS * 0.30), oy = iy + Math.round(TS * 0.55);
        const sw = u * 6, sh = u * 4;
        ctx.fillStyle = P.D_BROWN;   ctx.fillRect(ox,        oy,        sw,        sh);
        ctx.fillStyle = P.M_CLAY;    ctx.fillRect(ox + u,    oy,        sw - u*2,  sh - u);
        ctx.fillStyle = P.L_PARCH;   ctx.fillRect(ox + u*2,  oy + u,    u,         u);
        if (variant === 1) { ctx.fillStyle = P.M_MOSS; ctx.fillRect(ox + u, oy, sw - u*2, u); }

    } else if (type === 'bush') {
        const ox = ix + Math.round(TS * 0.18), oy = iy + Math.round(TS * 0.44);
        const bw = u * 8;
        ctx.fillStyle = P.D_GREEN;   ctx.fillRect(ox,        oy + u*3,  bw,        u*2);
        ctx.fillStyle = P.M_FOREST;  ctx.fillRect(ox - u,    oy + u,    bw + u*2,  u*3);
        ctx.fillStyle = (variant === 0) ? P.M_FOREST : P.L_LEAF;
                                     ctx.fillRect(ox + u,    oy,        bw - u*2,  u*2);
        ctx.fillStyle = P.L_LEAF;    ctx.fillRect(ox + u*2,  oy - u,    u*2,       u);
        if (variant === 2) { ctx.fillStyle = P.A_RARE; ctx.fillRect(ox + u*3, oy, u, u); }

    } else if (type === 'plant') {
        const ox = ix + Math.round(TS * 0.40), oy = iy + Math.round(TS * 0.32);
        if (variant === 0) {
            ctx.fillStyle = P.M_MOSS;   ctx.fillRect(ox,      oy + u*2, u,    u*3);
            ctx.fillStyle = P.M_FOREST; ctx.fillRect(ox - u,  oy + u,   u*2,  u);
                                        ctx.fillRect(ox + u,  oy,       u*2,  u);
        } else if (variant === 1) {
            ctx.fillStyle = P.M_FOREST; ctx.fillRect(ox,      oy,       u,    u*5);
                                        ctx.fillRect(ox - u,  oy + u,   u,    u*4);
                                        ctx.fillRect(ox + u,  oy + u*2, u,    u*3);
            ctx.fillStyle = P.L_LEAF;   ctx.fillRect(ox,      oy - u,   u,    u);
                                        ctx.fillRect(ox - u,  oy,       u,    u);
        } else {
            ctx.fillStyle = P.L_LEAF;   ctx.fillRect(ox,      oy,       u*2,  u*2);
                                        ctx.fillRect(ox + u*2, oy + u,  u*2,  u*2);
                                        ctx.fillRect(ox - u,  oy + u,   u*2,  u*2);
            ctx.fillStyle = P.M_MOSS;   ctx.fillRect(ox + u,  oy + u*3, u,    u*2);
        }
    } else if (type === 'patch') {
        // Phase 5: full-tile tint overlay — subtle biome colour variation
        //  variant 0 = dark moss  (darker grass interior patches)
        //  variant 1 = dry/light  (warm sandy-ochre tone for dry grass)
        //  variant 2 = warm earth (sandy PATH tiles in DIRT biome)
        const patchColors  = [P.D_GREEN, P.M_SAND, P.M_CLAY];
        const patchAlphas  = [0.22,      0.18,     0.18     ];
        ctx.globalAlpha = patchAlphas[variant] ?? 0.20;
        ctx.fillStyle   = patchColors[variant] ?? P.D_GREEN;
        ctx.fillRect(ix, iy, TS, TS);
        ctx.globalAlpha = 1;
    }
}
// ═══════════════════════════════════════════════════════
//  TILE VARIANT CACHE
//  Pre-renders N variants of each tile into offscreen
//  canvases at startup.  drawTile() just calls drawImage()
//  which is ~10× faster than re-drawing every frame, and
//  allows richly detailed artwork on each tile.
// ═══════════════════════════════════════════════════════
const _tc  = {};   // cache:  key string → HTMLCanvasElement
let  _tcTS = 0;    // TS value at last build; 0 = dirty

// Seeded deterministic PRNG (LCG) — returns values in [0, 1)
function _rng(seed) {
    let s = (seed * 1664525 + 1013904223) >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function _mkTile() {
    const c = document.createElement('canvas');
    c.width = c.height = TS;
    return c;
}

// Color parse cache — hex '#rrggbb' → [r,g,b], computed once per color string.
const _rgbCache = new Map();
function _hexToRgb(hex) {
    if (_rgbCache.has(hex)) return _rgbCache.get(hex);
    const v = parseInt(hex.slice(1), 16);
    const result = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    _rgbCache.set(hex, result);
    return result;
}

// 2-colour checkerboard dither over a rectangular region.
// col1 = even-position colour (dominant), col2 = odd-position colour.
// offset (0|1) shifts the checkerboard phase by one pixel for directionality.
// Uses putImageData for bulk pixel writes — ~270k fillRect calls → 1 call per region.
function dither2(c, bx, by, bw, bh, col1, col2, offset) {
    const o  = offset | 0;
    const [r1,g1,b1] = _hexToRgb(col1);
    const [r2,g2,b2] = _hexToRgb(col2);
    const data = new Uint8ClampedArray(bw * bh * 4);
    for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
            const i = (y * bw + x) * 4;
            if (((bx + x + by + y + o) & 1) === 0) {
                data[i]=r1; data[i+1]=g1; data[i+2]=b1;
            } else {
                data[i]=r2; data[i+1]=g2; data[i+2]=b2;
            }
            data[i+3] = 255;
        }
    }
    c.putImageData(new ImageData(data, bw, bh), bx, by);
}

function invalidateTileCache() { _tcTS = 0; }

function ensureTileCache() {
    if (_tcTS === TS) return;
    _tcTS = TS;
    _buildTileCache();
}

function _buildTileCache() {
    for (const k of Object.keys(_tc)) delete _tc[k];
    const T = TS, U = Math.max(1, Math.floor(T / 16));
    const P = PALETTE; // shorthand

    // ── tile-renderer.js helpers — available at runtime (loaded after game.js) ──
    // _ditherBayer and _ellipse are defined in tile-renderer.js.  Provide
    // graceful fallbacks so _buildTileCache still works if that file is absent.
    const _db = typeof _ditherBayer === 'function' ? _ditherBayer
        : (c, x, y, w, h, ca, cb, d) => dither2(c, x, y, w, h, ca, cb, 0);
    const _el = typeof _ellipse === 'function' ? _ellipse
        : (c, cx, cy, rx, ry, col) => {
            c.fillStyle = col;
            c.beginPath(); c.arc(cx, cy, Math.max(rx, ry), 0, Math.PI * 2); c.fill();
        };

    // ─────────────────────────────────────────────────────
    // GRASS — 12 pixel-art variants, no blur, palette only
    // Type A (v0-2,7): solid base + scattered 1px dew + L-blades
    // Type B (v3-4):   dithered dark/mid patches + cross flowers
    // Type C (v5):     dry — dithered mid/sand + crack marks
    // Type D (v6):     dense dark — dark base + extra blades
    // Type E (v8-11):  wildflower, fern, stone scatter, mossy
    // ─────────────────────────────────────────────────────
    for (let v = 0; v < 12; v++) {
        const can = _mkTile(), c = can.getContext('2d');
        const rng = _rng(v * 37 + 5);
        const isDry  = v === 5, isDark = v === 6;
        const base1  = isDry ? P.V_GRASS_DRY  : isDark ? P.V_GRASS_DARK : P.V_GRASS_BASE;
        const base2  = isDry ? P.V_DIRT_BASE   : isDark ? P.V_GRASS_BASE : P.V_GRASS_MID;
        // ── Solid base ──────────────────────────────────
        c.fillStyle = base1; c.fillRect(0, 0, T, T);

        // ── Type B / C: dithered secondary patch ─────────
        if (v === 3 || v === 4) {
            // Type B — Bayer-ordered dither for smoother organic dark patches
            for (let i = 0; i < 5; i++) {
                const px2 = Math.floor(rng()*(T-U*6)), py2 = Math.floor(rng()*(T-U*6));
                const pw = Math.floor(rng()*U*10+U*3), ph = Math.floor(rng()*U*8+U*2);
                _db(c, px2, py2, Math.min(pw,T-px2), Math.min(ph,T-py2), P.V_GRASS_BASE, P.V_GRASS_DARK, 0.45);
            }
        } else if (v === 5) {
            // Type C — dither dry/dirt across full tile
            dither2(c, 0, 0, T, T, P.V_GRASS_DRY, P.V_DIRT_BASE, 0);
        } else if (v < 8) {
            // Type A / D — scattered secondary colour blobs
            c.fillStyle = base2;
            for (let i = 0; i < 22; i++) {
                const sw = Math.floor(rng()*U*4+U), sh = Math.floor(rng()*U*3+U);
                c.fillRect(Math.floor(rng()*(T-sw)), Math.floor(rng()*(T-sh)), sw, sh);
            }
        }

        // ── Dew / highlight scatter (1-px pixels) ────────
        const hiCol = isDry ? P.V_DIRT_LIGHT : isDark ? P.V_GRASS_BASE : P.V_GRASS_HI;
        const hiCount = isDark ? 8 : (v === 3 || v === 4) ? 5 : 12;
        if (v < 8) {
            c.fillStyle = hiCol;
            for (let i = 0; i < hiCount; i++)
                c.fillRect(Math.floor(rng()*(T-U*2)+U), Math.floor(rng()*(T-U*2)+U), 1, 1);
        }

        // ── L-shaped grass blades with shaded tips ───────
        const bladeCol = isDry ? P.V_DIRT_BASE   : isDark ? P.V_GRASS_DARK : P.V_GRASS_MID;
        const bladeTip = isDry ? P.V_DIRT_LIGHT  : isDark ? P.V_GRASS_BASE : P.V_GRASS_HI;
        if (v < 8) {
            for (let i = 0; i < 12; i++) {
                const bx2 = Math.floor(rng()*(T-U*4)+U), by2 = Math.floor(rng()*(T-U*5)+U);
                c.fillStyle = bladeCol; c.fillRect(bx2, by2+1, 1, U*2);  // stem
                c.fillStyle = bladeTip; c.fillRect(bx2, by2,   1, 1);     // bright tip
                if (i % 2 === 0) { c.fillStyle = bladeCol; c.fillRect(bx2+1, by2, 1, 1); } // L foot
            }
        }
        // ── Ground-depth shadow — Bayer fringe at lower 38% ─
        if (!isDry && v < 8) {
            _db(c, 0, Math.floor(T*0.62), T, Math.floor(T*0.38), base1, P.V_GRASS_DARK, 0.28);
        }
        // ── Per-variant pixel-art detail ─────────────────
        switch (v) {
            case 1: { // Type A — small cross flowers (2 colours)
                for (let f = 0; f < 2; f++) {
                    const fx = Math.floor(rng()*(T-U*6)+U*3), fy = Math.floor(rng()*(T-U*6)+U*3);
                    const fc = f ? P.A_RARE : P.A_YELLOW;
                    c.fillStyle = fc;
                    c.fillRect(fx-1, fy, 1, 1); c.fillRect(fx+1, fy, 1, 1);
                    c.fillRect(fx, fy-1, 1, 1); c.fillRect(fx, fy+1, 1, 1);
                    c.fillStyle = P.L_WHITE; c.fillRect(fx, fy, 1, 1);
                }
                break;
            }
            case 2: { // Type A — pebbles: 2-px rect, bright top, dark bottom
                for (let p = 0; p < 5; p++) {
                    const px2 = Math.floor(rng()*(T-U*3)+U), py2 = Math.floor(rng()*(T-U*2)+U);
                    c.fillStyle = p%2 ? P.M_STONE : P.M_CLAY;
                    c.fillRect(px2, py2, U*2, U);
                    c.fillStyle = P.L_STONE; c.fillRect(px2, py2, U*2, 1);       // hi
                    c.fillStyle = P.D_STONE; c.fillRect(px2, py2+U-1, U*2, 1);   // shadow
                }
                break;
            }
            case 3: { // Type B — mushroom (solid palette colors)
                const mx = Math.floor(T*0.37), my = Math.floor(T*0.44);
                c.fillStyle = P.S_MID;   c.fillRect(mx, my, U*2, U*3);          // stem
                c.fillStyle = P.M_BRICK; c.fillRect(mx-U, my-U*2, U*4, U*2);   // cap
                c.fillStyle = P.L_WHITE; c.fillRect(mx+U, my-U*2, 1, 1);       // spot
                c.fillRect(Math.floor(mx-U*.5), my-U, 1, 1);
                break;
            }
            case 4: { // Type B — extra dark blade clusters
                c.fillStyle = P.V_GRASS_DARK;
                for (let i = 0; i < 6; i++) {
                    const bx2 = Math.floor(rng()*(T-2)), by2 = Math.floor(rng()*(T-U*4));
                    c.fillRect(bx2, by2, 1, U*2);
                }
                break;
            }
            case 5: { // Type C — cracked earth patch + sparse pixels
                const cpx = Math.floor(rng()*T*0.5+T*0.2), cpy = Math.floor(rng()*T*0.4+T*0.3);
                c.fillStyle = P.V_DIRT_BASE; c.fillRect(cpx, cpy, U*3, U);     // crack patch
                c.fillStyle = P.D_BROWN;
                for (let i = 0; i < 4; i++) c.fillRect(cpx+i, cpy, 1, 1);     // crack dots
                break;
            }
            case 6: { // Type D — dense, extra dark short blades
                c.fillStyle = P.V_GRASS_DARK;
                for (let i = 0; i < 8; i++) {
                    const bx2 = Math.floor(rng()*(T-2)), by2 = Math.floor(rng()*(T-U*3));
                    c.fillRect(bx2, by2, 1, U*2+1);
                }
                break;
            }
            case 7: { // Type A — clover: 3 arcs + bright center pixel
                for (let cl = 0; cl < 2; cl++) {
                    const clx = Math.floor(rng()*(T-U*8)+U*4), cly = Math.floor(rng()*(T-U*8)+U*4);
                    c.fillStyle = P.V_GRASS_HI;
                    c.beginPath(); c.arc(clx,        cly-U*1.2, U*1.1, 0, Math.PI*2); c.fill();
                    c.beginPath(); c.arc(clx-U*1.2,  cly+U*.7,  U*1.1, 0, Math.PI*2); c.fill();
                    c.beginPath(); c.arc(clx+U*1.2,  cly+U*.7,  U*1.1, 0, Math.PI*2); c.fill();
                    c.fillStyle = P.L_WHITE;
                    c.fillRect(clx, cly, 1, 1);
                }
                break;
            }
            case 8: { // Wildflower patch — 3 five-petal flowers
                for (let fl = 0; fl < 3; fl++) {
                    const fx = Math.floor(rng()*(T-U*8)+U*4), fy = Math.floor(rng()*(T-U*8)+U*4);
                    c.fillStyle = P.A_PURPLE;
                    c.fillRect(fx-1, fy,   1, 1); c.fillRect(fx+1, fy,   1, 1);
                    c.fillRect(fx,   fy-1, 1, 1); c.fillRect(fx,   fy+1, 1, 1);
                    c.fillStyle = P.A_YELLOW;
                    c.fillRect(fx, fy, 1, 1);
                }
                break;
            }
            case 9: { // Fern fronds — 3 diagonal strokes mirrored
                for (let fr = 0; fr < 3; fr++) {
                    const fx = Math.floor(rng()*(T-U*8)+U*4), fy = Math.floor(rng()*(T-U*6)+U*4);
                    c.fillStyle = P.V_GRASS_MID;
                    for (let i = 1; i <= 6; i++) {
                        c.fillRect(fx - i, fy - i, 1, 1);
                        c.fillRect(fx + i, fy - i, 1, 1);
                    }
                    c.fillStyle = P.V_GRASS_HI;
                    c.fillRect(fx - 6, fy - 6, 1, 1);
                    c.fillRect(fx + 6, fy - 6, 1, 1);
                }
                break;
            }
            case 10: { // Stone scatter — pebbles on green base
                for (let p = 0; p < 4; p++) {
                    const px2 = Math.floor(rng()*(T-U*3)+U), py2 = Math.floor(rng()*(T-U*2)+U);
                    c.fillStyle = P.V_STONE_BASE;
                    c.fillRect(px2, py2, U*2, U);
                    c.fillStyle = P.V_STONE_HI;   c.fillRect(px2, py2, U*2, 1);        // top-left bevel
                    c.fillStyle = P.V_STONE_DARK; c.fillRect(px2, py2+U-1, U*2, 1);    // bottom-right shadow
                }
                break;
            }
            case 11: { // Mossy ground — dark base, heavy Bayer moss patches + blade tips
                for (let i = 0; i < 3; i++) {
                    const mpx = Math.floor(rng()*T*0.5), mpy = Math.floor(rng()*T*0.5);
                    const mpw = Math.floor(T*0.45+rng()*T*0.20), mph = Math.floor(T*0.40+rng()*T*0.20);
                    _db(c, mpx, mpy, Math.min(mpw,T-mpx), Math.min(mph,T-mpy), P.V_STONE_MOSS, P.V_GRASS_DARK, 0.45);
                }
                c.fillStyle = P.V_GRASS_HI;
                for (let i = 0; i < 8; i++)
                    c.fillRect(Math.floor(rng()*(T-U*2)+U), Math.floor(rng()*(T-U*2)+U), 1, 1);
                break;
            }
        }
        // No blur — pixel art must stay crisp
        _tc[`g${v}`] = can;
    }

    // ─────────────────────────────────────────────────────
    // PATH — 4 variants, beveled cobblestones
    // Each stone: flat fill, V_DIRT_HI highlight top-left,
    // V_STONE_DARK shadow bottom-right. Mortar: V_DIRT_DARK lines.
    // ─────────────────────────────────────────────────────
    for (let v = 0; v < 4; v++) {
        const can = _mkTile(), c = can.getContext('2d');
        const gap = Math.max(1, Math.floor(T/18)), half = Math.floor(T/2);
        // Mortar base
        c.fillStyle = P.V_DIRT_DARK; c.fillRect(0, 0, T, T);
        // Mossy variant: moss pixels in mortar lines
        if (v === 2) {
            c.fillStyle = P.V_STONE_MOSS;
            c.fillRect(0, half-1, T, 1); c.fillRect(half-1, 0, 1, T);
        }
        // Stone colour per variant — warm browns alternating
        const stoneCols = [P.V_DIRT_BASE, P.V_STONE_BASE, P.V_DIRT_BASE, P.V_STONE_BASE];
        const sc = stoneCols[v];
        [[gap,gap],[half+gap,gap],[gap,half+gap],[half+gap,half+gap]].forEach(([ox,oy]) => {
            const sw = half-gap*2, sh = half-gap*2;
            // Flat fill
            c.fillStyle = sc; c.fillRect(ox, oy, sw, sh);
            // Worn center — subtle Bayer-dithered lighter highlight in center ~50%
            if (sw > 4 && sh > 4) {
                _db(c, ox+Math.floor(sw*0.25), oy+Math.floor(sh*0.25),
                    Math.floor(sw*0.50), Math.floor(sh*0.50), sc, P.V_STONE_HI, 0.20);
            }
            // Bevel: 2px bright top + left edges
            c.fillStyle = P.V_DIRT_HI;
            c.fillRect(ox, oy, sw, 1);         // top highlight (outer)
            c.fillRect(ox, oy, 1, sh);         // left highlight (outer)
            c.fillStyle = P.V_DIRT_LIGHT;
            c.fillRect(ox, oy+1, sw, 1);       // top highlight (inner)
            c.fillRect(ox+1, oy, 1, sh);       // left highlight (inner)
            // Bevel: 2px dark bottom + right edges
            c.fillStyle = P.V_STONE_DARK;
            c.fillRect(ox,      oy+sh-1, sw, 1);  // bottom shadow (outer)
            c.fillRect(ox+sw-1, oy,      1, sh);  // right shadow (outer)
            c.fillStyle = P.V_DIRT_DARK;
            c.fillRect(ox,      oy+sh-2, sw, 1);  // bottom shadow (inner)
            c.fillRect(ox+sw-2, oy,      1, sh);  // right shadow (inner)
        });
        // Edge darkening — cast shadow from tiles to the south and east.
        c.fillStyle = P.V_DIRT_DARK;
        c.fillRect(0, T-Math.max(1,gap), T, Math.max(1,gap)); // south edge
        c.fillRect(T-Math.max(1,gap), 0, Math.max(1,gap), T); // east edge
        if (v === 1 || v === 3) { // hairline cracks — 2-3 diagonal 1px dots
            c.fillStyle = P.V_DIRT_DARK;
            for (let i = 0; i < 4; i++) c.fillRect(gap+2+i, gap+2+i, 1, 1);
            for (let i = 0; i < 3; i++) c.fillRect(half+gap+3+i, half+gap+3+i, 1, 1);
        }
        _tc[`p${v}`] = can;
    }

    // ─────────────────────────────────────────────────────
    // WALL — 3 types × 4 variants
    //   wex0-3  exterior stone (village)
    //   win0-3  interior wood panel (buildings)
    //   wd0-3   dungeon hewn rock
    // ─────────────────────────────────────────────────────

    // ── Exterior stone (rough-cut, dithered mortar seams) ─
    for (let v = 0; v < 4; v++) {
        const can = _mkTile(), c = can.getContext('2d');
        const rng = _rng(v*53+13);
        const bH = Math.floor(T/4), bW = Math.floor(T/2);
        c.fillStyle = P.V_WALL_DARK; c.fillRect(0, 0, T, T); // mortar
        for (let row = 0; row < 4; row++) {
            const by = Math.floor(row*bH), off = (row%2)*Math.floor(bW/2);
            for (let col = -1; col < 3; col++) {
                const bx = Math.floor(col*bW+off);
                const x1 = Math.max(1,bx+1), x2 = Math.min(T-1,bx+bW-1);
                const y1 = by+1, y2 = by+bH-1;
                if (x2<=x1||y2<=y1) continue;
                c.fillStyle = (row+col)%2===0 ? P.V_WALL_BASE : P.V_WALL_HI;
                c.fillRect(x1, y1, x2-x1, y2-y1);
                c.fillStyle = P.V_WALL_HI;   c.fillRect(x1, y1, x2-x1, 1);       // top hi
                c.fillStyle = P.V_WALL_DARK; c.fillRect(x1, y2-1, x2-x1, 1);     // bottom sh
            }
        }
        if (v===1) { // occasional moss pixel on lower stones
            c.fillStyle = P.V_WALL_MOSS;
            for (let i=0;i<3;i++) c.fillRect(Math.floor(rng()*T), Math.floor(T*.6+rng()*T*.3), 1, 1);
        }
        if (v===3) { // dithered dark patch — age staining lower quarter
            dither2(c, 0, Math.floor(T*.75), T, Math.floor(T*.25), P.V_WALL_BASE, P.V_WALL_DARK, 0);
        }
        _tc[`wex${v}`] = can;
    }

    // ── Interior wood panel (vertical 6px planks) ────────
    for (let v = 0; v < 4; v++) {
        const can = _mkTile(), c = can.getContext('2d');
        const rng = _rng(v*59+700);
        const plankW = Math.max(5, Math.floor(T/6));
        const nPlanks = Math.ceil(T/plankW)+1;
        // Alternating plank brightness (3 tones)
        const plankCols = [P.M_CLAY, P.S_DARK, P.S_MID];
        for (let i = 0; i < nPlanks; i++) {
            const px2 = i*plankW;
            c.fillStyle = plankCols[i%3]; c.fillRect(px2, 0, plankW-1, T);
            // Subtle brightness variation: 1px bright strip at top
            c.fillStyle = P.L_PARCH; c.fillRect(px2, 0, plankW-1, 1);
            // 1px dark seam between planks
            c.fillStyle = P.D_BROWN; c.fillRect(px2+plankW-1, 0, 1, T);
            // Nail pixel near top of each plank
            c.fillStyle = P.D_STONE;
            c.fillRect(px2+Math.floor(plankW/2), Math.floor(T*0.08), 1, 1);
        }
        // v=2: horizontal cross-beam strip across mid tile
        if (v===2) {
            const beamY = Math.floor(T*0.45), beamH = Math.max(3,Math.floor(T*0.10));
            c.fillStyle = P.D_BROWN; c.fillRect(0, beamY, T, beamH);
            c.fillStyle = P.M_CLAY;  c.fillRect(0, beamY, T, 1);     // beam top face
        }
        _tc[`win${v}`] = can;
    }

    // ── Dungeon hewn rock ─────────────────────────────────
    for (let v = 0; v < 4; v++) {
        const can = _mkTile(), c = can.getContext('2d');
        const rng = _rng(v*53+1000);
        c.fillStyle = P.D_VOID; c.fillRect(0, 0, T, T);
        // Dithered rock texture: D_BLUE into D_VOID
        dither2(c, 0, 0, T, T, P.D_VOID, P.D_BLUE, v&1);
        // Faint highlight near top — torch-light catch
        dither2(c, 0, 0, T, Math.max(2,Math.floor(T*.12)), P.D_BLUE, P.M_TEAL, 0);
        // Irregular rock face chips (3-4 pixels)
        c.fillStyle = P.M_TEAL;
        for (let i=0;i<4;i++)
            c.fillRect(Math.floor(rng()*T), Math.floor(rng()*T), 1, 1);
        if (v===1) { // moss trickle — a vertical line of M_TEAL pixels
            const mx2 = Math.floor(rng()*T);
            for (let y2=Math.floor(T*.5);y2<T;y2+=2) c.fillRect(mx2, y2, 1, 1);
        }
        _tc[`wd${v}`] = can;
    }

    // ─── FLOOR  4 variants × light/dark ────────────────
    // Light (fl): warm wood planks — S_DARK / S_MID / M_CLAY
    // Dark  (fd): dungeon stone   — D_BLUE / M_TEAL / M_SLATE
    const floorLight = [
        [P.S_DARK, P.S_MID,  P.M_CLAY],  // v0 standard warm
        [P.M_CLAY, P.S_DARK, P.S_MID ],  // v1 worn/shifted
        [P.S_DARK, P.S_MID,  P.M_CLAY],  // v2 stained
        [P.S_DARK, P.M_CLAY, P.S_DARK],  // v3 dark/old
    ];
    const floorDark = [
        [P.D_BLUE,  P.M_TEAL,  P.M_SLATE], // v0
        [P.M_TEAL,  P.D_BLUE,  P.M_SLATE], // v1
        [P.D_BLUE,  P.M_TEAL,  P.M_SLATE], // v2
        [P.M_SLATE, P.D_BLUE,  P.M_TEAL ], // v3
    ];
    for (let dk = 0; dk < 2; dk++) {
        const colSets = dk ? floorDark : floorLight;
        for (let v = 0; v < 4; v++) {
            const can = _mkTile(), c = can.getContext('2d');
            const rng = _rng(v*59+(dk?2000:0)+17);
            const cols   = colSets[v];
            const plankH = Math.floor(T/3);
            const jointX = v%2===0 ? Math.floor(T*.42) : Math.floor(T*.60);
            for (let i = 0; i < 3; i++) {
                const py2 = Math.floor(i*plankH), h = i===2 ? T-2*plankH : plankH;
                c.fillStyle = cols[i]; c.fillRect(0, py2, T, h);
                c.fillStyle = dk ? P.M_TEAL  : P.L_PARCH; c.fillRect(0, py2, T, 1);       // top hi
                c.fillStyle = dk ? P.D_VOID  : P.D_BROWN; c.fillRect(0, py2+h-1, T, 1);   // bottom sh
                c.fillStyle = dk ? P.D_VOID  : P.D_BROWN; c.fillRect(jointX, py2, 1, h);   // joint
            }
            if (v===1) { // v1: scratch lines
                c.fillStyle = dk ? P.D_VOID : P.D_BROWN;
                for (let s=0;s<2;s++) {
                    const sx = Math.floor(rng()*T*.7+T*.1);
                    c.fillRect(sx, Math.floor(rng()*(plankH-2)+1), Math.floor(rng()*T*.35+T*.1), 1);
                }
            } else if (v===2) { // v2: stain patch on mid plank
                c.fillStyle = dk ? P.D_VOID : P.S_DARK;
                c.fillRect(Math.floor(T*.15), plankH+2, Math.floor(T*.48), plankH-4);
            }
            _tc[dk?`fd${v}`:`fl${v}`] = can;
        }
    }

    // ─── TREE  4 variants (transparent bg — drawn over grass) ─
    for (let v = 0; v < 4; v++) {
        const can = _mkTile(), c = can.getContext('2d');
        const cfg = [
            {r:.38,cx:.50,cy:.38,dense:false,wide:false},
            {r:.42,cx:.50,cy:.40,dense:true, wide:false},
            {r:.34,cx:.50,cy:.44,dense:false,wide:true },
            {r:.30,cx:.50,cy:.31,dense:false,wide:false},
        ][v];
        const cx2 = Math.floor(T*cfg.cx), cy2 = Math.floor(T*cfg.cy), r = T*cfg.r;
        const tW = cfg.wide ? Math.floor(T*.15) : v===3 ? Math.floor(T*.08) : Math.floor(T*.12);
        const tH = v===3 ? Math.floor(T*.34) : Math.floor(T*.22);
        // Ground shadow: dithered D_STONE checkerboard under canopy footprint
        const shY = Math.floor(T*.65), shW = Math.floor(T*.60), shH = Math.floor(T*.10);
        c.fillStyle = P.D_STONE;
        for (let dy = 0; dy < shH; dy++)
            for (let dx = 0; dx < shW; dx++)
                if (!((dx+dy)&1)) c.fillRect(Math.floor(T*.20)+dx, shY+dy, 1, 1);
        // Trunk — V_TREE_BARK base, V_TREE_BARK_HI highlight stripe
        c.fillStyle = P.V_TREE_BARK;    c.fillRect(Math.floor(T/2-tW/2), Math.floor(T*.44), tW, tH);
        c.fillStyle = P.V_TREE_BARK_HI; c.fillRect(Math.floor(T/2-tW/2+Math.floor(tW*.25)), Math.floor(T*.44), Math.floor(tW*.40), tH);
        // Canopy layers — pixel-art ellipses (no anti-aliasing), squashed vertically for depth
        const ry = Math.floor(r * 0.82); // slight vertical squash
        // Outer shadow ring (V_TREE_DARK darkest, full radius)
        _el(c, cx2, cy2, Math.floor(r), ry, P.V_TREE_DARK);
        // Main canopy body (V_TREE_BASE, inset 10%)
        _el(c, cx2, cy2 - Math.floor(r*.06), Math.floor(r*.86), Math.floor(ry*.84), P.V_TREE_BASE);
        // Inner highlight mass (V_TREE_MID, upper-left offset)
        _el(c, cx2 - Math.floor(r*.16), cy2 - Math.floor(r*.18), Math.floor(r*.62), Math.floor(ry*.58), P.V_TREE_MID);
        // Bright specular patch upper-left (V_TREE_HI rectangle, crisp pixel-art)
        c.fillStyle = P.V_TREE_HI;
        c.fillRect(Math.floor(cx2 - r*.36), Math.floor(cy2 - r*.40), Math.floor(r*.30), Math.floor(r*.22));
        // 2px specular glint (L_WHITE)
        c.fillStyle = P.L_WHITE;
        c.fillRect(Math.floor(cx2 - r*.30), Math.floor(cy2 - r*.36), 2, 2);
        if (cfg.dense) { // extra perimeter bump clusters — pixel-art ellipses
            for (let i = 0; i < 5; i++) {
                const a = (i / 5) * Math.PI * 2;
                const bx3 = Math.round(cx2 + Math.cos(a) * r * .65);
                const by3 = Math.round(cy2 + Math.sin(a) * r * .44);
                _el(c, bx3, by3, Math.floor(r*.23), Math.floor(r*.18), P.V_TREE_DARK);
            }
        }
        if (cfg.wide) { // lateral side lobes — pixel-art ellipses
            _el(c, cx2 - Math.floor(r*.54), cy2 + Math.floor(r*.10), Math.floor(r*.28), Math.floor(r*.22), P.V_TREE_BASE);
            _el(c, cx2 + Math.floor(r*.54), cy2 + Math.floor(r*.10), Math.floor(r*.28), Math.floor(r*.22), P.V_TREE_BASE);
        }
        _tc[`tr${v}`] = can;
    }

    // ── STONE_PATH  4 variants — cool gray cobblestone, dark grout ──
    // sp0–sp3 drawn by drawTile() case TILE.STONE_PATH.
    // Individual stones slightly offset; cool grays + D_VOID grout.
    for (let v = 0; v < 4; v++) {
        const can = _mkTile(), c = can.getContext('2d');
        const rng = _rng(v * 43 + 200);
        const gap = Math.max(1, Math.floor(T/18)), half = Math.floor(T/2);
        // Grout base — cool dark gray
        c.fillStyle = P.D_STONE; c.fillRect(0, 0, T, T);
        const stoneCols = [P.M_STONE, P.L_STONE, P.M_SLATE, P.M_STONE];
        const sc = stoneCols[v];
        // 4 stones with slight random sub-pixel offsets for organic cobblestone look
        const offsets = [
            [gap + Math.floor(rng()*gap),       gap + Math.floor(rng()*gap)       ],
            [half + gap + Math.floor(rng()*gap), gap + Math.floor(rng()*gap)       ],
            [gap + Math.floor(rng()*gap),        half + gap + Math.floor(rng()*gap)],
            [half + gap + Math.floor(rng()*gap), half + gap + Math.floor(rng()*gap)],
        ];
        offsets.forEach(([ox, oy]) => {
            const sw = Math.max(2, half - gap*2), sh = Math.max(2, half - gap*2);
            // Stone face
            c.fillStyle = sc; c.fillRect(ox, oy, sw, sh);
            // Subtle worn center via Bayer dither
            if (sw > 4 && sh > 4) {
                _db(c, ox+Math.floor(sw*.25), oy+Math.floor(sh*.25),
                    Math.floor(sw*.50), Math.floor(sh*.50), sc, P.L_STONE, 0.15);
            }
            // Cool highlight (top + left)
            c.fillStyle = P.L_STONE; c.fillRect(ox, oy, sw, 1);
            c.fillStyle = P.M_STONE; c.fillRect(ox, oy, 1, sh);
            // Dark grout shadow (bottom + right)
            c.fillStyle = P.D_VOID;  c.fillRect(ox, oy+sh-1, sw, 1);
            c.fillStyle = P.D_STONE; c.fillRect(ox+sw-1, oy, 1, sh);
        });
        // v=1/3: pebble in grout line; v=2: aged moss fleck
        if (v === 1 || v === 3) {
            c.fillStyle = P.M_STONE;
            c.fillRect(Math.floor(rng()*(T-2))+1, Math.floor(rng()*(T-2))+1, 2, 1);
        }
        if (v === 2) {
            c.fillStyle = P.M_MOSS;
            for (let i = 0; i < 3; i++)
                c.fillRect(Math.floor(rng()*gap*2), Math.floor(rng()*T), 1, 1);
        }
        _tc[`sp${v}`] = can;
    }

    // ── VOID — pure black null tile ───────────────────────────────
    {
        const can = _mkTile(), c = can.getContext('2d');
        c.fillStyle = P.D_VOID; c.fillRect(0, 0, T, T);
        _tc['vd'] = can;
    }

    // ── CEILING  4 variants (interior top-row overhead) ──────
    // Rendered when tile===WALL && returnMap && !dark && ty===0
    // Dark stone dither base + wooden crossbeam strip
    for (let v = 0; v < 4; v++) {
        const can = _mkTile(), c = can.getContext('2d');
        const rng = _rng(v*71+3000);
        dither2(c, 0, 0, T, T, P.D_STONE, P.D_VOID, v&1);       // stone base
        const beamY = Math.floor(T*.38), beamH = Math.max(3, Math.floor(T*.18));
        c.fillStyle = P.D_BROWN; c.fillRect(0, beamY, T, beamH);  // beam body
        c.fillStyle = P.S_DARK;  c.fillRect(0, beamY, T, 1);      // beam top face (lit)
        c.fillStyle = P.D_VOID;  c.fillRect(0, beamY+beamH-1, T, 1); // beam bottom shadow
        c.fillStyle = P.D_VOID;  // knot/nail pixel
        c.fillRect(Math.floor(rng()*T*.8+T*.1), beamY+Math.floor(beamH*.4), 2, 2);
        _tc[`ceil${v}`] = can;
    }

    // ── WATER  8 animation frames (flipbook @ 4fps = 250ms/frame) ──
    // Three depth zones via Bayer dithering:
    //   Surface  0–35%:  V_WATER_SURF / V_WATER_HI  caustic shimmer
    //   Mid     35–65%:  V_WATER_MID  / V_WATER_DEEP (Bayer 55%)
    //   Deep    65–100%: V_WATER_DEEP solid fill
    // Per frame: primary highlight line shifts ±2px; ripple ellipses
    // grow/fade in two independent off-center pools.
    for (let f = 0; f < 8; f++) {
        const can = _mkTile(), c = can.getContext('2d');
        c.imageSmoothingEnabled = false;

        // ── 1. Deep bottom ──────────────────────────────
        c.fillStyle = P.V_WATER_DEEP; c.fillRect(0, 0, T, T);
        // Mid depth: Bayer blend V_WATER_MID into deep zone
        _db(c, 0, Math.floor(T*0.40), T, Math.floor(T*0.30), P.V_WATER_MID, P.V_WATER_DEEP, 0.55);
        // Surface zone: solid V_WATER_SURF over upper portion
        c.fillStyle = P.V_WATER_SURF; c.fillRect(0, 0, T, Math.floor(T*0.40));
        // Bayer transition surface → mid
        _db(c, 0, Math.floor(T*0.33), T, Math.floor(T*0.14), P.V_WATER_SURF, P.V_WATER_MID, 0.50);

        // ── 2. Caustic shimmer at surface ───────────────
        _db(c, 0, 0, T, Math.floor(T*0.32), P.V_WATER_SURF, P.V_WATER_HI, 0.11);

        // ── 3. Drifting primary highlight line ──────────
        // Moves up by 1px per frame then wraps at top of tile
        const hlY = Math.floor(T*0.22) - (f & 3) * Math.floor(T*0.025);
        c.fillStyle = P.V_WATER_HI;
        c.fillRect(Math.floor(T*0.08), hlY, Math.floor(T*0.55), 1);
        c.fillStyle = P.V_WATER_FOAM;
        c.fillRect(Math.floor(T*0.26), hlY, Math.floor(T*0.20), 1); // bright center

        // ── 4. Secondary highlight (inverted phase) ─────
        const hlY2 = Math.floor(T*0.62) + (f & 3) * Math.floor(T*0.02);
        c.fillStyle = P.V_WATER_HI;
        c.fillRect(Math.floor(T*0.45), hlY2, Math.floor(T*0.34), 1);

        // ── 5. Ripple A — left-center pool ──────────────
        // Grows over frames 1-4 then collapses; ellipse squashed ~50% vertically
        const rAphase = f & 3;  // 0-3 within each half-cycle
        if (rAphase > 0) {
            const rAr   = [0, 2, 4, 3][rAphase];
            const rAalp = [0, 0.85, 0.65, 0.30][rAphase];
            c.globalAlpha = rAalp;
            _el(c, Math.floor(T*0.30), Math.floor(T*0.55), rAr, Math.max(1, Math.ceil(rAr*0.55)), P.V_WATER_HI);
            c.globalAlpha = 1;
        }

        // ── 6. Ripple B — right-center pool (offset 4 frames) ─
        const rBphase = (f + 4) & 7;
        if (rBphase >= 1 && rBphase <= 3) {
            const rBr   = [0, 2, 3, 2][rBphase > 3 ? 0 : rBphase];
            const rBalp = [0, 0.75, 0.55, 0.25][rBphase > 3 ? 0 : rBphase];
            if (rBr > 0) {
                c.globalAlpha = rBalp;
                _el(c, Math.floor(T*0.66), Math.floor(T*0.38), rBr, Math.max(1, Math.ceil(rBr*0.5)), P.V_WATER_HI);
                c.globalAlpha = 1;
            }
        }

        // ── 7. Specular glint (every 4 frames) ──────────
        if ((f & 3) === 0) {
            c.fillStyle = P.V_WATER_FOAM;
            const gx = f === 0 ? Math.floor(T*0.14) : Math.floor(T*0.54);
            c.fillRect(gx, Math.floor(T*0.17), 2, 1);
            c.fillRect(Math.floor(T*0.42), Math.floor(T*0.42), 1, 1);
        }

        _tc[`wa${f}`] = can;
    }

    // ── TORCH  2 animation frames (transparent bg) ───────────
    // Frame 'ta' = tall narrow flame  |  Frame 'tb' = wide squat flame
    // Wall background is drawn separately by drawTorch() before compositing.
    for (let f = 0; f < 2; f++) {
        const can = _mkTile(), c = can.getContext('2d');
        // Bracket: dark iron pole + lighter metal bands
        c.fillStyle = P.D_STONE;
        c.fillRect(Math.floor(T*.42), Math.floor(T*.34), Math.floor(T*.16), Math.floor(T*.36));
        c.fillStyle = P.M_STONE;
        c.fillRect(Math.floor(T*.38), Math.floor(T*.34), Math.floor(T*.24), Math.floor(T*.05));
        c.fillRect(Math.floor(T*.38), Math.floor(T*.66), Math.floor(T*.24), Math.floor(T*.05));
        // Flame via stacked palette rects (no ellipse/rgba)
        const tcx = Math.floor(T*.50), tcy = Math.floor(T*.16);
        if (f===0) { // tall narrow teardrop
            c.fillStyle=P.A_RED;    c.fillRect(tcx-3, tcy+8, 6, 8);
            c.fillStyle=P.A_ORANGE; c.fillRect(tcx-2, tcy+3, 5, 8);
            c.fillStyle=P.A_YELLOW; c.fillRect(tcx-1, tcy,   3, 6);
            c.fillStyle=P.L_WHITE;  c.fillRect(tcx,   tcy,   1, 3);
        } else {     // wide squat teardrop
            c.fillStyle=P.A_RED;    c.fillRect(tcx-4, tcy+7, 8, 7);
            c.fillStyle=P.A_ORANGE; c.fillRect(tcx-3, tcy+3, 7, 7);
            c.fillStyle=P.A_YELLOW; c.fillRect(tcx-1, tcy+1, 4, 5);
            c.fillStyle=P.L_WHITE;  c.fillRect(tcx,   tcy+1, 2, 2);
        }
        _tc[f===0?'ta':'tb'] = can;
    }
}

// ═══════════════════════════════════════════════════════
//  VARIANT MAP  — bake tile variant indices at map-load time
//  Eliminates per-frame hash arithmetic from the render loop.
//
//  Packing (Uint8Array, one byte per tile):
//    bits [3:0]  primary variant (grass 0-7, path/floor/wall 0-3)
//    bits [5:4]  tree overlay variant (0-3, used only on TILE.TREE)
//
//  PHASE 2 ADDITION:
//  When map.biomeData is present (village map), variant selection is
//  biome-aware rather than pure hash:
//
//  GRASS tiles → cardinal forest-neighbor bitmask → _GRASS_EDGE_LUT
//    selects the correct Serene-Village edge/corner tile variant so
//    grass blends into forest with proper direction-aware sprites.
//    Interior grass (no forest neighbors) rotates between variant 0/1.
//
//  PATH tiles → topology detection (N/S/E/W PATH neighbours)
//    → dirt_path_cross / dirt_path_h / dirt_path_v / dirt_center
//    so roads display correct directional sprites and open village
//    ground shows a plain dirt_center tile.
//
//  All other tile types and all interior/dungeon maps keep the
//  original hash arithmetic so nothing else is affected.
// ═══════════════════════════════════════════════════════

// Forest-neighbor bitmask → GRASS variant index (TILE_MANIFEST GRASS.ids)
//   bits: 0=N forest  1=E forest  2=S forest  3=W forest
//
// Serene Village grass variants:
//   0 grass_center   2 grass_top     4 grass_left    6 grass_corner_tl
//   1 grass_center   3 grass_bottom  5 grass_right   7 grass_corner_tr
const _GRASS_EDGE_LUT = new Uint8Array([
//  0    1    2    3    4    5    6    7    8    9   10   11   12   13   14   15
    0,   2,   5,   7,   3,   0,   0,   3,   4,   6,   0,   4,   0,   2,   5,   0,
]);
// Detailed mapping (bits: W=8 S=4 E=2 N=1):
//   0  0000  no forest          → 0  grass_center (interior)
//   1  0001  N only             → 2  grass_top
//   2  0010  E only             → 5  grass_right
//   3  0011  N+E forest         → 7  grass_corner_tr  (top-right outer corner)
//   4  0100  S only             → 3  grass_bottom
//   5  0101  N+S (strip)        → 0  center fallback
//   6  0110  E+S                → 0  center fallback
//   7  0111  N+E+S              → 3  grass_bottom  (W open → face W side)
//   8  1000  W only             → 4  grass_left
//   9  1001  N+W forest         → 6  grass_corner_tl  (top-left outer corner)
//  10  1010  E+W (strip)        → 0  center fallback
//  11  1011  N+E+W              → 4  grass_left    (S open → face S side)
//  12  1100  S+W                → 0  center fallback
//  13  1101  N+S+W              → 2  grass_top     (E open → face E side)
//  14  1110  E+S+W              → 5  grass_right   (N open → face N side)
//  15  1111  all forest         → 0  center (surrounded, rare)

function buildVariantMap(map) {
    const w  = map.w, h = map.h;
    const vm = new Uint8Array(w * h);
    const bd = map.biomeData;   // Uint8Array | undefined — only set on village map

    for (let ty = 0; ty < h; ty++) {
        const row = map.tiles[ty];
        if (!row) continue;
        for (let tx = 0; tx < w; tx++) {
            const tile = row[tx];
            let v = 0;

            if (bd) {
                // ── Biome-aware selection (village map) ───────────────
                // Helper: biome at (ty2,tx2), treats OOB as FOREST border
                const B = (dy, dx) => {
                    const ty2 = ty + dy, tx2 = tx + dx;
                    return (ty2 < 0 || ty2 >= h || tx2 < 0 || tx2 >= w)
                        ? BIOME.FOREST
                        : bd[ty2 * w + tx2];
                };
                // Helper: tile type at (ty2,tx2), returns -1 for OOB
                const T = (dy, dx) => {
                    const ty2 = ty + dy, tx2 = tx + dx;
                    if (ty2 < 0 || ty2 >= h || tx2 < 0 || tx2 >= w) return -1;
                    return map.tiles[ty2]?.[tx2] ?? -1;
                };

                switch (tile) {

                    case TILE.GRASS: {
                        // Cardinal forest-neighbor bitmask → edge tile or interior
                        const mask =
                            ((B(-1,  0) === BIOME.FOREST) ? 1 : 0) |   // N
                            ((B( 0, +1) === BIOME.FOREST) ? 2 : 0) |   // E
                            ((B(+1,  0) === BIOME.FOREST) ? 4 : 0) |   // S
                            ((B( 0, -1) === BIOME.FOREST) ? 8 : 0);    // W
                        v = mask ? _GRASS_EDGE_LUT[mask]
                                 : (((tx * 2237) ^ (ty * 3181)) >>> 0) % 5; // interior: variants 0-4, no checkerboard
                        break;
                    }

                    case TILE.TREE: {
                        // Preserve existing two-part packing:
                        //   bits [3:0] = grass sub-variant (drawn under canopy)
                        //   bits [5:4] = tree-canopy variant (0 or 1)
                        v = ((tx * 7 + ty * 13) & 11)
                          | (((tx * 5 + ty * 9) & 3) << 4);
                        break;
                    }

                    case TILE.DIRT_PATH: {
                        // Topology-aware road detection: path segments connect visually.
                        const _isP = t => t === TILE.DIRT_PATH || t === TILE.STONE_PATH;
                        const pN = _isP(T(-1, 0));
                        const pE = _isP(T( 0,+1));
                        const pS = _isP(T(+1, 0));
                        const pW = _isP(T( 0,-1));
                        const axisV = pN || pS;
                        const axisH = pE || pW;
                        if      (axisV && axisH) v = 0; // cross intersection
                        else if (axisV)           v = 3; // N–S segment
                        else if (axisH)           v = 2; // E–W segment
                        else                      v = 1; // isolated patch
                        break;
                    }

                    case TILE.STONE_PATH: {
                        v = (tx * 11 + ty * 7) & 3; // hash-based cobblestone variant
                        break;
                    }

                    case TILE.BUILDING_WALL: {
                        // Position-aware facade encoding.
                        //   v=0 roof    — no solid wall to north
                        //   v=1 body    — surrounded on all sides
                        //   v=2 r-edge  — no solid wall to east
                        //   v=3 shadow  — no solid wall to south
                        const solid = t => t === TILE.BUILDING_WALL || t === TILE.DOOR;
                        const wN = solid(T(-1,  0));
                        const wS = solid(T(+1,  0));
                        const wE = solid(T( 0, +1));
                        if      (!wN) v = 0;
                        else if (!wS) v = 3;
                        else if (!wE) v = 2;
                        else          v = 1;
                        break;
                    }

                    default: {
                        switch (tile) {
                            case TILE.BUILDING_FLOOR: v = (tx * 5 + ty * 17) & 3; break;
                            default:                  v = 0;                       break;
                        }
                    }
                }

            } else {
                // ── Hash fallback (dungeon / interior maps) ──────────
                switch (tile) {
                    case TILE.GRASS:          v = (tx * 7  + ty * 13) & 11;                                    break;
                    case TILE.TREE:           v = ((tx * 7 + ty * 13) & 11) | (((tx * 5 + ty * 9) & 3) << 4); break;
                    case TILE.DIRT_PATH:      v = (tx * 11 + ty * 7)  & 3;                                    break;
                    case TILE.STONE_PATH:     v = (tx * 11 + ty * 7)  & 3;                                    break;
                    case TILE.BUILDING_FLOOR: v = (tx * 5  + ty * 17) & 3;                                    break;
                    case TILE.BUILDING_WALL:  v = (tx * 3  + ty * 11) & 3;                                    break;
                    default:                  v = 0;                                                           break;
                }
            }

            vm[ty * w + tx] = v;
        }
    }
    map.variantMap = vm;
}

// ═══════════════════════════════════════════════════════
//  BACKGROUND CACHE  — pre-bake all static tiles to bgCanvas
// ═══════════════════════════════════════════════════════

function withTarget(targetCtx, fn) {
    const prev = ctx;
    ctx = Game.ctx = targetCtx;
    try {
        return fn();
    } finally {
        ctx = Game.ctx = prev;
    }
}

// Draw all non-animated tiles to bgCanvas via withTarget.
// Called once per frame only when bgDirty is set (cam moved or map changed).
function rebuildBgCanvas() {
    // Ensure variant indices are pre-computed (lazy — also covers dungeon rebuilds)
    if (!currentMap.variantMap) buildVariantMap(currentMap);

    // [Fix 1] 4-tile scroll buffer — wider zone means threshold crossings are rarer,
    // eliminating the 1-frame edge-exposure that caused perimeter tile flicker.
    const BUF = 4 * TS;
    const bw  = cW + 2 * BUF;
    const bh  = cH + 2 * BUF;

    // Resize backing canvas when viewport or TS changes
    if (bgCanvas.width !== bw || bgCanvas.height !== bh) {
        bgCanvas.width  = bw;
        bgCanvas.height = bh;
        bgCtx = bgCanvas.getContext('2d');
        bgCtx.imageSmoothingEnabled = false;
    }

    // Clear full buffer
    bgCtx.clearRect(0, 0, bw, bh);
    if (currentMap.dark) {
        bgCtx.fillStyle = PALETTE.MAP_DARK_BG;
        bgCtx.fillRect(0, 0, bw, bh);
    }

    withTarget(bgCtx, () => {
        ensureTileCache();
        // Expand the tile range by the buffer on every side
        const stx = Math.max(0,               Math.floor((cam.x - BUF) / TS));
        const sty = Math.max(0,               Math.floor((cam.y - BUF) / TS));
        const etx = Math.min(currentMap.w - 1, Math.ceil((cam.x + cW + BUF) / TS));
        const ety = Math.min(currentMap.h - 1, Math.ceil((cam.y + cH + BUF) / TS));
        for (let ty = sty; ty <= ety; ty++) {
            for (let tx = stx; tx <= etx; tx++) {
                const tile = currentMap.tiles[ty][tx];
                if (ANIMATED_TILES.has(tile)) continue; // skip — drawn live each frame
                // Shift tile position by BUF so the buffer region sits off the left/top edge
                drawTile(tile, tx * TS - cam.x + BUF, ty * TS - cam.y + BUF, tx, ty);
            }
        }

        // Bake AO with matching BUF offset so gradients align with the shifted tile positions
        if (typeof VQ !== 'undefined') VQ.bakeAO(bgCtx, stx, sty, etx, ety, BUF, BUF);

        // ── Phase 3: draw secondary decorations (stumps, bushes, plants, patches) ──
        // These sit on top of the baked tile layer but below entities/particles.
        // 'patch' entries (Phase 5) are full-tile semi-transparent tints drawn here too.
        if (currentMap.decorations && currentMap.decorations.length > 0) {
            for (const dec of currentMap.decorations) {
                if (dec.tx < stx || dec.tx >= etx || dec.ty < sty || dec.ty >= ety) continue;
                const dpx = (dec.tx - stx) * TS + BUF;
                const dpy = (dec.ty - sty) * TS + BUF;
                _drawDecoration(bgCtx, dpx, dpy, dec.type, dec.variant, TS);
            }
        }

        // ── Phase 5: worn-path overlay ──────────────────────────────────────────
        // A lighter central band drawn over high-traffic PATH tiles gives the roads
        // a worn, sun-bleached appearance. Drawn after decorations so it's always
        // the topmost static layer (entities and particles still render above this).
        if (currentMap.wornPaths) {
            const wp = currentMap.wornPaths;
            const mw = currentMap.w;
            for (let wty = sty; wty <= ety; wty++) {
                for (let wtx = stx; wtx <= etx; wtx++) {
                    const level = wp[wty * mw + wtx];
                    if (!level) continue;
                    const wpx = (wtx - stx) * TS + BUF;
                    const wpy = (wty - sty) * TS + BUF;
                    const pad = Math.round(TS * 0.20);
                    bgCtx.globalAlpha = level === 2 ? 0.24 : 0.13;
                    bgCtx.fillStyle   = PALETTE.L_WHITE;
                    bgCtx.fillRect(Math.round(wpx + pad), Math.round(wpy + pad),
                                   TS - pad * 2, TS - pad * 2);
                    bgCtx.globalAlpha = 1;
                }
            }
        }
        // ── Phase 5 note: water animation ────────────────────────────────────────
        // TILE.WATER is in ANIMATED_TILES — it is NOT baked here. It is drawn live
        // each frame by drawAnimatedTiles() which calls spriteRenderer.drawTile with
        // the current _waterFrame (advanced at 4 fps by spriteRenderer.advanceAnimations).
    });
    bgDirty = false;
    // [Fix 1] Snap to integer so blit offset never has sub-pixel drift
    _bgCamX = Math.round(cam.x);
    _bgCamY = Math.round(cam.y);
}

// Draw only the animated tiles directly onto the main ctx each frame.
function drawAnimatedTiles() {
    ensureTileCache();
    const stx = Math.max(0, Math.floor(cam.x / TS));
    const sty = Math.max(0, Math.floor(cam.y / TS));
    const etx = Math.min(currentMap.w - 1, Math.ceil((cam.x + cW) / TS));
    const ety = Math.min(currentMap.h - 1, Math.ceil((cam.y + cH) / TS));
    for (let ty = sty; ty <= ety; ty++) {
        for (let tx = stx; tx <= etx; tx++) {
            const tile = currentMap.tiles[ty][tx];
            if (!ANIMATED_TILES.has(tile)) continue;
            drawTile(tile, tx * TS - cam.x, ty * TS - cam.y, tx, ty);
        }
    }
}

// ═══════════════════════════════════════════════════════
//  TILE RENDERING
// ═══════════════════════════════════════════════════════
function drawTile(tile, px, py, tx, ty) {
    const ipx = Math.floor(px), ipy = Math.floor(py);
    // SpriteRenderer routes all tiles through tileRenderer's offscreen cache.
    if (typeof spriteRenderer !== 'undefined' && spriteRenderer.isReady()) {
        spriteRenderer.drawTile(tile, ipx, ipy, tx, ty);
        return;
    }
    // ── Fallback: _tc cache (active only before SpriteRenderer is ready) ──────
    ensureTileCache();
    const dark = currentMap.dark;
    const S1 = TS + 1; // 1px over to close sub-pixel seams
    // Helper: is a tile ID a path-type (used for grass autotile blending)
    const _isPath = t => t === TILE.DIRT_PATH || t === TILE.STONE_PATH;
    switch (tile) {
        case TILE.GRASS: {
            const _gv = currentMap.variantMap
                ? currentMap.variantMap[ty * currentMap.w + tx] & 7
                : (tx*7+ty*13)&7;
            ctx.drawImage(_tc[`g${_gv}`], ipx, ipy, S1, S1);
            // Autotile edge blending: dithered strip at grass→path/water borders
            const sw = Math.max(4, Math.floor(TS/8));
            const blendNeighbors = [[tx,ty-1,0],[tx,ty+1,1],[tx-1,ty,2],[tx+1,ty,3]];
            for (const [ntx,nty,dir] of blendNeighbors) {
                const nt = currentMap.tiles[nty]?.[ntx];
                if (!_isPath(nt) && nt!==TILE.WATER) continue;
                const bCol = nt===TILE.WATER ? PALETTE.M_SLATE : PALETTE.M_CLAY;
                if (dir===0) dither2(ctx, ipx, ipy,           TS, sw, PALETTE.M_FOREST, bCol, 0);
                if (dir===1) dither2(ctx, ipx, ipy+TS-sw,     TS, sw, PALETTE.M_FOREST, bCol, 1);
                if (dir===2) dither2(ctx, ipx, ipy,           sw, TS, PALETTE.M_FOREST, bCol, 0);
                if (dir===3) dither2(ctx, ipx+TS-sw, ipy,     sw, TS, PALETTE.M_FOREST, bCol, 1);
            }
            // Diagonal corner fills at convex path corners
            for (let ci = 0; ci < 4; ci++) {
                const dnx = ci < 2 ? tx+1 : tx-1;
                const dny = (ci===0||ci===2) ? ty-1 : ty+1;
                const dt  = currentMap.tiles[dny]?.[dnx];
                if (!_isPath(dt) && dt!==TILE.WATER) continue;
                const a1t = currentMap.tiles[dny]?.[tx];
                const a2t = currentMap.tiles[ty ]?.[dnx];
                if ((_isPath(a1t)||a1t===TILE.WATER)||(_isPath(a2t)||a2t===TILE.WATER)) continue;
                const bCol = dt===TILE.WATER ? PALETTE.M_SLATE : PALETTE.M_CLAY;
                dither2(ctx, ipx+(dnx>tx?TS-sw:0), ipy+(dny>ty?TS-sw:0), sw, sw, PALETTE.M_FOREST, bCol, 0);
            }
            break;
        }
        case TILE.DIRT_PATH: {
            const _pv = currentMap.variantMap
                ? currentMap.variantMap[ty * currentMap.w + tx] & 3
                : (tx*11+ty*7)&3;
            ctx.drawImage(_tc[`p${_pv}`], ipx, ipy, S1, S1);
            break;
        }
        case TILE.STONE_PATH: {
            const _sv = currentMap.variantMap
                ? currentMap.variantMap[ty * currentMap.w + tx] & 3
                : (tx*11+ty*7)&3;
            ctx.drawImage(_tc[`sp${_sv}`], ipx, ipy, S1, S1);
            break;
        }
        case TILE.BUILDING_FLOOR: {
            const v = currentMap.variantMap
                ? currentMap.variantMap[ty * currentMap.w + tx] & 3
                : (tx*5+ty*17)&3;
            ctx.drawImage(_tc[dark?`fd${v}`:`fl${v}`], ipx, ipy, S1, S1);
            break;
        }
        case TILE.BUILDING_WALL: {
            const v = currentMap.variantMap
                ? currentMap.variantMap[ty * currentMap.w + tx] & 3
                : (tx*3+ty*11)&3;
            // Ceiling: interior top row → overhead beam tile
            if (!dark && currentMap.returnMap && ty === 0) {
                ctx.drawImage(_tc[`ceil${v}`], ipx, ipy, S1, S1);
                break;
            }
            const wk = dark ? `wd${v}` : currentMap.returnMap ? `win${v}` : `wex${v}`;
            ctx.drawImage(_tc[wk], ipx, ipy, S1, S1);
            break;
        }
        case TILE.TREE: {
            const _pk = currentMap.variantMap
                ? currentMap.variantMap[ty * currentMap.w + tx]
                : ((tx*7+ty*13)&7)|(((tx*5+ty*9)&3)<<4);
            const gv = _pk & 7, tv = (_pk >> 4) & 3;
            ctx.drawImage(_tc[`g${gv}`], ipx, ipy, S1, S1);
            ctx.drawImage(_tc[`tr${tv}`], ipx, ipy, S1, S1);
            break;
        }
        case TILE.WATER:    drawWater(px,py);       break;
        case TILE.DOOR:     drawDoor(px,py,tx,ty);  break;
        case TILE.STAIRS:   drawStairs(px,py);       break;
        case TILE.STAIRSUP: drawStairsUp(px,py);    break;
        case TILE.VOID:     drawVoid(px,py);         break;
        case TILE.SIGN: {
            const snb = [
                currentMap.tiles[ty]?.[tx-1], currentMap.tiles[ty]?.[tx+1],
                currentMap.tiles[ty-1]?.[tx],  currentMap.tiles[ty+1]?.[tx],
            ];
            const onWall = snb.some(t => t === TILE.BUILDING_WALL);
            if (dark || onWall) {
                const sv = (tx*3+ty*11)&3;
                const swk = dark ? `wd${sv}` : currentMap.returnMap ? `win${sv}` : `wex${sv}`;
                ctx.drawImage(_tc[dark?`fd${(tx*5+ty*17)&3}`:swk], ipx, ipy, S1, S1);
            } else if (snb.some(t => t === TILE.BUILDING_FLOOR)) {
                ctx.drawImage(_tc[`fl${(tx*5+ty*17)&3}`], ipx, ipy, S1, S1);
            } else if (snb.some(t => _isPath(t))) {
                ctx.drawImage(_tc[`p${(tx*11+ty*7)&3}`], ipx, ipy, S1, S1);
            } else {
                ctx.drawImage(_tc[`g${(tx*7+ty*13)&11}`], ipx, ipy, S1, S1);
            }
            if (onWall) drawWallPlaque(px, py);
            else        drawSignPost(px, py);
            break;
        }
        case TILE.TORCH: drawTorch(px,py,tx,ty); break;
        default: ctx.fillStyle = PALETTE.D_VOID; ctx.fillRect(ipx, ipy, TS, TS);
    }
}

// VOID — pure black null tile
function drawVoid(px, py) {
    ctx.fillStyle = PALETTE.D_VOID;
    ctx.fillRect(Math.floor(px), Math.floor(py), TS, TS);
}

function drawWater(px, py) {
    const ipx = Math.floor(px), ipy = Math.floor(py);
    // Blit pre-rendered flipbook frame (4fps = 250ms per frame, 8-frame cycle)
    const frame = Math.floor(timeMs / 250) & 7;
    ctx.drawImage(_tc[`wa${frame}`], ipx, ipy, TS+1, TS+1);
    // Live lily pad (anchored by tile-seed so same pad each frame)
    const txw = Math.round(px/TS), tyw = Math.round(py/TS);
    const ws = txw*7 + tyw*13;
    if (ws % 5 === 0) {
        const lpx = Math.floor(px + TS*.18 + (ws%3)*TS*.22);
        const lpy = Math.floor(py + TS*.30 + ((ws>>2)%3)*TS*.20);
        const lpR = Math.floor(TS*.13);
        // Pad body (M_FOREST green circle)
        ctx.fillStyle = PALETTE.M_FOREST;
        ctx.beginPath(); ctx.arc(lpx, lpy, lpR, 0, Math.PI*2); ctx.fill();
        // Notch wedge cut-out (water colour)
        ctx.fillStyle = PALETTE.M_SLATE;
        ctx.beginPath(); ctx.moveTo(lpx,lpy); ctx.arc(lpx,lpy,lpR+1,-0.45,0.15); ctx.closePath(); ctx.fill();
        // 2px specular highlight
        ctx.fillStyle = PALETTE.L_LEAF;
        ctx.fillRect(lpx-Math.floor(lpR*.3), lpy-Math.floor(lpR*.3), 2, 1);
        // Tiny flower on rarer pads
        if (ws % 15 === 0) {
            ctx.fillStyle = PALETTE.A_RARE;
            ctx.beginPath(); ctx.arc(lpx, lpy-Math.floor(lpR*.1), Math.max(1,Math.floor(lpR*.35)), 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = PALETTE.L_WHITE;
            ctx.fillRect(lpx-1, lpy-Math.floor(lpR*.1)-1, 2, 2);
        }
    }
}

function drawDoor(px, py, tx, ty) {
    const P = PALETTE;
    const dark = currentMap.dark;
    const T = TS;
    const ipx = Math.floor(px), ipy = Math.floor(py);
    const S1 = T + 1;

    // ── 1. Wall background from tile cache ───────────────────────────────
    const wv = ((tx||0)*3 + (ty||0)*11) & 3;
    const wk = dark ? `wd${wv}` : currentMap.returnMap ? `win${wv}` : `wex${wv}`;
    ctx.drawImage(_tc[wk], ipx, ipy, S1, S1);

    // ── 2. Stone door frame (recessed arch) ──────────────────────────────
    const frameL   = Math.floor(T*.13), frameR = Math.floor(T*.87);
    const frameW   = frameR - frameL;
    const frameTop = Math.floor(T*.05), frameBot = Math.floor(T*.86);
    ctx.fillStyle = dark ? P.D_VOID : P.D_BROWN;
    ctx.fillRect(ipx+frameL-2, ipy+frameTop, frameW+4, frameBot-frameTop);

    // Arch top
    const archH = Math.floor(T*.10);
    ctx.fillStyle = dark ? P.D_BLUE  : P.M_CLAY;
    ctx.fillRect(ipx+frameL, ipy+frameTop, frameW, archH);
    ctx.fillStyle = dark ? P.D_STONE : P.M_STONE;
    ctx.fillRect(ipx+frameL+2, ipy+frameTop+1, frameW-4, archH-2);

    // ── 3. Door panel ────────────────────────────────────────────────────
    const dL   = ipx+frameL+2,  dTop = ipy+frameTop+archH;
    const dW   = frameW-4,      dH   = frameBot-frameTop-archH-2;

    // Open state: player is standing on this tile → show interior darkness
    const isOpen = (tx !== undefined) && (player.x === tx) && (player.y === ty);

    if (isOpen) {
        // Dark void (interior darkness visible)
        ctx.fillStyle = P.D_VOID;
        ctx.fillRect(dL, dTop, dW, dH);
        // Dithered transition at the threshold — D_VOID fading into D_BLUE
        dither2(ctx, dL, dTop, dW, Math.floor(dH*.4), P.D_VOID, P.D_BLUE, 0);
    } else {
        // Closed state — vertical wood planks
        const plankH   = Math.floor(dH/4);
        const plankCols = dark
            ? [P.D_BROWN, P.D_VOID, P.D_BROWN, P.D_VOID]
            : [P.S_DARK,  P.M_CLAY, P.S_DARK,  P.S_MID ];
        for (let i = 0; i < 4; i++) {
            const plankY = dTop + i*plankH;
            const ph = (i === 3) ? dH - 3*plankH : plankH;
            ctx.fillStyle = plankCols[i];
            ctx.fillRect(dL, plankY, dW, ph-1);
            // Top highlight — flat palette pixel (no rgba)
            ctx.fillStyle = P.L_WHITE;
            ctx.fillRect(dL, plankY, dW, 1);
            // Vertical grain lines
            ctx.fillStyle = P.D_VOID;
            ctx.fillRect(dL+Math.floor(dW*.33), plankY+1, 1, ph-2);
            ctx.fillRect(dL+Math.floor(dW*.66), plankY+1, 1, ph-2);
        }
        // Panel inset shadow on sides
        ctx.fillStyle = P.D_VOID;
        ctx.fillRect(dL,      dTop, 2, dH);
        ctx.fillRect(dL+dW-2, dTop, 2, dH);

        // ── Metal crossbar across the middle (spec item 15) ──────────────
        const crossY = dTop + Math.floor(dH*.46);
        const crossH = Math.max(2, Math.floor(T*.05));
        ctx.fillStyle = dark ? P.D_STONE : P.M_STONE;
        ctx.fillRect(dL, crossY, dW, crossH);
        ctx.fillStyle = P.L_STONE; ctx.fillRect(dL, crossY,          dW, 1);
        ctx.fillStyle = P.D_VOID;  ctx.fillRect(dL, crossY+crossH-1, dW, 1);

        // ── Handle (brass) ────────────────────────────────────────────────
        const hx = ipx+Math.floor(T*.70), hy = ipy+Math.floor(T*.50);
        ctx.fillStyle = P.U_GOLD;
        ctx.fillRect(hx, hy, Math.floor(T*.06), Math.floor(T*.10));
        ctx.fillStyle = P.L_GOLD;
        ctx.fillRect(hx+1, hy+1, Math.floor(T*.03), Math.floor(T*.04));

        // ── Hinges (iron, left side) ──────────────────────────────────────
        const hingeX = ipx+frameL+2;
        const hingeW = Math.floor(T*.07), hingeH = Math.floor(T*.06);
        ctx.fillStyle = P.D_STONE;
        ctx.fillRect(hingeX, ipy+Math.floor(T*.20), hingeW, hingeH);
        ctx.fillRect(hingeX, ipy+Math.floor(T*.62), hingeW, hingeH);
        ctx.fillStyle = P.L_WHITE;
        ctx.fillRect(hingeX, ipy+Math.floor(T*.20), hingeW, 1);
        ctx.fillRect(hingeX, ipy+Math.floor(T*.62), hingeW, 1);
    }

    // ── 6. Stone step / threshold ─────────────────────────────────────────
    const stepH = Math.floor(T*.14);
    ctx.fillStyle = dark ? P.D_BLUE : P.M_SAND;
    ctx.fillRect(ipx+frameL-3, ipy+frameBot, frameW+6, stepH);
    ctx.fillStyle = P.L_WHITE;
    ctx.fillRect(ipx+frameL-3, ipy+frameBot,          frameW+6, 1);
    ctx.fillStyle = P.D_VOID;
    ctx.fillRect(ipx+frameL-3, ipy+frameBot+stepH-1,  frameW+6, 1);

    // ── 7. Transom window above arch ─────────────────────────────────────
    const winY = ipy+frameTop+2, winH = archH-4;
    const winL = dL+Math.floor(dW*.20), winW = Math.floor(dW*.60);
    if (winH > 2) {
        ctx.fillStyle = dark ? P.D_VOID : P.M_SLATE;
        ctx.fillRect(winL, winY, winW, winH);
        ctx.fillStyle = P.L_WHITE;
        ctx.fillRect(winL, winY, winW, 1);
        ctx.fillRect(winL, winY, 1,    winH);
        ctx.fillStyle = dark ? P.D_BLUE : P.L_BLUE;
        ctx.fillRect(winL+Math.floor(winW/2)-1, winY, 1, winH);
    }
}

function drawStairs(px, py) {
    const P = PALETTE, ipx = Math.floor(px), ipy = Math.floor(py);
    const stripeH = Math.floor(TS/5);
    // 5 stripes alternating dark/mid slate — descending depth effect
    const cols = [P.M_SLATE, P.D_BLUE, P.M_SLATE, P.D_BLUE, P.M_TEAL];
    for (let i = 0; i < 5; i++) {
        const sy  = ipy + i*stripeH;
        const inset = i * Math.floor(TS/11);
        const h   = i===4 ? TS - 4*stripeH : stripeH;
        ctx.fillStyle = cols[i]; ctx.fillRect(ipx+inset, sy, TS-inset*2, h-1);
        ctx.fillStyle = P.L_BLUE;  ctx.fillRect(ipx+inset, sy, TS-inset*2, 1);          // bright step edge
        ctx.fillStyle = P.D_VOID;  ctx.fillRect(ipx+inset, sy+h-2, TS-inset*2, 1);      // dark riser shadow
    }
    // Animated descend arrow (palette colour, no rgba)
    const t = timeMs/1000;
    ctx.fillStyle = P.A_PURPLE;
    ctx.font = `bold ${Math.floor(TS*.3)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('↓', ipx+Math.floor(TS/2), Math.floor(ipy+TS*.44+Math.sin(t*2.5)*2));
}

function drawStairsUp(px, py) {
    const P = PALETTE, ipx = Math.floor(px), ipy = Math.floor(py);
    if (currentMap?.returnMap) {
        // Interior exit — floor doormat with EXIT label
        const fv = ((ipx/TS|0)*5+(ipy/TS|0)*17)&3;
        ctx.drawImage(_tc[`fl${fv}`], ipx, ipy, TS+1, TS+1);
        ctx.fillStyle = P.S_DARK;
        ctx.fillRect(Math.floor(px+TS*.10), Math.floor(py+TS*.25), Math.floor(TS*.80), Math.floor(TS*.50));
        ctx.fillStyle = P.S_MID;
        for (let i = 0; i < 4; i++)
            ctx.fillRect(Math.floor(px+TS*.15+i*TS*.18), Math.floor(py+TS*.30), Math.max(1,Math.floor(TS*.04)), Math.floor(TS*.40));
        ctx.fillStyle = P.L_GOLD;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = `bold ${Math.floor(TS*.22)}px sans-serif`;
        ctx.fillText('EXIT', Math.floor(px+TS/2), Math.floor(py+TS*.52));
        return;
    }
    // 5 stripes alternating moss/dark green — ascending depth
    const stripeH = Math.floor(TS/5);
    const cols = [P.M_MOSS, P.D_GREEN, P.M_FOREST, P.D_GREEN, P.M_MOSS];
    for (let i = 4; i >= 0; i--) {
        const sy    = ipy + (4-i)*stripeH;
        const inset = i * Math.floor(TS/11);
        const h     = i===0 ? TS - 4*stripeH : stripeH;
        ctx.fillStyle = cols[4-i]; ctx.fillRect(ipx+inset, sy, TS-inset*2, h-1);
        ctx.fillStyle = P.L_LEAF;  ctx.fillRect(ipx+inset, sy, TS-inset*2, 1);
        ctx.fillStyle = P.D_GREEN; ctx.fillRect(ipx+inset, sy+h-2, TS-inset*2, 1);
    }
    const t = timeMs/1000;
    ctx.fillStyle = P.L_LEAF;
    ctx.font = `bold ${Math.floor(TS*.3)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('↑', ipx+Math.floor(TS/2), Math.floor(ipy+TS*.54+Math.sin(t*2.5)*2));
}

function drawWallPlaque(px, py) {
    const P = PALETTE;
    const U = Math.max(1, Math.floor(TS/16));
    // Stone bracket mounts (left + right)
    ctx.fillStyle = P.D_BROWN;
    ctx.fillRect(Math.floor(px+TS*.10), Math.floor(py+TS*.30), U*2, U*3);
    ctx.fillRect(Math.floor(px+TS*.82), Math.floor(py+TS*.30), U*2, U*3);
    // Plaque board: dark border
    const bx = Math.floor(px+TS*.12), by = Math.floor(py+TS*.22);
    const bw = Math.floor(TS*.76),    bh = Math.floor(TS*.44);
    ctx.fillStyle = P.D_BROWN; ctx.fillRect(bx, by, bw, bh);
    // Mid fill
    ctx.fillStyle = P.M_CLAY;  ctx.fillRect(bx+2, by+2, bw-4, bh-4);
    // Top half highlight
    ctx.fillStyle = P.M_SAND;  ctx.fillRect(bx+2, by+2, bw-4, Math.floor((bh-4)/2));
    // 3 carved text lines (flat dark — no rgba)
    const lm = bx+Math.floor(bw*.14), lw = Math.floor(bw*.72);
    ctx.fillStyle = P.D_BROWN;
    ctx.fillRect(lm, Math.floor(by+bh*.24), lw,                 2);
    ctx.fillRect(lm, Math.floor(by+bh*.50), lw,                 2);
    ctx.fillRect(lm, Math.floor(by+bh*.72), Math.floor(lw*.55), 2);
    // Bottom shadow
    ctx.fillStyle = P.D_VOID; ctx.fillRect(bx+2, by+bh-4, bw-4, 2);
    // Corner nail dots
    ctx.fillStyle = P.D_VOID;
    [[bx+Math.floor(bw*.10), by+Math.floor(bh*.15)],
     [bx+Math.floor(bw*.90), by+Math.floor(bh*.15)],
     [bx+Math.floor(bw*.10), by+Math.floor(bh*.82)],
     [bx+Math.floor(bw*.90), by+Math.floor(bh*.82)]].forEach(([nx,ny]) => {
        ctx.fillRect(Math.floor(nx)-U, Math.floor(ny)-U, U*2, U*2);
    });
}

function drawSignPost(px, py) {
    const P = PALETTE;
    const U = Math.max(1, Math.floor(TS/16));
    // ── Post (3-color flat strips) ──────────────────────
    const postX = Math.floor(px+TS*.44), postY = Math.floor(py+TS*.32);
    const postW = Math.floor(TS*.12), postH = Math.floor(TS*.68);
    ctx.fillStyle = P.D_BROWN; ctx.fillRect(postX, postY, postW, postH);
    ctx.fillStyle = P.M_CLAY;  ctx.fillRect(postX+Math.floor(postW*.25), postY, Math.floor(postW*.35), postH);
    ctx.fillStyle = P.D_VOID;  ctx.fillRect(postX+Math.floor(postW*.75), postY, Math.floor(postW*.25), postH);

    // ── Board ──────────────────────────────────────────
    const bx = Math.floor(px+TS*.08), by = Math.floor(py+TS*.04);
    const bw = Math.floor(TS*.84),    bh = Math.floor(TS*.30);
    // Dark border fill
    ctx.fillStyle = P.D_BROWN; ctx.fillRect(bx, by, bw, bh);
    // Parchment fill (spec: parchment-colored fill, 2px dark border)
    ctx.fillStyle = P.S_DARK;  ctx.fillRect(bx+1, by+1, bw-2, bh-2);
    ctx.fillStyle = P.L_PARCH; ctx.fillRect(bx+1, by+1, bw-2, Math.floor(bh/2)-1);

    // 2 horizontal 1px lines inside (spec item 17 — suggests text)
    const lm = bx + Math.floor(bw*.14), lw = Math.floor(bw*.72);
    ctx.fillStyle = P.D_BROWN;
    ctx.fillRect(lm, Math.floor(by+bh*.22), lw,                 2);
    ctx.fillRect(lm, Math.floor(by+bh*.46), lw,                 2);
    ctx.fillRect(lm, Math.floor(by+bh*.68), Math.floor(lw*.55), 2);
    // Highlight row below each line (flat palette — no rgba)
    ctx.fillStyle = P.L_PARCH;
    ctx.fillRect(lm, Math.floor(by+bh*.22)+2, lw,                 1);
    ctx.fillRect(lm, Math.floor(by+bh*.46)+2, lw,                 1);
    ctx.fillRect(lm, Math.floor(by+bh*.68)+2, Math.floor(lw*.55), 1);

    // 4 corner nail dots (flat rects)
    ctx.fillStyle = P.D_VOID;
    [[bx+Math.floor(bw*.12), by+Math.floor(bh*.18)],
     [bx+Math.floor(bw*.88), by+Math.floor(bh*.18)],
     [bx+Math.floor(bw*.12), by+Math.floor(bh*.80)],
     [bx+Math.floor(bw*.88), by+Math.floor(bh*.80)]].forEach(([nx,ny]) => {
        ctx.fillRect(Math.floor(nx)-U, Math.floor(ny)-U, U*2, U*2);
    });
}

function drawTorch(px, py, tx, ty) {
    const dark = currentMap.dark;
    const ipx = Math.floor(px), ipy = Math.floor(py);
    const S1 = TS + 1;
    // ── 1. Wall background from tile cache (no raw drawWall call) ──────────
    const wv = ((tx||0)*3 + (ty||0)*11) & 3;
    const wk = dark ? `wd${wv}` : currentMap.returnMap ? `win${wv}` : `wex${wv}`;
    ctx.drawImage(_tc[wk], ipx, ipy, S1, S1);
    // ── 2. Irregular flame — per-tile phase so torches flicker independently ─
    // Three summed sine waves at incommensurable frequencies create a
    // convincingly non-periodic flicker without any random() call.
    const phase = (((tx||0) * 7 + (ty||0) * 13) & 63) * 0.097;
    const noise = Math.sin(timeMs * 0.008 + phase)
                + Math.sin(timeMs * 0.021 + phase * 1.63) * 0.5
                + Math.sin(timeMs * 0.053 + phase * 0.79) * 0.3;
    const frame = noise > 0.1 ? 'ta' : 'tb';
    ctx.drawImage(_tc[frame], ipx, ipy, S1, S1);
}


// Cached gradient — recreated only on resize, not every frame.
let _vigGrd = null, _vigGrdW = 0, _vigGrdH = 0;
function _invalidateVigGrd() { _vigGrd = null; }

function renderVignette() {
    // Soft corner darkening for interiors — makes small rooms feel enclosed
    if (!currentMap?.returnMap) return;
    if (!_vigGrd || _vigGrdW !== cW || _vigGrdH !== cH) {
        _vigGrd  = ctx.createRadialGradient(cW/2,cH/2,Math.min(cW,cH)*.32,
                                             cW/2,cH/2,Math.min(cW,cH)*.75);
        _vigGrd.addColorStop(0,'rgba(0,0,0,0)');
        _vigGrd.addColorStop(1,'rgba(0,0,0,0.48)');
        _vigGrdW = cW; _vigGrdH = cH;
    }
    ctx.fillStyle = _vigGrd;
    ctx.fillRect(0,0,cW,cH);
}

// ═══════════════════════════════════════════════════════
//  ENTITY & ITEM RENDERING
// ═══════════════════════════════════════════════════════
// Shims — declarations live in game-constants.js
const CLASS_COLORS = Game.CLASS_COLORS;
const CLASS_CLOAK  = Game.CLASS_CLOAK;
const _tintCache   = new Map(); // enemy hurt-flash rgba strings keyed by integer tint level (0-100)

// ── Per-frame allocation fix ──────────────────────────────────────
// These four lookup tables were previously declared as new objects inside
// drawCharacter() and drawWeapon() on every call (every frame, every visible
// character).  At 60fps with a player + ~10 NPCs that was ~200 object
// allocations/frame driving GC pressure.  Hoisted here once at startup.
const _CHAR_DIRS = Object.freeze({up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]});
const _HEAD_OFF  = Object.freeze({up:[0,-.48],down:[0,.38],left:[-.42,0],right:[.42,0]});
const _EYE_POS   = Object.freeze({
    up:    Object.freeze([{x:-.15,y:-.18},{x:.15,y:-.18}]),
    down:  Object.freeze([{x:-.15,y:.10}, {x:.15,y:.10} ]),
    left:  Object.freeze([{x:-.18,y:-.08},{x:-.05,y:.10}]),
    right: Object.freeze([{x:.18, y:-.08},{x:.05, y:.10}]),
});

// ── Humanoid character palette — one entry per class ──────────────────
// See docs/SPRITE_STYLE_GUIDE.md for the full style spec.
// Light source: top-left.  Outline: 1px dark on silhouette edges.
const _CHAR_PALETTES = Object.freeze({
    Warrior: { armor:'#c07818', armorHi:'#d89030', armorSh:'#8a5010',
                cloak:'#1a0c04', cloakEdge:'#2e1a0a',
                collar:'#8a2020', legs:'#3a2818', boots:'#1e1208',
                helmet:'#788898', helmetHi:'#a0b8c8' },
    Rogue:   { armor:'#6020a8', armorHi:'#8030c8', armorSh:'#3a1068',
                cloak:'#0c0c1e', cloakEdge:'#1a1830',
                collar:'#3a1060', legs:'#18121e', boots:'#0c0810',
                helmet:'#3a1870', helmetHi:'#5a2890' },
    Wizard:  { armor:'#4a6878', armorHi:'#6a8898', armorSh:'#2a4858',
                cloak:'#0c0c1e', cloakEdge:'#1a1830',
                collar:'#1a3050', legs:'#1a2838', boots:'#0c1018',
                helmet:'#3a5870', helmetHi:'#5a78a0' },
    Cleric:  { armor:'#c09010', armorHi:'#d8a830', armorSh:'#8a6808',
                cloak:'#141210', cloakEdge:'#201e18',
                collar:'#d4a020', legs:'#2a2218', boots:'#1a1408',
                helmet:'#b8920e', helmetHi:'#e0c040' },
});
// Shared skin / hair / outline / eye constants — same for all classes.
const _CHAR_SKIN    = '#c8a882';
const _CHAR_SKIN_HI = '#ddc09a';
const _CHAR_SKIN_SH = '#a07858';
const _CHAR_HAIR    = '#2a1a0a';
const _CHAR_HAIR_HI = '#3d2a10';   // hair band top-row highlight (all humanoids)
const _CHAR_OUTLINE = '#1a1208';
const _CHAR_EYE_W   = '#e8e0d0';
const _CHAR_EYE_D   = '#281808';

// NPC-specific skin and hair overrides
const _CHAR_SKIN_PALE      = '#d4b890';   // Elder Maren
const _CHAR_SKIN_PALE_HI   = '#e8cca8';
const _CHAR_SKIN_PALE_SH   = '#a88860';
const _CHAR_SKIN_TAN       = '#b07848';   // Daran forge-tan
const _CHAR_SKIN_TAN_HI    = '#c89060';
const _CHAR_SKIN_TAN_SH    = '#886038';
const _CHAR_SKIN_ELF       = '#d4c8a0';   // Veyla elfin
const _CHAR_SKIN_ELF_HI    = '#e8dcb8';
const _CHAR_SKIN_ELF_SH    = '#b0a878';
const _CHAR_SKIN_GHOST     = '#b0c8e0';   // Mira ghost-blue
const _CHAR_SKIN_GHOST_HI  = '#c8dff0';
const _CHAR_SKIN_GHOST_SH  = '#8098b0';
const _CHAR_HAIR_SILVER      = '#c8c8c0'; // Elder Maren
const _CHAR_HAIR_SILVER_BLUE = '#b8b8c0'; // Veyla
const _CHAR_HAIR_GHOST       = '#8090c0'; // Mira

// ── NPC character configs — one entry per npc.id ─────────────────────
const _NPC_CONFIGS = Object.freeze({
    guide: {
        skin: '#c8a882', skinHi: '#ddc09a', skinSh: '#a07858',
        hair: '#2a1a0a',
        palette: { armor:'#3a7830', armorHi:'#4a9840', armorSh:'#285820',
                   cloak:'#1a2010', cloakEdge:'#283018', cloakLining:'#283820', cloakFold:'#141a10',
                   collar:'#c09010', belt:'#6a4010', buckle:'#c09010',
                   legs:'#2a3018', boots:'#1a1208', bootSole:_CHAR_OUTLINE,
                   helmet:'#3a7830', helmetHi:'#4a9840' },
        bareHead: true,  elfEars: false, widthMul: 1.00, accessory: 'satchel',
    },
    elder: {
        skin: '#d4b890', skinHi: '#e8cca8', skinSh: '#a88860',
        hair: '#c8c8c0',
        palette: { armor:'#6a7890', armorHi:'#8898b0', armorSh:'#4a5870',
                   cloak:'#141820', cloakEdge:'#202838', cloakLining:'#202848', cloakFold:'#0c1020',
                   collar:'#c09010', belt:'#4a5870', buckle:'#8898b0',
                   legs:'#282838', boots:'#141418', bootSole:_CHAR_OUTLINE,
                   helmet:'#c0c0b8', helmetHi:'#d8d8d0' },
        bareHead: false, elfEars: false, widthMul: 0.90, accessory: 'staff',
    },
    blacksmith: {
        skin: '#b07848', skinHi: '#c89060', skinSh: '#886038',
        hair: '#2a1a0a',
        palette: { armor:'#4a3018', armorHi:'#6a4828', armorSh:'#302010',
                   cloak:'#1a100a', cloakEdge:'#281808', cloakLining:'#221410', cloakFold:'#100a06',
                   collar:'#883010', belt:'#6a2010', buckle:'#909090',
                   legs:'#302018', boots:'#1a1008', bootSole:_CHAR_OUTLINE,
                   helmet:'#4a3018', helmetHi:'#6a4828' },
        bareHead: true,  elfEars: false, widthMul: 1.15, accessory: 'hammer',
    },
    traveler: {
        skin: '#d4c8a0', skinHi: '#e8dcb8', skinSh: '#b0a878',
        hair: '#b8b8c0',
        palette: { armor:'#2848a0', armorHi:'#3860c0', armorSh:'#183080',
                   cloak:'#101828', cloakEdge:'#182030', cloakLining:'#203050', cloakFold:'#080c18',
                   collar:'#5878c8', belt:'#3860c8', buckle:'#d0b040',
                   legs:'#182050', boots:'#101828', bootSole:_CHAR_OUTLINE,
                   helmet:'#a0b0d0', helmetHi:'#d0e0f0' },
        bareHead: false, elfEars: true,  widthMul: 1.00, accessory: 'scroll',
    },
    ghost: {
        skin: '#b0c8e0', skinHi: '#c8dff0', skinSh: '#8098b0',
        hair: '#8090c0',
        palette: { armor:'#404888', armorHi:'#5060a8', armorSh:'#282e68',
                   cloak:'#101828', cloakEdge:'#182038', cloakLining:'#182040', cloakFold:'#0c1028',
                   collar:'#5868a8', belt:'#303868', buckle:'#5060a8',
                   legs:'#181828', boots:'#101018', bootSole:_CHAR_OUTLINE,
                   helmet:'#404888', helmetHi:'#5060a8' },
        bareHead: false, elfEars: false, widthMul: 1.00, accessory: null,
    },
});

// ── Pixel art player sprite cache ─────────────────────────────────────
// Fixed 64×64 authoring resolution — cache entries are resolution-stable across all TS values.
// Keyed by "charClass|facing|frameIdx". Invalidated only on class change, not on window resize.
const PLAYER_SPRITE_SIZE = 64;
const NPC_SPRITE_SIZE    = 64;

// Accessory material constants — shared across all NPC accessories
const _NPC_WOOD     = '#7a4818';  // staff/handle
const _NPC_METAL    = '#808090';  // hammer/metal base
const _NPC_METAL_HI = '#a0a8d0';  // metal highlight
const _NPC_METAL_SH  = '#606080';  // metal shadow
const _NPC_PARCHMENT = '#e8dcc0';  // scroll/paper

const _charCache = new Map();

// ── Pixel art NPC sprite cache ────────────────────────────────────────
// Fixed 64×64 authoring resolution — cache entries are resolution-stable across all TS values.
// Keyed by "npcId|facing|frameIdx". Invalidated only on explicit invalidateNPCCache(), not on resize.
const _npcCache = new Map();

function _buildCharFrame(charClass, facing, frameIdx) {
    const key = `${charClass}|${facing}|${frameIdx}`;
    if (_charCache.has(key)) { if (Game.DEV) _charCacheHits++; return _charCache.get(key); }
    if (Game.DEV) _charCacheMisses++;

    const P = _CHAR_PALETTES[charClass] || _CHAR_PALETTES.Warrior;
    const PSZ = PLAYER_SPRITE_SIZE; // 64 — authoring canvas; displayed scaled to TS×TS via drawImage

    const off = document.createElement('canvas');
    off.width = off.height = PSZ;
    const c = off.getContext('2d');
    c.imageSmoothingEnabled = false;

    const U   = Math.max(1, Math.floor(PSZ / 16));
    const cx  = Math.floor(PSZ / 2);
    // Walk frames 0-3: frames 1 and 3 bob; idle frames 4-5: frame 5 bobs
    const bob = (frameIdx === 1 || frameIdx === 3 || frameIdx === 5) ? -Math.max(1, Math.floor(PSZ / 32)) : 0;

    const headR  = Math.max(2, Math.floor(PSZ * 0.145));
    const headW  = headR * 2;
    const headH  = headR * 2;
    const headX  = cx - headR;
    const headCY = Math.floor(PSZ * 0.22) + bob;
    const headY  = headCY - headR;

    const bodyW  = Math.floor(PSZ * 0.44);
    const bodyH  = Math.floor(PSZ * 0.32);
    const bodyX  = cx - Math.floor(bodyW / 2);
    const bodyY  = Math.floor(PSZ * 0.40) + bob;
    const sW     = Math.max(U, Math.floor(PSZ * 0.08));

    const legW    = Math.max(1, Math.floor(PSZ * 0.12));
    const legH    = Math.floor(PSZ * 0.22);
    const legTopY = bodyY + bodyH - 1;
    const leftLegX  = bodyX + U;
    const rightLegX = bodyX + bodyW - U - legW;
    // Walk: alternate legs forward/back on frames 1 and 3
    const leftLegDY  = frameIdx === 1 ? -U : frameIdx === 3 ?  U : 0;
    const rightLegDY = frameIdx === 1 ?  U : frameIdx === 3 ? -U : 0;

    // ── 1. Ground shadow ──────────────────────────────────────────────
    c.globalAlpha = 0.22;
    c.fillStyle = '#000000';
    c.fillRect(cx - Math.floor(PSZ*0.20), Math.floor(PSZ*0.84), Math.floor(PSZ*0.40), Math.max(1, Math.floor(PSZ*0.05)));
    c.globalAlpha = 1;

    // ── 2. Cloak (behind body — drawn before legs and torso) ──────────
    // Flares slightly wider than shoulders to give a silhouette fringe.
    const cloakFlare = Math.max(U*2, Math.floor(PSZ * 0.10));
    const cloakTopY  = bodyY + Math.floor(bodyH * 0.35);
    const cloakBotY  = legTopY + legH + U;
    const cloakX     = bodyX - cloakFlare;
    const cloakW     = bodyW + cloakFlare * 2;
    c.fillStyle = P.cloak;
    c.fillRect(cloakX, cloakTopY, cloakW, cloakBotY - cloakTopY);
    // 1px slightly lighter edge on each visible cloak side
    c.fillStyle = P.cloakEdge;
    c.fillRect(cloakX,              cloakTopY, 1, cloakBotY - cloakTopY);
    c.fillRect(cloakX + cloakW - 1, cloakTopY, 1, cloakBotY - cloakTopY);

    // ── 3. Legs ───────────────────────────────────────────────────────
    if (facing === 'left' || facing === 'right') {
        c.fillStyle = P.legs;
        c.fillRect(bodyX + U, legTopY, bodyW - U*2, legH);
        c.fillStyle = P.boots;
        c.fillRect(bodyX + U, legTopY + legH - U, bodyW - U*2, U);
    } else {
        c.fillStyle = P.legs;
        c.fillRect(leftLegX,  legTopY + leftLegDY,  legW, legH);
        c.fillRect(rightLegX, legTopY + rightLegDY, legW, legH);
        c.fillStyle = P.boots;
        c.fillRect(leftLegX,  legTopY + leftLegDY  + legH - U, legW, U);
        c.fillRect(rightLegX, legTopY + rightLegDY + legH - U, legW, U);
    }

    // ── 4. Silhouette outline (drawn before body/head fills) ──────────
    // Head outline: 4-side dark border
    c.fillStyle = _CHAR_OUTLINE;
    c.fillRect(headX,         headY - 1, headW,          1); // top
    c.fillRect(headX - 1,     headY,     1,               headH); // left
    c.fillRect(headX + headW, headY,     1,               headH); // right
    // Body/shoulder left+right sides, feet bottom
    c.fillRect(bodyX - sW - 1, bodyY,        1, bodyH + legH + 1); // left
    c.fillRect(bodyX + bodyW + sW, bodyY,    1, bodyH + legH + 1); // right
    c.fillRect(bodyX - sW - 1, legTopY + legH, bodyW + sW*2 + 2, 1); // feet bottom

    // ── 5. Body + shoulders ───────────────────────────────────────────
    c.fillStyle = P.armor;
    c.fillRect(bodyX, bodyY, bodyW, bodyH);
    // Shoulders (slightly darker — they face sideways, less direct light)
    c.fillStyle = P.armorSh;
    c.fillRect(bodyX - sW, bodyY + U,    sW, Math.floor(bodyH * 0.55));
    c.fillRect(bodyX + bodyW, bodyY + U, sW, Math.floor(bodyH * 0.55));
    // Collar accent strip
    c.fillStyle = P.collar;
    c.fillRect(bodyX + U, bodyY + U, bodyW - U*2, U);
    // Body bevel: top-left bright, bottom-right dark (consistent light source)
    c.fillStyle = P.armorHi;
    c.fillRect(bodyX, bodyY, bodyW, 1);     // top highlight
    c.fillRect(bodyX, bodyY, 1, bodyH);     // left highlight
    c.fillStyle = P.armorSh;
    c.fillRect(bodyX, bodyY + bodyH - 1, bodyW, 1); // bottom shadow
    c.fillRect(bodyX + bodyW - 1, bodyY, 1, bodyH); // right shadow

    // ── 6. Head fill (pixel-art rounded rect — corners cut by 1px) ───
    c.fillStyle = _CHAR_SKIN;
    c.fillRect(headX + 1, headY,     headW - 2, headH); // narrow top/bottom
    c.fillRect(headX,     headY + 1, headW,     headH - 2); // full-width middle

    // ── 7. Head shading (top-left light source, matching body) ────────
    c.fillStyle = _CHAR_SKIN_HI;
    c.fillRect(headX + 1, headY,     headW - 2, 1); // top highlight strip
    c.fillRect(headX,     headY + 1, 1, headH - 2); // left highlight strip
    c.fillStyle = _CHAR_SKIN_SH;
    c.fillRect(headX + 1, headY + headH - 1, headW - 2, 1); // bottom shadow
    c.fillRect(headX + headW - 1, headY + 1, 1, headH - 2); // right shadow

    // ── 8. Hair and face detail (direction-dependent) ─────────────────
    const hairH = Math.max(U, Math.floor(headH * 0.42));
    const sideH = Math.floor(headH * 0.25);
    const eyeY  = headCY + Math.floor(headH * 0.05);

    if (facing === 'up') {
        // Back of head — full hair coverage, no face
        c.fillStyle = _CHAR_HAIR;
        c.fillRect(headX + 1, headY,     headW - 2, headH);
        c.fillRect(headX,     headY + 1, headW,     headH - 2);
    } else {
        // Hair band with top highlight row
        c.fillStyle = _CHAR_HAIR;
        c.fillRect(headX + 1, headY,     headW - 2, hairH);
        c.fillRect(headX,     headY + 1, headW,     hairH - 1);
        c.fillStyle = _CHAR_HAIR_HI;
        c.fillRect(headX + 1, headY, headW - 2, 1); // top highlight row
        // Sideburns
        c.fillStyle = _CHAR_HAIR;
        c.fillRect(headX,             headY + hairH, 1, sideH);
        c.fillRect(headX + headW - 1, headY + hairH, 1, sideH);

        if (facing === 'down') {
            // Eyes: hard-coded 2×2 whites, 1×1 pupils — 2px gap between eyes
            c.fillStyle = _CHAR_EYE_W;
            c.fillRect(cx - 4, eyeY, 2, 2); // left white
            c.fillRect(cx + 2, eyeY, 2, 2); // right white
            c.fillStyle = _CHAR_EYE_D;
            c.fillRect(cx - 3, eyeY + 1, 1, 1); // left pupil
            c.fillRect(cx + 2, eyeY + 1, 1, 1); // right pupil
            // Nose dot
            c.fillStyle = _CHAR_SKIN_SH;
            c.fillRect(cx, headCY + Math.floor(headH * 0.20), 1, 1);
            // Mouth hint (2×2)
            c.fillRect(cx - 1, headCY + Math.floor(headH * 0.35), 2, 2);
        } else if (facing === 'left') {
            c.fillStyle = _CHAR_EYE_W;
            c.fillRect(cx - 6, eyeY, 2, 2);
            c.fillStyle = _CHAR_EYE_D;
            c.fillRect(cx - 6, eyeY + 1, 1, 1); // pupil on inner edge
        } else { // right
            c.fillStyle = _CHAR_EYE_W;
            c.fillRect(cx + 4, eyeY, 2, 2);
            c.fillStyle = _CHAR_EYE_D;
            c.fillRect(cx + 5, eyeY + 1, 1, 1); // pupil on inner edge
        }
    }

    // ── 9. Helmet strip (top of head — over hair) ─────────────────────
    const helmH = Math.max(1, Math.floor(headH * 0.28));
    c.fillStyle = P.helmet;
    c.fillRect(headX + 1, headY, headW - 2, helmH); // corner-cut top row
    c.fillRect(headX,     headY + 1, headW, helmH - 1); // full width below
    c.fillStyle = P.helmetHi;
    c.fillRect(headX + 1, headY, headW - 2, 1); // single highlight row at very top

    _charCache.set(key, off);
    return off;
}

function _buildNPCFrame(npcId, facing, frameIdx) {
    const key = `${npcId}|${facing}|${frameIdx}`;
    if (_npcCache.has(key)) return _npcCache.get(key);

    const cfg = _NPC_CONFIGS[npcId];
    if (!cfg) return null;
    const P   = cfg.palette;
    const PSZ = NPC_SPRITE_SIZE; // 64 — authoring canvas; displayed scaled to TS×TS via drawImage

    const off = document.createElement('canvas');
    off.width = off.height = PSZ;
    const c = off.getContext('2d');
    c.imageSmoothingEnabled = false;

    const U   = Math.max(1, Math.floor(PSZ / 16));
    const cx  = Math.floor(PSZ / 2);
    const bob = (frameIdx === 1 || frameIdx === 3 || frameIdx === 5) ? -Math.max(1, Math.floor(PSZ / 32)) : 0;

    const headR  = Math.max(2, Math.floor(PSZ * 0.145));
    const headW  = headR * 2;
    const headH  = headR * 2;
    const headX  = cx - headR;
    const headCY = Math.floor(PSZ * 0.22) + bob;
    const headY  = headCY - headR;

    const bodyW  = Math.floor(PSZ * 0.44 * cfg.widthMul);
    const bodyH  = Math.floor(PSZ * 0.32);
    const bodyX  = cx - Math.floor(bodyW / 2);
    const bodyY  = Math.floor(PSZ * 0.40) + bob;
    const sW     = Math.max(U, Math.floor(PSZ * 0.08));

    const legW    = Math.max(1, Math.floor(PSZ * 0.12));
    const legH    = Math.floor(PSZ * 0.22);
    const legTopY = bodyY + bodyH - 1;
    const leftLegX  = bodyX + U;
    const rightLegX = bodyX + bodyW - U - legW;
    const leftLegDY  = frameIdx === 1 ? -U : frameIdx === 3 ?  U : 0;
    const rightLegDY = frameIdx === 1 ?  U : frameIdx === 3 ? -U : 0;

    // ── 1. Ground shadow ──────────────────────────────────────────────
    c.globalAlpha = 0.22;
    c.fillStyle = '#000000';
    c.fillRect(cx - Math.floor(PSZ*0.20), Math.floor(PSZ*0.84), Math.floor(PSZ*0.40), Math.max(1, Math.floor(PSZ*0.05)));
    c.globalAlpha = 1;

    // ── 2. Cloak ──────────────────────────────────────────────────────
    const cloakFlare = Math.max(U*2, Math.floor(PSZ * 0.10));
    const cloakTopY  = bodyY + Math.floor(bodyH * 0.35);
    const cloakBotY  = legTopY + legH + U;
    const cloakX     = bodyX - cloakFlare;
    const cloakW     = bodyW + cloakFlare * 2;
    c.fillStyle = P.cloak;
    c.fillRect(cloakX, cloakTopY, cloakW, cloakBotY - cloakTopY);
    // Outer edge strips
    c.fillStyle = P.cloakEdge;
    c.fillRect(cloakX,              cloakTopY, 1, cloakBotY - cloakTopY);
    c.fillRect(cloakX + cloakW - 1, cloakTopY, 1, cloakBotY - cloakTopY);
    // Inner lining strips — lighter than base, suggests fabric interior
    c.fillStyle = P.cloakLining;
    c.fillRect(cloakX + 1,              cloakTopY, 1, cloakBotY - cloakTopY);
    c.fillRect(cloakX + cloakW - 2,     cloakTopY, 1, cloakBotY - cloakTopY);
    // Fold lines — two vertical crease marks suggesting drape
    const fold1X = cloakX + Math.floor(cloakW * 0.30);
    const fold2X = cloakX + Math.floor(cloakW * 0.70);
    c.fillStyle = P.cloakFold;
    c.fillRect(fold1X, cloakTopY + 2, 1, cloakBotY - cloakTopY - 4);
    c.fillRect(fold2X, cloakTopY + 2, 1, cloakBotY - cloakTopY - 4);

    // ── 3. Legs ───────────────────────────────────────────────────────
    if (facing === 'left' || facing === 'right') {
        c.fillStyle = P.legs;
        c.fillRect(bodyX + U, legTopY, bodyW - U*2, legH);
        c.fillStyle = P.boots;
        c.fillRect(bodyX + U, legTopY + legH - U, bodyW - U*2, U);
        c.fillStyle = P.bootSole;
        c.fillRect(bodyX + U, legTopY + legH, bodyW - U*2, 1);
    } else {
        c.fillStyle = P.legs;
        c.fillRect(leftLegX,  legTopY + leftLegDY,  legW, legH);
        c.fillRect(rightLegX, legTopY + rightLegDY, legW, legH);
        c.fillStyle = P.boots;
        c.fillRect(leftLegX,  legTopY + leftLegDY  + legH - U, legW, U);
        c.fillRect(rightLegX, legTopY + rightLegDY + legH - U, legW, U);
        c.fillStyle = P.bootSole;
        c.fillRect(leftLegX,  legTopY + leftLegDY  + legH, legW, 1);
        c.fillRect(rightLegX, legTopY + rightLegDY + legH, legW, 1);
    }

    // ── 4. Silhouette outline ─────────────────────────────────────────
    c.fillStyle = _CHAR_OUTLINE;
    c.fillRect(headX,             headY - 1, headW,          1);
    c.fillRect(headX - 1,         headY,     1,               headH);
    c.fillRect(headX + headW,     headY,     1,               headH);
    c.fillRect(bodyX - sW - 1,    bodyY,     1, bodyH + legH + 1);
    c.fillRect(bodyX + bodyW + sW, bodyY,    1, bodyH + legH + 1);
    c.fillRect(bodyX - sW - 1, legTopY + legH, bodyW + sW*2 + 2, 1);

    // ── 4a. Elf ears (before head fill) ──────────────────────────────
    if (cfg.elfEars) {
        c.fillStyle = cfg.skin;
        c.fillRect(headX,             headY - 1, 1, 2); // left ear nub
        c.fillRect(headX + headW - 1, headY - 1, 1, 2); // right ear nub
    }

    // ── 5. Body + shoulders ───────────────────────────────────────────
    c.fillStyle = P.armor;
    c.fillRect(bodyX, bodyY, bodyW, bodyH);
    c.fillStyle = P.armorSh;
    c.fillRect(bodyX - sW, bodyY + U,    sW, Math.floor(bodyH * 0.55));
    c.fillRect(bodyX + bodyW, bodyY + U, sW, Math.floor(bodyH * 0.55));
    c.fillStyle = P.collar;
    c.fillRect(bodyX + U, bodyY + U, bodyW - U*2, U);
    // Bevel: top-left bright, bottom-right dark
    c.fillStyle = P.armorHi;
    c.fillRect(bodyX, bodyY, bodyW, 1);
    c.fillRect(bodyX, bodyY, 1, bodyH);
    c.fillStyle = P.armorSh;
    c.fillRect(bodyX, bodyY + bodyH - 1, bodyW, 1);
    c.fillRect(bodyX + bodyW - 1, bodyY, 1, bodyH);
    // Belt + buckle
    const beltY = bodyY + bodyH - 4;
    c.fillStyle = P.belt;
    c.fillRect(bodyX, beltY, bodyW, 1);
    c.fillStyle = P.buckle;
    c.fillRect(cx - 1, beltY, 2, 2);

    // ── 6. Head fill ──────────────────────────────────────────────────
    c.fillStyle = cfg.skin;
    c.fillRect(headX + 1, headY,     headW - 2, headH);
    c.fillRect(headX,     headY + 1, headW,     headH - 2);

    // ── 7. Head shading ───────────────────────────────────────────────
    c.fillStyle = cfg.skinHi;
    c.fillRect(headX + 1, headY,     headW - 2, 1);
    c.fillRect(headX,     headY + 1, 1, headH - 2);
    c.fillStyle = cfg.skinSh;
    c.fillRect(headX + 1, headY + headH - 1, headW - 2, 1);
    c.fillRect(headX + headW - 1, headY + 1, 1, headH - 2);

    // ── 8. Hair and face detail ───────────────────────────────────────
    const hairH = Math.max(U, Math.floor(headH * 0.42));
    const sideH = Math.floor(headH * 0.25);
    const eyeY  = headCY + Math.floor(headH * 0.05);

    if (facing === 'up') {
        c.fillStyle = cfg.hair;
        c.fillRect(headX + 1, headY,     headW - 2, headH);
        c.fillRect(headX,     headY + 1, headW,     headH - 2);
    } else {
        // Hair band with top highlight row
        c.fillStyle = cfg.hair;
        c.fillRect(headX + 1, headY,     headW - 2, hairH);
        c.fillRect(headX,     headY + 1, headW,     hairH - 1);
        c.fillStyle = _CHAR_HAIR_HI;
        c.fillRect(headX + 1, headY, headW - 2, 1); // top highlight row
        // Sideburns
        c.fillStyle = cfg.hair;
        c.fillRect(headX,             headY + hairH, 1, sideH);
        c.fillRect(headX + headW - 1, headY + hairH, 1, sideH);

        if (facing === 'down') {
            // Eyes: hard-coded 2×2 whites, 1×1 pupils — no U-derived eyeSize
            c.fillStyle = _CHAR_EYE_W;
            c.fillRect(cx - 4, eyeY, 2, 2); // left white
            c.fillRect(cx + 2, eyeY, 2, 2); // right white
            c.fillStyle = _CHAR_EYE_D;
            c.fillRect(cx - 3, eyeY + 1, 1, 1); // left pupil (bottom-right of white)
            c.fillRect(cx + 2, eyeY + 1, 1, 1); // right pupil (bottom-left of white)
            // Nose dot
            c.fillStyle = cfg.skinSh;
            c.fillRect(cx, headCY + Math.floor(headH * 0.20), 1, 1);
            // Mouth hint (2×2)
            c.fillRect(cx - 1, headCY + Math.floor(headH * 0.35), 2, 2);
        } else if (facing === 'left') {
            c.fillStyle = _CHAR_EYE_W;
            c.fillRect(cx - 6, eyeY, 2, 2);
            c.fillStyle = _CHAR_EYE_D;
            c.fillRect(cx - 6, eyeY + 1, 1, 1); // pupil on inner edge
        } else { // right
            c.fillStyle = _CHAR_EYE_W;
            c.fillRect(cx + 4, eyeY, 2, 2);
            c.fillStyle = _CHAR_EYE_D;
            c.fillRect(cx + 5, eyeY + 1, 1, 1); // pupil on inner edge
        }
    }

    // ── 9. Helmet / headwear ──────────────────────────────────────────
    if (!cfg.bareHead) {
        const helmH = Math.max(1, Math.floor(headH * 0.28));
        c.fillStyle = P.helmet;
        c.fillRect(headX + 1, headY, headW - 2, helmH);
        c.fillRect(headX,     headY + 1, headW, helmH - 1);
        c.fillStyle = P.helmetHi;
        c.fillRect(headX + 1, headY, headW - 2, 1);
    }

    // ── 10. Accessories ───────────────────────────────────────────────
    if (cfg.accessory === 'staff') {
        // Tall walking staff to the right of body
        c.fillStyle = _NPC_WOOD;
        c.fillRect(bodyX + bodyW + sW + 2, bodyY - headH, 2, bodyH + legH + headH + U);
    } else if (cfg.accessory === 'hammer') {
        // Short-handle hammer to the right
        const hHandleX = bodyX + bodyW + sW + 2;
        const hHandleY = bodyY + Math.floor(bodyH * 0.30);
        c.fillStyle = _NPC_WOOD;
        c.fillRect(hHandleX, hHandleY, 2, Math.floor(bodyH * 0.70) + legH);
        c.fillStyle = _NPC_METAL;
        c.fillRect(hHandleX - 2, hHandleY - U, 6, U * 2);
        c.fillStyle = _NPC_METAL_HI;
        c.fillRect(hHandleX - 2, hHandleY - U, 6, 1); // top highlight
        c.fillStyle = _NPC_METAL_SH;
        c.fillRect(hHandleX - 2, hHandleY - U + U*2 - 1, 6, 1); // bottom shadow
    } else if (cfg.accessory === 'satchel') {
        // Small leather pouch at right hip
        const spX = bodyX + bodyW + 2;
        const spY = legTopY - U;
        c.fillStyle = _NPC_WOOD;          // leather brown
        c.fillRect(spX, spY, 4, 5);
        c.fillStyle = _NPC_METAL_SH;      // strap shadow line
        c.fillRect(spX, spY, 4, 1);
    } else if (cfg.accessory === 'scroll') {
        // Rolled scroll at left hip
        const scX = bodyX - 5;
        const scY = legTopY;
        c.fillStyle = _NPC_PARCHMENT;
        c.fillRect(scX, scY, 3, 8);
        c.fillStyle = _NPC_WOOD;           // end caps
        c.fillRect(scX, scY,     3, 1);
        c.fillRect(scX, scY + 7, 3, 1);
    }

    _npcCache.set(key, off);
    return off;
}

function drawCharacter(sx, sy, color, facing, name, isPlayer, isNear, ghost, walkPhase=0, isMoving=false, npcId=null) {
    const cx=sx+TS/2, cy=sy+TS/2, r=TS*.28, t=timeMs/1000;

    // Player (non-ghost): pixel art sprite blitted from cache
    if (isPlayer && !ghost) {
        let frameIdx;
        if (isMoving) {
            frameIdx = Math.floor(Math.abs(walkPhase)) % 4;
        } else {
            frameIdx = 4 + (Math.floor(timeMs / 166) % 2);
        }
        const frame = _buildCharFrame(gs.charClass || 'Warrior', facing, frameIdx);
        ctx.drawImage(frame, Math.round(sx), Math.round(sy), TS, TS);
        const hasWeapon = gs.inventory.some(i => i.questComplete === 'quest_weapon_complete');
        if (hasWeapon) drawWeapon(cx, cy, r, facing);
        return;
    }

    // NPCs: pixel art sprite blitted from cache
    if (npcId) {
        const cfg = _NPC_CONFIGS[npcId];
        if (cfg) {
            const frameIdx = Math.floor(timeMs / 500) % 6;
            const frame = _buildNPCFrame(npcId, facing, frameIdx);
            if (frame) {
                const idleBob = Math.round(Math.sin(t * 1.1 + cx * 0.031) * 1.4);
                ctx.save();
                if (ghost || cfg.ghost) {
                    ctx.globalAlpha = 0.55 + 0.15 * Math.sin(t * 2.2);
                    ctx.shadowColor = '#80b0ff';
                    ctx.shadowBlur = 18;
                }
                ctx.drawImage(frame, Math.round(sx), Math.round(sy) + idleBob, TS, TS);
                ctx.shadowBlur = 0;
                ctx.restore();
                ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
                const nw = ctx.measureText(name).width;
                ctx.fillStyle = 'rgba(0,0,0,0.72)';
                ctx.fillRect(cx - nw/2 - 4, sy - 23, nw + 8, 15);
                ctx.fillStyle = (ghost || cfg.ghost) ? '#b0d0ff' : '#e8d0b0';
                ctx.textBaseline = 'top';
                ctx.fillText(name, cx, sy - 22);
                if (isNear) {
                    ctx.fillStyle = '#ffe040';
                    ctx.font = `bold ${Math.max(14, TS * 0.32)}px sans-serif`;
                    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
                    ctx.fillText('!', cx, sy - 2 + Math.sin(timeMs / 280) * 3);
                }
                return;
            }
        }
    }
}

function drawWeapon(cx, cy, r, facing) {
    const [dx,dy]=_CHAR_DIRS[facing]||_CHAR_DIRS.down;
    const [px2,py2]=[-dy,dx]; // perpendicular
    const charClass=gs.charClass||'Warrior';
    const t=timeMs/1000;
    if (charClass==='Warrior') {
        // sword blade
        ctx.strokeStyle='#c8d0d8'; ctx.lineWidth=3;
        ctx.beginPath(); ctx.moveTo(cx+dx*r*1.1,cy+dy*r*1.1);
        ctx.lineTo(cx+dx*(r*1.1+TS*.27),cy+dy*(r*1.1+TS*.27)); ctx.stroke();
        ctx.strokeStyle='#e8eef4'; ctx.lineWidth=1;
        ctx.beginPath(); ctx.moveTo(cx+dx*r*1.2,cy+dy*r*1.2);
        ctx.lineTo(cx+dx*(r*1.2+TS*.23),cy+dy*(r*1.2+TS*.23)); ctx.stroke();
        // guard
        const gx=cx+dx*r*1.1, gy=cy+dy*r*1.1;
        ctx.strokeStyle='#c8922a'; ctx.lineWidth=3.5;
        ctx.beginPath(); ctx.moveTo(gx-px2*TS*.10,gy-py2*TS*.10);
        ctx.lineTo(gx+px2*TS*.10,gy+py2*TS*.10); ctx.stroke();
    } else if (charClass==='Rogue') {
        [-1,1].forEach(side => {
            const ax=cx+dx*r*1.1+px2*r*.55*side, ay=cy+dy*r*1.1+py2*r*.55*side;
            ctx.strokeStyle='#b8c0c8'; ctx.lineWidth=2;
            ctx.beginPath(); ctx.moveTo(ax,ay); ctx.lineTo(ax+dx*TS*.16,ay+dy*TS*.16); ctx.stroke();
            ctx.strokeStyle='#9a40d0'; ctx.lineWidth=2.5;
            ctx.beginPath(); ctx.moveTo(ax-px2*TS*.04,ay-py2*TS*.04);
            ctx.lineTo(ax+px2*TS*.04,ay+py2*TS*.04); ctx.stroke();
        });
    } else if (charClass==='Wizard') {
        const sx2=cx+px2*r*.85, sy2=cy+py2*r*.85;
        ctx.strokeStyle='#7a4818'; ctx.lineWidth=2.5;
        ctx.beginPath(); ctx.moveTo(sx2-dx*TS*.18,sy2-dy*TS*.18);
        ctx.lineTo(sx2+dx*TS*.18,sy2+dy*TS*.18); ctx.stroke();
        ctx.shadowColor='#6090ff'; ctx.shadowBlur=10;
        ctx.fillStyle=`rgba(80,130,255,${0.6+0.3*Math.sin(t*3)})`;
        ctx.beginPath(); ctx.arc(sx2+dx*TS*.18,sy2+dy*TS*.18,TS*.055,0,Math.PI*2); ctx.fill();
        ctx.shadowBlur=0;
    } else if (charClass==='Cleric') {
        const hx2=cx+dx*r*1.55, hy2=cy+dy*r*1.55;
        ctx.shadowColor='#ffff80'; ctx.shadowBlur=8;
        ctx.strokeStyle='#e0d840'; ctx.lineWidth=3;
        ctx.beginPath(); ctx.moveTo(hx2-dx*TS*.10,hy2-dy*TS*.10);
        ctx.lineTo(hx2+dx*TS*.10,hy2+dy*TS*.10); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(hx2-px2*TS*.07,hy2-py2*TS*.07);
        ctx.lineTo(hx2+px2*TS*.07,hy2+py2*TS*.07); ctx.stroke();
        ctx.shadowBlur=0;
    }
}

// ── Chest sprite cache ─────────────────────────────────────────────────
const _chestCache  = new Map();
let   _chestCacheTS = 0;

function _buildChestFrame(isOpen) {
    if (_chestCacheTS !== TS) { _chestCache.clear(); _chestCacheTS = TS; }
    const key = isOpen ? 'open' : 'closed';
    if (_chestCache.has(key)) return _chestCache.get(key);

    const off = document.createElement('canvas');
    off.width = off.height = TS;
    const c = off.getContext('2d');
    c.imageSmoothingEnabled = false;

    const U   = Math.max(1, Math.floor(TS / 16));
    const mid = Math.floor(TS / 2);

    // Drop shadow
    c.globalAlpha = 0.35;
    c.fillStyle = '#0a0806';
    c.beginPath();
    c.ellipse(mid, mid + U * 5, U * 4, U, 0, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = 1;

    if (!isOpen) {
        // Outline behind everything
        c.fillStyle = '#1a0c00';
        c.fillRect(U,      U * 2, U * 14, U * 7);   // lid outline
        c.fillRect(U,      U * 9, U * 14, U * 5);   // body outline
        // Lid top face
        c.fillStyle = '#6a3c10';
        c.fillRect(U * 2,  U * 3, U * 12, U * 4);
        c.fillStyle = '#8a5828';
        c.fillRect(U * 2,  U * 3, U * 12, U);       // highlight strip
        // Lid front face
        c.fillStyle = '#4a2a08';
        c.fillRect(U * 2,  U * 7, U * 12, U * 2);
        // Body face
        c.fillStyle = '#7a4820';
        c.fillRect(U * 2,  U * 9, U * 12, U * 5);
        c.fillStyle = '#5a3010';
        c.fillRect(U * 2,  U * 12, U * 12, U * 2);  // lower shadow
        // Metal bands
        c.fillStyle = '#686868';
        c.fillRect(U * 2,  U * 8,  U * 12, U);
        c.fillRect(U * 2,  U * 11, U * 12, U);
        c.fillStyle = '#b0b0b0';
        c.fillRect(U * 2,  U * 8,  U * 12, Math.max(1, Math.floor(U * 0.5)));
        // Gold latch
        c.fillStyle = '#7a5800';
        c.fillRect(mid - U, U * 8, U * 2, U * 3);
        c.fillStyle = '#ffc020';
        c.fillRect(mid - Math.floor(U * 0.5), U * 8 + Math.floor(U * 0.5), U, U * 2);
    } else {
        // Open lid thrown back (thin strip at top)
        c.fillStyle = '#1a0c00';
        c.fillRect(U,     U * 2, U * 14, U * 3);
        c.fillStyle = '#4a2a08';
        c.fillRect(U * 2, U * 2, U * 12, U * 2);
        c.fillStyle = '#6a3c10';
        c.fillRect(U * 2, U * 2, U * 12, U);
        // Body outline
        c.fillStyle = '#1a0c00';
        c.fillRect(U,     U * 5, U * 14, U * 9);
        // Interior dark void
        c.fillStyle = '#0a0604';
        c.fillRect(U * 2, U * 5, U * 12, U * 4);
        // Gold glint inside
        c.globalAlpha = 0.65;
        c.fillStyle = '#c08000';
        c.fillRect(mid - U * 3, U * 5, U * 6, U * 2);
        c.globalAlpha = 1;
        c.fillStyle = '#ffe060';
        c.fillRect(mid - U,    U * 5, U * 2, U);
        // Body face
        c.fillStyle = '#7a4820';
        c.fillRect(U * 2, U * 9,  U * 12, U * 4);
        c.fillStyle = '#5a3010';
        c.fillRect(U * 2, U * 12, U * 12, U);
        // Metal band
        c.fillStyle = '#686868';
        c.fillRect(U * 2, U * 11, U * 12, U);
        c.fillStyle = '#b0b0b0';
        c.fillRect(U * 2, U * 11, U * 12, Math.max(1, Math.floor(U * 0.5)));
    }

    _chestCache.set(key, off);
    return off;
}

function drawAmbientBubbles() {
    if (!currentMap.npcs) return;
    for (const npc of currentMap.npcs) {
        const s = npc._amb;
        if (!s || s.alpha <= 0 || !s.text) continue;
        const sx = Math.round(npc.x * TS - cam.x);
        const sy = Math.round(npc.y * TS - cam.y);
        if (sx < -TS * 3 || sx > cW + TS * 3 || sy < -TS * 3 || sy > cH + TS * 3) continue;
        _drawSpeechBubble(sx + TS / 2, sy, s.text, s.alpha);
    }
}

function _drawSpeechBubble(cx, sy, text, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    const fontSize = Math.max(10, Math.round(TS * 0.22));
    ctx.font = `italic ${fontSize}px sans-serif`;
    const textW  = Math.min(ctx.measureText(text).width, 220);
    const padX   = 8, padY = 5;
    const bw     = textW + padX * 2;
    const bh     = fontSize + padY * 2;
    const tipH   = 6;
    const bx     = cx - bw / 2;
    // Bottom of bubble body sits 30px above the NPC name label (sy-23)
    const bodyBottom = sy - 30;
    const bodyTop    = bodyBottom - bh;
    const r = 4;

    ctx.fillStyle   = 'rgba(8,4,2,0.90)';
    ctx.strokeStyle = 'rgba(90,58,24,0.75)';
    ctx.lineWidth   = 1;

    ctx.beginPath();
    ctx.moveTo(bx + r, bodyTop);
    ctx.lineTo(bx + bw - r, bodyTop);
    ctx.quadraticCurveTo(bx + bw, bodyTop, bx + bw, bodyTop + r);
    ctx.lineTo(bx + bw, bodyBottom - r);
    ctx.quadraticCurveTo(bx + bw, bodyBottom, bx + bw - r, bodyBottom);
    ctx.lineTo(cx + 5, bodyBottom);
    ctx.lineTo(cx, bodyBottom + tipH);
    ctx.lineTo(cx - 5, bodyBottom);
    ctx.lineTo(bx + r, bodyBottom);
    ctx.quadraticCurveTo(bx, bodyBottom, bx, bodyBottom - r);
    ctx.lineTo(bx, bodyTop + r);
    ctx.quadraticCurveTo(bx, bodyTop, bx + r, bodyTop);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle   = '#c8b890';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, bodyTop + bh / 2, 220);
    ctx.restore();
}

function drawItem(item, sx, sy) {
    const bob = Math.sin(timeMs * 0.002 + sx * 0.08) * 3;
    const isOpen = Math.abs(player.x - item.x) <= 1 && Math.abs(player.y - item.y) <= 1;
    const frame  = _buildChestFrame(isOpen);
    const ix     = Math.round(sx);
    const iy     = Math.round(sy + bob);

    // Glow halo around chest
    ctx.save();
    ctx.shadowColor = isOpen ? '#ffd060' : '#c08020';
    ctx.shadowBlur  = isOpen ? 18 : 10;
    ctx.drawImage(frame, ix, iy);
    ctx.restore();
    ctx.shadowBlur  = 0;
    ctx.shadowColor = 'transparent';

    // Name label
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.shadowColor = '#c08020';
    ctx.shadowBlur  = 5;
    ctx.fillStyle   = '#f0e0c0';
    ctx.fillText(item.name, ix + TS / 2, iy - 3);
    ctx.shadowBlur  = 0;
    ctx.shadowColor = 'transparent';
}

// ═══════════════════════════════════════════════════════
//  DYNAMIC LIGHTING
// ═══════════════════════════════════════════════════════
let lightCanvas = null, lightCtx2 = null;
const _torchBuf = []; // reusable flat array [lx,ly,tx,ty,...] — avoids per-frame allocation

// Scanlines overlay — pre-rendered once at startup/resize, blitted each frame
let _scanlinesCanvas = null;
function _buildScanlinesCanvas() {
    _scanlinesCanvas = document.createElement('canvas');
    _scanlinesCanvas.width  = cW;
    _scanlinesCanvas.height = cH;
    const sc = _scanlinesCanvas.getContext('2d');
    sc.fillStyle = 'rgba(0,0,0,0.08)';
    for (let y = 0; y < cH; y += 4) sc.fillRect(0, y, cW, 2);
}

// Pre-rendered light disc canvases — rebuilt when TS changes, not per-frame
let _torchPunchDisc = null, _torchWarmDisc = null, _playerPunchDisc = null;
let _discTS = 0;
function _buildLightDiscs() {
    if (_discTS === TS) return;
    _discTS = TS;

    // Torch punch disc (destination-out): white radial, radius = TS*7
    const pr = Math.ceil(TS * 7), pd = pr * 2;
    _torchPunchDisc = document.createElement('canvas');
    _torchPunchDisc.width = _torchPunchDisc.height = pd;
    const pc = _torchPunchDisc.getContext('2d');
    const pg = pc.createRadialGradient(pr,pr,0,pr,pr,pr);
    pg.addColorStop(0,   'rgba(255,255,255,1)');
    pg.addColorStop(0.45,'rgba(255,255,255,0.55)');
    pg.addColorStop(0.8, 'rgba(255,255,255,0.18)');
    pg.addColorStop(1,   'rgba(0,0,0,0)');
    pc.fillStyle = pg; pc.beginPath(); pc.arc(pr,pr,pr,0,Math.PI*2); pc.fill();

    // Torch warm disc (screen blend): orange/red radial, radius = TS*6
    const wr = Math.ceil(TS * 6), wd = wr * 2;
    _torchWarmDisc = document.createElement('canvas');
    _torchWarmDisc.width = _torchWarmDisc.height = wd;
    const wc = _torchWarmDisc.getContext('2d');
    const wg = wc.createRadialGradient(wr,wr,0,wr,wr,wr);
    wg.addColorStop(0,    'rgba(255,155,35,1)');
    wg.addColorStop(0.35, 'rgba(220,85,10,0.54)');
    wg.addColorStop(0.70, 'rgba(160,40,0,0.19)');
    wg.addColorStop(1,    'rgba(0,0,0,0)');
    wc.fillStyle = wg; wc.beginPath(); wc.arc(wr,wr,wr,0,Math.PI*2); wc.fill();

    // Player ambient glow disc (destination-out): radius = TS*2.5
    const xr = Math.ceil(TS * 2.5), xd = xr * 2;
    _playerPunchDisc = document.createElement('canvas');
    _playerPunchDisc.width = _playerPunchDisc.height = xd;
    const xc = _playerPunchDisc.getContext('2d');
    const xg = xc.createRadialGradient(xr,xr,0,xr,xr,xr);
    xg.addColorStop(0,   'rgba(255,255,255,0.52)');
    xg.addColorStop(0.45,'rgba(255,255,255,0.29)');
    xg.addColorStop(0.8, 'rgba(255,255,255,0.09)');
    xg.addColorStop(1,   'rgba(0,0,0,0)');
    xc.fillStyle = xg; xc.beginPath(); xc.arc(xr,xr,xr,0,Math.PI*2); xc.fill();
}

function ensureLightCanvas() {
    if (!lightCanvas||lightCanvas.width!==cW||lightCanvas.height!==cH) {
        lightCanvas=document.createElement('canvas');
        lightCanvas.width=cW; lightCanvas.height=cH;
        lightCtx2=lightCanvas.getContext('2d');
    }
    _buildLightDiscs();
}

function renderWorldEventOverlays() {
    const activeEvents = Game.gs.activeWorldEvents;
    if (!activeEvents?.length && !Game._sealPulseEnd && !Game._torchDimEnd) return;
    const tMs = timeMs;

    // darkness_spreads: persistent mine entrance tint (village map only)
    if (activeEvents?.includes('darkness_spreads') && currentMap.id === 'village') {
        ctx.save();
        ctx.fillStyle = 'rgba(20, 0, 30, 0.15)';
        ctx.fillRect(Math.round(21 * TS - cam.x), Math.round(34 * TS - cam.y), TS * 2, TS);
        ctx.restore();
    }

    // seal_weakening: one-time cold pulse on mine entrance (village map)
    if (Game._sealPulseEnd && tMs < Game._sealPulseEnd && currentMap.id === 'village') {
        const progress = 1 - (Game._sealPulseEnd - tMs) / 2000;
        const alpha = 0.3 * Math.sin(progress * Math.PI);
        if (alpha > 0.001) {
            ctx.save();
            ctx.fillStyle = `rgba(150, 200, 255, ${alpha})`;
            ctx.fillRect(Math.round(21 * TS - cam.x), Math.round(34 * TS - cam.y), TS * 2, TS);
            ctx.restore();
        }
    } else if (Game._sealPulseEnd && tMs >= Game._sealPulseEnd) {
        Game._sealPulseEnd = 0;
    }

    // seal_weakening: dungeon shimmer (dark maps only)
    if (activeEvents?.includes('seal_weakening') && currentMap.dark) {
        const alpha = 0.01 + 0.01 * Math.sin(tMs * 0.0002);
        ctx.save();
        ctx.fillStyle = `rgba(80, 120, 200, ${alpha})`;
        ctx.fillRect(0, 0, cW, cH);
        ctx.restore();
    }

    // village_alert: torch snuff (brief dim, village map)
    if (Game._torchDimEnd && tMs < Game._torchDimEnd && currentMap.id === 'village') {
        const alpha = 0.12 * ((Game._torchDimEnd - tMs) / 1500);
        ctx.save();
        ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
        ctx.fillRect(0, 0, cW, cH);
        ctx.restore();
    } else if (Game._torchDimEnd && tMs >= Game._torchDimEnd) {
        Game._torchDimEnd = 0;
    }
}

function renderLighting() {
    if (!currentMap.dark) return;
    ensureLightCanvas();
    const lc=lightCtx2, t=timeMs/1000, W=cW, H=cH;
    lc.clearRect(0,0,W,H);
    lc.fillStyle='rgba(0,0,20,0.82)'; lc.fillRect(0,0,W,H);
    lc.globalCompositeOperation='destination-out';

    // Player ambient glow — blit cached disc, no gradient creation
    const pr = _playerPunchDisc.width >> 1;
    const plx = Math.round(player.x*TS-cam.x+TS/2), ply = Math.round(player.y*TS-cam.y+TS/2);
    lc.drawImage(_playerPunchDisc, plx-pr, ply-pr);

    // Collect torch positions; blit cached punch disc per torch
    const stx=Math.max(0,Math.floor(cam.x/TS)-2), sty=Math.max(0,Math.floor(cam.y/TS)-2);
    const etx=Math.min(currentMap.w-1,Math.ceil((cam.x+W)/TS)+2);
    const ety=Math.min(currentMap.h-1,Math.ceil((cam.y+H)/TS)+2);
    _torchBuf.length = 0;
    const tr = _torchPunchDisc.width >> 1;
    for (let ty=sty;ty<=ety;ty++) for (let tx=stx;tx<=etx;tx++) {
        if (currentMap.tiles[ty][tx]===TILE.TORCH) {
            const lx=Math.round(tx*TS-cam.x+TS/2), ly=Math.round(ty*TS-cam.y+TS/2);
            // Flicker: modulate radius via globalAlpha ±12%
            const fl = 1 + 0.12*Math.sin(t*10.5+tx*2.7+ty*1.3);
            lc.globalAlpha = fl;
            lc.drawImage(_torchPunchDisc, lx-tr, ly-tr);
            lc.globalAlpha = 1;
            _torchBuf.push(lx, ly, tx, ty);
        }
    }
    lc.globalCompositeOperation='source-over';

    // Draw darkness layer onto scene
    ctx.drawImage(lightCanvas,0,0);

    // Warm color bleed — blit cached warm disc per torch with alpha-modulated flicker
    ctx.save(); ctx.globalCompositeOperation='screen';
    const wr = _torchWarmDisc.width >> 1;
    for (let i=0; i<_torchBuf.length; i+=4) {
        const lx=_torchBuf[i], ly=_torchBuf[i+1], tx=_torchBuf[i+2];
        const fl=0.13+0.05*Math.sin(t*10.5+tx*2.7);
        ctx.globalAlpha = fl * 2.4; // match original center alpha
        ctx.drawImage(_torchWarmDisc, lx-wr, ly-wr);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
}

// ═══════════════════════════════════════════════════════
//  ENEMY AI
// ═══════════════════════════════════════════════════════
// ── Pixel art enemy sprite cache ──────────────────────────────────────
const _enemyCache  = new Map();
let   _enemyCacheTS = 0;

function _buildEnemyFrame(type, frameIdx) {
    if (_enemyCacheTS !== TS) { _enemyCache.clear(); _enemyCacheTS = TS; }
    const key = `${type}|${frameIdx}`;
    if (_enemyCache.has(key)) { if (Game.DEV) _enemyCacheHits++; return _enemyCache.get(key); }
    if (Game.DEV) _enemyCacheMisses++;

    const off = document.createElement('canvas');
    off.width = off.height = TS;
    const c = off.getContext('2d');
    c.imageSmoothingEnabled = false;

    const U   = Math.max(1, Math.floor(TS / 16));
    const mid = Math.floor(TS / 2);
    const bob = frameIdx === 1 ? -U : 0;

    if (type === 'shade') {
        // Drop shadow beneath body
        c.globalAlpha = 0.40;
        c.fillStyle = '#150625';
        c.beginPath();
        c.ellipse(mid, mid + Math.floor(TS * 0.37), U * 4, U, 0, 0, Math.PI * 2);
        c.fill();
        c.globalAlpha = 1;

        const by = mid + bob;
        // Outer dark body
        c.fillStyle = '#1a0838';
        c.beginPath(); c.arc(mid, by, U * 5, 0, Math.PI * 2); c.fill();
        // Mid-tone layer
        c.fillStyle = '#2a0860';
        c.beginPath(); c.arc(mid, by - U, U * 4, 0, Math.PI * 2); c.fill();
        // Bright core
        c.fillStyle = '#3a1080';
        c.beginPath(); c.arc(mid, by - U, U * 3, 0, Math.PI * 2); c.fill();

        // Wispy tendrils
        c.fillStyle = '#1a0838';
        c.fillRect(mid - U * 5, by + U * 3,       U * 2, U * 3);
        c.fillRect(mid - U,     by + U * 3 + U,    U * 2, U * 2);
        c.fillRect(mid + U * 3, by + U * 3,        U * 2, U * 3);

        // Red eyes
        const eyeY = by - U;
        c.fillStyle = '#ff1020';
        c.beginPath(); c.arc(mid - U * 3, eyeY, U * 1.2, 0, Math.PI * 2); c.fill();
        c.beginPath(); c.arc(mid + U * 3, eyeY, U * 1.2, 0, Math.PI * 2); c.fill();
        // Bright eye specular
        c.fillStyle = '#ffaaaa';
        c.fillRect(mid - U * 3 - U, eyeY - U, U, U);
        c.fillRect(mid + U * 3 - U, eyeY - U, U, U);

    } else { // lurker
        // Drop shadow
        c.globalAlpha = 0.45;
        c.fillStyle = '#0a0806';
        c.beginPath();
        c.ellipse(mid, mid + Math.floor(TS * 0.38), U * 4, U, 0, 0, Math.PI * 2);
        c.fill();
        c.globalAlpha = 1;

        // Dark outline base
        c.fillStyle = '#2a1a10';
        c.beginPath(); c.ellipse(mid, mid + U, U * 5, U * 4, 0, 0, Math.PI * 2); c.fill();
        // Main brown body
        c.fillStyle = '#5a3820';
        c.beginPath(); c.ellipse(mid, mid, U * 4, U * 3, 0, 0, Math.PI * 2); c.fill();

        // Rocky highlight patches
        c.fillStyle = '#7a5030';
        c.fillRect(mid - U * 4, mid - U,     U * 2, U * 2);
        c.fillRect(mid + U * 2, mid,          U * 3, U * 2);
        c.fillRect(mid - U,     mid - U * 3,  U * 2, U * 2);
        // Dark crack lines
        c.fillStyle = '#1a0e08';
        c.fillRect(mid - U,     mid - U,      U, U * 3);
        c.fillRect(mid + U * 3, mid - U * 2,  U, U * 2);

        // Three orange eyes
        const eyeY = mid - U;
        c.fillStyle = '#cc5000';
        for (let i = -1; i <= 1; i++) {
            c.beginPath(); c.arc(mid + i * U * 3, eyeY, U * 1.2, 0, Math.PI * 2); c.fill();
        }
        c.fillStyle = '#ff9030';
        for (let i = -1; i <= 1; i++) {
            c.fillRect(mid + i * U * 3 - U, eyeY - U, U, U);
        }
    }

    _enemyCache.set(key, off);
    return off;
}

function drawEnemyOverworld(sx, sy, en) {
    const frameIdx = Math.floor(timeMs / 500) & 1;
    const frame    = _buildEnemyFrame(en.type, frameIdx);

    if (en.aggroed) {
        ctx.save();
        ctx.shadowColor = '#ff0000';
        ctx.shadowBlur  = 12 + 6 * Math.sin(timeMs * 0.006);
    }
    ctx.drawImage(frame, Math.round(sx), Math.round(sy));
    if (en.aggroed) {
        ctx.restore();
        ctx.shadowBlur  = 0;
        ctx.shadowColor = 'transparent';
    }

    // Hurt flash: red tint overlay
    if (en.hurtTimer > 0) {
        const tint = en.hurtTimer / 200;
        const ecx  = sx + TS / 2, ecy = sy + TS / 2;
        const _tintKey = Math.round(tint * 100);
        if (!_tintCache.has(_tintKey)) _tintCache.set(_tintKey, `rgba(255,80,80,${(_tintKey * 0.0055).toFixed(2)})`);
        ctx.fillStyle = _tintCache.get(_tintKey);
        ctx.beginPath(); ctx.arc(ecx, ecy, TS * 0.4, 0, Math.PI * 2); ctx.fill();
    }

    // HP bar
    const bw = TS * .8, bh = 5, bx = sx + TS * .1, by = sy - 10;
    ctx.fillStyle = '#400000'; ctx.fillRect(bx, by, bw, bh);
    const maxHp = ENEMY_DEFS[en.type].hp;
    ctx.fillStyle = en.hp / maxHp > .5 ? '#40d040' : en.hp / maxHp > .25 ? '#d0a000' : '#d02020';
    ctx.fillRect(bx, by, bw * (en.hp / maxHp), bh);
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(bx, by, bw, bh);
    ctx.lineWidth = 1;
}

// ═══════════════════════════════════════════════════════
//  MINIMAP
// ═══════════════════════════════════════════════════════
let _minimapEl = null, _minimapCtx = null;
let _minimapTileCache = null, _minimapMapId = null;
let _minimapDisplayState = null, _minimapFrameSkip = 0;
function _buildMinimapTiles(mW, mH) {
    _minimapTileCache = document.createElement('canvas');
    _minimapTileCache.width = mW; _minimapTileCache.height = mH;
    const mc = _minimapTileCache.getContext('2d');
    mc.imageSmoothingEnabled = false;
    const scaleX = mW / currentMap.w, scaleY = mH / currentMap.h;
    const dotW = Math.max(1, Math.ceil(scaleX)), dotH = Math.max(1, Math.ceil(scaleY));
    for (let ty = 0; ty < currentMap.h; ty++) {
        for (let tx = 0; tx < currentMap.w; tx++) {
            mc.fillStyle = MINIMAP_COLORS[currentMap.tiles[ty][tx]] || '#111';
            mc.fillRect(Math.round(tx * scaleX), Math.round(ty * scaleY), dotW, dotH);
        }
    }
    _minimapMapId = currentMap.id;
}
function renderMinimap() {
    if (!_minimapEl) {
        _minimapEl = document.getElementById('minimap-canvas');
        if (!_minimapEl) return;
        _minimapCtx = _minimapEl.getContext('2d');
        _minimapCtx.imageSmoothingEnabled = false;
    }
    // Cache display state — only write DOM when it changes
    const shouldShow = !_isBattleActive && !_isLoading;
    if (shouldShow !== _minimapDisplayState) {
        _minimapDisplayState = shouldShow;
        _minimapEl.style.display = shouldShow ? 'block' : 'none';
    }
    if (!shouldShow) return;

    // Throttle tile+entity redraw to ~12fps (every 5 frames)
    if (++_minimapFrameSkip % 5 !== 0) return;

    const mW = _minimapEl.width, mH = _minimapEl.height;
    // Rebuild tile layer only on map change
    if (!_minimapTileCache || _minimapMapId !== currentMap.id) _buildMinimapTiles(mW, mH);
    const scaleX = mW / currentMap.w, scaleY = mH / currentMap.h;
    _minimapCtx.clearRect(0, 0, mW, mH);
    _minimapCtx.drawImage(_minimapTileCache, 0, 0);
    // Player dot (white, 3×3)
    _minimapCtx.fillStyle = '#ffffff';
    _minimapCtx.fillRect(Math.round(player.x * scaleX) - 1, Math.round(player.y * scaleY) - 1, 3, 3);
    // Enemy dots (red)
    if (currentMap.enemies) {
        _minimapCtx.fillStyle = '#ff4040';
        for (const en of currentMap.enemies) {
            if (!en.alive) continue;
            _minimapCtx.fillRect(Math.round(en.x * scaleX), Math.round(en.y * scaleY), 2, 2);
        }
    }
}

// ═══════════════════════════════════════════════════════
//  RENDER
// ═══════════════════════════════════════════════════════
function render() {
    if (Game.DEV) {
        if (_enemyCacheTS !== 0 && _enemyCacheTS !== TS) console.error('[CacheAssert] _enemyCache TS mismatch: expected', TS, 'got', _enemyCacheTS);
        if (_chestCacheTS !== 0 && _chestCacheTS !== TS) console.error('[CacheAssert] _chestCache TS mismatch: expected', TS, 'got', _chestCacheTS);
    }

    // Pixel-perfect — smoothing must always be off on the main context
    ctx.imageSmoothingEnabled = false;

    ctx.clearRect(0, 0, cW, cH);

    // ── Static tile layer (bgCanvas cache) ────────────────
    // [Fix 1] _bgBuf matches BUF in rebuildBgCanvas (4 tiles).
    // Trigger fires at 75% of buffer so rebuild happens before the edge is reached,
    // eliminating the 1-frame seam that caused perimeter flicker.
    // Math.round on blit offset prevents sub-pixel jitter on tile edges.
    const _bgBuf = 4 * TS;
    if (!bgDirty && (Math.abs(cam.x - _bgCamX) >= _bgBuf * 0.75 || Math.abs(cam.y - _bgCamY) >= _bgBuf * 0.75)) bgDirty = true;
    if (bgDirty) rebuildBgCanvas();
    ctx.drawImage(bgCanvas, Math.round(_bgCamX - cam.x - _bgBuf), Math.round(_bgCamY - cam.y - _bgBuf));

    // ── Animated tile layer (water, stairs, torches) ──────
    drawAnimatedTiles();

    // ── Entities ──────────────────────────────────────────
    for (const item of currentMap.items) {
        if (!itemVisible(item)) continue;
        const sx=Math.round(item.x*TS-cam.x), sy=Math.round(item.y*TS-cam.y);
        if (sx>-TS&&sx<cW+TS&&sy>-TS&&sy<cH+TS) drawItem(item,sx,sy);
    }
    for (const npc of currentMap.npcs) {
        const sx=Math.round(npc.x*TS-cam.x), sy=Math.round(npc.y*TS-cam.y);
        if (sx>-TS*2&&sx<cW+TS&&sy>-TS*2&&sy<cH+TS)
            drawCharacter(sx,sy,npc.color,'down',npc.name,false,isAdjacent(npc.x,npc.y),npc.ghost,0,false,npc.id);
    }
    drawAmbientBubbles();
    if (currentMap.enemies) {
        for (const en of currentMap.enemies) {
            if (!en.alive) continue;
            const sx=Math.round(en.x*TS-cam.x), sy=Math.round(en.y*TS-cam.y);
            if (sx>-TS*2&&sx<cW+TS*2&&sy>-TS*2&&sy<cH+TS*2)
                drawEnemyOverworld(sx, sy, en);
        }
    }
    // Integer-pixel player position eliminates sub-pixel shimmer
    drawCharacter(Math.round(player.renderX-cam.x), Math.round(player.renderY-cam.y),
        CLASS_COLORS[gs.charClass]||CLASS_COLORS.Warrior,
        player.facing,'',true,false,false,player.walkPhase,player.isMoving);

    particleSystem.render(ctx, cam);               // ambient particles
    particleSystem.renderMotes(ctx);               // atmospheric dust motes
    renderLighting();   // dynamic darkness + torch light + warm color bleed
    renderVignette();   // corner vignette in interiors
    if (typeof VQ !== 'undefined') VQ.renderOutdoorTorchGlow(); // torch warm halo on lit maps (guarded, no-op during dark battle)
    renderWorldEventOverlays();
    if (_isBattleActive) battleSystem.render(ctx);
    else updateHintBar();
    // Scanlines + color grade always last — applies correctly over both overworld and battle
    if (!_scanlinesCanvas || _scanlinesCanvas.width !== cW || _scanlinesCanvas.height !== cH) _buildScanlinesCanvas();
    ctx.drawImage(_scanlinesCanvas, 0, 0);
    if (typeof VQ !== 'undefined') VQ.renderColorGrade(); // warm tone + full-scene vignette
    _perf.draw(ctx, cW); // F3 toggles on-screen FPS counter (drawn last — above all other layers)
    renderMinimap();     // DOM canvas overlay — separate context, always last
}

// Public API for helper functions consumed by external files (SpriteRenderer.js, visual-quality.js).
// All other render.js internals remain private.
window.Render = { dither2, drawWallPlaque, drawSignPost, buildCharFrame: _buildCharFrame };
