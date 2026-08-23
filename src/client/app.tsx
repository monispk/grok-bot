import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks'
import { DebugPanel } from './debug.tsx'
import { askMessages, finished, STEPS, thanksDoc, thanksGps, thanksName } from './flow.ts'
import { audioSources } from '../shared/steps.ts'
import { audioForText, SAY } from '../shared/messages.ts'
import { dropRepeat, readYesNo, stripEcho, TYPE_NAME_PLEASE } from '../shared/steps.ts'
import { render as renderMarkdown } from './markdown.ts'
import { DocumentBubble, Picture, VoiceNote } from './media.tsx'
import * as store from './storage.ts'
import type { Message } from './storage.ts'
import { runTurn, warm } from './stream.ts'
import { forModel, VOICE_SOURCES, WELCOME } from './welcome.ts'

const HISTORY_WINDOW = 12

/**
 * Messages the bot sends arrive as a batch — the welcome is six at once — which
 * lands as a wall of text nobody reads. They are revealed one at a time instead,
 * words appearing quickly, so the eye follows the newest line rather than having
 * to find it. Fast enough not to be a wait; slow enough to be noticed.
 */
const WORD_MS = 18
const GAP_MS = 110
const MEDIA_MS = 190
/** Long messages reveal several words a tick so none outstays this budget. */
const MAX_TICKS = 14
const ACCEPT = 'image/jpeg,image/png,image/gif,application/pdf,.jpg,.jpeg,.png,.gif,.pdf'
const CAMERA_ACCEPT = 'image/*'

const bot = (content: string): Message => ({ role: 'assistant', content })

/**
 * Appends, skipping any bot line that just repeats the one before it, and
 * attaching the recording for any message that has one.
 */
