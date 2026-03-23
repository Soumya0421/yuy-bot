/**
 * src/events/messageCreate.js — Main message handler
 *
 * Fires on every message in every server. Does nothing unless the message
 * starts with "yuy" or @mentions Yuy.
 *
 * Full pipeline:
 *   1.  Check trigger word / @mention
 *   2.  ACTION SHORTCUT: detect "yuy hug @user" patterns → instant GIF, no AI needed
 *   3.  Transcribe voice attachments via Groq Whisper
 *   4.  Analyze image attachments via Gemini Vision
 *   5.  Fetch reply context if user replied to a message
 *   6.  Gather recent channel messages for conversational context
 *   7.  Build an enriched prompt with all context combined
 *   8.  Run detectIntent() to get a structured action from the AI
 *   9.  If needs_search: run Python BS4 web search, re-run intent with results
 *  10.  Dispatch the intent to the correct module
 *  11.  Save message metadata to Firebase (full detail logging)
 *
 * ── ACTION SHORTCUT (step 2) ────────────────────────────────────────────────
 * Pattern: "yuy <action> @user" or "yuy @user <action>"
 * e.g. "yuy hug @soumya" → instantly sends an anime hug GIF mentioning both users
 *
 * This bypasses the AI entirely for these predictable social interactions:
 *   - Zero latency (no API call)
 *   - 100% reliable (no chance of AI routing to "chat" instead)
 *   - GIF is always sent first, then a fun text line
 */

import {
  detectIntent,
  transcribeAudio,
  analyzeImage,
  searchWeb,
} from '../modules/aiRouter.js';
import {
  getUser,
  getServer,
  saveHistory,
  getHistory,
  saveMessageMeta,
} from '../utils/firebase.js';
import { checkCooldown } from '../utils/cooldown.js';
import { logger } from '../utils/logger.js';
import { dispatch } from '../modules/dispatcher.js';
import { storeImageEmoji } from '../commands/emoji.js';
import { updateStatusChannel, trackStat } from '../modules/statusLogger.js';

const TRIGGER = (process.env.BOT_TRIGGER || 'yuy').toLowerCase();

// ─── Action → GIF query map ───────────────────────────────────────────────────
// Keys are the action words users type. Values are Klipy search queries.
// Add more entries here to expand the action vocabulary.
const ACTION_GIF_MAP = {
  // Physical affection
  hug:      'anime hug',
  pat:      'anime head pat',
  headpat:  'anime head pat',
  poke:     'anime poke',
  boop:     'anime boop',
  kiss:     'anime kiss',
  bite:     'anime bite',
  lick:     'anime lick',
  nuzzle:   'anime nuzzle',
  cuddle:   'anime cuddle',
  glomp:    'anime glomp tackle',
  tackle:   'anime tackle',
  // Greetings / reactions
  wave:     'anime wave hello',
  highfive: 'anime high five',
  bonk:     'anime bonk',
  slap:     'anime slap',
  punch:    'anime punch',
  kick:     'anime kick',
  throw:    'anime throw',
  bully:    'anime bully',
  protect:  'anime protect',
  // Expressions toward someone
  stare:    'anime stare',
  glare:    'anime angry glare',
  wink:     'anime wink',
  blush:    'anime blush',
  pout:     'anime pout',
  // Celebrate
  cheer:    'anime cheer',
  clap:     'anime clap',
  celebrate:'anime celebrate',
  dance:    'anime dance',
  spin:     'anime spin',
};

