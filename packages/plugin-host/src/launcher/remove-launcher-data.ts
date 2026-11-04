import { connect } from "node:net";
import { BinferenceError } from "@binference/core";
import { dataRemovedLine } from "./serve-launcher.js";

/**
 * Asks the image's plugin launcher at `socket` to remove a plugin's data folder, which only the
 * plugin user may change (decision 0351). It names the plugin by its id alone; the launcher picks
 * the folder. It settles once the launcher says the folder is gone, and fails
 * `plugin.launcher_unreachable` when no launcher answers, or `plugin.data_not_removed` when the
 * launcher closes without saying so or the signal aborts first.
 */
export async function removeLauncherData(
  options: { readonly socket: string },
  id: string,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect(options.socket);
    const said = { text: "" };
    const kill = (): void => {
      socket.destroy();
    };
    if (signal.aborted) {
      kill();
    }
    signal.addEventListener("abort", kill, { once: true });
    socket.on("data", (chunk: Buffer) => {
      said.text += chunk.toString("utf8");
      // The launcher answers one short line; anything longer is not its answer.
      if (said.text.length > dataRemovedLine.length) {
        kill();
      }
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
    socket.once("close", () => {
      signal.removeEventListener("abort", kill);
      if (said.text === dataRemovedLine) {
        resolve();
        return;
      }
      reject(
        new BinferenceError({
          code: "plugin.data_not_removed",
          message: `The plugin launcher did not remove the data folder of ${id}.`,
          details: { plugin: id },
        }),
      );
    });
    socket.once("connect", () => {
      socket.write(`${JSON.stringify({ plugin: id, removeData: true })}\n`);
    });
  });
}
