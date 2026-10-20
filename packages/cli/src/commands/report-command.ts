import { homedir } from "node:os";
import { dirname } from "node:path";
import { ensurePrivateFolder, writePrivateFile } from "@binference/platform";
import { platformOf } from "../compose/engine-locations.js";
import type { ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import { collectReport, reportFileOf } from "../report/collect-report.js";

/**
 * `binference report` (decision 0263): writes the support bundle, a JSON file the owner may read
 * and share, to `reports/` in the state folder, owner-only, and names it. It holds the versions,
 * the config with each secret source shown as its kind, the findings of `binference check`, the
 * engine's status if it answers, and the newest engine log lines kept by their field rules. It
 * never reads a key, a database, a chat or a saved address, and every value is cut to what the
 * rules of `src/report/` keep. It works with the engine stopped and before `init`. With `--json`
 * it prints `{ file }`. Exits 0 once the file is written.
 */
export async function runReport(run: CommandRun): Promise<ExitCode> {
  const { host, output } = run;
  const platform = platformOf(host);
  const signal = new AbortController().signal;
  const places = { home: host.homeDir ?? homedir() };
  const bundle = await collectReport(host, places);
  const file = reportFileOf(host, host.clock.now());
  const files = { permissions: platform.permissions, signal };
  await ensurePrivateFolder(dirname(file), files);
  await writePrivateFile(file, `${JSON.stringify(bundle, undefined, 2)}\n`, files);
  output.json({ file });
  output.say("report.written", { file });
  return 0;
}
