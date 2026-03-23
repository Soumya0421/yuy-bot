/** src/modules/profile.js */
import { EmbedBuilder } from 'discord.js';
import { getUser, updateUser, db } from '../utils/firebase.js';
import { requireTier, TIERS } from '../utils/permissions.js';
import { logger } from '../utils/logger.js';

// Auto-awarded badges (checked on demand)
const AUTO_BADGES = [
  { id: 'newcomer',    emoji: '🌱', name: 'Newcomer',     check: (u) => true },
  { id: 'first_steps', emoji: '🎯', name: 'First Steps',  check: (u) => (u.xp || 0) > 0 },
  { id: 'on_fire',     emoji: '🔥', name: 'On Fire',      check: (u) => (u.checkInStreak || 0) >= 7 },
  { id: 'dedicated',   emoji: '💎', name: 'Dedicated',    check: (u) => (u.checkInStreak || 0) >= 30 },
  { id: 'music_lover', emoji: '🎵', name: 'Music Lover',  check: (u) => (u.songsPlayed || 0) >= 10 },
  { id: 'top_dog',     emoji: '🏆', name: 'Top Dog',      check: (u) => (u.level || 1) >= 10 },
  { id: 'gamer',       emoji: '🎮', name: 'Gamer',        check: (u) => (u.gamesWon || 0) >= 5 },
  { id: 'big_brain',   emoji: '🧠', name: 'Big Brain',    check: (u) => (u.triviaWon || 0) >= 10 },
  { id: 'rich',        emoji: '💰', name: 'Rich',         check: (u) => (u.coins || 0) >= 1000 },
  { id: 'legend',      emoji: '👑', name: 'Legend',       check: (u) => (u.level || 1) >= 50 },
];

// ─── Profile Card ────────────────────────────────────────────────────────────

export async function showProfile(message, targetStr, selfUser) {
  let userData = selfUser;
  let member = message.member;

  if (targetStr) {
    const id = targetStr.replace(/[<@!>]/g, '');
    try {
      member = await message.guild.members.fetch(id);
      userData = await getUser(member.id, member.user.username);
    } catch {
      return message.reply('couldn\'t find that user 🤷');
    }
  }

  // Compute auto badges
  const earnedAuto = AUTO_BADGES.filter(b => b.check(userData)).map(b => `${b.emoji} ${b.name}`);
  const customBadges = (userData.badges || []).map(b => `${b.emoji || '🏅'} ${b.name}`);
  const allBadges = [...earnedAuto, ...customBadges];

  const embed = new EmbedBuilder()
    .setTitle(`👤 ${member.user.username}'s Profile`)
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: '📊 Level', value: `${userData.level || 1}`, inline: true },
      { name: '✨ XP', value: `${userData.xp || 0}`, inline: true },
      { name: '🪙 Coins', value: `${userData.coins || 0}`, inline: true },
      { name: '⭐ Rep', value: `${userData.rep || 0}`, inline: true },
      { name: '🤖 AI Model', value: userData.preferredModel || 'groq', inline: true },
      { name: '📝 Bio', value: userData.bio || '*No bio set*', inline: false },
      { name: `🏅 Badges (${allBadges.length})`, value: allBadges.join(' • ') || '*No badges yet*', inline: false }
    )
    .setColor(0x5865f2)
    .setTimestamp();

  await message.reply({ embeds: [embed] });
}

// ─── Avatar Fetcher ──────────────────────────────────────────────────────────

export async function showAvatar(message, targetStr) {
  let member = message.member;

  if (targetStr) {
    const id = targetStr.replace(/[<@!>]/g, '');
    try {
      member = await message.guild.members.fetch(id);
    } catch {
      return message.reply('couldn\'t find that user 🤷');
    }
  }

  const user = member.user;
  const sizes = [128, 256, 512, 1024, 4096];

  // Get both global and server avatars
  const globalUrl = user.displayAvatarURL({ size: 4096, extension: 'png' });
  const serverUrl = member.displayAvatarURL({ size: 4096, extension: 'png' });

  const embed = new EmbedBuilder()
    .setTitle(`🖼️ ${user.username}'s Avatar`)
    .setImage(serverUrl || globalUrl)
    .setColor(0x5865f2)
    .addFields({
      name: 'Download Links',
      value: sizes.map(s => `[${s}px](${user.displayAvatarURL({ size: s, extension: 'png' })})`).join(' • ')
    });

  // Add server avatar link if different
  if (serverUrl !== globalUrl) {
    embed.addFields({ name: 'Server Avatar', value: `[Click here](${serverUrl})` });
  }

  await message.reply({ embeds: [embed] });
}

