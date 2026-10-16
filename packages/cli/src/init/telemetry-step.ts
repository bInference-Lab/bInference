import type { LayerEntry } from "../config/layers/layer-entry.js";
import type { InitContext } from "./init-context.js";
import { isSetByFlag } from "./set-by-flag.js";

const path = ["telemetry", "enabled"] as const;

/**
 * The telemetry step (decision 0048): off unless the person picks yes; the earlier set-up's
 * choice comes first on a start over. binference sends no usage counts yet, so the step says the
 * choice is kept for when it does. A run nobody answers, or a `--set telemetry.enabled` flag,
 * asks nothing: the default, off, or the flag applies.
 */
export async function takeTelemetry(
  context: InitContext,
  earlier: boolean | undefined,
): Promise<readonly LayerEntry[]> {
  if (!context.isInteractive || isSetByFlag(context, path)) {
    return [];
  }
  const picked = await context.prompter.choose({
    id: "telemetry",
    message: context.words("telemetry.ask"),
    options: [
      { value: "no", label: context.words("telemetry.no") },
      { value: "yes", label: context.words("telemetry.yes") },
    ],
    initial: earlier === true ? "yes" : "no",
  });
  context.prompter.say(context.words("telemetry.none"));
  return [{ path, value: picked === "yes", origin: { layer: "flag", name: path.join(".") } }];
}
