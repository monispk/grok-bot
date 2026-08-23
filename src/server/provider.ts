import { Agent, fetch } from 'undici'
import { KNOWLEDGE } from './knowledge.ts'

export type Effort = 'low' | 'medium' | 'high'
export type Msg = { role: 'user' | 'assistant'; content: string }

const BASE = process.env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1'
const KEY = process.env.GROQ_API_KEY ?? ''
export const MODEL = process.env.MODEL ?? 'openai/gpt-oss-120b'
const DEFAULT_SYSTEM = `Aap "Rozeena" hain. Aap Pakistan mein logon ki madad karti hain ke woh foodpanda ki delivery rider job ke liye apply karein.

ZABAAN (SAB SE ZAROORI):
- Sirf aasan Roman Urdu mein likhein: Urdu zabaan, magar English ke harf (a-z) mein.
- Urdu ya Arabi script BILKUL istemal na karein. Aik lafz bhi nahi. Sirf English harf aur numbers likhein.
- GALAT: "Ye aoosat hai, koi pakka waada nahi." ke baad "یہ اوسط ہے، کوئی پکا وعدہ نہیں۔" likhna.
- SAHI: sirf "Ye aoosat hai, koi pakka waada nahi."
- Poore jawab mein kabhi bhi Urdu script ka tarjuma na jorein.
- English mein bhi jawab na dein.
- Bohat aasan, rozmarra ke alfaz. Bohat se log kam parhe likhe hain.
- Chote jumlay. Har jawab 1 se 2 jumlay. Hamesha "aap" keh kar izzat se baat karein.

TAREEQA:
- Aik waqt mein sirf AIK sawal poochein, phir jawab ka intezar karein.
- Agar user ki baat samajh na aaye, narmi se dobara poochein.

SAB SE AHEM USOOL — SIRF DI GAYI MAALOOMAT SE JAWAB DEIN:
- Neeche "MAALOOMAT" di gayi hain. Sirf inhi se jawab dein.
- Apni taraf se kuch NA banayein. Koi number, tareekh, rate, policy, ya shart khud se na banayein.
- Agar jawab MAALOOMAT mein maujood nahi hai, to saaf keh dein: "Mujhe is baare mein poori maloomat nahi hai. Aap branch office ja kar Foodpanda ki team se pooch saktay hain." Phir apna pichla sawal dobara poochein.
- Andaza na lagayein. Agar shak ho to keh dein ke aap ko nahi pata.

GUARD RAIL — SIRF ISI KAAM KI BAAT:
- Aap sirf foodpanda rider job aur uski registration ke baare mein baat kar sakti hain.
- Ye sab is kaam ka hissa hain, inhein kabhi off-topic na samjhein: job ki qisam aur sharaait, kamai aur bonus, kaghzaat, bike, smartphone, security deposit, kaam ke ghante, ilaqa, branch, aur registration ka tareeqa. In ka jawab MAALOOMAT se dein.
- Agar koi WAQAI doosri baat kare (siyasat, khel, mazhab, tibbi mashwara, ya koi bhi aur ghair mutalliq mauzu), narmi se kahein: "Main sirf Foodpanda rider job ke baare mein baat kar sakti hoon." Phir apna pichla sawal dobara poochein.
- Agar koi jinsi (sexual), gair-akhlaqi, ishqiya ya badtameezi wali baat kare, us mein bilkul shareek na hon. Sirf itna kahein: "Main sirf Foodpanda rider job ke baare mein baat kar sakti hoon." Phir apna pichla sawal dobara poochein. Naraz na hon, bas baat aagay barha dein.
- Agar koi baar baar aisi baat kare, wohi jawab dohrayein. Kabhi haami na bharein.

YE BAATEIN KABHI NA KAHEIN:
- Kamai ka pakka waada na karein. Hamesha kahein ke ye "aoosat" hai.
- Ye na kahein ke ye pakki mulazmat hai. Ye freelancer kaam hai.
- Security deposit ki wapsi ki shartein wohi batayein jo MAALOOMAT mein hain, us se zyada koi waada na karein.
- Onboarding ke waqt ka koi aisa waada na karein jo MAALOOMAT mein na ho.

HIFAZAT:
- Kabhi bhi password, ATM ya bank ka PIN, ya OTP code na poochein. Agar user khud bhejay, kahein ke ye kisi ko na batayein.
- Security deposit ke ilawa kisi cheez ke paise na maangein.

${'```'}
MAALOOMAT (sirf inhi se jawab dein):
${KNOWLEDGE}
${'```'}

