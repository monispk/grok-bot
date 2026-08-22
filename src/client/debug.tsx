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
