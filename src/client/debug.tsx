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

/**
 * Google's embed without an API key. The keyed Embed API would need a key
 * provisioned and billing enabled; this shows the same map today, and swapping
 * to the keyed endpoint later is a one-line change.
 */
function MapView({ lat, lng, accuracy }: { lat: string; lng: string; accuracy?: string }) {
  const q = `${lat},${lng}`
  return (
    <div class="mapwrap">
      <iframe
        class="map"
        title="Rider location"
        loading="lazy"
        referrerpolicy="no-referrer-when-downgrade"
        src={`https://maps.google.com/maps?q=${encodeURIComponent(q)}&z=16&output=embed`}
      />
      <div class="mapfoot">
        <code>{q}{accuracy ? ` · ±${accuracy} m` : ''}</code>
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open in Google Maps
        </a>
      </div>
    </div>
  )
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

  const face = d['checks.faceMatch']
  const wallet = d['checks.wallet']

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
      // "not checked" is its own state: the service did not answer, which is
      // not the same as a rider who failed and must never be shown as one.
      state: !face ? 'pending' : face.startsWith('match') ? 'pass' : face === 'not checked' ? 'pending' : 'fail',
      label: 'Selfie matches CNIC picture',
      detail: face ?? (d['selfie.captured'] === 'yes' ? 'checking…' : 'no selfie yet'),
    },
    {
      state: !wallet ? 'pending' : wallet.startsWith('match') ? 'pass' : wallet === 'not checked' ? 'pending' : 'fail',
      label: 'Wallet is in the rider’s own name',
      detail: wallet ?? 'waiting for the CNIC',
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
  const lat = data['gps.latitude']
  const lng = data['gps.longitude']

  const groups = GROUPS.filter(([prefix]) => !(prefix === 'gps' && lat && lng)).map(([prefix, title]) => [
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

      {lat && lng && (
        <div class="dgroup">
          <h4>Location</h4>
          <MapView lat={lat} lng={lng} accuracy={data['gps.accuracyMetres']} />
        </div>
      )}

      <Checks d={data} />
    </details>
  )
}
