import {
  type ChainFamily,
  type DecodedEffect,
  decodedEffectSchema,
  type DraftCall,
  type TxDecoder,
  type TxDraft,
  txDraftSchema,
} from "@binference/chain";
import { err, ok, type Result } from "@binference/core";
import { z } from "zod";
import type { ApprovalStep, PlanStep } from "./build-checks.js";
import { ownCopy } from "./call-venue.js";

const draftsSchema = z.array(txDraftSchema).readonly();

/** Who reads a venue's drafts: the chain's family and the venue's own decoder. */
export interface StepReaders {
  readonly family: ChainFamily;
  readonly decoder: TxDecoder;
}

// Venue code may throw or answer outside its type; either way the step cannot be read.
function decodeSafely(decoder: TxDecoder, draft: TxDraft): DecodedEffect | undefined {
  try {
    const decoded = decoder.decode(draft);
    return decoded.ok ? ownCopy(decodedEffectSchema, decoded.value) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads one draft a venue built: what the chain family reads from it, a token approval as an
 * approval step, and any other call as `readCall` reads it. A draft the family cannot read, or a
 * call `readCall` cannot, is `undefined`.
 */
function readCallStep<S>(
  draft: TxDraft,
  family: ChainFamily,
  readCall: (draft: TxDraft, call: DraftCall) => S | undefined,
): ApprovalStep | S | undefined {
  const call = family.readDraft(draft);
  if (!call.ok) {
    return undefined;
  }
  const { approval } = call.value;
  return approval === undefined
    ? readCall(draft, call.value)
    : { kind: "approval", draft, call: call.value, approval };
}

/**
 * Reads every draft a venue built with `read`, each from the host's own copy of the draft. No
 * draft, or one draft `read` cannot read, refuses the whole plan.
 */
function readEachDraft<S>(
  drafts: readonly TxDraft[],
  read: (draft: TxDraft) => S | undefined,
): Result<readonly S[], "unreadable_step"> {
  const copies = ownCopy(draftsSchema, drafts) ?? [];
  const steps = copies.map(read);
  const found = steps.filter((step) => step !== undefined);
  return found.length === steps.length && found.length > 0 ? ok(found) : err("unreadable_step");
}

/**
 * Reads every draft a venue built into a step: the host's own copy of the draft, what the chain
 * family reads from it, and, for a call that is no token approval, what the venue's decoder
 * reads. No draft, or one draft that either reader cannot read, refuses the whole plan.
 */
export function readSteps(
  drafts: readonly TxDraft[],
  readers: StepReaders,
): Result<readonly PlanStep[], "unreadable_step"> {
  return readEachDraft(drafts, (draft) =>
    readCallStep(draft, readers.family, (read, call): PlanStep | undefined => {
      const effect = decodeSafely(readers.decoder, read);
      return effect === undefined ? undefined : { kind: "trade", draft: read, call, effect };
    }),
  );
}
