'use strict';

// ═══════════════════════════════════════════════════════
//  TILE DEFINITIONS
// ═══════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════
//  RENDER TRACE  (map array → canvas output)
//
//  1. map.tiles[ty][tx]          → integer tile ID (one of TILE.*)
//  2. drawTile(tile, px, py, tx, ty)  → called from rebuildBgCanvas()
//                                       and drawAnimatedTiles() each frame
//  3. switch(tile) in drawTile() → selects draw function or _tc blit
//  4. _tc['g0'..'g7']            → ctx.drawImage(offscreen canvas, ...)
//     drawWater / drawDoor etc.  → direct ctx.fill* / ctx.arc calls
//  5. Canvas output              → bgCanvas (static) + main ctx (animated)
// ══════════════════════════════════════════════════════════════════════
const TILE = Object.freeze({
    GRASS:          0,   // rich dark green ground
    DIRT_PATH:      1,   // warm sandy brown secondary paths
    BUILDING_FLOOR: 2,   // worn wood plank interior floor
    BUILDING_WALL:  3,   // dark stone brick facade
    TREE:           4,   // deep forest canopy
    WATER:          5,   // deep navy/teal animated water
    DOOR:           6,   // building entrance (interactive)
    STAIRS:         7,   // descent to dungeon
    SIGN:           8,   // interactive sign post
    STAIRSUP:       9,   // ascent / interior exit
    TORCH:          10,  // wall torch (animated)
    STONE_PATH:     11,  // cool gray cobblestone main roads
    VOID:           12,  // null / empty — pure black
});
const WALKABLE = new Set([
    TILE.GRASS, TILE.DIRT_PATH, TILE.STONE_PATH, TILE.BUILDING_FLOOR,
    TILE.DOOR, TILE.STAIRS, TILE.STAIRSUP,
]);
const MINIMAP_COLORS = Object.freeze({
    [TILE.GRASS]:          '#2a4a18',
    [TILE.DIRT_PATH]:      '#6a4a28',
    [TILE.BUILDING_FLOOR]: '#4a3820',
    [TILE.BUILDING_WALL]:  '#1e1818',
    [TILE.TREE]:           '#1a3808',
    [TILE.WATER]:          '#183848',
    [TILE.DOOR]:           '#7a5030',
    [TILE.STAIRS]:         '#806040',
    [TILE.STAIRSUP]:       '#806040',
    [TILE.SIGN]:           '#6a4828',
    [TILE.TORCH]:          '#c07830',
    [TILE.STONE_PATH]:     '#48443c',
    [TILE.VOID]:           '#040308',
});
// Tiles that animate every frame and must bypass the bg cache.
// Only truly animated tiles belong here — static special tiles (STAIRS, STAIRSUP)
// are baked into the bg canvas and handled by spriteRenderer.drawTile normally.
const ANIMATED_TILES = new Set([TILE.WATER, TILE.TORCH]);

// ═══════════════════════════════════════════════════════
//  COLOUR PALETTE  — locked 32-colour pixel-art palette
//  Every tile, sprite, particle and UI element draws
//  exclusively from these values. No arbitrary hex.
// ═══════════════════════════════════════════════════════
const PALETTE = Object.freeze({
    // ── DARKS (5) ────────────────────────────────────────
    D_VOID:    '#04030a',  // 01 deeper void black
    D_BROWN:   '#1a0c04',  // 02 very dark bark
    D_BLUE:    '#0c0c1e',  // 03 deep dungeon void
    D_STONE:   '#141210',  // 04 near-black stone
    D_GREEN:   '#0c2804',  // 05 darkest canopy green

    // ── MIDS (8) ─────────────────────────────────────────
    M_STONE:   '#3a3830',  // 06 aged dark stone
    M_CLAY:    '#4a3018',  // 07 dark earth mortar
    M_MOSS:    '#2a4818',  // 08 deep moss
    M_TEAL:    '#162820',  // 09 dark dungeon teal
    M_SLATE:   '#1e2840',  // 10 deep slate
    M_BRICK:   '#5a1a10',  // 11 dark aged brick
    M_SAND:    '#7a6030',  // 12 aged dirt path
    M_FOREST:  '#1e4010',  // 13 deep forest base

    // ── LIGHTS (7) ───────────────────────────────────────
    L_STONE:   '#786850',  // 14 torchlit stone highlight
    L_PARCH:   '#8a6840',  // 15 aged parchment
    L_GOLD:    '#c07818',  // 16 dim gold
    L_BLUE:    '#4a6878',  // 17 muted pale blue
    L_WHITE:   '#d4c8a0',  // 18 warm candlelight white
    L_LEAF:    '#387820',  // 19 muted leaf green
    L_WATER:   '#2878a0',  // 20 deep dark water

    // ── ACCENTS (6) ──────────────────────────────────────
    A_RED:     '#b01818',  // 21 blood red
    A_ORANGE:  '#c04008',  // 22 deep ember orange
    A_YELLOW:  '#c09010',  // 23 dim lantern yellow
    A_PURPLE:  '#6020a8',  // 24 deep arcane purple
    A_GHOST:   '#607898',  // 25 muted ghost blue
    A_RARE:    '#903070',  // 26 dark rare magenta

    // ── SKIN / FLESH (3) ─────────────────────────────────
    S_PALE:    '#c8a070',  // 27 weathered skin
    S_MID:     '#9a6030',  // 28 dark wood mid
    S_DARK:    '#5a2c10',  // 29 dark wood deep

    // ── UI (3) ───────────────────────────────────────────
    U_BG:      '#0e0a0c',  // 30 UI panel background
    U_GOLD:    '#c8901a',  // 31 UI border gold
    U_TEXT:    '#e8dcc8',  // 32 UI text cream

    // ── MOODY ADDITIONS ──────────────────────────────────
    M_ARCANE:  '#2a1848',  // deep arcane purple-black (magic ambience)
    M_AMBER:   '#6a3808',  // torchlight amber (warm glow base)
    L_AMBER:   '#d08020',  // bright torchlight (flame highlight)
    M_LICHEN:  '#1e3010',  // lichen dark green (aged stone surface)

    // ── SEMANTIC ALIASES (all resolve to values above) ───
    MAP_DARK_BG:   '#04030a',  // = D_VOID
    HP_FULL:       '#387820',  // = L_LEAF
    HP_MID:        '#c07818',  // = L_GOLD
    HP_LOW:        '#b01818',  // = A_RED
    HP_BG:         '#04030a',  // = D_VOID
    XP_FILL:       '#1e2840',  // = M_SLATE
    SHADE_BODY:    '#6020a8',  // = A_PURPLE
    SHADE_EYE:     '#b01818',  // = A_RED
    LURKER_BODY:   '#4a3018',  // = M_CLAY
    LURKER_EYE:    '#c04008',  // = A_ORANGE
    CLASS_WARRIOR: '#c07818',  // = L_GOLD
    CLASS_ROGUE:   '#6020a8',  // = A_PURPLE
    CLASS_WIZARD:  '#4a6878',  // = L_BLUE
    CLASS_CLERIC:  '#c09010',  // = A_YELLOW
    CLOAK_WARRIOR: '#1a0c04',  // = D_BROWN
    CLOAK_ROGUE:   '#0c0c1e',  // = D_BLUE
    CLOAK_WIZARD:  '#0c0c1e',  // = D_BLUE
    CLOAK_CLERIC:  '#141210',  // = D_STONE
    TIMING_MISS:   '#04030a',  // = D_VOID
    TIMING_WEAK:   '#5a1a10',  // = M_BRICK
    TIMING_HIT:    '#2a4818',  // = M_MOSS
    TIMING_CRIT:   '#387820',  // = L_LEAF

    // ── VILLAGE GREENS (grass needs readable range) ──────────
    V_GRASS_BASE:  '#2d5a1b',  // mid forest green — readable grass base
    V_GRASS_MID:   '#3d7a24',  // brighter mid green — grass body
    V_GRASS_HI:    '#5aaa30',  // bright leaf green — grass blade tips / dew
    V_GRASS_DARK:  '#1a3a0e',  // shadow green — tile depth fringe
    V_GRASS_DRY:   '#8a7040',  // dry/dead grass — yellowish tan

    // ── DIRT PATH (needs warm readable browns) ───────────────
    V_DIRT_BASE:   '#7a5530',  // warm mid brown — path base fill
    V_DIRT_LIGHT:  '#a07848',  // light sandy tan — path stone faces
    V_DIRT_DARK:   '#3a2010',  // deep shadow brown — mortar / grout
    V_DIRT_HI:     '#c8a060',  // bright highlight — sun-lit stone top edge

    // ── STONE / COBBLE ───────────────────────────────────────
    V_STONE_BASE:  '#5a5248',  // mid grey-brown stone — cobble base
    V_STONE_HI:    '#8a7c68',  // lighter warm stone — bevel highlight
    V_STONE_DARK:  '#2a2420',  // deep shadow stone — bevel shadow
    V_STONE_MOSS:  '#3a5828',  // mossy stone overlay colour

    // ── TREE / FOLIAGE ───────────────────────────────────────
    V_TREE_DARK:   '#0e2808',  // darkest canopy shadow
    V_TREE_BASE:   '#1e5010',  // main canopy body
    V_TREE_MID:    '#307818',  // mid canopy / inner volume
    V_TREE_HI:     '#4a9e28',  // bright specular patch top-left of canopy
    V_TREE_BARK:   '#3a1e08',  // trunk bark mid tone
    V_TREE_BARK_HI:'#5a3010',  // trunk highlight stripe

    // ── WATER (needs more readable depth range) ──────────────
    V_WATER_DEEP:  '#0a1828',  // deep water — bottom zone
    V_WATER_MID:   '#1a3850',  // mid water — body
    V_WATER_SURF:  '#2a5878',  // surface water — upper zone
    V_WATER_HI:    '#4a88a8',  // highlight line / shimmer
    V_WATER_FOAM:  '#88b8c8',  // foam / specular glint

    // ── WALL / BUILDING ──────────────────────────────────────
    V_WALL_BASE:   '#4a3e30',  // dark stone wall face
    V_WALL_HI:     '#6a5a48',  // lit stone face / top edge
    V_WALL_DARK:   '#1e1810',  // deep shadow / mortar
    V_WALL_MOSS:   '#2e4a18',  // aged moss stain on wall
});

// ═══════════════════════════════════════════════════════
//  ENEMY DEFINITIONS
// ═══════════════════════════════════════════════════════
const ENEMY_DEFS = {
    shade: {
        name:'Shade', hp:22, atk:8, xp:15,
        speed:1100, aggroRange:7, aggroSpeed:420,
        color:PALETTE.SHADE_BODY, eyeColor:PALETTE.SHADE_EYE,
        desc:'A wraith of living shadow.',
    },
    lurker: {
        name:'Cave Lurker', hp:55, atk:18, xp:35,
        speed:1900, aggroRange:3, aggroSpeed:1000,
        color:PALETTE.LURKER_BODY, eyeColor:PALETTE.LURKER_EYE,
        desc:'A massive stone-skinned predator.',
    },
};
const { GRASS:G, DIRT_PATH:P, BUILDING_FLOOR:F, BUILDING_WALL:W, TREE:TR,
        WATER:WA, DOOR:DR, STAIRS:ST, SIGN:SG,
        STAIRSUP:SU, TORCH:TC, STONE_PATH:SP, VOID:VD } = TILE;

// ═══════════════════════════════════════════════════════
//  BIOME NOISE HELPERS
//  Pure value noise — no external dependencies.
//  Used by buildVillageTiles() for organic biome shape
//  generation.  All functions are pure (no side effects).
// ═══════════════════════════════════════════════════════

// Integer hash → float in [0,1)
function _vhash(xi, yi, s) {
    let n = (xi * 374761393 ^ yi * 668265263 ^ s * 1013904223) | 0;
    n = Math.imul(n ^ (n >>> 13), 1664525);
    n = n ^ (n >>> 17);
    n = Math.imul(n, 1013904223);
    return (n >>> 0) / 4294967296;
}
// Bilinear value noise — single octave
function _vnoise(x, y, seed) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);   // smoothstep
    const uy = fy * fy * (3 - 2 * fy);
    return _vhash(ix,   iy,   seed) * (1-ux) * (1-uy)
         + _vhash(ix+1, iy,   seed) *    ux  * (1-uy)
         + _vhash(ix,   iy+1, seed) * (1-ux) *    uy
         + _vhash(ix+1, iy+1, seed) *    ux  *    uy;
}
// Fractional Brownian motion — multi-octave noise
function _vfbm(x, y, seed, oct) {
    let v = 0, a = 0.5, f = 1, m = 0;
    for (let i = 0; i < oct; i++) {
        v += _vnoise(x * f, y * f, seed + i * 97) * a;
        m += a;  a *= 0.5;  f *= 2.1;
    }
    return v / m;
}

// Biome type constants — stored per-tile in map.biomeData (Uint8Array)
const BIOME = Object.freeze({
    VILLAGE:   0,   // sandy warm clearing — village buildings sit here
    GRASSLAND: 1,   // open green grass fields
    DIRT:      2,   // sparse sandy/dry clearings
    FOREST:    3,   // dense tree canopy
});

// Set by buildVillageTiles(); attached to MAPS.village immediately after MAPS is defined
let _villageBiomeData   = null;
let _villageDecorations = null;
let _villageWornPaths   = null;

// ── Phase 3 helpers ─────────────────────────────────────────────────────────

