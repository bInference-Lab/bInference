import {
  BinferenceError,
  type HostLookup,
  type HttpRequest,
  isAddressHost,
  isPublicAddress,
} from "@binference/core";

/** Where a public-only request through the proxy is sent, and the `host` header it then needs. */
export interface PublicTarget {
  readonly url: string;
  /** The host's name and port, when the URL names the address checked in its place. */
  readonly host?: string;
}

function privateAddress(request: HttpRequest): BinferenceError {
  return new BinferenceError({
    code: "http.private_address",
    message: "The host resolves to an address that is not on the internet.",
    details: { method: request.method, origin: new URL(request.url).origin },
  });
}

// The public address a public-only request's host resolves to here, or a refusal when any of its
// addresses is off the internet or none resolves.
async function checkedAddress(request: HttpRequest, lookup: HostLookup): Promise<string> {
  const { hostname } = new URL(request.url);
  if (isAddressHost(hostname)) {
    return hostname;
  }
  request.signal.throwIfAborted();
  const resolved = new Promise<string | undefined>((resolve) => {
    lookup(hostname, { all: true }, (error, addresses) => {
      const isPublic =
        error === null &&
        addresses.length > 0 &&
        addresses.every(({ address }) => isPublicAddress(address));
      resolve(isPublic ? addresses[0]?.address : undefined);
    });
  });
  const aborted = new Promise<never>((_resolve, reject) => {
    request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true });
  });
  const address = await Promise.race([resolved, aborted]);
  if (address === undefined) {
    throw privateAddress(request);
  }
  return address;
}

/**
 * Where a public-only request through the proxy goes (decision 0347). The proxy resolves a name
 * itself, so the name is resolved here first and refused with `http.private_address` when any of
 * its addresses is off the internet. An `https:` request keeps its name, which TLS binds to the
 * host's certificate; an `http:` one is sent to the address checked here, the name in `host`, so
 * the proxy connects where binference looked and a name cannot rebind between the two lookups.
 */
export async function publicTarget(
  request: HttpRequest,
  lookup: HostLookup,
): Promise<PublicTarget> {
  const address = await checkedAddress(request, lookup);
  const url = new URL(request.url);
  if (url.protocol !== "http:" || isAddressHost(url.hostname)) {
    return { url: request.url };
  }
  const host = url.host;
  url.hostname = address.includes(":") ? `[${address}]` : address;
  return { url: url.toString(), host };
}
