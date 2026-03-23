/**
 * src/index.js — Yuy Bot entry point
 *
 * Bootstraps the Discord client, loads all commands and event handlers,
 * and logs in using the token from .env.
 *
 * Run locally:  node src/index.js   (or: npm start)
 * Dev mode:     npm run dev          (auto-restarts on file change)
 * Deploy cmds:  npm run deploy       (registers slash commands with Discord)
 */

import 'dotenv/config';
import { Client, GatewayIntentBits, Partials, Collection } from 'discord.js';
import { readdirSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { logger } from './utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Discord Client ───────────────────────────────────────────────────────────
// Request only the intents we actually use to minimize memory footprint

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,                // Guild structure + channel info
    GatewayIntentBits.GuildMembers,          // Member join/leave events
    GatewayIntentBits.GuildMessages,         // Read messages in servers
    GatewayIntentBits.MessageContent,        // Required to read message text
    GatewayIntentBits.GuildVoiceStates,      // Required for music/voice features
    GatewayIntentBits.GuildMessageReactions, // Emoji reactions
    GatewayIntentBits.DirectMessages,        // DM support
  ],
  partials: [Partials.Channel, Partials.Message],
});

// ─── Collections ──────────────────────────────────────────────────────────────
// Stores registered commands and interaction handlers at runtime

client.commands       = new Collection();
client.buttonHandlers = new Collection();
client.selectHandlers = new Collection();

// ─── Load Slash Commands ──────────────────────────────────────────────────────
// Every .js file in src/commands/ that exports { data, execute } is auto-loaded

const commandsPath = join(__dirname, 'commands');
try {
  const commandFiles = readdirSync(commandsPath).filter(f => f.endsWith('.js'));
  for (const file of commandFiles) {
    const filePath = pathToFileURL(join(commandsPath, file)).href;
    const command  = await import(filePath);
    if (command.default?.data && command.default?.execute) {
      client.commands.set(command.default.data.name, command.default);
      logger.info(`Loaded command: ${command.default.data.name}`);
    }
  }
} catch (err) {
  logger.warn(`Commands directory issue: ${err.message}`);
}

// ─── Load Event Handlers ──────────────────────────────────────────────────────
// Every .js file in src/events/ is loaded as a Discord gateway event handler

const eventsPath = join(__dirname, 'events');
const eventFiles = readdirSync(eventsPath).filter(f => f.endsWith('.js'));

for (const file of eventFiles) {
  const filePath = pathToFileURL(join(eventsPath, file)).href;
  const event    = await import(filePath);
  const ev       = event.default;
  if (ev.once) {
    client.once(ev.name, (...args) => ev.execute(...args));
  } else {
    client.on(ev.name, (...args) => ev.execute(...args));
  }
  logger.info(`Loaded event: ${ev.name}`);
}

// ─── Global Error Handlers ────────────────────────────────────────────────────

client.on('error', err => logger.error(`Client error: ${err.message}`));

process.on('unhandledRejection', err =>
  logger.error(`Unhandled rejection: ${err?.message}`)
);

process.on('uncaughtException', err => {
  logger.error(`Uncaught exception: ${err.message}`);
  process.exit(1);
});

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

process.on('SIGINT',  () => { logger.info('SIGINT — bye!'); process.exit(0); });
process.on('SIGTERM', () => { logger.info('SIGTERM — bye!'); process.exit(0); });

// ─── Connect to Discord ───────────────────────────────────────────────────────

logger.info('Starting Yuy...');
await client.login(process.env.DISCORD_TOKEN);