// Replace the uniform FOREST biome fill with organic tree clusters (3-8 tiles each).
// Algorithm: jittered grid seeds cluster centres, randomised BFS grows each cluster
// within FOREST biome only. All other FOREST tiles become walkable GRASS.
function _placeTreeClusters(m, biome, W, H, rng) {
    // Clear every FOREST-biome tile to GRASS so we start with a blank canvas.
    for (let ty = 0; ty < H; ty++)
        for (let tx = 0; tx < W; tx++)
            if (biome[ty * W + tx] === BIOME.FOREST) m[ty][tx] = G;

    const SPACING = 5;
    const DIRS8 = [[0,-1],[1,0],[0,1],[-1,0],[-1,-1],[1,-1],[-1,1],[1,1]];
    const marked = new Uint8Array(W * H);

    // Jittered grid: one candidate per SPACING×SPACING cell
    for (let gy = 0; gy < H; gy += SPACING) {
        for (let gx = 0; gx < W; gx += SPACING) {
            const cx = Math.min(W - 2, Math.floor(gx + rng() * SPACING));
            const cy = Math.min(H - 2, Math.floor(gy + rng() * SPACING));
            if (cx < 1 || cy < 1 || biome[cy * W + cx] !== BIOME.FOREST) continue;

            const clusterSize = 3 + Math.floor(rng() * 6); // 3–8
            const queue = [[cx, cy]];
            let placed = 0;

            while (queue.length > 0 && placed < clusterSize) {
                const qi = Math.floor(rng() * queue.length);
                const [tx, ty] = queue.splice(qi, 1)[0];
                if (tx < 1 || tx >= W-1 || ty < 1 || ty >= H-1) continue;
                if (biome[ty * W + tx] !== BIOME.FOREST) continue;
                if (marked[ty * W + tx]) continue;

                marked[ty * W + tx] = 1;
                m[ty][tx] = TR;
                placed++;

                // Shuffle neighbours before enqueuing (Fisher-Yates)
                const dirs = DIRS8.slice();
                for (let i = dirs.length - 1; i > 0; i--) {
                    const j = Math.floor(rng() * (i + 1));
                    [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
                }
                for (const [dx, dy] of dirs) {
                    const nx = tx + dx, ny = ty + dy;
                    if (nx > 0 && nx < W-1 && ny > 0 && ny < H-1
                        && biome[ny * W + nx] === BIOME.FOREST
                        && !marked[ny * W + nx])
                        queue.push([nx, ny]);
                }
            }
        }
    }
}

// Scatter secondary decorations (stumps, bushes, small plants) based on
// the final tile layout + biome data. Returns an array of
// { tx, ty, type:'stump'|'bush'|'plant', variant:0..2 }.
// Called at the END of buildVillageTiles() so road/building tiles are finalised.
function _placeDecorations(m, biome, W, H, rng) {
    const decs = [];
    const tileAt = (ty, tx) => (ty >= 0 && ty < H && tx >= 0 && tx < W) ? m[ty][tx] : -1;
    for (let ty = 1; ty < H - 1; ty++) {
        for (let tx = 1; tx < W - 1; tx++) {
            const tile = m[ty][tx];
            const b    = biome[ty * W + tx];
            if (tile === G && b === BIOME.FOREST) {
                // GRASS tile inside forest biome = clearing/cluster edge
                const adjTrees = (tileAt(ty-1,tx)===TR) + (tileAt(ty+1,tx)===TR)
                                + (tileAt(ty,tx-1)===TR) + (tileAt(ty,tx+1)===TR);
                if      (adjTrees > 0 && rng() < 0.22)
                    decs.push({tx, ty, type:'stump', variant: Math.floor(rng() * 2)});
                else if (adjTrees === 0 && rng() < 0.14)
                    decs.push({tx, ty, type:'bush',  variant: Math.floor(rng() * 3)});
            } else if (tile === G && b === BIOME.GRASSLAND) {
                // Noise-driven grass variation — dark moss patches and scattered plants
                const pn = _vfbm(tx * 0.45, ty * 0.45, 4447, 2);
                if      (pn > 0.63) decs.push({tx, ty, type:'patch', variant:0}); // mossy shadow
                else if (rng() < 0.07) decs.push({tx, ty, type:'plant', variant: Math.floor(rng() * 3)});
            } else if (tile === G && b === BIOME.DIRT) {
                // Light ground cover in dry clearings
                const pn = _vfbm(tx * 0.55, ty * 0.55, 7771, 2);
                if      (pn > 0.60) decs.push({tx, ty, type:'patch', variant:0}); // dark moss
                else if (rng() < 0.05) decs.push({tx, ty, type:'plant', variant: Math.floor(rng() * 2)});
            } else if (tile === G && b === BIOME.VILLAGE) {
                // Subtle tonal variation across the village ground
                const pn = _vfbm(tx * 0.35, ty * 0.35, 2231, 3);
                if      (pn > 0.65) decs.push({tx, ty, type:'patch', variant:0}); // mossy darker
                else if (rng() < 0.05) decs.push({tx, ty, type:'plant', variant: Math.floor(rng() * 3)});
            }
        }
    }
    return decs;
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


// ── Phase 1b: organic grass fringe ──────────────────────────────────────────
// After the biome pass (all non-forest → P) and after tree cluster placement,
// promote sandy PATH tiles that sit directly next to a tree tile into GRASS tiles.
// This creates an organic green fringe at the forest boundary without any hard
// rectangular border.
//
//   dist=1 (Chebyshev)  → always GRASS  (hard inner edge)
//   dist=2              → GRASS if noise > 0.45  (soft organic outer ring)
//
// The result: sandy ground up to the forest, then a 1–2 tile green fringe,
// then tree canopy — matching the reference palette exactly.
function _placeGrassFringe(m, W, H) {
    const isTree = (ty, tx) =>
        ty >= 0 && ty < H && tx >= 0 && tx < W && m[ty][tx] === TR;

    for (let ty = 1; ty < H - 1; ty++) {
        for (let tx = 1; tx < W - 1; tx++) {
            if (m[ty][tx] !== G) continue; // only promote open ground tiles

            // Find nearest tree tile within Chebyshev radius 2
            let minDist = 99;
            for (let dy = -2; dy <= 2; dy++) {
                for (let dx = -2; dx <= 2; dx++) {
                    if (isTree(ty + dy, tx + dx))
                        minDist = Math.min(minDist, Math.max(Math.abs(dx), Math.abs(dy)));
                }
            }

            if      (minDist === 1) m[ty][tx] = G;  // always fringe
            else if (minDist === 2) {
                // Organic outer ring — use value noise so the edge is
                // blobby rather than a perfect 2-tile border.
                const n = _vfbm(tx * 0.60, ty * 0.60, 8831, 2);
                if (n > 0.45) m[ty][tx] = G;
            }
        }
    }
}


// ── Phase 4: village transitional zone ──────────────────────────────────────
// Creates the visual border between the sandy village and the outer biomes:
//   • Road shoulders — PATH tiles 1-2 tiles off the main spines through grassland,
//     making the approach routes look wide and worn rather than ruler-straight.
//   • Scattered outpost trees — individual TR tiles at low probability across
//     GRASSLAND, creating the sparse canopy seen between forest and settlement.
// Called after _placeTreeClusters so it only modifies unmodified GRASS tiles.
function _placeVillageTransition(m, biome, W, H, rng) {
    for (let ty = 1; ty < H - 1; ty++) {
        for (let tx = 1; tx < W - 1; tx++) {
            if (biome[ty * W + tx] !== BIOME.GRASSLAND) continue;
            if (m[ty][tx] !== G) continue; // only open grass tiles

            // Chebyshev distance to the main road spines (N-S x=21,22; E-W y=16,17)
            const dNS = Math.min(Math.abs(tx - 21), Math.abs(tx - 22));
            const dEW = Math.min(Math.abs(ty - 16), Math.abs(ty - 17));
            const rd  = Math.min(dNS, dEW);

            // Scatter trees — denser further from roads for a natural treeline feel
            if      (rd > 5  && rng() < 0.20) m[ty][tx] = TR;
            else if (rd > 3  && rng() < 0.10) m[ty][tx] = TR;
        }
    }
}

// ── Phase 5: worn-path classification ───────────────────────────────────────
// Returns a Uint8Array (one byte per tile, same WxH layout as tiles).
//   0 = no worn effect
//   1 = main road spine (N-S or E-W) — subtle central lighter band
//   2 = building connector (adjacent to a DOOR tile) — more prominent wear
// Only PATH tiles receive non-zero values.
function _buildWornPathMap(m, W, H) {
    const worn = new Uint8Array(W * H);
    for (let ty = 0; ty < H; ty++) {
        for (let tx = 0; tx < W; tx++) {
            if (m[ty][tx] !== SP) continue;
            if (tx === 21 || tx === 22 || ty === 16 || ty === 17) {
                worn[ty * W + tx] = 1; // main spine
                continue;
            }
            // Near a DOOR tile → high-traffic connector
            if ((m[ty > 0     ? ty-1 : 0  ][tx] === DR) ||
                (m[ty < H-1 ? ty+1 : H-1][tx] === DR) ||
                (m[ty][tx > 0     ? tx-1 : 0  ] === DR) ||
                (m[ty][tx < W-1 ? tx+1 : W-1] === DR))
                worn[ty * W + tx] = 2;
        }
    }
    return worn;
}

// ═══════════════════════════════════════════════════════
//  MAP TILE DATA
// ═══════════════════════════════════════════════════════
function buildVillageTiles() {
    const W_=48, H_=36;
    const m = Array.from({length:H_}, () => new Array(W_).fill(TR));
    const s = (x,y,t) => { if(y>=0&&y<H_&&x>=0&&x<W_) m[y][x]=t; };
    const fill = (x1,y1,x2,y2,t) => { for(let y=y1;y<=y2;y++) for(let x=x1;x<=x2;x++) s(x,y,t); };
    const house = (x1,y1,x2,y2) => { fill(x1,y1,x2,y2,W); };

    // ── 1. Noise-based biome terrain ────────────────────────────────
    //  Replaces the old rectangular fill + hand-placed tree blocks.
    //  Every cell is assigned a BIOME type first, then mapped to a tile:
    //    VILLAGE   → P  (sandy/warm dirt ground — matches reference art)
    //    GRASSLAND → G  (rich green grass fields)
    //    DIRT      → P  (sandy clearing — same tile, different variant via hash)
    //    FOREST    → TR (tree canopy — buildings/roads placed below overwrite)
    //
    //  Three noise layers at different scales produce organically shaped
    //  biome blobs.  Village center is forced by a radial distance falloff
    //  so the clearing always surrounds the town buildings.  A feathered
    //  transition ring (dist 0.25–0.44) blends village↔grassland using a
    //  noise threshold that shifts with distance — 2-3 tile wide organic edge.
    //
    //  All generation is O(W_×H_) — completes in <1 ms at 48×36.
    //  Output stored in _villageBiomeData, attached to MAPS.village below.
    const _biome = new Uint8Array(W_ * H_);
    for (let _ty = 0; _ty < H_; _ty++) {
        for (let _tx = 0; _tx < W_; _tx++) {
            // Normalised coords — centre = (0.5, 0.5)
            const _nx = _tx / W_,  _ny = _ty / H_;
            const _dx = _nx - 0.5, _dy = _ny - 0.5;
            const _d  = Math.sqrt(_dx * _dx + _dy * _dy);

            // Three independent noise fields
            const _bn = _vfbm(_nx * 2.8, _ny * 2.8, 42,  4); // primary biome shape
            const _fn = _vfbm(_nx * 3.5, _ny * 3.5, 239, 3); // forest clustering
            const _dn = _vfbm(_nx * 5.2, _ny * 5.2, 571, 3); // dirt patch detail

            let _b;
            if (_tx === 0 || _tx === W_-1 || _ty === 0 || _ty === H_-1) {
                _b = BIOME.FOREST;                              // 1-tile hard border
            } else if (_d < 0.25) {
                _b = BIOME.VILLAGE;                             // village core
            } else if (_d < 0.44) {
                // Feathered edge: noise threshold grows with distance so the
                // transition is 2-3 tiles wide and organically shaped, never
                // a hard circle or rectangle.
                const _t = (_d - 0.25) / 0.19;                 // 0→1 across ring
                _b = _bn > 0.43 + _t * 0.22 ? BIOME.VILLAGE : BIOME.GRASSLAND;
            } else {
                if      (_fn > 0.55)  _b = BIOME.FOREST;
                else if (_dn < 0.32)  _b = BIOME.DIRT;
                else                  _b = BIOME.GRASSLAND;
            }

            _biome[_ty * W_ + _tx] = _b;
            // All non-forest biomes start as sandy PATH (warm dirt).
            // Green GRASS is placed only at the forest fringe by _placeGrassFringe().
            m[_ty][_tx] = _b === BIOME.FOREST ? TR : G;
        }
    }
    _villageBiomeData = _biome;

    // ── 1b. Cluster tree placement ───────────────────────────────────────────
    // Replace the solid FOREST-biome fill with organic clusters of 3-8 trees.
    _placeTreeClusters(m, _biome, W_, H_, _rng(777));

    // ── 1c. Organic grass fringe (Phase 1b) ──────────────────────────────────
    // Promote sandy tiles that touch a tree tile into GRASS tiles.
    // Runs AFTER _placeTreeClusters so tree positions are finalised.
    _placeGrassFringe(m, W_, H_);

    // ── 1d. Village transitional zone (Phase 4) ───────────────────────────────
    // Scattered outpost trees in the sandy ring around the village.
    // Must run AFTER _placeGrassFringe so it only touches unmodified PATH tiles.
    _placeVillageTransition(m, _biome, W_, H_, _rng(551));

    // ── 2. Main roads ────────────────────────────────────────
    // N–S spine x=21,22; E–W spine y=16,17 → stone-paved main roads
    // Secondary building connectors stay as DIRT_PATH (P)
    fill(21,1,22,34, SP);
    fill(1,16,46,17, SP);

    // ── 4. Pond (NW decorative water feature) ────────────────
    //  Water: x=13–19, y=3–12  (safely west of N–S road x=21)
    fill(13,3,19,12, WA);
    fill(12,2,20,2,  SP);   // north rim path
    fill(12,13,20,13,SP);   // south rim path
    fill(12,2,12,13, SP);   // west rim path
    // east rim is x=20, adjacent to N–S road at x=21 (already path)

    // ── 5. Buildings ──────────────────────────────────────────
    // Layout (verified non-overlapping, no road tiles covered):
    //   A: Elder's Hall    x= 2–11, y= 2–11   (NW)
    //   B: Merchant House  x=24–30, y= 2– 9   (NE upper)
    //   C: Blacksmith      x=33–43, y= 2–11   (NE)
    //   D: Tavern          x= 2–12, y=19–27   (SW)
    //   E: Market Hall     x=24–36, y=19–27   (SE upper)
    //   F: Small Cottage   x= 2– 9, y=29–34   (SW lower)
    //   G: Chapel          x=27–36, y=29–34   (SE lower)
    //   H: Veyla's Cottage x=38–45, y=19–26   (SE right)

    // A: Elder's Hall — 10×10
    house(2,2, 11,11);
    s(6,11,DR); s(7,11,DR);             // south entrance

    // B: Merchant House — 7×8
    house(24,2, 30,9);
    s(26,9,DR); s(27,9,DR);             // south entrance

    // C: Blacksmith — 11×10
    house(33,2, 43,11);
    s(36,11,DR); s(37,11,DR);           // south entrance

    // D: Tavern — 11×9
    house(2,19, 12,27);
    s(6,19,DR); s(7,19,DR);             // north entrance (faces E–W road gap at y=18)

    // E: Market Hall — 13×9
    house(24,19, 36,27);
    s(24,22,DR); s(24,23,DR);           // west entrance (faces N–S road at x=22)

    // F: Small Cottage — 8×6
    house(2,29, 9,34);
    s(9,31,DR); s(9,32,DR);             // east entrance

    // G: Chapel — 10×6
    house(27,29, 36,34);
    s(30,29,DR); s(31,29,DR);           // north entrance

    // H: Veyla's Cottage — 8×8
    house(38,19, 45,26);
    s(41,19,DR); s(42,19,DR);           // north entrance (faces E–W road at y=17)

    // ── 6. Connecting paths ───────────────────────────────────
    // A south exit → E–W road
    fill(6,12,7,16, SP);
    // Horizontal shortcut east across the NW quadrant to N–S road
    fill(6,13,20,13, SP);

    // B south → E–W road
    fill(26,10,27,16, SP);

    // C south → E–W road
    fill(36,12,37,16, SP);

    // D north door gap (y=18) → E–W road at y=17
    fill(6,18,7,18, SP);
    // D south step
    fill(5,28,6,28, SP);

    // F east door → N–S road
    fill(10,31,20,32, SP);

    // E west door → N–S road
    fill(23,22,23,23, SP);
    // E south → G north
    fill(29,28,31,28, SP);

    // H north door gap (y=18) → E–W road at y=17
    fill(41,18,42,18, SP);

    // ── 7. Signs ────────────────────────────────────────────
    s(21,8,  SG);   // village welcome sign (on N–S road, y=8)
    s(21,32, SG);   // dungeon warning sign

    // ── 8. Dungeon stairs ────────────────────────────────────
    s(21,34, ST);
    s(22,34, ST);

    // ── 9. Secondary decorations (Phase 3 + 5) ───────────────
    // Run AFTER all roads/buildings are finalised so we never place a decoration
    // under a WALL or on a PATH road tile.
    _villageDecorations = _placeDecorations(m, _biome, W_, H_, _rng(913));

    // ── 10. Worn-path map (Phase 5) ───────────────────────────
    // Classify high-traffic PATH tiles for the lighter overlay drawn in bgCanvas.
    _villageWornPaths = _buildWornPathMap(m, W_, H_);

    return m;
}

// ═══════════════════════════════════════════════════════
//  PROCEDURAL MINE GENERATOR
//  Generates a large connected cave network using Prim's
//  MST room connection + L-shaped mine shaft corridors.
// ═══════════════════════════════════════════════════════
function buildMineTiles(rng) {
    const MW = 100, MH = 65;
    const tiles = Array.from({length:MH}, () => new Array(MW).fill(W));
    const rooms = [], signs = [];

    // ── 1. Room placement ─────────────────────────────────
    const TARGET = 24, TRIES = 600, PAD = 2;
    for (let t = 0; t < TRIES && rooms.length < TARGET; t++) {
        const rw = 5  + Math.floor(rng() * 11);   // 5–15 wide
        const rh = 4  + Math.floor(rng() * 7);    // 4–10 tall
        const rx = 2  + Math.floor(rng() * (MW - rw - 4));
        const ry = 2  + Math.floor(rng() * (MH - rh - 4));
        const bad = rooms.some(r =>
            rx < r.x+r.w+PAD && rx+rw+PAD > r.x &&
            ry < r.y+r.h+PAD && ry+rh+PAD > r.y);
        if (!bad) rooms.push({x:rx,y:ry,w:rw,h:rh,
            cx:rx+Math.floor(rw/2), cy:ry+Math.floor(rh/2)});
    }

    // Fill rooms with FLOOR
    for (const r of rooms)
        for (let y=r.y; y<r.y+r.h; y++)
            for (let x=r.x; x<r.x+r.w; x++) tiles[y][x]=F;

    // ── 2. Corridor carving (Prim MST + extra loops) ──────
    const dig = (x,y) => { if(x>=1&&x<MW-1&&y>=1&&y<MH-1) tiles[y][x]=F; };
    const carve = (x1,y1,x2,y2,wide=false) => {
        const hf = rng()>.5;
        const row = (y,xa,xb) => { for(let x=Math.min(xa,xb);x<=Math.max(xa,xb);x++){dig(x,y);if(wide)dig(x,y+1);} };
        const col = (x,ya,yb) => { for(let y=Math.min(ya,yb);y<=Math.max(ya,yb);y++){dig(x,y);if(wide)dig(x+1,y);} };
        if (hf) { row(y1,x1,x2); col(x2,y1,y2); }
        else    { col(x1,y1,y2); row(y2,x1,x2); }
    };

    // Prim's algorithm — connect each room to nearest in-tree room
    const inTree = new Set([0]);
    while (inTree.size < rooms.length) {
        let bDist=Infinity, bI=-1, bJ=-1;
        for (const i of inTree) {
            for (let j=0;j<rooms.length;j++) {
                if (inTree.has(j)) continue;
                const dx=rooms[i].cx-rooms[j].cx, dy=rooms[i].cy-rooms[j].cy;
                const d=dx*dx+dy*dy;
                if (d<bDist){bDist=d;bI=i;bJ=j;}
            }
        }
        if (bJ===-1) break;
        inTree.add(bJ);
        carve(rooms[bI].cx,rooms[bI].cy,rooms[bJ].cx,rooms[bJ].cy, rng()<.22);
    }
    // Extra loops for interest (~25% extra connections)
    for (let i=0;i<Math.floor(rooms.length*.25);i++) {
        const a=Math.floor(rng()*rooms.length), b=Math.floor(rng()*rooms.length);
        if (a!==b) carve(rooms[a].cx,rooms[a].cy,rooms[b].cx,rooms[b].cy);
    }

    // ── 3. Torches ────────────────────────────────────────
    for (const r of rooms) {
        const count = r.w>=9 ? 2 : 1;
        for (let i=0;i<count;i++) {
            const tx = r.x+1+Math.floor(i*(r.w-3)/Math.max(count-1,1));
            tiles[r.y][Math.min(tx,r.x+r.w-2)] = TC;
        }
    }

    // ── 4. Underground water pools ────────────────────────
    let wc=0;
    for (let ri=3; ri<rooms.length && wc<6; ri++) {
        const r=rooms[ri];
        if (r.w<7||r.h<5||rng()>.35) continue;
        const wx=r.x+1+Math.floor(rng()*(r.w-4));
        const wy=r.y+1+Math.floor(rng()*(r.h-3));
        const ww=1+Math.floor(rng()*3), wh=1+Math.floor(rng()*2);
        for (let py=wy;py<=Math.min(wy+wh,r.y+r.h-2);py++)
            for (let px=wx;px<=Math.min(wx+ww,r.x+r.w-2);px++)
                if (tiles[py][px]===F) tiles[py][px]=WA;
        wc++;
    }

    // ── 5. Lore signs ─────────────────────────────────────
    const LORE = [
        'Day 12. The sounds have returned.\nHenrick says to ignore them.\nI am trying.',
        'DANGER — SHAFT UNSTABLE\nProceed at your own risk.\n\nManagement accepts\nno liability.',
        'The ore ran dry at depth four.\nThe miners kept digging.\nThey found something else.',
        'If you find this note:\nWE MADE IT TO THE EAST PASSAGE.\nWe did not make it out.',
        '— H.D. WAS HERE —\nDay 47. Still breathing.\nSomething in the dark breathes back.',
        'DEPTH MARKER: LOWER LEVEL\nTurn-back rate: 100%\nSurvival rate: pending.',
        'Do not answer the voice.\nIt learns your name.\nThen it uses it.',
        'Property of the Eldoria Mining Guild\nFounded Year of the Third Moon\n[THE REST IS SCRATCHED OUT]',
    ];
    let li=0;
    for (let ri=1; ri<rooms.length&&li<LORE.length; ri++) {
        if (rng()>.45) continue;
        const r=rooms[ri];
        const sx=r.x+1, sy=r.y;
        if (tiles[sy][sx]===TC||tiles[sy][sx]===SG) continue;
        tiles[sy][sx]=SG;
        signs.push({x:sx,y:sy,text:LORE[li++]});
    }

    // Ancient tablet (Veyla's quest) — deep room, not the exit room
    const deepIdx = Math.min(
        Math.floor(rooms.length*.65)+Math.floor(rng()*Math.floor(rooms.length*.30)),
        rooms.length-1);
    const deepR = rooms[deepIdx];
    const tabX=deepR.x+Math.floor(deepR.w/2), tabY=deepR.y;
    if (tiles[tabY][tabX]!==SG&&tiles[tabY][tabX]!==TC) {
        tiles[tabY][tabX]=SG;
        signs.push({x:tabX,y:tabY,
            text:'— ANCIENT TABLET —\n\n[Written in Old Script, barely legible...]\n\n"Here rests the Hollow King, sealed by the Three Wardens\nin the Age Before Memory. Should the seal fracture,\ndarkness will pour forth until the realm above\nknows only endless night."\n\n[The stone is cracked. Something has been pressing from within.]',
            questComplete:{given:'quest_sealed_truth_given',complete:'quest_sealed_truth_complete'}
        });
    }

    // ── 6. Player start + exit stairsup ───────────────────
    const startR = rooms[0];
    // StairsUp at center of entry room
    tiles[startR.cy][startR.cx] = SU;
    // Player spawns one step south
    const ps = { x:startR.cx, y:Math.min(startR.cy+1, startR.y+startR.h-2) };
    if (tiles[ps.y][ps.x]!==F) tiles[ps.y][ps.x]=F;

    // ── 7. Item + NPC positions ───────────────────────────
    // Henrick's ring — farthest room from start
    let farR=rooms[1], farD=0;
    for (let ri=1;ri<rooms.length;ri++) {
        const dx=rooms[ri].cx-startR.cx, dy=rooms[ri].cy-startR.cy;
        const d=dx*dx+dy*dy;
        if (d>farD){farD=d;farR=rooms[ri];}
    }
    const itemPos = { x:farR.cx, y:farR.cy };

    // Mira's ghost — mid-map room
    const ghostR = rooms[Math.floor(rooms.length*.4)];
    const ghostPos = { x:ghostR.cx, y:ghostR.cy };

    // ── 8. Enemy spawns ──────────────────────────────────
    // Skip room 0 (entry), ghost room, and item room to avoid overcrowding
    const enemySpawns = [];
    const skipRooms = new Set([0, Math.floor(rooms.length*.4), deepIdx]);
    for (let ri = 1; ri < rooms.length; ri++) {
        if (skipRooms.has(ri)) continue;
        const r = rooms[ri];
        // Lurker every 5 rooms (slow, tanky), Shade every other room (fast, weak)
        if (ri % 5 === 2) {
            enemySpawns.push({ type:'lurker', x:r.cx, y:r.cy });
        } else if (ri % 2 === 1) {
            enemySpawns.push({ type:'shade', x:r.cx, y:r.cy });
        }
    }

    return { tiles, w:MW, h:MH, playerStart:ps, signs, itemPos, ghostPos, enemySpawns };
}

// Shared tile-map builder helpers — used by all buildXxxInterior() functions.
// Must be called with the local map array `m` already in scope via destructuring:
//   const { s, fill } = _makeTileHelpers(m);
function _makeTileHelpers(m) {
    const s    = (x,y,t)           => { m[y][x]=t; };
    const fill = (x1,y1,x2,y2,t)  => { for(let y=y1;y<=y2;y++) for(let x=x1;x<=x2;x++) s(x,y,t); };
    return { s, fill };
}

function buildEldersHallInterior() {
    const W_=14, H_=12;
    const m = Array.from({length:H_}, () => new Array(W_).fill(W));
    const { s, fill } = _makeTileHelpers(m);
    fill(1,1,W_-2,H_-2, F);
    // Torches on north wall
    s(3,0,TC); s(10,0,TC);
    // Council table (hollow rectangle)
    fill(2,2,11,5,W); fill(3,3,10,4,F);
    // Bookcase strip on east wall
    fill(12,1,12,5,W);
    // Notice board sign on north wall
    s(6,0,SG);
    // Exit tiles
    s(6,H_-2,SU); s(7,H_-2,SU);
    return m;
}

function buildMerchantInterior() {
    const W_=12, H_=10;
    const m = Array.from({length:H_}, () => new Array(W_).fill(W));
    const { s, fill } = _makeTileHelpers(m);
    fill(1,1,W_-2,H_-2, F);
    s(2,0,TC); s(9,0,TC);
    // L-shape counter
    fill(1,2,8,2,W);
    s(8,3,W); s(8,4,W);
    // Goods display east
    fill(10,2,10,5,W);
    s(5,H_-2,SU); s(6,H_-2,SU);
    return m;
}

function buildBlacksmithInterior() {
    const W_=14, H_=12;
    const m = Array.from({length:H_}, () => new Array(W_).fill(W));
    const { s, fill } = _makeTileHelpers(m);
    fill(1,1,W_-2,H_-2, F);
    s(2,0,TC); s(11,0,TC);
    // Forge torch (east side — forge fire)
    s(11,1,TC);
    // Anvil
    s(9,3,W);
    // Tool rack on north wall
    fill(2,1,6,1,W);
    // Weapon rack on west wall
    fill(1,2,1,6,W);
    s(6,H_-2,SU); s(7,H_-2,SU);
    return m;
}

function buildTavernInterior() {
    const W_=14, H_=12;
    const m = Array.from({length:H_}, () => new Array(W_).fill(W));
    const { s, fill } = _makeTileHelpers(m);
    fill(1,1,W_-2,H_-2, F);
    s(2,0,TC); s(11,0,TC);
    // Bar counter (L-shape)
    fill(1,2,9,2,W);
    fill(1,3,1,5,W);
    // 2 tables
    fill(4,5,5,6,W); fill(8,5,9,6,W);
    // Barrels on east wall
    fill(12,3,12,6,W);
    s(6,H_-2,SU); s(7,H_-2,SU);
    return m;
}

function buildMarketInterior() {
    const W_=16, H_=12;
    const m = Array.from({length:H_}, () => new Array(W_).fill(W));
    const { s, fill } = _makeTileHelpers(m);
    fill(1,1,W_-2,H_-2, F);
    s(2,0,TC); s(13,0,TC);
    // 3 market stalls
    fill(2,2,4,4,W); fill(7,2,9,4,W); fill(12,2,14,4,W);
    s(7,H_-2,SU); s(8,H_-2,SU);
    return m;
}

function buildCottageInterior() {
    const W_=10, H_=10;
    const m = Array.from({length:H_}, () => new Array(W_).fill(W));
    const { s, fill } = _makeTileHelpers(m);
    fill(1,1,W_-2,H_-2, F);
    s(2,0,TC); s(7,0,TC);
    // Bed (NE)
    fill(8,1,8,3,W);
    // Table
    fill(2,2,3,3,W);
    // Fireplace on west wall
    s(1,4,TC);
    s(4,H_-2,SU); s(5,H_-2,SU);
    return m;
}

function buildChapelInterior() {
    const W_=12, H_=12;
    const m = Array.from({length:H_}, () => new Array(W_).fill(W));
    const { s, fill } = _makeTileHelpers(m);
    fill(1,1,W_-2,H_-2, F);
    s(2,0,TC); s(9,0,TC);
    // Altar signs on north wall
    s(5,0,SG); s(6,0,SG);
    // Altar flanking walls
    s(3,2,W); s(4,2,W); s(7,2,W); s(8,2,W);
    // Pews (2 rows of 2)
    fill(2,5,3,5,W); fill(8,5,9,5,W);
    fill(2,7,3,7,W); fill(8,7,9,7,W);
    s(5,H_-2,SU); s(6,H_-2,SU);
    return m;
}

function buildVeylaInterior() {
    const W_=12, H_=10;
    const m = Array.from({length:H_}, () => new Array(W_).fill(W));
    const { s, fill } = _makeTileHelpers(m);
    fill(1,1,W_-2,H_-2, F);
    s(2,0,TC); s(9,0,TC);
    // Bookshelves on east/west walls
    fill(1,2,1,5,W); fill(10,2,10,5,W);
    // Crystal table centerpiece (hollow)
    fill(4,3,7,4,W); fill(5,3,6,4,F);
    s(5,H_-2,SU); s(6,H_-2,SU);
    return m;
}

// ═══════════════════════════════════════════════════════
//  WORLD ENTITY DATA
// ═══════════════════════════════════════════════════════
const GUIDE_NPCS = [
    { id:'guide', name:'Rowan', x:21, y:15, portrait:'🧑', color:'#80c870', history:[],
      role:'A friendly young villager who greets newcomers and introduces them to Eldoria.' },
];

const VILLAGE_NPCS = [];  // Major NPCs are inside buildings; Rowan stays in the village square

const ELDER_NPCS = [
    { id:'elder', name:'Elder Maren', x:6, y:5, portrait:'👴', color:'#d0c870', history:[],
      role:'The elderly leader of Eldoria. Wise but frightened — darkness spreads from the Cursed Mines to the south. He desperately needs someone to investigate. He will explicitly ask the player to enter the mines, promising a reward. If the player has entered the mines (quest_into_dark_complete=true), he reacts with relief and asks what they found.' },
];

const BLACKSMITH_NPCS = [
    { id:'blacksmith', name:'Daran', x:4, y:4, portrait:'🔨', color:'#d07040', history:[],
      role:'The village blacksmith. Gruff, grieving. His brother Henrick went into the mines 3 months ago and never returned. He will ask the player to look for any sign of Henrick. If quest_brothers_fate_complete=true (Henrick\'s ring found), he breaks down and thanks the player, and says at least now he knows.' },
];

const VEYLA_NPCS = [
    { id:'traveler', name:'Veyla', x:5, y:2, portrait:'🧝', color:'#70a0e0', history:[],
      role:'A mysterious elven wanderer. Cryptic, testing. She knows an ancient sealed entity called the Hollow King lies in the mines. She will ask the player to find the ancient tablet that describes the seal. If quest_sealed_truth_complete=true, she reveals she is a Warden\'s descendant sent to reinforce the seal.' },
];

const VILLAGE_SIGNS = [
    { x:21, y:8, text:'— ELDORIA —\n\nFounded in the Year of the Third Moon.\nPopulation: 23.\n\n"May the Old Gods light your path."' },
    { x:21, y:32, text:'THE CURSED MINES\n\n"Turn back. Whatever you hear below,\ndo not answer it."\n\n— scratched into the stone by a shaking hand', type:'stairs' },
];

const DUNGEON_NPCS = [
    { id:'ghost', name:"Mira's Ghost", x:5, y:12, portrait:'👻', color:'rgba(160,200,255,0.85)', history:[], ghost:true,
      role:'The ghost of Mira, a young woman who died in the Cursed Mines three months ago. She is confused and fragmented, unable to fully remember what happened. She knows Henrick — he survived longer than the others and made it to the eastern passage before succumbing. She felt the presence of something cold and immense in the deep. She can guide the player east toward where Henrick fell.' },
];

// Dungeon signs are generated procedurally by buildMineTiles()

const DUNGEON_ITEMS = [
    { id:'henrick_ring', name:"Henrick's Ring", x:25, y:13, color:'#e8c050', icon:'💍',
      desc:"A worn iron ring with 'H.D.' engraved on the inside. This belonged to Daran's brother.",
      questRequired:'quest_brothers_fate_given',
      questComplete:'quest_brothers_fate_complete' },
];

// ═══════════════════════════════════════════════════════
//  MAP DEFINITIONS
// ═══════════════════════════════════════════════════════
const MAPS = {
    village: {
        id:'village', w:48, h:36,
        tiles: buildVillageTiles(),
        npcs:  [...VILLAGE_NPCS, ...GUIDE_NPCS],
        signs: VILLAGE_SIGNS,
        items: [],
        playerStart:{x:21,y:16},
        name:'Eldoria Village',
        dark:false,
    },
    dungeon_1: {
        id:'dungeon_1', w:100, h:65,
        tiles: [],          // populated by rebuildDungeon()
        npcs:  DUNGEON_NPCS,
        signs: [],          // populated by rebuildDungeon()
        items: [],          // populated by rebuildDungeon()
        enemies: [],        // populated by rebuildDungeon()
        playerStart:{x:5,y:5}, // populated by rebuildDungeon()
        name:'Cursed Mines',
        dark:true,
    },
    int_elder: {
        id:'int_elder', w:14, h:12,
        tiles: buildEldersHallInterior(),
        npcs:  ELDER_NPCS,
        signs: [{ x:6, y:0, text:"ELDER'S HALL\n\nThe council chamber of Eldoria.\nAll matters of import are decided here." }],
        items: [],
        playerStart:{x:6, y:8},
        name:"Elder's Hall",
        dark:false,
        returnMap:'village', returnX:6, returnY:12,
    },
    int_merchant: {
        id:'int_merchant', w:12, h:10,
        tiles: buildMerchantInterior(),
        npcs:  [],
        signs: [],
        items: [],
        playerStart:{x:5, y:6},
        name:'Merchant House',
        dark:false,
        returnMap:'village', returnX:26, returnY:10,
    },
    int_blacksmith: {
        id:'int_blacksmith', w:14, h:12,
        tiles: buildBlacksmithInterior(),
        npcs:  BLACKSMITH_NPCS,
        signs: [],
        items: [],
        playerStart:{x:6, y:8},
        name:"Daran's Forge",
        dark:false,
        returnMap:'village', returnX:36, returnY:12,
    },
    int_tavern: {
        id:'int_tavern', w:14, h:12,
        tiles: buildTavernInterior(),
        npcs:  [],
        signs: [],
        items: [],
        playerStart:{x:6, y:8},
        name:'The Wanderer\'s Rest',
        dark:false,
        returnMap:'village', returnX:6, returnY:18,
    },
    int_market: {
        id:'int_market', w:16, h:12,
        tiles: buildMarketInterior(),
        npcs:  [],
        signs: [],
        items: [],
        playerStart:{x:7, y:8},
        name:'Market Hall',
        dark:false,
        returnMap:'village', returnX:23, returnY:22,
    },
    int_cottage: {
        id:'int_cottage', w:10, h:10,
        tiles: buildCottageInterior(),
        npcs:  [],
        signs: [],
        items: [],
        playerStart:{x:4, y:6},
        name:'Village Cottage',
        dark:false,
        returnMap:'village', returnX:10, returnY:31,
    },
    int_chapel: {
        id:'int_chapel', w:12, h:12,
        tiles: buildChapelInterior(),
        npcs:  [],
        signs: [{ x:5, y:0, text:"CHAPEL OF THE OLD GODS\n\n\"Light endures.\nDarkness merely waits its turn.\"\n\n— The Third Scripture" },
                { x:6, y:0, text:"CHAPEL OF THE OLD GODS\n\n\"Light endures.\nDarkness merely waits its turn.\"\n\n— The Third Scripture" }],
        items: [],
        playerStart:{x:5, y:8},
        name:'Chapel of the Old Gods',
        dark:false,
        returnMap:'village', returnX:30, returnY:28,
    },
    int_veyla: {
        id:'int_veyla', w:12, h:10,
        tiles: buildVeylaInterior(),
        npcs:  VEYLA_NPCS,
        signs: [],
        items: [],
        playerStart:{x:5, y:6},
        name:"Veyla's Study",
        dark:false,
        returnMap:'village', returnX:41, returnY:18,
    },
};

// Attach noise-generated biome data produced by buildVillageTiles()
// Must be after MAPS so the object exists; biomeData is used by Phase 2+
// decoration, transition tile selection, and cluster placement.
MAPS.village.biomeData    = _villageBiomeData;
MAPS.village.decorations  = _villageDecorations;
MAPS.village.wornPaths    = _villageWornPaths;

// ── Rebuild dungeon with fresh procedural generation ────
function rebuildDungeon() {
    const seed = Math.floor(Math.random() * 0xFFFFFF);
    const data = buildMineTiles(_rng(seed));
    const d = MAPS.dungeon_1;
    d.tiles = data.tiles;
    d.variantMap = null; // tiles changed — rebuilt lazily on next rebuildBgCanvas
    d.w = data.w; d.h = data.h;
    d.playerStart = data.playerStart;
    d.signs = data.signs;
    d.items = [{ ...DUNGEON_ITEMS[0], x:data.itemPos.x, y:data.itemPos.y }];
    DUNGEON_NPCS[0].x = data.ghostPos.x;
    DUNGEON_NPCS[0].y = data.ghostPos.y;
    DUNGEON_NPCS[0].history = [];
    d.enemies = data.enemySpawns.map((sp, i) => ({
        ...ENEMY_DEFS[sp.type],
        id: `enemy_${i}`,
        type: sp.type,
        x: sp.x, y: sp.y,
        hp: ENEMY_DEFS[sp.type].hp,
        moveTimer: 300 + Math.floor(Math.random() * 700),
        aggroed: false,
        alive: true,
        hurtTimer: 0,
    }));
}
rebuildDungeon(); // initial build so tiles array is never empty

// ═══════════════════════════════════════════════════════
//  BUILDING ENTRANCE LOOKUP
// ═══════════════════════════════════════════════════════
const BUILDING_ENTRANCES = {
    village: {
        '6,11':'int_elder',   '7,11':'int_elder',
        '26,9':'int_merchant','27,9':'int_merchant',
        '36,11':'int_blacksmith','37,11':'int_blacksmith',
        '6,19':'int_tavern',  '7,19':'int_tavern',
        '24,22':'int_market', '24,23':'int_market',
        '9,31':'int_cottage', '9,32':'int_cottage',
        '30,29':'int_chapel', '31,29':'int_chapel',
        '41,19':'int_veyla',  '42,19':'int_veyla',
    },
};

// ═══════════════════════════════════════════════════════
//  QUEST DEFINITIONS
// ═══════════════════════════════════════════════════════
const QUESTS = [
    { id:'find_weapon',     title:'Armed and Ready',
      giver:'guide',        giverName:'Rowan',
      objective:'Find your weapon hidden somewhere in the village.',
      flag_given:'quest_weapon_given', flag_complete:'quest_weapon_complete' },
    { id:'into_the_dark',   title:'Into the Dark',
      giver:'elder',        giverName:'Elder Maren',
      objective:'Descend into the Cursed Mines south of Eldoria.',
      flag_given:'quest_into_dark_given', flag_complete:'quest_into_dark_complete' },
    { id:'brothers_fate',   title:"Brother's Fate",
      giver:'blacksmith',   giverName:'Daran',
      objective:"Find any trace of Henrick in the mines.",
      flag_given:'quest_brothers_fate_given', flag_complete:'quest_brothers_fate_complete' },
    { id:'sealed_truth',    title:'The Sealed Truth',
      giver:'traveler',     giverName:'Veyla',
      objective:'Find the ancient tablet deep in the mines.',
      flag_given:'quest_sealed_truth_given', flag_complete:'quest_sealed_truth_complete' },
];

const QUEST_GIVER_FLAGS = {
    guide:       'quest_weapon_given',
    elder:       'quest_into_dark_given',
    blacksmith:  'quest_brothers_fate_given',
    traveler:    'quest_sealed_truth_given',
};

// ═══════════════════════════════════════════════════════
//  GAME STATE
// ═══════════════════════════════════════════════════════
// XP thresholds — xpThresholds[level] = total XP needed to reach that level
const XP_THRESHOLDS = [0, 0, 60, 150, 280, 450, 670, 950, 1300, 1720, 2220];
// Max level = XP_THRESHOLDS.length - 1
const MAX_LEVEL = XP_THRESHOLDS.length - 1;

const gs = { charName:'Hero', charClass:'Warrior', flags:{}, inventory:[], hp:50, maxHp:50, xp:0, level:1 };
let currentMap = MAPS.village;

// ── XP helpers ────────────────────────────────────────
function xpForLevel(lvl) { return XP_THRESHOLDS[Math.min(lvl, MAX_LEVEL)] || 0; }
function xpToNext() {
    if (gs.level >= MAX_LEVEL) return 0;
    return xpForLevel(gs.level + 1) - gs.xp;
}
function xpProgressPct() {
    if (gs.level >= MAX_LEVEL) return 1;
    const base = xpForLevel(gs.level), next = xpForLevel(gs.level + 1);
    return (gs.xp - base) / (next - base);
}
function grantXP(amount) {
    if (gs.level >= MAX_LEVEL) return;
    gs.xp += amount;
    while (gs.level < MAX_LEVEL && gs.xp >= xpForLevel(gs.level + 1)) {
        gs.level++;
        // Stat boost on level up
        const hpGain = { Warrior:10, Cleric:9, Rogue:7, Wizard:6 }[gs.charClass] || 8;
        gs.maxHp += hpGain;
        gs.hp = Math.min(gs.hp + Math.ceil(hpGain / 2), gs.maxHp);
        updateHPUI();
        showNotification(`Level Up!  Lv ${gs.level}  +${hpGain} Max HP`, 'levelup');
    }
    updateInventoryUI();
}

// ── Battle state ──────────────────────────────────────
// Phases:
//  'player_menu'     — main action menu (FIGHT / ITEM / FLEE)
//  'player_item'     — item submenu
//  'player_timing'   — timing-bar minigame after FIGHT
//  'player_result'   — show hit label + damage number
//  'no_weapon'       — brief "no weapon" warning, then enemy turn
//  'flee_attempt'    — flee animation / result
//  'enemy_turn'      — pause before enemy strike
//  'enemy_result'    — show enemy damage
//  'victory'         — win screen
//  'defeat'          — defeat screen
const battle = {
    active: false,
    enemy: null,
    phase: 'player_menu',
    timer: 0,
    // Menu navigation
    menuCursor: 0,   // 0=FIGHT 1=ITEM 2=FLEE
    // Item submenu
    itemCursor: 0,
    // Timing bar
    cursorPos: 0.1,
    cursorDir: 1,
    // Results
    hitResult: '',
    hitDmg: 0,
    playerDmgTaken: 0,
    message: '',     // text shown in left dialogue box
    shakeTimer: 0,
};

const player  = {
    x:7, y:8, facing:'down',
    renderX:7*48, renderY:8*48,   // sub-tile pixel position for smooth rendering
    prevX:7*48,   prevY:8*48,     // start of current move interpolation
    moveT:1, moveDuration:130,    // move progress (0→1) and duration in ms
    walkPhase:0,                  // advances each step; drives leg/bob animation
    isMoving:false,
};
const cam     = { x:0, y:0 };
const ui      = { dialogue:null, sign:null, loading:false, questLog:false, paused:false, inventory:false };
let timeMs    = 0;
let TS        = 48;
const HUD_H   = 40, HINT_H = 26;

// ═══════════════════════════════════════════════════════
//  CANVAS
// ═══════════════════════════════════════════════════════
const canvas = document.getElementById('game-canvas');
let   ctx    = canvas.getContext('2d');

// Logical (CSS-pixel) canvas dimensions — use these everywhere in game logic.
// canvas.width / canvas.height are the physical pixel dimensions (cW * dpr, cH * dpr).
let cW = 0, cH = 0;

// Offscreen background canvas — caches all static (non-animated) tiles each frame only
// when the camera moves or the map changes.  Animated tiles are drawn live on top.
let bgCanvas = document.createElement('canvas');
let bgCtx    = bgCanvas.getContext('2d');
let bgDirty  = true;   // true → must rebuild before next render
let _bgCamX  = -1, _bgCamY = -1; // last cam position baked into bgCanvas

function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;

    // Logical (CSS-pixel) size
    cW = window.innerWidth;
    cH = window.innerHeight - HUD_H - HINT_H;

    // Physical pixel size on the canvas element
    canvas.width  = Math.round(cW * dpr);
    canvas.height = Math.round(cH * dpr);

    // Keep the CSS display size at logical pixels so layout isn't disturbed
    canvas.style.width  = cW + 'px';
    canvas.style.height = cH + 'px';

    // Scale all subsequent draw calls so we always work in logical coords
    ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = false; // pixel-perfect — never blur tile art

    // bgCanvas is sized to (cW + 4*TS) × (cH + 4*TS) by rebuildBgCanvas to hold
    // a 2-tile scroll buffer on every edge.  Mark dirty; rebuild handles the resize.
    bgDirty = true;

    TS = Math.floor(Math.min(cW / 15, cH / 11));
    TS = Math.max(32, Math.min(TS, 64));
    lightCanvas = null; // force recreation at new size
    _scanlinesCanvas = null; // force rebuild at new size
    invalidateTileCache(); // rebuild tile variants at new TS
    if (typeof spriteRenderer !== 'undefined') {
        spriteRenderer.invalidate();           // invalidates tileRenderer cache internally
        if (spriteRenderer.isReady()) spriteRenderer.warmCache(TS); // pre-warm all rows at new TS
    }
    if (typeof VQ !== 'undefined') VQ.invalidate(); // rebuild sway frames at new TS
    _invalidateVigGrd(); // vignette gradient is sized to cW/cH — must rebuild
}
window.addEventListener('resize', resizeCanvas);

// ═══════════════════════════════════════════════════════
//  INPUT
// ═══════════════════════════════════════════════════════
const KEYS         = new Set();
const JUST_PRESSED = new Set();
// Module-level Set — avoids allocating a new array on every keydown event
// and O(1) .has() vs O(n) .includes() scan.
const _NAV_KEYS = new Set(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' ']);

