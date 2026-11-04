import type { RuntimePlugin } from "@binference/runtime";
import { describe, expect, it } from "vitest";
import { createPluginSwitch } from "./plugin-switch.js";

const withTools: readonly RuntimePlugin[] = [
  {
    plugin: "plg_0192b3c4-d5e6-7f80-9a1b-2c3d4e5f6a7b",
    id: "fear-index",
    tools: [{ name: "index", description: "The index.", input: { type: "object" } }],
  },
];

describe("the community plugin switch", () => {
  it("is on while the runtime takes a plugin's tools, and stays on until it dropped them", async () => {
    const seen: boolean[] = [];
    const plugins = createPluginSwitch(async () => {
      seen.push(plugins.isOn());
      return Promise.resolve();
    });

    await plugins.offer(withTools);
    const afterOn = plugins.isOn();
    await plugins.offer([]);

    expect(seen).toStrictEqual([true, true]);
    expect([afterOn, plugins.isOn()]).toStrictEqual([true, false]);
  });

  it("stays off for plugins that offer no tool", async () => {
    const plugins = createPluginSwitch(async () => Promise.resolve());
    const toolless = { plugin: "plg_0192b3c4-d5e6-7f80-9a1b-2c3d4e5f6a7b", id: "feed", tools: [] };

    await plugins.offer([toolless]);

    expect(plugins.isOn()).toBe(false);
  });
});
