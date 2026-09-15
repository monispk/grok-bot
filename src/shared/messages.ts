/**
 * Every refusal the rider can see, with the recording that speaks it.
 *
 * These are defined once and imported by the code that sends them, so the text
 * and its audio cannot drift apart. A rider who cannot read the question cannot
 * read why they were turned back either, which is what these recordings fix.
 */
export type Spoken = { text: string; audio: string; recorded: boolean }

/**
 * `recorded: false` marks a line that is written but not yet voiced. It is sent
 * as text only, so the rider never meets a player that cannot play: a missing
 * file 404s, and the bubble removes itself and leaves a silent gap.
 */
const say = (text: string, audio: string, recorded = true): Spoken => ({
  text,
  audio,
  recorded,
})

export const SAY = {
  photoUnclear: say(
    'Tasveer saaf nahi aayi. Camera ko seedha rakh kar, achi roshni mein dobara khenchein.',
    '/say-photo-unclear',
  ),
  billTooOld: say(
    'Ye bill teen mahine se purana hai. Baraye meherbani pichlay teen mahine ka bill bhejein.',
    '/say-bill-too-old',
  ),
  cnicMismatch: say(
    'Is document par CNIC number aap ke CNIC se match nahi kar raha. Baraye meherbani sahi document bhejein.',
    '/say-cnic-mismatch',
  ),
  notCnicFront: say(
    'Ye CNIC ke saamne wali tasveer nahi lag rahi. Baraye meherbani CNIC ka front, achi roshni mein, dobara bhejein.',
    '/say-not-cnic-front',
  ),
  notCnicBack: say(
    'Ye CNIC ke peechay wali tasveer nahi lag rahi. Baraye meherbani CNIC ka back, achi roshni mein, dobara bhejein.',
    '/say-not-cnic-back',
  ),
  notLicense: say(
    'Ye driving license ki tasveer nahi lag rahi. Baraye meherbani license ka front, achi roshni mein, dobara bhejein.',
    '/say-not-license',
  ),
  /**
   * Said while the last check runs.
   *
   * A second or two of silence at the end of a ten-minute conversation reads
   * as the thing having crashed, and a rider who reloads then is a rider who
   * has to be found again by name and number.
   */
  verifyingFace: say(
    'Ek lamha — aap ki selfie ka CNIC ki tasveer se milan kiya ja raha hai.',
    '/say-verifying-face',
    false,
  ),
  /**
   * A licence sent as a PDF.
   *
   * The reader needs pixels, and a scanner app's PDF has no text layer worth
   * having either. Asking for a photograph is honest and costs the rider
   * nothing: the card is already in their hand.
   */
  licensePhotoPlease: say(
    'License ki PDF file ke bajaye, card ki seedhi tasveer khenchein — neeche camera ka nishan daba kar.',
    '/say-license-photo-please',
    false,
  ),
  /**
   * The licence read, but not well enough to trust.
   *
   * A guessed digit in a licence number is worse than no number, and a guessed
   * digit in a date has told a rider their valid licence had expired. So the
   * card is photographed again, with the three things that actually fix it —
   * light, glare, and holding the camera square.
   */
  licenseUnclear: say(
    'License ke number ya tareekh saaf nahi parhi ja rahi. Baraye meherbani achi roshni mein, seedha rukh kar ke, aur bina chamak (reflection) ke dobara tasveer khenchein.',
    '/say-license-unclear',
    false,
  ),
  /**
   * Two tries and still not readable. The rider is not stopped over it — the
   * card is in their hand and a recruiter can read it in a second.
   */
  licenseUnreadable: say(
    'Aap ka license theek se parha nahi ja saka. Koi baat nahi — aap ki application aage barh rahi hai, lekin apna asli driving license foodpanda office zaroor saath laayein.',
    '/say-license-unreadable',
    false,
  ),
  /**
   * An expired licence. Not a refusal: another photograph of the same card
   * cannot make it current, so the document is kept and the application goes
   * on — it simply stops being a verified one, and the rider is told now,
   * while there is still time to renew before making the journey.
   */
  licenseExpired: say(
    'Aap ke driving license ki tareekh guzar chuki hai — ye ab valid nahi hai. Aap ki application jama ho jaye gi, lekin pehle license renew karwa lein, aur naya license saath le kar foodpanda office aayein.',
    '/say-license-expired',
    false,
  ),
  billNoDate: say(
    'Is bill par due date nahi mil saki. Baraye meherbani poora bill, achi roshni mein, dobara bhejein.',
    '/say-bill-no-date',
  ),
  typeName: say(
    'Baraye meherbani apna naam likh kar bhejein, voice note ya tasveer nahi. Baaqi sawalon ke jawab aap voice note se bhi de saktay hain, lekin naam likhna zaroori hai.',
    '/say-type-name',
  ),
  badFileType: say(
    'Ye file qabool nahi ho saki. Sirf JPG, PNG, GIF ya PDF bhejein.',
    '/say-bad-file-type',
  ),
  fileTooBig: say(
    'File bohat bari hai. 10 MB se choti file bhejein.',
    '/say-file-too-big',
  ),
  uploadFailed: say(
    'File bhejne mein masla hua. Dobara koshish karein.',
    '/say-upload-failed',
  ),
  voiceUnclear: say(
    'Aap ki awaaz saaf nahi aayi. Baraye meherbani dobara bolein, ya likh kar bhejein.',
    '/say-voice-unclear',
  ),
  /**
   * The microphone, one line per way it can be unavailable.
   *
   * There used to be one line for all of them, telling the rider to allow the
   * microphone in their phone's settings. On UC Browser and Opera Mini — a
   * seventh of the phones in Pakistan — there is no such setting; what they
   * need is Chrome. A rider who had blocked it needs to be shown where; a rider
   * on a call needs to end the call. Same failure on screen, four different
   * things to do, so four lines, and a sheet for each.
   */
  micUnsupported: say(
    'Is browser mein voice note nahi bhej sakte. Ye page Chrome mein kholein, neeche button dabayein. Ya apna jawab likh kar bhejein.',
    '/say-mic-unsupported',
  ),
  micAsk: say(
    'Bolne ke liye microphone ki ijazat chahiye. Ab phone poochay ga, Allow dabayein.',
    '/say-mic-ask',
  ),
  micBlocked: say(
    'Microphone band hai. Isay kholne ke liye upar address ke saath taalay ke nishan par dabayein, phir Permissions mein Microphone ko Allow karein. Ya apna jawab likh kar bhejein.',
    '/say-mic-blocked',
  ),
  micBusy: say(
    'Microphone kisi aur app mein chal raha hai. Doosri app band kar ke dobara koshish karein.',
    '/say-mic-busy',
  ),
  micNone: say(
    'Is phone mein microphone nahi mil raha. Apna jawab likh kar bhejein.',
    '/say-mic-none',
  ),
  /** Shown after a tap, because a tap is what a rider used to WhatsApp tries first. */
  holdToTalk: say(
    'Bolne ke liye microphone ko dabaye rakhein, bolein, phir chhor dein.',
    '/say-hold-to-talk',
  ),
  micReady: say('Shukriya. Ab microphone ko dabaye rakh kar bolein.', '/say-mic-ready'),
  /**
   * "I have neither", said while the number is still being asked for. The
   * number is wanted regardless — it is how anyone reaches them — and the
   * wallet check simply comes back unchecked. Repeating the original question
   * would ask again about accounts they have just said they do not have.
   */
  noWalletAskNumber: say(
    'Koi baat nahi. Phir bhi apna mobile number bhejein, hum isi number par aap se raabta karein ge.',
    '/say-no-wallet',
  ),
  /**
   * The number just given has an unfinished application on it, by someone of
   * the same name. Asked, not assumed: a phone is often shared, and the rider
   * may want to start again.
   */
  resumeOffer: say(
    'Is number se pehle bhi application shuru ki gayi thi. Kya aap wahin se jaari rakhna chahte hain? Haan ya nahi likhein.',
    '/say-resume-offer',
  ),
  resumed: say('Theek hai. Wahin se chalte hain jahan aap ne chhora tha.', '/say-resumed'),
  startedFresh: say('Theek hai, nayi application shuru karte hain.', '/say-started-fresh'),
  /**
   * A phone number typed at the name question.
   *
   * The model was asked whether it was a name and said yes, so a rider was
   * greeted as "Shukriya 03051234567" and their real name, sent next, was
   * refused as a bad phone number. The name is matched against the CNIC and the
   * licence, so a wrong one fails a check nobody can trace back to this. A
   * string with no letters in it is not a name, whatever the model thinks —
   * and the number is kept, so it is not asked for twice.
   */
  numberNotName: say(
    'Ye aap ka mobile number lagta hai, wo hum aage poochein ge. Pehle apna poora naam likhein, jaisa ID Card par hai.',
    '/say-number-not-name',
  ),
  /**
   * The rider names their wallet at the number question — which answers the
   * question after this one, not this one. Recorded, then the number is asked
   * for again, naming the account so they know which number is wanted.
   */
  stillNeedNumber: say(
    'Shukriya. Ab baraye meherbani wohi mobile number bhejein jis par ye account hai.',
    '/say-still-need-number',
  ),
  /**
   * The same answer, once the number is already in hand.
   *
   * One line used to serve both moments, so a rider who said they had neither
   * wallet was asked for a number they had typed two messages earlier. What
   * they actually need to hear at this point is how the fee gets paid.
   */
  /*
   * The bank questions, asked only of a rider who has neither wallet.
   *
   * A rider with JazzCash or Easypaisa has already had this check run on their
   * mobile number without being asked anything at all; these two questions
   * exist so that a rider without one is not simply left unverified.
   *
   * All spoken at runtime rather than recorded: two of them carry a bank's
   * name, and none is worth a recording until the wording has settled.
   */
  askBank: say(
    'Aap ka bank account kis bank mein hai? Bank ka naam likh dein — maslan HBL, Meezan, ya UBL.',
    '/say-ask-bank',
    false,
  ),
  bankUnclear: say(
    'Maaf kijiye, bank ka naam samajh nahi aaya. Baraye meherbani poora naam likhein — maslan "Habib Bank", "Bank Al Habib", ya "Habib Metro".',
    '/say-bank-unclear',
    false,
  ),
  bankNotListed: say(
    'Maaf kijiye, is bank ko hum abhi check nahi kar sakte. Koi baat nahi — aap ki application aage barh rahi hai, bank ki tafseel office par le li jaye gi.',
    '/say-bank-not-listed',
    false,
  ),
  bankChecking: say(
    'Ek lamha — aap ke account ka naam check kiya ja raha hai.',
    '/say-bank-checking',
    false,
  ),
  bankMatched: say(
    'Shukriya! Aap ka bank account aap hi ke naam par hai — tasdeeq ho gayi.',
    '/say-bank-matched',
    false,
  ),
  /** Wrong number, most likely. One more go before giving up on it. */
  bankRetry: say(
    'Ye account number theek se nahi mila. Baraye meherbani apna account number dobara dekh kar likhein — bank ki app ya cheque book par poora number mil jaye ga.',
    '/say-bank-retry',
    false,
  ),
  /** Two tries. Not a reason to stop anybody. */
  bankGaveUp: say(
    'Koi baat nahi, aap ka bank account check nahi ho saka. Aap ki application aage barh rahi hai — office par apni bank ki tafseel saath laayein.',
    '/say-bank-gave-up',
    false,
  ),
  /** A real account, in somebody else's name. Recorded, never a refusal. */
  bankOtherName: say(
    'Ye account kisi aur ke naam par hai. Koi baat nahi — aap ki application aage barh rahi hai, lekin office par is ki tasdeeq karni hogi.',
    '/say-bank-other-name',
    false,
  ),
  askAccountNumber: say(
    'Ab apna account number likh dein. Poora number likhein, jaisay bank ki app ya cheque book par likha hai.',
    '/say-ask-account-number',
    false,
  ),
  noWalletPayAtOffice: say(
    'Koi baat nahi. Registration fee pachees sau rupay aap office aa kar, counter par jama kara sakte hain.',
    '/say-fee-at-office',
  ),
  /**
   * When the pin cannot be trusted — refused, never arrived, too vague, or a
   * rider far from both offices. Asking is better than guessing: a fix accurate
   * to five kilometres looks exactly like a good one and sends somebody across
   * a city for nothing.
   */
  /**
   * A number that is not a Pakistani mobile number. Said plainly, because
   * repeating the question told a rider who had typed one digit too many that
   * they had somehow failed to answer it.
   */
  badNumber: say(
    'Ye number theek nahi lag raha. Baraye meherbani apna poora mobile number check kar ke dobara likhein, jaise 0300 1234567.',
    '/say-bad-number',
  ),
  /** The pin was fine; the rider is simply far from both offices. Said so, plainly. */
  farFromOffices: say(
    'Shukriya, location mil gayi. Aap dono offices se kaafi door hain. Neeche bata dein, aap kis office aayein ge: Islamabad F8 Markaz, ya Rawalpindi Saddar.',
    '/say-far-from-offices',
  ),
  pickOffice: say(
    'Koi baat nahi. Aap khud bata dein: aap Islamabad ke F8 Markaz office aayein ge ya Rawalpindi ke Saddar office? Neeche apna office chunein.',
    '/say-pick-office',
  ),
  feeAsking: say(
    'Ab registration fee aap ke wallet se li ja rahi hai. Apne phone par aane wali request manzoor kar dein.',
    '/say-fee-asking',
  ),
  /**
   * A rail can time out while the debit succeeds, so this never says the money
   * was not taken — only that the result is not known yet.
   */
  feePending: say(
    'Aap ki payment confirm ho rahi hai. Jaise hi mukammal ho gi, hum isi chat par bata dein ge.',
    '/say-fee-pending',
  ),
  /**
   * The fee did not go through. Offered once, because a rail can refuse and
   * then accept the same payment seconds later.
   */
  feeRetry: say(
    'Fee jama nahi hui. Kya aap dobara koshish karna chahenge? Haan ya nahi.',
    '/say-fee-retry',
  ),
  feeFailed: say(
    'Fee abhi jama nahi hui. Koi baat nahi, aap office par counter par fee jama kara saktay hain.',
    '/say-fee-failed',
  ),
  underReview: say(
    'Aap ke documents mil gaye hain. Hamari team inhein check kar rahi hai. Jab ye mukammal ho jayen ge, hum isi number par aap se raabta karein ge. Abhi office aane ki zaroorat nahi.',
    '/say-under-review',
  ),
  needBike: say(
    'Is kaam ke liye apni bike zaroori hai. Jab aap ke paas bike ho, tab dobara raabta karein — hum aap ki madad karein ge.',
    '/say-need-bike',
  ),
  /**
   * What follows a missing phone or bike. The rider is not turned away: their
   * details are worth keeping, and they are told to come back to this same
   * chat when they have the thing.
   */
  /**
   * A required document the rider does not have.
   *
   * Not a rejection, and not the end of the conversation: the rest of their
   * details are still worth having, and they are told to come back to this
   * same chat. What it must not do is what it used to — repeat the line about
   * pressing the camera button at someone who has just explained, three
   * times, that there is nothing to photograph.
   */
  needLicense: say(
    'Foodpanda rider ke liye driving license zaroori hai. Jab aap ka license ban jaye, isi chat par wapas aa kar apni registration mukammal kar lijiye ga.',
    '/say-need-license',
    false,
  ),
  needCnicDoc: say(
    'Registration ke liye asli CNIC zaroori hai. Jab aap ke paas apna CNIC ho, isi chat par wapas aa kar apni registration mukammal kar lijiye ga.',
    '/say-need-cnic-doc',
    false,
  ),
  knockoutAck: say(
    'Theek hai, note kar liya. Abhi aap apne documents jama kara dein — jab aap ke paas ye cheez aa jaye, tab isi chat par aa kar registration mukammal kar lijiye ga.',
    '/say-knockout-ack',
  ),
  selfieRetry: say(
    'Selfie match nahi hui. Baraye meherbani neeche button daba kar dobara selfie khenchein — achi roshni mein, seedha camera ki taraf dekh kar.',
    '/say-selfie-retry',
  ),
  repeat: say(
    'Maazrat, samajh nahi aaya. Baraye meherbani dobara likhein.',
    '/say-repeat',
  ),
  /** Said once, before anything is asked for, so the fee is never a surprise. */
  /**
   * The requirements, and nothing else in the bubble with them.
   *
   * Three numbered lines a rider can count on their fingers. Buried in a
   * paragraph they were three clauses among six, and the one that decides
   * whether somebody continues — the fee — read like an aside.
   */
  docsBriefing: say(
    'Registration ke liye ye cheezein chahiye:\n\n1. Driving license ki picture\n2. CNIC ki picture\n3. Registration fee Rs. 2,500',
    '/say-docs-briefing',
  ),
  /** Everything that is not a requirement, kept out of the list above. */
  briefingNote: say(
    'Ye foodpanda ki official fee hai, kisi shakhs ko cash na dein. Main ye sab aap se ek ek kar ke maangungi. Agar aap ka koi sawal ho to neeche microphone ka button dabaye rakh kar kisi bhi waqt voice note bhej saktay hain.',
    '/say-briefing-note',
  ),
  railComingSoon: say(
    'JazzCash par ye sahulat abhi jald aa rahi hai. Filhaal Easypaisa se ho sakti hai — kya Easypaisa se jama kar dein? Warna aap office par counter par bhi de saktay hain.',
    '/say-rail-coming-soon',
  ),
  okDocument: say('Shukriya, tasveer mil gayi.', '/ok-document'),
  okLocation: say('Shukriya, location mil gayi.', '/ok-location'),
  okSmartphone: say('Theek hai.', '/ok-smartphone'),
  needSmartphone: say(
    'Is kaam ke liye bara screen wala touch phone zaroori hai. Jab aap ke paas aisa phone ho, tab dobara raabta karein — hum aap ki madad karein ge.',
    '/say-need-smartphone',
  ),
  locationDenied: say(
    'Location nahi mil saki. Baraye meherbani apne phone mein location ki ijazat dein, phir dobara koshish karein.',
    '/say-location-denied',
  ),

  /**
   * The city question, and what follows it.
   *
   * A rider types where they live; the answer decides which branches they are
   * offered. All three of these are spoken at runtime rather than recorded,
   * because two of them carry the rider's own city in them.
   */
  cityUnclear: say(
    'Maaf kijiye, sheher ka naam samajh nahi aaya. Baraye meherbani sirf apne sheher ka naam likhein — maslan Rawalpindi, Lahore, ya Peshawar.',
    '/say-city-unclear',
    false,
  ),
  /** Nothing we can offer them, and no reason to waste their journey. */
  noOfficeNearby: say(
    'Maaf kijiye. Filhaal aap ke sheher mein hamara koi office nahi hai. Aap ki maloomat mehfooz kar li gayi hai — jab aap ke ilaqay mein mauqa hua, hum aap se khud raabta karein ge. Shukriya!',
    '/say-no-office-nearby',
    false,
  ),
} as const

const BY_TEXT = new Map(
  Object.values(SAY)
    .filter((s) => s.recorded)
    .map((s) => [s.text, s.audio]),
)

const UNRECORDED = new Set(
  Object.values(SAY)
    .filter((s) => !s.recorded)
    .map((s) => s.text),
)

/**
 * A line that is ours but has no recording yet. Those are read aloud by Uplift
 * instead, so the rider hears them like everything else.
 */
export const awaitingVoice = (text: string): boolean => UNRECORDED.has(text.trim())

/** The recording for a message, if one has been made. */
export const audioForText = (text: string): string | null =>
  BY_TEXT.get(text.trim()) ?? null
