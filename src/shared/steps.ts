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
  /**
   * A requirement of the role rather than a question about it. A "no" is
   * recorded and the rider carries on — their details are worth having, and
   * they are told to come back when they have the missing thing. Turning them
   * away at the door loses the application and the lead with it.
   */
  gate?: boolean
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
    audio: '/ask-full_name',
    ask: 'Aapka poora naam jo CNIC par hai, kya hai?',
    need: 'Baraye meherbani apna poora naam likh kar bhejein.',
  },
  {
    id: 'phone',
    kind: 'text',
    audio: '/ask-phone',
    ask: 'Aap ka mobile number kya hai? Wohi number bhejein jis par aap ka Easypaisa ya JazzCash account hai.',
    need: 'Baraye meherbani apna sahi mobile number likh kar bhejein.',
  },
  {
    // Asked right after the number, while that is what the rider is thinking
    // about. Skipped entirely if they have already said they have neither.
    id: 'wallet',
    kind: 'text',
    audio: '/ask-wallet-rail',
    ask: 'Aap ke paas Easypaisa hai ya JazzCash?',
    need: 'Baraye meherbani bataein: Easypaisa, JazzCash, ya koi nahi.',
  },
  {
    id: 'smartphone',
    kind: 'confirm',
    gate: true,
    audio: '/ask-smartphone',
    ask: 'Kya aap ke paas apna baray screen wala touch phone hai? Touch phone foodpanda rider job ke liye zaroori hai.',
    need: 'Baraye meherbani "haan" ya "nahi" likh kar bataein.',
  },
  {
    id: 'bike',
    kind: 'confirm',
    gate: true,
    audio: '/ask-bike',
    ask: 'Kya aap ke paas apni bike hai? Bike foodpanda rider job ke liye zaroori hai.',
    need: 'Baraye meherbani "haan" ya "nahi" likh kar bataein.',
  },
  {
    id: 'license_front',
    audio: '/ask-licence',
    kind: 'upload',
    doc: 'license',
    ask: 'Ab apne driving license ke saamne wale hissay (front) ki tasveer bhejein.',
    need: 'Iske liye driving license ke front ki tasveer chahiye.',
    webHint: WEB_CLIP,
    waHint: WA_CLIP,
  },
  {
    id: 'cnic_front',
    audio: '/ask-cnic_front',
    kind: 'upload',
    doc: 'cnic_front',
    ask: 'Ab apne CNIC ke saamne wale hissay (front) ki tasveer bhejein.',
    need: 'Iske liye CNIC ke front ki tasveer chahiye.',
    webHint: WEB_CLIP,
    waHint: WA_CLIP,
  },
  {
    // After the CNIC, never before it: the selfie is matched against the
    // photograph on the card, so asking first leaves nothing to match.
    id: 'selfie',
    audio: '/ask-selfie',
    kind: 'upload',
    facing: 'user',
    imageOnly: true,
    ask: 'Shukriya! Ab ek chhoti selfie se aap ki pehchan verify karni hai. Neeche button dabayen — camera khud khul jayega. Selfie ho jane ke baad main khud aage barh jaungi.',
    need: 'Iske liye aap ki selfie chahiye.',
    webHint: 'Neeche camera ka nishan daba kar apni tasveer khenchein.',
    waHint: 'Apni selfie khenchein aur isi chat mein bhej dein.',
  },
  {
    id: 'location',
    audio: '/ask-location',
    kind: 'gps',
    ask: 'Neeche button daba kar apni location bhej dein, taake hum aap ko sab se qareeb foodpanda office bata sakein.',
    need: 'Iske liye aap ki location chahiye.',
    webHint: 'Neeche "Location bhejein" ka button dabayein.',
    waHint: 'WhatsApp mein attach ka nishan daba kar Location bhejein.',
  },
]

