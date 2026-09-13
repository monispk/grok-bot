import { SAY } from '../shared/messages.ts'
import { inspect, type DocKind } from './fields.ts'
import { compareNames } from './names.ts'
import { ocrReady, readCnicFront } from './rozee.ts'
import { read, SPARSE_WORDS } from './ocr.ts'
import { readLicence, visionReady } from './vision.ts'

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
}): Promise<Verification> {
  const { kind, bytes, mime, expectedName = '', expectedCnic = '' } = opts
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
   * A licence that read, but not completely.
   *
   * The expiry is the field that decides whether a licence is any use, and the
   * local reader loses it about a third of the time — the same card, uploaded
   * three times, gave the date twice. It passed anyway, because nothing
   * required it, so an application could reach a branch with no idea whether
   * the licence had run out.
   *
   * So when the labels found a licence but not its dates, the picture is
   * looked at for the missing parts only. What the local reader found is kept:
   * it read those from the actual pixels, and a model asked to fill a gap
   * should not get to overwrite what was not a gap.
   */
  if (found?.pass && kind === 'license' && isPhoto && visionReady() && !found.fields.expiry) {
    const seen = await readLicence(bytes, mime)
    if (seen?.isLicence && (seen.expiry || seen.number || seen.name)) {
      const filled: Record<string, string | null> = { ...found.fields }
      let used = false
      for (const [key, value] of [
        ['expiry', seen.expiry],
        ['number', seen.number],
        ['name', seen.name],
        ['cnic', seen.cnic],
      ] as const) {
        if (!filled[key] && value) {
          filled[key] = value
          used = true
        }
      }
      if (filled.expiry && !filled.expired)
        filled.expired = String(new Date(filled.expiry).getTime() < Date.now())
      if (used) {
        filled.readBy = 'local OCR + vision'
        console.log(`vision: filled ${Object.keys(filled).filter((k) => !found.fields[k]).join(', ')} on a licence`)
        return settle(filled, true, null, found.missing, expectedName, expectedCnic)
      }
    }
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
