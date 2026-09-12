import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ASK_COUNT, pickQuestions, QUESTIONS, readChoice } from '../shared/quiz.ts'

test('the bank is whole, and every question offers three options', () => {
  assert.equal(QUESTIONS.length, 47)
  for (const q of QUESTIONS) {
    assert.ok(q.stem.length > 10, `${q.id} has no question`)
    assert.deepEqual(q.options.map((o) => o.key), ['a', 'b', 'c'], `${q.id} options`)
    for (const o of q.options) assert.ok(o.text.length > 0, `${q.id} option ${o.key} is empty`)
  }
})

test('ten questions, never the same one twice, spread across the bank', () => {
  for (let run = 0; run < 50; run++) {
    const picked = pickQuestions()
    assert.equal(picked.length, ASK_COUNT)
    assert.equal(new Set(picked.map((q) => q.id)).size, ASK_COUNT, 'a question repeated')
    // One from each slice: the ids must climb.
    const ns = picked.map((q) => Number(q.id.slice(1)))
    assert.deepEqual(ns, [...ns].sort((x, y) => x - y), 'not drawn in bank order')
  }
})

test('an answer is understood however it is given', () => {
  for (const said of ['a', 'A', 'option a', '1', 'aik', 'ایک']) assert.equal(readChoice(said), 'a', said)
  for (const said of ['b', 'option b', '2', 'doosra', 'دو']) assert.equal(readChoice(said), 'b', said)
  for (const said of ['c', 'option c', '3', 'teen', 'تین']) assert.equal(readChoice(said), 'c', said)
})

test('anything else is not an answer', () => {
  for (const said of ['', 'pata nahi', 'haan', 'd', '4']) assert.equal(readChoice(said), null, said)
})
