'use strict';

window.Game = window.Game || {};

(function() {

// ═══════════════════════════════════════════════════════
//  TILE DEFINITIONS
// ═══════════════════════════════════════════════════════
const TILE = Game.TILE = Object.freeze({
    GRASS:          0,   // rich dark green ground
    DIRT_PATH:      1,   // warm sandy brown secondary paths
    BUILDING_FLOOR: 2,   // worn wood plank interior floor
    BUILDING_WALL:  3,   // dark stone brick facade
    TREE:           4,   // deep forest canopy
    WATER:          5,   // deep navy/teal animated water
    DOOR:           6,   // building entrance (interactive)
    STAIRS:         7,   // descent to dungeon
    SIGN:           8,   // interactive sign post
    STAIRSUP:       9,   // ascent / interior exit
    TORCH:          10,  // wall torch (animated)
    STONE_PATH:     11,  // cool gray cobblestone main roads
    VOID:           12,  // null / empty — pure black
});
Game.WALKABLE = new Set([
    TILE.GRASS, TILE.DIRT_PATH, TILE.STONE_PATH, TILE.BUILDING_FLOOR,
    TILE.DOOR, TILE.STAIRS, TILE.STAIRSUP,
]);
Game.WORLD_ITEM_PLACEABLE = new Set([TILE.GRASS, TILE.DIRT_PATH, TILE.STONE_PATH]);
Game.WEAPON_SEARCH_RADIUS        = 12;
Game.WEAPON_MIN_PLAYER_DISTANCE  = 5;
Game.WEAPON_RING_START_ANGLES    = [0, 90, 180, 270];
Game.MINIMAP_COLORS = Object.freeze({
    [TILE.GRASS]:          '#2a4a18',
    [TILE.DIRT_PATH]:      '#6a4a28',
    [TILE.BUILDING_FLOOR]: '#4a3820',
    [TILE.BUILDING_WALL]:  '#1e1818',
    [TILE.TREE]:           '#1a3808',
    [TILE.WATER]:          '#183848',
    [TILE.DOOR]:           '#7a5030',
    [TILE.STAIRS]:         '#806040',
    [TILE.STAIRSUP]:       '#806040',
    [TILE.SIGN]:           '#6a4828',
    [TILE.TORCH]:          '#c07830',
    [TILE.STONE_PATH]:     '#48443c',
    [TILE.VOID]:           '#040308',
});
// Tiles that animate every frame and must bypass the bg cache.
// Only truly animated tiles belong here — static special tiles (STAIRS, STAIRSUP)
// are baked into the bg canvas and handled by spriteRenderer.drawTile normally.
Game.ANIMATED_TILES = new Set([TILE.WATER, TILE.TORCH]);

// ═══════════════════════════════════════════════════════
//  COLOUR PALETTE  — locked 32-colour pixel-art palette
//  Every tile, sprite, particle and UI element draws
//  exclusively from these values. No arbitrary hex.
// ═══════════════════════════════════════════════════════
const PALETTE = Game.PALETTE = Object.freeze({
    // ── DARKS (5) ────────────────────────────────────────
    D_VOID:    '#04030a',  // 01 deeper void black
    D_BROWN:   '#1a0c04',  // 02 very dark bark
    D_BLUE:    '#0c0c1e',  // 03 deep dungeon void
    D_STONE:   '#141210',  // 04 near-black stone
    D_GREEN:   '#0c2804',  // 05 darkest canopy green

    // ── MIDS (8) ─────────────────────────────────────────
    M_STONE:   '#3a3830',  // 06 aged dark stone
    M_CLAY:    '#4a3018',  // 07 dark earth mortar
    M_MOSS:    '#2a4818',  // 08 deep moss
    M_TEAL:    '#162820',  // 09 dark dungeon teal
    M_SLATE:   '#1e2840',  // 10 deep slate
    M_BRICK:   '#5a1a10',  // 11 dark aged brick
    M_SAND:    '#7a6030',  // 12 aged dirt path
    M_FOREST:  '#1e4010',  // 13 deep forest base

    // ── LIGHTS (7) ───────────────────────────────────────
    L_STONE:   '#786850',  // 14 torchlit stone highlight
    L_PARCH:   '#8a6840',  // 15 aged parchment
    L_GOLD:    '#c07818',  // 16 dim gold
    L_BLUE:    '#4a6878',  // 17 muted pale blue
    L_WHITE:   '#d4c8a0',  // 18 warm candlelight white
    L_LEAF:    '#387820',  // 19 muted leaf green
    L_WATER:   '#2878a0',  // 20 deep dark water

    // ── ACCENTS (6) ──────────────────────────────────────
    A_RED:     '#b01818',  // 21 blood red
    A_ORANGE:  '#c04008',  // 22 deep ember orange
    A_YELLOW:  '#c09010',  // 23 dim lantern yellow
    A_PURPLE:  '#6020a8',  // 24 deep arcane purple
    A_GHOST:   '#607898',  // 25 muted ghost blue
    A_RARE:    '#903070',  // 26 dark rare magenta

    // ── SKIN / FLESH (3) ─────────────────────────────────
    S_PALE:    '#c8a070',  // 27 weathered skin
    S_MID:     '#9a6030',  // 28 dark wood mid
    S_DARK:    '#5a2c10',  // 29 dark wood deep

    // ── UI (3) ───────────────────────────────────────────
    U_BG:      '#0e0a0c',  // 30 UI panel background
    U_GOLD:    '#c8901a',  // 31 UI border gold
    U_TEXT:    '#e8dcc8',  // 32 UI text cream

    // ── MOODY ADDITIONS ──────────────────────────────────
    M_ARCANE:  '#2a1848',  // deep arcane purple-black (magic ambience)
    M_AMBER:   '#6a3808',  // torchlight amber (warm glow base)
    L_AMBER:   '#d08020',  // bright torchlight (flame highlight)
    M_LICHEN:  '#1e3010',  // lichen dark green (aged stone surface)

    // ── SEMANTIC ALIASES (all resolve to values above) ───
    MAP_DARK_BG:   '#04030a',  // = D_VOID
    HP_FULL:       '#387820',  // = L_LEAF
    HP_MID:        '#c07818',  // = L_GOLD
    HP_LOW:        '#b01818',  // = A_RED
    HP_BG:         '#04030a',  // = D_VOID
    XP_FILL:       '#1e2840',  // = M_SLATE
    SHADE_BODY:    '#6020a8',  // = A_PURPLE
    SHADE_EYE:     '#b01818',  // = A_RED
    LURKER_BODY:   '#4a3018',  // = M_CLAY
    LURKER_EYE:    '#c04008',  // = A_ORANGE
    CLASS_WARRIOR: '#c07818',  // = L_GOLD
    CLASS_ROGUE:   '#6020a8',  // = A_PURPLE
    CLASS_WIZARD:  '#4a6878',  // = L_BLUE
    CLASS_CLERIC:  '#c09010',  // = A_YELLOW
    CLOAK_WARRIOR: '#1a0c04',  // = D_BROWN
    CLOAK_ROGUE:   '#0c0c1e',  // = D_BLUE
    CLOAK_WIZARD:  '#0c0c1e',  // = D_BLUE
    CLOAK_CLERIC:  '#141210',  // = D_STONE
    TIMING_MISS:   '#04030a',  // = D_VOID
    TIMING_WEAK:   '#5a1a10',  // = M_BRICK
    TIMING_HIT:    '#2a4818',  // = M_MOSS
    TIMING_CRIT:   '#387820',  // = L_LEAF

    // ── VILLAGE GREENS (grass needs readable range) ──────────
    V_GRASS_BASE:  '#2d5a1b',  // mid forest green — readable grass base
    V_GRASS_MID:   '#3d7a24',  // brighter mid green — grass body
    V_GRASS_HI:    '#5aaa30',  // bright leaf green — grass blade tips / dew
    V_GRASS_DARK:  '#1a3a0e',  // shadow green — tile depth fringe
    V_GRASS_DRY:   '#8a7040',  // dry/dead grass — yellowish tan

    // ── DIRT PATH (needs warm readable browns) ───────────────
    V_DIRT_BASE:   '#7a5530',  // warm mid brown — path base fill
    V_DIRT_LIGHT:  '#a07848',  // light sandy tan — path stone faces
    V_DIRT_DARK:   '#3a2010',  // deep shadow brown — mortar / grout
    V_DIRT_HI:     '#c8a060',  // bright highlight — sun-lit stone top edge

    // ── STONE / COBBLE ───────────────────────────────────────
    V_STONE_BASE:  '#5a5248',  // mid grey-brown stone — cobble base
    V_STONE_HI:    '#8a7c68',  // lighter warm stone — bevel highlight
    V_STONE_DARK:  '#2a2420',  // deep shadow stone — bevel shadow
    V_STONE_MOSS:  '#3a5828',  // mossy stone overlay colour

    // ── TREE / FOLIAGE ───────────────────────────────────────
    V_TREE_DARK:   '#0e2808',  // darkest canopy shadow
    V_TREE_BASE:   '#1e5010',  // main canopy body
    V_TREE_MID:    '#307818',  // mid canopy / inner volume
    V_TREE_HI:     '#4a9e28',  // bright specular patch top-left of canopy
    V_TREE_BARK:   '#3a1e08',  // trunk bark mid tone
    V_TREE_BARK_HI:'#5a3010',  // trunk highlight stripe

    // ── WATER (needs more readable depth range) ──────────────
    V_WATER_DEEP:  '#0a1828',  // deep water — bottom zone
    V_WATER_MID:   '#1a3850',  // mid water — body
    V_WATER_SURF:  '#2a5878',  // surface water — upper zone
    V_WATER_HI:    '#4a88a8',  // highlight line / shimmer
    V_WATER_FOAM:  '#88b8c8',  // foam / specular glint

    // ── WALL / BUILDING ──────────────────────────────────────
    V_WALL_BASE:   '#4a3e30',  // dark stone wall face
    V_WALL_HI:     '#6a5a48',  // lit stone face / top edge
    V_WALL_DARK:   '#1e1810',  // deep shadow / mortar
    V_WALL_MOSS:   '#2e4a18',  // aged moss stain on wall
});

// ═══════════════════════════════════════════════════════
//  CLASS & COMBAT CONSTANTS
// ═══════════════════════════════════════════════════════
Game.CLASS_STATS = Object.freeze({
    Warrior: { atk:16, def:8,  spd:'Normal' },
    Rogue:   { atk:13, def:5,  spd:'Fast'   },
    Wizard:  { atk:20, def:3,  spd:'Slow'   },
    Cleric:  { atk:11, def:10, spd:'Normal' },
});
Game.CLASS_COLORS = Object.freeze({
    Warrior: PALETTE.CLASS_WARRIOR,
    Rogue:   PALETTE.CLASS_ROGUE,
    Wizard:  PALETTE.CLASS_WIZARD,
    Cleric:  PALETTE.CLASS_CLERIC,
});
Game.CLASS_CLOAK = Object.freeze({
    Warrior: PALETTE.CLOAK_WARRIOR,
    Rogue:   PALETTE.CLOAK_ROGUE,
    Wizard:  PALETTE.CLOAK_WIZARD,
    Cleric:  PALETTE.CLOAK_CLERIC,
});
Game.ENEMY_DMG_FLOOR    = 0.30;
Game.ENEMY_DMG_VARIANCE = 0.15;
Game.ENEMY_MISS_CHANCE  = 0.08;
Game.ENEMY_CRIT_CHANCE  = 0.07;
Game.ENEMY_CRIT_MULT    = 1.50;
Game.DEFEAT_TRANSITION_MS = 600;

// ═══════════════════════════════════════════════════════
//  ENEMY DEFINITIONS
// ═══════════════════════════════════════════════════════
Game.ENEMY_DEFS = {
    shade: {
        name:'Shade', hp:22, atk:8, xp:15,
        speed:1100, aggroRange:7, aggroSpeed:420,
        color:PALETTE.SHADE_BODY, eyeColor:PALETTE.SHADE_EYE,
        desc:'A wraith of living shadow.',
    },
    lurker: {
        name:'Cave Lurker', hp:55, atk:18, xp:35,
        speed:1900, aggroRange:3, aggroSpeed:1000,
        color:PALETTE.LURKER_BODY, eyeColor:PALETTE.LURKER_EYE,
        desc:'A massive stone-skinned predator.',
    },
};

// Biome type constants — stored per-tile in map.biomeData (Uint8Array)
Game.BIOME = Object.freeze({
    VILLAGE:   0,   // sandy warm clearing — village buildings sit here
    GRASSLAND: 1,   // open green grass fields
    DIRT:      2,   // sparse sandy/dry clearings
    FOREST:    3,   // dense tree canopy
});

// ═══════════════════════════════════════════════════════
//  QUEST DEFINITIONS
// ═══════════════════════════════════════════════════════
Game.QUESTS = [
    { id:'find_weapon',     title:'Armed and Ready',
      giver:'guide',        giverName:'Rowan',
      objective:'Find your weapon hidden somewhere in the village.',
      flag_given:'quest_weapon_given', flag_complete:'quest_weapon_complete' },
    { id:'into_the_dark',   title:'Into the Dark',
      giver:'elder',        giverName:'Elder Maren',
      objective:'Descend into the Cursed Mines south of Eldoria.',
      flag_given:'quest_into_dark_given', flag_complete:'quest_into_dark_complete' },
    { id:'brothers_fate',   title:"Brother's Fate",
      giver:'blacksmith',   giverName:'Daran',
      objective:"Find any trace of Henrick in the mines.",
      flag_given:'quest_brothers_fate_given', flag_complete:'quest_brothers_fate_complete' },
    { id:'sealed_truth',    title:'The Sealed Truth',
      giver:'traveler',     giverName:'Veyla',
      objective:'Find the ancient tablet deep in the mines.',
      flag_given:'quest_sealed_truth_given', flag_complete:'quest_sealed_truth_complete' },
];

Game.QUEST_GIVER_FLAGS = {
    guide:       'quest_weapon_given',
    elder:       'quest_into_dark_given',
    blacksmith:  'quest_brothers_fate_given',
    traveler:    'quest_sealed_truth_given',
};

// Items that NPCs can give the player via GIVE_ITEM signal token.
Game.GIVEABLE_ITEMS = {
    health_potion:        { id: 'health_potion',        name: 'Health Potion',        icon: '🧪', color: '#e84040', desc: 'Restores some health.' },
    iron_key:             { id: 'iron_key',             name: 'Iron Key',             icon: '🗝️', color: '#b0b0b0', desc: 'A heavy iron key.' },
    mysterious_component: { id: 'mysterious_component', name: 'Mysterious Component', icon: '🔮', color: '#9060e8', desc: 'Its purpose is unclear.' },
    ancient_coin:         { id: 'ancient_coin',         name: 'Ancient Coin',         icon: '🪙', color: '#e8c050', desc: 'Old beyond reckoning.' },
    elder_token:          { id: 'elder_token',          name: "Elder's Token",        icon: '📿', color: '#80e8a0', desc: 'Grants passage.' },
};

})();
