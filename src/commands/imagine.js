/**
 * src/commands/imagine.js — /imagine slash command
 *
 * Generates AI images via Pollinations.ai with full control over:
 *   - Style preset (anime, realistic, pixel, dark, pastel, etc.)
 *   - Aspect ratio (square, wide, tall, portrait, landscape)
 *   - Number of variations (1-4)
 *   - Quality enhancement (auto-prepend quality prompt words)
 *
 * Usage examples:
 *   /imagine prompt:a sunset over tokyo
 *   /imagine prompt:yuy the anime girl style:anime ratio:wide
 *   /imagine prompt:mountain at dawn style:realistic ratio:landscape count:4
 *
 * Also handles natural language image gen via "yuy imagine/generate/draw ..."
 */

import { SlashCommandBuilder } from 'discord.js';
import {
  generateImage,
  IMAGE_MODELS,
  IMAGE_STYLES,
  ASPECT_RATIOS,
} from '../modules/imageGen.js';

export default {
  data: new SlashCommandBuilder()
    .setName('imagine')
    .setDescription('Generate an AI image using Pollinations.ai')

    .addStringOption(o =>
      o.setName('prompt')
        .setDescription('Describe the image you want to generate')
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('style')
        .setDescription('Art style preset (default: none)')
        .setRequired(false)
        .addChoices(
          { name: '✨ Default (no preset)',               value: 'default'   },
          { name: '🎌 Anime',                             value: 'anime'     },
          { name: '📸 Photorealistic',                    value: 'realistic' },
          { name: '🎮 Pixel Art',                         value: 'pixel'     },
          { name: '✏️ Pencil Sketch',                     value: 'sketch'    },
          { name: '🌑 Dark Fantasy',                      value: 'dark'      },
          { name: '🌸 Pastel / Kawaii',                   value: 'pastel'    },
          { name: '🎨 Watercolor',                        value: 'watercolor'},
          { name: '🔮 3D Render',                         value: '3d'        },
          { name: '🐣 Chibi',                             value: 'chibi'     },
          { name: '🏔️ Epic Landscape',                    value: 'landscape' },
          { name: '👤 Portrait',                          value: 'portrait'  },
        )
    )
    .addStringOption(o =>
      o.setName('ratio')
        .setDescription('Aspect ratio (default: square)')
        .setRequired(false)
        .addChoices(
          { name: '⬛ 1:1 Square (1024×1024)',    value: 'square'    },
          { name: '🖥️ 16:9 Wide (1792×1024)',    value: 'wide'      },
          { name: '📱 9:16 Tall (1024×1792)',    value: 'tall'      },
          { name: '🖼️ 2:3 Portrait (832×1216)',  value: 'portrait'  },
          { name: '🏞️ 3:2 Landscape (1216×832)', value: 'landscape' },
        )
    )
    .addIntegerOption(o =>
      o.setName('count')
        .setDescription('Number of variations to generate (1-4, default: 1)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(4)
    )
    .addStringOption(o =>
      o.setName('model')
        .setDescription('AI model to use (default: flux)')
        .setRequired(false)
        .addChoices(...IMAGE_MODELS.map(m => ({ name: m.label, value: m.id })))
    )
    .addBooleanOption(o =>
      o.setName('enhance')
        .setDescription('Auto-enhance prompt with quality words (default: true)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const prompt  = interaction.options.getString('prompt');
    const style   = interaction.options.getString('style')   || 'default';
    const ratio   = interaction.options.getString('ratio')   || 'square';
    const count   = interaction.options.getInteger('count')  || 1;
    const model   = interaction.options.getString('model')   || 'flux';
    const enhance = interaction.options.getBoolean('enhance') ?? true;

    await interaction.deferReply();

    // Build a fake message-like object so generateImage() works for both
    // slash commands and natural language triggers
    const fakeMessage = {
      author:  interaction.user,
      user:    interaction.user,
      guild:   interaction.guild,
      channel: interaction.channel,
      reply:   async (m) => {
        if (typeof m === 'string') return interaction.editReply({ content: m });
        return interaction.editReply(m);
      },
    };

    await generateImage(fakeMessage, prompt, model, style, ratio, count, enhance);
  },
};
