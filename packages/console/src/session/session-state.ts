import type { ProtocolClient } from "@binference/client";
import type { ReadyFrame } from "@binference/protocol";

/** Why the console shows the sign-in page instead of the console. */
export type SignedOutReason =
  | "no_device"
  | "used"
  | "expired"
  | "refused"
  | "revoked"
  | "no_crypto"
  | "mini_failed"
  | "unreachable";

/** Where the console's sign-in stands. */
export type SessionState =
  | { readonly kind: "starting" | "pairing" | "connecting" }
  | { readonly kind: "ready"; readonly client: ProtocolClient; readonly ready: ReadyFrame }
  | { readonly kind: "signed_out"; readonly reason: SignedOutReason };
