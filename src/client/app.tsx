import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { render as renderMarkdown } from './markdown.ts'
import * as store from './storage.ts'
import type { Message } from './storage.ts'
import { runTurn, warm } from './stream.ts'
import { Picture, VoiceNote } from './media.tsx'
import { forModel, VOICE_SOURCES, WELCOME } from './welcome.ts'

// Only the tail is sent upstream: prompt length drives time-to-first-token
// linearly, and the round trip to Groq's US origin is already ~175ms.
const HISTORY_WINDOW = 12

export function App() {
  const [messages, setMessages] = useState<Message[]>(() => {
    const saved = store.load()
    return saved.length ? saved : WELCOME
  })
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [gate, setGate] = useState<{ required: boolean; authed: boolean }>({
    required: false,
    authed: true,
  })
  const [password, setPassword] = useState('')

  const abort = useRef<AbortController | null>(null)
  const scroller = useRef<HTMLDivElement | null>(null)
  const busy = streaming !== null

  useEffect(() => {
    fetch('/api/session')
      .then((r) => r.json())
      .then((s: { authRequired: boolean; authed: boolean }) =>
        setGate({ required: s.authRequired, authed: s.authed }),
      )
      .catch(() => {})
  }, [])

  useEffect(() => store.save(messages), [messages])

  // Idle keepalive so the edge connection never goes cold between turns.
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

  // Takes the text from the event target rather than the closed-over draft, so a
  // keystroke and an Enter landing in the same frame can't send a stale value.
  const send = useCallback(
    (override?: string) => {
    const text = (override ?? draft).trim()
    if (!text || busy) return

    const next = [...messages, { role: 'user' as const, content: text }]
    setMessages(next)
    setDraft('')
    setError(null)
    setStreaming('')

    const controller = new AbortController()
    abort.current = controller
    let acc = ''

    void runTurn(
      forModel(next).slice(-HISTORY_WINDOW),
      {
        onDelta: (t) => {
          acc += t
          setStreaming(acc)
        },
        onDone: () => {
          setMessages((m) => [...m, { role: 'assistant', content: acc }])
          setStreaming(null)
          abort.current = null
        },
        onError: (message) => {
          if (acc)
            setMessages((m) => [...m, { role: 'assistant', content: acc }])
          setStreaming(null)
          setError(message)
          abort.current = null
        },
        onUnauthorized: () => {
          setStreaming(null)
          setGate({ required: true, authed: false })
          abort.current = null
        },
      },
      controller.signal,
    )
    },
    [draft, busy, messages],
  )

  const stop = useCallback(() => {
    abort.current?.abort()
    abort.current = null
    setStreaming((acc) => {
      if (acc) setMessages((m) => [...m, { role: 'assistant', content: acc }])
      return null
    })
  }, [])

  const reset = useCallback(() => {
    abort.current?.abort()
    abort.current = null
    setStreaming(null)
    store.clear()
    setMessages(WELCOME)
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
      } else {
        setError('Wrong password')
      }
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
        <button class="ghost" onClick={reset} disabled={!messages.length && !busy}>
          Clear
        </button>
      </header>

      <div class="scroll" ref={scroller}>
        {!messages.length && !busy && (
          <div class="empty">
            <p>Ask anything.</p>
            <small>gpt-oss-120b on Groq · Singapore edge</small>
          </div>
        )}

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
              <span class="think">thinking</span>
            )}
          </div>
        )}

        {error && <div class="err banner">{error}</div>}
      </div>

      <footer>
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
              send((e.target as HTMLTextAreaElement).value)
            }
          }}
        />
        {busy ? (
          <button class="stop" onClick={stop}>
            Stop
          </button>
        ) : (
          <button class="send" onClick={() => send()} disabled={!draft.trim()}>
            Send
          </button>
        )}
      </footer>
    </div>
  )
}
