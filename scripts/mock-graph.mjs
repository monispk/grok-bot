/**
 * Stands in for Meta's Graph API so the WhatsApp flow can be run end to end
 * without credentials. Records what the bot sends and serves media back.
 *   node scripts/mock-graph.mjs
 */
import http from 'node:http'
import { readFile } from 'node:fs/promises'

const PORT = Number(process.env.MOCK_GRAPH_PORT ?? 4020)
const sent = []
const media = new Map() // id -> { path, mime }

for (const [id, path, mime] of (process.env.MOCK_MEDIA ?? '').split(';').filter(Boolean).map(s => s.split(','))) {
  media.set(id, { path, mime })
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    const parts = url.pathname.split('/').filter(Boolean)

    if (req.method === 'POST' && parts.at(-1) === 'messages') {
      let raw = ''
      for await (const c of req) raw += c
      const body = JSON.parse(raw)
      if (body.status !== 'read') sent.push(body)
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ messages: [{ id: `wamid.${sent.length}` }] }))
    }

    if (req.method === 'GET' && url.pathname === '/__sent') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify(sent))
    }
    if (req.method === 'DELETE' && url.pathname === '/__sent') {
      sent.length = 0
      res.writeHead(204); return res.end()
    }

    // Media bytes
    if (req.method === 'GET' && parts[0] === 'blob' && media.has(parts[1])) {
      const { path, mime } = media.get(parts[1])
      const buf = await readFile(path)
      res.writeHead(200, { 'content-type': mime })
      return res.end(buf)
    }

    // Media metadata: /vXX.0/<mediaId>
    const id = parts.at(-1)
    if (req.method === 'GET' && media.has(id) && parts.length === 2) {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ url: `http://localhost:${PORT}/blob/${id}`, mime_type: media.get(id).mime }))
    }

    res.writeHead(404); res.end('{}')
  })
  .listen(PORT, () => console.log(`mock graph on :${PORT}`))
