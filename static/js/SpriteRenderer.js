'use strict';
if (!window.Game || !window.Game.TILE)
    throw new Error('SpriteRenderer.js loaded before Game namespace initialized');

const WATER_FRAME_MS = 250; // ms per water animation frame

// ═══════════════════════════════════════════════════════════════════
//  SpriteRenderer.js  —  The Forgotten Realm
//
//  Routes all tile draw calls through TileRenderer (offscreen-cached
//  procedural tiles from tile-renderer.js).
//
//  isReady() returns true immediately — all tiles are procedural,
//  no image assets are required.
//
//  Uses Game.* namespace: Game.ctx, Game.TS, Game.currentMap,
//                         Game.TILE, Game.PALETTE, Game.timeMs,
//                         Game.player
//  Render API: Render.dither2, Render.drawWallPlaque, Render.drawSignPost
//  Global instance: tileRenderer (tile-renderer.js)
// ═══════════════════════════════════════════════════════════════════

class SpriteRenderer {
    constructor() {
        this._ready = true;
    }

    isReady() { return this._ready; }
    loadAll()  {}

    advanceAnimations(_dt) {}   // water/torch frames derived from Game.timeMs directly

    // Pre-warm all tileRenderer rows at the given tile size.
    // Call after every resize and at startup.
    warmCache(ts) {
        const rows = [
            'GRASS', 'PATH', 'STONE_PATH', 'WATER',
            'WALL_EXT', 'WALL_INT', 'WALL_DUN', 'CEILING',
            'FLOOR_LIGHT', 'FLOOR_DARK',
            'TREE', 'DOOR', 'STAIRS', 'TORCH',
        ];
        for (const row of rows) tileRenderer.warmRow(row, ts);
    }

    // Discard all cached tile canvases (call after resize or map change).
    invalidate() { tileRenderer.invalidate(); }

    // Return the cached offscreen canvas for a given (row, variant, ts) triple,
    // or null if it hasn't been built yet. Used by VQ._buildSway() so sway frames
    // share the same base image as bgCanvas — prevents the visual mismatch that
    // caused grass flickering in the player's sway radius.
    _getCachedVariant(row, variant, ts) {
        return tileRenderer.getCachedVariant(row, variant, ts);
    }

    // Entry point called from game.js::drawTile() when isReady() is true.
    // ipx/ipy are already Math.floor()'d by drawTile() before this call.
    drawTile(tileId, ipx, ipy, tx, ty) {
        this._drawProcedural(tileId, ipx, ipy, tx, ty);
    }

