'use strict';

// ═══════════════════════════════════════════════════════════════════
//  tile-renderer.js  ─  The Forgotten Realm
//
//  1. SHEET_LAYOUT  — 48×48 atlas spec for commissioning PNG art
//  2. TileRenderer  — loads PNG sprite sheets with procedural fallback
//  3. applyPixelArtSettings — canonical canvas crispness settings
//  4. Reference procedural tiles: grass, stone path, water
//     Higher-quality than the _tc cache; use as art brief / in-game
//     until real sprites are ready.
//
//  ─── CANVAS 2D PIXEL-PERFECT SETTINGS ───────────────────────────
//
//    // Always set on every ctx (main, offscreen, bgCanvas):
//    ctx.imageSmoothingEnabled = false;
//
//    // Always set on the <canvas> element itself for CSS upscaling:
//    canvas.style.imageRendering = 'pixelated';   // Chrome, Edge, Safari 15+
//    canvas.style.imageRendering = 'crisp-edges'; // Firefox fallback
//
//    // Always round coordinates before drawing:
//    ctx.drawImage(sprite, Math.round(x), Math.round(y));
//
//    // DPR: scale the context once after each resize, then work in
//    // logical (CSS) pixels everywhere. game.js already does this.
//
//  ─── WEBGL FALLBACK (when to switch and how) ─────────────────────
//
//    Switch when sustained framerate drops below ~45fps on mid-range
//    hardware (test with Chrome DevTools Performance panel).
//
//    Recommended path: PixiJS v8
//      import * as PIXI from 'pixi.js';
//      PIXI.settings.SCALE_MODE = PIXI.SCALE_MODES.NEAREST;  // pixel-art
//
//    Migration notes:
//      • All offscreen canvas pre-renders become PIXI.Texture.from(offscreen)
//      • PIXI.Sprite replaces ctx.drawImage — GPU-batched automatically
//      • Keep the tile variant cache (_tc) — same pre-render strategy
//      • Post-processing (CRT, bloom): PIXI.Filter on the world container
//      • ctx.save/restore → PIXI.Container.position/scale, no cost
//      • Input, game logic, UI panels: unchanged (they're DOM-based)
//
//  Depends on: PALETTE (defined in game.js, loaded before this file)
// ═══════════════════════════════════════════════════════════════════


// ───────────────────────────────────────────────────────────────────
//  SPRITE SHEET LAYOUT
//  Art brief: every tile type maps to a row in a single 48×48 atlas.
//  Each cell = 48px tile + 1px gap = 49px stride.
//
//  Atlas dimensions:
//    Width  = 8 columns × 49 − 1 = 391 px
//    Height = 13 rows   × 49 − 1 = 636 px
//
//  When handing this spec to an artist or AI generator:
//    - Each row is one tile type; each column is a variant or frame.
//    - Row 7 (WATER) and Row 11 (TORCH) are animation flip-books:
//      columns 0–3 are sequential frames, left to right.
//    - Palette must match PALETTE in game.js (32 colors).
//    - No anti-aliasing; no gradients; pixel art only.
// ───────────────────────────────────────────────────────────────────
const SHEET_LAYOUT = Object.freeze({
    CELL_SZ:  49,   // stride between tile origins in the atlas (48 + 1 gap)
    TILE_SZ:  48,   // pixel dimensions of each tile cell

    rows: Object.freeze({
        //             row  variants  purpose
        GRASS:    { r:  0, v: 8 },  // 0=plain 1=flowers 2=pebbles 3=mushroom 4=blades 5=dry 6=dark 7=clover
        PATH:     { r:  1, v: 4 },  // 0=plain 1=cracked 2=mossy 3=worn
        FLOOR:    { r:  2, v: 4 },  // 0=plain 1=worn 2=marked 3=dark
        WALL_EXT: { r:  3, v: 4 },  // exterior stone: 0=plain 1=mossy 2=dark 3=stained
        WALL_INT: { r:  4, v: 4 },  // interior wood plank: 0-2=variants 3=beam
        WALL_DUN: { r:  5, v: 4 },  // dungeon rock: 0=plain 1=crack 2=damp 3=vein
        TREE:     { r:  6, v: 2 },  // 0=summer 1=autumn
        WATER:    { r:  7, v: 4 },  // frames 0-3 (animation, 8-tick interval)
        DOOR:     { r:  8, v: 4 },  // 0=ext-closed 1=ext-open 2=int-closed 3=int-open
        STAIRS:   { r:  9, v: 2 },  // 0=down 1=up
        SIGN:     { r: 10, v: 3 },  // 0=wall 1=floor 2=post
        TORCH:    { r: 11, v: 2 },  // frames 0-1 (animation, 4–6-tick interval)
        CEILING:  { r: 12, v: 1 },  // overhead beam (top row of interior)
    }),

    // Returns the {sx, sy, sw, sh} source rect for drawImage() from the atlas.
    srcRect(rowName, variantIdx) {
        const entry = this.rows[rowName];
        if (!entry) return null;
        const col = Math.min(variantIdx, entry.v - 1);
        return {
            sx: col  * this.CELL_SZ,
            sy: entry.r * this.CELL_SZ,
            sw: this.TILE_SZ,
            sh: this.TILE_SZ,
        };
    },
});


