/**
 * src/modules/imageGen.js — AI image generation via Pollinations.ai
 *
 * Supports:
 *   - Multiple style presets (anime, realistic, pixel, sketch, dark, pastel, etc.)
 *   - Aspect ratios: square, wide (16:9), tall (9:16), portrait, landscape
 *   - Auto-enhancement: prepends quality prompt words for better results
 *   - Up to 4 image variations in one command
 *   - Gallery: every generated image saved to Firebase for future recall
 *   - Full fallback chain across 3 Pollinations endpoints
 */

import { EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { checkCooldown } from '../utils/cooldown.js';
import { logger } from '../utils/logger.js';
import { db } from '../utils/firebase.js';
import admin from '../utils/firebase.js';

// ── Available models ──────────────────────────────────────────────────────────

export const IMAGE_MODELS = [
  { id: 'flux',         label: 'Flux (best quality, default)' },
  { id: 'flux-realism', label: 'Flux Realism (photorealistic)' },
  { id: 'flux-anime',   label: 'Flux Anime'                    },
  { id: 'flux-3d',      label: 'Flux 3D'                       },
  { id: 'turbo',        label: 'Turbo (fastest)'               },
];

// ── Style presets ─────────────────────────────────────────────────────────────
// Each preset prepends quality-boosting words to the user's prompt.

export const IMAGE_STYLES = {
  default:   '',
  anime:     'anime style, high quality anime art, detailed, ',
  realistic: 'photorealistic, ultra detailed, 8k, sharp focus, professional photography, ',
  pixel:     'pixel art, 16-bit, retro game style, detailed pixel art, ',
  sketch:    'pencil sketch, detailed hand-drawn illustration, hatching, ',
  dark:      'dark fantasy art, gothic, dramatic lighting, moody atmosphere, detailed, ',
  pastel:    'pastel colors, soft lighting, cute, kawaii aesthetic, gentle tones, ',
  watercolor:'watercolor painting, soft edges, artistic, beautiful color wash, ',
  '3d':      '3D rendered, octane render, volumetric lighting, ultra detailed, ',
  chibi:     'chibi style, super deformed, cute, big eyes, adorable, ',
  landscape: 'epic landscape, stunning scenery, wide angle, cinematic, detailed, ',
  portrait:  'portrait photography, detailed face, beautiful lighting, shallow depth of field, ',
};

// ── Aspect ratio dimensions ────────────────────────────────────────────────────

export const ASPECT_RATIOS = {
  square:    { w: 1024, h: 1024, label: '1:1 Square'    },
  wide:      { w: 1792, h: 1024, label: '16:9 Wide'     },
  tall:      { w: 1024, h: 1792, label: '9:16 Tall'     },
  portrait:  { w: 832,  h: 1216, label: '2:3 Portrait'  },
  landscape: { w: 1216, h: 832,  label: '3:2 Landscape' },
};

// ── Main generate function ────────────────────────────────────────────────────

/**
 * Generate one or more images and send them to Discord.
 *
 * @param {object} message         - Discord message or fake-message object
 * @param {string} prompt          - User's image description
 * @param {string} model           - Model ID (from IMAGE_MODELS)
 * @param {string} style           - Style preset key (from IMAGE_STYLES)
 * @param {string} ratio           - Aspect ratio key (from ASPECT_RATIOS)
 * @param {number} count           - Number of variations (1-4)
 * @param {boolean} enhance        - Whether to prepend quality words
 */
export async function generateImage(
  message,
  prompt,
  model    = 'flux',
  style    = 'default',
  ratio    = 'square',
  count    = 1,
  enhance  = true,
) {
  if (!prompt) return message.reply('give me a prompt! 🎨');

  const userId  = message.author?.id || message.user?.id;
  const guildId = message.guild?.id;

  // Cooldown: 15s per user (longer for multiple images)
  const cooldownSecs = count > 1 ? 30 : 15;
  const { limited, remaining } = checkCooldown(userId, 'imagine', cooldownSecs);
  if (limited) return message.reply(`wait ${remaining}s before generating again 🥱`);

  const thinking = await message.reply(
    `🎨 generating ${count > 1 ? `${count} variations of` : ''} **${prompt.slice(0, 60)}${prompt.length > 60 ? '…' : ''}**...`
  );

  // Build the final prompt with style prefix and optional enhancement
  const stylePrefix  = IMAGE_STYLES[style] || '';
  const qualityWords = enhance && !stylePrefix.includes('quality')
    ? 'masterpiece, best quality, highly detailed, '
    : '';
  const fullPrompt   = `${stylePrefix}${qualityWords}${prompt}`;

  const { w, h } = ASPECT_RATIOS[ratio] || ASPECT_RATIOS.square;
  const apiKey    = process.env.POLLINATIONS_TOKEN;

  // Generate all requested variations
  const results = await Promise.allSettled(
    Array.from({ length: count }, (_, i) =>
      generateSingle(fullPrompt, model, w, h, apiKey, i)
    )
  );

  const successful = results
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value);

  if (!successful.length) {
    await thinking.edit(
      `image generation failed 💀 — all endpoints failed.\n\n` +
      `**Fix:** Visit **https://pollinations.ai** → sign in → get an API token → add to \`.env\` as \`POLLINATIONS_TOKEN=your_key\``
    );
    return;
  }

  // Build the response embed
  const ratioInfo = ASPECT_RATIOS[ratio] || ASPECT_RATIOS.square;
  const styleInfo = style !== 'default' ? ` • Style: ${style}` : '';

  if (successful.length === 1) {
    // Single image: use an embed with a large preview
    const { buffer, url } = successful[0];
    const attachment = new AttachmentBuilder(buffer, { name: 'yuy-image.png' });
    const embed = new EmbedBuilder()
      .setTitle('🎨 Image Generated')
      .setDescription(`**Prompt:** ${prompt.slice(0, 300)}`)
      .setImage('attachment://yuy-image.png')
      .setColor(0x5865f2)
      .setFooter({ text: `Model: ${model} • ${ratioInfo.label}${styleInfo} • Pollinations.ai` })
      .setTimestamp();

    await thinking.edit({ content: '', embeds: [embed], files: [attachment] });

  } else {
    // Multiple images: send as a grid of attachments
    const files = successful.map((r, i) =>
      new AttachmentBuilder(r.buffer, { name: `yuy-image-${i + 1}.png` })
    );
    const embed = new EmbedBuilder()
      .setTitle(`🎨 ${successful.length} Variations Generated`)
      .setDescription(`**Prompt:** ${prompt.slice(0, 300)}`)
      .setColor(0x5865f2)
      .setFooter({ text: `Model: ${model} • ${ratioInfo.label}${styleInfo} • Pollinations.ai` })
      .setTimestamp();

    await thinking.edit({ content: '', embeds: [embed], files });
  }

  // Save to Firebase gallery (non-blocking)
  if (guildId) {
    const galleryData = {
      userId,
      username:  message.author?.username || message.user?.username || 'unknown',
      guildId,
      prompt,
      fullPrompt,
      model,
      style,
      ratio,
      count:     successful.length,
      width:     w,
      height:    h,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    db.collection('image_gallery').add(galleryData).catch(() => {});
  }

  logger.success(`Generated ${successful.length}/${count} images for: "${prompt.slice(0, 50)}"`);
}

// ── Generate a single image ───────────────────────────────────────────────────

async function generateSingle(prompt, model, width, height, apiKey, index = 0) {
  // Use different seeds for each variation so they're actually different
  const seed     = Math.floor(Math.random() * 999999) + index * 1000;
  const encoded  = encodeURIComponent(prompt);

  // Endpoint fallback chain
  const endpoints = [
    // 1. Authenticated endpoint (best quality, needs token)
    ...(apiKey ? [{
      label: 'image.pollinations.ai (auth)',
      url:   `https://image.pollinations.ai/prompt/${encoded}?model=${model}&width=${width}&height=${height}&seed=${seed}&nologo=true&token=${apiKey}`,
    }] : []),
    // 2. Anonymous Pollinations (always works, may have rate limits)
    {
      label: 'pollinations.ai/p (anonymous)',
      url:   `https://pollinations.ai/p/${encoded}?model=${model}&width=${width}&height=${height}&seed=${seed}&nologo=true`,
    },
    // 3. Legacy image endpoint
    {
      label: 'image.pollinations.ai (legacy)',
      url:   `https://image.pollinations.ai/prompt/${encoded}?model=${model}&width=${width}&height=${height}&seed=${seed}&nologo=true`,
    },
  ];

  for (const ep of endpoints) {
    try {
      logger.info(`Image: trying ${ep.label}`);

      const controller = new AbortController();
      const timeout    = setTimeout(() => controller.abort(), 60_000);

      const res = await fetch(ep.url, {
        signal:  controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Accept':     'image/webp,image/png,image/*,*/*',
        },
      });
      clearTimeout(timeout);

      if (!res.ok) {
        logger.warn(`${ep.label} → HTTP ${res.status}`);
        continue;
      }

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.startsWith('image/')) {
        logger.warn(`${ep.label} → not an image (${contentType})`);
        continue;
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length < 1000) {
        logger.warn(`${ep.label} → buffer too small (${buffer.length}b)`);
        continue;
      }

      logger.success(`Image OK via ${ep.label} (${buffer.length} bytes)`);
      return { buffer, url: ep.url };

    } catch (err) {
      logger.warn(`${ep.label} → ${err.message?.slice(0, 60)}`);
    }
  }

  return null; // all endpoints failed for this variation
}
