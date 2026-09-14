import { SAY } from '../shared/messages.ts'
import { inspect, type DocKind } from './fields.ts'
import { compareNames } from './names.ts'
import { ocrReady, readCnicFront } from './rozee.ts'
import { read, SPARSE_WORDS } from './ocr.ts'
import { licenceReaderReady, readLicence } from './vision-openai.ts'

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

  /**
   * A driving licence is read by one reader, and it is the vision model.
   *
   * There were three — label matching here, then qwen, then this — each one
   * covering for the last, and between them they still got a licence wrong
   * often enough to matter. Every card has one number and one date that decide
   * anything, and a reader that is right about them most of the time is a
   * reader that sends real riders away and waves expired cards through.
   *
   * So the cheap readers are gone from this path rather than kept as a
   * fallback. A fallback that is wrong is worse than no fallback: it produces
   * an answer, and an answer is acted on.
   */
  if (kind === 'license') return await readLicenceCard(bytes, mime, attempt, expectedName, expectedCnic)

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

  if (found?.pass)
    return settle(found.fields, true, null, found.missing, expectedName, expectedCnic)

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

/** A refusal the rider can act on: what was wrong, in their own language. */
const refuse = (reason: string, why: string): Verification => ({
  pass: false,
  checked: true,
  reason,
  missing: [why],
  fields: {},
  nameVerdict: null,
  nameScore: null,
})

/**
 * A driving licence, read by the vision model and nothing else.
 *
 * The card is the one document in the flow whose contents decide something:
 * the number identifies it and the expiry says whether it is any use, and both
 * have to be right. What is *not* read is as important — an expiry nobody
 * could make out is left null rather than guessed at, because a guessed date
 * has told a rider with a card good until 2031 that theirs expired in 2021.
 *
 * Two photographs, and no more. The first failure asks for a better picture
 * with the three things that actually fix one; the second is accepted and
 * flagged, and the rider brings the card to the office where a person reads it
 * in a second. Nobody photographs the same licence three times.
 */
async function readLicenceCard(
  bytes: Uint8Array,
  mime: string,
  attempt: number,
  expectedName: string,
  expectedCnic: string,
): Promise<Verification> {
  /*
   * A PDF, which vision cannot read — it needs pixels, and a scanner app's PDF
   * has no text layer worth having either. Asking for a photograph is both
   * honest and trivial for the rider: the card is in their hand.
   */
  if (mime === 'application/pdf') return refuse(SAY.licensePhotoPlease.text, 'licence sent as a pdf')

  // Nothing configured, or their API did not answer. Never fail an applicant
  // on our own outage: the document is kept, the branch visit is the backstop.
  if (!licenceReaderReady()) {
    console.warn('licence: no OPENAI_API_KEY — accepting the card unchecked')
    return open('no licence reader configured')
  }
  const seen = await readLicence(bytes, mime)
  if (!seen) return open('the licence reader did not answer')

  // It looked, and it says this is something else. A firmer answer than any
  // amount of label matching could give, so it is the one the rider hears.
  if (!seen.isLicence) return refuse(SAY.notLicense.text, 'not a driving licence')

  const fields: Record<string, string | null> = {
    name: seen.name,
    number: seen.number,
    cnic: seen.cnic,
    expiry: seen.expiry,
    expired: seen.expiry ? String(new Date(seen.expiry).getTime() < Date.now()) : null,
    // Recorded, not acted on. A learner permit is a licensing question for the
    // office, not something to turn somebody away over in a chat window.
    ...(seen.learner ? { learner: 'true' } : {}),
    readBy: 'openai vision',
  }

  /*
   * A licence needs both halves. A number with no date cannot be checked for
   * expiry, and a date with no number cannot be tied to the card it came from.
   */
  const complete = Boolean(seen.readable && seen.number && seen.expiry)
  if (!complete && attempt < 2) return refuse(SAY.licenseUnclear.text, 'licence not read clearly')
  if (!complete) {
    fields.unreadable = 'true'
    // What was not read stays unread. Half a licence is not an expiry claim.
    if (!seen.expiry) {
      fields.expiry = null
      fields.expired = null
    }
  }
  return settle(fields, true, null, [], expectedName, expectedCnic)
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
