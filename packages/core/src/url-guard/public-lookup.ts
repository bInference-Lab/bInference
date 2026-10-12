import { BinferenceError } from "../errors/binference-error.js";
import { isPublicAddress } from "./public-address.js";

/** One address a name resolves to, as `node:dns` answers it. */
export interface ResolvedAddress {
  readonly address: string;
  readonly family: number;
}

/** A name lookup that answers every address of a name, as `dns.lookup` with `all: true` does. */
export type HostLookup = (
  hostname: string,
  options: { readonly all: true },
  callback: (error: Readonly<Error> | null, addresses: readonly ResolvedAddress[]) => void,
) => void;

/** What a socket's `lookup` option is called with, for one address or all. */
export type SocketLookup = (
  hostname: string,
  options: { readonly all?: boolean | undefined },
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a socket's lookup callback takes an Error and a mutable list, as node:net declares it
  callback: (error: Error | null, address: string | ResolvedAddress[], family?: number) => void,
) => void;

function privateAddress(hostname: string): BinferenceError {
  return new BinferenceError({
    code: "http.private_address",
    message: "The host resolves to an address that is not on the internet.",
    details: { host: hostname },
  });
}

/**
 * A socket `lookup` that reaches public addresses only, over `base`: it resolves every address of
 * the name and fails with `http.private_address` when any of them is not public, so a name that
 * resolves to a private address, or rebinds to one after an earlier check, is never connected to.
 * The socket connects to the addresses this lookup checked.
 */
export function publicOnlyLookup(base: HostLookup): SocketLookup {
  return (hostname, options, callback) => {
    base(hostname, { all: true }, (error, addresses) => {
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
 * Whether every address a host name resolves to through `lookup` is public, within the signal; an
 * IP address, bracketed or not, is checked as it is. A name that does not resolve is not public.
 * Rejects with the signal's reason when it aborts.
 */
export async function resolvesToPublic(
  hostname: string,
  context: { readonly signal: AbortSignal; readonly lookup: HostLookup },
): Promise<boolean> {
  const { signal, lookup } = context;
  signal.throwIfAborted();
  const bare = hostname.replace(/^\[(.*)\]$/, "$1");
  if (bare.includes(":") || /^[\d.]+$/.test(bare)) {
    return isPublicAddress(bare);
  }
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
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  return Promise.race([resolved, aborted]);
}
