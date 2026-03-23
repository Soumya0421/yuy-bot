/** src/commands/coinflip.js —  */
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('coinflip')
    .setDescription('Flip a coin!')
    .addStringOption(o => o.setName('guess').setDescription('Your guess').setRequired(false).addChoices({ name: 'Heads', value: 'heads' }, { name: 'Tails', value: 'tails' })),

  async execute(interaction) {
    const guess  = interaction.options.getString('guess');
    const result = Math.random() > 0.5 ? 'heads' : 'tails';
    const won    = guess && guess === result;

    const embed = new EmbedBuilder()
      .setTitle(`🪙 Coin Flip`)
      .setDescription(`The coin landed on **${result === 'heads' ? '👑 Heads' : '🔵 Tails'}**!${guess ? `\n\nYour guess: **${guess}** — ${won ? '✅ Correct!' : '❌ Wrong!'}` : ''}`)
      .setColor(won ? 0x00ff88 : result === 'heads' ? 0xffd700 : 0x5865f2);

    await interaction.reply({ embeds: [embed] });
  },
};
