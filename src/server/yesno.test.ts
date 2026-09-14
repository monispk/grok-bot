import assert from 'node:assert/strict'
import { test } from 'node:test'
import { asksSomething, readPhone, readRail, readYesNo, stripAskBack, stripReceipt } from '../shared/steps.ts'

test('reads yes', () => {
  for (const t of ['haan', 'Ji haan', 'jee', 'yes', 'G', 'bilkul', 'ji hai'])
    assert.equal(readYesNo(t), 'yes', t)
})

test('reads no', () => {
  for (const t of ['nahi', 'Nahin', 'no', 'nhi', 'ji nahi', 'nahi hai'])
    assert.equal(readYesNo(t), 'no', t)
})

test('a negative anywhere wins over a positive', () => {
  assert.equal(readYesNo('ji nahi'), 'no')
  assert.equal(readYesNo('haan nahi'), 'no')
})

test('anything unclear is not guessed', () => {
  for (const t of ['kitne paise milenge?', 'Monis Ur Rahmaan', ''])
    assert.equal(readYesNo(t), null, t)
})

test('reads a spoken answer in Urdu script', () => {
  for (const t of ['جی ہاں', 'ہاں', 'بالکل', 'جی'])
    assert.equal(readYesNo(t), 'yes', t)
  for (const t of ['نہیں', 'جی نہیں', 'نہیں ہے'])
    assert.equal(readYesNo(t), 'no', t)
})

test('an Urdu negative still wins over a positive', () => {
  assert.equal(readYesNo('جی نہیں'), 'no')
})

test('a question hidden inside an answer is noticed', () => {
  // Real transcript: the rider answered the smartphone question and asked about
  // pay in the same breath. The pay question was dropped.
  assert.equal(
    asksSomething('haan mere paas hai to sahih magar pehle bataein ke salary kitni mile gi?'),
    true,
  )
  assert.equal(asksSomething('ہاں میرے پاس ہے مگر بتائیں کہ سیلری کتنی ملے گی؟'), true)
  assert.equal(asksSomething('nahi, magar kya main purana phone use kar sakta hoon'), true)
})

test('a plain answer is not mistaken for a question', () => {
  assert.equal(asksSomething('haan'), false)
  assert.equal(asksSomething('ہاں جی میرے پاس ہے'), false)
  assert.equal(asksSomething('haan ji bilkul mere paas touch phone hai'), false)
  assert.equal(asksSomething('nahi mere paas nahi hai'), false)
  // A question mark alone, on a short answer, is not a question.
  assert.equal(asksSomething('haan hai na?'), false)
})

test('a mobile number survives however the rider writes it', () => {
  // Every one of these is the same number.
  for (const written of [
    '03001234567',
    '0300-1234567',
    '0300 123 4567',
    '+92 300 1234567',
    '923001234567',
    '00923001234567',
    '3001234567',
    'mera number 0300 1234567 hai',
  ])
    assert.equal(readPhone(written), '923001234567', `failed on "${written}"`)
})

test('something that is not a mobile number is refused', () => {
  assert.equal(readPhone('Monis Ur Rahmaan'), null)
  assert.equal(readPhone(''), null)
  assert.equal(readPhone('0421234567'), null)      // a landline, not 03xx
  assert.equal(readPhone('12345'), null)           // too short
  assert.equal(readPhone('61101-1234567-1'), null) // a CNIC, not a phone
})

test('the shortest answers a phone keyboard offers', () => {
  // Reported: "y" was not understood, so the model was asked to answer a
  // question nobody had asked, and it invented one.
  for (const yes of ['y', 'Y', 'yes', 'ok', 'theek hai', 'haan']) assert.equal(readYesNo(yes), 'yes', yes)
  for (const no of ['n', 'N', 'no', 'nahi']) assert.equal(readYesNo(no), 'no', no)
})

test('which wallet, however the rider says it', () => {
  for (const said of ['easypaisa', 'Easy Paisa', 'ep', 'easypaisa hai'])
    assert.equal(readRail(said), 'easypaisa', said)
  for (const said of ['jazzcash', 'jazz cash', 'JazzCash hai', 'jazz'])
    assert.equal(readRail(said), 'jazzcash', said)
  for (const said of ['koi nahi', 'nahi', 'dono nahi hain', 'neither', 'کوئی نہیں'])
    assert.equal(readRail(said), 'neither', said)
  // Written when any "nahi" counted as a denial, which is what turned a rider
  // saying they had not understood into a rider with no wallet.
  assert.equal(readRail('pata nahin kya'), null)
  assert.equal(readRail('hmm'), null)
})

