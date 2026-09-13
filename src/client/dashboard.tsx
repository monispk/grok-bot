import { useState } from 'preact/hooks'
import type { FlowState } from './storage.ts'
import { QUESTIONS } from '../shared/quiz.ts'
import { STEPS } from './flow.ts'

/**
 * Everything the application has collected, on one screen.
 *
 * A testing aid, not part of the rider's journey — it exists so the flow can be
 * walked and checked without reading local storage by hand. It shows exactly
 * what the backend will be sent, in the shape the push spec describes, so a
 * gap here is a gap there.
 */

type State = 'pass' | 'fail' | 'pending'

const DOCS = [
  { key: 'license', label: 'Driving licence' },
  { key: 'cnic_front', label: 'CNIC front' },
  { key: 'selfie', label: 'Selfie' },
] as const

function Verdict({ state, children }: { state: State; children: preact.ComponentChildren }) {
  return (
    <span class={`verdict ${state}`}>
      {state === 'pass' ? '✓' : state === 'fail' ? '✕' : '•'} {children}
    </span>
  )
}

function Row({ label, value, state }: { label: string; value: string; state?: State }) {
  return (
    <div class="drow">
      <span>{label}</span>
      {state ? <Verdict state={state}>{value}</Verdict> : <b>{value}</b>}
    </div>
  )
}

function Section({ title, children }: { title: string; children: preact.ComponentChildren }) {
  return (
    <section class="dsec">
      <h4>{title}</h4>
      {children}
    </section>
  )
}

/** How a recorded check reads: "match (91.2)", "mismatch (12.0)", "not checked". */
const stateOf = (v: string | undefined): State =>
  !v || v === 'not checked' ? 'pending' : v.startsWith('match') ? 'pass' : 'fail'

export function Dashboard({
  flow,
  syncedAt,
  onClose,
}: {
  flow: FlowState
  syncedAt?: number
  onClose: () => void
}) {
  const [big, setBig] = useState<string | null>(null)
  const d = flow.collected
  const gates = [
    { id: 'smartphone', label: 'Touch phone' },
    { id: 'bike', label: 'Own bike' },
  ]

  return (
    <div class="dash" role="dialog" aria-label="Collected data">
      <header class="dash-top">
        <strong>Collected data</strong>
        <button onClick={onClose} aria-label="Band karein">✕</button>
      </header>

      <div class="dash-body">
        <Section title="Application">
          <Row label="Application id" value={flow.applicationId ?? '—'} />
          <Row
            label="On the server"
            value={syncedAt ? `yes, ${new Date(syncedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'not yet'}
          />
          <Row label="Step" value={`${Math.min(flow.step, STEPS.length)} of ${STEPS.length}`} />
          <Row label="Full name" value={flow.fullName || '—'} />
          <Row label="Phone" value={flow.phone || '—'} />
          <Row label="CNIC number" value={flow.cnic || '—'} />
          <Row label="Wallet" value={flow.noWallet ? 'has neither' : 'not stated'} />
        </Section>

        <Section title="Eligibility">
          {gates.map((g) => {
            const missed = (flow.missing ?? []).includes(g.id)
            const reached = flow.step > STEPS.findIndex((s) => s.id === g.id)
            return (
              <Row
                key={g.id}
                label={g.label}
                value={!reached ? 'not asked yet' : missed ? 'no — recorded, not rejected' : 'yes'}
                state={!reached ? 'pending' : missed ? 'fail' : 'pass'}
              />
            )
          })}
        </Section>

        <Section title="Checks">
          <Row
            label="Selfie matches CNIC"
            value={d['checks.faceMatch'] ?? 'not run'}
            state={stateOf(d['checks.faceMatch'])}
          />
          <Row
            label="Licence name matches CNIC"
            value={d['checks.licenceVsCnic'] ?? 'not run'}
            state={
              !d['checks.licenceVsCnic']
                ? 'pending'
                : d['checks.licenceVsCnic'] === 'mismatch'
                  ? 'fail'
                  : 'pass'
            }
          />
          <Row
            label="Wallet in rider's name"
            value={d['checks.wallet'] ?? 'not run'}
            state={stateOf(d['checks.wallet'])}
          />
        </Section>

        <Section title="Documents">
          <div class="shots">
            {DOCS.map((doc) => {
              const id = d[`${doc.key}.uploadId`]
              return (
                <figure key={doc.key}>
                  {id ? (
                    <button onClick={() => setBig(`/api/upload/${id}`)}>
                      <img src={`/api/upload/${id}`} alt={doc.label} />
                    </button>
                  ) : (
                    <div class="noshot">not sent</div>
                  )}
                  <figcaption>{doc.label}</figcaption>
                </figure>
              )
            })}
          </div>
        </Section>

        {/* Whatever each document gave up, exactly as the checks saw it. */}
        <Section title="Read from the documents">
          {Object.entries(d)
            .filter(([k]) => !k.startsWith('checks.') && !k.endsWith('.uploadId'))
            .map(([k, v]) => <Row key={k} label={k} value={v} />)}
          {!Object.keys(d).some((k) => !k.startsWith('checks.') && !k.endsWith('.uploadId')) && (
            <p class="none">Nothing read yet.</p>
          )}
        </Section>

        <Section title="Training quiz">
          {!flow.quiz ? (
            <p class="none">Not offered yet.</p>
          ) : flow.quiz.declined ? (
            <p class="none">Offered, declined — to be asked at the branch.</p>
          ) : !flow.quiz.answers.length ? (
            <p class="none">Offered, not started.</p>
          ) : (
            <>
              <Row
                label="Answered"
                value={`${flow.quiz.answers.length} of ${flow.quiz.asked.length}`}
              />
              {flow.quiz.answers.map((a) => {
                const q = QUESTIONS.find((x) => x.id === a.id)
                const chosen = q?.options.find((o) => o.key === a.chose)
                return (
                  <div class="qrow" key={a.id}>
                    <span class="qid">{a.id}</span>
                    <span dir="auto">
                      <em>{q?.stem}</em>
                      <br />
                      <b>{a.chose}) </b>
                      {chosen?.text}
                    </span>
                  </div>
                )
              })}
              <p class="none">Graded on the backend — no answer key exists here.</p>
            </>
          )}
        </Section>

        <Section title="What would be pushed">
          <pre>{JSON.stringify(flow, null, 2)}</pre>
        </Section>
      </div>

      {big && (
        <button class="lightbox" onClick={() => setBig(null)} aria-label="Band karein">
          <img src={big} alt="" />
        </button>
      )}
    </div>
  )
}
