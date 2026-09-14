import { existsSync } from 'node:fs'
import { audioForText, SAY } from '../../shared/messages.ts'
import {
  asksSomething,
  branchLines,
  OFFICES,
  submittedLines,
  blockedOn,
  readYesNo,
  saysHasnt,
  STEP_SPECS,
  dropRepeat,
  stripEcho,
  TYPE_NAME_PLEASE,
  WA_ASK,
  WELCOME_LINES,
} from '../../shared/steps.ts'
import { extractName } from '../extract.ts'
import { speak, speechReady } from '../speak.ts'
import { completeText } from '../provider.ts'
import { blank, sessions, type Session } from '../sessions.ts'
import { accept } from '../uploads.ts'
import { transcribe } from '../transcribe.ts'
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
function audioLink(base: string | undefined | null): string | null {
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
    // Only an immediate repeat; a rider who sends a second wrong document must
    // still be told why, even though the words are the same as last time.
    const last = session.history[session.history.length - 1]
    if (last?.role === 'assistant' && dropRepeat(last.content, line)) continue
    await sendText(to, line)
    session.history.push({ role: 'assistant', content: line })

    // Speak it too: the recording when there is one, otherwise have Uplift read
    // it, so an answer the model wrote is heard like everything else.
    const recorded = audioLink(audioForText(line))
    if (recorded) {
      await sendAudio(to, recorded)
    } else if (speechReady() && PUBLIC_URL) {
      const id = await speak(line)
      if (id) await sendAudio(to, `${PUBLIC_URL}/api/speak/${id}`)
    }
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

/**
 * Answers a question from the FAQ. The rider's words are assumed to be in the
 * history already when `pushed` is false, which is the case when their answer
 * to a step also carried a question.
 */
async function answerOnly(to: string, session: Session, question: string, pushed = true) {
  if (!pushed) session.history.push({ role: 'user', content: question })
  const reply = await completeText(session.history.slice(-HISTORY))
  const pending = askText(session.step)

  // Strip the repeated question; the step asks it again itself, with its recording.
  if (!reply) {
    await say(to, session, 'Maazrat, abhi jawab nahi mil saka. Baraye meherbani dobara poochein.')
    return
  }
  const kept = pending ? stripEcho(reply, pending) : reply
  if (kept) await say(to, session, kept)
}

/** Answers a question from the FAQ, then repeats whatever is still outstanding. */
async function answerThenReask(to: string, session: Session, question: string) {
  await answerOnly(to, session, question, false)
  await askStep(to, session, session.step)
}

async function sayRetry(to: string, session: Session, i: number) {
  await say(to, session, retry(i))
  const link = audioLink(STEP_SPECS[i]?.audio)
  if (link) await sendAudio(to, link)
}

async function advance(to: string, session: Session, confirm: string, extra: string[] = []) {
  session.step += 1
  if (STEP_SPECS[session.step]) {
    await say(to, session, confirm, ...extra)
    await askStep(to, session, session.step)
    return
  }
  if (session.ineligible) {
    await say(to, session, confirm, ...extra)
    return
  }
  // The fee and the verification results decide which of the four is sent.
  // WhatsApp gets both halves at once: it has no quiz to sit between them.
  const missing = session.missing ?? []
  const outcome = session.ineligible || missing.length ? 'not_eligible' : 'not_verified'
  const licenceExpired = session.collected['license.expired'] === 'true'
  await say(
    to,
    session,
    confirm,
    ...extra,
    ...submittedLines(outcome, session.firstName),
    ...branchLines(OFFICES.f8.address, {
      owesFee: true,
      licenceExpired,
      waitingFor: blockedOn(missing, licenceExpired),
    }),
  )
}

/**
 * The same state machine the web app runs, driven by WhatsApp messages instead of
 * clicks. Code owns the sequence; the model only answers questions.
 */
export async function handleIncoming(raw: Incoming): Promise<void> {
  // Shadowed so a spoken answer can be rewritten as a typed one and fall
  // through the handling below untouched.
  let msg = raw
  const to = msg.from
  const session = (await sessions.get(to)) ?? blank(to)

  void markRead(to, msg.id)

  if (!session.greeted) {
    await welcome(to, session)
    await sessions.save(session)
    return
  }

  const step = STEP_SPECS[session.step]

  if (msg.type === 'audio' || msg.type === 'voice') {
    // The name is matched against the CNIC and the licence, so it has to exist
    // as text. Refused before transcribing, since the answer cannot be used.
    if (step?.id === 'name') {
      await say(to, session, TYPE_NAME_PLEASE)
      await askStep(to, session, session.step)
      await sessions.save(session)
      return
    }

    const media = msg.mediaId ? await downloadMedia(msg.mediaId) : null
    const heard = media ? await transcribe(media.bytes, media.mime) : null

    if (!heard?.ok) {
      await say(to, session, SAY.voiceUnclear.text)
      await askStep(to, session, session.step)
      await sessions.save(session)
      return
    }
    msg = { ...msg, type: 'text', text: heard.text }
  }

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

  if (msg.type === 'text' && msg.text && step.kind === 'confirm') {
    const answer = readYesNo(msg.text)
    // An answer can carry a question with it — "haan mere paas hai, magar pehle
    // bataein salary kitni milegi?". Acknowledge, answer, then move on.
    const also = asksSomething(msg.text)
    if (answer === 'yes') {
      session.history.push({ role: 'user', content: msg.text })
      if (also) {
        await say(to, session, 'Theek hai.')
        await answerOnly(to, session, msg.text)
        await advance(to, session, '')
      } else {
        await advance(to, session, 'Theek hai.')
      }
    } else if (answer === 'no') {
      session.history.push({ role: 'user', content: msg.text })
      if (also) await answerOnly(to, session, msg.text)
      // A smartphone is not optional for this job. Say so plainly and stop
      // rather than walking them through an application they cannot finish.
      session.step = STEP_SPECS.length
      session.ineligible = true
      await say(to, session, SAY.needSmartphone.text)
    } else {
      await answerThenReask(to, session, msg.text)
    }
    await sessions.save(session)
    return
  }

  if (msg.type === 'text' && msg.text) {
    if (step.kind !== 'text') {
      // "I don't have one" is an answer. A required document the rider does
      // not have is recorded and the flow moves on; repeating the request at
      // someone who has just explained there is nothing to photograph is what
      // this used to do.
      const required =
        step.id === 'license_front'
          ? SAY.needLicense
          : step.id === 'cnic_front'
            ? SAY.needCnicDoc
            : null
      if (required && saysHasnt(msg.text)) {
        session.history.push({ role: 'user', content: msg.text })
        session.missing = [...new Set([...(session.missing ?? []), step.id])]
        await advance(to, session, required.text, [SAY.knockoutAck.text])
        await sessions.save(session)
        return
      }

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
  if (step.id === 'name' && msg.type !== 'text') {
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
      await say(to, session, SAY.uploadFailed.text)
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

    // Read, kept, and not current. Said here rather than saved for the ending:
    // a rider told at the last message has already spent the day on it.
    const expired = step.doc === 'license' && result.fields.expired === 'true'

    await advance(
      to,
      session,
      'Shukriya, tasveer mil gayi.',
      expired ? [SAY.licenseExpired.text] : [],
    )
    await sessions.save(session)
    return
  }

  // Anything else — a voice note, a sticker, a contact card.
  await sayRetry(to, session, session.step)
  await sessions.save(session)
}
