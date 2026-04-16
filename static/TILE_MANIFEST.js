'use strict';
// ═══════════════════════════════════════════════════════════════════
//  TILE_MANIFEST.js  —  The Forgotten Realm
//
//  Maps every game tile type and entity type to its sprite sheet.
//
//  ALL COORDINATES VERIFIED via pixel-sampling each sheet.
//  Last verified: 2026-04-15
//
//  COORDINATE HELPERS
//  ──────────────────
//  v(col, row)  — Serene Village 48 px grid  (48 px tiles, no gap)
//  i(col, row)  — Room Builder / Interiors 48 px grid (48 px tiles, no gap)
//  k(col, row)  — Kenney 16 px grid (16 px tiles, 1 px gap → 17 px stride)
//  n(col, row)  — Ninja Adventure 16 px grid (16 px tiles, no gap)
//
//  HOW THE SHEETS ARE ORGANISED
//  ─────────────────────────────
//  VILLAGE  (Serene_Village_48x48.png, 912×2160, 19×45 tiles)
//    Rows 0–6 = sample-map scene (autotile terrain).
//    Green grass fills cols 3–5 row 0; sandy path cols 6,9 rows 1–3;
//    tree canopy cols 15–16 row 10.
//
//  ROOM_BUILDER  (Room_Builder_free_48x48.png, 816×1104, 17×23 tiles)
//    Rows 0–4 = room-border/ceiling schematic (mostly transparent).
//    Rows 5–20 = stacked wall/floor material bands, 2 rows per material.
//    Left group  (cols 0–3):   main wall-panel face
//    Center group (cols 4–6):  accent variant
//    Right group  (cols 7–9):  lighter variant
//    Far right    (cols 11–16): floor-tile patterns
//    Row 5–6:  salmon/rose       Row 7–8:  cream/golden
//    Row 9–10: teal-mint         Row 11–12: warm wood (light)
//    Row 13–14: medium wood      Row 15–16: terracotta/brick
//    Row 17–18: blue-grey slate  Row 19–20: neutral stone
//    Ceiling tiles (alpha=255, near-white): cols 14–16 rows 0–2.
//
//  KENNEY  (roguelikeSheet_transparent.png, 968×526, 57×31 @ 17px stride)
//    Cols 0–4 rows 0–5 = water/terrain (blue-teal).
//    k(6,0)  = brown earth      k(7,0)  = grey-blue stone
//    k(8,0)  = cream/sandy      k(9,0)  = grey-blue stone
//    k(5-9, 3-5) = brown earth floor (dungeon floor tiles)
//    k(6,2)  = light grey       k(15,6) = warm torch/candle
//    k(16,6) = warm torch variant
//
//  WATER_ANIM  (water_waves_48x48.png, 672×48, 14×1 tiles) — 14 frames total;
//    the game uses the first 4 (0–3), all verified as blue water.
//
//  DOOR_ANIM  (door_48x48.png, 192×48, 4×1 tiles) — all 4 verified as wood door.
// ═══════════════════════════════════════════════════════════════════


// ─── SHEET REGISTRY ──────────────────────────────────────────────────────────
const SHEET_PATHS = Object.freeze({

    // ── PLAYER — one sheet per character class ────────────────────
    CHAR_KNIGHT:     '/assets/characters/Actor/Character/Knight/SpriteSheet.png',
    CHAR_NINJA_BLUE: '/assets/characters/Actor/Character/NinjaBlue/SpriteSheet.png',
    CHAR_SORCERER:   '/assets/characters/Actor/Character/SorcererBlack/SpriteSheet.png',
    CHAR_MONK:       '/assets/characters/Actor/Character/Monk2/SpriteSheet.png',

    // ── NPC CHARACTERS ────────────────────────────────────────────
    CHAR_BOY:        '/assets/characters/Actor/Character/Boy/SpriteSheet.png',
    CHAR_OLDMAN:     '/assets/characters/Actor/Character/OldMan2/SpriteSheet.png',
    CHAR_FIGHTER:    '/assets/characters/Actor/Character/FighterRed/SpriteSheet.png',
    CHAR_NOBLE:      '/assets/characters/Actor/Character/Noble/SpriteSheet.png',
    CHAR_SPIRIT:     '/assets/characters/Actor/Character/Spirit/SpriteSheet.png',

    // ── ENEMIES ───────────────────────────────────────────────────
    ENEMY_SHADE:     '/assets/characters/Actor/Character/NinjaDark/SpriteSheet.png',
    ENEMY_LURKER:    null,   // procedural fallback
});


