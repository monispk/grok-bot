export type Role = 'user' | 'assistant'
export type Message = { role: Role; content: string }

const KEY = 'grok-bot:history'
const MAX = 60

export function load(): Message[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (m): m is Message =>
        !!m &&
        typeof (m as Message).content === 'string' &&
        ((m as Message).role === 'user' || (m as Message).role === 'assistant'),
    )
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
