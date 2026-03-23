import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

// 12 pairs + 1 wild = 25 tiles for 5x5
// Using Discord emoji as "images" shown on revealed tiles — same as screenshot style
const TILE_SETS = {
  animals: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐸'],
  memes:   ['💀','🗿','😭','🤡','👺','🤖','👻','🎭','🦧','🤯','🫡','💅'],
  food:    ['🍕','🍔','🌮','🍜','🍣','🍛','🧁','🍩','🍦','🍫','🍎','🍇'],
  space:   ['🌍','🌙','⭐','☄️','🚀','🛸','🪐','🌌','🌠','🔭','👽','🌞'],
};

const activeGames = new Map();

export default {
  data: new SlashCommandBuilder()
    .setName('memory')
    .setDescription('Play a 5x5 memory tile matching game!')
    .addUserOption(o => o.setName('opponent').setDescription('Challenge someone to play (optional)').setRequired(false))
    .addStringOption(o =>
      o.setName('theme')
        .setDescription('Tile theme (default: random)')
        .setRequired(false)
        .addChoices(
          { name: '🐾 Animals', value: 'animals' },
          { name: '💀 Memes',   value: 'memes'   },
          { name: '🍕 Food',    value: 'food'     },
          { name: '🌌 Space',   value: 'space'    },
        )
    ),

  async execute(interaction) {
    const opponent  = interaction.options.getUser('opponent');
    const themeKey  = interaction.options.getString('theme') || Object.keys(TILE_SETS)[Math.floor(Math.random() * 4)];
    const gameKey   = `${interaction.guild.id}:${interaction.channel.id}`;

    if (activeGames.has(gameKey)) {
      return interaction.reply({ content: '⚠️ There\'s already a memory game running in this channel! Finish it first.', ephemeral: true });
    }

    const pairs   = [...TILE_SETS[themeKey]]; // 12 pairs
    const tiles   = [...pairs, ...pairs, '⭐'].sort(() => Math.random() - 0.5); // 25 tiles
    const players = [interaction.user, opponent].filter(Boolean);

    const game = {
      tiles,
      revealed:    new Array(25).fill(false),
      matched:     new Array(25).fill(false),
      flipped:     [],
      scores:      Object.fromEntries(players.map(p => [p.id, 0])),
      currentTurn: interaction.user.id,
      players,
      active:      true,
      theme:       themeKey,
      moveCount:   0,
    };

    activeGames.set(gameKey, game);
    // Auto-cleanup after 30 min
    setTimeout(() => activeGames.delete(gameKey), 30 * 60 * 1000);

    const msg = await interaction.reply({
      content: buildTurnText(game, interaction.guild),
      embeds:  [buildScoreEmbed(game, interaction.guild, themeKey)],
      components: buildGrid(game),
      fetchReply: true,
    });

    game.messageId  = msg.id;
    game.channelId  = interaction.channel.id;
    game.guildId    = interaction.guild.id;
    game.gameKey    = gameKey;

    // Collector for tile clicks
    const collector = msg.createMessageComponentCollector({
      filter: i => game.players.some(p => p.id === i.user.id),
      time: 30 * 60 * 1000,
    });

    collector.on('collect', async btn => {
      await handleTileClick(btn, game, gameKey, interaction.guild, collector);
    });

    collector.on('end', (_, reason) => {
      if (reason === 'time') {
        activeGames.delete(gameKey);
        interaction.editReply({ content: '⏰ Game timed out!', components: [] }).catch(() => {});
      }
    });
  },
};

// ── Handle tile click ─────────────────────────────────────────────────────────

