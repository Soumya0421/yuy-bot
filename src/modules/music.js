import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
  StreamType,
  NoSubscriberBehavior,
} from '@discordjs/voice';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

// ─── Paths — works on both Windows (local) and Linux (Railway/Docker) ────────
const IS_WINDOWS = process.platform === 'win32';
const FFMPEG_PATH = IS_WINDOWS ? 'F:\\Software\\ffmpeg\\bin\\ffmpeg.exe' : 'ffmpeg';
const YTDLP_PATH  = 'yt-dlp';

// ─── Per-guild queue ──────────────────────────────────────────────────────────
const queues = new Map();

function getQueue(guildId) {
  if (!queues.has(guildId)) {
    queues.set(guildId, {
      tracks:      [],
      player:      null,
      current:     null,
      is8D:        false,
      textChannel: null,
    });
  }
  return queues.get(guildId);
}

// ─── yt-dlp helpers ───────────────────────────────────────────────────────────

async function ytdlpSearch(query) {
  const { stdout } = await execFileAsync(YTDLP_PATH, [
    `ytsearch1:${query}`,
    '--print', '%(id)s|||%(title)s|||%(duration)s|||%(thumbnail)s',
    '--no-playlist',
    '--no-warnings',
    '--quiet',
  ]);
  const line = stdout.trim();
  if (!line) return null;
  const [id, title, duration, thumbnail] = line.split('|||');
  return { id, title, url: `https://www.youtube.com/watch?v=${id}`, duration: parseInt(duration) || 0, thumbnail: thumbnail || null };
}

async function ytdlpGetUrl(videoUrl) {
  const { stdout } = await execFileAsync(YTDLP_PATH, [
    videoUrl, '-f', 'bestaudio', '-g',
    '--no-playlist', '--no-warnings', '--quiet',
  ]);
  const url = stdout.trim().split('\n')[0];
  if (!url) throw new Error('yt-dlp returned no URL');
  return url;
}

async function ytdlpGetInfo(videoUrl) {
  const { stdout } = await execFileAsync(YTDLP_PATH, [
    videoUrl,
    '--print', '%(id)s|||%(title)s|||%(duration)s|||%(thumbnail)s',
    '--no-playlist', '--no-warnings', '--quiet',
  ]);
  const line = stdout.trim();
  if (!line) return null;
  const [id, title, duration, thumbnail] = line.split('|||');
  return { id, title, url: `https://www.youtube.com/watch?v=${id}`, duration: parseInt(duration) || 0, thumbnail: thumbnail || null };
}

// ─── Voice connection ─────────────────────────────────────────────────────────

async function getOrCreateConnection(vc, guild) {
  let connection = getVoiceConnection(guild.id);
  if (!connection || connection.state.status === VoiceConnectionStatus.Destroyed) {
    connection = joinVoiceChannel({
      channelId: vc.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        connection.destroy();
        queues.delete(guild.id);
      }
    });
  }
  await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  return connection;
}

// ─── Play ─────────────────────────────────────────────────────────────────────

export async function play(message, query) {
  if (!query) return message.reply('what do you want me to play? 🎵');
  const vc = message.member?.voice?.channel;
  if (!vc) return message.reply('join a voice channel first 🎧');
  const thinking = await message.reply(`🔍 searching for **${query}**...`);
  try {
    let track;
    if (query.includes('youtube.com') || query.includes('youtu.be')) {
      track = await ytdlpGetInfo(query);
      if (!track) return thinking.edit(`couldn't get info for that URL 😔`);
    } else {
      track = await ytdlpSearch(query);
      if (!track) return thinking.edit(`couldn't find "${query}" on YouTube 😔`);
    }
    track.requestedBy = message.author.username;
    const q = getQueue(message.guild.id);
    q.textChannel = message.channel;
    q.tracks.push(track);
    await thinking.edit(`🔗 connecting to **${vc.name}**...`);
    const connection = await getOrCreateConnection(vc, message.guild);
    if (!q.player || q.player.state.status === AudioPlayerStatus.Idle) {
      await thinking.delete().catch(() => {});
      await startPlaying(message.guild.id, connection);
    } else {
      await thinking.edit(`✅ added to queue: **${track.title}**`);
    }
  } catch (err) {
    logger.error(`Play error: ${err.message}`);
    await thinking.edit(`failed 💀 — ${err.message}`);
  }
}

