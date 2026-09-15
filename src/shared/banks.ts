/**
 * The banks a rider can be paid into, as the title-fetch service knows them.
 *
 * `id` is Rizq's own bank id — a small integer, and the only thing their
 * titleFetch accepts. It is not the 1Link IMD and not the SWIFT code: an
 * account that resolves under id 33 does not resolve under JazzCash's IMD
 * 585953, which is how the two were told apart.
 *
 * `lengths` is what the bank's own IBFT hint says an account number looks
 * like, longest first. It is used to decide whether a number the rider typed
 * is short by a few zeros — the commonest way an account number arrives wrong,
 * because a branch code that starts 00 loses them to every spreadsheet and
 * contact card it has ever passed through.
 */
export type Bank = {
  /** Rizq's bank id, for `titleFetch`. */
  id: string
  /** SWIFT, for the record and for reading an IBAN. */
  code: string
  name: string
  /** What a rider is likely to call it, lower case. */
  aliases: string[]
  /** Account-number lengths the bank accepts. */
  lengths: number[]
  /** Whether the bank's own hint offers the 24-character IBAN. */
  iban: boolean
  /** A wallet or EMI, where the account number is a mobile number. */
  wallet: boolean
}

export const BANKS: Bank[] = [
  { id: '3', code: 'AIIN', name: 'Al Baraka Bank Limited', aliases: ['al baraka', 'albaraka', 'baraka'], lengths: [13], iban: true, wallet: false },
  { id: '5', code: 'ABPA', name: 'Allied Bank Limited', aliases: ['abl', 'allied', 'myabl'], lengths: [20, 16, 14, 13, 11], iban: false, wallet: false },
  { id: '7', code: 'APNA', name: 'Apna Microfinance Bank', aliases: ['apna', 'apna bank'], lengths: [16], iban: true, wallet: false },
  { id: '55', code: 'ASCM', name: 'Askari Commercial Bank Limited', aliases: ['akbl', 'askari'], lengths: [14, 13], iban: false, wallet: false },
  { id: '11', code: 'BAHL', name: 'Bank AL Habib Limited', aliases: ['al habib', 'alhabib', 'bahl', 'bank al habib'], lengths: [17], iban: true, wallet: false },
  { id: '9', code: 'ALFH', name: 'Bank Alfalah Limited', aliases: ['alfalah', 'falah'], lengths: [18, 14, 12, 11], iban: true, wallet: false },
  { id: '13', code: 'BPUN', name: 'Bank of Punjab', aliases: ['bank of punjab', 'bop', 'punjab bank', 'taqwa'], lengths: [17, 16], iban: true, wallet: false },
  { id: '15', code: 'BKIP', name: 'BankIslami Pakistan Limited', aliases: ['bank islami', 'bankislami', 'islami'], lengths: [15, 13], iban: true, wallet: false },
  { id: '19', code: 'DUIB', name: 'Dubai Islamic Bank Pakistan Limited', aliases: ['dib', 'dubai islamic'], lengths: [10], iban: true, wallet: false },
  { id: '51', code: 'TMFB', name: 'Easypaisa-Telenor Bank', aliases: ['easy paisa', 'easypaisa', 'telenor'], lengths: [16, 15, 11], iban: false, wallet: true },
  { id: '63', code: 'ABHI', name: 'FINCA Microfinance Bank', aliases: ['abhi', 'finca'], lengths: [20, 16, 11], iban: false, wallet: false },
  { id: '21', code: 'FAYS', name: 'Faysal Bank Limited', aliases: ['faysal', 'faysal islami'], lengths: [16, 14], iban: true, wallet: false },
  { id: '61', code: 'FWOM', name: 'First Women Bank Limited', aliases: ['first women', 'fwbl'], lengths: [16], iban: false, wallet: false },
  { id: '23', code: 'HABB', name: 'Habib Bank Limited', aliases: ['habib bank', 'hbl', 'hbl konnect', 'konnect'], lengths: [14, 11], iban: true, wallet: false },
  { id: '25', code: 'MPBL', name: 'Habib Metropolitan Bank Limited', aliases: ['habib metro', 'habibmetro', 'hmb', 'metropolitan'], lengths: [19], iban: true, wallet: false },
  { id: '27', code: 'ICBK', name: 'ICBC', aliases: ['icbc'], lengths: [16], iban: true, wallet: false },
  { id: '29', code: 'JSBL', name: 'JS Bank', aliases: ['js bank', 'jsbl', 'zindigi'], lengths: [16, 11, 6], iban: true, wallet: false },
  { id: '31', code: 'MUCB', name: 'MCB Bank', aliases: ['mcb', 'mcb lite', 'muslim commercial'], lengths: [16, 15, 11], iban: true, wallet: false },
  { id: '57', code: 'MCIB', name: 'MCB Islamic Bank', aliases: ['mcb islamic'], lengths: [16], iban: false, wallet: false },
  { id: '59', code: 'MEZN', name: 'Meezan Bank Limited', aliases: ['mbl', 'meezan'], lengths: [14], iban: false, wallet: false },
  { id: '33', code: 'JCMA', name: 'Mobilink Bank/JazzCash', aliases: ['jazz', 'jazz cash', 'jazzcash', 'mobicash', 'mobilink'], lengths: [11, 9], iban: true, wallet: true },
  { id: '53', code: 'NRSP', name: 'NRSP Microfinance Bank Ltd.', aliases: ['nrsp'], lengths: [13], iban: false, wallet: false },
  { id: '47', code: 'NBPA', name: 'National Bank of Pakistan', aliases: ['aitemaad', 'national bank', 'nbp'], lengths: [16, 14, 10], iban: false, wallet: false },
  { id: '75', code: 'NAYA', name: 'NayaPay', aliases: ['naya pay', 'nayapay'], lengths: [11], iban: false, wallet: true },
  { id: '65', code: 'SADA', name: 'SadaPay', aliases: ['sada pay', 'sadapay'], lengths: [11], iban: true, wallet: true },
  { id: '35', code: 'SAMB', name: 'Samba Bank', aliases: ['samba'], lengths: [10], iban: true, wallet: false },
  { id: '37', code: 'SAUD', name: 'Silk Bank', aliases: ['silk bank', 'silkbank'], lengths: [14], iban: true, wallet: false },
  { id: '39', code: 'SIND', name: 'Sindh Bank', aliases: ['sindh bank'], lengths: [14], iban: true, wallet: false },
  { id: '41', code: 'SONE', name: 'Soneri Bank', aliases: ['soneri'], lengths: [15, 11], iban: true, wallet: false },
  { id: '49', code: 'SCBL', name: 'Standard Chartered Bank', aliases: ['chartered', 'scb', 'standard chartered'], lengths: [16, 11], iban: false, wallet: false },
  { id: '43', code: 'SUMB', name: 'Summit Bank', aliases: ['bank makramah', 'makramah', 'summit'], lengths: [20], iban: true, wallet: false },
  { id: '45', code: 'UMBL', name: 'Ubank', aliases: ['u bank', 'u microfinance', 'ubank', 'upaisa'], lengths: [15, 11], iban: true, wallet: false },
  { id: '2', code: 'UNIL', name: 'United Bank Limited', aliases: ['omni', 'ubl', 'ubl omni', 'united bank'], lengths: [16, 13, 12, 11, 9], iban: true, wallet: false },
]

