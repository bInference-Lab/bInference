import { type ServeConfig, serveConfigOf } from "./serve-config.js";
import type { RunTailscale } from "./tailscale-cli.js";
import { type TailscaleNode, tailscaleNodeOf } from "./tailscale-node.js";

/**
 * Tailscale as one read found it: no CLI, a daemon that is down, signed out or unreadable, or one
 * that runs, with this machine's node and everything it serves.
 */
export type TailscaleState =
  | { readonly kind: "absent" }
  | { readonly kind: "stopped"; readonly run: RunTailscale }
  | {
      readonly kind: "running";
      readonly run: RunTailscale;
      readonly node: TailscaleNode;
      readonly config: ServeConfig;
    };

/** Reads `tailscale serve status --json`; `undefined` when the CLI fails or prints other text. */
export async function readServeConfig(
  run: RunTailscale,
  signal: AbortSignal,
): Promise<ServeConfig | undefined> {
  const served = await run(["serve", "status", "--json"], signal);
  return served.exitCode === 0 ? serveConfigOf(served.stdout) : undefined;
}

/**
 * Reads this machine's Tailscale through `tailscale status --json --peers=false` and `tailscale
 * serve status --json`, both at once. A CLI that fails, a backend state other than `Running`, or
 * output that is not their JSON reads as stopped; it never throws for Tailscale's answers.
 */
export async function readTailscale(
  run: RunTailscale | undefined,
  signal: AbortSignal,
): Promise<TailscaleState> {
  if (run === undefined) {
    return { kind: "absent" };
  }
  const [status, config] = await Promise.all([
    run(["status", "--json", "--peers=false"], signal),
    readServeConfig(run, signal),
  ]);
  const node = status.exitCode === 0 ? tailscaleNodeOf(status.stdout) : undefined;
  if (node?.running !== true || config === undefined) {
    return { kind: "stopped", run };
  }
  return { kind: "running", run, node, config };
}
