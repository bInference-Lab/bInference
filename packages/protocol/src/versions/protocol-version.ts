import { err, ok, type Result } from "@binference/core";

/**
 * The protocol version this package defines. Inside a version, changes are additive; a removal
 * or a change of meaning raises it by one.
 */
export const protocolVersion: number = 1;

// After a raise, the previous version stays here for one stable release.
const servedVersions: ReadonlySet<number> = new Set([protocolVersion]);

/**
 * Checks the version a client names in `open`. A version the engine does not serve, newer or
 * older, is refused with `protocol.version`.
 */
export function checkProtocolVersion(version: number): Result<number, "protocol.version"> {
  return servedVersions.has(version) ? ok(version) : err("protocol.version");
}
