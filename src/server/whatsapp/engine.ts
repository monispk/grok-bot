import { closing, STEP_SPECS, WA_ASK, WELCOME_LINES } from '../../shared/steps.ts'
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
const ask = (i: number) => {
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
    await sendText(to, line)
    session.history.push({ role: 'assistant', content: line })
  }
  session.history = session.history.slice(-HISTORY)
}

/** The scripted first contact: the branded image, the voice note, then the script. */
async function welcome(to: string, session: Session) {
  if (PUBLIC_URL) {
    await sendImage(to, `${PUBLIC_URL}/welcome.jpg`)
    await sendAudio(to, `${PUBLIC_URL}/welcome.opus`)
  }
  await say(to, session, ...WELCOME_LINES, ask(0))
  session.greeted = true
}

/** Answers a question from the FAQ, then repeats whatever is still outstanding. */
async function answerThenReask(to: string, session: Session, question: string) {
  session.history.push({ role: 'user', content: question })
  const reply = await completeText(session.history.slice(-HISTORY))
  await say(
    to,
    session,
    reply ?? 'Maazrat, abhi jawab nahi mil saka. Baraye meherbani dobara poochein.',
    ask(session.step),
  )
}

async function advance(to: string, session: Session, confirm: string) {
  session.step += 1
  const next = ask(session.step)
  if (next) {
    await say(to, session, confirm, next)
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

  if (msg.type === 'location') {
    if (step.kind !== 'gps') {
      await say(to, session, retry(session.step))
    } else {
      session.collected['gps.latitude'] = String(msg.latitude ?? '')
      session.collected['gps.longitude'] = String(msg.longitude ?? '')
      await advance(to, session, 'Shukriya, location mil gayi.')
    }
    await sessions.save(session)
    return
  }

  if (msg.type === 'image' || msg.type === 'document') {
    if (step.kind !== 'upload') {
      await say(to, session, retry(session.step))
      await sessions.save(session)
      return
    }
    if (step.imageOnly && msg.type !== 'image') {
      await say(to, session, retry(session.step))
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
  await say(to, session, retry(session.step))
  await sessions.save(session)
}
