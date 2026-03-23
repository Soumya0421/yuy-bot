/**
 * src/events/ready.js — Bot ready event
 *
 * Fires once when Yuy successfully connects to Discord.
 * Sets the bot's activity status and rotates it every 30 seconds
 * to show off different features.
 */

import { ActivityType } from 'discord.js';
import { logger } from '../utils/logger.js';

const ACTIVITIES = [
  { name: 'yuy help me',      type: ActivityType.Listening },
  { name: 'your server',      type: ActivityType.Watching  },
  { name: 'yuy play a song',  type: ActivityType.Listening },
  { name: 'with AI models',   type: ActivityType.Playing   },
  { name: '/help for commands', type: ActivityType.Playing },
];

let activityIndex = 0;

export default {
  name: 'ready',
  once: true, // Only fires once on startup

  execute(client) {
    logger.success(`Yuy is online as ${client.user.tag} 🎉`);
    logger.info(`Serving ${client.guilds.cache.size} server(s)`);
    logger.info(`Loaded ${client.commands.size} commands`);

    // Set initial activity and rotate every 30 seconds
    const setActivity = () => {
      const activity = ACTIVITIES[activityIndex % ACTIVITIES.length];
      client.user.setActivity(activity.name, { type: activity.type });
      activityIndex++;
    };

    setActivity();
    setInterval(setActivity, 30_000);
  },
};
