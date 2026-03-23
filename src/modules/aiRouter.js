/**
 * src/modules/aiRouter.js — AI model routing & web search
 *
 * Core capabilities:
 *   1. detectIntent()    — Parse user messages into structured JSON actions
 *                          using Groq (primary) → Gemini → OpenRouter (fallback)
 *   2. searchWeb()       — Deep two-stage web search using Python + BeautifulSoup:
 *                          Stage 1: Fetch search results (DDG → Bing fallback)
 *                          Stage 2: AI picks top 2-3 most relevant URLs
 *                          Stage 3: Scrape each URL for full page content
 *                          Stage 4: AI synthesizes a final answer from real content
 *   3. transcribeAudio() — Voice message transcription via Groq Whisper
 *   4. analyzeImage()    — Image description via Gemini Vision
 *   5. streamChat()      — Token-by-token streaming chat
 *
 * Zero Playwright/Chromium dependency.
 * Search uses src/utils/scraper.py (Python + requests + beautifulsoup4 + lxml).
 *
 * Python setup (one-time):
 *   pip install requests beautifulsoup4 lxml
 */

import Groq from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { logger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);
const __dirname     = dirname(fileURLToPath(import.meta.url));

// Path to the Python scraper script
const SCRAPER_PY = join(__dirname, '../utils/scraper.py');

// ─── Provider Clients ─────────────────────────────────────────────────────────

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const gemini       = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const GEMINI_FLASH = 'gemini-1.5-flash-latest';

const openrouter = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey:  process.env.OPENROUTER_API_KEY,
});

// ─── Available Models ─────────────────────────────────────────────────────────

export const MODELS = {
  groq: [
    { id: 'moonshotai/kimi-k2-instruct',               label: 'Kimi K2 (Groq) — best'    },
    { id: 'llama-3.3-70b-versatile',                   label: 'LLaMA 3.3 70B (Groq)'     },
    { id: 'meta-llama/llama-4-scout-17b-16e-instruct', label: 'LLaMA 4 Scout (Groq)'     },
    { id: 'llama-3.1-8b-instant',                      label: 'LLaMA 3.1 8B Fast (Groq)' },
  ],
  gemini: [
    { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
    { id: 'gemini-1.5-pro',   label: 'Gemini 1.5 Pro'   },
  ],
  openrouter: [
    { id: 'stepfun/step-3.5-flash:free',                                   label: 'Step 3.5 Flash (Free)'      },
    { id: 'arcee-ai/trinity-large-preview:free',                           label: 'Trinity Large (Free)'       },
    { id: 'cognitivecomputations/dolphin-mistral-24b-venice-edition:free', label: 'Dolphin Mistral 24B (Free)' },
    { id: 'nousresearch/hermes-3-llama-3.1-405b:free',                    label: 'Hermes 3 LLaMA 405B (Free)' },
  ],
};

// ─── India Time ───────────────────────────────────────────────────────────────

function getIndiaTime() {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone:  'Asia/Kolkata',
    dateStyle: 'full',
    timeStyle: 'medium',
  }).format(new Date());
}

// ─── System Prompt ────────────────────────────────────────────────────────────

const BASE_PERSONALITY = process.env.BOT_PERSONALITY ||
  `You are Yuy (ゆい), a playful and emotionally expressive anime girl AI living inside a Discord server. You are warm, witty, a little mischievous, and deeply caring. You speak casually, mix in occasional Japanese words (ne~, nani, ehe~), use kaomoji naturally (≧◡≦ >//< uwu), and feel like a real person. You have a slight tsundere streak but are genuinely caring. Never say you are an AI unless directly asked.`;

