import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks'
import { Dashboard } from './dashboard.tsx'
import { holdFresh } from './fresh.ts'
import {
  alreadyAnswered,
  askMessages,
  expiredLicence,
  farewell,
  spoken as readAloud,
  submitted,
  unreadableLicence,
  quizAsk,
  quizSay,
  STEPS,
  thanksDoc,
  thanksOffice,
  thanksName,
} from './flow.ts'
import {
  audioSources,
  feeReceivedLine,
  type InviteOpts,
  NO_OFFICE,
  officeChoice,
  OFFICES,
  type OfficeId,
  type Outcome,
} from '../shared/steps.ts'
import { INTRO as QUIZ_INTRO, pickQuestions, QUESTIONS, readChoice } from '../shared/quiz.ts'
import { audioForText, awaitingVoice, SAY } from '../shared/messages.ts'
import {
  asksSomething,
  blockedOn,
  dropRepeat,
  readPhone,
  readRail,
  saysHasnt,
  readYesNo,
  stripAskBack,
  stripEcho,
  stripReceipt,
  TYPE_NAME_PLEASE,
} from '../shared/steps.ts'
import { render as renderMarkdown } from './markdown.ts'
import { DocumentBubble, Picture, Video, VoiceNote } from './media.tsx'
import * as store from './storage.ts'
import type { Message } from './storage.ts'
import { useRecorder, type MicProblem, type Recording } from './recorder.ts'
import { CANCEL_PX, useMicGesture } from './mic.tsx'
import { MicSheet } from './micsheet.tsx'
import { shrinkImage } from './image.ts'
import { lookup, pushSoon, resume } from './sync.ts'
import { blip, cashBell, CHOICES, Choices, type Choice } from './choices.tsx'
import { Camera } from './camera.tsx'
import { BEAT_MS, GROUP_MS, MAX_TICKS, VOICE_PATIENCE_MS, WORD_MS } from './pace.ts'
import { isReady, setOrder, stopAll, whenReady } from './autoplay.ts'
import { runTurn, warm } from './stream.ts'
import { forModel, VOICE_SOURCES, WELCOME } from './welcome.ts'

const HISTORY_WINDOW = 12

const ACCEPT = 'image/jpeg,image/png,image/gif,application/pdf,.jpg,.jpeg,.png,.gif,.pdf'
const CAMERA_ACCEPT = 'image/*'

const bot = (content: string): Message => ({ role: 'assistant', content })

/** How long the rider gets to approve the debit in their wallet app, and how often the rail is asked. */
const PAY_WAIT_MS = 70_000
const PAY_POLL_MS = 5_000

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

/** The red microphone that blinks beside the clock while recording, as WhatsApp's does. */
const RedMic = () => (
  <svg class="redmic" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <path d="M12 15a3.5 3.5 0 0 0 3.5-3.5v-6a3.5 3.5 0 0 0-7 0v6A3.5 3.5 0 0 0 12 15z" fill="currentColor" />
    <path d="M18.5 11.2a6.5 6.5 0 0 1-13 0M12 17.8V21" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" />
  </svg>
)

let seq = 0
/**
 * Which of the four closings a rider gets.
 *
 * A branch visit is only offered on a verified application. Everything that
 * blocks — an unreadable CNIC, a licence that is not one, a selfie that does
 * not match the card — already stops the rider at its own step, so what is
 * left here is the quiet kind of doubt: a check that could not be run because
 * a service was down, or a name the documents disagree about. Neither is the
 * rider's fault and neither is worth a wasted journey across a city.
 *
 * The quiz has no part in this. It is optional, and it is graded elsewhere.
 */
function outcomeFor(f: store.FlowState): Outcome {
  if (f.ineligible || (f.missing ?? []).length > 0) return 'not_eligible'

  const face = f.collected['checks.faceMatch'] ?? ''
  const name = f.collected['checks.licenceVsCnic'] ?? ''
  // An expired licence is a definite answer, not a doubt: the card in hand is
  // not one a rider can deliver on. It does not turn them away — the office
  // takes it from here — but it does mean nothing is charged for a licence
  // that has run out.
  const expired = f.collected['license.expired'] === 'true'
  const verified =
    !expired && face.startsWith('match') && (name === 'match' || name === 'review' || name === '')

  if (!verified) return 'not_verified'
  // Payment is not wired into the flow yet, so the fee is still owed.
  return 'verified_unpaid'
}

/**
 * Gives a new bubble its time, its identity, and its place in the thread.
 *
 * The place is counted from whatever the thread already holds rather than from
 * a counter of its own, so it survives a reload, a resumed application, and the
 * trimming of old messages — all three of which reset a module-level counter
 * and none of which change what came before.
 *
 * A message that already has both is returned untouched. Rewriting a delivered
 * message is how one becomes two at the other end.
 */
const stamp = (list: Message[]): Message[] => {
  let now = 0
  let place = list.reduce((n, m) => Math.max(n, m.seq ?? 0), 0)
  return list.map((m) =>
    m.at && m.id
      ? m
      : {
          ...m,
          at: m.at ?? (now ||= Date.now()),
          id: m.id ?? `m${++seq}`,
          seq: m.seq ?? ++place,
        },
  )
}

const clock = (at?: number) =>
  at
    ? new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : ''

/**
 * The time, and for the rider's own messages the pair of ticks that says it
 * arrived. Every WhatsApp bubble carries these; without them the shape is
 * right but the thing still does not look like itself.
 */
function Stamp({ m }: { m: Message }) {
  if (!m.at) return null
  return (
    <span class="stamp">
      {clock(m.at)}
      {m.role === 'user' && (
        <svg viewBox="0 0 16 11" width="15" height="11" aria-hidden="true">
          <path
            d="M1 5.8 3.9 8.7 9.6 3M6.4 5.8 9.3 8.7 15 3"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      )}
    </span>
  )
}

/**
 * The model's own words. Marked, because a scripted line may already have a
 * recording travelling with it — a step's question arrives as the words plus
 * its voice note — and reading those aloud as well gave every question two.
 */
const fromModel = (content: string): Message => ({
  role: 'assistant',
  content,
  unscripted: true,
})

/**
 * Appends, skipping any bot line that just repeats the one before it, and
 * attaching the recording for any message that has one.
 */
function append(existing: Message[], incoming: Message[]): Message[] {
  const out = [...existing]
  for (let i = 0; i < incoming.length; i++) {
    const m = incoming[i]!
    // Only an *immediate* repeat is suppressed. Looking back past the rider's
    // own messages meant a second wrong upload got no answer at all, because the
    // refusal matched the one from the previous attempt.
    const last = out[out.length - 1]
    const repeats =
      last?.role === 'assistant' && !last.kind && dropRepeat(last.content, m.content)
    if (m.role === 'assistant' && !m.kind && repeats) continue
    out.push(m)
    if (m.role === 'assistant' && !m.kind) {
      // A step's question arrives as the words followed by its own recording.
      // Looking one ahead stops a second copy being attached to the same line.
      const carried = incoming[i + 1]
      if (carried?.role === 'assistant' && carried.kind === 'audio' && !carried.speak) continue
      const spoken = audioForText(m.content)
      if (spoken)
        out.push({ role: 'assistant', content: '', kind: 'audio', sources: audioSources(spoken) })
      // Only what nobody could have recorded: what the model just wrote, and the
      // handful of our own lines still waiting for a recording.
      else if (m.content.trim() && (m.unscripted || awaitingVoice(m.content)))
        out.push({ role: 'assistant', content: '', kind: 'audio', speak: m.content, pending: true })
    }
  }
  return out
}

