import { SAY } from '../shared/messages.ts'
import type { Reading, Word } from './ocr.ts'

export type DocKind = 'cnic_front' | 'cnic_back' | 'license' | 'bill'

export type Inspection = {
  pass: boolean
  kind: DocKind
  fields: Record<string, string | null>
  missing: string[]
  /** Roman Urdu, shown to the rider when pass is false. */
  reason: string | null
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** CNIC is printed 35202-0142726-7 on the card and 3520201427267 on a licence. */
const CNIC = /\b\d{5}[-\s]?\d{7}[-\s]?\d\b/

const cnicOf = (text: string) => {
  const m = text.match(CNIC)
  return m ? m[0].replace(/\D/g, '') : null
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

const yr = (n: number) => (n > 99 ? n : n <= 79 ? 2000 + n : 1900 + n)

/**
 * Dates arrive as 21 AUG 26, 12.08.2031, 12-MAY-30 and 24/08/26, and OCR sprays
 * spaces through them ("12- MAY-30", "08-M AY-70"), so spacing is stripped first.
 */
/** OCR routinely returns O for 0, l/I for 1, S for 5 and B for 8 in small print. */
const digits = (t: string) =>
  t.replace(/[olisb]/g, (c) => ({ o: '0', l: '1', i: '1', s: '5', b: '8' })[c] ?? c)

export function parseDate(raw: string): { iso: string; date: Date } | null {
  const s = raw.replace(/\s+/g, '').toLowerCase()

  let m = digits(s).match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})$/)
  if (m) {
    const d = new Date(Date.UTC(yr(+m[3]!), +m[2]! - 1, +m[1]!))
    return Number.isNaN(d.getTime()) ? null : { iso: d.toISOString().slice(0, 10), date: d }
  }

  // Only the day and year are digit-corrected; the month name must stay letters.
  m = s.match(/^([0-9olisb]{1,2})[.\-/]?([a-z]{3})[a-z]*[.\-/]?([0-9olisb]{2,4})$/)
  if (m && MONTHS[m[2]!]) {
    m = [m[0], digits(m[1]!), m[2]!, digits(m[3]!)] as RegExpMatchArray
    const d = new Date(Date.UTC(yr(+m[3]!), MONTHS[m[2]!]! - 1, +m[1]!))
    return Number.isNaN(d.getTime()) ? null : { iso: d.toISOString().slice(0, 10), date: d }
  }
  return null
}

const looksLikeDate = (t: string) => parseDate(t) !== null

/**
 * Reads the value for a label. OCR puts it on the same line for some documents
 * ("Name MONIS UR RAHMAN") and on the next line for others, so both are tried.
 */
function labelled(lines: string[], label: string): string | null {
  const want = squash(label)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const sq = squash(line)
    if (sq === want) {
      const next = lines[i + 1]?.trim()
      return next && squash(next) ? next : null
    }
    if (sq.startsWith(want) && sq.length > want.length) {
      // Same line: drop the label, keep the rest.
      const rest = line.replace(new RegExp(`^\\s*${label.split('').join('\\s*')}\\s*[:.]?\\s*`, 'i'), '')
      if (rest && squash(rest)) return rest.trim()
    }
  }
  return null
}

/**
 * Finds the date belonging to a label by position rather than reading order.
 *
 * Both documents that need this print their labels side by side with the values
 * on the row beneath — "Date of Issue | Date of Expiry" above "12.08.2021 |
 * 12.08.2031", and a bill that carries READING, ISSUE and DUE dates plus two
 * more for paying late. Reading order interleaves them; the column does not.
 */
export function dateUnder(words: Word[], label: string): string | null {
  const want = squash(label)

  // Utilities word this differently — DUE DATE, Due Date:, LAST DATE OF PAYMENT.
  // Accept a label that ends with the phrase, but never one qualified by
  // "after"/"within"/"payable", which is how a bill names its late-payment date.
  const isLabel = (t: string) => {
    const q = squash(t)
    if (q === want) return true
    if (!q.endsWith(want)) return false
    return !/after|within|payable|surcharge/.test(q)
  }

  const labels = words.filter((w) => isLabel(w.text))
  let best: { text: string; dy: number } | null = null

  for (const label of labels) {
    for (const w of words) {
      if (w.y <= label.y) continue
      const overlaps = w.x < label.x + label.w && w.x + w.w > label.x
      if (!overlaps || !looksLikeDate(w.text)) continue
      const dy = w.y - label.y
      if (dy > label.h * 6) continue
      if (!best || dy < best.dy) best = { text: w.text, dy }
    }
  }
  return best?.text ?? null
}

/**
 * Reads a left-aligned block of lines under a label — the consumer name and
 * address on a bill. The x tolerance is deliberately tight: the label row also
 * spans the sub-division column, whose values would otherwise be swept in.
 */
