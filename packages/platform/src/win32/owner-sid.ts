import { BinferenceError } from "@binference/core";

/** The arguments that make `whoami` print the current account and its security id as CSV. */
export const whoamiUserArgs: readonly string[] = ["/user", "/fo", "csv", "/nh"];

// The last field of `whoami /user /fo csv /nh` is the account's security id.
const sidPattern = /"(S-1-\d+(?:-\d+)+)"\s*$/;

/**
 * Reads the account's security id from what `whoami /user /fo csv /nh` printed. Throws
 * `platform.owner_unknown` when it names no account, rather than guess an owner.
 */
export function ownerSidOf(whoamiOutput: string): string {
  const sid = sidPattern.exec(whoamiOutput)?.[1];
  if (sid === undefined) {
    throw new BinferenceError({
      code: "platform.owner_unknown",
      message: "whoami named no account, so no owner-only access list can be set.",
    });
  }
  return sid;
}
