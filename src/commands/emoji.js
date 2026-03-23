/**
 * src/commands/emoji.js — Custom emoji store using Firebase Storage
 *
 * No Discord guild emoji API. No server permissions needed.
 *
 * HOW IT WORKS:
 *   1. User attaches an image (or provides a URL/existing emoji)
 *   2. sharp resizes it to 128×128 PNG (or keeps GIF animated)
 *   3. Image is uploaded to Firebase Storage → permanent public URL
 *   4. URL + metadata saved to Firestore: custom_emojis/{guildId}/emojis/{name}
 *   5. /emoji use name:wave → Yuy sends the image in an embed
 *   6. /emoji list → paginated gallery with thumbnails
 *
 * Works via:
 *   /emoji add  name:wave  + image attachment (or value for text shortcuts)
 *   /emoji use  name:wave
 *   /emoji list
 *   /emoji delete name:wave
 *   /emoji browse  (server's built-in Discord emojis)
 *
 * Also via natural language:
 *   "yuy add as emoji name:wave" + image attached
 *
 * Firebase Storage path: emojis/{guildId}/{name}.png
 * Firestore: custom_emojis/{guildId}/emojis/{name}
 *   { name, url, type: 'image'|'text', mimeType, width, height, addedBy, ... }
 *
 * SETUP:
 *   1. npm install sharp
 *   2. Enable Firebase Storage in Firebase Console:
 *      Project → Build → Storage → Get started → Start in production mode
 *   3. Set storage rules to allow public reads:
 *      rules_version = '2';
 *      service firebase.storage {
 *        match /b/{bucket}/o {
 *          match /emojis/{allPaths=**} {
 *            allow read: if true;
 *            allow write: if false;
 *          }
 *        }
 *      }
 */

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
} from 'discord.js';
import { db } from '../utils/firebase.js';
import { uploadEmojiImage, deleteEmojiImage } from '../utils/supabase.js';
import admin from '../utils/firebase.js';
import { logger } from '../utils/logger.js';

const PAGE_SIZE = 9; // 3×3 grid of thumbnails in embeds

// ── Firestore helpers ─────────────────────────────────────────────────────────

function emojiRef(guildId) {
  return db.collection('custom_emojis').doc(guildId).collection('emojis');
}

export async function getCustomEmoji(guildId, name) {
  const doc = await emojiRef(guildId).doc(name.toLowerCase()).get();
  return doc.exists ? doc.data() : null;
}

export async function getAllCustomEmojis(guildId) {
  const snap = await emojiRef(guildId).orderBy('createdAt', 'desc').get();
  return snap.docs.map(d => d.data());
}

// ── Sanitize emoji name ───────────────────────────────────────────────────────

function sanitizeName(raw) {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
}

// ── Image → resized buffer via sharp ─────────────────────────────────────────

/**
 * Fetch an image from a URL, resize to 128×128, return { buffer, mimeType }.
 * Uses sharp for processing. GIFs are kept animated (not resized by sharp,
 * passed through as-is since animated GIF resizing requires giflib).
 *
 * @param {string} url
 * @returns {Promise<{ buffer: Buffer, mimeType: string, width: number, height: number }>}
 */
