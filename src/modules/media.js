import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { logger } from '../utils/logger.js';

const KLIPY_BASE = 'https://api.klipy.com/v2/search';
const API_KEY = process.env.KLIPY_API_KEY;

/**
 * Search and send media from Klipy
 * @param {object} message
 * @param {'gif'|'meme'|'sticker'|'clip'} subtype
 * @param {string} query
 * @param {boolean} auto - if true, send first result directly (no picker, for Yuy's autonomous actions)
 */
export async function sendMedia(message, subtype = 'gif', query, auto = false) {
  if (!query) return message.reply(`what ${subtype} do you want? give me a keyword 👀`);

  // For auto mode, send silently without a loading message
  const thinking = auto ? null : await message.reply(`🔍 searching for **${query}** ${subtype}s...`);

  try {
    const results = await searchKlipy(subtype, query);

    if (!results || results.length === 0) {
      if (!auto) await thinking.edit(`couldn't find any ${subtype}s for "${query}" 😔`);
      return;
    }

    if (auto) {
      // ── Auto mode: pick a random result from top 5 and send directly ────────
      const pick = results[Math.floor(Math.random() * Math.min(5, results.length))];
      const mediaUrl = pick?.url || pick?.media_url || null;
      if (mediaUrl) {
        await message.channel.send(mediaUrl);
      }
    } else {
      // ── Manual mode: show paginated picker ───────────────────────────────────
      await showPicker(thinking, message, results, subtype, query, 0);
    }

  } catch (err) {
    logger.error(`Klipy error: ${err.message}`);
    if (!auto) await thinking.edit(`klipy search failed 💀 — ${err.message}`);
  }
}

async function searchKlipy(subtype, query) {
  const prefixMap = { gif: '', meme: 'meme', sticker: 'sticker', clip: 'clip' };
  const prefix = prefixMap[subtype] ?? '';
  const fullQuery = prefix ? `${prefix} ${query}` : query;

  const url = `${KLIPY_BASE}?q=${encodeURIComponent(fullQuery)}&key=${API_KEY}&limit=8`;
  const res = await fetch(url);
  const text = await res.text();

  if (!res.ok) throw new Error(`Klipy API ${res.status}: ${text.slice(0, 120)}`);
  if (!text?.trim()) throw new Error('Klipy returned empty response');

  const data = JSON.parse(text);
  return data.results || [];
}

async function showPicker(message, original, results, subtype, query, index) {
  const item = results[index];
  const mediaUrl = item?.url || item?.media_url || null;

  if (!mediaUrl) {
    return message.edit(`couldn't get media URL for result #${index + 1} 😔`);
  }

  const embed = new EmbedBuilder()
    .setTitle(`${subtypeEmoji(subtype)} ${subtype.toUpperCase()} — "${query}"`)
    .setImage(mediaUrl)
    .setColor(0x5865f2)
    .setFooter({ text: `Result ${index + 1} of ${results.length}` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`media_prev:${index}`).setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(index === 0),
    new ButtonBuilder().setCustomId(`media_send:${index}`).setLabel('✅ Send').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`media_next:${index}`).setLabel('▶ Next').setStyle(ButtonStyle.Secondary).setDisabled(index === results.length - 1),
    new ButtonBuilder().setCustomId('media_cancel').setLabel('❌ Cancel').setStyle(ButtonStyle.Danger),
  );

  await message.edit({ content: '', embeds: [embed], components: [row] });

  const collector = message.createMessageComponentCollector({
    filter: i => i.user.id === original.author.id,
    time: 30_000,
    max: 1,
  });

  collector.on('collect', async interaction => {
    const [action, idx] = interaction.customId.split(':');
    const newIndex = parseInt(idx);

    if (action === 'media_send') {
      await interaction.update({ content: mediaUrl, embeds: [], components: [] });
    } else if (action === 'media_prev') {
      await interaction.deferUpdate();
      await showPicker(message, original, results, subtype, query, newIndex - 1);
    } else if (action === 'media_next') {
      await interaction.deferUpdate();
      await showPicker(message, original, results, subtype, query, newIndex + 1);
    } else if (action === 'media_cancel') {
      await interaction.update({ content: '❌ cancelled', embeds: [], components: [] });
    }
  });

  collector.on('end', (_, reason) => {
    if (reason === 'time') message.edit({ components: [] }).catch(() => {});
  });
}

function subtypeEmoji(subtype) {
  return { gif: '🎬', meme: '😂', sticker: '🩹', clip: '🎞️' }[subtype] || '🎬';
}