test('a number with a digit too many is not a number', () => {
  // Reported: an extra digit was read as unanswerable rather than as mistyped.
  assert.equal(readPhone('033482343444'), null, 'twelve digits')
  assert.equal(readPhone('0334823444'), null, 'ten digits')
  assert.equal(readPhone('03998234444'), null, 'no operator uses 039')
  assert.equal(readPhone('0421234567'), null, 'a landline')
  // And the real ones still work, including SCO in the north.
  assert.equal(readPhone('03348234444'), '923348234444')
  assert.equal(readPhone('0355 1234567'), '923551234567')
})

test('"dono" is both, unless it is "dono nahi"', () => {
  // Reported: saying they had both recorded them as having neither.
  assert.equal(readRail('dono hain'), 'both')
  assert.equal(readRail('easypaisa aur jazzcash dono'), 'both')
  assert.equal(readRail('dono nahi'), 'neither')
  assert.equal(readRail('koi nahi'), 'neither')
  assert.equal(readRail('mere paas jazzcash nahi hai'), 'neither')
})

test('not understanding is not the same as having no wallet', () => {
  for (const said of ['kuch samajh nahi aaya', 'pata nahi', 'mujhe nahi pata', 'سمجھ نہیں آیا'])
    assert.equal(readRail(said), null, said)
  // While a real denial still reads as one.
  assert.equal(readRail('koi nahi'), 'neither')
})

test('a sentence that answers the question counts as an answer', () => {
  // Reported: a voice note transcribed as "آہ میرے پاس touch phone ہے" — plainly
  // yes — was thrown away because it did not begin with "haan".
  for (const said of [
    'آہ میرے پاس touch phone ہے',
    'mere paas touch phone hai',
    'ji haan mere paas bike hai',
    'میرے پاس بائیک ہے',
  ])
    assert.equal(readYesNo(said), 'yes', said)

  for (const said of ['mere paas nahi hai', 'میرے پاس نہیں ہے', 'bike nahi hai mere paas'])
    assert.equal(readYesNo(said), 'no', said)
})

test('being unsure is not the same as saying no', () => {
  // A "no" here records a rider as having no bike, which ends their eligibility
  // on a question they only failed to understand.
  for (const said of ['pata nahi', 'samajh nahi aaya', 'mujhe nahi pata', 'پتہ نہیں'])
    assert.equal(readYesNo(said), null, said)
})

test('a mangled transcript is read as the answer it is, not as a question', () => {
  // Verbatim from a live conversation. Whisper heard "mera koi Easypaisa ya
  // JazzCash account nahi hai" and wrote "JazzCash account" as جاس کیاش ایک انٹ.
  // کیاش contains کیا, and matching the question words as substrings made this
  // a question: the rider was lectured on opening an account, then asked for
  // their number again — and their answer was never recorded at all.
  const mangled = 'میرا کوئی ایزی پیسہ ہے جاس کیاش ایک انٹ نہیں ہے'
  assert.equal(asksSomething(mangled), false)
  assert.equal(readRail(mangled), 'neither')

  // Said again, clearly, two messages later. This one always worked.
  const plain = 'میرے پاس دونوں میں سے کوئی بھی نہیں ہے۔'
  assert.equal(asksSomething(plain), false)
  assert.equal(readRail(plain), 'neither')
})

test('a real Urdu question is still a question', () => {
  // The substring fix must not go the other way: these have to keep working.
  for (const asked of [
    'سیلری کتنی ملتی ہے؟',
    'یہ کیا ہے',
    'آفس کہاں ہے',
    'کب جانا ہوگا',
    'مجھے کیوں چاہیے',
  ])
    assert.equal(asksSomething(asked), true, asked)
})

test('"nahin" however the vowels fall out', () => {
  // Reported: "dono nhn hain" — I have neither — was recorded as having BOTH,
  // because nhn was in no list of spellings and "dono" won. At the end of the
  // flow that charges the fee through a wallet the rider does not have.
  assert.equal(readRail('dono nhn hain'), 'neither')
  assert.equal(readYesNo('dono nhn hain'), 'no')
  for (const said of ['nahi', 'nahin', 'nhi', 'nhn', 'nah', 'nahen', 'nahein'])
    assert.equal(readRail(`dono ${said} hain`), 'neither', said)

  // And the shape must not swallow agreement. "hai na" is a rider saying yes.
  assert.equal(readRail('easypaisa hai na'), 'easypaisa')
  assert.equal(readRail('dono hain'), 'both')
  assert.equal(readRail('in mein se easypaisa hai'), 'easypaisa')
})

