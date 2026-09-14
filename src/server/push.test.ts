import assert from 'node:assert/strict'
import { test } from 'node:test'
import { delta, forBackend, voicePairs } from './push.ts'
import { trackable, unflatten } from './ingest.ts'

const ID = '11111111-2222-4333-8444-555555555555'
const hash = (s: string) => `h${s.length}`

test('only what the backend has not acknowledged is sent again', () => {
  const now = { candidate_name: 'Monis', 'collected.bike': 'haan', from_number: '923348234444' }
  const sent = { candidate_name: 'Monis', 'collected.bike': 'nahi' }
  assert.deepEqual(delta(now, sent), { 'collected.bike': 'haan', from_number: '923348234444' })
  // Nothing changed means nothing queued, however often it is saved.
  assert.deepEqual(delta(sent, sent), {})
})

/**
 * The conversation counts as one thing. Sixty bubbles flattened would be
 * hundreds of entries that all shift whenever a rider says anything, and the
 * question "have they seen this?" would be answered wrongly for all of them.
 */
test('the transcript is tracked as a single key that moves when it moves', () => {
  const one = trackable(
    { candidate_name: 'Monis', messages: [{ role: 'user', content: 'hi', type: 'text' }] },
    hash,
  )
  const two = trackable(
    {
      candidate_name: 'Monis',
      messages: [
        { role: 'user', content: 'hi', type: 'text' },
        { role: 'user', content: 'again', type: 'text' },
      ],
    },
    hash,
  )
  assert.equal(typeof one['messages'], 'string')
  assert.notEqual(one['messages'], two['messages'])
  assert.equal(one['candidate_name'], two['candidate_name'])
  assert.equal(Object.keys(delta(two, one)).join(), 'messages')
})

test('a changed field rebuilds into the nesting their API merges by', () => {
  assert.deepEqual(
    unflatten({
      'collected.bike': 'haan',
      'validation_results.identity_verification.detail.front_cnic': '3520201427267',
      phase: 'complete',
    }),
    {
      collected: { bike: 'haan' },
      validation_results: { identity_verification: { detail: { front_cnic: '3520201427267' } } },
      phase: 'complete',
    },
  )
})

test('working state of ours is never a field they are owed', () => {
  const flat = forBackend(
    ID,
    {
      applicationId: ID,
      fullName: 'Monis',
      resume: { id: 'x', firstName: 'M', step: 3 },
      sentBranch: true,
      payRetried: true,
      step: 2,
      collected: {},
    },
    [],
  )
  const names = Object.keys(flat)
  assert.ok(!names.some((n) => /resume|sentBranch|payRetried|applicationId/.test(n)), names.join())
  assert.equal(flat['candidate_name'], 'Monis')
})

/**
 * A recording belongs to a message, and the two lists are matched by position
 * and never by content. A rider who answers "haan" twice produces two
 * identical messages, and matching on the words would attach the audio to
 * whichever came first.
 */
test('a recording is paired with its message by position', () => {
  const VOICE = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
  const OTHER = 'ffffffff-1111-4222-8333-444444444444'
  const messages = [
    { role: 'assistant', type: 'text', content: 'Kya aap ke paas bike hai?' },
    { role: 'user', type: 'voice', content: 'haan', audio_url: `https://x.test/api/upload/${VOICE}` },
    { role: 'assistant', type: 'text', content: 'Aur touch phone?' },
    { role: 'user', type: 'voice', content: 'haan', audio_url: `https://x.test/api/upload/${OTHER}` },
  ]
  assert.deepEqual(voicePairs(messages as never, [22332, 22333, 22334, 22335]), [
    { uploadId: VOICE, messageId: 22333 },
    { uploadId: OTHER, messageId: 22335 },
  ])
})

test('a voice note with no recording of ours is not queued', () => {
  const messages = [{ role: 'user', type: 'voice', content: 'haan ji' }]
  assert.deepEqual(voicePairs(messages as never, [22332]), [])
})

test('nothing is paired when the ids did not arrive', () => {
  const messages = [
    { role: 'user', type: 'voice', content: 'haan', audio_url: 'https://x.test/api/upload/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' },
  ]
  assert.deepEqual(voicePairs(messages as never, undefined), [])
  assert.deepEqual(voicePairs(messages as never, [null]), [])
  assert.deepEqual(voicePairs(undefined, [1]), [])
})
