/**
 * Twenty conversations, driven through the real app.
 *
 * Unit tests ask a reader what one sentence means. This asks the whole flow
 * what a person means over six turns — which is where the bugs have actually
 * been: a reader that was right in isolation, used at the wrong moment, or a
 * step that walked over an answer given a question early.
 *
 * Every rider here writes the way riders write: vowels dropped, English words
 * spelled by ear, answers to the question they thought was asked. Some of them
 * are wrong on purpose.
 *
 *   npm run dev:mock     # in another terminal
 *   npm run talk
 */
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { STEP_SPECS } from '../src/shared/steps.ts'

const APP = process.env.APP ?? 'http://localhost:3099'
const ORDER = STEP_SPECS.map((s) => s.id)
const only = process.env.ONLY ? Number(process.env.ONLY) : null

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()

const settle = async (predicate, timeout = 30_000) => {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    if (await predicate()) return true
    await page.waitForTimeout(100)
  }
  return false
}

const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('grok-bot:flow') || '{}'))
const history = () => page.evaluate(() => JSON.parse(localStorage.getItem('grok-bot:history') || '[]'))

/** Waits until nothing is streaming and the thread has stopped growing. */
const quiet = async () => {
  let last = -1
  let stable = 0
  const until = Date.now() + 30_000
  while (Date.now() < until) {
    const n = await page.evaluate(
      () => document.querySelectorAll('.scroll > *').length + (document.querySelector('.fab.stop') ? 1000 : 0),
    )
    stable = n === last ? stable + 1 : 0
    last = n
    if (stable >= 8) return
    await page.waitForTimeout(150)
  }
}

const send = async (line) => {
  await page.fill('footer textarea', line)
  await page.waitForSelector('footer button.fab.send')
  await page.click('footer button.fab.send')
  await quiet()
}

/** Everything the rider would see, in order, as one readable transcript. */
const transcript = (log) =>
  log
    .filter((m) => m.content || m.kind)
    .map((m) => {
      const who = m.role === 'user' ? 'rider' : 'bot  '
      if (m.kind === 'image') return `${who} │ [photo]`
      if (m.kind === 'audio') return `${who} │ [voice note]`
      if (m.kind === 'video') return `${who} │ [video]`
      return `${who} │ ${(m.content || '').replace(/\s+/g, ' ')}`
    })
    .join('\n')

const results = []

const talk = async (title, lines, expect) => {
  await page.goto(APP)
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await settle(async () => (await history()).length > 0)
  await quiet()

  for (const line of lines) {
    await send(line)
    // Stop as soon as a document is asked for; that is as far as typing goes.
    const at = ORDER[(await state()).step ?? 0]
    if (STEP_SPECS.find((s) => s.id === at)?.kind === 'upload') break
  }

  const flow = await state()
  const log = await history()
  const problems = []
  try {
    expect({ flow, log, at: ORDER[flow.step ?? 0], text: log.map((m) => m.content || '').join('\n') })
  } catch (err) {
    problems.push(err.message)
  }

  // Applies to every conversation: the bot must never ask two questions in a
  // row without the rider having spoken in between.
  const asked = log.map((m, i) => ({ m, i })).filter(({ m }) =>
    m.role === 'assistant' && /[?؟]/.test(m.content || ''))
  for (let k = 1; k < asked.length; k++) {
    const between = log.slice(asked[k - 1].i + 1, asked[k].i)
    if (!between.some((m) => m.role === 'user'))
      problems.push(`two questions with no answer between them: "${asked[k - 1].m.content}" then "${asked[k].m.content}"`)
  }

  results.push({ title, lines, transcript: transcript(log), flow, problems })
}

const AT_UPLOAD = ({ at }) => assert.equal(at, 'license_front', `stopped at ${at}`)

