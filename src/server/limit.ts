type Bucket = { tokens: number; last: number }

const buckets = new Map<string, Bucket>()
const CAPACITY = 8 // burst
const REFILL_PER_SEC = 20 / 60 // ~20 requests/minute sustained

export function allow(ip: string): boolean {
  const now = Date.now()
  const b = buckets.get(ip) ?? { tokens: CAPACITY, last: now }
  b.tokens = Math.min(CAPACITY, b.tokens + ((now - b.last) / 1000) * REFILL_PER_SEC)
  b.last = now
  if (b.tokens < 1) {
    buckets.set(ip, b)
    return false
  }
  b.tokens -= 1
  buckets.set(ip, b)
  return true
}

// Bounded memory: drop buckets that have fully refilled and gone idle.
setInterval(() => {
  const cutoff = Date.now() - 10 * 60_000
  for (const [ip, b] of buckets) if (b.last < cutoff) buckets.delete(ip)
}, 60_000).unref()
