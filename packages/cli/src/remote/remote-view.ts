import type { RemoteProblem, RemoteView } from "@binference/protocol";
import type { TailscaleState } from "./read-tailscale.js";
import {
  isPublished,
  type LoopbackPorts,
  publishesExtra,
  reachesEngine,
  webhookHttpsPort,
} from "./remote-handlers.js";

/** What binference recorded it published, `remote.mini` and `remote.webhooks` (decision 0341). */
export interface RemoteRecord {
  readonly mini: boolean;
  readonly webhooks: boolean;
  /** `remote.publicUrl`, which `expose` writes only when it is unset or names the Mini App. */
  readonly publicUrl?: string;
}

/** What a view is drawn from besides Tailscale's state. */
export interface RemoteFacts {
  readonly record: RemoteRecord;
  readonly ports: LoopbackPorts;
  /** Whether the engine's port answers on an address beyond loopback. */
  readonly engineAnswers: boolean;
  readonly now: number;
}

type Running = Extract<TailscaleState, { kind: "running" }>;

// What a running Tailscale shows wrong against the record and the rules of decision 0341.
function runningProblems(state: Running, facts: RemoteFacts): readonly RemoteProblem[] {
  const { node, config } = state;
  const at = { name: node.name ?? "", ports: facts.ports };
  const { record } = facts;
  const isRecorded = record.mini || record.webhooks;
  const checks: readonly (readonly [RemoteProblem, boolean])[] = [
    ["https_off", isRecorded && (!node.https || node.name === undefined)],
    ["funnel_denied", record.webhooks && !node.funnel],
    ["funnel_extra", publishesExtra(config, at)],
    ["engine_exposed", facts.engineAnswers || reachesEngine(config, at)],
    [
      "serve_changed",
      (record.mini && !isPublished(config, at, "mini")) ||
        (record.webhooks && !isPublished(config, at, "webhooks")),
    ],
  ];
  return checks.filter(([, holds]) => holds).map(([problem]) => problem);
}

/**
 * The `RemoteView` of one read (protocol spec, section 7.9): Tailscale's state, the URLs of
 * binference's handlers while they are published, and the problems `binference check` fails.
 * Signed out or down, the record makes `logged_out` a problem; absent, only the engine's port
 * can be one.
 */
export function remoteViewOf(state: TailscaleState, facts: RemoteFacts): RemoteView {
  const exposed: readonly RemoteProblem[] = facts.engineAnswers ? ["engine_exposed"] : [];
  if (state.kind === "absent") {
    return { tailscale: "absent", problems: exposed, checkedAt: facts.now };
  }
  if (state.kind === "stopped") {
    const isRecorded = facts.record.mini || facts.record.webhooks;
    const problems: readonly RemoteProblem[] = isRecorded ? ["logged_out", ...exposed] : exposed;
    return { tailscale: "stopped", problems, checkedAt: facts.now };
  }
  return runningView(state, facts);
}

function runningView(state: Running, facts: RemoteFacts): RemoteView {
  const name = state.node.name ?? "";
  const at = { name, ports: facts.ports };
  const published = {
    mini: name !== "" && isPublished(state.config, at, "mini"),
    webhooks: name !== "" && isPublished(state.config, at, "webhooks"),
  };
  return {
    tailscale: "running",
    ...(published.mini ? { miniUrl: `https://${name}` } : {}),
    ...(published.webhooks ? { webhookUrl: `https://${name}:${String(webhookHttpsPort)}` } : {}),
    published,
    problems: runningProblems(state, facts),
    checkedAt: facts.now,
  };
}
