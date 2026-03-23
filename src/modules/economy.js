/** src/modules/economy.js */
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getUser, updateUser } from '../utils/firebase.js';
import { checkCooldown } from '../utils/cooldown.js';
import { logger } from '../utils/logger.js';

const DAILY_COINS = 100;
const GAMBLE_MAX = 500;

// ─── Show Coins ───────────────────────────────────────────────────────────────

export async function showCoins(message, targetStr, selfUser) {
  let userData = selfUser;
  let username = message.author.username;

  if (targetStr) {
    const id = targetStr.replace(/[<@!>]/g, '');
    try {
      const member = await message.guild.members.fetch(id);
      userData = await getUser(member.id);
      username = member.user.username;
    } catch {
      return message.reply('couldn\'t find that user 🤷');
    }
  }

  await message.reply(`🪙 **${username}** has **${userData.coins || 0} coins**`);
}

// ─── Daily Claim ─────────────────────────────────────────────────────────────

export async function claimDaily(message, user) {
  const { limited, remaining } = checkCooldown(message.author.id, 'daily', 20 * 3600);
  if (limited) {
    const hours = Math.floor(remaining / 3600);
    const mins = Math.floor((remaining % 3600) / 60);
    return message.reply(`already claimed! come back in **${hours}h ${mins}m** ⏰`);
  }

  const newCoins = (user.coins || 0) + DAILY_COINS;
  await updateUser(message.author.id, { coins: newCoins });

  const embed = new EmbedBuilder()
    .setTitle('🪙 Daily Coins Claimed!')
    .setDescription(`+**${DAILY_COINS} coins** → Total: **${newCoins} 🪙**`)
    .setColor(0xffd700)
    .setTimestamp();

  await message.reply({ embeds: [embed] });
}

// ─── Give Coins ───────────────────────────────────────────────────────────────

export async function giveCoins(message, targetStr, amount, user) {
  if (!targetStr || !amount) return message.reply('usage: `yuy give @user 100`');

  const amt = parseInt(amount);
  if (isNaN(amt) || amt <= 0) return message.reply('that\'s not a valid amount 🤷');
  if ((user.coins || 0) < amt) return message.reply(`you only have **${user.coins || 0} coins** 💸`);

  const id = targetStr.replace(/[<@!>]/g, '');
  const targetUser = await getUser(id);

  await updateUser(message.author.id, { coins: (user.coins || 0) - amt });
  await updateUser(id, { coins: (targetUser.coins || 0) + amt });

  await message.reply(`✅ sent **${amt} 🪙** to <@${id}>!`);
}

// ─── Gamble ──────────────────────────────────────────────────────────────────

export async function gamble(message, amountStr, user) {
  if (!amountStr) return message.reply('how much do you want to gamble? `yuy gamble 50`');

  let amount = amountStr === 'all' ? (user.coins || 0) : parseInt(amountStr);
  if (isNaN(amount) || amount <= 0) return message.reply('invalid amount 🤷');
  if (amount > GAMBLE_MAX) return message.reply(`max gamble is **${GAMBLE_MAX} coins** per bet 🎰`);
  if ((user.coins || 0) < amount) return message.reply(`you only have **${user.coins || 0} coins** 💸`);

  const { limited, remaining } = checkCooldown(message.author.id, 'gamble', 30);
  if (limited) return message.reply(`wait ${remaining}s before gambling again 🥱`);

  const roll = Math.random();
  const won = roll > 0.45; // 55% loss rate
  const multiplier = roll > 0.95 ? 3 : roll > 0.75 ? 2 : 1.5;
  const winnings = won ? Math.floor(amount * multiplier) : 0;
  const newCoins = (user.coins || 0) - amount + winnings;

  await updateUser(message.author.id, { coins: Math.max(0, newCoins) });

  const embed = new EmbedBuilder()
    .setTitle(won ? '🎰 You Won!' : '🎰 You Lost!')
    .setDescription(
      won
        ? `Rolled **${(roll * 100).toFixed(0)}** — you won **${winnings} 🪙** (${multiplier}x)!`
        : `Rolled **${(roll * 100).toFixed(0)}** — you lost **${amount} 🪙** 😭`
    )
    .addFields({ name: 'New Balance', value: `${Math.max(0, newCoins)} 🪙`, inline: true })
    .setColor(won ? 0xffd700 : 0xff0000)
    .setTimestamp();

  await message.reply({ embeds: [embed] });
}

// ─── Shop ────────────────────────────────────────────────────────────────────

export async function openShop(message) {
  const items = [
    { emoji: '🎨', name: 'Custom Color Role', price: 500, id: 'color_role' },
    { emoji: '✏️', name: 'Nickname Change', price: 200, id: 'nickname' },
    { emoji: '👑', name: 'VIP Role', price: 1000, id: 'vip_role' },
    { emoji: '🎭', name: 'Special Badge', price: 750, id: 'special_badge' },
  ];

  const embed = new EmbedBuilder()
    .setTitle('🛒 Yuy Shop')
    .setDescription(items.map(i => `${i.emoji} **${i.name}** — ${i.price} 🪙`).join('\n'))
    .setColor(0x5865f2)
    .setFooter({ text: 'Use /shop buy <item> to purchase' });

  const row = new ActionRowBuilder().addComponents(
    ...items.map(item =>
      new ButtonBuilder()
        .setCustomId(`shop_buy:${item.id}`)
        .setLabel(`${item.emoji} ${item.price}🪙`)
        .setStyle(ButtonStyle.Primary)
    )
  );

  await message.reply({ embeds: [embed], components: [row] });
}