document.addEventListener('keydown', e => {
    if (document.activeElement?.tagName === 'INPUT') return;
    if (_NAV_KEYS.has(e.key)) e.preventDefault();
    if (!KEYS.has(e.key)) JUST_PRESSED.add(e.key);
    KEYS.add(e.key);
    if (battle.active) { e.preventDefault(); handleBattleInput(e.key); return; }
    if (e.key === 'Tab') { e.preventDefault(); toggleInventory(); return; }
    if (e.key === 'e' || e.key === 'E') { e.preventDefault(); handleInteract(); }
    if (e.key === 'q' || e.key === 'Q') { e.preventDefault(); toggleQuestLog(); }
    if (e.key === 'Escape') {
        if (ui.paused) { closePause(); }
        else if (ui.inventory) { closeInventory(); }
        else if (ui.dialogue || ui.sign || ui.questLog) { closeDialogue(); closeSign(); closeQuestLog(); }
        else { openPause(); }
    }
});
document.addEventListener('keyup', e => KEYS.delete(e.key));
document.addEventListener('keydown', e => {
    if(e.target?.id==='dlg-input'&&e.key==='Enter'){e.preventDefault();sendDialogueMessage();}
});

let moveAccum = 999;

function updateMovement(dt) {
    if (battle.active || ui.inventory || ui.dialogue || ui.sign || ui.questLog || ui.loading || ui.paused) { JUST_PRESSED.clear(); return; }
    const dirs = [
        { keys:['ArrowUp','w','W'],    dx:0,  dy:-1, f:'up'    },
        { keys:['ArrowDown','s','S'],  dx:0,  dy:1,  f:'down'  },
        { keys:['ArrowLeft','a','A'],  dx:-1, dy:0,  f:'left'  },
        { keys:['ArrowRight','d','D'], dx:1,  dy:0,  f:'right' },
    ];
    for (const d of dirs) {
        if (d.keys.some(k => JUST_PRESSED.has(k))) {
            JUST_PRESSED.clear(); tryMove(d.dx, d.dy, d.f); moveAccum=0; return;
        }
    }
    JUST_PRESSED.clear();
    moveAccum += dt;
    if (moveAccum < 130) return;
    for (const d of dirs) {
        if (d.keys.some(k => KEYS.has(k))) {
            if (tryMove(d.dx, d.dy, d.f)) moveAccum = 0;
            return;
        }
    }
}

