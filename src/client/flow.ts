import type { Message } from './storage.ts'

export type StepKind = 'text' | 'upload' | 'gps'

export type Step = {
  id: string
  kind: StepKind
  /** The canned question. No model call — instant, and always identical. */
  ask: string
  /** Said when the wrong sort of input arrives, before re-asking. */
  wrong: string
}

const CLIP = 'Neeche clip (📎) ka nishan daba kar tasveer chunein.'

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
    id: 'license_front',
    kind: 'upload',
    ask: 'Ab apne driving license ke saamne wale hissay (front) ki tasveer bhejein.',
    wrong: `Iske liye driving license ke front ki tasveer chahiye. ${CLIP}`,
  },
  {
    id: 'cnic_front',
    kind: 'upload',
    ask: 'Ab apne CNIC ke saamne wale hissay (front) ki tasveer bhejein.',
    wrong: `Iske liye CNIC ke front ki tasveer chahiye. ${CLIP}`,
  },
  {
    id: 'cnic_back',
    kind: 'upload',
    ask: 'Ab apne CNIC ke peechay wale hissay (back) ki tasveer bhejein.',
    wrong: `Iske liye CNIC ke back ki tasveer chahiye. ${CLIP}`,
  },
  {
    id: 'utility_bill',
    kind: 'upload',
    ask: 'Ab apne ghar ka utility bill (bijli, gas ya paani) ki tasveer bhejein jis par aap ke rehne ka pata likha ho. Bill kisi aur ke naam par ho to bhi theek hai.',
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
export const finished = (firstName: string): Message[] => [
  bot(
    firstName
      ? `Mubarak ho ${firstName}! Aap ki application manzoor ho gayi hai.`
      : 'Mubarak ho! Aap ki application manzoor ho gayi hai.',
  ),
  bot(
    'Ab aap foodpanda office aa kar apni uniform lein aur training mukammal karein. Office Peer se Juma, dopahar 12 baje se shaam 6 baje tak khula hai.',
  ),
]

export const thanksName = (firstName: string): Message =>
  bot(firstName ? `Shukriya ${firstName}!` : 'Shukriya!')

export const thanksDoc = (): Message => bot('Shukriya, tasveer mil gayi.')
export const thanksGps = (): Message => bot('Shukriya, location mil gayi.')
