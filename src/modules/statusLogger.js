import { EmbedBuilder } from 'discord.js';
import { getServer, updateServer, db } from '../utils/firebase.js';
import { logger } from '../utils/logger.js';

// ─── Rate limiting — update at most every 30 seconds per guild ───────────────
const lastUpdate = new Map();
const INTERVAL_MS = 30_000;

// ─── Counters tracked in memory ──────────────────────────────────────────────
const stats = {
  commandsHandled: 0,
  dbReads:         0,
  dbWrites:        0,
  groqCalls:       0,
  geminiCalls:     0,
  openrouterCalls: 0,
  errors:          0,
  startTime:       Date.now(),
};

// Export so other modules can increment
export function trackStat(key) {
  if (key in stats) stats[key]++;
}

// ─── Main update function ─────────────────────────────────────────────────────

export async function updateStatusChannel(client, guildId) {
  const now = Date.now();
  const last = lastUpdate.get(guildId) || 0;
  if (now - last < INTERVAL_MS) return; // skip if updated recently
  lastUpdate.set(guildId, now);

  try {
    const server = await getServer(guildId);
    const channelId = server?.channels?.status;
    if (!channelId) return;

    const channel = client.channels.cache.get(channelId);
    if (!channel) return;

    const embed = buildStatusEmbed(client, guildId);

    // Try to edit the last pinned message, otherwise send a new one
    const messages = await channel.messages.fetch({ limit: 5 });
    const existing = messages.find(m => m.author.id === client.user.id && m.embeds.length);

    if (existing) {
      await existing.edit({ embeds: [embed] });
    } else {
      await channel.send({ embeds: [embed] });
    }

  } catch (err) {
    logger.error(`Status channel update error: ${err.message}`);
  }
}

// ─── Build status embed ───────────────────────────────────────────────────────

function buildStatusEmbed(client, guildId) {
  const uptimeMs = Date.now() - stats.startTime;
  const uptime = formatUptime(uptimeMs);
  const mem = process.memoryUsage();
  const memUsed = (mem.heapUsed / 1024 / 1024).toFixed(1);
  const memTotal = (mem.heapTotal / 1024 / 1024).toFixed(1);

  return new EmbedBuilder()
    .setTitle('🤖 Yuy System Status')
    .setColor(0x00ff88)
    .addFields(
      // ── Bot Health ────────────────────────────────────────────────────────
      {
        name: '⚙️ Bot Health',
        value: [
          `**Uptime:** ${uptime}`,
          `**Memory:** ${memUsed}MB / ${memTotal}MB`,
          `**Ping:** ${client.ws.ping}ms`,
          `**Node:** ${process.version}`,
        ].join('\n'),
        inline: true,
      },
      // ── Usage Stats ───────────────────────────────────────────────────────
      {
        name: '📊 Usage (since start)',
        value: [
          `**Commands handled:** ${stats.commandsHandled}`,
          `**Errors:** ${stats.errors}`,
          `**DB Reads:** ${stats.dbReads}`,
          `**DB Writes:** ${stats.dbWrites}`,
        ].join('\n'),
        inline: true,
      },
      // ── AI Model Calls ────────────────────────────────────────────────────
      {
        name: '🧠 AI Model Calls',
        value: [
          `**Groq:** ${stats.groqCalls} calls`,
          `**Gemini:** ${stats.geminiCalls} calls`,
          `**OpenRouter:** ${stats.openrouterCalls} calls`,
          `**Total:** ${stats.groqCalls + stats.geminiCalls + stats.openrouterCalls}`,
        ].join('\n'),
        inline: true,
      },
      // ── Model Rate Limit Estimates ────────────────────────────────────────
      {
        name: '⏱️ Groq Free Limits',
        value: [
          `**Daily limit:** 6,000 req/day`,
          `**Used today:** ~${stats.groqCalls}`,
          `**Remaining:** ~${Math.max(0, 6000 - stats.groqCalls)}`,
          `**Per min limit:** 30 req/min`,
        ].join('\n'),
        inline: true,
      },
      {
        name: '⏱️ Gemini Free Limits',
        value: [
          `**Daily limit:** 1,500 req/day`,
          `**Used today:** ~${stats.geminiCalls}`,
          `**Remaining:** ~${Math.max(0, 1500 - stats.geminiCalls)}`,
          `**Per min limit:** 15 req/min`,
        ].join('\n'),
        inline: true,
      },
      // ── Firebase ─────────────────────────────────────────────────────────
      {
        name: '🔥 Firebase Free Limits',
        value: [
          `**Reads today:** ${stats.dbReads} / 50,000`,
          `**Writes today:** ${stats.dbWrites} / 20,000`,
          `**Reads remaining:** ~${Math.max(0, 50000 - stats.dbReads)}`,
          `**Writes remaining:** ~${Math.max(0, 20000 - stats.dbWrites)}`,
        ].join('\n'),
        inline: true,
      },
    )
    .setFooter({ text: `Last updated` })
    .setTimestamp();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h ${m % 60}m`;
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m ${s % 60}s`;
}

// ─── Setup command to designate status channel ────────────────────────────────

export async function setupStatusChannel(message) {
  const { updateServer } = await import('../utils/firebase.js');
  const server = await getServer(message.guild.id);
  const channels = server.channels || {};

  // Use current channel or create a dedicated one
  channels.status = message.channel.id;
  await updateServer(message.guild.id, { channels });

  await message.reply(`✅ This channel is now Yuy's **status channel** — I'll post system stats here every 30s when active!`);
}
