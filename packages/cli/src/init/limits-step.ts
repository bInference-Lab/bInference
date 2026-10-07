import type { LayerEntry } from "../config/layers/layer-entry.js";
import type { InitContext } from "./init-context.js";

// US dollars as the config file writes them: at most six decimals, at most a trillion.
const dollarPattern = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/;

/** The limits a person sets at init, with the defaults of config spec 6.4. */
const asked = [
  { path: ["defaults", "limits", "perTradeUsd"], id: "perTradeUsd", initial: "100" },
  { path: ["defaults", "limits", "rollingDayUsd"], id: "rollingDayUsd", initial: "500" },
] as const;

async function askLimit(context: InitContext, limit: (typeof asked)[number]): Promise<LayerEntry> {
  const typed = await context.prompter.ask({
    id: limit.id,
    message: context.words(`limits.${limit.id}`),
    initial: limit.initial,
    check: (answer) =>
      dollarPattern.test(answer.trim()) ? undefined : context.words("limits.invalid"),
  });
  const origin = { layer: "flag", name: limit.path.join(".") } as const;
  return { path: limit.path, value: Number(typed.trim()), origin };
}

function isSetByFlag(context: InitContext, path: readonly string[]): boolean {
  const key = `${path.join(".")}=`;
  return context.flags.sets.some((set) => set.startsWith(key));
}

/**
 * The default limits step: a person sets the most one trade and all trades in 24 hours may move,
 * in US dollars, which every new agent copies. A key a `--set` flag gives is not asked, and a run
 * without a person asks nothing: the defaults, or its flags, apply.
 */
export async function takeLimits(context: InitContext): Promise<readonly LayerEntry[]> {
  if (!context.isInteractive) {
    return [];
  }
  context.prompter.note(context.words("limits.explain"), context.words("limits.title"));
  const open = asked.filter((item) => !isSetByFlag(context, item.path));
  // One question after the other: a person answers them in turn.
  return open.reduce<Promise<readonly LayerEntry[]>>(
    async (earlier, limit) => [...(await earlier), await askLimit(context, limit)],
    Promise.resolve([]),
  );
}