// ───────────────────────────────────────────────────────────────────
//  PIXEL-ART SETTINGS HELPER
//  Call on every canvas context you create (offscreen or main).
// ───────────────────────────────────────────────────────────────────
function applyPixelArtSettings(ctx, canvasEl) {
    ctx.imageSmoothingEnabled = false;
    if (canvasEl) {
        canvasEl.style.imageRendering = 'pixelated';
        // Firefox fallback — ignored by Chrome/Safari
        canvasEl.style.imageRendering = 'crisp-edges';
    }
}


// ───────────────────────────────────────────────────────────────────
//  INTERNAL DRAWING PRIMITIVES
//  (mirrors pixel-art-rendering skill; kept local so this file is
//   self-contained and doesn't mutate game.js globals)
// ───────────────────────────────────────────────────────────────────

// Seeded LCG — same as game.js _rng for reproducible variants
function _rng(seed) {
    let s = (seed * 1664525 + 1013904223) >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// Bayer 4×4 ordered dither matrix (values 0–15)
const _BAYER4 = [
    [ 0, 8, 2,10],
    [12, 4,14, 6],
    [ 3,11, 1, 9],
    [15, 7,13, 5],
];

// Ordered Bayer dither over a rect. density in (0,1) = fraction of colorB.
function _ditherBayer(c, x, y, w, h, colA, colB, density) {
    const thresh = density * 16;
    for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
            c.fillStyle = _BAYER4[py & 3][px & 3] < thresh ? colB : colA;
            c.fillRect(x + px, y + py, 1, 1);
        }
    }
}

// 2-colour checkerboard (fast, for large fills)
function _ditherCheck(c, x, y, w, h, colA, colB, phase) {
    const o = phase | 0;
    for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
            c.fillStyle = ((px + py + o) & 1) === 0 ? colA : colB;
            c.fillRect(x + px, y + py, 1, 1);
        }
    }
}

// Filled pixel-ellipse (no anti-aliasing)
function _ellipse(c, cx, cy, rx, ry, col) {
    c.fillStyle = col;
    for (let dy = -ry; dy <= ry; dy++) {
        for (let dx = -rx; dx <= rx; dx++) {
            if ((dx*dx)/(rx*rx) + (dy*dy)/(ry*ry) <= 1)
                c.fillRect(Math.round(cx+dx), Math.round(cy+dy), 1, 1);
        }
    }
}

// Bresenham line — no anti-aliasing
function _line(c, x0, y0, x1, y1, col) {
    c.fillStyle = col;
    const dx = Math.abs(x1-x0), dy = Math.abs(y1-y0);
    const sx = x0<x1?1:-1, sy = y0<y1?1:-1;
    let err = dx - dy;
    for (;;) {
        c.fillRect(x0, y0, 1, 1);
        if (x0===x1 && y0===y1) break;
        const e2 = 2*err;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 <  dx) { err += dx; y0 += sy; }
    }
}

// ───────────────────────────────────────────────────────────────────
//  REFERENCE TILE DRAW FUNCTIONS
//  These target 48×48px and use more layering than the _tc cache.
//  Purpose: art-brief reference. Also used as procedural fallback
//  inside TileRenderer when no PNG sheet is loaded.
// ───────────────────────────────────────────────────────────────────

