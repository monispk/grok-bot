/**
 * Records a line in Rozeena's voice and writes the three files the app serves.
 *
 *   node scripts/voice.mjs ask-phone "Aap ka mobile number kya hai?"
 *   node scripts/voice.mjs --from docs/audio/step/index.json      # a whole bank
 *
 * Uplift is given mixed script — Urdu words in Urdu, English left in Latin —
 * because a voice engine reading Roman Urdu guesses, and guesses with an
 * English accent. The conversion is the same one the live server uses.
 *
 * It writes .mp3 (what Uplift returns), .opus (Android, Chrome) and
 * .m4a (iOS Safari will not play Ogg). The player picks whichever the browser
 * says it can decode.
 *
 * Needs UPLIFT_API_KEY and GROQ_API_KEY in the environment.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { forSpeech } from '../src/server/script.ts'

const KEY = process.env.UPLIFT_API_KEY ?? ''
const VOICE = process.env.UPLIFT_VOICE_ID ?? 'helpdesk-agent'
const OUT = process.env.VOICE_OUT ?? 'public'

if (!KEY) {
  console.error('UPLIFT_API_KEY is not set.')
  process.exit(1)
}

async function say(name, text, raw = false) {
  // --raw hands Uplift the words unchanged. The converter is not deterministic,
  // and for a line every rider hears — the welcome — the pauses and the
  // pronunciations are worth pinning down by hand.
  const spoken = raw ? text : await forSpeech(text)

  // forSpeech falls back to the Roman Urdu when the conversion fails, which is
  // right at runtime — an accent beats silence — and wrong here. A recording is
  // permanent: this wrote two clips read letter by letter in English before
  // anything said the conversion had not happened.
  if (!raw && !/[\u0600-\u06FF]/.test(spoken)) {
    console.error(`  ${name}: the script conversion produced no Urdu — is GROQ_API_KEY set?`)
    return false
  }
  const res = await fetch('https://api.upliftai.org/v1/synthesis/text-to-speech', {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ voiceId: VOICE, text: spoken, outputFormat: 'MP3_22050_128' }),
  })
  if (!res.ok) {
    console.error(`  ${name}: uplift ${res.status} ${(await res.text()).slice(0, 160)}`)
    return false
  }
  mkdirSync(OUT, { recursive: true })
  const mp3 = `${OUT}/${name}.mp3`
  writeFileSync(mp3, Buffer.from(await res.arrayBuffer()))

  // A short pad: some players clip the last syllable without it.
  const pad = ['-af', 'apad=pad_dur=0.4']
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp3, ...pad,
    '-c:a', 'libopus', '-b:a', '32k', '-ac', '1', '-ar', '48000', `${OUT}/${name}.opus`])
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp3, ...pad,
    '-c:a', 'aac', '-b:a', '48k', '-ac', '1', '-ar', '24000', `${OUT}/${name}.m4a`])

  const secs = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'csv=p=0', `${OUT}/${name}.opus`]).toString().trim().slice(0, 4)
  console.log(`  ${name}  ${secs}s`)
  console.log(`      text: ${text}`)
  console.log(`      says: ${spoken}`)
  return true
}

const args = process.argv.slice(2).filter((a) => a !== '--raw')
const raw = process.argv.includes('--raw')
if (args[0] === '--from') {
  const bank = JSON.parse(readFileSync(args[1], 'utf8'))
  for (const [name, text] of Object.entries(bank)) {
    await say(name, text, raw)
    await new Promise((r) => setTimeout(r, 1200)) // the script pass is rate limited
  }
} else {
  const [name, ...rest] = args
  if (!name || !rest.length) {
    console.error('usage: node scripts/voice.mjs <name> "<roman urdu text>"')
    process.exit(1)
  }
  await say(name, rest.join(' '), raw)
}
