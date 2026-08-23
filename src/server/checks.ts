import type { Verification } from './verify.ts'
import { verifyDocument } from './verify.ts'

/**
 * The document checks, as four plain functions.
 *
 * This is the surface another bot should call — the LangGraph flow, a batch
 * re-check, anything. Each takes the bytes and returns a decision plus whatever
 * it could read. Nothing here knows about HTTP, WhatsApp or the web app.
 *
 * Every check fails open: if OCR is unavailable, or the file is a PDF with no
 * text layer, the document is accepted unchecked rather than trapping someone
 * behind our pipeline. `checked` says which happened.
 */
export type CheckOutcome<F> = {
  /** False only when we read the document and it was wrong. */
  pass: boolean
  /** False when nothing could be read, so `pass` is an assumption. */
  checked: boolean
  /** Roman Urdu, ready to send to the rider. Null when it passed. */
  reason: string | null
  /** Which expected markers were absent. */
  missing: string[]
  fields: F
  /** How the name compares with one already on file, when one was given. */
  nameVerdict: 'match' | 'review' | 'mismatch' | null
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const bool = (v: unknown): boolean | null =>
  v === 'true' ? true : v === 'false' ? false : null

const shape = <F>(v: Verification, fields: F): CheckOutcome<F> => ({
  pass: v.pass,
  checked: v.checked,
  reason: v.reason,
  missing: v.missing,
  fields,
  nameVerdict: (v.nameVerdict as CheckOutcome<F>['nameVerdict']) ?? null,
})

export type Document = { bytes: Uint8Array; mime: string }

/** Optional cross-checks: values already collected from earlier documents. */
export type Against = {
  /** Refuses the document when its CNIC number differs from this one. */
  cnic?: string
  /** Compared, recorded, never a reason to refuse — spelling varies too much. */
  name?: string
}

export type CnicFields = {
  cnic: string | null
  name: string | null
  expiry: string | null
  expired: boolean | null
}

export async function checkCnicFront(
  doc: Document,
  against: Against = {},
): Promise<CheckOutcome<CnicFields>> {
  const v = await verifyDocument({
    kind: 'cnic_front',
    bytes: doc.bytes,
    mime: doc.mime,
    expectedCnic: against.cnic,
    expectedName: against.name,
  })
  return shape(v, {
    cnic: str(v.fields.cnic),
    name: str(v.fields.name),
    expiry: str(v.fields.expiry),
    expired: bool(v.fields.expired),
  })
}

export async function checkCnicBack(
  doc: Document,
  against: Against = {},
): Promise<CheckOutcome<{ cnic: string | null }>> {
  const v = await verifyDocument({
    kind: 'cnic_back',
    bytes: doc.bytes,
    mime: doc.mime,
    expectedCnic: against.cnic,
  })
  return shape(v, { cnic: str(v.fields.cnic) })
}

export type LicenseFields = CnicFields & { number: string | null }

export async function checkLicense(
  doc: Document,
  against: Against = {},
): Promise<CheckOutcome<LicenseFields>> {
  const v = await verifyDocument({
    kind: 'license',
    bytes: doc.bytes,
    mime: doc.mime,
    expectedCnic: against.cnic,
    expectedName: against.name,
  })
  return shape(v, {
    cnic: str(v.fields.cnic),
    name: str(v.fields.name),
    number: str(v.fields.number),
    expiry: str(v.fields.expiry),
    expired: bool(v.fields.expired),
  })
}

export type BillFields = {
  /** ISO date. The due date, never the issue date or a late-payment date. */
  dueDate: string | null
  dueDateRaw: string | null
  /** The bill need not be in the rider's name; this is recorded, not matched. */
  billName: string | null
  address: string | null
  ageDays: number | null
}

export async function checkBill(doc: Document): Promise<CheckOutcome<BillFields>> {
  const v = await verifyDocument({ kind: 'bill', bytes: doc.bytes, mime: doc.mime })
  const age = str(v.fields.billAgeDays)
  return shape(v, {
    dueDate: str(v.fields.dueDate),
    dueDateRaw: str(v.fields.dueDateRaw),
    billName: str(v.fields.billName),
    address: str(v.fields.billAddress),
    ageDays: age === null ? null : Number(age),
  })
}