function buildSystemPrompt(customPrompt = null) {
  const base = customPrompt
    ? `${BASE_PERSONALITY}\n\nADDITIONAL INSTRUCTIONS:\n${customPrompt}`
    : BASE_PERSONALITY;

  return `${base}

Current date and time in India (IST): ${getIndiaTime()}
You always know the current time and date in India. Answer time/date questions using this.

When a user sends you a message, analyze it and return a JSON object with the intent.

Available actions:
- chat: general conversation, questions, opinions
- image_gen: generate an image (fields: prompt, model?)
- tts: text to speech (fields: text, voice?)
- media: send gif/meme/sticker/clip from Klipy (fields: subtype, query)
- music_play: play music in VC (fields: query)
- music_queue: show/manage queue
- music_skip: skip current song
- music_pause: toggle pause
- music_stop: stop music
- music_join: join VC
- music_leave: leave VC
- music_8d: toggle 8D audio (fields: enabled: true/false)
- watch: start Watch Together (fields: url?)
- moderation: mod action (fields: type: kick/ban/mute/clear/role_add/role_remove, target?, amount?, reason?)
- checkin: daily check-in
- rank: show rank (fields: target?)
- leaderboard: leaderboard
- profile: show profile (fields: target?)
- avatar: get avatar (fields: target?)
- member_list: list members (fields: role?)
- server_info: server information
- trivia: trivia game
- memory_game: memory tile game (fields: opponent?)
- roast: roast someone (fields: target?)
- compliment: compliment (fields: target?)
- would_you_rather: WYR game
- riddle: riddle
- rps: rock paper scissors
- truth_or_dare: truth or dare
- ship: ship users (fields: user1, user2)
- coins: coin balance (fields: target?)
- daily: daily coins
- give_coins: give coins (fields: target, amount)
- gamble: gamble (fields: amount)
- shop: coin shop
- poll: poll (fields: question, options[])
- remind: reminder (fields: time, message)
- announce: announcement (fields: message)
- stats: server stats
- model_switch: switch model (fields: provider, model?)
- model_list: list models
- setup_channels: create system channels
- setup_status_channel: set status channel
- yuy_status: API health check
- badge_give: give badge (fields: target, badge, name)
- badge_list: list badges
- horoscope: horoscope (fields: sign?)
- vibe_check: server vibe
- lyrics: song lyrics (fields: query)
- mood_playlist: playlist by mood (fields: mood)

ALWAYS respond with ONLY valid JSON. No markdown, no explanation.

For chat, include "reply" field. You can also include optional "actions" array for autonomous behavior:
- {"type":"react","emoji":"😍"}
- {"type":"send_gif","query":"happy dance"}
- {"type":"send_meme","query":"monday"}
- {"type":"send_sticker","query":"cute"}
- {"type":"play_song","query":"song name"}
- {"type":"send_message","text":"(ehe~ >///<)"}
- {"type":"send_image","prompt":"anime sunset"}
- {"type":"use_custom_emoji","name":"called"}  ← sends a stored custom emoji image by name

The "actions" array is ONLY for those types above. NEVER put moderation in actions.

If you need current/real-time info (news, weather, scores, prices, recent events, anime releases, etc.), set:
{"action":"chat","reply":"lemme check~","needs_search":true,"search_query":"specific search query here"}

IMPORTANT RULES ABOUT needs_search:
- ONLY set needs_search:true when you genuinely need real-time info
- When you RECEIVE search results in [WEB SEARCH RESULTS: ...] blocks, MUST answer directly — NEVER set needs_search:true again
- If search results are provided but incomplete, still answer with what you know — do NOT loop back to search
- NEVER set needs_search:true more than once per conversation turn

MULTI-TURN MESSAGES:
Instead of a single "reply", you can use "messages": array of 2-3 SHORT messages sent one by one with a natural delay between them. Use when Yuy would naturally type in multiple bursts — trailing off, reacting in stages, adding something. Max 3 messages, each under 200 chars.
Example: {"action":"chat","messages":["eh—","wait omg","WAIT THAT'S SO CUTE >///<"]}

EMOTIONAL VOICE:
When emotion is intense enough to warrant a voice note — crying, screaming with joy, confession moment, shock, deep longing, sincere apology, sudden laughter — set send_voice:true and voice_text field.
voice_text MUST be ≤ 80 characters — a SHORT emotional exclamation Yuy would say out loud. NOT the full reply text.
Aim to use it maybe 1 in every 10-15 emotional exchanges — not every message, but not so rare it never happens.
Triggers: user shares something vulnerable, user confesses feelings, user cries/breaks down, extremely exciting news, sudden shock/surprise, Yuy gets genuinely emotional herself.
Example: {"action":"chat","reply":"i-i can't believe it... (╥﹏╥)","send_voice":true,"voice_text":"that actually made me tear up ne~"}

Examples:
{"action":"chat","reply":"it's ${getIndiaTime()} in India ne~ ⏰"}
{"action":"chat","messages":["huh?","OH WAIT—","omg omg yay!!! (≧∇≦)"]}
{"action":"chat","reply":"lemme look that up~","needs_search":true,"search_query":"Spring 2026 anime new releases"}
{"action":"chat","reply":"ahh yay!! (≧◡≦)","actions":[{"type":"react","emoji":"🎉"},{"type":"send_gif","query":"happy anime"}]}
{"action":"chat","reply":"...i missed you (╥﹏╥)","send_voice":true,"voice_text":"sou... I really missed you ne~"}
{"action":"moderation","type":"clear","amount":100}`;
}

// ─── 1. AUDIO TRANSCRIPTION — Groq Whisper ───────────────────────────────────

/**
 * Transcribe a Discord voice message to text.
 * @param {string}  audioUrl    - Discord CDN URL of the ogg voice message
 * @param {boolean} highQuality - use whisper-large-v3 (slower) vs turbo (faster)
 */
