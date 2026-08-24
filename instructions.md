# Foodpanda Delivery Rider Onboarding — implemented behaviour

What this bot does today, the exact words it says, and where every recording
lives. Written from the source, not from memory.

Live: <https://grok-bot-production-b3a4.up.railway.app>

---

## 1. What is implemented

### Conversation

- Replies **only in simple Roman Urdu**. Urdu script and English are both
  forbidden by the system prompt, and a live test caught the model appending an
  Urdu-script translation, which the prompt now bans with a worked example.
- Short answers, one question at a time, `aap` throughout.
- **Answers only from the approved FAQ** (`src/server/knowledge.ts`). Anything
  outside it gets "mujhe is baare mein poori maloomat nahi hai" plus a pointer to
  the branch. No invented rates, dates or policies.
- **Guard rail**: off-topic, romantic or abusive turns get one flat redirect and
  the pending question repeated. Questions about the job itself — pay, documents,
  bike, hours, branch — are explicitly in scope and never refused.
- Earnings are always stated as an average, never a promise; the role is never
  described as permanent employment.
- The model **never drives the flow**. It cannot ask for a document or skip a
  step; it only answers questions and phrases outcomes.

### The application

A fixed sequence walked by code. A step advances only when the right kind of
input actually arrives — text at a document step is treated as a question,
answered, and the step repeats.

1. Full name (typed — never a voice note or photo)
2. Smartphone check (yes / no gate)
3. Selfie
4. Driving licence, front
5. CNIC, front
6. CNIC, back
7. Utility bill (must be within three months)
8. GPS location
9. Accepted

Answering **no** to the smartphone question ends the flow with an explanation
rather than collecting documents that cannot be used. The session is kept, so
the rider can resume if that changes.

### Document verification

- OCR runs **in-process** (PaddleOCR via onnxruntime). No Python, no second
  service, no per-call cost.
- Each document is checked for the combination of fields that identifies it, so
  a licence sent when the CNIC was asked for is refused rather than accepted as
  the wrong thing.
- **Dates are found by geometry**, not reading order: the nearest date directly
  below its label. A LESCO bill prints reading, issue and due dates side by side
  plus two more for paying late; this returns the due date.
- The bill's **address and consumer name** are read and shown. The bill need not
  be in the rider's name.
- **Bills older than three months are refused.**
- The **CNIC number is remembered** from the first document and every later one
  is checked against it. Thirteen digits either match or they do not, so this
  blocks.
- **Names never block.** Roman Urdu spelling varies far too much to refuse a
  rider over it, so the comparison is recorded for the branch. Matching folds
  transliteration variants, tolerates OCR noise, recovers names OCR ran together,
  and compares by sound as well as spelling.
- Uploads accept **jpg, png, gif and pdf**, validated by their magic bytes rather
  than the filename. A PDF with a text layer is read directly, no OCR needed.
- **Verification fails open.** If OCR is unavailable, or a PDF has no text layer,
  the document is accepted unchecked rather than trapping a rider behind our
  pipeline. The branch visit is the backstop.

Reusable entry points for other bots — no HTTP, no transport coupling:

```ts
checkCnicFront(doc, against?)   checkCnicBack(doc, against?)
checkLicense(doc, against?)     checkBill(doc)
```

### Two front ends, one core

| | |
| --- | --- |
| **Web app** | camera and attachment buttons, front camera for the selfie, staged reveal, debug panel, map |
| **WhatsApp** | webhook with signature verification, media download, session store, same sequence |

The steps, prompts, FAQ, verification and name matching are shared. Only the
transport differs. WhatsApp is inert until its credentials are set.

### Spoken, not just written

Every question and every refusal is **spoken as well as written**, because many
riders read Roman Urdu poorly. A rider who cannot read the question could not
read why they were turned back either — which is why the refusals are recorded
too, not only the questions.

### Interface

- Foodpanda magenta `#D70F64`, panda mark in the header, app icons, "Powered by
  rozeegpt.ai" under the composer.
