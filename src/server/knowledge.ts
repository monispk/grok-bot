/**
 * The ONLY facts the assistant may state. Written in Roman Urdu so the model can
 * reproduce approved answers almost verbatim rather than translating on the fly —
 * less generation means less room to invent.
 *
 * CONFLICT IN SOURCE: the documents list says the security deposit is Rs. 1,500,
 * while the onboarding steps, compensation section and objection-handling all say
 * Rs. 2,500. Rs. 2,500 is used here (three mentions to one). Confirm before this
 * goes to real riders — it is the number they are asked to hand over.
 */
export const KNOWLEDGE = `
=== JOB KI MAALOOMAT ===
Job ka naam: foodpanda Delivery Rider (bike / motorcycle rider).
Shehar: Islamabad. Branch office: F8 Markaz aur Rawalpindi.
Kaam kya hai: Rider partner restaurant ya store se khanay aur grocery ka order uthata hai aur foodpanda rider app istemal kar ke customer tak pohanchata hai. Apne waqt khud chuntay hain.
Bike: Apni motorbike hona zaroori hai.
Umar: Kam az kam 18 saal.
Kaam ki qisam: Freelancer (mulazim nahi).

=== SAWAL AUR MANZOOR SHUDA JAWAB ===
Kamai kitni hai: Hafte mein taqreeban Rs. 15,000 aur mahine mein taqreeban Rs. 60,000, agar rozana aoosatan 12 ghante kaam karein. Ye aoosat hai, pakka waada nahi.
Paise kab miltay hain: Har hafte, rider wallet mein.
Apni bike zaroori hai: Ji haan.
Apne ghante khud chun saktay hain: Ji haan, rider app se apni shift khud chunta hai.
Kaunse kaghzaat chahiye: Asli aur valid CNIC, Learner's ya asli valid Driving License, smartphone, bijli/gas ka taaza bill ki copy, aur Rs. 2,500 security deposit.
Security deposit wapas milta hai: Ji haan, wapas mil jata hai. Shart ye hai ke aap delivery bag theek haalat mein wapas karein, aap ko nikala na gaya ho, aur aap ke account par koi baqaya raqam na ho.
Onboarding mein kitna waqt lagta hai: Aik din.
Pehle ka tajurba chahiye: Nahi, koi tajurba zaroori nahi.
Agar smartphone theek na ho: Phir aap kaam nahi kar saktay. App ke liye iPhone iOS 9.0 ya Android 7.0 ya us se naya phone chahiye.
Kya auratein apply kar sakti hain: Ji haan.
Interview hota hai: Nahi.
Kya ye pakki ya sarkari naukri hai: Nahi. Ye freelancer kaam hai, mulazmat nahi hai. Aap apne kaam ke ghante khud chuntay hain.
WhatsApp par kaghzaat bhejnay ke baad kya hota hai: Rider ko apni branch office jana hota hai, Peer se Juma, dopahar 12 baje se shaam 6 baje tak, taake registration mukammal ho.

=== FAIDAY ===
Apne kaam ke ghante khud chunain.
WhatsApp se jaldi aur asaan registration.
Aoosatan mahine mein Rs. 60,000 se zyada, aur upar se bonus: joining bonus, daily quest, fuel bonus, refer bonus.
Haadsay ki insurance coverage.
Loyalty program, Rider of the Month, aur eid/tehwar ke inaamat.
Foodpanda aik jana pehchana aur mo'tabar brand hai.

=== KON APPLY KAR SAKTA HAI ===
Valid CNIC. Valid Learner's ya poora Driving License. Smartphone. Ghar ka taaza utility bill (pata sabit karne ke liye). Umar 18 saal ya us se zyada.

=== ONBOARDING KE MARHALAY ===
1. Rider WhatsApp agent se raabta karta hai.
2. Apni maaloomat deta hai aur ye cheezein bhejta hai: apni tasveer, CNIC, Driving License, utility bill ki tasveer.
3. Rs. 2,500 security deposit easypaisa, JazzCash ya HBL Konnect se jama karta hai.
4. Apni branch jata hai, Peer se Juma, dopahar 12 se shaam 6 baje tak.
5. Branch par bag aur shirt milti hai, app ki training hoti hai, aur pehli baar login karaya jata hai.

=== TANKHWAH AUR BONUS ===
Bunyadi kamai: Har delivery par rate, jo badalta rehta hai.
Bonus: Rush bonus, mausam ka bonus, daily quest, fuel bonus.
Adaigi: Har hafte.
Security deposit: Rs. 2,500.

=== KAAM KA TAREEQA ===
Shift: Rider app se apne ghante khud chunta hai.
Qisam: Freelancer.
Saamaan: foodpanda delivery bag aur shirt deta hai.
Ilaqa: Rider app se apni pasand ka ilaqa chun sakta hai.

=== AAM ETRAAZ AUR JAWAB ===
"Security deposit bohat zyada hai": Rs. 2,500 is liye liya jata hai taake aap ko delivery bag mil sakay aur registration mukammal ho. Jab aap kaam chhorain gay to ye poora wapas mil jata hai, agar bag theek haalat mein wapas karein, aap ko nikala na gaya ho, aur koi baqaya raqam na ho.
"Mere paas smartphone nahi hai": Is kaam ke liye smartphone bilkul zaroori hai.
"Mujhe kaise pata ye scam nahi": Ye foodpanda ka asli brand hai. Aap branch office ja kar khud tasdeeq kar saktay hain: F8 Markaz ya Rawalpindi, Peer se Juma, dopahar 12 se shaam 6 baje tak.
"Mere paas sirf learner's license hai": Learner's license qabool hai.
"Agar mujhe kaam pasand na aaya ya chhorna ho": Aap shift lena band kar saktay hain aur baad mein jab chahein wapas aa saktay hain.
"Kya main koi doosri job ke sath ye kaam kar sakta hoon": Ji haan, kyunke aap apne ghante khud chuntay hain.
`.trim()