async function processImage(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image: HTTP ${res.status}`);

  const rawBuffer  = Buffer.from(await res.arrayBuffer());
  const mimeType   = res.headers.get('content-type') || 'image/png';

  // Animated GIF: pass through without resizing (sharp doesn't support animated GIF resize)
  if (mimeType === 'image/gif') {
    return { buffer: rawBuffer, mimeType: 'image/gif', width: 128, height: 128 };
  }

  // Static images: resize to 128×128 with sharp
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    throw new Error('sharp not installed. Run: npm install sharp');
  }

  const processed = await sharp(rawBuffer)
    .resize(128, 128, {
      fit:        'contain',        // fit within 128×128, preserving aspect ratio
      background: { r: 0, g: 0, b: 0, alpha: 0 }, // transparent background
    })
    .png()                          // always output as PNG for consistency
    .toBuffer();

  return { buffer: processed, mimeType: 'image/png', width: 128, height: 128 };
}

// ── Store emoji to Firebase ───────────────────────────────────────────────────

/**
 * Full pipeline: fetch → resize → upload to Storage → save to Firestore.
 * Returns the Firestore emoji data object.
 */
export async function storeImageEmoji(guildId, name, imageUrl, userId, username) {
  // 1. Fetch and resize
  const { buffer, mimeType, width, height } = await processImage(imageUrl);

  // 2. Upload to Firebase Storage → get permanent public URL
  const publicUrl = await uploadEmojiImage(guildId, name, buffer, mimeType);

  // 3. Save metadata to Firestore
  const emojiData = {
    name,
    url:         publicUrl,
    type:        'image',
    mimeType,
    width,
    height,
    originalUrl: imageUrl,
    addedBy:     userId,
    addedByName: username,
    createdAt:   admin.firestore.FieldValue.serverTimestamp(),
  };

  await emojiRef(guildId).doc(name).set(emojiData);
  logger.info(`Emoji stored: :${name}: → ${publicUrl}`);

  return emojiData;
}

// ── Command Definition ────────────────────────────────────────────────────────

export default {
  data: new SlashCommandBuilder()
    .setName('emoji')
    .setDescription('Custom emoji store — upload images, use them anywhere')

    // browse
    .addSubcommand(sub =>
      sub.setName('browse')
        .setDescription('Browse this server\'s built-in Discord emojis')
        .addStringOption(o =>
          o.setName('query').setDescription('Search by name').setRequired(false).setAutocomplete(true)
        )
    )

    // add
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Upload an image as a custom emoji (stored in Firebase)')
        .addStringOption(o =>
          o.setName('name').setDescription('Emoji name (letters, numbers, underscores)').setRequired(true)
        )
        .addAttachmentOption(o =>
          o.setName('image').setDescription('Image to use as emoji (PNG/JPG/GIF, any size — auto-resized to 128×128)').setRequired(false)
        )
        .addStringOption(o =>
          o.setName('value').setDescription('Text shortcut value (if no image)').setRequired(false)
        )
    )

    // use
    .addSubcommand(sub =>
      sub.setName('use')
        .setDescription('Send a stored custom emoji')
        .addStringOption(o =>
          o.setName('name').setDescription('Emoji name').setRequired(true).setAutocomplete(true)
        )
    )

    // list
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('Show all custom emojis stored for this server')
    )

    // delete
    .addSubcommand(sub =>
      sub.setName('delete')
        .setDescription('Delete a custom emoji')
        .addStringOption(o =>
          o.setName('name').setDescription('Emoji name').setRequired(true).setAutocomplete(true)
        )
    ),

  // ── Autocomplete ─────────────────────────────────────────────────────────────
  async autocomplete(interaction) {
    // getSubcommand() throws if no subcommand is active yet — always wrap in try/catch
    let sub;
    try {
      sub = interaction.options.getSubcommand();
    } catch {
      return interaction.respond([]).catch(() => {});
    }

    const focused = interaction.options.getFocused().toLowerCase().trim();

    if (sub === 'browse') {
      const emojis   = [...interaction.guild.emojis.cache.values()];
      const filtered = focused ? emojis.filter(e => e.name.toLowerCase().includes(focused)) : emojis;
      return interaction.respond(
        filtered.slice(0, 25).map(e => ({ name: `:${e.name}:${e.animated ? ' (animated)' : ''}`, value: e.name }))
      ).catch(() => {});
    }

    if (sub === 'use' || sub === 'delete') {
      try {
        const snap     = await emojiRef(interaction.guild.id).orderBy('name').limit(100).get();
        const all      = snap.docs.map(d => d.data());
        const filtered = focused ? all.filter(e => e.name.includes(focused)) : all;
        return interaction.respond(
          filtered.slice(0, 25).map(e => ({
            name:  `${e.type === 'image' ? '🖼️' : '💬'} ${e.name}`,
            value: e.name,
          }))
        ).catch(() => {});
      } catch {
        return interaction.respond([]).catch(() => {});
      }
    }

    // Any other subcommand — return empty safely
    return interaction.respond([]).catch(() => {});
  },

  // ── Execute ───────────────────────────────────────────────────────────────────
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    switch (sub) {

      // ── BROWSE (Discord server emojis) ───────────────────────────────────────
      case 'browse': {
        const query    = interaction.options.getString('query')?.toLowerCase().trim() || '';
        const allEmoji = [...interaction.guild.emojis.cache.values()];
        const results  = query ? allEmoji.filter(e => e.name.toLowerCase().includes(query)) : allEmoji;

        await interaction.deferReply();
        if (!results.length) return interaction.editReply(`no emojis found${query ? ` matching "${query}"` : ''} 😔`);
        await showBrowsePage(interaction, results, 0, query, true);
        break;
      }

      // ── ADD (image → Firebase Storage OR text shortcut) ──────────────────────
      case 'add': {
        const rawName    = interaction.options.getString('name');
        const attachment = interaction.options.getAttachment('image');
        const textValue  = interaction.options.getString('value');
        const name       = sanitizeName(rawName);

        if (name.length < 2) {
          return interaction.reply({
            content: '❌ Name too short. Use at least 2 letters/numbers/underscores.',
            ephemeral: true,
          });
        }

        await interaction.deferReply();

        // ── PATH A: Image → Firebase Storage ──────────────────────────────────
        if (attachment) {
          if (!attachment.contentType?.startsWith('image/')) {
            return interaction.editReply(`❌ That file isn't an image (${attachment.contentType || 'unknown'}). Please attach a PNG, JPG, or GIF.`);
          }

          const thinking = await interaction.editReply(`🖼️ processing \`:${name}:\`...`);

          try {
            const emojiData = await storeImageEmoji(
              interaction.guild.id,
              name,
              attachment.url,
              interaction.user.id,
              interaction.user.username
            );

            const embed = new EmbedBuilder()
              .setTitle('✅ Custom Emoji Saved!')
              .setDescription(
                `**:${name}:** has been stored!\n\n` +
                `Use it with \`/emoji use name:${name}\`\n` +
                `Or say \`yuy use emoji ${name}\` in chat~`
              )
              .setThumbnail(emojiData.url)
              .addFields(
                { name: 'Name',     value: `:${name}:`,                       inline: true },
                { name: 'Size',     value: `${emojiData.width}×${emojiData.height}px`, inline: true },
                { name: 'Added by', value: interaction.user.username,          inline: true },
              )
              .setColor(0x57f287)
              .setTimestamp();

            await interaction.editReply({ content: '', embeds: [embed] });

          } catch (err) {
            logger.error(`Emoji store failed: ${err.message}`);
            let msg = `❌ Failed to store emoji: ${err.message}`;
            if (err.message.includes('sharp not installed')) {
              msg = '❌ `sharp` is not installed. Run `npm install sharp` then restart Yuy.';
            } else if (err.message.includes('Supabase not configured')) {
              msg = '❌ Supabase not set up yet!\n\n**Steps:**\n1. Go to [supabase.com](https://supabase.com) → New project\n2. Storage → New bucket → name: `emojis` → Public: ON\n3. Settings → API → copy Project URL + service_role key\n4. Add to `.env`: `SUPABASE_URL=` and `SUPABASE_SERVICE_KEY=`\n5. Restart Yuy';
            }
            await interaction.editReply(msg);
          }
          break;
        }

        // ── PATH B: Text shortcut ──────────────────────────────────────────────
        if (!textValue) {
          return interaction.editReply(
            '❌ Provide either:\n' +
            '• An **image attachment** to store as a custom emoji\n' +
            '• A **value** to store as a text shortcut\n\n' +
            'Examples:\n' +
            '`/emoji add name:wave` + attach image\n' +
            '`/emoji add name:gg value:🎉 GG everyone!!`'
          );
        }

        try {
          await emojiRef(interaction.guild.id).doc(name).set({
            name,
            value:       textValue,
            type:        'text',
            addedBy:     interaction.user.id,
            addedByName: interaction.user.username,
            createdAt:   admin.firestore.FieldValue.serverTimestamp(),
          });

          const embed = new EmbedBuilder()
            .setTitle('✅ Text Shortcut Saved')
            .addFields(
              { name: 'Name',     value: `\`${name}\``,             inline: true },
              { name: 'Value',    value: textValue,                  inline: true },
              { name: 'Added by', value: interaction.user.username,  inline: true },
            )
            .setDescription(`Use it with \`/emoji use name:${name}\``)
            .setColor(0x57f287);

          await interaction.editReply({ embeds: [embed] });
        } catch (err) {
          await interaction.editReply(`Failed to save 💀 — ${err.message}`);
        }
        break;
      }

      // ── USE ──────────────────────────────────────────────────────────────────
      case 'use': {
        const name = interaction.options.getString('name').toLowerCase().trim();
        await interaction.deferReply();

        try {
          const emoji = await getCustomEmoji(interaction.guild.id, name);

          if (!emoji) {
            return interaction.editReply(`no custom emoji found for \`:${name}:\` 😔\nUse \`/emoji list\` to see what's saved.`);
          }

          if (emoji.type === 'image') {
            // Send as embed with the image displayed large
            const embed = new EmbedBuilder()
              .setImage(emoji.url)
              .setFooter({ text: `:${name}: • added by ${emoji.addedByName || 'unknown'}` })
              .setColor(0x5865f2);
            await interaction.editReply({ embeds: [embed] });
          } else {
            // Text shortcut — just send the value
            await interaction.editReply(emoji.value);
          }
        } catch (err) {
          await interaction.editReply(`Couldn't fetch emoji 💀 — ${err.message}`);
        }
        break;
      }

      // ── LIST ─────────────────────────────────────────────────────────────────
      case 'list': {
        await interaction.deferReply();

        try {
          const emojis = await getAllCustomEmojis(interaction.guild.id);

          if (!emojis.length) {
            return interaction.editReply(
              `no custom emojis yet!\n\n` +
              `**Add one:** \`/emoji add name:wave\` + attach an image~`
            );
          }

          await showEmojiListPage(interaction, emojis, 0, true);
        } catch (err) {
          await interaction.editReply(`Couldn't load list 💀 — ${err.message}`);
        }
        break;
      }

      // ── DELETE ───────────────────────────────────────────────────────────────
      case 'delete': {
        const name = interaction.options.getString('name').toLowerCase().trim();
        await interaction.deferReply({ ephemeral: true });

        try {
          const doc = await emojiRef(interaction.guild.id).doc(name).get();
          if (!doc.exists) return interaction.editReply(`\`${name}\` doesn't exist 😔`);

          const data    = doc.data();
          const isOwner = interaction.guild.ownerId === interaction.user.id;
          const isAdmin = interaction.member.permissions.has('Administrator');
          const isAdder = data.addedBy === interaction.user.id;

          if (!isOwner && !isAdmin && !isAdder) {
            return interaction.editReply(`you can't delete \`${name}\` — only the person who added it or admins can!`);
          }

          // Delete from Firestore
          await emojiRef(interaction.guild.id).doc(name).delete();

          // Delete image from Firebase Storage if it's an image emoji
          if (data.type === 'image') {
            await deleteEmojiImage(interaction.guild.id, name).catch(() => {});
          }

          await interaction.editReply(`✅ Deleted \`:${name}:\`${data.type === 'image' ? ' (image removed from storage)' : ''}`);
        } catch (err) {
          await interaction.editReply(`Failed to delete 💀 — ${err.message}`);
        }
        break;
      }
    }
  },
};

