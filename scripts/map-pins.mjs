/**
 * Draws the two office locations once, so a rider is shown where to go rather
 * than only told.
 *
 * Tiles come from OpenStreetMap and are stitched here, at build time, into one
 * small image per office. There are two offices and they do not move, so a map
 * service with a key and a per-view charge would be machinery for nothing —
 * and this way the picture loads from our own origin, on a phone that may be
 * on 3G, with no third party watching which riders looked at it.
 *
 * The pin is not drawn into the image: it is an SVG in the page, centred over
 * the picture. That keeps this script to fetching and stitching, and lets the
 * marker stay sharp on a high-density screen.
 *
 *   node scripts/map-pins.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpeg from 'ffmpeg-static'

const OFFICES = {
  'office-f8': { lat: 33.7125, lng: 73.0373, name: 'F8 Markaz, Islamabad' },
  'office-saddar': { lat: 33.5995, lng: 73.0627, name: 'Saddar, Rawalpindi' },
}

const ZOOM = 16
const TILE = 256
const COLS = 3
const ROWS = 2
/** The finished picture: wide enough to read a street name, short enough not to
 *  push the message that follows it off a 360px screen. */
const OUT_W = 640
const OUT_H = 300

const xOf = (lng, z) => ((lng + 180) / 360) * 2 ** z
const yOf = (lat, z) => {
  const r = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z
}

// OpenStreetMap asks for identification and modest volume. This runs by hand,
// for two images, perhaps twice a year.
const UA = 'foodpanda-rider-onboarding/1.0 (+https://rozee.pk; one-off office map)'

for (const [name, o] of Object.entries(OFFICES)) {
  const fx = xOf(o.lng, ZOOM)
  const fy = yOf(o.lat, ZOOM)
  const x0 = Math.floor(fx) - Math.floor(COLS / 2)
  const y0 = Math.floor(fy) - Math.floor(ROWS / 2)

  const dir = mkdtempSync(join(tmpdir(), 'tiles-'))
  try {
    const rows = []
    for (let dy = 0; dy < ROWS; dy++) {
      const row = []
      for (let dx = 0; dx < COLS; dx++) {
        const url = `https://tile.openstreetmap.org/${ZOOM}/${x0 + dx}/${y0 + dy}.png`
        const res = await fetch(url, { headers: { 'user-agent': UA } })
        if (!res.ok) throw new Error(`tile ${url}: ${res.status}`)
        const file = join(dir, `t${dy}-${dx}.png`)
        writeFileSync(file, Buffer.from(await res.arrayBuffer()))
        row.push(file)
        await new Promise((r) => setTimeout(r, 120))
      }
      rows.push(row)
    }

    // Where the office falls inside the stitched sheet, so the crop centres on it.
    const px = (fx - x0) * TILE
    const py = (fy - y0) * TILE
    const cropX = Math.max(0, Math.min(COLS * TILE - OUT_W, Math.round(px - OUT_W / 2)))
    const cropY = Math.max(0, Math.min(ROWS * TILE - OUT_H, Math.round(py - OUT_H / 2)))

    const inputs = rows.flat().flatMap((f) => ['-i', f])
    const stack =
      rows
        .map((row, r) => row.map((_, c) => `[${r * COLS + c}:v]`).join('') + `hstack=inputs=${COLS}[r${r}];`)
        .join('') +
      rows.map((_, r) => `[r${r}]`).join('') +
      `vstack=inputs=${ROWS}[sheet];[sheet]crop=${OUT_W}:${OUT_H}:${cropX}:${cropY}[out]`

    execFileSync(ffmpeg, [
      '-y', '-loglevel', 'error', ...inputs,
      '-filter_complex', stack, '-map', '[out]', '-q:v', '5',
      `public/${name}.jpg`,
    ])
    console.log(`${name}.jpg — ${o.name}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
