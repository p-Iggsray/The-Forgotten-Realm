'use strict';
// ═══════════════════════════════════════════════════════════════════
//  SpriteRenderer.js  —  The Forgotten Realm
//
//  Loads every sprite sheet defined in TILE_MANIFEST, pre-cuts each
//  tile to a ts×ts offscreen canvas, and replaces procedural drawing.
//
//  PUBLIC API
//  ──────────
//  spriteRenderer.isReady()
//    → true once all required core tile sheets have loaded
//      (or failed).  Procedural fallback is used until then.
//
//  spriteRenderer.drawTile(ctx, tileId, x, y, tx, ty, mapCtx)
//    → main draw entry point called from drawTile() in game.js
//    mapCtx = { dark: bool, isInterior: bool, isCeiling: bool }
//
//  spriteRenderer.advanceAnimations(dt)
//    → must be called once per frame with delta-ms.
//      Call it at the top of the game loop's render step.
//
//  spriteRenderer.warmCache(ts)
//    → pre-cuts every static tile variant at size ts.
//      Called automatically when sheets load; also call manually
//      after a resize that changes TS.
//
//  spriteRenderer.invalidate()
//    → clears the tile canvas cache.  Call on resize / TS change.
//
//  DEPENDENCIES (must be defined before this file parses / runs)
//    TILE_MANIFEST  — TILE_MANIFEST.js
//    SHEET_PATHS    — TILE_MANIFEST.js
//    TILE           — game.js (TILE.GRASS, TILE.PATH, etc.)
//    TS             — game.js (current tile size in px)
//    bgDirty        — game.js (set true to force bg-canvas rebuild)
//    _tc, ensureTileCache — game.js (procedural fallback)
//    drawWater, drawDoor, drawStairs, drawTorch, drawSign — game.js
//
//  DEBUG
//  ─────
//  Press F3 to toggle the Sprite Picker overlay.
//  Click any cell on a loaded sheet → its coords print to the console.
//  Call TILE_MANIFEST.listUnverified() for the full coordinate checklist.
// ═══════════════════════════════════════════════════════════════════

// Set true during development to highlight tiles that fell through to procedural.
// Red border + tile-ID number will appear over every unmapped/transparent tile.
const DEBUG_TILES = false;

class SpriteRenderer {

    constructor() {
        // key → { img: HTMLImageElement, loaded: bool, failed: bool }
        this._images      = new Map();

        // 'TILEKEY:variantOrFrame:ts' → HTMLCanvasElement
        this._tileCache   = new Map();

        // Sheet keys whose load state (loaded | failed) must ALL resolve
        // before isReady() flips true.
        this._requiredKeys = new Set();

        // ── atlas state ───────────────────────────────────────────
        // id → atlas entry { file, sx, sy, sw, sh, frames, ... }
        this._atlasById   = new Map();
        this._atlasLoaded = false;

        // ── animation state ──────────────────────────────────────
        this._waterFrame  = 0;
        this._waterAccum  = 0;          // ms accumulator
        this._torchFrame  = 0;
        this._torchAccum  = 0;
        this._torchNext   = this._nextTorchMs();

        // ── load state ───────────────────────────────────────────
        this._ready       = false;
        this._loadStarted = false;
        this._ts          = 0;          // TS value at last warmCache

        // ── F3 sprite picker ─────────────────────────────────────
        this._pickerOpen  = false;
        this._initPicker();
    }

    // ═══════════════════════════════════════════════════════════════
    //  PUBLIC — LIFECYCLE
    // ═══════════════════════════════════════════════════════════════