export const WA_ASK: Record<string, string> = {
  location:
    'Aakhri kaam. Apni location bhejein taake hum aap ko sab se qareeb foodpanda office bata sakein. Attach (📎) daba kar "Location" chunein.',
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
/**
 * Whether the rider slipped a question into an answer — "haan mere paas hai,
 * magar pehle bataein salary kitni milegi?". Answering the step and dropping
 * the question leaves them asking it twice, which is what happened.
 *
 * A question word is enough on its own; a bare question mark is not, so "haan
 * hai na?" does not send a stray turn to the model.
 */
export function asksSomething(text: string): boolean {
  const urdu = /کیا|کیسے|کتنا|کتنی|کتنے|کتنی|کب|کہاں|کیوں|کون|سیلری|تنخواہ/
  if (urdu.test(text)) return true

  const t = ` ${text.toLowerCase().replace(/[^a-z\s]/g, ' ')} `
  const asks =
    /\s(kya|kia|kaise|kaisay|kitna|kitni|kitne|kitnay|kab|kahan|kahaan|kyun|kyu|kiun|kaun|kon|kaunsa|konsa|bataein|batayein|batao)\s/
  if (asks.test(t)) return true

  return /[?؟]/.test(text) && t.trim().split(/\s+/).length >= 4
}

/**
 * A Pakistani mobile number out of whatever the rider typed or said.
 *
 * Length alone is not enough. A number with one digit too many came back as
 * unreadable, and the rider was asked again in the same words — with nothing
 * to tell them they had simply mistyped. Operator codes run 0300 to 0349, with
 * 0355 for SCO in Gilgit-Baltistan and Kashmir, then seven more digits.
 *
 * Returned as the wallet check wants it: 923001234567, no plus.
 */
const MOBILE = /^3(?:[0-4]\d|55)\d{7}$/

export function readPhone(text: string): string | null {
  const digits = text.replace(/[^0-9]/g, '')
  const local = digits.startsWith('0092')
    ? digits.slice(4)
    : digits.startsWith('92')
      ? digits.slice(2)
      : digits.startsWith('0')
        ? digits.slice(1)
        : digits
  return MOBILE.test(local) ? `92${local}` : null
}

export type Rail = 'easypaisa' | 'jazzcash' | 'both' | 'neither'

/**
 * Which wallet the rider's number is on.
 *
 * Order matters. "dono nahi" is neither and "dono hain" is both, and they share
 * their first word — reading that word alone recorded a rider who had both
 * accounts as having none, and sent them down the counter path.
 */
export function readRail(text: string): Rail | null {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9؀-ۿ\s]/g, ' ')} `
  const has = (...w: string[]) => w.some((x) => t.includes(` ${x} `))

  // "samajh nahi aaya" is not "I have neither". Taking any sentence with
  // "nahi" in it as a denial turned a rider saying they had not understood
  // into a rider with no wallet at all.
  if (/samajh nahi|pata nahi|nahi pata|maloom nahi|nahi samjh|سمجھ نہیں|پتہ نہیں/.test(t))
    return null

  const denied = has('nahi', 'nahin', 'nai', 'nhi', 'no', 'none', 'neither', 'نہیں', 'کوئی')
  const both = has('dono', 'donon', 'both', 'دونوں')
  const easypaisa = has('easypaisa', 'easy', 'ep', 'ایزی') || /easy\s*paisa/i.test(text)
  const jazzcash = has('jazzcash', 'jazz', 'jc', 'جاز') || /jazz\s*cash/i.test(text)

  // A denial beats everything: "dono nahi", "koi nahi", "easypaisa nahi hai".
  if (denied) return 'neither'
  if (both || (easypaisa && jazzcash)) return 'both'
  if (easypaisa) return 'easypaisa'
  if (jazzcash) return 'jazzcash'
  return null
}


export function readYesNo(text: string): 'yes' | 'no' | null {
  const t = ` ${text.toLowerCase().replace(/[^a-z\s]/g, ' ')} `
  const said = (...w: string[]) => w.some((x) => t.includes(` ${x} `))

  // "pata nahi" is not an answer at all. Counted as a no, it would record a
  // rider as having no bike because they were unsure what was being asked.
  if (/samajh nahi|pata nahi|nahi pata|maloom nahi|nahi samjh|سمجھ نہیں|پتہ نہیں/.test(t + text))
    return null

  // Negation first, otherwise. "mere paas nahi hai" carries every word that
  // means yes and one that means no, and the no is the answer.
  if (/نہیں|نہ\b|نا\b/.test(text)) return 'no'
  if (said('nahi', 'nahin', 'nahen', 'nai', 'nhi', 'no', 'nope', 'na', 'n')) return 'no'

  if (/ہاں|جی|بالکل|ضرور|آہ/.test(text)) return 'yes'
  // "y" and "n" included: a rider on a phone keyboard types the shortest thing
  // that could work, and being told it was not understood is a poor reward.
  if (
    said('haan', 'han', 'hann', 'ji', 'jee', 'g', 'yes', 'yep', 'yup', 'y', 'ok', 'okay',
         'theek', 'bilkul', 'zaroor', 'hai', 'aah', 'ah', 'ahan')
  )
    return 'yes'

  /**
   * A whole sentence rather than a word: "mere paas touch phone hai", or the
   * same transcribed into Urdu script. A voice note comes back as speech, not
   * as an answer form, and a rider who has plainly said they have the thing
   * should not be asked again because they did not begin with "haan".
   */
  const owns = /\bpaas\b|پاس/.test(text)
  const isTense = /\bhai\b|\bhain\b|\bhay\b|ہے|ہیں/.test(text)
  if (owns && isTense) return 'yes'

  return null
}


export const WELCOME_LINES = [
  'Assalam o Alaikum! Foodpanda delivery rider ki job mein khush aamdeed.',
  'Mera naam Rozeena hai. Agar aap achi job dhoondh rahay hain tu Foodpanda delivery rider ki job ke liye apply karein.',
  // The fee is stated before anything is asked for. A rider who learns the
  // price after photographing their CNIC has spent the effort before hearing
  // it, and that is where they walk.
  SAY.docsBriefing.text,
  SAY.briefingNote.text,
]

/**
 * The welcome, exactly as Uplift is given it.
 *
 * Written out rather than converted. The converter is not deterministic — the
 * same sentence came back with two commas one run and none the next, and it
 * kept CNIC after being told not to — and this is the line every rider hears
 * first, so its pauses and pronunciations are pinned by hand.
 *
 * Three things in here are deliberate and easy to undo by accident:
 *
 *   Newlines, not full stops, at the three places a breath belongs. Measured
 *   against this voice: a newline buys about 0.65s of pause, a full stop 0.2s,
 *   and an ellipsis or a dash almost nothing.
 *
 *   "ID card", never CNIC. Read as a word it comes out "sinik".
 *
 *   ڈھونڈ with one ھ. Spelled ڈھونڈھ it is read as "dhunaray".
 *
 * Re-record with: npx tsx scripts/voice.mjs --raw welcome "<this text>"
 */
export const WELCOME_SPOKEN = [
  'السلام علیکم! Foodpanda delivery rider کی job میں، خوش آمدید۔',
  'میرا نام Rozeena ہے۔ اگر آپ اچھی job ڈھونڈ رہے ہیں، تو Foodpanda delivery rider کی job کے لیے apply کریں۔',
  'Registration کے لیے، تین چیزیں چاہئیں۔',
  'پہلی، driving license کی picture۔ دوسری، ID card کی picture۔ تیسری، registration fee پچیس سو روپے۔',
  'یہ foodpanda کی official fee ہے، کسی شخص کو cash نہ دیں۔ میں یہ سب، آپ سے ایک ایک کر کے مانگوں گی۔',
  'اگر آپ کا کوئی سوال ہو، تو نیچے microphone کا button دبا کر، کسی بھی وقت voice note بھیج سکتے ہیں۔',
].join('\n')

/** How the application ended, which decides what the rider is told. */
export type Outcome =
  | 'verified_paid'
  | 'verified_unpaid'
  | 'not_verified'
  | 'not_eligible'

const HOURS = 'Office Peer se Juma, dopahar 12 baje se shaam 6 baje tak khula hai.'

/**
 * The closing message, one of four, from the process document.
 *
 * They differ in what the rider must bring and what is still owed, so telling
 * everyone the same thing would send people to a branch without the documents
 * or the fee that visit depends on. A rider who did not meet a gate is not sent
 * anywhere at all — they are told to come back here.
 */
export function closing(outcome: Outcome, firstName: string, branch?: string): string[] {
  const office = branch ?? OFFICES.f8.address
  const hello = firstName ? `Shukriya ${firstName}!` : 'Shukriya!'

  if (outcome === 'not_eligible')
    return [
      `${hello} Aap ki maloomat mehfooz kar li gayi hai.`,
      'Jab aap ke paas bike aur touch phone dono aa jayen, tab isi chat par message karein — hum wahin se aage barha dein ge.',
    ]

  if (outcome === 'verified_paid')
    return [
      `${hello} Aap ki registration mukammal ho gayi hai aur fee mil gayi hai.`,
      `Ab aap ${office} aa kar apna ID card, delivery bag aur shirt le lein.`,
      HOURS,
    ]

  if (outcome === 'verified_unpaid')
    return [
      `${hello} Aap ke documents check ho gaye hain.`,
      `Apna asli CNIC le kar ${office} aayein aur counter par fee jama kara dein.`,
      HOURS,
    ]

  /**
   * Nobody is sent to a branch on an unverified application. A rider who makes
   * that journey — often across a city, often losing a day's earnings — and is
   * turned away at the counter has paid for our uncertainty. They are told the
   * truth instead: it is being looked at, and we will call.
   */
  return [
    `${hello} Aap ke documents mil gaye hain. Hamari team inhein check kar rahi hai.`,
    'Jab ye mukammal ho jayen ge, hum isi number par aap se raabta karein ge. Abhi office aane ki zaroorat nahi.',
  ]
}

/**
 * The two registration offices, from the process document.
 *
 * The coordinates are approximate — F-8 Markaz and the Marir Chowk end of
 * Murree Road — and only ever used to decide which of two offices is nearer.
 * They are about twelve kilometres apart, so a few hundred metres of error
 * changes nothing; worth replacing with surveyed pins all the same.
 */
export const OFFICES = {
  f8: {
    address:
      'foodpanda office, Office No. 1, First Floor, Al Babar Center, F8 Markaz, Islamabad',
    short: 'F8 Markaz, Islamabad',
    lat: 33.7104,
    lng: 73.0479,
  },
  saddar: {
    address:
      'foodpanda office, Office No. 2, First Floor, Al Naseer Plaza, Marir Metro Station ke paas, Main Murree Road, Rawalpindi',
    short: 'Saddar, Rawalpindi',
    lat: 33.6007,
    lng: 73.0679,
  },
} as const

export type OfficeId = keyof typeof OFFICES

/** Great-circle distance in kilometres. */
export function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/**
 * Which office the rider is closer to. Sent to the branch they can actually
 * reach — the two are twelve kilometres and a motorway apart, and a rider told
 * to cross the city when the other office is nearer has been sent the wrong way.
 */
export function nearestOffice(at: { lat: number; lng: number }): OfficeId {
  return distanceKm(at, OFFICES.f8) <= distanceKm(at, OFFICES.saddar) ? 'f8' : 'saddar'
}

/** A fix vaguer than this says which city, not which office. */
export const VAGUE_METRES = 2000
/** Beyond this, "nearest" is not a useful word. */
export const FAR_KM = 40

/**
 * Whether a pin is good enough to choose an office from.
 *
 * A refusal is obvious. A bad fix is not: an IP-derived position looks
 * identical to a satellite one and can be a city out. So accuracy is checked
 * as well as presence, and a rider far from both is asked rather than told.
 */
export function canPickFrom(at: { lat: number; lng: number; accuracy?: number }): boolean {
  if (at.accuracy != null && at.accuracy > VAGUE_METRES) return false
  const nearest = Math.min(distanceKm(at, OFFICES.f8), distanceKm(at, OFFICES.saddar))
  return nearest <= FAR_KM
}