const SCRIPTS = [
  // ---- 1-6: people who answer properly, in the shorthand they actually use
  ['a clean run, nothing unusual',
   ['Ali Raza', '03001234567', 'easypaisa', 'haan', 'haan'],
   (c) => { AT_UPLOAD(c); assert.equal(c.flow.rail, 'easypaisa'); assert.equal(c.flow.phone, '923001234567') }],

  ['every answer as short as it goes',
   ['Bilal Ahmed', '03456789012', 'jc', 'g', 'g'],
   (c) => { AT_UPLOAD(c); assert.equal(c.flow.rail, 'jazzcash') }],

  ['spaces and dashes in the number',
   ['Hamza Tariq', '0321-456 7890', 'ep', 'ji han', 'ji'],
   (c) => { AT_UPLOAD(c); assert.equal(c.flow.phone, '923214567890') }],

  ['the country code instead of the zero',
   ['Faisal Mehmood', '+92 333 1234567', 'jazz cash', 'haan ji', 'bilkul'],
   (c) => { AT_UPLOAD(c); assert.equal(c.flow.phone, '923331234567') }],

  ['says their name in a sentence',
   ['mera naam Adnan Sheikh hai', '03009876543', 'easypaisa hai', 'haan', 'haan'],
   (c) => { AT_UPLOAD(c); assert.equal(c.flow.firstName, 'Adnan') }],

  ['has both accounts',
   ['Zeeshan Ali', '03011112222', 'dono hain', 'haan', 'haan'],
   (c) => { AT_UPLOAD(c); assert.equal(c.flow.rail, 'both') }],

  // ---- 7-11: the answer arrives for a question that has not been asked yet
  ['no wallet, said at the number question, shorthand',
   ['Usman Khan', 'dono nhn hain', '03211234567', 'haan', 'haan'],
   (c) => {
     AT_UPLOAD(c); assert.equal(c.flow.rail, 'neither'); assert.equal(c.flow.noWallet, true)
     assert.ok(!c.text.includes('Easypaisa hai ya JazzCash'), 'asked about wallets anyway')
   }],

  ['no wallet, spelled another way again',
   ['Nadeem Abbas', 'mere paas koi nhi hai', '03331234567', 'haan', 'haan'],
   (c) => { AT_UPLOAD(c); assert.equal(c.flow.rail, 'neither') }],

  ['names the wallet at the number question',
   ['Shahid Iqbal', 'easypaisa', '03041234567', 'haan', 'haan'],
   (c) => { AT_UPLOAD(c); assert.equal(c.flow.rail, 'easypaisa'); assert.equal(c.flow.phone, '923041234567') }],

  ['gives the number at the name question',
   ['03051234567', 'Rizwan Haider', '03051234567', 'ep', 'haan', 'haan'],
   (c) => { AT_UPLOAD(c); assert.equal(c.flow.firstName, 'Rizwan') }],

  ['answers the wallet question before it is asked, in Urdu script',
   ['Kamran Yousaf', 'میرے پاس کوئی نہیں ہے', '03061234567', 'haan', 'haan'],
   (c) => { AT_UPLOAD(c); assert.equal(c.flow.rail, 'neither') }],

  // ---- 12-15: wrong answers, because the question was misread
  ['answers "haan" to the name question',
   ['haan', 'Tariq Jameel', '03071234567', 'jc', 'haan', 'haan'],
   (c) => AT_UPLOAD(c)],

  ['a number one digit too long, then right',
   ['Waqar Younis', '033482344444', '03348234444', 'ep', 'haan', 'haan'],
   (c) => { AT_UPLOAD(c); assert.equal(c.flow.phone, '923348234444')
     assert.ok(c.text.includes('theek nahi lag raha'), 'was not told the number was wrong') }],

  ['a landline, which is not a mobile',
   ['Sajid Hussain', '0421234567', '03081234567', 'jc', 'haan', 'haan'],
   (c) => { AT_UPLOAD(c); assert.equal(c.flow.phone, '923081234567') }],

  ['does not know what a wallet is',
   ['Naveed Anjum', '03091234567', 'pata nhi', 'easypaisa', 'haan', 'haan'],
   (c) => { AT_UPLOAD(c); assert.equal(c.flow.rail, 'easypaisa') }],

  // ---- 16-18: gates answered no, which records and carries on
  ['no smartphone',
   ['Arif Mahmood', '03101234567', 'ep', 'nhn', 'haan'],
   (c) => { AT_UPLOAD(c); assert.deepEqual(c.flow.missing, ['smartphone']) }],

  ['no bike',
   ['Junaid Akhtar', '03111234567', 'jc', 'haan', 'nhi'],
   (c) => { AT_UPLOAD(c); assert.deepEqual(c.flow.missing, ['bike']) }],

  ['neither phone nor bike',
   ['Rashid Minhas', '03121234567', 'ep', 'nahi', 'nahi'],
   (c) => { AT_UPLOAD(c); assert.deepEqual(c.flow.missing, ['smartphone', 'bike']) }],

  // ---- 19-20: junk and questions
  ['junk, then answers properly',
   ['asdfgh', 'Saad Rehman', '03131234567', 'ep', 'haan', 'haan'],
   (c) => AT_UPLOAD(c)],

  ['asks about pay in the middle',
   ['Imran Nazir', 'salary kitni milti hai', '03141234567', 'ep', 'haan', 'haan'],
   (c) => { AT_UPLOAD(c); assert.equal(c.flow.phone, '923141234567') }],
]

for (const [i, [title, lines, expect]] of SCRIPTS.entries()) {
  if (only !== null && only !== i + 1) continue
  process.stderr.write(`  ${String(i + 1).padStart(2)} ${title}\n`)
  await talk(title, lines, expect)
}

await browser.close()

let failed = 0
for (const [i, r] of results.entries()) {
  const n = SCRIPTS.findIndex(([t]) => t === r.title) + 1
  console.log(`\n${'='.repeat(72)}\n${n}. ${r.title}`)
  console.log(r.transcript)
  console.log(`  → step: ${ORDER[r.flow.step] ?? 'done'}  phone: ${r.flow.phone ?? '-'}  ` +
    `rail: ${r.flow.rail ?? '-'}  missing: ${(r.flow.missing ?? []).join(',') || '-'}`)
  if (r.problems.length) {
    failed++
    for (const p of r.problems) console.log(`  ✗ ${p}`)
  } else console.log('  ✓')
}
console.log(`\n${results.length - failed}/${results.length} conversations clean`)
process.exitCode = failed ? 1 : 0
