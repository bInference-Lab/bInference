import { lookup } from "node:dns";
import { resolvesToPublic } from "@binference/core";

// A name that takes longer to resolve counts as not public.
const endpointLookupMs = 5_000;

/**
 * Whether a browser push endpoint's host resolves to public internet addresses only, within 5
 * seconds; a host that does not resolve in time is not public. Rejects when `signal` aborts.
 */
export async function isPublicEndpoint(endpoint: string, signal: AbortSignal): Promise<boolean> {
  const late = AbortSignal.timeout(endpointLookupMs);
  try {
    return await resolvesToPublic(new URL(endpoint).hostname, {
      signal: AbortSignal.any([signal, late]),
      lookup,
    });
  } catch (error) {
    if (late.aborted && !signal.aborted) {
      return false;
    }
    throw error;
  }
}