function tryMove(dx, dy, facing) {
    player.facing = facing;
    const nx = player.x + dx, ny = player.y + dy;
    if (nx < 0 || nx >= currentMap.w || ny < 0 || ny >= currentMap.h) return false;
    if (!NPCS_OK(nx, ny)) return false;
    const tile = currentMap.tiles[ny][nx];
    if (!WALKABLE.has(tile)) return false;
    // Start smooth interpolation from current render position to new tile
    player.prevX = player.renderX; player.prevY = player.renderY;
    player.x = nx; player.y = ny;
    player.moveT = 0; player.isMoving = true;
    player.walkPhase += Math.PI; // half-cycle per step drives alternating legs
    // Footstep dust puff at the tile we just left
    spawnParticle('dust', player.prevX/TS + 0.5, player.prevY/TS + 0.5);
    // Building entry via door tiles
    if (tile === TILE.DOOR) {
        const key = `${nx},${ny}`;
        const entrances = BUILDING_ENTRANCES[currentMap.id];
        if (entrances?.[key]) { changeMap(entrances[key]); return true; }
    }
    // Stairs transitions
    if (tile === TILE.STAIRS)   handleStairsDown();
    if (tile === TILE.STAIRSUP) handleStairsUp();
    // Item pickup
    checkItemPickup();
    return true;
}

function NPCS_OK(nx, ny) {
    return !currentMap.npcs.some(n => n.x === nx && n.y === ny);
}

// ═══════════════════════════════════════════════════════
//  MAP TRANSITIONS
// ═══════════════════════════════════════════════════════
function handleStairsDown() {
    if (currentMap.id === 'village') {
        changeMap('dungeon_1');
    } else {
        showSign('The passage leads deeper into the earth.\n\n[ Floor 2 — Coming Soon ]');
    }
}

function handleStairsUp() {
    if (currentMap.returnMap) {
        changeMap(currentMap.returnMap, currentMap.returnX, currentMap.returnY);
    } else {
        changeMap('village', 22, 32);
    }
}

function changeMap(mapId, sx, sy) {
    currentMap = MAPS[mapId];
    buildVariantMap(currentMap); // pre-compute tile variant indices for new map
    player.x   = sx !== undefined ? sx : currentMap.playerStart.x;
    player.y   = sy !== undefined ? sy : currentMap.playerStart.y;
    player.facing = 'down';
    player.renderX = player.x * TS; player.renderY = player.y * TS;
    player.prevX = player.renderX;  player.prevY = player.renderY;
    player.moveT = 1; player.isMoving = false;
    updateCamera();
    bgDirty = true; // new map — force full bg cache rebuild

    document.getElementById('hud-location').textContent = currentMap.name;

    // Quest: entering dungeon for first time
    if (mapId === 'dungeon_1' && !gs.flags.quest_into_dark_complete) {
        gs.flags.quest_into_dark_complete = true;
        setTimeout(() => showNotification('Quest Complete: Into the Dark', 'quest'), 800);
        updateQuestUI();
    }
}

// ═══════════════════════════════════════════════════════
//  CAMERA
// ═══════════════════════════════════════════════════════
function updatePlayerAnim(dt) {
    if (player.moveT >= 1) {
        player.renderX = player.x * TS;
        player.renderY = player.y * TS;
        player.isMoving = false;
        return;
    }
    player.moveT = Math.min(1, player.moveT + dt / player.moveDuration);
    const t = player.moveT;
    const ease = t * t * (3 - 2 * t); // smoothstep
    player.renderX = player.prevX + (player.x * TS - player.prevX) * ease;
    player.renderY = player.prevY + (player.y * TS - player.prevY) * ease;
}

