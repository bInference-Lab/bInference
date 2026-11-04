import type { ProtocolClient } from "@binference/client";
import { jsonValueSchema } from "@binference/core";
import { displayOutsideText } from "@binference/i18n";
import { operations, type ResultOf } from "@binference/protocol";
import { z } from "zod";
import type { ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import { withEngine } from "./connect-engine.js";

type PluginView = ResultOf<"plugin/list">["items"][number];

// A plugin's name and tools are its manifest's, read by a strict schema; they show as any text set
// outside binference does.
const nameLength = 64;

function pluginValues(plugin: PluginView) {
  return {
    plugin: displayOutsideText(plugin.name, nameLength),
    version: displayOutsideText(plugin.version, nameLength),
    state: plugin.state,
    reason: plugin.disabledReason ?? "none",
    provenance: plugin.provenance ?? "none",
    tools: displayOutsideText((plugin.tools ?? []).join(", "), 1_000),
  };
}

/**
 * `binference plugin list`: every installed community plugin through `plugin/list`: its name and
 * version, whether it is on and why not, whether npm provenance backs it, and its tools as the
 * agent calls them. With `--json` it prints the page as the operation answers it.
 */
export async function runPluginList(run: CommandRun): Promise<ExitCode> {
  const { host, output } = run;
  return withEngine(host, output, async (client, signal) => {
    const page = await client.call("plugin/list", {}, { signal });
    output.json(jsonValueSchema.parse(z.encode(operations["plugin/list"].result, page)));
    output.say("plugin.count", { count: page.items.length });
    for (const plugin of page.items) {
      output.item("plugin.item", pluginValues(plugin));
    }
    return 0;
  });
}

/** The change `plugin enable`, `disable` and `remove` make. */
type PluginChange = "pluginEnable" | "pluginDisable" | "pluginRemove";

const doneKeys: Readonly<Record<PluginChange, string>> = {
  pluginEnable: "plugin.enabled",
  pluginDisable: "plugin.disabled",
  pluginRemove: "plugin.removed",
};

async function changed(
  client: ProtocolClient,
  change: { readonly name: PluginChange; readonly plugin: PluginView["plugin"] },
  signal: AbortSignal,
) {
  const args = { plugin: change.plugin };
  if (change.name === "pluginRemove") {
    return client.call("plugin/remove", args, { signal });
  }
  const op = change.name === "pluginEnable" ? "plugin/enable" : "plugin/disable";
  const view = await client.call(op, args, { signal });
  return z.encode(operations[op].result, view);
}

/**
 * `binference plugin enable`, `disable` and `remove <name>`: finds the installed plugin by its
 * name through `plugin/list`, then turns it on, turns it off at once, or removes it with its data.
 * A name no plugin has is `plugin.not_found`. With `--json` it prints what the operation answers.
 */
export async function runPluginChange(
  run: CommandRun,
  chosen: { readonly name: PluginChange; readonly plugin: string },
): Promise<ExitCode> {
  const { host, output } = run;
  return withEngine(host, output, async (client, signal) => {
    const page = await client.call("plugin/list", {}, { signal });
    const found = page.items.find((plugin) => plugin.name === chosen.plugin);
    const shown = { plugin: displayOutsideText(chosen.plugin, nameLength) };
    if (found === undefined) {
      output.fail({ code: "plugin.not_found", key: "plugin.notInstalled", values: shown });
      return 1;
    }
    const answer = await changed(client, { name: chosen.name, plugin: found.plugin }, signal);
    output.json(jsonValueSchema.parse(answer));
    output.say(doneKeys[chosen.name], shown);
    return 0;
  });
}
