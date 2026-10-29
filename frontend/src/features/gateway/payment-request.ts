import type { Info } from "@/lib/api";

export type PaymentKind = "mobile" | "card" | "payout";

export type PaymentValues = {
  kind: PaymentKind;
  amount: string;
  currency: string;
  reference: string;
  phone: string;
  callbackUrl: string;
  returnUrl: string;
}

export function paymentRequest(value: PaymentValues, info: Info) {
  return {
    merchant: info.merchant,
    type: value.kind === "card" ? "2" : "1",
    reference: value.reference,
    amount: value.amount,
    currency: value.currency,
    ...(value.kind === "payout"
      ? { callbackUrl: value.callbackUrl }
      : { callback_url: value.callbackUrl }),
    ...(value.kind === "card"
      ? {
          approve_url: value.returnUrl,
          cancel_url: value.returnUrl,
          decline_url: value.returnUrl,
        }
      : { phone: value.phone }),
  };
}