// ── GRASS  ──────────────────────────────────────────────────────────
// 5 depth layers:
//   1. Base fill (M_FOREST)
//   2. Bayer-dithered shadow patches (D_GREEN, ~35%)
//   3. Mid-tone scattered blobs (M_MOSS)
//   4. Grass blades: 1×3–5px vertical strokes, shaded tip
//   5. Specular dew pixels (L_LEAF)
// Variant detail added on top (same as _tc: flowers, pebbles, etc.)
function _drawRefGrass(c, T, v) {
    const P = PALETTE;
    const rng = _rng(v * 37 + 5);
    const U   = Math.max(1, Math.floor(T / 16));

    // ── 1. Base ─────────────────────────────────────────
    const isDry  = v === 5;
    const isDark = v === 6;
    const base   = isDry ? P.M_SAND : isDark ? P.D_GREEN : P.M_FOREST;
    c.fillStyle = base;
    c.fillRect(0, 0, T, T);

    // ── 2. Bayer shadow patches ──────────────────────────
    if (v === 3 || v === 4) {
        // Type B: dithered dark-green patches
        for (let i = 0; i < 5; i++) {
            const px = Math.floor(rng() * (T - U*8)), py = Math.floor(rng() * (T - U*8));
            const pw = Math.floor(rng() * U*10 + U*3), ph = Math.floor(rng() * U*8 + U*2);
            _ditherBayer(c, px, py, Math.min(pw, T-px), Math.min(ph, T-py),
                P.M_FOREST, P.D_GREEN, 0.4);
        }
    } else if (isDry) {
        // Type C: dry — Bayer blend sand into base
        _ditherBayer(c, 0, 0, T, T, P.M_SAND, P.L_STONE, 0.45);
    } else {
        // Type A / D: organic blob patches
        c.fillStyle = isDark ? P.M_FOREST : P.M_MOSS;
        for (let i = 0; i < 14; i++) {
            const sw = Math.floor(rng() * U*5 + U);
            const sh = Math.floor(rng() * U*4 + U);
            c.fillRect(Math.floor(rng()*(T-sw)), Math.floor(rng()*(T-sh)), sw, sh);
        }
        // Bayer-dithered dark fringe in lower 40% for ground depth
        _ditherBayer(c, 0, Math.floor(T*0.6), T, Math.floor(T*0.4),
            base, P.D_GREEN, 0.25);
    }

    // ── 3. Scattered soil pixels (ground peeking through) ─
    if (!isDry) {
        c.fillStyle = P.M_CLAY;
        for (let i = 0; i < 4; i++)
            c.fillRect(Math.floor(rng()*(T-2)), Math.floor(rng()*(T-2)), 1, 1);
    }

    // ── 4. Grass blades ──────────────────────────────────
    const bladeBase = isDry ? P.M_CLAY : isDark ? P.D_GREEN : P.M_FOREST;
    const bladeMid  = isDry ? P.M_CLAY : isDark ? P.M_FOREST : P.M_MOSS;
    const bladeTip  = isDry ? P.L_STONE : isDark ? P.M_MOSS : P.L_LEAF;
    const bladeCount = isDark ? 14 : (v === 3 || v === 4) ? 8 : 10;
    for (let i = 0; i < bladeCount; i++) {
        const bx = Math.floor(rng() * (T - U*2) + U);
        const by = Math.floor(rng() * (T - U*5) + U*2);
        const bh = Math.floor(rng() * U*3 + U*2);   // 2–5 px tall
        // Shadow at base
        c.fillStyle = bladeBase; c.fillRect(bx, by + bh - 1, 1, 1);
        // Mid body
        c.fillStyle = bladeMid;  c.fillRect(bx, by + 1, 1, bh - 2);
        // Bright tip
        c.fillStyle = bladeTip;  c.fillRect(bx, by, 1, 1);
        // L-foot (every other blade)
        if (i % 2 === 0) { c.fillStyle = bladeMid; c.fillRect(bx+1, by + bh - 1, 1, 1); }
    }

    // ── 5. Specular dew pixels ───────────────────────────
    c.fillStyle = isDry ? P.L_WHITE : P.L_LEAF;
    const dewCount = isDark ? 6 : 4;
    for (let i = 0; i < dewCount; i++)
        c.fillRect(Math.floor(rng()*(T-U*2)+U), Math.floor(rng()*(T-U*2)+U), 1, 1);

    // ── 6. Variant detail ────────────────────────────────
    switch (v) {
        case 1: { // Cross flowers (pink + yellow)
            for (let f = 0; f < 2; f++) {
                const fx = Math.floor(rng()*(T-U*8)+U*4), fy = Math.floor(rng()*(T-U*8)+U*4);
                const fc = f ? P.A_RARE : P.A_YELLOW;
                c.fillStyle = fc;
                c.fillRect(fx-1, fy, 1, 1); c.fillRect(fx+1, fy, 1, 1);
                c.fillRect(fx, fy-1, 1, 1); c.fillRect(fx, fy+1, 1, 1);
                c.fillStyle = P.L_WHITE; c.fillRect(fx, fy, 1, 1);
            }
            break;
        }
        case 2: { // Pebbles with 2px bevel
            for (let p = 0; p < 5; p++) {
                const px = Math.floor(rng()*(T-U*4)+U), py = Math.floor(rng()*(T-U*2)+U);
                const pw = U*2+1, ph = U;
                c.fillStyle = p%2 ? P.M_STONE : P.M_CLAY;
                c.fillRect(px, py, pw, ph);
                c.fillStyle = P.L_STONE; c.fillRect(px, py, pw, 1);        // top hi
                c.fillStyle = P.D_STONE; c.fillRect(px, py+ph-1, pw, 1);   // bottom shadow
                c.fillStyle = P.L_WHITE; c.fillRect(px, py, 1, 1);         // corner specular
            }
            break;
        }
        case 3: { // Mushroom
            const mx = Math.floor(T*0.37), my = Math.floor(T*0.44);
            c.fillStyle = P.S_MID;    c.fillRect(mx, my, U*2, U*3);           // stem
            c.fillStyle = P.M_BRICK;  c.fillRect(mx-U, my-U*2, U*4, U*2);    // cap
            c.fillStyle = P.L_PARCH;  c.fillRect(mx-U, my-U*2, U*4, 1);      // cap hi
            c.fillStyle = P.D_BROWN;  c.fillRect(mx-U, my-1, U*4, 1);        // underside shadow
            c.fillStyle = P.L_WHITE;  c.fillRect(mx+U, my-U*2, 1, 1);        // spot
            c.fillRect(Math.floor(mx-U*0.5), my-U, 1, 1);
            break;
        }
        case 4: { // Dense dark blade clusters
            c.fillStyle = P.D_GREEN;
            for (let i = 0; i < 8; i++) {
                const bx2 = Math.floor(rng()*(T-2)), by2 = Math.floor(rng()*(T-U*4));
                c.fillRect(bx2, by2, 1, U*2+1);
            }
            break;
        }
        case 5: { // Cracked dry earth
            const cpx = Math.floor(rng()*T*0.5+T*0.2), cpy = Math.floor(rng()*T*0.4+T*0.3);
            c.fillStyle = P.M_CLAY;  c.fillRect(cpx, cpy, U*3, U);
            c.fillStyle = P.D_BROWN;
            for (let i = 0; i < 4; i++) c.fillRect(cpx+i, cpy, 1, 1);
            // Second crack diagonal
            _line(c, cpx+U, cpy+U, cpx+U*2, cpy+U*2, P.D_BROWN);
            break;
        }
        case 6: { // Dense dark — extra blades (already handled above) + dark fringe
            _ditherBayer(c, 0, T-Math.floor(T*0.2), T, Math.floor(T*0.2), P.D_GREEN, P.D_VOID, 0.3);
            break;
        }
        case 7: { // Clover — 3 overlapping circles + bright center
            for (let cl = 0; cl < 2; cl++) {
                const clx = Math.floor(rng()*(T-U*8)+U*4), cly = Math.floor(rng()*(T-U*8)+U*4);
                // Three leaf lobes
                _ellipse(c, clx,        cly-U*1.2, U+1, U,   P.L_LEAF);
                _ellipse(c, clx-U*1.2,  cly+U*0.7, U+1, U,   P.L_LEAF);
                _ellipse(c, clx+U*1.2,  cly+U*0.7, U+1, U,   P.L_LEAF);
                // Midrib lines
                _line(c, clx, cly, clx,       cly-U*1,  P.M_MOSS);
                _line(c, clx, cly, clx-U,     cly+U,    P.M_MOSS);
                _line(c, clx, cly, clx+U,     cly+U,    P.M_MOSS);
                c.fillStyle = P.L_WHITE; c.fillRect(clx, cly, 1, 1);
            }
            break;
        }
    }
}


