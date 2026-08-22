import { completeJson } from './provider.ts'

const NAME_PROMPT = `You decide whether a message is a person's name.
The user was asked: "Aapka poora naam jo CNIC par hai, kya hai?" (What is your full name as on your CNIC?)
Reply with JSON only: {"is_name": true|false, "full_name": string|null, "first_name": string|null}
If the message is a question, a greeting, or anything other than their own name, set is_name to false and the names to null.
Names may be written in Roman Urdu. Strip words like "mera naam hai" / "my name is". Keep the name's own spelling.`

export type NameGuess = { isName: boolean; fullName: string | null; firstName: string | null }

/** A small dedicated call — no persona, no FAQ — so it stays cheap and fast. */
export async function extractName(text: string): Promise<NameGuess> {
  const trimmed = text.slice(0, 500)
  if (!trimmed) return { isName: false, fullName: null, firstName: null }

  const out = await completeJson(NAME_PROMPT, trimmed)
  if (!out) return { isName: false, fullName: null, firstName: null }

  const full = typeof out.full_name === 'string' ? out.full_name.trim() : ''
  const first = typeof out.first_name === 'string' ? out.first_name.trim() : ''
  return {
    isName: out.is_name === true && full.length > 0,
    fullName: full || null,
    firstName: first || full.split(/\s+/)[0] || null,
  }
}
