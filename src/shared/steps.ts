/**
 * The application sequence: every question a rider is asked, in order.
 *
 * The prompts live here rather than beside the code that sends them, so the
 * words, the recording that speaks them and the answer that satisfies them
 * stay in one place. Retry text is split in two: `need` states what is
 * required, and `webHint` says how to send it — a rider who has understood the
 * question and cannot find the button needs the second, not the first again.
 */
import { SAY } from './messages.ts'

export type StepKind = 'text' | 'confirm' | 'upload'
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
  /** What is required. */
  need: string
  /** How to send it. */
  webHint?: string
  /**
   * Base path of a spoken version of `ask`, without extension. Many riders read
   * Roman Urdu poorly, so the important questions are also asked aloud.
   */
  audio?: string
}

/** Opus for Android, AAC because iOS Safari will not play Ogg. */
export const audioSources = (base: string) => [
  { src: `${base}.opus`, type: 'audio/ogg; codecs=opus' },
  { src: `${base}.m4a`, type: 'audio/mp4' },
]

const WEB_CLIP =
  'Neeche camera ka nishan daba kar tasveer khenchein, ya clip ka nishan daba kar file chunein.'

export const STEP_SPECS: StepSpec[] = [
  {
    id: 'name',
    kind: 'text',
    audio: '/ask-full_name',
    ask: 'Chalain shuru kartay hain! Aapka poora naam kya hai jo ID Card par likha hai?',
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
  },
  {
    id: 'cnic_front',
    audio: '/ask-cnic_front',
    kind: 'upload',
    doc: 'cnic_front',
    ask: 'Ab apne CNIC ke saamne wale hissay (front) ki tasveer bhejein.',
    need: 'Iske liye CNIC ke front ki tasveer chahiye.',
    webHint: WEB_CLIP,
  },
  {
    // After the CNIC, never before it: the selfie is matched against the
    // photograph on the card, so asking first leaves nothing to match.
    id: 'selfie',
    audio: '/ask-selfie',
    kind: 'upload',
    facing: 'user',
    imageOnly: true,
    ask: 'Ab ek chhoti selfie se aap ki pehchan verify karni hai. Neeche camera ka button dabayen — camera khud khul jayega. Selfie ho jane ke baad main khud aage barh jaungi.',
    need: 'Iske liye aap ki selfie chahiye.',
    webHint: 'Neeche camera ka nishan daba kar apni tasveer khenchein.',
  },
  {
    /*
     * Where the rider lives, typed.
     *
     * This was a "send your location" button. On the handsets riders actually
     * use it was the least reliable thing in the flow: a GPS chip that never
     * fixes indoors, an in-app browser that never asks for the permission, a
     * position derived from the phone network that put a rider in the wrong
     * city. Every one of those failures landed on the last step, after three
     * documents had already been sent.
     *
     * A rider knows which city they live in. Asking them is shorter, works on
     * every phone, and gives an answer that can be counted afterwards.
     */
    id: 'city',
    kind: 'text',
    ask: 'Aakhri sawal. Aap kis sheher mein rehte hain?',
    need: 'Baraye meherbani apne sheher ka naam likhein.',
    webHint: '',
  },
]


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

/**
 * Whether two names are the same person's, as riders type them: "Monis Ur
 * Rahmaan" and "monis rahman" are. Letters only, case folded, then close
 * enough on edit distance — one dropped vowel or doubled letter is not a
 * different person, but "Ali Raza" and "Bilal Raza" are.
 */
