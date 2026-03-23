/** src/commands/poll.js —  */
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Create a poll with up to 4 options')
    .addStringOption(o => o.setName('question').setDescription('The poll question').setRequired(true))
    .addStringOption(o => o.setName('option1').setDescription('Option 1').setRequired(true))
    .addStringOption(o => o.setName('option2').setDescription('Option 2').setRequired(true))
    .addStringOption(o => o.setName('option3').setDescription('Option 3').setRequired(false))
    .addStringOption(o => o.setName('option4').setDescription('Option 4').setRequired(false)),

  async execute(interaction) {
    const question = interaction.options.getString('question');
    const options  = [1,2,3,4].map(n => interaction.options.getString(`option${n}`)).filter(Boolean);
    const emojis   = ['1️⃣','2️⃣','3️⃣','4️⃣'];

    const embed = new EmbedBuilder()
      .setTitle(`📊 ${question}`)
      .setDescription(options.map((o, i) => `${emojis[i]} ${o}`).join('\n'))
      .setColor(0x5865f2)
      .setFooter({ text: `Poll by ${interaction.user.username}` })
      .setTimestamp();

    const msg = await interaction.reply({ embeds: [embed], fetchReply: true });
    for (let i = 0; i < options.length; i++) await msg.react(emojis[i]);
  },
};
