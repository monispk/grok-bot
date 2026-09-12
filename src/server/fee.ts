/**
 * The registration fee: what the rider is told, and what is actually charged.
 *
 * These are normally the same number and resolve from one place, so the text,
 * the voice note and the debit cannot drift apart. They are allowed to differ
 * only for testing, where charging Rs 2,500 to a real wallet on every run is
 * not reasonable.
 *
 * That gap is dangerous in exactly one direction: an override left in place
 * would tell a rider 2,500 and take something else. So it is never silent —
 * it is logged at boot, logged again on every charge, reported by /healthz and
 * shown in the debug panel. If it ships by accident, it announces itself.
 */
const paisa = (v: string | undefined, fallback: number) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback
}

/** What the rider is told, and what the recording says. Rs 2,500. */
export const FEE_PAISA = paisa(process.env.REGISTRATION_FEE_PAISA, 250_000)

/** What the rail is actually asked for. The same, unless testing. */
export const CHARGE_PAISA = paisa(process.env.FEE_CHARGE_OVERRIDE_PAISA, FEE_PAISA)

export const feeOverridden = CHARGE_PAISA !== FEE_PAISA

/** "Rs. 2,500" — the form the written and spoken lines both use. */
export const rupees = (p: number) =>
  `Rs. ${Math.round(p / 100).toLocaleString('en-US')}`

export function announceFee() {
  if (!feeOverridden) {
    console.log(`fee: ${rupees(FEE_PAISA)} (${FEE_PAISA} paisa)`)
    return
  }
  console.warn(
    `fee: TEST OVERRIDE — riders are told ${rupees(FEE_PAISA)} but ` +
      `${rupees(CHARGE_PAISA)} (${CHARGE_PAISA} paisa) will be charged. ` +
      `Unset FEE_CHARGE_OVERRIDE_PAISA before real riders use this.`,
  )
}
