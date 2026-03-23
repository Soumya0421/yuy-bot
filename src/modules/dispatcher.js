/**
 * src/modules/dispatcher.js — Intent router
 *
 * Receives a parsed intent object from aiRouter.detectIntent() and routes
 * it to the correct module function. Each "action" maps to a specific handler.
 *
 * Modules are lazy-loaded (imported on first use) to keep startup fast.
 * Unrecognized actions fall back to a streaming chat response.
 *
 * Autonomous actions (react, send_gif, play_song, etc.) are executed
 * after the main reply, filtered to safe types only — moderation actions
 * can NEVER appear in the autonomous actions array.
 */

import { EmbedBuilder } from 'discord.js';
import { saveHistory } from '../utils/firebase.js';
import { logger } from '../utils/logger.js';

// Lazy-loaded module handlers (imported on first use)
let chatModule, imageModule, ttsModule, mediaModule, musicModule,
    modModule, utilityModule, profileModule, gameModule, economyModule;

/**
 * Dispatch an intent to the correct module
 * @param {object} intent - parsed intent from AI router
 * @param {import('discord.js').Message} message
 * @param {object} ctx - { user, server, preferredModel }
 */
export async function dispatch(intent, message, ctx) {
  const { action } = intent;
  logger.event(`Dispatch → ${action}`);

  try {
    switch (action) {

      // ── Chat ──────────────────────────────────────────────────────────────
      case 'chat': {
        // Support both single "reply" and multi-turn "messages" array
        const messages = Array.isArray(intent.messages) && intent.messages.length
          ? intent.messages
          : (intent.reply ? [intent.reply] : null);

        if (!messages) return;

        // Note: web search is already handled in messageCreate.js before dispatch().

        // Filter autonomous actions — only safe types, never moderation
        const safeActionTypes = ['react', 'send_gif', 'send_meme', 'send_sticker', 'send_message', 'play_song', 'send_image', 'use_custom_emoji'];
        const safeActions     = (intent.actions || []).filter(a => safeActionTypes.includes(a.type));

        // ── Multi-turn: send each message with a natural typing delay ──────
        for (let i = 0; i < messages.length; i++) {
          const text     = messages[i];
          const resolved = resolveMentions(text, message.guild);

          if (i === 0) {
            // First message: reply to the user
            await message.reply(resolved);
          } else {
            // Subsequent messages: simulate typing then send
            const delay = 400 + Math.random() * 600; // 400-1000ms feels natural
            await new Promise(r => setTimeout(r, delay));
            await message.channel.sendTyping().catch(() => {});
            const typingDelay = Math.min(text.length * 40, 2000); // ~40ms per char, max 2s
            await new Promise(r => setTimeout(r, typingDelay));
            await message.channel.send(resolved);
          }
        }

        // Save the combined reply to history
        const fullReply = messages.join(' ');
        await saveHistory(message.guild.id, message.channel.id, 'assistant', fullReply, ctx.preferredModel);

        // ── Emotional voice — ElevenLabs, only when AI explicitly requests it
        if (intent.send_voice && intent.voice_text) {
          const { sendEmotionalVoice } = await import('./tts.js');
          // Non-blocking — voice is a bonus, never delays the conversation
          sendEmotionalVoice(message, intent.voice_text).catch(err =>
            logger.warn(`Emotional voice silently failed: ${err.message}`)
          );
        }

        // ── Autonomous follow-up actions (GIFs, reactions, etc.) ───────────
        for (const autoAction of safeActions) {
          await executeAutoAction(autoAction, message, ctx).catch(err =>
            logger.warn(`Auto action ${autoAction.type} failed: ${err.message}`)
          );
        }
        break;
      }

      // ── Image Generation ──────────────────────────────────────────────────
      case 'image_gen': {
        if (!imageModule) imageModule = await import('./imageGen.js');
        // Pass style, ratio, count if the AI provided them (optional fields)
        await imageModule.generateImage(
          message,
          intent.prompt,
          intent.model  || 'flux',
          intent.style  || 'default',
          intent.ratio  || 'square',
          intent.count  || 1,
          true  // always enhance for natural language requests
        );
        break;
      }

      // ── TTS ───────────────────────────────────────────────────────────────
      case 'tts': {
        if (!ttsModule) ttsModule = await import('./tts.js');
        await ttsModule.speak(message, intent.text, intent.voice);
        break;
      }

      // ── Media (Klipy) ─────────────────────────────────────────────────────
      case 'media': {
        if (!mediaModule) mediaModule = await import('./media.js');
        await mediaModule.sendMedia(message, intent.subtype || 'gif', intent.query);
        break;
      }

      // ── Music ─────────────────────────────────────────────────────────────
      case 'music_play': {
        if (!musicModule) musicModule = await import('./music.js');
        await musicModule.play(message, intent.query);
        break;
      }
      case 'music_skip': {
        if (!musicModule) musicModule = await import('./music.js');
        await musicModule.skip(message);
        break;
      }
      case 'music_pause': {
        if (!musicModule) musicModule = await import('./music.js');
        await musicModule.pause(message);
        break;
      }
      case 'music_stop': {
        if (!musicModule) musicModule = await import('./music.js');
        await musicModule.stop(message);
        break;
      }
      case 'music_join': {
        if (!musicModule) musicModule = await import('./music.js');
        await musicModule.joinVC(message);
        break;
      }
      case 'music_leave': {
        if (!musicModule) musicModule = await import('./music.js');
        await musicModule.leaveVC(message);
        break;
      }
      case 'music_queue': {
        if (!musicModule) musicModule = await import('./music.js');
        await musicModule.showQueue(message);
        break;
      }
      case 'music_8d': {
        if (!musicModule) musicModule = await import('./music.js');
        await musicModule.toggle8D(message, intent.enabled);
        break;
      }

      // ── Moderation ────────────────────────────────────────────────────────
      case 'moderation': {
        if (!modModule) modModule = await import('./moderation.js');
        await modModule.handleMod(message, intent, ctx);
        break;
      }

      // ── Utilities ─────────────────────────────────────────────────────────
      case 'checkin': {
        if (!utilityModule) utilityModule = await import('./utility.js');
        await utilityModule.checkIn(message, ctx.user);
        break;
      }
      case 'rank': {
        if (!utilityModule) utilityModule = await import('./utility.js');
        await utilityModule.showRank(message, intent.target, ctx.user);
        break;
      }
      case 'leaderboard': {
        if (!utilityModule) utilityModule = await import('./utility.js');
        await utilityModule.showLeaderboard(message);
        break;
      }
      case 'stats': {
        if (!utilityModule) utilityModule = await import('./utility.js');
        await utilityModule.showStats(message);
        break;
      }
      case 'member_list': {
        if (!utilityModule) utilityModule = await import('./utility.js');
        await utilityModule.showMemberList(message, intent.role);
        break;
      }
      case 'server_info': {
        if (!utilityModule) utilityModule = await import('./utility.js');
        await utilityModule.showServerInfo(message);
        break;
      }
      case 'poll': {
        if (!utilityModule) utilityModule = await import('./utility.js');
        await utilityModule.createPoll(message, intent.question, intent.options);
        break;
      }
      case 'remind': {
        if (!utilityModule) utilityModule = await import('./utility.js');
        await utilityModule.setReminder(message, intent.time, intent.message);
        break;
      }

      // ── Profile ───────────────────────────────────────────────────────────
      case 'profile': {
        if (!profileModule) profileModule = await import('./profile.js');
        await profileModule.showProfile(message, intent.target, ctx.user);
        break;
      }
      case 'avatar': {
        if (!profileModule) profileModule = await import('./profile.js');
        await profileModule.showAvatar(message, intent.target);
        break;
      }
      case 'badge_give': {
        if (!profileModule) profileModule = await import('./profile.js');
        await profileModule.giveBadge(message, intent.target, intent.badge, intent.name, ctx);
        break;
      }
      case 'badge_list': {
        if (!profileModule) profileModule = await import('./profile.js');
        await profileModule.listBadges(message, intent.target);
        break;
      }

      // ── Economy ───────────────────────────────────────────────────────────
      case 'coins': {
        if (!economyModule) economyModule = await import('./economy.js');
        await economyModule.showCoins(message, intent.target, ctx.user);
        break;
      }
      case 'daily': {
        if (!economyModule) economyModule = await import('./economy.js');
        await economyModule.claimDaily(message, ctx.user);
        break;
      }
      case 'give_coins': {
        if (!economyModule) economyModule = await import('./economy.js');
        await economyModule.giveCoins(message, intent.target, intent.amount, ctx.user);
        break;
      }
      case 'gamble': {
        if (!economyModule) economyModule = await import('./economy.js');
        await economyModule.gamble(message, intent.amount, ctx.user);
        break;
      }
      case 'shop': {
        if (!economyModule) economyModule = await import('./economy.js');
        await economyModule.openShop(message);
        break;
      }

      // ── Games ─────────────────────────────────────────────────────────────
      case 'trivia': {
        if (!gameModule) gameModule = await import('./games.js');
        await gameModule.startTrivia(message, ctx);
        break;
      }
      case 'memory_game': {
        if (!gameModule) gameModule = await import('./games.js');
        await gameModule.startMemory(message, intent.opponent);
        break;
      }
      case 'roast': {
        if (!gameModule) gameModule = await import('./games.js');
        await gameModule.roast(message, intent.target, ctx.preferredModel);
        break;
      }
      case 'compliment': {
        if (!gameModule) gameModule = await import('./games.js');
        await gameModule.compliment(message, intent.target, ctx.preferredModel);
        break;
      }
      case 'would_you_rather': {
        if (!gameModule) gameModule = await import('./games.js');
        await gameModule.wouldYouRather(message, ctx.preferredModel);
        break;
      }
      case 'riddle': {
        if (!gameModule) gameModule = await import('./games.js');
        await gameModule.riddle(message, ctx.preferredModel);
        break;
      }
      case 'rps': {
        if (!gameModule) gameModule = await import('./games.js');
        await gameModule.rps(message);
        break;
      }
      case 'truth_or_dare': {
        if (!gameModule) gameModule = await import('./games.js');
        await gameModule.truthOrDare(message, ctx.preferredModel);
        break;
      }
      case 'ship': {
        if (!gameModule) gameModule = await import('./games.js');
        await gameModule.ship(message, intent.user1, intent.user2);
        break;
      }
      case 'horoscope': {
        if (!gameModule) gameModule = await import('./games.js');
        await gameModule.horoscope(message, intent.sign, ctx.preferredModel);
        break;
      }
      case 'vibe_check': {
        if (!gameModule) gameModule = await import('./games.js');
        await gameModule.vibeCheck(message, ctx.preferredModel);
        break;
      }

      // ── Model Switching ───────────────────────────────────────────────────
      case 'model_switch': {
        const { updateUser } = await import('../utils/firebase.js');
        await updateUser(message.author.id, { preferredModel: intent.provider });
        await message.reply(`switched to **${intent.provider}** 🤖 got it!`);
        break;
      }
      case 'model_list': {
        const { MODELS } = await import('./aiRouter.js');
        const list = Object.entries(MODELS)
          .map(([p, models]) => `**${p}**\n${models.map(m => `• ${m.label}`).join('\n')}`)
          .join('\n\n');
        await message.reply(`here's what i can run on:\n\n${list}`);
        break;
      }

      // ── Admin ─────────────────────────────────────────────────────────────
      case 'announce': {
        if (!modModule) modModule = await import('./moderation.js');
        await modModule.announce(message, intent.message, ctx);
        break;
      }
      case 'setup_channels': {
        if (!modModule) modModule = await import('./moderation.js');
        await modModule.setupChannels(message, ctx);
        break;
      }
      case 'yuy_status': {
        await showStatus(message);
        break;
      }

      // ── Web Search ────────────────────────────────────────────────────────
      case 'web_search': {
        const { searchWeb, detectIntent } = await import('./aiRouter.js');
        const thinking = await message.reply('🔍 searching the web~');
        try {
          // Gemini searches, Groq forms the reply
          const searchResult = await searchWeb(intent.query || message.content);
          const finalIntent = await detectIntent(
            `[WEB SEARCH RESULTS:\n${searchResult.slice(0, 2000)}]\n\nUser asked: ${message.content}\nReply naturally as Yuy.`,
            ctx.preferredModel, [], ctx.server?.customPrompt
          );
          const reply = finalIntent?.reply || searchResult.slice(0, 2000);
          await thinking.edit(reply);
          await saveHistory(message.guild.id, message.channel.id, 'assistant', reply, 'gemini+groq');
        } catch (err) {
          await thinking.edit(`web search failed 💀 — ${err.message}`);
        }
        break;
      }
      case 'setup_status_channel': {
        const { setupStatusChannel } = await import('./statusLogger.js');
        await setupStatusChannel(message);
        break;
      }

      // ── Lyrics & Playlist ─────────────────────────────────────────────────
      case 'lyrics': {
        if (!musicModule) musicModule = await import('./music.js');
        await musicModule.getLyrics(message, intent.query);
        break;
      }
      case 'mood_playlist': {
        if (!musicModule) musicModule = await import('./music.js');
        await musicModule.moodPlaylist(message, intent.mood, ctx.preferredModel);
        break;
      }

      // ── Watch Together ────────────────────────────────────────────────────
      case 'watch': {
        const { watchTogether } = await import('./watchTogether.js');
        await watchTogether(message, intent.url);
        break;
      }

      default: {
        // Dynamic fallback — if action is unknown, treat it as a chat reply
        if (intent.reply) {
          await message.reply(intent.reply);
          await saveHistory(message.guild.id, message.channel.id, 'assistant', intent.reply, ctx.preferredModel);
        } else {
          // Re-route as chat using the original message
          const { streamChat } = await import('./aiRouter.js');
          let response = '';
          for await (const token of streamChat(message.content, [], ctx.preferredModel)) {
            response += token;
          }
          if (response) {
            await message.reply(response.slice(0, 2000));
            await saveHistory(message.guild.id, message.channel.id, 'assistant', response, ctx.preferredModel);
          }
        }
        break;
      }
    }
  } catch (err) {
    logger.error(`Dispatch error for action ${action}: ${err.message}`);
    message.reply("something went sideways 💀").catch(() => {});
  }
}

