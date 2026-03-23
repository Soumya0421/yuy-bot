/**
 * src/utils/supabase.js — Supabase Storage client
 *
 * Used ONLY for file storage (emoji images).
 * All structured data (history, users, servers, etc.) stays in Firebase Firestore.
 *
 * Why Supabase Storage over Firebase Storage:
 *   - Generous free tier (1GB storage, no credit card)
 *   - No setup required beyond creating a project + bucket
 *   - Simple REST API via @supabase/supabase-js
 *   - Public buckets give permanent CDN URLs with no expiry
 *
 * Setup (one-time):
 *   1. Go to https://supabase.com → New project
 *   2. Project settings → API → copy "Project URL" and "service_role" key
 *   3. Left sidebar → Storage → New bucket → name: "emojis" → Public: ON → Create
 *   4. Add to .env:
 *        SUPABASE_URL=https://xxxx.supabase.co
 *        SUPABASE_SERVICE_KEY=eyJ...
 *
 * Public URL format (permanent, no expiry):
 *   https://{project}.supabase.co/storage/v1/object/public/emojis/{guildId}/{name}.png
 */

import { createClient } from '@supabase/supabase-js';
import { logger } from './logger.js';

// ── Lazy client — only initialised when first used ───────────────────────────
// This way if SUPABASE_URL is not set, nothing breaks until someone actually
// tries to upload an emoji.

let _client = null;

function getClient() {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error(
      'Supabase not configured.\n' +
      'Add to .env:\n' +
      '  SUPABASE_URL=https://xxxx.supabase.co\n' +
      '  SUPABASE_SERVICE_KEY=eyJ...\n\n' +
      'Get these from: https://supabase.com → your project → Settings → API'
    );
  }

  // service_role key bypasses Row Level Security — safe for server-side use
  _client = createClient(url, key);
  return _client;
}

const BUCKET = 'emojis';

// ── Upload ────────────────────────────────────────────────────────────────────

/**
 * Upload an image buffer to Supabase Storage.
 * Returns a permanent public URL.
 *
 * @param {string} guildId
 * @param {string} name       - sanitized emoji name
 * @param {Buffer} buffer     - image data (resized to 128×128)
 * @param {string} mimeType   - 'image/png' | 'image/gif'
 * @returns {Promise<string>} - permanent public URL
 */
export async function uploadEmojiImage(guildId, name, buffer, mimeType = 'image/png') {
  const supabase = getClient();
  const ext      = mimeType === 'image/gif' ? 'gif' : 'png';
  const path     = `${guildId}/${name}.${ext}`;

  // upsert: true — overwrite if the same name already exists
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, {
      contentType:  mimeType,
      upsert:       true,
      cacheControl: '31536000', // cache 1 year
    });

  if (error) throw new Error(`Supabase upload failed: ${error.message}`);

  // Get the permanent public URL — no signed URL, no expiry
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  logger.info(`Emoji uploaded to Supabase: ${data.publicUrl}`);
  return data.publicUrl;
}

// ── Delete ────────────────────────────────────────────────────────────────────

/**
 * Delete an emoji image from Supabase Storage.
 * Tries both .png and .gif extensions.
 *
 * @param {string} guildId
 * @param {string} name
 */
export async function deleteEmojiImage(guildId, name) {
  const supabase = getClient();

  const paths = [
    `${guildId}/${name}.png`,
    `${guildId}/${name}.gif`,
  ];

  const { error } = await supabase.storage.from(BUCKET).remove(paths);
  if (error) logger.warn(`Supabase delete warn: ${error.message}`);
}
