# Yuy Bot — Update Changelog

## New Features

---

### 1. 🎙️ ElevenLabs Voice Messages

Yuy now sends real voice messages during **extreme emotional moments** — when she's overwhelmed with joy, deeply shocked, flustered, or moved. This is intentionally rare and reserved for peak moments only.

**How it works:**
- The AI decides when to include a `voice_message` in its JSON response
- When present, the ElevenLabs API generates a short MP3 clip
- It's sent as a Discord audio file right after the text reply
- Audio is **hard-capped at ~10 seconds** (130 character limit on text input)

**When Yuy uses voice:**
- Someone confesses feelings to her → she responds with a flustered voice clip
- A deeply heartwarming/touching moment
- Being suddenly shocked or surprised
- Overwhelming happiness she can't contain in text

**When she does NOT use voice:**
- Normal chat, commands, searches, GIFs, music, etc.
- Mild reactions (she uses kaomoji instead)

**Setup:**
```env
ELEVENLABS_API_KEY=sk_...
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM   # optional, defaults to "Rachel"
```

Browse voice options at https://elevenlabs.io/voice-library

**File:** `src/modules/elevenLabs.js` (new)

---

### 2. 💬 Multi-Turn Messaging

Yuy can now send her reply in **multiple messages with natural delays** — just like a real person who has multiple thoughts, or pauses dramatically mid-sentence.

**How it works:**
- The AI returns a `messages` array alongside the main `reply`
- Each entry has `text` and `delay_ms` (300–3000ms, clamped for safety)
- Before each follow-up, Yuy triggers `sendTyping()` so it looks completely natural

**Example AI output:**
```json
{
  "action": "chat",
  "reply": "w-wait, you really said that?! >///<",
  "messages": [
    { "text": "that's... that's so sudden ne~", "delay_ms": 1200 },
    { "text": "ehe~ s-stop making me feel things (≧///≦)", "delay_ms": 900 }
  ]
}
```

**File:** `src/modules/dispatcher.js` (updated — `case 'chat'`)

---

### 3. ⌨️ Proper Slash Command Fields + Real-Time Autocomplete

All slash commands now have **meaningful, separate input fields** with appropriate dropdowns and real-time autocomplete — no more typing raw strings and hoping for the right format.

#### `/search` — upgraded
| Field | Type | Notes |
|---|---|---|
| `query` | text + **autocomplete** | Real-time DuckDuckGo suggestions as you type |
| `category` | dropdown | General / News / Wikipedia / Videos / Shopping / Academic |
| `language` | dropdown | English / Japanese / German / French / Spanish / Hindi / Korean / Chinese |
| `depth` | dropdown | ⚡ Quick (snippets only) or 🔍 Thorough (full page scrape) |

#### `/remind` — upgraded
| Field | Type | Notes |
|---|---|---|
| `amount` | integer (1–999) | The number |
| `unit` | dropdown | Seconds / Minutes / Hours / Days |
| `message` | text + **autocomplete** | Common reminder templates (Check emails, Drink water, etc.) |
| `private` | boolean | DM or channel delivery |

Also shows a Discord `<t:unix:R>` relative timestamp for when the reminder fires, and sends a rich embed when it triggers.

#### `/imagine` — upgraded
| Field | Type | Notes |
|---|---|---|
| `prompt` | text + **autocomplete** | 25 curated prompt starters (anime, cyberpunk, cozy cafe, etc.) |
| `style` | dropdown | 12 art styles (same as before) |
| `ratio` | dropdown | 5 aspect ratios (same as before) |
| `count` | integer 1–4 | Variations |
| `model` | dropdown | From IMAGE_MODELS |
| `enhance` | boolean | Auto-enhance prompt |
| `private` | boolean | Ephemeral reply (only you see it) |

#### `/poll` — upgraded
| Field | Type | Notes |
|---|---|---|
| `question` | text + **autocomplete** | Common poll templates |
| `option1–4` | text | Options 1 and 2 required, 3–4 optional |
| `duration` | dropdown | 5min / 30min / 1hr / 6hr / 24hr / Permanent |

Auto-closes when duration expires and **posts the final vote tally** with a winner crown 🏆.

#### `/8ball` — upgraded
| Field | Type | Notes |
|---|---|---|
| `question` | text + **autocomplete** | Common question starters |
| `shakes` | dropdown | 1 / 2 / 3 — more shakes = dramatic suspense animation |
| `private` | boolean | Only you see the answer |

#### `/avatar` — upgraded
| Field | Type | Notes |
|---|---|---|
| `user` | user picker | (existing) |
| `type` | dropdown | Avatar / Banner / Server Avatar |
| `format` | dropdown | PNG / JPG / WebP / GIF |
| `size` | dropdown | 128 / 256 / 512 / 1024 / 4096 |

Shows all size and format download links in the embed.

#### `/truth-or-dare` — upgraded
| Field | Type | Notes |
|---|---|---|
| `mode` | dropdown | 🙊 Truth / 😈 Dare / 🎲 Random (optional — still has buttons if omitted) |
| `target` | user picker | Challenge a specific person |
| `spice` | dropdown | 😇 Mild / 🌶️ Normal / 🔥 Spicy |
| `rounds` | integer 1–5 | Auto-continues through rounds with next-round buttons |

#### `/coinflip` — upgraded
| Field | Type | Notes |
|---|---|---|
| `guess` | dropdown | 👑 Heads / 🔵 Tails |
| `flips` | integer 1–10 | Flip multiple coins at once, shows all results |
| `private` | boolean | Only you see it |

---

## Files Changed

| File | Change |
|---|---|
| `src/modules/elevenLabs.js` | **NEW** — ElevenLabs voice message module |
| `src/modules/dispatcher.js` | Updated `chat` case: multi-turn messages + ElevenLabs dispatch |
| `src/modules/aiRouter.js` | Updated system prompt: `voice_message`, `messages[]`, instructions |
| `src/commands/search.js` | Proper fields + DDG autocomplete |
| `src/commands/remind.js` | Split amount/unit fields + rich embed reminders |
| `src/commands/imagine.js` | Prompt autocomplete + private option |
| `src/commands/poll.js` | Duration dropdown + auto-close with results |
| `src/commands/8ball.js` | Shakes + autocomplete + private option |
| `src/commands/avatar.js` | Format + size dropdowns |
| `src/commands/truth-or-dare.js` | Mode/spice/rounds fields + multi-round flow |
| `src/commands/coinflip.js` | Multi-flip + private option |
| `src/commands/help.js` | Updated to document new features |
| `.env.example` | Added `ELEVENLABS_VOICE_ID` |

## Setup After Update

1. `npm install` (no new packages needed)
2. Add to `.env` if you want voice messages:
   ```
   ELEVENLABS_API_KEY=sk_...
   ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
   ```
3. Re-deploy slash commands: `node src/deploy-commands.js`
4. Restart the bot
