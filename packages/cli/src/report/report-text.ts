import { redactedMark, redactSecrets } from "@binference/core";
import { shortAddress } from "@binference/i18n";

/** What the support bundle knows about this machine, so a text never names its owner's folders. */
export interface ReportPlaces {
  /** The account's home folder, written as `~` wherever a text names it. */
  readonly home: string;
}

/** What stands in for a URL the bundle cannot read. */
export const urlMark = "[url]";

// An EVM address: 0x and 40 hex digits. A private key, 64 digits, is masked before this runs.
const evmAddress = /\b0x[0-9a-fA-F]{40}\b/g;
// A URL: its scheme, `://`, then anything up to a space or a quote.
const anyUrl = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>`]+/gi;
// A run of key-like characters long enough to be a token, a key or an encoded secret.
const tokenLike = /[A-Za-z0-9+/_=-]{24,}/g;
// An id binference made: a prefix of two to four letters and a UUID version 7.
const binferenceId =
  /^[a-z]{2,4}_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A URL as the bundle keeps it: its origin alone, so no path, query or user name carries a key. */
export function urlOrigin(text: string): string {
  try {
    const { origin } = new URL(text);
    return origin === "null" ? urlMark : origin;
  } catch {
    return urlMark;
  }
}

// A key-like run stays only when it is one of binference's own ids, or holds no digit or no
// letter, as a dotted name or a long word does.
function maskToken(run: string): string {
  if (binferenceId.test(run) || !/[0-9]/.test(run) || !/[A-Za-z]/.test(run)) {
    return run;
  }
  return redactedMark;
}

function withoutHome(text: string, home: string): string {
  return home.length > 1 ? text.split(home).join("~") : text;
}

/**
 * A free text as the support bundle may hold it: every secret `redactSecrets` knows masked, every
 * EVM address cut to its short form (`0x1234…abcd`), every URL cut to its origin, every other
 * run of 24 or more key-like characters masked unless it is a binference id, and the home folder
 * written as `~`. It is the bundle's last line of defence for a value no field rule covers.
 */
export function redactReportText(text: string, places: ReportPlaces): string {
  const masked = redactSecrets(withoutHome(text, places.home));
  const urls = masked.replace(anyUrl, (url) => urlOrigin(url));
  const addresses = urls.replace(evmAddress, (address) => shortAddress(address));
  return addresses.replace(tokenLike, maskToken);
}