// ─── startPlaying ─────────────────────────────────────────────────────────────

async function startPlaying(guildId, connection) {
  const q = getQueue(guildId);
  if (!q.tracks.length) {
    q.current = null;
    q.textChannel?.send('queue is empty, i\'m done 🎵').catch(() => {});
    return;
  }
  q.current = q.tracks.shift();
  logger.info(`Playing: ${q.current.title}`);
  try {
    const streamUrl = await ytdlpGetUrl(q.current.url);
    logger.info(`Stream URL obtained ✅`);
    const ffmpegProcess = spawn(FFMPEG_PATH, [
      '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
      '-i', streamUrl,
      '-f', 's16le', '-ar', '48000', '-ac', '2', '-vn',
      'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
    const resource = createAudioResource(ffmpegProcess.stdout, {
      inputType: StreamType.Raw,
      inlineVolume: true,
    });
    resource.volume?.setVolume(0.8);
    if (!q.player) {
      q.player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
      q.player.on(AudioPlayerStatus.Idle, () => {
        const conn = getVoiceConnection(guildId);
        if (conn) startPlaying(guildId, conn);
      });
      q.player.on('error', err => logger.error(`Player error: ${err.message}`));
    }
    connection.subscribe(q.player);
    q.player.play(resource);
    const embed = buildNowPlayingEmbed(q.current, q);
    const row = buildPlayerRow();
    q.textChannel?.send({ embeds: [embed], components: [row] }).catch(() => {});
  } catch (err) {
    logger.error(`startPlaying error: ${err.message}`);
    q.textChannel?.send(`⚠️ failed to play **${q.current?.title}** — skipping`).catch(() => {});
    const conn = getVoiceConnection(guildId);
    if (conn) startPlaying(guildId, conn);
  }
}

// ─── Controls ─────────────────────────────────────────────────────────────────

export async function skip(message) {
  const q = getQueue(message.guild?.id);
  if (!q?.player) return message.reply('nothing is playing 🤷');
  q.player.stop();
  await message.reply('⏭️ skipped!');
}

export async function pause(message) {
  const q = getQueue(message.guild?.id);
  if (!q?.player) return message.reply('nothing is playing 🤷');
  if (q.player.state.status === AudioPlayerStatus.Paused) {
    q.player.unpause();
    await message.reply('▶️ resumed!');
  } else {
    q.player.pause();
    await message.reply('⏸️ paused!');
  }
}

export async function stop(message) {
  const q = getQueue(message.guild?.id);
  if (!q) return;
  q.tracks = [];
  q.player?.stop();
  await message.reply('⏹️ stopped!');
}

export async function joinVC(message) {
  const vc = message.member?.voice?.channel;
  if (!vc) return message.reply('join a voice channel first 🎧');
  try {
    await getOrCreateConnection(vc, message.guild);
    await message.reply(`joined **${vc.name}** 🎧`);
  } catch (err) {
    await message.reply(`couldn't join: ${err.message}`);
  }
}

export async function leaveVC(message) {
  const connection = getVoiceConnection(message.guild.id);
  if (connection) {
    connection.destroy();
    queues.delete(message.guild.id);
  }
  await message.reply('left the vc 👋');
}

export async function showQueue(message) {
  const q = getQueue(message.guild?.id);
  if (!q?.current && !q?.tracks?.length) return message.reply('queue is empty 🎵');
  const lines = [];
  if (q.current) lines.push(`**Now Playing:** ${q.current.title}`);
  if (q.tracks.length) {
    lines.push('\n**Up Next:**');
    q.tracks.slice(0, 10).forEach((t, i) => lines.push(`${i + 1}. ${t.title}`));
    if (q.tracks.length > 10) lines.push(`...and ${q.tracks.length - 10} more`);
  }
  const embed = new EmbedBuilder()
    .setTitle('🎵 Queue')
    .setDescription(lines.join('\n'))
    .setColor(0x5865f2)
    .setFooter({ text: q.is8D ? '🎧 8D Mode: ON' : '8D Mode: OFF' });
  await message.reply({ embeds: [embed] });
}

export async function toggle8D(message, enabled) {
  const q = getQueue(message.guild?.id);
  if (!q) return;
  if (enabled === true) q.is8D = true;
  else if (enabled === false) q.is8D = false;
  else q.is8D = !q.is8D;
  await message.reply(q.is8D ? '🎧 8D audio **ON** — headphones on!' : '🔈 8D audio **OFF**');
  if (q.current && q.player) { q.tracks.unshift(q.current); q.player.stop(); }
}

export async function getLyrics(message, query) {
  const q = getQueue(message.guild?.id);
  if (!query) query = q?.current?.title;
  if (!query) return message.reply('what song?');
  const thinking = await message.reply(`🔍 finding lyrics for **${query}**...`);
  try {
    const parts = query.split(' - ');
    const artist = parts.length > 1 ? parts[0] : query;
    const title  = parts.length > 1 ? parts[1] : query;
    const res  = await fetch(`https://lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`);
    const data = await res.json();
    if (!data.lyrics) return thinking.edit(`couldn't find lyrics 😔`);
    await thinking.edit(`**${query}**\n\`\`\`\n${data.lyrics.slice(0, 1900)}\n\`\`\``);
  } catch { await thinking.edit(`couldn't find lyrics 😔`); }
}

export async function moodPlaylist(message, mood, preferredModel) {
  if (!mood) return message.reply('what mood?');
  const thinking = await message.reply(`🎵 curating a **${mood}** playlist...`);
  try {
    const { detectIntent } = await import('./aiRouter.js');
    const result = await detectIntent(
      `Give me 5 song recommendations for a ${mood} mood. Return JSON: {"songs": ["Song - Artist"]}`,
      preferredModel
    );
    const songs = result.songs || [];
    if (!songs.length) return thinking.edit('couldn\'t generate a playlist 😔');
    const embed = new EmbedBuilder()
      .setTitle(`🎵 ${mood.charAt(0).toUpperCase() + mood.slice(1)} Playlist`)
      .setDescription(songs.map((s, i) => `${i + 1}. ${s}`).join('\n'))
      .setColor(0x5865f2)
      .setFooter({ text: 'Say "yuy play [song]" to play any!' });
    await thinking.edit({ content: '', embeds: [embed] });
  } catch { await thinking.edit('playlist generation failed 💀'); }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(sec) {
  if (!sec) return '?:??';
  return `${Math.floor(sec / 60)}:${(sec % 60).toString().padStart(2, '0')}`;
}

function buildNowPlayingEmbed(track, q) {
  return new EmbedBuilder()
    .setTitle('🎵 Now Playing')
    .setDescription(`**[${track.title}](${track.url})**`)
    .setThumbnail(track.thumbnail)
    .addFields(
      { name: 'Duration',     value: formatDuration(track.duration), inline: true },
      { name: 'Requested by', value: track.requestedBy,              inline: true },
      { name: 'Queue',        value: `${q.tracks.length} up next`,   inline: true },
    )
    .setColor(0x5865f2)
    .setTimestamp();
}

function buildPlayerRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('music_pause').setLabel('⏸ Pause').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('music_skip') .setLabel('⏭ Skip') .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('music_stop') .setLabel('⏹ Stop') .setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('music_queue').setLabel('📋 Queue').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('music_8d_toggle').setLabel('🎧 8D').setStyle(ButtonStyle.Success)
  );
}
