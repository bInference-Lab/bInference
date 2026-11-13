import { Console } from "node:console";
import process from "node:process";

// The runtime's standard output is its control pipe to the engine, one JSON line per message, and
// a line the engine cannot read ends the runtime. So every console method that writes to standard
// output writes to standard error instead, whatever bundled library calls it: the MCP SDK's client
// writes a line with `console.debug` for a server that lists no tools. The runtime's entry imports
// this module first, so it runs before the code of any other module.
const toStderr = new Console({ stdout: process.stderr, stderr: process.stderr });

Object.assign(globalThis.console, {
  log: toStderr.log.bind(toStderr),
  info: toStderr.info.bind(toStderr),
  debug: toStderr.debug.bind(toStderr),
  dir: toStderr.dir.bind(toStderr),
  dirxml: toStderr.dirxml.bind(toStderr),
  table: toStderr.table.bind(toStderr),
  trace: toStderr.trace.bind(toStderr),
  group: toStderr.group.bind(toStderr),
  groupCollapsed: toStderr.groupCollapsed.bind(toStderr),
  groupEnd: toStderr.groupEnd.bind(toStderr),
  count: toStderr.count.bind(toStderr),
  countReset: toStderr.countReset.bind(toStderr),
  time: toStderr.time.bind(toStderr),
  timeLog: toStderr.timeLog.bind(toStderr),
  timeEnd: toStderr.timeEnd.bind(toStderr),
});