// ── STONE PATH  ─────────────────────────────────────────────────────
// 2×2 cobblestones, each ~22×22px, 2px mortar gap.
// Per-stone: 3-tone face (base, Bayer-dithered lit quarter, shadow strip)
//            2px bevel (hi top-left, shadow bottom-right)
//            optional crack / moss
function _drawRefPath(c, T, v) {
    const P  = PALETTE;
    const gap = Math.max(2, Math.floor(T / 18));   // mortar thickness
    const half = Math.floor(T / 2);

    // ── Mortar fill ──────────────────────────────────────
    c.fillStyle = P.M_CLAY;
    c.fillRect(0, 0, T, T);
    if (v === 2) {
        // Mossy mortar: Bayer-dither M_MOSS into mortar lines
        _ditherBayer(c, 0, half-gap, T, gap*2, P.M_CLAY, P.M_MOSS, 0.55);
        _ditherBayer(c, half-gap, 0, gap*2, T, P.M_CLAY, P.M_MOSS, 0.55);
    }

    // ── Four stone faces ────────────────────────────────
    const stoneCols = [P.M_SAND, P.L_STONE, P.M_SAND, P.L_STONE];
    const origins = [
        [gap, gap],
        [half + gap, gap],
        [gap, half + gap],
        [half + gap, half + gap],
    ];
    origins.forEach(([ox, oy], i) => {
        const sw = half - gap * 2, sh = half - gap * 2;
        const sc = stoneCols[(v + i) % stoneCols.length];

        // Base face
        c.fillStyle = sc;
        c.fillRect(ox, oy, sw, sh);

        // Bayer-dithered lit upper-left quadrant (~35% lighter)
        _ditherBayer(c, ox, oy, Math.floor(sw*0.55), Math.floor(sh*0.55),
            sc, P.L_WHITE, 0.22);

        // Worn center highlight — lighter center 40% of face (foot traffic)
        _ditherBayer(c, ox + Math.floor(sw*0.25), oy + Math.floor(sh*0.25),
            Math.floor(sw*0.50), Math.floor(sh*0.50), sc, P.L_STONE, 0.20);

        // 2px bevel: bright top + left edges
        c.fillStyle = P.L_WHITE;
        c.fillRect(ox,    oy,    sw, 1);   // top
        c.fillRect(ox,    oy,    1, sh);   // left
        c.fillStyle = P.L_STONE;
        c.fillRect(ox,    oy+1,  sw, 1);   // top inner
        c.fillRect(ox+1,  oy,    1, sh);   // left inner

        // 2px bevel: dark bottom + right edges
        c.fillStyle = P.D_STONE;
        c.fillRect(ox,        oy+sh-1, sw, 1);  // bottom
        c.fillRect(ox+sw-1,   oy,      1, sh);  // right
        c.fillStyle = P.D_BROWN;
        c.fillRect(ox,        oy+sh-2, sw, 1);  // bottom inner
        c.fillRect(ox+sw-2,   oy,      1, sh);  // right inner

        // Corner specular pixel
        c.fillStyle = P.L_WHITE;
        c.fillRect(ox, oy, 1, 1);

        // Variant crack / moss
        if (v === 1 || v === 3) {
            // Diagonal crack — 3-pixel Bresenham
            c.fillStyle = P.D_BROWN;
            const cx0 = ox + Math.floor(sw*0.3), cy0 = oy + Math.floor(sh*0.3);
            _line(c, cx0, cy0, cx0 + Math.floor(sw*0.35), cy0 + Math.floor(sh*0.35), P.D_STONE);
            c.fillStyle = P.D_VOID;
            c.fillRect(cx0 + 1, cy0 + 1, 1, 1);
        }
        if (v === 2) {
            // Moss pixel cluster in bottom-right mortar corner
            c.fillStyle = P.M_MOSS;
            c.fillRect(ox + sw - 2, oy + sh - 1, 2, 1);
            c.fillRect(ox + sw - 1, oy + sh - 2, 1, 1);
        }
    });

    // ── Mortar center intersection highlight ────────────
    c.fillStyle = P.D_BROWN;
    c.fillRect(half - gap, half - gap, gap*2, gap*2);
    c.fillStyle = P.D_VOID;
    c.fillRect(half - 1, half - 1, 1, 1);  // center void pixel

    // ── South + east edge darkening (recessed shadow under/right of tile) ──
    const edgeSz = Math.max(1, gap);
    c.fillStyle = P.D_BROWN;
    c.fillRect(0, T - edgeSz, T, edgeSz);  // south edge
    c.fillRect(T - edgeSz, 0, edgeSz, T);  // east edge
}