// ─── Banner Fetcher ──────────────────────────────────────────────────────────

export async function showBanner(message, targetStr) {
  let userId = message.author.id;

  if (targetStr) {
    userId = targetStr.replace(/[<@!>]/g, '');
  }

  try {
    // Fetch full user to get banner (requires fetching from API)
    const user = await message.client.users.fetch(userId, { force: true });
    const bannerUrl = user.bannerURL({ size: 4096 });

    if (!bannerUrl) {
      return message.reply('that user doesn\'t have a banner 😔');
    }

    const embed = new EmbedBuilder()
      .setTitle(`🎨 ${user.username}'s Banner`)
      .setImage(bannerUrl)
      .setColor(0x5865f2);

    await message.reply({ embeds: [embed] });
  } catch (err) {
    await message.reply('couldn\'t fetch that user\'s banner 💀');
  }
}

// ─── Give Badge (Admin) ──────────────────────────────────────────────────────

export async function giveBadge(message, targetStr, badgeEmoji, badgeName, ctx) {
  if (!requireTier(message.member, message.guild.ownerId, TIERS.ADMIN)) {
    return message.reply('only admins can give badges 🚫');
  }

  if (!targetStr || !badgeName) {
    return message.reply('usage: `yuy badge give @user 🌟 "Star Member"`');
  }

  const id = targetStr.replace(/[<@!>]/g, '');
  const targetUser = await getUser(id);
  const badges = targetUser.badges || [];

  // Check if badge already exists
  if (badges.find(b => b.name === badgeName)) {
    return message.reply('that user already has that badge!');
  }

  badges.push({ emoji: badgeEmoji || '🏅', name: badgeName, grantedBy: message.author.username, grantedAt: new Date().toISOString() });
  await updateUser(id, { badges });

  await message.reply(`✅ gave **${badgeEmoji || '🏅'} ${badgeName}** to <@${id}>!`);
}

// ─── Remove Badge (Admin) ────────────────────────────────────────────────────

export async function removeBadge(message, targetStr, badgeName, ctx) {
  if (!requireTier(message.member, message.guild.ownerId, TIERS.ADMIN)) {
    return message.reply('only admins can remove badges 🚫');
  }

  const id = targetStr?.replace(/[<@!>]/g, '');
  const targetUser = await getUser(id);
  const badges = (targetUser.badges || []).filter(b => b.name !== badgeName);
  await updateUser(id, { badges });

  await message.reply(`✅ removed badge **${badgeName}** from <@${id}>`);
}

// ─── List Badges ─────────────────────────────────────────────────────────────

export async function listBadges(message, targetStr) {
  let userData;
  let member = message.member;

  if (targetStr) {
    const id = targetStr.replace(/[<@!>]/g, '');
    try {
      member = await message.guild.members.fetch(id);
      userData = await getUser(member.id);
    } catch {
      return message.reply('couldn\'t find that user 🤷');
    }
  } else {
    userData = await getUser(message.author.id);
  }

  const earnedAuto = AUTO_BADGES.filter(b => b.check(userData));
  const customBadges = userData.badges || [];

  const embed = new EmbedBuilder()
    .setTitle(`🏅 ${member.user.username}'s Badges`)
    .setColor(0x5865f2);

  if (earnedAuto.length) {
    embed.addFields({
      name: '⚙️ Auto-Earned',
      value: earnedAuto.map(b => `${b.emoji} **${b.name}**`).join('\n')
    });
  }

  if (customBadges.length) {
    embed.addFields({
      name: '🎖️ Custom Badges',
      value: customBadges.map(b => `${b.emoji || '🏅'} **${b.name}** (by ${b.grantedBy})`).join('\n')
    });
  }

  if (!earnedAuto.length && !customBadges.length) {
    embed.setDescription('no badges yet! start checking in and playing games 🎮');
  }

  await message.reply({ embeds: [embed] });
}
