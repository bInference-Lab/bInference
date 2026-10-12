import { err, ok, type Result } from "../result.js";
import { isAddressHost, isPublicAddress } from "./public-address.js";

/** Why the guard refuses a URL before anything is looked up or sent. */
export type UrlRefusal =
  /** The text is not an absolute URL, or is longer than 2,048 characters. */
  | "not_url"
  /** Its scheme is not `http` or `https`. */
  | "scheme"
  /** It carries a user name or a password. */
  | "credentials"
  /** Its host is an address that is not on the internet, or a name only a local network uses. */
  | "private_host";

/** The longest URL the guard reads. */
export const maxUrlChars = 2_048;

// Names that never reach the internet (RFC 6761, RFC 6762, RFC 8375, ICANN's `internal`, and the
// `lan` home routers use): a resolver may answer them from the local network.
const localSuffixes = [".localhost", ".local", ".internal", ".home.arpa", ".lan"] as const;

function isLocalName(hostname: string): boolean {
  const name = hostname.toLowerCase().replace(/\.$/, "");
  return (
    name === "localhost" ||
    !name.includes(".") ||
    localSuffixes.some((suffix) => name.endsWith(suffix))
  );
}

function parsed(text: string): URL | undefined {
  if (text.length > maxUrlChars || !URL.canParse(text)) {
    return undefined;
  }
  return new URL(text);
}

/**
 * Checks a URL a person, a model or a page gave before it is looked up (the OWASP guidance on
 * server-side request forgery): an absolute `http` or `https` URL of at most 2,048 characters,
 * with no user name or password, whose host is a public IP address or a name with a dot that
 * no local network keeps for itself (`localhost`, `.local`, `.internal` and the like). The
 * WHATWG parser reads every IPv4 spelling (decimal, octal, hex) as its dotted form first. A name
 * is only half the check: what it resolves to must be public too ({@link publicOnlyLookup}).
 * Answers the URL without its fragment.
 */
export function checkPublicUrl(text: string): Result<URL, UrlRefusal> {
  const url = parsed(text);
  if (url === undefined) {
    return err("not_url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return err("scheme");
  }
  if (url.username !== "" || url.password !== "") {
    return err("credentials");
  }
  const host = url.hostname;
  const isPublic = isAddressHost(host) ? isPublicAddress(host) : !isLocalName(host);
  if (!isPublic) {
    return err("private_host");
  }
  url.hash = "";
  return ok(url);
}
