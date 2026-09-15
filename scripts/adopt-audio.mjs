/**
 * Takes the recorded clip bank from the handover into public/.
 *
 *   node scripts/adopt-audio.mjs docs/audio/step
 *
 * The clips arrive as .ogg because Android and Chrome want Opus in an Ogg container.
 * That is already what we serve as .opus — same bytes, different extension —
 * so the only real work is an AAC copy for iOS Safari, which will not play
 * Ogg at all. Nothing is re-synthesised: these are the recordings the index
 * was built against, and re-making them would risk the text no longer
 * matching the audio.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'

const src = process.argv[2] ?? 'docs/audio/step'
const out = process.argv[3] ?? 'public'
if (!existsSync(src)) {
  console.error(`no such directory: ${src}`)
  process.exit(1)
}
mkdirSync(out, { recursive: true })

const index = existsSync(join(src, 'index.json'))
  ? JSON.parse(readFileSync(join(src, 'index.json'), 'utf8'))
  : {}

const secs = (f) =>
  execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f])
    .toString().trim().slice(0, 4)

let done = 0
for (const file of readdirSync(src).filter((f) => f.endsWith('.ogg')).sort()) {
  const name = basename(file, '.ogg')
  const from = join(src, file)

  copyFileSync(from, join(out, `${name}.opus`))
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', from,
    '-c:a', 'aac', '-b:a', '48k', '-ac', '1', '-ar', '24000', join(out, `${name}.m4a`)])

  const said = index[name]
  console.log(`  ${name.padEnd(22)} ${secs(from)}s${said ? `  "${said.replace(/\n/g, ' ').slice(0, 58)}…"` : ''}`)
  done++
}
console.log(`\n  ${done} clips adopted into ${out}/ as .opus + .m4a`)