// ─── Status Check ────────────────────────────────────────────────────────────

async function showStatus(message) {
  const checks = [
    { name: 'Groq', check: () => fetch('https://api.groq.com', { signal: AbortSignal.timeout(3000) }) },
    { name: 'Gemini', check: () => fetch('https://generativelanguage.googleapis.com', { signal: AbortSignal.timeout(3000) }) },
    { name: 'OpenRouter', check: () => fetch('https://openrouter.ai', { signal: AbortSignal.timeout(3000) }) },
    { name: 'Pollinations', check: () => fetch('https://image.pollinations.ai', { signal: AbortSignal.timeout(3000) }) },
    { name: 'Klipy', check: () => fetch('https://klipy.com', { signal: AbortSignal.timeout(3000) }) },
  ];

  const results = await Promise.all(
    checks.map(async ({ name, check }) => {
      try {
        await check();
        return `✅ ${name}`;
      } catch {
        return `❌ ${name}`;
      }
    })
  );

  const embed = new EmbedBuilder()
    .setTitle('🤖 Yuy System Status')
    .setDescription(results.join('\n'))
    .setColor(0x5865f2)
    .setTimestamp();

  await message.reply({ embeds: [embed] });
}

// ─── Resolve @username mentions in Yuy's reply ───────────────────────────────
// Converts "@Soumya" → "<@userId>" so Discord renders clickable mentions

