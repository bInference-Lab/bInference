import { BinferenceError } from "@binference/core";

const partPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/**
 * Checks one part of an endpoint address, such as its name or the install id, and returns it.
 * Letters, digits, `_` and `-` only, so no part can leave its folder or change the pipe path.
 */
export function checkEndpointPart(value: string, label: string): string {
  if (!partPattern.test(value)) {
    throw new BinferenceError({
      code: "platform.ipc_bad_name",
      message: `The IPC ${label} ${value} may hold only letters, digits, _ and -, 64 at most.`,
      details: { label },
    });
  }
  return value;
}