async function handleTileClick(interaction, game, gameKey, guild, collector) {
  // Only the current player can click
  if (game.players.length > 1 && interaction.user.id !== game.currentTurn) {
    return interaction.reply({ content: `it's not your turn! Wait for <@${game.currentTurn}> 😤`, ephemeral: true });
  }

  const tileIndex = parseInt(interaction.customId.split(':')[1]);

  if (game.matched[tileIndex] || game.revealed[tileIndex]) {
    return interaction.deferUpdate();
  }

  game.revealed[tileIndex] = true;
  game.flipped.push(tileIndex);
  game.moveCount++;

  // First tile flipped — just show it
  if (game.flipped.length === 1) {
    await interaction.update({
      content: buildTurnText(game, guild),
      embeds:  [buildScoreEmbed(game, guild, game.theme)],
      components: buildGrid(game),
    });
    return;
  }

  // Second tile flipped — check match
  const [a, b] = game.flipped;
  const isMatch = game.tiles[a] === game.tiles[b];

  if (isMatch) {
    game.matched[a] = true;
    game.matched[b] = true;
    game.scores[game.currentTurn]++;
    game.flipped = [];

    // Check if game is over (24 matched = 12 pairs, wild tile stays)
    const matchedCount = game.matched.filter(Boolean).length;
    if (matchedCount >= 24) {
      game.active = false;
      activeGames.delete(gameKey);
      collector.stop('finished');

      const winner = Object.entries(game.scores).sort((a, b) => b[1] - a[1])[0];
      const winnerMember = guild.members.cache.get(winner[0]);
      const isTie = Object.values(game.scores).every(s => s === winner[1]) && game.players.length > 1;

      await interaction.update({
        content: isTie ? `🤝 **It's a tie!** Both scored **${winner[1]} pairs**!` : `🎉 **${winnerMember?.displayName || 'Player'} wins** with **${winner[1]} pairs**! GG!`,
        embeds:  [buildScoreEmbed(game, guild, game.theme, true)],
        components: buildGrid(game),
      });
      return;
    }

    // Match found — same player goes again
    await interaction.update({
      content: `✅ Match! <@${game.currentTurn}> got it! Go again!`,
      embeds:  [buildScoreEmbed(game, guild, game.theme)],
      components: buildGrid(game),
    });
  } else {
    // No match — flip back after showing both, switch turns
    await interaction.update({
      content: `❌ No match! Flipping back...`,
      embeds:  [buildScoreEmbed(game, guild, game.theme)],
      components: buildGrid(game),
    });

    await new Promise(r => setTimeout(r, 1500));

    game.revealed[a] = false;
    game.revealed[b] = false;
    game.flipped = [];

    // Switch turn in multiplayer
    if (game.players.length > 1) {
      const currentIdx = game.players.findIndex(p => p.id === game.currentTurn);
      game.currentTurn = game.players[(currentIdx + 1) % game.players.length].id;
    }

    // Fetch message and edit
    try {
      const channel = await interaction.client.channels.fetch(game.channelId);
      const msg = await channel.messages.fetch(game.messageId);
      await msg.edit({
        content: buildTurnText(game, guild),
        embeds:  [buildScoreEmbed(game, guild, game.theme)],
        components: buildGrid(game),
      });
    } catch {}
  }
}

// ── Build 5x5 button grid ─────────────────────────────────────────────────────

function buildGrid(game) {
  const rows = [];
  for (let row = 0; row < 5; row++) {
    const actionRow = new ActionRowBuilder();
    for (let col = 0; col < 5; col++) {
      const i = row * 5 + col;
      const isMatched  = game.matched[i];
      const isRevealed = game.revealed[i];
      const emoji = (isRevealed || isMatched) ? game.tiles[i] : '❓';

      actionRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`mem_tile:${i}`)
          .setLabel(emoji)
          .setStyle(isMatched ? ButtonStyle.Success : isRevealed ? ButtonStyle.Primary : ButtonStyle.Secondary)
          .setDisabled(isMatched || (isRevealed && game.flipped.length >= 2))
      );
    }
    rows.push(actionRow);
  }
  return rows;
}

// ── Score embed ───────────────────────────────────────────────────────────────

function buildScoreEmbed(game, guild, theme, finished = false) {
  const themeEmojis = { animals: '🐾', memes: '💀', food: '🍕', space: '🌌' };
  const scoreLines = Object.entries(game.scores).map(([id, score]) => {
    const member = guild.members.cache.get(id);
    const isCurrent = id === game.currentTurn && !finished;
    return `${isCurrent ? '▶️' : '  '} **${member?.displayName || 'Player'}** — ${score} pair${score !== 1 ? 's' : ''}`;
  });

  return new EmbedBuilder()
    .setTitle(`${themeEmojis[theme] || '🎮'} Memory Game — ${theme}`)
    .addFields({ name: 'Score', value: scoreLines.join('\n') })
    .addFields({ name: 'Moves', value: `${game.moveCount}`, inline: true })
    .addFields({ name: 'Matched', value: `${game.matched.filter(Boolean).length}/24`, inline: true })
    .setColor(finished ? 0xffd700 : 0x5865f2);
}

function buildTurnText(game, guild) {
  if (game.players.length === 1) return `🎮 Solo Memory! Find all matching pairs!`;
  const member = guild.members.cache.get(game.currentTurn);
  return `🎮 It's **${member?.displayName || 'your'}** turn!`;
}