- Phone-first layout, 16px composer so iOS does not zoom, safe-area insets,
  44px touch targets, installable to the home screen.
- Messages arrive **one at a time**, words appearing quickly — the welcome
  settles in about 1.8 seconds — and the newest line stays against the composer
  so the rider never scrolls.
- A photo appears **immediately** with a spinner rather than after the upload.
- Optional shared-password gate.

### Tests

`npm test` — 20 unit tests: name matching, the yes/no reader, message lookups.
`npm run e2e` — 5 browser tests: staged arrival, scroll pinning, history not
replayed, a refused document keeping its voice note, and a second wrong document
still being answered. The last two are regression guards for bugs that shipped.

---

## 2. Every word the bot says

### Welcome — sent once, on first contact

| Order | What |
| --- | --- |
| 1 | Image — `welcome.jpg` |
| 2 | Voice note — `welcome.opus` |
| 3 | `Assalam o Alaikum! Foodpanda delivery rider ki job mein khush aamdeed.` |
| 4 | `Mera naam Rozeena hai. Agar aap achi job dhoondh rahay hain tu Foodpanda delivery rider ki job ke liye apply karein.` |
| 5 | `Main aapki madad karungi. Chalein shuru karte hain.` |
| 6 | The name question (below), with its recording |

### The questions

**1. Name** — `/ask-name`

> Aapka poora naam jo CNIC par hai, kya hai?

If the wrong sort of answer arrives:
> Baraye meherbani apna poora naam likh kar bhejein.

**2. Smartphone** — `/ask-smartphone`

> Kya aap ke paas apna baray screen wala touch phone hai? Touch phone foodpanda rider job ke liye zaroori hai.

If neither yes nor no can be read:
> Baraye meherbani "haan" ya "nahi" likh kar bataein.

**3. Selfie** — `/ask-selfie`

Web:
> Ab apni aik selfie khenchein. Camera ka button dabayein aur apna chehra saaf dikhayein.

WhatsApp:
> Ab apni aik selfie khenchein aur bhejein. Apna chehra saaf dikhayein.

Retry: `Iske liye aap ki selfie chahiye.` plus, on the web,
`Neeche camera ka nishan daba kar apni tasveer khenchein.` and on WhatsApp
`Apni selfie khenchein aur isi chat mein bhej dein.`

**4. Driving licence, front** — `/ask-license-front`

> Ab apne driving license ke saamne wale hissay (front) ki tasveer bhejein.

Retry: `Iske liye driving license ke front ki tasveer chahiye.`

**5. CNIC, front** — `/ask-cnic-front`

> Ab apne CNIC ke saamne wale hissay (front) ki tasveer bhejein.

Retry: `Iske liye CNIC ke front ki tasveer chahiye.`

**6. CNIC, back** — `/ask-cnic-back`

> Ab apne CNIC ke peechay wale hissay (back) ki tasveer bhejein.

Retry: `Iske liye CNIC ke back ki tasveer chahiye.`

**7. Utility bill** — `/ask-utility-bill`

> Ab apne ghar ka utility bill (bijli, gas ya paani) ki tasveer bhejein jis par aap ke rehne ka pata likha ho. Bill pichlay teen mahine ke andar ka hona chahiye. Bill kisi aur ke naam par ho to bhi theek hai.

Retry: `Iske liye utility bill ki tasveer chahiye jis par pata likha ho.`

**8. Location** — `/ask-gps`

Web:
> Aakhri kaam. Apni location bhejein taake hum aap ko sab se qareeb foodpanda office bata sakein. Neeche "Location bhejein" ka button dabayein.

WhatsApp:
> Aakhri kaam. Apni location bhejein taake hum aap ko sab se qareeb foodpanda office bata sakein. Attach (📎) daba kar "Location" chunein.

Retry: `Iske liye aap ki location chahiye.`

Shared retry hint on the web for every upload step:
> Neeche camera ka nishan daba kar tasveer khenchein, ya clip ka nishan daba kar file chunein.