function append(existing: Message[], incoming: Message[]): Message[] {
  const out = [...existing]
  for (const m of incoming) {
    const prev = [...out].reverse().find((x) => x.role === 'assistant' && !x.kind)
    if (m.role === 'assistant' && !m.kind && dropRepeat(prev?.content, m.content)) continue
    out.push(m)
    if (m.role === 'assistant' && !m.kind) {
      const spoken = audioForText(m.content)
      if (spoken)
        out.push({ role: 'assistant', content: '', kind: 'audio', sources: audioSources(spoken) })
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
  const [messages, setMessages] = useState<Message[]>(boot.msgs)
  const [revealed, setRevealed] = useState(boot.revealed)
  const [typed, setTyped] = useState(0)
  const [{ step, firstName, fullName, cnic, collected, ineligible }, setFlow] = useState(
    () => store.loadState(),
  )
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
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

    if (m.kind && m.kind !== 'text') {
      const t = setTimeout(() => setRevealed((r) => r + 1), MEDIA_MS)
      return () => clearTimeout(t)
    }

    const words = m.content.split(/\s+/).filter(Boolean)
    if (!words.length) {
      setRevealed((r) => r + 1)
      return
    }

    const chunk = Math.max(1, Math.ceil(words.length / MAX_TICKS))
    let shown = 0
    setTyped(0)
    const id = setInterval(() => {
      shown = Math.min(words.length, shown + chunk)
      setTyped(shown)
      if (shown >= words.length) {
        clearInterval(id)
        setTimeout(() => {
          setTyped(0)
          setRevealed((r) => r + 1)
        }, GAP_MS)
      }
    }, WORD_MS)
    return () => clearInterval(id)
  }, [revealed, messages])
  useEffect(
    () => store.saveState({ step, firstName, fullName, cnic, collected, ineligible }),
    [step, firstName, fullName, cnic, collected, ineligible],
  )

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

  const say = useCallback((...lines: Message[]) => {
    setMessages((m) => append(m, lines))
  }, [])

  /** Move to the next step, or finish. Called only once the input was accepted. */
  const advanceFrom = useCallback(
    (i: number, extra: Message[], patch: Partial<store.FlowState> = {}) => {
      const next = STEPS[i + 1]
      setFlow((f) => {
        const merged = { ...f, ...patch, step: i + 1 }
        setMessages((m) =>
          append(m, [
            ...extra,
            ...(next
              ? askMessages(next)
              : merged.ineligible
                ? []
                : finished(merged.firstName, merged.collected['bill.billAddress'])),
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
              // recording attached.
              const kept = pending ? stripEcho(acc, pending) : acc
              if (kept) {
                const next = append(messagesRef.current, [bot(kept)])
                setMessages(next)
                setRevealed(next.length)
              }
              setStreaming(null)
              abort.current = null
              resolve()
            },
            onError: (message) => {
              if (acc) setMessages((m) => [...m, bot(acc)])
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

  const onSend = useCallback(
    async (override?: string) => {
      const text = (override ?? draft).trim()
      if (!text || busy) return
      setDraft('')
      setError(null)

      const withUser: Message[] = [...messages, { role: 'user', content: text }]
      setMessages(withUser)

      // Flow complete — from here the bot is purely a question answerer.
      if (!current) return void (await runFaq(withUser))

      if (current.kind === 'confirm') {
        const answer = readYesNo(text)
        if (answer === 'yes') {
          advanceFrom(step, [bot('Theek hai.')], {})
        } else if (answer === 'no') {
          // A smartphone is not optional for this job. Say so plainly and stop
          // rather than walking them through an application they cannot finish.
          setFlow((f) => ({ ...f, step: STEPS.length, ineligible: true }))
          say(bot(SAY.needSmartphone.text))
        } else {
          await runFaq(withUser, current.ask)
          say(...askMessages(current))
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
        advanceFrom(step, [thanksName(first)], {
          firstName: first,
          fullName: (named.full_name ?? text).trim(),
        })
      } else {
        await runFaq(withUser, current.ask)
        say(...askMessages(current))
      }
    },
    [draft, busy, messages, current, step, runFaq, say, advanceFrom],
  )

  const onFile = useCallback(
    async (file: File) => {
      setError(null)
      if (current?.imageOnly && !file.type.startsWith('image/')) {
        say(bot(current.wrong))
        return
      }
      if (current?.kind === 'text') {
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
            collected: {
              ...collected,
              'gps.latitude': latitude.toFixed(6),
              'gps.longitude': longitude.toFixed(6),
              'gps.accuracyMetres': String(Math.round(pos.coords.accuracy)),
            },
          },
        )
      },
      () => {
        setWorking(false)
        say(bot(SAY.locationDenied.text))
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    )
  }, [current, step, collected, say, advanceFrom])

  const stop = useCallback(() => {
    abort.current?.abort()
    abort.current = null
    setStreaming((acc) => {
      if (acc) setMessages((m) => [...m, bot(acc)])
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
    setMessages(WELCOME)
    setFlow({ step: 0, firstName: '', fullName: '', cnic: '', collected: {}, ineligible: false })
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
        <strong>Foodpanda Delivery Rider Onboarding</strong>
        <button class="ghost" onClick={reset} disabled={busy}>
          Clear
        </button>
      </header>

      <div class="scroll" ref={scroller}>
        {messages.slice(0, revealed).map((m, i) => {
          if (m.kind === 'image')
            return (
              <div key={i} class="msg bot media">
                <Picture src={m.src ?? ''} alt="Foodpanda delivery rider" />
              </div>
            )
          if (m.kind === 'audio')
            return (
              <div key={i} class="msg bot media">
                <VoiceNote sources={m.sources ?? VOICE_SOURCES} />
              </div>
            )
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
            </div>
          ) : (
            <div
              key={i}
              class="msg bot"
              dangerouslySetInnerHTML={{ __html: rendered[i] ?? '' }}
            />
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

      {current?.kind === 'gps' && (
        <div class="gpsbar">
          <button onClick={onGps} disabled={busy}>
            📍 Location bhejein
          </button>
        </div>
      )}

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
        <button
          class="camera"
          aria-label={current?.facing === 'user' ? 'Selfie khenchein' : 'Tasveer khenchein'}
          disabled={busy}
          onClick={() =>
            (current?.facing === 'user' ? selfieCam : camera).current?.click()
          }
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path
              d="M4 8h3l1.4-2h7.2L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linejoin="round"
            />
            <circle cx="12" cy="13.5" r="3.4" fill="none" stroke="currentColor" stroke-width="1.7" />
          </svg>
        </button>

        <button
          class="attach"
          aria-label="Tasveer ya file bhejein"
          disabled={busy}
          onClick={() => picker.current?.click()}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path
              d="M21 11.5 12.5 20a5 5 0 0 1-7-7l8.5-8.5a3.5 3.5 0 0 1 5 5L10.5 18a2 2 0 0 1-3-3l8-8"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>

        <textarea
          value={draft}
          rows={1}
          placeholder="Message…"
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

        {streaming !== null ? (
          <button class="stop" onClick={stop}>
            Stop
          </button>
        ) : (
          <button class="send" onClick={() => void onSend()} disabled={!draft.trim() || busy}>
            Send
          </button>
        )}
      </footer>

      <div class="credit">
        <span>Powered by</span>
        <img src="/rozeegpt.png" alt="RozeeGPT" />
      </div>
    </div>
  )
}
