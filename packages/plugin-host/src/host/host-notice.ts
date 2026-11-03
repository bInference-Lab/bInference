import type { Clock } from "@binference/core";
import type { ProbeAct } from "../probe/probe-outcome.schema.js";

/**
 * Why community plugins cannot run on this machine: an act the probe was not refused, the
 * engine started without `--disable-sigusr1` (`engineDebugSignal`), or a probe that gave no
 * report (`probeFailed`).
 */
export type SandboxFailure = ProbeAct | "engineDebugSignal" | "probeFailed";

/**
 * What the plugin host tells the owner (spec 4, section 4.4): a fetch of an undeclared host
 * (`notice.pluginHostRefused`), a plugin turned off after its crashes (`notice.pluginStopped`),
 * a plugin ended for leaving what the host sent it unread (`notice.pluginStalled`), or a sandbox
 * that does not hold (`notice.pluginSandboxOff`).
 */
export type HostNotice =
  | { readonly kind: "hostRefused"; readonly plugin: string; readonly host: string }
  | { readonly kind: "stopped"; readonly plugin: string }
  | { readonly kind: "stalled"; readonly plugin: string }
  | { readonly kind: "sandboxOff"; readonly reason: SandboxFailure };

/** Hears a notice for the owner; the composition root publishes it. */
export type TellOwner = (notice: HostNotice) => void;

const dayMs = 86_400_000;
// The pairs remembered; past it the oldest is forgotten, so a plugin that asks for endless hosts
// costs a bounded map and at worst a second notice for a host.
const maxRemembered = 1_000;

/**
 * Tells the owner of a plugin's undeclared host once per plugin and host a day. What it told
 * lives in memory, so a restart may tell a pair again within its day.
 */
export function createHostRefusals(parts: {
  readonly clock: Clock;
  readonly tell: TellOwner;
}): (plugin: string, host: string) => void {
  const told = new Map<string, number>();
  return (plugin, host) => {
    const key = `${plugin} ${host}`;
    const now = parts.clock.now();
    const last = told.get(key);
    if (last !== undefined && now - last < dayMs) {
      return;
    }
    told.delete(key);
    told.set(key, now);
    const oldest = told.size > maxRemembered ? told.keys().next().value : undefined;
    if (oldest !== undefined) {
      told.delete(oldest);
    }
    parts.tell({ kind: "hostRefused", plugin, host });
  };
}
