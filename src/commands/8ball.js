/** src/commands/8ball.js —  */
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

const RESPONSES = [
  { text: 'It is certain.', color: 0x00ff88 },
  { text: 'It is decidedly so.', color: 0x00ff88 },
  { text: 'Without a doubt.', color: 0x00ff88 },
  { text: 'Yes, definitely.', color: 0x00ff88 },
  { text: 'You may rely on it.', color: 0x00ff88 },
  { text: 'As I see it, yes.', color: 0x00ff88 },
  { text: 'Most likely.', color: 0x00ff88 },
  { text: 'Outlook good.', color: 0x00ff88 },
  { text: 'Yes.', color: 0x00ff88 },
  { text: 'Signs point to yes.', color: 0x00ff88 },
  { text: 'Reply hazy, try again.', color: 0xffa500 },
  { text: 'Ask again later.', color: 0xffa500 },
  { text: 'Better not tell you now.', color: 0xffa500 },
  { text: 'Cannot predict now.', color: 0xffa500 },
  { text: 'Concentrate and ask again.', color: 0xffa500 },
  { text: "Don't count on it.", color: 0xff0000 },
  { text: 'My reply is no.', color: 0xff0000 },
  { text: 'My sources say no.', color: 0xff0000 },
  { text: 'Outlook not so good.', color: 0xff0000 },
  { text: 'Very doubtful.', color: 0xff0000 },
];

export default {
  data: new SlashCommandBuilder()
    .setName('8ball')
    .setDescription('Ask the magic 8-ball a question')
    .addStringOption(o => o.setName('question').setDescription('Your question').setRequired(true)),

  async execute(interaction) {
    const question = interaction.options.getString('question');
    const response = RESPONSES[Math.floor(Math.random() * RESPONSES.length)];

    await interaction.reply({ embeds: [new EmbedBuilder()
      .setTitle('🎱 Magic 8-Ball')
      .addFields({ name: '❓ Question', value: question }, { name: '🎱 Answer', value: response.text })
      .setColor(response.color)] });
  },
};
