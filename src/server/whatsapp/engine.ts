import { existsSync } from 'node:fs'
import {
  closing,
  STEP_SPECS,
  dropRepeat,
  stripEcho,
  TYPE_NAME_PLEASE,
  WA_ASK,
  WELCOME_LINES,
} from '../../shared/steps.ts'
import { extractName } from '../extract.ts'
import { completeText } from '../provider.ts'
import { blank, sessions, type Session } from '../sessions.ts'
import { accept } from '../uploads.ts'
import { verifyDocument } from '../verify.ts'
import { downloadMedia, markRead, PUBLIC_URL, sendAudio, sendImage, sendText } from './client.ts'

export type Incoming = {
  from: string
  id: string
  type: string
  text?: string
  mediaId?: string
  mime?: string
  latitude?: number
  longitude?: number
}

const HISTORY = 12

/**
 * Recordings are dropped into public/ as they are made. A step whose file is
 * not there yet stays text-only rather than firing a send Meta cannot fulfil.
 */
const audioCache = new Map<string, boolean>()
function audioLink(base: string | undefined): string | null {
  if (!base || !PUBLIC_URL) return null
  let ok = audioCache.get(base)
  if (ok === undefined) {
    ok = existsSync(`./dist/client${base}.opus`)
    audioCache.set(base, ok)
    if (!ok) console.log(`whatsapp: no recording for ${base}, asking in text only`)
  }
  return ok ? `${PUBLIC_URL}${base}.opus` : null
}
const askText = (i: number) => {
  const step = STEP_SPECS[i]
  if (!step) return null
  return WA_ASK[step.id] ?? step.ask
}
const retry = (i: number) => {
  const step = STEP_SPECS[i]
  if (!step) return ''
  return [step.need, step.waHint].filter(Boolean).join(' ')
}

async function say(to: string, session: Session, ...lines: (string | null)[]) {
  for (const line of lines) {
    if (!line) continue
    const prev = [...session.history].reverse().find((m) => m.role === 'assistant')
    if (dropRepeat(prev?.content, line)) continue
    await sendText(to, line)
    session.history.push({ role: 'assistant', content: line })
  }
  session.history = session.history.slice(-HISTORY)
}

/** The scripted first contact: the branded image, the voice note, then the script. */
/**
 * Asks a step, and plays it aloud when it has a recording. Many riders read
 * Roman Urdu poorly, so the question is spoken as well as written.
 */
async function askStep(to: string, session: Session, i: number) {
  const step = STEP_SPECS[i]
  if (!step) return
  await say(to, session, askText(i))
  const link = audioLink(step.audio)
  if (link) await sendAudio(to, link)
}

async function welcome(to: string, session: Session) {
  if (PUBLIC_URL) {
    await sendImage(to, `${PUBLIC_URL}/welcome.jpg`)
    await sendAudio(to, `${PUBLIC_URL}/welcome.opus`)
  }
  await say(to, session, ...WELCOME_LINES)
  await askStep(to, session, 0)
  session.greeted = true
}

/** Answers a question from the FAQ, then repeats whatever is still outstanding. */
async function answerThenReask(to: string, session: Session, question: string) {
  session.history.push({ role: 'user', content: question })
  const reply = await completeText(session.history.slice(-HISTORY))
  const pending = askText(session.step)

  // Strip the repeated question; askStep asks it again below, with its recording.
  if (!reply) {
    await say(to, session, 'Maazrat, abhi jawab nahi mil saka. Baraye meherbani dobara poochein.')
  } else {
    const kept = pending ? stripEcho(reply, pending) : reply
    if (kept) await say(to, session, kept)
  }

  await askStep(to, session, session.step)
}

async function sayRetry(to: string, session: Session, i: number) {
  await say(to, session, retry(i))
  const link = audioLink(STEP_SPECS[i]?.audio)
  if (link) await sendAudio(to, link)
}

async function advance(to: string, session: Session, confirm: string) {
  session.step += 1
  if (STEP_SPECS[session.step]) {
    await say(to, session, confirm)
    await askStep(to, session, session.step)
    return
  }
  await say(to, session, confirm, ...closing(session.firstName, session.collected['bill.billAddress']))
}