    // ── private ──────────────────────────────────────────────────────
    // Dispatches each tile type to tileRenderer.draw() with the correct
    // row key and variant.  Uses Game.* namespace throughout.
    _drawProcedural(tileId, ipx, ipy, tx, ty) {
        const P         = Game.PALETTE;
        const dark      = Game.currentMap.dark;
        const isInterior = !dark && !!Game.currentMap.returnMap;
        // raw encodes both the grass variant (low 3 bits) and tree canopy
        // variant (bits 4-5) when a variantMap exists; otherwise derive
        // deterministically from tile coordinates (same formula as game.js).
        const raw = Game.currentMap.variantMap
            ? Game.currentMap.variantMap[ty * Game.currentMap.w + tx]
            : (tx * 7 + ty * 13);

        switch (tileId) {

            case Game.TILE.GRASS: {
                tileRenderer.draw(Game.ctx, 'GRASS', raw & 7, ipx, ipy, Game.TS);
                // Autotile edge blending: dithered strip at grass→path/water borders.
                // Preserved verbatim from game.js's switch(TILE.GRASS) block.
                const sw = Math.max(4, Math.floor(Game.TS / 8));
                const _isPath = t => t === Game.TILE.DIRT_PATH || t === Game.TILE.STONE_PATH;
                const blendN = [[tx, ty-1, 0], [tx, ty+1, 1], [tx-1, ty, 2], [tx+1, ty, 3]];
                for (const [ntx, nty, dir] of blendN) {
                    const nt = Game.currentMap.tiles[nty]?.[ntx];
                    if (!_isPath(nt) && nt !== Game.TILE.WATER) continue;
                    const bCol = nt === Game.TILE.WATER ? P.M_SLATE : P.M_CLAY;
                    if (dir === 0) Render.dither2(Game.ctx, ipx,        ipy,        Game.TS, sw, P.M_FOREST, bCol, 0);
                    if (dir === 1) Render.dither2(Game.ctx, ipx,        ipy+Game.TS-sw,  Game.TS, sw, P.M_FOREST, bCol, 1);
                    if (dir === 2) Render.dither2(Game.ctx, ipx,        ipy,        sw, Game.TS, P.M_FOREST, bCol, 0);
                    if (dir === 3) Render.dither2(Game.ctx, ipx+Game.TS-sw,  ipy,        sw, Game.TS, P.M_FOREST, bCol, 1);
                }
                // Diagonal corner fills at convex path corners
                for (let ci = 0; ci < 4; ci++) {
                    const dnx = ci < 2 ? tx+1 : tx-1;
                    const dny = (ci===0||ci===2) ? ty-1 : ty+1;
                    const dt  = Game.currentMap.tiles[dny]?.[dnx];
                    if (!_isPath(dt) && dt !== Game.TILE.WATER) continue;
                    const a1t = Game.currentMap.tiles[dny]?.[tx];
                    const a2t = Game.currentMap.tiles[ty ]?.[dnx];
                    if ((_isPath(a1t)||a1t===Game.TILE.WATER)||(_isPath(a2t)||a2t===Game.TILE.WATER)) continue;
                    const bCol = dt === Game.TILE.WATER ? P.M_SLATE : P.M_CLAY;
                    Render.dither2(Game.ctx, ipx+(dnx>tx?Game.TS-sw:0), ipy+(dny>ty?Game.TS-sw:0), sw, sw, P.M_FOREST, bCol, 0);
                }
                break;
            }

            case Game.TILE.DIRT_PATH: {
                tileRenderer.draw(Game.ctx, 'PATH', raw & 3, ipx, ipy, Game.TS);
                break;
            }

            case Game.TILE.STONE_PATH: {
                tileRenderer.draw(Game.ctx, 'STONE_PATH', raw & 3, ipx, ipy, Game.TS);
                break;
            }

            case Game.TILE.BUILDING_FLOOR: {
                tileRenderer.draw(Game.ctx, dark ? 'FLOOR_DARK' : 'FLOOR_LIGHT', raw & 3, ipx, ipy, Game.TS);
                break;
            }

            case Game.TILE.BUILDING_WALL: {
                const wv = raw & 3;
                if (!dark && isInterior && ty === 0) {
                    tileRenderer.draw(Game.ctx, 'CEILING', 0, ipx, ipy, Game.TS);
                    break;
                }
                const rowKey = dark ? 'WALL_DUN' : isInterior ? 'WALL_INT' : 'WALL_EXT';
                tileRenderer.draw(Game.ctx, rowKey, wv, ipx, ipy, Game.TS);
                break;
            }

            case Game.TILE.TREE: {
                // Grass base first, then canopy overlay on top (same composite as game.js)
                tileRenderer.draw(Game.ctx, 'GRASS', raw & 7, ipx, ipy, Game.TS);
                tileRenderer.draw(Game.ctx, 'TREE',  (raw >> 4) & 1, ipx, ipy, Game.TS);
                break;
            }

            case Game.TILE.WATER: {
                // _drawRefWater has 4 frames (0-3); advance at 250 ms per frame.
                tileRenderer.draw(Game.ctx, 'WATER', Math.floor(Game.timeMs / WATER_FRAME_MS) & 3, ipx, ipy, Game.TS);
                break;
            }

            case Game.TILE.DOOR: {
                // frame 0=closed, 1=open (player standing on the tile)
                const isOpen = (Game.player.x === tx) && (Game.player.y === ty);
                tileRenderer.draw(Game.ctx, 'DOOR', isOpen ? 1 : 0, ipx, ipy, Game.TS);
                break;
            }

            case Game.TILE.STAIRS: {
                tileRenderer.draw(Game.ctx, 'STAIRS', 0, ipx, ipy, Game.TS);
                break;
            }

            case Game.TILE.STAIRSUP: {
                if (Game.currentMap?.returnMap) {
                    // Interior exit: floor tile + EXIT doormat overlay
                    tileRenderer.draw(Game.ctx, 'FLOOR_LIGHT', raw & 3, ipx, ipy, Game.TS);
                    Game.ctx.fillStyle = P.S_DARK;
                    Game.ctx.fillRect(Math.floor(ipx+Game.TS*.10), Math.floor(ipy+Game.TS*.25), Math.floor(Game.TS*.80), Math.floor(Game.TS*.50));
                    Game.ctx.fillStyle = P.S_MID;
                    for (let i = 0; i < 4; i++)
                        Game.ctx.fillRect(Math.floor(ipx+Game.TS*.15+i*Game.TS*.18), Math.floor(ipy+Game.TS*.30),
                                     Math.max(1, Math.floor(Game.TS*.04)), Math.floor(Game.TS*.40));
                    Game.ctx.fillStyle = P.L_GOLD;
                    Game.ctx.textAlign = 'center'; Game.ctx.textBaseline = 'middle';
                    Game.ctx.font = `bold ${Math.floor(Game.TS*.22)}px sans-serif`;
                    Game.ctx.fillText('EXIT', Math.floor(ipx+Game.TS/2), Math.floor(ipy+Game.TS*.52));
                } else {
                    tileRenderer.draw(Game.ctx, 'STAIRS', 1, ipx, ipy, Game.TS);
                }
                break;
            }

            case Game.TILE.TORCH: {
                // Wall background via tileRenderer, then cached flame frame.
                // Per-tile summed-sine phase preserved so each torch flickers independently.
                const wv = raw & 3;
                const wallRow = dark ? 'WALL_DUN' : isInterior ? 'WALL_INT' : 'WALL_EXT';
                tileRenderer.draw(Game.ctx, wallRow, wv, ipx, ipy, Game.TS);
                const phase = (((tx||0) * 7 + (ty||0) * 13) & 63) * 0.097;
                const noise = Math.sin(Game.timeMs * 0.008 + phase)
                            + Math.sin(Game.timeMs * 0.021 + phase * 1.63) * 0.5
                            + Math.sin(Game.timeMs * 0.053 + phase * 0.79) * 0.3;
                const torchFrame = noise > 0.4 ? 0 : noise > -0.3 ? 1 : 2;
                tileRenderer.draw(Game.ctx, 'TORCH', torchFrame, ipx, ipy, Game.TS);
                break;
            }

            case Game.TILE.SIGN: {
                const snb = [
                    Game.currentMap.tiles[ty]?.[tx-1], Game.currentMap.tiles[ty]?.[tx+1],
                    Game.currentMap.tiles[ty-1]?.[tx],  Game.currentMap.tiles[ty+1]?.[tx],
                ];
                const onWall = snb.some(t => t === Game.TILE.BUILDING_WALL);
                const _isPath = t => t === Game.TILE.DIRT_PATH || t === Game.TILE.STONE_PATH;
                if (dark || onWall) {
                    const wallRow = dark ? 'WALL_DUN' : isInterior ? 'WALL_INT' : 'WALL_EXT';
                    tileRenderer.draw(Game.ctx, dark ? 'FLOOR_DARK' : wallRow, raw & 3, ipx, ipy, Game.TS);
                } else if (snb.some(t => t === Game.TILE.BUILDING_FLOOR)) {
                    tileRenderer.draw(Game.ctx, 'FLOOR_LIGHT', raw & 3, ipx, ipy, Game.TS);
                } else if (snb.some(t => _isPath(t))) {
                    tileRenderer.draw(Game.ctx, 'PATH', raw & 3, ipx, ipy, Game.TS);
                } else {
                    tileRenderer.draw(Game.ctx, 'GRASS', raw & 7, ipx, ipy, Game.TS);
                }
                if (onWall) Render.drawWallPlaque(ipx, ipy);
                else        Render.drawSignPost(ipx, ipy);
                break;
            }

            case Game.TILE.VOID:
            default: {
                Game.ctx.fillStyle = P.D_VOID;
                Game.ctx.fillRect(ipx, ipy, Game.TS, Game.TS);
                break;
            }
        }
    }
}

const spriteRenderer = new SpriteRenderer();
