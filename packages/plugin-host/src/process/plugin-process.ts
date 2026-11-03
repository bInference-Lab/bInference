import process from "node:process";
import { pathToFileURL } from "node:url";
import { lockDown } from "./lock-down.js";
import { toolsOfModule } from "./plugin-module.schema.js";
import { isSealedRun } from "./sealed-run.js";
import { servePlugin } from "./serve-plugin.js";

// The program the plugin host starts for each community plugin with `pluginNodeArguments`
// (decisions 0300 and 0343). The plugin's code runs in this process, so nothing here is a
// boundary: the host checks every message as the plugin's own. Unless it runs sealed, with the
// permission model, exactly the host's flags and no NODE_OPTIONS, it stops at once; else it locks
// V8's flags and its own exit down before the plugin's code loads.
const sealed = isSealedRun({
  permission: process.permission,
  execArgv: process.execArgv,
  nodeOptions: process.env["NODE_OPTIONS"],
});
if (sealed) {
  lockDown();
  await servePlugin({
    input: process.stdin,
    write: (line) => process.stdout.write(line),
    load: async (entry) => toolsOfModule(await import(pathToFileURL(entry).href)),
  });
}
process.exit(sealed ? 0 : 3);