// Fun text lines Yuy says after sending the action GIF
// {actor} = the user who triggered, {target} = the @mentioned user
const ACTION_LINES = {
  hug:      '{actor} gives {target} a big warm hug~ ≧◡≦',
  pat:      '{actor} pats {target} on the head ehe~ (´｡• ᵕ •｡`)',
  headpat:  '{actor} gives {target} headpats~ ≧◡≦',
  poke:     '{actor} pokes {target} >///<',
  boop:     '{actor} boops {target}\'s nose~ (｀• ω •´)',
  kiss:     '{actor} gives {target} a kiss~ 💋 >///<',
  bite:     '{actor} bites {target}! nom nom >///<',
  lick:     '{actor} licks {target}... e-ehe 👅 >///<',
  nuzzle:   '{actor} nuzzles {target} softly~ 🥺',
  cuddle:   '{actor} cuddles up with {target}~ (っ˘ω˘ς)',
  glomp:    '{actor} GLOMPS {target} out of nowhere!! (≧∇≦)',
  tackle:   '{actor} tackles {target} to the ground!! 💥',
  wave:     '{actor} waves at {target}~ ✋(・ω・)',
  highfive: '{actor} high fives {target}! ✋🙌',
  bonk:     '{actor} bonks {target} on the head! go to horny jail 🔨',
  slap:     '{actor} slaps {target}!! ヽ(ー_ー )ノ',
  punch:    '{actor} punches {target}!! 👊 POW',
  kick:     '{actor} kicks {target}!!  ( ´_ゝ｀)ﾉ',
  throw:    '{actor} throws {target} into the void!!',
  bully:    '{actor} is bullying {target}!! someone stop them 😤',
  protect:  '{actor} stands in front of {target} to protect them 🛡️ uwu',
  stare:    '{actor} stares intensely at {target}... (눈_눈)',
  glare:    '{actor} glares at {target} with full power (ಠ_ಠ)',
  wink:     '{actor} winks at {target}~ ( ͡° ͜ʖ ͡°)',
  blush:    '{actor} blushes at {target}... s-stop!! >///<',
  pout:     '{actor} pouts at {target}... hmph!! (◣_◢)',
  cheer:    '{actor} cheers for {target}!! 🎉 go go go!!',
  clap:     '{actor} claps for {target}!! 👏👏',
  celebrate:'{actor} celebrates with {target}!! 🎊🎉',
  dance:    '{actor} wants to dance with {target}!! (っ◔◡◔)っ ♪',
  spin:     '{actor} spins {target} around!! 💫',
};

