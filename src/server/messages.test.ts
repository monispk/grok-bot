import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { test } from 'node:test'
import { inspect } from './fields.ts'
import { audioForText, SAY } from '../shared/messages.ts'

test('every voiced message resolves to its own recording', () => {
  for (const [key, spoken] of Object.entries(SAY))
    assert.equal(
      audioForText(spoken.text),
      spoken.recorded ? spoken.audio : null,
      `${key} did not resolve`,
    )
})

test('every recording the bot would send actually exists', () => {
  // A missing file 404s and the player quietly removes itself, leaving the
  // rider a silent gap. Catch it here instead of in front of them.
  const dir = new URL('../../public/', import.meta.url)
  for (const [key, spoken] of Object.entries(SAY)) {
    if (!spoken.recorded) continue
    for (const ext of ['.opus', '.m4a'])
      assert.ok(
        existsSync(new URL(`.${spoken.audio}${ext}`, dir)),
        `${key} promises ${spoken.audio}${ext}, which is not in public/`,
      )
  }
})

test('an unrecognised line has no recording', () => {
  // Something the bot could say but nobody recorded — a model's own words.
  assert.equal(audioForText('Aap ko hafte mein taqreeban Rs. 15,000 mil saktay hain.'), null)
  assert.equal(audioForText(''), null)
})

test('the refusals the document rules emit are in the lookup', () => {
  // A reading with nothing in it fails every document kind, which is the path
  // that produces the per-document refusals.
  const empty = { lines: [], words: [] }
  for (const kind of ['cnic_front', 'cnic_back', 'license', 'bill'] as const) {
    const reason = inspect(kind, empty).reason
    assert.ok(reason, `${kind} produced no reason`)
    assert.ok(audioForText(reason), `${kind} reason is not in the lookup: ${reason}`)
  }
})

test('a licence whose heading is damaged by glare is still a licence', async () => {
  const { inspect } = await import('./fields.ts')
  // A real Punjab licence, rejected in front of a rider. Glare across the
  // heading ate the N in DRIVING; every other field read perfectly.
  const glared = [
    'DRIVI G LICENSE', 'TRAFFIC POLICE, PUNJAB',
    'License No.  LE-24-123386', 'Name  ALTAF HUSSAIN', 'S/D/W  MUHAMMAD AMIR',
    'Address  HOUSE # 23-A, WARIS COLONY', 'IQBAL TOWN WAHDAT ROAD', 'LAHORE',
    'Issue Date  07-SEP-24', 'Expiry Date  07-SEP-27',
    'CNIC No.  35202-2762658-7', 'Date of Birth  13-DEC-05', 'Height  6',
    'LAHORE', 'LICENCING AUTHORITY', 'PUNJAB',
  ]
  const r = inspect('license', { lines: glared, words: [] })
  assert.ok(r.pass, `rejected: ${r.missing.join(', ')}`)
  assert.equal(r.fields.name, 'ALTAF HUSSAIN')
  assert.equal(r.fields.cnic, '3520227626587')
  assert.equal(r.fields.number, 'LE-24-123386')
  assert.equal(r.fields.expiry, '2027-09-07')

  // And with the heading gone entirely — the labels still say what it is.
  const noHeading = inspect('license', { lines: glared.slice(2), words: [] })
  assert.ok(noHeading.pass, `rejected: ${noHeading.missing.join(', ')}`)
})

test('something that is not a licence is still refused', async () => {
  const { inspect } = await import('./fields.ts')
  // A CNIC sent at the licence step: no licence labels anywhere on it.
  const cnic = inspect('license', {
    lines: [
      'PAKISTAN', 'National Identity Card', 'Name  ALTAF HUSSAIN',
      'Father Name  MUHAMMAD AMIR', 'Identity Number  35202-2762658-7',
      'Country of Stay  Pakistan', 'Date of Expiry  12.08.2031',
    ],
    words: [],
  })
  assert.equal(cnic.pass, false)
  assert.ok(cnic.missing.includes('driving licence labels'))

  // A photograph of nothing in particular.
  const nothing = inspect('license', { lines: ['HELLO', 'WORLD'], words: [] })
  assert.equal(nothing.pass, false)
})
