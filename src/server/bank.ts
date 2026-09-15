/**
 * Which bank a rider means.
 *
 * The list settles most of it for nothing: a rider says "HBL", "meezan",
 * "mera account UBL mein hai". What it will not settle is a name that belongs
 * to more than one bank — "Habib" is HBL, Bank AL Habib and Habib Metropolitan,
 * three banks with three different account formats — and there the model is
 * asked, with the list in front of it, and its answer is checked back against
 * the list before it is believed.
 */
import { ambiguousBank, BANKS, bankById, knownBank, type Bank } from '../shared/banks.ts'
import { phonetic, similarity } from './names.ts'
import { completeJson } from './provider.ts'

const PROMPT = `You decide which Pakistani bank a person means.
They were asked "Aap ka bank account kis bank mein hai?" and answered in Roman Urdu, English or Urdu script.

Reply with JSON only: {"bank_id": string|null, "unsure": true|false}

"bank_id" must be one of these ids, or null:
${BANKS.map((b) => `${b.id} = ${b.name}`).join('\n')}

Rules:
- A name that could be more than one of these — "Habib" is Habib Bank, Bank AL Habib and Habib Metropolitan — is not an answer. Set bank_id null and unsure true.
- A bank that is not on the list at all: bank_id null, unsure false.
- A wallet name (JazzCash, Easypaisa, SadaPay, NayaPay, UPaisa) is on the list; use it.
- Never invent an id.`

export type BankGuess = {
  id: string | null
  name: string | null
  /** The answer named something, but more than one bank answers to it. */
  unsure: boolean
  by: 'list' | 'model' | 'none'
}

/**
 * The bank a rider meant, when they did not spell it the way we do.
 *
 * "Meezn", "mezan", "alfalh", "askri", "faysel", "standerd chartered" — a
 * rider types a bank's name from memory on a phone keyboard, and a list that
 * only accepts exact spellings sends every one of them to a model call, or
 * worse, to "we cannot check that bank".
 *
 * Matched token by token against the distinctive words of each bank's names —
 * near-miss spelling or a sound-alike, the same two tests the CNIC name
 * comparison uses, because the problem is the same one. Generic words are not
 * distinctive and are ignored: matching on "bank" would match everything.
 */
const GENERIC = new Set([
  'bank', 'limited', 'ltd', 'pakistan', 'the', 'of', 'commercial',
  'microfinance', 'islamic', 'islami', 'pvt', 'company',
])

const words = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean)

const distinctive = (b: Bank) => {
  const out = new Set<string>()
  for (const phrase of [b.name, ...b.aliases])
    for (const w of words(phrase)) if (!GENERIC.has(w) && w.length >= 3) out.add(w)
  return [...out]
}

const closeEnough = (a: string, b: string) =>
  a === b || similarity(a, b) >= 0.8 || (phonetic(a) !== '' && phonetic(a) === phonetic(b))

function scored(text: string): { bank: Bank; score: number }[] {
  const said = words(text).filter((w) => !GENERIC.has(w) && w.length >= 3)
  if (!said.length) return []
  const out: { bank: Bank; score: number }[] = []
  for (const b of BANKS) {
    let best = 0
    for (const key of distinctive(b))
      for (const w of said)
        if (closeEnough(w, key)) best = Math.max(best, Math.max(similarity(w, key), 0.8))
    if (best) out.push({ bank: b, score: best })
  }
  return out.sort((x, y) => y.score - x.score)
}

/** One bank, clearly closer than any other. */
function nearestBank(text: string): { bank: Bank; score: number } | null {
  const hits = scored(text)
  if (!hits.length) return null
  if (hits.length === 1) return hits[0]!
  // A near-miss that fits two banks equally well is the same problem as
  // "Habib": a question, not an answer.
  return hits[0]!.score > hits[1]!.score + 0.001 ? hits[0]! : null
}

const ambiguousNear = (text: string) => scored(text).length > 1

export async function readBank(text: string): Promise<BankGuess> {
  const trimmed = text.slice(0, 120).trim()
  if (!trimmed) return { id: null, name: null, unsure: false, by: 'none' }

  const known = knownBank(trimmed)
  if (known) return { id: known.id, name: known.name, unsure: false, by: 'list' }
  // The list can settle "this is more than one bank" on its own, and should:
  // asking a model which Habib they meant would get an answer either way.
  if (ambiguousBank(trimmed)) return { id: null, name: null, unsure: true, by: 'list' }

  const close = nearestBank(trimmed)
  if (close) return { id: close.bank.id, name: close.bank.name, unsure: false, by: 'list' }
  if (close === null && ambiguousNear(trimmed))
    return { id: null, name: null, unsure: true, by: 'list' }

  const out = await completeJson(PROMPT, trimmed)
  if (!out) return { id: null, name: null, unsure: false, by: 'none' }

  // Checked against the list rather than trusted: a model asked for one of
  // thirty-three ids will occasionally produce a thirty-fourth.
  const picked = typeof out.bank_id === 'string' ? bankById(out.bank_id.trim()) : undefined
  return {
    id: picked?.id ?? null,
    name: picked?.name ?? null,
    unsure: out.unsure === true,
    by: 'model',
  }
}

export type { Bank }
