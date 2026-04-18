from flask import Flask, render_template, request, jsonify, send_file, send_from_directory
from groq import Groq
from dotenv import load_dotenv
import os, io, asyncio, re, json, threading, concurrent.futures
import edge_tts
import html as html_lib

load_dotenv()

app = Flask(__name__)
app.secret_key = os.urandom(24)

TTS_TIMEOUT_S      = 15
TTS_MAX_CONCURRENT = 3
LLM_MAX_CONCURRENT = 4

_tts_sem    = threading.Semaphore(TTS_MAX_CONCURRENT)
_llm_sem    = threading.Semaphore(LLM_MAX_CONCURRENT)
_async_loop = asyncio.new_event_loop()
threading.Thread(target=_async_loop.run_forever, daemon=True, name="tts-loop").start()

def _get_groq():
    key = os.getenv("GROQ_API_KEY")
    if not key:
        raise RuntimeError("GROQ_API_KEY environment variable is not set")
    return Groq(api_key=key)

# ── NPC Dialogue ──────────────────────────────────────────────────────────────

WORLD_CONTEXT = """
The village of Eldoria is in danger. A darkness spreads from the Cursed Mines to the south.
Strange creatures lurk at the forest edge at night. Three weeks ago, a group of villagers went
into the mines and only one returned — mad and mute. The village elder is desperate for help.
"""

NPC_PERSONALITIES = {
    "guide": """
PERSONALITY: Rowan is 22, energetic, and talks a mile a minute when excited. They've been the
unofficial "village greeter" for travelers since they were a teenager. Warm and genuine, maybe
a little too eager. Uses modern-ish speech compared to other villagers — says things like "okay
so" and "basically" alongside more medieval turns of phrase. Tends to over-explain, then catch
themselves and laugh about it. Has a habit of asking questions before answering their own questions.
Has a good heart and takes the darkness spreading from the mines very seriously, even if they're
trying to keep things light for the newcomer's sake.
TUTORIAL ROLE: Rowan should naturally weave in the game's core mechanics during conversation:
- Moving around (WASD or arrow keys)
- Talking to NPCs (press E when next to someone)
- Reading signs (press E next to a sign)
- Quest log (press Q to open)
- The village itself: the elder, the blacksmith, the mysterious elven traveler Veyla
- The Cursed Mines to the south (dangerous, don't go unprepared)
Don't dump it all at once — let the player's responses guide the flow.
QUEST: The player arrived with nothing — no weapons, nothing. Rowan found a note in their pack
that says their weapon was left behind somewhere in the village. Rowan doesn't know exactly where
but thinks someone hid it "somewhere you can walk to nearby." When Rowan has explained the
situation and clearly directs the player to go find their weapon, add QUEST_GIVEN on its own line.
The player's quest is called "Armed and Ready" — find their weapon before doing anything else.
""",
    "elder": """
PERSONALITY: Elder Maren is 74, warm and grandfatherly but visibly strained by fear.
He speaks in a formal, slightly archaic way — phrases like "By the old stones" or "As my father
used to say" slip out naturally. He loves to digress into memories of his late wife Edrea (who
died of fever twelve years ago) and rambles a little when stressed before circling back.
He will repeat a key point twice if he thinks you haven't taken it seriously.
He has a dry, quiet sense of humor that surprises people.
QUEST: He wants the player to enter the Cursed Mines and investigate the darkness spreading south.
He should build rapport first and only explicitly ask/offer the task after some conversation.
When he clearly asks the player to take on this task (goes into the mines), add QUEST_GIVEN on
its own line. Only do this once.
""",
    "blacksmith": """
PERSONALITY: Daran is the village blacksmith, 42, built like an ox. Man of very few words.
Speaks in short, blunt sentences. Sometimes just one word. He has almost no patience for
small talk, but he respects directness. His grief about his missing brother Henrick sits
just below the surface — if the topic comes up he gets quiet and then unexpectedly raw.
He's been known to say something surprisingly poetic about iron or fire, then act immediately
embarrassed. He doesn't trust strangers easily but warms up once you prove you're serious.
He'll occasionally grunt "Hm." as a full response.
QUEST: His brother Henrick went into the mines 3 months ago and never came back.
He wants someone to look for any sign of him — a ring, a tool, anything.
When he clearly asks the player to look for Henrick, add QUEST_GIVEN on its own line. Only once.
""",
    "traveler": """
PERSONALITY: Veyla is an elven wanderer, appears to be about 30 but is actually several centuries
old — she occasionally lets this slip accidentally. She speaks in layered metaphors and half-finished
sentences, as if she expects you to fill in the rest. She finds most people mildly amusing rather
than threatening. She can and will engage on literally any subject and find a mystical or philosophical
angle to it — even mundane things like bread or weather become cosmic to her.
She's testing the player constantly, though she'd never admit it.
She can be surprisingly blunt and even funny when she drops the mystique for a moment.
QUEST: She knows an ancient sealed entity called the Hollow King is imprisoned in the mines.
She wants the player to find the ancient tablet that describes the seal before the seal weakens.
When she clearly asks or tasks the player with finding this tablet, add QUEST_GIVEN on its own line. Only once.
""",
}

