import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks'
import { Dashboard } from './dashboard.tsx'
import { DebugPanel } from './debug.tsx'
import {
  alreadyAnswered,
  askMessages,
  finished,
  quizAsk,
  quizSay,
  STEPS,
  thanksDoc,
  thanksGps,
  thanksName,
} from './flow.ts'
import {
  audioSources,
  canPickFrom,
  distanceKm,
  nearestOffice,
  OFFICES,
  type Outcome,
} from '../shared/steps.ts'
import { INTRO as QUIZ_INTRO, pickQuestions, QUESTIONS, readChoice } from '../shared/quiz.ts'
import { audioForText, awaitingVoice, SAY } from '../shared/messages.ts'
import {
  asksSomething,
  dropRepeat,
  readPhone,
  readRail,
  readYesNo,
  stripAskBack,
  stripEcho,
  TYPE_NAME_PLEASE,
} from '../shared/steps.ts'
import { render as renderMarkdown } from './markdown.ts'
import { Camera, type Shot } from './camera.tsx'
import { DocumentBubble, Picture, Video, VoiceNote } from './media.tsx'
import * as store from './storage.ts'
import type { Message } from './storage.ts'
import { useRecorder, type Recording } from './recorder.ts'
import { setOrder, stopAll } from './autoplay.ts'
import { runTurn, warm } from './stream.ts'
import { forModel, VOICE_SOURCES, WELCOME } from './welcome.ts'

const HISTORY_WINDOW = 12

/**
 * Messages the bot sends arrive as a batch — the welcome is six at once — which
 * lands as a wall of text nobody reads. They are revealed instead in the groups
 * a person would say them in: a line, its voice note just behind it, then a
 * pause before the next thing is said. A rider who is listening rather than
 * reading needs that pause to keep up.
 */
const WORD_MS = 18
/** A voice note follows the words it speaks almost at once: one utterance. */
const BEAT_MS = 160
/** The pause between one thing being said and the next. */
const GROUP_MS = 700
/** Long messages reveal several words a tick so none outstays this budget. */
const MAX_TICKS = 14
const ACCEPT = 'image/jpeg,image/png,image/gif,application/pdf,.jpg,.jpeg,.png,.gif,.pdf'
const CAMERA_ACCEPT = 'image/*'

const bot = (content: string): Message => ({ role: 'assistant', content })

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
  const verified =
    face.startsWith('match') && (name === 'match' || name === 'review' || name === '')

  if (!verified) return 'not_verified'
  // Payment is not wired into the flow yet, so the fee is still owed.
  return 'verified_unpaid'
}

