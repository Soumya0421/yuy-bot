/**
 * src/commands/help.js — /help command
 *
 * Displays a beautiful embed listing all of Yuy's features, grouped
 * by category, with usage examples. Paginated with Select Menu navigation
 * so it doesn't flood the chat with a wall of text.
 *
 * Usage: /help
 *        /help category:music
 */

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';

// ─── Feature Categories ────────────────────────────────────────────────────────
// Each category has an emoji, name, description, and list of features.

const CATEGORIES = {
  chat: {
    emoji: '💬',
    name:  'AI Chat',
    desc:  'Talk to Yuy naturally — she understands context, images, voice messages, and more.',
    features: [
      '`yuy <message>` or `@Yuy <message>` — chat with Yuy',
      '`yuy` + attach image — she describes/discusses it',
      '`yuy` + voice message — auto-transcribed then answered',
      'Yuy detects emotion in your messages and adapts her tone',
      'Full conversation memory per channel (last 10 messages)',
      'Replies to threads and message replies with context',
      'Real-time web search when she needs current info',
    ],
  },
  music: {
    emoji: '🎵',
    name:  'Music',
    desc:  'Play music from YouTube directly in voice channels.',
    features: [
      '`yuy play <song>` — play a song or add to queue',
      '`yuy skip` — skip the current track',
      '`yuy pause` / `yuy resume` — toggle playback',
      '`yuy stop` — stop and clear the queue',
      '`yuy queue` — view the current queue',
      '`yuy 8d on/off` — toggle immersive 8D audio effect',
      '`yuy lyrics <song>` — fetch song lyrics',
      '`yuy playlist <mood>` — auto-generate a mood playlist',
      '/music — slash command with YouTube autocomplete search',
    ],
  },
  search: {
    emoji: '🔍',
    name:  'Web Search',
    desc:  'Yuy can search the web in real-time and deliver results as a clean embed.',
    features: [
      '`yuy search <query>` — instant web search with rich results',
      'Auto-triggered when you ask about news, weather, prices, etc.',
      'Uses Python + BeautifulSoup — no API key, no browser needed',
      'Stage 1: DDG/Bing search → Stage 2: AI picks best URLs → Stage 3: full page scrape',
      'Setup: `pip install requests beautifulsoup4 lxml` (one-time)',
      'Results rendered as a clean embed with clickable sources and AI summary',
    ],
  },
  media: {
    emoji: '🎨',
    name:  'Media & Images',
    desc:  'Generate images and send animated GIFs, memes, and stickers.',
    features: [
      '`yuy imagine <prompt>` — AI image generation',
      '`yuy gif <query>` — send a relevant GIF',
      '`yuy meme <query>` — send a meme',
      '`yuy sticker <query>` — send a sticker',
      '`yuy tts <text>` — text-to-speech with ElevenLabs',
      '`yuy watch <url>` — start Watch Together in VC',
      '/imagine — slash command with model selector',
    ],
  },
  profile: {
    emoji: '👤',
    name:  'Profile & Economy',
    desc:  'XP system, coins, daily rewards, and custom profiles.',
    features: [
      '`yuy checkin` — daily XP + coins reward',
      '`yuy rank [@user]` — show XP rank card',
      '`yuy profile [@user]` — detailed profile with badges',
      '`yuy leaderboard` — server XP leaderboard',
      '`yuy coins [@user]` — check coin balance',
      '`yuy daily` — claim daily coins',
      '`yuy give @user <amount>` — gift coins',
      '`yuy gamble <amount>` — risk coins',
      '`yuy shop` — browse the coin shop',
    ],
  },
  games: {
    emoji: '🎮',
    name:  'Games & Fun',
    desc:  'Mini-games, trivia, and social interaction commands.',
    features: [
      '`yuy trivia` — random trivia question',
      '`yuy memory [@opponent]` — memory tile matching game',
      '`yuy rps` — rock paper scissors',
      '`yuy truth or dare` — truth or dare',
      '`yuy wyr` — would you rather',
      '`yuy riddle` — random riddle',
      '`yuy roast @user` — Yuy roasts someone',
      '`yuy compliment @user` — Yuy compliments someone',
      '`yuy ship @user1 @user2` — ship compatibility',
      '`yuy horoscope [sign]` — today\'s horoscope',
      '`yuy vibe` — check server\'s current vibe',
    ],
  },
  moderation: {
    emoji: '🛡️',
    name:  'Moderation',
    desc:  'Moderation tools controllable via natural language or slash commands.',
    features: [
      '`yuy kick @user [reason]` — kick a member',
      '`yuy ban @user [reason]` — ban a member',
      '`yuy mute @user` — timeout a member',
      '`yuy clear <N>` — delete N messages',
      '`yuy warn @user <reason>` — issue a warning',
      '`yuy announce <message>` — send announcement',
      '`yuy give @user <role>` — assign a role',
      'All actions are logged to the audit log in Firebase',
    ],
  },
  utility: {
    emoji: '⚙️',
    name:  'Utility & Settings',
    desc:  'Server setup, polls, reminders, and bot configuration.',
    features: [
      '/help — this menu',
      '/info — server & bot info (password protected)',
      '`yuy poll <question> | opt1 | opt2` — create a poll',
      '`yuy remind me <time> <message>` — set a reminder',
      '`yuy avatar [@user]` — get user\'s avatar',
      '`yuy server info` — server statistics',
      '`yuy model list` — list available AI models',
      '`yuy model <provider>` — switch your AI model',
      '`yuy status` — check all API health statuses',
      '`yuy setprompt <text>` — set a custom personality for this server',
      '`yuy setup channels` — create all system channels (mod log, welcome, etc.)',
    ],
  },
};

