# Yuy Bot — Local Setup Guide

**Yuy (ゆい)** is an all-in-one AI Discord bot with chat, music, games, moderation, web search, and more.

---

## Prerequisites (Windows)

Install these before running the bot:

| Tool | Download | Notes |
|------|----------|-------|
| **Node.js 18+** | https://nodejs.org | LTS version recommended |
| **yt-dlp** | https://github.com/yt-dlp/yt-dlp/releases | Add to PATH or place in project folder |
| **ffmpeg** | https://ffmpeg.org/download.html | Add `bin/` to PATH, OR update `FFMPEG_PATH` in `src/modules/music.js` |
| **Git** | https://git-scm.com | Optional, for version control |

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Make sure firebase-key.json is in the root folder
#    (Download from Firebase Console → Project Settings → Service Accounts)

# 3. Register slash commands with Discord (run once)
npm run deploy

# 4. Start the bot
npm start

# Development mode (auto-restarts on file changes)
npm run dev
```

---

## Environment Variables (.env)

All config lives in `.env`. Key settings:

| Variable | Description |
|----------|-------------|
| `DISCORD_TOKEN` | Your bot token from Discord Developer Portal |
| `CLIENT_ID` | Your bot's application ID |
| `GUILD_ID` | (Optional) Server ID for fast command deployment |
| `GROQ_API_KEY` | Groq API key — primary AI provider (free tier available) |
| `GEMINI_API_KEY` | Google Gemini key — image analysis + fallback AI |
| `OPENROUTER_API_KEY` | OpenRouter — secondary AI fallback |
| `ELEVENLABS_API_KEY` | ElevenLabs — text-to-speech |
| `KLIPY_API_KEY` | Klipy — GIFs, memes, stickers |
| `INFO_PASSWORD` | Password for `/info` command (default: `yuy123#`) |
| `BOT_TRIGGER` | Trigger word (default: `yuy`) |

---

## 🔍 Web Search Setup

Web search uses **Python + BeautifulSoup4** — a lightweight scraper with no browser, no API keys, zero Playwright/Chromium.

**Install Python packages once:**
```
pip install requests beautifulsoup4 lxml
```

Make sure `python3` (or `python`) is in your system PATH. That's it.

**How it works (two-stage pipeline):**
1. Fetches search results from DuckDuckGo Lite HTML (fallback: Bing)
2. AI picks the 2-3 most relevant URLs from the results
3. Scrapes those pages with BS4 — strips nav/ads/scripts, extracts clean text
4. AI synthesizes a final answer from the real page content

---

## Music Setup (Windows)

Music requires **yt-dlp** and **ffmpeg**. The bot auto-detects your OS.

On Windows, if ffmpeg isn't in your PATH, edit `src/modules/music.js`:
```js
const FFMPEG_PATH = 'C:\\path\\to\\ffmpeg\\bin\\ffmpeg.exe'; // update this
```

---

## How to Talk to Yuy

| Method | Example |
|--------|---------|
| Trigger word | `yuy what's the weather in Mumbai?` |
| @mention | `@Yuy play something chill` |
| Slash commands | `/help`, `/search`, `/music`, `/info` |

---

## Commands Quick Reference

| Command | Description |
|---------|-------------|
| `/help` | Browse all features with interactive category menu |
| `/search <query>` | Real-time web search with rich embed results |
| `/info password:yuy123#` | Server stats, member counts, bot health (password protected) |
| `/music` | Play music with YouTube autocomplete |
| `/imagine <prompt>` | Generate an AI image |

---

## Project Structure

```
yuy-bot/
├── src/
│   ├── index.js              # Entry point — client setup & loader
│   ├── deploy-commands.js    # Register slash commands with Discord
│   ├── commands/             # Slash command definitions
│   │   ├── help.js           # /help — feature guide
│   │   ├── info.js           # /info — server stats (password protected)
│   │   ├── search.js         # /search — web search
│   │   ├── music.js          # /music — YouTube music player
│   │   ├── imagine.js        # /imagine — AI image generation
│   │   └── ...
│   ├── events/               # Discord event handlers
│   │   ├── messageCreate.js  # Main message handler (trigger: "yuy ...")
│   │   ├── interactionCreate.js  # Slash commands + buttons
│   │   ├── guildMemberAdd.js # Welcome new members
│   │   └── ready.js          # Bot startup
│   ├── modules/              # Feature modules
│   │   ├── aiRouter.js       # AI routing, intent detection, web search
│   │   ├── dispatcher.js     # Route intents to correct module
│   │   ├── music.js          # yt-dlp + ffmpeg music player
│   │   ├── moderation.js     # Kick/ban/mute/clear
│   │   ├── games.js          # Trivia, memory game, etc.
│   │   ├── economy.js        # XP, coins, shop
│   │   ├── profile.js        # User profiles, rank cards
│   │   ├── imageGen.js       # AI image generation
│   │   ├── media.js          # GIFs, memes, stickers (Klipy)
│   │   ├── tts.js            # Text-to-speech (ElevenLabs)
│   │   ├── utility.js        # Polls, reminders, server info
│   │   ├── statusLogger.js   # Live status channel updates
│   │   └── watchTogether.js  # Watch Together in VC
│   └── utils/
│       ├── firebase.js       # Firestore database helpers
│       ├── logger.js         # Colorized console logger
│       ├── cooldown.js       # Per-user rate limiting
│       └── permissions.js    # Permission tier system
├── firebase-key.json         # 🔒 NOT in git — download from Firebase Console
├── .env                      # 🔒 NOT in git — your secrets
└── package.json
```

---

## Firebase Collections

| Collection | Contents |
|------------|----------|
| `users/` | XP, coins, level, badges, AI model preference |
| `servers/` | Default model, channel IDs, custom personality |
| `history/` | Per-channel conversation history |
| `messages/` | Full message metadata: intent, emotion, model used |
| `audit_logs/` | Moderation action log |
