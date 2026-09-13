import assert from 'node:assert/strict'
import { test } from 'node:test'
import { staleTarget } from '../client/fresh.ts'

const HERE = 'https://rider.example/?chrome=no'

test('a page older than the server sends itself somewhere no cache has an answer', () => {
  const go = staleTarget({ built: 'abc1234', live: 'def5678', href: HERE, tried: null })
  assert.equal(go, 'https://rider.example/?chrome=no&v=def5678')
})

test('a page that is current stays where it is', () => {
  assert.equal(staleTarget({ built: 'abc1234', live: 'abc1234', href: HERE, tried: null }), null)
})

test('it never spins', () => {
  // The reload came back stale as well — a cache more stubborn than this, or a
  // proxy in the way. A rider seeing an old page is a problem; a rider watching
  // it reload forever is a worse one.
  assert.equal(staleTarget({ built: 'abc1234', live: 'def5678', href: HERE, tried: 'def5678' }), null)
  // But a newer deploy than the one already tried is worth one more go.
  assert.ok(staleTarget({ built: 'abc1234', live: 'ghi9012', href: HERE, tried: 'def5678' }))
})

test('a build that does not know its own commit does nothing', () => {
  // Local development, where the page is always the one just built.
  assert.equal(staleTarget({ built: '', live: 'def5678', href: HERE, tried: null }), null)
  // And a server that does not report one cannot be compared against.
  assert.equal(staleTarget({ built: 'abc1234', live: '', href: HERE, tried: null }), null)
})