// ─── Command Definition ────────────────────────────────────────────────────────

export default {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show all of Yuy\'s features and how to use them'),

  async execute(interaction) {
    // Show the overview embed with a dropdown to explore categories
    const overviewEmbed = buildOverviewEmbed();
    const row           = buildSelectMenu();

    await interaction.reply({
      embeds:     [overviewEmbed],
      components: [row],
      ephemeral:  false,
    });

    // ── Listen for category selection for 2 minutes ───────────────────────────
    const collector = interaction.channel.createMessageComponentCollector({
      filter: i => i.customId === 'help_category' && i.user.id === interaction.user.id,
      time:   120_000,
    });

    collector.on('collect', async (selectInteraction) => {
      const selected = selectInteraction.values[0];

      if (selected === 'overview') {
        await selectInteraction.update({
          embeds:     [buildOverviewEmbed()],
          components: [buildSelectMenu()],
        });
      } else {
        const cat = CATEGORIES[selected];
        if (!cat) return;
        await selectInteraction.update({
          embeds:     [buildCategoryEmbed(cat)],
          components: [buildSelectMenu(selected)],
        });
      }
    });

    collector.on('end', () => {
      // Remove the select menu when the collector expires to avoid dead interactions
      interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};

// ─── Embed Builders ───────────────────────────────────────────────────────────

/** Main overview embed — shows all categories as a grid */
function buildOverviewEmbed() {
  const categoryList = Object.values(CATEGORIES)
    .map(c => `${c.emoji} **${c.name}** — ${c.desc}`)
    .join('\n');

  return new EmbedBuilder()
    .setTitle('✨ Yuy — Feature Guide')
    .setDescription(
      'Hey there! I\'m **Yuy** (ゆい), your all-in-one AI Discord companion~ ≧◡≦\n\n' +
      'Talk to me with **`yuy <message>`** or **`@Yuy`** for natural language, ' +
      'or use `/` slash commands.\n\n' +
      '**Select a category below to see detailed commands:**\n\n' +
      categoryList
    )
    .setColor(0x5865f2)
    .setFooter({ text: 'Use the menu below to explore each category • /info for server details' })
    .setTimestamp();
}

/** Category detail embed — shows all features for one category */
function buildCategoryEmbed(cat) {
  return new EmbedBuilder()
    .setTitle(`${cat.emoji} ${cat.name}`)
    .setDescription(cat.desc)
    .addFields({
      name:  'Commands & Features',
      value: cat.features.join('\n'),
    })
    .setColor(0x5865f2)
    .setFooter({ text: 'Use the menu to switch categories' });
}

/** Select menu with all categories */
function buildSelectMenu(selected = 'overview') {
  const options = [
    {
      label:       '📋 Overview',
      value:       'overview',
      description: 'See all categories',
      default:     selected === 'overview',
    },
    ...Object.entries(CATEGORIES).map(([key, cat]) => ({
      label:       `${cat.emoji} ${cat.name}`,
      value:       key,
      description: cat.desc.slice(0, 50),
      default:     selected === key,
    })),
  ];

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('help_category')
      .setPlaceholder('Select a category...')
      .addOptions(options)
  );
}
