'use strict';
// ═══════════════════════════════════════════════════════════════════
//  TILE_MANIFEST.js  —  The Forgotten Realm
//
//  Stub — fully procedural rendering. No sprite sheets, no atlas,
//  no image files of any kind. All tile drawing is done via canvas
//  primitives in game.js _buildTileCache() and draw* functions.
// ═══════════════════════════════════════════════════════════════════

// Empty sheet registry — no image paths exist or are needed.
const SHEET_PATHS = Object.freeze({});

// Minimal manifest stub for character animation layout used by entity draw code.
const TILE_MANIFEST = Object.freeze({
    CHAR: Object.freeze({
        frameW:    16,
        frameH:    16,
        walkRows:  Object.freeze({ down: 0, up: 1, left: 2, right: 3 }),
        walkFrames: Object.freeze([0, 1, 2]),
        player: Object.freeze({ Warrior: null, Rogue: null, Wizard: null, Cleric: null }),
        npc:    Object.freeze({ guide: null, elder: null, blacksmith: null,
                                traveler: null, ghost: null, _default: null }),
        enemy:  Object.freeze({ shade: null, lurker: null }),
    }),
});
