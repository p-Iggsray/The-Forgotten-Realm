'use strict';

// world.js — Shared core state module
// Owns: player, gs, cam, currentMap
// Exported via window.Game.* for cross-module access.
// game.js holds shim references (const player = Game.player, etc.) so all
// existing local mutations propagate through the same object references.
// currentMap is the only reassigned variable — game.js uses the double-
// assignment pattern (currentMap = Game.currentMap = newMap) to keep both in sync.
(function () {
    const Game = window.Game;

    Game.player = {
        x: 7, y: 8, facing: 'down',
        renderX: 7 * 48, renderY: 8 * 48,
        prevX:   7 * 48, prevY:   8 * 48,
        moveT: 1, moveDuration: 130,
        walkPhase: 0,
        isMoving: false,
    };

    Game.gs = {
        charName: 'Hero', charClass: 'Warrior',
        flags: {}, inventory: [],
        hp: 50, maxHp: 50, xp: 0, level: 1,
        knownLore:          [],
        codexTutorialShown: false,
        unlockedAreas: [],
        reputation:    {},
        npcMoods:           {},
        activeWorldEvents:  [],
        sessionId:          '',
    };

    Game.cam = { x: 0, y: 0 };

    // currentMap is null until game.js initializes MAPS and calls changeMap / startGame.
    Game.currentMap = null;

    // ═══════════════════════════════════════════════════════
    //  CHOKEPOINT VALIDATOR
    //  isWalkableAfterBlock(map, bx, by): returns true if every walkable
    //  tile currently reachable from a seed point remains reachable when
    //  (bx, by) is treated as blocked. Used at authoring time for new
    //  prop placements (well, rocks, fences) to guarantee the map stays
    //  fully connected. Never called from the render loop.
    // ═══════════════════════════════════════════════════════
    Game.isWalkableAfterBlock = function isWalkableAfterBlock(map, bx, by) {
        const W = map.w, H = map.h, tiles = map.tiles;
        const WALKABLE = Game.WALKABLE;
        // Find any walkable seed tile that is not (bx, by).
        let seedX = -1, seedY = -1, total = 0;
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                if (!WALKABLE.has(tiles[y][x])) continue;
                total++;
                if (seedX < 0 && !(x === bx && y === by)) { seedX = x; seedY = y; }
            }
        }
        if (seedX < 0) return false;
        const expected = total - (WALKABLE.has(tiles[by]?.[bx]) ? 1 : 0);
        // BFS
        const visited = new Uint8Array(W * H);
        const qx = new Int16Array(W * H), qy = new Int16Array(W * H);
        let head = 0, tail = 0, reached = 0;
        qx[tail] = seedX; qy[tail] = seedY; tail++;
        visited[seedY * W + seedX] = 1;
        while (head < tail) {
            const cx = qx[head], cy = qy[head]; head++;
            reached++;
            const neighbours = [[cx, cy-1],[cx+1, cy],[cx, cy+1],[cx-1, cy]];
            for (const [nx, ny] of neighbours) {
                if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
                if (nx === bx && ny === by) continue;
                if (visited[ny * W + nx]) continue;
                if (!WALKABLE.has(tiles[ny][nx])) continue;
                visited[ny * W + nx] = 1;
                qx[tail] = nx; qy[tail] = ny; tail++;
            }
        }
        return reached === expected;
    };
})();
