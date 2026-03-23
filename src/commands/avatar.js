/** src/commands/avatar.js —  */
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('avatar')
    .setDescription('Get a user\'s avatar or banner')
    .addUserOption(o => o.setName('user').setDescription('User to get avatar of (default: you)').setRequired(false))
    .addStringOption(o => o.setName('type').setDescription('Avatar type').setRequired(false).addChoices({ name: 'Avatar', value: 'avatar' }, { name: 'Banner', value: 'banner' }, { name: 'Server Avatar', value: 'server' })),

  async execute(interaction) {
    const target = interaction.options.getUser('user') || interaction.user;
    const type   = interaction.options.getString('type') || 'avatar';
    const member = interaction.guild.members.cache.get(target.id);

    await interaction.deferReply();

    const fullUser = await target.fetch();

    if (type === 'banner') {
      const bannerUrl = fullUser.bannerURL({ size: 4096 });
      if (!bannerUrl) return interaction.editReply(`**${target.username}** doesn't have a banner 😔`);
      return interaction.editReply({ embeds: [new EmbedBuilder().setTitle(`🖼️ ${target.username}'s Banner`).setImage(bannerUrl).setColor(0x5865f2)] });
    }

    const url = type === 'server' && member
      ? member.displayAvatarURL({ size: 4096, extension: 'png' })
      : target.displayAvatarURL({ size: 4096, extension: 'png' });

    const sizes = [128, 256, 512, 1024, 4096].map(s => `[${s}px](${target.displayAvatarURL({ size: s, extension: 'png' })})`).join(' • ');

    await interaction.editReply({ embeds: [new EmbedBuilder().setTitle(`🖼️ ${target.username}'s Avatar`).setImage(url).addFields({ name: 'Download', value: sizes }).setColor(0x5865f2)] });
  },
};
