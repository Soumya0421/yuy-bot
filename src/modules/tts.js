/**
 * src/modules/tts.js — Text-to-Speech via ElevenLabs
 *
 * Two modes:
 *
 * 1. COMMAND TTS — /tts or "yuy say ..." → speaks any text on demand
 *    Uses ElevenLabs with Yuy's voice. Falls back to edge-tts if EL fails.
 *
 * 2. EMOTIONAL VOICE — automatic, triggered by dispatcher when AI sets send_voice:true
 *    Only fires on extremely emotional moments (crying, very excited, confession, etc.)
 *    Hard limit: ≤ 10 seconds of audio (enforced by trimming voice_text to ~100 chars)
 *    Sent as a Discord attachment alongside the text reply.
 *
 * ElevenLabs voice used: Rachel (warm, expressive female)
 * Voice ID can be overridden via ELEVENLABS_VOICE_ID in .env
 *
 * API: POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}
 *   Headers: xi-api-key: {key}, Content-Type: application/json
 *   Body: { text, model_id, voice_settings }
 *   Returns: audio/mpeg binary
 */

import { AttachmentBuilder } from 'discord.js';
import { checkCooldown } from '../utils/cooldown.js';
import { logger } from '../utils/logger.js';

// ElevenLabs voice IDs
const VOICE_IDS = {
  aerisita: 'pqHfZKP75CvOlQylNhV4', // Aerisita — bubbly, feminine, outgoing (Yuy's voice)
  rachel:   '21m00Tcm4TlvDq8ikWAM', // Rachel — warm, expressive
  bella:    'EXAVITQu4vr4xnSDxMaL', // Bella — soft, gentle
  elli:     'MF3mGyEYCl7XYWbV9V6O', // Elli — emotional range
  domi:     'AZnzlk1XvdvUeBnXmlld', // Domi — confident
};

// Use Aerisita by default — bubbly and feminine, perfect for Yuy
// Override via ELEVENLABS_VOICE_ID in .env
const DEFAULT_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || VOICE_IDS.aerisita;
const EL_API_KEY       = process.env.ELEVENLABS_API_KEY;

// Max chars before we risk exceeding 10 seconds
// ~12 chars/second at normal pace → 10s = ~120 chars. Use 100 for safety.
const MAX_VOICE_CHARS = 100;

// ── ElevenLabs TTS ────────────────────────────────────────────────────────────

/**
 * Generate speech using ElevenLabs API.
 * Returns a Buffer of mp3 audio, or throws on failure.
 *
 * @param {string} text         - text to speak (trimmed to MAX_VOICE_CHARS)
 * @param {string} voiceId      - ElevenLabs voice ID
 * @param {number} stability    - 0-1, lower = more expressive
 * @param {number} similarity   - 0-1, voice similarity boost
 */
async function generateElevenLabsAudio(text, voiceId = DEFAULT_VOICE_ID, stability = 0.4, similarity = 0.8) {
  if (!EL_API_KEY) throw new Error('ELEVENLABS_API_KEY not set in .env');

  // Enforce 10-second hard limit
  const trimmedText = text.slice(0, MAX_VOICE_CHARS);

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method:  'POST',
    headers: {
      'xi-api-key':   EL_API_KEY,
      'Content-Type': 'application/json',
      'Accept':       'audio/mpeg',
    },
    body: JSON.stringify({
      text:     trimmedText,
      model_id: 'eleven_multilingual_v2',  // supports Japanese words Yuy uses
      voice_settings: {
        stability,
        similarity_boost: similarity,
        style:           0.5,   // expressiveness 0-1
        use_speaker_boost: true,
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ElevenLabs API ${res.status}: ${body.slice(0, 120)}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length < 100) throw new Error('ElevenLabs returned empty audio');

  return buffer;
}

// ── Edge-TTS fallback ─────────────────────────────────────────────────────────

import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink, mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const execFileAsync = promisify(execFile);

async function generateEdgeTTSAudio(text, voice = 'en-US-AriaNeural') {
  const tmpDir  = await mkdtemp(join(tmpdir(), 'yuy-tts-'));
  const outFile = join(tmpDir, 'speech.mp3');

  await execFileAsync('edge-tts', [
    '--voice', voice,
    '--text', text.slice(0, MAX_VOICE_CHARS),
    '--write-media', outFile,
  ]);

  const { readFile } = await import('fs/promises');
  const buffer = await readFile(outFile);
  await unlink(outFile).catch(() => {});
  return buffer;
}

// ── Public: command TTS ───────────────────────────────────────────────────────

/**
 * Generate TTS on demand and send as Discord attachment.
 * Called by dispatcher for "tts" action or "yuy say ..." messages.
 */
export async function speak(message, text, voiceKey = 'default') {
  if (!text) return message.reply('what do you want me to say? 🗣️');

  const userId = message.author?.id || message.user?.id;
  const { limited, remaining } = checkCooldown(userId, 'tts', 10);
  if (limited) return message.reply(`wait ${remaining}s before using TTS again 🥱`);

  const thinking = await message.reply('🎙️ generating audio...');

  try {
    // Try ElevenLabs first
    const buffer     = await generateElevenLabsAudio(text);
    const attachment = new AttachmentBuilder(buffer, { name: 'yuy-says.mp3' });

    await thinking.edit({
      content: `🎙️ *${text.slice(0, 100)}${text.length > 100 ? '...' : ''}*`,
      files:   [attachment],
    });

  } catch (err) {
    logger.warn(`ElevenLabs TTS failed: ${err.message} — trying edge-tts`);

    try {
      const buffer     = await generateEdgeTTSAudio(text);
      const attachment = new AttachmentBuilder(buffer, { name: 'yuy-says.mp3' });
      await thinking.edit({
        content: `🎙️ *${text.slice(0, 100)}${text.length > 100 ? '...' : ''}*`,
        files:   [attachment],
      });
    } catch (err2) {
      logger.error(`TTS fallback also failed: ${err2.message}`);
      await thinking.edit(`TTS failed 💀 — ${err.message}`);
    }
  }
}

// ── Public: emotional voice burst ────────────────────────────────────────────

/**
 * Send a short emotional voice message alongside a chat reply.
 * Only called when AI explicitly sets send_voice:true in its JSON response.
 *
 * Rules:
 * - voice_text is trimmed to MAX_VOICE_CHARS (~10 seconds max)
 * - Higher instability (0.2) for more expressive delivery
 * - Sent as a follow-up attachment after the text reply
 * - Silently skipped if ElevenLabs is not configured or fails
 *
 * @param {object} message     - Discord message
 * @param {string} voiceText   - SHORT emotional line to speak (≤100 chars)
 */
export async function sendEmotionalVoice(message, voiceText) {
  if (!voiceText || !EL_API_KEY) return;

  const text = voiceText.slice(0, MAX_VOICE_CHARS);

  try {
    // Lower stability = more emotional, expressive delivery
    const buffer     = await generateElevenLabsAudio(text, DEFAULT_VOICE_ID, 0.2, 0.85);
    const attachment = new AttachmentBuilder(buffer, { name: 'yuy-voice.mp3' });

    // Send as a follow-up (not a reply) so it feels like Yuy adding a voice note
    await message.channel.send({ files: [attachment] });
    logger.info(`Emotional voice sent: "${text}"`);

  } catch (err) {
    // Silent failure — voice is a bonus, never block the conversation
    logger.warn(`Emotional voice failed (silent): ${err.message}`);
  }
}

// Export voice IDs so other modules can reference them
export { VOICE_IDS };
