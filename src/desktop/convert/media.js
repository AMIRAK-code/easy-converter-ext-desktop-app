// Video & audio edges (ffmpeg).

import { createRequire } from 'node:module';
import { run } from './util.js';

const require = createRequire(import.meta.url);
export const FFMPEG = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');

const VIDEO = ['mp4', 'mov', 'webm', 'mkv', 'avi', 'wmv'];
const AUDIO = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus', 'wma'];

const H264 = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p'];
// libx264 needs even dimensions.
const EVEN = ['-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2'];

const VIDEO_ARGS = {
  mp4: [...H264, ...EVEN, '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'],
  mov: [...H264, ...EVEN, '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'],
  mkv: [...H264, ...EVEN, '-c:a', 'aac', '-b:a', '192k'],
  webm: ['-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-deadline', 'good', '-cpu-used', '4', '-row-mt', '1', '-c:a', 'libopus', '-b:a', '128k'],
  avi: ['-c:v', 'mpeg4', '-q:v', '3', '-c:a', 'libmp3lame', '-q:a', '3'],
  wmv: ['-c:v', 'wmv2', '-b:v', '4M', '-c:a', 'wmav2', '-b:a', '192k'],
};

const AUDIO_ARGS = {
  mp3: ['-vn', '-c:a', 'libmp3lame', '-q:a', '2'],
  wav: ['-vn', '-c:a', 'pcm_s16le'],
  m4a: ['-vn', '-c:a', 'aac', '-b:a', '192k'],
  aac: ['-vn', '-c:a', 'aac', '-b:a', '192k', '-f', 'adts'],
  ogg: ['-vn', '-c:a', 'libvorbis', '-q:a', '5'],
  flac: ['-vn', '-c:a', 'flac'],
  opus: ['-vn', '-c:a', 'libopus', '-b:a', '128k'],
  wma: ['-vn', '-c:a', 'wmav2', '-b:a', '192k'],
};

const parseTime = (s) => {
  const m = /(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(s);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null;
};

/** Run ffmpeg, reporting progress (0..1) from its stderr. */
export function ffmpeg(args, { ctx, label = 'Converting' } = {}) {
  let duration = null;
  return run(FFMPEG, ['-hide_banner', '-y', ...args], {
    signal: ctx?.signal,
    timeoutMs: 2 * 60 * 60_000,
    onStderr(chunk) {
      if (duration == null) {
        const d = /Duration: (\d+:\d+:\d+\.\d+)/.exec(chunk);
        if (d) duration = parseTime(d[1]);
      }
      const t = [...chunk.matchAll(/time=(\d+:\d+:\d+\.\d+)/g)].pop();
      if (t && duration) ctx?.progress(Math.min(1, parseTime(t[1]) / duration), label);
    },
  });
}

export async function probeDuration(input) {
  try {
    await run(FFMPEG, ['-hide_banner', '-i', input], { timeoutMs: 30_000 });
  } catch (e) {
    // ffmpeg exits non-zero without an output file; the info is in the message.
    return parseTime(/Duration: (\d+:\d+:\d+\.\d+)/.exec(e.message)?.[1] ?? '') ?? null;
  }
  return null;
}

export function mediaEdges() {
  return [
    {
      id: 'ffmpeg-video',
      from: [...VIDEO, 'gif'],
      to: VIDEO,
      cost: 1,
      async run({ input, to, output, ctx }) {
        await ffmpeg(['-i', input, ...VIDEO_ARGS[to], output], { ctx });
        return output;
      },
    },
    {
      id: 'ffmpeg-audio',
      from: [...VIDEO, ...AUDIO],
      to: AUDIO,
      cost: 1,
      async run({ input, to, output, ctx }) {
        await ffmpeg(['-i', input, ...AUDIO_ARGS[to], output], { ctx });
        return output;
      },
    },
    {
      id: 'ffmpeg-gif',
      from: VIDEO,
      to: ['gif'],
      cost: 1,
      async run({ input, output, ctx }) {
        // Two-pass palette for clean colours; 12 fps, max 640px wide.
        const vf = 'fps=12,scale=min(640\\,iw):-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4';
        await ffmpeg(['-i', input, '-filter_complex', vf, '-loop', '0', output], { ctx });
        return output;
      },
    },
  ];
}
