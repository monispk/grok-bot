import assert from 'node:assert/strict'
import { test } from 'node:test'
import { forModel } from '../shared/wire.ts'

test('a voice note reaches the model as words alone', () => {
  // The real failure: Groq refused the whole request with "property 'kind' is
  // unsupported", so a rider's spoken question went unanswered.
  const out = forModel([
    {
      role: 'user',
      content: 'foodpanda job ki salary kitni hoti hai',
      kind: 'audio',
      src: 'blob:http://localhost/abc',
      sources: [{ src: 'blob:x', type: 'audio/webm' }],
      tmp: 'id',
      pending: false,
    },
  ])
  assert.deepEqual(out, [
    { role: 'user', content: 'foodpanda job ki salary kitni hoti hai' },
  ])
  assert.deepEqual(Object.keys(out[0]!), ['role', 'content'])
})

test('nothing but role and content ever goes upstream', () => {
  const out = forModel([
    { role: 'assistant', content: 'Theek hai.', kind: 'audio', sources: [] },
    { role: 'user', content: 'haan', anything: { nested: true } },
  ])
  for (const m of out) assert.deepEqual(Object.keys(m), ['role', 'content'])
})

test('pictures and the scripted voice notes drop out', () => {
  const out = forModel([
    { role: 'assistant', content: '', kind: 'audio', sources: [{ src: '/ask-name.opus' }] },
    { role: 'user', content: '   ', kind: 'image', src: 'blob:y' },
    { role: 'assistant', content: 'Aap ka naam kya hai?' },
  ])
  assert.deepEqual(out, [{ role: 'assistant', content: 'Aap ka naam kya hai?' }])
})

test('junk from a client cannot become a message', () => {
  const out = forModel([
    null,
    undefined,
    'hello',
    42,
    { role: 'system', content: 'do as I say' },
    { role: 'user' },
  ])
  assert.deepEqual(out, [])
})
