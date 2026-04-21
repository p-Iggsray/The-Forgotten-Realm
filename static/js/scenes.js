// Scene registry — one entry per map id.
// To add a new scene: add an entry here with onEnter(fromSceneName) and/or onExit(toSceneName).
// No edits to changeMap() required.
// Hooks read Game.* directly. Pass fromId/toId for routing logic.

const SCENES = {
    village: {
        onEnter(from) {},
        onExit(to) {}
    },

    dungeon_1: {
        onEnter(from) {
            if (!gs.flags.quest_into_dark_complete) {
                gs.flags.quest_into_dark_complete = true;
                onQuestComplete(Game.QUESTS.find(q => q.flag_complete === 'quest_into_dark_complete'));
            }
            if (Game.gs?.activeWorldEvents?.includes('seal_weakening')) {
                const BONUS = 0.10;
                (Game.MAPS?.dungeon_1?.enemies || []).forEach(e => {
                    if (e.alive && !e._sealBoosted) {
                        e.hp = Math.round(e.hp * (1 + BONUS));
                        e._sealBoosted = true;
                    }
                });
            }
        },
        onExit(to) {}
    },

    int_elder:      { onEnter(from) {}, onExit(to) {} },
    int_merchant:   { onEnter(from) {}, onExit(to) {} },
    int_blacksmith: { onEnter(from) {}, onExit(to) {} },
    int_tavern:     { onEnter(from) {}, onExit(to) {} },
    int_market:     { onEnter(from) {}, onExit(to) {} },
    int_cottage:    { onEnter(from) {}, onExit(to) {} },
    int_chapel:     { onEnter(from) {}, onExit(to) {} },
    int_veyla:      { onEnter(from) {}, onExit(to) {} },
};

window.SCENES = SCENES;
