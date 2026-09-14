/**
 * Pakistan's cities, spelled one way.
 *
 * A rider types where they live and no two type it alike: Rawalpindi arrives
 * as Rawalpindi, Pindi, rwp, پنڈی and راولپنڈی, sometimes with the sector or
 * the mohalla attached. A free-text city is useless to anyone downstream —
 * it cannot be counted, grouped, or matched against the offices — so every
 * answer resolves to one spelling from this list.
 *
 * The list is the canonical spelling first, then the ways it actually arrives:
 * the common short forms, the Urdu, and the misspellings that are one slip
 * away. It is not exhaustive and does not need to be — the model handles what
 * is not here, and this handles what the model should never be asked about.
 */
export type City = { name: string; also: string[] }

export const CITIES: City[] = [
  { name: 'Islamabad', also: ['isb', 'islambad', 'islamabaad', 'اسلام آباد', 'اسلام اباد', 'capital'] },
  { name: 'Rawalpindi', also: ['pindi', 'rwp', 'rawalpindi', 'rawlpindi', 'راولپنڈی', 'پنڈی'] },
  { name: 'Lahore', also: ['lhr', 'lahor', 'lahour', 'لاہور', 'لاهور'] },
  { name: 'Karachi', also: ['khi', 'karachi', 'karachee', 'کراچی'] },
  { name: 'Faisalabad', also: ['fsd', 'lyallpur', 'faislabad', 'فیصل آباد', 'فیصل اباد'] },
  { name: 'Multan', also: ['mux', 'multaan', 'ملتان'] },
  { name: 'Peshawar', also: ['pew', 'pishawar', 'peshwar', 'پشاور'] },
  { name: 'Quetta', also: ['uet', 'kwatta', 'کوئٹہ'] },
  { name: 'Gujranwala', also: ['gujranwala', 'gujranwalla', 'گوجرانوالہ'] },
  { name: 'Sialkot', also: ['skt', 'sialkoat', 'سیالکوٹ'] },
  { name: 'Hyderabad', also: ['hyd', 'haiderabad', 'حیدر آباد', 'حیدرآباد'] },
  { name: 'Bahawalpur', also: ['bwp', 'bahawalpoor', 'بہاولپور'] },
  { name: 'Sargodha', also: ['sgd', 'sargoda', 'سرگودھا'] },
  { name: 'Sukkur', also: ['sukhur', 'sakkar', 'سکھر'] },
  { name: 'Larkana', also: ['larkano', 'لاڑکانہ'] },
  { name: 'Sheikhupura', also: ['sheikhupura', 'shekhupura', 'شیخوپورہ'] },
  { name: 'Mardan', also: ['مردان'] },
  { name: 'Gujrat', also: ['gujraat', 'گجرات'] },
  { name: 'Jhelum', also: ['jehlum', 'جہلم'] },
  { name: 'Kasur', also: ['kasoor', 'قصور'] },
  { name: 'Sahiwal', also: ['montgomery', 'ساہیوال'] },
  { name: 'Okara', also: ['اوکاڑہ'] },
  { name: 'Rahim Yar Khan', also: ['ryk', 'rahimyarkhan', 'رحیم یار خان'] },
  { name: 'Dera Ghazi Khan', also: ['dgk', 'dgkhan', 'ڈیرہ غازی خان'] },
  { name: 'Dera Ismail Khan', also: ['dikhan', 'dik', 'ڈیرہ اسماعیل خان'] },
  { name: 'Abbottabad', also: ['abbotabad', 'ایبٹ آباد'] },
  { name: 'Mirpur', also: ['mirpur ajk', 'میرپور'] },
  { name: 'Muzaffarabad', also: ['مظفرآباد'] },
  { name: 'Gilgit', also: ['گلگت'] },
  { name: 'Skardu', also: ['سکردو'] },
  { name: 'Chakwal', also: ['چکوال'] },
  { name: 'Attock', also: ['campbellpur', 'اٹک'] },
  { name: 'Wah Cantt', also: ['wah', 'واہ'] },
  { name: 'Taxila', also: ['ٹیکسلا'] },
  { name: 'Murree', also: ['مری'] },
  { name: 'Kohat', also: ['کوہاٹ'] },
  { name: 'Bannu', also: ['بنوں'] },
  { name: 'Swat', also: ['mingora', 'saidu sharif', 'سوات', 'مینگورہ'] },
  { name: 'Nowshera', also: ['نوشہرہ'] },
  { name: 'Charsadda', also: ['چارسدہ'] },
  { name: 'Mansehra', also: ['مانسہرہ'] },
  { name: 'Haripur', also: ['ہری پور'] },
  { name: 'Jhang', also: ['جھنگ'] },
  { name: 'Toba Tek Singh', also: ['tts', 'ٹوبہ ٹیک سنگھ'] },
  { name: 'Khanewal', also: ['خانیوال'] },
  { name: 'Vehari', also: ['وہاڑی'] },
  { name: 'Muzaffargarh', also: ['مظفر گڑھ'] },
  { name: 'Layyah', also: ['leiah', 'لیہ'] },
  { name: 'Bhakkar', also: ['بھکر'] },
  { name: 'Mianwali', also: ['میانوالی'] },
  { name: 'Khushab', also: ['خوشاب'] },
  { name: 'Hafizabad', also: ['حافظ آباد'] },
  { name: 'Mandi Bahauddin', also: ['mbdin', 'منڈی بہاؤالدین'] },
  { name: 'Narowal', also: ['نارووال'] },
  { name: 'Chiniot', also: ['چنیوٹ'] },
  { name: 'Pakpattan', also: ['پاکپتن'] },
  { name: 'Lodhran', also: ['لودھراں'] },
  { name: 'Bahawalnagar', also: ['بہاولنگر'] },
  { name: 'Nankana Sahib', also: ['ننکانہ صاحب'] },
  { name: 'Jacobabad', also: ['جیکب آباد'] },
  { name: 'Shikarpur', also: ['شکارپور'] },
  { name: 'Nawabshah', also: ['shaheed benazirabad', 'نوابشاہ'] },
  { name: 'Mirpur Khas', also: ['mirpurkhas', 'میرپور خاص'] },
  { name: 'Tando Adam', also: ['ٹنڈو آدم'] },
  { name: 'Thatta', also: ['ٹھٹھہ'] },
  { name: 'Badin', also: ['بدین'] },
  { name: 'Dadu', also: ['دادو'] },
  { name: 'Khairpur', also: ['خیرپور'] },
  { name: 'Turbat', also: ['تربت'] },
  { name: 'Gwadar', also: ['گوادر'] },
  { name: 'Khuzdar', also: ['خضدار'] },
  { name: 'Chaman', also: ['چمن'] },
  { name: 'Zhob', also: ['ژوب'] },
  { name: 'Sibi', also: ['سبی'] },
  { name: 'Hub', also: ['hub chowki', 'حب'] },
  { name: 'Kotri', also: ['کوٹری'] },
  { name: 'Jamshoro', also: ['جامشورو'] },
  { name: 'Kamoke', also: ['کامونکی'] },
  { name: 'Daska', also: ['ڈسکہ'] },
  { name: 'Gojra', also: ['گوجرہ'] },
  { name: 'Burewala', also: ['بورے والا'] },
  { name: 'Kabirwala', also: ['کبیر والا'] },
  { name: 'Chishtian', also: ['چشتیاں'] },
  { name: 'Kamalia', also: ['کمالیہ'] },
  { name: 'Wazirabad', also: ['وزیر آباد'] },
  { name: 'Jaranwala', also: ['جڑانوالہ'] },
  { name: 'Arifwala', also: ['عارف والا'] },
  { name: 'Shahdadkot', also: ['شہداد کوٹ'] },
  { name: 'Tando Allahyar', also: ['ٹنڈو الہ یار'] },
  { name: 'Kot Addu', also: ['کوٹ ادو'] },
  { name: 'Dera Allah Yar', also: ['ڈیرہ اللہ یار'] },
  { name: 'Timergara', also: ['تیمرگرہ'] },
  { name: 'Batkhela', also: ['بٹ خیلہ'] },
  { name: 'Hangu', also: ['ہنگو'] },
  { name: 'Chitral', also: ['چترال'] },
  { name: 'Kohlu', also: ['کوہلو'] },
  { name: 'Loralai', also: ['لورالائی'] },
  { name: 'Rawalakot', also: ['راولاکوٹ'] },
  { name: 'Kotli', also: ['کوٹلی'] },
  { name: 'Bhimber', also: ['بھمبر'] },
]

