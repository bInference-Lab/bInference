import { err, ok, type Result } from "@binference/core";
import type { LaunchTokenRequest, ProtocolErrorCode } from "@binference/protocol";
import { activeAgent } from "../operations/active-agent.js";
import { hasLaunchUnderWay } from "./propose-launch.js";
import { type LaunchPathOptions, type ResolvedLaunch, resolveLaunch } from "./resolve-launch.js";

/**
 * Checks the agent's launch draft as a proposal is checked before anything is stored (decision
 * 0285): the agent is active (else `agent.not_found` or `agent.archived`), not frozen
 * (`agent.frozen`) and live (`agent.paper_only`); no other launch of it is under way
 * (`intent.launch_waiting`); the launch resolves as `resolveLaunch` says; and it runs from the
 * agent's live launch wallet (`intent.launch_wallet_missing`). Nothing is stored, read from a
 * launchpad or uploaded.
 */
export async function checkLaunchDraft(
  options: LaunchPathOptions,
  request: LaunchTokenRequest,
  signal: AbortSignal,
): Promise<Result<ResolvedLaunch, ProtocolErrorCode>> {
  const active = await activeAgent(options.agents, request.agent, { signal });
  if (!active.ok) {
    return active;
  }
  const settings = active.value;
  if (settings.agent.frozenAtMs !== undefined) {
    return err("agent.frozen");
  }
  if (settings.agent.mode !== "live") {
    return err("agent.paper_only");
  }
  if (await hasLaunchUnderWay(options, request.agent, signal)) {
    return err("intent.launch_waiting");
  }
  const resolved = await resolveLaunch(options, { request, settings, isPaper: false, signal });
  if (!resolved.ok) {
    return resolved;
  }
  return resolved.value.isLaunchWallet ? ok(resolved.value) : err("intent.launch_wallet_missing");
}
