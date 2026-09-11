import { completeJson } from './provider.ts'

/**
 * Rewrites a line the way Uplift needs to hear it.
 *
 * The bot writes Roman Urdu because that is what a rider reads. A voice engine
 * reading Latin letters has to guess, and guesses with an English accent. Urdu
 * words are therefore put into Urdu script and English words left in Latin, so
 * each is pronounced by the rules it belongs to — "CNIC" stays CNIC, "hafte"
 * becomes ہفتے.
 *
 * The result is cached against the original words, so a line already converted
 * costs nothing the next time it is said.
 */
const SYSTEM = `You rewrite Roman Urdu into mixed script so a text-to-speech engine pronounces it correctly.

Every Urdu word MUST be rewritten in Urdu script. English words and brand names MUST stay in Latin script. Never leave an Urdu word in Latin letters.

Keep English as-is: foodpanda, rider, CNIC, license, selfie, GPS, location, smartphone, touch phone, office, training, uniform, WhatsApp, app, PDF, JPG, camera.
Keep numbers, currency and dates exactly: Rs. 15,000 stays Rs. 15,000.
Translate nothing. Add nothing. Remove nothing. Keep the word order and punctuation.

Example
input:  Aap ka poora naam kya hai? Wohi naam likhein jo aap ke CNIC par hai.
output: آپ کا پورا نام کیا ہے؟ وہی نام لکھیں جو آپ کے CNIC پر ہے۔

Example
input:  Nahi, ye freelancer ka kaam hai, mulazmat nahi.
output: نہیں، یہ freelancer کا کام ہے، ملازمت نہیں۔

Reply as JSON: {"text": "<the rewritten line>"}`

const cache = new Map<string, string>()
const MAX_CACHED = 400

export async function forSpeech(line: string): Promise<string> {
  const t = line.trim()
  if (!t) return t

  const hit = cache.get(t)
  if (hit !== undefined) return hit

  // Reasoning tokens bill against this, and a tight cap comes back empty.
  const out = await completeJson(SYSTEM, t, 900)
  const text = typeof out?.['text'] === 'string' ? (out['text'] as string).trim() : ''

  // A failed conversion is not worth failing the voice note over: Uplift reads
  // Roman Urdu after a fashion, and silence would be worse.
  const result = text || t
  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!)
  cache.set(t, result)
  return result
}