export default {
  name: 'messageCreate',

  async execute(message) {
    if (message.author.bot) return;
    if (!message.guild)     return;

    const content = message.content.trim();
    const lower   = content.toLowerCase();

    // ── 1. Trigger detection ──────────────────────────────────────────────────
    const mentionTrigger = message.mentions.has(message.client.user);
    const textTrigger    = lower.startsWith(TRIGGER);
    if (!textTrigger && !mentionTrigger) return;

    // Strip the trigger to get the user's actual message
    let userMessage = mentionTrigger
      ? content.replace(/<@!?\d+>/g, '').trim()
      : content.slice(TRIGGER.length).trim();

    // ── 2a. ACTION SHORTCUT — detect "hug @user", "pat @user", etc. ──────────
    // Check BEFORE rate-limiting, Firebase calls, or AI — this is instant.
    const actionResult = detectActionPattern(userMessage, message);
    if (actionResult) {
      return handleAction(actionResult, message);
    }

    // ── 2b. IMAGE → EMOJI — detect "add as emoji name:X" + image attachment ──
    // Pattern: "add as emoji name:X", "add emoji X", "make emoji X", "save as emoji X"
    // Requires an image attachment. Bypasses AI — direct guild emoji creation.
    const emojiResult = detectEmojiRequest(userMessage, message);
    if (emojiResult) {
      return handleEmojiCreation(emojiResult, message);
    }

    // ── Attachments ───────────────────────────────────────────────────────────
    const voiceAttachment = message.attachments.find(a =>
      a.contentType?.includes('ogg')   ||
      a.contentType?.includes('audio') ||
      a.waveform !== undefined
    );
    const imageAttachment = message.attachments.find(a =>
      a.contentType?.startsWith('image/')
    );

    if (!userMessage && !voiceAttachment && !imageAttachment) {
      return message.reply("yeah? 👀");
    }

    // ── Rate limit ────────────────────────────────────────────────────────────
    const { limited, remaining } = checkCooldown(message.author.id, 'nlp', 2);
    if (limited) return message.reply(`chill bestie, wait ${remaining}s 🥱`);

    await message.channel.sendTyping();

    try {
      const [user, server] = await Promise.all([
        getUser(message.author.id, message.author.username),
        getServer(message.guild.id),
      ]);
      trackStat('commandsHandled');
      trackStat('dbReads');

      const preferredModel = user.preferredModel || server.defaultModel || 'groq';
      const dbHistory = await getHistory(message.guild.id, message.channel.id, 8);
      trackStat('dbReads');

      // ── 3. Voice transcription ────────────────────────────────────────────
      if (voiceAttachment) {
        await message.react('🎙️');
        try {
          const transcribed = await transcribeAudio(voiceAttachment.url);
          userMessage = transcribed || userMessage;
          await message.react('✅');
          logger.info(`Voice transcribed: "${transcribed}"`);
        } catch (err) {
          await message.react('❌');
          logger.warn(`Voice transcription failed: ${err.message}`);
          return message.reply("couldn't transcribe that voice message 😔");
        }
      }

      // ── 4. Image analysis ─────────────────────────────────────────────────
      let imageContext = '';
      if (imageAttachment) {
        try {
          const desc   = await analyzeImage(imageAttachment.url, userMessage);
          imageContext = `\n[IMAGE: ${desc}]`;
        } catch (err) {
          imageContext = `\n[USER SENT IMAGE: ${imageAttachment.url}]`;
          logger.warn(`Image analysis failed: ${err.message}`);
        }
      }

      // ── 5. Reply context ──────────────────────────────────────────────────
      let replyContext = '';
      if (message.reference?.messageId) {
        try {
          const ref = await message.channel.messages.fetch(message.reference.messageId);
          const who = ref.author.id === message.client.user.id ? 'Yuy' : ref.author.username;
          replyContext = `\n[REPLYING TO ${who.toUpperCase()}: "${ref.content?.slice(0, 300) || '[no text]'}"]`;
          const refImg = ref.attachments.find(a => a.contentType?.startsWith('image/'));
          if (refImg) replyContext += ` [WITH IMAGE: ${refImg.url}]`;
        } catch { /* ignore */ }
      }

      // ── 6. Recent chat context ────────────────────────────────────────────
      const recentMsgs = await message.channel.messages
        .fetch({ limit: 6, before: message.id })
        .then(msgs =>
          [...msgs.values()].reverse()
            .filter(m => !m.author.bot || m.author.id === message.client.user.id)
            .slice(0, 5)
            .map(m => `[${m.author.id === message.client.user.id ? 'Yuy' : m.author.username}]: ${m.content.slice(0, 150)}`)
        ).catch(() => []);

      // ── 7. Member context for @mention awareness ──────────────────────────
      const members = message.guild.members.cache
        .filter(m => !m.user.bot)
        .map(m => `${m.displayName} (username: ${m.user.username})`)
        .slice(0, 50).join(', ');
      const memberContext = members
        ? `\nSERVER MEMBERS YOU CAN @MENTION: ${members}`
        : '';

      // ── 7b. Load custom emojis so Yuy knows what she can use ────────────
      let emojiContext = '';
      try {
        const { getAllCustomEmojis } = await import('../commands/emoji.js');
        const customEmojis = await getAllCustomEmojis(message.guild.id);
        if (customEmojis.length) {
          const emojiList = customEmojis.map(e => `:${e.name}:`).join(', ');
          emojiContext = `\nCUSTOM EMOJIS YOU CAN USE: ${emojiList}\nTo use one, add to actions: {"type":"use_custom_emoji","name":"emojiname"}`;
        }
      } catch { /* non-blocking */ }

      // ── 8. Build enriched prompt ──────────────────────────────────────────
      const enrichedMessage = [
        recentMsgs.length ? `[RECENT CHAT:\n${recentMsgs.join('\n')}]` : '',
        replyContext,
        imageContext,
        `[${message.author.username}]: ${userMessage || '(sent media)'}`,
        emojiContext || null,
      ].filter(Boolean).join('\n');

      // ── 9. Detect intent ──────────────────────────────────────────────────
      const intent = await detectIntent(
        enrichedMessage,
        preferredModel,
        dbHistory,
        (server.customPrompt || '') + memberContext
      );

      if (preferredModel === 'openrouter') trackStat('openrouterCalls');
      else                                  trackStat('groqCalls');

      // ── 10. Web search pipeline ───────────────────────────────────────────
      if (intent.needs_search && intent.search_query) {
        logger.info(`Web search triggered: "${intent.search_query}"`);
        await message.channel.sendTyping();
        try {
          const searchResult = await searchWeb(intent.search_query);
          const finalIntent  = await detectIntent(
            `${searchResult.slice(0, 3000)}\n\nAnswer the user: ${userMessage}\nStay in character as Yuy.`,
            preferredModel, dbHistory, server.customPrompt || null, true
          );
          if (finalIntent?.reply)   intent.reply   = finalIntent.reply;
          if (finalIntent?.actions) intent.actions = finalIntent.actions;
          intent.needs_search = false;
          intent.search_query = undefined;
        } catch (err) {
          logger.warn(`Web search pipeline failed: ${err.message}`);
          intent.reply = `tried searching but hit a snag 😔 — ${
            intent.reply?.replace(/lemme check~?|searching\.\.\.?/gi, '').trim() ||
            "not sure about that one rn~ try again ne~"
          }`;
          intent.needs_search = false;
        }
      }

      await saveHistory(message.guild.id, message.channel.id, 'user', userMessage || '(media)');
      trackStat('dbWrites');

      await dispatch(intent, message, { user, server, preferredModel });

      // ── 11. Log full message metadata to Firebase ─────────────────────────
      saveMessageMeta({
        guildId:     message.guild.id,
        guildName:   message.guild.name,
        channelId:   message.channel.id,
        channelName: message.channel.name,
        userId:      message.author.id,
        username:    message.author.username,
        content:     userMessage || '(media)',
        intent:      intent.action || 'unknown',
        emotion:     inferEmotion(userMessage),
        modelUsed:   preferredModel,
        botReply:    intent.reply || null,
        hasImage:    !!imageAttachment,
        hasVoice:    !!voiceAttachment,
        needsSearch: !!intent.needs_search,
        searchQuery: intent.search_query || null,
      }).catch(() => {});

      updateStatusChannel(message.client, message.guild.id).catch(() => {});

    } catch (err) {
      trackStat('errors');
      logger.error(`messageCreate error: ${err.message}`);
      message.reply("something broke on my end 💀 try again").catch(() => {});
    }
  },
};

