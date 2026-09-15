export type Role = 'user' | 'assistant'
export type Kind = 'text' | 'image' | 'audio' | 'document' | 'video' | 'choice' | 'location'
export type Message = {
  role: Role
  content: string
  /** Attachments render as bubbles but are never sent to the model. */
  kind?: Kind
  src?: string
  /** A place on a map: the picture is in `src`, this is where it points. */
  place?: { lat: number; lng: number; address: string }
  sources?: { src: string; type: string }[]
  doc?: { name: string; mime: string; size: number }
  /** A YouTube id, for the training video every closing message carries. */
  video?: string
  /** Identifies the bubble for its whole life, however the list is rebuilt. */
  id?: string
  /** When it was said, for the time in the corner of the bubble. */
  at?: number
  /** The model wrote these words just now, so no recording of them can exist. */
  unscripted?: boolean
  /** Words still waiting to be spoken, once Uplift has read them. */
  speak?: string
  /** Transient: identifies an optimistic bubble so it can be updated in place. */
  tmp?: string
  /** Transient: the upload is still in flight. */
  pending?: boolean
  /**
   * Where this message sits in the conversation, counting from one.
   *
   * `at` is not enough to sort by: a batch of lines stamped together shares a
   * millisecond, and the backend has no way to put them back in order. Given
   * once, when the bubble is created, and never changed — so a message that
   * has already been delivered is not rewritten into a new one.
   */
  seq?: number
}

export type FlowState = {
  /**
   * Minted once, at first contact, and kept for the life of the application.
   * The backend will key on this: a phone number cannot, because it arrives at
   * step two and one number may legitimately start again.
   */
  applicationId?: string
  step: number
  /** Gates the rider did not meet. Recorded, never a reason to stop. */
  missing?: string[]
  /** E.164 without the plus, as the wallet check wants it. */
  phone?: string
  /**
   * The rider has neither Easypaisa nor JazzCash. Recorded so the fee step
   * does not offer rails they have already said they do not have — it sends
   * them to the counter instead.
   */
  noWallet?: boolean
  /** The nearer of the two offices, from the rider's pin. */
  branch?: 'f8' | 'saddar'
  /** The city the rider gave, resolved to one canonical spelling. */
  city?: string
  /** The rider is choosing which branch to come to. */
  pickOffice?: boolean
  /**
   * None of the offices suit them. The conversation ends there: no video, no
   * questions, no invitation to a city they do not live in.
   */
  noOffice?: boolean
  /** Which rail the rider's number is on, once they have said. */
  rail?: 'easypaisa' | 'jazzcash' | 'both' | 'neither'
  /**
   * A rider with neither wallet is asked where they bank instead, so the
   * account their pay would go into can still be checked against their CNIC.
   */
  bank?: { id: string; name: string }
  bankAccount?: string
  /** Which of the two bank questions is outstanding, if either. */
  asking?: 'bank' | 'account'
  /** Account numbers tried. Two, then it goes to the office. */
  bankTries?: number
  /** The fee: what was attempted, and how it ended. */
  payment?: {
    rail: string
    state: 'initiated' | 'pending' | 'paid' | 'failed'
    amountPaisa: number
    ref: string
    detail: string
  }
  /**
   * The training quiz, once collection is done. `asked` is fixed when the
   * rider accepts, so a reload cannot reshuffle the questions under them.
   */
  quiz?: {
    offered: boolean
    declined: boolean
    done: boolean
    asked: string[]
    at: number
    answers: { id: string; chose: string | null }[]
  }
  firstName: string
  fullName: string
  cnic: string
  /** Everything pulled off the documents, for the summary at the end. */
  collected: Record<string, string>
  /** Screened out — no smartphone. Kept, so they can resume if that changes. */
  ineligible?: boolean
  /**
   * The directions to the office have been given. Three paths end there and a
   * reload can revisit any of them; without this a rider could be sent to the
   * branch twice in one conversation.
   */
  sentBranch?: boolean
  /** The fee has already been offered a second attempt. Only ever one. */
  payRetried?: boolean
  /**
   * The face check is running, between the last answer and the ending.
   * Nothing is decided and no fee is taken while this is true.
   */
  verifying?: boolean
  /**
   * The face check has had its final say — matched, did not, or could not be
   * run. Stops the ending asking for it a second time.
   */
  faceChecked?: boolean
  /**
   * An earlier application on this number, found when the number was given.
   * The rider is being asked whether to carry on with it; nothing moves until
   * they answer.
   */
  resume?: { id: string; firstName: string; step: number }
}

