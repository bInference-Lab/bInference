import { BinferenceError } from "@binference/core";
import type { EngineOptions } from "@binference/engine";
import type { RemoteView } from "@binference/protocol";
import { readRemoteView, type RemoteReadParts } from "../remote/read-remote-view.js";
import { createSystemRandom } from "../runtime/system-random.js";
import type { Opened, Opening } from "./open-engine-parts.js";

// One read of Tailscale serves every caller for this long: a status, a rule's URL, a check.
const keepMs = 5_000;
// The whole read: two CLI calls of 10 seconds at once and the engine probe.
const readMs = 15_000;

/** Remote access as the engine reads it: one read of Tailscale, kept 5 seconds. */
export interface RemoteReading {
  readonly parts: RemoteReadParts;
  /** The view of the read kept, or of a new one; callers at once share it. */
  view(): Promise<RemoteView>;
  /** Drops the kept read, after a change of Tailscale's config. */
  forget(): void;
}

// The engine's one reading, so `remote/status` and a rule's URL share its kept read.
const readings = new WeakMap<Opened, RemoteReading>();

/**
 * A remote reading over `parts`: one read of Tailscale and the engine probe, kept 5 seconds and
 * shared by the callers that ask meanwhile.
 */
export function createRemoteReading(parts: RemoteReadParts): RemoteReading {
  const kept: { atMs: number; view: Promise<RemoteView> | undefined } = {
    atMs: 0,
    view: undefined,
  };
  return {
    parts,
    view: async () => {
      const now = parts.clock.now();
      if (kept.view === undefined || now - kept.atMs >= keepMs) {
        kept.atMs = now;
        // A read of its own time, so one caller's stop does not end the read others share.
        const signal = AbortSignal.timeout(readMs);
        kept.view = readRemoteView(parts, { probeEngine: true, signal });
      }
      return kept.view;
    },
    forget: () => {
      kept.view = undefined;
    },
  };
}

/**
 * The self-hosted engine's remote reading: the ports the engine and its webhook listener bind at
 * start, and the records as the config holds them on each read. One per engine.
 */
export function remoteReadingOf(opening: Opening, opened: Opened): RemoteReading {
  const known = readings.get(opened);
  if (known !== undefined) {
    return known;
  }
  const { engine } = opened.config;
  const reading = createRemoteReading({
    host: opening.host,
    ports: { engine: engine.port, webhooks: opening.host.webhookPort ?? engine.webhookPort },
    record: () => opened.settings.current().remote,
    clock: opening.host.clock,
  });
  readings.set(opened, reading);
  return reading;
}

/**
 * The base of every webhook rule's URL (decision 0340): the published funnel address while
 * binference's handler is there, else the webhook listener's loopback address. While
 * `remote.webhooks` records the path published and Tailscale does not answer, it rejects with
 * Tailscale's `remote` code, so nothing is stored and no URL that works only here is shown.
 */
export function webhookBaseOf(reading: RemoteReading): () => Promise<string> {
  const loopback = `http://127.0.0.1:${String(reading.parts.ports.webhooks)}`;
  return async () => {
    const view = await reading.view();
    if (reading.parts.record().webhooks && view.tailscale !== "running") {
      const code = view.tailscale === "absent" ? "remote.tailscale_missing" : "remote.logged_out";
      throw new BinferenceError({
        code,
        message: `Tailscale did not answer, so the public base of a rule's URL is unknown: ${code}.`,
      });
    }
    return view.webhookUrl ?? loopback;
  };
}

/**
 * The webhook rules' secure generator and the base of their URLs (decision 0338). A rule's secret
 * comes from the OS generator, never `host.random`, which tests seed: the secret alone keeps
 * strangers out.
 */
export function webhookPartsOf(
  opening: Opening,
  opened: Opened,
): Required<Pick<EngineOptions, "secretRandom" | "webhookBase">> {
  return {
    secretRandom: createSystemRandom(),
    webhookBase: webhookBaseOf(remoteReadingOf(opening, opened)),
  };
}
