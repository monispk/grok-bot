// Offline stand-in for Uplift's text-to-speech, so the spoken-answer path can be
// exercised without a key and without spending on speech.
//
// It answers slowly on purpose. The real thing takes a Groq call to convert the
// script and then a second or so to read it, and the interface has to hold up
// for that whole time — an instant mock hid a spinner that escaped its bubble
// and span over the text beside it.
import http from 'node:http'
import { readFileSync } from 'node:fs'

const PORT = Number(process.env.MOCK_UPLIFT_PORT ?? 4011)
const DELAY = Number(process.env.MOCK_UPLIFT_DELAY ?? 1200)
const audio = readFileSync('public/ask-cnic-back.m4a')

http
  .createServer(async (req, res) => {
    let raw = ''
    for await (const c of req) raw += c
    const body = (() => {
      try {
        return JSON.parse(raw || '{}')
      } catch {
        return {}
      }
    })()
    console.log(`mock uplift: ${req.url} ${JSON.stringify(body).slice(0, 120)}`)
    await new Promise((r) => setTimeout(r, DELAY))
    res.writeHead(200, { 'content-type': 'audio/mp4' })
    res.end(audio)
  })
  .listen(PORT, () => console.log(`mock uplift on :${PORT} (${DELAY}ms delay)`))
