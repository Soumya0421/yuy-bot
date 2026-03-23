/** src/modules/utility.js */
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getUser, updateUser, db } from '../utils/firebase.js';
import { logger } from '../utils/logger.js';
import admin from '../utils/firebase.js';

// ─── XP Config ───────────────────────────────────────────────────────────────

const XP_PER_CHECKIN = 50;
const COINS_PER_CHECKIN = 25;
const XP_PER_LEVEL = (level) => level * 100;

function getLevel(xp) {
  let level = 1;
  let totalXp = 0;
  while (totalXp + XP_PER_LEVEL(level) <= xp) {
    totalXp += XP_PER_LEVEL(level);
    level++;
  }
  return { level, currentXp: xp - totalXp, neededXp: XP_PER_LEVEL(level) };
}

// ─── Check-in ────────────────────────────────────────────────────────────────

export async function checkIn(message, user) {
  const now = new Date();
  const lastCheckIn = user.lastCheckIn?.toDate?.() || null;

  if (lastCheckIn) {
    const diff = (now - lastCheckIn) / (1000 * 60 * 60);
    if (diff < 20) {
      const hoursLeft = (20 - diff).toFixed(1);
      return message.reply(`you already checked in today! come back in **${hoursLeft}h** ⏰`);
    }
  }

  const newXp = (user.xp || 0) + XP_PER_CHECKIN;
  const newCoins = (user.coins || 0) + COINS_PER_CHECKIN;
  const { level, currentXp, neededXp } = getLevel(newXp);

  // Check for level up
  const oldLevel = getLevel(user.xp || 0).level;
  const leveledUp = level > oldLevel;

  await updateUser(message.author.id, {
    xp: newXp,
    coins: newCoins,
    level,
    lastCheckIn: admin.firestore.Timestamp.now(),
  });

  const bar = progressBar(currentXp, neededXp);
  const embed = new EmbedBuilder()
    .setTitle('✅ Daily Check-in!')
    .setDescription(
      leveledUp
        ? `🎉 **LEVEL UP!** You're now Level **${level}**!`
        : `+${XP_PER_CHECKIN} XP  •  +${COINS_PER_CHECKIN} 🪙 coins`
    )
    .addFields(
      { name: 'Level', value: `${level}`, inline: true },
      { name: 'Coins', value: `${newCoins} 🪙`, inline: true },
      { name: `XP Progress (${currentXp}/${neededXp})`, value: bar }
    )
    .setColor(leveledUp ? 0xffd700 : 0x5865f2)
    .setThumbnail(message.author.displayAvatarURL())
    .setTimestamp();

  await message.reply({ embeds: [embed] });

  // Send level-up message to level-up channel if configured
  if (leveledUp) {
    try {
      const { getServer } = await import('../utils/firebase.js');
      const server = await getServer(message.guild.id);
      const chId = server.channels?.levelup;
      if (chId) {
        const ch = message.guild.channels.cache.get(chId);
        if (ch) ch.send(`🎉 **${message.author.username}** leveled up to **Level ${level}**! 🏆`);
      }
    } catch {}
  }
}

// ─── Rank ────────────────────────────────────────────────────────────────────

export async function showRank(message, targetStr, selfUser) {
  let targetUser = selfUser;
  let targetMember = message.member;

  if (targetStr) {
    const id = targetStr.replace(/[<@!>]/g, '');
    try {
      targetMember = await message.guild.members.fetch(id);
      targetUser = await getUser(targetMember.id, targetMember.user.username);
    } catch {
      return message.reply('couldn\'t find that user 🤷');
    }
  }

  const { level, currentXp, neededXp } = getLevel(targetUser.xp || 0);
  const bar = progressBar(currentXp, neededXp);

  const embed = new EmbedBuilder()
    .setTitle(`📊 ${targetMember.user.username}'s Rank`)
    .setThumbnail(targetMember.user.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: 'Level', value: `${level}`, inline: true },
      { name: 'XP', value: `${targetUser.xp || 0}`, inline: true },
      { name: 'Coins', value: `${targetUser.coins || 0} 🪙`, inline: true },
      { name: 'Rep', value: `${targetUser.rep || 0} ⭐`, inline: true },
      { name: `Progress (${currentXp}/${neededXp})`, value: bar }
    )
    .setColor(0x5865f2)
    .setTimestamp();

  await message.reply({ embeds: [embed] });
}

