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

export type Waiting = { application: string; fields: string[]; attempts: number; last_error: string | null }

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )

/** Pakistan time, because that is where everyone reading this is. */
const when = (d: Date | string | null | undefined) => {
  if (!d) return '—'
  const t = new Date(d)
  return Number.isNaN(t.getTime())
    ? '—'
    : t.toLocaleString('en-GB', {
        timeZone: 'Asia/Karachi',
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false,
      })
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
  const all = Object.keys(forBackend(row.flow))
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
  return `<span class="bar" title="${s.delivered.length} delivered, ${s.pending.length} queued, ${s.never.length} not queued">
    <i class="ok" style="width:${pc(s.delivered.length)}%"></i><i class="wait" style="width:${pc(s.pending.length)}%"></i><i class="none" style="width:${pc(s.never.length)}%"></i>
  </span> <small>${s.delivered.length}/${s.total}</small>`
}

const STYLE = `
:root{--ground:#f6f7f7;--paper:#fff;--ink:#15191a;--dim:#5b6566;--faint:#8a9394;--rule:#dde2e2;
--accent:#0e6b6b;--accent-soft:#e3efee;--bad:#a6341c;--bad-soft:#f7e6e1;--good:#2d6b47;--good-soft:#e5efe8;
--warn:#8a5a00;--warn-soft:#f6ecd6;--code:#f2f5f5}
@media(prefers-color-scheme:dark){:root{--ground:#101414;--paper:#171c1c;--ink:#e8ecec;--dim:#9aa5a5;
--faint:#6f7a7a;--rule:#2a3232;--accent:#5cc4bd;--accent-soft:#173030;--bad:#e58e77;--bad-soft:#2e1d19;
--good:#8ac6a2;--good-soft:#1a2822;--warn:#e0b25a;--warn-soft:#2d2416;--code:#111717}}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:28px 20px 80px}
.wrap{max-width:1180px;margin:0 auto;display:flex;flex-direction:column;gap:22px}
h1{font-size:26px;margin:0;letter-spacing:-.01em}
h2{font-size:17px;margin:0}
a{color:var(--accent)}
.top{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;border-bottom:1px solid var(--rule);padding-bottom:14px}
.top .muted{color:var(--dim);font-size:13.5px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1px;background:var(--rule);border:1px solid var(--rule);border-radius:10px;overflow:hidden}
.card{background:var(--paper);padding:13px 15px}
.card b{display:block;font-size:25px;font-variant-numeric:tabular-nums;line-height:1.15}
.card span{font-size:12.5px;color:var(--dim)}
.tablewrap{overflow-x:auto;border:1px solid var(--rule);border-radius:10px;background:var(--paper)}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th{text-align:left;font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--faint);font-weight:600;padding:10px 11px;border-bottom:1px solid var(--rule);white-space:nowrap}
td{padding:9px 11px;border-bottom:1px solid var(--rule);vertical-align:top}
tr:last-child td{border-bottom:0}
tr:hover td{background:var(--accent-soft)}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
.pill{display:inline-block;font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;padding:2px 7px;border-radius:20px;white-space:nowrap}
.ok{background:var(--good-soft);color:var(--good)}
.no{background:var(--bad-soft);color:var(--bad)}
.mid{background:var(--warn-soft);color:var(--warn)}
.dim{background:var(--rule);color:var(--dim)}
.bar{display:inline-flex;width:76px;height:7px;border-radius:4px;overflow:hidden;background:var(--rule);vertical-align:middle}
.bar i{display:block;height:100%}
.bar .ok{background:#2d9c5f}.bar .wait{background:#d9a53b}.bar .none{background:transparent}
small{color:var(--dim);font-size:12px}
.panel{background:var(--paper);border:1px solid var(--rule);border-radius:12px;padding:18px 20px;display:flex;flex-direction:column;gap:14px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px}
.kv{display:flex;justify-content:space-between;gap:14px;padding:6px 0;border-bottom:1px solid var(--rule);font-size:13.5px}
.kv:last-child{border-bottom:0}
.kv span{color:var(--dim)}
.kv b{font-weight:600;text-align:right;word-break:break-word}
.docs{display:flex;gap:12px;flex-wrap:wrap}
.docs figure{margin:0;width:150px}
.docs img{width:100%;border-radius:8px;border:1px solid var(--rule);background:var(--ground)}
.docs figcaption{font-size:12px;color:var(--dim);margin-top:4px}
.chat{background:var(--ground);border:1px solid var(--rule);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:5px;max-height:440px;overflow:auto}
.msg{max-width:78%;padding:6px 10px;border-radius:9px;font-size:13px;line-height:1.45}
.msg.bot{background:var(--paper);border:1px solid var(--rule);align-self:flex-start}
.msg.me{background:var(--good-soft);align-self:flex-end}
.fieldlist{display:flex;flex-wrap:wrap;gap:5px}
.fieldlist code{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;padding:2px 6px;border-radius:5px;background:var(--code)}
details summary{cursor:pointer;color:var(--accent);font-weight:500}
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
      const verdict = (v?: string) =>
        !v ? '<span class="pill dim">—</span>'
          : /^match/.test(v) ? `<span class="pill ok">${esc(v.slice(0, 22))}</span>`
          : /mismatch|no match|fail/i.test(v) ? `<span class="pill no">${esc(v.slice(0, 22))}</span>`
          : `<span class="pill mid">${esc(v.slice(0, 22))}</span>`
      return `<tr>
        <td class="mono">${esc(when(r.created_at))}<br><small>${esc(ago(r.updated_at))}</small></td>
        <td><a href="/admin?id=${esc(r.id)}">${esc(r.full_name || '—')}</a><br><small class="mono">${esc(r.phone || '—')}</small></td>
        <td class="mono">${esc(f['cnic'] || '—')}</td>
        <td>${r.step} of 9 ${r.completed ? '<span class="pill ok">done</span>' : ''}</td>
        <td>${verdict(c['checks.faceMatch'])}</td>
        <td>${verdict(c['checks.licenceVsCnic'])}</td>
        <td>${verdict(c['checks.wallet'])}</td>
        <td>${['license', 'cnic_front', 'selfie'].filter((k) => c[`${k}.uploadId`]).length}/3</td>
        <td>${
          pay
            ? `<span class="pill ${pay.state === 'paid' ? 'ok' : pay.state === 'failed' ? 'no' : 'mid'}">${esc(pay.state)}</span> <small>Rs ${((pay.amountPaisa ?? 0) / 100).toLocaleString('en-US')}</small>`
            : '<span class="pill dim">—</span>'
        }</td>
        <td>${quiz?.declined ? '<span class="pill dim">declined</span>' : quiz ? `${(quiz.answers ?? []).length}/10` : '—'}</td>
        <td>${bar(s)}<br><small>${s.lastAt ? esc(when(s.lastAt)) : pushOn ? 'not sent' : 'no endpoint'}</small></td>
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
<thead><tr><th>Started</th><th>Rider</th><th>CNIC</th><th>Step</th><th>Face</th><th>Licence vs CNIC</th>
<th>Wallet</th><th>Docs</th><th>Fee</th><th>Quiz</th><th>Synced</th></tr></thead>
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

  const docs = ['license', 'cnic_front', 'selfie']
    .filter((k) => c[`${k}.uploadId`])
    .map(
      (k) => `<figure><img src="/api/upload/${esc(c[`${k}.uploadId`])}" alt="${esc(k)}"
        onerror="this.replaceWith(Object.assign(document.createElement('small'),{textContent:'no longer held'}))">
        <figcaption>${esc(k.replace('_', ' '))}</figcaption></figure>`,
    )
    .join('')

  const answers = (q?.answers ?? [])
    .map((a) => {
      const question = quiz.find((x) => x.id === a.id)
      const chosen = question?.options.find((o) => o.key === a.chose)
      return `<div class="kv"><span>${esc(question?.stem ?? a.id)}</span><b>${esc(a.chose.toUpperCase())}) ${esc(chosen?.text ?? '')}</b></div>`
    })
    .join('')

  const transcript = (r.history ?? [])
    .map((m) => {
      const msg = m as { role?: string; content?: string; kind?: string }
      const text = msg.kind && msg.kind !== 'text' ? `[${msg.kind}]` : msg.content
      if (!text) return ''
      return `<div class="msg ${msg.role === 'user' ? 'me' : 'bot'}">${esc(text)}</div>`
    })
    .join('')

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
    ${kv('Selfie matches CNIC', c['checks.faceMatch'])}
    ${kv('Licence name vs CNIC', c['checks.licenceVsCnic'])}
    ${kv('Wallet in rider’s name', c['checks.wallet'])}
    ${kv('Licence number', c['license.number'])}
    ${kv('Licence expiry', c['license.expiry'])}
    ${kv('Licence expired', c['license.expired'])}
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
  ${docs || '<small>None uploaded.</small>'}
  <small>Documents are held for thirty minutes and never written to disk, so older ones will not load.</small>
</div>

<div class="panel"><h2>Training quiz</h2>
  ${q?.declined ? '<small>Declined — the questions will be asked at the office.</small>' : answers || '<small>Not answered.</small>'}
</div>

<div class="panel"><h2>Conversation</h2>
  <details><summary>Show the whole thread (${(r.history ?? []).length} messages)</summary>
    <div class="chat">${transcript}</div>
  </details>
</div>
</div></body></html>`
}
