import { type AccountRef, accountRefParts } from "@binference/chain";
import type { DestinationChain } from "../address-book/destination-chain.js";
import type { AgentRecord } from "../agents/agent-record.js";
import type { RescueReachRecord } from "../install/rescue-record.js";
import type { EnginePush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";

// The message keys of the notices that tell where a bridge pays a rescue address (decision 0321).
const bridgedKey = "notice.rescueBridged";
const notBridgedKey = "notice.rescueNotBridged";

/** A destination as the words name it: its chain and the registry's name. */
type Named = Pick<DestinationChain, "ref" | "name">;

// The destinations' names, as the registry gives them, each once.
function namesOf(destinations: readonly Named[], accounts: readonly AccountRef[]): string {
  const chains = [...new Set(accounts.map((account) => accountRefParts(account).chain))];
  return chains
    .map((chain) => destinations.find((item) => item.ref === chain)?.name ?? chain)
    .join(", ");
}

// The standings grouped by their address and a label, each group with its accounts.
function groupsOf(
  records: readonly RescueReachRecord[],
  label: (record: RescueReachRecord) => string,
): readonly {
  readonly address: string;
  readonly label: string;
  readonly accounts: readonly AccountRef[];
}[] {
  const groups = new Map<string, { address: string; label: string; accounts: AccountRef[] }>();
  for (const record of records) {
    const address = accountRefParts(record.account).address;
    const key = `${address} ${label(record)}`;
    const group = groups.get(key) ?? { address, label: label(record), accounts: [] };
    group.accounts.push(record.account);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** What an agent's standings were before a write and are after it, and when a waiting one pays. */
export interface StandingChange {
  readonly before: readonly RescueReachRecord[];
  readonly after: readonly RescueReachRecord[];
  readonly destinations: readonly Named[];
  /** When the rescue address that waits takes effect; absent while none waits. */
  readonly waitsUntilMs?: number;
}

/**
 * The notices of the standings of one agent that changed (decision 0321), each once per real
 * change: `notice.rescueBridged` where its bridge rules now list a rescue address, `now` for the
 * one in effect and `waiting` with its time for the one that waits; and `notice.rescueNotBridged`
 * where a rescue address is left out for a reason other than the one last told: code, a chain it
 * could not read, a chain of another kind, or no room. Each names the chains by the registry.
 */
export function standingNotices(
  agent: Pick<AgentRecord, "id" | "name">,
  change: StandingChange,
): readonly EnginePush[] {
  const { before, after, destinations, waitsUntilMs } = change;
  const was = (record: RescueReachRecord) =>
    before.find((item) => item.account === record.account)?.state;
  const listed = after.filter(
    (record) =>
      (record.state === "joined" && was(record) !== "joined") ||
      (record.state === "waiting" && was(record) !== "waiting" && was(record) !== "joined"),
  );
  const left = after.filter(
    (record) =>
      record.state !== "joined" && record.state !== "waiting" && was(record) !== record.state,
  );
  const bridged = groupsOf(listed, (record) => record.state).map((group) =>
    noticePush({
      key: bridgedKey,
      agent: agent.id,
      values: {
        agent: agent.name,
        address: group.address,
        chains: namesOf(destinations, group.accounts),
        status: group.label === "waiting" ? "waiting" : "now",
      },
      ...(group.label === "waiting" && waitsUntilMs !== undefined
        ? { times: { when: waitsUntilMs } }
        : {}),
    }),
  );
  const notBridged = groupsOf(left, (record) => record.state).map((group) =>
    noticePush({
      key: notBridgedKey,
      agent: agent.id,
      values: {
        agent: agent.name,
        address: group.address,
        chains: namesOf(destinations, group.accounts),
        why: group.label,
      },
    }),
  );
  return [...bridged, ...notBridged];
}
