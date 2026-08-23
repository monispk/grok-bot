/**
 * The application sequence, shared by the web app and the WhatsApp bot.
 *
 * Prompts live here once so the two transports cannot drift apart. Retry text is
 * split: `need` states what is required and is identical everywhere, while the
 * hint that tells someone *how* to send it differs — the web app has an on-screen
 * camera button, WhatsApp has its own attachment menu, and telling a WhatsApp
 * user to press a button that isn't there would be worse than saying nothing.
 */
import { SAY } from './messages.ts'

export type StepKind = 'text' | 'confirm' | 'upload' | 'gps'
export type DocKind = 'cnic_front' | 'cnic_back' | 'license' | 'bill'

export type StepSpec = {
  id: string
  kind: StepKind
  doc?: DocKind
  /** Which camera the web app should open. 'user' is the selfie camera. */
  facing?: 'user' | 'environment'
  /** Selfies must be photographs, not a PDF picked from storage. */
  imageOnly?: boolean
  ask: string
  /** What is required. Transport-neutral. */
  need: string
  /** How to send it, in the web app. */
  webHint?: string
  /** How to send it, in WhatsApp. */
  waHint?: string
  /**
   * Base path of a spoken version of `ask`, without extension. Many riders read
   * Roman Urdu poorly, so the important questions are also asked aloud.
   */
  audio?: string
}

/** Opus for Android and WhatsApp, AAC because iOS Safari will not play Ogg. */
export const audioSources = (base: string) => [
  { src: `${base}.opus`, type: 'audio/ogg; codecs=opus' },
  { src: `${base}.m4a`, type: 'audio/mp4' },
]

const WEB_CLIP =
  'Neeche camera ka nishan daba kar tasveer khenchein, ya clip ka nishan daba kar file chunein.'
const WA_CLIP = 'Tasveer khenchein aur isi chat mein bhej dein.'

export const STEP_SPECS: StepSpec[] = [
  {
    id: 'name',
    kind: 'text',
    audio: '/ask-name',
    ask: 'Aapka poora naam jo CNIC par hai, kya hai?',
    need: 'Baraye meherbani apna poora naam likh kar bhejein.',
  },
  {
    id: 'smartphone',
    kind: 'confirm',
    audio: '/ask-smartphone',
    ask: 'Kya aap ke paas apna baray screen wala touch phone hai? Touch phone foodpanda rider job ke liye zaroori hai.',
    need: 'Baraye meherbani "haan" ya "nahi" likh kar bataein.',
  },
  {
    id: 'selfie',
    audio: '/ask-selfie',
    kind: 'upload',
    facing: 'user',
    imageOnly: true,
    ask: 'Ab apni aik selfie khenchein. Camera ka button dabayein aur apna chehra saaf dikhayein.',
    need: 'Iske liye aap ki selfie chahiye.',
    webHint: 'Neeche camera ka nishan daba kar apni tasveer khenchein.',
    waHint: 'Apni selfie khenchein aur isi chat mein bhej dein.',
  },
  {
    id: 'license_front',
    audio: '/ask-license-front',
    kind: 'upload',
    doc: 'license',
    ask: 'Ab apne driving license ke saamne wale hissay (front) ki tasveer bhejein.',
    need: 'Iske liye driving license ke front ki tasveer chahiye.',
    webHint: WEB_CLIP,
    waHint: WA_CLIP,
  },
  {
    id: 'cnic_front',
    audio: '/ask-cnic-front',
    kind: 'upload',
    doc: 'cnic_front',
    ask: 'Ab apne CNIC ke saamne wale hissay (front) ki tasveer bhejein.',
    need: 'Iske liye CNIC ke front ki tasveer chahiye.',
    webHint: WEB_CLIP,
    waHint: WA_CLIP,
  },
  {
    id: 'cnic_back',
    audio: '/ask-cnic-back',
    kind: 'upload',
    doc: 'cnic_back',
    ask: 'Ab apne CNIC ke peechay wale hissay (back) ki tasveer bhejein.',
    need: 'Iske liye CNIC ke back ki tasveer chahiye.',
    webHint: WEB_CLIP,
    waHint: WA_CLIP,
  },
  {
    id: 'utility_bill',
    audio: '/ask-utility-bill',
    kind: 'upload',
    doc: 'bill',
    ask: 'Ab apne ghar ka utility bill (bijli, gas ya paani) ki tasveer bhejein jis par aap ke rehne ka pata likha ho. Bill pichlay teen mahine ke andar ka hona chahiye. Bill kisi aur ke naam par ho to bhi theek hai.',
    need: 'Iske liye utility bill ki tasveer chahiye jis par pata likha ho.',
    webHint: WEB_CLIP,
    waHint: WA_CLIP,
  },
  {
    id: 'gps',
    audio: '/ask-gps',
    kind: 'gps',
    ask: 'Aakhri kaam. Apni location bhejein taake hum aap ko sab se qareeb foodpanda office bata sakein. Neeche "Location bhejein" ka button dabayein.',
    need: 'Iske liye aap ki location chahiye.',
    webHint: 'Neeche "Location bhejein" ka button dabayein.',
    waHint: 'WhatsApp mein attach (📎) daba kar "Location" chunein aur apni location bhejein.',
  },
]

