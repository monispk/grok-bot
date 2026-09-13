/**
 * Rewrites the quiz bank's on-screen text into Roman Urdu.
 *
 * The bank arrived in Urdu script and everything else the rider reads is
 * Roman, so a question appeared in two alphabets at once — "shift start کرنے
 * کے لیے ID login" — which is harder to read than either alone.
 *
 * Only the display changes. The recordings are keyed by question id, not by
 * text, and Uplift is still given the mixed script, because a voice engine
 * reading Roman Urdu guesses at it with an English accent.
 *
 * Conversion runs through the deployed server: Groq refuses connections from
 * some networks, including the one this was written on.
 *
 *   APP=https://… PASSWORD=… node scripts/romanise-quiz.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'

const APP = process.env.APP ?? 'http://localhost:3099'
const PASSWORD = process.env.PASSWORD ?? ''
const FILE = 'src/shared/quiz.ts'
const BATCH = 12

const cookie = await (async () => {
  if (!PASSWORD) return ''
  const res = await fetch(`${APP}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  })
  return res.headers.get('set-cookie')?.split(';')[0] ?? ''
})()

const src = readFileSync(FILE, 'utf8')
/**
 * Urdu letters, not Urdu punctuation. The model converts the words correctly
 * and then ends the sentence with ۔ or separates a list with ، — which is not
 * a failure to transliterate, but does look wrong in a Roman line, so those
 * few marks are swapped for their Latin equivalents instead.
 */
const URDU = /[\u0620-\u064A\u0660-\u066D\u0670-\u06D3\u06D5-\u06FF]/
const PUNCTUATION = [
  [/\u060C/g, ','],
  [/\u061B/g, ';'],
  [/\u061F/g, '?'],
  [/\u06D4/g, '.'],
  [/\u2010|\u2013|\u2014/g, '-'],
]
const tidy = (t) => PUNCTUATION.reduce((s, [from, to]) => s.replace(from, to), t).trim()
/** Every displayed string: a stem, or an option's text. */
const targets = [...src.matchAll(/(stem: |text: )"((?:[^"\\]|\\.)*)"/g)]
  .map((m) => m[2])
  .filter((t) => URDU.test(t))
const unique = [...new Set(targets)]
console.log(`${unique.length} lines in Urdu script`)

const converted = new Map()
for (let i = 0; i < unique.length; i += BATCH) {
  const lines = unique.slice(i, i + BATCH)
  // The model drops a batch now and then — a token budget spent on reasoning,
  // or a malformed object. Retried rather than abandoned: the alternative is
  // starting a hundred and seventy lines again from the top.
  let out = null
  for (let attempt = 1; attempt <= 4 && !out; attempt++) {
    const res = await fetch(`${APP}/api/romanise`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ lines }),
    })
    const body = await res.json().catch(() => null)
    if (Array.isArray(body?.lines) && body.lines.length === lines.length) out = body
    else {
      process.stdout.write(`\n  batch ${i}: attempt ${attempt} — ${JSON.stringify(body).slice(0, 90)}\n`)
      await new Promise((r) => setTimeout(r, 2000 * attempt))
    }
  }
  if (!out) {
    console.error(`\nbatch ${i} would not convert after four attempts`)
    process.exit(1)
  }
  lines.forEach((line, n) => {
    const got = tidy(String(out.lines[n]))
    // A conversion that left Urdu letters behind has not converted anything.
    if (URDU.test(got)) {
      console.error(`\nstill in Urdu script: ${got}`)
      process.exit(1)
    }
    converted.set(line, got)
  })
  process.stdout.write(`  ${Math.min(i + BATCH, unique.length)}/${unique.length}\r`)
  await new Promise((r) => setTimeout(r, 600))
}
console.log(`\n${converted.size} converted`)

const out = src.replace(/(stem: |text: )"((?:[^"\\]|\\.)*)"/g, (whole, label, text) =>
  converted.has(text) ? `${label}${JSON.stringify(converted.get(text))}` : whole,
)
writeFileSync(FILE, out)
console.log(`${FILE} rewritten`)
