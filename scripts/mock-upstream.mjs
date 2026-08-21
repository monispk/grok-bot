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
    for await (const _ of req) void _
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
