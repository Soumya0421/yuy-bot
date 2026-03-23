/** src/modules/moderation.js */
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ChannelType } from 'discord.js';
import { requireTier, TIERS } from '../utils/permissions.js';
import { logAudit, updateServer, getServer } from '../utils/firebase.js';
import { logger } from '../utils/logger.js';

// ─── Mod Action Handler ───────────────────────────────────────────────────────

export async function handleMod(message, intent, ctx) {
  const { type } = intent;

  if (!requireTier(message.member, message.guild.ownerId, TIERS.MODERATOR)) {
    return message.reply('you don\'t have permission for that 🚫');
  }

  switch (type) {
    case 'kick':     return kickUser(message, intent, ctx);
    case 'ban':      return banUser(message, intent, ctx);
    case 'mute':     return muteUser(message, intent, ctx);
    case 'clear':    return clearMessages(message, intent, ctx);
    case 'role_add': return manageRole(message, intent, ctx, 'add');
    case 'role_remove': return manageRole(message, intent, ctx, 'remove');
    default:
      return message.reply(`unknown mod action: ${type}`);
  }
}

// ─── Kick ────────────────────────────────────────────────────────────────────

async function kickUser(message, intent, ctx) {
  const target = await resolveTarget(message, intent.target);
  if (!target) return message.reply('couldn\'t find that user 🤷');

  const embed = new EmbedBuilder()
    .setTitle('⚠️ Kick Confirmation')
    .setDescription(`Kick **${target.user.username}**?\nReason: ${intent.reason || 'No reason given'}`)
    .setColor(0xffa500);

  const row = confirmRow('kick', target.id);
  const msg = await message.reply({ embeds: [embed], components: [row] });

  awaitConfirm(msg, message.author.id, async () => {
    await target.kick(intent.reason || 'Kicked by Yuy');
    await msg.edit({ embeds: [embed.setColor(0xff0000).setTitle('✅ Kicked')], components: [] });
    await logAudit(message.guild.id, { type: 'kick', target: target.user.username, by: message.author.username, reason: intent.reason });
    await sendAuditLog(message.guild, ctx.server, `👢 **${message.author.username}** kicked **${target.user.username}** — ${intent.reason || 'no reason'}`);
  });
}

// ─── Ban ─────────────────────────────────────────────────────────────────────

async function banUser(message, intent, ctx) {
  if (!requireTier(message.member, message.guild.ownerId, TIERS.ADMIN)) {
    return message.reply('only admins can ban 🚫');
  }

  const target = await resolveTarget(message, intent.target);
  if (!target) return message.reply('couldn\'t find that user 🤷');

  const embed = new EmbedBuilder()
    .setTitle('⚠️ Ban Confirmation')
    .setDescription(`Ban **${target.user.username}**?\nReason: ${intent.reason || 'No reason given'}`)
    .setColor(0xffa500);

  const row = confirmRow('ban', target.id);
  const msg = await message.reply({ embeds: [embed], components: [row] });

  awaitConfirm(msg, message.author.id, async () => {
    await message.guild.members.ban(target.id, { reason: intent.reason });
    await msg.edit({ embeds: [embed.setColor(0xff0000).setTitle('✅ Banned')], components: [] });
    await logAudit(message.guild.id, { type: 'ban', target: target.user.username, by: message.author.username, reason: intent.reason });
    await sendAuditLog(message.guild, ctx.server, `🔨 **${message.author.username}** banned **${target.user.username}** — ${intent.reason || 'no reason'}`);
  });
}

// ─── Mute (Timeout) ──────────────────────────────────────────────────────────

async function muteUser(message, intent, ctx) {
  const target = await resolveTarget(message, intent.target);
  if (!target) return message.reply('couldn\'t find that user 🤷');

  const durationMs = parseDuration(intent.duration || '10m');
  await target.timeout(durationMs, intent.reason || 'Muted by Yuy');
  await message.reply(`🔇 **${target.user.username}** has been muted for ${intent.duration || '10m'}`);
  await sendAuditLog(message.guild, ctx.server, `🔇 **${message.author.username}** muted **${target.user.username}** for ${intent.duration || '10m'}`);
}

// ─── Clear Messages ───────────────────────────────────────────────────────────

async function clearMessages(message, intent, ctx) {
  const amount = Math.min(parseInt(intent.amount) || 5, 100);

  const thinking = await message.reply(`🗑️ clearing ${amount} messages...`);

  try {
    await message.channel.bulkDelete(amount + 1, true); // +1 to include the command message
    const done = await message.channel.send(`✅ cleared ${amount} messages`);
    setTimeout(() => done.delete().catch(() => {}), 3000);
    await sendAuditLog(message.guild, ctx.server, `🗑️ **${message.author.username}** cleared ${amount} messages in <#${message.channel.id}>`);
  } catch (err) {
    thinking.edit(`couldn't clear messages — ${err.message}`);
  }
}

// ─── Role Management ──────────────────────────────────────────────────────────

