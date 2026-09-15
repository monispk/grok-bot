/**
 * The recruiter's view: every application, what was checked, and what the
 * backend has actually received.
 *
 * Server-rendered, as its own page. The rider's app ships as a single 160 KB
 * document to a phone on 3G, and an admin screen nobody but staff will open
 * has no business inside it. This is a few kilobytes of HTML, built from the
 * same tables the push works from — so what it shows about delivery is what is
 * true, not a second account of it.
 */
import { forBackend } from './push.ts'

export type Row = {
  id: string
  phone: string | null
  full_name: string | null
  step: number
  completed: boolean
  flow: Record<string, unknown>
  history: unknown[]
  created_at: Date
  updated_at: Date
  pushed_at: Record<string, string>
}

import { MIN_SIMILARITY } from './rozee.ts'

export type Waiting = { application: string; fields: string[]; attempts: number; last_error: string | null }

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )

/**
 * Every document on an application, in the order the rider sent them.
 *
 * Read off the collected fields rather than a list of the three we expect.
 * The list was the three: a CNIC back, a utility bill, a second attempt at a
 * licence — anything the flow learns to ask for — was uploaded, verified,
 * stored, and then shown to nobody.
 */
const DOC_ORDER = ['license', 'cnic_front', 'cnic_back', 'bill', 'selfie']

export function uploaded(c: Record<string, string>): { kind: string; id: string }[] {
  return Object.keys(c)
    .filter((k) => k.endsWith('.uploadId') && c[k])
    .map((k) => ({ kind: k.slice(0, -'.uploadId'.length), id: c[k]! }))
    .sort((a, b) => {
      const i = DOC_ORDER.indexOf(a.kind)
      const j = DOC_ORDER.indexOf(b.kind)
      return (i < 0 ? DOC_ORDER.length : i) - (j < 0 ? DOC_ORDER.length : j)
    })
}

/** One message of a thread, as it was stored by the app. */
type Msg = {
  role?: string
  content?: string
  kind?: string
  src?: string
  sources?: { src: string; type: string }[]
  doc?: { name?: string; mime?: string; size?: number }
  video?: string
  place?: { lat?: number; lng?: number; address?: string }
  at?: number
}

/**
 * One bubble of the conversation, as it happened.
 *
 * This used to render every attachment as the word "[audio]" or "[document]",
 * which told a recruiter that something was sent and nothing about what. A
 * thread is the record of an application: the picture the rider sent is the
 * evidence, and the voice note is the rider's own words — the transcript
 * beneath it is only our reading of them, and the times it is wrong are
 * exactly the times somebody comes looking.
 *
 * Everything here is a URL this same server already serves: /api/upload for
 * what the rider sent, /api/speak and the recorded clips for what we said.
 */
export function bubble(m: Msg): string {
  const side = m.role === 'user' ? 'me' : 'bot'
  const wrap = (inner: string) => (inner ? `<div class="msg ${side}">${inner}</div>` : '')
  const words = (m.content ?? '').trim()

  if (m.kind === 'audio') {
    const srcs = (m.sources ?? []).filter((s) => s?.src && !s.src.startsWith('blob:'))
    // Voice notes whose recording did not outlive the retention window still
    // have their words. A player pointing nowhere would be worse than none.
    if (!srcs.length)
      return wrap(words ? `<div class="said">${esc(words)}</div>` : '')
    const tags = srcs
      .map((x) => `<source src="${esc(x.src)}" type="${esc(x.type)}">`)
      .join('')
    return wrap(
      `<audio controls preload="none" class="player">${tags}</audio>` +
        (words ? `<div class="said">${esc(words)}</div>` : ''),
    )
  }

  if ((m.kind === 'document' || m.kind === 'image' || m.kind === 'choice') && m.src) {
    const pdf = m.doc?.mime === 'application/pdf'
    const caption = m.doc?.name
      ? `<div class="said">${esc(m.doc.name)}${m.doc.size ? ` · ${Math.round(m.doc.size / 1024)} KB` : ''}</div>`
      : words
        ? `<div class="said">${esc(words)}</div>`
        : ''
    const shown = pdf
      ? `<div class="said">PDF — open</div>`
      : `<img src="${esc(m.src)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'said',textContent:'no longer held'}))">`
    return wrap(
      `<a href="${esc(m.src)}" target="_blank" rel="noopener">${shown}</a>${caption}`,
    )
  }

  if (m.kind === 'location' && m.place) {
    const at = `${m.place.lat},${m.place.lng}`
    return wrap(
      `<a href="https://www.google.com/maps/search/?api=1&amp;query=${esc(at)}" target="_blank" rel="noopener">` +
        (m.src ? `<img src="${esc(m.src)}" alt="" loading="lazy" onerror="this.remove()">` : '') +
        `</a><div class="said">${esc(m.place.address ?? words)}</div>`,
    )
  }

  if (m.kind === 'video' && m.video)
    return wrap(
      `<a href="https://www.youtube.com/watch?v=${esc(m.video)}" target="_blank" rel="noopener">training video</a>`,
    )

  return wrap(words ? esc(words) : '')
}

