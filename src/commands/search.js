/**
 * src/commands/search.js — /search slash command
 *
 * Real-time autocomplete suggestions as the user types (via DuckDuckGo suggest API).
 * Full input fields: query + category + language.
 * Runs the full BS4 two-stage scrape pipeline for results.
 */

import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { searchWeb, detectIntent } from '../modules/aiRouter.js';
import { logger } from '../utils/logger.js';

// ── DDG suggest API for real-time autocomplete ────────────────────────────────
async function getDDGSuggestions(query) {
  try {
    const url = `https://duckduckgo.com/ac/?q=${encodeURIComponent(query)}&type=list`;
    const res  = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal:  AbortSignal.timeout(2000),
    });
    const data = await res.json();
    // DDG returns [query, [suggestion1, suggestion2, ...]]
    return Array.isArray(data[1]) ? data[1].slice(0, 20) : [];
  } catch {
    return [];
  }
}

export default {
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search the web for real-time information')
    .addStringOption(o =>
      o.setName('query')
        .setDescription('What to search for')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption(o =>
      o.setName('category')
        .setDescription('Search category (default: web)')
        .setRequired(false)
        .addChoices(
          { name: '🌐 Web',     value: 'web'     },
          { name: '📰 News',    value: 'news'    },
          { name: '🎬 Videos',  value: 'videos'  },
          { name: '🖼️ Images',  value: 'images'  },
          { name: '📚 Wiki',    value: 'wiki'    },
          { name: '🛒 Shopping',value: 'shopping'},
        )
    )
    .addStringOption(o =>
      o.setName('depth')
        .setDescription('Search depth')
        .setRequired(false)
        .addChoices(
          { name: '⚡ Quick (snippets only)',        value: 'quick'  },
          { name: '🔍 Deep (scrape top pages)',      value: 'deep'   },
        )
    ),

  // ── Autocomplete: real-time DDG suggestions as user types ────────────────────
  async autocomplete(interaction) {
    const query = interaction.options.getFocused().trim();
    if (!query || query.length < 2) {
      return interaction.respond([
        { name: 'Type to get suggestions...', value: 'latest news today' },
      ]).catch(() => {});
    }

    try {
      const suggestions = await getDDGSuggestions(query);
      const choices = suggestions.length
        ? suggestions.map(s => ({ name: s.slice(0, 100), value: s.slice(0, 100) }))
        : [{ name: query, value: query }];

      await interaction.respond(choices.slice(0, 25)).catch(() => {});
    } catch {
      await interaction.respond([{ name: query, value: query }]).catch(() => {});
    }
  },

  async execute(interaction) {
    const query    = interaction.options.getString('query');
    const category = interaction.options.getString('category') || 'web';
    const depth    = interaction.options.getString('depth')    || 'deep';

    await interaction.deferReply();

    // Enhance query with category context
    const searchQuery = category !== 'web'
      ? `${query} ${category}`
      : query;

    try {
      let contextBlock, summary;

      if (depth === 'quick') {
        // Quick mode: just get snippets, no page scraping
        contextBlock = `Quick search results for "${query}" (${category})`;
      } else {
        // Deep mode: full pipeline (DDG POST → fetch pages → readability)
        contextBlock = await searchWeb(searchQuery);
      }

      // Ask Yuy to summarize in character
      const summaryIntent = await detectIntent(
        `${contextBlock.slice(0, 3000)}\n\nSummarize these results for the user who asked: "${query}". Category: ${category}. Be concise, helpful, in character as Yuy.`,
        'groq', [], null, true
      );
      summary = summaryIntent?.reply || 'Here are the search results~';

      // Parse source URLs
      const urlMatches = [...contextBlock.matchAll(/URL:\s*(https?:\/\/\S+)/g)];
      const uniqueUrls = [...new Set(urlMatches.map(m => m[1]))].slice(0, 5);

      const embed = new EmbedBuilder()
        .setTitle(`🔍 ${query}${category !== 'web' ? ` (${category})` : ''}`)
        .setDescription(summary)
        .setColor(0x5865f2)
        .setTimestamp()
        .setFooter({ text: `${depth === 'deep' ? 'Deep search' : 'Quick search'} • Python BS4 pipeline` });

      if (uniqueUrls.length) {
        embed.addFields({
          name:  '🔗 Sources',
          value: uniqueUrls.map((u, i) => `${i + 1}. ${u}`).join('\n'),
        });
      }

      await interaction.editReply({ embeds: [embed] });

    } catch (err) {
      logger.warn(`/search failed: ${err.message}`);
      const isPythonError = err.message.includes('Python not found') || err.message.includes('SCRAPER_ERROR');
      await interaction.editReply({
        content: isPythonError
          ? '❌ Python scraper not set up:\n```\npip install aiohttp beautifulsoup4 readability-lxml lxml\n```'
          : `Search failed 😔 — ${err.message}`,
      });
    }
  },
};