function resolveMentions(text, guild) {
  if (!text || !guild) return text;

  return text.replace(/@([\w\d_\.]+)/g, (match, username) => {
    // Search by display name, username, or nickname (case-insensitive)
    const member = guild.members.cache.find(m =>
      m.user.username.toLowerCase()    === username.toLowerCase() ||
      m.displayName.toLowerCase()      === username.toLowerCase() ||
      m.user.globalName?.toLowerCase() === username.toLowerCase()
    );
    return member ? `<@${member.id}>` : match; // keep original if not found
  });
}


// Called when Yuy decides on her own to do something alongside a chat reply
// e.g. react with emoji, send a gif, play a song, send a sticker

async function executeAutoAction(action, message, ctx) {
  switch (action.type) {

    // React to the message with an emoji
    case 'react': {
      if (action.emoji) {
        await message.react(action.emoji).catch(() => {});
      }
      break;
    }

    // Send a gif/meme/sticker from Klipy — auto mode, no picker
    case 'send_gif':
    case 'send_meme':
    case 'send_sticker': {
      if (!mediaModule) mediaModule = await import('./media.js');
      const subtype = action.type.replace('send_', '');
      await mediaModule.sendMedia(message, subtype, action.query || 'happy', true); // true = auto, no picker
      break;
    }

    // Play a song in VC (only if user is in VC)
    case 'play_song': {
      const vc = message.member?.voice?.channel;
      if (vc && action.query) {
        if (!musicModule) musicModule = await import('./music.js');
        await musicModule.play(message, action.query);
      }
      break;
    }

    // Send a follow-up message (e.g. a kaomoji or extra expression)
    case 'send_message': {
      if (action.text) {
        await message.channel.send(action.text);
      }
      break;
    }

    // Send a stored custom emoji image from Supabase
    case 'use_custom_emoji': {
      if (action.name) {
        try {
          const { getCustomEmoji } = await import('../commands/emoji.js');
          const emoji = await getCustomEmoji(message.guild.id, action.name);
          if (emoji?.type === 'image' && emoji?.url) {
            await message.channel.send(emoji.url);
          } else if (emoji?.type === 'text' && emoji?.value) {
            await message.channel.send(emoji.value);
          }
        } catch (err) {
          logger.warn(`Custom emoji action failed: ${err.message}`);
        }
      }
      break;
    }

    // Generate and send an image (autonomous action from Yuy)
    case 'send_image': {
      if (action.prompt) {
        if (!imageModule) imageModule = await import('./imageGen.js');
        await imageModule.generateImage(
          message,
          action.prompt,
          action.model || 'flux',
          action.style || 'anime',  // default to anime style for Yuy's autonomous images
          'square',
          1,
          true
        );
      }
      break;
    }
  }
}
