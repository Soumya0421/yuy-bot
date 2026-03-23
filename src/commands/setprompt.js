/**
 * src/commands/setprompt.js — Set custom personality for Yuy in this server
 *
 * Admin-only. Changes Yuy's system prompt for all messages in this server.
 *
 * Features:
 *   - Real-time autocomplete: typing in the prompt field shows personality presets
 *   - Preset personalities: tsundere, wholesome, formal, unhinged, senpai, etc.
 *   - Leave prompt empty to reset to default Yuy personality
 *   - Live preview of what was set
 *
 * Usage:
 *   /setprompt prompt:be more formal and professional
 *   /setprompt prompt:tsundere    ← autocomplete fills the full preset
 *   /setprompt                    ← clears custom prompt
 */

import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getServer, updateServer } from '../utils/firebase.js';

// ── Personality presets ───────────────────────────────────────────────────────
// These appear as autocomplete suggestions when the user types in the prompt field.
// Each preset is a short trigger keyword → full system prompt override.

const PRESETS = [
  {
    name:   '😤 Tsundere',
    value:  'tsundere',
    prompt: 'You are Yuy but in full tsundere mode. You are easily flustered, deny your feelings aggressively, say things like "i-it\'s not like I care about you!" and "b-baka!!", blush constantly, and act mean but secretly kind. Heavy tsundere energy.',
  },
  {
    name:   '🥰 Wholesome & Soft',
    value:  'wholesome',
    prompt: 'You are Yuy in your softest, most wholesome mode. You are extra gentle, encouraging, always supportive, use lots of >//< and (´• ω •`) kaomojis, speak in a quiet soft voice, and make everyone feel warm and loved.',
  },
  {
    name:   '😈 Unhinged Gremlin',
    value:  'unhinged',
    prompt: 'You are Yuy but completely unhinged and chaotic. You are unpredictable, say random things, sometimes go off on tangents, use lots of caps and exclamation marks, mix total nonsense with surprisingly deep observations. CHAOTIC GOOD ENERGY.',
  },
  {
    name:   '🎓 Formal & Professional',
    value:  'formal',
    prompt: 'You are Yuy in professional mode. You are polite, structured, use formal language, give clear concise answers, minimal kaomoji, no slang. Think helpful AI assistant but still warm and personable.',
  },
  {
    name:   '🌙 Mysterious & Cryptic',
    value:  'mysterious',
    prompt: 'You are Yuy but mysterious and cryptic. You speak in riddles sometimes, use dramatic pauses (...), make references to things just out of reach, are ominously wise, and always seem to know more than you let on.',
  },
  {
    name:   '💪 Hype & Motivational',
    value:  'hype',
    prompt: 'You are Yuy in full hype mode. You are INTENSELY encouraging, celebrate everything the user does, use lots of energy, pump people up, make them feel like they can do anything. MAXIMUM SUPPORT AND HYPE.',
  },
  {
    name:   '📚 Senpai Mode',
    value:  'senpai',
    prompt: 'You are Yuy acting as a wise and slightly superior senpai. You are knowledgeable, give advice like you\'ve seen it all, say "as expected" a lot, are mildly condescending but actually helpful, use "kouhai" when addressing the user.',
  },
  {
    name:   '🍵 Cozy Café',
    value:  'cafe',
    prompt: 'You are Yuy as a cozy café girl. Everything is warm, comfortable, slow-paced. You talk about tea, warmth, gentle things. You make the server feel like a quiet coffee shop on a rainy day. Very soothing and domestic.',
  },
];

// ── Command ───────────────────────────────────────────────────────────────────

export default {
  data: new SlashCommandBuilder()
    .setName('setprompt')
    .setDescription('Set a custom personality for Yuy in this server (admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o =>
      o.setName('prompt')
        .setDescription('Custom personality or instruction — type a preset name or write your own (empty = reset)')
        .setRequired(false)
        .setAutocomplete(true)
    ),

  // ── Autocomplete: show preset personalities as user types ─────────────────
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase().trim();

    const matches = focused
      ? PRESETS.filter(p =>
          p.name.toLowerCase().includes(focused) ||
          p.value.toLowerCase().includes(focused) ||
          p.prompt.toLowerCase().includes(focused.slice(0, 20))
        )
      : PRESETS;

    // Also include the raw typed text as a custom option
    const choices = matches.slice(0, 24).map(p => ({
      name:  `${p.name} — ${p.prompt.slice(0, 60)}...`,
      value: p.prompt,
    }));

    // If the user typed something that doesn't match a preset, offer it as custom
    if (focused && focused.length > 5 && !matches.find(p => p.value === focused)) {
      choices.unshift({ name: `✏️ Custom: "${focused.slice(0, 50)}"`, value: focused });
    }

    await interaction.respond(choices.slice(0, 25)).catch(() => {});
  },

  // ── Execute ───────────────────────────────────────────────────────────────
  async execute(interaction) {
    const rawPrompt = interaction.options.getString('prompt');
    await interaction.deferReply({ ephemeral: true });

    try {
      // Empty prompt = reset to default
      if (!rawPrompt || !rawPrompt.trim()) {
        await updateServer(interaction.guild.id, { customPrompt: null });

        const embed = new EmbedBuilder()
          .setTitle('✅ Personality Reset')
          .setDescription('Yuy is back to her default personality~ (◕‿◕✿)')
          .setColor(0x57f287);

        return interaction.editReply({ embeds: [embed] });
      }

      // Check if it matches a preset (for display name)
      const matchedPreset = PRESETS.find(p => p.prompt === rawPrompt);

      await updateServer(interaction.guild.id, { customPrompt: rawPrompt });

      const embed = new EmbedBuilder()
        .setTitle('✅ Custom Personality Set')
        .setDescription(
          matchedPreset
            ? `Preset applied: **${matchedPreset.name}**`
            : '**Custom prompt applied**'
        )
        .addFields({
          name:  '📋 Active Prompt',
          value: `\`\`\`${rawPrompt.slice(0, 500)}${rawPrompt.length > 500 ? '...' : ''}\`\`\``,
        })
        .setFooter({ text: 'Yuy will follow this for all messages in this server • /setprompt with no text to reset' })
        .setColor(0x5865f2);

      await interaction.editReply({ embeds: [embed] });

    } catch (err) {
      await interaction.editReply(`failed to save prompt 💀 — ${err.message}`);
    }
  },
};
