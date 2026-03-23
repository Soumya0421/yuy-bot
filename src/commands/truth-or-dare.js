import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import Groq from 'groq-sdk';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function getPrompt(type) {
  const res = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: `Give me one fun, spicy but not offensive ${type} prompt for a Discord server game. Just the prompt text, nothing else.` }],
    max_tokens: 150,
    response_format: { type: 'text' },
  });
  return res.choices[0].message.content.trim();
}

export default {
  data: new SlashCommandBuilder()
    .setName('truth-or-dare')
    .setDescription('Play truth or dare with AI-generated prompts!')
    .addUserOption(o => o.setName('target').setDescription('Who to challenge (optional)').setRequired(false)),

  async execute(interaction) {
    const target = interaction.options.getUser('target');
    const mention = target ? `<@${target.id}>` : interaction.user.toString();

    const embed = new EmbedBuilder()
      .setTitle('🎭 Truth or Dare?')
      .setDescription(`${mention} — choose your fate!`)
      .setColor(0xff6b6b);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`tod_truth:${interaction.user.id}:${target?.id||interaction.user.id}`).setLabel('🙊 Truth').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`tod_dare:${interaction.user.id}:${target?.id||interaction.user.id}`).setLabel('😈 Dare').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`tod_random:${interaction.user.id}:${target?.id||interaction.user.id}`).setLabel('🎲 Random').setStyle(ButtonStyle.Secondary),
    );

    const msg = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });

    const collector = msg.createMessageComponentCollector({
      filter: i => i.user.id === (target?.id || interaction.user.id) || i.user.id === interaction.user.id,
      time: 30_000,
      max: 1,
    });

    collector.on('collect', async btn => {
      const [action] = btn.customId.split(':');
      let type = action === 'tod_truth' ? 'truth' : action === 'tod_dare' ? 'dare' : Math.random() > 0.5 ? 'truth' : 'dare';

      await btn.deferUpdate();

      try {
        const prompt = await getPrompt(type);
        const resultEmbed = new EmbedBuilder()
          .setTitle(type === 'truth' ? '🙊 TRUTH' : '😈 DARE')
          .setDescription(`**${mention}**\n\n${prompt}`)
          .setColor(type === 'truth' ? 0x5865f2 : 0xff0000)
          .setFooter({ text: 'Use /truth-or-dare again to play another round!' });

        const playAgainRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('tod_again').setLabel('🔄 Play Again').setStyle(ButtonStyle.Success).setDisabled(true),
        );

        await btn.editReply({ embeds: [resultEmbed], components: [playAgainRow] });
      } catch {
        await btn.editReply({ content: 'failed to generate prompt 💀', embeds: [], components: [] });
      }
    });

    collector.on('end', (_, reason) => {
      if (reason === 'time') msg.edit({ components: [] }).catch(() => {});
    });
  },
};