export function columnUnder(words: Word[], labels: string[], maxDyFactor = 4): string[] {
  const wanted = labels.map(squash)
  const anchor = words.find((w) => {
    const q = squash(w.text)
    return wanted.some((want) => q.includes(want))
  })
  if (!anchor) return []

  // Everything is measured against the label's own height, so the rules hold at
  // any photo resolution rather than only at the size this was written against.
  const xSlack = Math.max(anchor.h * 1.5, 12)
  const maxDy = anchor.h * maxDyFactor

  const below = words
    .filter(
      (w) =>
        w.y > anchor.y &&
        w.y - anchor.y <= maxDy &&
        w.x <= anchor.x + xSlack &&
        w.x + w.w > anchor.x - xSlack / 2,
    )
    .sort((a, b) => a.y - b.y || a.x - b.x)

  const rows: string[] = []
  let baseline = Number.NaN
  let row: string[] = []
  for (const w of below) {
    if (Number.isNaN(baseline) || Math.abs(w.y - baseline) <= Math.max(4, w.h * 0.7)) {
      if (Number.isNaN(baseline)) baseline = w.y
      row.push(w.text)
    } else {
      rows.push(row.join(' '))
      baseline = w.y
      row = [w.text]
    }
  }
  if (row.length) rows.push(row.join(' '))
  return rows.map((r) => r.trim()).filter(Boolean)
}

/** A proof of residence has to be recent to prove anything. */
const BILL_MAX_AGE_DAYS = 92

const RETRY: Record<DocKind, string> = {
  cnic_front: SAY.notCnicFront.text,
  cnic_back: SAY.notCnicBack.text,
  license: SAY.notLicense.text,
  bill: SAY.billNoDate.text,
}

export function inspect(kind: DocKind, reading: Reading): Inspection {
  const text = reading.lines.join('\n')
  const all = squash(text)
  const has = (...keys: string[]) => keys.filter((k) => all.includes(k)).length
  const fields: Record<string, string | null> = {}
  const missing: string[] = []

  if (kind === 'cnic_front') {
    fields.cnic = cnicOf(text)
    fields.name = labelled(reading.lines, 'Name')
    const expiryRaw =
      labelled(reading.lines, 'Date of Expiry') ?? dateUnder(reading.words, 'Date of Expiry')
    const expiry = expiryRaw ? parseDate(expiryRaw) : null
    fields.expiry = expiry?.iso ?? null
    // Recorded, never blocking: a re-upload cannot fix an expired card, and an
    // OCR slip on a date must not lock a rider out. The branch sees the original.
    fields.expired = expiry ? String(expiry.date.getTime() < Date.now()) : null

    const marks = has(
      'nationalidentitycard',
      'identitynumber',
      'fathername',
      'countryofstay',
      'dateofexpiry',
    )
    if (!fields.cnic) missing.push('cnic number')
    if (marks < 2) missing.push('cnic front labels')
  }

  if (kind === 'cnic_back') {
    fields.cnic = cnicOf(text)
    // The back is mostly Urdu; the reliable Latin anchor is the registrar line.
    const registrar = all.includes('regist') && all.includes('general')
    if (!fields.cnic) missing.push('cnic number')
    if (!registrar) missing.push('registrar line')
    if (all.includes('nationalidentitycard')) missing.push('this is the front, not the back')
  }

  if (kind === 'license') {
    fields.cnic = cnicOf(text)
    fields.name = labelled(reading.lines, 'Name')
    fields.number = labelled(reading.lines, 'License No')
    const licExpiryRaw =
      labelled(reading.lines, 'Expiry Date') ?? dateUnder(reading.words, 'Expiry Date')
    const licExpiry = licExpiryRaw ? parseDate(licExpiryRaw) : null
    fields.expiry = licExpiry?.iso ?? null
    fields.expired = licExpiry ? String(licExpiry.date.getTime() < Date.now()) : null

    if (!all.includes('drivinglicen')) missing.push('driving licence heading')
    if (!fields.cnic) missing.push('cnic number')
  }

  let override: string | null = null

  if (kind === 'bill') {
    const due = dateUnder(reading.words, 'Due Date')
    const parsed = due ? parseDate(due) : null
    fields.dueDate = parsed?.iso ?? null
    fields.dueDateRaw = due

    const block = columnUnder(reading.words, [
      'name address',
      'name and address',
      'consumer name',
      'nameaddress',
    ])
    fields.billName = block[0] ?? null
    fields.billAddress = block.slice(1).join(', ') || null

    if (!parsed) missing.push('due date')
    else {
      const ageDays = (Date.now() - parsed.date.getTime()) / 86_400_000
      fields.billAgeDays = String(Math.round(ageDays))
      if (ageDays > BILL_MAX_AGE_DAYS) {
        missing.push('bill older than three months')
        override = SAY.billTooOld.text
      }
    }
  }

  return {
    pass: missing.length === 0,
    kind,
    fields,
    missing,
    reason: missing.length === 0 ? null : (override ?? RETRY[kind]),
  }
}