// ─── Action Pattern Detection ─────────────────────────────────────────────────

/**
 * Detect "hug @user", "pat @user", "@user hug", "@user pat" patterns.
 * Returns { action, gifQuery, target, targetId } or null if no match.
 *
 * @param {string} text   - the message after stripping the "yuy" trigger
 * @param {object} message - Discord message object
 */
function detectActionPattern(text, message) {
  if (!text) return null;

  // Match: "action @mention" or "@mention action"
  const patterns = [
    /^(\w+)\s+<@!?(\d+)>$/i,    // "hug @user"
    /^<@!?(\d+)>\s+(\w+)$/i,    // "@user hug"  — capture groups flipped
  ];

  for (let i = 0; i < patterns.length; i++) {
    const match = text.match(patterns[i]);
    if (!match) continue;

    // Normalize: always [action, userId]
    const [action, userId] = i === 0
      ? [match[1].toLowerCase(), match[2]]
      : [match[2].toLowerCase(), match[1]];

    if (!ACTION_GIF_MAP[action]) continue;

    // Resolve the @mentioned member
    const targetMember = message.guild.members.cache.get(userId);
    if (!targetMember) continue;

    return {
      action,
      gifQuery: ACTION_GIF_MAP[action],
      target:   targetMember,
      targetId: userId,
    };
  }

  return null;
}

/**
 * Handle a detected action: send the GIF first (highest priority),
 * then send a fun text line mentioning both users.
 */