/**
 * The same state machine the web app runs, driven by WhatsApp messages instead of
 * clicks. Code owns the sequence; the model only answers questions.
 */
export async function handleIncoming(msg: Incoming): Promise<void> {
  const to = msg.from
  const session = (await sessions.get(to)) ?? blank(to)

  void markRead(to, msg.id)

  if (!session.greeted) {
    await welcome(to, session)
    await sessions.save(session)
    return
  }

  const step = STEP_SPECS[session.step]

  // The application is finished; from here the bot is purely a question answerer.
  if (!step) {
    if (msg.type === 'text' && msg.text) {
      session.history.push({ role: 'user', content: msg.text })
      const reply = await completeText(session.history.slice(-HISTORY))
      await say(to, session, reply ?? 'Maazrat, abhi jawab nahi mil saka.')
    }
    await sessions.save(session)
    return
  }

  if (msg.type === 'text' && msg.text) {
    if (step.kind !== 'text') {
      // A document or a location was asked for; text cannot satisfy it.
      await answerThenReask(to, session, msg.text)
      await sessions.save(session)
      return
    }

    const guess = await extractName(msg.text)
    if (!guess.isName) {
      await answerThenReask(to, session, msg.text)
      await sessions.save(session)
      return
    }

    session.firstName = guess.firstName ?? ''
    session.fullName = guess.fullName ?? msg.text.trim()
    session.history.push({ role: 'user', content: msg.text })
    await advance(to, session, session.firstName ? `Shukriya ${session.firstName}!` : 'Shukriya!')
    await sessions.save(session)
    return
  }

  // A voice note, photo or file sent at the name question. Say why it has to be
  // typed before falling through to the media handling below.
  if (step.kind === 'text' && msg.type !== 'text') {
    await say(to, session, TYPE_NAME_PLEASE)
    await askStep(to, session, session.step)
    await sessions.save(session)
    return
  }

  if (msg.type === 'location') {
    if (step.kind !== 'gps') {
      await sayRetry(to, session, session.step)
    } else {
      session.collected['gps.latitude'] = String(msg.latitude ?? '')
      session.collected['gps.longitude'] = String(msg.longitude ?? '')
      await advance(to, session, 'Shukriya, location mil gayi.')
    }
    await sessions.save(session)
    return
  }

  if (msg.type === 'image' || msg.type === 'document') {
    if (step.kind !== 'upload' || (step.imageOnly && msg.type !== 'image')) {
      await sayRetry(to, session, session.step)
      await sessions.save(session)
      return
    }

    const media = msg.mediaId ? await downloadMedia(msg.mediaId) : null
    if (!media) {
      await say(to, session, 'Tasveer nahi mil saki. Baraye meherbani dobara bhejein.')
      await sessions.save(session)
      return
    }

    // Same byte-level validation the web upload does — a mislabelled file is
    // still wrong however it arrived.
    const stored = accept(media.name, media.bytes)
    if (!stored.ok) {
      await say(to, session, stored.reason)
      await sessions.save(session)
      return
    }

    const result = await verifyDocument({
      kind: step.doc ?? null,
      bytes: stored.upload.bytes,
      mime: stored.upload.mime,
      expectedName: session.fullName,
      expectedCnic: session.cnic,
    })

    if (!result.pass) {
      await say(
        to,
        session,
        result.reason ?? 'Ye tasveer saaf nahi hai. Baraye meherbani dobara bhejein.',
      )
      await sessions.save(session)
      return
    }

    for (const [k, v] of Object.entries(result.fields))
      if (v) session.collected[`${step.doc ?? step.id}.${k}`] = v
    if (result.nameVerdict) session.collected[`${step.doc ?? step.id}.nameMatch`] = result.nameVerdict
    if (step.id === 'selfie') session.collected['selfie.captured'] = 'yes'

    const seen = result.fields.cnic
    if (typeof seen === 'string' && seen && !session.cnic) session.cnic = seen

    await advance(to, session, 'Shukriya, tasveer mil gayi.')
    await sessions.save(session)
    return
  }

  // Anything else — a voice note, a sticker, a contact card.
  await sayRetry(to, session, session.step)
  await sessions.save(session)
}