/**
 * The bank account against the card, in the four states it can be in.
 *
 * The question is whether the account the rider will be paid into is in the
 * same name as their CNIC, and there are four honest answers — not two. A
 * fetch that failed and a name that did not match look identical if both are
 * reported as "no", and only one of them is about the rider.
 */
export type BankCheck = 'match' | 'mismatch' | 'fetch failed' | 'cnic not read' | 'not run'

export function bankCheck(recorded: string | undefined): { state: BankCheck; detail: string } {
  if (!recorded) return { state: 'not run', detail: '' }
  // The card was never read, so whatever this matched, it was not the CNIC.
  if (recorded.includes('CNIC not read'))
    return { state: 'cnic not read', detail: recorded.replace(/ — CNIC not read.*/, '') }
  if (recorded.startsWith('match')) return { state: 'match', detail: recorded.slice(8) }
  if (recorded.includes('no account found')) return { state: 'fetch failed', detail: 'no account found' }
  if (recorded.includes('bank not on the list'))
    return { state: 'fetch failed', detail: 'the bank is not one we can look up' }
  if (recorded.startsWith('not checked')) return { state: 'fetch failed', detail: 'the service did not answer' }
  if (recorded.startsWith('no match')) return { state: 'mismatch', detail: recorded.slice(11) }
  return { state: 'not run', detail: recorded }
}

const BANK_SAYS: Record<BankCheck, string> = {
  match: 'matched the CNIC',
  mismatch: 'does NOT match the CNIC',
  'fetch failed': 'could not be looked up',
  'cnic not read': 'CNIC was not read — not compared with the card',
  'not run': 'not run',
}

/** The same verdict as one line, for the panel. */
export function bankTitle(recorded: string | undefined): string {
  const { state, detail } = bankCheck(recorded)
  return detail ? `${BANK_SAYS[state]} — ${detail}` : BANK_SAYS[state]
}

/**
 * The face check, said in full.
 *
 * It is the criterion a rider is actually verified by — the selfie against the
 * photograph on their CNIC — and the number behind it decides the answer, so
 * the number is shown, along with the bar it had to clear. The bar comes from
 * the one place that sets it rather than being written out again here.
 */
export function faceMatch(recorded: string | undefined): string {
  if (!recorded) return 'not run'
  const score = /\(([\d.]+)\)/.exec(recorded)?.[1]
  if (!score) return recorded
  return Number(score) >= MIN_SIMILARITY
    ? `matched — ${score} of 100`
    : `no match — ${score} of 100, below ${MIN_SIMILARITY}`
}

/** Pakistan time, because that is where everyone reading this is. */
const PKT = { timeZone: 'Asia/Karachi', hour12: false } as const

