import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

const KLIPY_BASE = 'https://api.klipy.com/v2/search';
const API_KEY = process.env.KLIPY_API_KEY;

const gifCache = new Map();

async function searchKlipy(query, type = 'gif') {
  const prefixMap = { gif: '', meme: 'meme', sticker: 'sticker', clip: 'clip' };
  const prefix = prefixMap[type] || '';
  const fullQuery = prefix ? `${prefix} ${query}` : query;
  const url = `${KLIPY_BASE}?q=${encodeURIComponent(fullQuery)}&key=${API_KEY}&limit=10`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Klipy ${res.status}`);
  const data = await res.json();
  return data.results || [];
}

export default {
  data: new SlashCommandBuilder()
    .setName('gif')
    .setDescription('Search GIFs, memes, stickers or clips from Klipy in real time')
    .addStringOption(o =>
      o.setName('query')
        .setDescription('What to search for')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption(o =>
      o.setName('type')
        .setDescription('Type of media (default: gif)')
        .setRequired(false)
        .addChoices(
          { name: '🎬 GIF',     value: 'gif'     },
          { name: '😂 Meme',    value: 'meme'    },
          { name: '🩹 Sticker', value: 'sticker' },
          { name: '🎞️ Clip',    value: 'clip'    },
        )
    ),

  // ── Autocomplete: real-time Klipy search ──────────────────────────────────
  async autocomplete(interaction) {
    const query = interaction.options.getFocused().trim();
    const type  = interaction.options.getString('type') || 'gif';

    if (!query || query.length < 2) {
      return interaction.respond([{ name: 'Type to search Klipy...', value: 'funny' }]).catch(() => {});
    }

    try {
      const results = await Promise.race([
        searchKlipy(query, type),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2800)),
      ]);

      const choices = results.slice(0, 25).map((r, i) => ({
        name: (r.title || r.slug || `Result ${i + 1}`).slice(0, 100),
        value: (r.title || r.slug || query).slice(0, 100),
      }));

      await interaction.respond(
        choices.length ? choices : [{ name: `Search: "${query}"`, value: query }]
      ).catch(() => {});
    } catch {
      await interaction.respond([{ name: `🔍 Press Enter to search: "${query}"`, value: query }]).catch(() => {});
    }
  },

  // ── Execute ───────────────────────────────────────────────────────────────
  async execute(interaction) {
    const query = interaction.options.getString('query');
    const type  = interaction.options.getString('type') || 'gif';
    await interaction.deferReply();

    try {
      const results = await searchKlipy(query, type);
      if (!results.length) return interaction.editReply(`no ${type}s found for "${query}" 😔`);

      gifCache.set(interaction.user.id, { results, query, type });
      setTimeout(() => gifCache.delete(interaction.user.id), 120_000);

      await showGifResult(interaction, results, 0, query, type, true);
    } catch (err) {
      await interaction.editReply(`klipy search failed 💀 — ${err.message}`);
    }
  },
};

async function showGifResult(interaction, results, index, query, type, initial = false) {
  const item = results[index];
  const mediaUrl = item?.url || item?.media_url || null;

  if (!mediaUrl) {
    const p = { content: `no media URL for result #${index + 1} 😔`, embeds: [], components: [] };
    return initial ? interaction.editReply(p) : interaction.update(p);
  }

  const typeEmoji = { gif: '🎬', meme: '😂', sticker: '🩹', clip: '🎞️' }[type] || '🎬';

  const embed = new EmbedBuilder()
    .setTitle(`${typeEmoji} ${type.toUpperCase()} — "${query}"`)
    .setImage(mediaUrl)
    .setColor(0x5865f2)
    .setFooter({ text: `Result ${index + 1} of ${results.length} • Klipy` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`gf_prev:${index}`).setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(index === 0),
    new ButtonBuilder().setCustomId(`gf_send:${index}`).setLabel('✅ Send').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`gf_next:${index}`).setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(index === results.length - 1),
    new ButtonBuilder().setCustomId('gf_cancel').setLabel('✕').setStyle(ButtonStyle.Danger),
  );

  const payload = { embeds: [embed], components: [row] };
  const msg = initial ? await interaction.editReply(payload) : await interaction.update(payload);
  if (!initial) return;

  const collector = msg.createMessageComponentCollector({
    filter: i => i.user.id === interaction.user.id,
    time: 120_000,
  });

  collector.on('collect', async btn => {
    const [action, idxStr] = btn.customId.split(':');
    const newIndex = parseInt(idxStr);
    const cached = gifCache.get(interaction.user.id);
    if (!cached) return btn.update({ content: 'session expired ⏰', embeds: [], components: [] });

    if (action === 'gf_send') {
      const url = cached.results[newIndex]?.url || cached.results[newIndex]?.media_url;
      await btn.update({ content: url, embeds: [], components: [] });
      collector.stop();
    } else if (action === 'gf_prev') {
      await showGifResult(btn, cached.results, newIndex - 1, cached.query, cached.type);
    } else if (action === 'gf_next') {
      await showGifResult(btn, cached.results, newIndex + 1, cached.query, cached.type);
    } else if (action === 'gf_cancel') {
      await btn.update({ content: '❌ cancelled', embeds: [], components: [] });
      collector.stop();
    }
  });

  collector.on('end', (_, reason) => {
    if (reason === 'time') interaction.editReply({ components: [] }).catch(() => {});
  });
}
