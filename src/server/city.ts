/**
 * Which city a rider means.
 *
 * The list handles what it can — the common spellings, the short forms, the
 * Urdu — and everything it cannot goes to the model with the list in hand.
 * A rider from a town of forty thousand people should not be told we do not
 * understand them because their town is not in an array.
 *
 * The model's job is narrow on purpose: pick a name from the list, or say the
 * answer is not a place. It is not asked to invent a spelling, because a
 * spelling nobody agreed on is exactly what this exists to prevent.
 */
import { CITY_NAMES, isCity, knownCity } from '../shared/cities.ts'
import { completeJson } from './provider.ts'

const PROMPT = `You decide which Pakistani city a person means.
They were asked "Aap kis sheher mein rehte hain?" (which city do you live in?) and answered in Roman Urdu, English or Urdu script.

Reply with JSON only: {"is_city": true|false, "city": string|null, "nearest": string|null}

"city" must be copied EXACTLY from this list, or be null:
${CITY_NAMES.join(', ')}

Rules:
- A town, tehsil, village or neighbourhood that is not on the list: set "city" to null and put the closest listed city in "nearest".
- A sector, colony, mohalla or landmark inside a listed city (F-8, Saddar, DHA, Gulberg, Bara Kahu): resolve it to that city.
- A question, a greeting, a name, a number or anything that is not a place: set "is_city" false and both names null.
- Never invent a name that is not on the list.`

export type CityGuess = {
  /** The canonical name, when it is one we know. */
  city: string | null
  /** The listed city nearest to a place we do not list. */
  nearest: string | null
  /** Whether the answer was about a place at all. */
  isCity: boolean
  /** Where the answer came from, for the record. */
  by: 'list' | 'model' | 'none'
}

const none: CityGuess = { city: null, nearest: null, isCity: false, by: 'none' }

export async function readCity(text: string): Promise<CityGuess> {
  const trimmed = text.slice(0, 200).trim()
  if (!trimmed) return none

  // The list first: it costs nothing, it is deterministic, and it is right
  // about the cities riders actually come from.
  const known = knownCity(trimmed)
  if (known) return { city: known, nearest: null, isCity: true, by: 'list' }

  const out = await completeJson(PROMPT, trimmed)
  if (!out) return none

  const pick = typeof out.city === 'string' ? out.city.trim() : ''
  const near = typeof out.nearest === 'string' ? out.nearest.trim() : ''
  return {
    // Checked against the list rather than trusted: a model asked for one of
    // a hundred names will occasionally produce a hundred and first.
    city: isCity(pick) ? pick : null,
    nearest: isCity(near) ? near : null,
    isCity: out.is_city === true,
    by: 'model',
  }
}
