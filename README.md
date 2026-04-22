<div align="center">

![Header](https://capsule-render.vercel.app/api?type=waving&color=0:1a0a2e,50:3d1a6e,100:0a0a1a&height=220&section=header&text=The%20Forgotten%20Realm&fontSize=52&fontColor=c9a84c&fontAlignY=40&desc=A%20Dark%20Fantasy%20RPG%20with%20AI-Powered%20Souls&descAlignY=62&descSize=18&descColor=9b7ebd)

<br/>

[![Play Now](https://img.shields.io/badge/%E2%96%B6%20PLAY%20NOW-Live%20on%20Render-22c55e?style=for-the-badge&logoColor=white)](https://the-forgotten-realm.onrender.com/)
&nbsp;
[![Python](https://img.shields.io/badge/Python-3.10%2B-3776ab?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
&nbsp;
[![Flask](https://img.shields.io/badge/Flask-3.x-000000?style=for-the-badge&logo=flask&logoColor=white)](https://flask.palletsprojects.com)
&nbsp;
[![Groq](https://img.shields.io/badge/Groq-Llama%203.3%2070B-f55036?style=for-the-badge)](https://console.groq.com)
&nbsp;
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20macOS-6b7280?style=for-the-badge)](https://github.com/PriggS/The-Forgotten-Realm)

<br/>

*Every NPC is a living mind. Every conversation is unrepeatable. Every shadow hides something.*

<br/>

[Play Online](#-play-online) · [Quick Start](#-quick-start-windows) · [Features](#-features) · [How It Works](#-how-it-works)

</div>

---

## The Story

> *You arrive in the village of Eldoria with no memory of how you got there — and no weapon.
> A darkness is spreading from the Cursed Mines to the south. Three weeks ago, a group of
> villagers descended into those mines. Only one returned, mad and mute.*

The village needs a hero. The villagers need answers. The mines need *someone brave enough to enter.*

Every conversation you have is generated live by **Llama 3.3 70B** and narrated in real time by **Microsoft edge-tts** — no pre-written lines, no dialogue trees. The NPCs remember your choices, react to your quest progress, and respond in character to anything you say.

---

## Screenshots

> Add screenshots by dropping images into an `assets/` folder and updating the paths below.
> Recommended: capture the village at night, a dialogue exchange, and the battle screen.

<p align="center">
  <img src="assets/screenshot-village.png" alt="Eldoria Village" width="48%" />
  &nbsp;
  <img src="assets/screenshot-dialogue.png" alt="AI NPC Dialogue" width="48%" />
</p>
<p align="center">
  <img src="assets/screenshot-battle.png" alt="Turn-Based Battle" width="48%" />
  &nbsp;
  <img src="assets/screenshot-journal.png" alt="Quest Journal" width="48%" />
</p>

---

## Features

- **AI-Driven NPCs** — four hand-crafted characters each powered by Llama 3.3 70B; every response is generated live, shaped by world state and your quest progress
- **Live Voice Narration** — every NPC line is spoken in real time via Microsoft edge-tts (Christopher Neural, deep voice, custom prosody) — no audio files, zero pre-recording
- **Procedural Pixel Art** — all 13 tile types drawn in code using HTML5 Canvas; noise-based terrain generation, ambient occlusion, autotile blending, grass sway animation, torch flicker, and water shimmer — no sprite sheets
- **Four Questlines** — each NPC carries their own arc woven into live dialogue; quests are signaled by embedded AI tokens, tracked in an in-game journal
- **Turn-Based Battle System** — timing-based strikes, class-specific mechanics, two enemy archetypes with distinct behaviors
- **Hand-Crafted Village Map** — Eldoria with buildings, torchlit streets, forest edges, a river, signs, and the mine entrance looming to the south
- **Character Creation** — choose your name and class (Warrior / Rogue / Wizard / Cleric) before entering the world
- **One-Click Launcher** — `launch.bat` detects Python, creates a venv, installs dependencies, starts the server, and opens the browser automatically
- **Safe Auto-Updater** — `update.bat` creates a timestamped git backup tag before every pull and supports full rollback

---

## The Four Souls of Eldoria

| Character | Role | Personality |
|-----------|------|-------------|
| **Rowan** | Village greeter & guide | Energetic, slightly over-explains things, secretly proud of the village — gives you your first lead |
| **Elder Maren** | Village elder | Formal, grandfatherly, a weight behind every word — asks you to enter the mines |
| **Daran** | Blacksmith | A man of almost no words. His brother Henrick went into the mines three weeks ago and never came back |
| **Veyla** | Elven wanderer | Centuries old, speaks in half-finished metaphors, always testing whether you're worth her time |

---

## Play Online

The game is deployed on Render's free tier — no install required:

**[▶ https://the-forgotten-realm.onrender.com/](https://the-forgotten-realm.onrender.com/)**

> [!NOTE]
> The first load may take **30–60 seconds** if the server has been idle — Render spins down free instances after inactivity. Once it's warm, response times are fast.

---

## Quick Start (Windows)

The launcher handles everything. You only need **Python 3.10+** and a free **Groq API key**.

**Step 1 — Get a free Groq API key**

Sign up at [console.groq.com](https://console.groq.com) — no credit card required.

**Step 2 — Create a `.env` file** in the project root:

```env
GROQ_API_KEY=your_key_here
```

**Step 3 — Double-click `scripts/launch.bat`**

The launcher automatically:
- Detects your Python installation
- Creates a virtual environment on first run
- Installs all dependencies from `requirements.txt`
- Starts the Flask server on port 5000
- Opens `http://127.0.0.1:5000` in your browser

To stop the server: press `Ctrl+C` in the terminal window.

> [!TIP]
> If Python isn't found, the launcher prints the download link. If Git isn't installed, the update check is silently skipped — the game still runs normally.

---

## Manual Setup (All Platforms)

```bash
# Clone the repository
git clone https://github.com/PriggS/The-Forgotten-Realm.git
cd The-Forgotten-Realm

# Create and activate a virtual environment
python -m venv venv

# Windows
venv\Scripts\activate

# macOS / Linux
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Add your API key
echo GROQ_API_KEY=your_key_here > .env

# Start the server
python app.py
```

Open [http://127.0.0.1:5000](http://127.0.0.1:5000) in your browser.

---

## Keeping Up to Date

```bash
# Pull the latest version (creates a timestamped backup tag first)
scripts\update.bat

# Roll back to the previous version if something goes wrong
scripts\update.bat --rollback
```

The updater stashes any local changes, shows exactly what's coming before applying it, and detects dependency changes automatically.

---

## Controls

| Action | Key |
|--------|-----|
| Move | `W A S D` or `↑ ← ↓ →` |
| Interact / Talk to NPC | `E` *(when adjacent)* |
| Read a sign | `E` *(when adjacent)* |
| Quest journal | `Q` |
| Inventory | `Tab` |
| Pause menu | `Esc` |
| Battle — confirm / strike | `Space` |
| Battle — navigate menus | `W` / `S` |

---

## How It Works

### AI Dialogue Pipeline

```
Player presses E near NPC
        │
        ▼
Flask /interact endpoint
        │
        ├─ NPC personality system prompt injected
        ├─ World state (quest flags, location) appended
        └─ Player message sent
        │
        ▼
Groq API → Llama 3.3 70B Versatile (max 120 tokens)
        │
        ├─ QUEST_GIVEN token → activates quest in journal
        ├─ END_CONVERSATION token → closes dialogue
        └─ Tokens stripped before display
        │
        ▼
Flask /narrate endpoint
        │
        └─ edge-tts → ChristopherNeural → audio stream → browser
```

- Up to **4 concurrent LLM calls** (semaphore-limited)
- Up to **3 concurrent TTS streams** (semaphore-limited)
- 10-second LLM timeout · 15-second TTS timeout

### Procedural Rendering Pipeline

Every frame, the game:
1. Samples value noise + FBM to determine biome zones (village, grassland, forest, dirt)
2. Looks up pre-warmed tile variants from the offscreen sprite atlas
3. Applies ambient occlusion strips pre-rendered at map load
4. Blends terrain boundaries with bilateral dithering (autotile system)
5. Animates grass tiles within 7-tile radius of the player (3-frame wind cycle)
6. Composites a warm amber color grade + adaptive vignette as a screen overlay
7. Adds torch glow using screen-blend mode at all torch positions

All tile art is drawn procedurally using Canvas 2D `fillRect` calls — **zero external image assets**.

---

## Tech Stack

<div align="center">

![HTML5](https://img.shields.io/badge/HTML5%20Canvas-E34F26?style=for-the-badge&logo=html5&logoColor=white)
![JavaScript](https://img.shields.io/badge/Vanilla%20JS-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white)
![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)
![Flask](https://img.shields.io/badge/Flask-000000?style=for-the-badge&logo=flask&logoColor=white)
![Groq](https://img.shields.io/badge/Groq%20API-f55036?style=for-the-badge)
![Render](https://img.shields.io/badge/Render-46E3B7?style=for-the-badge&logo=render&logoColor=black)

</div>

| Layer | Technology |
|-------|-----------|
| **Rendering** | HTML5 Canvas 2D · Offscreen canvas sprite atlas · High-DPI (DPR) scaling |
| **Game Logic** | Vanilla JavaScript · Value noise + FBM terrain generation |
| **Visual FX** | Ambient occlusion · Autotile blending · Grass sway animation · Post-processing |
| **Backend** | Python 3.10+ · Flask 3.x · Gunicorn (production) |
| **AI / LLM** | Groq API · Llama 3.3 70B Versatile · Semaphore concurrency control |
| **Voice** | Microsoft edge-tts · ChristopherNeural · Custom SSML prosody |
| **Hosting** | Render.com · Gunicorn multi-worker (`gthread`, 4 threads) |
| **Launcher** | PowerShell 5.1 · Windows Batch (VT100 ANSI color support) |

---

## Project Structure

<details>
<summary>Click to expand</summary>

```
The-Forgotten-Realm/
│
├── app.py                     Flask server — /interact (LLM) and /narrate (TTS) endpoints
├── requirements.txt           Python dependencies (5 packages)
├── Procfile                   Render.com deployment config (gunicorn, 2 workers, 4 threads)
│
├── scripts/
│   ├── launch.bat             One-click Windows launcher (double-click to run)
│   ├── launch.ps1             Launcher logic — Python detection, venv, deps, server start
│   ├── update.bat             One-click updater — pulls latest from GitHub
│   ├── update.ps1             Updater logic — stash, backup tag, pull, rollback support
│   ├── weblauncher.bat        Opens Render-hosted version in browser
│   └── weblauncher.ps1        Web launcher — connectivity check, cold-start notice
│
├── static/
│   ├── js/
│   │   ├── game-noise.js      Value noise + FBM for terrain generation
│   │   ├── event-bus.js       Synchronous pub/sub event bus
│   │   ├── narrator.js        edge-tts streaming TTS via Flask /narrate
│   │   ├── game-constants.js  All tile IDs, colours, movement and battle constants
│   │   ├── world.js           Map data loader/caching shim
│   │   ├── audio.js           Web Audio — ambient, footstep, and battle sounds
│   │   ├── input.js           Key state tracking and keydown routing
│   │   ├── battle.js          Full turn-based battle system (938 lines)
│   │   ├── particles.js       Particle system for ambient effects
│   │   ├── game-ui.js         UI state — dialogue, quests, codex, inventory, pause (976 lines)
│   │   ├── scenes.js          SCENES config — title/transition definitions
│   │   ├── game.js            Player movement, map gen, NPC system, interactions (1749 lines)
│   │   ├── game-loop.js       RAF loop with fixed 60 Hz timestep accumulator
│   │   ├── render.js          Full renderer — tiles, characters, particles, minimap (2753 lines)
│   │   ├── tile-renderer.js   Procedural pixel-art tile drawing — all art in code (1132 lines)
│   │   ├── SpriteRenderer.js  Sprite atlas facade over TileRenderer
│   │   └── visual-quality.js  AO bake, colour grade, torch glow, grass sway (547 lines)
│   └── css/
│       └── style.css          Canvas, menus, dialogue UI, quest journal, battle screen
│
└── templates/
    └── index.html             Game shell — canvas, menus, dialogue, journal, inventory, battle UI
```

</details>

---

## Environment Variables

```env
GROQ_API_KEY=your_key_here    # Required for NPC dialogue (get free at console.groq.com)
```

> [!IMPORTANT]
> Text-to-speech (edge-tts) is **completely offline** — no API key needed. Only NPC dialogue requires the Groq key. The game loads without it, but NPCs will not respond.

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `flask` | Web server and API routing |
| `groq` | Groq LLM client — all NPC dialogue |
| `python-dotenv` | Loads `GROQ_API_KEY` from `.env` |
| `edge-tts` | Offline text-to-speech narration |
| `gunicorn` | Production WSGI server for Render deployment |

---

## Roadmap

- [x] AI-powered NPC dialogue with quest signaling
- [x] Live voice narration (edge-tts streaming)
- [x] Procedural pixel art tile renderer
- [x] Ambient occlusion + autotile blending
- [x] Village map (Eldoria) with four NPCs
- [x] Quest journal with four questlines
- [x] Turn-based battle system
- [x] One-click Windows launcher and auto-updater
- [ ] The Cursed Mines interior map
- [ ] Boss encounter — The Hollow King
- [ ] Inventory and item system
- [ ] Persistent save state
- [ ] Mobile touch controls
- [ ] Additional NPCs and questlines

---

## Contributing

Contributions are welcome — especially for the mines interior, enemy variety, and mobile controls.

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/mines-interior`
3. Make your changes and test locally with `launch.bat`
4. Commit: `git commit -m "feat: add mines interior map"`
5. Push and open a Pull Request

For significant changes, open an issue first to discuss the direction.

---

<div align="center">

![Footer](https://capsule-render.vercel.app/api?type=waving&color=0:0a0a1a,50:1a0a2e,100:3d1a6e&height=140&section=footer&fontColor=c9a84c)

*Built with obsessive attention to detail.*
*Every tile drawn in code. Every voice line generated live. Every NPC with their own story.*

<br/>

**`⚔  Enter Eldoria. The mines are waiting.  ⚔`**

</div>
