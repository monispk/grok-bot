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
    </details>
  )
}
