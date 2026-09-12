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
    stem: "foodpanda attire میں کیسی t-shirt شامل ہے؟",
    options: [
      { key: 'a', text: "formal t-shirt" },
      { key: 'b', text: "foodpanda t-shirt" },
      { key: 'c', text: "کوئی بھی اپنی پسند کی t-shirt" },
    ],
  },
  {
    id: 'q2',
    stem: "foodpanda attire کے ساتھ ان میں سے کیا چیز safety کے لیے سب سے ضروری ہے؟",
    options: [
      { key: 'a', text: "sunglasses" },
      { key: 'b', text: "powerbank" },
      { key: 'c', text: "helmet" },
    ],
  },
  {
    id: 'q3',
    stem: "اگر آپ کی طبیعت ٹھیک نہیں ہے تو pick کی ہوئی shift کا کیا کریں؟",
    options: [
      { key: 'a', text: "shift کو swap کریں اور آرام کریں" },
      { key: 'b', text: "اگر shift لی ہے تو ہر صورت کام پہ آئیں" },
      { key: 'c', text: "اپنے دوست کو shift کرنے کے لیے بھیج دیں" },
    ],
  },
  {
    id: 'q4',
    stem: "shift start کرنے سے پہلے ID login کرنے کے لیے کیسی selfie قابلِ قبول ہے؟",
    options: [
      { key: 'a', text: "selfie میں face clear ہو اور foodpanda shirt ہو" },
      { key: 'b', text: "selfie میں face پہ mask ہو" },
      { key: 'c', text: "selfie میں background کی چیزیں نظر آ رہی ہوں" },
    ],
  },
  {
    id: 'q5',
    stem: "اپنا password اور OTP کس کے ساتھ share کر سکتے ہیں؟",
    options: [
      { key: 'a', text: "جو مانگے اس کے ساتھ" },
      { key: 'b', text: "صرف staff members کے ساتھ" },
      { key: 'c', text: "کسی کے ساتھ بھی نہیں" },
    ],
  },
  {
    id: 'q6',
    stem: "اگر کسی call یا whatsapp number پہ foodpanda staff بتا کر آپ سے password یا OTP مانگا جائے تو کیا کریں؟",
    options: [
      { key: 'a', text: "فوراً دے دیں" },
      { key: 'b', text: "ہرگز نہیں دیں، یہ صرف آپ کو پتہ ہونا چاہیے، foodpanda نمائندے کو بھی نہیں" },
      { key: 'c', text: "انہیں نہیں لیکن office staff کو دے دیں" },
    ],
  },
  {
    id: 'q7',
    stem: "selfie میں کسی اور کی تصویر یا ID share کرنے پہ کیا action لیا جاتا ہے؟",
    options: [
      { key: 'a', text: "ایک اور chance دیا جاتا ہے" },
      { key: 'b', text: "suspend کیا جاتا ہے" },
      { key: 'c', text: "contract ختم کر دیا جاتا ہے" },
    ],
  },
  {
    id: 'q8',
    stem: "fake ID کے استعمال پہ company کیا کرتی ہے؟",
    options: [
      { key: 'a', text: "ID بند کر دیتی ہے اور earning بھی hold کر لیتی ہے" },
      { key: 'b', text: "کچھ نہیں کرتی ہے" },
      { key: 'c', text: "ایسا کرنا allowed ہے" },
    ],
  },
  {
    id: 'q9',
    stem: "restaurant کے orders pick کرتے ہی سب سے پہلے کیا کرنا چاہیے؟",
    options: [
      { key: 'a', text: "pick up mark کر دینا چاہیے" },
      { key: 'b', text: "menu کے حساب سے order کو check کرنا چاہیے" },
      { key: 'c', text: "customer کو call کرنی چاہیے" },
    ],
  },
  {
    id: 'q10',
    stem: "homechef کی location نہ مل رہی ہو تو کیا کریں؟",
    options: [
      { key: 'a', text: "dispatch سے رابطہ کریں" },
      { key: 'b', text: "order cancel کرا دیں" },
      { key: 'c', text: "homechef کو call کریں" },
    ],
  },
  {
    id: 'q11',
    stem: "foodpanda میں صرف food delivery ہی کی جاتی ہے؟",
    options: [
      { key: 'a', text: "food delivery، grocery اور shops سب کے orders foodpanda پہ موجود ہیں" },
      { key: 'b', text: "food delivery اور grocery ہی کی جاتی ہے" },
      { key: 'c', text: "جی، صرف food delivery ہی کی جاتی ہے" },
    ],
  },
  {
    id: 'q12',
    stem: "cigarette delivery کے لیے کیا ضروری ہے؟",
    options: [
      { key: 'a', text: "customer سے ID card مانگنا" },
      { key: 'b', text: "order صرف اٹھارہ سال سے بڑے customer کے ہاتھ میں ہی دینا" },
      { key: 'c', text: "دونوں options ٹھیک ہیں" },
    ],
  },
  {
    id: 'q13',
    stem: "order کی اگر pin location غلط ہے تو کیا کریں؟",
    options: [
      { key: 'a', text: "dispatch chat پہ آ کر update کرائیں" },
      { key: 'b', text: "خود deliver کرنے چلے جائیں" },
      { key: 'c', text: "order cancel کرا دیں" },
    ],
  },
  {
    id: 'q14',
    stem: "order handle کرنے میں سب سے اہم کیا چیز ہے؟",
    options: [
      { key: 'a', text: "order کو bike کے tank پہ رکھا جائے" },
      { key: 'b', text: "delivery bag کا صحیح استعمال کرتے ہوئے order bag میں رکھا جائے" },
      { key: 'c', text: "order کو bike کے side پہ لٹکایا جائے" },
    ],
  },
  {
    id: 'q15',
    stem: "shift کے دوران bike کہاں park کریں؟",
    options: [
      { key: 'a', text: "customer یا vendor کے gate پر" },
      { key: 'b', text: "no parking پر" },
      { key: 'c', text: "parking area میں double stand پر" },
    ],
  },
  {
    id: 'q16',
    stem: "کسی بھی vendor کے پاس پہنچ کر wait کرتے ہوئے کیا کریں؟",
    options: [
      { key: 'a', text: "vendor سے ہر اگلے minute order کا پوچھیں" },
      { key: 'b', text: "تحمل سے order ready ہونے کا wait کریں" },
      { key: 'c', text: "dispatch پہ آ کر بتائیں کہ آپ پہنچ گئے ہیں" },
    ],
  },
  {
    id: 'q17',
    stem: "customer کو order دے کے foodpanda rider آخری چیز کیا کرتے ہیں؟",
    options: [
      { key: 'a', text: "ان کے number پہ messages کرتے ہیں" },
      { key: 'b', text: "ان سے extra پیسے یا tip مانگتے ہیں" },
      { key: 'c', text: "انہیں foodpanda کا استعمال کرنے پہ thank you کہتے ہیں" },
    ],
  },
  {
    id: 'q18',
    stem: "order cancel ہو جانے پہ return trip بن جائے تو cancel order کہاں لے کے جائیں؟",
    options: [
      { key: 'a', text: "اسی same vendor کو جا کے return کریں" },
      { key: 'b', text: "اگلے vendor کو جا کے return کریں" },
      { key: 'c', text: "اپنی مرضی کے vendor کو جا کے return کریں" },
    ],
  },
  {
    id: 'q19',
    stem: "ایک ہی vendor کے زیادہ orders ہوں انہیں stacked orders کہتے ہیں، ایسے orders کا کیا کریں؟",
    options: [
      { key: 'a', text: "دونوں orders کو pick up mark کریں" },
      { key: 'b', text: "پہلے order کو pick up mark کریں، دوسرے order کے لیے wait کریں" },
      { key: 'c', text: "جو order مل جائے اسے لے کے چلے جائیں" },
    ],
  },
  {
    id: 'q20',
    stem: "vendor کے experience کو foodpanda کے ساتھ کیسے share کریں؟",
    options: [
      { key: 'a', text: "vendor کو pick up screen پہ rate کریں اور comments دیں" },
      { key: 'b', text: "vendor کو بتائیں" },
      { key: 'c', text: "کسی سے share نہیں کریں" },
    ],
  },
  {
    id: 'q21',
    stem: "اگر customer order لینے سے منع کر دے تو کیا کریں؟",
    options: [
      { key: 'a', text: "customer کو زبردستی order لینے کا کہیں" },
      { key: 'b', text: "dispatch chat پہ بتائیں" },
      { key: 'c', text: "order خود رکھ لیں" },
    ],
  },
  {
    id: 'q22',
    stem: "اگر return trip نہ ہو تو cancelled order کا کیا کریں؟",
    options: [
      { key: 'a', text: "اسی same vendor کو جا کے return کریں" },
      { key: 'b', text: "order خود رکھ لیں" },
      { key: 'c', text: "اگلے vendor کو return کریں جہاں آپ کا اگلا order آیا ہے اور dispatch chat پہ picture بھیجیں" },
    ],
  },
  {
    id: 'q23',
    stem: "اگر customer کا address نہیں مل رہا ہو تو کیا کریں؟",
    options: [
      { key: 'a', text: "rider customer chat پہ customer سے رابطہ کریں یا call کریں" },
      { key: 'b', text: "رابطہ نہ ہونے پہ دس minute بعد dispatcher سے dispatch chat پہ رابطہ کریں" },
      { key: 'c', text: "دونوں options ٹھیک ہیں" },
    ],
  },
  {
    id: 'q24',
    stem: "ایک قابلِ قبول cancelled order کی picture کیسی ہوتی ہے؟",
    options: [
      { key: 'a', text: "picture میں مکمل order، vendor background یا device اور receive کرنے والا شامل ہو" },
      { key: 'b', text: "picture میں بس order ہونا کافی ہے" },
      { key: 'c', text: "picture میں بس vendor shop کی تصویر ہونا کافی ہے" },
    ],
  },
  {
    id: 'q25',
    stem: "اگر vendor cancelled order لینے سے منع کر دے تو کیا کریں؟",
    options: [
      { key: 'a', text: "order خود رکھ لیں" },
      { key: 'b', text: "order اگلے vendor کو دے کے picture dispatch chat پہ بھیجیں" },
      { key: 'c', text: "وہ order واپس customer کو دے دیں" },
    ],
  },
  {
    id: 'q26',
    stem: "dispatch chat سے رابطہ کب کیا جائے؟",
    options: [
      { key: 'a', text: "جب آپ کو کوئی order نہیں لگے ہوئے ہوں" },
      { key: 'b', text: "جب آپ کو live order delivery کے دوران کوئی مسئلہ آئے" },
      { key: 'c', text: "جب آپ کو salary کو لے کے کوئی سوال ہو" },
    ],
  },
  {
    id: 'q27',
    stem: "chat پہ اپنا مسئلہ کیسے بیان کریں؟",
    options: [
      { key: 'a', text: "dispatch agent کو call کرنے کا کہتے رہیں" },
      { key: 'b', text: "chat پہ اپنا مسئلہ type کر کے بتائیں اور تحمل سے wait کریں" },
      { key: 'c', text: "agent کو ہر minute message کرتے رہیں" },
    ],
  },
  {
    id: 'q28',
    stem: "dispatch agent یا ticket agent کے ساتھ تجربہ کس سے share کریں؟",
    options: [
      { key: 'a', text: "chat یا ticket کے end میں rating اور feedback دے کے" },
      { key: 'b', text: "dispatch chat پہ agent کو بتا کے" },
      { key: 'c', text: "دوسرے riders کے ساتھ share کر کے" },
    ],
  },
  {
    id: 'q29',
    stem: "rider support پہ non live issues کا جواب کتنی دیر میں آ سکتا ہے؟",
    options: [
      { key: 'a', text: "فوراً آتا ہے" },
      { key: 'b', text: "چوبیس گھنٹے میں آتا ہے" },
      { key: 'c', text: "اگلے دن آتا ہے" },
    ],
  },
  {
    id: 'q30',
    stem: "اگر آپ پہ غلط penalty یا suspension لگی ہے تو کیا کریں؟",
    options: [
      { key: 'a', text: "اگلے دن سے کام پہ نہیں آئیں" },
      { key: 'b', text: "اپنی appeal investigation کے لیے ticket کے ذریعے بھیجیں" },
      { key: 'c', text: "کوئی راستہ نہیں ہے" },
    ],
  },
  {
    id: 'q31',
    stem: "accident کی صورت میں کیا کریں؟",
    options: [
      { key: 'a', text: "website پہ موجود، hub staff کے پاس یا rider coordinator کے ذریعے insurance company سے رابطہ کریں" },
      { key: 'b', text: "کچھ نہیں کریں، insurance نہیں دی جاتی" },
      { key: 'c', text: "اپنا کام جاری رکھیں جیسے ہو سکے" },
    ],
  },
  {
    id: 'q32',
    stem: "اگر مسئلہ chat یا dispatch پہ بھی حل نہ ہو رہا ہو تو کیا کریں؟",
    options: [
      { key: 'a', text: "اگلے دن سے shift پہ نہیں آئیں" },
      { key: 'b', text: "zone میں rider coordinator یا hub office آ کے staff کو بتائیں" },
      { key: 'c', text: "dispatch اور ticket کے علاوہ کوئی راستہ نہیں ہے" },
    ],
  },
  {
    id: 'q33',
    stem: "customer سے ملنے والی cash collection کا کیا کریں؟",
    options: [
      { key: 'a', text: "cash collection کو قریبی JazzCash، Easy پیسہ یا hbl konnect کے retailer کے پاس جمع کرائیں" },
      { key: 'b', text: "cash کو shift ختم ہونے سے پہلے ہی جمع کرائیں تاکہ orders میں رکاوٹ نہ آئے" },
      { key: 'c', text: "دونوں options ٹھیک ہیں" },
    ],
  },
  {
    id: 'q34',
    stem: "foodpanda قانونی کارروائی کرنے کا اختیار رکھتا ہے اگر؟",
    options: [
      { key: 'a', text: "cash collection جمع نہ کرائی جائے" },
      { key: 'b', text: "strike، fraud یا کسی کو system میں ہراساں کیا جائے" },
      { key: 'c', text: "دونوں options ٹھیک ہیں" },
    ],
  },
  {
    id: 'q35',
    stem: "foodpanda میں salary یعنی earnings کب ملتی ہیں؟",
    options: [
      { key: 'a', text: "روزانہ" },
      { key: 'b', text: "ہفتہ وار" },
      { key: 'c', text: "ماہانہ" },
    ],
  },
  {
    id: 'q36',
    stem: "دورانِ shift کتنا cash ہو جانے پہ فوری collection جمع کریں ورنہ online orders لگیں گے؟",
    options: [
      { key: 'a', text: "تین ہزار روپے" },
      { key: 'b', text: "پانچ ہزار روپے" },
      { key: 'c', text: "سات ہزار روپے" },
    ],
  },
  {
    id: 'q37',
    stem: "orders accept نہ کرنے سے کیا ہوتا ہے؟",
    options: [
      { key: 'a', text: "batch اثر انداز ہوتا ہے جس سے آمدنی بھی کم ملتی ہے" },
      { key: 'b', text: "کچھ نہیں ہوتا ہے" },
      { key: 'c', text: "salary روک لی جاتی ہے" },
    ],
  },
  {
    id: 'q38',
    stem: "vendor سے order مل جانے کے بعد کیا کرنا بالکل صحیح نہیں ہے؟",
    options: [
      { key: 'a', text: "order کو pick up mark کر دینا" },
      { key: 'b', text: "vendor کی location پہ رہ کر مزید orders کا wait کرنا" },
      { key: 'c', text: "order لے کے customer کی location کی طرف جانا" },
    ],
  },
  {
    id: 'q39',
    stem: "اگر کسی وجہ سے order deliver کرنے کی حالت میں نہ ہوں تو کیا کریں؟",
    options: [
      { key: 'a', text: "order decline کر کے break لے لیں" },
      { key: 'b', text: "order accept کر کے ایسے ہی pick اور drop کر دیں" },
      { key: 'c', text: "order accept کر کے shift چھوڑ دیں" },
    ],
  },
  {
    id: 'q40',
    stem: "order deliver کرتے ہوئے online order ہو تو کیا کریں؟",
    options: [
      { key: 'a', text: "customer کا نام پوچھیں اور انہیں order دیں، تصدیق کے لیے rider customer chat پہ بھی لکھ لیں" },
      { key: 'b', text: "order ایسے ہی gate پہ رکھ کے چلے جائیں" },
      { key: 'c', text: "order دیے بغیر ہی drop off mark کر دیں" },
    ],
  },
  {
    id: 'q41',
    stem: "cash order میں کیا کریں؟",
    options: [
      { key: 'a', text: "customer سے cash لے کے اسے change واپس نہیں کریں اور drop off mark کر دیں" },
      { key: 'b', text: "customer سے cash لے کے اسے change واپس کریں اور drop off mark کریں" },
      { key: 'c', text: "customer سے cash لینے سے پہلے ہی order drop off mark کر دیں" },
    ],
  },
  {
    id: 'q42',
    stem: "اگر customer یا vendor تلخی یا غصے میں بات کرے تو کیا کریں؟",
    options: [
      { key: 'a', text: "ان سے اسی لہجے میں بات کریں" },
      { key: 'b', text: "shift ختم ہو جانے کے بعد ان سے رابطہ کریں" },
      { key: 'c', text: "ان سے کوئی بات نہیں کریں اور فوری dispatch chat پہ agent سے رابطہ کریں، ہمیں handle کرنے دیں" },
    ],
  },
  {
    id: 'q43',
    stem: "app میں موجود heat map کیا بتاتا ہے؟",
    options: [
      { key: 'a', text: "کون سے areas hot zones ہیں اور وہاں orders زیادہ ہیں" },
      { key: 'b', text: "کون سے areas میں traffic زیادہ ہے" },
      { key: 'c', text: "کون سے areas میں network خراب ہے" },
    ],
  },
  {
    id: 'q44',
    stem: "اگر آپ کی sim اور JazzCash یا hbl konnect آپ کے ID card پر registered نہیں ہے تو کیا ہو سکتا ہے؟",
    options: [
      { key: 'a', text: "کچھ نہیں ہوتا ہے" },
      { key: 'b', text: "میری ID block ہو جائے گی" },
      { key: 'c', text: "آپ کی ہفتہ وار earning fail ہو کے آپ کے foodpanda wallet میں آ جائے گی" },
    ],
  },
  {
    id: 'q45',
    stem: "دورانِ shift GPS بند رکھنے پہ کیا ہوتا ہے؟",
    options: [
      { key: 'a', text: "آپ پر ایک ہزار روپے تک کی penalty لگتی ہے" },
      { key: 'b', text: "آپ کو orders نہیں لگتے اور company کے لیے آپ inactive ہو جاتے ہیں" },
      { key: 'c', text: "دونوں options ٹھیک ہیں" },
    ],
  },
  {
    id: 'q46',
    stem: "company information سے باخبر رہنے کے لیے کیا کریں؟",
    options: [
      { key: 'a', text: "rider app میں inbox کو روزانہ دیکھیں تاکہ important messages miss نہ ہوں" },
      { key: 'b', text: "کچھ نہیں کریں" },
      { key: 'c', text: "دوسرے riders سے پوچھتے رہیں" },
    ],
  },
  {
    id: 'q47',
    stem: "foodpanda میں دوستوں کو refer کیسے کریں؟",
    options: [
      { key: 'a', text: "دوست کو اپنی ID دے دیں" },
      { key: 'b', text: "دوست کو اپنے referral link سے foodpanda registration hub پہ آ کے refer کریں" },
      { key: 'c', text: "دوست کو refer نہیں کیا جاتا" },
    ],
  },
]

/** What the bot says around the questions. Each has a recording. */
export const INTRO = "یہ video دیکھنے کے بعد میں آپ سے چند چھوٹے سوال پوچھنا چاہوں گی، صرف یہ دیکھنے کے لیے کہ سب کچھ clear ہے۔ اگر آپ ان کے جواب یہیں دے دیں تو branch پر آپ کا کام جلدی ہو جائے گا اور زیادہ انتظار نہیں کرنا پڑے گا۔ ورنہ یہ سوال وہاں پوچھے جائیں گے۔ دس سوال ہیں، ہر سوال کے تین جواب۔ بس صحیح جواب پر tap کرنا ہے۔"
export const CLOSING = "شکریہ! آپ نے سارے سوال مکمل کر لیے۔ اب branch پر تشریف لائیں، آپ کا کام جلدی ہو جائے گا۔"
export const DECLINED = "کوئی بات نہیں! یہ سوال branch پر پوچھ لیے جائیں گے۔"
export const UNCLEAR = "معذرت، سمجھ نہیں آیا۔ option a، option b، یا option c میں سے کون سا؟"

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
