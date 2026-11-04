import type { Http } from "@binference/core";
import type { AgentMode } from "@binference/protocol";

/**
 * The opt-in counts of decision 0048, as decision 0355 sends them: the version, the OS, the
 * venues the agents' limits name, the bundled plugins the config turns on, how many community
 * plugins are on, paper or live, and how many agents. Never an address, a balance, an amount, a
 * token, a chat, a key, a community plugin's name or an install id.
 */
export interface UpdateCounts {
  readonly version: string;
  readonly os: string;
  readonly venues: readonly string[];
  readonly plugins: readonly string[];
  readonly communityPlugins: number;
  readonly mode: "paper" | "live" | "both";
  readonly agents: number;
}

/** What the counts are drawn from, as the install stands at the check. */
export interface CountFacts {
  readonly version: string;
  readonly os: string;
  /** Each agent not archived: its mode and the venues its limits name. */
  readonly agents: readonly { readonly mode: AgentMode; readonly venues: readonly string[] }[];
  /** `cex.binance.enabled`: the Binance Agent OS plugin is on. */
  readonly binanceOn: boolean;
  /** How many community plugins the plugin lock holds on. */
  readonly communityPluginsOn: number;
}

/** binference.io's address for the counts, until a test host names its own (decision 0355). */
export const countsUrl = "https://binference.io/api/v1/counts";

const countsBudgetMs = 10_000;

function modeOf(modes: ReadonlySet<AgentMode>): UpdateCounts["mode"] {
  if (modes.has("live")) {
    return modes.has("paper") ? "both" : "live";
  }
  return "paper";
}

/** The counts of the install's facts: venues sorted and each once, `paper` when none is live. */
export function countsOf(facts: CountFacts): UpdateCounts {
  const venues = new Set(facts.agents.flatMap((agent) => agent.venues));
  return {
    version: facts.version,
    os: facts.os,
    venues: [...venues].toSorted(),
    plugins: facts.binanceOn ? ["binance"] : [],
    communityPlugins: facts.communityPluginsOn,
    mode: modeOf(new Set(facts.agents.map((agent) => agent.mode))),
    agents: facts.agents.length,
  };
}

/**
 * Posts the counts as one JSON body, in 10 seconds, with the update check's user agent. Answers
 * whether the endpoint took them; it never throws but for a stop, since telemetry fails soft.
 */
export async function sendCounts(
  parts: { readonly http: Http; readonly url: string; readonly userAgent: string },
  counts: UpdateCounts,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    const answer = await parts.http.request({
      method: "POST",
      url: parts.url,
      headers: { "content-type": "application/json", "user-agent": parts.userAgent },
      body: JSON.stringify(counts),
      signal: AbortSignal.any([signal, AbortSignal.timeout(countsBudgetMs)]),
    });
    return answer.status >= 200 && answer.status < 300;
  } catch {
    signal.throwIfAborted();
    return false;
  }
}