export const CITY_NAMES = CITIES.map((c) => c.name)

const fold = (s: string) =>
  s
    .toLowerCase()
    .replace(/[ً-ْٰ]/g, '') // Urdu diacritics, which nobody types twice the same
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

const INDEX = new Map<string, string>()
for (const c of CITIES) {
  INDEX.set(fold(c.name), c.name)
  for (const a of c.also) INDEX.set(fold(a), c.name)
}

/**
 * The canonical name, from an answer we can resolve without asking anybody.
 *
 * Exact and contained matches only. "Rawalpindi" and "main rawalpindi se hoon"
 * both land; "Pindi ke qareeb" does too. Anything cleverer than this belongs
 * to the model, which sees the raw words and the list together.
 */
export function knownCity(text: string): string | null {
  const t = fold(text)
  if (!t) return null
  const exact = INDEX.get(t)
  if (exact) return exact

  // The longest alias contained in the answer wins, so "Dera Ghazi Khan" is
  // not read as "Dera Ismail Khan" because both begin the same way, and
  // "Rahim Yar Khan" is not read as the "Khan" inside it.
  let best: { name: string; len: number } | null = null
  for (const [alias, name] of INDEX) {
    if (alias.length < 3) continue
    if (!t.includes(alias)) continue
    if (!best || alias.length > best.len) best = { name, len: alias.length }
  }
  return best?.name ?? null
}

/** Whether a name is one we know, whoever produced it. */
export const isCity = (name: string): boolean => CITY_NAMES.includes(name)