async function manageRole(message, intent, ctx, action) {
  const target = await resolveTarget(message, intent.target);
  if (!target) return message.reply('couldn\'t find that user 🤷');

  const role = message.guild.roles.cache.find(
    r => r.name.toLowerCase().includes((intent.role || '').toLowerCase())
  );
  if (!role) return message.reply(`couldn't find role "${intent.role}" 🤷`);

  if (action === 'add') {
    await target.roles.add(role);
    await message.reply(`✅ gave **${role.name}** to **${target.user.username}**`);
  } else {
    await target.roles.remove(role);
    await message.reply(`✅ removed **${role.name}** from **${target.user.username}**`);
  }
}

// ─── Announce ────────────────────────────────────────────────────────────────

export async function announce(message, text, ctx) {
  if (!requireTier(message.member, message.guild.ownerId, TIERS.ADMIN)) {
    return message.reply('only admins can announce 🚫');
  }

  const channelId = ctx.server?.channels?.announcements;
  const channel = channelId
    ? message.guild.channels.cache.get(channelId)
    : message.channel;

  if (!channel) return message.reply('no announcements channel configured 🤷 run `/setup-channels` first');

  const embed = new EmbedBuilder()
    .setTitle('📢 Announcement')
    .setDescription(text)
    .setColor(0x5865f2)
    .setFooter({ text: `By ${message.author.username}` })
    .setTimestamp();

  await channel.send({ embeds: [embed] });
  if (channel.id !== message.channel.id) {
    await message.reply(`✅ announced in <#${channel.id}>`);
  }
}

// ─── Setup Channels ──────────────────────────────────────────────────────────

export async function setupChannels(message, ctx) {
  if (!requireTier(message.member, message.guild.ownerId, TIERS.ADMIN)) {
    return message.reply('only admins can set up channels 🚫');
  }

  const thinking = await message.reply('⚙️ setting up Yuy system channels...');

  const channelDefs = [
    { key: 'announcements', name: '📢・announcements' },
    { key: 'audit',         name: '📜・audit-log' },
    { key: 'music',         name: '🔊・music-log' },
    { key: 'welcome',       name: '👋・welcome' },
    { key: 'serverlog',     name: '📊・server-log' },
    { key: 'status',        name: '🤖・yuy-status' },
    { key: 'levelup',       name: '🏅・level-up' },
    { key: 'botcommands',   name: '🎰・bot-commands' },
  ];

  // Create or find a Yuy category
  let category = message.guild.channels.cache.find(c => c.name === 'Yuy System' && c.type === ChannelType.GuildCategory);
  if (!category) {
    category = await message.guild.channels.create({
      name: 'Yuy System',
      type: ChannelType.GuildCategory,
    });
  }

  const channelMap = {};
  for (const def of channelDefs) {
    let ch = message.guild.channels.cache.find(c => c.name === def.name.replace('・', '・') || c.name.includes(def.key));
    if (!ch) {
      ch = await message.guild.channels.create({
        name: def.name,
        type: ChannelType.GuildText,
        parent: category.id,
      });
    }
    channelMap[def.key] = ch.id;
  }

  await updateServer(message.guild.id, { channels: channelMap });

  await thinking.edit(`✅ all Yuy system channels are set up under **Yuy System** category!`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resolveTarget(message, targetStr) {
  if (!targetStr) return null;
  const id = targetStr.replace(/[<@!>]/g, '');
  try {
    return await message.guild.members.fetch(id);
  } catch {
    return message.guild.members.cache.find(m =>
      m.user.username.toLowerCase().includes(targetStr.toLowerCase())
    );
  }
}

function confirmRow(action, targetId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`confirm_${action}:${targetId}`)
      .setLabel('✅ Confirm')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('confirm_cancel')
      .setLabel('❌ Cancel')
      .setStyle(ButtonStyle.Secondary)
  );
}

function awaitConfirm(msg, userId, onConfirm) {
  const collector = msg.createMessageComponentCollector({
    filter: i => i.user.id === userId,
    time: 15_000,
    max: 1,
  });

  collector.on('collect', async interaction => {
    if (interaction.customId.startsWith('confirm_cancel')) {
      await interaction.update({ content: '❌ cancelled', embeds: [], components: [] });
    } else {
      await interaction.deferUpdate();
      await onConfirm();
    }
  });

  collector.on('end', (_, reason) => {
    if (reason === 'time') msg.edit({ components: [] }).catch(() => {});
  });
}

function parseDuration(str) {
  const match = str.match(/(\d+)(s|m|h|d)/);
  if (!match) return 10 * 60 * 1000;
  const [, num, unit] = match;
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return parseInt(num) * multipliers[unit];
}

async function sendAuditLog(guild, server, content) {
  const channelId = server?.channels?.audit;
  if (!channelId) return;
  const channel = guild.channels.cache.get(channelId);
  if (channel) await channel.send(content).catch(() => {});
}