and on WhatsApp:
> Tasveer khenchein aur isi chat mein bhej dein.

### Confirmations

| When | Words |
| --- | --- |
| Name accepted | `Shukriya <first name>!` |
| Smartphone confirmed | `Theek hai.` |
| A document accepted | `Shukriya, tasveer mil gayi.` |
| Location received | `Shukriya, location mil gayi.` |

### Closing

> Mubarak ho `<first name>`! Aap ki application manzoor ho gayi hai.

> Aap ka pata jo bill par mila: `<address from the bill>`

> Ab aap foodpanda office aa kar apni uniform lein aur training mukammal karein. Office Peer se Juma, dopahar 12 baje se shaam 6 baje tak khula hai.

### Refusals

| Recording | When | Words |
| --- | --- | --- |
| `/say-photo-unclear` | Too blurred or tilted to read | Tasveer saaf nahi aayi. Camera ko seedha rakh kar, achi roshni mein dobara khenchein. |
| `/say-bill-too-old` | Bill due date over three months old | Ye bill teen mahine se purana hai. Baraye meherbani pichlay teen mahine ka bill bhejein. |
| `/say-cnic-mismatch` | CNIC number differs across documents | Is document par CNIC number aap ke CNIC se match nahi kar raha. Baraye meherbani sahi document bhejein. |
| `/say-not-cnic-front` | Not the front of a CNIC | Ye CNIC ke saamne wali tasveer nahi lag rahi. Baraye meherbani CNIC ka front, achi roshni mein, dobara bhejein. |
| `/say-not-cnic-back` | Not the back of a CNIC | Ye CNIC ke peechay wali tasveer nahi lag rahi. Baraye meherbani CNIC ka back, achi roshni mein, dobara bhejein. |
| `/say-not-license` | Not a driving licence | Ye driving license ki tasveer nahi lag rahi. Baraye meherbani license ka front, achi roshni mein, dobara bhejein. |
| `/say-bill-no-date` | Bill readable, no due date found | Is bill par due date nahi mil saki. Baraye meherbani poora bill, achi roshni mein, dobara bhejein. |
| `/say-type-name` | Voice note or photo at the name question | Baraye meherbani apna naam likh kar bhejein, voice note ya tasveer nahi. Baaqi sawalon ke jawab aap voice note se bhi de saktay hain, lekin naam likhna zaroori hai. |
| `/say-bad-file-type` | Not jpg, png, gif or pdf | Ye file qabool nahi ho saki. Sirf JPG, PNG, GIF ya PDF bhejein. |
| `/say-file-too-big` | Over 10 MB | File bohat bari hai. 10 MB se choti file bhejein. |
| `/say-upload-failed` | Transfer failed | File bhejne mein masla hua. Dobara koshish karein. |
| `/say-location-denied` | Location permission refused | Location nahi mil saki. Baraye meherbani apne phone mein location ki ijazat dein, phir dobara koshish karein. |
| `/say-need-smartphone` | No smartphone — ends the flow | Is kaam ke liye bara screen wala touch phone zaroori hai. Jab aap ke paas aisa phone ho, tab dobara raabta karein — hum aap ki madad karein ge. |

---

## 3. Sound files

All live in `public/`, served from the site root — `public/ask-name.opus` is
`https://<host>/ask-name.opus`.

Each exists **twice**: `.opus` (Ogg/Opus, mono 48 kHz) for Android, Chrome and
WhatsApp voice notes, and `.m4a` (AAC, mono 24 kHz) because iOS Safari will not
play Ogg. The player picks whichever the browser reports it can decode; WhatsApp
is always sent the `.opus`, since Meta accepts opus only inside an ogg container.

They are served as `audio/ogg` and `audio/mp4` — a generic byte stream is refused
by Meta and will not play on iOS.

