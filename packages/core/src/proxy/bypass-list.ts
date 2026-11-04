import { type AddressBlock, inBlock, ipv4Bytes, ipv6Bytes } from "../url-guard/ip-address.js";
import { isPublicAddress } from "../url-guard/public-address.js";

/** One entry of the no-proxy list, read. */
type BypassEntry =
  | { readonly kind: "all" }
  | { readonly kind: "name"; readonly name: string; readonly port?: number }
  | { readonly kind: "address"; readonly bytes: Readonly<Uint8Array>; readonly port?: number }
  | { readonly kind: "block"; readonly block: AddressBlock; readonly size: number };

/** The no-proxy list, read: the hosts reached without the proxy (`network.noProxy`). */
export interface BypassList {
  readonly entries: readonly BypassEntry[];
}

const namePattern = /^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?(?:\.[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?)*$/;
const digits = /^\d{1,5}$/;
const defaultPorts: Readonly<Record<string, number>> = {
  "http:": 80,
  "https:": 443,
  "ws:": 80,
  "wss:": 443,
};

function portOf(text: string): number | undefined {
  const port = digits.test(text) ? Number(text) : 0;
  return port >= 1 && port <= 65_535 ? port : undefined;
}

// ::ffff:0:0/96, the IPv4-mapped form: an address read as the IPv4 address it carries, so an
// entry and a host match in either form.
const mappedPrefix: readonly number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff];

function addressBytes(text: string): Uint8Array | undefined {
  const ipv6 = ipv6Bytes(text);
  if (ipv6 !== undefined && mappedPrefix.every((byte, at) => ipv6[at] === byte)) {
    return ipv6.slice(12);
  }
  return ipv4Bytes(text) ?? ipv6;
}

// A name: letters, digits, dashes and underscores in dotted labels, written in punycode, whose last
// label is no number, so it never reads as an address.
function isName(text: string): boolean {
  return namePattern.test(text) && !/^\d+$/.test(text.slice(text.lastIndexOf(".") + 1));
}

// `10.0.0.0/8` or `fd00::/8`: an address and how many of its leading bits a host must share.
function blockOf(text: string): BypassEntry | undefined {
  const [address = "", bitsText = "", ...rest] = text.split("/");
  const bytes = addressBytes(address);
  const bits = digits.test(bitsText) ? Number(bitsText) : -1;
  if (rest.length > 0 || bytes === undefined || bits < 0 || bits > bytes.length * 8) {
    return undefined;
  }
  return { kind: "block", block: [[...bytes], bits], size: bytes.length };
}

// A name, an address, `[v6]` or any of them with `:port`.
function hostEntryOf(text: string): BypassEntry | undefined {
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(text);
  const unbracketedV6 = text.split(":").length > 2 && bracketed === null;
  const cut = text.lastIndexOf(":");
  const [host, portText] = (() => {
    if (bracketed !== null) {
      return [bracketed[1] ?? "", bracketed[2]];
    }
    return unbracketedV6 || cut < 0 ? [text, undefined] : [text.slice(0, cut), text.slice(cut + 1)];
  })();
  const port = portText === undefined ? undefined : portOf(portText);
  if (portText !== undefined && port === undefined) {
    return undefined;
  }
  const portPart = port === undefined ? {} : { port };
  const bytes = addressBytes(host);
  if (bytes !== undefined) {
    return { kind: "address", bytes, ...portPart };
  }
  const name = host.replace(/^\*?\./, "").replace(/\.$/, "");
  return bracketed === null && isName(name) ? { kind: "name", name, ...portPart } : undefined;
}

function entryOf(text: string): BypassEntry | undefined {
  const entry = text.trim().toLowerCase();
  if (entry === "*") {
    return { kind: "all" };
  }
  return entry.includes("/") ? blockOf(entry) : hostEntryOf(entry);
}

/**
 * Whether a text is a no-proxy entry: `*` for every host, a host name in punycode, whose last
 * label is no number, that also covers the names under it (`example.com`, `.example.com` and
 * `*.example.com` all cover `api.example.com`), an IP address, `[v6]`, any of these with `:port`,
 * or an address block such as `10.0.0.0/8`. A name covers names alone, never an address.
 */
export function isBypassEntry(text: string): boolean {
  return entryOf(text) !== undefined;
}

/** Reads the no-proxy list; an entry {@link isBypassEntry} refuses covers no host. */
export function bypassListOf(entries: readonly string[]): BypassList {
  return { entries: entries.flatMap((text) => entryOf(text) ?? []) };
}

/** A URL's host and port as an entry is matched against them. */
interface Target {
  readonly host: string;
  readonly bytes: Readonly<Uint8Array> | undefined;
  readonly port: number;
}

function targetOf(text: string): Target {
  const url = new URL(text);
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const port = url.port === "" ? (defaultPorts[url.protocol] ?? 0) : Number(url.port);
  return { host, bytes: addressBytes(host), port };
}

function sameBytes(left: Readonly<Uint8Array>, right: Readonly<Uint8Array>): boolean {
  return left.length === right.length && left.every((byte, at) => byte === right[at]);
}

function portFits(port: number | undefined, target: Target): boolean {
  return port === undefined || port === target.port;
}

function hostFits(
  entry: Extract<BypassEntry, { readonly port?: number }>,
  target: Target,
): boolean {
  if (entry.kind === "name") {
    const isNameHost = target.bytes === undefined;
    return isNameHost && (target.host === entry.name || target.host.endsWith(`.${entry.name}`));
  }
  return target.bytes !== undefined && sameBytes(entry.bytes, target.bytes);
}

function covers(entry: BypassEntry, target: Target): boolean {
  if (entry.kind === "all") {
    return true;
  }
  if (entry.kind === "block") {
    return target.bytes?.length === entry.size && inBlock(target.bytes, entry.block);
  }
  return hostFits(entry, target) && portFits(entry.port, target);
}

// This machine, by name or address: what listens here is never the proxy's to reach.
function isLoopbackName(host: string): boolean {
  return host === "localhost" || host.endsWith(".localhost");
}

/**
 * Whether a request to the URL, which must parse, connects directly rather than through the proxy: always for this
 * machine (`localhost`, a name under `.localhost`) and for an IP address that is not on the
 * internet (loopback, private, link-local and the other blocks `isPublicAddress` refuses), and
 * for a host an entry of the list covers.
 */
export function goesDirect(list: BypassList, url: string): boolean {
  const target = targetOf(url);
  if (
    isLoopbackName(target.host) ||
    (target.bytes !== undefined && !isPublicAddress(target.host))
  ) {
    return true;
  }
  return list.entries.some((entry) => covers(entry, target));
}
