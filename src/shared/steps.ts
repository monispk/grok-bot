/**
 * The application sequence, shared by the web app and the WhatsApp bot.
 *
 * Prompts live here once so the two transports cannot drift apart. Retry text is
 * split: `need` states what is required and is identical everywhere, while the
 * hint that tells someone *how* to send it differs — the web app has an on-screen
 * camera button, WhatsApp has its own attachment menu, and telling a WhatsApp
 * user to press a button that isn't there would be worse than saying nothing.
 */
export type StepKind = 'text' | 'upload' | 'gps'
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
export const TYPE_NAME_PLEASE =
  'Baraye meherbani apna naam likh kar bhejein — voice note ya tasveer nahi. Baaqi sawalon ke jawab aap voice note se bhi de saktay hain, lekin naam likhna zaroori hai.'

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