// ── List pagination with thumbnails ──────────────────────────────────────────

const listCache = new Map();

async function showEmojiListPage(interaction, emojis, page, initial = false) {
  const totalPages = Math.ceil(emojis.length / PAGE_SIZE);
  const slice      = emojis.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Separate images and text shortcuts
  const imageEmojis = slice.filter(e => e.type === 'image');
  const textEmojis  = slice.filter(e => e.type === 'text');

  const embed = new EmbedBuilder()
    .setTitle(`✨ Custom Emojis — ${interaction.guild?.name || 'Server'} (${emojis.length})`)
    .setColor(0x5865f2)
    .setFooter({ text: `Page ${page + 1} of ${totalPages} • /emoji use name:X to send` });

  // Image emojis: show as thumbnail grid description
  if (imageEmojis.length) {
    const lines = imageEmojis.map(e =>
      `🖼️ **:${e.name}:** [view](${e.url}) *(${e.addedByName || 'unknown'})*`
    );
    embed.addFields({ name: '🖼️ Image Emojis', value: lines.join('\n') });

    // Show the first image emoji as embed image for preview
    if (imageEmojis[0]) embed.setImage(imageEmojis[0].url);
  }

  // Text shortcuts
  if (textEmojis.length) {
    const lines = textEmojis.map(e =>
      `💬 \`${e.name}\` → ${e.value} *(${e.addedByName || 'unknown'})*`
    );
    embed.addFields({ name: '💬 Text Shortcuts', value: lines.join('\n') });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`em_list_prev:${page}`).setLabel('◀ Prev')
      .setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(`em_list_next:${page}`).setLabel('Next ▶')
      .setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1),
  );

  const payload = { embeds: [embed], components: totalPages > 1 ? [row] : [] };

  if (!initial) {
    await interaction.update(payload);
    return;
  }

  const msg = await interaction.editReply(payload);
  if (totalPages <= 1) return;

  listCache.set(interaction.user.id, emojis);
  setTimeout(() => listCache.delete(interaction.user.id), 120_000);

  const collector = msg.createMessageComponentCollector({
    filter: i => i.user.id === interaction.user.id,
    time:   120_000,
  });

  collector.on('collect', async btn => {
    const [, pageStr] = btn.customId.split(':');
    const curPage  = parseInt(pageStr);
    const cached   = listCache.get(interaction.user.id);
    if (!cached) return btn.update({ content: 'session expired ⏰', embeds: [], components: [] });

    const newPage = btn.customId.startsWith('em_list_prev') ? curPage - 1 : curPage + 1;
    await showEmojiListPage(btn, cached, newPage);
  });

  collector.on('end', () => {
    interaction.editReply({ components: [] }).catch(() => {});
  });
}

