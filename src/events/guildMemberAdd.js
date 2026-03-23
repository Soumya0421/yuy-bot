/**
 * src/events/guildMemberAdd.js — New member welcome handler
 *
 * Fires whenever a new user joins a server Yuy is in.
 * Creates their user document in Firebase and sends a welcome message
 * to the configured welcome channel (if one is set up).
 *
 * To set a welcome channel: "yuy setup channels" or configure manually
 * in Firebase under servers/<guildId>/channels/welcome
 */

import { EmbedBuilder } from 'discord.js';
import { getServer, getUser } from '../utils/firebase.js';
import { logger } from '../utils/logger.js';

export default {
  name: 'guildMemberAdd',
  async execute(member) {
    try {
      // Always create the user document so XP/coins work from day 1
      await getUser(member.id, member.user.username);

      // Look up the welcome channel from server settings
      const server           = await getServer(member.guild.id);
      const welcomeChannelId = server.channels?.welcome;
      if (!welcomeChannelId) return; // No welcome channel configured — skip

      const channel = member.guild.channels.cache.get(welcomeChannelId);
      if (!channel) return; // Channel was deleted or bot lacks access

      const embed = new EmbedBuilder()
        .setTitle(`👋 Welcome to ${member.guild.name}!`)
        .setDescription(
          `Hey ${member}, glad you're here! ≧◡≦\n` +
          `You're member **#${member.guild.memberCount}**.\n\n` +
          `Talk to me anytime — just start your message with **yuy** or mention me!`
        )
        .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
        .setColor(0x5865f2)
        .setTimestamp();

      await channel.send({ embeds: [embed] });

    } catch (err) {
      logger.error(`guildMemberAdd error: ${err.message}`);
    }
  },
};
