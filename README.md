<div align="center">

```
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║          ✦  T H E   F O R G O T T E N   R E A L M  ✦        ║
║                                                              ║
║              A  D A R K  F A N T A S Y  R P G               ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
```

**AI-powered NPC dialogue · Procedural pixel art · Live text-to-speech narration**

<br>

[![Python](https://img.shields.io/badge/Python-3.10%2B-3776ab?style=flat-square&logo=python&logoColor=white)](https://python.org)
[![Flask](https://img.shields.io/badge/Flask-3.x-000000?style=flat-square&logo=flask&logoColor=white)](https://flask.palletsprojects.com)
[![Groq](https://img.shields.io/badge/Groq-Llama%203.3%2070B-f55036?style=flat-square)](https://console.groq.com)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey?style=flat-square)]()
[![Live](https://img.shields.io/badge/▶%20Play%20Now-Live%20on%20Render-22c55e?style=flat-square)](https://the-forgotten-realm.onrender.com/)

<br>

</div>

---

## ◈ The Story

> *You arrive in the village of Eldoria with no memory of how you got there — and no weapon.*
> *A darkness is spreading from the Cursed Mines to the south. Three weeks ago, a group of*
> *villagers descended into those mines. Only one returned, mad and mute.*

The village needs a hero. The villagers need answers. The mines need *someone brave enough to enter.*

Every conversation is generated live by **Llama 3.3 70B** running through the Groq API and narrated in real time by **Microsoft edge-tts** with a deep Christopher Neural voice — no two playthroughs sound quite the same.

---

## ◈ Characters

| Character | Role | Personality |
|-----------|------|-------------|
| **Rowan** | Village greeter & guide | Energetic, over-explains, gives you your first quest |
| **Elder Maren** | Village elder | Formal, grandfatherly, haunted — asks you to enter the mines |
| **Daran** | Blacksmith | Man of almost no words. His brother Henrick never came back |
| **Veyla** | Elven wanderer | Centuries old, speaks in half-finished metaphors, always testing you |

---

## ◈ Features

- ⚔️  **AI NPC Dialogue** — every conversation unique, driven by Llama 3.3 70B via Groq
- 🔊  **Live Narration** — responses voiced in real time via Microsoft edge-tts (Christopher Neural)
- 🎨  **Procedural Pixel Art** — all tiles drawn in code: ambient occlusion, autotile blending, animated grass sway, torch flicker, water shimmer
- 🗺️  **Hand-crafted village map** — Eldoria with buildings, paths, forest, water, and the mine entrance to the south
- 📜  **Quest system** — four questlines woven into NPC dialogue, tracked in an in-game journal
- ⚔️  **Turn-based battle system** — encounter hostile entities as the darkness spreads
- 🎭  **Character creation** — name your hero before entering Eldoria
- 🪟  **One-click launcher** — `launch.bat` sets up Python, venv, dependencies, and opens the browser automatically
- 🔄  **Auto-updater** — `update.bat` pulls the latest version from GitHub with rollback support

---

## ◈ Controls

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

## ◈ Play Online

The game is deployed on Render's free tier:

**[▶ https://the-forgotten-realm.onrender.com/](https://the-forgotten-realm.onrender.com/)**

> **Note:** The first load may take up to 30 seconds if the server has been idle — Render spins down free instances after inactivity. Just wait for it.

---

## ◈ Quick Start (Windows)

The easiest way to run locally. Requires **Python 3.10+** and a **Groq API key** (see below).

**1.** Create a `.env` file in the project root:
```
GROQ_API_KEY=your_key_here
```

**2.** Double-click **`launch.bat`**

That's it. The launcher will:
- Create a Python virtual environment on first run
- Install all dependencies from `requirements.txt`
- Start the Flask server on port 5000
- Open `http://127.0.0.1:5000` in your browser automatically

To stop: press `Ctrl+C` in the terminal window.

> If Python isn't found, the launcher shows an error with the download link.  
> If Git isn't installed, the update check is silently skipped — the game still runs normally.

---

## ◈ Keeping Up to Date

```
update.bat              — pull the latest version from GitHub
update.bat --rollback   — restore a previous version from a backup tag
```

The updater creates a timestamped git tag before every pull so you can always roll back. It handles stashing local changes, detects dependency changes, and shows exactly what's coming before applying anything.

---

## ◈ Manual Setup

If you prefer to configure the environment yourself:

```bash
# 1. Create and activate a virtual environment
python -m venv venv

# Windows
venv\Scripts\activate

# macOS / Linux
source venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Add your API key (see Environment Variables below)

# 4. Start the server
python app.py

# 5. Open http://127.0.0.1:5000
```

---

## ◈ Environment Variables

Create a `.env` file in the project root:

```env
GROQ_API_KEY=your_key_here
```

Get a free key at **[console.groq.com](https://console.groq.com)** — no credit card required.

> The game runs without this key but NPC dialogue will not work. Text-to-speech (edge-tts) is entirely offline and does not need a key.

---

## ◈ Project Structure

```
The-Forgotten-Realm/
│
├── app.py                   Flask server — NPC dialogue API, TTS endpoint
├── requirements.txt         Python dependencies
├── Procfile                 Render.com deployment config
│
├── launch.bat               One-click Windows launcher (double-click to run)
├── launch.ps1               Launcher logic — Python, venv, deps, server
├── update.bat               One-click updater — pulls latest from GitHub
├── update.ps1               Updater logic — stash, backup tag, pull, rollback
│
├── static/
│   ├── js/
│   │   ├── game.js          Main game loop, map, input, battle, UI
│   │   ├── SpriteRenderer.js   Offscreen sprite atlas and tile cache
│   │   ├── tile-renderer.js    Procedural pixel-art tile drawing
│   │   ├── TILE_MANIFEST.js    Tile IDs and sprite atlas definitions
│   │   └── visual-quality.js  Ambient occlusion, autotile blending, animations
│   └── css/
│       └── style.css        Canvas, UI, menu, and dialogue styling
│
└── templates/
    └── index.html           Game shell, menus, canvas, dialogue UI
```

---

## ◈ Dependencies

| Package | Purpose |
|---------|---------|
| `flask` | Web server and API routing |
| `groq` | Groq LLM client — powers all NPC dialogue |
| `python-dotenv` | Loads `GROQ_API_KEY` from `.env` |
| `edge-tts` | Offline text-to-speech narration |
| `gunicorn` | Production WSGI server (Render deployment) |

---

## ◈ Tech Stack

```
Frontend    HTML5 Canvas · Vanilla JS · CSS3
Backend     Python · Flask
AI / LLM    Groq API · Llama 3.3 70B Versatile
Voice       Microsoft edge-tts · Christopher Neural
Hosting     Render (free tier)
Launcher    PowerShell 5.1 · Windows Batch
```

---

<div align="center">

*Built with obsessive attention to detail.*
*Every tile drawn in code. Every voice line generated live. Every NPC with their own story.*

<br>

`⚔  Enter Eldoria. The mines are waiting.  ⚔`

</div>
