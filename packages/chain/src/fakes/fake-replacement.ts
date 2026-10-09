import { err, ok, type Result } from "@binference/core";
import { accountRefParts, accountRefSchema } from "../caip/account-ref.js";
import type { ChainRef } from "../caip/chain-ref.js";
import { leastReplacementFee } from "../sending/least-replacement-fee.js";
import type { PreparedReplacement, ReplaceRequest } from "../sending/prepared-tx.js";
import type { OriginalCall, StepReplacement } from "../signing/sign-step.js";
import { readFakeSent } from "./fake-ledger.js";

/** What the fake network prepares a replacement with. */
export interface FakeReplacing {
  readonly chain: ChainRef;
  /** The fee per gas the chain asks now. */
  readonly feePerGasBase: bigint;
  /** The fee per gas above which a prepared transaction is marked. */
  readonly feeCapBase: bigint;
  /** Draft payloads whose calls fail now. */
  readonly failing: ReadonlySet<string>;
}

function hexOf(text: string): string {
  const bytes = [...new TextEncoder().encode(text)];
  return `0x${bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The call of a fake draft's payload as the signer's rule 6 compares it: the address called, the
 * native coin sent, and the data's text as hex bytes.
 */
export function fakeOriginalCall(chain: ChainRef, draftPayload: string): OriginalCall {
  const [to = "", value = "0", data = ""] = draftPayload.split("|");
  return { to: accountRefSchema.parse(`${chain}:${to}`), value: BigInt(value), data: hexOf(data) };
}

/**
 * Prepares a replacement the fake way: the signed call again, or a 0-value transfer to the sender
 * with no data, at the signed nonce and at least `leastReplacementFee` of the signed fee.
 */
export function prepareFakeReplacement(
  replacing: FakeReplacing,
  request: ReplaceRequest,
): Result<PreparedReplacement, "would_fail"> {
  const sent = readFakeSent(replacing.chain, request.replaced.raw);
  const { address } = accountRefParts(request.from);
  const call = request.kind === "cancel" ? [address, "0", ""].join("|") : sent.draftPayload;
  if (replacing.failing.has(call)) {
    return err("would_fail");
  }
  const least = leastReplacementFee(sent.feePerGasBase);
  const feePerGasBase = replacing.feePerGasBase > least ? replacing.feePerGasBase : least;
  const payload = [call, String(sent.nonce), feePerGasBase.toString()].join("|");
  const { nonce } = sent;
  const replaces: StepReplacement =
    request.kind === "cancel"
      ? { kind: "cancel", nonce }
      : { kind: "speedUp", nonce, original: fakeOriginalCall(replacing.chain, call) };
  return ok({
    unsigned: { chain: replacing.chain, from: request.from, payload },
    feePerGasBase,
    isAboveFeeCap: feePerGasBase > replacing.feeCapBase,
    replaces,
  });
}