export function App() {
  const [boot] = useState(() => {
    const saved = store.load()
    // Returning riders see their history at once; a fresh one watches it arrive.
    return saved.length
      ? { msgs: saved, revealed: saved.length }
      : { msgs: WELCOME, revealed: 0 }
  })
  const [messages, setRaw] = useState<Message[]>(stamp(boot.msgs))
  /**
   * Every message carries the time it was said. Stamping here rather than at
   * each call site means no route into the thread can forget — and there are
   * six of them.
   */
  const setMessages = useCallback(
    (v: Message[] | ((prev: Message[]) => Message[])) =>
      setRaw((prev) => stamp(typeof v === 'function' ? v(prev) : v)),
    [],
  )
  const [revealed, setRevealed] = useState(boot.revealed)
  /** Bumped to re-run the reveal while it is waiting on a voice note. */
  const [nudge, setNudge] = useState(0)
  /** When each voice note was put on screen, so the wait for it has a limit. */
  const shownAt = useRef(new Map<string, number>())
  /**
   * Everything already in the thread when the page opened. Those are read back
   * silently; only what arrives from here on is played aloud.
   */
  const restored = useRef(boot.revealed)
  const [typed, setTyped] = useState(0)
  const [flow, setFlow] = useState(() => {
    const loaded = store.loadState()
    return loaded.applicationId ? loaded : { ...loaded, applicationId: crypto.randomUUID() }
  })
  const { step, firstName, fullName, cnic, collected, ineligible, missing, phone, quiz, pickOffice } =
    flow
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The sheet explaining why the microphone cannot be used, or null. */
  const [micSheet, setMicSheet] = useState<MicProblem | null>(null)
  /** The "hold to talk" hint, shown for a moment after a tap. */
  const [hint, setHint] = useState(false)
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Lines said once per visit, so reopening a sheet does not repeat them. */
  const saidOnce = useRef(new Set<string>())
  /**
   * How many times each step has been answered and sent back.
   *
   * Only the licence uses it, and only to stop asking: a card the reader
   * cannot be sure of is worth one more photograph and no more than that.
   * Not in the flow state, because it is about this sitting at the step and
   * not about the application.
   */
  const [tries, setTries] = useState<Record<string, number>>({})
  /** Testing only: everything collected so far, on one screen. */
  const [dashOpen, setDashOpen] = useState(false)
  /** When the server last confirmed it holds this application. */
  const [syncedAt, setSyncedAt] = useState(0)
  /** The in-chat front camera, for the selfie: open, refused, or neither. */
  const [selfieCam, setSelfieCam] = useState<'open' | 'refused' | null>(null)

  const abort = useRef<AbortController | null>(null)
  const messagesRef = useRef(messages)
  const scroller = useRef<HTMLDivElement | null>(null)
  const picker = useRef<HTMLInputElement | null>(null)
  const camera = useRef<HTMLInputElement | null>(null)
  const selfieInput = useRef<HTMLInputElement | null>(null)
  /** The phone's own recorder app, for when the browser will not give up the mic. */
  const recApp = useRef<HTMLInputElement | null>(null)

  const busy = streaming !== null || working

  /*
   * A stale page replaces itself, but not while the rider is mid-turn: the
   * thread and the flow both survive a reload and the half-typed message in
   * the composer does not.
   */
  useEffect(() => {
    holdFresh(busy || draft.trim().length > 0)
  }, [busy, draft])

  const current = STEPS[step]

  /**
   * Whether the camera and paperclip are live.
   *
   * A photograph sent when none was asked for cannot be filed against anything,
   * so it is answered with a line explaining that and thrown away. Greying the
   * buttons out says the same thing before the rider has taken the picture,
   * which is the half of it that saves them the trouble. They stay in place
   * rather than disappearing: a composer whose buttons come and go reads as
   * broken, and their being visible is how a rider learns they exist at all.
   */
  const wantsUpload = current?.kind === 'upload'

  useEffect(() => {
    messagesRef.current = messages
    store.save(messages)
  }, [messages])

  // Reveals the next message: instantly if the rider sent it, after a beat for
  // an image or a voice note, word by word for anything the bot says.
  useEffect(() => {
    if (revealed >= messages.length) return
    const m = messages[revealed]
    if (!m) return

    if (m.role === 'user') {
      setRevealed((r) => r + 1)
      return
    }

    // A voice note belongs to the line above it — they are one utterance, so it
    // follows on a beat. Anything else is the next thing being said, and waits.
    const prev = messages[revealed - 1]
    const attached = m.kind === 'audio' && prev?.role === 'assistant'

    // The next thing is not said until the last thing can be heard: if the
    // previous line's voice note is still being made, or is made but has not
    // loaded yet, wait for it. Then the pair — words, then voice — lands
    // whole, and the two seconds are counted from the voice, not from the
    // words. Without this the next question was on screen while the answer's
    // note was still an empty bubble, and on a slow connection the pause
    // was spent loading the clip: two lines and two notes, as one lump.
    if (!attached && prev?.role === 'assistant' && prev.kind === 'audio' && prev.id && !isReady(prev.id)) {
      const waited = Date.now() - (shownAt.current.get(prev.id) ?? prev.at ?? 0)
      if (waited < VOICE_PATIENCE_MS) {
        const off = whenReady(prev.id, () => setNudge((n) => n + 1))
        const t = setTimeout(() => setNudge((n) => n + 1), VOICE_PATIENCE_MS - waited)
        return () => {
          off()
          clearTimeout(t)
        }
      }
    }
    const lead = revealed === 0 ? 0 : attached ? BEAT_MS : GROUP_MS

    if (m.kind && m.kind !== 'text') {
      const t = setTimeout(() => {
        if (m.kind === 'audio' && m.id) shownAt.current.set(m.id, Date.now())
        setRevealed((r) => r + 1)
      }, lead)
      return () => clearTimeout(t)
    }

    const words = m.content.split(/\s+/).filter(Boolean)
    if (!words.length) {
      setRevealed((r) => r + 1)
      return
    }

    // The pause comes first, then the words appear. Typing straight away would
    // put the gap after the line, where it reads as hesitation rather than turn-taking.
    let ticking: ReturnType<typeof setInterval> | null = null
    const start = setTimeout(() => {
      const chunk = Math.max(1, Math.ceil(words.length / MAX_TICKS))
      let shown = 0
      setTyped(0)
      ticking = setInterval(() => {
        shown = Math.min(words.length, shown + chunk)
        setTyped(shown)
        if (shown >= words.length) {
          if (ticking) clearInterval(ticking)
          setTyped(0)
          setRevealed((r) => r + 1)
        }
      }, WORD_MS)
    }, lead)

    return () => {
      clearTimeout(start)
      if (ticking) clearInterval(ticking)
    }
  }, [revealed, messages, nudge])
  /**
   * The whole thing, not a list of fields. Naming them one by one meant every
   * field added afterwards was silently left out of storage — the phone number,
   * the gates a rider did not meet and their quiz answers were all being lost
   * on reload, and nothing said so.
   */
  useEffect(() => store.saveState(flow), [flow])

  /**
   * And to the server, a moment after. From the first thing the rider says:
   * a welcome nobody answered is not an application. The phone is where the
   * only copy used to live, and the phone is what gets cleared, shared and
   * swapped for another browser halfway through.
   */
  useEffect(() => {
    if (!messages.some((m) => m.role === 'user')) return
    pushSoon(flow, messages, setSyncedAt)
  }, [flow, messages])

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') warm()
    }, 30_000)
    return () => clearInterval(id)
  }, [])

  // Keep the newest line just above the composer as it is written. This runs
  // after layout and again on the next frame: measuring before the new words
  // are laid out leaves the thread short of the bottom, which is exactly the
  // scrolling the rider should never have to do.
  /**
   * Has Uplift read any answer still waiting for a voice. The id comes back
   * from the words themselves, so a line already read costs nothing the second
   * time and keeps the same URL across a reload.
   */
  useEffect(() => {
    setOrder(
      messages
        .map((m, i) => ({ m, i }))
        .filter(
          ({ m, i }) =>
            m.role === 'assistant' && m.kind === 'audio' && i >= restored.current && !!m.id,
        )
        .map(({ m }) => m.id!),
    )
  }, [messages])

  const spoken = useRef(new Set<string>())
  useEffect(() => {
    const waiting = messages.filter((m) => m.kind === 'audio' && m.speak && !m.sources)
    for (const m of waiting) {
      const words = m.speak!
      if (spoken.current.has(words)) continue
      spoken.current.add(words)
      void (async () => {
        let sources: { src: string; type: string }[] | null = null
        try {
          const res = await fetch('/api/speak', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: words }),
          })
          const data = (await res.json()) as { ok?: boolean; id?: string }
          if (data.ok && data.id)
            sources = [{ src: `/api/speak/${data.id}`, type: 'audio/mpeg' }]
        } catch {
          /* no voice for this one; the words are still on screen */
        }
        // Without audio the bubble is an empty box, so it is dropped entirely.
        // Dropping it shifts everything after it up a slot, and `revealed`
        // counts slots: left alone, the message that had been waiting its turn
        // was suddenly below the line and appeared with no pause at all.
        const gone = sources
          ? []
          : messagesRef.current
              .map((x, i) => (x.speak === words && !x.sources ? i : -1))
              .filter((i) => i >= 0)
        setMessages((list) =>
          list.flatMap((x) => {
            if (x.speak !== words || x.sources) return [x]
            return sources ? [{ ...x, sources, pending: false }] : []
          }),
        )
        if (gone.length) setRevealed((r) => r - gone.filter((i) => i < r).length)
      })()
    }
  }, [messages])

  /** Whether the rider is at the foot of the thread, or has scrolled up to re-read. */
  const atBottom = useRef(true)

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const pin = () => {
      el.scrollTop = el.scrollHeight
    }
    pin()
    const id = requestAnimationFrame(pin)
    return () => cancelAnimationFrame(id)
  }, [messages, streaming, revealed, typed])

  /**
   * Pins again when a picture finishes loading.
   *
   * The thread is measured the moment something is added to it, and a picture
   * that has not arrived yet is a box of no height — so the buttons under a
   * yes-or-no question, which are mostly picture, were scrolled to while they
   * were still flat and ended up below the fold. Their aspect ratio is
   * declared in the stylesheet, which handles the common case; this handles a
   * browser that does not honour it, and the map pin, and anything else that
   * grows late.
   *
   * Only when the rider is already at the foot. Someone who has scrolled up to
   * look at their own licence again should not be dragged back down.
   */
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const NEAR = 120
    const note = () => {
      atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR
    }
    const grew = () => {
      if (atBottom.current) el.scrollTop = el.scrollHeight
    }
    el.addEventListener('scroll', note, { passive: true })
    // Capture: a picture's load event does not bubble.
    el.addEventListener('load', grew, true)
    return () => {
      el.removeEventListener('scroll', note)
      el.removeEventListener('load', grew, true)
    }
  }, [])

  // Licence name against CNIC name — a comparison between two documents, which
  // neither upload could make on its own.
  useEffect(() => {
    const a = collected['license.name']
    const b = collected['cnic_front.name']
    if (!a || !b || collected['checks.licenceVsCnic']) return
    let cancelled = false
    void fetch('/api/compare-names', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ a, b }),
    })
      .then((r) => r.json())
      .then((r: { verdict?: string | null }) => {
        if (cancelled || !r.verdict) return
        setFlow((f) => ({
          ...f,
          collected: { ...f.collected, 'checks.licenceVsCnic': r.verdict! },
        }))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [collected])

  /**
   * The wallet title, once the CNIC has been read. It waits for the card
   * because the name on the card is what the title is compared against, and it
   * runs in the background because nothing the rider does depends on it.
   */
  useEffect(() => {
    const name = collected['cnic_front.name'] ?? fullName
    if (!phone || !name || collected['checks.wallet']) return
    let cancelled = false
    fetch('/api/wallet', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone, name }),
    })
      .then((r) => r.json())
      .then((r: { outcome?: string; rail?: string; title?: string; titles?: { rail: string; title: string }[] }) => {
        if (cancelled || !r.outcome) return
        const note =
          r.outcome === 'pass'
            ? `match — ${r.title} (${r.rail})`
            : r.outcome === 'fail'
              ? `no match — ${(r.titles ?? []).map((t) => `${t.rail}: ${t.title}`).join(', ') || 'no account found'}`
              : 'not checked'
        setFlow((f) => ({ ...f, collected: { ...f.collected, 'checks.wallet': note } }))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [phone, fullName, collected])

  const say = useCallback((...lines: Message[]) => {
    setMessages((m) => append(m, lines))
  }, [])

  /**
   * Where to go, what to bring, what is owed — and the pin.
   *
   * The last thing a rider is told, on every path: after the quiz, after
   * declining it, and straight away for anyone not offered one. Sent exactly
   * once, which `sentBranch` is for — three call sites and a reload between
   * them is more than enough to send it twice.
   */
  /**
   * What the invitation has to say about this rider: whether they still owe
   * the fee, what they are waiting on, and what to carry. Read in two places —
   * the invitation and the farewell — which must agree.
   */
  const inviteOpts = (f: store.FlowState): InviteOpts => {
    const licenceExpired = f.collected['license.expired'] === 'true'
    const licenceUnread = f.collected['license.unreadable'] === 'true'
    return {
      // Only a rider the rail has actually taken money from owes nothing.
      owesFee: f.payment?.state !== 'paid',
      waitingFor: blockedOn(f.missing ?? [], { licenceExpired, licenceUnread }),
      licenceExpired,
      licenceUnread,
    }
  }

  /** The last word: the office once more, and the pin. */
  const goToBranch = useCallback((f: store.FlowState, before: Message[] = []) => {
    if (f.sentBranch) return
    setFlow((prev) => ({ ...prev, sentBranch: true }))
    setMessages((m) =>
      append(m, [...before, ...farewell(OFFICES[f.branch ?? 'f8'], inviteOpts(f))]),
    )
  }, [])

  /**
   * One turn of the quiz: accept it or not, then ten answers.
   *
   * The questions are chosen once, when the rider says yes, and kept in the
   * flow state — drawing them fresh each turn would hand them a different
   * question every time they mistyped an answer.
   */
  const handleQuiz = useCallback(
    (text: string, withUser: Message[]) => {
      const q = quiz
      if (!q || q.done) return

      // Not started: this is the yes or no.
      if (!q.asked.length) {
        const answer = readYesNo(text)
        if (answer === 'no') {
          const done = { ...q, declined: true, done: true }
          setFlow((f) => ({ ...f, quiz: done }))
          goToBranch({ ...flow, quiz: done }, quizSay('declined'))
          return
        }
        if (answer !== 'yes') {
          say(bot(SAY.repeat.text), bot(QUIZ_INTRO))
          return
        }
        const picked = pickQuestions()
        setFlow((f) => ({ ...f, quiz: { ...q, asked: picked.map((x) => x.id), at: 0 } }))
        say(...quizAsk(picked[0]!, 1, picked.length))
        return
      }

      // Mid-quiz: read the choice.
      const chose = readChoice(text)
      const current = QUESTIONS.find((x) => x.id === q.asked[q.at])
      if (!current) return

      if (!chose) {
        say(...quizSay('unclear'))
        return
      }

      const answers = [...q.answers, { id: current.id, chose }]
      const next = q.at + 1
      if (next >= q.asked.length) {
        const done = { ...q, answers, at: next, done: true }
        setFlow((f) => ({ ...f, quiz: done }))
        goToBranch({ ...flow, quiz: done }, quizSay('closing'))
        return
      }
      setFlow((f) => ({ ...f, quiz: { ...q, answers, at: next } }))
      const following = QUESTIONS.find((x) => x.id === q.asked[next])
      if (following) say(...quizAsk(following, next + 1, q.asked.length))
    },
    [quiz, say, flow, goToBranch],
  )

  /**
   * The first half of the ending: how it went, the video, and the offer to
   * answer the quiz now. The directions wait until that is settled.
   */
  const conclude = useCallback(
    (outcome: Outcome, f: store.FlowState, before: Message[] = []) => {
      const withQuiz: store.FlowState = {
        ...f,
        quiz: f.quiz ?? {
          offered: true,
          declined: false,
          done: false,
          asked: [],
          at: 0,
          answers: [],
        },
      }
      setFlow((prev) => ({ ...prev, quiz: withQuiz.quiz }))
      setMessages((m) =>
        append(m, [
          ...before,
          ...submitted(outcome, f.firstName, OFFICES[f.branch ?? 'f8'], inviteOpts(f)),
        ]),
      )
    },
    [],
  )

  /**
   * Takes the fee, once and only once, when the flow has handed over to it.
   *
   * Never blocks and never accuses: a rail that times out may still have taken
   * the money, so that ends as "being confirmed" rather than as a failure, and
   * a rider whose payment does not go through is told they can pay at the
   * counter — not that something is wrong with them.
   */
  const paying = useRef(false)
  useEffect(() => {
    if (step < STEPS.length) return
    if (flow.payment?.state !== 'initiated' || paying.current) return
    paying.current = true

    void (async () => {
      const rail = flow.rail === 'jazzcash' ? 'jazzcash' : 'easypaisa'
      let result: NonNullable<store.FlowState['payment']> = {
        rail,
        state: 'failed',
        amountPaisa: 0,
        ref: '',
        detail: 'no answer',
      }
      try {
        const res = await fetch('/api/pay', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ rail: flow.rail, phone: flow.phone, cnic: flow.cnic }),
        })
        const got = (await res.json()) as Partial<NonNullable<store.FlowState['payment']>>
        if (got?.state) result = { ...result, ...got }
      } catch {
        /* left as failed; the counter is always open */
      }

      // The rider approves the debit in their wallet app, which takes as long
      // as it takes to find the request and tap it. So the rail is asked every
      // few seconds, for up to a minute, before anything final is said. Told
      // "not received" at once, a rider was still opening the app.
      if (result.state === 'pending' && result.ref) {
        setFlow((f) => ({ ...f, payment: result }))
        say(bot(SAY.feePending.text))
        const until = Date.now() + PAY_WAIT_MS
        while (Date.now() < until) {
          await new Promise((r) => setTimeout(r, PAY_POLL_MS))
          try {
            const res = await fetch('/api/pay/status', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ rail: result.rail, ref: result.ref }),
            })
            const got = (await res.json()) as Partial<NonNullable<store.FlowState['payment']>>
            if (got?.state === 'paid' || got?.state === 'failed') {
              result = { ...result, ...got }
              break
            }
            if (got?.detail) result = { ...result, detail: got.detail }
          } catch {
            /* ask again next time round */
          }
        }
        if (result.state === 'pending')
          result = { ...result, detail: `unconfirmed after ${PAY_WAIT_MS / 1000}s — ${result.detail}` }
      }

      setFlow((f) => ({ ...f, payment: result }))

      /**
       * One retry, offered once.
       *
       * A rail can refuse and then accept the same payment seconds later —
       * JazzCash did exactly that in testing, rejecting instantly and going
       * through twenty seconds afterwards. A rider who has already approved
       * once should not be sent to a counter over that.
       */
      if (result.state !== 'paid' && !flow.payRetried) {
        setFlow((f) => ({ ...f, payRetried: true }))
        say(bot(SAY.feeRetry.text))
        return
      }

      /*
       * Money arriving gets a sound of its own.
       *
       * A rider has just approved a debit of Rs 2,500 in another app and come
       * back to this one. The bell says it landed before they have read a
       * word, which for a rider who reads slowly is the whole message — and
       * the line that follows gives them the reference to quote if anyone at
       * the office ever disputes it.
       *
       * Still pending after the wait is "not received" as far as the rider is
       * concerned — the counter is open — but it stays pending on the record,
       * because the money may yet move.
       */
      const paid = result.state === 'paid'
      if (paid) {
        cashBell()
        say(readAloud(feeReceivedLine(result.rail, result.ref)))
      }
      const note = paid ? [] : [bot(SAY.feeFailed.text)]
      // The settled payment, not the one this effect started with: `flow`
      // still says "initiated", which had a rider who had just paid being
      // told to bring the money to the counter.
      conclude(paid ? 'verified_paid' : 'verified_unpaid', { ...flow, payment: result }, note)
    })()
  }, [step, flow, conclude, say])

  /** Move to the next step, or finish. Called only once the input was accepted. */
  const advanceFrom = useCallback(
    (i: number, extra: Message[], patch: Partial<store.FlowState> = {}) => {
      setFlow((f) => {
        const merged = { ...f, ...patch }
        // Past anything already answered, not simply to the next in the list.
        // A rider who said at the number question that they had neither wallet
        // was then asked which wallet they had — twice, because the answer was
        // recorded and the sequence walked over it anyway.
        let j = i + 1
        while (STEPS[j] && alreadyAnswered(STEPS[j]!, merged)) j++
        merged.step = j
        const next = STEPS[j]
        // Collection just ended. A verified rider with a wallet is asked to pay
        // before anything is concluded; everyone else is concluded here.
        // A rider with both accounts is charged on Easypaisa: it is the rail
        // that is live, and the recorded line says JazzCash is still coming.
        const rail = merged.rail === 'both' ? 'easypaisa' : merged.rail
        const payable =
          !next &&
          !merged.ineligible &&
          // A rider we have no office for is not charged for a journey they
          // cannot make, whatever their documents said.
          !merged.noOffice &&
          outcomeFor(merged) === 'verified_unpaid' &&
          (rail === 'easypaisa' || rail === 'jazzcash')
        if (payable)
          merged.payment = {
            rail: rail!,
            state: 'initiated',
            amountPaisa: 0,
            ref: '',
            detail: '',
          }
        // Everybody is offered the quiz now, because everybody is sent to an
        // office — a rider waiting on a bike included, who is told to come once
        // they have it. Answering here saves them the same queue.
        else if (!next && !merged.noOffice)
          merged.quiz = merged.quiz ?? {
            offered: true,
            declined: false,
            done: false,
            asked: [],
            at: 0,
            answers: [],
          }
        setMessages((m) =>
          append(m, [
            ...extra,
            ...(next
              ? askMessages(next)
              : merged.noOffice
                ? // Already said, in `noOfficeForThem`: there is no office to
                  // invite them to, so there is nothing to add.
                  []
                : merged.payment?.state === 'initiated'
                  ? // The fee is being taken; the rest waits for the rail.
                    [bot(SAY.feeAsking.text)]
                  : submitted(
                      outcomeFor(merged),
                      merged.firstName,
                      OFFICES[merged.branch ?? 'f8'],
                      inviteOpts(merged),
                    )),
          ]),
        )
        return merged
      })
    },
    [],
  )

  /** Answer a question from the FAQ. Resolves when the reply is complete. */
  const runFaq = useCallback(
    (history: Message[], pending?: string) =>
      new Promise<void>((resolve) => {
        const controller = new AbortController()
        abort.current = controller
        let acc = ''
        setStreaming('')
        void runTurn(
          forModel(history).slice(-HISTORY_WINDOW),
          {
            onDelta: (t) => {
              acc += t
              setStreaming(acc)
            },
            onDone: () => {
              // Strip the repeated question; we ask it again ourselves, with the
              // recording attached. And strip any question of its own it has
              // asked the rider: the flow asks the questions, and one from both
              // at once leaves the rider with two to answer and no answer.
              const kept = stripReceipt(stripAskBack(pending ? stripEcho(acc, pending) : acc))
              if (kept) {
                const next = append(messagesRef.current, [fromModel(kept)])
                setMessages(next)
                setRevealed(next.length)
              }
              setStreaming(null)
              abort.current = null
              resolve()
            },
            onError: (message) => {
              if (acc) setMessages((m) => [...m, fromModel(acc)])
              setStreaming(null)
              setError(message)
              abort.current = null
              resolve()
            },
          },
          controller.signal,
        )
      }),
    [],
  )

  /**
   * Puts the rider back into an earlier application: its thread, its answers,
   * its id — then says so and asks the question they had reached. The old
   * thread is shown at once and not read aloud; only what is new is staged.
   */
  const restore = useCallback(
    async (id: string) => {
      setWorking(true)
      const got = phone && fullName ? await resume(id, phone, fullName) : null
      setWorking(false)
      if (!got) {
        // Gone, or not theirs after all. Carry on with this one.
        say(bot(SAY.startedFresh.text))
        advanceFrom(step, [], { resume: undefined })
        return
      }
      stopAll()
      // Fresh ids, so nothing collides with what this visit already numbered.
      const history = got.history.map((m) => ({ ...m, id: undefined }))
      const next = STEPS[got.flow.step]
      restored.current = history.length
      setRevealed(history.length)
      setMessages(append(history, [bot(SAY.resumed.text), ...(next ? askMessages(next) : [])]))
      setFlow({ ...got.flow, applicationId: id, resume: undefined })
    },
    [phone, fullName, say, advanceFrom, step],
  )

  /**
   * Everything that happens once the rider's words are in the thread, however
   * they arrived. Typed and spoken answers are the same from here on.
   */
  /**
   * The city the rider typed, resolved to one spelling.
   *
   * The list answers most of them without a call; the model handles the towns
   * and the neighbourhoods it does not list. An answer that is not a place at
   * all gets the question again rather than a branch list, because a rider who
   * misread the question is not a rider who lives nowhere.
   */
  const onCity = useCallback(
    async (text: string, withUser: Message[]) => {
      setWorking(true)
      let city: string | null = null
      let nearest: string | null = null
      try {
        const res = await fetch('/api/city', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text }),
        })
        const got = (await res.json()) as { city?: string; nearest?: string }
        city = got.city ?? null
        nearest = got.nearest ?? null
      } catch {
        /* handled below */
      }
      setWorking(false)

      // A town we do not list resolves to the listed city nearest it, which is
      // enough to decide whether we have an office anywhere near them.
      const resolved = city ?? nearest
      if (!resolved) {
        say(bot(SAY.cityUnclear.text))
        return
      }

      const choice = officeChoice(resolved)
      setFlow((f) => ({
        ...f,
        city: resolved,
        pickOffice: true,
        collected: {
          ...f.collected,
          city: resolved,
          'city.said': text.trim().slice(0, 80),
          ...(city ? {} : { 'city.nearest': resolved }),
        },
      }))
      say(readAloud(choice.say))
    },
    [say],
  )

  const processText = useCallback(
    async (text: string, withUser: Message[]) => {
      /**
       * The fee did not go through and the rider was asked whether to try
       * again. Yes puts the payment back to 'initiated', which the effect
       * above is watching; no goes on to the counter.
       */
      if (flow.payment && flow.payment.state !== 'paid' && flow.payRetried && !flow.quiz) {
        const yn = readYesNo(text)
        if (yn === 'yes') {
          paying.current = false
          setFlow((f) => ({ ...f, payment: { ...f.payment!, state: 'initiated' } }))
          say(bot(SAY.feeAsking.text))
          return
        }
        if (yn === 'no') {
          conclude('verified_unpaid', flow, [bot(SAY.feeFailed.text)])
          return
        }
        say(bot(SAY.repeat.text), bot(SAY.feeRetry.text))
        return
      }

      // The rider is being asked whether to carry on an earlier application.
      // Yes puts them back where they were, on this device; no leaves the
      // earlier one where it is (it may be a brother's) and carries on here.
      if (flow.resume) {
        const yn = readYesNo(text)
        if (yn === 'yes') return void (await restore(flow.resume.id))
        if (yn === 'no') {
          say(bot(SAY.startedFresh.text))
          advanceFrom(step, [], { resume: undefined })
          return
        }
        say(bot(SAY.repeat.text), bot(SAY.resumeOffer.text))
        return
      }

      // Collection is done. The quiz comes first if it is still running; only
      // once it is finished or declined does the bot go back to answering.
      if (!current) {
        if (quiz && !quiz.done) return void handleQuiz(text, withUser)
        return void (await runFaq(withUser))
      }

      if (current.kind === 'confirm') {
        const answer = readYesNo(text)
        // An answer can carry a question with it — "haan mere paas hai, magar
        // pehle bataein salary kitni milegi?". Acknowledge, answer, then move on.
        const also = asksSomething(text)
        if (answer === 'yes') {
          if (also) {
            say(bot(SAY.okSmartphone.text))
            await runFaq(withUser)
            advanceFrom(step, [], {})
          } else {
            advanceFrom(step, [bot(SAY.okSmartphone.text)], {})
          }
        } else if (answer === 'no') {
          // A missing phone or bike is not a rejection. Say what is needed,
          // record it, and carry on collecting — their details are worth
          // having, and they are told to come back to this same chat. Turning
          // them away at the door loses the application and the lead with it.
          if (also) await runFaq(withUser)
          const needed = current.id === 'bike' ? SAY.needBike : SAY.needSmartphone
          say(bot(needed.text), bot(SAY.knockoutAck.text))
          advanceFrom(step, [], { missing: [...(missing ?? []), current.id] })
        } else if (also) {
          // They asked something instead of answering. Answer it, then repeat.
          await runFaq(withUser, current.ask)
          say(...askMessages(current))
        } else {
          // Not an answer and not a question. Say so, and ask again — sending
          // this to the model made it invent a question of its own, which the
          // rider then saw in place of the one they had just been asked.
          say(bot(SAY.repeat.text), ...askMessages(current))
        }
        return
      }

      if (current.kind !== 'text') {
        /*
         * "I don't have one" is an answer, and it used to be unhearable here.
         * A rider with no driving licence said so twice by voice and once in
         * English, and all three times was told to press the camera button —
         * because an upload step only ever expected a file.
         *
         * It is not a rejection. The licence and the CNIC are both required,
         * so they are recorded as missing, which takes the fee out of the
         * chat and ends at an office; the rest of the details are still worth
         * collecting, and the rider is told to come back to this same chat.
         *
         * Not the selfie: it is taken here and now, so there is nothing a
         * rider can fail to have.
         */
        const required =
          current.id === 'license_front'
            ? SAY.needLicense
            : current.id === 'cnic_front'
              ? SAY.needCnicDoc
              : null
        if (required && saysHasnt(text)) {
          if (asksSomething(text)) await runFaq(withUser)
          say(bot(required.text), bot(SAY.knockoutAck.text))
          advanceFrom(step, [], { missing: [...(missing ?? []), current.id] })
          return
        }

        // A document or location was asked for, and text cannot satisfy it. A
        // question is answered, then the step is asked again. Anything else —
        // "Sent", "ho gaya", "ok" — gets the step's own line and nothing more:
        // handed "Sent", the model told a rider their licence had arrived and
        // moved on to the deposit, when nothing had arrived at all. The step
        // does not move until the server has the file and has checked it.
        if (asksSomething(text)) await runFaq(withUser, current.ask)
        say(bot(current.wrong), ...(current.audio ? askMessages(current).slice(1) : []))
        return
      }

      if (current.id === 'city') {
        // A rider still choosing a branch has already answered this; anything
        // they type now is a question, not another city.
        if (pickOffice) {
          if (asksSomething(text)) await runFaq(withUser)
          else say(bot(SAY.repeat.text))
          return
        }
        await onCity(text, withUser)
        return
      }

      if (current.id === 'wallet') {
        const rail = readRail(text)
        if (!rail) {
          if (asksSomething(text)) {
            await runFaq(withUser, current.ask)
            say(...askMessages(current))
          } else {
            say(bot(current.need), ...askMessages(current).slice(1))
          }
          return
        }
        if (rail === 'neither') {
          // The number is already in hand by this point, so what is left to say
          // is how the fee gets paid — not "send your number anyway", which is
          // what this said when one line served both questions.
          advanceFrom(step, [bot(SAY.noWalletPayAtOffice.text)], { rail, noWallet: true })
          return
        }
        advanceFrom(step, [], { rail, noWallet: false })
        return
      }

      // The only other typed step. A number is checked here rather than sent
      // to the model: it is a pattern, not a judgement, and a wrong reading
      // would fail the wallet check for a reason the rider could not guess at.
      if (current.id === 'phone') {
        const phone = readPhone(text)
        if (!phone) {
          // Read for a wallet answer before deciding this is a question. A
          // rider often answers the next question first — "I have neither" —
          // and the Latin-only test that used to live here could not see it
          // said in Urdu, so it was recorded only when the words happened to
          // also read as a plain "no".
          const rail = readRail(text)
          if (rail) {
            // An answer, not a failure to understand one. Recorded here so the
            // wallet question is not asked again further down.
            setFlow((f) => ({ ...f, rail, noWallet: rail === 'neither' }))
            say(bot(rail === 'neither' ? SAY.noWalletAskNumber.text : SAY.stillNeedNumber.text))
          } else if (asksSomething(text)) {
            await runFaq(withUser, current.ask)
            say(...askMessages(current))
          } else {
            // Not "answer the question again" — the number itself is wrong,
            // and a rider who mistyped one digit deserves to be told so.
            say(bot(SAY.badNumber.text))
          }
          return
        }
        if (asksSomething(text)) await runFaq(withUser)

        // Someone of this name has an unfinished application on this number.
        // Offered, not assumed — a phone is often shared — and nothing moves
        // until they answer.
        const earlier = fullName ? await lookup(phone, fullName, flow.applicationId ?? '') : null
        if (earlier) {
          setFlow((f) => ({
            ...f,
            phone,
            resume: { id: earlier.id, firstName: earlier.firstName, step: earlier.step },
          }))
          say(bot(SAY.resumeOffer.text))
          return
        }
        advanceFrom(step, [], { phone })
        return
      }

      // The name step. A phone number is not a name, whatever the model makes
      // of it — checked here rather than asked, the same way the number itself
      // is. Kept rather than discarded: it is the answer to the next question.
      const early = readPhone(text)
      if (early) {
        setFlow((f) => ({ ...f, phone: early }))
        say(bot(SAY.numberNotName.text))
        return
      }

      setWorking(true)
      let named: { is_name?: boolean; first_name?: string; full_name?: string } = {}
      try {
        const res = await fetch('/api/extract-name', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text }),
        })
        named = await res.json()
      } catch {
        named = {}
      }
      setWorking(false)

      if (named.is_name) {
        const first = (named.first_name ?? '').trim()
        const patch = {
          firstName: first,
          fullName: (named.full_name ?? text).trim(),
        }
        if (asksSomething(text)) {
          say(thanksName(first))
          await runFaq(withUser)
          advanceFrom(step, [], patch)
        } else {
          advanceFrom(step, [thanksName(first)], patch)
        }
      } else if (asksSomething(text)) {
        await runFaq(withUser, current.ask)
        say(...askMessages(current))
      } else {
        say(bot(SAY.repeat.text), ...askMessages(current))
      }
    },
    [current, step, runFaq, say, advanceFrom, missing, quiz, handleQuiz, flow.resume, flow.applicationId, fullName, restore, onCity, pickOffice],
  )

  /** A reply button: the words go in the thread, the answer goes down the usual path. */
  const onReply = useCallback(
    async (shown: string, answer: string) => {
      if (busy) return
      blip()
      const withUser: Message[] = [...messages, { role: 'user', content: shown }]
      setMessages(withUser)
      await processText(answer, withUser)
    },
    [busy, messages, processText],
  )


  /** A picture tapped instead of a word: the same answer, and the picture stays in the thread. */
  const onPick = useCallback(
    async (c: Choice) => {
      if (busy) return
      setError(null)
      const withUser: Message[] = [
        ...messages,
        { role: 'user', content: c.label, kind: 'choice', src: c.src },
      ]
      setMessages(withUser)
      await processText(c.answer, withUser)
    },
    [busy, messages, processText],
  )


  const onSend = useCallback(
    async (override?: string) => {
      const text = (override ?? draft).trim()
      if (!text || busy) return
      setDraft('')
      setError(null)
      const withUser: Message[] = [...messages, { role: 'user', content: text }]
      setMessages(withUser)
      await processText(text, withUser)
    },
    [draft, busy, messages, processText],
  )

  /** A spoken answer: play it back, transcribe it, then treat it as typed. */
  const onVoice = useCallback(
    async ({ blob, mime }: Recording) => {
      if (busy) return
      setError(null)

      // The name is matched against the CNIC and the licence, so it has to
      // exist as text. It is the one question a recording cannot answer — and
      // only it: the phone step is typed too, and refusing a voice note there
      // told a rider asked for their number to type their name.
      if (current?.id === 'name') {
        say(bot(SAY.typeName.text))
        return
      }

      const src = URL.createObjectURL(blob)
      const tmp = crypto.randomUUID()
      const withVoice: Message[] = [
        ...messages,
        {
          role: 'user',
          content: '',
          kind: 'audio',
          src,
          tmp,
          pending: true,
          sources: [{ src, type: mime }],
        },
      ]
      setMessages(withVoice)

      setWorking(true)
      let heard = ''
      // Where the clip was kept, so the bubble can stop pointing at a blob URL
      // that dies with the page — the rider replays their own voice note after
      // a reload, and a reviewer can hear what the transcript was made from.
      let kept = ''
      try {
        const body = new FormData()
        body.append('file', new File([blob], 'speech', { type: mime }))
        if (flow.applicationId) body.append('applicationId', flow.applicationId)
        const res = await fetch('/api/transcribe', { method: 'POST', body })
        const data = (await res.json()) as { ok?: boolean; text?: string; id?: string }
        if (data.ok && data.text) heard = data.text.trim()
        if (data.id) kept = `/api/upload/${data.id}`
      } catch {
        /* handled below */
      }
      setWorking(false)

      const settle = (content: string) =>
        withVoice.map((x) =>
          x.tmp === tmp
            ? {
                ...x,
                content,
                pending: false,
                tmp: undefined,
                ...(kept ? { src: kept, sources: [{ src: kept, type: mime }] } : {}),
              }
            : x,
        )

      if (!heard) {
        setMessages(settle(''))
        say(bot(SAY.voiceUnclear.text))
        return
      }

      const settled = settle(heard)
      setMessages(settled)
      await processText(heard, settled)
    },
    [busy, current, messages, say, processText, flow.applicationId],
  )

  /**
   * A line said once per visit. The sheet it belongs to can be opened as often
   * as the rider taps the microphone; the chat behind it says why only the
   * first time. Repeating it on every tap is what read as the app being stuck.
   */
  const sayOnce = useCallback(
    (key: keyof typeof SAY) => {
      if (saidOnce.current.has(key)) return
      saidOnce.current.add(key)
      say(bot(SAY[key].text))
    },
    [say],
  )

  const showHint = useCallback(() => {
    setHint(true)
    if (hintTimer.current) clearTimeout(hintTimer.current)
    hintTimer.current = setTimeout(() => setHint(false), 2200)
    sayOnce('holdToTalk')
  }, [sayOnce])

  const onMicProblem = useCallback(
    (p: MicProblem) => {
      setMicSheet(p)
      sayOnce(
        p === 'unsupported'
          ? 'micUnsupported'
          : p === 'ask'
            ? 'micAsk'
            : p === 'blocked'
              ? 'micBlocked'
              : p === 'busy'
                ? 'micBusy'
                : 'micNone',
      )
    },
    [sayOnce],
  )

  const recorder = useRecorder({ onDone: onVoice, onProblem: onMicProblem, onHint: showHint })
  const mic = useMicGesture(recorder)

  /**
   * The sheet's own button: ask for the permission from a tap the browser will
   * honour, or find out whether it has been given since. Either way the answer
   * decides whether the sheet closes or explains again.
   */
  const tryMic = useCallback(async () => {
    const got = await recorder.allow()
    if (got === 'granted') {
      setMicSheet(null)
      say(bot(SAY.micReady.text))
    } else onMicProblem(got)
  }, [recorder, say, onMicProblem])

  const onFile = useCallback(
    async (raw: File) => {
      setError(null)
      if (current?.imageOnly && !raw.type.startsWith('image/')) {
        say(bot(current.wrong))
        return
      }
      // Only the name. A phone number may be spoken or photographed off a
      // SIM pack; refusing every typed step here told a rider asked for their
      // number to type their name instead.
      if (current?.id === 'name') {
        say(bot(TYPE_NAME_PLEASE))
        return
      }
      if (!current || current.kind !== 'upload') {
        say(
          bot(
            current
              ? current.wrong
              : 'Aap ki application mukammal ho chuki hai, ab kisi tasveer ki zaroorat nahi.',
          ),
        )
        return
      }

      // A phone camera hands back several megabytes. Shrunk here, the same
      // card is a few hundred kilobytes and the right way up.
      const file = await shrinkImage(raw)

      // Show the photo straight away. A camera shot on a slow connection takes
      // seconds to upload and verify, and a rider who sees nothing assumes the
      // button did not work and shoots again.
      const tmp = crypto.randomUUID()
      const localPreview = URL.createObjectURL(file)
      setMessages((m) => [
        ...m,
        {
          role: 'user',
          content: '',
          kind: 'document',
          src: localPreview,
          tmp,
          pending: true,
          doc: { name: file.name, mime: file.type, size: file.size },
        },
      ])

      const settle = (src: string | undefined) =>
        setMessages((m) =>
          m.map((x) => (x.tmp === tmp ? { ...x, src, pending: false, tmp: undefined } : x)),
        )

      setWorking(true)
      try {
        const body = new FormData()
        body.append('file', file)
        if (current.doc) body.append('kind', current.doc)
        // So the server can forward the picture to the backend against the
        // right application.
        if (flow.applicationId) body.append('applicationId', flow.applicationId)
        if (fullName) body.append('expectedName', fullName)
        if (cnic) body.append('expectedCnic', cnic)
        // How many times this step has been tried. A licence the reader could
        // not be sure of is sent back once; a second doubtful one is accepted
        // and flagged, so nobody photographs the same card all afternoon.
        body.append('attempt', String((tries[current.id] ?? 0) + 1))
        // The selfie is checked against the CNIC already uploaded. Both are
        // still held in memory server-side, which is why this is sent now.
        if (current.id === 'selfie' && collected['cnic_front.uploadId'])
          body.append('against', collected['cnic_front.uploadId'])

        const res = await fetch('/api/upload', { method: 'POST', body })
        const data = (await res.json()) as {
          id?: string
          name?: string
          mime?: string
          size?: number
          error?: string
          verification?: {
            pass?: boolean
            reason?: string | null
            nameVerdict?: string | null
            fields?: Record<string, string | null>
          }
          face?: {
            outcome?: 'pass' | 'fail' | 'unavailable'
            score?: number
            reason?: string
          } | null
        }
        if (!res.ok || !data.id) {
          settle(undefined)
          setError(data.error ?? SAY.uploadFailed.text)
          return
        }

        settle(`/api/upload/${data.id}`)
        URL.revokeObjectURL(localPreview)

        // The document was read and is not what this step asked for. Say why and
        // ask again — the step does not move.
        if (data.verification && data.verification.pass === false) {
          setTries((t) => ({ ...t, [current.id]: (t[current.id] ?? 0) + 1 }))
          say(
            bot(
              data.verification?.reason ??
                'Ye tasveer saaf nahi hai. Baraye meherbani dobara bhejein.',
            ),
          )
          return
        }

        // Remember the CNIC from the first document that carries one, so every
        // later document is checked against it.
        const seen = data.verification?.fields?.cnic
        const gathered: Record<string, string> = {}
        for (const [k, v] of Object.entries(data.verification?.fields ?? {}))
          if (v) gathered[`${current.doc ?? current.id}.${k}`] = v
        if (data.verification?.nameVerdict)
          gathered[`${current.doc ?? current.id}.nameMatch`] = data.verification.nameVerdict
        if (current.id === 'selfie') gathered['selfie.captured'] = 'yes'
        // Keep the id: the selfie is matched against the CNIC by it, and the
        // dashboard shows every document by it.
        gathered[`${current.doc ?? current.id}.uploadId`] = data.id

        // A selfie that is plainly not the person on the card is worth one more
        // attempt — a bad photograph is far likelier than an impostor, and the
        // recorded line asks for better light rather than accusing anybody.
        if (data.face?.outcome === 'fail') {
          gathered['checks.faceMatch'] = `mismatch (${data.face.score?.toFixed(1) ?? '?'})`
          say(bot(SAY.selfieRetry.text))
          setFlow((f) => ({ ...f, collected: { ...f.collected, ...gathered } }))
          return
        }
        if (data.face?.outcome === 'pass')
          gathered['checks.faceMatch'] = `match (${data.face.score?.toFixed(1) ?? '?'})`
        if (data.face?.outcome === 'unavailable') gathered['checks.faceMatch'] = 'not checked'

        // The licence read, and its date has passed. The document is kept and
        // the step moves on — a second photograph of the same card cannot make
        // it current — but the rider hears why the office, not the wallet, is
        // the next thing that happens to them.
        const expired = gathered['license.expired'] === 'true'
        // Two photographs and the reader still could not be sure. Not the
        // rider's fault and not worth a third attempt — the card is in their
        // hand, and a recruiter reads it in a second.
        const unreadable = gathered['license.unreadable'] === 'true'

        advanceFrom(
          step,
          [
            thanksDoc(),
            ...(unreadable ? unreadableLicence() : []),
            ...(expired ? expiredLicence() : []),
          ],
          {
            ...(seen && !cnic ? { cnic: seen } : {}),
            collected: { ...collected, ...gathered },
          },
        )
      } catch {
        settle(undefined)
        setError(SAY.uploadFailed.text)
      } finally {
        setWorking(false)
      }
    },
    [current, step, fullName, cnic, collected, say, advanceFrom, tries, flow.applicationId],
  )

  /**
   * Finishes the last step with a branch, once the rider has chosen one.
   *
   * Chosen, never derived. This used to be decided from a GPS fix, which on
   * the handsets riders actually use failed more often than it worked — no
   * fix indoors, no permission prompt inside an in-app browser, or a position
   * from the phone network that put a rider in the wrong city. Every one of
   * those failures landed on the last step, after three documents had been
   * sent. A rider knows which office they can get to.
   */
  const chooseOffice = useCallback(
    (branch: OfficeId, extra: Record<string, string> = {}) => {
      advanceFrom(step, [thanksOffice()], {
        branch,
        pickOffice: false,
        collected: { ...collected, 'office.chosen': OFFICES[branch].short, ...extra },
      })
    },
    [step, collected, advanceFrom],
  )

  /**
   * Nothing we can offer them. Said plainly, and the conversation ends there.
   *
   * No video, no questions, no invitation: a rider who has just been told the
   * nearest office is three hundred kilometres away is not going to sit
   * through ten multiple-choice questions, and asking them to would be a way
   * of not taking their answer seriously.
   */
  const noOfficeForThem = useCallback(() => {
    advanceFrom(step, [bot(NO_OFFICE), bot(SAY.noOfficeNearby.text)], {
      pickOffice: false,
      noOffice: true,
      collected: { ...collected, 'office.chosen': 'none of the offices suit the rider' },
    })
  }, [step, collected, advanceFrom])

  const stop = useCallback(() => {
    abort.current?.abort()
    abort.current = null
    setStreaming((acc) => {
      if (acc) setMessages((m) => [...m, fromModel(acc)])
      return null
    })
  }, [])

  const reset = useCallback(() => {
    // Clear means start over. The server's copy is closed, not deleted, so
    // the same number is not offered this application back next time.
    if (flow.applicationId)
      void fetch(`/api/application/${flow.applicationId}/close`, { method: 'POST', keepalive: true }).catch(() => {})
    abort.current?.abort()
    abort.current = null
    setStreaming(null)
    setWorking(false)
    store.clear()
    store.clearState()
    stopAll()
    restored.current = 0
    setMessages(WELCOME)
    // Back to nothing revealed, so the welcome is said again at a pace the rider
    // can follow. Left where it was, it sat past the end of the new thread and
    // dropped the whole welcome on screen at once.
    setRevealed(0)
    setTyped(0)
    setFlow({
      applicationId: crypto.randomUUID(),
      step: 0,
      firstName: '',
      fullName: '',
      cnic: '',
      collected: {},
      ineligible: false,
      missing: [],
      phone: '',
    })
    setError(null)
  }, [])

  const rendered = useMemo(
    () =>
      messages.map((m) =>
        m.role === 'assistant' && (!m.kind || m.kind === 'text')
          ? renderMarkdown(m.content)
          : null,
      ),
    [messages],
  )

  return (
    <div class="shell">
      <header>
        <img class="mark" src="/panda.png" alt="" />
        <span class="who">
          <strong>Foodpanda Rider Onboarding</strong>
          <span class="status">{streaming !== null ? 'typing…' : 'online'}</span>
        </span>
        {/* Temporary, for testing the flow. Goes when the flow is trusted. */}
        <button
          class="ghost data"
          onClick={() => setDashOpen(true)}
          aria-label="Collected data dekhein"
        >
          Data
        </button>
        <button class="ghost clear" onClick={reset} disabled={busy}>
          Clear
        </button>
      </header>

      <div class="scroll" ref={scroller}>
        {messages.slice(0, revealed).map((m, i) => {
          if (m.kind === 'image')
            return (
              <div key={i} class="msg bot media shot">
                <Picture src={m.src ?? ''} alt="Foodpanda delivery rider" />
                <Stamp m={m} />
              </div>
            )
          if (m.kind === 'choice')
            return (
              <div key={i} class="msg user picked">
                {/* Width and height given, so the bubble has its size before
                    the picture loads — a flex column shrank it to a sliver
                    on a Samsung while the image was still on its way. */}
                <span class="pickwrap">
                  {m.src && <img class="pick" src={m.src} width={120} height={103} alt="" draggable={false} />}
                  <span class="pickbadge" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="14" height="14">
                      <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  </span>
                </span>
                <span class="picklabel">{m.content}</span>
                <Stamp m={m} />
              </div>
            )
          if (m.kind === 'location' && m.place)
            // Not `shot`: that pins the timestamp over the picture, and here
            // there is a caption under it for the stamp to sit beside.
            return (
              <div key={i} class="msg bot media place-msg">
                <a
                  class="place"
                  href={`https://www.google.com/maps/search/?api=1&query=${m.place.lat},${m.place.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span class="placemap">
                    {m.src && <img src={m.src} alt="" width={640} height={300} draggable={false} />}
                    {/* Drawn here rather than into the picture, so it stays
                        sharp on a dense screen and the picture stays a map. */}
                    <svg class="placepin" viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
                      <path
                        d="M12 22s7-6.3 7-12A7 7 0 0 0 5 10c0 5.7 7 12 7 12z"
                        fill="#ea4335"
                        stroke="#fff"
                        stroke-width="1.6"
                      />
                      <circle cx="12" cy="10" r="2.6" fill="#fff" />
                    </svg>
                  </span>
                  <span class="placefoot">
                    <strong>{m.content}</strong>
                    <small>Google Maps mein kholein</small>
                  </span>
                </a>
                <Stamp m={m} />
              </div>
            )
          if (m.kind === 'video')
            return (
              <div key={i} class="msg bot media shot">
                <Video id={m.video ?? ''} caption="foodpanda rider training video" />
                <Stamp m={m} />
              </div>
            )
          if (m.kind === 'audio') {
            const mine = m.role === 'user'
            // A line Uplift is still reading shows nothing at all. The words are
            // already on screen and the voice note simply appears behind them —
            // a spinner over an empty bubble has no box to sit in, so it floated
            // loose over whatever happened to be next to it.
            if (m.speak && !m.sources) return null
            return (
              <div
                key={i}
                class={`msg ${mine ? 'user' : 'bot'} media${m.pending ? ' pending' : ''}`}
                dir="auto"
              >
                {/* Only ever over the rider's own clip, which fills the bubble. */}
                {mine && m.pending && (
                  <span class="spinner" role="status" aria-label="Awaaz sun rahe hain" />
                )}
                <VoiceNote
                  sources={m.sources ?? VOICE_SOURCES}
                  playId={!mine && i >= restored.current ? m.id : undefined}
                />
                {/* Show what was heard, so a mistranscription is obvious. */}
                {mine && m.content && <span class="transcript">{m.content}</span>}
                <Stamp m={m} />
              </div>
            )
          }
          if (m.kind === 'document')
            return (
              <div key={i} class={`msg user media${m.pending ? ' pending' : ''}`}>
                {m.pending && (
                  <span class="spinner" role="status" aria-label="Tasveer check ho rahi hai" />
                )}
                <DocumentBubble
                  src={m.src ?? ''}
                  name={m.doc?.name ?? 'document'}
                  mime={m.doc?.mime ?? ''}
                  size={m.doc?.size ?? 0}
                />
              </div>
            )
          return m.role === 'user' ? (
            <div key={i} class="msg user">
              {m.content}
              <Stamp m={m} />
            </div>
          ) : (
            <div key={i} class="msg bot" dir="auto">
              <span dangerouslySetInnerHTML={{ __html: rendered[i] ?? '' }} />
              <Stamp m={m} />
            </div>
          )
        })}

        {revealed >= messages.length && !busy && flow.resume && (
          <div class="replies">
            <button class="reply" onClick={() => void onReply('Haan, wahin se', 'haan')}>Haan, wahin se jaari rakhein</button>
            <button class="reply" onClick={() => void onReply('Nahi, nayi application', 'nahi')}>Nahi, nayi shuru karein</button>
          </div>
        )}
        {!current && quiz && quiz.offered && !quiz.done && revealed >= messages.length && !busy && (
          quiz.asked.length === 0 ? (
            <div class="replies">
              <button class="reply" onClick={() => void onReply('Haan', 'haan')}>Haan, quiz dein</button>
              <button class="reply" onClick={() => void onReply('Nahi', 'nahi')}>Nahi</button>
            </div>
          ) : (
            <div class="replies">
              {(QUESTIONS.find((x) => x.id === quiz.asked[quiz.at])?.options ?? []).map((o) => (
                <button key={o.key} class="reply answer" onClick={() => void onReply(`${o.key.toUpperCase()}) ${o.text}`, o.key)}>
                  <b>{o.key.toUpperCase()}</b>
                  {o.text}
                </button>
              ))}
            </div>
          )
        )}
        {/* The branches, once the rider has said which city they are in. A
            rider in a city we are in sees that city's offices; anyone else
            sees all of them, and a way to say none of them will do. */}
        {current?.id === 'city' && pickOffice && revealed >= messages.length && (
          <div class="replies">
            {officeChoice(flow.city ?? '').offices.map((id) => (
              <button key={id} class="reply office" onClick={() => { blip(); chooseOffice(id) }} disabled={busy}>
                {OFFICES[id].short}
                <small>{OFFICES[id].address.replace('foodpanda office, ', '')}</small>
              </button>
            ))}
            {officeChoice(flow.city ?? '').wayOut && (
              <button class="reply" onClick={() => { blip(); noOfficeForThem() }} disabled={busy}>
                {NO_OFFICE}
              </button>
            )}
          </div>
        )}
        {current?.kind === 'confirm' && CHOICES[current.id] && revealed >= messages.length && !flow.resume && (
          <Choices options={CHOICES[current.id]!} disabled={busy} onPick={(c) => void onPick(c)} />
        )}
        {revealed < messages.length && typed > 0 && messages[revealed] && (
          <div class="msg bot">
            <span
              dangerouslySetInnerHTML={{
                __html: renderMarkdown(
                  messages[revealed]!.content.split(/\s+/).filter(Boolean).slice(0, typed).join(' '),
                ),
              }}
            />
          </div>
        )}

        {streaming !== null && (
          <div class="msg bot">
            {streaming ? (
              <span dangerouslySetInnerHTML={{ __html: renderMarkdown(streaming) }} />
            ) : (
              <span class="think">soch rahi hoon</span>
            )}
          </div>
        )}


        {error && <div class="err banner">{error}</div>}
      </div>

      {dashOpen && <Dashboard flow={flow} syncedAt={syncedAt} onClose={() => setDashOpen(false)} />}

      {selfieCam === 'open' && (
        <Camera
          facing="user"
          label="Selfie khenchein"
          onCancel={() => setSelfieCam(null)}
          onShot={({ blob }) => {
            setSelfieCam(null)
            void onFile(new File([blob], 'selfie.jpg', { type: 'image/jpeg' }))
          }}
          onUnavailable={() => setSelfieCam('refused')}
        />
      )}
      {selfieCam === 'refused' && (
        <div class="sheetback" onClick={() => setSelfieCam(null)}>
          <div class="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <span class="sheet-grip" />
            <h2>Camera nahi khul raha</h2>
            <p>Phone ke camera se selfie lein. Camera khulay to usay apni taraf (front) ghuma lein.</p>
            {/* A real tap, so the browser honours the click on the input. */}
            <button
              class="sheet-main"
              onClick={() => {
                setSelfieCam(null)
                selfieInput.current?.click()
              }}
            >
              Phone ke camera se selfie lein
            </button>
            <button class="sheet-alt" onClick={() => setSelfieCam(null)}>
              Band karein
            </button>
          </div>
        </div>
      )}
      {micSheet && (
        <MicSheet
          kind={micSheet}
          onClose={() => setMicSheet(null)}
          onAllow={tryMic}
          onRetry={tryMic}
          onRecorderApp={() => recApp.current?.click()}
          onType={() => {
            setMicSheet(null)
            document.querySelector<HTMLTextAreaElement>('footer textarea')?.focus()
          }}
        />
      )}
      {hint && (
        <div class="toast" role="status">
          Bolne ke liye dabaye rakhein
        </div>
      )}

      <footer class={recorder.state}>
        <input
          ref={picker}
          class="hidden"
          type="file"
          accept={ACCEPT}
          onChange={(e) => {
            const el = e.target as HTMLInputElement
            const f = el.files?.[0]
            el.value = ''
            if (f) void onFile(f)
          }}
        />
        {/* The phone's own camera app, back and front. It needs no permission
            from the browser, which is how a rider whose browser refused the
            camera still sends a photograph — and it gives the full-resolution
            picture, which the in-chat preview never could. */}
        <input
          ref={camera}
          class="hidden"
          type="file"
          accept={CAMERA_ACCEPT}
          capture="environment"
          onChange={(e) => {
            const el = e.target as HTMLInputElement
            const f = el.files?.[0]
            el.value = ''
            if (f) void onFile(f)
          }}
        />
        <input
          ref={selfieInput}
          class="hidden"
          type="file"
          accept={CAMERA_ACCEPT}
          capture="user"
          onChange={(e) => {
            const el = e.target as HTMLInputElement
            const f = el.files?.[0]
            el.value = ''
            if (f) void onFile(f)
          }}
        />
        {/* The phone's recorder app. Whatever it records, the server converts. */}
        <input
          ref={recApp}
          class="hidden"
          type="file"
          accept="audio/*"
          capture="environment"
          onChange={(e) => {
            const el = e.target as HTMLInputElement
            const f = el.files?.[0]
            el.value = ''
            if (f) void onVoice({ blob: f, mime: f.type || 'audio/mp4', seconds: 0 })
          }}
        />

        {recorder.state === 'reviewing' && recorder.draft ? (
          <>
          {/* Stopped and held: hear it back, then send or bin it. */}
          <button class="bin" onClick={recorder.cancel} aria-label="Mansookh karein">
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
              <path
                d="M4 7h16M10 4h4M9 7v12m3-12v12m3-12v12M6 7l1 13h10l1-13"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
          <div class="review">
            <VoiceNote
              sources={[{ src: URL.createObjectURL(recorder.draft.blob), type: recorder.draft.mime }]}
            />
          </div>
          </>
        ) : recorder.state === 'locked' ? (
          <>
          <button class="bin" onClick={recorder.cancel} aria-label="Mansookh karein">
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
              <path
                d="M4 7h16M10 4h4M9 7v12m3-12v12m3-12v12M6 7l1 13h10l1-13"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
          <span class="reclive">
            <RedMic />
            {mmss(recorder.seconds)}
          </span>
          {/* Stop: the recording ends and waits to be heard back. */}
          <button class="stoprec" onClick={recorder.stop} aria-label="Rok kar sunein">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
            </svg>
          </button>
          </>
        ) : recorder.state === 'recording' || recorder.state === 'asking' ? (
          <div class="rectray">
            <span class="reclive">
              <RedMic />
              {mmss(recorder.seconds)}
            </span>
            <span
              class="slidecancel"
              style={{
                transform: `translateX(${mic.dx}px)`,
                opacity: Math.max(0, 1 + mic.dx / CANCEL_PX),
              }}
            >
              ‹ Cancel ke liye slide karein
            </span>
          </div>
        ) : (
        <div class="pill">
          <textarea
            value={draft}
            rows={1}
            placeholder="Message"
            onFocus={warm}
            onInput={(e) => {
              const el = e.target as HTMLTextAreaElement
              setDraft(el.value)
              el.style.height = 'auto'
              el.style.height = `${Math.min(el.scrollHeight, 180)}px`
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void onSend((e.target as HTMLTextAreaElement).value)
              }
            }}
          />

          <button
            class="attach"
            aria-label="Tasveer ya file bhejein"
            // Greyed out unless a file from storage is what is being asked for.
            // Not on the selfie step either: a file from storage is somebody's
            // saved photograph, which is the one thing the face match exists to
            // catch — the selfie has to be taken now, on the front camera.
            disabled={busy || !wantsUpload || current?.facing === 'user'}
            onClick={() => picker.current?.click()}
          >
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
              <path
                d="M16.5 6.5v9.75a4.5 4.5 0 0 1-9 0V5.75a3 3 0 0 1 6 0v9.75a1.5 1.5 0 0 1-3 0V6.5"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
              />
            </svg>
          </button>

          <button
            class="camera"
            aria-label={current?.facing === 'user' ? 'Selfie khenchein' : 'Tasveer khenchein'}
            // Front camera for a selfie, back camera for everything else. The
            // paperclip beside it is the way to send a file already on the phone.
            // The click on the input has to happen inside this tap: a browser
            // ignores one that arrives after an await, which is how the old
            // fallback to this same input never opened anything.
            disabled={busy || !wantsUpload}
            onClick={() => (current?.facing === 'user' ? setSelfieCam('open') : camera.current?.click())}
          >
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
              <path
                d="M4.5 7.5h3L9 5.5h6l1.5 2h3A1.5 1.5 0 0 1 21 9v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18V9a1.5 1.5 0 0 1 1.5-1.5z"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linejoin="round"
              />
              <circle cx="12" cy="13.2" r="3.3" fill="none" stroke="currentColor" stroke-width="1.7" />
            </svg>
          </button>
        </div>
        )}

        {streaming !== null ? (
          <button class="fab stop" onClick={stop} aria-label="Rok dein">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
            </svg>
          </button>
        ) : draft.trim() ? (
          <button
            class="fab send"
            onClick={() => void onSend()}
            disabled={busy}
            aria-label="Bhejein"
          >
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
              <path d="M2.2 21.3 23 12 2.2 2.7 2.2 10l14.4 2-14.4 2z" fill="currentColor" />
            </svg>
          </button>
        ) : recorder.state === 'locked' || recorder.state === 'reviewing' ? (
          <span class="micwrap">
            {/* Shut, and gone a moment later: the sign that the slide took. */}
            {mic.justLocked && (
              <span class="lockpill locked" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18">
                  <rect x="5" y="10" width="14" height="11" rx="2" fill="currentColor" />
                  <path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="1.8" />
                </svg>
              </span>
            )}
            <button
              class="fab send pop"
              onClick={() => {
                if (!mic.settling()) recorder.send()
              }}
              aria-label="Bhejein"
            >
              <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                <path d="M2.2 21.3 23 12 2.2 2.7 2.2 10l14.4 2-14.4 2z" fill="currentColor" />
              </svg>
            </button>
          </span>
        ) : (
          <span class="micwrap">
            {/* The lock. As the finger rises the chevron fades and the button
                climbs towards it; at the threshold the padlock shuts. */}
            <span
              class={`lockpill ${recorder.state === 'recording' ? 'up' : ''}`}
              style={{ transform: `translate(-50%, ${-mic.rise * 10}px)` }}
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" width="18" height="18">
                <rect x="5" y="10" width="14" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.8" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="1.8" />
              </svg>
              <svg class="chev" viewBox="0 0 24 24" width="16" height="16" style={{ opacity: 1 - mic.rise }}>
                <path d="M6 14l6-6 6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
              </svg>
            </span>
            {/* Held, not tapped. The gesture handlers are the whole feature. */}
            <button
              class={`fab mic ${recorder.state}`}
              style={recorder.state === 'recording' ? { transform: `translateY(${-mic.rise * 34}px) scale(1.9)` } : undefined}
              aria-label="Bolne ke liye dabaye rakhein"
              disabled={busy}
              {...mic.handlers}
            >
              <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                <path
                  d="M12 15a3.5 3.5 0 0 0 3.5-3.5v-6a3.5 3.5 0 0 0-7 0v6A3.5 3.5 0 0 0 12 15z"
                  fill="currentColor"
                />
                <path
                  d="M18.5 11.2a6.5 6.5 0 0 1-13 0M12 17.8V21"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.9"
                  stroke-linecap="round"
                />
              </svg>
            </button>
          </span>
        )}
      </footer>

      <div class="credit">
        <span>Powered by</span>
        <img src="/rozeegpt.png" alt="RozeeGPT" />
      </div>
    </div>
  )
}