function updateCamera() {
    const tx = player.renderX + TS/2 - cW/2;
    const ty = player.renderY + TS/2 - cH/2;
    cam.x = Math.round(Math.max(0, Math.min(tx, currentMap.w * TS - cW)));
    cam.y = Math.round(Math.max(0, Math.min(ty, currentMap.h * TS - cH)));
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

// Redirect the global `ctx` to bgCtx, draw all non-animated tiles, restore.
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

    // Temporarily redirect the global ctx so all drawTile() calls go to bgCtx
    const savedCtx = ctx;
    ctx = bgCtx;

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

    // ── Phase 5: worn-path overlay ─────────────────────────────────────────────
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
    // ── Phase 5 note: water animation ─────────────────────────────────────────
    // TILE.WATER is in ANIMATED_TILES — it is NOT baked here. It is drawn live
    // each frame by drawAnimatedTiles() which calls spriteRenderer.drawTile with
    // the current _waterFrame (advanced at 4 fps by spriteRenderer.advanceAnimations).

    ctx = savedCtx; // restore main context
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

// ═══════════════════════════════════════════════════════
//  PARTICLE SYSTEM
//  Types: 'firefly' (outdoor), 'dust' (dungeon/interior),
//         'spark' (forge), 'leaf' (windy outdoor areas)
// ═══════════════════════════════════════════════════════
const PARTICLES = [];
let _partTimer  = 0;
// Per-type live counts — eliminates four .filter() calls in _spawnAmbient every 280ms.
const _partCount = { firefly:0, dust:0, spark:0, leaf:0 };

// Pooled ambient dust motes — persistent, wrap at viewport edges, never reallocated
const MOTE_COUNT = 20;
const _motes = Array.from({ length: MOTE_COUNT }, () => ({
    x: Math.random(),  // 0–1 fraction of cW (set to real coords on first update)
    y: Math.random(),  // 0–1 fraction of cH
    vy: 0.10 + Math.random() * 0.14,  // drift speed (px/frame at 60fps)
    vx: (Math.random() - 0.5) * 0.06,
    size: Math.random() < 0.5 ? 1 : 1.5,
    phase: Math.random() * Math.PI * 2,
    init: false,
}));
function _updateMotes() {
    for (const m of _motes) {
        if (!m.init) { m.x = Math.random() * cW; m.y = Math.random() * cH; m.init = true; }
        m.x += m.vx;
        m.y -= m.vy; // drift upward
        if (m.y < -4)  { m.y = cH + 2; m.x = Math.random() * cW; }
        if (m.x < -4)  m.x = cW + 2;
        if (m.x > cW + 4) m.x = -2;
    }
}
function _renderMotes() {
    ctx.save();
    for (const m of _motes) {
        const a = 0.18 + 0.10 * Math.sin(timeMs * 0.003 + m.phase);
        ctx.globalAlpha = a;
        ctx.fillStyle = '#e8e0d0';
        ctx.beginPath(); ctx.arc(Math.round(m.x), Math.round(m.y), m.size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
}

function spawnParticle(type, x, y) {
    const r = Math.random;
    const p = { type, x, y, life:0 };
    if (type==='firefly') Object.assign(p,{vx:(r()-.5)*.28,vy:(r()-.5)*.28,maxLife:5000+r()*5000,size:1.5+r()*1.5,phase:r()*Math.PI*2});
    else if (type==='dust')  Object.assign(p,{vx:(r()-.5)*.07,vy:-.03-r()*.04,maxLife:3000+r()*2000,size:1+r()*.8});
    else if (type==='spark') Object.assign(p,{vx:(r()-.5)*2.2,vy:-1.4-r()*2,maxLife:350+r()*500,size:1.5+r(),color:r()<.5?PALETTE.A_ORANGE:PALETTE.A_YELLOW});
    else if (type==='leaf')  Object.assign(p,{vx:.15+r()*.35,vy:.08+r()*.18,maxLife:6000+r()*4000,size:2+r(),color:r()<.5?PALETTE.S_DARK:PALETTE.M_CLAY,angle:r()*Math.PI*2,spin:(r()-.5)*.05});
    PARTICLES.push(p);
    if (_partCount[type] !== undefined) _partCount[type]++;
}

function updateParticles(dt) {
    if (ui.loading||ui.paused) return;
    _partTimer += dt;
    if (_partTimer > 280) { _partTimer = 0; _spawnAmbient(); }
    for (let i = PARTICLES.length-1; i >= 0; i--) {
        const p = PARTICLES[i];
        p.life += dt;
        if (p.life >= p.maxLife) {
            if (_partCount[p.type] !== undefined) _partCount[p.type]--;
            PARTICLES.splice(i,1); continue;
        }
        p.x += p.vx; p.y += p.vy;
        if (p.type==='firefly') {
            p.vx += (Math.random()-.5)*.024; p.vy += (Math.random()-.5)*.024;
            p.vx = Math.max(-.38,Math.min(.38,p.vx));
            p.vy = Math.max(-.38,Math.min(.38,p.vy));
        } else if (p.type==='spark') {
            p.vy += .09; // gravity
        } else if (p.type==='leaf') {
            p.vx += Math.sin(p.life*.002)*.012; p.vy += .005; p.angle += p.spin;
        }
    }
}

function _spawnAmbient() {
    if (!currentMap) return;
    const maxR = 13;
    if (!currentMap.dark && !currentMap.returnMap) {
        // Outdoor — fireflies
        if (_partCount.firefly < 7) {
            const tx = Math.floor(player.x+(Math.random()-.5)*maxR*2);
            const ty = Math.floor(player.y+(Math.random()-.5)*maxR*2);
            const t  = currentMap.tiles[ty]?.[tx];
            if (t===TILE.GRASS||t===TILE.TREE)
                spawnParticle('firefly',(tx+Math.random())*TS,(ty+Math.random())*TS-TS*.3);
        }
        // Occasional leaf drift near trees
        if (_partCount.leaf < 4) {
            const tx = Math.floor(player.x+(Math.random()-.5)*maxR*2);
            const ty = Math.floor(player.y+(Math.random()-.5)*maxR*2);
            if (currentMap.tiles[ty]?.[tx]===TILE.TREE)
                spawnParticle('leaf',(tx+Math.random())*TS,(ty+Math.random())*TS);
        }
    } else {
        // Dungeon / dark interior — dust motes
        if (_partCount.dust < 14)
            spawnParticle('dust',
                (player.x+(Math.random()-.5)*maxR)*TS,
                (player.y+(Math.random()-.5)*maxR)*TS);
    }
    // Forge sparks in blacksmith interior
    if (currentMap.id==='int_blacksmith') {
        if (_partCount.spark < 12)
            spawnParticle('spark', 11*TS+TS*.5, 1*TS+TS*.25);
    }
}

function renderParticles() {
    ctx.save();

    // Pass 1: fireflies (shadowBlur=10, set once for the group)
    ctx.shadowColor = '#80ff80';
    ctx.shadowBlur  = 10;
    ctx.fillStyle   = '#c0ffc0';
    for (const p of PARTICLES) {
        if (p.type !== 'firefly') continue;
        const sx = p.x-cam.x, sy = p.y-cam.y;
        if (sx<-30||sx>cW+30||sy<-30||sy>cH+30) continue;
        const pct = p.life/p.maxLife;
        ctx.globalAlpha = Math.sin(pct*Math.PI)*(.5+.4*Math.sin(p.life*.008+p.phase));
        ctx.beginPath(); ctx.arc(Math.floor(sx),Math.floor(sy),p.size,0,Math.PI*2); ctx.fill();
    }

    // Pass 2: dust + leaves (no shadow)
    ctx.shadowBlur = 0;
    for (const p of PARTICLES) {
        if (p.type !== 'dust' && p.type !== 'leaf') continue;
        const sx = p.x-cam.x, sy = p.y-cam.y;
        if (sx<-30||sx>cW+30||sy<-30||sy>cH+30) continue;
        const pct = p.life/p.maxLife;
        if (p.type === 'dust') {
            ctx.globalAlpha = Math.sin(pct*Math.PI)*.22;
            ctx.fillStyle   = '#806050';
            ctx.fillRect(Math.floor(sx),Math.floor(sy),Math.ceil(p.size),Math.ceil(p.size));
        } else {
            ctx.globalAlpha = Math.sin(pct*Math.PI)*.75;
            ctx.fillStyle   = p.color;
            ctx.save(); ctx.translate(Math.floor(sx),Math.floor(sy)); ctx.rotate(p.angle);
            ctx.fillRect(-p.size,-p.size*.5,p.size*2,p.size); ctx.restore();
        }
    }

    // Pass 3: sparks (shadowBlur=5, set once for the group)
    ctx.shadowBlur = 5;
    for (const p of PARTICLES) {
        if (p.type !== 'spark') continue;
        const sx = p.x-cam.x, sy = p.y-cam.y;
        if (sx<-30||sx>cW+30||sy<-30||sy>cH+30) continue;
        const pct = p.life/p.maxLife;
        ctx.globalAlpha = (1-pct)*.9;
        ctx.shadowColor = p.color;
        ctx.fillStyle   = p.color;
        ctx.fillRect(Math.floor(sx),Math.floor(sy),Math.ceil(p.size),Math.ceil(p.size));
    }

    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    ctx.restore();
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
const CLASS_COLORS = {Warrior:PALETTE.CLASS_WARRIOR,Rogue:PALETTE.CLASS_ROGUE,Wizard:PALETTE.CLASS_WIZARD,Cleric:PALETTE.CLASS_CLERIC};
const CLASS_CLOAK  = {Warrior:PALETTE.CLOAK_WARRIOR,Rogue:PALETTE.CLOAK_ROGUE,Wizard:PALETTE.CLOAK_WIZARD,Cleric:PALETTE.CLOAK_CLERIC};
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

// ── Pixel art player sprite cache ─────────────────────────────────────
// Keyed by "color|facing|frameIdx". Rebuilt automatically when TS changes.
const _charCache = new Map();
let   _charCacheTS = 0;

function _buildCharFrame(color, facing, frameIdx) {
    if (_charCacheTS !== TS) { _charCache.clear(); _charCacheTS = TS; }
    const key = `${color}|${facing}|${frameIdx}`;
    if (_charCache.has(key)) return _charCache.get(key);

    const off = document.createElement('canvas');
    off.width = off.height = TS;
    const c = off.getContext('2d');
    c.imageSmoothingEnabled = false;

    const U   = Math.max(1, Math.floor(TS / 16));
    const cx  = Math.floor(TS / 2);
    // Walk frames 0-3: frames 1 and 3 bob 1px; idle frames 4-5: frame 5 bobs
    const bob = (frameIdx === 1 || frameIdx === 3 || frameIdx === 5) ? -1 : 0;

    const headR  = Math.max(2, Math.floor(TS * 0.145));
    const headCY = Math.floor(TS * 0.22) + bob;

    const bodyW  = Math.floor(TS * 0.44);
    const bodyH  = Math.floor(TS * 0.32);
    const bodyX  = cx - Math.floor(bodyW / 2);
    const bodyY  = Math.floor(TS * 0.40) + bob;

    const legW   = Math.max(1, Math.floor(TS * 0.12));
    const legH   = Math.floor(TS * 0.22);
    const legTopY = bodyY + bodyH - 1;
    const leftLegX  = bodyX + U;
    const rightLegX = bodyX + bodyW - U - legW;
    // Walk: alternate legs forward/back on frames 1 and 3
    const leftLegDY  = frameIdx === 1 ? -U : frameIdx === 3 ?  U : 0;
    const rightLegDY = frameIdx === 1 ?  U : frameIdx === 3 ? -U : 0;

    // Ground shadow
    c.globalAlpha = 0.22;
    c.fillStyle = '#000000';
    c.fillRect(cx - Math.floor(TS*0.20), Math.floor(TS*0.84), Math.floor(TS*0.40), Math.max(1, Math.floor(TS*0.05)));
    c.globalAlpha = 1;

    // Legs (drawn under body)
    if (facing === 'left' || facing === 'right') {
        c.fillStyle = '#4a5a6a';
        c.fillRect(bodyX + U, legTopY, bodyW - U*2, legH);
        c.fillStyle = '#2a1a0a';
        c.fillRect(bodyX + U, legTopY + legH - U, bodyW - U*2, U);
    } else {
        c.fillStyle = '#4a5a6a';
        c.fillRect(leftLegX,  legTopY + leftLegDY,  legW, legH);
        c.fillRect(rightLegX, legTopY + rightLegDY, legW, legH);
        c.fillStyle = '#2a1a0a';
        c.fillRect(leftLegX,  legTopY + leftLegDY  + legH - U, legW, U);
        c.fillRect(rightLegX, legTopY + rightLegDY + legH - U, legW, U);
    }

    // Body
    c.fillStyle = color || '#8a9aaa';
    c.fillRect(bodyX, bodyY, bodyW, bodyH);

    // Shoulders
    const sW = Math.max(U, Math.floor(TS * 0.08));
    c.fillStyle = color || '#8a9aaa';
    c.fillRect(bodyX - sW, bodyY + U,       sW, Math.floor(bodyH * 0.55));
    c.fillRect(bodyX + bodyW, bodyY + U,    sW, Math.floor(bodyH * 0.55));

    // Accent collar strip
    c.fillStyle = '#aa3030';
    c.fillRect(bodyX + U, bodyY + U, bodyW - U*2, U);

    // Body bevel: bright top-left edge, dark bottom-right edge
    c.fillStyle = '#c0ccd8';
    c.fillRect(bodyX, bodyY, bodyW, 1);
    c.fillRect(bodyX, bodyY, 1, bodyH);
    c.fillStyle = '#3a4858';
    c.fillRect(bodyX, bodyY + bodyH - 1, bodyW, 1);
    c.fillRect(bodyX + bodyW - 1, bodyY, 1, bodyH);

    // Head: skin circle
    c.fillStyle = '#c8a882';
    c.beginPath(); c.arc(cx, headCY, headR, 0, Math.PI * 2); c.fill();

    if (facing === 'up') {
        // Back of head: hair covers entire head
        c.fillStyle = '#2a1a0a';
        c.beginPath(); c.arc(cx, headCY, headR, 0, Math.PI * 2); c.fill();
    } else {
        // Hair: top arc of head (counterclockwise π → 0 = upper half)
        c.fillStyle = '#2a1a0a';
        c.beginPath();
        c.arc(cx, headCY, headR, Math.PI, 0, true);
        c.lineTo(cx - headR, headCY);
        c.fill();
        // Eyes: direction-dependent
        if (facing === 'down') {
            c.fillStyle = '#ffffff';
            c.fillRect(cx - Math.floor(headR * 0.5), headCY - Math.floor(headR * 0.1), 2, 2);
            c.fillRect(cx + Math.floor(headR * 0.1), headCY - Math.floor(headR * 0.1), 2, 2);
            c.fillStyle = '#503820';
            c.fillRect(cx - 1, headCY + Math.floor(headR * 0.38), 1, 1);
        } else if (facing === 'left') {
            c.fillStyle = '#ffffff';
            c.fillRect(cx - Math.floor(headR * 0.65), headCY - Math.floor(headR * 0.1), 2, 2);
        } else {
            c.fillStyle = '#ffffff';
            c.fillRect(cx + Math.floor(headR * 0.35), headCY - Math.floor(headR * 0.1), 2, 2);
        }
    }

    // Helmet strip across the top of head
    c.fillStyle = '#7a8a9a';
    c.fillRect(cx - headR, headCY - headR, headR * 2, Math.max(1, Math.floor(headR * 0.5)));
    c.fillStyle = '#aabaca';
    c.fillRect(cx - headR, headCY - headR, headR * 2, 1);

    _charCache.set(key, off);
    return off;
}

function drawCharacter(sx, sy, color, facing, name, isPlayer, isNear, ghost, walkPhase=0, isMoving=false) {
    const cx=sx+TS/2, cy=sy+TS/2, r=TS*.28, t=timeMs/1000;

    // Player (non-ghost): pixel art sprite blitted from cache
    if (isPlayer && !ghost) {
        let frameIdx;
        if (isMoving) {
            frameIdx = Math.floor(Math.abs(walkPhase)) % 4;
        } else {
            frameIdx = 4 + (Math.floor(timeMs / 166) % 2);
        }
        const frame = _buildCharFrame(color, facing, frameIdx);
        ctx.drawImage(frame, Math.round(sx), Math.round(sy));
        const hasWeapon = gs.inventory.some(i => i.questComplete === 'quest_weapon_complete');
        if (hasWeapon) drawWeapon(cx, cy, r, facing);
        // NPC labels never shown for player, so return early
        return;
    }

    // NPCs and ghost characters: circle-based rendering (unchanged)
    const walkBob = isMoving ? Math.abs(Math.sin(walkPhase)) * TS * 0.055 : 0;
    const idlePhase = t * 1.1 + cx * 0.031;
    const npcBob = isPlayer ? 0 : Math.sin(idlePhase) * 1.4;
    const totalBob = isPlayer ? -walkBob : npcBob;

    ctx.save(); ctx.translate(0, totalBob);
    if (ghost) { ctx.globalAlpha=0.55+0.15*Math.sin(t*2.2); ctx.shadowColor='#80b0ff'; ctx.shadowBlur=18; }

    {
        const [fdx,fdy] = _CHAR_DIRS[facing] || _CHAR_DIRS.down;
        const [fpx,fpy] = [-fdy, fdx];
        const footR = r * 0.22;
        const footPhase = isPlayer ? walkPhase : idlePhase * 0.6;
        const footSwing = isPlayer ? (isMoving ? r * 0.38 : r * 0.08) : r * 0.13;
        const footColor = ghost ? '#8090c0' : '#2a1a0a';
        const fbx = cx - fdx * r * 0.15;
        const fby = cy - fdy * r * 0.15;
        ctx.fillStyle = footColor;
        const lx = fbx + fpx * Math.sin(footPhase) * footSwing;
        const ly = fby + fpy * Math.sin(footPhase) * footSwing;
        ctx.beginPath(); ctx.arc(lx, ly, footR, 0, Math.PI*2); ctx.fill();
        const rx2 = fbx + fpx * Math.sin(footPhase + Math.PI) * footSwing;
        const ry2 = fby + fpy * Math.sin(footPhase + Math.PI) * footSwing;
        ctx.beginPath(); ctx.arc(rx2, ry2, footR, 0, Math.PI*2); ctx.fill();
    }

    const shadowScale = 1 - (walkBob / (TS * 0.12)) * 0.25;
    ctx.fillStyle='rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(cx,cy+r+3,r*.7*shadowScale,r*.22*shadowScale,0,0,Math.PI*2); ctx.fill();
    const cloakC=ghost?'rgba(80,110,200,0.7)':isPlayer?(CLASS_CLOAK[gs.charClass]||'#4a2810'):'rgba(20,12,8,0.65)';
    ctx.shadowBlur=0;
    ctx.fillStyle=cloakC; ctx.beginPath(); ctx.arc(cx,cy+r*.1,r*1.12,0,Math.PI*2); ctx.fill();
    ctx.shadowBlur=0;
    ctx.fillStyle=ghost?'rgba(140,180,255,0.82)':color;
    ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='rgba(0,0,0,0.45)'; ctx.lineWidth=1.5; ctx.stroke();
    const [hox,hoy]=_HEAD_OFF[facing]||_HEAD_OFF.down;
    const hx=cx+hox*r, hy=cy+hoy*r;
    ctx.fillStyle=ghost?'#c0d0ff':'#e8cfa0';
    ctx.beginPath(); ctx.arc(hx,hy,r*.40,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='rgba(0,0,0,0.25)'; ctx.lineWidth=1; ctx.stroke();
    ctx.fillStyle=ghost?'#a0c8ff':'#281808';
    const _ep=_EYE_POS[facing]||_EYE_POS.down;
    for (let _ei=0;_ei<_ep.length;_ei++) {
        ctx.beginPath(); ctx.arc(hx+_ep[_ei].x*r,hy+_ep[_ei].y*r,r*.10,0,Math.PI*2); ctx.fill();
    }
    ctx.shadowBlur=0; ctx.globalAlpha=1; ctx.restore();

    if (!isPlayer) {
        ctx.font='11px sans-serif'; ctx.textAlign='center';
        const nw=ctx.measureText(name).width;
        ctx.fillStyle='rgba(0,0,0,0.72)'; ctx.fillRect(cx-nw/2-4,sy-23,nw+8,15);
        ctx.fillStyle=ghost?'#b0d0ff':'#e8d0b0'; ctx.textBaseline='top'; ctx.fillText(name,cx,sy-22);
    }
    if (!isPlayer&&isNear) {
        ctx.fillStyle='#ffe040'; ctx.font=`bold ${Math.max(14,TS*.32)}px sans-serif`;
        ctx.textAlign='center'; ctx.textBaseline='bottom';
        ctx.fillText('!',cx,sy-2+Math.sin(timeMs/280)*3);
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
function updateEnemies(dt) {
    if (battle.active || ui.dialogue || ui.sign || ui.paused || ui.loading) return;
    if (!currentMap.enemies) return;
    for (const en of currentMap.enemies) {
        if (!en.alive) continue;
        if (en.hurtTimer > 0) en.hurtTimer = Math.max(0, en.hurtTimer - dt);
        en.moveTimer -= dt;
        if (en.moveTimer > 0) continue;

        const dx = player.x - en.x, dy = player.y - en.y;
        const dist = Math.abs(dx) + Math.abs(dy);

        // Aggro check
        en.aggroed = dist <= en.aggroRange;
        en.moveTimer = en.aggroed ? en.aggroSpeed : en.speed;

        if (!en.aggroed) continue;

        // Adjacent to player → start battle
        if (dist <= 1) { startBattle(en); return; }

        // Move one step toward player
        let mx = 0, my = 0;
        if (Math.abs(dx) >= Math.abs(dy)) mx = dx > 0 ? 1 : -1;
        else my = dy > 0 ? 1 : -1;
        const nx2 = en.x + mx, ny2 = en.y + my;
        if (nx2 >= 0 && nx2 < currentMap.w && ny2 >= 0 && ny2 < currentMap.h) {
            const tile = currentMap.tiles[ny2][nx2];
            const blocked = currentMap.enemies.some(e => e !== en && e.alive && e.x === nx2 && e.y === ny2);
            if (WALKABLE.has(tile) && !blocked) { en.x = nx2; en.y = ny2; }
        }
    }
}

// ── Pixel art enemy sprite cache ──────────────────────────────────────
const _enemyCache  = new Map();
let   _enemyCacheTS = 0;

function _buildEnemyFrame(type, frameIdx) {
    if (_enemyCacheTS !== TS) { _enemyCache.clear(); _enemyCacheTS = TS; }
    const key = `${type}|${frameIdx}`;
    if (_enemyCache.has(key)) return _enemyCache.get(key);

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
//  BATTLE SYSTEM
// ═══════════════════════════════════════════════════════
function getPlayerAtk() {
    return { Warrior:16, Rogue:13, Wizard:20, Cleric:11 }[gs.charClass] || 15;
}

function hasWeapon() {
    return gs.inventory.some(i => i.questComplete === 'quest_weapon_complete');
}

function startBattle(enemy) {
    battle.active   = true;
    battle.enemy    = enemy;
    battle.phase    = 'player_menu';
    battle.timer    = 0;
    battle.menuCursor = 0;
    battle.itemCursor = 0;
    battle.cursorPos = 0.1;
    battle.cursorDir = 1;
    battle.hitResult = '';
    battle.hitDmg   = 0;
    battle.playerDmgTaken = 0;
    battle.shakeTimer = 0;
    battle.message  = `A wild ${enemy.name} appeared!`;
    showNotification(`A ${enemy.name} appears!`, 'danger');
}

// ── Battle input handler ────────────────────────────────
function handleBattleInput(key) {
    if (!battle.active) return false;

    // Only accept input on interactive phases
    if (battle.phase === 'player_menu') {
        const MENU = ['FIGHT', 'ITEM', 'FLEE'];
        if (key === 'ArrowUp'   || key === 'w' || key === 'W') { battle.menuCursor = (battle.menuCursor + MENU.length - 1) % MENU.length; return true; }
        if (key === 'ArrowDown' || key === 's' || key === 'S') { battle.menuCursor = (battle.menuCursor + 1) % MENU.length; return true; }
        if (key === ' ' || key === 'Enter' || key === 'e' || key === 'E') {
            if (battle.menuCursor === 0) {      // FIGHT
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
            } else if (battle.menuCursor === 1) { // ITEM
                if (gs.inventory.length === 0) {
                    battle.message = "Your pack is empty!";
                } else {
                    battle.phase = 'player_item';
                    battle.itemCursor = 0;
                    battle.message = 'Choose an item.';
                }
            } else {                            // FLEE
                battle.phase = 'flee_attempt';
                battle.timer = 900;
                battle.message = 'Getting away…';
            }
            return true;
        }
        return true;
    }

    if (battle.phase === 'player_item') {
        const items = gs.inventory;
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
                // Consumable heal item
                const healed = Math.min(item.healAmt, gs.maxHp - gs.hp);
                gs.hp = Math.min(gs.maxHp, gs.hp + item.healAmt);
                gs.inventory.splice(battle.itemCursor, 1);
                battle.itemCursor = Math.min(battle.itemCursor, gs.inventory.length - 1);
                updateHPUI();
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

    return true; // swallow all keys during other phases
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
    battle.message   = result === 'MISS!' ? 'Your attack missed!' :
                       result === 'WEAK!' ? 'A glancing blow...' :
                       result === 'HIT!'  ? 'A solid hit!' : 'CRITICAL HIT!';
}

function updateBattle(dt) {
    if (!battle.active) return;
    const en = battle.enemy;
    if (battle.shakeTimer > 0) battle.shakeTimer = Math.max(0, battle.shakeTimer - dt);

    if (battle.phase === 'player_timing') {
        const speed = en.type === 'shade' ? 1.45 : 0.88;
        battle.cursorPos += battle.cursorDir * speed * (dt / 1000);
        if (battle.cursorPos >= 1) { battle.cursorPos = 1; battle.cursorDir = -1; }
        if (battle.cursorPos <= 0) { battle.cursorPos = 0; battle.cursorDir = 1;  }

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
                battle.message = `${en.name}'s turn…`;
            }
        }

    } else if (battle.phase === 'no_weapon') {
        battle.timer -= dt;
        if (battle.timer <= 0) {
            battle.phase = 'enemy_turn'; battle.timer = 1100;
            battle.message = `${en.name}'s turn…`;
        }

    } else if (battle.phase === 'player_item_use') {
        battle.timer -= dt;
        if (battle.timer <= 0) {
            battle.phase = 'enemy_turn'; battle.timer = 1100;
            battle.message = `${en.name}'s turn…`;
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
            // Flee success rate: fast enemies harder to escape
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
            battle.playerDmgTaken = ENEMY_DEFS[en.type].atk;
            gs.hp = Math.max(0, gs.hp - battle.playerDmgTaken);
            updateHPUI();
            battle.shakeTimer = 500;
            battle.phase = 'enemy_result'; battle.timer = 1100;
            battle.message = `${en.name} attacked for ${battle.playerDmgTaken} damage!`;
        }

    } else if (battle.phase === 'enemy_result') {
        battle.timer -= dt;
        if (battle.timer <= 0) {
            if (gs.hp <= 0) {
                battle.phase = 'defeat'; battle.timer = 2400;
                battle.message = 'You were defeated…';
            } else {
                battle.phase = 'player_menu';
                battle.message = `What will ${gs.charName} do?`;
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
    battle.active = false;
    if (outcome === 'victory') {
        const xp = ENEMY_DEFS[battle.enemy.type].xp;
        grantXP(xp);
        showNotification(`${battle.enemy.name} defeated! (+${xp} XP)`, 'quest');
    } else if (outcome === 'defeat') {
        gs.hp = Math.max(1, Math.floor(gs.maxHp * 0.2));
        updateHPUI();
        showNotification('You were defeated… Waking up in Eldoria.', 'danger');
        setTimeout(() => changeMap('village', 22, 32), 600);
    }
    // 'flee' just closes battle; no penalty, no XP
}

// ── Battle Rendering ────────────────────────────────────
function renderBattle() {
    if (!battle.active) return;
    const W = cW, H = cH, t = timeMs / 1000;
    const en = battle.enemy;

    // Player shake offset (on hit)
    const shakeAmt = battle.shakeTimer > 0 ? Math.sin(battle.shakeTimer * 0.08) * 5 : 0;

    // ── Background ─────────────────────────────────────
    ctx.fillStyle = '#080308'; ctx.fillRect(0, 0, W, H);
    const wallH = H * 0.52;
    // Cave wall
    ctx.fillStyle = '#120a10'; ctx.fillRect(0, 0, W, wallH);
    // Ground strip
    ctx.fillStyle = '#1e1018'; ctx.fillRect(0, wallH, W, H - wallH);
    ctx.fillStyle = '#2a1622'; ctx.fillRect(0, wallH, W, 3);
    // Stalactites
    ctx.fillStyle = '#0e080c';
    for (let i = 0; i < 7; i++) {
        const sx2 = W * 0.08 + i * W * 0.13;
        const sh  = H * (0.06 + (i % 3) * 0.04);
        ctx.beginPath(); ctx.moveTo(sx2 - W*.022, 0); ctx.lineTo(sx2 + W*.022, 0); ctx.lineTo(sx2, sh); ctx.closePath(); ctx.fill();
    }
    // Ground platform shadow lines
    ctx.strokeStyle = '#3a1a30'; ctx.lineWidth = 1;
    for (let y2 = wallH + 10; y2 < H; y2 += 20) {
        ctx.beginPath(); ctx.moveTo(0, y2); ctx.lineTo(W, y2); ctx.stroke();
    }

    // ── Enemy HP card (top-left) ────────────────────────
    const emaxhp = ENEMY_DEFS[en.type].hp;
    drawBattleCard(W * 0.04, H * 0.04, W * 0.38, 56, en.name, `Lv ${en.type === 'lurker' ? 8 : 3}`, en.hp, emaxhp, false);

    // ── Enemy sprite (top-right, with death fade) ──────
    const ESZ = Math.min(W * 0.28, H * 0.40);
    const ESX = W * 0.56, ESY = H * 0.03;
    if (en.alive || battle.phase === 'victory') {
        ctx.save();
        if (battle.phase === 'player_result' && battle.hitDmg > 0) {
            const frac = 1 - battle.timer / 1050;
            const flashAlpha = frac < 0.3 ? frac / 0.3 : frac < 0.6 ? 1 : (1 - frac) / 0.4;
            ctx.globalAlpha = Math.max(0.3, 1 - flashAlpha * 0.5);
        }
        drawBattleSprite(ESX, ESY, ESZ, en.type, t);
        ctx.restore();
    }

    // ── Player HP card (bottom, left of menu) ──────────
    const playerShakeX = shakeAmt;
    ctx.save(); ctx.translate(playerShakeX, 0);
    drawBattleCard(W * 0.04, wallH + H * 0.04, W * 0.40, 56, gs.charName, `Lv ${gs.level}`, gs.hp, gs.maxHp, true);
    // Player sprite (above card, bottom-left zone)
    const PSZ = Math.min(W * 0.18, H * 0.28);
    const PSX = W * 0.12, PSY = wallH - PSZ * 1.0;
    drawBattlePlayerSprite(PSX, PSY, PSZ);
    ctx.restore();

    // ── Bottom UI area ─────────────────────────────────
    const uiTop  = wallH + H * 0.01;
    const uiH    = H - uiTop;
    const msgW   = W * 0.48, menuW = W * 0.44;
    const msgX   = W * 0.04, menuX = W * 0.52;
    const boxH   = uiH * 0.86;
    const boxY   = uiTop + uiH * 0.08;

    // Full-width message box (victory/defeat only)
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
            ctx.fillText(`+${ENEMY_DEFS[en.type].xp} XP`, W / 2, boxY + boxH * 0.80);
        } else {
            ctx.fillStyle = '#ff3030'; ctx.shadowColor = '#ff0000'; ctx.shadowBlur = 24;
            ctx.fillText('DEFEATED', W / 2, boxY + boxH * 0.38);
            ctx.shadowBlur = 0; ctx.font = `${Math.floor(H * 0.038)}px sans-serif`;
            ctx.fillStyle = '#c0a0b0';
            ctx.fillText('Returning to Eldoria…', W / 2, boxY + boxH * 0.68);
        }
        ctx.shadowBlur = 0; ctx.textBaseline = 'alphabetic';
        return;
    }

    // ── Left: dialogue message box ─────────────────────
    drawDialogueBox(msgX, boxY, msgW, boxH);
    ctx.font = `${Math.floor(H * 0.038)}px 'IM Fell English', serif`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillStyle = '#e8d8c0';
    // Word-wrap message
    wrapTextInBox(battle.message, msgX + 18, boxY + 16, msgW - 36, Math.floor(H * 0.038), Math.floor(H * 0.046));

    // Damage pop-up on enemy (player_result)
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
    // Damage pop-up on player (enemy_result)
    if (battle.phase === 'enemy_result') {
        const pop = 1 - battle.timer / 1100;
        const py = PSY + PSZ * 0.1 - pop * H * 0.10;
        ctx.save(); ctx.globalAlpha = Math.min(1, (1 - pop) * 3);
        ctx.font = `bold ${Math.floor(H * 0.060)}px 'Cinzel', serif`;
        ctx.textAlign = 'center'; ctx.fillStyle = '#ff5050';
        ctx.shadowColor = '#ff0000'; ctx.shadowBlur = 16;
        ctx.fillText(`-${battle.playerDmgTaken}`, PSX + PSZ / 2 + playerShakeX, py);
        ctx.shadowBlur = 0; ctx.restore();
    }

    // ── Right: action menu or timing bar ───────────────
    drawDialogueBox(menuX, boxY, menuW, boxH);

    if (battle.phase === 'player_menu') {
        drawBattleMenu(menuX, boxY, menuW, boxH);

    } else if (battle.phase === 'player_item') {
        drawBattleItemMenu(menuX, boxY, menuW, boxH);

    } else if (battle.phase === 'player_timing') {
        drawTimingBarInBox(menuX, boxY, menuW, boxH, en);

    } else {
        // Waiting phases — show an animated ellipsis
        ctx.font = `${Math.floor(H * 0.042)}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#6a5040';
        const dots = '.'.repeat(1 + Math.floor((t * 2) % 3));
        ctx.fillText(dots, menuX + menuW / 2, boxY + boxH / 2);
    }

    ctx.shadowBlur = 0; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
}

function drawDialogueBox(x, y, w, h) {
    ctx.fillStyle = 'rgba(10,6,2,0.96)';
    ctx.strokeStyle = '#5a3820';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 6); ctx.fill(); ctx.stroke();
}

function wrapTextInBox(text, x, y, maxW, fontSize, lineH) {
    const words = text.split(' ');
    let line = '';
    let cy = y;
    for (const word of words) {
        const test = line ? line + ' ' + word : word;
        if (ctx.measureText(test).width > maxW && line) {
            ctx.fillText(line, x, cy);
            line = word; cy += lineH;
        } else { line = test; }
    }
    if (line) ctx.fillText(line, x, cy);
}

function drawBattleCard(x, y, w, h, name, lvlText, hp, maxHp, showXp) {
    ctx.fillStyle = 'rgba(10,6,2,0.90)';
    ctx.strokeStyle = '#4a2818'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 5); ctx.fill(); ctx.stroke();

    const pad = 10, bh = 8;
    // Name + level
    ctx.font = `bold ${Math.floor(h * 0.30)}px 'Cinzel', serif`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillStyle = '#d4b896'; ctx.fillText(name, x + pad, y + pad);
    ctx.font = `${Math.floor(h * 0.22)}px sans-serif`;
    ctx.fillStyle = '#7a5a38'; ctx.fillText(lvlText, x + w - pad - ctx.measureText(lvlText).width, y + pad);

    // HP bar
    const barY = y + h * 0.55, barX = x + pad, barW = w - pad * 2;
    ctx.fillStyle = PALETTE.HP_BG; ctx.fillRect(barX, barY, barW, bh);
    const pct = Math.max(0, hp / maxHp);
    const barCol = pct > 0.5 ? PALETTE.HP_FULL : pct > 0.25 ? PALETTE.HP_MID : PALETTE.HP_LOW;
    ctx.fillStyle = barCol; ctx.fillRect(barX, barY, barW * pct, bh);
    ctx.strokeStyle = '#3a1a10'; ctx.lineWidth = 1; ctx.strokeRect(barX, barY, barW, bh);

    ctx.font = `${Math.floor(h * 0.20)}px sans-serif`;
    ctx.textAlign = 'right'; ctx.fillStyle = '#8a6050';
    ctx.fillText(`${Math.ceil(hp)}/${maxHp}`, x + w - pad, barY + bh + 3);

    if (showXp) {
        const xpBarY = barY + bh + 14;
        ctx.fillStyle = '#0a0a10'; ctx.fillRect(barX, xpBarY, barW, 5);
        ctx.fillStyle = PALETTE.XP_FILL; ctx.fillRect(barX, xpBarY, barW * xpProgressPct(), 5);
        ctx.strokeStyle = '#1a1a30'; ctx.lineWidth = 1; ctx.strokeRect(barX, xpBarY, barW, 5);
        ctx.font = `${Math.floor(h * 0.17)}px sans-serif`;
        ctx.textAlign = 'right'; ctx.fillStyle = '#4060a0';
        ctx.fillText(gs.level < MAX_LEVEL ? `XP: ${xpToNext()} to Lv${gs.level + 1}` : 'MAX', x + w - pad, xpBarY + 6);
    }
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
}

function drawBattleMenu(x, y, w, h) {
    const MENU = [
        { label:'⚔  FIGHT', sub:'Timing minigame', color:'#c8922a', warn: !hasWeapon() },
        { label:'🎒  ITEM',  sub:`${gs.inventory.length} item${gs.inventory.length !== 1 ? 's' : ''}`, color:'#5090d0' },
        { label:'💨  FLEE',  sub:'Try to escape',  color:'#40a060' },
    ];
    const rowH = h / MENU.length;
    MENU.forEach((opt, i) => {
        const ry = y + i * rowH;
        const selected = battle.menuCursor === i;
        if (selected) {
            ctx.fillStyle = 'rgba(200,146,42,0.10)';
            ctx.beginPath(); ctx.roundRect(x + 4, ry + 4, w - 8, rowH - 8, 4); ctx.fill();
            ctx.strokeStyle = '#c8922a'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.roundRect(x + 4, ry + 4, w - 8, rowH - 8, 4); ctx.stroke();
        }
        // Cursor arrow
        ctx.font = `bold ${Math.floor(rowH * 0.42)}px sans-serif`;
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        const midY = ry + rowH / 2;
        ctx.fillStyle = selected ? '#c8922a' : 'transparent';
        ctx.fillText('▶', x + 14, midY);
        // Label
        ctx.fillStyle = opt.warn ? '#806040' : (selected ? '#e8c890' : opt.color);
        ctx.font = `bold ${Math.floor(rowH * 0.42)}px 'Cinzel', serif`;
        ctx.fillText(opt.label, x + 34, midY - rowH * 0.08);
        // Sub-text
        ctx.font = `${Math.floor(rowH * 0.28)}px sans-serif`;
        ctx.fillStyle = opt.warn ? '#a04020' : (selected ? '#8a7050' : '#4a3a28');
        ctx.fillText(opt.warn ? '⚠ No weapon equipped' : opt.sub, x + 34, midY + rowH * 0.22);
        // Divider
        if (i < MENU.length - 1) {
            ctx.strokeStyle = '#2a1808'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(x + 12, ry + rowH); ctx.lineTo(x + w - 12, ry + rowH); ctx.stroke();
        }
    });
    ctx.textBaseline = 'alphabetic';
}

function drawBattleItemMenu(x, y, w, h) {
    const items = gs.inventory;
    if (items.length === 0) {
        ctx.font = `italic ${Math.floor(h * 0.14)}px 'IM Fell English', serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#7a5a40';
        ctx.fillText('Pack is empty.', x + w / 2, y + h / 2);
        ctx.textBaseline = 'alphabetic'; return;
    }
    const rowH = Math.min(h / Math.max(items.length, 1), h / 4);
    const pad = 12;
    items.forEach((item, i) => {
        const ry = y + i * rowH;
        const sel = battle.itemCursor === i;
        if (sel) {
            ctx.fillStyle = 'rgba(80,144,208,0.12)';
            ctx.beginPath(); ctx.roundRect(x + 4, ry + 3, w - 8, rowH - 6, 4); ctx.fill();
            ctx.strokeStyle = '#5090d0'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.roundRect(x + 4, ry + 3, w - 8, rowH - 6, 4); ctx.stroke();
        }
        const midY = ry + rowH / 2;
        ctx.font = `${Math.floor(rowH * 0.48)}px sans-serif`;
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillStyle = sel ? '#e8c890' : '#8a6840';
        ctx.fillText(sel ? '▶' : ' ', x + pad, midY);
        ctx.fillText(item.icon || '◆', x + pad + 20, midY);
        ctx.font = `${Math.floor(rowH * 0.36)}px 'Cinzel', serif`;
        ctx.fillStyle = item.questComplete ? '#c8922a' : (sel ? '#d4b896' : '#7a5a38');
        ctx.fillText(item.name, x + pad + 44, midY - rowH * 0.06);
        ctx.font = `${Math.floor(rowH * 0.26)}px sans-serif`;
        ctx.fillStyle = '#4a3828';
        const subText = item.healAmt ? `Restores ${item.healAmt} HP` : item.questComplete ? 'Equipped' : 'No battle use';
        ctx.fillText(subText, x + pad + 44, midY + rowH * 0.24);
    });
    // Back hint
    ctx.font = `${Math.floor(h * 0.09)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#3a2818';
    ctx.fillText('[Esc] Back', x + w / 2, y + h - 6);
    ctx.textBaseline = 'alphabetic';
}

function drawTimingBarInBox(x, y, w, h, en) {
    const pad = 16, bh = Math.floor(h * 0.18);
    const barY = y + h * 0.46, barX = x + pad, barW = w - pad * 2;

    // Zone fills — MISS(dark) | WEAK(orange) | HIT(yellow-green) | CRIT(bright green) | HIT | WEAK | MISS
    const zones = [
        {from:0,    to:0.15,  col:'#3a0e06'},
        {from:0.15, to:0.32,  col:'#7a3206'},
        {from:0.32, to:0.44,  col:'#7a7408'},
        {from:0.44, to:0.56,  col:'#0a7820'},
        {from:0.56, to:0.68,  col:'#7a7408'},
        {from:0.68, to:0.85,  col:'#7a3206'},
        {from:0.85, to:1.0,   col:'#3a0e06'},
    ];
    for (const z of zones) {
        ctx.fillStyle = z.col;
        ctx.fillRect(barX + barW * z.from, barY, barW * (z.to - z.from), bh);
    }
    // Zone labels inside bar
    ctx.font = `bold ${Math.floor(bh * 0.40)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText('CRIT', barX + barW * 0.50, barY + bh / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.30)';
    ctx.fillText('HIT', barX + barW * 0.38, barY + bh / 2);
    ctx.fillText('HIT', barX + barW * 0.62, barY + bh / 2);
    // Border
    ctx.strokeStyle = '#6a4030'; ctx.lineWidth = 1.5; ctx.strokeRect(barX, barY, barW, bh);

    // Cursor
    const cx2 = barX + barW * battle.cursorPos;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.moveTo(cx2, barY - 7); ctx.lineTo(cx2 - 6, barY - 15); ctx.lineTo(cx2 + 6, barY - 15); ctx.closePath(); ctx.fill();
    ctx.fillRect(cx2 - 3, barY, 6, bh);
    ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(cx2, barY + bh / 2, 4, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;

    // Label above bar
    ctx.font = `bold ${Math.floor(h * 0.13)}px 'Cinzel', serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillStyle = '#c8922a';
    ctx.fillText('STRIKE!', x + w / 2, y + h * 0.10);
    ctx.font = `${Math.floor(h * 0.09)}px sans-serif`;
    ctx.fillStyle = '#6a5040';
    ctx.fillText('Press SPACE at the right moment', x + w / 2, y + h * 0.25);

    // Speed label
    const speedLabel = en.type === 'shade' ? '⚡ Fast' : '🐢 Slow';
    ctx.font = `${Math.floor(h * 0.09)}px sans-serif`;
    ctx.fillStyle = en.type === 'shade' ? '#c85050' : '#508050';
    ctx.fillText(speedLabel, x + w / 2, y + h * 0.80);
    ctx.textBaseline = 'alphabetic';
}

function drawBattleSprite(sx, sy, sz, type, t) {
    const cx = sx + sz/2, cy = sy + sz * 0.5;
    ctx.save();
    if (type === 'shade') {
        // Large wispy shade — multiple dark lobes
        const fl = Math.sin(t * 2.4) * sz * 0.04;
        ctx.fillStyle = '#0a021a';
        ctx.beginPath(); ctx.arc(cx, cy + fl, sz * .42, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#150535';
        ctx.beginPath(); ctx.arc(cx - sz*.18, cy - sz*.12 + fl, sz*.36, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + sz*.18, cy + sz*.04 + fl, sz*.34, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#220a50';
        ctx.beginPath(); ctx.arc(cx, cy - sz*.06 + fl, sz*.30, 0, Math.PI*2); ctx.fill();
        // Tendrils dripping down
        ctx.fillStyle = '#0d0220';
        for (let i = 0; i < 4; i++) {
            const tx2 = cx + (i - 1.5) * sz * .18;
            const th = sz * (0.18 + Math.sin(t*1.8 + i) * 0.06);
            ctx.beginPath(); ctx.ellipse(tx2, cy + sz*.3 + th/2, sz*.045, th/2, 0, 0, Math.PI*2); ctx.fill();
        }
        // Glowing red eyes
        ctx.shadowColor = '#ff0010'; ctx.shadowBlur = sz * .12;
        ctx.fillStyle = '#ff1020';
        ctx.beginPath(); ctx.arc(cx - sz*.10, cy - sz*.06 + fl, sz*.07, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + sz*.10, cy - sz*.06 + fl, sz*.07, 0, Math.PI*2); ctx.fill();
        // Bright inner eye
        ctx.fillStyle = '#ff9090'; ctx.shadowBlur = 0;
        ctx.beginPath(); ctx.arc(cx - sz*.10, cy - sz*.06 + fl, sz*.025, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + sz*.10, cy - sz*.06 + fl, sz*.025, 0, Math.PI*2); ctx.fill();

    } else {
        // Cave Lurker — large armored blob
        // Body shadow
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.beginPath(); ctx.ellipse(cx, cy + sz*.50, sz*.50, sz*.10, 0, 0, Math.PI*2); ctx.fill();
        // Main body
        ctx.fillStyle = '#1e0e08';
        ctx.beginPath(); ctx.ellipse(cx, cy, sz*.45, sz*.40, 0, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#4a2818';
        ctx.beginPath(); ctx.ellipse(cx, cy - sz*.03, sz*.40, sz*.35, 0, 0, Math.PI*2); ctx.fill();
        // Rock armor plating
        const plates = [
            {ox:-0.22,oy:-0.18,w:.22,h:.17},
            {ox: 0.05,oy:-0.26,w:.26,h:.15},
            {ox: 0.18,oy:-0.06,w:.20,h:.18},
            {ox:-0.10,oy: 0.08,w:.24,h:.16},
            {ox: 0.10,oy: 0.15,w:.18,h:.14},
        ];
        for (const pl of plates) {
            ctx.fillStyle = '#6a3c20';
            ctx.beginPath();
            ctx.ellipse(cx + pl.ox*sz, cy + pl.oy*sz, pl.w*sz, pl.h*sz, 0, 0, Math.PI*2);
            ctx.fill();
            ctx.fillStyle = '#8a5030';
            ctx.beginPath();
            ctx.ellipse(cx + pl.ox*sz - sz*.01, cy + pl.oy*sz - sz*.015, pl.w*sz*.65, pl.h*sz*.55, 0, 0, Math.PI*2);
            ctx.fill();
        }
        // Three glowing orange eyes
        ctx.shadowColor = '#ff8010'; ctx.shadowBlur = sz * .10;
        ctx.fillStyle = '#ff8010';
        const eyeY = cy - sz * .07;
        for (let i = -1; i <= 1; i++) {
            ctx.beginPath(); ctx.arc(cx + i*sz*.18, eyeY, sz*.065, 0, Math.PI*2); ctx.fill();
        }
        ctx.fillStyle = '#ffdd80'; ctx.shadowBlur = 0;
        for (let i = -1; i <= 1; i++) {
            ctx.beginPath(); ctx.arc(cx + i*sz*.18, eyeY, sz*.022, 0, Math.PI*2); ctx.fill();
        }
        // Claws at bottom
        ctx.fillStyle = '#2a1208';
        for (let i = -1; i <= 1; i++) {
            ctx.beginPath();
            ctx.moveTo(cx + i*sz*.20 - sz*.05, cy + sz*.30);
            ctx.lineTo(cx + i*sz*.20, cy + sz*.48);
            ctx.lineTo(cx + i*sz*.20 + sz*.05, cy + sz*.30);
            ctx.fill();
        }
    }
    ctx.restore();
}

function drawBattlePlayerSprite(sx, sy, sz) {
    // Small player silhouette for battle scene (back-facing, slightly simplified)
    const cx = sx + sz/2, cy = sy + sz/2;
    const col = CLASS_COLORS[gs.charClass] || CLASS_COLORS.Warrior;
    const cloak = CLASS_CLOAK[gs.charClass] || '#4a2810';
    ctx.save();
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath(); ctx.ellipse(cx, cy + sz*.40, sz*.30, sz*.07, 0, 0, Math.PI*2); ctx.fill();
    // Cloak / body
    ctx.fillStyle = cloak;
    ctx.beginPath(); ctx.arc(cx, cy + sz*.05, sz*.38, 0, Math.PI*2); ctx.fill();
    // Body
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(cx, cy, sz*.32, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 2; ctx.stroke();
    // Head (facing up — back to camera)
    ctx.fillStyle = '#e8cfa0';
    ctx.beginPath(); ctx.arc(cx, cy - sz*.28, sz*.17, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; ctx.stroke();
    // Hair/hood
    ctx.fillStyle = cloak;
    ctx.beginPath(); ctx.arc(cx, cy - sz*.32, sz*.16, Math.PI, Math.PI*2); ctx.fill();
    // Weapon visible on side
    const hasWeapon2 = gs.inventory.some(i => i.questComplete === 'quest_weapon_complete');
    if (hasWeapon2) {
        ctx.fillStyle = '#a0a8d0'; ctx.strokeStyle = '#606080'; ctx.lineWidth = 2;
        ctx.save(); ctx.translate(cx + sz*.25, cy - sz*.12); ctx.rotate(-0.3);
        ctx.fillRect(-sz*.04, -sz*.30, sz*.07, sz*.42); // blade
        ctx.fillStyle = '#6a3010'; ctx.fillRect(-sz*.06, sz*.05, sz*.11, sz*.08); // guard
        ctx.restore();
    }
    ctx.restore();
}


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
    const shouldShow = !battle.active && !ui.loading;
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
            drawCharacter(sx,sy,npc.color,'down',npc.name,false,isAdjacent(npc.x,npc.y),npc.ghost);
    }
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

    renderParticles();  // ambient particles (fireflies, dust, sparks, leaves)
    _renderMotes();     // pooled atmospheric dust motes (always present)
    renderLighting();   // dynamic darkness + torch light + warm color bleed
    renderVignette();   // corner vignette in interiors
    if (typeof VQ !== 'undefined') {
        VQ.renderOutdoorTorchGlow(); // torch warm halo on lit maps
        VQ.renderColorGrade();       // warm tone + full-scene vignette
    }
    // Scanlines — subtle atmospheric overlay, never affects HUD
    if (!_scanlinesCanvas || _scanlinesCanvas.width !== cW || _scanlinesCanvas.height !== cH) _buildScanlinesCanvas();
    ctx.drawImage(_scanlinesCanvas, 0, 0);
    if (battle.active) renderBattle();
    else updateHintBar();
    _perf.draw(ctx, cW); // F3 toggles on-screen FPS counter (drawn last — above all other layers)
    renderMinimap();     // DOM canvas overlay — separate context, always last
}

function isAdjacent(nx,ny){return Math.abs(nx-player.x)+Math.abs(ny-player.y)===1;}

let _lastHint = null;
function updateHintBar() {
    const adj=[{dx:0,dy:-1},{dx:0,dy:1},{dx:-1,dy:0},{dx:1,dy:0}];
    let hint='';
    for (const d of adj) {
        const tx=player.x+d.dx, ty=player.y+d.dy;
        if (tx<0||tx>=currentMap.w||ty<0||ty>=currentMap.h) continue;
        const tile=currentMap.tiles[ty][tx];
        if (tile===TILE.SIGN)    { hint='Press E to read'; break; }
        if (tile===TILE.DOOR) {
            const entrances = BUILDING_ENTRANCES[currentMap.id];
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
    if (hint !== _lastHint) { _lastHint = hint; document.getElementById('hint-bar').textContent = hint; }
}

// ═══════════════════════════════════════════════════════
//  INTERACTION
// ═══════════════════════════════════════════════════════
function handleInteract() {
    if(ui.questLog){closeQuestLog();return;}
    if(ui.dialogue){closeDialogue();return;}
    if(ui.sign)    {closeSign();return;}

    const adj=[{dx:0,dy:-1},{dx:0,dy:1},{dx:-1,dy:0},{dx:1,dy:0}];
    for(const d of adj){
        const tx=player.x+d.dx,ty=player.y+d.dy;
        if(tx<0||tx>=currentMap.w||ty<0||ty>=currentMap.h)continue;
        const tile=currentMap.tiles[ty][tx];

        if(tile===TILE.SIGN){
            const s=currentMap.signs.find(s=>s.x===tx&&s.y===ty);
            if(s) showSign(s.text, s.questComplete);
            return;
        }
        if(tile===TILE.STAIRS){handleStairsDown();return;}
        if(tile===TILE.STAIRSUP){handleStairsUp();return;}

        const npc=currentMap.npcs.find(n=>n.x===tx&&n.y===ty);
        if(npc){startDialogue(npc);return;}
    }
}

// ─ Sign ────────────────────────────────────────────────
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

// ─ Items ───────────────────────────────────────────────
function itemVisible(item) {
    return !item.questRequired || !!gs.flags[item.questRequired];
}

function checkItemPickup() {
    const items=currentMap.items;
    for(let i=items.length-1;i>=0;i--){
        if(!itemVisible(items[i])) continue;
        if(items[i].x===player.x&&items[i].y===player.y){
            const item=items.splice(i,1)[0];
            gs.inventory.push(item);
            showNotification(`Found: ${item.name}`,'item');
            if(item.questComplete&&!gs.flags[item.questComplete]){
                gs.flags[item.questComplete]=true;
                const q=QUESTS.find(q=>q.flag_complete===item.questComplete);
                if(q) setTimeout(()=>showNotification(`Quest Complete: ${q.title}`,'quest'),600);
                updateQuestUI();
            }
            updateInventoryUI();
        }
    }
}

// ─ Dialogue ────────────────────────────────────────────
async function startDialogue(npc) {
    ui.loading=true;
    const box=document.getElementById('dialogue-box');
    document.getElementById('dlg-name').textContent=npc.name;
    document.getElementById('dlg-portrait').textContent=npc.portrait;
    const dlgText=document.getElementById('dlg-text');
    dlgText.textContent='Thinking…';
    dlgText.classList.add('dlg-loading');
    document.getElementById('dlg-player-msg').textContent='';
    _dlgSetInputEnabled(false);
    box.classList.remove('hidden');
    const data=await callInteract(npc,'',npc.history);
    npc.history=data.history;
    ui.dialogue=npc; ui.loading=false;
    showDialogueData(data);
    _dlgFocus();
}

async function sendDialogueMessage() {
    if(ui.loading||!ui.dialogue)return;
    const input=document.getElementById('dlg-input');
    const text=input.value.trim();
    if(!text)return;
    input.value='';
    const npc=ui.dialogue;
    ui.loading=true;
    document.getElementById('dlg-player-msg').textContent=`You: "${text}"`;
    const dlgText2=document.getElementById('dlg-text');
    dlgText2.textContent='Thinking…';
    dlgText2.classList.add('dlg-loading');
    _dlgSetInputEnabled(false);
    const data=await callInteract(npc,text,npc.history);
    npc.history=data.history;
    ui.loading=false;
    // Grant quest only when LLM explicitly signals it
    if(data.quest_given){
        const flag=QUEST_GIVER_FLAGS[npc.id];
        if(flag&&!gs.flags[flag]){
            gs.flags[flag]=true;
            const q=QUESTS.find(q=>q.flag_given===flag);
            if(q) showNotification(`New Quest: ${q.title}`,'quest');
            updateQuestUI();
        }
    }
    if(data.ended){closeDialogue();return;}
    showDialogueData(data);
    _dlgFocus();
}

async function callInteract(npc,playerText,history) {
    const res=await fetch('/interact',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({npc:{name:npc.name,role:npc.role,id:npc.id},playerText,history,flags:gs.flags})});
    return res.json();
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
    // Quest is granted via LLM signal, NOT automatically on close
    ui.dialogue=null; ui.loading=false;
    document.getElementById('dialogue-box').classList.add('hidden');
    document.getElementById('dlg-player-msg').textContent='';
    const inp=document.getElementById('dlg-input');
    if(inp){inp.value='';inp.disabled=false;}
}

// ─ Quest Log ───────────────────────────────────────────
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

function updateInventoryUI() {
    // Refresh the full inventory screen if it's open
    if (ui.inventory) renderInventoryScreen();
}

// ─ Full Inventory / Character Screen ───────────────────
let _selectedItem = null;

const CLASS_STATS = {
    Warrior: { atk:16, def:8,  spd:'Normal' },
    Rogue:   { atk:13, def:5,  spd:'Fast'   },
    Wizard:  { atk:20, def:3,  spd:'Slow'   },
    Cleric:  { atk:11, def:10, spd:'Normal' },
};
const CLASS_ICONS = { Warrior:'⚔️', Rogue:'🗡️', Wizard:'🪄', Cleric:'🔱' };

function toggleInventory() {
    if (ui.inventory) closeInventory();
    else openInventory();
}

function openInventory() {
    if (battle.active || ui.dialogue || ui.sign || ui.paused) return;
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

    // ── Character panel ────────────────────────────────
    document.getElementById('inv-char-portrait').textContent = CLASS_ICONS[gs.charClass] || '🧑';
    document.getElementById('inv-char-name').textContent = gs.charName;
    document.getElementById('inv-char-class').textContent = gs.charClass.toUpperCase();
    document.getElementById('inv-level-badge').textContent = `Lv ${gs.level}`;

    // HP bar
    const hpPct = Math.max(0, gs.hp / gs.maxHp);
    document.getElementById('inv-hp-fill').style.width = `${hpPct * 100}%`;
    document.getElementById('inv-hp-val').textContent = `${Math.ceil(gs.hp)}/${gs.maxHp}`;

    // XP bar
    const xpPct = gs.level >= MAX_LEVEL ? 1 : xpProgressPct();
    document.getElementById('inv-xp-fill').style.width = `${xpPct * 100}%`;
    const nextXP = gs.level >= MAX_LEVEL ? '—' : xpToNext() + ' XP';
    document.getElementById('inv-xp-val').textContent = gs.level >= MAX_LEVEL ? 'MAX' : `${gs.xp - xpForLevel(gs.level)} / ${xpForLevel(gs.level+1) - xpForLevel(gs.level)}`;

    // Stats (scale slightly with level)
    const lvlBonus = gs.level - 1;
    document.getElementById('inv-atk-val').textContent = stats.atk + lvlBonus * 2;
    document.getElementById('inv-def-val').textContent = stats.def + lvlBonus;
    document.getElementById('inv-spd-val').textContent = stats.spd;
    document.getElementById('inv-next-val').textContent = gs.level >= MAX_LEVEL ? 'MAX LEVEL' : nextXP;

    // Equipped weapon
    const weapon = gs.inventory.find(i => i.questComplete === 'quest_weapon_complete');
    if (weapon) {
        document.getElementById('inv-equipped-icon').textContent = weapon.icon || '⚔️';
        document.getElementById('inv-equipped-name').textContent = weapon.name;
    } else {
        document.getElementById('inv-equipped-icon').textContent = '—';
        document.getElementById('inv-equipped-name').textContent = 'Nothing equipped';
    }

    // ── Item grid ─────────────────────────────────────
    const grid = document.getElementById('inv-grid');
    grid.innerHTML = '';

    const GRID_SIZE = 20; // always show 20 slots
    const emptyMsg = document.getElementById('inv-empty-msg');
    emptyMsg.style.display = gs.inventory.length === 0 ? 'block' : 'none';

    for (let i = 0; i < GRID_SIZE; i++) {
        const slot = document.createElement('div');
        const item = gs.inventory[i];
        if (item) {
            slot.className = 'inv-slot' + (_selectedItem === item ? ' selected' : '');
            slot.innerHTML = `<div class="slot-icon">${item.icon || '◆'}</div><div class="slot-name">${item.name}</div>`;
            // Quest badge if it's a quest item
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

    // ── Item detail panel ──────────────────────────────
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
    // Only consumables (not quest weapons) can be "used" — for now, just inspect
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

// ─ Notifications ───────────────────────────────────────
function showNotification(msg,type='info') {
    const el=document.createElement('div');
    el.className=`notif notif-${type}`;el.textContent=msg;
    document.getElementById('notifications').appendChild(el);
    requestAnimationFrame(()=>el.classList.add('notif-show'));
    setTimeout(()=>el.classList.remove('notif-show'),2800);
    setTimeout(()=>el.remove(),3300);
}

// ═══════════════════════════════════════════════════════
//  AMBIENT AUDIO
// ═══════════════════════════════════════════════════════
let audioCtx=null,masterGain=null,melodyTimer=null,allNodes=[],musicOn=true;
const SCALE_VILLAGE=[110,123.47,130.81,146.83,164.81,174.61,196,220,246.94,261.63,293.66,329.63,349.23,392,440];
const SCALE_DUNGEON=[110,116.54,130.81,138.59,164.81,174.61,185,220,233.08,261.63,277.18,329.63,349.23,370,440];

function startMusic() {
    if(audioCtx)return;
    audioCtx=new(window.AudioContext||window['webkitAudioContext'])();
    masterGain=audioCtx.createGain();masterGain.gain.value=((window.gameVolumePct??50)/100)*0.25;
    const delay=audioCtx.createDelay(3);delay.delayTime.value=0.45;
    const fb=audioCtx.createGain();fb.gain.value=0.42;
    const lpf=audioCtx.createBiquadFilter();lpf.type='lowpass';lpf.frequency.value=1800;
    delay.connect(lpf);lpf.connect(fb);fb.connect(delay);
    delay.connect(masterGain);masterGain.connect(audioCtx.destination);
    allNodes.push(delay,fb,lpf);
    startWind(masterGain);startDrone(55,masterGain);
    scheduleMelody(delay,masterGain);
}

function startDrone(f,out){const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type='sine';o.frequency.value=f;g.gain.value=0.055;o.connect(g);g.connect(out);o.start();allNodes.push(o,g);}

function startWind(out){const len=audioCtx.sampleRate*3,buf=audioCtx.createBuffer(1,len,audioCtx.sampleRate),d=buf.getChannelData(0);for(let i=0;i<len;i++)d[i]=Math.random()*2-1;const src=audioCtx.createBufferSource();src.buffer=buf;src.loop=true;const flt=audioCtx.createBiquadFilter();flt.type='bandpass';flt.frequency.value=400;flt.Q.value=0.5;const wg=audioCtx.createGain();wg.gain.value=0.04;const lfo=audioCtx.createOscillator(),lfog=audioCtx.createGain();lfo.frequency.value=0.06;lfog.gain.value=0.03;lfo.connect(lfog);lfog.connect(wg.gain);lfo.start();src.connect(flt);flt.connect(wg);wg.connect(out);src.start();allNodes.push(src,flt,wg,lfo,lfog);}

function playNote(freq,wet,dry){const now=audioCtx.currentTime,o=audioCtx.createOscillator(),e=audioCtx.createGain();o.type='sine';o.frequency.value=freq;e.gain.setValueAtTime(0,now);e.gain.linearRampToValueAtTime(0.18,now+0.05);e.gain.exponentialRampToValueAtTime(0.001,now+4.5);o.connect(e);e.connect(wet);e.connect(dry);o.start(now);o.stop(now+4.6);}

function scheduleMelody(wet,dry){
    const scale=currentMap.dark?SCALE_DUNGEON:SCALE_VILLAGE;
    [scale[0],scale[2],scale[4]].forEach(f=>playNote(f,wet,dry));
    melodyTimer=setInterval(()=>{if(!audioCtx||audioCtx.state==='closed')return;
        const sc=currentMap.dark?SCALE_DUNGEON:SCALE_VILLAGE;
        const n=Math.random()<0.25?2:1;
        for(let i=0;i<n;i++)playNote(sc[Math.floor(Math.random()*sc.length)],wet,dry);
    },2800+Math.random()*2000);
}

function stopMusic(){clearInterval(melodyTimer);melodyTimer=null;allNodes.forEach(n=>{try{n.stop?n.stop():n.disconnect();}catch(e){}});allNodes=[];if(audioCtx){audioCtx.close();audioCtx=null;masterGain=null;}}

// ═══════════════════════════════════════════════════════
//  PAUSE MENU
// ═══════════════════════════════════════════════════════
const _pauseEl  = () => document.getElementById('pause-menu');
const _pauseVol = () => document.getElementById('pause-vol');

function openPause() {
    if (document.getElementById('game-screen').classList.contains('hidden')) return;
    ui.paused = true;
    if (audioCtx && audioCtx.state === 'running') audioCtx.suspend();
    clearInterval(melodyTimer); melodyTimer = null;
    // Sync pause slider to shared volume preference
    const vol = window.gameVolumePct ?? 50;
    const slider = _pauseVol();
    slider.value = Math.min(100, Math.max(0, vol));
    _updateSliderFill(slider);
    _pauseEl().classList.remove('hidden');
}

function closePause() {
    ui.paused = false;
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    _pauseEl().classList.add('hidden');
}

function _updateSliderFill(slider) {
    slider.style.setProperty('--pct', slider.value + '%');
}

// Wire up pause slider — delegates to syncVolSliders so menu slider stays in sync too
document.getElementById('pause-vol').addEventListener('input', function() {
    _updateSliderFill(this);
    if (typeof syncVolSliders === 'function') syncVolSliders(+this.value);
    else if (masterGain) masterGain.gain.value = (this.value / 100) * 0.25;
});

// Resume button
document.getElementById('pause-resume').addEventListener('click', closePause);

// Fullscreen button
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
    // also update the main menu options button if it exists
    if (typeof window['updateOptFullscreenLabel'] === 'function') window['updateOptFullscreenLabel']();
}

document.getElementById('pause-fullscreen').addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', updateFullscreenLabel);

// F11 shortcut toggles fullscreen from anywhere in-game
document.addEventListener('keydown', e => {
    if (e.key === 'F11') { e.preventDefault(); toggleFullscreen(); }
}, true);

// Main Menu button (reuses the restart flow)
document.getElementById('pause-mainmenu').addEventListener('click', () => {
    closePause();
    document.getElementById('restart-btn').click();
});

// ═══════════════════════════════════════════════════════
//  PERFORMANCE MONITOR  (press F3 to toggle)
// ═══════════════════════════════════════════════════════
const _perf = (() => {
    const SAMPLES = 60;
    const frames  = new Float32Array(SAMPLES); // ring buffer — no GC
    let   head    = 0, filled = 0, lastT = 0, visible = false;

    document.addEventListener('keydown', e => {
        if (e.key === 'F3') { e.preventDefault(); visible = !visible; }
    });

    return {
        startFrame(ts) {
            if (lastT) {
                frames[head] = ts - lastT;
                head = (head + 1) % SAMPLES;
                if (filled < SAMPLES) filled++;
            }
            lastT = ts;
        },
        draw(ctx2, w) {
            if (!visible || !filled) return;
            let sum = 0, worst = 0;
            for (let i = 0; i < filled; i++) {
                const v = frames[i];
                sum += v;
                if (v > worst) worst = v;
            }
            const avg = sum / filled;
            const fps = Math.round(1000 / avg);
            const color = fps < 50 ? '#f44' : fps < 58 ? '#fa0' : '#4f4';
            ctx2.save();
            ctx2.font = 'bold 12px monospace';
            ctx2.fillStyle = 'rgba(0,0,0,0.55)';
            ctx2.fillRect(w - 282, 6, 276, 20);
            ctx2.fillStyle = color;
            ctx2.fillText(
                `FPS: ${fps}  avg: ${avg.toFixed(1)}ms  worst: ${worst.toFixed(1)}ms`,
                w - 278, 20
            );
            ctx2.restore();
        },
    };
})();

// ═══════════════════════════════════════════════════════
//  GAME LOOP
// ═══════════════════════════════════════════════════════
// Fixed-timestep game loop — physics/logic always runs at 60 Hz regardless of
// monitor refresh rate.  Raw delta is capped at 50 ms to prevent the
// spiral-of-death when the tab is backgrounded or the frame takes too long.
const FIXED_STEP = 1000 / 60; // ~16.667 ms
let lastTs = 0, accumulator = 0;

function loop(ts) {
    _perf.startFrame(ts);
    const rawDt = ts - lastTs;
    lastTs = ts;
    timeMs = ts;

    // Cap so a very long frame doesn't simulate many steps at once
    accumulator += Math.min(rawDt, 50);

    while (accumulator >= FIXED_STEP) {
        const dt = FIXED_STEP;
        updateMovement(dt);
        updatePlayerAnim(dt);
        updateCamera();
        updateEnemies(dt);
        updateBattle(dt);
        updateParticles(dt);
        accumulator -= FIXED_STEP;
    }
    // Guard: if no fixed step ran this frame (accumulator too small),
    // JUST_PRESSED would never be cleared — clearing here prevents a key
    // press from being held over into a later frame and firing twice.
    JUST_PRESSED.clear();

    _updateMotes();

    // Advance SpriteRenderer animations (water, torch) with the raw frame delta.
    // rawDt is capped at 50 ms above — safe to pass directly.
    if (typeof spriteRenderer !== 'undefined') {
        spriteRenderer.advanceAnimations(Math.min(rawDt, 50));
    }
    render();
    requestAnimationFrame(loop);
}

// ═══════════════════════════════════════════════════════
//  INITIALIZATION
// ═══════════════════════════════════════════════════════
// ── Starter weapon placement ────────────────────────────
const STARTER_WEAPONS = {
    Warrior: { name:'Iron Sword',    icon:'⚔️',  color:'#b0b8e8', desc:'A well-worn iron sword. Still sharp.' },
    Rogue:   { name:'Shadow Dagger', icon:'🗡️',  color:'#80c0d8', desc:'Light, quick, and quiet.'             },
    Wizard:  { name:'Arcane Staff',  icon:'🪄',  color:'#c090e8', desc:'Hums faintly with old magic.'         },
    Cleric:  { name:'Holy Mace',     icon:'🔱',  color:'#e8c060', desc:'Blessed by the Old Gods.'             },
};

function placeStarterWeapon(charClass) {
    const weapon = { ...STARTER_WEAPONS[charClass] || STARTER_WEAPONS.Warrior,
                     questRequired:'quest_weapon_given',
                     questComplete:'quest_weapon_complete' };
    const sx = currentMap.playerStart.x, sy = currentMap.playerStart.y;
    const walkable = new Set([TILE.GRASS, TILE.DIRT_PATH, TILE.STONE_PATH]);
    // Try random positions in a ring of radius 4–10 around start
    for (let attempt = 0; attempt < 60; attempt++) {
        const angle = Math.random() * Math.PI * 2;
        const dist  = 4 + Math.floor(Math.random() * 7);
        const tx = Math.round(sx + Math.cos(angle) * dist);
        const ty = Math.round(sy + Math.sin(angle) * dist);
        if (tx<1||ty<1||tx>=currentMap.w-1||ty>=currentMap.h-1) continue;
        const tile = currentMap.tiles[ty]?.[tx];
        if (!walkable.has(tile)) continue;
        if (currentMap.npcs.some(n=>n.x===tx&&n.y===ty)) continue;
        if (currentMap.items.some(i=>i.x===tx&&i.y===ty)) continue;
        currentMap.items.push({ ...weapon, x:tx, y:ty });
        return;
    }
    // Fallback: place south of player on path
    currentMap.items.push({ ...weapon, x:sx, y:sy+5 });
}

// ── Intro cinematic sequence ────────────────────────────
function playIntroSequence() {
    const ov = document.getElementById('intro-overlay');
    const lines = [
        'You open your eyes…',
        'Eldoria.\nA village clinging to the edge of darkness.',
        'Someone is calling your name.',
    ];
    let i = 0;
    const txt = document.getElementById('intro-text');
    ov.style.opacity = '1';
    ov.classList.remove('hidden');

    function showLine() {
        if (i >= lines.length) {
            // Fade out intro overlay → game becomes fully visible
            ov.style.transition = 'opacity 1.2s ease';
            ov.style.opacity = '0';
            setTimeout(() => { ov.classList.add('hidden'); }, 1250);
            return;
        }
        txt.style.opacity = '0';
        txt.textContent = lines[i];
        // Small pause then fade in text
        setTimeout(() => {
            txt.style.transition = 'opacity 0.7s ease';
            txt.style.opacity = '1';
        }, 100);
        // Hold then fade out
        setTimeout(() => {
            txt.style.transition = 'opacity 0.5s ease';
            txt.style.opacity = '0';
        }, 1900);
        setTimeout(() => { i++; showLine(); }, 2500);
    }
    showLine();
}

function startGame(name,charClass) {
    gs.charName=name;gs.charClass=charClass;gs.flags={};gs.inventory=[];
    const classMaxHp={Warrior:60,Rogue:45,Wizard:35,Cleric:55};
    gs.maxHp=classMaxHp[charClass]||50; gs.hp=gs.maxHp;
    gs.xp=0; gs.level=1;
    currentMap=MAPS.village;
    [...VILLAGE_NPCS,...GUIDE_NPCS,...DUNGEON_NPCS,...ELDER_NPCS,...BLACKSMITH_NPCS,...VEYLA_NPCS].forEach(n=>n.history=[]);
    MAPS.village.items=[];
    rebuildDungeon(); // fresh procedurally generated mine every new game
    placeStarterWeapon(charClass);
    player.x=currentMap.playerStart.x; player.y=currentMap.playerStart.y; player.facing='down';
    player.renderX=player.x*TS; player.renderY=player.y*TS;
    player.prevX=player.renderX; player.prevY=player.renderY;
    player.moveT=1; player.isMoving=false; player.walkPhase=0;
    ui.dialogue=null;ui.sign=null;ui.questLog=false;ui.loading=false;ui.paused=false;ui.inventory=false;
    _pauseEl().classList.add('hidden');
    resizeCanvas();
    document.getElementById('start-screen').classList.add('hidden');
    document.getElementById('game-screen').classList.remove('hidden');
    document.getElementById('hud-name').textContent=name;
    document.getElementById('hud-class').textContent=charClass;
    document.getElementById('hud-location').textContent=currentMap.name;
    updateQuestUI();updateInventoryUI();updateHPUI();
    startMusic();
    requestAnimationFrame(loop);
    // Black intro sequence — fades out after the cinematic lines
    if (typeof fadeOverlay === 'function') fadeOverlay('out');
    playIntroSequence();
}

document.getElementById('begin-btn').addEventListener('click',()=>{
    const name=document.getElementById('char-name').value.trim();
    const charClass=document.querySelector('.class-card.selected')?.dataset.class;
    if (!name || !charClass) return; // button should already be disabled; guard anyway
    setTimeout(()=>startGame(name,charClass), 340);
});

document.getElementById('restart-btn').addEventListener('click',()=>{
    stopMusic();closeDialogue();closeSign();closeQuestLog();
    // Fade to black, swap back to menu, then fade in
    if (typeof fadeOverlay === 'function') {
        fadeOverlay('in', ()=>{
            document.getElementById('game-screen').classList.add('hidden');
            const ss=document.getElementById('start-screen');ss.classList.remove('hidden');
            document.querySelectorAll('.menu-panel').forEach(p=>{p.classList.add('hidden');p.style.opacity='0';p.style.transform='';});
            const main=document.getElementById('menu-main');
            main.classList.remove('hidden');
            main.style.transform='translateY(0)';
            requestAnimationFrame(()=>{main.style.opacity='1';});
            menuLoop&&menuLoop();
            // Reset character creation form
            document.getElementById('char-name').value='';
            document.querySelectorAll('.class-card').forEach(c=>c.classList.remove('selected'));
            document.getElementById('begin-btn').disabled=true;
            document.getElementById('create-error').classList.add('hidden');
            fadeOverlay('out');
        });
    } else {
        document.getElementById('game-screen').classList.add('hidden');
        const ss=document.getElementById('start-screen');ss.classList.remove('hidden');
        document.querySelectorAll('.menu-panel').forEach(p=>{p.classList.add('hidden');p.style.opacity='0';});
        const main=document.getElementById('menu-main');main.classList.remove('hidden');
        requestAnimationFrame(()=>{main.style.opacity='1';});
        menuLoop&&menuLoop();
    }
});

document.getElementById('music-toggle').addEventListener('click',()=>{
    musicOn=!musicOn;const btn=document.getElementById('music-toggle');
    musicOn?(startMusic(),btn.classList.add('active')):(stopMusic(),btn.classList.remove('active'));
});

document.getElementById('quest-btn').addEventListener('click',toggleQuestLog);
document.getElementById('close-quest-log').addEventListener('click',closeQuestLog);