test('a question the model asks back is not passed on', () => {
  // Reported: the rider asked "konsa account" and was asked it straight back,
  // then asked for their number by the flow — three questions, no answer.
  assert.equal(
    stripAskBack('Aap ke paas kaun sa account hai – Easypaisa ya JazzCash? (Sirf ek batayein).'),
    '',
  )
  // An actual answer survives, including the part before the question.
  assert.equal(
    stripAskBack('Security deposit Rs. 2,500 hai. Aap ke paas kaun sa account hai?'),
    'Security deposit Rs. 2,500 hai.',
  )
  assert.equal(
    stripAskBack('Rs. 2,500 security deposit hai. Ye poora wapas mil jata hai.'),
    'Rs. 2,500 security deposit hai. Ye poora wapas mil jata hai.',
  )
})

test('"I don\'t know" stays unanswerable however it is spelled', () => {
  // Found by running twenty conversations: "pata nhi" was not on the list of
  // exact phrases, so the nhi in it read as a denial and a rider who did not
  // know what a wallet was got recorded as having none.
  for (const unsure of [
    'pata nhi', 'pata nahi', 'pta nhi', 'mujhe nahi pata',
    'kuch samajh nahi aaya', 'smjh nhi aya', 'سمجھ نہیں آیا', 'پتہ نہیں',
  ]) {
    assert.equal(readRail(unsure), null, unsure)
    assert.equal(readYesNo(unsure), null, unsure)
  }
  // And a real denial is still a denial.
  assert.equal(readRail('koi nahi'), 'neither')
  assert.equal(readYesNo('nhi'), 'no')
})

test('the model may not claim to have received a document', () => {
  // Reported: at the licence step a rider typed "Sent". The model answered
  // "Aapka license front tasveer mil gaya" and moved on to the deposit.
  // Nothing had arrived. Only the server, which checks the file, may say so.
  assert.equal(
    stripReceipt(
      'Aapka license front tasveer mil gaya. Ab aap Rs. 2,500 security deposit easypaisa ya JazzCash se jama kar sakte hain.',
    ),
    'Ab aap Rs. 2,500 security deposit easypaisa ya JazzCash se jama kar sakte hain.',
  )
  assert.equal(stripReceipt('Aap ki CNIC ki tasveer mil gayi hai, shukriya.'), '')
  assert.equal(stripReceipt('آپ کا لائسنس مل گیا۔'), '')
  // Receiving something that is not a document is a different sentence.
  assert.equal(stripReceipt('Paise har hafte mil jate hain.'), 'Paise har hafte mil jate hain.')
  assert.equal(stripReceipt('Bag aur shirt branch par mil jati hai.'), 'Bag aur shirt branch par mil jati hai.')
})

test('a question is not a yes just because it ends in "hai"', () => {
  // Found by tracing: "salary kitni milti hai" answered the smartphone gate
  // with a yes, because "hai" was in the list of yes-words.
  assert.equal(readYesNo('salary kitni milti hai'), null)
  assert.equal(readYesNo('kya bike zaroori hai?'), null)
  assert.equal(readYesNo('office kahan hai'), null)
  // A plain "hai" is still a yes, and a real answer with a question in it keeps its answer.
  assert.equal(readYesNo('hai'), 'yes')
  assert.equal(readYesNo('mere paas hai'), 'yes')
  assert.equal(readYesNo('haan hai, magar salary kitni hai?'), 'yes')
  assert.equal(readYesNo('nahi hai, kya zaroori hai?'), 'no')
})

/**
 * Reported with a screenshot: a rider said JazzCash twice by voice and was
 * asked the same question both times, in the same words.
 *
 * Whisper writes it in Urdu and never the same way twice — جیز کیش, جیس کیش,
 * جاز کیش — and the reader matched the first half against a single spelling.
 * The second half does not vary, and کیش belongs to nothing else said here.
 */
test('JazzCash is heard however Whisper spells it', () => {
  for (const said of [
    'میرے پاس جیس کیش ہے',
    'جیز کیش',
    'جاز کیش',
    'میرے پاس جیزکیش اکاؤنٹ ہے',
    'jazzcash',
    'Jazz Cash',
    'jaz kash hai',
    'JC',
  ])
    assert.equal(readRail(said), 'jazzcash', said)
})

test('Easypaisa is heard however Whisper spells it', () => {
  for (const said of [
    'ایزی پیسہ',
    'میرے پاس ایزی پیسا ہے',
    'easypaisa',
    'easy paisa',
    'EP',
  ])
    assert.equal(readRail(said), 'easypaisa', said)
})

test('both, and neither, still win over either', () => {
  assert.equal(readRail('دونوں'), 'both')
  assert.equal(readRail('جیس کیش اور ایزی پیسہ dono hain'), 'both')
  // A denial beats a wallet named inside it.
  assert.equal(readRail('میرے پاس جیس کیش نہیں ہے'), 'neither')
  assert.equal(readRail('koi nahi'), 'neither')
  // Not understanding is not an answer.
  assert.equal(readRail('samajh nahi aaya'), null)
})
