export type Role = 'user' | 'assistant'
export type Kind = 'text' | 'image' | 'audio'
export type Message = {
  role: Role
  content: string
  /** Attachments render as bubbles but are never sent to the model. */
  kind?: Kind
  src?: string
  sources?: { src: string; type: string }[]
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
