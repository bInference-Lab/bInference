import { ok, type Result } from "@binference/core";
import {
  type OwnerAuthorize,
  type PlannedEdits,
  type PrivyApi,
  writePlannedEdits,
} from "@binference/custody-privy";

/**
 * Writes the edits planned for every ceiling of one change, one ceiling at a time, once all of
 * them were planned: a ceiling that cannot be built stops the change before any ceiling is
 * written, so an agent's wallets never end under different ceilings for that reason. A refusal
 * of Privy's while writing stops the rest.
 */
export async function writeEveryPlan(
  api: PrivyApi,
  planned: readonly PlannedEdits[],
  input: {
    readonly authorize: OwnerAuthorize;
    readonly expiresAtMs: number;
    readonly signal: AbortSignal;
  },
): Promise<Result<void, "not_found" | "refused">> {
  for (const plan of planned) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one ceiling at a time: a refusal stops the rest
    const written = await writePlannedEdits(api, plan, input);
    if (!written.ok) {
      return written;
    }
  }
  return ok(undefined);
}
