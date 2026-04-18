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
    const variant = v % 4;
    const U = Math.max(1, Math.floor(T / 16));
    const rng = _rng(v * 37 + 5);

    // Base fill — 4 subtly different greens
    const bases = ['#4a7c3f', '#5a8f4a', '#3d6b34', '#4f8045'];
    c.fillStyle = bases[variant];
    c.fillRect(0, 0, T, T);

    if (variant === 0) {
        // Subtle crosshatch texture at 20% opacity
        c.fillStyle = '#2d5a2d';
        c.globalAlpha = 0.20;
        const step = Math.max(3, Math.floor(T / 6));
        for (let i = step; i < T - 1; i += step) {
            c.fillRect(i, 0, 1, T);
            c.fillRect(0, i, T, 1);
        }
        c.globalAlpha = 1;
    } else if (variant === 1) {
        // Small scattered light and dark dot details
        c.fillStyle = '#7ab84a';
        for (let i = 0; i < 6; i++)
            c.fillRect(Math.floor(rng() * (T - U*2) + U), Math.floor(rng() * (T - U*2) + U), 1, 1);
        c.fillStyle = '#3d6b34';
        for (let i = 0; i < 4; i++)
            c.fillRect(Math.floor(rng() * (T - U*2) + U), Math.floor(rng() * (T - U*2) + U), 1, 1);
    } else if (variant === 2) {
        // Horizontal shadow streak across bottom quarter
        const streakY = Math.floor(T * 0.75);
        const streakH = Math.max(1, Math.floor(T * 0.06));
        c.fillStyle = '#2a5530';
        c.globalAlpha = 0.50;
        c.fillRect(0, streakY, T, streakH);
        c.globalAlpha = 1;
    } else {
        // variant 3: 2–3 tiny pebble dots with highlight
        const count = 2 + (rng() > 0.5 ? 1 : 0);
        for (let i = 0; i < count; i++) {
            const px = Math.floor(rng() * (T - U*4) + U*2);
            const py = Math.floor(rng() * (T - U*4) + U*2);
            c.fillStyle = '#6b7c5a';
            c.fillRect(px, py, U + 1, U);
            c.fillStyle = '#8a9870';
            c.fillRect(px, py, U + 1, 1);
        }
    }

    // All variants: 1px darker border on bottom and right for depth
    c.fillStyle = '#2d5224';
    c.fillRect(0, T - 1, T, 1);
    c.fillRect(T - 1, 0, 1, T);
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


