import { err, ok } from "@binference/core";
import type { ChainFamily } from "../ports.js";

const addressPattern = /^0x[0-9a-fA-F]{8}$/;

/**
 * Creates a chain family for tests: namespace `fake`, addresses of 8 hex digits after `0x`,
 * canonical in lowercase.
 */
export function createFakeFamily(): ChainFamily {
  return {
    id: "fake",
    namespace: "fake",
    parseAddress: (text) =>
      addressPattern.test(text) ? ok(text.toLowerCase()) : err("malformed_address"),
  };
}