// ── Browse pagination (Discord server emojis) ─────────────────────────────────

const browseCache = new Map();
const BROWSE_PAGE = 20;

async function showBrowsePage(interaction, results, page, query, initial = false) {
  const totalPages = Math.ceil(results.length / BROWSE_PAGE);
  const slice      = results.slice(page * BROWSE_PAGE, (page + 1) * BROWSE_PAGE);

  const lines = slice.map(e =>
    `${e.toString()} — \`:${e.name}:\`${e.animated ? ' *(animated)*' : ''}`
  );

  const embed = new EmbedBuilder()
    .setTitle(`😀 Server Emojis${query ? ` — "${query}"` : ''} (${results.length})`)
    .setDescription(lines.join('\n') || 'none')
    .setFooter({ text: `Page ${page + 1} of ${totalPages}` })
    .setColor(0x5865f2);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`em_prev:${page}`).setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId(`em_copy:${page}`).setLabel('📋 Copy Names').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`em_next:${page}`).setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1),
  );

  const payload = { embeds: [embed], components: [row] };

  if (!initial) { await interaction.update(payload); return; }

  const msg = await interaction.editReply(payload);
  browseCache.set(interaction.user.id, { results, query });
  setTimeout(() => browseCache.delete(interaction.user.id), 120_000);

  const collector = msg.createMessageComponentCollector({
    filter: i => i.user.id === interaction.user.id,
    time:   120_000,
  });

  collector.on('collect', async btn => {
    const [action, pageStr] = btn.customId.split(':');
    const curPage = parseInt(pageStr);
    const cached  = browseCache.get(interaction.user.id);
    if (!cached) return btn.update({ content: 'session expired ⏰', embeds: [], components: [] });

    if (action === 'em_prev') await showBrowsePage(btn, cached.results, curPage - 1, cached.query);
    else if (action === 'em_next') await showBrowsePage(btn, cached.results, curPage + 1, cached.query);
    else if (action === 'em_copy') {
      const names = cached.results.slice(curPage * BROWSE_PAGE, (curPage + 1) * BROWSE_PAGE).map(e => `:${e.name}:`).join(' ');
      await btn.reply({ content: `📋 **Page ${curPage + 1}:**\n${names}`, ephemeral: true });
    }
  });

  collector.on('end', () => { interaction.editReply({ components: [] }).catch(() => {}); });
}
