import { EmbedBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';

// Discord's official YouTube Together Activity App ID
const YOUTUBE_TOGETHER_APP_ID = '880218394199220334';

/**
 * Start a Watch Together session in the user's voice channel
 * @param {import('discord.js').Message} message
 * @param {string} url - optional YouTube URL to suggest
 */
export async function watchTogether(message, url) {
  const vc = message.member?.voice?.channel;
  if (!vc) return message.reply('join a voice channel first 🎧');

  try {
    const invite = await vc.createInvite({
      targetType: 2,                        // EMBEDDED_APPLICATION
      targetApplication: YOUTUBE_TOGETHER_APP_ID,
      maxAge: 86400,                        // 24 hours
    });

    const embed = new EmbedBuilder()
      .setTitle('🎬 Watch Together')
      .setDescription(
        `**[▶ Click here to launch Watch Together](${invite.url})**\n\n` +
        `Everyone in **${vc.name}** can join and watch together!\n\n` +
        (url
          ? `📋 Paste this in the YouTube search bar inside:\n\`${url}\``
          : `Search for any YouTube video once inside.`)
      )
      .setColor(0xff0000)
      .setFooter({ text: 'Invite valid for 24 hours • Requires Discord desktop or browser' })
      .setTimestamp();

    await message.reply({ embeds: [embed] });

  } catch (err) {
    logger.error(`Watch Together error: ${err.message}`);
    await message.reply(
      `couldn't create Watch Together session 💀\nMake sure I have the **Create Invite** permission in that voice channel!`
    );
  }
}