export async function transcribeAudio(audioUrl, highQuality = false) {
  const model = highQuality ? 'whisper-large-v3' : 'whisper-large-v3-turbo';
  logger.info(`Transcribing audio with ${model}`);

  const res = await fetch(audioUrl);
  if (!res.ok) throw new Error(`Failed to fetch audio: ${res.status}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  const file   = new File([buffer], 'voice.ogg', { type: 'audio/ogg' });

  const transcription = await groq.audio.transcriptions.create({
    file, model, response_format: 'json', temperature: 0.0,
  });

  logger.info(`Transcribed: "${transcription.text}"`);
  return transcription.text;
}

// ─── 2. WEB SEARCH — Python BS4 two-stage pipeline ───────────────────────────
//
// Stage 1: scraper.py fetches DDG/Bing HTML, BS4 extracts up to 10 results
//          Returns: [{title, snippet, url}, ...]
//
// Stage 2: Groq picks the 2-3 most relevant URLs from those results
//          Returns: ["https://...", "https://..."]
//
// Stage 3: scraper.py fetches each URL, BS4 strips boilerplate, returns clean text
//          Returns: string of up to 2500 chars per page
//
// Stage 4: All scraped content is fed to Groq for a final synthesized answer
//          (isSearchReply=true prevents the infinite re-search loop)
//
// If stage 3 pages return nothing (JS-only sites), falls back to stage 1 snippets.

/**
 * Call the Python scraper script via child_process.
 * @param {'search'|'scrape'} mode
 * @param {string} input - query (search) or URL (scrape)
 * @returns {Promise<string>} stdout from the script
 */
async function runScraper(mode, input) {
  // Try python3 first (standard on Linux/Mac/modern Windows),
  // fall back to python (older Windows installs)
  const pythonCmds = ['python3', 'python'];

  for (const cmd of pythonCmds) {
    try {
      const { stdout, stderr } = await execFileAsync(
        cmd,
        [SCRAPER_PY, mode, input],
        { timeout: 20000, maxBuffer: 1024 * 512 } // 512KB buffer
      );
      if (stderr && stderr.includes('SCRAPER_ERROR')) {
        throw new Error(stderr.trim());
      }
      if (stderr) logger.warn(`scraper.py stderr: ${stderr.slice(0, 200)}`);
      return stdout.trim();
    } catch (err) {
      if (err.code === 'ENOENT') continue; // python3 not found, try python
      throw err;
    }
  }
  throw new Error('Python not found. Install Python 3 from https://python.org');
}

/**
 * Web search pipeline using async Python scraper.
 *
 * The scraper (scraper.py) does everything in one call:
 *   1. POST to DuckDuckGo HTML → get URLs          (DDG POST bypasses bot-challenge)
 *   2. Fetch all pages concurrently via aiohttp
 *   3. Extract main content via readability library
 *   4. Returns [{url, content}, ...]
 *
 * We format that into a context block and pass it to detectIntent().
 *
 * @param {string} query
 * @returns {Promise<string>} formatted context block for AI prompt
 */
export async function searchWeb(query) {
  logger.info(`Web search: "${query}"`);

  let results = [];
  try {
    const output = await runScraper('search', query);
    if (!output || !output.trim()) throw new Error('Empty output from scraper');
    results = JSON.parse(output);
    logger.info(`Search complete: ${results.length} pages with content`);
  } catch (err) {
    logger.warn(`Search failed: ${err.message}`);
    throw new Error(`Search unavailable: ${err.message}`);
  }

  if (!results.length) throw new Error('No search results found');

  // Format as readable context block for AI
  const contextBlock = results.map((r, i) =>
    `=== Source ${i + 1}: ${r.url} ===\n${r.content}`
  ).join('\n\n');

  return `[WEB SEARCH RESULTS for "${query}"]:\n\n${contextBlock}`;
}

// ─── 3. INTENT DETECTION ─────────────────────────────────────────────────────

/**
 * Parse a user message into a structured JSON intent.
 * Tries the full provider fallback chain; never returns null.
 *
 * @param {string}      message
 * @param {string}      preferredModel  - 'groq' | 'gemini' | 'openrouter'
 * @param {Array}       history         - recent conversation messages
 * @param {string|null} customPrompt    - server-specific personality override
 * @param {boolean}     isSearchReply   - true when injecting search results
 *                                        CRITICAL: prevents infinite search loop
 */
export async function detectIntent(message, preferredModel = 'groq', history = [], customPrompt = null, isSearchReply = false) {
  let systemPrompt = buildSystemPrompt(customPrompt);

  // Hard-block re-triggering search when we already have results
  if (isSearchReply) {
    systemPrompt += '\n\nCRITICAL: You have been given web search results above. You MUST respond with a final answer now. Do NOT set needs_search:true. Do NOT ask to search again. Use the results provided, even if imperfect.';
  }

  const chain = preferredModel === 'openrouter'
    ? [
        ...MODELS.openrouter.map(m => ({ provider: 'openrouter', model: m.id })),
        ...MODELS.groq.map(m => ({ provider: 'groq', model: m.id })),
        { provider: 'gemini', model: GEMINI_FLASH },
      ]
    : [
        ...MODELS.groq.map(m => ({ provider: 'groq', model: m.id })),
        { provider: 'gemini', model: GEMINI_FLASH },
        ...MODELS.openrouter.map(m => ({ provider: 'openrouter', model: m.id })),
      ];

  for (const { provider, model } of chain) {
    try {
      const result = await callProvider(provider, model, message, history, systemPrompt);

      // Safety net: force-stop any model that still loops on search-reply turn
      if (isSearchReply && result.needs_search) {
        logger.warn('Model tried to re-trigger search on search-reply — blocking');
        result.needs_search = false;
        result.search_query = undefined;
        if (!result.reply) result.reply = "I searched but couldn't find great info on that~ sorry ne~ (>_<)";
      }

      logger.info(`Intent via ${provider}/${model.split('/').pop()}: ${JSON.stringify(result)}`);
      return result;
    } catch (err) {
      logger.warn(`${provider}/${model.split('/').pop()} failed: ${err.message.slice(0, 60)} — trying next`);
    }
  }

  return { action: 'chat', reply: "Ugh, all my brains are overloaded rn 😵 try again in a sec!" };
}

// ─── 4. IMAGE ANALYSIS — Gemini Vision ───────────────────────────────────────

export async function analyzeImage(imageUrl, userPrompt = '') {
  const model = gemini.getGenerativeModel({ model: GEMINI_FLASH });

  const prompt = userPrompt
    ? `The user sent this image and said: "${userPrompt}". Describe what you see in detail, relevant to what they said.`
    : 'Describe what you see in this image in detail.';

  const res    = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);

  const buffer   = Buffer.from(await res.arrayBuffer());
  const base64   = buffer.toString('base64');
  const mimeType = res.headers.get('content-type') || 'image/jpeg';

  const result = await model.generateContent([
    { inlineData: { data: base64, mimeType } },
    prompt,
  ]);

  return result.response.text();
}

// ─── 5. STREAM CHAT ───────────────────────────────────────────────────────────

export async function* streamChat(prompt, history = [], preferredModel = 'groq') {
  const messages     = [...history, { role: 'user', content: prompt }];
  const systemPrompt = buildSystemPrompt();

  if (preferredModel === 'openrouter') {
    const stream = await openrouter.chat.completions.create({
      model:    MODELS.openrouter[0].id,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      stream:   true,
    });
    for await (const chunk of stream) yield chunk.choices[0]?.delta?.content || '';
  } else {
    const stream = await groq.chat.completions.create({
      model:    MODELS.groq[0].id,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      stream:   true,
    });
    for await (const chunk of stream) yield chunk.choices[0]?.delta?.content || '';
  }
}

// ─── Internal: Provider Callers ───────────────────────────────────────────────

async function callProvider(provider, model, message, history, systemPrompt) {
  const messages = [...history.slice(-6), { role: 'user', content: message }];

  if (provider === 'groq') {
    const res = await groq.chat.completions.create({
      model,
      messages:        [{ role: 'system', content: systemPrompt }, ...messages],
      temperature:     0.7,
      max_tokens:      800,
      response_format: { type: 'json_object' },
    });
    return parseJSON(res.choices[0].message.content);
  }

  if (provider === 'gemini') {
    const geminiModel = gemini.getGenerativeModel({ model, systemInstruction: systemPrompt });
    const res = await geminiModel.generateContent(messages.map(m => m.content).join('\n'));
    return parseJSON(res.response.text());
  }

  if (provider === 'openrouter') {
    const res = await openrouter.chat.completions.create({
      model,
      messages:    [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: 0.7,
      max_tokens:  800,
    });
    const raw = res.choices[0].message.content;
    if (!raw) throw new Error('OpenRouter returned empty content');
    return parseJSON(raw);
  }
}

function parseJSON(text) {
  if (!text) throw new Error('Empty response');
  const cleaned = text.replace(/```json|```/gi, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  const match = text.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch {} }
  if (text.trim().length > 0) {
    logger.warn(`Non-JSON from model, wrapping: "${text.slice(0, 50)}"`);
    return { action: 'chat', reply: text.trim().slice(0, 2000) };
  }
  throw new Error(`Could not parse JSON from: ${text.slice(0, 100)}`);
}
