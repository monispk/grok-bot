/**
 * Comparing a name from a CNIC against one from a licence, or against what the
 * rider typed. Exact string equality is useless here: Urdu names have no single
 * Roman spelling, documents print them in different orders and lengths, and OCR
 * adds its own noise.
 */

/** Spelling variants that mean the same name. Left side is the canonical form. */
const VARIANTS: Record<string, string[]> = {
  muhammad: ['mohammad', 'mohammed', 'muhammed', 'mohd', 'md', 'mohamad', 'muhamad'],
  ahmed: ['ahmad', 'ahmet'],
  rahman: ['rehman', 'ur-rahman', 'urrahman'],
  hussain: ['hussein', 'hussian', 'husain', 'hosain'],
  syed: ['sayed', 'sayyid', 'saiyed', 'sayyed'],
  abdul: ['abdel', 'abd', 'abdool'],
  ali: [],
  hasan: ['hassan'],
  hussnain: ['husnain'],
  bilal: [],
  khan: [],
  shaikh: ['sheikh', 'shaykh'],
  siddiqui: ['siddiqi', 'sidiqui'],
  qureshi: ['quraishi', 'qureshy'],
  iqbal: [],
  javed: ['javaid', 'jawaid', 'javid'],
  nawaz: [],
  aslam: [],
  akhtar: ['akhter'],
  anwar: ['anwer'],
  bibi: [],
  begum: ['baigum'],
  fatima: ['fatimah'],
  ayesha: ['aisha', 'ayisha', 'aayesha'],
}

const CANON = new Map<string, string>()
for (const [canonical, alts] of Object.entries(VARIANTS)) {
  CANON.set(canonical, canonical)
  for (const a of alts) CANON.set(a, canonical)
}

/**
 * Tokens too common to identify anyone. "Muhammad" prefixes a large share of
 * Pakistani male names, so two names sharing only that are not a match.
 */
const WEAK = new Set(['muhammad', 'syed', 'abdul', 'mr', 'mrs', 'ms', 'bibi', 'begum'])

/** Relationship markers printed on CNICs and licences, not part of the name. */
const NOISE = new Set([
  's', 'o', 'd', 'w', 'so', 'do', 'wo', 'son', 'daughter', 'wife', 'of',
  'bin', 'binte', 'binti', 'name', 'holder',
])

export function normalise(raw: string): string[] {
  return raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0 && !NOISE.has(t))
    .map((t) => CANON.get(t) ?? t)
}

/** Levenshtein similarity, 0..1 — absorbs OCR slips like rn/m or l/1. */
function similarity(a: string, b: string): number {
  if (a === b) return 1
  const m = a.length
  const n = b.length
  if (m === 0 || n === 0) return 0
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const curr = [i]
    for (let j = 1; j <= n; j++) {
      curr[j] = Math.min(
        prev[j]! + 1,
        curr[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    prev = curr
  }
  return 1 - prev[n]! / Math.max(m, n)
}

const TOKEN_MATCH = 0.82

export type Verdict = 'match' | 'review' | 'mismatch'
export type NameComparison = {
  verdict: Verdict
  score: number
  matched: string[]
  strongMatches: number
  reason: string
}

/**
 * Compares two names. Shorter forms are expected — a licence may carry
 * "Muhammad Bilal" where the CNIC carries "Muhammad Bilal Ahmed" — so scoring is
 * containment of the shorter name, not equality. A `review` verdict is not a
 * failure: it means send them to the branch, where staff see the originals.
 */
export function compareNames(a: string, b: string): NameComparison {
  const left = normalise(a)
  const right = normalise(b)

  if (!left.length || !right.length)
    return {
      verdict: 'mismatch',
      score: 0,
      matched: [],
      strongMatches: 0,
      reason: 'One of the names is empty',
    }

  const pool = [...right]
  const matched: string[] = []

  for (const token of left) {
    let bestIdx = -1
    let best = 0
    for (let i = 0; i < pool.length; i++) {
      const s = similarity(token, pool[i]!)
      if (s > best) {
        best = s
        bestIdx = i
      }
    }
    if (best >= TOKEN_MATCH && bestIdx >= 0) {
      matched.push(pool[bestIdx]!)
      pool.splice(bestIdx, 1)
    }
  }

  const score = matched.length / Math.min(left.length, right.length)
  const strongMatches = matched.filter((t) => !WEAK.has(t)).length

  // A shortened name is normal — a licence may omit the family name the CNIC
  // carries. But two names sharing only "Muhammad", or only a single token, are
  // not evidence of the same person however cleanly that token matches.
  if (score >= 0.99 && matched.length >= 2 && strongMatches >= 1)
    return {
      verdict: 'match',
      score,
      matched,
      strongMatches,
      reason: 'Every token of the shorter name matched',
    }

  if (score >= 0.99)
    return {
      verdict: 'review',
      score,
      matched,
      strongMatches,
      reason: 'Too little in common to be sure',
    }

  if (score >= 0.6 && strongMatches >= 1)
    return { verdict: 'review', score, matched, strongMatches, reason: 'Partial overlap' }

  return { verdict: 'mismatch', score, matched, strongMatches, reason: 'Names differ' }
}
