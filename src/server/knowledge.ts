/**
 * The ONLY facts the assistant may state. Written in Roman Urdu so the model can
 * reproduce approved answers almost verbatim rather than translating on the fly —
 * less generation means less room to invent.
 *
 * The source FAQ gave the security deposit as both Rs. 1,500 (documents list)
 * and Rs. 2,500 (three other sections). Confirmed 2026-08-22: it is Rs. 2,500.
 */
export const KNOWLEDGE = `
=== JOB KI MALOOMAT ===
Job ka naam: foodpanda Delivery Rider (bike / motorcycle rider).
Shehar: Islamabad. Branch office: F8 Markaz aur Rawalpindi.
Kaam kya hai: Rider restaurant ya store se khana aur grocery ka order uthata hai aur foodpanda rider app se customer tak pohanchata hai. Apna waqt khud chunta hai.
Bike: Apni motorbike honi zaroori hai.
Umar: 18 saal ya us se zyada.
Kaam ki qisam: Freelancer. Ye pakki naukri nahi hai.

=== SAWAL AUR JAWAB ===
Kamai kitni hai: Agar aap roz 12 ghante kaam karein to hafte mein Rs. 15,000 tak aur mahine mein Rs. 60,000 tak mil saktay hain. Ye pakka waada nahi. Kam ya zyada bhi ho sakta hai.
Paise kab miltay hain: Har hafte, rider wallet mein.
Apni bike zaroori hai: Ji haan.
Apne ghante khud chun saktay hain: Ji haan, rider app se apni shift khud chuntay hain.
Kaunse documents chahiye: Asli CNIC, Learner's ya poora Driving License, smartphone, bijli ya gas ka naya bill, aur Rs. 2,500 security deposit.
Security deposit wapas milta hai: Ji haan, poora wapas mil jata hai. Bas delivery bag theek haalat mein wapas karein, aap ko kaam se nikala na gaya ho, aur aap ne foodpanda ko koi paisa dena na ho.
Onboarding mein kitna waqt lagta hai: Aik din.
Pehle ka tajurba chahiye: Nahi, koi tajurba zaroori nahi.
Agar smartphone theek na ho: Phir aap kaam nahi kar saktay. App chalane ke liye iPhone iOS 9.0 ya Android 7.0 ya us se naya phone chahiye.
Kya auratein apply kar sakti hain: Ji haan.
Interview hota hai: Nahi.
Foodpanda ka office kahan hai: Do office hain. Aik F8 Markaz, Islamabad mein, aur doosra Rawalpindi mein. Aap Peer se Juma, dopahar 12 baje se shaam 6 baje tak ja saktay hain.
Mujhe kis office jana hoga: Jo office aap ke ghar se qareeb ho, F8 Markaz Islamabad ya Rawalpindi.
Kya ye pakki ya sarkari naukri hai: Nahi. Ye freelancer kaam hai, naukri nahi. Aap apne kaam ke ghante khud chuntay hain.
WhatsApp par documents bhejnay ke baad kya hota hai: Rider ko apni branch office jana hota hai, Peer se Juma, dopahar 12 baje se shaam 6 baje tak, taake registration poori ho jaye.

=== IS KAAM KE FAIDAY ===
Apne kaam ke ghante khud chunain.
WhatsApp se jaldi aur asaan registration.
Mahine mein Rs. 60,000 se zyada, aur upar se bonus: joining bonus, daily quest, fuel bonus, refer bonus.
Accident ki insurance.
Loyalty program, Rider of the Month, aur eid ke inaam.
Foodpanda aik jana pehchana aur bharosay wala brand hai.

=== KON APPLY KAR SAKTA HAI ===
Asli CNIC. Learner's ya poora Driving License. Smartphone. Ghar ka naya bijli ya gas ka bill (pata check karne ke liye). Umar 18 saal ya us se zyada.

=== REGISTRATION KE QADAM ===
1. Rider WhatsApp agent se baat karta hai.
2. Apni maloomat deta hai aur ye cheezein bhejta hai: apni tasveer, CNIC, Driving License, bill ki tasveer.
3. Rs. 2,500 security deposit easypaisa, JazzCash ya HBL Konnect se jama karta hai.
4. Apni branch jata hai, Peer se Juma, dopahar 12 se shaam 6 baje tak.
5. Branch par bag aur shirt milti hai, app ki training hoti hai, aur pehli baar login karaya jata hai.

=== PAISE AUR BONUS ===
Har delivery ke paise: Har delivery par rate milta hai, jo badalta rehta hai.
Bonus: Rush bonus, mausam ka bonus, daily quest, fuel bonus.
Paise kab: Har hafte.
Security deposit: Rs. 2,500.

=== KAAM KA TAREEQA ===
Shift: Rider app se apne ghante khud chuntay hain.
Qisam: Freelancer.
Cheezein: foodpanda delivery bag aur shirt deta hai.
Ilaqa: Rider app se apni pasand ka ilaqa chun saktay hain.

=== AAM SAWAL AUR JAWAB ===
"Security deposit bohat zyada hai": Rs. 2,500 is liye liya jata hai taake aap ko delivery bag mil sakay aur registration poori ho. Jab aap kaam chhorain gay to ye poora wapas mil jata hai, agar bag theek haalat mein wapas karein, aap ko kaam se nikala na gaya ho, aur aap ne koi paisa dena na ho.
"Mere paas smartphone nahi hai": Is kaam ke liye smartphone bilkul zaroori hai.
"Mujhe kaise pata ye scam nahi": Ye foodpanda ka asli brand hai. Aap branch office ja kar khud dekh saktay hain: F8 Markaz ya Rawalpindi, Peer se Juma, dopahar 12 se shaam 6 baje tak.
"Mere paas sirf learner's license hai": Learner's license chalta hai.
"Agar mujhe kaam pasand na aaya ya chhorna ho": Aap shift lena band kar saktay hain aur baad mein jab chahein wapas aa saktay hain.
"Kya main koi doosri job ke sath ye kaam kar sakta hoon": Ji haan, kyunke aap apne ghante khud chuntay hain.
`.trim()
