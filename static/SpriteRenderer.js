'use strict';
// ═══════════════════════════════════════════════════════════════════
//  SpriteRenderer.js  —  The Forgotten Realm
//
//  Routes all tile draw calls through TileRenderer (offscreen-cached
//  procedural tiles from tile-renderer.js).
//
//  isReady() returns true immediately — all tiles are procedural,
//  no image assets are required.
//
//  Uses game.js globals: ctx, TS, currentMap, TILE, PALETTE,
//                        timeMs, player, dither2,
//                        drawWallPlaque, drawSignPost
// ═══════════════════════════════════════════════════════════════════

class SpriteRenderer {
    constructor() {
        this._ready = true;
    }

    isReady() { return this._ready; }
    loadAll()  {}

    advanceAnimations(_dt) {}   // water/torch frames derived from timeMs directly

    // Pre-warm all tileRenderer rows at the given tile size.
    // Call after every resize and at startup.
    warmCache(ts) {
        const rows = [
            'GRASS', 'PATH', 'WATER',
            'WALL_EXT', 'WALL_INT', 'WALL_DUN', 'CEILING',
            'FLOOR_LIGHT', 'FLOOR_DARK',
            'TREE', 'DOOR', 'STAIRS', 'TORCH',
        ];
        for (const row of rows) tileRenderer.warmRow(row, ts);
    }

    // Discard all cached tile canvases (call after resize or map change).
    invalidate() { tileRenderer.invalidate(); }

    // Entry point called from game.js::drawTile() when isReady() is true.
    // ipx/ipy are already Math.floor()'d by drawTile() before this call.
    drawTile(tileId, ipx, ipy, tx, ty) {
        this._drawProcedural(tileId, ipx, ipy, tx, ty);
    }

