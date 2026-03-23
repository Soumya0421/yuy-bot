/** src/modules/games.js */
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getUser, updateUser } from '../utils/firebase.js';
import { checkCooldown } from '../utils/cooldown.js';
import { detectIntent } from './aiRouter.js';
import { logger } from '../utils/logger.js';

// ─── Memory Game (5x5 Tile Flip) ─────────────────────────────────────────────

const TILE_THEMES = {
  animals: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🦆','🦉','🦋','🐛','🐌','🐞','🐜'],
  anime:   ['⚔️','🗡️','🏯','⛩️','🎎','🎐','🎑','🎍','🎋','🎏','🏮','🎆','🎇','✨','🌸','🌺','🍡','🍱','🍣','🍜','🍛','🍙','🍘','🍥','🎴'],
  food:    ['🍕','🍔','🌮','🌯','🍜','🍱','🍣','🍛','🍲','🥘','🍝','🍠','🧀','🥚','🍳','🥞','🧆','🥓','🥩','🍗','🍖','🦴','🌭','🥪','🥗'],
};

const activeGames = new Map();

export async function startMemory(message, opponentStr) {
  const guildId = message.guild.id;
  const gameKey = `memory_${guildId}_${message.channel.id}`;

  if (activeGames.has(gameKey)) {
    return message.reply('there\'s already a memory game going in this channel! finish that one first 🎮');
  }

  let opponent = null;
  if (opponentStr) {
    const id = opponentStr.replace(/[<@!>]/g, '');
    try { opponent = await message.guild.members.fetch(id); } catch {}
  }

  // Build 5x5 grid: 12 pairs + 1 wild tile
  const theme = TILE_THEMES.animals;
  const pairs = theme.slice(0, 12);
  const tiles = [...pairs, ...pairs, '⭐'].sort(() => Math.random() - 0.5);

  const game = {
    tiles,
    revealed: new Array(25).fill(false),
    matched: new Array(25).fill(false),
    flipped: [],
    scores: { [message.author.id]: 0, ...(opponent ? { [opponent.id]: 0 } : {}) },
    currentTurn: message.author.id,
    players: [message.author, ...(opponent ? [opponent.user] : [])],
    active: true,
  };

  activeGames.set(gameKey, game);

  const embed = buildMemoryEmbed(game, message.guild);
  const rows = buildMemoryRows(game);

  const msg = await message.reply({
    content: opponent
      ? `🎮 Memory Game — **${message.author.username}** vs **${opponent.user.username}**!\n${message.author}'s turn`
      : `🎮 Memory Game — solo mode! Good luck ${message.author}!`,
    embeds: [embed],
    components: rows,
  });

  // Store message ref for editing
  game.message = msg;
  game.gameKey = gameKey;
}

function buildMemoryRows(game) {
  const rows = [];
  for (let row = 0; row < 5; row++) {
    const actionRow = new ActionRowBuilder();
    for (let col = 0; col < 5; col++) {
      const i = row * 5 + col;
      const isRevealed = game.revealed[i];
      const isMatched = game.matched[i];

      actionRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`memory_tile:${i}`)
          .setLabel(isRevealed || isMatched ? game.tiles[i] : '?')
          .setStyle(isMatched ? ButtonStyle.Success : isRevealed ? ButtonStyle.Primary : ButtonStyle.Secondary)
          .setDisabled(isMatched || isRevealed)
      );
    }
    rows.push(actionRow);
  }
  return rows;
}

function buildMemoryEmbed(game, guild) {
  const scoreLines = Object.entries(game.scores).map(([id, score]) => {
    const member = guild.members.cache.get(id);
    return `${member?.user.username || id}: **${score}** pairs`;
  });

  return new EmbedBuilder()
    .setTitle('🧠 Memory Game')
    .setDescription(`Find matching pairs! Current turn: **${guild.members.cache.get(game.currentTurn)?.user.username || 'Player'}**`)
    .addFields({ name: 'Score', value: scoreLines.join('\n') })
    .setColor(0x5865f2);
}

