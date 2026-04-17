'use strict';
// ═══════════════════════════════════════════════════════════════════
//  SpriteRenderer.js  —  The Forgotten Realm
//
//  Stub — all tile and entity rendering is fully procedural via
//  canvas primitives. This class exists to satisfy references in
//  game.js without loading any image files.
//
//  isReady() always returns false so game.js always uses its own
//  procedural _buildTileCache() / draw* pipeline.
// ═══════════════════════════════════════════════════════════════════

class SpriteRenderer {
    isReady()             { return false; }
    loadAll()             {}
    advanceAnimations()   {}
    warmCache()           {}
    invalidate()          {}
    drawTile()            {}
}

const spriteRenderer = new SpriteRenderer();