// ── WATER  ──────────────────────────────────────────────────────────
// 4-frame flip-book. Each frame built once and cached.
//
// Depth layering (3 tones via Bayer dither):
//   Surface 0–40%:  L_WATER / M_TEAL
//   Mid    40–70%:  M_TEAL  / M_SLATE  (30% density)
//   Deep   70–100%: M_SLATE / D_BLUE   (25% density)
//
// Per-frame: horizontal highlight line(s) shift ±2px
//            ripple ellipses grow and fade
function _drawRefWater(c, T, frame) {
    const P = PALETTE;
    const f = frame & 3;

    // ── 1. Deep background ──────────────────────────────
    c.fillStyle = P.M_TEAL;
    c.fillRect(0, 0, T, T);

    // Mid depth
    _ditherBayer(c, 0, Math.floor(T*0.40), T, Math.floor(T*0.30),
        P.M_TEAL, P.M_SLATE, 0.30);
    // Deep
    _ditherBayer(c, 0, Math.floor(T*0.70), T, Math.floor(T*0.30),
        P.M_SLATE, P.D_BLUE, 0.28);

    // ── 2. Caustic shimmer dither at surface ─────────────
    _ditherBayer(c, 0, 0, T, Math.floor(T*0.35), P.M_TEAL, P.L_WATER, 0.12);

    // ── 3. Highlight lines (shift per frame) ─────────────
    //   Primary highlight: moves up and back
    const hlY1 = [Math.floor(T*0.22), Math.floor(T*0.19), Math.floor(T*0.21), Math.floor(T*0.24)][f];
    c.fillStyle = P.L_WATER;
    c.fillRect(Math.floor(T*0.08), hlY1, Math.floor(T*0.55), 1);
    c.fillStyle = P.L_WHITE;
    c.fillRect(Math.floor(T*0.25), hlY1, Math.floor(T*0.22), 1);  // bright center

    //   Secondary highlight at ~60% height (inverted timing)
    const hlY2 = [Math.floor(T*0.62), Math.floor(T*0.65), Math.floor(T*0.60), Math.floor(T*0.63)][f];
    c.fillStyle = P.L_BLUE;
    c.fillRect(Math.floor(T*0.45), hlY2, Math.floor(T*0.35), 1);

    // ── 4. Animated ripple ellipses ──────────────────────
    // Ripple A — left-center, grows frames 1→3, fades frame 3
    if (f >= 1) {
        const rAx = Math.floor(T*0.32), rAy = Math.floor(T*0.55);
        const rAr = [0, 2, 4, 5][f];
        c.globalAlpha = [0, 0.9, 0.75, 0.35][f];
        _ellipse(c, rAx, rAy, rAr, Math.max(1, Math.floor(rAr*0.5)), P.L_WATER);
        c.globalAlpha = 1;
    }
    // Ripple B — right-center, starts frame 2
    if (f >= 2) {
        const rBx = Math.floor(T*0.68), rBy = Math.floor(T*0.38);
        const rBr = [0, 0, 2, 3][f];
        c.globalAlpha = [0, 0, 0.85, 0.6][f];
        _ellipse(c, rBx, rBy, rBr, Math.max(1, Math.floor(rBr*0.5)), P.L_WATER);
        c.globalAlpha = 1;
    }

    // ── 5. Lily pad (anchored to tile seed — same every frame) ──
    const lpx = Math.floor(T*0.60), lpy = Math.floor(T*0.70);
    _ellipse(c, lpx, lpy, Math.floor(T*0.09), Math.floor(T*0.06), P.M_MOSS);
    _ellipse(c, lpx, lpy, Math.floor(T*0.07), Math.floor(T*0.045), P.M_FOREST);
    // Notch (the missing slice from the lily)
    c.fillStyle = P.M_TEAL;
    c.fillRect(lpx - 1, lpy - Math.floor(T*0.07), 2, Math.floor(T*0.07));
    // Bright edge highlight
    c.fillStyle = P.L_LEAF;
    c.fillRect(lpx - Math.floor(T*0.07), lpy - 1, Math.floor(T*0.04), 1);

    // ── 6. Foam edge pixels at tile top (visible at shallow entry) ─
    c.fillStyle = P.A_GHOST;
    c.globalAlpha = 0.5;
    for (let i = 0; i < 4; i++)
        c.fillRect(Math.floor(T*0.1) + i*Math.floor(T*0.18), 1, 2, 1);
    c.globalAlpha = 1;
}


