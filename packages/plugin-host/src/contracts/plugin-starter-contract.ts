import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import { channelLines } from "../channel/channel-lines.js";
import { maxMessageBytes } from "../channel/channel-message.schema.js";
import type { PluginStarter } from "../ports.js";
import type { PluginLaunch } from "../process/plugin-node-arguments.js";

/** A starter, and a plugin whose entry module exports one tool, `echo`. */
export interface PluginStarterSubject {
  readonly starter: PluginStarter;
  readonly launch: PluginLaunch;
  /** The plugin's entry module, an absolute path inside its package folder. */
  readonly entry: string;
}

/** Makes a fresh subject for each check. */
export interface PluginStarterHarness {
  create(): Promise<PluginStarterSubject>;
}

const startLine = (entry: string, dataFolder: string): string =>
  `${JSON.stringify({ kind: "start", entry, dataFolder, config: null, hosts: [] })}\n`;

/** The contract every `PluginStarter` adapter passes. */
export function pluginStarterContract(harness: PluginStarterHarness): readonly ContractCheck[] {
  return [
    {
      name: "starts the plugin, which answers start with ready and its tools",
      run: async () => {
        const { starter, launch, entry } = await harness.create();
        const program = await starter.start(launch, AbortSignal.timeout(30_000));
        await program.write(startLine(entry, launch.folders.dataFolder));
        const first = await channelLines(program.output, maxMessageBytes).next();
        await program.end();
        assert.deepEqual(first.done === true ? undefined : JSON.parse(first.value), {
          kind: "ready",
          tools: ["echo"],
        });
        await program.exited;
      },
    },
    {
      name: "ends the plugin at once on kill",
      run: async () => {
        const { starter, launch } = await harness.create();
        const program = await starter.start(launch, AbortSignal.timeout(30_000));
        program.kill();
        assert.notEqual(await program.exited, 0);
      },
    },
    {
      name: "ends the plugin when the signal aborts",
      run: async () => {
        const { starter, launch } = await harness.create();
        const stop = new AbortController();
        const program = await starter.start(launch, stop.signal);
        stop.abort();
        assert.notEqual(await program.exited, 0);
      },
    },
  ];
}
