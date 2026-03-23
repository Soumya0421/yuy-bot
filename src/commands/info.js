/**
 * src/commands/info.js — /info command (password protected)
 *
 * Provides detailed intelligence about any server Yuy is in.
 * Protected by a password so only authorized users can access it.
 *
 * Password: yuy123#  (set via INFO_PASSWORD in .env to change it)
 *
 * Shows:
 *   - All servers Yuy is currently in (name, member count, ID)
 *   - Detailed info about the current server (channels, roles, members)
 *   - Member list with roles, join date, status
 *   - Server settings stored in Firebase (model, channels, etc.)
 *
 * Usage: /info password:yuy123#
 *        /info password:yuy123# server_id:123456789
 */

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { getServer } from '../utils/firebase.js';

const INFO_PASSWORD = process.env.INFO_PASSWORD || 'yuy123#';

export default {
  data: new SlashCommandBuilder()
    .setName('info')
    .setDescription('Detailed server & bot info (password protected)')
    .addStringOption(opt =>
      opt.setName('password')
        .setDescription('Access password')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('server_id')
        .setDescription('Server ID to inspect (leave blank for current server)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const password = interaction.options.getString('password');
    const serverId = interaction.options.getString('server_id');

    // ── Password check ─────────────────────────────────────────────────────────
    if (password !== INFO_PASSWORD) {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('🔒 Access Denied')
            .setDescription('Wrong password. This command is restricted. >///<')
            .setColor(0xff4444),
        ],
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      // ── Build the main info embeds ─────────────────────────────────────────
      const embeds = [];

      // 1. Bot overview — all servers Yuy is in
      embeds.push(await buildBotOverviewEmbed(interaction.client));

      // 2. Target server details — current or specified
      const targetGuildId = serverId || interaction.guild.id;
      const targetGuild   = interaction.client.guilds.cache.get(targetGuildId);

      if (!targetGuild) {
        embeds.push(
          new EmbedBuilder()
            .setTitle('⚠️ Server Not Found')
            .setDescription(`Yuy is not in server \`${targetGuildId}\` or it doesn't exist.`)
            .setColor(0xff9900)
        );
      } else {
        embeds.push(await buildServerDetailEmbed(targetGuild));
        embeds.push(await buildMemberListEmbed(targetGuild));
        embeds.push(await buildFirebaseSettingsEmbed(targetGuild));
      }

      await interaction.editReply({ embeds });

    } catch (err) {
      await interaction.editReply({
        content: `Something broke while fetching info: ${err.message}`,
      });
    }
  },
};

// ─── Embed: Bot Overview ──────────────────────────────────────────────────────

/**
 * Shows all servers Yuy is currently in, total users, and uptime.
 */
async function buildBotOverviewEmbed(client) {
  const guilds     = [...client.guilds.cache.values()];
  const totalUsers = guilds.reduce((sum, g) => sum + g.memberCount, 0);

  const serverList = guilds
    .sort((a, b) => b.memberCount - a.memberCount) // biggest first
    .slice(0, 20) // cap at 20 to avoid embed limit
    .map((g, i) =>
      `\`${i + 1}.\` **${g.name}** — ${g.memberCount} members \`ID: ${g.id}\``
    )
    .join('\n');

  const uptimeSec = Math.floor(process.uptime());
  const h = Math.floor(uptimeSec / 3600);
  const m = Math.floor((uptimeSec % 3600) / 60);
  const s = uptimeSec % 60;

  return new EmbedBuilder()
    .setTitle('🤖 Yuy — Bot Overview')
    .addFields(
      { name: '📊 Stats',           value: `**Servers:** ${guilds.length}\n**Total Users:** ${totalUsers}\n**Uptime:** ${h}h ${m}m ${s}s\n**Ping:** ${client.ws.ping}ms`, inline: true },
      { name: '🧠 Node.js',         value: `${process.version}`, inline: true },
      { name: `🌐 Servers (${guilds.length})`, value: serverList || 'None' },
    )
    .setColor(0x00d4aa)
    .setThumbnail(client.user.displayAvatarURL())
    .setTimestamp();
}

// ─── Embed: Server Detail ─────────────────────────────────────────────────────

/**
 * Detailed breakdown of a specific guild — channels, roles, creation date, etc.
 */