// ─── TILE-SIZE CONSTANTS (native pixels, before scaling) ─────────────────────
const V_TILE   = 48;   // Serene Village / Modern Interiors / Room Builder — 48 px
const K_TILE   = 16;   // Kenney — 16 px tile
const K_STRIDE = 17;   // Kenney — 17 px stride (16 + 1 px gap)


// ─── COORDINATE HELPERS ──────────────────────────────────────────────────────

/** Serene Village 48 px grid */
function v(col, row) {
    return { sx: col * V_TILE, sy: row * V_TILE, sw: V_TILE, sh: V_TILE };
}

/** Room Builder / Modern Interiors 48 px grid */
function i(col, row) {
    return { sx: col * V_TILE, sy: row * V_TILE, sw: V_TILE, sh: V_TILE };
}

/** Kenney 16 px / 17 px-stride grid: returns a 16×16 source rect */
function k(col, row) {
    return { sx: col * K_STRIDE, sy: row * K_STRIDE, sw: K_TILE, sh: K_TILE };
}

/** Ninja Adventure 16 px grid (no gap) */
function n(col, row) {
    return { sx: col * 16, sy: row * 16, sw: 16, sh: 16 };
}


// ═══════════════════════════════════════════════════════════════════
//  TILE_MANIFEST
//
//  Village tiles (GRASS, PATH, WATER, DOOR, TORCH, TREE, SIGN) use
//  the atlas-ID format: { ids: [...] } or { animId, frameCount }.
//  All coordinates are resolved at runtime via SpriteRenderer.getSprite(id).
//
//  Interior/dungeon tiles still use the legacy { sheet, variants } format
//  but those sheets don't exist yet, so they fall through to procedural.
// ═══════════════════════════════════════════════════════════════════
const TILE_MANIFEST = {

    // ─────────────────────────────────────────────────────────────
    //  GRASS  (TILE.GRASS = 0)
    //  Source: sprite_atlas.json → Serene_Village_16x16.png
    //  8 variants picked by (tx*7 + ty*13) & 7
    // ─────────────────────────────────────────────────────────────
    GRASS: {
        ids: [
            'grass_center',       // 0
            'grass_center',       // 1 (duplicate for density)
            'grass_top',          // 2
            'grass_bottom',       // 3
            'grass_left',         // 4
            'grass_right',        // 5
            'grass_corner_tl',    // 6
            'grass_corner_tr',    // 7
        ],
        fallback: 'procedural',
    },

    // ─────────────────────────────────────────────────────────────
    //  PATH  (TILE.PATH = 1)
    //  4 variants picked by (tx*11 + ty*7) & 3
    // ─────────────────────────────────────────────────────────────
    PATH: {
        ids: [
            'dirt_path_cross',    // 0 — crossroads
            'dirt_center',        // 1 — plain dirt
            'dirt_path_h',        // 2 — horizontal path
            'dirt_path_v',        // 3 — vertical path
        ],
        fallback: 'procedural',
    },

    // ─────────────────────────────────────────────────────────────
    //  FLOOR_LIGHT — light interior floor  (TILE.FLOOR, dark=false)
    //  Legacy format — falls through to procedural until interior
    //  atlas entries are mapped.
    // ─────────────────────────────────────────────────────────────
    FLOOR_LIGHT: {
        ids: [
            'path_stone_c',   // 0 — stone floor (best available stand-in)
            'path_stone_c',   // 1
            'path_stone_c',   // 2
            'path_stone_c',   // 3
        ],
        fallback: 'procedural',
    },

    // ─────────────────────────────────────────────────────────────
    //  FLOOR_DARK — dark dungeon floor  (TILE.FLOOR, dark=true)
    // ─────────────────────────────────────────────────────────────
    FLOOR_DARK: {
        ids: [
            'dirt_center',    // 0
            'dirt_center',    // 1
            'sand_dark',      // 2
            'dirt_center',    // 3
        ],
        fallback: 'procedural',
    },

    // ─────────────────────────────────────────────────────────────
    //  WALL_EXT — exterior building wall  (TILE.WALL, outdoor map)
    //
    //  Variants are position-aware (set by buildVariantMap Phase 2):
    //    v=0  ROOF     row 22 col 0  rgb(252, 92, 70) — orange-red roof tile
    //    v=1  BODY     row 23 col 0  rgb(224,184,112) — warm tan/ochre wall face
    //    v=2  R-BORDER row 23 col 2  rgb( 70, 70, 94) — dark outline (right edge)
    //    v=3  SHADOW   row 27 col 0  rgb(156,120,107) — darker foundation / south face
    //
    //  Colour-verified via pixel-sampling 2026-04-16.
    // ─────────────────────────────────────────────────────────────
    WALL_EXT: {
        ids: [
            'building_row22_col0',   // 0 — orange-red ROOF tile
            'building_row23_col0',   // 1 — warm tan wall body
            'building_row23_col2',   // 2 — dark right-edge border
            'building_row27_col0',   // 3 — darker shadow/foundation row
        ],
        fallback: 'procedural',
    },

    // ─────────────────────────────────────────────────────────────
    //  WALL_INT — interior wood wall  (TILE.WALL, interior map)
    //  Row 13 col 5-8: warm brownish wood — opaque enough for walls.
    //  Avoid col 2 (rgb 183,222,185 = bright green vegetation tile).
    //  Verified: rgb(132,110,101) (132,110,100) (156,116,88) (155,119,95)
    // ─────────────────────────────────────────────────────────────
    WALL_INT: {
        ids: [
            'building_row13_col5',   // 0 — warm brown wood
            'building_row13_col6',   // 1 — warm brown wood variant
            'building_row13_col7',   // 2 — rich warm brown
            'building_row13_col8',   // 3 — warm brown plank
        ],
        fallback: 'procedural',
    },

    // ─────────────────────────────────────────────────────────────
    //  WALL_DUN — dungeon stone  (TILE.WALL, dark map)
    //  Row 14 col 0,1,3,4: grey/dark stone tones.
    //  Avoid col 2 (rgb 183,222,185 = bright green vegetation tile).
    //  Verified: rgb(100,98,87) (121,115,101) (134,117,110) (129,106,97)
    // ─────────────────────────────────────────────────────────────
    WALL_DUN: {
        ids: [
            'building_row14_col0',   // 0 — dark grey stone
            'building_row14_col1',   // 1 — medium grey stone
            'building_row14_col3',   // 2 — warm stone
            'building_row14_col4',   // 3 — brownish stone
        ],
        fallback: 'procedural',
    },

    // ─────────────────────────────────────────────────────────────
    //  CEILING — interior overhead  (TILE.WALL, isCeiling=true)
    //  Row 15 col 0-3: warm tan/brown roof material.
    //  Verified: rgb(116,101,73) (116,102,99) (116,112,99) (108,104,91)
    // ─────────────────────────────────────────────────────────────
    CEILING: {
        ids: [
            'building_row15_col0',   // 0 — warm brown roof
            'building_row15_col1',   // 1 — warm tan roof
            'building_row15_col2',   // 2 — neutral tan roof
            'building_row15_col3',   // 3 — neutral stone roof
        ],
        fallback: 'procedural',
    },

    // ─────────────────────────────────────────────────────────────
    //  TREE  (TILE.TREE = 4)
    //  isOverlay: SpriteRenderer draws GRASS first, then this on top.
    //  2 variants picked by (tx*5 + ty*9) & 1
    // ─────────────────────────────────────────────────────────────
    TREE: {
        ids: [
            'tree_large_tl',   // 0 — upper-left canopy quad
            'tree_large_tm',   // 1 — upper-mid canopy quad
        ],
        isOverlay: true,
        fallback:  'procedural',
    },

    // ─────────────────────────────────────────────────────────────
    //  WATER  (TILE.WATER = 5)  — animated, 4 frames
    //  animId → atlas entry with frames=4 horizontal strip
    // ─────────────────────────────────────────────────────────────
    WATER: {
        animId:     'water_waves',
        frameCount: 4,
        animated:   true,
        fallback:   'procedural',
    },

    // ─────────────────────────────────────────────────────────────
    //  DOOR  (TILE.DOOR = 6)  — animated, 4 frames
    // ─────────────────────────────────────────────────────────────
    DOOR: {
        animId:     'door',
        frameCount: 4,
        animated:   true,
        fallback:   'procedural',
    },

    // ─────────────────────────────────────────────────────────────
    //  STAIRS DOWN  (TILE.STAIRS = 7)
    // ─────────────────────────────────────────────────────────────
    STAIRS: {
        ids: [
            'dirt_corner_bl',   // 0 — dark pit entrance
        ],
        fallback: 'procedural',
    },

    // ─────────────────────────────────────────────────────────────
    //  STAIRS UP  (TILE.STAIRSUP = 9)
    // ─────────────────────────────────────────────────────────────
    STAIRSUP: {
        ids: [
            'path_stone_tl',   // 0 — stone exit marker
        ],
        fallback: 'procedural',
    },

    // ─────────────────────────────────────────────────────────────
    //  SIGN  (TILE.SIGN = 8)
    // ─────────────────────────────────────────────────────────────
    SIGN: {
        ids: [
            'sign_post',    // 0 — post sign
            'sign_arrow',   // 1 — arrow sign
            'sign_post',    // 2 — post sign (reuse)
        ],
        fallback: 'procedural',
    },

    // ─────────────────────────────────────────────────────────────
    //  TORCH  (TILE.TORCH = 10)  — animated campfire, 2 frames used
    //  animId uses campfire_16x16.png (4-frame strip); only frames
    //  0 and 1 are requested by drawTile.
    // ─────────────────────────────────────────────────────────────
    TORCH: {
        animId:     'campfire',
        frameCount: 2,
        animated:   true,
        fallback:   'procedural',
    },


    // ═══════════════════════════════════════════════════════════════
    //  CHARACTER DEFINITIONS
    //  Used by EntityRenderer.
    //  Ninja Adventure walk layout (16 px, no gap):
    //    Row 0 — Walk Down   cols 0–8
    //    Row 1 — Walk Up
    //    Row 2 — Walk Left
    //    Row 3 — Walk Right
    // ═══════════════════════════════════════════════════════════════
    CHAR: Object.freeze({
        frameW:    16,
        frameH:    16,
        walkRows:  Object.freeze({ down: 0, up: 1, left: 2, right: 3 }),
        walkFrames: Object.freeze([0, 1, 2]),

        player: Object.freeze({
            Warrior: 'CHAR_KNIGHT',
            Rogue:   'CHAR_NINJA_BLUE',
            Wizard:  'CHAR_SORCERER',
            Cleric:  'CHAR_MONK',
        }),

        npc: Object.freeze({
            guide:      'CHAR_BOY',
            elder:      'CHAR_OLDMAN',
            blacksmith: 'CHAR_FIGHTER',
            traveler:   'CHAR_NOBLE',
            ghost:      'CHAR_SPIRIT',
            _default:   'CHAR_BOY',
        }),

        enemy: Object.freeze({
            shade:  'ENEMY_SHADE',
            lurker: null,   // procedural
        }),
    }),
};

Object.freeze(TILE_MANIFEST);


// ─── DEBUG HELPER ─────────────────────────────────────────────────────────────
//  Call TILE_MANIFEST.listAll() in the browser console to print
//  every tile source coordinate currently in the manifest.
(function attachHelpers() {
    const lines = [];
    for (const [name, def] of Object.entries(TILE_MANIFEST)) {
        if (!def || typeof def !== 'object' || name === 'CHAR') continue;
        const items = def.variants || def.frames || [];
        items.forEach((rect, idx) => {
            if (!rect) return;
            const type = def.variants ? 'variant' : 'frame';
            lines.push(
                `${name}[${type} ${idx}]  sheet:${def.sheet}` +
                `  → sx:${rect.sx}  sy:${rect.sy}  sw:${rect.sw}  sh:${rect.sh}`
            );
        });
    }
    Object.defineProperty(TILE_MANIFEST, 'listAll', {
        value() {
            console.group('TILE_MANIFEST — all verified coordinates');
            lines.forEach(l => console.log(l));
            console.groupEnd();
            return lines;
        },
        enumerable:   false,
        configurable: false,
        writable:     false,
    });
})();