    // ── private ──────────────────────────────────────────────────────
    // Dispatches each tile type to tileRenderer.draw() with the correct
    // row key and variant.  Uses game.js globals throughout.
    _drawProcedural(tileId, ipx, ipy, tx, ty) {
        const P         = PALETTE;
        const dark      = currentMap.dark;
        const isInterior = !dark && !!currentMap.returnMap;
        // raw encodes both the grass variant (low 3 bits) and tree canopy
        // variant (bits 4-5) when a variantMap exists; otherwise derive
        // deterministically from tile coordinates (same formula as game.js).
        const raw = currentMap.variantMap
            ? currentMap.variantMap[ty * currentMap.w + tx]
            : (tx * 7 + ty * 13);

        switch (tileId) {

            case TILE.GRASS: {
                tileRenderer.draw(ctx, 'GRASS', raw & 7, ipx, ipy, TS);
                // Autotile edge blending: dithered strip at grass→path/water borders.
                // Preserved verbatim from game.js's switch(TILE.GRASS) block.
                const sw = Math.max(4, Math.floor(TS / 8));
                const _isPath = t => t === TILE.DIRT_PATH || t === TILE.STONE_PATH;
                const blendN = [[tx, ty-1, 0], [tx, ty+1, 1], [tx-1, ty, 2], [tx+1, ty, 3]];
                for (const [ntx, nty, dir] of blendN) {
                    const nt = currentMap.tiles[nty]?.[ntx];
                    if (!_isPath(nt) && nt !== TILE.WATER) continue;
                    const bCol = nt === TILE.WATER ? P.M_SLATE : P.M_CLAY;
                    if (dir === 0) dither2(ctx, ipx,        ipy,        TS, sw, P.M_FOREST, bCol, 0);
                    if (dir === 1) dither2(ctx, ipx,        ipy+TS-sw,  TS, sw, P.M_FOREST, bCol, 1);
                    if (dir === 2) dither2(ctx, ipx,        ipy,        sw, TS, P.M_FOREST, bCol, 0);
                    if (dir === 3) dither2(ctx, ipx+TS-sw,  ipy,        sw, TS, P.M_FOREST, bCol, 1);
                }
                // Diagonal corner fills at convex path corners
                for (let ci = 0; ci < 4; ci++) {
                    const dnx = ci < 2 ? tx+1 : tx-1;
                    const dny = (ci===0||ci===2) ? ty-1 : ty+1;
                    const dt  = currentMap.tiles[dny]?.[dnx];
                    if (!_isPath(dt) && dt !== TILE.WATER) continue;
                    const a1t = currentMap.tiles[dny]?.[tx];
                    const a2t = currentMap.tiles[ty ]?.[dnx];
                    if ((_isPath(a1t)||a1t===TILE.WATER)||(_isPath(a2t)||a2t===TILE.WATER)) continue;
                    const bCol = dt === TILE.WATER ? P.M_SLATE : P.M_CLAY;
                    dither2(ctx, ipx+(dnx>tx?TS-sw:0), ipy+(dny>ty?TS-sw:0), sw, sw, P.M_FOREST, bCol, 0);
                }
                break;
            }

            case TILE.DIRT_PATH:
            case TILE.STONE_PATH: {
                tileRenderer.draw(ctx, 'PATH', raw & 3, ipx, ipy, TS);
                break;
            }

            case TILE.BUILDING_FLOOR: {
                tileRenderer.draw(ctx, dark ? 'FLOOR_DARK' : 'FLOOR_LIGHT', raw & 3, ipx, ipy, TS);
                break;
            }

            case TILE.BUILDING_WALL: {
                const wv = raw & 3;
                if (!dark && isInterior && ty === 0) {
                    tileRenderer.draw(ctx, 'CEILING', 0, ipx, ipy, TS);
                    break;
                }
                const rowKey = dark ? 'WALL_DUN' : isInterior ? 'WALL_INT' : 'WALL_EXT';
                tileRenderer.draw(ctx, rowKey, wv, ipx, ipy, TS);
                break;
            }

            case TILE.TREE: {
                // Grass base first, then canopy overlay on top (same composite as game.js)
                tileRenderer.draw(ctx, 'GRASS', raw & 7, ipx, ipy, TS);
                tileRenderer.draw(ctx, 'TREE',  (raw >> 4) & 1, ipx, ipy, TS);
                break;
            }

            case TILE.WATER: {
                // _drawRefWater has 4 frames (0-3); advance at 250 ms per frame.
                tileRenderer.draw(ctx, 'WATER', Math.floor(timeMs / 250) & 3, ipx, ipy, TS);
                break;
            }

            case TILE.DOOR: {
                // frame 0=closed, 1=open (player standing on the tile)
                const isOpen = (player.x === tx) && (player.y === ty);
                tileRenderer.draw(ctx, 'DOOR', isOpen ? 1 : 0, ipx, ipy, TS);
                break;
            }

            case TILE.STAIRS: {
                tileRenderer.draw(ctx, 'STAIRS', 0, ipx, ipy, TS);
                break;
            }

            case TILE.STAIRSUP: {
                if (currentMap?.returnMap) {
                    // Interior exit: floor tile + EXIT doormat overlay
                    tileRenderer.draw(ctx, 'FLOOR_LIGHT', raw & 3, ipx, ipy, TS);
                    ctx.fillStyle = P.S_DARK;
                    ctx.fillRect(Math.floor(ipx+TS*.10), Math.floor(ipy+TS*.25), Math.floor(TS*.80), Math.floor(TS*.50));
                    ctx.fillStyle = P.S_MID;
                    for (let i = 0; i < 4; i++)
                        ctx.fillRect(Math.floor(ipx+TS*.15+i*TS*.18), Math.floor(ipy+TS*.30),
                                     Math.max(1, Math.floor(TS*.04)), Math.floor(TS*.40));
                    ctx.fillStyle = P.L_GOLD;
                    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                    ctx.font = `bold ${Math.floor(TS*.22)}px sans-serif`;
                    ctx.fillText('EXIT', Math.floor(ipx+TS/2), Math.floor(ipy+TS*.52));
                } else {
                    tileRenderer.draw(ctx, 'STAIRS', 1, ipx, ipy, TS);
                }
                break;
            }

            case TILE.TORCH: {
                // Wall background via tileRenderer, then cached flame frame.
                // Per-tile summed-sine phase preserved so each torch flickers independently.
                const wv = raw & 3;
                const wallRow = dark ? 'WALL_DUN' : isInterior ? 'WALL_INT' : 'WALL_EXT';
                tileRenderer.draw(ctx, wallRow, wv, ipx, ipy, TS);
                const phase = (((tx||0) * 7 + (ty||0) * 13) & 63) * 0.097;
                const noise = Math.sin(timeMs * 0.008 + phase)
                            + Math.sin(timeMs * 0.021 + phase * 1.63) * 0.5
                            + Math.sin(timeMs * 0.053 + phase * 0.79) * 0.3;
                tileRenderer.draw(ctx, 'TORCH', noise > 0.1 ? 0 : 1, ipx, ipy, TS);
                break;
            }

            case TILE.SIGN: {
                const snb = [
                    currentMap.tiles[ty]?.[tx-1], currentMap.tiles[ty]?.[tx+1],
                    currentMap.tiles[ty-1]?.[tx],  currentMap.tiles[ty+1]?.[tx],
                ];
                const onWall = snb.some(t => t === TILE.BUILDING_WALL);
                const _isPath = t => t === TILE.DIRT_PATH || t === TILE.STONE_PATH;
                if (dark || onWall) {
                    const wallRow = dark ? 'WALL_DUN' : isInterior ? 'WALL_INT' : 'WALL_EXT';
                    tileRenderer.draw(ctx, dark ? 'FLOOR_DARK' : wallRow, raw & 3, ipx, ipy, TS);
                } else if (snb.some(t => t === TILE.BUILDING_FLOOR)) {
                    tileRenderer.draw(ctx, 'FLOOR_LIGHT', raw & 3, ipx, ipy, TS);
                } else if (snb.some(t => _isPath(t))) {
                    tileRenderer.draw(ctx, 'PATH', raw & 3, ipx, ipy, TS);
                } else {
                    tileRenderer.draw(ctx, 'GRASS', raw & 7, ipx, ipy, TS);
                }
                if (onWall) drawWallPlaque(ipx, ipy);
                else        drawSignPost(ipx, ipy);
                break;
            }

            case TILE.VOID:
            default: {
                ctx.fillStyle = P.D_VOID;
                ctx.fillRect(ipx, ipy, TS, TS);
                break;
            }
        }
    }
}

const spriteRenderer = new SpriteRenderer();
