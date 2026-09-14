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

/**
 * The gate on a reload, once the page has been sitting open.
 *
 * A page that has gone stale while a rider was halfway through a sentence
 * must wait. What a reload costs is the composer — the thread and the flow are
 * both on disk — but that is the one thing the rider cannot get back.
 */
test('a stale page still knows where to go; when it goes is a separate question', () => {
  const go = staleTarget({ built: 'aaa', live: 'bbb', href: 'https://x.test/', tried: null })
  assert.equal(go, 'https://x.test/?v=bbb')
  // Asked twice for the same version, it does not spin.
  assert.equal(staleTarget({ built: 'aaa', live: 'bbb', href: go!, tried: 'bbb' }), null)
})
