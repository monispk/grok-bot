import { SAY } from '../shared/messages.ts'
import { inspect, type DocKind } from './fields.ts'
import { compareNames } from './names.ts'
import { ocrReady, readCnicFront } from './rozee.ts'
import { read, SPARSE_WORDS, SURE } from './ocr.ts'
import { readLicence, visionReady } from './vision.ts'
import { lastResortReady, readLicenceLastResort } from './vision-openai.ts'

export type Verification = {
  pass: boolean
  checked: boolean
  reason: string | null
  missing: string[]
  fields: Record<string, string | null>
  nameVerdict: string | null
  nameScore: number | null
}

const open = (reason: string | null = null): Verification => ({
  pass: true,
  checked: false,
  reason,
  missing: [],
  fields: {},
  nameVerdict: null,
  nameScore: null,
})

/**
 * One document, checked. Shared by the web upload route and the WhatsApp bot so
 * a rider gets the same answer whichever way they applied.
 *
 * Fails open throughout: no OCR, an unrasterisable PDF or a thrown model call
 * accepts the document unchecked rather than trapping someone behind our
 * pipeline. The branch visit is the backstop.
 */
export async function verifyDocument(opts: {
  kind: DocKind | null
  bytes: Uint8Array
  mime: string
  expectedName?: string
  expectedCnic?: string
  /** Which try this is at the same step. A second one is not refused twice. */
  attempt?: number
}): Promise<Verification> {
  const { kind, bytes, mime, expectedName = '', expectedCnic = '', attempt = 1 } = opts
  if (!kind) return open()

  /**
   * A CNIC front goes to Rozee first. It reads the card properly and says so
   * in its own words — "Not a valid front side" beats inferring a refusal from
   * a field we failed to find. Our own reader stays as the fallback, because a
   * service that does not answer must never cost a rider their application.
   *
   * A photograph only: the endpoint is built for the printed face, and a PDF
   * goes straight to the local path.
   */
  if (kind === 'cnic_front' && mime !== 'application/pdf' && ocrReady()) {
    const seen = await readCnicFront(bytes)
    if (seen.outcome === 'fail')
      return {
        pass: false,
        checked: true,
        reason: SAY.notCnicFront.text,
        missing: [seen.reason],
        fields: {},
        nameVerdict: null,
        nameScore: null,
      }
    if (seen.outcome === 'pass')
      return settle(
        { name: seen.fields.name, cnic: seen.fields.cnic, father: seen.fields.father },
        true,
        null,
        [],
        expectedName,
        expectedCnic,
      )
    // unavailable: fall through and read it ourselves.
    console.log('rozee ocr unavailable, reading the CNIC locally')
  }

  const reading = await read(bytes, mime)
  const isPhoto = mime !== 'application/pdf'

  // Almost nothing was read: a tilted, blurred or dark photo. Guessing from a
  // partial read is worse than asking for another one.
  //
  // Photos only. A PDF's text layer either extracts or it does not, and a short
  // one is not a bad photograph — treating it as one told a rider their bill was
  // blurred when the real answer was that it had expired.
  const sparse = !reading || (isPhoto && reading.words.length < SPARSE_WORDS)

  const found = reading && !sparse ? inspect(kind, reading) : null

  /**
   * A licence that read, but not well enough.
   *
   * Two values decide what a licence is worth: the number, which identifies
   * it, and the expiry, which says whether it is any use. The local reader
   * loses the expiry about a third of the time — the same card, uploaded three
   * times, gave the date twice — and when it does read one, it does not always
   * read it right. A guessed digit in a date has told a rider with a card good
   * until 2031 that theirs expired in 2021.
   *
   * So a card missing either value, or unsure of either, goes to the vision
   * model. It is the better reader and it is looking at the same pixels, so
   * what it says replaces a guess and fills a gap. What the local reader was
   * sure of is kept: it read that off the image, and a model asked to check a
   * doubtful field should not get to rewrite a confident one.
   */
  if (found?.pass && kind === 'license' && isPhoto) {
    const f = found.fields
    const shaky = (value: string | null | undefined, score: string | null | undefined) =>
      !value || (score != null && Number(score) < SURE)

    const filled: Record<string, string | null> = { ...f }
    const doubtful = () => shaky(filled.number, filled.numberScore) || shaky(filled.expiry, filled.expiryScore)

    /** Takes whatever a reader saw, for the values still in doubt. */
    const absorb = (seen: Awaited<ReturnType<typeof readLicence>>, who: string) => {
      if (!seen?.isLicence || !(seen.expiry || seen.number || seen.name)) return false
      let used = false
      for (const [key, value, score] of [
        ['expiry', seen.expiry, filled.expiryScore],
        ['number', seen.number, filled.numberScore],
        ['name', seen.name, null],
        ['cnic', seen.cnic, null],
      ] as const) {
        if (!value) continue
        if (filled[key] && !shaky(filled[key], score)) continue
        filled[key] = value
        // Read off the image by a model that looked at it. There is no score
        // to put on that, and its absence means "no longer in doubt".
        if (key === 'expiry') delete filled.expiryScore
        if (key === 'number') delete filled.numberScore
        used = true
      }
      if (used) {
        filled.readBy = filled.readBy ? `${filled.readBy} + ${who}` : `local OCR + ${who}`
        console.log(`${who}: corrected or filled a licence the reader was unsure of`)
      }
      return used
    }

    /*
     * Three readers, cheapest first, each one asked only about what is still
     * in doubt. Qwen handles the provincial formats the label matching was
     * never taught; the last resort costs perhaps twenty times as much and is
     * reached only for the cards it cannot manage either — a glared laminate,
     * a torn card, a photograph taken at an angle in the dark.
     */
    if (doubtful() && visionReady()) absorb(await readLicence(bytes, mime), 'vision')
    if (doubtful() && lastResortReady())
      absorb(await readLicenceLastResort(bytes, mime), 'openai vision')

    // Recomputed from whatever the expiry finally is, sure or not.
    filled.expired = filled.expiry
      ? String(new Date(filled.expiry).getTime() < Date.now())
      : null

    /*
     * Still a guess. One more photograph, with the three things that actually
     * fix it — light, glare, and holding the camera square — and if that does
     * not work either, the card goes to the office in the rider's hand rather
     * than the rider going home.
     */
    const unsure = shaky(filled.number, filled.numberScore) || shaky(filled.expiry, filled.expiryScore)
    if (unsure && attempt < 2)
      return {
        pass: false,
        checked: true,
        reason: SAY.licenseUnclear.text,
        missing: ['licence not read clearly'],
        fields: {},
        nameVerdict: null,
        nameScore: null,
      }
    if (unsure) {
      // Accepted, and honest about it. An expiry we are not sure of is not an
      // expiry: claiming one either way from a guessed date is the mistake
      // this whole path exists to avoid.
      filled.unreadable = 'true'
      if (shaky(filled.expiry, filled.expiryScore)) {
        filled.expiry = null
        filled.expired = null
      }
    }
    return settle(filled, true, null, found.missing, expectedName, expectedCnic)
  }

  if (found?.pass)
    return settle(found.fields, true, null, found.missing, expectedName, expectedCnic)

  /**
   * The labels did not add up. Before refusing a rider, look at the card.
   *
   * Only licences, and only photographs. A CNIC has one national format that
   * Rozee reads properly; a licence has one per province, and the label
   * matching above knows Punjab's. This is what stops a Sindh or KPK card
   * being refused for the crime of being printed differently.
   */
  if (kind === 'license' && isPhoto && visionReady()) {
    const seen = await readLicence(bytes, mime)
    if (seen && seen.isLicence && seen.readable)
      return settle(
        {
          name: seen.name,
          number: seen.number,
          cnic: seen.cnic,
          expiry: seen.expiry,
          expired: seen.expiry ? String(new Date(seen.expiry).getTime() < Date.now()) : null,
          authority: seen.authority,
          readBy: 'vision',
        },
        true,
        null,
        [],
        expectedName,
        expectedCnic,
      )
    // It looked and said this is not a licence. That is a firmer answer than
    // the label matching could give, so it is the one the rider hears.
    if (seen && !seen.isLicence)
      return {
        pass: false,
        checked: true,
        reason: SAY.notLicense.text,
        missing: ['not a driving licence'],
        fields: {},
        nameVerdict: null,
        nameScore: null,
      }
    // Unavailable, or it could not read the photograph either: fall through to
    // whatever the labels made of it.
  }

  if (!reading) return open()
  if (sparse && reading.words.length > 0)
    return {
      pass: false,
      checked: true,
      reason: SAY.photoUnclear.text,
      missing: ['unreadable'],
      fields: {},
      nameVerdict: null,
      nameScore: null,
    }

  const verdict = found ?? inspect(kind, reading)
  return settle(
    verdict.fields,
    verdict.pass,
    verdict.reason,
    verdict.missing,
    expectedName,
    expectedCnic,
  )
}

/**
 * The rules that apply to a reading however it was obtained — ours or Rozee's.
 * Kept in one place so the two readers cannot disagree about what a mismatched
 * CNIC means, or about names never blocking anybody.
 */
function settle(
  fields: Record<string, string | null>,
  passed: boolean,
  why: string | null,
  missing: string[],
  expectedName: string,
  expectedCnic: string,
): Verification {
  let pass = passed
  let reason = why

  const cnic = typeof fields.cnic === 'string' ? fields.cnic : null
  const wanted = expectedCnic.replace(/\D/g, '')
  if (pass && wanted && cnic && cnic !== wanted) {
    // Thirteen exact digits either match or they do not — worth blocking on.
    pass = false
    reason = SAY.cnicMismatch.text
  }

  // Names never block: Roman Urdu spelling varies too much to refuse a rider
  // over it. Recorded so the branch can look.
  const docName = typeof fields.name === 'string' ? fields.name : null
  const nameCheck = expectedName && docName ? compareNames(expectedName, docName) : null

  return {
    pass,
    checked: true,
    reason,
    missing,
    fields,
    nameVerdict: nameCheck?.verdict ?? null,
    nameScore: nameCheck?.score ?? null,
  }
}
