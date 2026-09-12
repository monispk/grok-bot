import { audioSources, WELCOME_LINES } from '../shared/steps.ts'
import { askMessages, STEPS } from './flow.ts'
import type { Message } from './storage.ts'

export const VOICE_SOURCES = audioSources('/welcome')

/**
 * The scripted first-contact sequence — fixed content, not generated. It renders
 * instantly with no network round trip and costs no tokens.
 *
 * The four text bubbles ARE seeded into the conversation as assistant turns, so
 * the model knows it has already greeted the rider and asked for the CNIC name,
 * and can read the reply as an answer to that question. The image and the voice
 * note are display-only and never sent upstream.
 */
export const WELCOME: Message[] = [
  { role: 'assistant', content: '', kind: 'image', src: '/welcome.jpg' },
  { role: 'assistant', content: '', kind: 'audio', sources: VOICE_SOURCES },
  // The same words WhatsApp opens with. They used to be written out again
  // here, so the fee briefing added to the shared list never reached the web
  // app at all — and nothing said so, because both copies looked right.
  ...WELCOME_LINES.map((content) => ({ role: 'assistant' as const, content })),
  // The name question and its spoken version, straight from the shared step.
  ...askMessages(STEPS[0]!),
]

/**
 * What the model sees. A transcribed voice note is the rider's own words and
 * must reach it, so this no longer turns attachments away by kind — it keeps
 * whatever carries text. Shared with the server, which re-does the same work.
 */
export { forModel } from '../shared/wire.ts'
