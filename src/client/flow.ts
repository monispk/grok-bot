import {
  audioSources,
  blockedOn,
  branchLines,
  STEP_SPECS,
  submittedLines,
  type Outcome,
  type StepSpec,
} from '../shared/steps.ts'
import {
  CLOSING as QUIZ_CLOSING,
  DECLINED as QUIZ_DECLINED,
  INTRO as QUIZ_INTRO,
  UNCLEAR as QUIZ_UNCLEAR,
  type Question,
} from '../shared/quiz.ts'
import type { FlowState, Message } from './storage.ts'

export type { StepKind, DocKind } from '../shared/steps.ts'

export type Step = StepSpec & { wrong: string }

/**
 * The web app's view of the shared sequence: the same steps, with the retry text
 * composed from what is needed plus the on-screen hint.
 */
export const STEPS: Step[] = STEP_SPECS.map((s) => ({
  ...s,
  wrong: [s.need, s.webHint].filter(Boolean).join(' '),
}))

const bot = (content: string): Message => ({ role: 'assistant', content })

/**
 * A line of ours that has no recording because it is built per rider — it
 * carries their name, or the office they were sent to. `unscripted` hands it
 * to Uplift, so the ending is spoken like everything else.
 *
 * The ending was silent: every other line the bot says is either pre-recorded
 * or comes from the model, and these are neither. Uplift caches by the words,
 * so the office address is read once for everybody.
 */
const spoken = (content: string): Message => ({ role: 'assistant', content, unscripted: true })

/**
 * Whether a step's answer is already on file.
 *
 * Only the typed steps can be answered out of turn, and one of them routinely
 * is: a rider asked for their number says "I have neither" — which is the
 * wallet question's answer, arriving a question early. Asking it anyway told
 * them they had not been listened to, which is exactly what it means.
 *
 * A document, a location or a yes-or-no is not covered: those have to be given
 * when they are asked for, and there is no earlier moment to give them in.
 */
export const alreadyAnswered = (step: Step, f: FlowState): boolean => {
  if (step.id === 'wallet') return !!f.rail
  if (step.id === 'phone') return !!f.phone
  if (step.id === 'name') return !!f.fullName
  return false
}


const voice = (base: string): Message => ({
  role: 'assistant',
  content: '',
  kind: 'audio',
  sources: audioSources(base),
})

/** A step's question, plus its spoken version when it has one. */
export const askMessages = (step: Step): Message[] => [
  bot(step.ask),
  ...(step.audio ? [voice(step.audio)] : []),
]

/**
 * Closing messages. The office line is a placeholder — the nearest branch will
 * be looked up from the GPS fix once that lands.
 */
/** The mandatory training video, which every closing message carries. */
export const TRAINING_VIDEO = 'pofJtK4o2z4'

/**
 * The first half of the ending: how it went, the video, and the offer to take
 * the quiz now. The directions to the office follow later, from `branch`.
 */
export const submitted = (outcome: Outcome, firstName: string): Message[] => [
  ...submittedLines(outcome, firstName).map(spoken),
  {
    role: 'assistant',
    content: '',
    kind: 'video',
    video: TRAINING_VIDEO,
  },
  // Offered after the video, never before: it tests what the video said.
  bot(QUIZ_INTRO),
  voice('/quiz/intro'),
]

/**
 * The second half: where to go, what to bring, what is owed — and the pin,
 * because a rider who has never been to F-8 Markaz needs to see it, not read
 * an address. Every path ends here, exactly once.
 */
export const branch = (
  office: { address: string; short: string; lat: number; lng: number; map: string },
  opts: { owesFee: boolean; waitingFor?: string | null },
): Message[] => [
  ...branchLines(office.address, opts).map(spoken),
  {
    role: 'assistant',
    content: office.short,
    kind: 'location',
    src: office.map,
    place: { lat: office.lat, lng: office.lng, address: office.address },
  },
]

/** A quiz question, numbered so the rider knows how far in they are. */
export const quizAsk = (q: Question, n: number, of: number): Message[] => [
  // The stem alone. The options are buttons under it, one tap each — listed
  // in the bubble as well they were read twice and answered by letter.
  bot(`Sawaal ${n} / ${of}\n\n${q.stem}`),
  voice(`/quiz/${q.id}`),
]

/** One of the three fixed lines around the questions, with its recording. */
export const quizSay = (which: 'closing' | 'declined' | 'unclear'): Message[] => [
  bot({ closing: QUIZ_CLOSING, declined: QUIZ_DECLINED, unclear: QUIZ_UNCLEAR }[which]),
  voice(`/quiz/${which}`),
]

export const thanksName = (firstName: string): Message =>
  bot(firstName ? `Shukriya ${firstName}!` : 'Shukriya!')

export const thanksDoc = (): Message => bot('Shukriya, tasveer mil gayi.')
export const thanksGps = (): Message => bot('Shukriya, location mil gayi.')
