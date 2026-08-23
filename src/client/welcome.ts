import { audioSources } from '../shared/steps.ts'
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
  {
    role: 'assistant',
    content: 'Assalam o Alaikum! Foodpanda delivery rider ki job mein khush aamdeed.',
  },
  {
    role: 'assistant',
    content:
      'Mera naam Rozeena hai. Agar aap achi job dhoondh rahay hain tu Foodpanda delivery rider ki job ke liye apply karein.',
  },
  { role: 'assistant', content: 'Main aapki madad karungi. Chalein shuru karte hain.' },
  // The name question and its spoken version, straight from the shared step.
  ...askMessages(STEPS[0]!),
]

/** Only real text turns reach the model; attachments are UI-only. */
export const forModel = (messages: Message[]): Message[] =>
  messages.filter((m) => (!m.kind || m.kind === 'text') && m.content.trim().length > 0)
