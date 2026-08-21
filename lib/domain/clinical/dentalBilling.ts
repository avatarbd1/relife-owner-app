export interface DentalBillingState {
  totalBill: number;
  due: number;
  advanceBalance: number;
}

export interface DentalBillingResult {
  newTotalBill: number;
  newDue: number;
  newAdvanceBalance: number;
  advanceApplied: number;
  paymentStatus: "Paid" | "Due";
}

function nonNegativeMoney(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export function applyDentalTreatmentCharge(
  state: DentalBillingState,
  chargeInput: number
): DentalBillingResult {
  const charge = Number(chargeInput);
  if (!Number.isFinite(charge) || !Number.isInteger(charge) || charge < 0) {
    throw new Error("DENTAL_CHARGE_INVALID");
  }

  const currentTotalBill = nonNegativeMoney(state.totalBill);
  const currentDue = nonNegativeMoney(state.due);
  const currentAdvance = nonNegativeMoney(state.advanceBalance);
  const advanceApplied = Math.min(currentAdvance, charge);
  const newAdvanceBalance = Math.max(0, currentAdvance - advanceApplied);
  const newTotalBill = currentTotalBill + charge;
  const newDue = Math.max(0, currentDue + charge - advanceApplied);

  return {
    newTotalBill,
    newDue,
    newAdvanceBalance,
    advanceApplied,
    paymentStatus: newDue > 0 ? "Due" : "Paid",
  };
}
