/**
 * src/deploy-commands.js — Register slash commands with Discord
 *
 * Run this script ONCE (or whenever you add/change slash commands):
 *   npm run deploy
 *
 * This sends all command definitions to Discord's API so they appear
 * in the / autocomplete menu for users.
 *
 * It deploys to a specific guild (server) for instant updates during
 * development. For production, change GUILD_ID to deploy globally
 * (global commands take up to 1 hour to propagate).
 *
 * Requires:
 *   DISCORD_TOKEN  — bot token
 *   CLIENT_ID      — bot application ID
 *   GUILD_ID       — (optional) your dev server ID for fast deployment
 */

import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { readdirSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const commands = [];

// Load all command definitions from src/commands/
const commandsPath = join(__dirname, 'commands');
const commandFiles = readdirSync(commandsPath).filter(f => f.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = pathToFileURL(join(commandsPath, file)).href;
  const command  = await import(filePath);
  if (command.default?.data) {
    commands.push(command.default.data.toJSON());
    console.log(`✓ Loaded: ${command.default.data.name}`);
  }
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

try {
  console.log(`\nDeploying ${commands.length} command(s) to Discord...`);

  const guildId = process.env.GUILD_ID;

  if (guildId) {
    // Guild-scoped: instant update, only visible in your dev server
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
      { body: commands }
    );
    console.log(`✅ Deployed ${commands.length} commands to guild ${guildId}`);
  } else {
    // Global: takes up to 1 hour to appear everywhere
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log(`✅ Deployed ${commands.length} commands globally`);
  }
} catch (err) {
  console.error('Deploy failed:', err.message);
  process.exit(1);
}