// ── TILE RENDERER CLASS ──────────────────────────────────────────────
// Loads PNG sprite sheets and caches tiles at the current TS.
// Falls back to enhanced procedural tiles when no sheet is loaded.
//
// Usage:
//   const tr = new TileRenderer();
//   tr.loadSheet('main', '/static/tiles.png');  // optional — add when art is ready
//   // In drawTile() or wherever you need a tile:
//   tr.draw(ctx, 'GRASS', variantIdx, screenX, screenY, TS);
// ────────────────────────────────────────────────────────────────────
class TileRenderer {
    constructor() {
        this._sheets = new Map();   // name → { img, loaded }
        this._cache  = new Map();   // 'ROW:variant:ts' → HTMLCanvasElement
    }

    // Register a PNG atlas. Call before first draw; safe to call at any time.
    // If the sheet is already registered, replaces it and clears the cache.
    loadSheet(name, src) {
        const img = new Image();
        const entry = { img, loaded: false };
        img.onload  = () => { entry.loaded = true; this.invalidate(); };
        img.onerror = () => console.warn(`TileRenderer: cannot load "${name}" from ${src}`);
        img.src = src;
        this._sheets.set(name, entry);
    }

    // Discard all cached tiles (call after resize or atlas change).
    invalidate() { this._cache.clear(); }

