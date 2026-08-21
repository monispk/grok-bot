// Generates the PWA / home-screen icons with a tiny hand-rolled PNG encoder,
// so the repo needs no image tooling.  node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

const TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

const crc32 = (buf) => {
  let c = -1
  for (const b of buf) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

function png(size, shade) {
  const stride = size * 4 + 1
  const raw = Buffer.alloc(size * stride)
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = shade(x + 0.5, y + 0.5, size)
      const o = y * stride + 1 + x * 4
      raw[o] = r
      raw[o + 1] = g
      raw[o + 2] = b
      raw[o + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const BG = [11, 13, 16]
const BUBBLE = [91, 141, 255]
const DOT = [34, 197, 94]

// Signed distance to a rounded rectangle, used for cheap anti-aliasing.
const roundRect = (px, py, x0, y0, x1, y1, r) => {
  const cx = Math.max(x0 + r, Math.min(px, x1 - r))
  const cy = Math.max(y0 + r, Math.min(py, y1 - r))
  return Math.hypot(px - cx, py - cy) - r
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t))

function shade(x, y, s) {
  const u = x / s
  const v = y / s
  let color = BG

  // speech bubble
  const d = roundRect(u, v, 0.17, 0.2, 0.83, 0.66, 0.13)
  const tail =
    v > 0.62 && v < 0.8 && u > 0.28 && u < 0.28 + (0.8 - v) * 1.15 ? -0.01 : 1
  const inBubble = Math.min(d, tail)
  color = mix(color, BUBBLE, 1 - Math.min(1, Math.max(0, inBubble * s * 0.5)))

  // three "typing" dots
  for (const cx of [0.35, 0.5, 0.65]) {
    const dd = Math.hypot(u - cx, v - 0.43) - 0.052
    const t = 1 - Math.min(1, Math.max(0, dd * s * 0.5))
    if (t > 0) color = mix(color, cx === 0.65 ? DOT : BG, t)
  }
  return [...color, 255]
}

for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  writeFileSync(new URL(`../public/${name}`, import.meta.url), png(size, shade))
  console.log('wrote public/' + name)
}
