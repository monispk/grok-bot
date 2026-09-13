import type { FlowState, Message } from './storage.ts'
import { keepable } from './storage.ts'

/**
 * Keeps the server's copy of an application current, and finds an earlier
 * one when a rider comes back.
 *
 * Every change is sent, a moment after it is made. The phone is not a safe
 * place to keep the only copy of an application — it is what gets cleared,
 * shared and swapped mid-form — and the backend's own API is not something
 * to wait for. The local database is.
 */
const SETTLE_MS = 1500

let timer: ReturnType<typeof setTimeout> | null = null
let latest: { flow: FlowState; history: Message[] } | null = null

export function pushSoon(flow: FlowState, history: Message[], onSaved: (at: number) => void) {
  latest = { flow, history }
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    const snap = latest
    latest = null
    if (!snap?.flow.applicationId) return
    void fetch(`/api/application/${snap.flow.applicationId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      // Not the resume offer itself: it is a question mid-answer, not state.
      body: JSON.stringify({
        flow: { ...snap.flow, resume: undefined },
        history: keepable(snap.history),
      }),
      keepalive: true,
    })
      .then((r) => r.json())
      .then((r: { ok?: boolean }) => {
        if (r.ok) onSaved(Date.now())
      })
      .catch(() => {})
  }, SETTLE_MS)
}

export type Earlier = { id: string; firstName: string; step: number; updatedAt: number }

/** An unfinished application on this number, by someone of this name. */
export async function lookup(phone: string, name: string, exclude: string): Promise<Earlier | null> {
  try {
    const res = await fetch('/api/application/lookup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone, name, exclude }),
    })
    const data = (await res.json()) as { found?: boolean } & Earlier
    return data.found ? data : null
  } catch {
    return null
  }
}

export async function resume(
  id: string,
  phone: string,
  name: string,
): Promise<{ flow: FlowState; history: Message[] } | null> {
  try {
    const res = await fetch('/api/application/resume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, phone, name }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { flow?: FlowState; history?: Message[] }
    return data.flow && Array.isArray(data.history) ? { flow: data.flow, history: data.history } : null
  } catch {
    return null
  }
}
