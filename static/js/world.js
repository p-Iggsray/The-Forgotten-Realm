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
        knownLore:     [],
        unlockedAreas: [],
        reputation:    {},
        npcMoods:           {},
        activeWorldEvents:  [],
        sessionId:          '',
    };

    Game.cam = { x: 0, y: 0 };

    // currentMap is null until game.js initializes MAPS and calls changeMap / startGame.
    Game.currentMap = null;
})();
