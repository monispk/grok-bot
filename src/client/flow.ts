import { audioSources, closing, STEP_SPECS, type Outcome, type StepSpec } from '../shared/steps.ts'
import type { Message } from './storage.ts'

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
]

export const thanksName = (firstName: string): Message =>
  bot(firstName ? `Shukriya ${firstName}!` : 'Shukriya!')

export const thanksDoc = (): Message => bot('Shukriya, tasveer mil gayi.')
export const thanksGps = (): Message => bot('Shukriya, location mil gayi.')
