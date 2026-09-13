/**
 * The rider training quiz: forty-seven questions, ten asked.
 *
 * Generated from the recorded bank by scripts/build-quiz.mjs — the clips are
 * keyed by question id rather than by text, so the running "Sawaal 3 / 10"
 * can change without the recording going missing.
 *
 * Nothing here says which answer is right. Grading happens on the backend,
 * so this build cannot mark a rider down and cannot be read to find out the
 * answers either.
 */
export type Question = { id: string; stem: string; options: { key: string; text: string }[] }

export const QUESTIONS: Question[] = [
  {
    id: 'q1',
    stem: "foodpanda attire mein kaisi t-shirt shamil hai?",
    options: [
      { key: 'a', text: "formal t-shirt" },
      { key: 'b', text: "foodpanda t-shirt" },
      { key: 'c', text: "koi bhi apni pasand ki t-shirt" },
    ],
  },
  {
    id: 'q2',
    stem: "foodpanda attire ke saath un mein se kya cheez safety ke liye sab se zaroori hai?",
    options: [
      { key: 'a', text: "sunglasses" },
      { key: 'b', text: "powerbank" },
      { key: 'c', text: "helmet" },
    ],
  },
  {
    id: 'q3',
    stem: "agar aap ki tabiyat theek nahi hai to pick ki hui shift ka kya karein?",
    options: [
      { key: 'a', text: "shift ko swap karein aur aaram karein" },
      { key: 'b', text: "agar shift li hai to har soorat kaam pe aain" },
      { key: 'c', text: "apne dost ko shift karne ke liye bhej den" },
    ],
  },
  {
    id: 'q4',
    stem: "shift start karne se pehle ID login karne ke liye kaisi selfie qabil e qubool hai?",
    options: [
      { key: 'a', text: "selfie mein face clear ho aur foodpanda shirt ho" },
      { key: 'b', text: "selfie mein face pe mask ho" },
      { key: 'c', text: "selfie mein background ki cheezain nazar aa rahi hun" },
    ],
  },
  {
    id: 'q5',
    stem: "apna password aur OTP kis ke saath share kar sakte hain?",
    options: [
      { key: 'a', text: "jo mange us ke saath" },
      { key: 'b', text: "sirf staff members ke saath" },
      { key: 'c', text: "kisi ke saath bhi nahi" },
    ],
  },
  {
    id: 'q6',
    stem: "agar kisi call ya whatsapp number pe foodpanda staff bata kar aap se password ya OTP manga jaye to kya karein?",
    options: [
      { key: 'a', text: "foran de dein" },
      { key: 'b', text: "hargiz nahi dein, ye sirf aap ko pata hona chahiye, foodpanda namayande ko bhi nahi" },
      { key: 'c', text: "unhein nahi lekin office staff ko de dein" },
    ],
  },
  {
    id: 'q7',
    stem: "selfie mein kisi aur ki tasveer ya ID share karne pe kya action liya jata hai?",
    options: [
      { key: 'a', text: "ek aur chance diya jata hai" },
      { key: 'b', text: "suspend kiya jata hai" },
      { key: 'c', text: "contract khatam kar diya jata hai" },
    ],
  },
  {
    id: 'q8',
    stem: "fake ID ke istemal pe company kya karti hai?",
    options: [
      { key: 'a', text: "ID band kar deti hai aur earning bhi hold kar leti hai" },
      { key: 'b', text: "kuch nahi karti hai" },
      { key: 'c', text: "aisa karna allowed hai" },
    ],
  },
  {
    id: 'q9',
    stem: "restaurant ke orders pick karte hi sab se pehle kya karna chahiye?",
    options: [
      { key: 'a', text: "pick up mark kar dena chahiye" },
      { key: 'b', text: "menu ke hisab se order ko check karna chahiye" },
      { key: 'c', text: "customer ko call karni chahiye" },
    ],
  },
  {
    id: 'q10',
    stem: "homechef ki location na mil rahi ho to kya karein?",
    options: [
      { key: 'a', text: "dispatch se rabta karein" },
      { key: 'b', text: "order cancel kara den" },
      { key: 'c', text: "homechef ko call karein" },
    ],
  },
  {
    id: 'q11',
    stem: "foodpanda mein sirf food delivery hi ki jati hai?",
    options: [
      { key: 'a', text: "food delivery, grocery aur shops sab ke orders foodpanda pe maujood hain" },
      { key: 'b', text: "food delivery aur grocery hi ki jati hai" },
      { key: 'c', text: "ji, sirf food delivery hi ki jati hai" },
    ],
  },
  {
    id: 'q12',
    stem: "cigarette delivery ke liye kya zaroori hai?",
    options: [
      { key: 'a', text: "customer se ID card maangna" },
      { key: 'b', text: "order sirf atharah saal se bare customer ke haath mein hi dena" },
      { key: 'c', text: "donon options theek hain" },
    ],
  },
  {
    id: 'q13',
    stem: "order ki agar pin location ghalat hai to kya karein?",
    options: [
      { key: 'a', text: "dispatch chat pe aa kar update karaain" },
      { key: 'b', text: "khud deliver karne chalay jain" },
      { key: 'c', text: "order cancel kara den" },
    ],
  },
  {
    id: 'q14',
    stem: "order handle karne mein sab se ahm kya cheez hai?",
    options: [
      { key: 'a', text: "order ko bike ke tank pe rakha jaye" },
      { key: 'b', text: "delivery bag ka sahi istamal karte hue order bag mein rakha jaye" },
      { key: 'c', text: "order ko bike ke side pe latkaya jaye" },
    ],
  },
  {
    id: 'q15',
    stem: "shift ke doraan bike kahan park karein?",
    options: [
      { key: 'a', text: "customer ya vendor ke gate par" },
      { key: 'b', text: "no parking par" },
      { key: 'c', text: "parking area mein double stand par" },
    ],
  },
  {
    id: 'q16',
    stem: "kisi bhi vendor ke pass pohnch kar wait karte hue kya karein?",
    options: [
      { key: 'a', text: "vendor se har aglay minute order ka poochain" },
      { key: 'b', text: "tahammul se order ready hone ka wait karein" },
      { key: 'c', text: "dispatch pe aa kar batain ke aap pohnch gaye hain" },
    ],
  },
  {
    id: 'q17',
    stem: "customer ko order de ke foodpanda rider akhri cheez kya karte hain?",
    options: [
      { key: 'a', text: "un ke number pe messages karte hain" },
      { key: 'b', text: "un se extra paise ya tip maangte hain" },
      { key: 'c', text: "unhein foodpanda ka istamal karne pe thank you kehte hain" },
    ],
  },
  {
    id: 'q18',
    stem: "order cancel ho jane pe return trip ban jaye to cancel order kahan le ke jayein?",
    options: [
      { key: 'a', text: "isi same vendor ko ja ke return karein" },
      { key: 'b', text: "aglay vendor ko ja ke return karein" },
      { key: 'c', text: "apni marzi ke vendor ko ja ke return karein" },
    ],
  },
  {
    id: 'q19',
    stem: "ek hi vendor ke zyada orders hon unhein stacked orders kehte hain, aise orders ka kya karein?",
    options: [
      { key: 'a', text: "donon orders ko pick up mark karein" },
      { key: 'b', text: "pehle order ko pick up mark karein, dusre order ke liye wait karein" },
      { key: 'c', text: "jo order mil jaye use le ke chale jayein" },
    ],
  },
  {
    id: 'q20',
    stem: "vendor ke experience ko foodpanda ke saath kaise share karein?",
    options: [
      { key: 'a', text: "vendor ko pick up screen pe rate karein aur comments den" },
      { key: 'b', text: "vendor ko batain" },
      { key: 'c', text: "kisi se share nahi karein" },
    ],
  },
  {
    id: 'q21',
    stem: "agar customer order lene se mana kar de to kya karein?",
    options: [
      { key: 'a', text: "customer ko zabardasti order lene ka kahen" },
      { key: 'b', text: "dispatch chat pe batain" },
      { key: 'c', text: "order khud rakh lein" },
    ],
  },
  {
    id: 'q22',
    stem: "agar return trip na ho to cancelled order ka kya karein?",
    options: [
      { key: 'a', text: "isi same vendor ko ja ke return karein" },
      { key: 'b', text: "order khud rakh lein" },
      { key: 'c', text: "aglay vendor ko return karein jahan aap ka agla order aya hai aur dispatch chat pe picture bhejen" },
    ],
  },
  {
    id: 'q23',
    stem: "agar customer ka address nahi mil raha ho to kya karein?",
    options: [
      { key: 'a', text: "rider customer chat pe customer se rabta karein ya call karein" },
      { key: 'b', text: "rabta na hone pe das minute baad dispatcher se dispatch chat pe rabta karein" },
      { key: 'c', text: "donon options theek hain" },
    ],
  },
  {
    id: 'q24',
    stem: "ek qabil e qabool cancelled order ki picture kaisi hoti hai?",
    options: [
      { key: 'a', text: "picture mein mukammal order, vendor background ya device aur receive karne wala shamil ho" },
      { key: 'b', text: "picture mein bas order hona kaafi hai" },
      { key: 'c', text: "picture mein bas vendor shop ki tasveer hona kaafi hai" },
    ],
  },
  {
    id: 'q25',
    stem: "agar vendor cancelled order lene se mana kar de to kya karein?",
    options: [
      { key: 'a', text: "order khud rakh lein" },
      { key: 'b', text: "order agle vendor ko de ke picture dispatch chat pe bhejen" },
      { key: 'c', text: "woh order wapas customer ko de den" },
    ],
  },
  {
    id: 'q26',
    stem: "dispatch chat se rabta kab kya jaye?",
    options: [
      { key: 'a', text: "jab aap ko koi order nahi lage hue hon" },
      { key: 'b', text: "jab aap ko live order delivery ke dauran koi masla aaye" },
      { key: 'c', text: "jab aap ko salary ko le ke koi sawal ho" },
    ],
  },
  {
    id: 'q27',
    stem: "chat pe apna masla kaise bayan karein?",
    options: [
      { key: 'a', text: "dispatch agent ko call karne ka kehte rahein" },
      { key: 'b', text: "chat pe apna masla type kar ke batain aur tahammul se wait karen" },
      { key: 'c', text: "agent ko har minute message karte rahein" },
    ],
  },
  {
    id: 'q28',
    stem: "dispatch agent ya ticket agent ke saath tajurba kis se share karen?",
    options: [
      { key: 'a', text: "chat ya ticket ke end mein rating aur feedback de ke" },
      { key: 'b', text: "dispatch chat pe agent ko bata ke" },
      { key: 'c', text: "dusre riders ke saath share kar ke" },
    ],
  },
  {
    id: 'q29',
    stem: "rider support pe non live issues ka jawab kitni der mein aa sakta hai?",
    options: [
      { key: 'a', text: "foran aata hai" },
      { key: 'b', text: "chobees ghante mein aata hai" },
      { key: 'c', text: "aglay din aata hai" },
    ],
  },
  {
    id: 'q30',
    stem: "agar aap pe ghalat penalty ya suspension lagi hai to kya karen?",
    options: [
      { key: 'a', text: "aglay din se kaam pe nahi aain" },
      { key: 'b', text: "apni appeal investigation ke liye ticket ke zariye bhejen" },
      { key: 'c', text: "koi rasta nahi hai" },
    ],
  },
  {
    id: 'q31',
    stem: "accident ki surat mein kya karein?",
    options: [
      { key: 'a', text: "website pe mojood, hub staff ke pas ya rider coordinator ke zariye insurance company se rabta karein" },
      { key: 'b', text: "kuch nahi karein, insurance nahi di jati" },
      { key: 'c', text: "apna kaam jari rakhen jaise ho sake" },
    ],
  },
  {
    id: 'q32',
    stem: "agar masla chat ya dispatch pe bhi hal na ho raha ho to kya karein?",
    options: [
      { key: 'a', text: "aglay din se shift pe nahi aain" },
      { key: 'b', text: "zone mein rider coordinator ya hub office aa ke staff ko batain" },
      { key: 'c', text: "dispatch aur ticket ke ilawa koi rasta nahi hai" },
    ],
  },
  {
    id: 'q33',
    stem: "customer se milne wali cash collection ka kya karein?",
    options: [
      { key: 'a', text: "cash collection ko qareebi JazzCash, Easy paisa ya hbl konnect ke retailer ke pas jama karain" },
      { key: 'b', text: "cash ko shift khatm hone se pehle hi jam karaen taaki orders mein rukaawat nah aaye" },
      { key: 'c', text: "donon options theek hain" },
    ],
  },
  {
    id: 'q34',
    stem: "foodpanda qanooni kaarwai karne ka ikhtiyar rakhta hai agar?",
    options: [
      { key: 'a', text: "cash collection jam nah karaai jaaye" },
      { key: 'b', text: "strike, fraud ya kisi ko system mein haraasaan kiya jaaye" },
      { key: 'c', text: "donon options theek hain" },
    ],
  },
  {
    id: 'q35',
    stem: "foodpanda mein salary yaani earnings kab milti hain?",
    options: [
      { key: 'a', text: "rozana" },
      { key: 'b', text: "hafta war" },
      { key: 'c', text: "mahina" },
    ],
  },
  {
    id: 'q36',
    stem: "doraan shift kitna cash ho janay pe fori collection jam karein warna online orders lagein ge?",
    options: [
      { key: 'a', text: "teen hazar rupay" },
      { key: 'b', text: "paanch hazar rupay" },
      { key: 'c', text: "sat hazar rupay" },
    ],
  },
  {
    id: 'q37',
    stem: "orders accept na karne se kya hota hai?",
    options: [
      { key: 'a', text: "batch asar andaz hota hai jis se aamdani bhi kam milti hai" },
      { key: 'b', text: "kuch nahi hota hai" },
      { key: 'c', text: "salary rok li jati hai" },
    ],
  },
  {
    id: 'q38',
    stem: "vendor se order mil jane ke baad kya karna bilkul sahi nahi hai?",
    options: [
      { key: 'a', text: "order ko pick up mark kar dena" },
      { key: 'b', text: "vendor ki location pe reh kar mazeed orders ka wait karna" },
      { key: 'c', text: "order le ke customer ki location ki taraf jana" },
    ],
  },
  {
    id: 'q39',
    stem: "agar kisi wajah se order deliver karne ki halat mein na hoon to kya karein?",
    options: [
      { key: 'a', text: "order decline kar ke break le lein" },
      { key: 'b', text: "order accept kar ke aise hi pick aur drop kar den" },
      { key: 'c', text: "order accept kar ke shift chor den" },
    ],
  },
  {
    id: 'q40',
    stem: "order deliver karein ho to kya karein?",
    options: [
      { key: 'a', text: "customer ka naam poochain aur unhein order den, tasdeeq ke liye rider customer chat pe bhi likh lein" },
      { key: 'b', text: "order aise hi gate pe rakh ke chale jaain" },
      { key: 'c', text: "order diye baghair hi drop off mark kar den" },
    ],
  },
  {
    id: 'q41',
    stem: "cash order mein kya karein?",
    options: [
      { key: 'a', text: "customer se cash le ke use change wapas nahi karein aur drop off mark kar den" },
      { key: 'b', text: "customer se cash le ke use change wapas karein aur drop off mark karein" },
      { key: 'c', text: "customer se cash lene se pehle hi order drop off mark kar den" },
    ],
  },
  {
    id: 'q42',
    stem: "agar customer ya vendor talkhi ya gusse mein baat kare to kya karein?",
    options: [
      { key: 'a', text: "un se isi lehje mein baat karein" },
      { key: 'b', text: "shift khatam ho jane ke baad un se rabta karein" },
      { key: 'c', text: "un se koi baat nahi karein aur fauri dispatch chat pe agent se rabta karein, humein handle karne den" },
    ],
  },
  {
    id: 'q43',
    stem: "app mein mojood heat map kya batata hai?",
    options: [
      { key: 'a', text: "kaun se areas hot zones hain aur wahan orders zyada hain" },
      { key: 'b', text: "kaun se areas mein traffic zyada hai" },
      { key: 'c', text: "kaun se areas mein network kharab hai" },
    ],
  },
  {
    id: 'q44',
    stem: "agar aap ki sim aur JazzCash ya hbl konnect aap ke ID card par registered nahi hai to kya ho sakta hai?",
    options: [
      { key: 'a', text: "kuch nahi hota hai" },
      { key: 'b', text: "meri ID block ho jayegi" },
      { key: 'c', text: "aap ki hafta war earning fail ho ke aap ke foodpanda wallet mein aa jayegi" },
    ],
  },
  {
    id: 'q45',
    stem: "doraan shift GPS band rakhne pe kya hota hai?",
    options: [
      { key: 'a', text: "aap par ek hazar rupay tak ki penalty lagti hai" },
      { key: 'b', text: "aap ko orders nahi lagte aur company ke liye aap inactive ho jate hain" },
      { key: 'c', text: "donon options theek hain" },
    ],
  },
  {
    id: 'q46',
    stem: "company information se bakhabar rehne ke liye kya karein?",
    options: [
      { key: 'a', text: "rider app mein inbox ko rozana dekhein taake important messages miss na hon" },
      { key: 'b', text: "kuch nahi karein" },
      { key: 'c', text: "dosray riders se poochte rahein" },
    ],
  },
  {
    id: 'q47',
    stem: "foodpanda mein doston ko refer kaise karein?",
    options: [
      { key: 'a', text: "dost ko apni ID de dein" },
      { key: 'b', text: "dost ko apne referral link se foodpanda registration hub pe aa ke refer karein" },
      { key: 'c', text: "dost ko refer nahi kiya jata" },
    ],
  },
]