// Memory button handler — exported for interactionCreate to register
export async function handleMemoryButton(interaction) {
  const gameKey = `memory_${interaction.guild.id}_${interaction.channel.id}`;
  const game = activeGames.get(gameKey);

  if (!game || !game.active) return interaction.reply({ content: 'no active game!', ephemeral: true });
  if (interaction.user.id !== game.currentTurn && game.players.length > 1) {
    return interaction.reply({ content: 'it\'s not your turn! 😤', ephemeral: true });
  }

  const tileIndex = parseInt(interaction.customId.split(':')[1]);
  if (game.matched[tileIndex] || game.revealed[tileIndex]) return interaction.deferUpdate();

  game.revealed[tileIndex] = true;
  game.flipped.push(tileIndex);

  if (game.flipped.length === 2) {
    const [a, b] = game.flipped;
    const isMatch = game.tiles[a] === game.tiles[b];

    if (isMatch) {
      game.matched[a] = true;
      game.matched[b] = true;
      game.scores[game.currentTurn]++;
      game.flipped = [];

      // Check win
      const allMatched = game.matched.filter(Boolean).length;
      if (allMatched >= 24) {
        game.active = false;
        activeGames.delete(gameKey);

        const winner = Object.entries(game.scores).sort((a, b) => b[1] - a[1])[0];
        const winnerMember = interaction.guild.members.cache.get(winner[0]);

        await interaction.update({
          content: `🎉 Game over! **${winnerMember?.user.username}** wins with **${winner[1]} pairs**!`,
          components: buildMemoryRows(game),
          embeds: [buildMemoryEmbed(game, interaction.guild)],
        });
        return;
      }
    } else {
      // Flip back after delay
      setTimeout(async () => {
        game.revealed[a] = false;
        game.revealed[b] = false;
        game.flipped = [];
        // Switch turn in multiplayer
        if (game.players.length > 1) {
          const idx = game.players.findIndex(p => p.id === game.currentTurn);
          game.currentTurn = game.players[(idx + 1) % game.players.length].id;
        }
        await game.message.edit({
          components: buildMemoryRows(game),
          embeds: [buildMemoryEmbed(game, interaction.guild)],
        }).catch(() => {});
      }, 1500);
    }
  }

  await interaction.update({
    components: buildMemoryRows(game),
    embeds: [buildMemoryEmbed(game, interaction.guild)],
  });
}

// ─── Trivia ──────────────────────────────────────────────────────────────────

export async function startTrivia(message, ctx) {
  const { limited, remaining } = checkCooldown(message.author.id, 'trivia', 30);
  if (limited) return message.reply(`wait ${remaining}s before starting another trivia 🥱`);

  const thinking = await message.reply('🎯 generating a trivia question...');

  try {
    const result = await detectIntent(
      'Generate a trivia question with 4 options (A, B, C, D). Return JSON: {"question":"...","options":["A. ...","B. ...","C. ...","D. ..."],"answer":"A"}',
      ctx.preferredModel
    );

    const { question, options, answer } = result;
    const letters = ['A', 'B', 'C', 'D'];

    const embed = new EmbedBuilder()
      .setTitle('🎯 Trivia!')
      .setDescription(question)
      .setColor(0x5865f2)
      .setFooter({ text: '15 seconds to answer!' });

    const row = new ActionRowBuilder().addComponents(
      ...options.map((opt, i) =>
        new ButtonBuilder()
          .setCustomId(`trivia_answer:${letters[i]}:${answer}:${message.author.id}`)
          .setLabel(opt)
          .setStyle(ButtonStyle.Primary)
      )
    );

    const msg = await thinking.edit({ content: '', embeds: [embed], components: [row] });

    const collector = msg.createMessageComponentCollector({ time: 15_000 });
    collector.on('collect', async interaction => {
      const [, chosen, correct, authorId] = interaction.customId.split(':');
      const won = chosen === correct;

      if (won) {
        await updateUser(interaction.user.id, {
          xp: ((await getUser(interaction.user.id)).xp || 0) + 20,
          triviaWon: ((await getUser(interaction.user.id)).triviaWon || 0) + 1,
        });
      }

      await interaction.update({
        embeds: [embed.setColor(won ? 0x00ff00 : 0xff0000).setFooter({
          text: won ? `✅ Correct! +20 XP` : `❌ Wrong! Answer was ${correct}`
        })],
        components: [],
      });
      collector.stop();
    });

    collector.on('end', (_, reason) => {
      if (reason === 'time') {
        msg.edit({ components: [] }).catch(() => {});
      }
    });

  } catch (err) {
    await thinking.edit('trivia generation failed 💀');
  }
}

// ─── Roast ──────────────────────────────────────────────────────────────────

export async function roast(message, targetStr, preferredModel) {
  const target = targetStr ? targetStr.replace(/[<@!>]/g, '') : null;
  const name = target
    ? (await message.guild.members.fetch(target).catch(() => null))?.user.username || targetStr
    : message.author.username;

  const thinking = await message.reply(`🔥 roasting **${name}**...`);

  try {
    const result = await detectIntent(
      `Roast the Discord user named "${name}" in a funny, savage but not genuinely hurtful way. Just the roast text, no explanation. Return JSON: {"reply":"..."}`,
      preferredModel
    );
    await thinking.edit(`🔥 **${name}**, ${result.reply}`);
  } catch {
    await thinking.edit('the roast machine broke 💀');
  }
}

