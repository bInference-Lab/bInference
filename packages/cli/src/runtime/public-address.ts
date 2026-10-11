import { lookup as systemLookup, type LookupAddress, type LookupOptions } from "node:dns";
import { BlockList, isIP } from "node:net";
import { BinferenceError } from "@binference/core";

// The ranges no public service lives in: this network, private, carrier-grade NAT, loopback,
// link-local, the IETF and documentation blocks, benchmarking, multicast and reserved, and their
// IPv6 counterparts, NAT64 and 6to4 included (RFC 6890 and the IANA special-purpose registries).
// An IPv4-mapped IPv6 address matches the IPv4 rules.
const nonPublicRanges: readonly (readonly [string, number, "ipv4" | "ipv6"])[] = [
  ["0.0.0.0", 8, "ipv4"],
  ["10.0.0.0", 8, "ipv4"],
  ["100.64.0.0", 10, "ipv4"],
  ["127.0.0.0", 8, "ipv4"],
  ["169.254.0.0", 16, "ipv4"],
  ["172.16.0.0", 12, "ipv4"],
  ["192.0.0.0", 24, "ipv4"],
  ["192.0.2.0", 24, "ipv4"],
  ["192.88.99.0", 24, "ipv4"],
  ["192.168.0.0", 16, "ipv4"],
  ["198.18.0.0", 15, "ipv4"],
  ["198.51.100.0", 24, "ipv4"],
  ["203.0.113.0", 24, "ipv4"],
  ["224.0.0.0", 4, "ipv4"],
  ["240.0.0.0", 4, "ipv4"],
  ["::", 128, "ipv6"],
  ["::1", 128, "ipv6"],
  ["64:ff9b::", 96, "ipv6"],
  ["64:ff9b:1::", 48, "ipv6"],
  ["100::", 64, "ipv6"],
  ["2001::", 23, "ipv6"],
  ["2001:db8::", 32, "ipv6"],
  ["2002::", 16, "ipv6"],
  ["fc00::", 7, "ipv6"],
  ["fe80::", 10, "ipv6"],
  ["ff00::", 8, "ipv6"],
];

const nonPublic = new BlockList();
for (const [network, prefix, family] of nonPublicRanges) {
  nonPublic.addSubnet(network, prefix, family);
}

/**
 * Whether an IP address may belong to a service on the internet: not private, loopback,
 * link-local, multicast, unspecified or reserved. Text that is no IP address is not public.
 */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) {
    return false;
  }
  return !nonPublic.check(address, family === 4 ? "ipv4" : "ipv6");
}

/** A name lookup as `node:dns` and `net.connect` call it. */
export type HostLookup = (
  hostname: string,
  options: LookupOptions & { readonly all: true },
  callback: (error: Error | null, addresses: readonly LookupAddress[]) => void,
) => void;

function privateAddress(hostname: string): BinferenceError {
  return new BinferenceError({
    code: "http.private_address",
    message: "The host resolves to an address that is not on the internet.",
    details: { host: hostname },
  });
}

/** What a socket's `lookup` option is called with. */
type SocketLookup = (
  hostname: string,
  options: LookupOptions,
  callback: (error: Error | null, address: string | LookupAddress[], family?: number) => void,
) => void;

/**
 * A `lookup` for sockets that may reach public addresses only: it resolves every address of the
 * name and fails with `http.private_address` when any of them is not public, so a name that
 * resolves to a private address, or rebinds to one, is never connected to. The socket connects to
 * the addresses this lookup checked.
 */
export function publicOnlyLookup(base: HostLookup = systemLookup): SocketLookup {
  return (hostname, options, callback) => {
    base(hostname, { ...options, all: true }, (error, addresses) => {
      if (error !== null) {
        callback(error, []);
        return;
      }
      if (addresses.length === 0 || !addresses.every(({ address }) => isPublicAddress(address))) {
        callback(privateAddress(hostname), []);
        return;
      }
      const [first] = addresses;
      if (options.all === true || first === undefined) {
        callback(null, [...addresses]);
        return;
      }
      callback(null, first.address, first.family);
    });
  };
}

/**
 * Whether every address a host name resolves to is public, within the signal; an IP literal is
 * checked as it is. A name that does not resolve is not public.
 */
export async function resolvesToPublic(
  hostname: string,
  context: { readonly signal: AbortSignal; readonly lookup?: HostLookup },
): Promise<boolean> {
  context.signal.throwIfAborted();
  const bare = hostname.replace(/^\[(.*)\]$/, "$1");
  if (isIP(bare) !== 0) {
    return isPublicAddress(bare);
  }
  const lookup = context.lookup ?? systemLookup;
  const resolved = new Promise<boolean>((resolve) => {
    lookup(bare, { all: true }, (error, addresses) => {
      resolve(
        error === null &&
          addresses.length > 0 &&
          addresses.every(({ address }) => isPublicAddress(address)),
      );
    });
  });
  const aborted = new Promise<never>((_resolve, reject) => {
    context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true });
  });
  return Promise.race([resolved, aborted]);
}

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
    });
  } catch (error) {
    if (late.aborted && !signal.aborted) {
      return false;
    }
    throw error;
  }
}
