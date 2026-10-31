import type { ChainRegistry } from "@binference/chain";
import type { AgentRecord } from "../agents/agent-record.js";
import type { CeilingRead } from "../install/ceiling-change.js";
import { assetInfoOf } from "../money-path/asset-infos.js";
import type { EnginePush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";

// The message key of the notice that a ceiling change added a 24-hour cap (decision 0305).
const dayCapAddedKey = "notice.dayCapAdded";

/** One wallet's ceiling as read before a change and after it. */
export interface CeilingReads {
  readonly earlier: CeilingRead;
  readonly next: CeilingRead;
}

/**
 * The notice that a ceiling change added a 24-hour cap on approvals of assets no cap held before,
 * as a ceiling made before ETH's cap gains it with its first ETH bridge route (decision 0305): it
 * names the agent and each asset by its registry symbol, and tells the owner that until this
 * change approvals of those assets had no 24-hour cap. Undefined when no cap was added.
 */
export function dayCapAddedNotice(
  agent: AgentRecord,
  change: { readonly chains: ChainRegistry; readonly reads: readonly CeilingReads[] },
): EnginePush | undefined {
  const added = change.reads.flatMap(({ earlier, next }) =>
    next.dayCaps
      .filter((cap) => !earlier.dayCaps.some((held) => held.asset === cap.asset))
      .map((cap) => cap.asset),
  );
  const symbols = [...new Set(added)].map(
    (asset) => assetInfoOf(change.chains, asset)?.symbol ?? asset,
  );
  return symbols.length === 0
    ? undefined
    : noticePush({
        key: dayCapAddedKey,
        agent: agent.id,
        values: { agent: agent.name, assets: symbols.join(", ") },
      });
}
