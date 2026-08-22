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
}

export type FlowState = {
  step: number
  firstName: string
  fullName: string
  cnic: string
}

const STATE_KEY = 'grok-bot:flow'

export function loadState(): FlowState {
  try {
    const raw = localStorage.getItem(STATE_KEY)
    if (!raw) return { step: 0, firstName: '', fullName: '', cnic: '' }
    const v = JSON.parse(raw) as Partial<FlowState>
    return {
      step: typeof v.step === 'number' && v.step >= 0 ? v.step : 0,
      firstName: typeof v.firstName === 'string' ? v.firstName : '',
      fullName: typeof v.fullName === 'string' ? v.fullName : '',
      cnic: typeof v.cnic === 'string' ? v.cnic : '',
    }
  } catch {
    return { step: 0, firstName: '', fullName: '', cnic: '' }
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
    localStorage.setItem(KEY, JSON.stringify(messages.slice(-MAX)))
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
