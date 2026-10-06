import { BlockList, isIP } from "node:net";
import { BinferenceError } from "@binference/core";

/**
 * Whether a host names this machine only: `localhost`, an address in `127.0.0.0/8`, or `::1`, with
 * or without brackets, and their IPv4-mapped forms. `0.0.0.0` and `::` name every interface, and a
 * host name may resolve anywhere, so neither is loopback.
 */
export function isLoopbackHost(host: string): boolean {
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (bare.toLowerCase() === "localhost") {
    return true;
  }
  const family = isIP(bare);
  if (family === 0) {
    return false;
  }
  const loopback = new BlockList();
  loopback.addSubnet("127.0.0.0", 8, "ipv4");
  loopback.addAddress("::1", "ipv6");
  return loopback.check(bare, family === 4 ? "ipv4" : "ipv6");
}

/** What decides whether the HTTP listener may bind a host. */
export interface BindRequest {
  readonly host: string;
  /** Whether the server holds the credentials every connection signs in with. */
  readonly hasAuth: boolean;
}

/**
 * Refuses a host beyond loopback unless sign-in is set: without it, the listener would answer
 * whoever reaches the address. Throws `server.unsafe_bind` before anything binds.
 */
export function checkBind(request: BindRequest): void {
  if (request.hasAuth || isLoopbackHost(request.host)) {
    return;
  }
  throw new BinferenceError({
    code: "server.unsafe_bind",
    message:
      "The server binds beyond loopback only when sign-in is set; bind 127.0.0.1 or pass auth.",
    details: { host: request.host },
  });
}
