# The Forgotten Realm

A browser-based AI-powered RPG built with Flask, HTML5 Canvas, and the Groq LLM API.

## Play Now

**[https://cs4880.onrender.com](https://cs4880.onrender.com)**

> First load may take ~30 seconds if the server has been idle.

---

## Running the Game

### 1. Activate the virtual environment

**Windows (PowerShell / Command Prompt):**
```
venv\Scripts\activate
```

**Mac / Linux / Git Bash:**
```
source venv/bin/activate
```

You'll know it's active when you see `(venv)` at the start of your terminal prompt.

### 2. Install dependencies (first time only)

```
pip install -r requirements.txt
```

### 3. Start the server

```
python app.py
```

### 4. Open the game

Open your browser and go to:

```
http://127.0.0.1:5000
```

> This only works on the machine running the server. To access it from another device on the same network, use your local IP (e.g. `http://192.168.x.x:5000`) and make sure your firewall allows port 5000.

---

## Environment Variables

Create a `.env` file in this folder with your Groq API key:

```
GROQ_API_KEY=your_key_here
```

---

## Controls

| Key | Action |
|-----|--------|
| `WASD` / Arrow Keys | Move |
| `E` | Interact / Talk to NPC |
| `Q` | Quest Journal |
| `Tab` | Inventory & Character Screen |
| `Esc` | Pause Menu |
| `Space` | Confirm in battle / Strike timing bar |
| `W` / `S` | Navigate battle menus |

---

## Dependencies

- `flask` — web server
- `groq` — LLM API for NPC dialogue
- `python-dotenv` — loads `.env` for API key
- `edge-tts` — text-to-speech narration