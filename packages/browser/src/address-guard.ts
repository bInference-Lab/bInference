import { fileURLToPath } from "node:url";
import {
  checkPublicUrl,
  type HostLookup,
  isAddressHost,
  isPublicAddress,
  resolvesToPublic,
} from "@binference/core";
import type { WalledPaths } from "@binference/platform";
import { type FilePage, isWalledPath, readFilePage } from "./file-pages.js";

/** What the check of the browser's requests reads (decision 0401), each read at each request. */
export interface AddressGuardOptions {
  /** Whether loopback and private addresses may load (`browser.allowPrivateNetwork`). */
  readonly allowPrivateNetwork: () => boolean;
  /** The engine's own ports, its console and its webhook listener, refused on every loopback. */
  readonly enginePorts: () => readonly number[];
  /** The origin of `remote.publicUrl`, refused whatever the network setting. */
  readonly publicOrigin: () => string | undefined;
  /** The state folder at each spelling, and the workspace inside it, as the shell's wall reads them. */
  readonly walled: WalledPaths;
  readonly lookup: HostLookup;
  /** A path's real path, links followed, or `undefined` when nothing is there. */
  readonly realPath: (path: string) => Promise<string | undefined>;
  /** Origins that always load, for a test's page on the loopback alone. */
  readonly allowedOrigins?: readonly string[];
}

/** Decides whether the browser may load an address: the page, a part of it, or a socket. */
export interface AddressGuard {
  allows(url: string, signal: AbortSignal): Promise<boolean>;
  /**
   * What a `file:` address serves the browser, which never opens the path itself (decision
   * 0410): the file read through the handle that was judged, or `undefined` to refuse it.
   */
  readFile(url: string, signal: AbortSignal): Promise<FilePage | undefined>;
}

// Schemes that hold no address to reach: the page itself makes them.
const selfMade = new Set(["about:", "data:", "blob:"]);
const webSchemes = new Set(["http:", "https:", "ws:", "wss:"]);
const defaultPorts: Readonly<Record<string, number>> = {
  "http:": 80,
  "ws:": 80,
  "https:": 443,
  "wss:": 443,
};

const loopbackNames = new Set(["localhost", "0.0.0.0", "[::]", "[::1]", "::", "::1"]);

// An IPv4 address written inside IPv6 (`::ffff:7f00:1`, as the URL parser writes
// `[::ffff:127.0.0.1]`), which reaches the IPv4 address: its first byte, or `undefined`.
function mappedFirstByte(name: string): number | undefined {
  const mapped = /^\[?::ffff:([0-9a-f]{1,4}):[0-9a-f]{1,4}\]?$/u.exec(name)?.[1];
  return mapped === undefined
    ? undefined
    : Number.parseInt(mapped.padStart(4, "0").slice(0, 2), 16);
}

// Whether a host is this machine: a loopback name or address, the unspecified address, or an
// IPv4 one of them written inside IPv6.
function isLoopbackHost(host: string): boolean {
  const name = host.toLowerCase().replace(/\.$/u, "");
  const mapped = mappedFirstByte(name);
  return (
    loopbackNames.has(name) ||
    name.endsWith(".localhost") ||
    name.startsWith("127.") ||
    mapped === 127 ||
    mapped === 0
  );
}

// The HTTP form of a web address, for the URL check that reads only http and https.
function asHttp(url: URL): string {
  const copy = new URL(url.href);
  copy.protocol = url.protocol === "wss:" || url.protocol === "https:" ? "https:" : "http:";
  copy.username = "";
  copy.password = "";
  return copy.href;
}

async function fileAllowed(options: AddressGuardOptions, url: URL): Promise<boolean> {
  const path = fileURLToPath(url);
  const real = (await options.realPath(path)) ?? path;
  return !isWalledPath(options.walled, real) && !isWalledPath(options.walled, path);
}

// Whether a name resolves to this machine, so the engine's ports on it are refused too.
async function reachesLoopback(
  options: AddressGuardOptions,
  host: string,
  signal: AbortSignal,
): Promise<boolean> {
  if (isAddressHost(host)) {
    return false;
  }
  const loopback = new Promise<boolean>((resolve) => {
    options.lookup(host, { all: true }, (error, addresses) => {
      resolve(error === null && addresses.some(({ address }) => isLoopbackHost(address)));
    });
  });
  signal.throwIfAborted();
  return loopback;
}

async function webAllowed(options: AddressGuardOptions, url: URL, signal: AbortSignal) {
  const host = url.hostname;
  const port = Number(url.port === "" ? defaultPorts[url.protocol] : url.port);
  const publicOrigin = options.publicOrigin();
  if (publicOrigin !== undefined && new URL(asHttp(url)).origin === publicOrigin) {
    return false;
  }
  const enginePort = options.enginePorts().includes(port);
  if (enginePort && (isLoopbackHost(host) || (await reachesLoopback(options, host, signal)))) {
    return false;
  }
  if (options.allowPrivateNetwork()) {
    return true;
  }
  if (isAddressHost(host)) {
    return isPublicAddress(host);
  }
  return (
    checkPublicUrl(asHttp(url)).ok && resolvesToPublic(host, { signal, lookup: options.lookup })
  );
}

/**
 * The check every request of the agent's browser passes first (decision 0401): the page, each
 * part, script and socket of it. It refuses the engine's ports on any loopback address, a name
 * that resolves to one included, the origin of `remote.publicUrl`, and any `file://` path inside
 * the state folder but the agent's workspace, its real path read through links; loopback and private addresses, and names
 * that resolve to them, unless `browser.allowPrivateNetwork` allows them; and every scheme but
 * the web's, `file:`, `about:`, `data:` and `blob:`. A `file:` request is answered from the bytes
 * {@link AddressGuard.readFile} gives, so no link moved after the check reaches a walled file.
 */
export function createAddressGuard(options: AddressGuardOptions): AddressGuard {
  const filePages = {
    walled: options.walled,
    realPath: async (path: string) => options.realPath(path),
  };
  return {
    readFile: async (url, signal) => readFilePage(filePages, url, signal),
    allows: async (text, signal) => {
      if (!URL.canParse(text)) {
        return false;
      }
      const url = new URL(text);
      if (selfMade.has(url.protocol)) {
        return true;
      }
      if (url.protocol === "file:") {
        return fileAllowed(options, url);
      }
      if (options.allowedOrigins?.includes(new URL(asHttp(url)).origin) === true) {
        return webSchemes.has(url.protocol);
      }
      return webSchemes.has(url.protocol) && webAllowed(options, url, signal);
    },
  };
}
