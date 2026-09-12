/**
 * Every refusal the rider can see, with the recording that speaks it.
 *
 * These are defined once and imported by the code that sends them, so the text
 * and its audio cannot drift apart. A rider who cannot read the question cannot
 * read why they were turned back either, which is what these recordings fix.
 */
export type Spoken = { text: string; audio: string; recorded: boolean }

/**
 * `recorded: false` marks a line that is written but not yet voiced. It is sent
 * as text only, so the rider never meets a player that cannot play: a missing
 * file 404s, and the bubble removes itself and leaves a silent gap.
 */
const say = (text: string, audio: string, recorded = true): Spoken => ({
  text,
  audio,
  recorded,
})

export const SAY = {
  photoUnclear: say(
    'Tasveer saaf nahi aayi. Camera ko seedha rakh kar, achi roshni mein dobara khenchein.',
    '/say-photo-unclear',
  ),
  billTooOld: say(
    'Ye bill teen mahine se purana hai. Baraye meherbani pichlay teen mahine ka bill bhejein.',
    '/say-bill-too-old',
  ),
  cnicMismatch: say(
    'Is document par CNIC number aap ke CNIC se match nahi kar raha. Baraye meherbani sahi document bhejein.',
    '/say-cnic-mismatch',
  ),
  notCnicFront: say(
    'Ye CNIC ke saamne wali tasveer nahi lag rahi. Baraye meherbani CNIC ka front, achi roshni mein, dobara bhejein.',
    '/say-not-cnic-front',
  ),
  notCnicBack: say(
    'Ye CNIC ke peechay wali tasveer nahi lag rahi. Baraye meherbani CNIC ka back, achi roshni mein, dobara bhejein.',
    '/say-not-cnic-back',
  ),
  notLicense: say(
    'Ye driving license ki tasveer nahi lag rahi. Baraye meherbani license ka front, achi roshni mein, dobara bhejein.',
    '/say-not-license',
  ),
  billNoDate: say(
    'Is bill par due date nahi mil saki. Baraye meherbani poora bill, achi roshni mein, dobara bhejein.',
    '/say-bill-no-date',
  ),
  typeName: say(
    'Baraye meherbani apna naam likh kar bhejein, voice note ya tasveer nahi. Baaqi sawalon ke jawab aap voice note se bhi de saktay hain, lekin naam likhna zaroori hai.',
    '/say-type-name',
  ),
  badFileType: say(
    'Ye file qabool nahi ho saki. Sirf JPG, PNG, GIF ya PDF bhejein.',
    '/say-bad-file-type',
  ),
  fileTooBig: say(
    'File bohat bari hai. 10 MB se choti file bhejein.',
    '/say-file-too-big',
  ),
  uploadFailed: say(
    'File bhejne mein masla hua. Dobara koshish karein.',
    '/say-upload-failed',
  ),
  voiceUnclear: say(
    'Aap ki awaaz saaf nahi aayi. Baraye meherbani dobara bolein, ya likh kar bhejein.',
    '/say-voice-unclear',
  ),
  micDenied: say(
    'Microphone ki ijazat nahi mili. Baraye meherbani apne phone mein microphone ki ijazat dein, ya apna jawab likh kar bhejein.',
    '/say-mic-denied',
  ),
  /**
   * The rider says they have neither wallet. The number is still wanted — it
   * is how anyone reaches them — and the wallet check simply comes back
   * unchecked. Repeating the original question here would only ask again about
   * the accounts they have just said they do not have.
   */
  noWallet: say(
    'Koi baat nahi. Phir bhi apna mobile number bhejein, hum isi number par aap se raabta karein ge.',
    '/say-no-wallet',
  ),
  underReview: say(
    'Aap ke documents mil gaye hain. Hamari team inhein check kar rahi hai. Jab ye mukammal ho jayen ge, hum isi number par aap se raabta karein ge. Abhi office aane ki zaroorat nahi.',
    '/say-under-review',
  ),
  needBike: say(
    'Is kaam ke liye apni bike zaroori hai. Jab aap ke paas bike ho, tab dobara raabta karein — hum aap ki madad karein ge.',
    '/say-need-bike',
  ),
  /**
   * What follows a missing phone or bike. The rider is not turned away: their
   * details are worth keeping, and they are told to come back to this same
   * chat when they have the thing.
   */
  knockoutAck: say(
    'Theek hai, note kar liya. Abhi aap apne documents jama kara dein — jab aap ke paas ye cheez aa jaye, tab isi chat par aa kar registration mukammal kar lijiye ga.',
    '/say-knockout-ack',
  ),
  selfieRetry: say(
    'Selfie match nahi hui. Baraye meherbani neeche button daba kar dobara selfie khenchein — achi roshni mein, seedha camera ki taraf dekh kar.',
    '/say-selfie-retry',
  ),
  repeat: say(
    'Maazrat, samajh nahi aaya. Baraye meherbani dobara likhein.',
    '/say-repeat',
  ),
  /** Said once, before anything is asked for, so the fee is never a surprise. */
  docsBriefing: say(
    'Registration mukammal karne ke liye do cheezein chahiye:\n1. License ki picture\n2. CNIC ki picture\n\nRegistration fee Rs. 2,500 hai. Yeh foodpanda ki official fee hai — kisi shakhs ko cash na dein.\n\nMain ye sab aap se ek ek kar ke maangungi.',
    '/say-docs-briefing',
  ),
  askWalletRail: say(
    'Aap ke paas Easypaisa hai ya JazzCash?',
    '/ask-wallet-rail',
  ),
  railComingSoon: say(
    'JazzCash par ye sahulat abhi jald aa rahi hai. Filhaal Easypaisa se ho sakti hai — kya Easypaisa se jama kar dein? Warna aap office par counter par bhi de saktay hain.',
    '/say-rail-coming-soon',
  ),
  okDocument: say('Shukriya, tasveer mil gayi.', '/ok-document'),
  okLocation: say('Shukriya, location mil gayi.', '/ok-location'),
  okSmartphone: say('Theek hai.', '/ok-smartphone'),
  needSmartphone: say(
    'Is kaam ke liye bara screen wala touch phone zaroori hai. Jab aap ke paas aisa phone ho, tab dobara raabta karein — hum aap ki madad karein ge.',
    '/say-need-smartphone',
  ),
  // Worded without reference to a button, so one recording serves both the web
  // app and WhatsApp.
  locationDenied: say(
    'Location nahi mil saki. Baraye meherbani apne phone mein location ki ijazat dein, phir dobara koshish karein.',
    '/say-location-denied',
  ),
} as const

const BY_TEXT = new Map(
  Object.values(SAY)
    .filter((s) => s.recorded)
    .map((s) => [s.text, s.audio]),
)

const UNRECORDED = new Set(
  Object.values(SAY)
    .filter((s) => !s.recorded)
    .map((s) => s.text),
)

/**
 * A line that is ours but has no recording yet. Those are read aloud by Uplift
 * instead, so the rider hears them like everything else.
 */
export const awaitingVoice = (text: string): boolean => UNRECORDED.has(text.trim())

/** The recording for a message, if one has been made. */
export const audioForText = (text: string): string | null =>
  BY_TEXT.get(text.trim()) ?? null
