/**
 * Every application, as it happens, in the local database.
 *
 * The phone is the record's home while a rider is filling the form in — and a
 * phone is the thing most likely to be cleared, shared, reset or swapped for
 * another browser halfway through. So each change is written here as it is
 * made, and a rider who comes back on a different phone is found by the number
 * they give and put back where they were.
 *
 * This is ours, not the backend's. The push to the backend (docs/…, the
 * outbox) is a separate concern that can land later; nothing here waits on it.
 */
import { sameName } from '../shared/steps.ts'
import { query } from './db.ts'

/** How long an unfinished application can be picked up again. */
export const RESUME_DAYS = 7

export type Snapshot = {
  flow: Record<string, unknown>
  history: unknown[]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (s: unknown): s is string => typeof s === 'string' && UUID.test(s)

export async function saveApplication(
  id: string,
  snap: Snapshot & { phone?: string; fullName?: string; step?: number; done?: boolean },
): Promise<boolean> {
  const rows = await query(
    `INSERT INTO applications (id, phone, full_name, step, completed, flow, history, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (id) DO UPDATE SET
       phone = EXCLUDED.phone, full_name = EXCLUDED.full_name, step = EXCLUDED.step,
       completed = EXCLUDED.completed, flow = EXCLUDED.flow, history = EXCLUDED.history,
       updated_at = now()
     RETURNING id`,
    [
      id,
      snap.phone ?? null,
      snap.fullName ?? null,
      snap.step ?? 0,
      !!snap.done,
      JSON.stringify(snap.flow),
      JSON.stringify(snap.history),
    ],
  )
  return !!rows?.length
}

type Row = {
  id: string
  full_name: string | null
  step: number
  flow: Record<string, unknown>
  history: unknown[]
  updated_at: Date
}

/**
 * An unfinished application on this number, by someone of this name.
 *
 * Both are required. A number is typed by whoever holds the phone, and a
 * phone is often shared; the name — given a question earlier, before the
 * number — is what says this is the same person and not a brother. It is a
 * weak proof, chosen because it costs the rider nothing: they have already
 * typed it. Stronger proof (a code sent to the number) needs a way to send
 * one, which this server does not have.
 */
export async function findOpen(
  phone: string,
  name: string,
  exclude: string,
): Promise<{ id: string; firstName: string; step: number; updatedAt: number } | null> {
  const rows = await query<Row>(
    `SELECT id, full_name, step, updated_at FROM applications
     WHERE phone = $1 AND id <> $2 AND completed = false
       AND updated_at > now() - interval '${RESUME_DAYS} days'
     ORDER BY updated_at DESC LIMIT 5`,
    [phone, isUuid(exclude) ? exclude : '00000000-0000-0000-0000-000000000000'],
  )
  const hit = rows?.find((r) => sameName(r.full_name ?? '', name))
  if (!hit) return null
  return {
    id: hit.id,
    firstName: (hit.full_name ?? '').split(/\s+/)[0] ?? '',
    step: hit.step,
    updatedAt: new Date(hit.updated_at).getTime(),
  }
}

/** The whole application, for the same phone and the same name only. */
export async function loadApplication(
  id: string,
  phone: string,
  name: string,
): Promise<Snapshot | null> {
  const rows = await query<Row>(
    `SELECT id, full_name, step, flow, history, updated_at FROM applications
     WHERE id = $1 AND phone = $2`,
    [id, phone],
  )
  const row = rows?.[0]
  if (!row || !sameName(row.full_name ?? '', name)) return null
  return { flow: row.flow, history: row.history }
}

/** The rider pressed Clear: over, as far as they are concerned. Kept, not offered back. */
export async function closeApplication(id: string): Promise<boolean> {
  const rows = await query(`UPDATE applications SET completed = true, updated_at = now() WHERE id = $1 RETURNING id`, [id])
  return !!rows?.length
}
