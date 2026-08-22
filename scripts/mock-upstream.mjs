// Offline stand-in for Groq's streaming API, so you can develop the UI without
// a key and without burning credits.  npm run dev:mock
import http from 'node:http'

const REPLY =
  'This is the mock upstream. It streams tokens the same shape Groq does, so '
  + 'you can exercise the UI, the reconnect path and the markdown renderer '
  + 'without an API key.\n\n```js\nconsole.log("code blocks render too")\n```\n'

const PORT = Number(process.env.MOCK_PORT ?? 4010)

http
  .createServer(async (req, res) => {
    if (req.url?.startsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end('{"data":[]}')
    }
    let raw = ''
    for await (const chunk of req) raw += chunk
    let body = {}
    try { body = JSON.parse(raw) } catch {}

    // Non-streaming JSON calls (name extraction). Treat anything that is not a
    // question as a name, which is enough to exercise the flow offline.
    if (body.response_format?.type === 'json_object') {
      const text = (body.messages?.at(-1)?.content ?? '').trim()
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
      return res.end(JSON.stringify({ choices: [{ message: { content: REPLY.trim() } }] }))
    }

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
    })
    for (const word of REPLY.split(/(?<= )/)) {
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: word } }] })}\n\n`,
      )
      await new Promise((r) => setTimeout(r, 60))
    }
    res.write('data: [DONE]\n\n')
    res.end()
  })
  .listen(PORT, () => console.log(`mock upstream on :${PORT}`))
