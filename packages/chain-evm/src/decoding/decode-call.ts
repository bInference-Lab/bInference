import { err, ok, type Result } from "@binference/core";
import {
  type Abi,
  AbiFunctionSignatureNotFoundError,
  decodeFunctionData,
  type DecodeFunctionDataReturnType,
  type Hex,
  size,
} from "viem";

/** Why calldata could not be decoded against an ABI. */
export type CalldataProblem = "unknown_function" | "malformed_calldata";

/**
 * Decodes calldata against a venue's ABI into the function's name and typed arguments. A selector
 * the ABI does not hold, and data too short or ill-formed for its function, are expected failures:
 * a venue's transaction that does not decode is refused, never trusted.
 */
export function decodeCall<const TAbi extends Abi>(
  abi: TAbi,
  data: Hex,
): Result<DecodeFunctionDataReturnType<TAbi>, CalldataProblem> {
  if (size(data) < 4) {
    return err("malformed_calldata");
  }
  try {
    return ok(decodeFunctionData({ abi, data }));
  } catch (error) {
    return err(
      error instanceof AbiFunctionSignatureNotFoundError
        ? "unknown_function"
        : "malformed_calldata",
    );
  }
}
