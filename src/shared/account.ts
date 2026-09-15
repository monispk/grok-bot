/**
 * What a rider typed, turned into numbers a bank will recognise.
 *
 * The title fetch sends the account number as an opaque string and the
 * receiving bank decides whether it knows it, so a number that is right but
 * written wrong fails exactly like a number that is wrong. Pakistani account
 * numbers arrive wrong in a handful of predictable ways, and every one of them
 * is worth trying before troubling the rider:
 *
 *   - separators of every kind, and Urdu digits from an Urdu keyboard
 *   - leading zeros gone, whole or per segment. A branch code that starts 00
 *     loses them to every spreadsheet and contact card it passes through
 *   - a branch prefix stuck in front of a number that already contains it
 *   - a mobile number written +92, 92, or without the leading zero
 *   - the IBAN quoted as "the account number"
 *
 * So one answer becomes a short ranked list, tried in order. It is not the
 * whole of the research — there is no per-bank branch directory here, and a
 * number missing its branch code cannot be repaired by guessing — but it is
 * the part that costs nothing and fixes most of what actually arrives.
 */
import type { Bank } from './banks.ts'

/** Urdu and Arabic-Indic digits, which an Urdu keyboard produces. */
const EASTERN = '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹'

export function digitsOnly(text: string): string {
  let out = ''
  for (const ch of text) {
    const e = EASTERN.indexOf(ch)
    if (e >= 0) out += String(e % 10)
    else if (ch >= '0' && ch <= '9') out += ch
  }
  return out
}

/** `PK` + 2 check digits + 4 letters + 16, however it was spaced. */
export function asIban(text: string): string | null {
  const t = text.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return /^PK\d{2}[A-Z]{4}[A-Z0-9]{16}$/.test(t) && mod97(t) ? t : null
}

/** ISO 7064 mod 97-10, the only offline check an IBAN carries. */
export function mod97(iban: string): boolean {
  const moved = iban.slice(4) + iban.slice(0, 4)
  let rest = 0
  for (const ch of moved) {
    const v = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch
    for (const d of v) rest = (rest * 10 + Number(d)) % 97
  }
  return rest === 1
}

/**
 * A Pakistani mobile number, as a wallet account is written: 03XXXXXXXXX.
 *
 * The leading zero stays. It is part of the account number for IBFT, and it is
 * the first thing lost when a number is stored as a number.
 */
export function asMobile(text: string): string | null {
  const d = digitsOnly(text)
  const local = d.startsWith('0092')
    ? d.slice(4)
    : d.startsWith('92') && d.length === 12
      ? d.slice(2)
      : d.startsWith('0')
        ? d.slice(1)
        : d
  return /^3\d{9}$/.test(local) ? `0${local}` : null
}

export type Candidate = { send: string; why: string }

/**
 * What to try, best first.
 *
 * At most a handful: every one costs a title fetch, and some banks throttle
 * repeated inquiries on the same account.
 */
export function candidates(bank: Bank, typed: string): Candidate[] {
  const out: Candidate[] = []
  const seen = new Set<string>()
  const add = (send: string, why: string) => {
    if (!send || seen.has(send)) return
    seen.add(send)
    out.push({ send, why })
  }

  // An IBAN is unambiguous and every bank that offers one accepts it. Sent
  // first when the bank's own hint says it takes one, and kept as a fallback
  // when it does not — the hints are old and several are incomplete.
  const iban = asIban(typed)

  const mobile = asMobile(typed)
  const d = digitsOnly(typed)

  if (iban && bank.iban) add(iban, 'the IBAN as given')

  // A wallet's account number is the mobile number, and nothing else is.
  if (bank.wallet && mobile) add(mobile, 'the mobile number')

  if (!bank.wallet) {
    const longest = bank.lengths[0] ?? 0

    // As typed, once the separators are gone. The commonest case is that this
    // is simply right.
    if (d && (bank.lengths.length === 0 || bank.lengths.includes(d.length)))
      add(d, 'the number as given')

    /*
     * Short by a few digits. Leading zeros are what goes missing, so they are
     * what is put back — but only up to a length the bank actually uses, and
     * only for a few digits. Padding a number that is short by six is not a
     * repair, it is a guess.
     */
    for (const n of bank.lengths) {
      if (d.length < n && n - d.length <= 4) add(d.padStart(n, '0'), `padded to ${n} digits`)
    }

    // Longer than anything the bank uses: most often a branch code written in
    // front of a number that already contains it.
    if (longest && d.length > longest) add(d.slice(d.length - longest), 'without the extra prefix')

    // Whatever is left, as typed. The bank is the authority, not our table.
    add(d, 'the number as given')
  }

  // A branchless account at a bank that also does branch accounts.
  if (!bank.wallet && mobile) add(mobile, 'as a branchless (mobile) account')

  if (iban && !bank.iban) add(iban, 'the IBAN, in case the hint is out of date')

  return out.slice(0, 4)
}
