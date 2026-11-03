import type { ProgramExit } from "@binference/platform";
import {
  httpsPortOf,
  type LoopbackPorts,
  type RemotePart,
  webhookMount,
} from "./remote-handlers.js";

/** Why publishing, or taking off, failed: a `remote.*` protocol code without its area. */
export type RemoteFailure =
  | "tailscale_missing"
  | "logged_out"
  | "https_off"
  | "funnel_denied"
  | "funnel_port"
  | "port_taken"
  | "same_port"
  | "not_operator"
  | "not_applied";

function mountOf(part: RemotePart): string {
  return part === "mini" ? "/" : webhookMount;
}

function placeOf(part: RemotePart): readonly string[] {
  return [`--https=${String(httpsPortOf(part))}`, `--set-path=${mountOf(part)}`];
}

/**
 * The CLI call that publishes `part` as decision 0340 sets it, kept across reboots and asking
 * nothing: `serve` for the Mini App at `/` on 443 to the engine's port, `funnel` for `/hook/` on
 * 8443 to the webhook listener's.
 */
export function publishArgs(part: RemotePart, ports: LoopbackPorts): readonly string[] {
  const target =
    part === "mini"
      ? `http://127.0.0.1:${String(ports.engine)}`
      : `http://127.0.0.1:${String(ports.webhooks)}${webhookMount}`;
  return [part === "mini" ? "serve" : "funnel", "--bg", "--yes", ...placeOf(part), target];
}

/**
 * The CLI call that takes `part`'s handler off again: the call that set it, with `off` for its
 * target, as Tailscale's docs give it; every other handler stays.
 */
export function unpublishArgs(part: RemotePart): readonly string[] {
  return [part === "mini" ? "serve" : "funnel", "--yes", ...placeOf(part), "off"];
}

// Tailscale's daemon refuses an account that may not change its settings: "access denied" on Linux
// and macOS, Windows' own "Access is denied"; the wording varies by OS and version.
const deniedWords =
  /access denied|access is denied|permission denied|not permitted|requires root|must be run as root|operator/i;

/** Why a CLI call that changed Tailscale failed: the operator check, or anything else. */
export function failureOf(exit: ProgramExit): RemoteFailure {
  return deniedWords.test(`${exit.stderr}\n${exit.stdout}`) ? "not_operator" : "not_applied";
}
