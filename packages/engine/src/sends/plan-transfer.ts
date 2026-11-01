import {
  type AccountRef,
  accountRefSchema,
  type AssetRef,
  assetRefParts,
  type ChainRegistry,
  isSameAccount,
  type RegisteredChain,
  type SimulatedStep,
  type TxDraft,
  type TxSimulator,
} from "@binference/chain";
import { err, type JsonValue, ok, type Result } from "@binference/core";
import type { SimulationView } from "@binference/protocol";
import type { WalletRecord } from "../install/install-record.js";
import type { QuoteFailure, SimulationFailure } from "../intents/intent-reason.js";
import { revokeQuoteDocument } from "../intents/revoke-quote.js";
import { type SentName, type SentPayee, sendQuoteDocument } from "../intents/send-quote.js";
import { isNamedInCeiling } from "../limits/limit-ceiling.js";
import { registryContractOf } from "../operations/is-registry-contract.js";
import { checkTransfer, type PlannedTransfer } from "../simulation/check-transfer.js";

/** A send or a revoke with its target known: what its one step does. */
export type TransferMove =
  | {
      readonly kind: "send";
      readonly transfer: PlannedTransfer;
      readonly name?: SentName;
      readonly payee: SentPayee;
    }
  | {
      readonly kind: "revokeApproval";
      readonly owner: AccountRef;
      readonly token: AssetRef;
      readonly spender: AccountRef;
      /** The wallet as the install holds it, whose ceiling must name the spender. */
      readonly wallet?: WalletRecord;
    };

/** A send's or a revoke's quote document and the one draft its plan holds. */
export interface TransferPlan {
  readonly quote: JsonValue;
  readonly draft: TxDraft;
}

// The account of a token's contract on its chain, as a family's approval draft names it.
function tokenAccount(token: AssetRef): AccountRef {
  const { chain, assetReference } = assetRefParts(token);
  return accountRefSchema.parse(`${chain}:${assetReference}`);
}

/**
 * The quote and build step of a send or an approval revoke (spec 6, section 3): a send drafts its
 * asset, as it is, to its target, with who that is; a revoke drafts the token's approval of its
 * spender back to 0, only for a spender the chain registry lists and the wallet's ceiling names
 * (decision 0309), else `spender_unlisted`, and names it as the registry does. An
 * asset its family cannot draft is `no_route`. The quote binds the target and, for a send by name,
 * the name the card shows (decision 0308).
 */
export function planTransfer(
  chain: RegisteredChain,
  move: TransferMove,
  context: { readonly chains: ChainRegistry; readonly nowMs: number },
): Result<TransferPlan, QuoteFailure> {
  const quotedAtMs = context.nowMs;
  if (move.kind === "send") {
    const { transfer, name, payee } = move;
    const draft = chain.family.transferDraft(transfer);
    const quote = { amount: transfer.amount, recipient: transfer.to, ...payee, quotedAtMs };
    return draft.ok
      ? ok({
          quote: sendQuoteDocument.encode(name === undefined ? quote : { ...quote, name }),
          draft: draft.value,
        })
      : err("no_route");
  }
  const { owner, token, spender, wallet } = move;
  const contract = registryContractOf(spender, context.chains);
  if (
    contract === undefined ||
    wallet === undefined ||
    !isNamedInCeiling(wallet, contract.address)
  ) {
    return err("spender_unlisted");
  }
  const reset = { from: owner, token: tokenAccount(token), spender, amountBase: 0n };
  const draft = chain.family.approvalDraft(reset);
  const spenderName = `${contract.venue} ${contract.name}`;
  return draft.ok
    ? ok({
        quote: revokeQuoteDocument.encode({ token, spender, spenderName, quotedAtMs }),
        draft: draft.value,
      })
    : err("no_route");
}

// A revoke's step moves nothing out of the wallet, and sets no allowance but its own, at zero.
function revokeRan(
  step: SimulatedStep | undefined,
  move: Extract<TransferMove, { kind: "revokeApproval" }>,
  chain: RegisteredChain,
): boolean {
  const { family } = chain;
  return (
    step?.status === "success" &&
    step.transfers.every(({ from }) => !isSameAccount(from, move.owner, family)) &&
    step.approvals.every(
      (approval) =>
        isSameAccount(approval.owner, move.owner, family) &&
        isSameAccount(approval.spender, move.spender, family) &&
        approval.amount.asset === move.token &&
        approval.amount.base === 0n,
    )
  );
}

/**
 * The simulate step of a send or a revoke (spec 6, section 3): its one draft runs unsent on the
 * chain's latest state. A send passes when it moves exactly its amount of its asset out of the
 * wallet and lands some of it at its target; a revoke when it moves nothing out and sets its
 * allowance to zero (decision 0309). A step that reverts is `simulation_reverted`, any other
 * difference `effects_differ`. The view sums what left the wallet and what reached the target.
 */
export async function simulateTransfer(
  parts: {
    readonly simulator: TxSimulator;
    readonly chain: RegisteredChain;
    readonly nowMs: () => number;
  },
  planned: { readonly move: TransferMove; readonly draft: TxDraft },
  signal: AbortSignal,
): Promise<Result<SimulationView, SimulationFailure>> {
  const { move, draft } = planned;
  const [step] = await parts.simulator.simulate([draft], { signal });
  if (step?.status !== "success") {
    return err("simulation_reverted");
  }
  const simulatedAt = parts.nowMs();
  if (move.kind === "revokeApproval") {
    return revokeRan(step, move, parts.chain)
      ? ok({ spent: [], received: [], simulatedAt })
      : err("effects_differ");
  }
  const received = checkTransfer(step, move.transfer, parts.chain.family);
  return received === undefined
    ? err("effects_differ")
    : ok({ spent: [move.transfer.amount], received: [received], simulatedAt });
}
