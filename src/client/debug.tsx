/** Development readout of everything the documents gave up. Not rider-facing copy. */
const GROUPS: [string, string][] = [
  ['cnic_front', 'CNIC (front)'],
  ['cnic_back', 'CNIC (back)'],
  ['license', 'Driving licence'],
  ['bill', 'Utility bill'],
  ['selfie', 'Selfie'],
  ['gps', 'Location'],
]

const LABELS: Record<string, string> = {
  name: 'Name',
  cnic: 'CNIC number',
  expiry: 'Expires',
  expired: 'Expired',
  number: 'Licence no',
  nameMatch: 'Name vs typed',
  dueDate: 'Due date',
  dueDateRaw: 'Due date as printed',
  billAgeDays: 'Bill age (days)',
  billName: 'Bill in name of',
  billAddress: 'Address',
  captured: 'Captured',
  latitude: 'Latitude',
  longitude: 'Longitude',
  accuracyMetres: 'Accuracy (m)',
}

type CheckState = 'pass' | 'fail' | 'pending'

const ICON: Record<CheckState, string> = { pass: '✅', fail: '❌', pending: '⏳' }

function Check({ state, label, detail }: { state: CheckState; label: string; detail: string }) {
  return (
    <div class={`check ${state}`}>
      <span class="tick" aria-hidden="true">{ICON[state]}</span>
      <span class="body">
        <strong>{label}</strong>
        <code>{detail}</code>
      </span>
    </div>
  )
}

/** The four checks, stated plainly, with the evidence beside each one. */
function Checks({ d }: { d: Record<string, string> }) {
  const cnicName = d['cnic_front.name']
  const licName = d['license.name']
  const nameVerdict = d['checks.licenceVsCnic']

  const dueDate = d['bill.dueDate']
  const age = d['bill.billAgeDays']
  const address = d['bill.billAddress']

  const rows: { state: CheckState; label: string; detail: string }[] = [
    {
      state: !cnicName || !licName || !nameVerdict
        ? 'pending'
        : nameVerdict === 'match'
          ? 'pass'
          : nameVerdict === 'review'
            ? 'pending'
            : 'fail',
      label: 'Licence name matches CNIC name',
      detail: cnicName && licName ? `${licName}  ·  ${cnicName}` : 'waiting for both documents',
    },
    {
      state: !dueDate ? 'pending' : Number(age) <= 92 ? 'pass' : 'fail',
      label: 'Utility bill is less than 3 months old',
      detail: dueDate ? `due ${dueDate}${age ? ` · ${age} days ago` : ''}` : 'no due date read',
    },
    {
      state: address ? 'pass' : 'pending',
      label: 'Utility bill address captured',
      detail: address ?? 'not captured',
    },
    {
      state: 'pending',
      label: 'Selfie matches CNIC picture',
      detail: d['selfie.captured'] === 'yes'
        ? 'selfie taken — face API not connected yet'
        : 'no selfie yet',
    },
  ]

  return (
    <div class="checks">
      <h4>Checks</h4>
      {rows.map((r) => (
        <Check key={r.label} {...r} />
      ))}
    </div>
  )
}

export function DebugPanel({ data }: { data: Record<string, string> }) {
  const groups = GROUPS.map(([prefix, title]) => [
    title,
    Object.entries(data)
      .filter(([k]) => k.startsWith(`${prefix}.`))
      .map(([k, v]) => [LABELS[k.split('.')[1] ?? ''] ?? k.split('.')[1], v] as const),
  ] as const).filter(([, rows]) => rows.length > 0)

  if (!groups.length) return null

  return (
    <details class="debug" open>
      <summary>Debug — extracted data</summary>
      {groups.map(([title, rows]) => (
        <div key={title} class="dgroup">
          <h4>{title}</h4>
          {rows.map(([label, value]) => (
            <div key={label} class="drow">
              <span>{label}</span>
              <code>{value}</code>
            </div>
          ))}
        </div>
      ))}
      <Checks d={data} />
    </details>
  )
}
