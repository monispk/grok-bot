/**
 * Every refusal the rider can see, with the recording that speaks it.
 *
 * These are defined once and imported by the code that sends them, so the text
 * and its audio cannot drift apart. A rider who cannot read the question cannot
 * read why they were turned back either, which is what these recordings fix.
 */
export type Spoken = { text: string; audio: string }

const say = (text: string, audio: string): Spoken => ({ text, audio })

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

const BY_TEXT = new Map(Object.values(SAY).map((s) => [s.text, s.audio]))

/** The recording for a message, if one has been made. */
export const audioForText = (text: string): string | null =>
  BY_TEXT.get(text.trim()) ?? null
