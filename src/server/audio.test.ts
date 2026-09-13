import assert from 'node:assert/strict'
import { test } from 'node:test'
import { forWhisper, sniffAudio, transcodeReady } from './audio.ts'

const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(
    parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)),
  )
const pad = (b: Uint8Array, n = 16) => {
  const out = new Uint8Array(Math.max(n, b.length))
  out.set(b)
  return out
}

test('the container is read from the bytes', () => {
  assert.equal(sniffAudio(pad(bytes([0x1a, 0x45, 0xdf, 0xa3]))), 'webm')
  assert.equal(sniffAudio(pad(bytes('OggS'))), 'ogg')
  assert.equal(sniffAudio(pad(bytes('RIFF', [0, 0, 0, 0], 'WAVE'))), 'wav')
  assert.equal(sniffAudio(pad(bytes('ID3'))), 'mp3')
  assert.equal(sniffAudio(pad(bytes([0, 0, 0, 24], 'ftyp', 'M4A '))), 'mp4')
  assert.equal(sniffAudio(pad(bytes([0, 0, 0, 24], 'ftyp', 'isom'))), 'mp4')
  // What the recorder app on a cheap Android hands back.
  assert.equal(sniffAudio(pad(bytes([0, 0, 0, 24], 'ftyp', '3gp4'))), '3gp')
  assert.equal(sniffAudio(pad(bytes('#!AMR\n'))), 'amr')
  assert.equal(sniffAudio(pad(bytes('nonsense'))), 'unknown')
  assert.equal(sniffAudio(bytes('short')), 'unknown')
})

test('what Whisper decodes is passed through untouched', async () => {
  const webm = pad(bytes([0x1a, 0x45, 0xdf, 0xa3]), 2048)
  const r = await forWhisper(webm)
  assert.ok(r && !r.converted && r.ext === 'webm' && r.bytes === webm)
  const m4a = pad(bytes([0, 0, 0, 24], 'ftyp', 'M4A '), 2048)
  assert.equal((await forWhisper(m4a))?.ext, 'm4a')
})

/**
 * Real fixtures, made by ffmpeg itself: a second of tone in the containers a
 * phone's recorder app produces. A hand-assembled AMR frame was rejected as a
 * corrupt bitstream, which tested nothing.
 */
async function fixture(args: string[]): Promise<Uint8Array | null> {
  const ffmpeg = (await import('ffmpeg-static')).default
  if (!ffmpeg) return null
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const { mkdtemp, readFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = await mkdtemp(join(tmpdir(), 'fixture-'))
  const out = join(dir, 'clip')
  try {
    await promisify(execFile)(ffmpeg, [
      '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', ...args, out,
    ])
    return new Uint8Array(await readFile(out))
  } catch {
    return null
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('a 3gp clip from a recorder app is converted to wav', async (t) => {
  if (!transcodeReady()) return t.skip('ffmpeg-static did not install here')
  const clip = await fixture(['-c:a', 'aac', '-ar', '16000', '-ac', '1', '-f', '3gp'])
  assert.ok(clip, 'could not make the fixture')
  assert.equal(sniffAudio(clip), '3gp')
  const r = await forWhisper(clip)
  assert.ok(r, 'ffmpeg could not read the clip')
  assert.equal(r.converted, true)
  assert.equal(r.ext, 'wav')
  assert.equal(String.fromCharCode(...r.bytes.subarray(0, 4)), 'RIFF')
  assert.ok(r.bytes.length > 16000, 'a second of 16 kHz audio is at least 32 KB')
})

test('an AMR clip from a recorder app is converted to wav', async (t) => {
  if (!transcodeReady()) return t.skip('ffmpeg-static did not install here')
  const clip = await fixture(['-c:a', 'libopencore_amrnb', '-ar', '8000', '-ac', '1', '-b:a', '12.2k', '-f', 'amr'])
  if (!clip) return t.skip('this ffmpeg has no AMR encoder; decoding is native and untested here')
  assert.equal(sniffAudio(clip), 'amr')
  const r = await forWhisper(clip)
  assert.ok(r && r.converted && r.ext === 'wav')
})