async function handleAction({ action, gifQuery, target }, message) {
  logger.event(`Action shortcut: ${message.author.username} → ${action} → ${target.user.username}`);

  const actor = message.author.toString();
  const tgt   = target.toString();

  // Build the text line
  const template = ACTION_LINES[action] || `{actor} ${action}s {target}~`;
  const textLine  = template
    .replace('{actor}', actor)
    .replace('{target}', tgt);

  try {
    // ── GIF first — highest priority ─────────────────────────────────────────
    const { sendMedia } = await import('../modules/media.js');
    await sendMedia(message, 'gif', gifQuery, true); // auto=true → no picker

    // ── Text line after ───────────────────────────────────────────────────────
    await message.channel.send(textLine);

  } catch (err) {
    logger.warn(`Action handler failed for ${action}: ${err.message}`);
    // Fallback: at least send the text line even if GIF failed
    await message.reply(textLine).catch(() => {});
  }
}

// ─── Emotion Inference ────────────────────────────────────────────────────────

function inferEmotion(text) {
  if (!text) return 'neutral';
  const t = text.toLowerCase();
  if (/\b(love|amazing|awesome|best|great|happy|excited|yay|hype|ily)\b/.test(t)) return 'positive';
  if (/\b(sad|depressed|lonely|miss|cry|hurt|anxious|scared|worried)\b/.test(t))  return 'sad';
  if (/\b(angry|mad|hate|stupid|idiot|wtf|damn|shut up)\b/.test(t))               return 'angry';
  if (/\b(funny|lol|lmao|haha|hilarious|joke|meme)\b/.test(t))                   return 'humor';
  if (/\b(help|how|what|when|where|why|explain|tell me)\b/.test(t))               return 'curious';
  if (/\b(bored|nothing|idk|whatever|meh)\b/.test(t))                             return 'bored';
  return 'neutral';
}

// ─── Emoji Creation Detection ──────────────────────────────────────────────────

/**
 * Detect natural language requests to create a server emoji from an image.
 *
 * Patterns recognized (all case-insensitive):
 *   "add as emoji name:wave"
 *   "add emoji wave"
 *   "make emoji wave"
 *   "save as emoji wave"
 *   "create emoji wave"
 *   "make this an emoji called wave"
 *
 * Requires an image attachment on the message.
 *
 * @returns {{ name: string, imageUrl: string }} or null
 */
function detectEmojiRequest(text, message) {
  if (!text) return null;

  // Must have an image attachment
  const imageAttachment = message.attachments.find(a =>
    a.contentType?.startsWith('image/')
  );
  if (!imageAttachment) return null;

  // Patterns to extract the emoji name from the message
  const patterns = [
    /(?:add as emoji|save as emoji|make this an? emoji|create emoji|add emoji|make emoji)\s+(?:name[:\s]+)?([a-zA-Z0-9_]+)/i,
    /(?:name[:\s]+)([a-zA-Z0-9_]+)\s+(?:as an? emoji|as emoji)/i,
    /emoji\s+(?:name[:\s]+)?([a-zA-Z0-9_]+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const name = match[1].toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 32);
      if (name.length >= 2) {
        return { name, imageUrl: imageAttachment.url };
      }
    }
  }

  return null;
}

/**
 * Handle natural language emoji creation:
 * Fetches the image, creates a guild emoji, confirms to the user.
 */
async function handleEmojiCreation({ name, imageUrl }, message) {
  logger.event(`Emoji store: ${message.author.username} → :${name}: from image`);

  const thinking = await message.reply(`🖼️ saving \`:${name}:\` as a custom emoji...`);

  try {
    const emojiData = await storeImageEmoji(
      message.guild.id,
      name,
      imageUrl,
      message.author.id,
      message.author.username
    );

    await thinking.edit(
      `✅ saved **:${name}:** as a custom emoji~ ≧◡≦\n` +
      `Use it with \`/emoji use name:${name}\` or ask me \`yuy use emoji ${name}\`!`
    );

  } catch (err) {
    logger.error(`Natural language emoji store failed: ${err.message}`);

    let msg = `couldn't save the emoji 💀 — ${err.message}`;
    if (err.message.includes('sharp not installed')) {
      msg = `\`sharp\` is not installed~ run \`npm install sharp\` and restart me!`;
    } else if (err.message.includes('storage')) {
      msg = `Supabase not set up yet 😔 Add SUPABASE_URL and SUPABASE_SERVICE_KEY to .env!`;
    }

    await thinking.edit(msg);
  }
}
