/**
 * src/utils/firebase.js — Firestore database layer
 *
 * Initializes Firebase Admin SDK (works locally via firebase-key.json,
 * and in production via environment variables). Provides typed helper
 * functions for all database operations Yuy needs.
 *
 * Collections:
 *   users/       — per-user profile, XP, coins, badges, preferences
 *   servers/     — per-guild settings, channel IDs, default model
 *   history/     — per-guild per-channel conversation history
 *   audit_logs/  — moderation action log
 *   messages/    — full message metadata (thoughts, emotions, intent)
 *
 * Local setup:
 *   Place firebase-key.json in the project root (same folder as package.json).
 *   Never commit this file — it's in .gitignore.
 */

import admin from 'firebase-admin';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Initialize Firebase (once) ───────────────────────────────────────────────

if (!admin.apps.length) {
  let credential;

  if (process.env.FIREBASE_PRIVATE_KEY) {
    // Production / CI — credentials come from environment variables
    credential = admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    });
  } else {
    // Local development — read service account key from file
    const keyPath = join(__dirname, '../../firebase-key.json');
    if (!existsSync(keyPath)) {
      throw new Error(
        'Firebase not configured.\n' +
        'For local use: place firebase-key.json in the project root.\n' +
        'For production: set FIREBASE_PRIVATE_KEY in environment variables.'
      );
    }
    const serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'));
    credential = admin.credential.cert(serviceAccount);
  }

  admin.initializeApp({ credential, storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'yuy-bot.appspot.com' });
}

export const db = admin.firestore();
export default admin;

// ─── User Operations ──────────────────────────────────────────────────────────

/**
 * Get a user document, creating it with defaults if it doesn't exist.
 * @param {string} userId    - Discord user ID
 * @param {string} username  - Discord username (for display)
 */
export async function getUser(userId, username = '') {
  const ref  = db.collection('users').doc(userId);
  const snap = await ref.get();

  if (!snap.exists) {
    const data = {
      username,
      xp:             0,
      level:          1,
      coins:          0,
      rep:            0,
      lastCheckIn:    null,
      preferredModel: 'groq',
      bio:            '',
      badges:         [],
      createdAt:      admin.firestore.FieldValue.serverTimestamp(),
    };
    await ref.set(data);
    return data;
  }

  return snap.data();
}

/**
 * Merge-update specific fields on a user document.
 * @param {string} userId
 * @param {object} fields - partial update, e.g. { xp: 150, coins: 25 }
 */
export async function updateUser(userId, fields) {
  await db.collection('users').doc(userId).set(fields, { merge: true });
}

// ─── Server Operations ────────────────────────────────────────────────────────

/**
 * Get a server (guild) document, creating it with defaults if needed.
 * @param {string} guildId
 */
export async function getServer(guildId) {
  const ref  = db.collection('servers').doc(guildId);
  const snap = await ref.get();

  if (!snap.exists) {
    const data = {
      defaultModel: 'groq',
      nsfw:         true,
      channels:     {},  // { welcome, levelup, status, log, ... }
      settings:     {},
      createdAt:    admin.firestore.FieldValue.serverTimestamp(),
    };
    await ref.set(data);
    return data;
  }

  return snap.data();
}

/**
 * Merge-update specific fields on a server document.
 * @param {string} guildId
 * @param {object} fields
 */
export async function updateServer(guildId, fields) {
  await db.collection('servers').doc(guildId).set(fields, { merge: true });
}

// ─── Conversation History ─────────────────────────────────────────────────────

/**
 * Append a message to conversation history.
 * Stored per guild, per channel so context is channel-scoped.
 *
 * @param {string} guildId
 * @param {string} channelId
 * @param {'user'|'assistant'} role
 * @param {string} content
 * @param {string|null} modelUsed  - e.g. 'groq', 'gemini'
 */
export async function saveHistory(guildId, channelId, role, content, modelUsed = null) {
  await db
    .collection('history').doc(guildId)
    .collection(channelId).add({
      role,
      content,
      modelUsed,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
}

/**
 * Retrieve the last N messages of history for a channel.
 * Returns them in chronological order (oldest first).
 *
 * @param {string} guildId
 * @param {string} channelId
 * @param {number} limit   - how many messages to retrieve (default 10)
 * @returns {Array<{ role: string, content: string }>}
 */
export async function getHistory(guildId, channelId, limit = 10) {
  const snap = await db
    .collection('history').doc(guildId)
    .collection(channelId)
    .orderBy('timestamp', 'desc')
    .limit(limit)
    .get();

  // Reverse to get chronological order for the AI context window
  return snap.docs
    .map(d => d.data())
    .reverse()
    .map(d => ({ role: d.role, content: d.content }));
}

// ─── Audit Log ────────────────────────────────────────────────────────────────

/**
 * Record a moderation action to the audit log.
 * @param {string} guildId
 * @param {object} action  - e.g. { type: 'ban', moderator: '123', target: '456', reason: '...' }
 */
export async function logAudit(guildId, action) {
  await db
    .collection('audit_logs').doc(guildId)
    .collection('logs').add({
      ...action,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
}

// ─── Message Metadata (rich logging) ─────────────────────────────────────────

/**
 * Save detailed metadata about a user message to Firestore.
 * Captures the full context: intent, detected emotion, AI model used,
 * conversation history snapshot, and server context.
 *
 * This powers the /info command and future analytics.
 *
 * @param {object} meta
 * @param {string} meta.guildId
 * @param {string} meta.channelId
 * @param {string} meta.userId
 * @param {string} meta.username
 * @param {string} meta.content           - raw user message
 * @param {string} meta.intent            - detected AI action (e.g. 'chat', 'music_play')
 * @param {string} meta.emotion           - inferred emotional tone
 * @param {string} meta.modelUsed
 * @param {string} meta.botReply          - what Yuy responded
 * @param {object} [meta.extras]          - any additional fields
 */
export async function saveMessageMeta(meta) {
  await db.collection('messages').add({
    ...meta,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });
}
