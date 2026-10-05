export const TURNITIN_CREDIT_UNIT_PRICE_NGN = 2300;
export const TURNITIN_CREDIT_MAX_QUANTITY = 500;

export function turnitinCreditTotalNgn(quantity: number): number {
  return Math.trunc(quantity) * TURNITIN_CREDIT_UNIT_PRICE_NGN;
}
