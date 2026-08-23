export type Role = 'user' | 'assistant'
export type Kind = 'text' | 'image' | 'audio' | 'document'
export type Message = {
  role: Role
  content: string
  /** Attachments render as bubbles but are never sent to the model. */
  kind?: Kind
  src?: string
  sources?: { src: string; type: string }[]
  doc?: { name: string; mime: string; size: number }
  /** Transient: identifies an optimistic bubble so it can be updated in place. */
  tmp?: string
  /** Transient: the upload is still in flight. */
  pending?: boolean
}

export type FlowState = {
  step: number
  firstName: string
  fullName: string
  cnic: string
  /** Everything pulled off the documents, for the summary at the end. */
  collected: Record<string, string>
  /** Screened out — no smartphone. Kept, so they can resume if that changes. */
  ineligible?: boolean
}

const STATE_KEY = 'grok-bot:flow'

export function loadState(): FlowState {
  try {
    const raw = localStorage.getItem(STATE_KEY)
    if (!raw) return { step: 0, firstName: '', fullName: '', cnic: '', collected: {} }
    const v = JSON.parse(raw) as Partial<FlowState>
    return {
      step: typeof v.step === 'number' && v.step >= 0 ? v.step : 0,
      firstName: typeof v.firstName === 'string' ? v.firstName : '',
      fullName: typeof v.fullName === 'string' ? v.fullName : '',
      cnic: typeof v.cnic === 'string' ? v.cnic : '',
      collected: v.collected && typeof v.collected === 'object' ? v.collected : {},
    }
  } catch {
    return { step: 0, firstName: '', fullName: '', cnic: '', collected: {} }
  }
}

export function saveState(state: FlowState) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state))
  } catch {
    /* ignore */
  }
}

export function clearState() {
  try {
    localStorage.removeItem(STATE_KEY)
  } catch {
    /* ignore */
  }
}

const KEY = 'grok-bot:history'
const MAX = 60

export function load(): Message[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((m): m is Message => {
      const v = m as Message | null
      return (
        !!v &&
        typeof v.content === 'string' &&
        (v.role === 'user' || v.role === 'assistant')
      )
    })
  } catch {
    return []
  }
}

export function save(messages: Message[]) {
  try {
    // blob: URLs die with the page, and a half-finished upload should not come
    // back as pending. Persist the bubble, drop what cannot survive a reload.
    const clean = messages.slice(-MAX).map((m) =>
      m.src?.startsWith('blob:') || m.pending
        ? { ...m, src: m.src?.startsWith('blob:') ? undefined : m.src, pending: false, tmp: undefined }
        : m,
    )
    localStorage.setItem(KEY, JSON.stringify(clean))
  } catch {
    /* private mode or quota — history is a convenience, not a requirement */
  }
}

export function clear() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
