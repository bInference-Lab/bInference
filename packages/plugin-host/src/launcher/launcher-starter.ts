import { connect } from "node:net";
import { BinferenceError } from "@binference/core";
import type { PluginStarter } from "../ports.js";

/**
 * The starter of the image (decision 0344): it asks the plugin launcher at `socket` to start a
 * plugin by its id, and holds the plugin through that connection. The launcher picks the
 * plugin's folders from its id alone and runs it under the plugin user, which cannot signal the
 * engine. The connection's end is the plugin's: its exit code does not cross it.
 */
export function createLauncherStarter(options: { readonly socket: string }): PluginStarter {
  return {
    ownUser: true,
    start: async (launch, signal) =>
      new Promise((resolve, reject) => {
        const socket = connect(options.socket);
        const kill = (): void => {
          socket.destroy();
        };
        signal.addEventListener("abort", kill, { once: true });
        const exited = new Promise<number | undefined>((settle) => {
          socket.once("close", () => {
            signal.removeEventListener("abort", kill);
            settle(undefined);
          });
        });
        socket.once("error", (cause) =>
          reject(
            new BinferenceError({
              code: "plugin.launcher_unreachable",
              message: "The plugin launcher does not answer on its socket.",
              cause,
            }),
          ),
        );
        socket.once("connect", () => {
          socket.write(`${JSON.stringify({ plugin: launch.id })}\n`);
          resolve({
            write: async (text) =>
              new Promise((written, failed) => {
                socket.write(text, (error) => (error instanceof Error ? failed(error) : written()));
              }),
            end: async () =>
              new Promise((ended) => {
                socket.end(() => ended());
              }),
            output: socket,
            exited,
            kill,
          });
        });
      }),
  };
}