const STATE_KEY = 'grok-bot:flow'

const FRESH: FlowState = { step: 0, firstName: '', fullName: '', cnic: '', collected: {} }

/**
 * Everything stored, with the required fields checked.
 *
 * The rest is carried through rather than listed. Naming each field meant every
 * one added later was quietly dropped on reload — the rider's phone number, the
 * gates they did not meet and their quiz answers all went that way, and nothing
 * reported it because a missing field looks exactly like a fresh start.
 */
export function loadState(): FlowState {
  try {
    const raw = localStorage.getItem(STATE_KEY)
    if (!raw) return { ...FRESH }
    const v = JSON.parse(raw) as Partial<FlowState>
    if (!v || typeof v !== 'object') return { ...FRESH }
    return {
      ...v,
      step: typeof v.step === 'number' && v.step >= 0 ? v.step : 0,
      firstName: typeof v.firstName === 'string' ? v.firstName : '',
      fullName: typeof v.fullName === 'string' ? v.fullName : '',
      cnic: typeof v.cnic === 'string' ? v.cnic : '',
      collected: v.collected && typeof v.collected === 'object' ? v.collected : {},
    }
  } catch {
    return { ...FRESH }
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

/**
 * The thread as it can be kept: what survives a reload here is also what is
 * worth sending to the server, so both use this.
 */
/**
 * The thread as it can be kept, whole.
 *
 * What is dropped here cannot survive being written down: a blob URL that dies
 * with the page, an upload still in flight, a clip nothing was heard in. What
 * is *not* dropped is any of the conversation — trimming belongs to the phone,
 * which has a quota, and not to the copy a recruiter reads.
 */
export function keepable(messages: Message[]): Message[] {
  // blob: URLs die with the page, and a half-finished upload should not come
  // back as pending. Persist the bubble, drop what cannot survive a reload.
  return messages
      // A clip nothing could be heard in leaves no transcript. Keep it if the
      // recording itself survived — an unclear clip is exactly the one someone
      // reviewing the thread wants to play — and drop the empty bubble if not.
      .filter(
        (m) =>
          !(
            m.role === 'user' &&
            m.kind === 'audio' &&
            !m.content.trim() &&
            !m.sources?.some((s) => !s.src.startsWith('blob:'))
          ),
      )
      // A line that was never actually spoken is a spinner, not a voice note.
      .filter((m) => !(m.kind === 'audio' && m.speak && !m.sources))
      /*
       * A rider's own voice note used to live only in a blob URL, which dies
       * with the page, so it was kept as plain text rather than a player
       * pointing nowhere. Now the clip is stored when it is transcribed: keep
       * the player when it points somewhere real, and fall back to the words.
       *
       * Rebuilt field by field, which quietly threw away `at` — so every voice
       * note reached the backend with no time on it and was stamped with the
       * clock at the far end instead. Spread and drop what cannot survive,
       * rather than listing what can.
       */
      .map((m) =>
        m.role === 'user' && m.kind === 'audio'
          ? m.sources?.some((s) => !s.src.startsWith('blob:'))
            ? { ...m, pending: false, tmp: undefined, speak: undefined }
            : { role: m.role, content: m.content, at: m.at, id: m.id, seq: m.seq }
          : m.src?.startsWith('blob:') || m.pending
            ? { ...m, src: m.src?.startsWith('blob:') ? undefined : m.src, pending: false, tmp: undefined }
            : m,
      )
}

/**
 * The thread as this phone keeps it: the same, but only the last `MAX`.
 *
 * localStorage is a few megabytes and a rider's thread carries the words of
 * every question twice over, so the oldest bubbles go. That trim used to be
 * inside `keepable`, which the server copy also went through — so an
 * application longer than sixty bubbles reached the recruiter's screen
 * beginning halfway through, with the welcome, the name and the number cut off
 * the front and nothing to say they had ever been there.
 */
const forThisPhone = (messages: Message[]): Message[] => keepable(messages).slice(-MAX)

export function save(messages: Message[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(forThisPhone(messages)))
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
