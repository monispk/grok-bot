import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inspect } from './fields.ts'
import { audioForText, SAY } from '../shared/messages.ts'

test('every message resolves to its own recording', () => {
  for (const [key, spoken] of Object.entries(SAY))
    assert.equal(audioForText(spoken.text), spoken.audio, `${key} did not resolve`)
})

test('an unrecognised line has no recording', () => {
  assert.equal(audioForText('Shukriya, tasveer mil gayi.'), null)
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