/** What the bot says around the questions. Each has a recording. */
export const INTRO = "Ye video dekhne ke baad, main aap se chand chhote sawal poochna chahungi. Agar aap un ke jawab yahin de dein, to office mein aap ka bohat waqt bach jaye ga — warna ye sawal wahan pooche jayen ge. Das sawal hain, har sawal ke teen jawab. Bas sahi jawab par tap karein. Kya aap abhi jawab dena chahen ge?"
export const CLOSING = "Shukriya! Aap ne saare sawal mukammal kar liye. Is se office mein aap ka kaam jaldi ho jaye ga."
export const DECLINED = "Koi baat nahi! Ye sawal office par pooch liye jayen ge."
export const UNCLEAR = "Maazrat, samajh nahi aaya. Option a, option b, ya option c mein se kaun sa?"

/** How many a rider is asked, out of the bank. */
export const ASK_COUNT = 10

/**
 * Ten questions, spread across the bank rather than drawn at random.
 *
 * The process document asks for one from each of ten categories. The bank
 * carries no category labels, but it is ordered by topic — attire, then
 * shifts, then account security, then order handling, and so on — so ten even
 * slices give one from each subject. Swap this for a real grouping the moment
 * the categories arrive.
 */
export function pickQuestions(bank: Question[] = QUESTIONS, count = ASK_COUNT): Question[] {
  if (bank.length <= count) return [...bank]
  const size = bank.length / count
  return Array.from({ length: count }, (_, i) => {
    const from = Math.floor(i * size)
    const to = Math.max(from + 1, Math.floor((i + 1) * size))
    return bank[from + Math.floor(Math.random() * (to - from))]!
  })
}

/**
 * Which option the rider picked, out of whatever they typed or said.
 *
 * They answer with a letter, a number, or the whole phrase — and a transcribed
 * voice note arrives as "option b" or just "b". None of those is worth a second
 * question.
 */
export function readChoice(text: string): 'a' | 'b' | 'c' | null {
  // Padded and stripped of punctuation, so a token can be matched between
  // spaces. \b is no use here: it is defined on ASCII word characters, so it
  // finds no boundary at all beside Urdu script — which is how "ایک" came to
  // be read as no answer.
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9؀-ۿ\s]/g, ' ')} `
  const has = (...words: string[]) => words.some((w) => t.includes(` ${w} `))

  if (has('a', '1', 'aik', 'ek', 'pehla', 'pehli', 'alif', 'ایک', 'پہلا', 'پہلی', 'اے'))
    return 'a'
  if (has('b', '2', 'do', 'dusra', 'doosra', 'dusri', 'bay', 'دو', 'دوسرا', 'دوسری', 'بی'))
    return 'b'
  if (has('c', '3', 'teen', 'teesra', 'teesri', 'jeem', 'تین', 'تیسرا', 'تیسری', 'سی'))
    return 'c'
  return null
}