/** WhatsApp asks for location through its own menu, not an on-screen button. */
export const WA_ASK: Record<string, string> = {
  gps: 'Aakhri kaam. Apni location bhejein taake hum aap ko sab se qareeb foodpanda office bata sakein. Attach (📎) daba kar "Location" chunein.',
  selfie: 'Ab apni aik selfie khenchein aur bhejein. Apna chehra saaf dikhayein.',
}

/**
 * Sent when a voice note or attachment arrives at the name question. The name is
 * the one answer that has to be typed — it is matched against the CNIC and the
 * licence, so it has to exist as text.
 */
export const TYPE_NAME_PLEASE = SAY.typeName.text

/**
 * The model, shown a pending question in the history, often just repeats it. The
 * canned question is then appended too and the rider sees it twice. Prompting
 * against this is unreliable, so the echo is detected and dropped instead — the
 * canned one is authoritative and carries the recording.
 */
/** Edit distance, so a paraphrase is still recognised as the same question. */
function similarity(a: string, b: string): number {
  if (a === b) return 1
  if (!a.length || !b.length) return 0
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const curr = [i]
    for (let j = 1; j <= b.length; j++)
      curr[j] = Math.min(
        prev[j]! + 1,
        curr[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    prev = curr
  }
  return 1 - prev[b.length]! / Math.max(a.length, b.length)
}

export function echoesQuestion(reply: string, question: string): boolean {
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '')
  const r = norm(reply)
  const q = norm(question)
  if (!r || !q) return false
  if (r === q) return true
  if (r.includes(q) && r.length < q.length * 2.2) return true
  // The model rewords as often as it repeats: "CNIC par hai" becomes "CNIC par
  // likha hai". Close enough to the pending question is still the same question.
  return similarity(r, q) >= 0.8
}

/**
 * Removes the repeated question but keeps the rest of the answer, because a
 * reply often answers properly and *then* repeats the question — dropping the
 * whole thing would throw away the answer the rider asked for.
 * Returns an empty string when nothing but the echo was there.
 */
export function stripEcho(reply: string, question: string): string {
  const parts = reply.split(/(?<=[.?!。])\s+|\n+/).filter((p) => p.trim())
  const kept = parts.filter((p) => !echoesQuestion(p, question))
  return kept.join(' ').trim()
}

/**
 * Last line of defence against the same thing being said twice in a row,
 * whatever produced it — the model, the canned question, or both.
 */
export function dropRepeat(previous: string | undefined, next: string): boolean {
  if (!previous || !next) return false
  return echoesQuestion(next, previous)
}

/**
 * Reads yes or no from a rider's reply. Deterministic rather than a model call:
 * it is one word, it must be reliable, and a wrong reading here either turns
 * away someone eligible or walks someone through an application they cannot
 * finish. A negative word anywhere wins, so "ji nahi" is a no.
 */
export function readYesNo(text: string): 'yes' | 'no' | null {
  const t = ` ${text.toLowerCase().replace(/[^a-z\s]/g, ' ')} `
  if (/\s(nahi|nahin|nahen|nai|nhi|no|nope|na)\s/.test(t)) return 'no'
  if (/\s(haan|han|hann|ji|jee|g|yes|yep|bilkul|zaroor|hai)\s/.test(t)) return 'yes'
  return null
}

export const WELCOME_LINES = [
  'Assalam o Alaikum! Foodpanda delivery rider ki job mein khush aamdeed.',
  'Mera naam Rozeena hai. Agar aap achi job dhoondh rahay hain tu Foodpanda delivery rider ki job ke liye apply karein.',
  'Main aapki madad karungi. Chalein shuru karte hain.',
]

export const closing = (firstName: string, address?: string): string[] => [
  firstName
    ? `Mubarak ho ${firstName}! Aap ki application manzoor ho gayi hai.`
    : 'Mubarak ho! Aap ki application manzoor ho gayi hai.',
  ...(address ? [`Aap ka pata jo bill par mila: ${address}`] : []),
  'Ab aap foodpanda office aa kar apni uniform lein aur training mukammal karein. Office Peer se Juma, dopahar 12 baje se shaam 6 baje tak khula hai.',
]
