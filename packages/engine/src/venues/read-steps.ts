import {
  type ChainFamily,
  type DecodedEffect,
  decodedEffectSchema,
  type TxDecoder,
  type TxDraft,
  txDraftSchema,
} from "@binference/chain";
import { err, ok, type Result } from "@binference/core";
import { z } from "zod";
import type { PlanStep } from "./build-checks.js";
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

function readStep(draft: TxDraft, readers: StepReaders): PlanStep | undefined {
  const call = readers.family.readDraft(draft);
  if (!call.ok) {
    return undefined;
  }
  const { approval } = call.value;
  if (approval !== undefined) {
    return { kind: "approval", draft, call: call.value, approval };
  }
  const effect = decodeSafely(readers.decoder, draft);
  return effect === undefined ? undefined : { kind: "trade", draft, call: call.value, effect };
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
  const copies = ownCopy(draftsSchema, drafts) ?? [];
  const steps = copies.map((draft) => readStep(draft, readers));
  const read = steps.filter((step) => step !== undefined);
  return read.length === steps.length && read.length > 0 ? ok(read) : err("unreadable_step");
}
