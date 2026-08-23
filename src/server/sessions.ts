import type { Msg } from './provider.ts'

/**
 * One rider's onboarding state, keyed by phone number.
 *
 * The web app keeps this in the browser. WhatsApp has no client, so it has to
 * live here. This is deliberately an interface with an in-memory implementation:
 * sessions are lost on redeploy, which is survivable while testing but not once
 * real riders are mid-application. Swapping in Postgres means implementing
 * `SessionStore` and nothing else — see docs/onboarding-flow.md for what that
 * table has to satisfy before it holds CNIC data for real.
 */
export type Session = {
  phone: string
  greeted: boolean
  step: number
  firstName: string
  fullName: string
  cnic: string
  collected: Record<string, string>
  history: Msg[]
  /** Screened out — no smartphone. Kept, so they can resume if that changes. */
  ineligible: boolean
  updatedAt: number
}

export interface SessionStore {
  get(phone: string): Promise<Session | undefined>
  save(session: Session): Promise<void>
  reset(phone: string): Promise<void>
}

const TTL = 14 * 24 * 60 * 60_000
const HISTORY = 12

export const blank = (phone: string): Session => ({
  phone,
  greeted: false,
  step: 0,
  firstName: '',
  fullName: '',
  cnic: '',
  collected: {},
  history: [],
  ineligible: false,
  updatedAt: Date.now(),
})

class MemoryStore implements SessionStore {
  private map = new Map<string, Session>()

  constructor() {
    setInterval(() => {
      const cutoff = Date.now() - TTL
      for (const [k, v] of this.map) if (v.updatedAt < cutoff) this.map.delete(k)
    }, 60 * 60_000).unref()
  }

  async get(phone: string) {
    return this.map.get(phone)
  }

  async save(session: Session) {
    session.updatedAt = Date.now()
    session.history = session.history.slice(-HISTORY)
    this.map.set(session.phone, session)
  }

  async reset(phone: string) {
    this.map.delete(phone)
  }
}

export const sessions: SessionStore = new MemoryStore()
