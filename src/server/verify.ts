import { inspect, type DocKind } from './fields.ts'
import { compareNames } from './names.ts'
import { read, SPARSE_WORDS } from './ocr.ts'

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

  const reading = await read(bytes, mime)
  if (!reading) return open()

  // Almost nothing was read: a tilted, blurred or dark photo. Guessing from a
  // partial read is worse than asking for another one.
  if (reading.words.length > 0 && reading.words.length < SPARSE_WORDS)
    return {
      pass: false,
      checked: true,
      reason:
        'Tasveer saaf nahi aayi. Camera ko seedha rakh kar, achi roshni mein dobara khenchein.',
      missing: ['unreadable'],
      fields: {},
      nameVerdict: null,
      nameScore: null,
    }

  const found = inspect(kind, reading)
  let pass = found.pass
  let reason = found.reason

  const cnic = typeof found.fields.cnic === 'string' ? found.fields.cnic : null
  const wanted = expectedCnic.replace(/\D/g, '')
  if (pass && wanted && cnic && cnic !== wanted) {
    // Thirteen exact digits either match or they do not — worth blocking on.
    pass = false
    reason =
      'Is document par CNIC number aap ke CNIC se match nahi kar raha. Baraye meherbani sahi document bhejein.'
  }

  // Names never block: Roman Urdu spelling varies too much to refuse a rider
  // over it. Recorded so the branch can look.
  const docName = typeof found.fields.name === 'string' ? found.fields.name : null
  const nameCheck = expectedName && docName ? compareNames(expectedName, docName) : null

  return {
    pass,
    checked: true,
    reason,
    missing: found.missing,
    fields: found.fields,
    nameVerdict: nameCheck?.verdict ?? null,
    nameScore: nameCheck?.score ?? null,
  }
}
