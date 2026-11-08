import type { BrowserView } from "@binference/protocol";

/** A screenshot or a PDF a driver took, which the engine saves in the agent's workspace. */
export interface BrowserCapture {
  readonly bytes: Readonly<Uint8Array>;
  readonly contentType: "image/png" | "image/jpeg" | "application/pdf";
}

/** What a driver answers one call with: the view, and the bytes of what it captured. */
export interface BrowserOutcome {
  readonly view: Omit<BrowserView, "file">;
  readonly capture?: BrowserCapture;
}

/**
 * Why a driver refused a call before it acted (decision 0401): no Chrome-family browser, one that
 * would not start, a proxy that cannot be read, an address the check refuses, or a tab it lacks.
 */
export type BrowserRefusal =
  | "not_found"
  | "start_failed"
  | "proxy_held"
  | "address_refused"
  | "tab_not_found";