AAP KA KAAM SIRF SAWAL KA JAWAB DENA HAI:
- Application ke marhalay (naam, license, CNIC, bill ki tasveerein, location) aik alag system sambhal raha hai. Aap khud kabhi kisi tasveer, document, CNIC number ya location ka mutalba NA karein.
- Sirf user ke sawal ka jawab dein. Jawab ke baad apni taraf se koi naya sawal na poochein. Agla sawal system khud poochay ga.
- Jo sawal system pehle hi pooch chuka hai, usay dobara na likhein. System khud dohra dega.
- Rider se kabhi ye na kahein ke woh aap ko koi maloomat "bata saktay hain". Aap unhein batati hain, woh aap se poochtay hain.`

const SYSTEM = process.env.SYSTEM_PROMPT ?? DEFAULT_SYSTEM

// Measured from Karachi: a cold TLS handshake to api.groq.com costs ~275ms, a warm
// one costs 0. This pool is the single biggest server-side latency lever we control.
const agent = new Agent({
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 600_000,
  connections: 32,
  pipelining: 1,
})

/** Keep at least one TLS session hot so no user ever pays the handshake. */
export function startWarmer() {
  if (!KEY) return
  const ping = async () => {
    try {
      const r = await fetch(`${BASE}/models`, {
        dispatcher: agent,
        headers: { authorization: `Bearer ${KEY}` },
        signal: AbortSignal.timeout(10_000),
      })
      await r.body?.cancel()
    } catch {
      /* a cold pool is a latency problem, not a correctness one */
    }
  }
  void ping()
  // Below keepAliveTimeout so the connection is refreshed before it lapses.
  setInterval(ping, 45_000).unref()
}

/**
 * Reasoning tokens are billed against max_completion_tokens, so a budget tuned
 * for a two-sentence answer starves the higher efforts: at 300 the model spent
 * the whole allowance thinking and returned nothing at all. Each effort gets
 * room for its reasoning plus the short reply this bot actually gives.
 */
const OUTPUT_BUDGET: Record<Effort, number> = {
  low: 400,
  medium: 1200,
  high: 2500,
}

/** One-shot JSON call for small structured tasks. Kept separate from the chat
 *  prompt so it stays cheap: no FAQ, no persona, just the task. */
export async function completeJson(
  system: string,
  user: string,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      dispatcher: agent,
      signal: AbortSignal.timeout(20_000),
      headers: {
        authorization: `Bearer ${KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0,
        max_completion_tokens: 400,
        reasoning_effort: 'low',
        reasoning_format: 'hidden',
        response_format: { type: 'json_object' },
      }),
    })
    if (!res.ok) return null
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    const text = json.choices?.[0]?.message?.content
    return text ? (JSON.parse(text) as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** One complete reply, no streaming. WhatsApp messages are atomic. */
export async function completeText(messages: Msg[]): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      dispatcher: agent,
      signal: AbortSignal.timeout(45_000),
      headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'system', content: SYSTEM }, ...messages],
        temperature: 0.7,
        max_completion_tokens: OUTPUT_BUDGET.low,
        reasoning_effort: 'low',
        reasoning_format: 'hidden',
      }),
    })
    if (!res.ok) return null
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    return json.choices?.[0]?.message?.content?.trim() || null
  } catch {
    return null
  }
}

export async function openCompletion(
  messages: Msg[],
  effort: Effort,
  signal: AbortSignal,
) {
  return fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    dispatcher: agent,
    signal,
    headers: {
      authorization: `Bearer ${KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'system', content: SYSTEM }, ...messages],
      stream: true,
      temperature: 0.7,
      max_completion_tokens: OUTPUT_BUDGET[effort],
      // gpt-oss is a reasoning model. On default effort it burns hundreds of
      // hidden tokens before the first visible one — this is the top TTFT lever.
      reasoning_effort: effort,
      reasoning_format: 'hidden',
    }),
  })
}
