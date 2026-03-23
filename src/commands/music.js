import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const YTDLP_PATH = 'yt-dlp';
const searchResultCache = new Map();

// ─── YouTube suggest API — returns in ~50ms, no key needed ───────────────────
async function getYouTubeSuggestions(query) {
  const url = `https://clients1.google.com/complete/search?client=youtube&hl=en&ds=yt&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(2000),
  });
  const text = await res.text();
  // Response format: window.google.ac.h(["query",["suggestion1","suggestion2",...]])
  const match = text.match(/\[\[.*?\]\]/s);
  if (!match) return [];
  const raw = JSON.parse(match[0]);
  return raw.map(item => item[0]).filter(Boolean).slice(0, 20);
}

// ─── yt-dlp search — only called on submit ───────────────────────────────────
async function ytSearch(query, limit = 8) {
  const { stdout } = await execFileAsync(YTDLP_PATH, [
    `ytsearch${limit}:${query}`,
    '--print', '%(id)s|--|%(title)s|--|%(uploader)s|--|%(duration_string)s|--|%(view_count)s|--|%(thumbnail)s',
    '--ignore-errors', '--no-playlist', '--no-warnings', '--quiet',
  ], { timeout: 15000 });
  return stdout.trim().split('\n').filter(Boolean).map(line => {
    const [id, title, uploader, duration, views, thumbnail] = line.split('|--|');
    return {
      id:        (id       || '').trim(),
      title:     (title    || 'Unknown').trim(),
      uploader:  (uploader || 'Unknown').trim(),
      duration:  (duration || '?:??').trim(),
      views:     parseInt(views) || 0,
      thumbnail: (thumbnail || '').trim(),
      url: `https://www.youtube.com/watch?v=${(id||'').trim()}`,
    };
  }).filter(r => r.id);
}

export default {
  data: new SlashCommandBuilder()
    .setName('music')
    .setDescription('Search YouTube and play music in your voice channel')
    .addStringOption(o =>
      o.setName('query')
        .setDescription('Song name, artist, or YouTube URL')
        .setRequired(true)
        .setAutocomplete(true)
    ),

  // ── Autocomplete: YouTube suggest API (~50ms) ─────────────────────────────
  async autocomplete(interaction) {
    const query = interaction.options.getFocused().trim();
    if (!query || query.length < 2) {
      return interaction.respond([{ name: 'Type a song name to search...', value: 'top songs' }]).catch(() => {});
    }
    try {
      const suggestions = await getYouTubeSuggestions(query);
      const choices = suggestions.map(s => ({ name: s.slice(0, 100), value: s.slice(0, 100) }));
      await interaction.respond(choices.length ? choices : [{ name: query, value: query }]).catch(() => {});
    } catch {
      await interaction.respond([{ name: query, value: query }]).catch(() => {});
    }
  },

  // ── Execute: yt-dlp for actual results ───────────────────────────────────
  async execute(interaction) {
    const query = interaction.options.getString('query');
    await interaction.deferReply();

    try {
      // Direct URL — play immediately
      if (query.includes('youtube.com') || query.includes('youtu.be')) {
        await interaction.editReply('🔗 Loading track...');
        const { play } = await import('../modules/music.js');
        await play(buildFakeMessage(interaction), query);
        return;
      }

      await interaction.editReply('🔍 Searching YouTube...');
      const results = await ytSearch(query, 8);
      if (!results.length) return interaction.editReply(`no results found for "${query}" 😔`);

      searchResultCache.set(interaction.user.id, { results, query });
      setTimeout(() => searchResultCache.delete(interaction.user.id), 120_000);

      await showResult(interaction, results, 0, query, true);
    } catch (err) {
      await interaction.editReply(`search failed 💀 — ${err.message}`);
    }
  },
};

async function showResult(interaction, results, index, query, initial = false) {
  const r = results[index];
  const embed = new EmbedBuilder()
    .setTitle(`🎵 "${query}"`)
    .setDescription(`**[${r.title}](${r.url})**`)
    .setThumbnail(r.thumbnail || null)
    .addFields(
      { name: '👤 Channel',  value: r.uploader,             inline: true },
      { name: '⏱ Duration', value: r.duration,              inline: true },
      { name: '👁 Views',   value: r.views.toLocaleString(), inline: true },
    )
    .setFooter({ text: `Result ${index + 1} of ${results.length}` })
    .setColor(0xff0000);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mu_prev:${index}`).setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(index === 0),
    new ButtonBuilder().setCustomId(`mu_play:${index}`).setLabel('▶ Play').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`mu_next:${index}`).setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(index === results.length - 1),
    new ButtonBuilder().setCustomId('mu_cancel').setLabel('✕').setStyle(ButtonStyle.Danger),
  );

  const payload = { embeds: [embed], components: [row] };
  const msg = initial
    ? await interaction.editReply(payload)
    : await interaction.update(payload);

  if (!initial) return;

  const collector = msg.createMessageComponentCollector({
    filter: i => i.user.id === interaction.user.id,
    time: 120_000,
  });

  collector.on('collect', async btn => {
    const [action, idxStr] = btn.customId.split(':');
    const newIndex = parseInt(idxStr);
    const cached = searchResultCache.get(interaction.user.id);
    if (!cached) return btn.update({ content: 'session expired ⏰', embeds: [], components: [] });

    if (action === 'mu_play') {
      await btn.update({ content: `▶ Loading **${cached.results[newIndex].title}**...`, embeds: [], components: [] });
      const { play } = await import('../modules/music.js');
      await play(buildFakeMessage(btn), cached.results[newIndex].url);
      collector.stop();
    } else if (action === 'mu_prev') {
      await showResult(btn, cached.results, newIndex - 1, cached.query);
    } else if (action === 'mu_next') {
      await showResult(btn, cached.results, newIndex + 1, cached.query);
    } else {
      await btn.update({ content: '❌ cancelled', embeds: [], components: [] });
      collector.stop();
    }
  });

  collector.on('end', (_, r) => {
    if (r === 'time') interaction.editReply({ components: [] }).catch(() => {});
  });
}

function buildFakeMessage(interaction) {
  return {
    guild:   interaction.guild,
    member:  interaction.member,
    channel: interaction.channel,
    author:  interaction.user,
    reply:   (m) => interaction.followUp(typeof m === 'string' ? { content: m } : m).catch(() => {}),
  };
}