export function sameName(a: string, b: string): boolean {
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z\u0600-\u06ff]/g, '')
  const x = norm(a)
  const y = norm(b)
  if (!x || !y) return false
  if (x === y) return true
  // The first name alone matches too, when the rest is missing: a rider who
  // gave "Monis Ur Rahmaan" and comes back as "Monis".
  const first = (t: string) => t.toLowerCase().trim().split(/\s+/)[0] ?? ''
  if (first(a).length >= 4 && first(a) === first(b) && (x.startsWith(y) || y.startsWith(x))) return true
  return similarity(x, y) >= 0.8
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
 * Removes a question the model has asked the rider.
 *
 * The prompt forbids it — "jawab ke baad apni taraf se koi naya sawal na
 * poochein" — and it asks anyway. A rider who asked "konsa account?" was asked
 * "Aap ke paas kaun sa account hai?" straight back, and then asked for their
 * number by the flow: three questions deep with nothing answered.
 *
 * A sentence has to both end in a question mark and address the rider before it
 * is dropped, so an answer that quotes a question survives.
 */
export function stripAskBack(reply: string): string {
  const parts = reply.split(/(?<=[.?!؟۔])\s+|\n+/).filter((p) => p.trim())
  const asksBack = (p: string) => /[?؟]/.test(p) && /\baap\b|آپ/i.test(p)
  // "(Sirf ek batayein)." was the aside left behind when the question in front
  // of it went, which reads as a stray instruction to nobody.
  const aside = (p: string) => /^\(.*\)\s*[.۔]?$/.test(p.trim())
  // Only from the end. A model that asks a question of its own puts it last,
  // and taking them wherever they fell also took answers that quote the
  // rider's own question back to them — "Aap ne poocha 'salary kitni hai?'" —
  // which is the whole answer gone.
  const kept = [...parts]
  while (kept.length && (asksBack(kept[kept.length - 1]!) || aside(kept[kept.length - 1]!)))
    kept.pop()
  return kept.join(' ').trim()
}

/**
 * Removes a sentence in which the model claims to have received something.
 *
 * It never has. Documents go to the server, which checks them and says so in
 * its own words; the model sees only text. Handed the word "Sent" at the
 * licence step it wrote "Aapka license front tasveer mil gaya" and went on to
 * the deposit — and a rider who has just been told their licence arrived has
 * no reason to send it. The prompt forbids this too; this is the part that
 * cannot be ignored.
 */