// ─── Leaderboard ─────────────────────────────────────────────────────────────

export async function showLeaderboard(message) {
  const snap = await db.collection('users').orderBy('xp', 'desc').limit(10).get();
  const users = snap.docs.map((d, i) => {
    const data = d.data();
    const { level } = getLevel(data.xp || 0);
    const medals = ['🥇', '🥈', '🥉'];
    return `${medals[i] || `${i + 1}.`} **${data.username || 'Unknown'}** — Level ${level} (${data.xp || 0} XP)`;
  });

  const embed = new EmbedBuilder()
    .setTitle('🏆 Leaderboard')
    .setDescription(users.join('\n') || 'No users yet!')
    .setColor(0xffd700)
    .setTimestamp();

  await message.reply({ embeds: [embed] });
}

// ─── Member List ─────────────────────────────────────────────────────────────

export async function showMemberList(message, roleFilter = null) {
  const thinking = await message.reply('📋 fetching member list...');

  try {
    // Fetch ALL members (requires GuildMembers intent)
    await message.guild.members.fetch();

    let members = message.guild.members.cache.filter(m => !m.user.bot);

    // Optional role filter
    if (roleFilter) {
      const role = message.guild.roles.cache.find(
        r => r.name.toLowerCase().includes(roleFilter.toLowerCase())
      );
      if (role) members = members.filter(m => m.roles.cache.has(role.id));
    }

    const sorted = [...members.values()].sort((a, b) =>
      a.user.username.localeCompare(b.user.username)
    );

    if (!sorted.length) return thinking.edit('no members found matching that filter 🤷');

    // Split into chunks of 30 per embed field
    const chunks = [];
    for (let i = 0; i < sorted.length; i += 30) {
      chunks.push(sorted.slice(i, i + 30));
    }

    const embed = new EmbedBuilder()
      .setTitle(`👥 ${message.guild.name} — Members (${sorted.length})`)
      .setColor(0x5865f2)
      .setTimestamp();

    chunks.slice(0, 3).forEach((chunk, i) => {
      embed.addFields({
        name: i === 0 ? 'Members' : '\u200b',
        value: chunk.map(m =>
          `• **${m.displayName}** (${m.user.username})${m.roles.highest.name !== '@everyone' ? ` — ${m.roles.highest.name}` : ''}`
        ).join('\n'),
        inline: false,
      });
    });

    if (chunks.length > 3) {
      embed.setFooter({ text: `Showing 90 of ${sorted.length} members` });
    }

    await thinking.edit({ content: '', embeds: [embed] });

  } catch (err) {
    logger.error(`Member list error: ${err.message}`);
    await thinking.edit(`failed to fetch members 💀 — ${err.message}`);
  }
}

// ─── Server Info ─────────────────────────────────────────────────────────────