    // Draw tile (sheetRow, variant) to ctx at (dx, dy) at tile size ts.
    // dx/dy must already be rounded to integers by the caller.
    draw(ctx, sheetRow, variant, dx, dy, ts) {
        const key = `${sheetRow}:${variant}:${ts}`;
        let tile = this._cache.get(key);
        if (!tile) {
            tile = this._build(sheetRow, variant, ts);
            this._cache.set(key, tile);
        }
        ctx.drawImage(tile, dx, dy);
    }

    // Warm the cache for all variants of a given row at tile size ts.
    // Call at map load time to avoid first-frame jank.
    warmRow(sheetRow, ts) {
        const entry = SHEET_LAYOUT.rows[sheetRow];
        if (!entry) return;
        for (let v = 0; v < entry.v; v++) this.draw({ drawImage() {} }, sheetRow, v, 0, 0, ts);
    }

    // ── private ──────────────────────────────────────────
    _build(sheetRow, variant, ts) {
        const sheet = this._sheets.get('main');
        if (sheet?.loaded) return this._fromSheet(sheet.img, sheetRow, variant, ts);
        return this._procedural(sheetRow, variant, ts);
    }

    // Slice + scale a tile from the PNG atlas.
    _fromSheet(img, sheetRow, variant, ts) {
        const src = SHEET_LAYOUT.srcRect(sheetRow, variant);
        if (!src) return this._procedural(sheetRow, variant, ts);
        const c = document.createElement('canvas');
        c.width = c.height = ts;
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, src.sx, src.sy, src.sw, src.sh, 0, 0, ts, ts);
        return c;
    }

    // Build enhanced procedural tile as fallback.
    _procedural(sheetRow, variant, ts) {
        const c = document.createElement('canvas');
        c.width = c.height = ts;
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        switch (sheetRow) {
            case 'GRASS':    _drawRefGrass(ctx, ts, variant);    break;
            case 'PATH':     _drawRefPath(ctx, ts, variant);     break;
            case 'WATER':    _drawRefWater(ctx, ts, variant);    break;
            default: {
                // Unknown row — fill with a debug checkerboard so it's obvious
                _ditherCheck(ctx, 0, 0, ts, ts, '#f0f', '#000', 0);
                break;
            }
        }
        return c;
    }
}

// Global singleton — game.js can call window.tileRenderer.draw(...)
const tileRenderer = new TileRenderer();


