// Offline stand-in for Uplift's text-to-speech, so the spoken-answer path can be
// exercised without a key and without spending on speech.
//
// It answers slowly on purpose, and the delay is chosen to match reality: a Groq
// call to convert the script plus a second or so for Uplift to read it, about
// two and a half seconds all told. That is longer than the thread takes to
// reveal the next question, which is the whole reason the answer and the
// question can end up being played in the wrong order. A quicker mock hides
// both that and the spinner that once escaped its bubble.
import http from 'node:http'
import { readFileSync } from 'node:fs'

const PORT = Number(process.env.MOCK_UPLIFT_PORT ?? 4011)
const DELAY = Number(process.env.MOCK_UPLIFT_DELAY ?? 2500)
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