export const BANK_NAMES = BANKS.map((b) => b.name)

export const bankById = (id: string): Bank | undefined => BANKS.find((b) => b.id === id)

const fold = (s: string) =>
  ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `

/**
 * The bank a rider means, where it can be settled without asking anybody.
 *
 * Matched on whole phrases, longest first, so "mera account UBL mein hai"
 * finds UBL and "habib bank" finds HBL rather than Bank AL Habib.
 *
 * "Habib" on its own finds nothing, and that is the point: it belongs to HBL,
 * Bank AL Habib and Habib Metropolitan — three banks with three different
 * account formats — so a bare "Habib" is a question, not an answer. Guessing
 * there costs the rider a failed lookup and a second round of typing.
 */
export function matchBanks(text: string): Bank[] {
  const said = fold(text)
  if (said.trim().length < 2) return []

  const phrases = (b: Bank) => [b.name, ...b.aliases].map(fold).filter((p) => p.trim().length >= 2)

  // A bank's own name or nickname, said inside whatever else the rider wrote.
  let best: { bank: Bank; len: number }[] = []
  for (const b of BANKS) {
    for (const p of phrases(b)) {
      if (!said.includes(p)) continue
      const len = p.trim().length
      if (!best.length || len > best[0]!.len) best = [{ bank: b, len }]
      else if (len === best[0]!.len && !best.some((x) => x.bank === b)) best.push({ bank: b, len })
    }
  }
  if (best.length) return best.map((x) => x.bank)

  // Nothing contained the answer. Try it as the start of a name — "meezan" for
  // "Meezan Bank Limited", "habib" for all three of them.
  return BANKS.filter((b) => phrases(b).some((p) => p.includes(said.trim())))
}

export function knownBank(text: string): Bank | null {
  const hit = matchBanks(text)
  return hit.length === 1 ? hit[0]! : null
}

/**
 * The answer names a bank, but more than one. "Habib" is Habib Bank, Bank AL
 * Habib and Habib Metropolitan — three banks with three account formats — and
 * the list knows that without having to ask a model.
 */
export const ambiguousBank = (text: string): boolean => matchBanks(text).length > 1
