'use strict';

// Shorthand for the cross-module namespace (populated by game-constants.js + world.js)
const Game   = window.Game;
const canvas = document.getElementById('game-canvas');

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
// Shims — declarations live in game-constants.js
const TILE               = Game.TILE;
const WALKABLE           = Game.WALKABLE;
const WORLD_ITEM_PLACEABLE = Game.WORLD_ITEM_PLACEABLE;
const WEAPON_SEARCH_RADIUS = Game.WEAPON_SEARCH_RADIUS;
const MINIMAP_COLORS     = Game.MINIMAP_COLORS;
const ANIMATED_TILES     = Game.ANIMATED_TILES;

const PALETTE = Game.PALETTE;

const ENEMY_DEFS = Game.ENEMY_DEFS;
const { GRASS:G, DIRT_PATH:P, BUILDING_FLOOR:F, BUILDING_WALL:W, TREE:TR,
        WATER:WA, DOOR:DR, STAIRS:ST, SIGN:SG,
        STAIRSUP:SU, TORCH:TC, STONE_PATH:SP, VOID:VD } = TILE;

// Noise functions live in game-noise.js (plain globals: _vhash, _vnoise, _vfbm)

// Seeded deterministic PRNG (LCG) — returns values in [0, 1)
function _rng(seed) {
    let s = (seed * 1664525 + 1013904223) >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const BIOME = Game.BIOME;

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
    s(8,  8, SG);   // notice board (village_alert target)

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
    { id:'guide', name:'Rowan', x:21, y:15, portrait:'🧑', color:'#80c870',
      role:'A friendly young villager who greets newcomers and introduces them to Eldoria.' },
];

const VILLAGE_NPCS = [];  // Major NPCs are inside buildings; Rowan stays in the village square

const ELDER_NPCS = [
    { id:'elder', name:'Elder Maren', x:6, y:5, portrait:'👴', color:'#d0c870',
      role:'The elderly leader of Eldoria. Wise but frightened — darkness spreads from the Cursed Mines to the south. He desperately needs someone to investigate. He will explicitly ask the player to enter the mines, promising a reward. If the player has entered the mines (quest_into_dark_complete=true), he reacts with relief and asks what they found.' },
];

const BLACKSMITH_NPCS = [
    { id:'blacksmith', name:'Daran', x:4, y:4, portrait:'🔨', color:'#d07040',
      role:'The village blacksmith. Gruff, grieving. His brother Henrick went into the mines 3 months ago and never returned. He will ask the player to look for any sign of Henrick. If quest_brothers_fate_complete=true (Henrick\'s ring found), he breaks down and thanks the player, and says at least now he knows.' },
];

const VEYLA_NPCS = [
    { id:'traveler', name:'Veyla', x:5, y:2, portrait:'🧝', color:'#70a0e0',
      role:'A mysterious elven wanderer. Cryptic, testing. She knows an ancient sealed entity called the Hollow King lies in the mines. She will ask the player to find the ancient tablet that describes the seal. If quest_sealed_truth_complete=true, she reveals she is a Warden\'s descendant sent to reinforce the seal.' },
];

const VILLAGE_SIGNS = [
    { x:21, y:8, text:'— ELDORIA —\n\nFounded in the Year of the Third Moon.\nPopulation: 23.\n\n"May the Old Gods light your path."' },
    { x:21, y:32, text:'THE CURSED MINES\n\n"Turn back. Whatever you hear below,\ndo not answer it."\n\n— scratched into the stone by a shaking hand', type:'stairs' },
    { x:8,  y:8, text:'Notice Board\n\nNo current announcements.' },
];

