import { err, ok, type Result } from "@binference/core";
import { readServeConfig, readTailscale, type TailscaleState } from "./read-tailscale.js";
import {
  handlersReaching,
  holdsOurHandler,
  isPortTaken,
  isPublished,
  type LoopbackPorts,
  type PortHandler,
  type RemotePart,
  type RemotePlace,
  webhookHttpsPort,
} from "./remote-handlers.js";
import type { RunTailscale } from "./tailscale-cli.js";
import { failureOf, publishArgs, type RemoteFailure, unpublishArgs } from "./tailscale-commands.js";
import { allowsFunnelOn, type TailscaleNode } from "./tailscale-node.js";

type Running = Extract<TailscaleState, { kind: "running" }>;

// An undo runs on time of its own, never on the job's signal, which a stop has already aborted.
const undoMs = 10_000;

// What keeps the webhook path from going public: the tailnet's policy, or the listener's port.
function webhookFailure(node: TailscaleNode, ports: LoopbackPorts): RemoteFailure | undefined {
  if (!node.funnel) {
    return "funnel_denied";
  }
  if (!allowsFunnelOn(node, webhookHttpsPort)) {
    return "funnel_port";
  }
  return ports.engine === ports.webhooks ? "same_port" : undefined;
}

// Every check of decision 0340 before any change, in the order the owner fixes them.
function readiness(
  state: TailscaleState,
  parts: readonly RemotePart[],
  ports: LoopbackPorts,
): Result<{ readonly state: Running; readonly at: RemotePlace }, RemoteFailure> {
  if (state.kind === "absent") {
    return err("tailscale_missing");
  }
  if (state.kind === "stopped") {
    return err("logged_out");
  }
  const { node, config } = state;
  if (!node.https || node.name === undefined) {
    return err("https_off");
  }
  const webhooks = parts.includes("webhooks") ? webhookFailure(node, ports) : undefined;
  if (webhooks !== undefined) {
    return err(webhooks);
  }
  const at = { name: node.name, ports };
  return parts.some((part) => isPortTaken(config, at, part))
    ? err("port_taken")
    : ok({ state, at });
}

// Runs each part's call in order until one fails or does not end; a part counts as attempted
// once its call starts, since a call killed at its time limit may have changed the config.
async function apply(
  run: RunTailscale,
  request: { readonly parts: readonly RemotePart[]; readonly ports: LoopbackPorts },
  signal: AbortSignal,
): Promise<{ readonly attempted: readonly RemotePart[]; readonly failure?: RemoteFailure }> {
  const attempted: RemotePart[] = [];
  for (const part of request.parts) {
    attempted.push(part);
    // oxlint-disable-next-line eslint/no-await-in-loop -- one change of Tailscale's config at a time
    const exit = await run(publishArgs(part, request.ports), signal);
    if (exit.exitCode !== 0) {
      return { attempted, failure: failureOf(exit) };
    }
  }
  return { attempted };
}

// Takes off, newest first, each attempted part a fresh read shows binference's handler of, on
// time of its own; one that cannot be read is taken off blind, and Tailscale ignores a missing one.
async function undo(run: RunTailscale, attempted: readonly RemotePart[], at: RemotePlace) {
  const signal = AbortSignal.timeout(undoMs);
  const now = await readServeConfig(run, signal);
  const left = attempted.filter((part) => now === undefined || holdsOurHandler(now, at, part));
  for (const part of left.toReversed()) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one change of Tailscale's config at a time
    await run(unpublishArgs(part), signal);
  }
}

/**
 * Publishes `parts` through Tailscale's CLI as decision 0340 sets them. Every check runs before any
 * change, and a part already published as set is left as it is. After the calls it reads Tailscale
 * back; a call that fails, runs past its time or is stopped, or a read that does not show each
 * part, fails `not_operator` or `not_applied`, and every part this run attempted that a fresh read
 * shows binference's handler of is taken off again, on time of its own. It answers this machine's
 * Tailscale name.
 */
export async function publishRemote(
  run: RunTailscale | undefined,
  request: { readonly parts: readonly RemotePart[]; readonly ports: LoopbackPorts },
  signal: AbortSignal,
): Promise<Result<string, RemoteFailure>> {
  const ready = readiness(await readTailscale(run, signal), request.parts, request.ports);
  if (!ready.ok) {
    return ready;
  }
  const { state, at } = ready.value;
  const missing = request.parts.filter((part) => !isPublished(state.config, at, part));
  const applied = await apply(state.run, { parts: missing, ports: at.ports }, signal);
  const after =
    applied.failure === undefined ? await readServeConfig(state.run, signal) : undefined;
  const isShown =
    after !== undefined && request.parts.every((part) => isPublished(after, at, part));
  if (isShown) {
    return ok(at.name);
  }
  await undo(state.run, applied.attempted, at);
  return err(applied.failure ?? "not_applied");
}

/** What Tailscale holds after `--off`: binference's parts still published, and what is left. */
export interface Unpublished {
  readonly published: { readonly mini: boolean; readonly webhooks: boolean };
  /** Every handler or TCP forward that still publishes the engine's or the listener's port. */
  readonly left: readonly PortHandler[];
  /** This machine's Tailscale name, when Tailscale runs and has one. */
  readonly name?: string;
}

const nothing: Unpublished = { published: { mini: false, webhooks: false }, left: [] };

/**
 * Takes off binference's own handlers (decision 0341): each only while it is exactly as binference
 * set it, the webhook path first; every other Tailscale setting stays. Then it reads Tailscale back
 * and answers what is still published. With no Tailscale CLI there is nothing to take off, unless
 * `isRecorded` says binference published something: then `tailscale_missing`. A daemon that is
 * down or signed out is `logged_out`, a refused account `not_operator`, a read back that fails
 * `not_applied`.
 */
export async function unpublishRemote(
  run: RunTailscale | undefined,
  request: { readonly ports: LoopbackPorts; readonly isRecorded: boolean },
  signal: AbortSignal,
): Promise<Result<Unpublished, RemoteFailure>> {
  const state = await readTailscale(run, signal);
  if (state.kind === "absent") {
    return request.isRecorded ? err("tailscale_missing") : ok(nothing);
  }
  if (state.kind === "stopped") {
    return err("logged_out");
  }
  const name = state.node.name ?? "";
  const at = { name, ports: request.ports };
  const ours: readonly RemotePart[] = ["webhooks", "mini"];
  for (const part of ours.filter((each) => isPublished(state.config, at, each))) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one change of Tailscale's config at a time
    const exit = await state.run(unpublishArgs(part), signal);
    if (exit.exitCode !== 0 && failureOf(exit) === "not_operator") {
      return err("not_operator");
    }
  }
  const after = await readServeConfig(state.run, signal);
  if (after === undefined) {
    return err("not_applied");
  }
  const published = {
    mini: isPublished(after, at, "mini"),
    webhooks: isPublished(after, at, "webhooks"),
  };
  const left = handlersReaching(after, at);
  return ok(name === "" ? { published, left } : { published, left, name });
}