export function stripReceipt(reply: string): string {
  const got = /mil\s*ga(?:ya|yi|ye|i)|receiv|mausool|موصول|مل\s*گ(?:یا|ئی|ئے)/i
  const thing =
    /tasveer|tasvir|photo|picture|document|license|licence|cnic|selfie|card|file|bill|location|تصویر|لائسنس|کارڈ/i
  const parts = reply.split(/(?<=[.?!؟۔])\s+|\n+/).filter((p) => p.trim())
  return parts.filter((p) => !(got.test(p) && thing.test(p))).join(' ').trim()
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
/**
 * Urdu question words, matched whole.
 *
 * As a plain alternation these matched inside other words, and the other words
 * a rider produces are not the ones you would write down: Whisper transcribed
 * "JazzCash account" as جاس کیاش ایک انٹ, and کیاش contains کیا. A rider
 * answering "I have neither" was read as asking a question, told at length to
 * go and open an account, and then asked for their number again.
 */
const URDU_ASKS = new Set([
  'کیا', 'کیسے', 'کیسا', 'کیسی', 'کتنا', 'کتنی', 'کتنے',
  'کب', 'کہاں', 'کیوں', 'کیون', 'کون', 'کونسا', 'کونسی',
  'سیلری', 'تنخواہ',
])

export function asksSomething(text: string): boolean {
  // Splitting on everything that is not a letter or a digit keeps Urdu words
  // whole; \b does not, because it is defined on Latin word characters.
  if (text.split(/[^\p{L}\p{N}]+/u).some((w) => URDU_ASKS.has(w))) return true

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

/**
 * "nahin", however it is spelled.
 *
 * Riders drop vowels wherever they like: nahi, nahin, nhi, nhn, nah, nahen.
 * A fixed list of spellings missed "nhn", so "dono nhn hain" lost its negative,
 * "dono" won, and a rider with neither account was recorded as having both —
 * which at the end of the flow would have charged them through a wallet they
 * had just said twice they did not have.
 *
 * Matched on the consonants instead: n, then h, then an optional closing n,
 * with vowels anywhere. The token must start with n, so "in" and "hain" are
 * left alone.
 */
const NEGATIVE_SHAPE = /^n[aeiou]*h[aeiou]*n?$/

/**
 * "I don't know" / "I didn't understand", which is not an answer at all.
 *
 * Counted as a refusal it records a rider as having no wallet, or no bike,
 * because they were unsure what was being asked. The list of exact phrases this
 * used to be missed "pata nhi" — the same word, three letters shorter — so it
 * is built from the unsure word plus any spelling of the negative instead.
 */
const UNSURE_WORD = /\b(pata|pta|maloom|malum|samajh|samjh|smjh|samjha)\b/
const UNSURE_URDU = /سمجھ|پتہ|پتا|معلوم/

export function saysUnsure(text: string): boolean {
  const t = text.toLowerCase()
  if (UNSURE_WORD.test(t) && saysNo(t, ['no'])) return true
  return UNSURE_URDU.test(text) && /نہیں|نہ\b/.test(text)
}

/**
 * "I don't have one", said to a step that asked for a document.
 *
 * A rider without a driving licence told us so three times — twice by voice,
 * once in English — and each time was handed the same line about pressing the
 * camera button. Nothing in the flow could hear a refusal at an upload step,
 * because an upload step only ever expected a file.
 *
 * The negative is never enough on its own: "nahi samajh aaya" is not a rider
 * without a licence. So it wants a denial plus either something about having
 * or not having, or a message short enough that at "send me a photograph of
 * your licence" it can only mean one thing.
 */
const OWNS = /\b(paas|pas|pass|have|has|had|got|own|owns|licence|license|card|cnic)\b/
const OWNS_URDU = /پاس|لائسنس|لائسینس|لیسنز|لایسنس|شناختی|کارڈ/

export function saysHasnt(text: string): boolean {
  // "pata nahi" is a rider who did not understand, not one without a licence.
  if (saysUnsure(text)) return false

  const t = text.toLowerCase().replace(/['’]/g, '')
  const denied =
    /نہیں|نہ\b|نا\b/.test(text) ||
    saysNo(t, ['nai', 'nay', 'no', 'none', 'nope', 'not', 'dont', 'doesnt', 'havent', 'without'])
  if (!denied) return false

  if (OWNS.test(t) || OWNS_URDU.test(text)) return true
  return t.split(/\s+/).filter(Boolean).length <= 5
}

export function saysNo(text: string, extra: readonly string[] = []): boolean {
  const words = text.toLowerCase().split(/[^a-z]+/).filter(Boolean)
  return words.some((w) => NEGATIVE_SHAPE.test(w) || extra.includes(w))
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
  if (saysUnsure(text)) return null

  // Not 'na' or a bare 'n': "easypaisa hai na" is a rider agreeing, and both
  // would have read it as a denial.
  const denied =
    saysNo(text, ['nai', 'nay', 'no', 'none', 'neither', 'nope']) || has('نہیں', 'کوئی')
  const both = has('dono', 'donon', 'both', 'دونوں')

  /*
   * Whisper writes these in Urdu, and never the same way twice. JazzCash comes
   * back as جیز کیش, جیس کیش, جاز کیش — two words, sometimes one, and the
   * variation is all in the first half. Matching the first half is what this
   * did, against the single spelling جاز, so a rider who said "جیس کیش" was
   * asked the same question until they gave up.
   *
   * The second half does not vary, and belongs to nothing else a rider says
   * here: کیش is cash and پیس is paisa. Those are what is matched, alongside
   * whatever Latin the rider might type.
   */
  const easypaisa =
    has('easypaisa', 'easy', 'ep', 'ایزی') || /easy\s*pai?sa/i.test(text) || /پیس/.test(text)
  const jazzcash =
    has('jazzcash', 'jazz', 'jaz', 'jc', 'جاز') ||
    /ja?zz?\s*(cash|kash)/i.test(text) ||
    /ک[یي]ش/.test(text)

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
  if (saysUnsure(text)) return null

  // Negation first, otherwise. "mere paas nahi hai" carries every word that
  // means yes and one that means no, and the no is the answer.
  if (/نہیں|نہ\b|نا\b/.test(text)) return 'no'
  if (saysNo(text) || said('nai', 'no', 'nope', 'na', 'n')) return 'no'

  if (/ہاں|جی|بالکل|ضرور|آہ/.test(text)) return 'yes'
  // "y" and "n" included: a rider on a phone keyboard types the shortest thing
  // that could work, and being told it was not understood is a poor reward.
  if (
    said('haan', 'han', 'hann', 'ji', 'jee', 'g', 'yes', 'yep', 'yup', 'y', 'ok', 'okay',
         'theek', 'bilkul', 'zaroor', 'aah', 'ah', 'ahan')
  )
    return 'yes'

  // What follows is weak evidence — "hai" is also the verb in every question
  // ("salary kitni milti hai?") — so a question with nothing stronger in it is
  // not an answer. "salary kitni milti hai" was read as yes to owning a
  // smartphone, thanked, and the flow moved on.
  if (asksSomething(text)) return null
  if (said('hai')) return 'yes'

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
  'السلام علیکم! Foodpanda delivery rider کی job میں خوش آمدید۔',
  'میرا نام Rozeena ہے۔ اگر آپ اچھی job ڈھونڈ رہے ہیں، تو Foodpanda delivery rider کی job کے لیے apply کریں۔',
  'Registration کے لیے، تین چیزیں چاہئیں۔',
  'پہلی، driving license کی picture۔ دوسری، ID card کی picture۔ تیسری، registration fee پچیس سو روپے۔',
  'یہ foodpanda کی official fee ہے، کسی شخص کو cash نہ دیں۔ میں یہ سب، آپ سے ایک ایک کر کے مانگوں گی۔',
  'اگر آپ کا کوئی سوال ہو، تو نیچے microphone کا button دبائے رکھ کر، کسی بھی وقت voice note بھیج سکتے ہیں۔',
].join('\n')

/**
 * The first question, exactly as Uplift is given it.
 *
 * Pinned by hand for the same reasons as WELCOME_SPOKEN above: "ID Card" rather
 * than CNIC, which is read as the word "sinik", and a newline after the opening
 * so the rider gets a beat before the question rather than one run-on breath.
 *
 * The question mark is the ASCII one. Given the Urdu ؟ this voice ends the
 * sentence flat, as a statement.
 *
 * Re-record with: npx tsx scripts/voice.mjs --raw ask-full_name "<this text>"
 */
export const NAME_SPOKEN = [
  'چلیں شروع کرتے ہیں!',
  'آپ کا پورا نام کیا ہے جو ID Card پر لکھا ہے?',
].join('\n')

/** The wallet's name as a person writes it, not as the code spells it. */
export const railName = (rail: string): string =>
  rail === 'jazzcash' ? 'JazzCash' : rail === 'easypaisa' ? 'Easypaisa' : rail

/**
 * The moment the money lands.
 *
 * Said in full — the amount, which wallet, and the number to quote — because
 * this is the one point in the conversation where a rider has parted with
 * money and has nothing yet to show for it. "Fee mil gayi" alone leaves them
 * with no reference if anything is ever disputed at the office.
 *
 * Rupees the way they are said aloud: "pachees sau", not "2,500", which the
 * voice reads as a string of digits.
 */
export function feeReceivedLine(rail: string, ref: string): string {
  const wallet = railName(rail)
  const where = wallet ? ` aap ke ${wallet} account se` : ''
  const number = ref ? ` Confirmation number: ${ref}.` : ''
  return `Fee mil gayi hai! Pachees sau rupay${where} wasool ho gaye hain.${number}`
}

/** How the application ended, which decides what the rider is told. */
export type Outcome =
  | 'verified_paid'
  | 'verified_unpaid'
  | 'not_verified'
  | 'not_eligible'

const HOURS = 'Office Peer se Juma, dopahar 12 baje se shaam 6 baje tak khula hai.'

/**
 * The end of the application.
 *
 * One line, and it is the good news: the rider is congratulated and told their
 * application is registered. Everything else — where to go, what to bring, the
 * video, the questions — follows in a fixed order from `inviteLines` on.
 */
export function submittedLines(outcome: Outcome, firstName: string): string[] {
  const hello = firstName ? `Mubarak ho ${firstName}!` : 'Mubarak ho!'
  const how =
    outcome === 'verified_paid'
      ? 'Aap ke documents check ho gaye hain aur fee bhi mil gayi hai.'
      : outcome === 'verified_unpaid'
        ? 'Aap ke documents check ho gaye hain.'
        : outcome === 'not_verified'
          ? 'Aap ke documents mil gaye hain — inhein office par check kiya jaye ga.'
          : 'Aap ki maloomat mehfooz kar li gayi hai.'
  return [`${hello} Aap ki application register ho gayi hai. ${how}`]
}

/** Said once the office has been given, never before it. */
export const WATCH_VIDEO = 'Office aane se pehle, ye training video zaroor dekh lein.'

export type InviteOpts = {
  owesFee: boolean
  waitingFor?: string | null
  licenceExpired?: boolean
  /** Two photographs and the reader still could not be sure of the card. */
  licenceUnread?: boolean
}

/**
 * What the rider is still waiting on, in the words they used to say it.
 *
 * An expired licence belongs on this list rather than among the refusals: it
 * is not a bad photograph and another upload cannot fix it. The rider has to
 * go and renew the card, and until they have, there is nothing the office can
 * do for them either — the same shape as waiting on a bike.
 */
export function blockedOn(
  missing: string[],
  opts: { licenceExpired?: boolean; licenceUnread?: boolean } = {},
): string | null {
  const o = opts
  const parts: string[] = []
  if (missing.includes('bike')) parts.push('apni bike')
  if (missing.includes('smartphone')) parts.push('touch phone')
  if (missing.includes('license_front')) parts.push('apna driving license')
  if (missing.includes('cnic_front')) parts.push('apna CNIC')
  if (o.licenceExpired && !missing.includes('license_front')) parts.push('naya license')
  if (parts.length === 0) return null
  if (parts.length === 1) return parts[0]!
  return `${parts.slice(0, -1).join(', ')} aur ${parts[parts.length - 1]}`
}

/** What to carry, beyond the CNIC that everybody brings. */
function alsoBring(opts: InviteOpts): string {
  if (opts.licenceExpired) return ' aur apna naya license'
  if (opts.licenceUnread) return ' aur apna asli driving license'
  return ''
}

/**
 * The invitation to the office. One shape, wherever the conversation reaches it.
 *
 * The order is the point. A rider who has just spent ten minutes and two and a
 * half thousand rupees is congratulated and told where to go first — address,
 * hours, what to bring, and the pin — and only then asked to watch a video and
 * answer questions. It used to run the other way round: good news, video, ten
 * questions, directions last, by which time a rider who had stopped reading
 * had the one thing they needed sitting below the fold.
 *
 * The fee is named only when it is still owed. Telling a rider who has already
 * paid to bring money is how a rider gets asked for it twice.
 */
export function inviteLines(office: string, opts: InviteOpts): string[] {
  const lines: string[] = []
  lines.push(
    opts.waitingFor
      ? `Jab aap ke paas ${opts.waitingFor} aa jaye, to is office aayein:`
      : 'Ab apni registration mukammal karne ke liye is office aayein:',
  )
  lines.push(office)
  lines.push(HOURS)
  lines.push(`Apna asli CNIC${alsoBring(opts)} saath laayein — office par dikhana hoga.`)
  if (opts.owesFee)
    lines.push('Registration fee pachees sau rupay office ke counter par jama karayein.')
  return lines
}

/**
 * The last word, after the questions are answered or declined.
 *
 * Short, and the office once more: the rider is about to close the tab, and
 * the only thing that has to survive that is where to go and what to carry.
 */
export function farewellLines(opts: InviteOpts): string[] {
  return [
    `Bas! Office zaroor aayein, apna asli CNIC${alsoBring(opts)} le kar — wahan aap ka registration mukammal ho jaye ga.`,
    HOURS,
  ]
}

/**
 * The two registration offices, from the process document.
 *
 * The coordinates are the offices themselves, given by Rozee. They were my
 * own approximations until a rider was going to be shown the pin and walk to
 * it — a use that will not tolerate being half a kilometre out.
 */
export const OFFICES = {
  f8: {
    address:
      'foodpanda office, Office No. 1, First Floor, Al Babar Center, F8 Markaz, Islamabad',
    short: 'F8 Markaz, Islamabad',
    city: 'Islamabad',
    map: '/office-f8.jpg',
    lat: 33.7125,
    lng: 73.0373,
  },
  saddar: {
    address:
      'foodpanda office, Office No. 2, First Floor, Al Naseer Plaza, Marir Metro Station ke paas, Main Murree Road, Rawalpindi',
    short: 'Saddar, Rawalpindi',
    city: 'Rawalpindi',
    map: '/office-saddar.jpg',
    lat: 33.5995,
    lng: 73.0627,
  },
} as const

export type OfficeId = keyof typeof OFFICES

/** The cities an office is actually in. */
export const OFFICE_CITIES = [...new Set(Object.values(OFFICES).map((o) => o.city))]

/** The branches in one city, in the order they are listed above. */
export const officesIn = (city: string): OfficeId[] =>
  (Object.keys(OFFICES) as OfficeId[]).filter((id) => OFFICES[id].city === city)

/** Every branch, for a rider whose own city has none. */
export const ALL_OFFICES = Object.keys(OFFICES) as OfficeId[]

/** The button a rider taps when none of the offices will do. */
export const NO_OFFICE = 'In mein se koi nahi'

/**
 * Which branches to offer, and what to say before offering them.
 *
 * A rider in a city we are in picks between that city's branches. A rider
 * anywhere else is told plainly that we are not in their city — not left to
 * work it out from a list of two places they have never heard of — and then
 * offered the same list with a way out at the bottom.
 */
export function officeChoice(city: string): {
  offices: OfficeId[]
  say: string
  wayOut: boolean
} {
  const here = officesIn(city)
  if (here.length)
    return {
      offices: here,
      say:
        here.length === 1
          ? `Achha, ${city}! Aap ka foodpanda office ye hai — neeche daba kar confirm karein.`
          : `Achha, ${city}! Aap kaunse office aana pasand karein ge? Neeche se chunein.`,
      wayOut: false,
    }
  return {
    offices: ALL_OFFICES,
    say: `Maaf kijiye, ${city} mein filhaal hamara koi office nahi hai. Lekin aap neeche diye gaye offices mein se kisi ek ko chun sakte hain.`,
    wayOut: true,
  }
}

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
  return whyNotPick(at) === null
}

/**
 * Why a pin cannot choose an office, because the two reasons deserve
 * different words. A vague fix is "never mind, tell us"; a rider in Lahore is
 * "we have your location, and you are far from both — which will you come
 * to?". Told the first when the second was true, a rider took it to mean their
 * tap had not counted.
 */
export function whyNotPick(at: { lat: number; lng: number; accuracy?: number }): 'vague' | 'far' | null {
  if (at.accuracy != null && at.accuracy > VAGUE_METRES) return 'vague'
  const nearest = Math.min(distanceKm(at, OFFICES.f8), distanceKm(at, OFFICES.saddar))
  return nearest <= FAR_KM ? null : 'far'
}