const DUNGEON_NPCS = [
    { id:'ghost', name:"Mira's Ghost", x:5, y:12, portrait:'👻', color:'rgba(160,200,255,0.85)', ghost:true,
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
//  LORE ENTRIES
// ═══════════════════════════════════════════════════════
const LORE_ENTRIES = {
    hollow_king: {
        key:    'hollow_king',
        title:  'The Hollow King',
        body:   'The entity imprisoned beneath the Cursed Mines was not defeated — it was contained, which is a different thing entirely. The elven seers who built the seal called it the Hollow King because it had consumed its own name and left nothing behind. Ancient, vast, and without purpose the way hunger is without purpose. The seal was designed to be permanent. Even those who placed it were not certain it would hold a thousand years. It has been eleven hundred.',
        source: 'Veyla',
    },
    brightmines_history: {
        key:    'brightmines_history',
        title:  'The Brightmines',
        body:   'Before the darkness, the mines were called the Brightmines, named by the original surveyors who found veins of coal and copper running deep under the foothills — and something older they did not have a word for. Three generations of Eldoria\'s prosperity came from those tunnels. The miners carved deep. There are chambers in the lower levels that have not been revisited in forty years. The village has not spoken the old name aloud since the darkness began.',
        source: 'Elder Maren',
    },
    seal_weakening: {
        key:    'seal_weakening',
        title:  'The Weakening Seal',
        body:   'The elven seal on the Hollow King requires maintenance — periodic renewal by someone who understands the old forms. The knowledge has not been passed down. No one in Eldoria has it. Veyla does, though she will not say so directly. The madness event three weeks ago — the seven who went in, the one who returned — was not the seal breaking. It was the seal cracking slightly open, like a door held shut by a failing latch. The difference is important.',
        source: 'Veyla',
    },
    henrick_fate: {
        key:    'henrick_fate',
        title:  "Daran's Brother",
        body:   'Henrick Vale went into the mines three months ago as part of an informal search party — men with torches and the particular determination of people who need to do something. He was the last to enter the lower chambers before the group turned back. They returned. He did not. His iron ring — stamped with the forge sigil, the same mark Daran uses — is somewhere in the lower levels. Daran does not speak of this unprompted.',
        source: 'Daran',
    },
    village_founders: {
        key:    'village_founders',
        title:  'The Founders of Eldoria',
        body:   'Eldoria was founded four generations ago by twelve families who followed a surveying party south from the mountains, drawn by reports of coal and copper deposits in the foothills. The miners who first went below expected ore. They found other things as well, though the old records are vague on what. Maren\'s family was among the twelve. The founders\' names are carved into the stone of the central well, though two of the families left early and are no longer spoken of.',
        source: 'Elder Maren',
    },
    veyla_history: {
        key:    'veyla_history',
        title:  'The Wandering Seer',
        body:   "Veyla arrived in Eldoria eight months ago and has not explained why she is still here. The inn's oldest guest ledger — kept behind the bar, rarely consulted — contains an entry in similar handwriting from eighty years prior. When asked directly, she neither confirms nor denies it. She is not merely old. She is watching for something specific, and she appears to be watching for it here.",
        source: 'Veyla',
    },
    darkness_nature: {
        key:    'darkness_nature',
        title:  'The Spreading Dark',
        body:   "The darkness spreading from the mines is not darkness in the literal sense — it is absence. Light dims. Warmth drains. Thoughts scatter at the edges. It is the Hollow King's influence diffusing through the stone, the way water moves through rock given enough time. It affects animals first, which is why they fled months before anyone noticed. Then the sensitive. Then, eventually, everyone. The survivor rocking in the inn is not mad. He is depleted. There is a difference, and it matters for what comes next.",
        source: 'Veyla',
    },
};
window.LORE_ENTRIES = LORE_ENTRIES;

// ═══════════════════════════════════════════════════════
//  AMBIENT / ENCOUNTER / DISCOVERY LINES
// ═══════════════════════════════════════════════════════
const AMBIENT_LINES = {
    guide: [
        "Okay so — have you talked to Elder Maren yet?",
        "The mines have been quiet today. That's — probably fine.",
        "I've been timing myself running to the well and back. New record.",
        "Did you notice Veyla moved to a different table at the inn again?",
        "Right, so don't go south after dark. Just — don't.",
        "I keep meaning to fix that sign by the well. Keep meaning to.",
    ],
    elder: [
        "Edrea always said the mines had a voice. I'm starting to think she was right.",
        "By the old stones. By the old stones.",
        "Come by later if you want to talk.",
        "I've been watching the south road. Nothing good comes from watching.",
        "Sleep has been difficult. It is for all of us, I think.",
    ],
    blacksmith: [
        "Hm.",
        "Need something?",
        "Iron doesn't ask questions.",
        "...",
        "Not now.",
        "Henrick used to help here.",
    ],
    traveler: [
        "You're still here. Interesting.",
        "The light changes near the mines. You've noticed that.",
        "Old stones remember everything.",
        "I've been in worse places. Many worse.",
        "Some doors don't open from the outside.",
        "The deepest shafts weren't dug by the miners. Someone else started that work.",
        "There's a cold that comes from below. Not weather. Something else.",
    ],
};
// Snapshot for new-game reset — mutations from world events are reversed in startGame()
const AMBIENT_LINES_DEFAULT = {
    guide:      [...AMBIENT_LINES.guide],
    elder:      [...AMBIENT_LINES.elder],
    blacksmith: [...AMBIENT_LINES.blacksmith],
    traveler:   [...AMBIENT_LINES.traveler],
};

const ENCOUNTER_LINES = {
    shade: [
        "The shadow detaches from the wall. It has eyes.",
        "Something cold moves in the dark ahead.",
        "The air pressure drops. You are not alone.",
        "It makes no sound. That is somehow worse.",
        "Between one blink and the next, it is in front of you.",
    ],
    lurker: [
        "The ground vibrates. Then stops.",
        "Three orange lights in the dark. Watching.",
        "Something very heavy shifts in the stone ahead.",
        "You smell copper and old rot.",
        "It has been here a very long time.",
    ],
};

const DISCOVERY_LINES = {
    cave_pool:   "Dark water. Still. Something beneath the surface catches what little light reaches here.",
    first_rubble:"Collapsed stone, old. Whatever caused this happened years ago at least.",
    first_room:  "The passage opens. Larger than you expected. The ceiling is lost in darkness above.",
    low_hp:      "You are bleeding. The mines don't care.",
};

let _discoveredFlavor = new Set();

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
Game.MAPS = MAPS;

// ── Rebuild dungeon with fresh procedural generation ────
function rebuildDungeon() {
    _discoveredFlavor.clear();
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
window.Game.BUILDING_ENTRANCES = BUILDING_ENTRANCES;

// ═══════════════════════════════════════════════════════
//  QUEST DEFINITIONS
// ═══════════════════════════════════════════════════════
const QUESTS            = Game.QUESTS;
const QUEST_GIVER_FLAGS = Game.QUEST_GIVER_FLAGS;

// ═══════════════════════════════════════════════════════
//  GAME STATE
// ═══════════════════════════════════════════════════════

// XP thresholds — xpThresholds[level] = total XP needed to reach that level
const XP_THRESHOLDS = [0, 0, 60, 150, 280, 450, 670, 950, 1300, 1720, 2220];
// Max level = XP_THRESHOLDS.length - 1
const MAX_LEVEL = XP_THRESHOLDS.length - 1;
window.Game.MAX_LEVEL = MAX_LEVEL;

const gs         = Game.gs;          // owned by world.js — shim by reference
let   currentMap  = Game.currentMap = MAPS.village; // world.js owns; kept in sync via double-assign

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

// ── Battle state  (implementation lives in battle.js)
// ─────────────────────────────────────────────────────

const player  = Game.player;   // owned by world.js — shim by reference
const cam     = Game.cam;      // owned by world.js — shim by reference
// ui state owned by game-ui.js — exposed as window.ui
const transition = { active: false, timerId: null };
window.Game.transition = transition;
Game.activeScene = null; // set by changeMap() on first call
let TS        = Game.TS = 48;
const HUD_H   = 40, HINT_H = 26;

// Logical (CSS-pixel) canvas dimensions — use these everywhere in game logic.
// canvas.width / canvas.height are the physical pixel dimensions (cW * dpr, cH * dpr).
let cW = Game.cW = 0, cH = Game.cH = 0;


function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;

    // Logical (CSS-pixel) size
    cW = Game.cW = window.innerWidth;
    cH = Game.cH = window.innerHeight - HUD_H - HINT_H;

    // Physical pixel size on the canvas element
    canvas.width  = Math.round(cW * dpr);
    canvas.height = Math.round(cH * dpr);

    // Keep the CSS display size at logical pixels so layout isn't disturbed
    canvas.style.width  = cW + 'px';
    canvas.style.height = cH + 'px';

    // Scale all subsequent draw calls so we always work in logical coords
    refreshCtx(canvas);

    // bgCanvas is sized to (cW + 4*TS) × (cH + 4*TS) by rebuildBgCanvas to hold
    // a 2-tile scroll buffer on every edge.  Mark dirty; rebuild handles the resize.
    markBgDirty();

    TS = Math.floor(Math.min(cW / 15, cH / 11));
    TS = Game.TS = Math.max(32, Math.min(TS, 64));
    invalidateLightCanvas();
    invalidateScanlinesCanvas();
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
//  INPUT  (implementation lives in input.js)
// ═══════════════════════════════════════════════════════

let moveAccum = 999;

function updateMovement(dt) {
    if (battleSystem.isActive() || transition.active || ui.inventory || ui.dialogue || ui.sign || ui.questLog || ui.loading || ui.paused || ui.codex) { input.clearFrame(); return; }
    const dirs = [
        { keys:['ArrowUp','w','W'],    dx:0,  dy:-1, f:'up'    },
        { keys:['ArrowDown','s','S'],  dx:0,  dy:1,  f:'down'  },
        { keys:['ArrowLeft','a','A'],  dx:-1, dy:0,  f:'left'  },
        { keys:['ArrowRight','d','D'], dx:1,  dy:0,  f:'right' },
    ];
    for (const d of dirs) {
        if (d.keys.some(k => input.wasJustPressed(k))) {
            input.clearFrame(); tryMove(d.dx, d.dy, d.f); moveAccum=0; return;
        }
    }
    input.clearFrame();
    moveAccum += dt;
    if (moveAccum < 130) return;
    for (const d of dirs) {
        if (d.keys.some(k => input.isHeld(k))) {
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
    particleSystem.spawn('dust', player.prevX/TS + 0.5, player.prevY/TS + 0.5);
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

function isTileOccupied(x, y, excludingEnemy) {
    if (currentMap.npcs.some(n => n.x === x && n.y === y)) return true;
    if (currentMap.enemies?.some(e => e !== excludingEnemy && e.alive && e.x === x && e.y === y)) return true;
    return false;
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

function resetTransitionInvariants() {
    invalidateTileCache();
    markBgDirty();
}

function changeMap(mapId, sx, sy) {
    Game.transition.active = true;

    const fromId    = Game.currentMap?.id ?? null;
    const fromScene = Game.activeScene;

    // EXIT — leave current scene
    fromScene?.onExit?.(mapId);

    // INVARIANT-RESET — clears state that must not persist across any transition
    resetTransitionInvariants();

    // TRANSITIONAL — swap core state
    currentMap = Game.currentMap = MAPS[mapId];
    buildVariantMap(currentMap);
    player.x   = sx !== undefined ? sx : currentMap.playerStart.x;
    player.y   = sy !== undefined ? sy : currentMap.playerStart.y;
    player.facing = 'down';
    player.renderX = player.x * TS; player.renderY = player.y * TS;
    player.prevX = player.renderX;  player.prevY = player.renderY;
    player.moveT = 1; player.isMoving = false;
    updateCamera();

    // ENTER — activate new scene
    const toScene = SCENES[mapId];
    Game.activeScene = toScene ?? null;
    document.getElementById('hud-location').textContent = currentMap.name;
    toScene?.onEnter?.(fromId);

    Game.transition.active = false;

    // Narrator: fire scene_enter after one render frame so the map is visible
    const _narMapName = currentMap.name;
    const _narMapType = currentMap.dark ? 'dungeon' : 'village';
    setTimeout(() => {
        if (typeof fireNarration === 'function') {
            fireNarration('scene_enter', {map_name: _narMapName, map_type: _narMapType, activeWorldEvents: gs.activeWorldEvents || []});
        }
    }, 200);
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

function updateEnemies(dt) {
    if (battleSystem.isActive() || transition.active || ui.dialogue || ui.sign || ui.paused || ui.loading) return;
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

        // Adjacent to player → encounter flavor + start battle
        if (dist <= 1) {
            const _encPool = ENCOUNTER_LINES[en.type];
            if (_encPool) window.queueNarration(_encPool[Math.floor(Math.random() * _encPool.length)]);
            battleSystem.start(en);
            return;
        }

        // Move one step toward player
        let mx = 0, my = 0;
        if (Math.abs(dx) >= Math.abs(dy)) mx = dx > 0 ? 1 : -1;
        else my = dy > 0 ? 1 : -1;
        const nx2 = en.x + mx, ny2 = en.y + my;
        if (nx2 >= 0 && nx2 < currentMap.w && ny2 >= 0 && ny2 < currentMap.h) {
            const tile = currentMap.tiles[ny2][nx2];
            if (WALKABLE.has(tile) && !isTileOccupied(nx2, ny2, en)) { en.x = nx2; en.y = ny2; }
        }
    }
}

function isAdjacent(nx,ny){return Math.abs(nx-player.x)+Math.abs(ny-player.y)===1;}

// ─── Ambient NPC speech bubbles ─────────────────────────────────────────────
const _AMB_IDLE_MS    = 7200;
const _AMB_FADEIN_MS  = 300;
const _AMB_HOLD_MS    = 4000;
const _AMB_FADEOUT_MS = 500;

function updateAmbient(dt) {
    if (battleSystem.isActive() || transition.active || ui.loading || ui.paused) return;
    if (!currentMap.npcs) return;
    for (const npc of currentMap.npcs) {
        if (npc.ghost) continue;
        const pool = AMBIENT_LINES[npc.id];
        if (!pool?.length) continue;
        if (!npc._amb) npc._amb = { idx: 0, timer: _AMB_IDLE_MS - 2000, phase: 'idle', alpha: 0, text: '' };
        const s = npc._amb;
        const inRange   = Math.abs(player.x - npc.x) + Math.abs(player.y - npc.y) <= 3;
        const suppressed = !inRange || ui.dialogue === npc;
        if (suppressed) {
            if (s.alpha > 0) { s.alpha = Math.max(0, s.alpha - dt / 150); if (s.alpha <= 0) s.phase = 'idle'; }
            continue;
        }
        s.timer += dt;
        if (s.phase === 'idle') {
            if (s.timer >= _AMB_IDLE_MS) { s.timer = 0; s.text = pool[s.idx % pool.length]; s.idx = (s.idx + 1) % pool.length; s.phase = 'fadein'; }
        } else if (s.phase === 'fadein') {
            s.alpha = Math.min(1, s.timer / _AMB_FADEIN_MS);
            if (s.timer >= _AMB_FADEIN_MS) { s.phase = 'hold'; s.timer = 0; }
        } else if (s.phase === 'hold') {
            if (s.timer >= _AMB_HOLD_MS) { s.phase = 'fadeout'; s.timer = 0; }
        } else if (s.phase === 'fadeout') {
            s.alpha = Math.max(0, 1 - s.timer / _AMB_FADEOUT_MS);
            if (s.timer >= _AMB_FADEOUT_MS) { s.alpha = 0; s.phase = 'idle'; s.timer = 0; }
        }
    }
}

// ─── Dungeon discovery narration ─────────────────────────────────────────────
function updateDiscovery() {
    if (!currentMap || currentMap.id !== 'dungeon_1') return;
    if (battleSystem.isActive() || transition.active || ui.loading || ui.paused) return;

    if (!_discoveredFlavor.has('low_hp') && gs.hp > 0 && gs.hp / gs.maxHp < 0.25) {
        _discoveredFlavor.add('low_hp');
        window.queueNarration(DISCOVERY_LINES.low_hp);
    }

    const _adjTiles = [{dx:0,dy:-1},{dx:0,dy:1},{dx:-1,dy:0},{dx:1,dy:0}];

    if (!_discoveredFlavor.has('cave_pool')) {
        for (const d of _adjTiles) {
            const tx = player.x + d.dx, ty = player.y + d.dy;
            if (ty >= 0 && ty < currentMap.h && tx >= 0 && tx < currentMap.w &&
                currentMap.tiles[ty][tx] === WA) {
                _discoveredFlavor.add('cave_pool');
                window.queueNarration(DISCOVERY_LINES.cave_pool);
                break;
            }
        }
    }

    if (!_discoveredFlavor.has('first_room')) {
        let openCount = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
            if (dx === 0 && dy === 0) continue;
            const tx = player.x + dx, ty = player.y + dy;
            if (ty >= 0 && ty < currentMap.h && tx >= 0 && tx < currentMap.w &&
                WALKABLE.has(currentMap.tiles[ty][tx])) openCount++;
        }
        if (openCount >= 14) {
            _discoveredFlavor.add('first_room');
            window.queueNarration(DISCOVERY_LINES.first_room);
        }
    }

    if (!_discoveredFlavor.has('first_rubble') && _discoveredFlavor.has('first_room')) {
        for (const d of _adjTiles) {
            const tx = player.x + d.dx, ty = player.y + d.dy;
            if (ty >= 0 && ty < currentMap.h && tx >= 0 && tx < currentMap.w &&
                currentMap.tiles[ty][tx] === W) {
                _discoveredFlavor.add('first_rubble');
                window.queueNarration(DISCOVERY_LINES.first_rubble);
                break;
            }
        }
    }
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

// ─ Items ───────────────────────────────────────────────
function itemVisible(item) {
    return !item.questRequired || !!gs.flags[item.questRequired];
}

function checkItemPickup() {
    const items=currentMap.items;
    const before=items.length;
    let pickupCount=0;
    for(let i=items.length-1;i>=0;i--){
        if(!itemVisible(items[i])) continue;
        if(items[i].x===player.x&&items[i].y===player.y){
            pickupCount++;
            const item=items.splice(i,1)[0];
            gs.inventory.push(item);
            showNotification(`Found: ${item.name}`,'item');
            if (item.questComplete && typeof fireNarration === 'function') {
                fireNarration('item_found', {item_name: item.name, item_type: item.id, location: currentMap.name});
            }
            if(item.questComplete&&!gs.flags[item.questComplete]){
                gs.flags[item.questComplete]=true;
                onQuestComplete(QUESTS.find(q=>q.flag_complete===item.questComplete));
            }
            updateInventoryUI();
        }
    }
    if(window.location.hostname==='localhost'){
        console.assert(items.length===before-pickupCount,
            `checkItemPickup: expected ${before-pickupCount} items remaining, got ${items.length}`);
    }
}

// ═══════════════════════════════════════════════════════
//  AMBIENT AUDIO  (implementation lives in audio.js)
// ═══════════════════════════════════════════════════════

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
//  INITIALIZATION
// ═══════════════════════════════════════════════════════
// ── Starter weapon placement ────────────────────────────
const STARTER_WEAPONS = {
    Warrior: { name:'Iron Sword',    icon:'⚔️',  color:'#b0b8e8', desc:'A well-worn iron sword. Still sharp.' },
    Rogue:   { name:'Shadow Dagger', icon:'🗡️',  color:'#80c0d8', desc:'Light, quick, and quiet.'             },
    Wizard:  { name:'Arcane Staff',  icon:'🪄',  color:'#c090e8', desc:'Hums faintly with old magic.'         },
    Cleric:  { name:'Holy Mace',     icon:'🔱',  color:'#e8c060', desc:'Blessed by the Old Gods.'             },
};

function findValidItemTile(map, cx, cy) {
    for (let r = 0; r <= WEAPON_SEARCH_RADIUS; r++) {
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                const tx = cx + dx, ty = cy + dy;
                if (tx < 0 || tx >= map.w || ty < 0 || ty >= map.h) continue;
                if (!WORLD_ITEM_PLACEABLE.has(map.tiles[ty]?.[tx])) continue;
                if (map.npcs.some(n => n.x === tx && n.y === ty)) continue;
                if (map.items.some(i => i.x === tx && i.y === ty)) continue;
                return { x: tx, y: ty };
            }
        }
    }
    return null;
}

function placeStarterWeapon(charClass) {
    const weapon = { ...STARTER_WEAPONS[charClass] || STARTER_WEAPONS.Warrior,
                     questRequired:'quest_weapon_given',
                     questComplete:'quest_weapon_complete' };
    const sx = currentMap.playerStart.x, sy = currentMap.playerStart.y;
    const pos = findValidItemTile(currentMap, sx, sy);
    if (pos) {
        currentMap.items.push({ ...weapon, x: pos.x, y: pos.y });
    } else {
        console.warn('[placeStarterWeapon] no valid tile within radius', WEAPON_SEARCH_RADIUS, '— weapon added to inventory');
        gs.inventory.push(weapon);
        gs.flags['quest_weapon_complete'] = true;
        updateQuestUI();
    }
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

function resetWorldState() {
    Object.values(MAPS).forEach(map => {
        if (map.id === 'dungeon_1') return;
        map.items = [];
        if (map.enemies) map.enemies = [];
    });
}

function startGame(name,charClass) {
    gs.charName=name;gs.charClass=charClass;gs.flags={};gs.inventory=[];
    gs.knownLore=[]; gs.unlockedAreas=['village','cursed_mines']; gs.reputation={guide:0,elder:0,blacksmith:0,traveler:0};
    gs.activeWorldEvents = [];
    Object.keys(AMBIENT_LINES_DEFAULT).forEach(k => { AMBIENT_LINES[k] = [...AMBIENT_LINES_DEFAULT[k]]; });
    const _MOODS = ['neutral','tired','worried','distracted','hopeful'];
    const _rnd   = () => _MOODS[Math.floor(Math.random() * _MOODS.length)];
    gs.npcMoods  = { guide: _rnd(), elder: _rnd(), blacksmith: _rnd(), traveler: _rnd() };
    gs.sessionId = crypto.randomUUID();
    invalidateCharCache(); // charClass → color changed; purge stale entries from any prior session
    const classMaxHp={Warrior:60,Rogue:45,Wizard:35,Cleric:55};
    gs.maxHp=classMaxHp[charClass]||50; gs.hp=gs.maxHp;
    gs.xp=0; gs.level=1;
    currentMap = Game.currentMap = MAPS.village;
    resetWorldState();
    rebuildDungeon(); // fresh procedurally generated mine every new game
    placeStarterWeapon(charClass);
    player.x=currentMap.playerStart.x; player.y=currentMap.playerStart.y; player.facing='down';
    player.renderX=player.x*TS; player.renderY=player.y*TS;
    player.prevX=player.renderX; player.prevY=player.renderY;
    player.moveT=1; player.isMoving=false; player.walkPhase=0;
    resetUIState();
    resizeCanvas();
    document.getElementById('start-screen').classList.add('hidden');
    document.getElementById('game-screen').classList.remove('hidden');
    document.getElementById('hud-name').textContent=name;
    document.getElementById('hud-class').textContent=charClass;
    document.getElementById('hud-location').textContent=currentMap.name;
    updateQuestUI();updateInventoryUI();updateHPUI();
    for (const [id, map] of Object.entries(MAPS)) {
        if (id === 'dungeon_1') continue;
        console.assert(map.items.length === 0 || id === 'village',
            `[startGame] ${id}.items not empty after reset — check resetWorldState()`);
    }
    [...GUIDE_NPCS,...ELDER_NPCS,...BLACKSMITH_NPCS,...VEYLA_NPCS,...DUNGEON_NPCS].forEach(n => { delete n._amb; });
    audio.startMusic();
    startLoop();
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
    stopLoop();
    audio.stopMusic();closeDialogue();closeSign();closeQuestLog();
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
    const on=audio.toggle();
    const btn=document.getElementById('music-toggle');
    on?btn.classList.add('active'):btn.classList.remove('active');
});

document.getElementById('quest-btn').addEventListener('click',toggleQuestLog);
document.getElementById('close-quest-log').addEventListener('click',closeQuestLog);
