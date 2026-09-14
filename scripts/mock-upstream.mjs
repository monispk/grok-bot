// Offline stand-in for Groq's streaming API, so you can develop the UI without
// a key and without burning credits.  npm run dev:mock
import http from 'node:http'

const REPLY =
  'This is the mock upstream. It streams tokens the same shape Groq does, so '
  + 'you can exercise the UI, the reconnect path and the markdown renderer '
  + 'without an API key.\n\n```js\nconsole.log("code blocks render too")\n```\n'

/**
 * The reply quotes the question, as a real model's would. Not decoration: the
 * server caches synthesised speech against the words, so a reply that never
 * varies is spoken instantly from the second run onwards — which silently
 * removes the delay the interface is supposed to cope with, and with it any
 * hope of a test noticing.
 */
const replyTo = (body) => {
  const asked = (body?.messages ?? []).filter((m) => m?.role === 'user').at(-1)
  const q = typeof asked?.content === 'string' ? asked.content.trim().slice(0, 120) : ''
  return q ? `Aap ne poocha "${q}". ${REPLY}` : REPLY
}

const PORT = Number(process.env.MOCK_PORT ?? 4010)

http
  .createServer(async (req, res) => {
    // Stands in for Whisper. Returns a fixed transcript so the flow can be run
    // without spending on speech, and MOCK_TRANSCRIPT steers what it "hears".
    if (req.url?.includes('/audio/transcriptions')) {
      for await (const _ of req) void _
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(
        JSON.stringify({ text: process.env.MOCK_TRANSCRIPT ?? 'kitne paise milenge' }),
      )
    }

    // MOCK_STATUS=429 exercises the rate-limited path, which is the failure a
    // real rider on the free tier is most likely to meet.
    if (process.env.MOCK_STATUS && !req.url?.startsWith('/models')) {
      for await (const _ of req) void _
      res.writeHead(Number(process.env.MOCK_STATUS), { 'content-type': 'application/json' })
      return res.end(
        JSON.stringify({
          error: {
            message:
              'Rate limit reached for model `openai/gpt-oss-120b` in organization `org_secret` on tokens per minute (TPM): Limit 8000. Upgrade to Dev Tier at https://console.groq.com/settings/billing',
          },
        }),
      )
    }

    if (req.url?.startsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end('{"data":[]}')
    }
    let raw = ''
    for await (const chunk of req) raw += chunk
    let body = {}
    try { body = JSON.parse(raw) } catch {}

    // Groq rejects the whole request if a message carries anything beyond role
    // and content, and it once rejected a real rider's question that way. Be as
    // strict here, so the offline tests can catch it.
    const bad = (body.messages ?? []).findIndex(
      (m) => Object.keys(m ?? {}).some((k) => k !== 'role' && k !== 'content'),
    )
    if (bad >= 0) {
      const prop = Object.keys(body.messages[bad]).find(
        (k) => k !== 'role' && k !== 'content',
      )
      res.writeHead(400, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({
        error: { message: `'messages.${bad}' : property '${prop}' is unsupported` },
      }))
    }

    // Non-streaming JSON calls. The licence reader asks for a `json_schema`
    // and everything else for a `json_object`; both land here, and a vision
    // call is told apart by its content being an array of parts rather than a
    // string. Gating this on `json_object` alone sent the licence reader's
    // request to the chat branch, which echoed the prompt back at it.
    if (body.response_format?.type === 'json_object' || body.response_format?.type === 'json_schema') {
      const last = body.messages?.at(-1)?.content
      /**
       * A vision call sends content as an array of parts, not a string. This
       * assumed a string and threw on it, which killed the whole mock and took
       * the browser suite down with it in a way that looked like the app.
       */
      if (Array.isArray(last)) {
        /*
         * Not a licence, unless asked for one. A stand-in that says yes to
         * every picture takes the refusal path out of the tests entirely —
         * which it did: a made-up photograph was accepted as a driving
         * licence because this answered for it.
         */
        const yes = process.env.MOCK_VISION === 'licence'
        res.writeHead(200, { 'content-type': 'application/json' })
        // The licence reader's schema, which is the only vision call left.
        return res.end(JSON.stringify({
          choices: [{ message: { content: JSON.stringify(
            yes
              ? {
                  is_driving_license: true,
                  unreadable: false,
                  holder_name: 'MOCK RIDER',
                  license_number: 'SI-24-000000',
                  cnic_number: '3520201427267',
                  expiry_date: '01.01.2030',
                  issue_date: '01.01.2025',
                  is_learner_permit: false,
                }
              : {
                  is_driving_license: false,
                  unreadable: false,
                  holder_name: '',
                  license_number: '',
                  cnic_number: '',
                  expiry_date: '',
                  issue_date: '',
                  is_learner_permit: false,
                },
          ) } }],
          usage: { total_tokens: 1300 },
        }))
      }
      const text = (typeof last === 'string' ? last : '').trim()
      const isName = text.length > 0 && !text.includes('?')
      const parts = text.replace(/^(mera naam|my name is)\s+/i, '').split(/\s+/)
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          is_name: isName,
          full_name: isName ? parts.join(' ') : null,
          first_name: isName ? parts[0] : null,
        }) } }],
      }))
    }
    // Non-streaming completions (the WhatsApp path) get a plain JSON reply.
    if (body.stream !== true) {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(
        JSON.stringify({ choices: [{ message: { content: replyTo(body).trim() } }] }),
      )
    }

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
    })
    for (const word of replyTo(body).split(/(?<= )/)) {
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: word } }] })}\n\n`,
      )
      await new Promise((r) => setTimeout(r, 60))
    }
    res.write('data: [DONE]\n\n')
    res.end()
  })
  .listen(PORT, () => console.log(`mock upstream on :${PORT}`))
