# The Forgotten Realm

A browser-based dark fantasy RPG with AI-powered NPC dialogue, procedural pixel-art rendering,
and text-to-speech narration. Built with Flask, HTML5 Canvas, and the Groq LLM API.

---

## Play Now

Join the game online at:

https://the-forgotten-realm.onrender.com/

Note: The first load may take up to 30 seconds if the server has been idle on Render's free tier.

---

## Run Locally with launch.bat

The easiest way to run the game on your own machine is the included launcher script.

Requirements before running:
- Python 3.10 or newer must be installed and on your PATH (https://python.org)
- A Groq API key stored in a .env file (see Environment Variables section below)

Steps:

1. Create a .env file in the project folder containing your Groq API key (see below).
2. Double-click launch.bat, or run it from a terminal.
3. The script will automatically:
   - Pull the latest code from GitHub if Git is available
   - Create a Python virtual environment on the first run
   - Install all dependencies from requirements.txt
   - Start the Flask server
   - Open http://127.0.0.1:5000 in your default browser
4. To stop the server, press Ctrl+C in the terminal window that opened.

If Python is not found, the launcher will display an error with a download link.
If Git is not installed, the update check is skipped and the game still runs normally.

---

## Manual Setup

If you prefer to set up the environment yourself:

1. Create and activate a virtual environment

   Windows:
   ```
   python -m venv venv
   venv\Scripts\activate
   ```

   Mac or Linux:
   ```
   python -m venv venv
   source venv/bin/activate
   ```

2. Install dependencies
   ```
   pip install -r requirements.txt
   ```

3. Create a .env file with your API key (see below)

4. Start the server
   ```
   python app.py
   ```

5. Open your browser and go to http://127.0.0.1:5000

---

## Environment Variables

Create a file named .env in the root of the project with the following content:

```
GROQ_API_KEY=your_key_here
```

You can get a free Groq API key at https://console.groq.com

The game will not be able to generate NPC dialogue without this key. Text-to-speech (edge-tts)
does not require an API key and works offline.

---

## Controls

Move                    WASD or Arrow Keys
Interact / Talk to NPC  E (when standing next to an NPC or sign)
Quest Journal           Q
Inventory               Tab
Pause Menu              Esc
Battle confirm / Strike Space
Navigate battle menus   W and S

---

## The Story

You arrive in the village of Eldoria with no memory of how you got there and no weapon.
A darkness is spreading from the Cursed Mines to the south. Three weeks ago a group of
villagers entered the mines and only one returned, mad and mute.

Talk to the villagers to learn what happened and prepare yourself before descending:

- Rowan - the village greeter who will get you oriented and help you find your missing weapon
- Elder Maren - the village elder who needs someone brave enough to investigate the mines
- Daran - the blacksmith, a man of few words whose brother Henrick went into the mines and
  never came back
- Veyla - an elven traveler who knows more about what is sealed in the mines than she lets on

Every NPC conversation is generated live by the Llama 3.3 70B language model via Groq.
Responses are narrated using Microsoft edge-tts with a deep Christopher Neural voice.

---

## Project Structure

```
app.py              Flask server, NPC dialogue API, text-to-speech endpoint
launch.bat          One-click Windows launcher
requirements.txt    Python dependencies
static/
  game.js           Main game loop, tile rendering, map generation, input handling
  SpriteRenderer.js Offscreen sprite atlas and tile cache system
  tile-renderer.js  Procedural pixel-art tile drawing primitives
  TILE_MANIFEST.js  Tile ID and sprite atlas definitions
  visual-quality.js Ambient occlusion and autotile edge blending
  style.css         UI and canvas styling
templates/
  index.html        Game shell and HTML canvas
```

---

## Dependencies

- flask - web server and API routing
- groq - Groq LLM API client for NPC dialogue (Llama 3.3 70B)
- python-dotenv - loads the .env file for the API key
- edge-tts - offline text-to-speech narration
- gunicorn - production WSGI server (used on Render)