export async function showServerInfo(message) {
  const guild = message.guild;

  try {
    await guild.members.fetch();
  } catch {}

  const owner = await guild.fetchOwner().catch(() => null);
  const humans = guild.members.cache.filter(m => !m.user.bot).size;
  const bots   = guild.members.cache.filter(m => m.user.bot).size;
  const textChannels  = guild.channels.cache.filter(c => c.type === 0).size;
  const voiceChannels = guild.channels.cache.filter(c => c.type === 2).size;
  const categories    = guild.channels.cache.filter(c => c.type === 4).size;
  const roles  = guild.roles.cache.size - 1; // exclude @everyone
  const emojis = guild.emojis.cache.size;
  const boosts = guild.premiumSubscriptionCount || 0;

  const embed = new EmbedBuilder()
    .setTitle(`🏠 ${guild.name}`)
    .setThumbnail(guild.iconURL({ size: 256 }))
    .addFields(
      { name: '👑 Owner',        value: owner?.user.username || 'Unknown', inline: true },
      { name: '🆔 Server ID',    value: guild.id,                          inline: true },
      { name: '📅 Created',      value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
      { name: '👥 Humans',       value: `${humans}`,                       inline: true },
      { name: '🤖 Bots',         value: `${bots}`,                         inline: true },
      { name: '📊 Total Members',value: `${guild.memberCount}`,            inline: true },
      { name: '💬 Text Channels',value: `${textChannels}`,                 inline: true },
      { name: '🔊 Voice Channels',value: `${voiceChannels}`,               inline: true },
      { name: '📁 Categories',   value: `${categories}`,                   inline: true },
      { name: '🎭 Roles',        value: `${roles}`,                        inline: true },
      { name: '😀 Emojis',       value: `${emojis}`,                       inline: true },
      { name: '🚀 Boosts',       value: `${boosts} (Tier ${guild.premiumTier})`, inline: true },
    )
    .setColor(0x5865f2)
    .setTimestamp();

  if (guild.description) embed.setDescription(guild.description);
  if (guild.bannerURL()) embed.setImage(guild.bannerURL({ size: 1024 }));

  await message.reply({ embeds: [embed] });
}



export async function showStats(message) {
  const guild = message.guild;
  const members = guild.memberCount;
  const bots = guild.members.cache.filter(m => m.user.bot).size;
  const channels = guild.channels.cache.size;
  const roles = guild.roles.cache.size;

  const embed = new EmbedBuilder()
    .setTitle(`📊 ${guild.name} Stats`)
    .setThumbnail(guild.iconURL({ size: 256 }))
    .addFields(
      { name: 'Members', value: `${members - bots} humans, ${bots} bots`, inline: true },
      { name: 'Channels', value: `${channels}`, inline: true },
      { name: 'Roles', value: `${roles}`, inline: true },
      { name: 'Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
      { name: 'Owner', value: `<@${guild.ownerId}>`, inline: true },
      { name: 'Boost Level', value: `${guild.premiumTier}`, inline: true }
    )
    .setColor(0x5865f2)
    .setTimestamp();

  await message.reply({ embeds: [embed] });
}

// ─── Poll ────────────────────────────────────────────────────────────────────

export async function createPoll(message, question, options = []) {
  if (!question) return message.reply('give me a question for the poll!');
  if (!options.length) options = ['Yes', 'No'];

  const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];
  const description = options
    .slice(0, 5)
    .map((opt, i) => `${emojis[i]} ${opt}`)
    .join('\n');

  const embed = new EmbedBuilder()
    .setTitle(`📊 ${question}`)
    .setDescription(description)
    .setColor(0x5865f2)
    .setFooter({ text: `Poll by ${message.author.username}` })
    .setTimestamp();

  const msg = await message.channel.send({ embeds: [embed] });
  for (let i = 0; i < Math.min(options.length, 5); i++) {
    await msg.react(emojis[i]);
  }
  await message.delete().catch(() => {});
}

// ─── Reminder ────────────────────────────────────────────────────────────────

export async function setReminder(message, timeStr, reminderMsg) {
  if (!timeStr || !reminderMsg) return message.reply('tell me when and what to remind you! e.g. "yuy remind me in 30m to eat"');

  const ms = parseDuration(timeStr);
  if (!ms) return message.reply('invalid time format — use like 30m, 2h, 1d');

  await message.reply(`⏰ got it! i'll remind you in **${timeStr}**`);

  setTimeout(async () => {
    try {
      await message.author.send(`⏰ Reminder: **${reminderMsg}**`);
    } catch {
      await message.channel.send(`⏰ ${message.author}, reminder: **${reminderMsg}**`);
    }
  }, ms);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function progressBar(current, total, length = 20) {
  const filled = Math.round((current / total) * length);
  return '█'.repeat(filled) + '░'.repeat(length - filled) + ` (${current}/${total})`;
}

function parseDuration(str) {
  const match = str.match(/(\d+)\s*(s|sec|m|min|h|hr|d|day)/i);
  if (!match) return null;
  const [, num, unit] = match;
  const multipliers = { s: 1000, sec: 1000, m: 60000, min: 60000, h: 3600000, hr: 3600000, d: 86400000, day: 86400000 };
  return parseInt(num) * (multipliers[unit.toLowerCase()] || 60000);
}
