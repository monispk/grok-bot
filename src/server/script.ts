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
Digits and dates stay as digits: 15,000 stays 15,000, 12 stays 12.
Money is said the Urdu way: the amount, then روپے. "Rs. 15,000" becomes
"15,000 روپے"; "15000 rupay" becomes "15,000 روپے". Never leave "Rs." in.
Translate nothing. Add nothing. Remove nothing. Keep the word order and punctuation.

Example
input:  Aap ka poora naam kya hai? Wohi naam likhein jo aap ke CNIC par hai.
output: آپ کا پورا نام کیا ہے؟ وہی نام لکھیں جو آپ کے CNIC پر ہے۔

Example
input:  Nahi, ye freelancer ka kaam hai, mulazmat nahi.
output: نہیں، یہ freelancer کا کام ہے، ملازمت نہیں۔

Example
input:  Hafte mein Rs. 15,000 aur mahine mein Rs. 60,000 mil sakte hain.
output: ہفتے میں 15,000 روپے اور مہینے میں 60,000 روپے مل سکتے ہیں۔

Pronunciation pins, from the people who recorded the rest of the bank:
- "Easypaisa" -> "Easy پیسہ" (split; the English word stays in Latin)
- "JazzCash" -> "JazzCash" (Latin, one word)
- "CNIC" -> "ID card" when spoken aloud
- "2,500" -> "پچیس سو" — digits are read inconsistently, and this is the one
  number a rider must not mishear

Spell these the standard way. A near-miss changes the vowel and is read aloud
wrong: وعدہ (waada, not واعدہ), برائے (baraye), مہربانی (meherbani), معذرت
(maazrat), اجازت (ijazat), ضروری (zaroori), تصویر (tasveer), ملازمت (mulazmat),
شکریہ (shukriya), تقریباً (taqreeban), اوسط (aoosat).

Reply as JSON: {"text": "<the rewritten line>"}`

const cache = new Map<string, string>()
const MAX_CACHED = 400

export async function forSpeech(line: string): Promise<string> {
  const t = line.trim()
  if (!t) return t

  const hit = cache.get(t)
  if (hit !== undefined) return hit

  const result = (await convert(t)) ?? t
  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!)
  cache.set(t, result)
  return result
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length

/**
 * One conversion, checked for length.
 *
 * The model drops a word now and then — "jama nahi hui" came back as "جمع
 * نہیں", losing the verb — and it does so intermittently, so the same sentence
 * converts correctly on the next attempt. That matters more than it sounds:
 * clips are cached against the words, so one bad conversion is recorded once
 * and then spoken to every rider who reaches that line.
 *
 * A conversion that has lost a quarter of its words is refused and tried
 * again; if the second is no better, the Roman Urdu is used instead. Uplift
 * reads that after a fashion, and an accent is a smaller problem than a
 * sentence with its verb missing.
 */
async function convert(t: string): Promise<string | null> {
  const want = words(t)
  for (let attempt = 0; attempt < 2; attempt++) {
    // Reasoning tokens bill against this, and a tight cap comes back empty.
    const out = await completeJson(SYSTEM, t, 900)
    const text = typeof out?.['text'] === 'string' ? (out['text'] as string).trim() : ''
    if (!text) continue
    // No shrinkage at all. The conversion is word for word — Urdu words become
    // Urdu, English stays English — so it may grow ("Easypaisa" becomes "Easy
    // پیسہ") but has no business getting shorter. A quarter's tolerance let a
    // missing verb through in a five-word sentence, which is exactly the case
    // this exists to catch.
    if (words(text) >= want) return text
    console.warn(
      `script: dropped words converting "${t.slice(0, 60)}" ` +
        `(${want} -> ${words(text)}), attempt ${attempt + 1}`,
    )
  }
  return null
}
