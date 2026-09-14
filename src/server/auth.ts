import { createHash, timingSafeEqual } from 'node:crypto'
import type { Context, Next } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'

/**
 * The password on the staff surfaces.
 *
 * It used to be on the chat as well, which meant a rider — the person this
 * whole thing is for — had to be told a password before they could say their
 * name. The chat is now open, as a public application form has to be.
 *
 * What it still protects is everything that looks at what riders sent: the
 * admin dashboard, the list of applications, the ops routes. Those hold names,
 * phone numbers, CNICs, licences and photographs of faces, and nothing about
 * removing the rider's password makes them any less worth protecting.
 */
const PASSWORD = process.env.ACCESS_PASSWORD ?? ''
export const authRequired = PASSWORD.length > 0

const COOKIE = 'gb_auth'
const expected = PASSWORD
  ? createHash('sha256').update(PASSWORD).digest('hex')
  : ''

function sameToken(given: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function isAuthed(c: Context): boolean {
  if (!authRequired) return true
  const token = getCookie(c, COOKIE)
  return !!token && sameToken(token)
}

export function grant(c: Context, password: string): boolean {
  if (!authRequired) return true
  const token = createHash('sha256').update(password).digest('hex')
  if (!sameToken(token)) return false
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })
  return true
}

/**
 * Staff only. Never put this on a route a rider's own page has to call —
 * that is what used to make the chat ask for a password.
 */
export async function staffOnly(c: Context, next: Next) {
  if (!isAuthed(c)) return c.json({ error: 'Unauthorized' }, 401)
  await next()
}
