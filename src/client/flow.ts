import {
  audioSources,
  farewellLines,
  inviteLines,
  STEP_SPECS,
  submittedLines,
  WATCH_VIDEO,
  type InviteOpts,
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
import { SAY } from '../shared/messages.ts'
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
export const spoken = (content: string): Message => ({ role: 'assistant', content, unscripted: true })

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

/**
 * A step's question, and its voice.
 *
 * A recording where one has been made, and Uplift where one has not. The
 * alternative was a step naming a clip that does not exist: the bubble 404s
 * and removes itself, so the question arrives silently — which for the rider
 * this is built for is the question not arriving at all.
 */
export const askMessages = (step: Step): Message[] =>
  step.audio ? [bot(step.ask), voice(step.audio)] : [spoken(step.ask)]

/** The mandatory training video, which every closing message carries. */
export const TRAINING_VIDEO = 'pofJtK4o2z4'

export type Office = {
  address: string
  short: string
  lat: number
  lng: number
  map: string
}

/**
 * The pin: a picture of the street, and a tap that opens Google Maps.
 *
 * A rider who has never been to F-8 Markaz needs to see it, not read an
 * address, and the two things they will do with it — look, and navigate — are
 * the two things this is.
 */
const pin = (office: Office): Message => ({
  role: 'assistant',
  content: office.short,
  kind: 'location',
  src: office.map,
  place: { lat: office.lat, lng: office.lng, address: office.address },
})

/**
 * The invitation to the office, in the order it has to happen.
 *
 * Congratulations and the registration first, then where to go and what to
 * bring, then the pin — and only after all of that the video and the offer to
 * answer the questions now. A rider who stops reading at the good news has
 * already been told the thing that decides whether their journey is wasted.
 */
export const submitted = (
  outcome: Outcome,
  firstName: string,
  office: Office,
  opts: InviteOpts,
): Message[] => [
  ...submittedLines(outcome, firstName).map(spoken),
  // The address among them is written, not spoken: `append` drops the voice
  // from any line that names an office, wherever in the conversation it is.
  ...inviteLines(office.address, opts).map(spoken),
  pin(office),
  spoken(WATCH_VIDEO),
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
 * The last word, after the questions are answered or declined. The office and
 * the pin again, because the rider is about to close the tab.
 */
export const farewell = (office: Office, opts: InviteOpts): Message[] => [
  ...farewellLines(opts).map(spoken),
  pin(office),
]

/**
 * Told the moment the licence is read, not saved for the ending.
 *
 * Spoken rather than written: a rider who cannot read has just been told the
 * one thing that decides whether their journey is wasted, and the whole
 * reason these recordings exist is that the refusals used to be text.
 */
export const expiredLicence = (): Message[] => [spoken(SAY.licenseExpired.text)]

/**
 * Two photographs and the reader still could not be sure of the card.
 *
 * Spoken, like the expiry note, and for the same reason: it changes what the
 * rider has to carry to the office, and a rider who cannot read the line is
 * the one most likely to arrive without it.
 */
export const unreadableLicence = (): Message[] => [spoken(SAY.licenseUnreadable.text)]

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
/**
 * Said when the rider picks their branch. It used to say the location had been
 * received, which was true when there was a location to receive and became a
 * small lie the moment the step became a question.
 */
export const thanksOffice = (): Message => bot('Shukriya, office chun liya gaya.')
