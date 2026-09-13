/**
 * Gets a voice note into a shape Whisper will take.
 *
 * A browser's MediaRecorder gives webm or mp4, and Whisper takes both. The
 * phone's own recorder app — which is what a rider uses when the browser will
 * not give the page a microphone — gives whatever the manufacturer chose:
 * m4a on Samsung and Xiaomi, but 3gp or AMR on the cheaper Infinix, Tecno and
 * itel phones that most riders carry. Whisper takes neither, so those are run
 * through ffmpeg first.
 *
 * The container is read from the bytes, not the declared type. A recorder app
 * hands the file over with no type at all as often as not.
 */
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * ffmpeg-static fetches its binary from GitHub when it is installed, so it is
 * an optional dependency: a build machine that cannot reach GitHub still ships
 * the app, and a voice note in a container Whisper cannot read is then the one
 * thing that does not work — instead of everything.
 */
let ffmpegPath: string | null = null
try {
  ffmpegPath = (await import('ffmpeg-static')).default
} catch {
  console.warn('ffmpeg-static is not installed; 3gp and AMR voice notes cannot be converted')
}

export type AudioKind = 'webm' | 'ogg' | 'mp4' | '3gp' | 'amr' | 'wav' | 'mp3' | 'flac' | 'unknown'

const ascii = (b: Uint8Array, at: number, n: number) =>
  String.fromCharCode(...b.subarray(at, at + n))

export function sniffAudio(b: Uint8Array): AudioKind {
  if (b.length < 12) return 'unknown'
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm'
  if (ascii(b, 0, 4) === 'OggS') return 'ogg'
  if (ascii(b, 0, 4) === 'fLaC') return 'flac'
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WAVE') return 'wav'
  if (ascii(b, 0, 5) === '#!AMR') return 'amr'
  if (ascii(b, 0, 3) === 'ID3' || (b[0] === 0xff && (b[1]! & 0xe6) === 0xe2)) return 'mp3'
  if (ascii(b, 4, 4) === 'ftyp') {
    // An ISO container. The brand says which family: 3gp is its own thing,
    // everything else here is mp4/m4a as far as a decoder is concerned.
    const brand = ascii(b, 8, 4)
    return /^3g/.test(brand) ? '3gp' : 'mp4'
  }
  return 'unknown'
}

/** What Whisper decodes on its own, with the extension it picks the decoder by. */
const DIRECT: Partial<Record<AudioKind, string>> = {
  webm: 'webm',
  ogg: 'ogg',
  mp4: 'm4a',
  wav: 'wav',
  mp3: 'mp3',
  flac: 'flac',
}

export const transcodeReady = () => !!ffmpegPath

/**
 * Sixteen kilohertz mono WAV: what Whisper resamples to internally anyway, and
 * a container nothing can get wrong. A minute of it is under two megabytes.
 */
export async function transcode(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (!ffmpegPath) return null
  const dir = await mkdtemp(join(tmpdir(), 'speech-'))
  try {
    // A file, not a pipe: mp4 and 3gp keep their index at the end, and ffmpeg
    // cannot seek back to it on stdin.
    const src = join(dir, 'in')
    const out = join(dir, 'out.wav')
    await writeFile(src, bytes)
    await run(
      ffmpegPath,
      ['-y', '-loglevel', 'error', '-i', src, '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', out],
      { timeout: 30_000 },
    )
    return new Uint8Array(await readFile(out))
  } catch (err) {
    console.error('transcode:', err instanceof Error ? err.message : err)
    return null
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

export async function forWhisper(
  bytes: Uint8Array,
): Promise<{ bytes: Uint8Array; ext: string; kind: AudioKind; converted: boolean } | null> {
  const kind = sniffAudio(bytes)
  const ext = DIRECT[kind]
  if (ext) return { bytes, ext, kind, converted: false }
  const wav = await transcode(bytes)
  return wav ? { bytes: wav, ext: 'wav', kind, converted: true } : null
}
