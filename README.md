# grok-bot

A deliberately small, low-latency chat UI over **`openai/gpt-oss-120b` on Groq
Cloud**, hosted on Railway. One service, no database, no queue. The browser holds
the conversation; the server is a thin streaming proxy that keeps the API key
secret.

```
Browser (Preact, one 21KB file)
   │  POST /api/chat  { messages, effort }
   ▼
Railway · asia-southeast1-eqsg3a (Singapore)
   ├─ serves the SPA from dist/client
   └─ /api/chat → Groq (streamed, buffered for resume)
   ▼
Groq Cloud · openai/gpt-oss-120b
```

## Why Singapore

Measured from a Karachi connection:

| Destination | RTT |
| --- | --- |
| Railway anycast edge (AS400940) | 99ms |
| Singapore | 98ms |
| `api.groq.com` (Cloudflare, PoP `HKG`) | 125ms |
| Frankfurt | 144ms |
| Virginia | 227ms |

Railway's edge is anycast and already answers Pakistan from Singapore, so TLS
terminates there no matter where the container runs. The region choice governs
the *edge→container* hop, which is paid on every streamed chunk — Virginia would
add ~200ms one-way to each one. A Singapore container also enters Cloudflare at
the same PoP the traffic already uses on its way to Groq, so the proxy hop costs
1–2ms.

A warm request to Groq round-trips in 300–360ms, of which only ~125ms is the
Pakistan leg. **The remaining ~175ms to Groq's US origin is not removable** —
region pinning (their Dammam site is ~40ms from Pakistan) is Enterprise-only.

## Latency measures in the code

- **`undici` keep-alive pool + a 45s warmer** (`src/server/provider.ts`). A cold
  TLS handshake to Groq measured ~275ms; warm measured 0.
- **`reasoning_effort` defaults to `low`.** gpt-oss is a reasoning model — on
  higher effort it burns hundreds of hidden tokens before the first visible one.
  The Fast/Balanced/Deep toggle exposes this.
- **Single-file client.** Everything is inlined into one HTML document, so the
  app costs one round trip instead of one per asset.
- **Connection warming.** `/api/ping` fires on composer focus and on a 30s idle
  timer, so the user never pays the ~207ms edge handshake at send time.
- **Resumable streams.** Turns are buffered server-side and keep consuming
  upstream even with no client attached. A dropped socket reconnects to
  `/api/chat/resume?turn=…&from=N` and continues — verified to produce a
  byte-identical result to an uninterrupted stream. This is why the server
  parses SSE rather than piping it through; the parse costs microseconds against
  a ~175ms network floor.
- **History window.** Only the last 12 messages go upstream; prompt length drives
  time-to-first-token linearly.

Expected time-to-first-token from Pakistan: **~420–550ms**. After that,
gpt-oss-120b's throughput on Groq makes it read as instant.

## Mobile first

The layout is authored phone-first — the single media query at `640px` widens it
for desktop, not the other way round.

- **Installable.** Web app manifest, standalone display, and generated home-screen
  icons, so it launches chromeless from the home screen on Android and iOS.
- **No zoom-on-focus.** The composer is 16px; anything smaller makes iOS Safari
  zoom the page when the input is focused.
- **`100dvh` + `interactive-widget=resizes-content`** so the on-screen keyboard
  shrinks the layout instead of hiding the composer behind it.
- **Safe-area insets** on the header and composer for notches and home bars.
- **44px touch targets**, `overscroll-behavior: contain` to keep pull-to-refresh
  out of the thread, and no tap-highlight flash.

Icons are generated, not committed by hand:

```bash
node scripts/make-icons.mjs
```

## Run locally

No API key needed — there's a mock upstream that streams in Groq's wire format:

```bash
npm install && npm run dev:mock
```

With a real key:

```bash
cp .env.example .env   # add your GROQ_API_KEY
npm install && npm run build && npm start
```

## Deploy

The service is connected to this repo, so **pushing to `main` deploys**:

```bash
git push origin main
```

Set the service variables in Railway's dashboard (or `railway variables --set`):

| Variable | Notes |
| --- | --- |
| `GROQ_API_KEY` | **required** — set it in Railway, never in the repo |
| `MODEL` | defaults to `openai/gpt-oss-120b` |
| `SYSTEM_PROMPT` | editable without a redeploy |
| `ACCESS_PASSWORD` | optional shared-password gate; unset means open to anyone |
| `GROQ_BASE_URL` | provider swap point (xAI: `https://api.x.ai/v1`) |

To deploy the working tree instead of a commit, `railway up --service grok-bot`
(this project needs the explicit `--service`).

### The region field that matters

`railway.json` pins Singapore through **`deploy.multiRegionConfig`**:

```json
"multiRegionConfig": { "asia-southeast1-eqsg3a": { "numReplicas": 1 } }
```

`deploy.region` is *not* in Railway's schema. Setting it is accepted silently,
ignored, and the service defaults to `sfo`. Railway's edge is anycast, so a
misplaced container still answers Pakistan from Singapore on the handshake and
the mistake is invisible in connect timings. Verify the real thing instead —
TTFB on `/healthz` minus `time_appconnect`:

```bash
curl -o /dev/null -s -w 'tls=%{time_appconnect}s ttfb=%{time_starttransfer}s\n' https://grok-bot-production-b3a4.up.railway.app/healthz
```

About one client round trip of difference (~105ms) means Singapore. An extra
~190ms on top means it landed in the US.

## Endpoints

| Route | Purpose |
| --- | --- |
| `POST /api/chat` | start a turn, stream SSE (`meta`, `delta`, `done`, `error`, `hb`) |
| `GET /api/chat/resume?turn&from` | reattach to a turn after a dropped connection |
| `GET /api/ping` | 204, keeps the TLS connection warm |
| `GET /api/session` | whether a password gate is active and satisfied |
| `POST /api/login` | exchange the shared password for a cookie |
| `GET /healthz` | Railway health check |

## Notes

- Client-supplied `system` messages are filtered out; the system prompt is set
  server-side only.
- Model output is HTML-escaped before markdown parsing, and non-`http(s)` link
  targets are neutralised.
- Rate limiting is a per-IP token bucket (burst 8, ~20/min), in-process — it
  resets on redeploy and is per-replica.
