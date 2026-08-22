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

/**
 * Roman Urdu spells long vowels inconsistently — Rasheed/Rashid, Rahmaan/Rahman,
 * Mehmood/Mehmud. Folding them to one form catches those without the guesswork
 * of a general phonetic algorithm, and leaves genuinely different names alone:
 * Asif and Arif still differ after folding.
 */
const fold = (t: string) =>
  t.replace(/ee/g, 'i').replace(/aa/g, 'a').replace(/oo/g, 'u').replace(/ii/g, 'i')

/**
 * A consonant skeleton — how the name sounds, stripped of spelling choices.
 * Soundex is tuned to English surnames and mangles these, so this handles the
 * substitutions Roman Urdu actually varies on: v/w (Naveed/Naweed), q/k/c
 * (Faruqi/Faruki), ph/f, and the vowels that carry no distinction.
 * Digraphs are protected as single symbols so "sh" never collapses to "s".
 */
function phonetic(token: string): string {
  const x = fold(token)
    .replace(/ph/g, 'f')
    .replace(/ch/g, 'C')
    .replace(/sh/g, 'S')
    .replace(/kh/g, 'K')
    .replace(/gh/g, 'G')
    .replace(/[wv]/g, 'v')
    .replace(/[qck]/g, 'k')
    .replace(/y/g, 'i')
  if (!x) return ''
  // Keep the first sound, drop interior vowels, collapse repeats.
  return (x[0]! + x.slice(1).replace(/[aeiou]/g, '')).replace(/(.)\1+/g, '$1')
}

/** Similarity that tolerates both OCR noise and vowel-spelling variance. */
const sim = (a: string, b: string) =>
  Math.max(similarity(a, b), similarity(fold(a), fold(b)))

const TOKEN_MATCH = 0.82

/**
 * OCR sometimes returns a name with the spaces missing — "KAMRANURRASHEED".
 * Rather than compare despaced blobs and hope, split the glued string back into
 * the other name's tokens. Splitting only succeeds when every piece genuinely
 * matches, so "ARIFMEHMOOD" will not quietly become "Asif Mehmood".
 */
function segment(glued: string, tokens: string[]): string[] | null {
  let rest = glued
  const out: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!
    if (i === tokens.length - 1) {
      if (sim(CANON.get(rest) ?? rest, t) < TOKEN_MATCH) return null
      out.push(rest)
      return out.map((x) => CANON.get(x) ?? x)
    }
    let bestLen = 0
    let bestScore = 0
    const lo = Math.max(1, t.length - 2)
    const hi = Math.min(rest.length - 1, t.length + 2)
    for (let len = lo; len <= hi; len++) {
      const piece = rest.slice(0, len)
      const sc = sim(CANON.get(piece) ?? piece, t)
      if (sc > bestScore) {
        bestScore = sc
        bestLen = len
      }
    }
    if (bestScore < TOKEN_MATCH || bestLen === 0) return null
    out.push(rest.slice(0, bestLen))
    rest = rest.slice(bestLen)
  }
  return null
}

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
  let left = normalise(a)
  let right = normalise(b)

  // Recover a name whose spacing OCR dropped, before any scoring happens.
  if (left.length === 1 && right.length > 1) {
    const split = segment(left[0]!, right)
    if (split) left = split
  } else if (right.length === 1 && left.length > 1) {
    const split = segment(right[0]!, left)
    if (split) right = split
  }

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
  let soundOnly = 0

  for (const token of left) {
    let bestIdx = -1
    let best = 0
    for (let i = 0; i < pool.length; i++) {
      const s = sim(token, pool[i]!)
      if (s > best) {
        best = s
        bestIdx = i
      }
    }

    if (best >= TOKEN_MATCH && bestIdx >= 0) {
      matched.push(pool[bestIdx]!)
      pool.splice(bestIdx, 1)
      continue
    }

    // Spelled differently but sounds the same. That is evidence, not proof, so
    // it counts towards overlap while forcing the verdict down to `review`.
    const key = phonetic(token)
    const idx = key ? pool.findIndex((p) => phonetic(p) === key) : -1
    if (idx >= 0) {
      matched.push(pool[idx]!)
      pool.splice(idx, 1)
      soundOnly += 1
    }
  }

  // Last resort: the despaced forms are close but splitting failed. Close is not
  // the same as certain, so this is never a match — the branch decides.
  const glued = sim(left.join(''), right.join(''))
  if (glued >= 0.85 && left.join('').length >= 8 && matched.length < left.length)
    return {
      verdict: 'review',
      score: glued,
      matched,
      strongMatches: matched.filter((t) => !WEAK.has(t)).length,
      reason: 'Close after ignoring spacing, but not conclusive',
    }

  const score = matched.length / Math.min(left.length, right.length)
  const strongMatches = matched.filter((t) => !WEAK.has(t)).length

  // A shortened name is normal — a licence may omit the family name the CNIC
  // carries. But two names sharing only "Muhammad", or only a single token, are
  // not evidence of the same person however cleanly that token matches.
  if (score >= 0.99 && matched.length >= 2 && strongMatches >= 1)
    return soundOnly > 0
      ? {
          verdict: 'review',
          score,
          matched,
          strongMatches,
          reason: 'Every name lines up, but some match only by sound',
        }
      : {
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