    /**
     * Start loading the sprite atlas JSON, then all tile image sheets.
     * Character sheets (SHEET_PATHS) load in parallel but don't block isReady().
     * Safe to call multiple times — subsequent calls are no-ops.
     */
    loadAll() {
        if (this._loadStarted) return;
        this._loadStarted = true;

        // Character/NPC/enemy sheets — load in background, don't block isReady().
        for (const [key, path] of Object.entries(SHEET_PATHS)) {
            if (!path) continue;
            if (!this._images.has(key)) this._startLoad(key, path);
        }

        // Fetch sprite_atlas.json — required before isReady() can flip true.
        fetch('/sprite_atlas.json')
            .then(r => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.json();
            })
            .then(json => {
                // Index every entry by id across all categories.
                for (const entries of Object.values(json)) {
                    if (!Array.isArray(entries)) continue;
                    for (const e of entries) this._atlasById.set(e.id, e);
                }
                this._atlasLoaded = true;
                this._loadAtlasSheets();  // load image files referenced by TILE_MANIFEST
                this._checkReady();       // in case no atlas files are required
            })
            .catch(err => {
                console.error('[SpriteRenderer] Failed to load sprite_atlas.json:', err);
                this._atlasLoaded = true;  // don't stall isReady() forever
                this._checkReady();
            });
    }

    /**
     * Looks up an atlas entry by id.
     * Throws a descriptive error if the id is not found — never falls back silently.
     * @param {string} id
     * @returns {{ file, sx, sy, sw, sh, frames, animated, category }}
     */
    getSprite(id) {
        if (!this._atlasLoaded) {
            throw new Error(`[SpriteRenderer] Atlas not loaded yet; cannot getSprite("${id}")`);
        }
        const entry = this._atlasById.get(id);
        if (!entry) {
            throw new Error(`[SpriteRenderer] Missing atlas entry: "${id}"`);
        }
        return entry;
    }

    /** True once all required core tile sheets are settled (loaded or failed). */
    isReady() { return this._ready; }

    /**
     * Pre-cut every static tile variant at size `ts`.
     * Called automatically on load; also call after resize changes TS.
     */
    warmCache(ts) {
        this._ts = ts;
        this._tileCache.clear();

        // static tiles with variant counts
        const STATIC = [
            ['GRASS',       8],
            ['PATH',        4],
            ['FLOOR_LIGHT', 4],
            ['FLOOR_DARK',  4],
            ['WALL_EXT',    4],
            ['WALL_INT',    4],
            ['WALL_DUN',    4],
            ['CEILING',     4],
            ['TREE',        2],
            ['SIGN',        3],
            ['STAIRS',      1],
            ['STAIRSUP',    1],
        ];
        for (const [name, count] of STATIC) {
            for (let v = 0; v < count; v++) {
                try { this._getCachedVariant(name, v, ts); }
                catch (e) { console.error(e.message); }
            }
        }

        // animated tiles — frameCount covers both old (.frames.length) and new (.frameCount)
        for (const name of ['WATER', 'DOOR', 'TORCH']) {
            const def = TILE_MANIFEST[name];
            if (!def) continue;
            const frameCount = def.frameCount ?? def.frames?.length ?? 0;
            for (let f = 0; f < frameCount; f++) {
                try { this._getCachedFrame(name, f, ts); }
                catch (e) { console.error(e.message); }
            }
        }
    }

    /** Discard cached tile canvases. Call on resize or TS change. */
    invalidate() {
        this._tileCache.clear();
        this._ts = 0;
    }

    // ═══════════════════════════════════════════════════════════════
    //  PUBLIC — PER-FRAME ANIMATION ADVANCE
    //  Call once at the start of each render pass (before drawTile).
    // ═══════════════════════════════════════════════════════════════

    /**
     * @param {number} dt  Frame delta in milliseconds.
     */
    advanceAnimations(dt) {
        // Water — fixed 4 fps (250 ms / frame); 8fps was too visually noisy
        this._waterAccum += dt;
        const waterInterval = 250;
        while (this._waterAccum >= waterInterval) {
            this._waterAccum -= waterInterval;
            const wdef = TILE_MANIFEST.WATER;
            const frameCount = wdef?.frameCount ?? wdef?.frames?.length ?? 4;
            this._waterFrame = (this._waterFrame + 1) % frameCount;
        }

        // Torch — irregular 4–6 fps per-torch phase
        this._torchAccum += dt;
        if (this._torchAccum >= this._torchNext) {
            this._torchAccum -= this._torchNext;
            this._torchFrame = 1 - this._torchFrame;
            this._torchNext  = this._nextTorchMs();
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  PUBLIC — MAIN DRAW
    //  Called from drawTile() in game.js when isReady() is true.
    //
    //  @param ctx      CanvasRenderingContext2D (may be bgCtx or main ctx)
    //  @param tileId   One of TILE.GRASS … TILE.TORCH  (number)
    //  @param x        Screen x in pixels (already offset by cam)
    //  @param y        Screen y in pixels
    //  @param tx       Tile column in map grid
    //  @param ty       Tile row in map grid
    //  @param mapCtx   { dark: bool, isInterior: bool, isCeiling: bool }
    // ═══════════════════════════════════════════════════════════════

    drawTile(ctx, tileId, x, y, tx, ty, mapCtx) {
        const ts  = TS;                      // game.js global
        const ipx = Math.round(x);
        const ipy = Math.round(y);
        const S1  = ts + 1;                  // +1 closes sub-pixel seams

        switch (tileId) {

            // ── GRASS ─────────────────────────────────────────────
            case TILE.GRASS: {
                const v  = currentMap.variantMap
                    ? currentMap.variantMap[ty * currentMap.w + tx] & 7
                    : (tx * 7 + ty * 13) & 7;
                const cv = this._getCachedVariant('GRASS', v, ts);
                if (cv) { ctx.drawImage(cv, ipx, ipy, S1, S1); return; }
                break;
            }

            // ── PATH ──────────────────────────────────────────────
            case TILE.PATH: {
                const v  = currentMap.variantMap
                    ? currentMap.variantMap[ty * currentMap.w + tx] & 3
                    : (tx * 11 + ty * 7) & 3;
                const cv = this._getCachedVariant('PATH', v, ts);
                if (cv) { ctx.drawImage(cv, ipx, ipy, S1, S1); return; }
                break;
            }

            // ── FLOOR ─────────────────────────────────────────────
            case TILE.FLOOR: {
                const v   = currentMap.variantMap
                    ? currentMap.variantMap[ty * currentMap.w + tx] & 3
                    : (tx * 5 + ty * 17) & 3;
                const key = mapCtx.dark ? 'FLOOR_DARK' : 'FLOOR_LIGHT';
                const cv  = this._getCachedVariant(key, v, ts);
                if (cv) { ctx.drawImage(cv, ipx, ipy, S1, S1); return; }
                break;
            }

            // ── WALL (context-dependent subtype) ──────────────────
            case TILE.WALL: {
                const v   = currentMap.variantMap
                    ? currentMap.variantMap[ty * currentMap.w + tx] & 3
                    : (tx * 3 + ty * 11) & 3;
                const key = mapCtx.isCeiling  ? 'CEILING'
                          : mapCtx.dark       ? 'WALL_DUN'
                          : mapCtx.isInterior ? 'WALL_INT'
                          :                     'WALL_EXT';
                const cv  = this._getCachedVariant(key, v, ts);
                if (cv) { ctx.drawImage(cv, ipx, ipy, S1, S1); return; }
                break;
            }

            // ── TREE (composite: grass base + overlay) ────────────
            case TILE.TREE: {
                const _p  = currentMap.variantMap
                    ? currentMap.variantMap[ty * currentMap.w + tx]
                    : ((tx * 7 + ty * 13) & 7) | (((tx * 5 + ty * 9) & 3) << 4);
                const gv  = _p & 7;
                const tv  = (_p >> 4) & 1;
                const gcv = this._getCachedVariant('GRASS', gv, ts);
                const tcv = this._getCachedVariant('TREE',  tv, ts);
                // Draw both layers; fall through to procedural only if neither loaded
                if (gcv) ctx.drawImage(gcv, ipx, ipy, S1, S1);
                if (tcv) { ctx.drawImage(tcv, ipx, ipy, S1, S1); return; }
                if (gcv) return;   // grass drawn, tree not ready yet — acceptable
                break;
            }

            // ── WATER (animated) ──────────────────────────────────
            case TILE.WATER: {
                const cv = this._getCachedFrame('WATER', this._waterFrame, ts);
                if (cv) { ctx.drawImage(cv, ipx, ipy, S1, S1); return; }
                break;
            }

            // ── DOOR (static frame 0 for map bake; open state later)
            case TILE.DOOR: {
                const cv = this._getCachedFrame('DOOR', 0, ts);
                if (cv) { ctx.drawImage(cv, ipx, ipy, S1, S1); return; }
                break;
            }

            // ── TORCH (animated, draws wall behind it) ────────────
            case TILE.TORCH: {
                const frame = (this._torchFrame + ((tx * 3 + ty * 7) & 1)) & 1;
                const cv    = this._getCachedFrame('TORCH', frame, ts);
                if (cv) {
                    // Wall background first
                    const wv  = (tx * 3 + ty * 11) & 3;
                    const wk  = mapCtx.dark       ? 'WALL_DUN'
                              : mapCtx.isInterior ? 'WALL_INT'
                              :                     'WALL_EXT';
                    const wcv = this._getCachedVariant(wk, wv, ts);
                    if (wcv) ctx.drawImage(wcv, ipx, ipy, S1, S1);
                    ctx.drawImage(cv, ipx, ipy, S1, S1);
                    return;
                }
                break;
            }

            // ── STAIRS DOWN / UP ──────────────────────────────────
            case TILE.STAIRS:
            case TILE.STAIRSUP: {
                const key = tileId === TILE.STAIRS ? 'STAIRS' : 'STAIRSUP';
                // Floor base first
                const fv  = (tx * 5 + ty * 17) & 3;
                const fk  = mapCtx.dark ? 'FLOOR_DARK' : 'FLOOR_LIGHT';
                const fcv = this._getCachedVariant(fk, fv, ts);
                if (fcv) ctx.drawImage(fcv, ipx, ipy, S1, S1);
                const cv  = this._getCachedVariant(key, 0, ts);
                if (cv) { ctx.drawImage(cv, ipx, ipy, S1, S1); return; }
                if (fcv) return;
                break;
            }

            // ── SIGN ──────────────────────────────────────────────
            case TILE.SIGN: {
                // Sub-type 0: always use wall-plaque for now; full context
                // detection (wall/floor/post) can be added in Phase 3.
                const cv = this._getCachedVariant('SIGN', 0, ts);
                if (cv) { ctx.drawImage(cv, ipx, ipy, S1, S1); return; }
                break;
            }

            default:
                break;
        }

        // ── Debug overlay ─────────────────────────────────────────
        // When DEBUG_TILES is true, flag every tile that missed the sprite path
        // (atlas entry missing, image failed to load, or region was transparent).
        if (DEBUG_TILES) {
            ctx.save();
            ctx.fillStyle   = 'rgba(255,0,0,0.30)';
            ctx.fillRect(ipx, ipy, ts + 1, ts + 1);
            ctx.strokeStyle = '#ff0000';
            ctx.lineWidth   = 2;
            ctx.strokeRect(ipx + 1, ipy + 1, ts - 1, ts - 1);
            ctx.fillStyle   = '#ffffff';
            ctx.font        = `bold 9px monospace`;
            ctx.fillText(String(tileId), ipx + 2, ipy + 11);
            ctx.restore();
        }
        // Tile drew nothing — intentionally leave blank.
        // Procedural fallback is permanently disabled: the atlas is the only
        // source of tile graphics. Enable DEBUG_TILES above to find missing IDs.
    }

    // ═══════════════════════════════════════════════════════════════
    //  PRIVATE — IMAGE LOADING
    // ═══════════════════════════════════════════════════════════════

    _startLoad(key, path) {
        const img   = new Image();
        const entry = { img, loaded: false, failed: false };
        this._images.set(key, entry);

        img.onload = () => {
            entry.loaded = true;
            this._checkReady();
        };

        img.onerror = () => {
            entry.failed = true;
            console.warn(`[SpriteRenderer] Could not load "${key}" from: ${path}`);
            this._checkReady();
        };

        img.src = path;
    }

    /**
     * Loads all image files referenced by TILE_MANIFEST atlas-ID entries,
     * marks them as required, and starts their loads.
     * Called once after sprite_atlas.json finishes fetching.
     */
    _loadAtlasSheets() {
        const files = new Set();

        for (const [name, def] of Object.entries(TILE_MANIFEST)) {
            if (!def || name === 'CHAR') continue;

            // ids-based tiles
            for (const id of (def.ids || [])) {
                const e = this._atlasById.get(id);
                if (e) files.add(e.file);
            }

            // animId-based tiles
            if (def.animId) {
                const e = this._atlasById.get(def.animId);
                if (e) files.add(e.file);
            }
        }

        // All unique terrain image files are required before isReady()
        // URL-encode each path segment so spaces (e.g. "Animated stuff") don't
        // cause silent image-load failures in the browser.
        for (const file of files) {
            this._requiredKeys.add(file);
            if (!this._images.has(file)) {
                const url = '/' + file.split('/').map(seg => encodeURIComponent(seg)).join('/');
                this._startLoad(file, url);
            }
        }
    }

    /**
     * After each load/fail event, test whether every required sheet
     * has settled.  When true, flip _ready and warm the cache.
     */
    _checkReady() {
        if (this._ready) {
            // Already ready — a late-loading sheet (e.g. character) arrived.
            // Rebuild the tile cache so new sprites appear immediately.
            const ts = (typeof TS !== 'undefined') ? TS : this._ts;
            if (ts > 0) this.warmCache(ts);
            if (typeof bgDirty !== 'undefined') bgDirty = true;
            return;
        }

        // Must wait for the atlas JSON before we can check image requirements.
        if (!this._atlasLoaded) return;

        const allSettled = [...this._requiredKeys].every(k => {
            const e = this._images.get(k);
            return e && (e.loaded || e.failed);
        });

        if (!allSettled) return;

        this._ready = true;
        const ts    = (typeof TS !== 'undefined') ? TS : 48;
        this.warmCache(ts);

        // Force the background canvas to rebuild with sprite tiles
        if (typeof bgDirty !== 'undefined') bgDirty = true;

        const loaded = [...this._images.values()].filter(e => e.loaded).length;
        const failed = [...this._images.values()].filter(e => e.failed).length;
        console.log(`[SpriteRenderer] Ready — ${loaded} sheets loaded, ${failed} failed.`);
        if (failed > 0) {
            console.info('[SpriteRenderer] Failed sheets will use procedural fallback.');
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  PRIVATE — TILE CANVAS CACHE
    // ═══════════════════════════════════════════════════════════════

    /**
     * Returns a cached ts×ts canvas for a static-tile variant,
     * or null if the sheet isn't loaded / coords are out of bounds.
     *
     * Supports two TILE_MANIFEST formats:
     *   { ids: ['atlas_id', ...] }  — atlas-based (new)
     *   { sheet, variants: [{sx,sy,sw,sh}, ...] }  — legacy (backward compat)
     *
     * Throws a descriptive error if an atlas id is missing.
     */
    _getCachedVariant(manifestKey, variantIdx, ts) {
        const cacheKey = `${manifestKey}:v${variantIdx}:${ts}`;
        if (this._tileCache.has(cacheKey)) return this._tileCache.get(cacheKey);

        const def = TILE_MANIFEST[manifestKey];
        if (!def) { this._tileCache.set(cacheKey, null); return null; }

        let result = null;

        if (def.ids) {
            // ── Atlas-based format ────────────────────────────────
            if (!this._atlasLoaded) {
                // Atlas not ready yet — don't cache so we retry after load
                return null;
            }
            const id = def.ids[Math.min(variantIdx, def.ids.length - 1)];
            if (!id) { this._tileCache.set(cacheKey, null); return null; }

            const atlasEntry = this._atlasById.get(id);
            if (!atlasEntry) {
                throw new Error(
                    `[SpriteRenderer] Missing atlas entry: "${id}" (tile: ${manifestKey})`
                );
            }
            const rect = {
                sx: atlasEntry.sx, sy: atlasEntry.sy,
                sw: atlasEntry.sw, sh: atlasEntry.sh,
            };
            result = this._cutToCanvas(atlasEntry.file, rect, ts);

        } else if (def.variants) {
            // ── Legacy format ─────────────────────────────────────
            const idx  = Math.min(variantIdx, def.variants.length - 1);
            const rect = def.variants[idx];
            if (!rect) { this._tileCache.set(cacheKey, null); return null; }
            result = this._cutToCanvas(def.sheet, rect, ts);
        }

        // Cache even null so we don't retry on every frame
        this._tileCache.set(cacheKey, result);
        return result;
    }

    /**
     * Returns a cached ts×ts canvas for one frame of an animated tile.
     *
     * Supports two TILE_MANIFEST formats:
     *   { animId: 'atlas_id', frameCount }  — atlas horizontal strip (new)
     *   { sheet, frames: [{sx,sy,sw,sh}, ...] }  — legacy explicit rects
     *
     * Throws a descriptive error if an atlas animId is missing.
     */
    _getCachedFrame(manifestKey, frameIdx, ts) {
        const cacheKey = `${manifestKey}:f${frameIdx}:${ts}`;
        if (this._tileCache.has(cacheKey)) return this._tileCache.get(cacheKey);

        const def = TILE_MANIFEST[manifestKey];
        if (!def) { this._tileCache.set(cacheKey, null); return null; }

        let result = null;

        if (def.animId) {
            // ── Atlas-based horizontal strip ──────────────────────
            if (!this._atlasLoaded) return null;   // retry after load

            const atlasEntry = this._atlasById.get(def.animId);
            if (!atlasEntry) {
                throw new Error(
                    `[SpriteRenderer] Missing atlas entry: "${def.animId}" (tile: ${manifestKey})`
                );
            }
            // Frame N is at sx + N * sw in a horizontal strip
            const fi   = Math.min(frameIdx, atlasEntry.frames - 1);
            const rect = {
                sx: atlasEntry.sx + fi * atlasEntry.sw,
                sy: atlasEntry.sy,
                sw: atlasEntry.sw,
                sh: atlasEntry.sh,
            };
            result = this._cutToCanvas(atlasEntry.file, rect, ts);

        } else if (def.frames) {
            // ── Legacy explicit-rect format ───────────────────────
            const idx  = Math.min(frameIdx, def.frames.length - 1);
            const rect = def.frames[idx];
            if (!rect) { this._tileCache.set(cacheKey, null); return null; }
            result = this._cutToCanvas(def.sheet, rect, ts);
        }

        this._tileCache.set(cacheKey, result);
        return result;
    }

    /**
     * Cuts `rect` from the named sheet, scales to ts×ts, returns
     * an offscreen HTMLCanvasElement.  Returns null on any error.
     *
     * Kenney 16 px tiles are automatically scaled 3× (16 → 48 px).
     * All other sheets are cut at their native size and scaled to ts.
     */
    _cutToCanvas(sheetKey, rect, ts) {
        const entry = this._images.get(sheetKey);
        if (!entry?.loaded) return null;
        if (!rect || rect.sx === undefined) return null;

        const img = entry.img;

        // Bounds check — warn once rather than spamming every frame
        const warnKey = `${sheetKey}:${rect.sx}:${rect.sy}`;
        if (rect.sx + rect.sw > img.width || rect.sy + rect.sh > img.height) {
            if (!this._warnedOob) this._warnedOob = new Set();
            if (!this._warnedOob.has(warnKey)) {
                this._warnedOob.add(warnKey);
                console.warn(
                    `[SpriteRenderer] Source rect out of bounds on "${sheetKey}":`,
                    `sx=${rect.sx} sy=${rect.sy} sw=${rect.sw} sh=${rect.sh}`,
                    `— sheet is ${img.width}×${img.height} px.`,
                    'Press F3 to open the Sprite Picker and find the correct coords.'
                );
            }
            return null;
        }

        const c   = document.createElement('canvas');
        c.width   = ts;
        c.height  = ts;
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = false;

        ctx.drawImage(
            img,
            rect.sx, rect.sy, rect.sw, rect.sh,   // source rect (native px)
            0,       0,       ts,      ts           // destination (scaled to ts×ts)
        );

        // Transparency guard — if the source region was empty/transparent the
        // canvas is technically valid but draws nothing, which would block the
        // procedural fallback.  Compute mean alpha; treat < 10 as "no tile here".
        const data = ctx.getImageData(0, 0, ts, ts).data;
        let totalAlpha = 0;
        for (let i = 3; i < data.length; i += 4) totalAlpha += data[i];
        if (totalAlpha / (ts * ts) < 10) return null;

        return c;
    }

    // ═══════════════════════════════════════════════════════════════
    //  PRIVATE — ANIMATION HELPERS
    // ═══════════════════════════════════════════════════════════════

    /** Random torch flicker interval — 4 to 6 frames at ~60 fps */
    _nextTorchMs() { return 66 + Math.floor(Math.random() * 50); }   // ~66–116 ms

    // ═══════════════════════════════════════════════════════════════
    //  PRIVATE — PROCEDURAL FALLBACK
    //  When a required sheet hasn't loaded, mirrors drawTile() logic
    //  from game.js exactly so the visual output is identical.
    // ═══════════════════════════════════════════════════════════════

    _drawProcedural(ctx, tileId, ipx, ipy, tx, ty, mapCtx, ts) {
        if (typeof ensureTileCache === 'undefined' || typeof _tc === 'undefined') return;
        ensureTileCache();

        const dark     = mapCtx.dark;
        const interior = mapCtx.isInterior;
        const S1       = ts + 1;

        switch (tileId) {
            case TILE.GRASS: {
                ctx.drawImage(_tc[`g${(tx*7+ty*13)&7}`], ipx, ipy, S1, S1);
                // Edge blending is handled by the VQ pass in rebuildBgCanvas;
                // no need to reproduce it here.
                break;
            }
            case TILE.PATH:
                ctx.drawImage(_tc[`p${(tx*11+ty*7)&3}`], ipx, ipy, S1, S1);
                break;
            case TILE.FLOOR: {
                const v = (tx*5+ty*17)&3;
                ctx.drawImage(_tc[dark?`fd${v}`:`fl${v}`], ipx, ipy, S1, S1);
                break;
            }
            case TILE.WALL: {
                const v  = (tx*3+ty*11)&3;
                if (mapCtx.isCeiling) { ctx.drawImage(_tc[`ceil${v}`], ipx, ipy, S1, S1); break; }
                const wk = dark?`wd${v}`:interior?`win${v}`:`wex${v}`;
                ctx.drawImage(_tc[wk], ipx, ipy, S1, S1);
                break;
            }
            case TILE.TREE: {
                const gv=(tx*7+ty*13)&7, tv=(tx*5+ty*9)&3;
                ctx.drawImage(_tc[`g${gv}`],  ipx, ipy, S1, S1);
                ctx.drawImage(_tc[`tr${tv}`], ipx, ipy, S1, S1);
                break;
            }
            case TILE.WATER:
                if (typeof drawWater   === 'function') drawWater(ipx, ipy);
                break;
            case TILE.TORCH:
                if (typeof drawTorch   === 'function') drawTorch(ipx, ipy, tx, ty);
                break;
            case TILE.STAIRS:
            case TILE.STAIRSUP:
                if (typeof drawStairs  === 'function') drawStairs(ipx, ipy);
                break;
            case TILE.DOOR:
                if (typeof drawDoor    === 'function') drawDoor(ipx, ipy, tx, ty);
                break;
            case TILE.SIGN:
                if (typeof drawSign    === 'function') drawSign(ipx, ipy, tx, ty);
                break;
            default:
                break;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  PRIVATE — F3 SPRITE PICKER OVERLAY
    //  Renders every loaded sheet with a clickable tile grid.
    //  Clicking a cell prints its col, row, sx, sy to the console.
    // ═══════════════════════════════════════════════════════════════

    _initPicker() {
        document.addEventListener('keydown', e => {
            if (e.key !== 'F3') return;
            e.preventDefault();
            this._pickerOpen = !this._pickerOpen;
            const el = document.getElementById('sr-picker');
            if (el) { el.remove(); }
            if (this._pickerOpen) this._buildPicker();
        });
    }

    _buildPicker() {
        const panel = document.createElement('div');
        panel.id    = 'sr-picker';
        Object.assign(panel.style, {
            position:     'fixed',
            top:          '10px',
            left:         '10px',
            background:   'rgba(8,4,12,0.96)',
            border:       '1px solid #c8901a',
            borderRadius: '4px',
            padding:      '12px',
            zIndex:       '10000',
            fontFamily:   'monospace',
            fontSize:     '11px',
            color:        '#e8dcc8',
            maxWidth:     '92vw',
            maxHeight:    '88vh',
            overflowY:    'auto',
            userSelect:   'none',
        });

        // Header
        const hdr = document.createElement('div');
        hdr.innerHTML = '<b style="color:#c8901a">Sprite Picker</b>'
            + '  <span style="color:#6a8a9a">(F3 to close)</span>'
            + '  Click any cell → coords print to console';
        hdr.style.marginBottom = '8px';
        panel.appendChild(hdr);

        let loadedCount = 0;

        for (const [key, entry] of this._images) {
            if (!entry.loaded) continue;
            loadedCount++;

            const section = document.createElement('div');
            section.style.marginBottom = '14px';

            // Sheet info label (updated on cell click)
            const lbl = document.createElement('div');
            lbl.style.cssText = 'color:#90a8c8;font-size:10px;margin-bottom:3px;';
            lbl.textContent   = `${key} — ${entry.img.width}×${entry.img.height}px`;
            section.appendChild(lbl);

            // Determine tile stride for grid overlay
            const isKenney  = (key === 'KENNEY');
            const tileStride = isKenney ? 17 : 48;
            const tileNative = isKenney ? 16 : 48;

            // Scale the sheet down so it fits in the panel
            const maxW  = Math.min(600, window.innerWidth * 0.85);
            const scale = Math.min(2, maxW / entry.img.width);

            const cv    = document.createElement('canvas');
            cv.width    = Math.round(entry.img.width  * scale);
            cv.height   = Math.round(entry.img.height * scale);
            cv.style.cursor = 'crosshair';
            cv.style.border = '1px solid #2a3848';
            cv.style.display = 'block';

            const c2 = cv.getContext('2d');
            c2.imageSmoothingEnabled = false;

            // Draw sheet
            c2.drawImage(entry.img, 0, 0, cv.width, cv.height);

            // Draw grid overlay
            c2.strokeStyle = 'rgba(200,144,26,0.45)';
            c2.lineWidth   = 0.5;
            const scaledStride = tileStride * scale;
            for (let gx = 0; gx <= cv.width;  gx += scaledStride) {
                c2.beginPath(); c2.moveTo(gx, 0); c2.lineTo(gx, cv.height); c2.stroke();
            }
            for (let gy = 0; gy <= cv.height; gy += scaledStride) {
                c2.beginPath(); c2.moveTo(0, gy); c2.lineTo(cv.width, gy); c2.stroke();
            }

            cv.addEventListener('click', evt => {
                const r   = cv.getBoundingClientRect();
                const mx  = (evt.clientX - r.left)  / scale;
                const my  = (evt.clientY - r.top)   / scale;
                const col = Math.floor(mx / tileStride);
                const row = Math.floor(my / tileStride);
                const sx  = col * tileStride;
                const sy  = row * tileStride;

                const helperCall = isKenney
                    ? `k(${col}, ${row})`
                    : `v(${col}, ${row})`;

                const msg = `📌 ${key}  col=${col} row=${row}`
                    + `  sx=${sx} sy=${sy} sw=${tileNative} sh=${tileNative}`
                    + `  →  ${helperCall}`;

                console.log(msg);
                lbl.textContent = msg;
                lbl.style.color = '#f0d080';
            });

            section.appendChild(cv);
            panel.appendChild(section);
        }

        if (loadedCount === 0) {
            const msg = document.createElement('div');
            msg.textContent = 'No sheets loaded yet — wait for the game to start.';
            msg.style.color = '#e06060';
            panel.appendChild(msg);
        }

        document.body.appendChild(panel);
    }
}

// ─── GLOBAL SINGLETON ────────────────────────────────────────────────────────
const spriteRenderer = new SpriteRenderer();

// Begin loading as soon as the DOM is ready so sheets load in parallel
// with the rest of game initialisation.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => spriteRenderer.loadAll());
} else {
    spriteRenderer.loadAll();
}
