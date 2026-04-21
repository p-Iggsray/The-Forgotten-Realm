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
                setTimeout(() => showNotification('Quest Complete: Into the Dark', 'quest'), 800);
                updateQuestUI();
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