const stamp = (list: Message[]): Message[] => {
  let now = 0
  return list.map((m) =>
    m.at && m.id ? m : { ...m, at: m.at ?? (now ||= Date.now()), id: m.id ?? `m${++seq}` },
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
  /** Which way the camera should face while it is open, or null when it is not. */
  const [camOpen, setCamOpen] = useState<'user' | 'environment' | null>(null)
  /** Testing only: everything collected so far, on one screen. */
  const [dashOpen, setDashOpen] = useState(false)
  const [gate, setGate] = useState({ required: false, authed: true })
  const [password, setPassword] = useState('')

  const abort = useRef<AbortController | null>(null)
  const messagesRef = useRef(messages)
  const scroller = useRef<HTMLDivElement | null>(null)
  const picker = useRef<HTMLInputElement | null>(null)
  const camera = useRef<HTMLInputElement | null>(null)
  const selfieCam = useRef<HTMLInputElement | null>(null)

  const busy = streaming !== null || working
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
    fetch('/api/session')
      .then((r) => r.json())
      .then((s: { authRequired: boolean; authed: boolean }) =>
        setGate({ required: s.authRequired, authed: s.authed }),
      )
      .catch(() => {})
  }, [])

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
    const lead = revealed === 0 ? 0 : attached ? BEAT_MS : GROUP_MS

    if (m.kind && m.kind !== 'text') {
      const t = setTimeout(() => setRevealed((r) => r + 1), lead)
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
  }, [revealed, messages])
  /**
   * The whole thing, not a list of fields. Naming them one by one meant every
   * field added afterwards was silently left out of storage — the phone number,
   * the gates a rider did not meet and their quiz answers were all being lost
   * on reload, and nothing said so.
   */
  useEffect(() => store.saveState(flow), [flow])

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
        setMessages((list) =>
          list.flatMap((x) => {
            if (x.speak !== words || x.sources) return [x]
            // Without audio the bubble is an empty box, so drop it entirely.
            return sources ? [{ ...x, sources, pending: false }] : []
          }),
        )
      })()
    }
  }, [messages])

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
          setFlow((f) => ({ ...f, quiz: { ...q, declined: true, done: true } }))
          say(...quizSay('declined'))
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
        setFlow((f) => ({ ...f, quiz: { ...q, answers, at: next, done: true } }))
        say(...quizSay('closing'))
        return
      }
      setFlow((f) => ({ ...f, quiz: { ...q, answers, at: next } }))
      const following = QUESTIONS.find((x) => x.id === q.asked[next])
      if (following) say(...quizAsk(following, next + 1, q.asked.length))
    },
    [quiz, say],
  )


  /**
   * Ends the conversation: the closing for this outcome, the training video,
   * and the quiz offer. Reached either straight from the last step or, when a
   * fee is being taken, once the rail has answered.
   */
  const conclude = useCallback(
    (outcome: Outcome, f: store.FlowState, before: Message[] = []) => {
      setFlow((prev) => ({
        ...prev,
        quiz:
          outcome === 'not_eligible'
            ? prev.quiz
            : (prev.quiz ?? {
                offered: true,
                declined: false,
                done: false,
                asked: [],
                at: 0,
                answers: [],
              }),
      }))
      setMessages((m) =>
        append(m, [...before, ...finished(outcome, f.firstName, OFFICES[f.branch ?? 'f8'].address)]),
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
      let result: store.FlowState['payment'] = {
        rail: flow.rail ?? 'easypaisa',
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

      setFlow((f) => ({ ...f, payment: result }))
      const note =
        result.state === 'paid'
          ? []
          : result.state === 'pending'
            ? [bot(SAY.feePending.text)]
            : [bot(SAY.feeFailed.text)]
      conclude(result.state === 'paid' ? 'verified_paid' : 'verified_unpaid', flow, note)
    })()
  }, [step, flow, conclude])

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
        else if (!next && outcomeFor(merged) !== 'not_eligible')
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
              : merged.payment?.state === 'initiated'
                ? // The fee is being taken; the closing waits for the rail.
                  [bot(SAY.feeAsking.text)]
                : merged.ineligible
                  ? []
                  : finished(
                      outcomeFor(merged),
                      merged.firstName,
                      OFFICES[merged.branch ?? 'f8'].address,
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
              const kept = stripAskBack(pending ? stripEcho(acc, pending) : acc)
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
            onUnauthorized: () => {
              setStreaming(null)
              setGate({ required: true, authed: false })
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
   * Everything that happens once the rider's words are in the thread, however
   * they arrived. Typed and spoken answers are the same from here on.
   */
  const processText = useCallback(
    async (text: string, withUser: Message[]) => {
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
        // A document or location was asked for. Text cannot satisfy it, so treat
        // it as a question, answer it, then ask again. The step does not move.
        await runFaq(withUser, current.ask)
        say(bot(current.wrong), ...(current.audio ? askMessages(current).slice(1) : []))
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
        if (asksSomething(text)) {
          await runFaq(withUser)
          advanceFrom(step, [], { phone })
        } else {
          advanceFrom(step, [], { phone })
        }
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
    [current, step, runFaq, say, advanceFrom, missing, quiz, handleQuiz],
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
      try {
        const body = new FormData()
        body.append('file', new File([blob], 'speech', { type: mime }))
        const res = await fetch('/api/transcribe', { method: 'POST', body })
        const data = (await res.json()) as { ok?: boolean; text?: string }
        if (data.ok && data.text) heard = data.text.trim()
      } catch {
        /* handled below */
      }
      setWorking(false)

      const settle = (content: string) =>
        withVoice.map((x) =>
          x.tmp === tmp ? { ...x, content, pending: false, tmp: undefined } : x,
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
    [busy, current, messages, say, processText],
  )

  const recorder = useRecorder(onVoice, () => say(bot(SAY.micDenied.text)))

  const onFile = useCallback(
    async (file: File) => {
      setError(null)
      if (current?.imageOnly && !file.type.startsWith('image/')) {
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
        if (fullName) body.append('expectedName', fullName)
        if (cnic) body.append('expectedCnic', cnic)
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

        advanceFrom(step, [thanksDoc()], {
          ...(seen && !cnic ? { cnic: seen } : {}),
          collected: { ...collected, ...gathered },
        })
      } catch {
        settle(undefined)
        setError(SAY.uploadFailed.text)
      } finally {
        setWorking(false)
      }
    },
    [current, step, fullName, cnic, collected, say, advanceFrom],
  )

  /**
   * Finishes the location step with a branch, however it was arrived at.
   * Offered as buttons when the pin cannot be trusted, so a rider is never
   * stuck at the last step with three documents already sent.
   */
  const chooseOffice = useCallback(
    (branch: 'f8' | 'saddar', extra: Record<string, string> = {}) => {
      advanceFrom(step, [thanksGps()], {
        branch,
        collected: { ...collected, 'gps.office': OFFICES[branch].short, ...extra },
      })
    },
    [step, collected, advanceFrom],
  )

  const onGps = useCallback(() => {
    setError(null)
    if (!current || current.kind !== 'gps') return
    if (!navigator.geolocation) {
      say(bot('Is phone mein location ki suvidha nahi hai.'))
      return
    }
    setWorking(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setWorking(false)
        const { latitude, longitude } = pos.coords
        const at = { lat: latitude, lng: longitude, accuracy: pos.coords.accuracy }
        if (!canPickFrom(at)) {
          // A fix arrived, but not one worth trusting — too vague to tell the
          // offices apart, or a rider nowhere near either. Ask.
          setFlow((f) => ({
            ...f,
            pickOffice: true,
            collected: {
              ...f.collected,
              'gps.latitude': latitude.toFixed(6),
              'gps.longitude': longitude.toFixed(6),
              'gps.accuracyMetres': String(Math.round(pos.coords.accuracy)),
              'gps.office': 'asked the rider — the pin was not usable',
            },
          }))
          say(bot(SAY.pickOffice.text))
          return
        }
        advanceFrom(
          step,
          [
            {
              role: 'user',
              content: `Location: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
            },
            thanksGps(),
          ],
          {
            // Which branch to send them to, decided here while the pin is in
            // hand. The offices are twelve kilometres and a motorway apart, so
            // naming the wrong one costs a rider a wasted morning.
            branch: nearestOffice({ lat: latitude, lng: longitude }),
            collected: {
              ...collected,
              'gps.latitude': latitude.toFixed(6),
              'gps.longitude': longitude.toFixed(6),
              'gps.accuracyMetres': String(Math.round(pos.coords.accuracy)),
              'gps.nearestOffice': OFFICES[nearestOffice({ lat: latitude, lng: longitude })].short,
              'gps.distanceKm': distanceKm(
                { lat: latitude, lng: longitude },
                OFFICES[nearestOffice({ lat: latitude, lng: longitude })],
              ).toFixed(1),
            },
          },
        )
      },
      () => {
        setWorking(false)
        // Asked once, then offered the choice. Repeating the request forever
        // stranded a verified rider at the last step over a GPS chip.
        setFlow((f) => ({
          ...f,
          pickOffice: true,
          collected: { ...f.collected, 'gps.office': 'asked the rider — no location' },
        }))
        say(bot(SAY.locationDenied.text), bot(SAY.pickOffice.text))
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    )
  }, [current, step, collected, say, advanceFrom])

  const stop = useCallback(() => {
    abort.current?.abort()
    abort.current = null
    setStreaming((acc) => {
      if (acc) setMessages((m) => [...m, fromModel(acc)])
      return null
    })
  }, [])

  const reset = useCallback(() => {
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

  const login = useCallback(
    async (e: Event) => {
      e.preventDefault()
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (res.ok) {
        setGate({ required: true, authed: true })
        setPassword('')
        setError(null)
      } else setError('Wrong password')
    },
    [password],
  )

  const rendered = useMemo(
    () =>
      messages.map((m) =>
        m.role === 'assistant' && (!m.kind || m.kind === 'text')
          ? renderMarkdown(m.content)
          : null,
      ),
    [messages],
  )

  if (gate.required && !gate.authed) {
    return (
      <div class="gate">
        <form onSubmit={login}>
          <h1>Foodpanda Delivery Rider Onboarding</h1>
          <input
            type="password"
            value={password}
            placeholder="Access password"
            autofocus
            onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
          />
          <button type="submit">Enter</button>
          {error && <p class="err">{error}</p>}
        </form>
      </div>
    )
  }

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

        {!current && <DebugPanel data={collected} />}

        {error && <div class="err banner">{error}</div>}
      </div>

      {current?.kind === 'gps' && !pickOffice && (
        <div class="gpsbar">
          <button onClick={onGps} disabled={busy}>
            📍 Location bhejein
          </button>
        </div>
      )}

      {current?.kind === 'gps' && pickOffice && (
        <div class="gpsbar offices">
          {(['f8', 'saddar'] as const).map((id) => (
            <button key={id} onClick={() => chooseOffice(id)} disabled={busy}>
              <b>{OFFICES[id].short}</b>
              <span>{OFFICES[id].address.replace('foodpanda office, ', '')}</span>
            </button>
          ))}
        </div>
      )}

      {dashOpen && <Dashboard flow={flow} onClose={() => setDashOpen(false)} />}

      {camOpen && (
        <Camera
          facing={camOpen}
          label={camOpen === 'user' ? 'Selfie khenchein' : 'Tasveer khenchein'}
          onCancel={() => setCamOpen(null)}
          onShot={({ blob }) => {
            setCamOpen(null)
            void onFile(
              new File([blob], camOpen === 'user' ? 'selfie.jpg' : 'photo.jpg', {
                type: 'image/jpeg',
              }),
            )
          }}
          onUnavailable={() => {
            // No camera, no permission, or an insecure origin. Fall back to the
            // picker rather than leaving the button doing nothing.
            setCamOpen(null)
            ;(current?.facing === 'user' ? selfieCam : camera).current?.click()
          }}
        />
      )}

      {recorder.state === 'recording' ? (
        <footer class="recbar">
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
            <span class="recdot" />
            {`${Math.floor(recorder.seconds / 60)}:${String(recorder.seconds % 60).padStart(2, '0')}`}
          </span>
          <button class="fab send" onClick={recorder.stop} aria-label="Bhejein">
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
              <path d="M2.2 21.3 23 12 2.2 2.7 2.2 10l14.4 2-14.4 2z" fill="currentColor" />
            </svg>
          </button>
        </footer>
      ) : (
      <footer>
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
        {/* capture="environment" opens the rear camera straight away on a phone.
            Desktop browsers ignore it, so the button is hidden there. */}
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
          ref={selfieCam}
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
            disabled={busy || !wantsUpload}
            onClick={() => setCamOpen(current?.facing === 'user' ? 'user' : 'environment')}
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
        ) : (
          <button
            class="fab mic"
            aria-label="Awaaz mein jawab dein"
            disabled={busy}
            onClick={() => void recorder.start()}
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
        )}
      </footer>
      )}

      <div class="credit">
        <span>Powered by</span>
        <img src="/rozeegpt.png" alt="RozeeGPT" />
      </div>
    </div>
  )
}