const when = (d: Date | string | null | undefined) => {
  if (!d) return '—'
  const t = new Date(d)
  return Number.isNaN(t.getTime())
    ? '—'
    : t.toLocaleString('en-GB', {
        ...PKT, day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
}

/** The same moment, short enough to sit on one line in a table cell. */
const stamp = (d: Date | string) => {
  const t = new Date(d)
  const day = t.toLocaleDateString('en-GB', { ...PKT, day: '2-digit', month: 'short' })
  const time = t.toLocaleTimeString('en-GB', { ...PKT, hour: '2-digit', minute: '2-digit' })
  return `<span class="nowrap">${esc(day)}</span> <span class="nowrap dim-t">${esc(time)}</span>`
}

const ago = (d: Date | string) => {
  const ms = Date.now() - new Date(d).getTime()
  const m = Math.round(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

/** How much of an application the backend has, and how much it is still owed. */
export function syncOf(row: Row, waiting: Waiting[]) {
  const all = Object.keys(forBackend(row.id, row.flow, row.history ?? []))
  const delivered = all.filter((f) => f in (row.pushed_at ?? {}))
  const queued = new Set(waiting.filter((w) => w.application === row.id).flatMap((w) => w.fields))
  const pending = all.filter((f) => !delivered.includes(f) && queued.has(f))
  const never = all.filter((f) => !delivered.includes(f) && !queued.has(f))
  const times = delivered.map((f) => row.pushed_at[f]!).sort()
  return {
    total: all.length,
    delivered,
    pending,
    never,
    lastAt: times.length ? times[times.length - 1]! : null,
    errors: waiting.filter((w) => w.application === row.id && w.last_error),
  }
}

const bar = (s: ReturnType<typeof syncOf>) => {
  const pc = (n: number) => (s.total ? Math.round((n / s.total) * 100) : 0)
  const title = `${s.delivered.length} delivered, ${s.pending.length} queued, ${s.never.length} not queued`
  return `<span class="barwrap" title="${title}">
    <span class="bar"><i class="ok" style="width:${pc(s.delivered.length)}%"></i><i class="wait" style="width:${pc(s.pending.length)}%"></i></span>
    <small>${s.delivered.length}/${s.total}</small></span>`
}

const STYLE = `
:root{--ground:#f6f7f7;--paper:#fff;--ink:#15191a;--dim:#5b6566;--faint:#8a9394;--rule:#e2e7e7;
--line:#eef2f2;--accent:#0e6b6b;--accent-soft:#e6f1f0;--bad:#a6341c;--bad-soft:#fae9e4;
--good:#237a49;--good-soft:#e4f1e9;--warn:#8a5a00;--warn-soft:#f8efd9;--code:#f2f5f5}
@media(prefers-color-scheme:dark){:root{--ground:#0e1212;--paper:#161b1b;--ink:#e8ecec;--dim:#9aa5a5;
--faint:#6f7a7a;--rule:#2a3232;--line:#212828;--accent:#5cc4bd;--accent-soft:#16302e;--bad:#e58e77;
--bad-soft:#2e1d19;--good:#8ac6a2;--good-soft:#17271f;--warn:#e0b25a;--warn-soft:#2a2316;--code:#111717}}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);
font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
-webkit-font-smoothing:antialiased;padding:26px 22px 70px}
.wrap{max-width:1320px;margin:0 auto;display:flex;flex-direction:column;gap:18px}
h1{font-size:22px;margin:0;font-weight:650;letter-spacing:-.012em}
h2{font-size:13px;margin:0 0 2px;font-weight:650;letter-spacing:.04em;text-transform:uppercase;color:var(--dim)}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
.top{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.top .muted{color:var(--faint);font-size:12.5px}
.nowrap{white-space:nowrap}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;letter-spacing:-.01em}
.sub{font-size:11.5px;color:var(--faint);margin-top:1px;white-space:nowrap}
.dim-t{color:var(--faint)}
.of{color:var(--faint)}

/* ---- summary ---- */
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:1px;
background:var(--rule);border:1px solid var(--rule);border-radius:9px;overflow:hidden}
.card{background:var(--paper);padding:11px 14px}
.card b{display:block;font-size:22px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.2}
.card span{font-size:11.5px;color:var(--dim)}

/* ---- table ---- */
.tablewrap{overflow-x:auto;border:1px solid var(--rule);border-radius:9px;background:var(--paper)}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:var(--faint);
font-weight:600;padding:9px 12px;border-bottom:1px solid var(--rule);white-space:nowrap;background:var(--paper)}
td{padding:8px 12px;border-bottom:1px solid var(--line);vertical-align:middle}
tbody tr:last-child td{border-bottom:0}
tbody tr{cursor:pointer}
tbody tr:hover td{background:var(--accent-soft)}
.mid-cell{text-align:center}

/* A verdict as a mark: written out, the wallet check alone was wider than its
   column and wrapped every row to three lines. */
.mark{display:inline-grid;place-items:center;width:21px;height:21px;border-radius:50%;
font-size:12px;font-weight:700;cursor:help}
.mark.good{background:var(--good-soft);color:var(--good)}
.mark.bad{background:var(--bad-soft);color:var(--bad)}
.mark.mid{background:var(--warn-soft);color:var(--warn)}
.mark.none{background:var(--line);color:var(--faint);font-weight:400}

.pill{display:inline-block;font-size:10px;letter-spacing:.05em;text-transform:uppercase;
padding:2px 7px;border-radius:20px;white-space:nowrap;font-weight:600}
.ok{background:var(--good-soft);color:var(--good)}
.no{background:var(--bad-soft);color:var(--bad)}
.mid{background:var(--warn-soft);color:var(--warn)}
.dim{background:var(--line);color:var(--dim)}

.shots{display:inline-flex;gap:3px}
.thumb{width:30px;height:30px;object-fit:cover;border-radius:4px;border:1px solid var(--rule);
background:var(--ground);display:block}

.bar{display:inline-flex;width:64px;height:6px;border-radius:3px;overflow:hidden;
background:var(--line);vertical-align:middle;border:1px solid var(--rule)}
.bar i{display:block;height:100%}
.bar .ok{background:#2d9c5f;border-radius:0}
.bar .wait{background:#d9a53b;border-radius:0}
.bar .none{background:transparent}
.barwrap{display:flex;align-items:center;gap:6px;white-space:nowrap}
.barwrap small{color:var(--dim);font-size:11.5px;font-variant-numeric:tabular-nums}

/* ---- detail ---- */
.panel{background:var(--paper);border:1px solid var(--rule);border-radius:10px;
padding:15px 17px;display:flex;flex-direction:column;gap:9px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(275px,1fr));gap:14px;align-items:start}
.kv{display:grid;grid-template-columns:auto 1fr;gap:16px;align-items:baseline;
padding:5px 0;border-bottom:1px solid var(--line);font-size:13px}
.kv:last-child{border-bottom:0}
.kv span{color:var(--dim);white-space:nowrap}
.kv b{font-weight:600;text-align:right;overflow-wrap:anywhere}
.docs{display:flex;gap:14px;flex-wrap:wrap}
.docs figure{margin:0;width:190px}
.docs img{width:100%;border-radius:7px;border:1px solid var(--rule);background:var(--ground);display:block}
.docs figcaption{font-size:11.5px;color:var(--dim);margin-top:5px;text-transform:capitalize}
.chat{background:var(--ground);border:1px solid var(--rule);border-radius:9px;padding:11px;
display:flex;flex-direction:column;gap:4px;max-height:420px;overflow:auto;margin-top:9px}
.msg{max-width:76%;padding:5px 9px;border-radius:8px;font-size:12.5px;line-height:1.45}
.msg.bot{background:var(--paper);border:1px solid var(--rule);align-self:flex-start}
.msg.me{background:var(--good-soft);align-self:flex-end}
.msg img{display:block;max-width:190px;border-radius:6px;border:1px solid var(--rule);
background:var(--ground)}
.msg a{color:inherit;text-decoration:none}
.msg .player{display:block;width:230px;height:32px;margin:1px 0}
.msg .said{font-size:11.5px;color:var(--dim);margin-top:4px;line-height:1.4}
.fieldlist{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.fieldlist code{font-family:ui-monospace,Menlo,monospace;font-size:11px;padding:2px 6px;
border-radius:4px;background:var(--code);color:var(--dim)}
details summary{cursor:pointer;color:var(--accent);font-size:13px}
`

export function listPage(rows: Row[], waiting: Waiting[], pushOn: boolean): string {
  const done = rows.filter((r) => r.completed).length
  const paid = rows.filter((r) => (r.flow['payment'] as { state?: string } | null)?.state === 'paid').length
  const owed = waiting.reduce((n, w) => n + w.fields.length, 0)

  const body = rows
    .map((r) => {
      const f = r.flow ?? {}
      const c = (f['collected'] ?? {}) as Record<string, string>
      const pay = (f['payment'] ?? null) as { state?: string; amountPaisa?: number } | null
      const quiz = (f['quiz'] ?? null) as { declined?: boolean; answers?: unknown[] } | null
      const s = syncOf(r, waiting)

      /**
       * A verdict as a mark, with the words on hover.
       *
       * Written out, "match — MONIS UR RAHMAN (jazzcash)" was wider than the
       * column and every row wrapped to three lines. The mark is what a
       * recruiter scans for; the detail is one click or one hover away.
       */
      const mark = (v?: string) => {
        if (!v) return '<span class="mark none" title="not run">–</span>'
        const good = /^match|^pass|^✓/i.test(v)
        const bad = /mismatch|no match|fail|not a /i.test(v)
        const cls = good ? 'good' : bad ? 'bad' : 'mid'
        const glyph = good ? '✓' : bad ? '✗' : '?'
        return `<span class="mark ${cls}" title="${esc(v)}">${glyph}</span>`
      }

      const shots = uploaded(c)
        .map(
          ({ kind, id }) =>
            `<img class="thumb" src="/api/upload/${esc(id)}" alt="${esc(kind)}" title="${esc(kind.replace(/_/g, ' '))}" loading="lazy" onerror="this.remove()">`,
        )
        .join('')

      return `<tr onclick="location.href='/admin?id=${esc(r.id)}'">
        <td class="nowrap">${stamp(r.created_at)}<div class="sub">${esc(ago(r.updated_at))}</div></td>
        <td class="nowrap"><a href="/admin?id=${esc(r.id)}">${esc(r.full_name || '—')}</a><div class="sub mono">${esc(r.phone || '—')}</div></td>
        <td class="nowrap mono">${esc(f['cnic'] || '—')}</td>
        <td class="nowrap">${r.step}<span class="of">/9</span>${r.completed ? ' <span class="pill ok">done</span>' : ''}</td>
        <td class="mid-cell">${mark(c['checks.faceMatch'])}</td>
        <td class="mid-cell">${(() => {
          const { state } = bankCheck(c['checks.wallet'])
          const cls = state === 'match' ? 'good' : state === 'mismatch' ? 'bad' : state === 'not run' ? 'none' : 'mid'
          const glyph = state === 'match' ? '✓' : state === 'mismatch' ? '✗' : state === 'not run' ? '–' : '?'
          return `<span class="mark ${cls}" title="${esc(bankTitle(c['checks.wallet']))}">${glyph}</span>`
        })()}</td>
        <td class="mid-cell">${
          // An expired card fails the column outright, whatever the name said:
          // it is the one licence fact that decides whether the rider pays.
          c['license.expired'] === 'true'
            ? `<span class="mark bad" title="licence expired ${esc(c['license.expiry'] ?? '')}">✗</span>`
            : mark(c['checks.licenceVsCnic'])
        }</td>
        <td class="nowrap"><span class="shots">${shots || '<span class="sub">none</span>'}</span></td>
        <td class="nowrap">${
          pay
            ? `<span class="pill ${pay.state === 'paid' ? 'ok' : pay.state === 'failed' ? 'no' : 'mid'}">${esc(pay.state)}</span><div class="sub">Rs ${((pay.amountPaisa ?? 0) / 100).toLocaleString('en-US')}</div>`
            : '<span class="sub">—</span>'
        }</td>
        <td class="nowrap">${quiz?.declined ? '<span class="pill dim">declined</span>' : quiz ? `${(quiz.answers ?? []).length}<span class="of">/10</span>` : '<span class="sub">—</span>'}</td>
        <td class="nowrap">${bar(s)}<div class="sub">${s.lastAt ? esc(when(s.lastAt)) : pushOn ? 'not sent' : 'no endpoint'}</div></td>
      </tr>`
    })
    .join('')

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rider applications</title><style>${STYLE}</style></head><body><div class="wrap">
<div class="top"><h1>Rider applications</h1>
<span class="muted">${rows.length} shown · times are Pakistan Standard Time</span></div>
<div class="cards">
  <div class="card"><b>${rows.length}</b><span>applications</span></div>
  <div class="card"><b>${done}</b><span>completed</span></div>
  <div class="card"><b>${paid}</b><span>fee paid</span></div>
  <div class="card"><b>${owed}</b><span>fields waiting to send</span></div>
  <div class="card"><b>${pushOn ? 'on' : 'off'}</b><span>backend push</span></div>
</div>
<div class="tablewrap"><table>
<thead><tr><th>Started</th><th>Rider</th><th>CNIC</th><th>Step</th><th>Face Match</th><th>Bank / CNIC</th><th>Licence</th>
<th>Docs</th><th>Fee</th><th>Quiz</th><th>Synced</th></tr></thead>
<tbody>${body || '<tr><td colspan="11"><small>No applications yet.</small></td></tr>'}</tbody>
</table></div>
</div></body></html>`
}

export function detailPage(
  r: Row,
  waiting: Waiting[],
  pushOn: boolean,
  quiz: { id: string; stem: string; options: { key: string; text: string }[] }[],
): string {
  const f = r.flow ?? {}
  const c = (f['collected'] ?? {}) as Record<string, string>
  const s = syncOf(r, waiting)
  const pay = (f['payment'] ?? null) as Record<string, unknown> | null
  const q = (f['quiz'] ?? null) as { declined?: boolean; done?: boolean; answers?: { id: string; chose: string }[] } | null

  const kv = (label: string, value: unknown) =>
    `<div class="kv"><span>${esc(label)}</span><b>${esc(value ?? '—') || '—'}</b></div>`

  const docs = uploaded(c)
    .map(
      ({ kind, id }) => `<figure><a href="/api/upload/${esc(id)}" target="_blank" rel="noopener">
        <img src="/api/upload/${esc(id)}" alt="${esc(kind)}" loading="lazy"
        onerror="this.closest('figure').innerHTML='<small>no longer held</small>'"></a>
        <figcaption>${esc(kind.replace(/_/g, ' '))}</figcaption></figure>`,
    )
    .join('')

  const answers = (q?.answers ?? [])
    .map((a) => {
      const question = quiz.find((x) => x.id === a.id)
      const chosen = question?.options.find((o) => o.key === a.chose)
      return `<div class="kv"><span>${esc(question?.stem ?? a.id)}</span><b>${esc(a.chose.toUpperCase())}) ${esc(chosen?.text ?? '')}</b></div>`
    })
    .join('')

  const transcript = (r.history ?? []).map((m) => bubble(m as Msg)).filter(Boolean).join('')

  const fields = (names: string[], cls: string) =>
    names.length
      ? `<div class="fieldlist">${names.map((n) => `<code class="${cls}">${esc(n)}</code>`).join('')}</div>`
      : '<small>none</small>'

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(r.full_name || 'Application')}</title><style>${STYLE}</style></head><body><div class="wrap">
<div class="top"><h1>${esc(r.full_name || 'Application')}</h1>
<span class="muted"><a href="/admin">← all applications</a></span></div>

<div class="grid">
  <div class="panel"><h2>Application</h2>
    ${kv('Started', when(r.created_at))}
    ${kv('Last activity', `${when(r.updated_at)} (${ago(r.updated_at)})`)}
    ${kv('Step', `${r.step} of 9${r.completed ? ' — closed' : ''}`)}
    ${kv('Phone', r.phone)}
    ${kv('CNIC', f['cnic'])}
    ${kv('Wallet', f['rail'])}
    ${kv('Office', f['branch'])}
    ${kv('Missing', ((f['missing'] ?? []) as string[]).join(', '))}
    ${kv('Id', r.id)}
  </div>

  <div class="panel"><h2>Verification</h2>
    ${kv('Face Match', faceMatch(c['checks.faceMatch']))}
    ${kv('Licence name vs CNIC', c['checks.licenceVsCnic'])}
    ${kv('Bank / CNIC Name Match', bankTitle(c['checks.wallet']))}
    ${c['bank.name'] ? kv('Account checked', `${c['bank.name']} ${c['bank.account'] ?? ''}`) : ''}
    ${kv('Licence number', c['license.number'])}
    ${kv(
      'Licence expiry',
      c['license.expiry']
        ? `${c['license.expiry']}${c['license.expired'] === 'true' ? ' — EXPIRED' : ''}`
        : 'not read',
    )}
    ${kv('Name on CNIC', c['cnic_front.name'])}
    ${kv('Read by', c['license.readBy'] ?? 'local OCR')}
  </div>

  <div class="panel"><h2>Backend sync</h2>
    ${kv('Endpoint', pushOn ? 'configured' : 'not configured')}
    ${kv('Delivered', `${s.delivered.length} of ${s.total} fields`)}
    ${kv('Last delivery', s.lastAt ? when(s.lastAt) : '—')}
    <div><small>Waiting to send</small>${fields(s.pending, 'wait')}</div>
    <div><small>Never queued</small>${fields(s.never, 'none')}</div>
    ${s.errors.map((e) => kv('Last error', `${e.attempts} attempts — ${e.last_error}`)).join('')}
  </div>

  <div class="panel"><h2>Fee</h2>
    ${pay
      ? kv('Status', pay['state']) + kv('Rail', pay['rail']) +
        kv('Amount', `Rs ${(((pay['amountPaisa'] as number) ?? 0) / 100).toLocaleString('en-US')}`) +
        kv('Reference', pay['ref']) + kv('Rail said', pay['detail'])
      : '<small>No payment was attempted.</small>'}
  </div>
</div>

<div class="panel"><h2>Documents</h2>
  <div class="docs">${docs || '<small>None uploaded.</small>'}</div>
  <small>Identity papers, so they are kept for sixty days and then deleted. Click one to see it full size.</small>
</div>

<div class="panel"><h2>Training quiz</h2>
  ${q?.declined ? '<small>Declined — the questions will be asked at the office.</small>' : answers || '<small>Not answered.</small>'}
</div>

<div class="panel"><h2>Conversation</h2>
  <details><summary>Show the whole thread (${(r.history ?? []).length} messages)</summary>
    <div class="chat">${transcript}</div>
    <small>Both sides can be played back. Recordings and documents are kept
    for sixty days and then deleted; after that a thread keeps its words and
    loses its pictures and players.</small>
  </details>
</div>
</div></body></html>`
}

/**
 * The way in.
 *
 * The API answers an unauthenticated request with JSON, which is right for the
 * app and useless for a page — a recruiter opening this saw the word
 * "Unauthorized" and nothing else. ACCESS_PASSWORD is what it wants; since the
 * chat was opened up, this is the only place it is asked for.
 */
export function loginPage(wrong = false): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in</title><style>${STYLE}
.signin{max-width:340px;margin:14vh auto;display:flex;flex-direction:column;gap:12px}
.signin input,.signin button{font:inherit;font-size:16px;min-height:46px;padding:0 14px;border-radius:10px;border:1px solid var(--rule)}
.signin input{background:var(--paper);color:var(--ink)}
.signin button{border:0;background:var(--accent);color:#fff;font-weight:600;cursor:pointer}
.signin .err{color:var(--bad);font-size:13.5px}
</style></head><body>
<form class="signin" onsubmit="go(event)">
  <h1>Rider applications</h1>
  <p><small>Staff only.</small></p>
  <input id="p" type="password" placeholder="Password" autofocus autocomplete="current-password">
  <button type="submit">Sign in</button>
  ${wrong ? '<p class="err">That password was not accepted.</p>' : ''}
  <p class="err" id="e" hidden>That password was not accepted.</p>
</form>
<script>
async function go(ev){
  ev.preventDefault()
  const res = await fetch('/api/login', {
    method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ password: document.getElementById('p').value }),
  })
  if (res.ok) location.reload()
  else document.getElementById('e').hidden = false
}
</script>
</body></html>`
}