| File | Length | Description |
| --- | --- | --- |
| `welcome.opus` / `.m4a` | 13.0s | Spoken introduction, sent with the welcome image |
| `ask-name.opus` / `.m4a` | 4.0s | Asks for the full name as printed on the CNIC |
| `ask-smartphone.opus` / `.m4a` | 6.0s | Asks whether the rider has a large-screen touch phone |
| `ask-selfie.opus` / `.m4a` | 5.3s | Asks for a selfie with the face clearly visible |
| `ask-license-front.opus` / `.m4a` | 7.6s | Asks for the front of the driving licence |
| `ask-cnic-front.opus` / `.m4a` | 8.2s | Asks for the front of the CNIC |
| `ask-cnic-back.opus` / `.m4a` | 3.6s | Asks for the back of the CNIC |
| `ask-utility-bill.opus` / `.m4a` | 12.1s | Asks for a utility bill showing the address, within three months |
| `ask-gps.opus` / `.m4a` | 9.8s | Asks the rider to share their location |
| `say-photo-unclear.opus` / `.m4a` | 6.8s | The photo could not be read; hold the camera straight, good light |
| `say-bill-too-old.opus` / `.m4a` | 6.1s | The bill is more than three months old |
| `say-cnic-mismatch.opus` / `.m4a` | 6.4s | The CNIC number does not match the one already given |
| `say-not-cnic-front.opus` / `.m4a` | 7.5s | This is not the front of a CNIC |
| `say-not-cnic-back.opus` / `.m4a` | 7.4s | This is not the back of a CNIC |
| `say-not-license.opus` / `.m4a` | 6.9s | This is not a driving licence |
| `say-bill-no-date.opus` / `.m4a` | 6.5s | No due date could be found on the bill |
| `say-type-name.opus` / `.m4a` | 8.7s | The name must be typed, not recorded or photographed |
| `say-bad-file-type.opus` / `.m4a` | 6.4s | Only jpg, png, gif or pdf are accepted |
| `say-file-too-big.opus` / `.m4a` | 5.7s | The file is over 10 MB |
| `say-upload-failed.opus` / `.m4a` | 4.4s | The transfer failed; try again |
| `say-location-denied.opus` / `.m4a` | 6.2s | Location was refused; allow it and try again |
| **`say-need-smartphone`** | — | **Not yet recorded.** A smartphone is required for the job |

Also in `public/`: `welcome.jpg` (the branded image), `panda.png` (header mark),
`rozeegpt.png` (the credit wordmark), and the app icons.

### Adding or replacing a recording

Convert to both formats under the exact file name and it is picked up with no
code change — the slot is already wired, and any file that is missing simply
leaves that message text-only.

```bash
ffmpeg -i new.mp3 -c:a libopus -b:a 32k -ar 48000 -ac 1 -application voip public/<name>.opus
```

```bash
ffmpeg -i new.mp3 -c:a aac -b:a 48k -ar 24000 -ac 1 public/<name>.m4a
```

Recordings must not mention any on-screen control. The selfie and location
questions are worded differently on the web and on WhatsApp, and one recording
serves both.

---

## 4. Not yet implemented

| | |
| --- | --- |
| `say-need-smartphone` | The one missing recording; that message is text-only |
| Face match | The selfie is collected but nothing compares it to the CNIC photo. The debug panel shows this check as pending rather than passed |
| Nearest office | The closing message names both offices; it does not yet pick one from the GPS fix |
| Verification fail path | Verification is real, but there is no separate "go to the branch to be verified manually" branch yet |
| WhatsApp credentials | The webhook is built and tested against a stubbed Graph API. `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` and `PUBLIC_BASE_URL` are needed to bring it up |
| Session storage | WhatsApp sessions are held in memory, so a redeploy loses anyone mid-application. This is also where CNIC data would live, so it needs the encryption, access control and retention rules in `docs/onboarding-flow.md` |
| Groq tier | The free tier allows roughly three messages a minute across all riders |
| Other utilities | The bill rules are proven against LESCO. SNGPL, K-Electric, MEPCO and others are untested and may use different labels |