// ─── Compliment ──────────────────────────────────────────────────────────────

export async function compliment(message, targetStr, preferredModel) {
  const target = targetStr ? targetStr.replace(/[<@!>]/g, '') : null;
  const name = target
    ? (await message.guild.members.fetch(target).catch(() => null))?.user.username || targetStr
    : message.author.username;

  const thinking = await message.reply(`💖 complimenting **${name}**...`);

  try {
    const result = await detectIntent(
      `Give a genuine, wholesome compliment to the Discord user named "${name}". Return JSON: {"reply":"..."}`,
      preferredModel
    );
    await thinking.edit(`💖 **${name}**, ${result.reply}`);
  } catch {
    await thinking.edit('compliment machine broke 💀');
  }
}

// ─── Would You Rather ────────────────────────────────────────────────────────

export async function wouldYouRather(message, preferredModel) {
  const thinking = await message.reply('🤔 generating a would you rather...');

  try {
    const result = await detectIntent(
      'Generate a fun/funny/spicy would you rather question. Return JSON: {"optionA":"...","optionB":"..."}',
      preferredModel
    );

    const embed = new EmbedBuilder()
      .setTitle('🤔 Would You Rather?')
      .setColor(0x5865f2);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('wyr_a').setLabel(`A: ${result.optionA}`).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('wyr_b').setLabel(`B: ${result.optionB}`).setStyle(ButtonStyle.Danger)
    );

    const votes = { a: 0, b: 0, voters: new Set() };
    const msg = await thinking.edit({ content: '', embeds: [embed.setDescription(`**A:** ${result.optionA}\n\n**B:** ${result.optionB}`)], components: [row] });

    const collector = msg.createMessageComponentCollector({ time: 30_000 });
    collector.on('collect', async interaction => {
      if (votes.voters.has(interaction.user.id)) {
        return interaction.reply({ content: 'you already voted!', ephemeral: true });
      }
      votes.voters.add(interaction.user.id);
      interaction.customId === 'wyr_a' ? votes.a++ : votes.b++;

      await interaction.update({
        embeds: [embed.setDescription(`**A:** ${result.optionA} — **${votes.a} votes**\n\n**B:** ${result.optionB} — **${votes.b} votes**`)],
        components: [row],
      });
    });

    collector.on('end', () => msg.edit({ components: [] }).catch(() => {}));
  } catch {
    await thinking.edit('wyr generation failed 💀');
  }
}

// ─── Riddle ──────────────────────────────────────────────────────────────────

export async function riddle(message, preferredModel) {
  const thinking = await message.reply('🧩 here\'s your riddle...');

  try {
    const result = await detectIntent(
      'Give a clever riddle. Return JSON: {"riddle":"...","answer":"..."}',
      preferredModel
    );

    const embed = new EmbedBuilder()
      .setTitle('🧩 Riddle')
      .setDescription(result.riddle)
      .setColor(0x5865f2)
      .setFooter({ text: 'Click "Reveal" when ready!' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`riddle_reveal:${Buffer.from(result.answer).toString('base64')}`).setLabel('🔍 Reveal Answer').setStyle(ButtonStyle.Secondary)
    );

    await thinking.edit({ content: '', embeds: [embed], components: [row] });
  } catch {
    await thinking.edit('riddle generation failed 💀');
  }
}

// ─── Rock Paper Scissors ──────────────────────────────────────────────────────

export async function rps(message) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('rps_rock').setLabel('🪨 Rock').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('rps_paper').setLabel('📄 Paper').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('rps_scissors').setLabel('✂️ Scissors').setStyle(ButtonStyle.Primary)
  );

  const msg = await message.reply({ content: '🪨📄✂️ Pick one!', components: [row] });

  const collector = msg.createMessageComponentCollector({
    filter: i => i.user.id === message.author.id,
    time: 15_000,
    max: 1,
  });

  collector.on('collect', async interaction => {
    const choices = ['rock', 'paper', 'scissors'];
    const player = interaction.customId.replace('rps_', '');
    const bot = choices[Math.floor(Math.random() * 3)];

    const wins = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
    const result = player === bot ? 'tie' : wins[player] === bot ? 'win' : 'lose';

    const emojis = { rock: '🪨', paper: '📄', scissors: '✂️' };
    const outcomes = {
      win: `🎉 You win! ${emojis[player]} beats ${emojis[bot]}!`,
      lose: `😔 You lose! ${emojis[bot]} beats ${emojis[player]}!`,
      tie: `🤝 It's a tie! We both picked ${emojis[player]}`,
    };

    await interaction.update({ content: outcomes[result], components: [] });
  });

  collector.on('end', (_, reason) => {
    if (reason === 'time') msg.edit({ components: [] }).catch(() => {});
  });
}