// ── STONE PATH  ─────────────────────────────────────────────────────
// Cool gray cobblestone — same 2×2 layout as PATH but with D_STONE grout
// and M_STONE/L_STONE faces instead of warm sandy browns.
// v=0 plain  v=1 cracked  v=2 mossy  v=3 worn
function _drawRefStonePath(c, T, v) {
    const gap  = Math.max(1, Math.floor(T / 16));
    const half = Math.floor(T / 2);
    const rng  = _rng(v * 53 + 11);

    // Per-variant overall tone (4 variants)
    const tones = ['#8a8070', '#7a7060', '#9a9080', '#6a6050'];
    const tone  = tones[v % 4];
    const isMossy = (v % 4) === 2;

    // Grout base — 1px dark lines between stones
    c.fillStyle = '#3a3830';
    c.fillRect(0, 0, T, T);

    // Mossy variant: dither moss into grout lines
    if (isMossy) {
        _ditherBayer(c, 0, half - gap, T, gap * 2, '#3a3830', '#5a7a4a', 0.5);
        _ditherBayer(c, half - gap, 0, gap * 2, T, '#3a3830', '#5a7a4a', 0.5);
    }

    // 2×2 stone blocks with 2–3 shade subdivisions per block
    const blockShades = ['#c0b8a8', '#a09888', '#b8b0a0', '#888070'];
    const origins = [
        [gap, gap],
        [half + gap, gap],
        [gap, half + gap],
        [half + gap, half + gap],
    ];
    origins.forEach(([ox, oy], i) => {
        const sw = half - gap * 2, sh = half - gap * 2;
        if (sw < 2 || sh < 2) return;

        // Pick a base shade offset by variant + position for variety
        const shade0 = blockShades[(v + i)     % blockShades.length];
        const shade1 = blockShades[(v + i + 1) % blockShades.length];

        // Upper two-thirds: shade0
        c.fillStyle = shade0;
        c.fillRect(ox, oy, sw, Math.floor(sh * 0.65));

        // Lower third: slightly darker shade1
        c.fillStyle = shade1;
        c.fillRect(ox, oy + Math.floor(sh * 0.65), sw, sh - Math.floor(sh * 0.65));

        // 1px highlight top-left (lighter)
        c.fillStyle = '#d0c8b8';
        c.fillRect(ox, oy, sw, 1);
        c.fillRect(ox, oy, 1, sh);

        // 1px shadow bottom-right (darker)
        c.fillStyle = '#504840';
        c.fillRect(ox, oy + sh - 1, sw, 1);
        c.fillRect(ox + sw - 1, oy, 1, sh);

        // Mossy splotch at corners on mossy variant
        if (isMossy) {
            c.fillStyle = '#5a7a4a';
            c.fillRect(ox + sw - 2, oy, 2, 2);
            c.fillRect(ox, oy + sh - 2, 2, 2);
        }

        // Crack detail on variants 1 and 3
        if (v % 2 === 1) {
            const cx0 = ox + Math.floor(sw * 0.3), cy0 = oy + Math.floor(sh * 0.25);
            _line(c, cx0, cy0, cx0 + Math.floor(sw * 0.3), cy0 + Math.floor(sh * 0.35), '#3a3830');
        }
    });

    // Mortar intersection center
    c.fillStyle = '#3a3830';
    c.fillRect(half - gap, half - gap, gap * 2, gap * 2);

    // 1px depth edge: bottom and right
    c.fillStyle = '#504840';
    c.fillRect(0,     T - 1, T, 1);
    c.fillRect(T - 1, 0,     1, T);
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


// ── WALL  ────────────────────────────────────────────────────────────
// subtype: 'EXT' exterior stone | 'INT' interior wood | 'DUN' dungeon rock | 'CEILING'
function _drawRefWall(c, T, v, subtype) {
    const P = PALETTE;
    const U = Math.max(1, Math.floor(T / 16));

    if (subtype === 'EXT') {
        const brickH = Math.max(4, Math.floor(T / 5));
        const brickW = Math.max(8, Math.floor(T / 3));
        const topFaceH = Math.max(1, Math.floor(brickH * 0.35));

        // Mortar fill (dark, consistent with shadow palette)
        c.fillStyle = '#504840';
        c.fillRect(0, 0, T, T);

        // Draw bricks — alternate offset every other row
        for (let row = 0; row < 6; row++) {
            const y0 = row * brickH + 1;
            const bh = brickH - 2;
            if (bh <= 0) continue;
            const offset = (row % 2) * Math.floor(brickW / 2);
            for (let col = offset - brickW; col < T + brickW; col += brickW) {
                const x0 = col + 1;
                const bw = Math.min(brickW - 2, T - x0);
                if (bw <= 0 || x0 >= T || x0 + bw <= 0) continue;
                const cx0 = Math.max(0, x0), cx1 = Math.min(T, x0 + bw);
                const cw = cx1 - cx0;
                if (cw <= 0) continue;

                // Top face (lighter — receives direct light from top-left)
                c.fillStyle = '#b0a898';
                c.fillRect(cx0, y0, cw, Math.min(topFaceH, bh));

                // Front face (darker — faces camera)
                if (bh > topFaceH) {
                    c.fillStyle = '#7a7060';
                    c.fillRect(cx0, y0 + topFaceH, cw, bh - topFaceH);
                }

                // 1px highlight on top-left edge
                c.fillStyle = '#c0b8a8';
                c.fillRect(cx0, y0, cw, 1);
                if (x0 >= 0) { c.fillStyle = '#c0b8a8'; c.fillRect(cx0, y0, 1, bh); }

                // 1px shadow on bottom-right edge
                c.fillStyle = '#3a3028';
                c.fillRect(cx0, y0 + bh - 1, cw, 1);
                if (x0 + bw <= T) { c.fillRect(cx0 + cw - 1, y0, 1, bh); }
            }
        }

        if (v === 1) {
            // Mossy — Bayer-dither moss into lower half
            _ditherBayer(c, 0, Math.floor(T * 0.55), T, Math.floor(T * 0.45), '#7a7060', '#5a7a4a', 0.35);
        } else if (v === 2) {
            // Crumbling edge: dark pixels along right + bottom
            c.fillStyle = '#3a3028';
            for (let y = 0; y < T; y += 2) c.fillRect(T - U, y, U, 1);
            for (let x = 0; x < T; x += 3) c.fillRect(x, T - U, 1, U);
        } else if (v === 3) {
            // Stained: dithered dark blotch upper-center
            _ditherBayer(c, Math.floor(T * 0.2), 0, Math.floor(T * 0.6), Math.floor(T * 0.4), '#7a7060', '#504840', 0.4);
        }

    } else if (subtype === 'DUN') {
        // Near-black dungeon rock — D_BLUE/D_STONE
        c.fillStyle = P.D_BLUE;
        c.fillRect(0, 0, T, T);
        _ditherBayer(c, 0, 0, T, T, P.D_BLUE, P.D_STONE, 0.35);
        // Jagged edge lines for rough silhouette feel
        c.fillStyle = P.D_STONE;
        for (let y = 0; y < T; y += Math.max(3, Math.floor(T / 8))) {
            c.fillRect(0, y, Math.floor(T * 0.08) + (y % 5 > 2 ? U : 0), 1);
            c.fillRect(T - Math.floor(T * 0.06), y, Math.floor(T * 0.06), 1);
        }
        if (v === 2) {
            // Damp drip streaks in M_TEAL
            c.fillStyle = P.M_TEAL;
            for (let x = Math.floor(T * 0.2); x < T * 0.8; x += Math.floor(T * 0.28)) {
                const dripLen = Math.floor(T * 0.4) + (x % 3) * Math.floor(T * 0.1);
                c.fillRect(x,   Math.floor(T * 0.1), 1, dripLen);
                c.fillRect(x+1, Math.floor(T * 0.1), 1, Math.floor(dripLen * 0.6));
            }
        } else if (v === 3) {
            // Mineral vein: thin L_BLUE diagonal line
            _line(c, Math.floor(T * 0.1), Math.floor(T * 0.2), Math.floor(T * 0.7), Math.floor(T * 0.8), P.L_BLUE);
        }

    } else if (subtype === 'INT') {
        // Warm wood plank wall — M_CLAY/L_PARCH horizontal planks
        c.fillStyle = P.M_CLAY;
        c.fillRect(0, 0, T, T);
        const plankH = Math.max(3, Math.floor(T / 4));
        for (let row = 0; row < 4; row++) {
            const y0 = row * plankH;
            const bh = (row === 3) ? T - 3 * plankH : plankH;
            c.fillStyle = (row % 2 === 0) ? P.M_CLAY : P.L_PARCH;
            c.fillRect(0, y0, T, bh);
            c.fillStyle = P.L_WHITE;  c.fillRect(0, y0, T, 1);          // top highlight
            c.fillStyle = P.D_BROWN;  c.fillRect(0, y0+bh-1, T, 1);     // bottom shadow
            c.fillStyle = P.D_BROWN;
            c.fillRect(Math.floor(T * 0.33), y0+1, 1, bh-2);             // grain line
            c.fillRect(Math.floor(T * 0.66), y0+1, 1, bh-2);
        }
        if (v === 3) {
            // Knot detail
            const kx = Math.floor(T * 0.5), ky = Math.floor(T * 0.5);
            _ellipse(c, kx, ky, U*2, U, P.D_BROWN);
            _ellipse(c, kx, ky, U,   U, P.D_VOID);
        }

    } else {
        // CEILING — dark overhead beam: D_BROWN base, M_STONE edges, center crease
        c.fillStyle = P.D_BROWN;
        c.fillRect(0, 0, T, T);
        c.fillStyle = P.M_STONE;
        c.fillRect(0, 0, T, U*2);           // top edge
        c.fillRect(0, T-U*2, T, U*2);       // bottom edge
        c.fillStyle = P.D_VOID;
        c.fillRect(0, Math.floor(T/2), T, 1);     // center crease shadow
        c.fillStyle = P.M_CLAY;
        c.fillRect(0, Math.floor(T/2)+1, T, 1);   // center crease highlight
    }
}


// ── FLOOR  ───────────────────────────────────────────────────────────
// dark=false: worn wood plank (M_CLAY/L_PARCH), foot-worn center highlight
// dark=true:  dungeon flagstone (D_STONE/M_STONE), Bayer crack on v=1
function _drawRefFloor(c, T, v, dark) {
    const P = PALETTE;

    if (dark) {
        c.fillStyle = P.D_STONE;
        c.fillRect(0, 0, T, T);
        // 2×2 flagstone slab pattern — D_VOID mortar lines
        const half = Math.floor(T / 2);
        c.fillStyle = P.D_VOID;
        c.fillRect(half, 0, 1, T);   // vertical center mortar
        c.fillRect(0, half, T, 1);   // horizontal center mortar
        // Slab faces: M_STONE
        const rects = [[1,1,half-2,half-2],[half+1,1,T-half-2,half-2],
                       [1,half+1,half-2,T-half-2],[half+1,half+1,T-half-2,T-half-2]];
        for (const [x,y,w,h] of rects) {
            c.fillStyle = P.M_STONE; c.fillRect(x, y, w, h);
            c.fillStyle = P.L_STONE;
            c.fillRect(x, y, w, 1);  // top highlight
            c.fillRect(x, y, 1, h);  // left highlight
        }
        if (v === 1) {
            // Bayer-dithered diagonal crack on top-left slab
            _ditherBayer(c, Math.floor(T*0.1), Math.floor(T*0.3),
                Math.floor(T*0.35), Math.floor(T*0.1), P.M_STONE, P.D_VOID, 0.5);
        }
    } else {
        // Worn wood planks — same structure as WALL_INT but horizontal
        const plankH = Math.max(3, Math.floor(T / 4));
        for (let row = 0; row < 4; row++) {
            const y0 = row * plankH;
            const bh = (row === 3) ? T - 3*plankH : plankH;
            c.fillStyle = (row % 2 === 0) ? P.M_CLAY : P.L_PARCH;
            c.fillRect(0, y0, T, bh);
            c.fillStyle = P.L_WHITE;  c.fillRect(0, y0, T, 1);
            c.fillStyle = P.D_BROWN;  c.fillRect(0, y0+bh-1, T, 1);
            c.fillStyle = P.D_BROWN;
            c.fillRect(Math.floor(T*0.33), y0+1, 1, bh-2);
            c.fillRect(Math.floor(T*0.66), y0+1, 1, bh-2);
        }
        // Foot-worn center highlight
        _ditherBayer(c, Math.floor(T*0.25), Math.floor(T*0.1),
            Math.floor(T*0.50), Math.floor(T*0.80), P.L_PARCH, P.L_WHITE, 0.15);
        // Shadowed side edges (wall shadow)
        _ditherBayer(c, 0, 0, Math.floor(T*0.08), T, P.M_CLAY, P.D_BROWN, 0.3);
        _ditherBayer(c, T-Math.floor(T*0.08), 0, Math.floor(T*0.08), T, P.M_CLAY, P.D_BROWN, 0.3);
    }
}


// ── TREE  ────────────────────────────────────────────────────────────
// Composite — caller draws grass base first; this draws on transparent bg.
// Layers: outer D_GREEN shell, M_FOREST body, M_MOSS mid-ring,
//         Bayer light on top-left, D_BROWN trunk, root shadow pixels.
function _drawRefTree(c, T, v) {
    const P = PALETTE;
    const U = Math.max(1, Math.floor(T / 16));

    const cx = Math.floor(T / 2), cy = Math.floor(T * 0.42);
    const rx = Math.floor(T * 0.38), ry = Math.floor(T * 0.35);

    _ellipse(c, cx, cy, rx, ry, P.D_GREEN);
    _ellipse(c, cx, cy, Math.floor(rx*0.80), Math.floor(ry*0.80), P.M_FOREST);
    _ellipse(c, cx - Math.floor(rx*0.20), cy + Math.floor(ry*0.10),
               Math.floor(rx*0.35), Math.floor(ry*0.30), P.M_MOSS);

    // Bayer-dithered light on top-left quadrant
    _ditherBayer(c, cx-rx, cy-ry, Math.floor(rx*1.0), Math.floor(ry*0.9),
        P.M_FOREST, P.L_LEAF, 0.25);

    // Trunk: D_BROWN 2px wide
    const trunkX = cx - U;
    const trunkTop = cy + Math.floor(ry * 0.7);
    const trunkH   = Math.floor(T * 0.22);
    c.fillStyle = P.D_BROWN;  c.fillRect(trunkX, trunkTop, U*2, trunkH);
    c.fillStyle = P.M_CLAY;   c.fillRect(trunkX, trunkTop, 1, trunkH);    // left highlight

    // Root shadow pixels
    c.fillStyle = P.D_VOID;
    c.fillRect(trunkX - U, trunkTop + trunkH - U, U, U);
    c.fillRect(trunkX + U*2, trunkTop + trunkH - U, U, U);

    if (v === 1) {
        // Autumn — reddish-orange canopy overlay
        _ditherBayer(c, cx-rx, cy-ry, rx*2, ry, P.M_FOREST, P.M_BRICK, 0.50);
        _ditherBayer(c, cx - Math.floor(rx*0.6), cy - Math.floor(ry*0.5),
            Math.floor(rx*1.2), Math.floor(ry*0.8), P.M_FOREST, P.A_ORANGE, 0.25);
    }
}


// ── DOOR  ────────────────────────────────────────────────────────────
// frame 0 = closed: iron-banded wood door, L_GOLD handle, D_VOID surround
// frame 1 = open:   dark void rectangle, D_STONE threshold line at bottom
function _drawRefDoor(c, T, frame) {
    const P = PALETTE;
    const U = Math.max(1, Math.floor(T / 16));

    // Stone wall background with brick hint
    c.fillStyle = P.D_STONE;
    c.fillRect(0, 0, T, T);
    const brickH = Math.floor(T / 3);
    for (let row = 0; row < 3; row++) {
        const y0 = row * brickH + 1, bh = brickH - 2;
        c.fillStyle = P.M_STONE;  c.fillRect(0, y0, T, bh);
        c.fillStyle = P.L_STONE;  c.fillRect(0, y0, T, 1);
    }

    const frameL = Math.floor(T*0.13), frameR = Math.floor(T*0.87);
    const frameW = frameR - frameL;
    const frameTop = Math.floor(T*0.05), frameBot = Math.floor(T*0.86);
    const archH = Math.floor(T*0.10);
    const dL = frameL + 2, dTop = frameTop + archH;
    const dW = frameW - 4, dH = frameBot - frameTop - archH - 2;

    // D_VOID door recess surround
    c.fillStyle = P.D_VOID;
    c.fillRect(frameL-2, frameTop, frameW+4, frameBot-frameTop);

    // Arch
    c.fillStyle = P.M_CLAY;  c.fillRect(frameL,   frameTop,   frameW,   archH);
    c.fillStyle = P.M_STONE; c.fillRect(frameL+2, frameTop+1, frameW-4, archH-2);

    if (frame === 1) {
        // Open: void interior, D_STONE threshold
        c.fillStyle = P.D_VOID;  c.fillRect(dL, dTop, dW, dH);
        c.fillStyle = P.D_STONE; c.fillRect(dL, dTop+dH-U, dW, U);
    } else {
        // Closed: wood planks with D_BROWN iron bands
        const plankH = Math.floor(dH / 4);
        const plankCols = [P.S_DARK, P.M_CLAY, P.S_DARK, P.S_MID];
        for (let i = 0; i < 4; i++) {
            const py = dTop + i*plankH;
            const ph = (i === 3) ? dH - 3*plankH : plankH;
            c.fillStyle = plankCols[i]; c.fillRect(dL, py, dW, ph-1);
            c.fillStyle = P.L_WHITE;    c.fillRect(dL, py, dW, 1);
            c.fillStyle = P.D_BROWN;    c.fillRect(dL, py+Math.floor(ph*0.6), dW, U);  // iron band
            c.fillStyle = P.D_VOID;
            c.fillRect(dL+Math.floor(dW*0.33), py+1, 1, ph-2);
            c.fillRect(dL+Math.floor(dW*0.66), py+1, 1, ph-2);
        }
        // Panel shadow sides
        c.fillStyle = P.D_VOID;
        c.fillRect(dL,      dTop, 2, dH);
        c.fillRect(dL+dW-2, dTop, 2, dH);
        // L_GOLD handle pixel
        c.fillStyle = P.L_GOLD;
        c.fillRect(dL + Math.floor(dW*0.70), dTop + Math.floor(dH*0.45), U, U*2);
    }

    // Stone threshold step
    const stepH = Math.floor(T*0.14);
    c.fillStyle = P.M_SAND;   c.fillRect(frameL-3, frameBot, frameW+6, stepH);
    c.fillStyle = P.L_WHITE;  c.fillRect(frameL-3, frameBot, frameW+6, 1);
}


// ── STAIRS  ──────────────────────────────────────────────────────────
// up=false: 4 descending M_STONE ledges, D_VOID shadow, D_BLUE void at bottom
// up=true:  4 ascending ledges — L_STONE bright top, rising from M_CLAY floor
function _drawRefStairs(c, T, up) {
    const P = PALETTE;
    const steps = 4;
    const stepH = Math.floor(T / (steps + 1));

    if (!up) {
        c.fillStyle = P.D_BLUE; c.fillRect(0, 0, T, T);
        for (let i = 0; i < steps; i++) {
            const y = i * stepH;
            const inset = i * Math.floor(T / (steps*2 + 1));
            const w = T - inset*2;
            c.fillStyle = P.M_STONE; c.fillRect(inset, y, w, stepH-1);
            c.fillStyle = P.L_STONE; c.fillRect(inset, y, w, 1);          // bright step edge
            c.fillStyle = P.D_VOID;  c.fillRect(inset, y+stepH-1, w, 1);  // riser shadow
        }
        // Bottom D_BLUE void with M_TEAL horizon line
        c.fillStyle = P.D_BLUE;  c.fillRect(0, steps*stepH, T, T - steps*stepH);
        c.fillStyle = P.M_TEAL;  c.fillRect(0, steps*stepH, T, 1);
    } else {
        c.fillStyle = P.M_CLAY; c.fillRect(0, 0, T, T);
        for (let i = steps-1; i >= 0; i--) {
            const y = (steps-1-i) * stepH;
            const inset = i * Math.floor(T / (steps*2 + 1));
            const w = T - inset*2;
            c.fillStyle = (i === steps-1) ? P.L_STONE : P.M_STONE;
            c.fillRect(inset, y, w, stepH-1);
            c.fillStyle = P.L_STONE; c.fillRect(inset, y, w, 1);
            c.fillStyle = P.D_VOID;  c.fillRect(inset, y+stepH-1, w, 1);
        }
        // M_CLAY landing with M_MOSS edge hint
        c.fillStyle = P.M_CLAY; c.fillRect(0, steps*stepH, T, T - steps*stepH);
        c.fillStyle = P.M_MOSS; c.fillRect(0, steps*stepH, T, 1);
    }
}


// ── TORCH  ───────────────────────────────────────────────────────────
// frame 0: L_GOLD core + M_BRICK outer flame pixels
// frame 1: flame shifts 1px up, A_YELLOW tip pixel added
// Glow halo: Bayer-dithered A_YELLOW/transparent ring (~0.22T radius, density 0.12)
// Background painted here so it can be blitted directly over the wall tile.
function _drawRefTorch(c, T, frame) {
    const U  = Math.max(1, Math.floor(T / 16));
    const cx = Math.floor(T * 0.50);

    // Iron wall bracket — dark grey, centered, lower-center of tile
    const bx = Math.floor(T * 0.38), by = Math.floor(T * 0.52);
    const bw = Math.floor(T * 0.24), bh = Math.floor(T * 0.12);
    c.fillStyle = '#3a3a3a';
    c.fillRect(bx, by, bw, bh);
    c.fillStyle = '#5a5a5a';
    c.fillRect(bx, by, bw, 1);    // highlight top

    // Torch body — brown narrow rectangle sitting in bracket
    const tx0 = Math.floor(T * 0.46), ty0 = Math.floor(T * 0.30);
    const tw  = Math.floor(T * 0.08), th  = Math.floor(T * 0.24);
    c.fillStyle = '#6a4a2a';
    c.fillRect(tx0, ty0, tw, th);
    c.fillStyle = '#8a6a4a';
    c.fillRect(tx0, ty0, tw, 1);   // top highlight on torch body

    // Warm glow halo (dithered, behind flame)
    const hr = Math.max(3, Math.floor(T * 0.20));
    const fy = Math.floor(T * 0.22);
    _ditherBayer(c, cx - hr, fy - hr, hr * 2, hr * 2, '#6a4a2a', '#ff8800', 0.10);

    // Flame — 3 frames: tall narrow / medium / short wide
    if (frame === 0) {
        // Tall narrow teardrop
        _ellipse(c, cx, fy,          Math.floor(T*0.060), Math.floor(T*0.105), '#ff6600');
        _ellipse(c, cx, fy + U,      Math.floor(T*0.040), Math.floor(T*0.075), '#ffdd44');
        c.fillStyle = '#ff2200';
        c.fillRect(cx - 1, fy - Math.floor(T*0.105) - 1, 2, 1);
    } else if (frame === 1) {
        // Medium teardrop
        _ellipse(c, cx, fy + U,      Math.floor(T*0.080), Math.floor(T*0.090), '#ff6600');
        _ellipse(c, cx, fy + U*2,    Math.floor(T*0.055), Math.floor(T*0.065), '#ffdd44');
        c.fillStyle = '#ff2200';
        c.fillRect(cx - 1, fy - Math.floor(T*0.080), 2, 1);
    } else {
        // Short wide teardrop
        _ellipse(c, cx, fy + U*2,    Math.floor(T*0.100), Math.floor(T*0.075), '#ff6600');
        _ellipse(c, cx, fy + U*2,    Math.floor(T*0.065), Math.floor(T*0.050), '#ffdd44');
        c.fillStyle = '#ff2200';
        c.fillRect(cx - 1, fy - Math.floor(T*0.060), 2, 1);
    }
    // Bright white core tip
    c.fillStyle = '#ffffcc';
    c.fillRect(cx - 1, fy + U, 2, 1);
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
    // Call at map load time and after every resize to avoid first-frame jank.
    // Falls back to 4 variants for rows not listed in SHEET_LAYOUT
    // (e.g. 'FLOOR_LIGHT', 'FLOOR_DARK').
    warmRow(sheetRow, ts) {
        const entry = SHEET_LAYOUT.rows[sheetRow];
        const variants = entry ? entry.v : 4;
        for (let v = 0; v < variants; v++) this.draw({ drawImage() {} }, sheetRow, v, 0, 0, ts);
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

    // Build enhanced procedural tile as offscreen canvas.
    // Only called during cache warmup — never per-frame.
    _procedural(sheetRow, variant, ts) {
        const c = document.createElement('canvas');
        c.width = c.height = ts;
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        switch (sheetRow) {
            case 'GRASS':       _drawRefGrass(ctx, ts, variant);              break;
            case 'PATH':        _drawRefPath(ctx, ts, variant);               break;
            case 'STONE_PATH':  _drawRefStonePath(ctx, ts, variant);         break;
            case 'WATER':       _drawRefWater(ctx, ts, variant);              break;
            case 'WALL_EXT':    _drawRefWall(ctx, ts, variant, 'EXT');        break;
            case 'WALL_INT':    _drawRefWall(ctx, ts, variant, 'INT');        break;
            case 'WALL_DUN':    _drawRefWall(ctx, ts, variant, 'DUN');        break;
            case 'CEILING':     _drawRefWall(ctx, ts, 0, 'CEILING');          break;
            case 'FLOOR_LIGHT': _drawRefFloor(ctx, ts, variant, false);       break;
            case 'FLOOR_DARK':  _drawRefFloor(ctx, ts, variant, true);        break;
            case 'TREE':        _drawRefTree(ctx, ts, variant);               break;
            case 'DOOR':        _drawRefDoor(ctx, ts, variant);               break;
            case 'STAIRS':      _drawRefStairs(ctx, ts, variant === 1);       break;
            case 'TORCH':       _drawRefTorch(ctx, ts, variant);              break;
            default: {
                // Unknown row — debug checkerboard so missing tiles are obvious
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
