import type { Message } from './storage.ts'

export type StepKind = 'text' | 'upload' | 'gps'

export type DocKind = 'cnic_front' | 'cnic_back' | 'license' | 'bill'

export type Step = {
  id: string
  kind: StepKind
  /** Which document the server should verify this upload as. */
  doc?: DocKind
  /** Which camera to open. 'user' is the selfie camera. */
  facing?: 'user' | 'environment'
  /** Selfies must be photographs, not a PDF picked from storage. */
  imageOnly?: boolean
  /** The canned question. No model call — instant, and always identical. */
  ask: string
  /** Said when the wrong sort of input arrives, before re-asking. */
  wrong: string
}

const CLIP =
  'Neeche camera ka nishan daba kar tasveer khenchein, ya clip ka nishan daba kar file chunein.'

/**
 * The application sequence. Code walks this list; the model never sees it and
 * cannot skip, reorder or invent a step. A step only advances when the right
 * kind of input actually arrives.
 */
export const STEPS: Step[] = [
  {
    id: 'name',
    kind: 'text',
    ask: 'Aapka poora naam jo CNIC par hai, kya hai?',
    wrong: 'Baraye meherbani apna poora naam likh kar bhejein.',
  },
  {
    id: 'selfie',
    kind: 'upload',
    facing: 'user',
    imageOnly: true,
    ask: 'Ab apni aik selfie khenchein. Camera ka button dabayein aur apna chehra saaf dikhayein.',
    wrong:
      'Iske liye aap ki selfie chahiye. Neeche camera ka nishan daba kar apni tasveer khenchein.',
  },
  {
    id: 'license_front',
    kind: 'upload',
    doc: 'license',
    ask: 'Ab apne driving license ke saamne wale hissay (front) ki tasveer bhejein.',
    wrong: `Iske liye driving license ke front ki tasveer chahiye. ${CLIP}`,
  },
  {
    id: 'cnic_front',
    kind: 'upload',
    doc: 'cnic_front',
    ask: 'Ab apne CNIC ke saamne wale hissay (front) ki tasveer bhejein.',
    wrong: `Iske liye CNIC ke front ki tasveer chahiye. ${CLIP}`,
  },
  {
    id: 'cnic_back',
    kind: 'upload',
    doc: 'cnic_back',
    ask: 'Ab apne CNIC ke peechay wale hissay (back) ki tasveer bhejein.',
    wrong: `Iske liye CNIC ke back ki tasveer chahiye. ${CLIP}`,
  },
  {
    id: 'utility_bill',
    kind: 'upload',
    doc: 'bill',
    ask: 'Ab apne ghar ka utility bill (bijli, gas ya paani) ki tasveer bhejein jis par aap ke rehne ka pata likha ho. Bill pichlay teen mahine ke andar ka hona chahiye. Bill kisi aur ke naam par ho to bhi theek hai.',
    wrong: `Iske liye utility bill ki tasveer chahiye jis par pata likha ho. ${CLIP}`,
  },
  {
    id: 'gps',
    kind: 'gps',
    ask: 'Aakhri kaam. Apni location bhejein taake hum aap ko sab se qareeb foodpanda office bata sakein. Neeche "Location bhejein" ka button dabayein.',
    wrong: 'Iske liye aap ki location chahiye. Neeche "Location bhejein" ka button dabayein.',
  },
]

const bot = (content: string): Message => ({ role: 'assistant', content })

/**
 * Closing messages. The office line is a placeholder — the nearest branch will
 * be looked up from the GPS fix once that lands.
 */
export const finished = (firstName: string, address?: string): Message[] => [
  bot(
    firstName
      ? `Mubarak ho ${firstName}! Aap ki application manzoor ho gayi hai.`
      : 'Mubarak ho! Aap ki application manzoor ho gayi hai.',
  ),
  ...(address ? [bot(`Aap ka pata jo bill par mila: ${address}`)] : []),
  bot(
    'Ab aap foodpanda office aa kar apni uniform lein aur training mukammal karein. Office Peer se Juma, dopahar 12 baje se shaam 6 baje tak khula hai.',
  ),
]

export const thanksName = (firstName: string): Message =>
  bot(firstName ? `Shukriya ${firstName}!` : 'Shukriya!')

export const thanksDoc = (): Message => bot('Shukriya, tasveer mil gayi.')
export const thanksGps = (): Message => bot('Shukriya, location mil gayi.')
