import { audioSources, STEP_SPECS, type StepSpec } from '../shared/steps.ts'
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
