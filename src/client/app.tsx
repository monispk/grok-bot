import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { finished, STEPS, thanksDoc, thanksGps, thanksName } from './flow.ts'
import { render as renderMarkdown } from './markdown.ts'
import { DocumentBubble, Picture, VoiceNote } from './media.tsx'
import * as store from './storage.ts'
import type { Message } from './storage.ts'
import { runTurn, warm } from './stream.ts'
import { forModel, VOICE_SOURCES, WELCOME } from './welcome.ts'

const HISTORY_WINDOW = 12
const ACCEPT = 'image/jpeg,image/png,image/gif,application/pdf,.jpg,.jpeg,.png,.gif,.pdf'

const bot = (content: string): Message => ({ role: 'assistant', content })

export function App() {
  const [messages, setMessages] = useState<Message[]>(() => {
    const saved = store.load()
    return saved.length ? saved : WELCOME
  })
  const [{ step, firstName }, setFlow] = useState(() => store.loadState())
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [gate, setGate] = useState({ required: false, authed: true })
  const [password, setPassword] = useState('')

  const abort = useRef<AbortController | null>(null)
  const scroller = useRef<HTMLDivElement | null>(null)
  const picker = useRef<HTMLInputElement | null>(null)

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

  useEffect(() => store.save(messages), [messages])
  useEffect(() => store.saveState({ step, firstName }), [step, firstName])

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') warm()
    }, 30_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, streaming])

  const say = useCallback((...lines: Message[]) => {
    setMessages((m) => [...m, ...lines])
  }, [])

  /** Move to the next step, or finish. Called only once the input was accepted. */
  const advanceFrom = useCallback(
    (i: number, extra: Message[], name: string) => {
      const next = STEPS[i + 1]
      setMessages((m) => [...m, ...extra, ...(next ? [bot(next.ask)] : finished(name))])
      setFlow({ step: i + 1, firstName: name })
    },
    [],
  )

  /** Answer a question from the FAQ. Resolves when the reply is complete. */
  const runFaq = useCallback(
    (history: Message[]) =>
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
              setMessages((m) => [...m, bot(acc)])
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

      if (current.kind !== 'text') {
        // A document or location was asked for. Text cannot satisfy it, so treat
        // it as a question, answer it, then ask again. The step does not move.
        await runFaq(withUser)
        say(bot(current.wrong))
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
        advanceFrom(step, [thanksName(first)], first)
      } else {
        await runFaq(withUser)
        say(bot(current.ask))
      }
    },
    [draft, busy, messages, current, step, runFaq, say, advanceFrom],
  )

  const onFile = useCallback(
    async (file: File) => {
      setError(null)
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

      setWorking(true)
      try {
        const body = new FormData()
        body.append('file', file)
        const res = await fetch('/api/upload', { method: 'POST', body })
        const data = (await res.json()) as {
          id?: string
          name?: string
          mime?: string
          size?: number
          error?: string
        }
        if (!res.ok || !data.id) {
          setError(data.error ?? 'File bhejne mein masla hua. Dobara koshish karein.')
          return
        }

        // Verification APIs slot in here. Until then every document is accepted,
        // but a document must genuinely have arrived for the step to move.
        advanceFrom(
          step,
          [
            {
              role: 'user',
              content: '',
              kind: 'document',
              src: `/api/upload/${data.id}`,
              doc: {
                name: data.name ?? file.name,
                mime: data.mime ?? file.type,
                size: data.size ?? file.size,
              },
            },
            thanksDoc(),
          ],
          firstName,
        )
      } catch {
        setError('File bhejne mein masla hua. Dobara koshish karein.')
      } finally {
        setWorking(false)
      }
    },
    [current, step, firstName, say, advanceFrom],
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
          firstName,
        )
      },
      () => {
        setWorking(false)
        say(
          bot(
            'Location nahi mil saki. Baraye meherbani apne phone mein location ki ijazat dein, phir dobara button dabayein.',
          ),
        )
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    )
  }, [current, step, firstName, say, advanceFrom])

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
    setFlow({ step: 0, firstName: '' })
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
          <h1>Monis' Grok Test Bot</h1>
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
        <span class="dot" /> <strong>Monis' Grok Test Bot</strong>
        <button class="ghost" onClick={reset} disabled={busy}>
          Clear
        </button>
      </header>

      <div class="scroll" ref={scroller}>
        {messages.map((m, i) => {
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
              <div key={i} class="msg user media">
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
    </div>
  )
}
