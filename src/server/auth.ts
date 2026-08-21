import { createHash, timingSafeEqual } from 'node:crypto'
import type { Context, Next } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'

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

export async function guard(c: Context, next: Next) {
  if (!isAuthed(c)) return c.json({ error: 'Unauthorized' }, 401)
  await next()
}