async function buildServerDetailEmbed(guild) {
  // Fetch full member list for accurate count
  await guild.members.fetch().catch(() => {});

  const owner = await guild.fetchOwner().catch(() => null);

  const textChannels  = guild.channels.cache.filter(c => c.type === 0).size;
  const voiceChannels = guild.channels.cache.filter(c => c.type === 2).size;
  const categories    = guild.channels.cache.filter(c => c.type === 4).size;
  const roles         = guild.roles.cache.filter(r => r.id !== guild.id); // exclude @everyone

  const topRoles = [...roles.values()]
    .sort((a, b) => b.position - a.position)
    .slice(0, 8)
    .map(r => `<@&${r.id}>`)
    .join(' ');

  const bots    = guild.members.cache.filter(m => m.user.bot).size;
  const humans  = guild.memberCount - bots;

  return new EmbedBuilder()
    .setTitle(`🏰 ${guild.name}`)
    .setThumbnail(guild.iconURL({ size: 256 }) || null)
    .addFields(
      { name: '👑 Owner',       value: owner ? `${owner.user.tag}\n\`${owner.id}\`` : 'Unknown',                   inline: true },
      { name: '📅 Created',     value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`,                       inline: true },
      { name: '🌍 Region',      value: guild.preferredLocale || 'en-US',                                           inline: true },
      { name: '👥 Members',     value: `👤 Humans: **${humans}**\n🤖 Bots: **${bots}**\n📊 Total: **${guild.memberCount}**`, inline: true },
      { name: '📢 Channels',    value: `💬 Text: **${textChannels}**\n🔊 Voice: **${voiceChannels}**\n📁 Categories: **${categories}**`, inline: true },
      { name: '🎭 Roles',       value: `**${roles.size}** roles`,                                                  inline: true },
      { name: '🏷️ Top Roles',  value: topRoles || 'None' },
      { name: '🆔 Server ID',   value: `\`${guild.id}\`` },
    )
    .setColor(0x5865f2);
}

// ─── Embed: Member List ───────────────────────────────────────────────────────

/**
 * Lists members with their top role, join date, and whether they're a bot.
 * Shows up to 25 members sorted by join date (newest first).
 */
async function buildMemberListEmbed(guild) {
  await guild.members.fetch().catch(() => {});

  const members = [...guild.members.cache.values()]
    .filter(m => !m.user.bot) // humans only
    .sort((a, b) => (b.joinedTimestamp || 0) - (a.joinedTimestamp || 0)) // newest first
    .slice(0, 25);

  const lines = members.map(m => {
    const topRole = m.roles.highest.id !== guild.id
      ? `<@&${m.roles.highest.id}>`
      : '—';
    const joined = m.joinedTimestamp
      ? `<t:${Math.floor(m.joinedTimestamp / 1000)}:d>`
      : '?';
    return `**${m.user.username}** ${topRole} joined ${joined}`;
  });

  const bots = guild.members.cache.filter(m => m.user.bot);
  const botLine = bots.size
    ? `\n\n🤖 **Bots (${bots.size}):** ${[...bots.values()].map(b => b.user.username).join(', ')}`
    : '';

  return new EmbedBuilder()
    .setTitle(`👥 Members — ${guild.name} (${guild.memberCount} total)`)
    .setDescription((lines.join('\n') || 'No members found') + botLine)
    .setColor(0x57f287)
    .setFooter({ text: `Showing latest ${members.length} human members` });
}

// ─── Embed: Firebase Settings ─────────────────────────────────────────────────

/**
 * Shows the server's Yuy configuration from Firebase:
 * configured channels, default AI model, custom prompt, etc.
 */
async function buildFirebaseSettingsEmbed(guild) {
  const server = await getServer(guild.id);

  const channelMap = Object.entries(server.channels || {})
    .map(([key, id]) => {
      const ch = guild.channels.cache.get(id);
      return `**${key}:** ${ch ? `<#${id}>` : `~~${id}~~ (deleted)`}`;
    })
    .join('\n') || 'No channels configured';

  const prompt = server.customPrompt
    ? server.customPrompt.slice(0, 200) + (server.customPrompt.length > 200 ? '…' : '')
    : 'Default (Yuy personality)';

  return new EmbedBuilder()
    .setTitle(`⚙️ Yuy Settings — ${guild.name}`)
    .addFields(
      { name: '🧠 Default AI Model', value: server.defaultModel || 'groq',   inline: true },
      { name: '🔞 NSFW Enabled',     value: server.nsfw ? 'Yes' : 'No',       inline: true },
      { name: '📌 Configured Channels', value: channelMap },
      { name: '🎭 Custom Personality', value: `\`\`\`${prompt}\`\`\`` },
    )
    .setColor(0xffa500)
    .setFooter({ text: `Server ID: ${guild.id}` });
}