// ───────────────────────────────────────────────────────────────────
//  DEV PREVIEW PANEL
//  Press F2 to toggle a floating panel showing the 3 reference tiles
//  at 1× (48px), 2× (96px), and 4× (192px) for art-briefing use.
//  The panel is DOM-only and has no impact on game performance.
// ───────────────────────────────────────────────────────────────────
(function buildDevPreview() {
    const PREVIEW_TS = 48;
    const SCALES = [1, 2, 4];
    const TILE_SPECS = [
        // [row, variants, label]
        ['GRASS', 8, 'Grass'],
        ['PATH',  4, 'Stone Path'],
        ['WATER', 4, 'Water'],
    ];

    function buildPanel() {
        const panel = document.createElement('div');
        panel.id = 'tr-preview';
        Object.assign(panel.style, {
            position: 'fixed', bottom: '16px', right: '16px',
            background: 'rgba(10,8,12,0.92)',
            border: '1px solid #c8901a',
            borderRadius: '4px',
            padding: '12px',
            zIndex: '9999',
            fontFamily: 'monospace',
            fontSize: '11px',
            color: '#e8dcc8',
            userSelect: 'none',
            overflowY: 'auto',
            maxHeight: '90vh',
        });

        const title = document.createElement('div');
        title.textContent = 'Tile Reference (F2 to close)';
        Object.assign(title.style, { marginBottom: '10px', color: '#c8901a', fontWeight: 'bold' });
        panel.appendChild(title);

        for (const [row, varCount, label] of TILE_SPECS) {
            const section = document.createElement('div');
            Object.assign(section.style, { marginBottom: '12px' });

            const h = document.createElement('div');
            h.textContent = label;
            Object.assign(h.style, { marginBottom: '4px', color: '#90a8c8' });
            section.appendChild(h);

            // Row of variant swatches at 1×
            const swatchRow = document.createElement('div');
            Object.assign(swatchRow.style, { display: 'flex', gap: '2px', marginBottom: '4px', flexWrap: 'wrap' });
            for (let v = 0; v < varCount; v++) {
                const cv = document.createElement('canvas');
                cv.width = cv.height = PREVIEW_TS;
                applyPixelArtSettings(cv.getContext('2d'), cv);
                cv.style.width = cv.style.height = PREVIEW_TS + 'px';
                cv.title = `${row} v${v}`;
                // Draw using local procedural functions (don't hit the cache)
                const ctx2 = cv.getContext('2d');
                ctx2.imageSmoothingEnabled = false;
                if (row === 'GRASS')  _drawRefGrass(ctx2, PREVIEW_TS, v);
                if (row === 'PATH')   _drawRefPath(ctx2, PREVIEW_TS, v);
                if (row === 'WATER')  _drawRefWater(ctx2, PREVIEW_TS, v);
                swatchRow.appendChild(cv);
            }
            section.appendChild(swatchRow);

            // Scaled-up view of variant 0 at 2× and 4×
            const scaleRow = document.createElement('div');
            Object.assign(scaleRow.style, { display: 'flex', gap: '8px', alignItems: 'flex-end' });
            for (const s of SCALES) {
                const wrap = document.createElement('div');
                const lbl = document.createElement('div');
                lbl.textContent = `${s}×`;
                Object.assign(lbl.style, { marginBottom: '2px', fontSize: '10px' });
                const cv = document.createElement('canvas');
                cv.width = cv.height = PREVIEW_TS;
                const ctx2 = cv.getContext('2d');
                ctx2.imageSmoothingEnabled = false;
                if (row === 'GRASS')  _drawRefGrass(ctx2, PREVIEW_TS, 0);
                if (row === 'PATH')   _drawRefPath(ctx2, PREVIEW_TS, 0);
                if (row === 'WATER')  _drawRefWater(ctx2, PREVIEW_TS, 1);
                cv.style.width  = (PREVIEW_TS * s) + 'px';
                cv.style.height = (PREVIEW_TS * s) + 'px';
                cv.style.imageRendering = 'pixelated';
                wrap.appendChild(lbl);
                wrap.appendChild(cv);
                scaleRow.appendChild(wrap);
            }
            section.appendChild(scaleRow);
            panel.appendChild(section);
        }

        // Atlas spec summary
        const spec = document.createElement('details');
        const sum  = document.createElement('summary');
        sum.textContent = 'Atlas Spec';
        Object.assign(sum.style, { cursor: 'pointer', color: '#c8901a', marginBottom: '4px' });
        spec.appendChild(sum);
        const pre = document.createElement('pre');
        pre.style.margin = '0';
        pre.style.fontSize = '10px';
        pre.style.color = '#90a8c8';
        pre.textContent = [
            `Cell:   48×48 px + 1px gap = 49px stride`,
            `Atlas:  391 × 636 px  (8 col × 13 row)`,
            ``,
            ...Object.entries(SHEET_LAYOUT.rows).map(
                ([k, v]) => `Row ${String(v.r).padStart(2)}: ${k.padEnd(9)} (${v.v} variants)`
            ),
        ].join('\n');
        spec.appendChild(pre);
        panel.appendChild(spec);

        return panel;
    }

    let panelEl = null;
    document.addEventListener('keydown', e => {
        if (e.key !== 'F2') return;
        e.preventDefault();
        if (panelEl) {
            panelEl.remove();
            panelEl = null;
        } else {
            panelEl = buildPanel();
            document.body.appendChild(panelEl);
        }
    });
})();
