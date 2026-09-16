import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inspect } from './fields.ts'
import { blockedOn, farewellLines, inviteLines } from '../shared/steps.ts'

/**
 * The reading of a real Punjab licence, as the local OCR produced it twice out
 * of three uploads of the same card — and, the third time, without the expiry.
 */
const CARD = [
  'DRIVING LICENSE', 'TRAFFIC POLICE, PUNJAB',
  'License No.  2003/20002', 'Name  MONIS UR RAHMAN',
  'Issue Date  12-MAY-20', 'Expiry Date  12-MAY-30',
  'CNIC No.  35202-0142726-7', 'Date of Birth  08-MAY-70',
]

test('a licence reads its expiry when the label survives', () => {
  const r = inspect('license', { lines: CARD, words: [] })
  assert.ok(r.pass)
  assert.equal(r.fields.expiry, '2030-05-12')
  assert.equal(r.fields.expired, 'false')
})

test('a licence still passes when the expiry is lost, and says it is missing', () => {
  // This is the case vision is called for: everything else read, and the one
  // field that decides whether the licence is any use did not.
  const withoutDates = CARD.filter((l) => !/Expiry Date/.test(l))
  const r = inspect('license', { lines: withoutDates, words: [] })
  assert.ok(r.pass, `refused: ${r.missing.join(', ')}`)
  assert.equal(r.fields.expiry, null)
  assert.equal(r.fields.expired, null)
  assert.equal(r.fields.number, '2003/20002')
})

test('an expiry in the past is recorded as expired', () => {
  const old = CARD.map((l) => l.replace('Expiry Date  12-MAY-30', 'Expiry Date  12-MAY-21'))
  const r = inspect('license', { lines: old, words: [] })
  assert.equal(r.fields.expiry, '2021-05-12')
  assert.equal(r.fields.expired, 'true')
  // Recorded, not refused: a re-upload cannot renew a card. What it costs the
  // rider is the verified outcome, not the upload — see the two tests below.
  assert.ok(r.pass)
})

/**
 * What an expired licence costs the rider.
 *
 * Not the upload: another photograph of the same card cannot renew it, so
 * refusing it would only loop. What it costs is the fee — an application with
 * a licence that has run out is not a verified one, so nothing is charged and
 * the rider is sent to the office once the card is renewed.
 */
test('an expired licence is named among the things the rider is waiting for', () => {
  assert.equal(blockedOn([], { licenceExpired: true }), 'naya license')
  assert.equal(blockedOn(['bike'], { licenceExpired: true }), 'apni bike aur naya license')
  assert.equal(blockedOn(['bike', 'smartphone'], { licenceExpired: true }), 'apni bike, touch phone aur naya license')
  // Unchanged for everybody else.
  assert.equal(blockedOn([], { licenceExpired: false }), null)
  assert.equal(blockedOn(['bike', 'smartphone']), 'apni bike aur touch phone')
})

test('an expired licence is asked for by name at the office, alongside the CNIC', () => {
  const lines = inviteLines('F8 Markaz', {
    owesFee: true,
    licenceExpired: true,
    waitingFor: blockedOn([], { licenceExpired: true }),
  })
  assert.match(lines[0]!, /naya license/)
  assert.match(lines.join('\n'), /CNIC aur apna naya license saath laayein/)
  // The fee is still owed; it is taken at the counter, not in the chat.
  assert.match(lines.join('\n'), /counter par jama karayein/)

  const ordinary = inviteLines('F8 Markaz', { owesFee: true })
  assert.match(ordinary.join('\n'), /Apna asli CNIC saath laayein/)
  assert.doesNotMatch(ordinary.join('\n'), /license/)
})

/**
 * A card the reader could not be sure of after two photographs. Nothing is
 * claimed about it — not that it expired, not that it did not — and the rider
 * is asked to carry the card itself, which settles the question in a second.
 */
test('a licence that could not be read is asked for at the office', () => {
  const lines = inviteLines('F8 Markaz', { owesFee: false, licenceUnread: true })
  assert.match(lines.join('\n'), /CNIC aur apna asli driving license saath laayein/)
  assert.doesNotMatch(lines.join('\n'), /counter par jama karayein/)
  assert.match(farewellLines({ owesFee: false, licenceUnread: true }).join('\n'), /asli driving license/)
})

/**
 * Nowhere a rider is sent is ever read aloud.
 *
 * Uplift pronounces a sector, a plaza or a road as though it were Urdu, and
 * the place it names is not anywhere. With more offices coming — each with its
 * own address — the rule is the whole of the fix: the words go on screen with
 * the pin, and the voice stays out of it.
 */
test('an office is named in writing and nowhere else', async () => {
  const { mentionsOffice, OFFICES, STEP_SPECS } = await import('../shared/steps.ts')
  const { SAY } = await import('../shared/messages.ts')

  for (const office of Object.values(OFFICES)) {
    assert.ok(mentionsOffice(office.address), office.address)
    assert.ok(mentionsOffice(office.short), office.short)
    // The locality on its own, as the model paraphrases it.
    assert.ok(mentionsOffice(`Aap ${office.short.split(',')[0]!} aa jayein.`))
    // The city is not an office. A rider lives in one, and the voice says it
    // perfectly well — "Achha, Islamabad!" must keep its recording.
    assert.equal(mentionsOffice(`Achha, ${office.city}! Aap ka office ye hai.`), false)
  }

  // Nothing with a recording, and no question we ask, names a place.
  for (const line of Object.values(SAY))
    assert.equal(mentionsOffice(line.text), false, line.text)
  for (const step of STEP_SPECS) assert.equal(mentionsOffice(step.ask), false, step.ask)
})

/**
 * The invitation, bubble by bubble: the address arrives written, and every
 * other line of it still speaks.
 *
 * Three things have to hold for the address to stay silent, and all three are
 * checked, because `append` speaks a plain line for any one of them: the
 * bubble is marked unscripted, a recording was made for those exact words, or
 * the line is one of ours still waiting for one.
 */
test('the office address is written but not read aloud', async () => {
  const { submitted } = await import('../client/flow.ts')
  const { mentionsOffice, OFFICES } = await import('../shared/steps.ts')
  const { audioForText, awaitingVoice } = await import('../shared/messages.ts')

  for (const office of Object.values(OFFICES)) {
    const said = submitted('verified_paid', 'Monis', office, { owesFee: false })
    const address = said.find((m) => m.content === office.address)
    assert.ok(address, 'the invitation still carries the address')
    assert.ok(mentionsOffice(address.content), 'and the rule catches it')
    assert.equal(audioForText(office.address), null)
    assert.equal(awaitingVoice(office.address), false)

    // Everything else about going to the office is still spoken — by Uplift,
    // by a recording named for the words, or by a clip travelling behind it.
    let spokenLines = 0
    said.forEach((m, i) => {
      if (m.kind || !m.content.trim() || mentionsOffice(m.content)) return
      const carried = said[i + 1]?.kind === 'audio'
      assert.ok(
        m.unscripted || audioForText(m.content) || carried,
        `silent line: ${m.content}`,
      )
      spokenLines++
    })
    assert.ok(spokenLines > 3, 'the invitation is still mostly spoken')
  }
})
