import { Agent, fetch } from 'undici'
import { KNOWLEDGE } from './knowledge.ts'

export type Effort = 'low' | 'medium' | 'high'
export type Msg = { role: 'user' | 'assistant'; content: string }

const BASE = process.env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1'
const KEY = process.env.GROQ_API_KEY ?? ''
export const MODEL = process.env.MODEL ?? 'openai/gpt-oss-120b'
const DEFAULT_SYSTEM = `Aap "Rozeena" hain. Aap Pakistan mein logon ki madad karti hain ke woh foodpanda ki delivery rider job ke liye apply karein.

ZABAAN:
- Sirf aasan Roman Urdu mein baat karein (Urdu, English harf mein likhi hui). Urdu script kabhi na likhein. English mein jawab kabhi na dein.
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
- Agar koi doosri baat kare (siyasat, khel, mazhab, tibbi mashwara, ya koi bhi aur mauzu), narmi se kahein: "Main sirf Foodpanda rider job ke baare mein baat kar sakti hoon." Phir apna pichla sawal dobara poochein.
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

Aap pehle hi user ko salam kar chuki hain, apna taaruf kara chuki hain, aur un ka poora naam (jo CNIC par hai) pooch chuki hain.`

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
      max_completion_tokens: 2048,
      // gpt-oss is a reasoning model. On default effort it burns hundreds of
      // hidden tokens before the first visible one — this is the top TTFT lever.
      reasoning_effort: effort,
      reasoning_format: 'hidden',
    }),
  })
}
