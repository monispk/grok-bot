import { audioSources, closing, STEP_SPECS, type Outcome, type StepSpec } from '../shared/steps.ts'
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
 * The closing, in one of four shapes, each ending with the training video —
 * the one thing every rider is given regardless of how their application went.
 */
export const finished = (outcome: Outcome, firstName: string, branch?: string): Message[] => [
  ...closing(outcome, firstName, branch).map(bot),
  {
    role: 'assistant',
    content: '',
    kind: 'video',
    video: TRAINING_VIDEO,
  },
  // Offered after the video, never before: it tests what the video said. Not
  // offered at all to a rider who did not meet a gate — they have been told to
  // come back when they have the bike or the phone, and a quiz on top of that
  // is noise.
  ...(outcome === 'not_eligible' ? [] : [bot(QUIZ_INTRO), voice('/quiz/intro')]),
]

/** A quiz question, numbered so the rider knows how far in they are. */
export const quizAsk = (q: Question, n: number, of: number): Message[] => [
  bot(
    `Sawaal ${n} / ${of}\n\n${q.stem}\n\n` +
      q.options.map((o) => `**${o.key})** ${o.text}`).join('\n'),
  ),
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