// ─── Truth or Dare ────────────────────────────────────────────────────────────

export async function truthOrDare(message, preferredModel) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('tod_truth').setLabel('🙊 Truth').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('tod_dare').setLabel('😈 Dare').setStyle(ButtonStyle.Danger)
  );

  const msg = await message.reply({ content: '🎲 Truth or Dare?', components: [row] });

  const collector = msg.createMessageComponentCollector({
    filter: i => i.user.id === message.author.id,
    time: 15_000,
    max: 1,
  });

  collector.on('collect', async interaction => {
    const type = interaction.customId === 'tod_truth' ? 'truth' : 'dare';
    await interaction.deferUpdate();

    const result = await detectIntent(
      `Give a fun ${type} prompt for a Discord server game. Keep it spicy but not offensive. Return JSON: {"reply":"..."}`,
      preferredModel
    );

    await msg.edit({
      content: `${type === 'truth' ? '🙊 **Truth:**' : '😈 **Dare:**'} ${result.reply}`,
      components: [],
    });
  });

  collector.on('end', (_, reason) => {
    if (reason === 'time') msg.edit({ components: [] }).catch(() => {});
  });
}

// ─── Ship ────────────────────────────────────────────────────────────────────

export async function ship(message, user1Str, user2Str) {
  const u1 = user1Str?.replace(/[<@!>]/g, '') || message.author.id;
  const u2 = user2Str?.replace(/[<@!>]/g, '');

  if (!u2) return message.reply('you need to tag two people! e.g. `yuy ship @person1 @person2`');

  const m1 = await message.guild.members.fetch(u1).catch(() => null);
  const m2 = await message.guild.members.fetch(u2).catch(() => null);

  if (!m1 || !m2) return message.reply('couldn\'t find one of those users 🤷');

  // Deterministic score based on user IDs
  const seed = (BigInt(u1) + BigInt(u2)).toString();
  const score = parseInt(seed.slice(-2)) || 42;
  const pct = Math.abs(score) % 101;

  const bar = '💗'.repeat(Math.floor(pct / 10)) + '🤍'.repeat(10 - Math.floor(pct / 10));
  const comment = pct >= 80 ? 'soulmates fr 💞' : pct >= 60 ? 'decent match 💕' : pct >= 40 ? 'could work 💛' : pct >= 20 ? 'maybe with some effort 💭' : 'yikes... 💔';

  const embed = new EmbedBuilder()
    .setTitle(`💘 Ship: ${m1.user.username} + ${m2.user.username}`)
    .setDescription(`${bar}\n**${pct}%** compatibility — ${comment}`)
    .setColor(0xff69b4)
    .setTimestamp();

  await message.reply({ embeds: [embed] });
}

// ─── Horoscope ────────────────────────────────────────────────────────────────

export async function horoscope(message, sign, preferredModel) {
  const signs = ['aries','taurus','gemini','cancer','leo','virgo','libra','scorpio','sagittarius','capricorn','aquarius','pisces'];
  const s = sign?.toLowerCase() || signs[Math.floor(Math.random() * 12)];

  const thinking = await message.reply(`🔮 checking the stars for **${s}**...`);

  try {
    const result = await detectIntent(
      `Write a funny, slightly sarcastic daily horoscope for ${s}. Make it entertaining. Return JSON: {"reply":"..."}`,
      preferredModel
    );
    await thinking.edit(`🔮 **${s.charAt(0).toUpperCase() + s.slice(1)} Horoscope:**\n${result.reply}`);
  } catch {
    await thinking.edit('the stars are unreadable rn 💀');
  }
}

// ─── Vibe Check ──────────────────────────────────────────────────────────────

export async function vibeCheck(message, preferredModel) {
  const thinking = await message.reply('📡 scanning the server vibes...');

  try {
    const recent = await message.channel.messages.fetch({ limit: 20 });
    const msgs = recent
      .filter(m => !m.author.bot)
      .map(m => m.content)
      .join(' | ')
      .slice(0, 500);

    const result = await detectIntent(
      `Based on these recent Discord messages, rate the vibe of the server: "${msgs}". Give a fun vibe rating and emoji. Return JSON: {"reply":"..."}`,
      preferredModel
    );
    await thinking.edit(`📡 **Vibe Check:** ${result.reply}`);
  } catch {
    await thinking.edit('vibe check failed 💀');
  }
}
