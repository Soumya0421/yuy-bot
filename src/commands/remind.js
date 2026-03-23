/** src/commands/remind.js —  */
import { SlashCommandBuilder } from 'discord.js';

function parseDuration(str) {
  const match = str.match(/^(\d+)\s*(s|sec|m|min|h|hr|d|day)s?$/i);
  if (!match) return null;
  const [, num, unit] = match;
  const map = { s: 1000, sec: 1000, m: 60000, min: 60000, h: 3600000, hr: 3600000, d: 86400000, day: 86400000 };
  return parseInt(num) * (map[unit.toLowerCase()] || 60000);
}

export default {
  data: new SlashCommandBuilder()
    .setName('remind')
    .setDescription('Set a reminder')
    .addStringOption(o => o.setName('time').setDescription('When to remind (e.g. 30m, 2h, 1d)').setRequired(true))
    .addStringOption(o => o.setName('message').setDescription('What to remind you about').setRequired(true)),

  async execute(interaction) {
    const timeStr = interaction.options.getString('time');
    const msg     = interaction.options.getString('message');
    const ms      = parseDuration(timeStr);

    if (!ms) return interaction.reply({ content: 'invalid time format — use like `30m`, `2h`, `1d`', ephemeral: true });
    if (ms > 7 * 24 * 3600000) return interaction.reply({ content: 'max reminder is 7 days', ephemeral: true });

    await interaction.reply({ content: `⏰ Got it! I'll remind you in **${timeStr}** about: **${msg}**`, ephemeral: true });

    setTimeout(async () => {
      try {
        await interaction.user.send(`⏰ **Reminder:** ${msg}`);
      } catch {
        await interaction.channel.send(`⏰ <@${interaction.user.id}> Reminder: **${msg}**`);
      }
    }, ms);
  },
};