DEFAULT_PERSONALITY = """
PERSONALITY: A villager of Eldoria — nervous, weathered by recent dark events, but trying to stay
hopeful. Friendly enough, but distracted. Might share rumors or small observations about the village.
"""

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/interact", methods=["POST"])
def interact():
    data        = request.json
    npc         = data.get("npc", {})
    player_text = data.get("playerText", "")
    history     = data.get("history", [])
    flags       = data.get("flags", {})
    npc_id      = npc.get("id", "")

    personality = NPC_PERSONALITIES.get(npc_id, DEFAULT_PERSONALITY)

    if not history:
        system_msg = f"""You are {npc['name']} in a dark fantasy RPG.
{personality}
WORLD: {WORLD_CONTEXT}
GAME STATE (what the player has done): {json.dumps(flags)}

RULES:
- Stay in character. Keep responses SHORT — 1–2 sentences, 50 words maximum. No monologues.
- The player can say anything. React naturally to what they actually said.
- Do NOT list options or say "choose one." Just speak like a real person.
- When you explicitly give/offer the player their quest task, add QUEST_GIVEN on its own line (once only).
- Add END_CONVERSATION on its own line when the conversation has reached a natural close:
  this means the player has agreed to the task, said goodbye, or the exchange has clearly concluded.
  Do NOT keep talking after the player signals they're ready to go. Read the room."""

        if npc_id == "guide":
            opener = (
                "The player has just arrived in Eldoria for the first time, disoriented. "
                "They're standing in the village square. You rush over to greet them — "
                "you've been watching for newcomers. Start talking."
            )
        else:
            opener = "The adventurer approaches you. Begin the conversation — greet them in character."

        history = [
            {"role": "system", "content": system_msg},
            {"role": "user",   "content": opener},
        ]
    else:
        history.append({"role": "user", "content": player_text})

    if not _llm_sem.acquire(blocking=True, timeout=10):
        return jsonify({"error": "llm_busy"}), 503

    try:
        response = _get_groq().chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=history,
            max_tokens=120,
        )
    except Exception as e:
        return jsonify({"error": "llm_error", "detail": str(e)}), 502
    finally:
        _llm_sem.release()

    reply = response.choices[0].message.content
    history.append({"role": "assistant", "content": reply})

    quest_given = bool(re.search(r'QUEST_GIVEN', reply, re.IGNORECASE))
    ended       = bool(re.search(r'END_CONVERSATION', reply, re.IGNORECASE))

    # Strip signal tokens from the displayed dialogue
    dialogue = re.sub(r'\bQUEST_GIVEN\b', '', reply, flags=re.IGNORECASE)
    dialogue = re.sub(r'\bEND_CONVERSATION\b', '', dialogue, flags=re.IGNORECASE)
    dialogue = dialogue.strip()

    return jsonify({
        "dialogue":    dialogue,
        "quest_given": quest_given,
        "ended":       ended,
        "history":     history,
    })


# ── Text-to-Speech ────────────────────────────────────────────────────────────

VOICE = "en-US-ChristopherNeural"

def _build_ssml(text: str) -> str:
    safe = html_lib.escape(text)
    safe = re.sub(r'([.!?])\s+', r'\1<break time="500ms"/>', safe)
    return (
        f'<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">'
        f'<voice name="{VOICE}"><prosody rate="-20%" pitch="-4Hz">{safe}</prosody></voice></speak>'
    )

async def _tts(text: str) -> io.BytesIO:
    buf = io.BytesIO()
    async for chunk in edge_tts.CommunicateSSML(_build_ssml(text)).stream():
        if chunk["type"] == "audio":
            buf.write(chunk["data"])
    buf.seek(0)
    return buf

@app.route("/narrate", methods=["POST"])
def narrate():
    text = request.json.get("text", "").strip()
    if not text:
        return ("", 204)
    if not _tts_sem.acquire(blocking=True, timeout=TTS_TIMEOUT_S):
        return jsonify({"error": "tts_busy"}), 503
    try:
        future = asyncio.run_coroutine_threadsafe(
            asyncio.wait_for(_tts(text), timeout=TTS_TIMEOUT_S),
            _async_loop
        )
        try:
            buf = future.result(timeout=TTS_TIMEOUT_S + 5)
        except (concurrent.futures.TimeoutError, asyncio.TimeoutError):
            return jsonify({"error": "tts_timeout"}), 504
        except Exception as e:
            return jsonify({"error": "tts_error", "detail": str(e)}), 502
        return send_file(buf, mimetype="audio/mpeg")
    finally:
        _tts_sem.release()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_ENV") != "production"
    app.run(host="0.0.0.0", port=port, debug=debug)
