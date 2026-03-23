/**
 * src/events/interactionCreate.js — Slash command & button interaction handler
 *
 * Handles all Discord interaction types:
 *   - Autocomplete (e.g. music search suggestions)
 *   - Slash commands (registered commands in src/commands/)
 *   - Button interactions (music controls, game buttons)
 *   - String select menus (help category picker, etc.)
 *
 * All commands are dynamically loaded by src/index.js and stored in
 * client.commands. This handler just routes to the right execute() function.
 */

import { logger } from '../utils/logger.js';
import { trackStat } from '../modules/statusLogger.js';

export default {
  name: 'interactionCreate',

  async execute(interaction) {

    // ── Autocomplete ──────────────────────────────────────────────────────────
    // Used by /music to show YouTube search suggestions as you type
    if (interaction.isAutocomplete()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (!command?.autocomplete) return;
      try {
        await command.autocomplete(interaction);
      } catch (err) {
        logger.error(`Autocomplete error for ${interaction.commandName}: ${err.message}`);
      }
      return;
    }

    // ── Slash Commands ────────────────────────────────────────────────────────
    if (interaction.isChatInputCommand()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (!command) {
        logger.warn(`Unknown command: ${interaction.commandName}`);
        return;
      }
      try {
        trackStat('commandsHandled');
        await command.execute(interaction);
      } catch (err) {
        logger.error(`Command ${interaction.commandName} error: ${err.message}`);
        trackStat('errors');
        const reply = { content: 'something broke 💀 try again', ephemeral: true };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(reply).catch(() => {});
        } else {
          await interaction.reply(reply).catch(() => {});
        }
      }
      return;
    }

    // ── Button Interactions ───────────────────────────────────────────────────
    if (interaction.isButton()) {
      const id = interaction.customId;

      // Music control buttons (sent with the now-playing embed)
      if (id === 'music_pause') {
        const { pause } = await import('../modules/music.js');
        await interaction.deferUpdate();
        await pause({ guild: interaction.guild, reply: m => interaction.followUp(m) });
        return;
      }
      if (id === 'music_skip') {
        const { skip } = await import('../modules/music.js');
        await interaction.deferUpdate();
        await skip({ guild: interaction.guild, reply: m => interaction.followUp(m) });
        return;
      }
      if (id === 'music_stop') {
        const { stop } = await import('../modules/music.js');
        await interaction.deferUpdate();
        await stop({ guild: interaction.guild, reply: m => interaction.followUp(m) });
        return;
      }
      if (id === 'music_queue') {
        const { showQueue } = await import('../modules/music.js');
        await interaction.deferUpdate();
        await showQueue({ guild: interaction.guild, reply: m => interaction.followUp(m) });
        return;
      }
      if (id === 'music_8d_toggle') {
        const { toggle8D } = await import('../modules/music.js');
        await interaction.deferUpdate();
        await toggle8D({ guild: interaction.guild, reply: m => interaction.followUp(m) });
        return;
      }

      // Memory game tile buttons — handled by the game's own collector
      if (id.startsWith('memory_tile:')) {
        const { handleMemoryButton } = await import('../modules/games.js');
        await handleMemoryButton(interaction);
        return;
      }

      // Generic registered button handlers
      const handler = interaction.client.buttonHandlers?.get(id.split(':')[0]);
      if (handler) {
        try {
          await handler(interaction);
        } catch (err) {
          logger.error(`Button handler error: ${err.message}`);
          await interaction.reply({ content: 'something broke 💀', ephemeral: true }).catch(() => {});
        }
      }
      return;
    }

    // ── Select Menu ───────────────────────────────────────────────────────────
    // Used by /help category picker and other select interactions
    if (interaction.isStringSelectMenu()) {
      const handler = interaction.client.selectHandlers?.get(interaction.customId.split(':')[0]);
      if (handler) {
        try {
          await handler(interaction);
        } catch (err) {
          logger.error(`Select handler error: ${err.message}`);
        }
      }
      return;
    }
  },
};
