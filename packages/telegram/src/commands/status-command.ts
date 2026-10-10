import { type AccountRef, accountRefParts } from "@binference/chain";
import type { ResultOf } from "@binference/protocol";
import { callOrSay, type CommandContext } from "./command-context.js";

type EngineStatus = ResultOf<"engine/status">;
type SafetyStatus = ResultOf<"safety/status">;

function engineLines(context: CommandContext, status: EngineStatus): readonly string[] {
  const { words } = context;
  const summary = words("cmd.status.summary", { version: status.version, state: status.state });
  return status.state === "locked" ? [summary, words("cmd.status.locked")] : [summary];
}

function agentLines(
  context: CommandContext,
  status: EngineStatus,
  safety: SafetyStatus,
): readonly string[] {
  const { words, formatter } = context;
  if (status.agents.length === 0) {
    return [words("cmd.status.noAgents")];
  }
  return status.agents.map((agent) => {
    const frozenAt = safety.agents?.find((frozen) => frozen.agent === agent.id)?.frozenAt;
    return words("cmd.status.agent", {
      agent: agent.id,
      mode: words("cmd.mode", { mode: agent.mode }),
      frozen: frozenAt === undefined ? "no" : "yes",
      when: frozenAt === undefined ? "" : formatter.dateTime(frozenAt),
    });
  });
}

function address(account: AccountRef): string {
  return accountRefParts(account).address;
}

// The install's freeze, the rescue under way, and the rescue address with a change that waits.
function safetyLines(context: CommandContext, safety: SafetyStatus): readonly string[] {
  const { words, formatter } = context;
  const { frozenAt, rescue, rescueAddress, pendingRescueAddress, pendingRescueAt } = safety;
  return [
    ...(frozenAt === undefined
      ? []
      : [words("cmd.status.installFrozen", { when: formatter.dateTime(frozenAt) })]),
    ...(rescue === undefined ? [] : [words("cmd.rescue.underWay", { state: rescue.state })]),
    rescueAddress === undefined
      ? words("cmd.status.noRescueAddress")
      : words("cmd.status.rescueAddress", { address: address(rescueAddress) }),
    ...(pendingRescueAddress === undefined || pendingRescueAt === undefined
      ? []
      : [
          words("cmd.status.pendingRescueAddress", {
            address: address(pendingRescueAddress),
            when: formatter.dateTime(pendingRescueAt),
          }),
        ]),
  ];
}

function healthLine(context: CommandContext, health: EngineStatus["health"]): string {
  const count = (state: string): number => health.filter((signal) => signal.state === state).length;
  const [fail, warn] = [count("fail"), count("warn")];
  return fail + warn === 0
    ? context.words("cmd.status.healthy", { count: health.length })
    : context.words("cmd.status.unhealthy", { fail, warn });
}

/**
 * `/status`: the engine's state and release, a locked engine said so (decision 0104), the
 * install's freeze, each agent with its mode and freeze, the rescue under way, the rescue address
 * with a change that waits, and how many health signals fail.
 */
export async function runStatus(context: CommandContext): Promise<void> {
  const status = await callOrSay(context, "engine/status", {});
  const safety = status === undefined ? undefined : await callOrSay(context, "safety/status", {});
  if (status === undefined || safety === undefined) {
    return;
  }
  const lines = [
    ...engineLines(context, status),
    ...safetyLines(context, safety),
    ...agentLines(context, status, safety),
    healthLine(context, status.health),
  ];
  await context.say(lines.join("\n"));
}
