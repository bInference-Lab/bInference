import type { TableNotice } from "@binference/i18n/testing";

// The reasons only a signer service refuses with, in spec 5, section 8.3's order.
const serviceReasons = [
  "unknown_wallet",
  "intent_state",
  "no_authorization",
  "authorization_ended",
  "terms_changed",
  "nonce_held",
  "privy_refused",
] as const;

/**
 * The other forms of the signer refusal notice of spec 4, section 4, beside the one the notice
 * table sends: each reason a signer service refuses a step with that no hard rule of the signer
 * process names. Keyed by the notice's key and the reason.
 */
export const signerNoticeVariants: Readonly<Record<string, TableNotice>> = Object.fromEntries(
  serviceReasons.map((rule) => [
    `notice.signerRefused ${rule}`,
    { key: "notice.signerRefused", values: { rule } },
  ]),
);
