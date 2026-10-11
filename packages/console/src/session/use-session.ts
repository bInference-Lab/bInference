import { useEffect, useState } from "react";
import type { ConsoleBrowser } from "../app/console-browser";
import { createConsoleClient } from "../connection/console-client";
import { createIndexedDeviceStore } from "../device/device-store";
import { openSession } from "./open-session";
import type { SessionState } from "./session-state";

// A session that opened after the page left, or before a retry, closes its client.
async function closeWhenReady(opened: Promise<SessionState>): Promise<void> {
  const ended = await opened;
  if (ended.kind === "ready") {
    ended.client.close();
  }
}

/**
 * Opens the console's session once the component mounts; a new attempt mounts it again. The client
 * closes when the component leaves. A fault while pairing or connecting, such as an engine
 * that does not answer, signs out as `unreachable`.
 */
export function useSession(browser: ConsoleBrowser, label: string): SessionState {
  const [state, setState] = useState<SessionState>({ kind: "starting" });
  useEffect(() => {
    const stop = new AbortController();
    const report = (next: SessionState): void => {
      if (!stop.signal.aborted) {
        setState(next);
      }
    };
    const store =
      browser.indexedDB === undefined ? undefined : createIndexedDeviceStore(browser.indexedDB);
    const context = {
      browser,
      store,
      label,
      connect: createConsoleClient.bind(undefined, browser),
      report,
      signal: stop.signal,
    };
    const opened = openSession(context).catch((): SessionState => ({
      kind: "signed_out",
      reason: "unreachable",
    }));
    void opened.then(report);
    return () => {
      stop.abort();
      void closeWhenReady(opened);
    };
  }, [browser, label]);
  return state;
}
